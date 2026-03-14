/* global toastr, jQuery, SillyTavern */
(function () {
    const MODULE_NAME = "BB-Interactive-Map";

    let currentMapContext = "";

    const MAP_PROMPT = `<task>
Analyze the recent roleplay context and generate a topological schematic of the immediate area.
</task>

<rules>
1. Map the surroundings into zones: "center", "north", "south", "east", "west", and optionally corners ("northwest", etc.).
2. Put characters INSIDE their current zone.
3. For the map itself, determine the overall "atmosphere" (e.g., "🌙 Ночь | 🌧️ Идет дождь" or "☀️ День | ☕ Спокойно"). Use '|' to separate distinct atmospheric traits.
4. For EACH zone, assign a "threat_level": "safe", "tension" (suspicious/uneasy), or "danger" (combat/traps).
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
            if (chars || poi || zone.threat_level !== "safe") {
                let threat = zone.threat_level === "danger" ? " [ОПАСНОСТЬ!]" : zone.threat_level === "tension" ? " [Напряженная обстановка]" : "";
                contextStr += `В зоне "${zone.name}" (${zone.position})${threat}: ${zone.summary}${chars}${poi} `;
            }
        });
        contextStr += `]`;
        return contextStr;
    }

    function showControlCenter() {
        const old = document.getElementById('bb-map-overlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'bb-map-overlay';
        overlay.className = 'bb-map-overlay';

        const statusHtml = currentMapContext 
            ? `<div style="color: #4ade80; font-size: 11px; font-weight: bold; margin-top: 5px; animation: dangerPulse 2s infinite;">🟢 ПАМЯТЬ АКТИВНА</div>`
            : `<div style="color: #94a3b8; font-size: 11px; font-weight: bold; margin-top: 5px;">⚪ ПАМЯТЬ ПУСТА</div>`;

        overlay.innerHTML = `
            <div class="bb-hub-modal">
                <div class="bb-map-header-container" style="border-bottom: none; padding-bottom: 0;">
                    <div class="bb-map-title">🛰️ ТЕРМИНАЛ КАРТЫ</div>
                    ${statusHtml}
                </div>
                
                <button class="bb-hub-btn" id="bb-hub-scan-btn">
                    <i class="fa-solid fa-satellite-dish"></i> ЗАПУСТИТЬ СКАН ЛОКАЦИИ
                </button>
                
                <button class="bb-hub-btn" id="bb-hub-view-btn">
                    <i class="fa-solid fa-eye"></i> ПОСМОТРЕТЬ ПАМЯТЬ РАДАРА
                </button>
                
                <div class="bb-memory-viewer" id="bb-memory-display"></div>

                <button class="bb-hub-btn bb-hub-btn-danger" id="bb-hub-clear-btn">
                    <i class="fa-solid fa-trash-can"></i> ОЧИСТИТЬ ПАМЯТЬ
                </button>

                <button class="bb-hub-btn" style="margin-top: 10px; border-color: transparent;" id="bb-hub-close-btn">
                    ЗАКРЫТЬ
                </button>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.style.opacity = '1');

        document.getElementById('bb-hub-scan-btn').onclick = function() {
            triggerMapScan(this);
        };

        document.getElementById('bb-hub-view-btn').onclick = function() {
            const viewer = document.getElementById('bb-memory-display');
            if (currentMapContext) {
                viewer.innerHTML = `<span>Текущий слепок:</span><br/>${escapeHtml(currentMapContext)}`;
            } else {
                viewer.innerHTML = `<i>Память радара чиста. ИИ не удерживает локацию в контексте.</i>`;
            }
            viewer.classList.toggle('active');
        };

        const clearBtn = document.getElementById('bb-hub-clear-btn');
        clearBtn.onclick = function() {
            try {
                const ctx = SillyTavern.getContext();
                currentMapContext = "";
                if (typeof ctx.addExtensionPrompt === 'function') {
                    ctx.addExtensionPrompt('bb_map_injector', "", 2, 2);
                }
            } catch (e) {
                console.error("[BB Map] Ошибка очистки API:", e);
            }
            
            // 100% Визуальный отклик и Уведомление
            // @ts-ignore
            toastr.success('Память радара успешно стерта!', 'BB Map Terminal');

            clearBtn.innerHTML = "🗑️ ПАМЯТЬ УСПЕШНО СТЕРТА!";
            clearBtn.style.background = "rgba(239, 68, 68, 0.4)";
            clearBtn.style.color = "#fff";
            
            const viewer = document.getElementById('bb-memory-display');
            if (viewer && viewer.classList.contains('active')) {
                viewer.innerHTML = `<i>Память радара чиста.</i>`;
            }

            setTimeout(() => {
                clearBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i> ОЧИСТИТЬ ПАМЯТЬ`;
                clearBtn.style.background = "";
                showControlCenter(); 
            }, 1500);
        };

        document.getElementById('bb-hub-close-btn').onclick = () => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 300);
        };
    }

    function showRadarModal(data) {
        const old = document.getElementById('bb-map-overlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'bb-map-overlay';
        overlay.className = 'bb-map-overlay';

        let gridHtml = '';
        const allowedPositions = ['center', 'north', 'south', 'east', 'west', 'northwest', 'northeast', 'southwest', 'southeast'];
        const telemetryData = []; 

        (data.zones || []).forEach(zone => {
            if (!allowedPositions.includes(zone.position)) return;

            let charsHtml = '';
            (zone.characters || []).forEach(char => {
                const safeName = escapeHtml(char.name);
                const charInfo = `<b>👤 ${safeName}</b><br/>🎭 <b>Состояние:</b> <span style="color:#e2e8f0;">${escapeHtml(char.mood || '😐 Спокоен')}</span><br/>🤝 <b>Отношение:</b> <span style="color:#e2e8f0;">${escapeHtml(char.attitude || 'Нейтральное')}</span><br/><i>💭 "${escapeHtml(char.thought)}"</i>`;
                const dataIndex = telemetryData.push(charInfo) - 1;
                charsHtml += `<div class="bb-char-badge interactable-node" data-id="${dataIndex}">${safeName.charAt(0)}</div>`;
            });

            const safeZoneName = escapeHtml(zone.name);
            const threatClass = zone.threat_level ? `threat-${zone.threat_level}` : 'threat-safe';
            
            let poiHtml = '';
            if (zone.poi && Array.isArray(zone.poi) && zone.poi.length > 0) {
                poiHtml = `<br/><br/><b style="color:#5bc0be;">🔍 Объекты:</b><br/>` + zone.poi.map(p => `• <span style="color:#cbd5e1;">${escapeHtml(p)}</span>`).join('<br/>');
            }

            const zoneInfo = `<b>📍 ${safeZoneName}</b><br/><small style="color:#94a3b8;">${escapeHtml(zone.summary)}</small>${poiHtml}`;
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
                    <button class="bb-map-btn bb-btn-save" id="bb-map-save-btn">💾 ЗАПОМНИТЬ ЛОКАЦИЮ</button>
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
        saveBtn.onclick = function() {
            try {
                const ctx = SillyTavern.getContext();
                currentMapContext = buildMapContextString(data);
                if (typeof ctx.addExtensionPrompt === 'function') {
                    ctx.addExtensionPrompt('bb_map_injector', currentMapContext, 2, 2);
                }
            } catch (e) {
                console.error("[BB Map] Ошибка сохранения API:", e);
            }
            
            // 100% Визуальный отклик и Уведомление
            // @ts-ignore
            toastr.success('Данные карты успешно загружены в радар ИИ!', 'BB Map Memory');

            saveBtn.innerHTML = "✅ УСПЕШНО ЗАПИСАНО В МОЗГ ИИ!";
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
        const oldHtml = btnElement.innerHTML;
        btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> СКАНИРОВАНИЕ...';
        btnElement.style.pointerEvents = "none"; 

        try {
            let prompt = MAP_PROMPT.replace('{{lastMessages}}', recentMessages);
            const ctx = SillyTavern.getContext();
            
            // @ts-ignore
            let result = await ctx.generateQuietPrompt(prompt);
            
            const data = extractJSON(result);
            showRadarModal(data);
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
                        <span>Показывать кнопку "Интерактивная карта" в меню магии</span>
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
                    <span style="color: #e2e8f0;">Терминал Карты (BB)</span>
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
            });
            setTimeout(() => {
                injectMapButtonToWandMenu();
                setupExtensionSettings();
            }, 2000);
        } catch (e) { console.error("[BB Map] Ошибка запуска:", e); }
    });
})();