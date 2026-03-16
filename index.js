/* global toastr, jQuery, SillyTavern */

import { setExtensionPrompt, chat_metadata, saveChatDebounced, extension_prompt_roles, extension_prompt_types } from '../../../../script.js';

const MODULE_NAME = "BB-Interactive-Map";

const MAP_PROMPT = `<task>
Analyze the recent roleplay context and generate a topological schematic of the environment.
{{scaleInstruction}}
</task>
{{previousMap}}
<rules>
1. Map the surroundings into zones: "center", "north", "south", "east", "west", and optionally corners ("northwest", etc.). CRITICAL: Each zone MUST have a UNIQUE "position". Never assign the same position to multiple zones.
2. Put characters INSIDE their current zone.
3. For the map itself, determine the overall "atmosphere" (e.g., "🌙 Ночь | 🌧️ Идет дождь" or "☀️ День | ☕ Спокойно"). Use '|' to separate distinct atmospheric traits.
4. For EACH zone, assign a "threat_level": "safe", "tension" (suspicious/uneasy), or "danger" (combat/traps), AND a "threat_reason" (Short atmospheric phrase describing WHY, e.g., "Комфортно. Тепло. Аура безопасности" or "Холод, тьма, присутствие врагов").
5. For EACH zone, list 1-3 "poi" (Points of Interest - items, details, furniture).
6. For EACH character, provide "mood" (emoji + short state) and "attitude" (how they feel about the user).
7. "thought" is a 1-sentence current thought of the character.
8. Keep zone "name" very short (1-3 words).
9. Output STRICTLY as raw JSON.
</rules>

<format>
{
  "schematic_name": "Общее название локации",
  "atmosphere": "Атмосфера | Время | Погода",
  "zones": [
    {
      "position": "center", 
      "name": "Название",
      "summary": "Краткое описание...",
      "threat_level": "safe",
      "threat_reason": "Комфортно. Мягкий свет, аура спокойствия",
      "poi": ["Деталь 1", "Объект 2"],
      "characters": [
        { 
          "name": "Имя", 
          "mood": "😠 Раздражен", 
          "attitude": "Настороженное", 
          "thought": "Мысль..." 
        }
      ]
    }
  ]
}
</format>

<context>
Recent chat: """{{lastMessages}}"""
</context>`;

function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function extractJSON(text) {
    let str = String(text).trim().replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
    let start = str.indexOf('{');
    let end = str.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error("API не вернуло JSON. Попробуйте еще раз.");
    return JSON.parse(str.substring(start, end + 1));
}

function buildMapContextString(mapData) {
    if (!mapData || !mapData.zones) return "";
    let contextStr = `[Системная справка: Игрок находится в локации "${mapData.schematic_name}". Атмосфера: ${mapData.atmosphere}. `;
    mapData.zones.forEach(zone => {
        let chars = "";
        if (zone.characters && zone.characters.length > 0) {
            chars = " Персонажи: " + zone.characters.map(c => `${c.name} (${c.mood}, отношение: ${c.attitude})`).join(", ") + ".";
        }
        let poi = "";
        if (zone.poi && zone.poi.length > 0) {
            poi = " Объекты: " + zone.poi.join(", ") + ".";
        }
        
        let threatContext = "";
        if (zone.threat_level === "danger") threatContext = ` [🔴 ОПАСНОСТЬ: ${zone.threat_reason || "Неизвестно"}]`;
        else if (zone.threat_level === "tension") threatContext = ` [🟠 Напряжение: ${zone.threat_reason || "Подозрительно"}]`;
        else if (zone.threat_reason) threatContext = ` [🟢 Безопасно: ${zone.threat_reason}]`;

        if (chars || poi || zone.threat_level !== "safe" || zone.threat_reason) {
            contextStr += `В зоне "${zone.name}" (${zone.position})${threatContext}: ${zone.summary}${chars}${poi} `;
        }
    });
    contextStr += `]`;
    return contextStr;
}

function getMapDataForCurrentChat() {
    if (!chat_metadata) return null;
    return chat_metadata['bb_map_data'] || null;
}

