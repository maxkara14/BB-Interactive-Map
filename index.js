/* global toastr, jQuery, SillyTavern */

import { setExtensionPrompt, chat_metadata, saveChatDebounced, saveSettingsDebounced, extension_prompt_roles, extension_prompt_types, generateQuietPrompt } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { normalizeMapData, poiName, createSavedMap, restorePreviousMap } from './map-state.js';

const MODULE_NAME = "BB-Interactive-Map";

if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = {
        useCustomApi: false,
        customApiUrl: 'https://api.groq.com/openai/v1',
        customApiKey: '',
        customApiModel: '',
        useMacro: false
    };
}

const settings = extension_settings[MODULE_NAME];
if (!['main', 'profile', 'custom'].includes(settings.generationSource)) {
    settings.generationSource = settings.useCustomApi ? 'custom' : 'main';
}
settings.uiLanguage ??= 'auto';
settings.connectionProfileId ??= '';
settings.showMenuButton ??= true;
settings.showWidget ??= true;
settings.widgetCollapsed ??= true;

const WIDGET_POSITIONS = ['northwest', 'north', 'northeast', 'west', 'center', 'east', 'southwest', 'south', 'southeast'];

function currentLanguage() {
    if (settings.uiLanguage === 'ru' || settings.uiLanguage === 'en') return settings.uiLanguage;
    return (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function tr(ru, en) {
    return currentLanguage() === 'ru' ? ru : en;
}

const MAP_PROMPT = `<task>
Analyze the recent roleplay context and generate a topological schematic of the environment.
{{scaleInstruction}}
</task>
{{previousMap}}
<rules>
1. Map the surroundings into zones: "center", "north", "south", "east", "west", and optionally corners ("northwest", etc.). CRITICAL: Each zone MUST have a UNIQUE "position". Never assign the same position to multiple zones.
2. Put characters INSIDE their current zone.
3. For the map itself, determine the overall "atmosphere" (e.g., "🌙 Night | 🌧️ Rain" or "☀️ Day | ☕ Calm"). Use '|' to separate distinct atmospheric traits.
4. For EACH zone, assign a "threat_level": "safe", "tension" (suspicious/uneasy), or "danger" (combat/traps), AND a "threat_reason" (short phrase describing WHY, e.g., "Warm and quiet" or "Darkness and hostile presence").
5. For EACH zone, list 1-3 "poi" (Points of Interest - items, details, furniture) as objects with "name" and a short "description".
6. For EACH character, provide a short "description", "mood" (emoji + short state) and "attitude" (how they feel about the user).
7. "thought" is a 1-sentence current thought of the character.
8. Keep zone "name" very short (1-3 words).
9. Output STRICTLY as raw JSON.
10. Write descriptive JSON values in the language of the recent chat. Keep JSON keys and enum values in English.
</rules>

<format>
{
  "schematic_name": "Location name",
  "atmosphere": "Atmosphere | Time | Weather",
  "zones": [
    {
      "position": "center", 
      "name": "Zone name",
      "summary": "Short description...",
      "threat_level": "safe",
      "threat_reason": "Warm light and calm surroundings",
      "poi": [{ "name": "Object 1", "description": "A short visible detail" }],
      "characters": [
        { 
          "name": "Name",
          "description": "A short visible detail",
          "mood": "😠 Irritated",
          "attitude": "Wary",
          "thought": "A brief thought..."
        }
      ]
    }
  ]
}
</format>

<context>
Recent chat: """{{lastMessages}}"""
</context>`;

async function runMainGen(promptText) {
    if (typeof generateQuietPrompt === 'function') {
        return await generateQuietPrompt(promptText);
    } else if (typeof window['generateQuietPrompt'] === 'function') {
        return await window['generateQuietPrompt'](promptText);
    } else {
        throw new Error(tr('Функция генерации SillyTavern недоступна.', 'SillyTavern generation is unavailable.'));
    }
}

function getProfileService() {
    const service = SillyTavern.getContext().ConnectionManagerRequestService;
    if (!service || typeof service.getSupportedProfiles !== 'function' || typeof service.sendRequest !== 'function') {
        throw new Error(tr('Менеджер подключений недоступен.', 'Connection Manager is unavailable.'));
    }
    return service;
}

async function runProfileGen(promptText) {
    const service = getProfileService();
    let profiles;
    try {
        profiles = service.getSupportedProfiles();
    } catch {
        throw new Error(tr('Менеджер подключений недоступен.', 'Connection Manager is unavailable.'));
    }
    if (!settings.connectionProfileId || !profiles.some(profile => profile.id === settings.connectionProfileId)) {
        throw new Error(tr('Выберите доступный профиль подключения.', 'Select an available connection profile.'));
    }
    let response;
    try {
        response = await service.sendRequest(settings.connectionProfileId,
            [{ role: 'system', content: 'Generate only the requested JSON map.' }, { role: 'user', content: promptText }],
            4000, { stream: false, extractData: true, includePreset: true, includeInstruct: true });
    } catch {
        throw new Error(tr('Запрос через профиль не удался.', 'The profile request failed.'));
    }
    const content = typeof response === 'string' ? response : response?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error(tr('Профиль вернул пустой ответ.', 'The profile returned an empty response.'));
    }
    return content;
}

async function generateMapFast(promptText) {
    const s = settings;
    if (s.generationSource === 'profile') return runProfileGen(promptText);
    if (s.generationSource === 'custom') {
        if (!s.customApiUrl || !s.customApiModel) {
            return runMainGen(promptText);
        }
        try {
            const baseUrl = s.customApiUrl.replace(/\/$/, '');
            const endpoint = baseUrl + '/chat/completions';
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${s.customApiKey || ''}`
                },
                body: JSON.stringify({
                    model: s.customApiModel,
                    messages: [
                        { role: 'system', content: 'You are an internal JSON generator for a topological map. Output ONLY valid JSON.' },
                        { role: 'user', content: promptText }
                    ],
                    temperature: 0.7,
                    max_tokens: 4000,
                    stream: false
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const content = data?.choices?.[0]?.message?.content || "";
            if (!content.trim()) throw new Error('Empty response');
            return content;
        } catch {
            console.warn('[BB Map] Custom API failed; using the main connection.');
            return await runMainGen(promptText);
        }
    } else {
        return await runMainGen(promptText);
    }
}

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
    if (start === -1 || end === -1) throw new Error(tr('Ответ не содержит JSON. Попробуйте ещё раз.', 'The response contains no JSON. Please try again.'));
    try {
        return JSON.parse(str.substring(start, end + 1));
    } catch {
        throw new Error(tr('Ответ содержит некорректный JSON. Попробуйте ещё раз.', 'The response contains invalid JSON. Please try again.'));
    }
}

function getMapDataForCurrentChat() {
    if (!chat_metadata) return null;
    return chat_metadata['bb_map_data'] || null;
}

// === ИЗМЕНЕНО: Логика инъекции теперь учитывает useMacro ===
function injectCurrentMapContext() {
    try {
        const mapData = getMapDataForCurrentChat();
        if (mapData && mapData.context && !extension_settings[MODULE_NAME].useMacro) {
            setExtensionPrompt('bb_map_injector', mapData.context, extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.USER);
        } else {
            setExtensionPrompt('bb_map_injector', '', extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.USER);
        }
    } catch (e) {
        console.error("[BB Map] Ошибка инъекции промпта:", e);
    }
}

function showControlCenter() {
    const chatForHub = SillyTavern.getContext().chat;
    const old = document.getElementById('bb-map-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bb-map-overlay';
    overlay.className = 'bb-map-overlay';

    const mapData = getMapDataForCurrentChat();
    const statusHtml = (mapData && mapData.context) 
        ? `<div style="color: #4ade80; font-size: 11px; font-weight: bold; margin-top: 5px; animation: dangerPulse 2s infinite;">🟢 ${tr('ПАМЯТЬ ЛОКАЦИИ АКТИВНА', 'LOCATION MEMORY ACTIVE')}</div>`
        : `<div style="color: #94a3b8; font-size: 11px; font-weight: bold; margin-top: 5px;">⚪ ${tr('ПАМЯТЬ ЛОКАЦИИ ПУСТА', 'LOCATION MEMORY EMPTY')}</div>`;

    let openMapBtnHtml = '';
    if (mapData && mapData.raw) {
        openMapBtnHtml = `
            <button class="bb-hub-btn" id="bb-hub-open-btn" style="border-color: rgba(91, 192, 190, 0.5); color: #5bc0be;">
                <i class="fa-solid fa-map"></i> ${tr('ОТКРЫТЬ СОХРАНЁННУЮ КАРТУ', 'OPEN SAVED MAP')}
            </button>
        `;
    }
    const restoreBtnHtml = mapData?.previous?.raw
        ? `<button class="bb-hub-btn" id="bb-hub-restore-btn">↶ ${tr('ВОССТАНОВИТЬ ПРЕДЫДУЩУЮ КАРТУ', 'RESTORE PREVIOUS MAP')}</button>`
        : '';

    const scaleSelectorHtml = `
        <style>
            .bb-scale-toggle { display: flex; background: #070709; border: 1px solid #1f1f22; border-radius: 8px; overflow: hidden; margin-bottom: -5px; }
            .bb-scale-btn { flex: 1; padding: 10px 0; text-align: center; font-size: 11px; font-weight: bold; color: #64748b; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; justify-content: center; gap: 6px; }
            .bb-scale-btn.active { background: rgba(91, 192, 190, 0.15); color: #5bc0be; border-bottom: 2px solid #5bc0be; }
            .bb-scale-btn:hover:not(.active) { background: rgba(255, 255, 255, 0.05); color: #e2e8f0; }
        </style>
        <div class="bb-scale-toggle" id="bb-map-scale-toggle" data-mode="local">
            <div class="bb-scale-btn active" data-val="local"><i class="fa-solid fa-crosshairs"></i> ${tr('Комната', 'Room')}</div>
            <div class="bb-scale-btn" data-val="global"><i class="fa-solid fa-globe"></i> ${tr('Здание', 'Building')}</div>
        </div>
    `;

    overlay.innerHTML = `
        <div class="bb-hub-modal">
            <div class="bb-map-header-container" style="border-bottom: none; padding-bottom: 0;">
                <div class="bb-map-title">🛰️ ${tr('ТЕРМИНАЛ КАРТЫ', 'MAP TERMINAL')}</div>
                ${statusHtml}
            </div>
            
            ${openMapBtnHtml}
            ${restoreBtnHtml}
            ${scaleSelectorHtml}

            <button class="bb-hub-btn" id="bb-hub-scan-btn">
                <i class="fa-solid fa-satellite-dish"></i> ${tr('ЗАПУСТИТЬ НОВЫЙ СКАН', 'START NEW SCAN')}
            </button>
            
            <button class="bb-hub-btn" id="bb-hub-view-btn">
                <i class="fa-solid fa-eye"></i> ${tr('ПОСМОТРЕТЬ ТЕКСТ ПАМЯТИ', 'VIEW MEMORY TEXT')}
            </button>
            
            <div class="bb-memory-viewer" id="bb-memory-display"></div>

            <button class="bb-hub-btn bb-hub-btn-danger" id="bb-hub-clear-btn">
                <i class="fa-solid fa-trash-can"></i> ${tr('ОЧИСТИТЬ ТЕКСТ ПАМЯТИ', 'CLEAR MEMORY TEXT')}
            </button>

            <button class="bb-hub-btn" style="margin-top: 10px; border-color: transparent;" id="bb-hub-close-btn">
                ${tr('ЗАКРЫТЬ', 'CLOSE')}
            </button>
        </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.style.opacity = '1');

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

    const restoreBtn = document.getElementById('bb-hub-restore-btn');
    if (restoreBtn) restoreBtn.onclick = () => {
        if (SillyTavern.getContext().chat !== chatForHub) {
            showControlCenter();
            return;
        }
        const restored = restorePreviousMap(getMapDataForCurrentChat());
        if (!restored || !chat_metadata) return;
        chat_metadata['bb_map_data'] = restored;
        saveChatDebounced();
        injectCurrentMapContext();
        renderMapWidget();
        showControlCenter();
        toastr.success(tr('Предыдущая карта восстановлена.', 'Previous map restored.'), 'BB Map');
    };

    document.getElementById('bb-hub-scan-btn').onclick = function() {
        triggerMapScan(this);
    };

    document.getElementById('bb-hub-view-btn').onclick = function() {
        const viewer = document.getElementById('bb-memory-display');
        const currentData = getMapDataForCurrentChat();
        if (currentData && currentData.context) {
            viewer.innerHTML = `<span>${tr('Снимок этого чата:', 'Snapshot for this chat:')}</span><br/>${escapeHtml(currentData.context)}`;
        } else {
            viewer.innerHTML = `<i>${tr('Память карты для этого чата пуста.', 'Map memory is empty for this chat.')}</i>`;
        }
        viewer.classList.toggle('active');
    };

    const clearBtn = document.getElementById('bb-hub-clear-btn');
    clearBtn.onclick = function() {
        if (SillyTavern.getContext().chat !== chatForHub) {
            showControlCenter();
            return;
        }
        try {
            if (chat_metadata) {
                delete chat_metadata['bb_map_data']; 
                saveChatDebounced(); 
                injectCurrentMapContext(); 
                renderMapWidget();
            }
        } catch (e) {
            console.error("[BB Map] Ошибка очистки API:", e);
        }
        
        // @ts-ignore
        toastr.success(tr('Память карты для этого чата очищена!', 'Map memory cleared for this chat!'), 'BB Map Terminal');

        clearBtn.textContent = `🗑️ ${tr('ПАМЯТЬ ОЧИЩЕНА!', 'MEMORY CLEARED!')}`;
        clearBtn.style.background = "rgba(239, 68, 68, 0.4)";
        clearBtn.style.color = "#fff";
        
        const viewer = document.getElementById('bb-memory-display');
        if (viewer && viewer.classList.contains('active')) {
            viewer.innerHTML = `<i>${tr('Память карты пуста.', 'Map memory is empty.')}</i>`;
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

function showRadarModal(data, isSavedMap = false, chatForMap = SillyTavern.getContext().chat) {
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
            const description = char.description ? `<br/>${escapeHtml(char.description)}` : '';
            const charInfo = `<b>👤 ${safeName}</b>${description}<br/>🎭 <b>${tr('Состояние:', 'Mood:')}</b> <span style="color:#e2e8f0;">${escapeHtml(char.mood || tr('😐 Спокоен', '😐 Calm'))}</span><br/>🤝 <b>${tr('Отношение:', 'Attitude:')}</b> <span style="color:#e2e8f0;">${escapeHtml(char.attitude || tr('Нейтральное', 'Neutral'))}</span><br/><i>💭 "${escapeHtml(char.thought)}"</i>`;
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
            reasonHtml = `<br/><br/>${threatIcon} <b>${tr('Обстановка:', 'Conditions:')}</b> <span style="color:#cbd5e1;">${escapeHtml(zone.threat_reason)}</span>`;
        }
        
        let poiHtml = '';
        if (zone.poi && Array.isArray(zone.poi) && zone.poi.length > 0) {
            const spacer = reasonHtml ? '<br/>' : '<br/><br/>';
            poiHtml = `${spacer}<b style="color:#5bc0be;">🔍 ${tr('Объекты:', 'Objects:')}</b><br/>` + zone.poi.map(p => {
                const detail = typeof p === 'object' && p?.description ? ` — ${escapeHtml(p.description)}` : '';
                return `• <span style="color:#cbd5e1;">${escapeHtml(poiName(p))}${detail}</span>`;
            }).join('<br/>');
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
        ? `<button class="bb-map-btn bb-btn-save" id="bb-map-save-btn" style="opacity: 0.5; cursor: not-allowed; background: rgba(91, 192, 190, 0.1);" disabled>✅ ${tr('УЖЕ В ПАМЯТИ', 'ALREADY SAVED')}</button>`
        : `<button class="bb-map-btn bb-btn-save" id="bb-map-save-btn">💾 ${tr('ЗАПОМНИТЬ ЛОКАЦИЮ', 'SAVE LOCATION')}</button>`;

    overlay.innerHTML = `
        <div class="bb-map-modal">
            <div class="bb-map-header-container">
                <div class="bb-map-title">📐 ${escapeHtml(data.schematic_name || tr('НЕИЗВЕСТНАЯ ЛОКАЦИЯ', 'UNKNOWN LOCATION'))}</div>
                ${tagsHtml ? `<div class="bb-header-tags">${tagsHtml}</div>` : ''}
            </div>
            
            <div class="bb-schematic-grid">
                ${gridHtml}
            </div>
            
            <div class="bb-telemetry-screen" id="bb-telemetry">
                <span style="opacity:0.5;">${tr('[ОЖИДАНИЕ] Наведите курсор или нажмите для выбора...', '[READY] Hover or click to select...')}</span>
            </div>

            <div class="bb-map-controls">
                ${saveBtnHtml}
                <button class="bb-map-btn" id="bb-map-back-btn">${tr('НАЗАД В ТЕРМИНАЛ', 'BACK TO TERMINAL')}</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.style.opacity = '1');

    const telemetryScreen = overlay.querySelector('#bb-telemetry');
    let lockedNode = null;
    function updateTelemetry(content, isLocked = false) {
        const lockMarker = isLocked ? `<div style="color:#5bc0be; font-size:10px; font-weight:bold; margin-bottom:5px; border-bottom:1px solid rgba(91, 192, 190, 0.3); padding-bottom:3px;">🔒 ${tr('ЗАКРЕПЛЕНО (нажмите ещё раз для сброса)', 'PINNED (click again to clear)')}</div>` : '';
        telemetryScreen.innerHTML = lockMarker + content;
    }

    overlay.querySelectorAll('.interactable-node').forEach(el => {
        el.addEventListener('mouseenter', (e) => {
            e.stopPropagation(); 
            if (!lockedNode) updateTelemetry(telemetryData[el.getAttribute('data-id')]);
        });
        el.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            if (!lockedNode) telemetryScreen.innerHTML = `<span style="opacity:0.5;">${tr('[ОЖИДАНИЕ] Наведите курсор или нажмите для выбора...', '[READY] Hover or click to select...')}</span>`;
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
                if (!chat_metadata || SillyTavern.getContext().chat !== chatForMap) {
                    throw new Error(tr('Чат сменился. Запустите скан ещё раз.', 'The chat changed. Please scan again.'));
                }
                chat_metadata['bb_map_data'] = createSavedMap(data, getMapDataForCurrentChat());
                saveChatDebounced();
                injectCurrentMapContext();
                renderMapWidget();
            } catch (e) {
                toastr.error(e.message, 'BB Map Memory');
                return;
            }
            
            // @ts-ignore
            toastr.success(tr('Карта сохранена для этого чата!', 'Map saved for this chat!'), 'BB Map Memory');

            saveBtn.textContent = `✅ ${tr('КАРТА СОХРАНЕНА!', 'MAP SAVED!')}`;
            saveBtn.disabled = true;
            saveBtn.style.background = "rgba(74, 222, 128, 0.3)";
            saveBtn.style.borderColor = "#4ade80";
            saveBtn.style.color = "#4ade80";
            saveBtn.style.transform = "scale(1.02)";
            
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
        return toastr.warning(tr('Чат пуст. Карту пока нельзя создать.', 'The chat is empty. A map cannot be created yet.'), 'BB Map');
    }

    const recentMessages = chat.slice(-3).map(m => `${m.name}: ${m.mes}`).join('\n\n');
    
    const scaleToggle = document.getElementById('bb-map-scale-toggle');
    const scaleMode = scaleToggle ? scaleToggle.getAttribute('data-mode') : 'local';
    
    let scaleInstruction = "";
    if (scaleMode === 'global') {
        scaleInstruction = `[CRITICAL MACRO SCALE]: Map the ENTIRE building/district. "center" is the current room as a whole. You MUST populate ALL 8 surrounding zones (north, south, east, west, northwest, northeast, southwest, southeast) with logical adjacent rooms, corridors, facilities, or outdoor areas to fill the entire 3x3 grid. Invent logical surrounding locations if they aren't in the chat. DO NOT LEAVE ZONES EMPTY.`;
    } else {
        scaleInstruction = `[CRITICAL MICRO SCALE]: Map strictly the IMMEDIATE single room. "center" is the exact spot the characters are standing. "north/south/east/west" and corners are just different walls/areas of this SAME room.`;
    }

    const prevData = getMapDataForCurrentChat();
    let prevMapInstruction = "";
    if (prevData && prevData.context) {
        prevMapInstruction = `\n<previous_topology>\nThis was the LAST known map state:\n"""\n${prevData.context}\n"""\nCRITICAL: Maintain logical spatial continuity! If characters moved, shift the focus logically (e.g. what was 'north' might now be 'center' or 'south'). Do NOT just copy it, adapt it to the latest events.\n</previous_topology>\n`;
    }

    const oldHtml = btnElement.innerHTML;
    btnElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>&nbsp; ${tr('СКАНИРОВАНИЕ...', 'SCANNING...')}`;
    btnElement.style.pointerEvents = "none"; 

    try {
        let prompt = MAP_PROMPT
            .replace('{{lastMessages}}', recentMessages)
            .replace('{{scaleInstruction}}', scaleInstruction)
            .replace('{{previousMap}}', prevMapInstruction);
            
        let result = await generateMapFast(prompt);
        
        if (SillyTavern.getContext().chat !== chat) {
            toastr.warning(tr('Чат сменился во время сканирования. Результат не сохранён.', 'The chat changed during the scan. The result was discarded.'), 'BB Map');
            return;
        }
        const data = normalizeMapData(extractJSON(result), getMapDataForCurrentChat()?.raw);
        showRadarModal(data, false, chat);
    } catch (err) {
        // @ts-ignore
        const message = err?.message === 'invalid_map'
            ? tr('Ответ содержит некорректную структуру карты. Попробуйте ещё раз.', 'The response has an invalid map structure. Please try again.')
            : err.message;
        toastr.error(tr('Ошибка карты: ', 'Map error: ') + message, 'BB Map');
    } finally {
        btnElement.innerHTML = oldHtml;
        btnElement.style.pointerEvents = "auto";
    }
}

function setupExtensionSettings(rebuild = false) {
    const existing = document.getElementById('bb-map-settings-wrapper');
    if (existing && !rebuild) return;
    const target = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!target) return;
    const openGroups = new Set([...existing?.querySelectorAll('details[open]') || []].map(el => el.dataset.section));
    const wasOpen = !!existing && existing.querySelector(':scope > .inline-drawer-content')?.style.display !== 'none';
    const panel = existing || document.createElement('div');
    panel.id = 'bb-map-settings-wrapper';
    panel.className = 'inline-drawer bb-map-settings';

    const heading = document.createElement('div');
    heading.className = 'inline-drawer-toggle inline-drawer-header';
    heading.tabIndex = 0;
    heading.setAttribute('role', 'button');
    heading.innerHTML = '<b>🛰️ BB Interactive Map</b><div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>';
    heading.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); heading.click(); }
    };
    const drawer = document.createElement('div');
    drawer.className = 'inline-drawer-content';
    drawer.style.display = wasOpen ? 'block' : 'none';
    const body = document.createElement('div');
    body.className = 'bb-map-settings-body';
    drawer.append(body);
    panel.replaceChildren(heading, drawer);

    const intro = document.createElement('div');
    intro.className = 'bb-map-settings-intro';
    const title = document.createElement('strong');
    title.textContent = tr('Карта и память сцены', 'Map and scene memory');
    const description = document.createElement('p');
    description.textContent = tr('Выберите язык и источник сканирования.', 'Choose the language and scan connection.');
    intro.append(title, description);
    body.append(intro);

    function group(label, icon, key) {
        const section = document.createElement('details');
        section.className = 'bb-map-settings-section';
        section.dataset.section = key;
        section.open = openGroups.has(key);
        const summary = document.createElement('summary');
        const glyph = document.createElement('span');
        glyph.className = 'bb-map-section-icon';
        glyph.textContent = icon;
        const name = document.createElement('span');
        name.textContent = label;
        summary.append(glyph, name);
        const content = document.createElement('div');
        content.className = 'bb-map-section-body';
        section.append(summary, content);
        body.append(section);
        return content;
    }
    function select(parent, label, value, options, change) {
        const wrap = document.createElement('label');
        wrap.className = 'bb-map-field';
        const caption = document.createElement('span');
        caption.textContent = label;
        const field = document.createElement('select');
        field.className = 'text_pole';
        for (const [optionValue, optionLabel] of options) {
            const option = document.createElement('option');
            option.value = optionValue;
            option.textContent = optionLabel;
            field.append(option);
        }
        field.value = value;
        field.onchange = () => change(field.value);
        wrap.append(caption, field);
        parent.append(wrap);
        return field;
    }
    function input(parent, label, value, type, change) {
        const wrap = document.createElement('label');
        wrap.className = 'bb-map-field';
        const caption = document.createElement('span');
        caption.textContent = label;
        const field = document.createElement('input');
        field.className = 'text_pole';
        field.type = type;
        field.value = value || '';
        if (type === 'password') field.autocomplete = 'off';
        field.onchange = () => change(field.value.trim());
        wrap.append(caption, field);
        parent.append(wrap);
        return field;
    }
    function checkbox(parent, label, checked, change) {
        const wrap = document.createElement('label');
        wrap.className = 'checkbox_label';
        const field = document.createElement('input');
        field.type = 'checkbox';
        field.checked = checked;
        const caption = document.createElement('span');
        caption.textContent = label;
        field.onchange = () => change(field.checked);
        wrap.append(field, caption);
        parent.append(wrap);
    }
    function note(parent, message) {
        const paragraph = document.createElement('p');
        paragraph.className = 'bb-map-settings-note';
        paragraph.textContent = message;
        parent.append(paragraph);
        return paragraph;
    }

    const general = group(tr('Интерфейс', 'Interface'), '⚙', 'general');
    select(general, tr('Язык интерфейса', 'Interface language'), settings.uiLanguage,
        [['auto', tr('Как в браузере', 'Browser language')], ['ru', 'Русский'], ['en', 'English']], value => {
            settings.uiLanguage = value;
            saveSettingsDebounced();
            document.querySelector('#bb-map-menu-item span')?.replaceChildren(document.createTextNode(tr('Интерактивная карта', 'Interactive Map')));
            setupExtensionSettings(true);
            renderMapWidget();
        });
    checkbox(general, tr('Показывать кнопку в меню расширений', 'Show button in Extensions menu'), settings.showMenuButton, checked => {
        settings.showMenuButton = checked;
        document.getElementById('bb-map-menu-container')?.toggleAttribute('hidden', !checked);
        saveSettingsDebounced();
    });
    checkbox(general, tr('Показывать виджет сохранённой карты', 'Show saved map widget'), settings.showWidget, checked => {
        settings.showWidget = checked;
        saveSettingsDebounced();
        renderMapWidget();
    });

    const connection = group(tr('Источник сканирования', 'Scan connection'), '⚡', 'connection');
    const profileBlock = document.createElement('div');
    profileBlock.className = 'bb-map-provider-block';
    const customBlock = document.createElement('div');
    customBlock.className = 'bb-map-provider-block';
    const source = select(connection, tr('Источник', 'Source'), settings.generationSource,
        [['main', tr('Текущее подключение SillyTavern', 'Current SillyTavern connection')],
            ['profile', tr('Профиль подключения SillyTavern', 'SillyTavern connection profile')],
            ['custom', 'Custom API']], value => {
            settings.generationSource = value;
            settings.useCustomApi = value === 'custom';
            profileBlock.hidden = value !== 'profile';
            customBlock.hidden = value !== 'custom';
            saveSettingsDebounced();
            if (value === 'profile') void refreshProfiles();
        });
    connection.append(profileBlock, customBlock);
    profileBlock.hidden = source.value !== 'profile';
    customBlock.hidden = source.value !== 'custom';
    const profiles = select(profileBlock, tr('Профиль подключения', 'Connection profile'), settings.connectionProfileId, [], value => {
        settings.connectionProfileId = value;
        saveSettingsDebounced();
    });
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'menu_button';
    refresh.textContent = tr('↻ Обновить профили', '↻ Refresh profiles');
    profileBlock.append(refresh);
    const profileNote = note(profileBlock, '');
    async function refreshProfiles() {
        refresh.disabled = true;
        profiles.disabled = true;
        try {
            const available = getProfileService().getSupportedProfiles();
            if (!profiles.isConnected) return;
            profiles.replaceChildren();
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = tr('Выберите профиль', 'Select a profile');
            profiles.append(placeholder);
            for (const profile of available) {
                const option = document.createElement('option');
                option.value = profile.id;
                option.textContent = profile.name || profile.id;
                profiles.append(option);
            }
            if (settings.connectionProfileId && !available.some(profile => profile.id === settings.connectionProfileId)) {
                const missing = document.createElement('option');
                missing.value = settings.connectionProfileId;
                missing.textContent = tr('Сохранённый профиль недоступен', 'Saved profile unavailable');
                profiles.append(missing);
            }
            profiles.value = settings.connectionProfileId;
            profiles.disabled = available.length === 0;
            profileNote.textContent = available.length
                ? tr('Используются модель и пресет профиля. Подключение чата не меняется.', 'Uses the profile model and preset. The chat connection stays unchanged.')
                : tr('Нет доступных текстовых профилей.', 'No supported text profiles are available.');
        } catch {
            profileNote.textContent = tr('Менеджер подключений недоступен.', 'Connection Manager is unavailable.');
        } finally {
            refresh.disabled = false;
        }
    }
    refresh.onclick = () => { void refreshProfiles(); };
    if (source.value === 'profile') void refreshProfiles();

    const url = input(customBlock, 'URL', settings.customApiUrl, 'url', value => {
        settings.customApiUrl = value;
        saveSettingsDebounced();
    });
    const key = input(customBlock, tr('API-ключ', 'API key'), settings.customApiKey, 'password', value => {
        settings.customApiKey = value;
        saveSettingsDebounced();
    });
    const model = input(customBlock, tr('Модель', 'Model'), settings.customApiModel, 'text', value => {
        settings.customApiModel = value;
        saveSettingsDebounced();
    });
    const modelList = document.createElement('datalist');
    modelList.id = 'bb-map-model-list';
    model.setAttribute('list', modelList.id);
    customBlock.append(modelList);
    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'menu_button';
    connect.textContent = tr('Подключиться / Обновить модели', 'Connect / Refresh models');
    customBlock.append(connect);
    connect.onclick = async () => {
        if (connect.disabled) return;
        settings.customApiUrl = url.value.trim();
        settings.customApiKey = key.value.trim();
        settings.customApiModel = model.value.trim();
        saveSettingsDebounced();
        connect.disabled = true;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            if (!settings.customApiUrl) throw new Error(tr('Укажите URL.', 'Enter a URL.'));
            const response = await fetch(settings.customApiUrl.replace(/\/+$/, '') + '/models', {
                headers: { Authorization: `Bearer ${settings.customApiKey || ''}` }, signal: controller.signal,
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!Array.isArray(data?.data)) throw new Error(tr('Список моделей недоступен.', 'Model list is unavailable.'));
            modelList.replaceChildren();
            for (const entry of data.data) {
                if (typeof entry?.id !== 'string') continue;
                const option = document.createElement('option');
                option.value = entry.id;
                modelList.append(option);
            }
            toastr.success(tr('Модели загружены!', 'Models loaded!'), 'BB Map');
        } catch (error) {
            const message = error?.name === 'AbortError' ? tr('Время ожидания истекло.', 'Request timed out.') : error.message;
            toastr.error(tr('Ошибка подключения: ', 'Connection error: ') + message, 'BB Map');
        } finally {
            clearTimeout(timer);
            connect.disabled = false;
        }
    };
    note(customBlock, tr('API-ключ сохраняется в настройках SillyTavern.', 'The API key is stored in SillyTavern settings.'));

    const memory = group(tr('Память и пресеты', 'Memory and presets'), '◈', 'memory');
    checkbox(memory, tr('Использовать макрос {{bb_map}} вместо авто-вставки', 'Use {{bb_map}} macro instead of automatic injection'), settings.useMacro, checked => {
        settings.useMacro = checked;
        saveSettingsDebounced();
        injectCurrentMapContext();
    });
    note(memory, tr('Добавьте {{bb_map}} в свой пресет вручную.', 'Add {{bb_map}} to your preset manually.'));

    if (!existing) target.append(panel);
}

function renderMapWidget() {
    document.getElementById('bb-map-widget')?.remove();
    const mapData = getMapDataForCurrentChat();
    if (!settings.showWidget || !Array.isArray(mapData?.raw?.zones)) return;

    const raw = mapData.raw;
    const zones = new Map(raw.zones.filter(zone => zone && WIDGET_POSITIONS.includes(zone.position)).map(zone => [zone.position, zone]));
    const center = zones.get('center');
    const danger = raw.zones.some(zone => zone?.threat_level === 'danger');
    const tension = !danger && raw.zones.some(zone => zone?.threat_level === 'tension');
    const level = danger ? 'danger' : tension ? 'tension' : 'safe';
    const threatText = danger ? tr('Опасность', 'Danger') : tension ? tr('Напряжение', 'Tension') : tr('Безопасно', 'Safe');
    const widget = document.createElement('section');
    widget.id = 'bb-map-widget';
    widget.className = `bb-map-widget bb-map-widget-${level}`;
    widget.setAttribute('aria-label', tr('Виджет карты', 'Map widget'));
    widget.innerHTML = `
        <div class="bb-map-widget-header" tabindex="0" aria-label="${tr('Переместить виджет карты стрелками', 'Move map widget with arrow keys')}">
            <span class="bb-map-widget-signal" aria-hidden="true"></span>
            <span class="bb-map-widget-heading">${escapeHtml(center?.name || raw.schematic_name || tr('Карта', 'Map'))}</span>
            <button type="button" class="bb-map-widget-toggle" aria-label="${settings.widgetCollapsed ? tr('Развернуть карту', 'Expand map') : tr('Свернуть карту', 'Collapse map')}" aria-expanded="${!settings.widgetCollapsed}">${settings.widgetCollapsed ? '▣' : '−'}</button>
        </div>
        <div class="bb-map-widget-content" ${settings.widgetCollapsed ? 'hidden' : ''}>
            <div class="bb-map-widget-meta"><span>${escapeHtml(raw.schematic_name)}</span><span class="bb-map-widget-threat">${threatText}</span></div>
            <div class="bb-map-widget-grid" aria-label="${tr('Схема зон', 'Zone grid')}">
                ${WIDGET_POSITIONS.map(position => {
                    const zone = zones.get(position);
                    const name = zone?.name || '';
                    const threatClass = ['safe', 'tension', 'danger'].includes(zone?.threat_level) ? zone.threat_level : 'safe';
                    return `<span class="bb-map-widget-cell ${zone ? `is-${threatClass}` : 'is-empty'} ${position === 'center' ? 'is-center' : ''}" title="${escapeHtml(name)}">${escapeHtml(name || '·')}</span>`;
                }).join('')}
            </div>
            <button type="button" class="bb-map-widget-open">${tr('Открыть карту', 'Open map')} ↗</button>
        </div>`;
    document.body.append(widget);

    const setPosition = (x, y, save = false) => {
        const width = widget.offsetWidth;
        const height = widget.offsetHeight;
        const nextX = Math.max(8, Math.min(x, window.innerWidth - width - 8));
        const nextY = Math.max(8, Math.min(y, window.innerHeight - height - 8));
        widget.style.left = `${nextX}px`;
        widget.style.top = `${nextY}px`;
        widget.style.right = 'auto';
        widget.style.bottom = 'auto';
        if (save) {
            settings.widgetPosition = { x: nextX, y: nextY };
            saveSettingsDebounced();
        }
    };
    if (Number.isFinite(settings.widgetPosition?.x) && Number.isFinite(settings.widgetPosition?.y)) {
        setPosition(settings.widgetPosition.x, settings.widgetPosition.y);
    }

    widget.querySelector('.bb-map-widget-toggle').onclick = () => {
        settings.widgetCollapsed = !settings.widgetCollapsed;
        saveSettingsDebounced();
        renderMapWidget();
    };
    widget.querySelector('.bb-map-widget-open').onclick = () => {
        const current = getMapDataForCurrentChat();
        if (current?.raw) showRadarModal(current.raw, true);
        else renderMapWidget();
    };

    const handle = widget.querySelector('.bb-map-widget-header');
    let drag = null;
    handle.addEventListener('pointerdown', event => {
        if (event.target.closest('button')) return;
        const bounds = widget.getBoundingClientRect();
        drag = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
        if (drag) setPosition(event.clientX - drag.x, event.clientY - drag.y);
    });
    handle.addEventListener('pointerup', event => {
        if (!drag) return;
        drag = null;
        handle.releasePointerCapture(event.pointerId);
        const bounds = widget.getBoundingClientRect();
        setPosition(bounds.left, bounds.top, true);
    });
    handle.addEventListener('pointercancel', () => { drag = null; });
    handle.addEventListener('keydown', event => {
        const offsets = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
        if (!offsets[event.key]) return;
        event.preventDefault();
        const bounds = widget.getBoundingClientRect();
        setPosition(bounds.left + offsets[event.key][0], bounds.top + offsets[event.key][1], true);
    });
}

function injectMapButtonToWandMenu() {
    if ($("#bb-map-menu-item").length > 0) return;
    const menuItem = $(`
        <div id="bb-map-menu-container" class="extension_container interactable" tabindex="0">
            <div id="bb-map-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-fw fa-solid fa-satellite-dish extensionsMenuExtensionButton" style="color: #5bc0be;"></div>
                <span style="color: #e2e8f0;">${tr('Интерактивная карта', 'Interactive Map')}</span>
            </div>
        </div>
    `);
    const extensionsMenu = $("#extensionsMenu");
    if (extensionsMenu.length > 0) {
        extensionsMenu.append(menuItem);
        menuItem[0].toggleAttribute('hidden', !settings.showMenuButton);
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
        
        // РЕГИСТРАЦИЯ МАКРОСА В TAVERN API
        const context = SillyTavern.getContext();
        if (context.registerMacro) {
            context.registerMacro('bb_map', () => {
                const mapData = getMapDataForCurrentChat();
                return (extension_settings[MODULE_NAME].useMacro && mapData && mapData.context) ? mapData.context : '';
            });
            console.log('[BB Map] Макрос {{bb_map}} зарегистрирован');
        }

        eventSource.on(event_types.APP_READY, () => {
            injectMapButtonToWandMenu();
            setupExtensionSettings();
            injectCurrentMapContext(); 
            renderMapWidget();
        });
        
        eventSource.on(event_types.CHAT_CHANGED, () => {
            injectCurrentMapContext();
            renderMapWidget();
        });
        window.addEventListener('resize', () => {
            if (document.getElementById('bb-map-widget')) renderMapWidget();
        });

        // ЖЕЛЕЗОБЕТОННЫЙ ПЕРЕХВАТЧИК МАКРОСА
        eventSource.on(event_types.GENERATE_AFTER_DATA, (generate_data) => {
            if (extension_settings[MODULE_NAME].useMacro && generate_data && Array.isArray(generate_data.messages)) {
                const mapData = getMapDataForCurrentChat();
                const promptText = (mapData && mapData.context) ? mapData.context : '';
                generate_data.messages.forEach(msg => {
                    if (msg && msg.content && typeof msg.content === 'string' && msg.content.includes('{{bb_map}}')) {
                        msg.content = msg.content.replace(/\{\{bb_map\}\}/g, promptText);
                    }
                });
            }
        });

        setTimeout(() => {
            injectMapButtonToWandMenu();
            setupExtensionSettings();
            renderMapWidget();
        }, 2000);
    } catch (e) { console.error("[BB Map] Ошибка запуска:", e); }
});