function injectCurrentMapContext() {
    try {
        const mapData = getMapDataForCurrentChat();
        if (mapData && mapData.context) {
            setExtensionPrompt('bb_map_injector', mapData.context, extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.USER);
        } else {
            setExtensionPrompt('bb_map_injector', '', extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.USER);
        }
    } catch (e) {
        console.error("[BB Map] Ошибка инъекции промпта:", e);
    }
}

function showControlCenter() {
    const old = document.getElementById('bb-map-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bb-map-overlay';
    overlay.className = 'bb-map-overlay';

    const mapData = getMapDataForCurrentChat();
    const statusHtml = (mapData && mapData.context) 
        ? `<div style="color: #4ade80; font-size: 11px; font-weight: bold; margin-top: 5px; animation: dangerPulse 2s infinite;">🟢 ПАМЯТЬ ЛОКАЦИИ АКТИВНА</div>`
        : `<div style="color: #94a3b8; font-size: 11px; font-weight: bold; margin-top: 5px;">⚪ ПАМЯТЬ ЛОКАЦИИ ПУСТА</div>`;

    let openMapBtnHtml = '';
    if (mapData && mapData.raw) {
        openMapBtnHtml = `
            <button class="bb-hub-btn" id="bb-hub-open-btn" style="border-color: rgba(91, 192, 190, 0.5); color: #5bc0be;">
                <i class="fa-solid fa-map"></i> ОТКРЫТЬ СОХРАНЕННУЮ КАРТУ
            </button>
        `;
    }

    // === ПРЕМИУМ ПЕРЕКЛЮЧАТЕЛЬ МАСШТАБА (СЕГМЕНТИРОВАННАЯ КНОПКА) ===
    const scaleSelectorHtml = `
        <style>
            .bb-scale-toggle { display: flex; background: #070709; border: 1px solid #1f1f22; border-radius: 8px; overflow: hidden; margin-bottom: -5px; }
            .bb-scale-btn { flex: 1; padding: 10px 0; text-align: center; font-size: 11px; font-weight: bold; color: #64748b; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; justify-content: center; gap: 6px; }
            .bb-scale-btn.active { background: rgba(91, 192, 190, 0.15); color: #5bc0be; border-bottom: 2px solid #5bc0be; }
            .bb-scale-btn:hover:not(.active) { background: rgba(255, 255, 255, 0.05); color: #e2e8f0; }
        </style>
        <div class="bb-scale-toggle" id="bb-map-scale-toggle" data-mode="local">
            <div class="bb-scale-btn active" data-val="local"><i class="fa-solid fa-crosshairs"></i> Комната</div>
            <div class="bb-scale-btn" data-val="global"><i class="fa-solid fa-globe"></i> Здание</div>
        </div>
    `;

    overlay.innerHTML = `
        <div class="bb-hub-modal">
            <div class="bb-map-header-container" style="border-bottom: none; padding-bottom: 0;">
                <div class="bb-map-title">🛰️ ТЕРМИНАЛ КАРТЫ</div>
                ${statusHtml}
            </div>
            
            ${openMapBtnHtml}
            ${scaleSelectorHtml}

            <button class="bb-hub-btn" id="bb-hub-scan-btn">
                <i class="fa-solid fa-satellite-dish"></i> ЗАПУСТИТЬ НОВЫЙ СКАН
            </button>
            
            <button class="bb-hub-btn" id="bb-hub-view-btn">
                <i class="fa-solid fa-eye"></i> ПОСМОТРЕТЬ ТЕКСТ ПАМЯТИ
            </button>
            
            <div class="bb-memory-viewer" id="bb-memory-display"></div>

            <button class="bb-hub-btn bb-hub-btn-danger" id="bb-hub-clear-btn">
                <i class="fa-solid fa-trash-can"></i> ОЧИСТИТЬ ТЕКСТ ПАМЯТИ
            </button>

            <button class="bb-hub-btn" style="margin-top: 10px; border-color: transparent;" id="bb-hub-close-btn">
                ЗАКРЫТЬ
            </button>
        </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.style.opacity = '1');

    // Логика переключателя
    const toggleBtns = overlay.querySelectorAll('.bb-scale-btn');
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            toggleBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('bb-map-scale-toggle').setAttribute('data-mode', this.getAttribute('data-val'));
        });
    });

    if (mapData && mapData.raw) {
        document.getElementById('bb-hub-open-btn').onclick = function() {
            showRadarModal(mapData.raw, true);
        };
    }

    document.getElementById('bb-hub-scan-btn').onclick = function() {
        triggerMapScan(this);
    };

    document.getElementById('bb-hub-view-btn').onclick = function() {
        const viewer = document.getElementById('bb-memory-display');
        const currentData = getMapDataForCurrentChat();
        if (currentData && currentData.context) {
            viewer.innerHTML = `<span>Слепок этого чата:</span><br/>${escapeHtml(currentData.context)}`;
        } else {
            viewer.innerHTML = `<i>Память радара для этого чата чиста. ИИ не удерживает локацию.</i>`;
        }
        viewer.classList.toggle('active');
    };

    const clearBtn = document.getElementById('bb-hub-clear-btn');
    clearBtn.onclick = function() {
        try {
            if (chat_metadata) {
                delete chat_metadata['bb_map_data']; 
                saveChatDebounced(); 
                injectCurrentMapContext(); 
            }
        } catch (e) {
            console.error("[BB Map] Ошибка очистки API:", e);
        }
        
        // @ts-ignore
        toastr.success('Память радара для этого чата успешно стерта!', 'BB Map Terminal');

        clearBtn.innerHTML = "🗑️ ПАМЯТЬ УСПЕШНО СТЕРТА!";
        clearBtn.style.background = "rgba(239, 68, 68, 0.4)";
        clearBtn.style.color = "#fff";
        
        const viewer = document.getElementById('bb-memory-display');
        if (viewer && viewer.classList.contains('active')) {
            viewer.innerHTML = `<i>Память радара чиста.</i>`;
        }

        setTimeout(() => {
            showControlCenter(); 
        }, 1500);
    };

    document.getElementById('bb-hub-close-btn').onclick = () => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    };
}

function showRadarModal(data, isSavedMap = false) {
    const old = document.getElementById('bb-map-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bb-map-overlay';
    overlay.className = 'bb-map-overlay';

    let gridHtml = '';
    const allowedPositions = ['center', 'north', 'south', 'east', 'west', 'northwest', 'northeast', 'southwest', 'southeast'];
    const telemetryData = []; 

    const userName = SillyTavern.getContext().name1 || "";

    const mergedZones = {};
    (data.zones || []).forEach(zone => {
        if (!allowedPositions.includes(zone.position)) return;
        
        if (!mergedZones[zone.position]) {
            mergedZones[zone.position] = { ...zone }; 
        } else {
            mergedZones[zone.position].name += " / " + zone.name;
            mergedZones[zone.position].summary += " " + zone.summary;
            
            if (zone.threat_level === 'danger' || mergedZones[zone.position].threat_level === 'danger') {
                mergedZones[zone.position].threat_level = 'danger';
            } else if (zone.threat_level === 'tension' && mergedZones[zone.position].threat_level !== 'danger') {
                mergedZones[zone.position].threat_level = 'tension';
            }
            
            if (zone.threat_reason) {
                mergedZones[zone.position].threat_reason = (mergedZones[zone.position].threat_reason ? mergedZones[zone.position].threat_reason + " | " : "") + zone.threat_reason;
            }

            if (zone.characters) {
                mergedZones[zone.position].characters = (mergedZones[zone.position].characters || []).concat(zone.characters);
            }
            if (zone.poi) {
                mergedZones[zone.position].poi = (mergedZones[zone.position].poi || []).concat(zone.poi);
            }
        }
    });

    Object.values(mergedZones).forEach(zone => {
        let charsHtml = '';
        (zone.characters || []).forEach(char => {
            const safeName = escapeHtml(char.name);
            const charInfo = `<b>👤 ${safeName}</b><br/>🎭 <b>Состояние:</b> <span style="color:#e2e8f0;">${escapeHtml(char.mood || '😐 Спокоен')}</span><br/>🤝 <b>Отношение:</b> <span style="color:#e2e8f0;">${escapeHtml(char.attitude || 'Нейтральное')}</span><br/><i>💭 "${escapeHtml(char.thought)}"</i>`;
            const dataIndex = telemetryData.push(charInfo) - 1;
            
            const isUser = userName && safeName.toLowerCase().includes(userName.toLowerCase());
            const userClass = isUser ? " user-char" : "";
            
            charsHtml += `<div class="bb-char-badge interactable-node${userClass}" data-id="${dataIndex}">${safeName.charAt(0)}</div>`;
        });

        const safeZoneName = escapeHtml(zone.name);
        const threatClass = zone.threat_level ? `threat-${zone.threat_level}` : 'threat-safe';
        
        let threatIcon = '🟢';
        if (zone.threat_level === 'danger') threatIcon = '🔴';
        if (zone.threat_level === 'tension') threatIcon = '🟠';

        let reasonHtml = '';
        if (zone.threat_reason) {
            reasonHtml = `<br/><br/>${threatIcon} <b>Обстановка:</b> <span style="color:#cbd5e1;">${escapeHtml(zone.threat_reason)}</span>`;
        }
        
        let poiHtml = '';
        if (zone.poi && Array.isArray(zone.poi) && zone.poi.length > 0) {
            const spacer = reasonHtml ? '<br/>' : '<br/><br/>';
            poiHtml = `${spacer}<b style="color:#5bc0be;">🔍 Объекты:</b><br/>` + zone.poi.map(p => `• <span style="color:#cbd5e1;">${escapeHtml(p)}</span>`).join('<br/>');
        }

        const zoneInfo = `<b>📍 ${safeZoneName}</b><br/><small style="color:#94a3b8;">${escapeHtml(zone.summary)}</small>${reasonHtml}${poiHtml}`;
        const dataIndex = telemetryData.push(zoneInfo) - 1;
        
        gridHtml += `
            <div class="bb-zone zone-${zone.position} ${threatClass} interactable-node" data-id="${dataIndex}">
                <div class="bb-zone-title">${safeZoneName}</div>
                <div class="bb-zone-chars">${charsHtml}</div>
            </div>
        `;
    });

    let tagsHtml = '';
    if (data.atmosphere) {
        const tags = data.atmosphere.split('|').map(t => t.trim()).filter(t => t.length > 0);
        tagsHtml = tags.map(t => `<span class="bb-header-tag">${escapeHtml(t)}</span>`).join('');
    }

    let saveBtnHtml = isSavedMap
        ? `<button class="bb-map-btn bb-btn-save" id="bb-map-save-btn" style="opacity: 0.5; cursor: not-allowed; background: rgba(91, 192, 190, 0.1);" disabled>✅ УЖЕ В ПАМЯТИ</button>`
        : `<button class="bb-map-btn bb-btn-save" id="bb-map-save-btn">💾 ЗАПОМНИТЬ ЛОКАЦИЮ</button>`;

    overlay.innerHTML = `
        <div class="bb-map-modal">
            <div class="bb-map-header-container">
                <div class="bb-map-title">📐 ${escapeHtml(data.schematic_name || 'НЕИЗВЕСТНАЯ ЛОКАЦИЯ')}</div>
                ${tagsHtml ? `<div class="bb-header-tags">${tagsHtml}</div>` : ''}
            </div>
            
            <div class="bb-schematic-grid">
                ${gridHtml}
            </div>
            
            <div class="bb-telemetry-screen" id="bb-telemetry">
                <span style="opacity:0.5;">[ОЖИДАНИЕ ВВОДА] Наведите курсор или кликните для фиксации...</span>
            </div>

            <div class="bb-map-controls">
                ${saveBtnHtml}
                <button class="bb-map-btn" id="bb-map-back-btn">НАЗАД В ТЕРМИНАЛ</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.style.opacity = '1');

    const telemetryScreen = overlay.querySelector('#bb-telemetry');
    let lockedNode = null;
    function updateTelemetry(content, isLocked = false) {
        const lockMarker = isLocked ? `<div style="color:#5bc0be; font-size:10px; font-weight:bold; margin-bottom:5px; border-bottom:1px solid rgba(91, 192, 190, 0.3); padding-bottom:3px;">🔒 ЗАФИКСИРОВАНО (Кликните еще раз для сброса)</div>` : '';
        telemetryScreen.innerHTML = lockMarker + content;
    }

    overlay.querySelectorAll('.interactable-node').forEach(el => {
        el.addEventListener('mouseenter', (e) => {
            e.stopPropagation(); 
            if (!lockedNode) updateTelemetry(telemetryData[el.getAttribute('data-id')]);
        });
        el.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            if (!lockedNode) telemetryScreen.innerHTML = '<span style="opacity:0.5;">[ОЖИДАНИЕ ВВОДА] Наведите курсор или кликните для фиксации...</span>';
        });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const info = telemetryData[el.getAttribute('data-id')];
            if (lockedNode === el) {
                lockedNode.classList.remove('node-locked');
                lockedNode = null;
                updateTelemetry(info); 
            } else {
                if (lockedNode) lockedNode.classList.remove('node-locked');
                lockedNode = el;
                lockedNode.classList.add('node-locked');
                updateTelemetry(info, true);
            }
        });
    });

    const saveBtn = document.getElementById('bb-map-save-btn');
    if (!isSavedMap) {
        saveBtn.onclick = function() {
            try {
                if (chat_metadata) {
                    const contextStr = buildMapContextString(data);
                    chat_metadata['bb_map_data'] = {
                        raw: data,
                        context: contextStr
                    };
                    saveChatDebounced(); 
                    injectCurrentMapContext(); 
                }
            } catch (e) {
                console.error("[BB Map] Ошибка сохранения API:", e);
            }
            
            // @ts-ignore
            toastr.success('Данные карты успешно привязаны к этому чату!', 'BB Map Memory');

            saveBtn.innerHTML = "✅ ПАМЯТЬ УСПЕШНО СОХРАНЕНА!";
            saveBtn.style.background = "rgba(74, 222, 128, 0.3)";
            saveBtn.style.borderColor = "#4ade80";
            saveBtn.style.color = "#4ade80";
            saveBtn.style.transform = "scale(1.02)";
            
            setTimeout(() => {
                saveBtn.innerHTML = "💾 ОБНОВИТЬ ЛОКАЦИЮ";
                saveBtn.style.background = "";
                saveBtn.style.borderColor = "";
                saveBtn.style.color = "";
                saveBtn.style.transform = "scale(1)";
            }, 2000);
        };
    }

    document.getElementById('bb-map-back-btn').onclick = () => {
        showControlCenter();
    };
}

async function triggerMapScan(btnElement) {
    const chat = SillyTavern.getContext().chat;
    if (!chat || chat.length === 0) {
        // @ts-ignore
        return toastr.warning("Чат пуст. Карта не сможет сформироваться!", "BB Map");
    }

    const recentMessages = chat.slice(-3).map(m => `${m.name}: ${m.mes}`).join('\n\n');
    
    // === ЧИТАЕМ РЕЖИМ МАСШТАБА ИЗ UI ===
    const scaleToggle = document.getElementById('bb-map-scale-toggle');
    const scaleMode = scaleToggle ? scaleToggle.getAttribute('data-mode') : 'local';
    
    let scaleInstruction = "";
    if (scaleMode === 'global') {
        scaleInstruction = `[CRITICAL MACRO SCALE]: Map the ENTIRE building/district. "center" is the current room as a whole. You MUST populate ALL 8 surrounding zones (north, south, east, west, northwest, northeast, southwest, southeast) with logical adjacent rooms, corridors, facilities, or outdoor areas to fill the entire 3x3 grid. Invent logical surrounding locations if they aren't in the chat. DO NOT LEAVE ZONES EMPTY.`;
    } else {
        scaleInstruction = `[CRITICAL MICRO SCALE]: Map strictly the IMMEDIATE single room. "center" is the exact spot the characters are standing. "north/south/east/west" and corners are just different walls/areas of this SAME room.`;
    }

    // === ПОДКЛЮЧАЕМ ИНЕРЦИОННУЮ ПАМЯТЬ ===
    const prevData = getMapDataForCurrentChat();
    let prevMapInstruction = "";
    if (prevData && prevData.context) {
        prevMapInstruction = `\n<previous_topology>\nThis was the LAST known map state:\n"""\n${prevData.context}\n"""\nCRITICAL: Maintain logical spatial continuity! If characters moved, shift the focus logically (e.g. what was 'north' might now be 'center' or 'south'). Do NOT just copy it, adapt it to the latest events.\n</previous_topology>\n`;
    }

    const oldHtml = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> СКАНИРОВАНИЕ...';
    btnElement.style.pointerEvents = "none"; 

    try {
        let prompt = MAP_PROMPT
            .replace('{{lastMessages}}', recentMessages)
            .replace('{{scaleInstruction}}', scaleInstruction)
            .replace('{{previousMap}}', prevMapInstruction);
            
        const ctx = SillyTavern.getContext();
        
        // @ts-ignore
        let result = await ctx.generateQuietPrompt(prompt);
        
        const data = extractJSON(result);
        showRadarModal(data, false); 
    } catch (err) {
        console.error(err);
        // @ts-ignore
        toastr.error('Ошибка карты: ' + err.message, 'BB Map');
        btnElement.innerHTML = oldHtml;
        btnElement.style.pointerEvents = "auto";
    } 
}

function setupExtensionSettings() {
    if ($('#bb-map-settings-wrapper').length > 0) return;
    
    const settingsHtml = `
        <div id="bb-map-settings-wrapper" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🛰️ BB Interactive Map</b>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding: 10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="bb_map_enable_toggle" checked>
                    <span>Показывать кнопку "Интерактивная карта" в меню Расширения</span>
                </label>
                <small style="display:block; margin-top:5px; color:#94a3b8;">
                    Эта настройка включает или отключает доступ к терминалу радара.
                </small>
            </div>
        </div>
    `;
    $('#extensions_settings').append(settingsHtml);

    $('#bb_map_enable_toggle').on('change', function() {
        if ($(this).is(':checked')) {
            $('#bb-map-menu-container').show();
        } else {
            $('#bb-map-menu-container').hide();
        }
    });
}

function injectMapButtonToWandMenu() {
    if ($("#bb-map-menu-item").length > 0) return;
    const menuItem = $(`
        <div id="bb-map-menu-container" class="extension_container interactable" tabindex="0">
            <div id="bb-map-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-fw fa-solid fa-satellite-dish extensionsMenuExtensionButton" style="color: #5bc0be;"></div>
                <span style="color: #e2e8f0;">Интерактивная карта</span>
            </div>
        </div>
    `);
    const extensionsMenu = $("#extensionsMenu");
    if (extensionsMenu.length > 0) {
        extensionsMenu.append(menuItem);
        $(document).on("click", "#bb-map-menu-item", function(e) {
            e.preventDefault();
            showControlCenter();
        });
    } else {
        setTimeout(injectMapButtonToWandMenu, 1000);
    }
}

jQuery(async () => {
    try {
        const { eventSource, event_types } = SillyTavern.getContext();
        
        eventSource.on(event_types.APP_READY, () => {
            injectMapButtonToWandMenu();
            setupExtensionSettings();
            injectCurrentMapContext(); 
        });
        
        eventSource.on(event_types.CHAT_CHANGED, () => {
            injectCurrentMapContext();
        });

        setTimeout(() => {
            injectMapButtonToWandMenu();
            setupExtensionSettings();
        }, 2000);
    } catch (e) { console.error("[BB Map] Ошибка запуска:", e); }
});
