/* global toastr, jQuery, SillyTavern */

import { setExtensionPrompt, chat_metadata, isChatSaving, saveChatConditional, saveChatDebounced, saveSettingsDebounced, extension_prompt_roles, extension_prompt_types, generateQuietPrompt } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { normalizeMapData, poiName, createSavedMap, restorePreviousMap, isSameChat, getMapChanges, getMapMode, getMapTransition, createTravelDraft } from './map-state.js';
import { createChatMapLinks } from './map-links.js';

const MODULE_NAME = "BB-Interactive-Map";
const MAP_MAX_TOKENS = 10000;

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
settings.showWidget ??= true;
settings.widgetCollapsed ??= true;
settings.autoUpdate ??= false;
settings.autoApply ??= false;
settings.highlightMentions ??= false;
if (!['simple', 'enhance'].includes(settings.travelWriting)) settings.travelWriting = 'simple';
if (!['local', 'global'].includes(settings.scanScale)) settings.scanScale = 'local';

const WIDGET_POSITIONS = ['northwest', 'north', 'northeast', 'west', 'center', 'east', 'southwest', 'south', 'southeast'];
let scanInProgress = false;
let generationStopped = false;
let generationSnapshot = null;
let pendingReply = null;
let autoScanTimer = null;
let autoCandidate = null;
let autoCandidateChat = null;
let autoCandidateBase = null;
let autoStatus = 'idle';
let chatMapLinks = null;
let mapTravelController = null;

function getEnhanceActionAPI() {
    const api = globalThis.BBEnhanceGen;
    return api?.apiVersion === 1 && typeof api.generatePlayerAction === 'function' ? api : null;
}

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
        return await generateQuietPrompt({ quietPrompt: promptText, responseLength: MAP_MAX_TOKENS });
    } else if (typeof window['generateQuietPrompt'] === 'function') {
        return await window['generateQuietPrompt']({ quietPrompt: promptText, responseLength: MAP_MAX_TOKENS });
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
            MAP_MAX_TOKENS, { stream: false, extractData: true, includePreset: true, includeInstruct: true });
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
                    max_tokens: MAP_MAX_TOKENS,
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

function getMapContextForCurrentChat() {
    const memory = getMapDataForCurrentChat()?.context || '';
    if (!memory || getMapMode(chat_metadata) !== 'game') return memory;
    return `${memory}\n[Game map: The center zone is the player's last known position. Treat zone threats as circumstances, not predetermined outcomes. A requested transition is an attempt; establish its outcome in the narrative before treating it as completed. Do not invent automatic damage, rolls, or actions for the player.]`;
}

// === ИЗМЕНЕНО: Логика инъекции теперь учитывает useMacro ===
function injectCurrentMapContext() {
    try {
        const memory = getMapContextForCurrentChat();
        if (memory && !extension_settings[MODULE_NAME].useMacro) {
            setExtensionPrompt('bb_map_injector', memory, extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.USER);
        } else {
            setExtensionPrompt('bb_map_injector', '', extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.USER);
        }
    } catch (e) {
        console.error("[BB Map] Ошибка инъекции промпта:", e);
    }
}

function mapFieldLabel(key) {
    const labels = {
        schematic_name: ['Локация', 'Location'], atmosphere: ['Атмосфера', 'Atmosphere'],
        name: ['Название', 'Name'], summary: ['Описание зоны', 'Zone description'],
        threat_level: ['Угроза', 'Threat'], threat_reason: ['Причина угрозы', 'Threat reason'],
        description: ['Описание', 'Description'], mood: ['Состояние', 'Mood'],
        attitude: ['Отношение', 'Attitude'], thought: ['Мысль', 'Thought'],
    };
    return tr(...labels[key]);
}

function mapPositionLabel(position) {
    const labels = {
        center: ['Центр', 'Center'], north: ['Север', 'North'], south: ['Юг', 'South'],
        east: ['Восток', 'East'], west: ['Запад', 'West'], northwest: ['Северо-запад', 'Northwest'],
        northeast: ['Северо-восток', 'Northeast'], southwest: ['Юго-запад', 'Southwest'], southeast: ['Юго-восток', 'Southeast'],
    };
    return labels[position] ? tr(...labels[position]) : '';
}

function mapThreatLabel(value) {
    return value === 'danger' ? tr('Опасность', 'Danger')
        : value === 'tension' ? tr('Напряжение', 'Tension') : tr('Безопасно', 'Safe');
}

function mapChangesHtml(previous, next) {
    const changes = getMapChanges(previous, next);
    const actions = { added: ['Добавлено', 'Added'], removed: ['Убрано с карты', 'Removed from map'],
        moved: ['Перемещение', 'Moved'], changed: ['Изменено', 'Changed'] };
    const types = { scene: ['Сцена', 'Scene'], zone: ['Зона', 'Zone'], character: ['Персонаж', 'Character'], object: ['Предмет', 'Object'] };
    const zoneLabel = (raw, position) => {
        const zone = raw?.zones?.find(zone => zone.position === position);
        return [zone?.name, mapPositionLabel(position)].filter(Boolean).join(' · ');
    };
    const locations = (raw, positions) => (Array.isArray(positions) ? positions : [positions])
        .filter(Boolean).map(position => zoneLabel(raw, position)).join('; ') || '—';
    return `<details class="bb-map-review" open>
        <summary>${tr('Изменения карты', 'Map changes')} <span>${changes.length}</span></summary>
        <p>${tr('Сравнение с сохранённой картой. Удаление с карты не означает, что объект исчез из истории.',
            'Compared with the saved map. Removal from the map does not mean an entity disappeared from the story.')}</p>
        ${changes.length ? `<ul>${changes.map(change => `<li class="bb-map-change bb-map-change-${change.action}">
            <div><span class="bb-map-change-action">${tr(...actions[change.action])}</span> ${tr(...types[change.type])} · <strong>${escapeHtml(change.name)}</strong></div>
            ${change.position ? `<small>${escapeHtml(mapPositionLabel(change.position))}</small>` : ''}
            ${change.from || change.to ? `<div class="bb-map-change-values"><span>${escapeHtml(locations(previous, change.from))}</span><b>→</b><span>${escapeHtml(locations(next, change.to))}</span></div>` : ''}
            ${change.ambiguous ? `<p class="bb-map-change-warning">${tr('Имя повторяется. Нельзя однозначно определить, какая запись изменилась.', 'Repeated name. The changed entry cannot be identified unambiguously.')}</p>` : ''}
            ${change.fields.map(field => `<div class="bb-map-change-field"><small>${mapFieldLabel(field.key)}</small><div class="bb-map-change-values"><span>${escapeHtml(field.key === 'threat_level' ? mapThreatLabel(field.before) : field.before || '—')}</span><b>→</b><span>${escapeHtml(field.key === 'threat_level' ? mapThreatLabel(field.after) : field.after || '—')}</span></div></div>`).join('')}
        </li>`).join('')}</ul>` : `<p>${tr('Изменений нет.', 'No changes.')}</p>`}
    </details>`;
}

function showRadarModal(data, isSavedMap = false, chatForMap = SillyTavern.getContext(), expectedMap = getMapDataForCurrentChat()) {
    mapTravelController?.abort();
    const gameMode = isSavedMap && getMapMode(chat_metadata) === 'game';
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
            <div class="bb-zone zone-${zone.position} ${threatClass} interactable-node" data-id="${dataIndex}" data-position="${zone.position}" ${gameMode ? `role="button" tabindex="0" aria-label="${escapeHtml(zone.name)} · ${escapeHtml(mapPositionLabel(zone.position))}"` : ''}>
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

            ${gameMode ? `<section id="bb-map-travel" class="bb-map-travel" aria-live="polite"><p>${tr('Выберите соседнюю зону для перехода.', 'Select a neighboring zone to travel.')}</p></section>` : ''}
            ${!isSavedMap ? mapChangesHtml(expectedMap?.raw, data) : ''}

            <div class="bb-map-controls">
                ${saveBtnHtml}
                <button type="button" class="bb-map-btn" id="bb-map-edit-btn">${tr('ПРАВИТЬ КАРТУ', 'EDIT MAP')}</button>
                <button class="bb-map-btn" id="bb-map-back-btn">${tr('ЗАКРЫТЬ КАРТУ', 'CLOSE MAP')}</button>
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
            if (mapTravelController) return;
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
            if (gameMode) showTravel(el === lockedNode ? el.dataset.position : null);
        });
        if (gameMode && el.dataset.position) el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
        });
    });

    function showTravel(position) {
        if (mapTravelController) return;
        const panel = overlay.querySelector('#bb-map-travel');
        const transition = getMapTransition(data, position);
        panel.className = 'bb-map-travel';
        panel.replaceChildren();
        const note = document.createElement('p');
        if (!transition) {
            note.textContent = position === 'center'
                ? tr('Вы уже в центральной зоне по сохранённой карте.', 'You are already in the center zone according to the saved map.')
                : tr('Выберите соседнюю зону для перехода. Для переходов карта должна содержать центральную зону.', 'Select a neighboring zone to travel. Travel requires a center zone on the map.');
            panel.append(note);
            return;
        }
        const { from, to } = transition;
        panel.classList.add(`is-${['safe', 'tension', 'danger'].includes(to.threat_level) ? to.threat_level : 'safe'}`);
        const route = document.createElement('strong');
        route.textContent = `${from.name} → ${to.name}`;
        note.textContent = `${mapThreatLabel(to.threat_level || 'safe')} · ${to.threat_reason || tr('Обстановка не описана.', 'Conditions are not described.')}`;
        const source = document.createElement('small');
        source.textContent = tr('По сохранённой карте. Переход добавится в черновик; расположение обновится после событий сцены и сохранения карты.',
            'From the saved map. Travel is added to your draft; the position updates after the scene and saving the map.');
        const prepare = document.createElement('button');
        prepare.type = 'button';
        prepare.className = 'bb-map-btn';
        prepare.textContent = tr('ПОДГОТОВИТЬ ПЕРЕХОД', 'PREPARE TRAVEL');
        const literary = settings.travelWriting === 'enhance';
        const instruction = document.createElement('input');
        instruction.type = 'text'; instruction.className = 'text_pole'; instruction.maxLength = 1000;
        instruction.placeholder = tr('Например: осторожно, не привлекая внимания', 'For example: cautiously, without drawing attention');
        const instructionLabel = document.createElement('label');
        instructionLabel.textContent = tr('Уточнение действия (необязательно)', 'Action detail (optional)');
        instructionLabel.append(instruction);
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'bb-map-btn'; cancel.hidden = true;
        cancel.textContent = tr('ОТМЕНИТЬ ГЕНЕРАЦИЮ', 'CANCEL GENERATION');
        if (literary) {
            prepare.textContent = tr('НАПИСАТЬ ДЕЙСТВИЕ · ENHANCE', 'WRITE ACTION · ENHANCE');
            source.textContent = tr('Запрос через подключение Enhance Gen. Результат добавится в черновик; отправка вручную.', 'A request through the Enhance Gen connection. The result is appended to your draft; sending is manual.');
            if (!getEnhanceActionAPI()) {
                prepare.disabled = true;
                status.textContent = tr('Нужен запущенный Enhance Gen с поддержкой действий карты. Обновите оба расширения или выберите простой текст.', 'Requires a running Enhance Gen with map action support. Update both extensions or choose simple text.');
            }
        }
        cancel.onclick = () => mapTravelController?.abort();
        prepare.onclick = async () => {
            if (!isSameChat(chatForMap, SillyTavern.getContext()) || getMapDataForCurrentChat() !== expectedMap
                || getMapMode(chat_metadata) !== 'game') {
                toastr.warning(tr('Чат, режим или карта изменились. Откройте карту заново.', 'The chat, mode, or map changed. Reopen the map.'), 'BB Map');
                return;
            }
            const composer = document.getElementById('send_textarea');
            if (!composer || composer.disabled || composer.readOnly || document.body.dataset.generating) {
                toastr.warning(tr('Поле ввода сейчас недоступно. Дождитесь завершения ответа.', 'The message input is unavailable. Wait for the reply to finish.'), 'BB Map');
                return;
            }
            if (literary) {
                const api = getEnhanceActionAPI();
                if (!api || mapTravelController) return;
                const controller = new AbortController(); mapTravelController = controller;
                prepare.disabled = true; instruction.disabled = true; cancel.hidden = false;
                status.textContent = tr('Enhance пишет действие…', 'Enhance is writing the action…');
                const isCurrent = () => isSameChat(chatForMap, SillyTavern.getContext())
                    && getMapDataForCurrentChat() === expectedMap && getMapMode(chat_metadata) === 'game' && overlay.isConnected;
                try {
                    const result = await api.generatePlayerAction({ kind: 'map_travel', from, to,
                        mapContext: expectedMap.context || '', instruction: instruction.value, isCurrent, signal: controller.signal });
                    if (result?.status === 'applied') overlay.remove();
                } catch (error) {
                    const messages = {
                        busy: tr('Enhance или таверна уже генерирует. Попробуйте позже.', 'Enhance or SillyTavern is already generating. Try again later.'),
                        draft_changed: tr('Черновик изменился. Результат не применён.', 'The draft changed. The result was not applied.'),
                        stale_chat: tr('Чат изменился. Результат не применён.', 'The chat changed. The result was not applied.'),
                        stale_action: tr('Карта или режим изменились. Результат не применён.', 'The map or mode changed. The result was not applied.'),
                    };
                    status.textContent = error?.name === 'AbortError' ? tr('Отменено. Черновик сохранён.', 'Cancelled. Your draft is preserved.')
                        : messages[error?.code] || tr('Enhance не смог подготовить действие. Проверьте его подключение и лимит ответа; черновик сохранён.', 'Enhance could not prepare the action. Check its connection and response limit; your draft is preserved.');
                } finally {
                    if (mapTravelController === controller) mapTravelController = null;
                    prepare.disabled = false; instruction.disabled = false; cancel.hidden = true;
                }
                return;
            }
            const draft = createTravelDraft(composer.value, transition, currentLanguage());
            if (composer.maxLength >= 0 && draft.length > composer.maxLength) {
                toastr.warning(tr('Действие не помещается в черновик.', 'The action exceeds the draft length limit.'), 'BB Map');
                return;
            }
            composer.value = draft;
            composer.dispatchEvent(new Event('input', { bubbles: true }));
            overlay.remove();
            composer.focus();
            composer.setSelectionRange(draft.length, draft.length);
        };
        panel.append(route, note, source);
        if (literary) panel.append(instructionLabel);
        panel.append(prepare, cancel, status);
    }

    const saveBtn = document.getElementById('bb-map-save-btn');
    overlay.querySelector('#bb-map-edit-btn').onclick = () => showMapEditor(data, isSavedMap, chatForMap, expectedMap);
    if (!isSavedMap) {
        saveBtn.onclick = function() {
            try {
                if (!chat_metadata || !isSameChat(chatForMap, SillyTavern.getContext())) {
                    throw new Error(tr('Чат сменился. Запустите скан ещё раз.', 'The chat changed. Please scan again.'));
                }
                if (getMapDataForCurrentChat() !== expectedMap) {
                    throw new Error(tr('Карта уже изменилась. Запустите скан ещё раз.', 'The map changed. Please scan again.'));
                }
                chat_metadata['bb_map_data'] = createSavedMap(data, getMapDataForCurrentChat());
                saveChatDebounced();
                autoCandidate = null;
                autoCandidateChat = null;
                autoCandidateBase = null;
                autoStatus = 'idle';
                injectCurrentMapContext();
                renderMapWidget();
                setupExtensionSettings(true);
            } catch (e) {
                toastr.error(e.message, 'BB Map Memory');
                return;
            }
            
            // @ts-ignore
            toastr.success(tr('Карта сохранена для этого чата!', 'Map saved for this chat!'), 'BB Map Memory');

            saveBtn.textContent = `✅ ${tr('КАРТА СОХРАНЕНА!', 'MAP SAVED!')}`;
            saveBtn.disabled = true;
            overlay.querySelector('#bb-map-edit-btn').disabled = true;
            saveBtn.style.background = "rgba(74, 222, 128, 0.3)";
            saveBtn.style.borderColor = "#4ade80";
            saveBtn.style.color = "#4ade80";
            saveBtn.style.transform = "scale(1.02)";
            
        };
    }

    document.getElementById('bb-map-back-btn').onclick = () => {
        mapTravelController?.abort();
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    };
}

function showMapEditor(data, isSavedMap, chatForMap, expectedMap) {
    mapTravelController?.abort();
    document.getElementById('bb-map-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'bb-map-overlay';
    overlay.className = 'bb-map-overlay';
    overlay.style.opacity = '1';
    overlay.innerHTML = `<form class="bb-map-modal bb-map-editor">
        <div class="bb-map-header-container"><div class="bb-map-title">${tr('ПРАВКА КАРТЫ', 'EDIT MAP')}</div>
        <p>${tr('Правки появятся в предпросмотре. Для записи в чат сохраните карту.', 'Edits appear in the preview. Save the map to write them to the chat.')}</p></div>
        <div class="bb-map-edit-fields"></div><div class="bb-map-edit-zones"></div>
        <p class="bb-map-edit-error" role="alert" hidden></p>
        <div class="bb-map-controls"><button class="bb-map-btn bb-btn-save" type="submit">${tr('ПРОВЕРИТЬ ПРАВКИ', 'PREVIEW EDITS')}</button>
        <button class="bb-map-btn" type="button" data-cancel>${tr('ОТМЕНИТЬ ПРАВКИ', 'CANCEL EDITS')}</button></div>
    </form>`;
    const form = overlay.querySelector('form');
    const field = (target, key, value, options = null, required = false, label = mapFieldLabel(key)) => {
        const wrapper = document.createElement('label');
        wrapper.textContent = label;
        const input = document.createElement(options ? 'select' : ['summary', 'description', 'thought', 'threat_reason', 'atmosphere'].includes(key) ? 'textarea' : 'input');
        if (options) for (const [optionValue, text] of options) {
            const option = document.createElement('option');
            option.value = optionValue;
            option.textContent = text;
            input.append(option);
        }
        input.name = key;
        input.value = value || '';
        input.required = required;
        if (input.tagName === 'TEXTAREA') input.rows = 2;
        wrapper.append(input);
        target.append(wrapper);
        return input;
    };
    const scene = form.querySelector('.bb-map-edit-fields');
    field(scene, 'schematic_name', data.schematic_name, null, true);
    field(scene, 'atmosphere', data.atmosphere);
    const destinations = data.zones.map((zone, index) => [String(index), `${zone.name} · ${mapPositionLabel(zone.position)}`]);
    const addEntity = (target, type, entry, zoneIndex) => {
        const block = document.createElement('fieldset');
        block.dataset.entityType = type;
        const legend = document.createElement('legend');
        legend.textContent = type === 'character' ? tr('Персонаж', 'Character') : tr('Предмет', 'Object');
        block.append(legend);
        field(block, 'name', poiName(entry), null, true);
        field(block, 'description', entry?.description);
        field(block, 'destination', String(zoneIndex), destinations, false, tr('Зона', 'Zone'));
        if (type === 'character') for (const key of ['mood', 'attitude', 'thought']) field(block, key, entry?.[key]);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'bb-map-edit-remove';
        remove.textContent = tr('Убрать с карты', 'Remove from map');
        remove.onclick = () => block.remove();
        block.append(remove);
        target.append(block);
        return block;
    };
    data.zones.forEach((zone, index) => {
        const section = document.createElement('details');
        section.className = 'bb-map-edit-zone';
        section.dataset.zoneIndex = index;
        section.open = index === 0;
        section.innerHTML = `<summary>${escapeHtml(zone.name)} <small>${mapPositionLabel(zone.position)}</small></summary><div class="bb-map-edit-zone-body"></div>`;
        const body = section.querySelector('.bb-map-edit-zone-body');
        field(body, 'name', zone.name, null, true);
        field(body, 'summary', zone.summary);
        field(body, 'threat_level', zone.threat_level || 'safe', ['safe', 'tension', 'danger'].map(value => [value, mapThreatLabel(value)]));
        field(body, 'threat_reason', zone.threat_reason);
        const entities = document.createElement('div');
        entities.className = 'bb-map-edit-entities';
        body.append(entities);
        for (const entry of zone.poi || []) addEntity(entities, 'object', entry, index);
        for (const entry of zone.characters || []) addEntity(entities, 'character', entry, index);
        const actions = document.createElement('div');
        actions.className = 'bb-map-edit-actions';
        for (const [type, label] of [['object', tr('+ Предмет', '+ Object')], ['character', tr('+ Персонаж', '+ Character')]]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'bb-map-btn';
            button.textContent = label;
            button.onclick = () => addEntity(entities, type, {}, index).querySelector('input').focus();
            actions.append(button);
        }
        body.append(actions);
        form.querySelector('.bb-map-edit-zones').append(section);
    });
    const cancel = () => {
        showRadarModal(data, isSavedMap, chatForMap, expectedMap);
        document.getElementById('bb-map-edit-btn')?.focus();
    };
    form.querySelector('[data-cancel]').onclick = cancel;
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    form.addEventListener('invalid', event => {
        event.target.closest('.bb-map-edit-zone')?.setAttribute('open', '');
    }, true);
    form.onsubmit = event => {
        event.preventDefault();
        try {
            if (!isSameChat(chatForMap, SillyTavern.getContext()) || getMapDataForCurrentChat() !== expectedMap) {
                throw new Error(tr('Чат или сохранённая карта изменились. Откройте карту заново.', 'The chat or saved map changed. Reopen the map.'));
            }
            const readFields = target => Object.fromEntries([...target.querySelectorAll(':scope > label > input, :scope > label > textarea, :scope > label > select')]
                .map(input => [input.name, input.value]));
            const draft = { ...readFields(scene), zones: [...form.querySelectorAll('.bb-map-edit-zone')].map((section, index) => ({
                ...readFields(section.querySelector('.bb-map-edit-zone-body')), position: data.zones[index].position, poi: [], characters: [],
            })) };
            for (const block of form.querySelectorAll('[data-entity-type]')) {
                const { destination, ...entry } = readFields(block);
                draft.zones[Number(destination)][block.dataset.entityType === 'character' ? 'characters' : 'poi'].push(entry);
            }
            const edited = normalizeMapData(draft, expectedMap?.raw);
            if (autoCandidate === data) autoCandidate = edited;
            showRadarModal(edited, false, chatForMap, expectedMap);
        } catch (error) {
            const message = form.querySelector('.bb-map-edit-error');
            message.hidden = false;
            message.textContent = error.message === 'invalid_map'
                ? tr('Проверьте названия зон, персонажей и предметов.', 'Check the zone, character, and object names.') : error.message;
            message.scrollIntoView({ block: 'nearest' });
        }
    };
    document.body.append(overlay);
    scene.querySelector('input').focus();
}

async function createMapCandidate(chatForScan, scaleMode) {
    const chat = chatForScan.chat;
    const recentMessages = chat.slice(-3).map(m => `${m.name}: ${m.mes}`).join('\n\n');
    
    let scaleInstruction = "";
    if (scaleMode === 'global') {
        scaleInstruction = `[CRITICAL MACRO SCALE]: Map the ENTIRE building/district. "center" is the current room as a whole. You MUST populate ALL 8 surrounding zones (north, south, east, west, northwest, northeast, southwest, southeast) with logical adjacent rooms, corridors, facilities, or outdoor areas to fill the entire 3x3 grid. Invent logical surrounding locations if they aren't in the chat. DO NOT LEAVE ZONES EMPTY.`;
    } else {
        scaleInstruction = `[CRITICAL MICRO SCALE]: Map strictly the IMMEDIATE single room. "center" is the exact spot the characters are standing. "north/south/east/west" and corners are just different walls/areas of this SAME room.`;
    }

    const prevData = getMapDataForCurrentChat();
    const modeForScan = getMapMode(chat_metadata);
    if (modeForScan === 'game' && scaleMode === 'global') {
        scaleInstruction = 'Map the nearby established rooms or outdoor areas of the building/district. Center is the player\'s current room. Include only adjacent zones supported by the scene; omit unknown surroundings.';
    }
    let prevMapInstruction = "";
    if (prevData && prevData.context) {
        prevMapInstruction = `\n<previous_topology>\nThis was the LAST known map state:\n"""\n${prevData.context}\n"""\nCRITICAL: Maintain logical spatial continuity! If characters moved, shift the focus logically (e.g. what was 'north' might now be 'center' or 'south'). Do NOT just copy it, adapt it to the latest events.\n</previous_topology>\n`;
    }

    const prompt = MAP_PROMPT
        .replace('{{lastMessages}}', recentMessages)
        .replace('{{scaleInstruction}}', scaleInstruction + (modeForScan === 'game'
            ? '\nGAME MODE: Center the map on the player\'s position supported by the latest narrative. A requested movement alone is not a completed transition. Do not invent threats, adjacent zones, or consequences unsupported by the scene; omit unknown zones even at building scale.' : ''))
        .replace('{{previousMap}}', prevMapInstruction);
    const result = await generateMapFast(prompt);
    if (!isSameChat(chatForScan, SillyTavern.getContext()) || getMapDataForCurrentChat() !== prevData
        || getMapMode(chat_metadata) !== modeForScan) return null;
    return normalizeMapData(extractJSON(result), prevData?.raw);
}

async function triggerMapScan(btnElement, scaleMode = 'local') {
    if (btnElement.disabled || scanInProgress) return;
    const chatForScan = SillyTavern.getContext();
    if (!chatForScan.chat?.length) {
        toastr.warning(tr('Чат пуст. Карту пока нельзя создать.', 'The chat is empty. A map cannot be created yet.'), 'BB Map');
        return;
    }

    const oldHtml = btnElement.innerHTML;
    btnElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>&nbsp; ${tr('СКАНИРОВАНИЕ...', 'SCANNING...')}`;
    btnElement.disabled = true;
    scanInProgress = true;
    try {
        const data = await createMapCandidate(chatForScan, scaleMode);
        if (!data) {
            toastr.warning(tr('Чат или карта изменились во время сканирования. Результат не сохранён.', 'The chat or map changed during the scan. The result was discarded.'), 'BB Map');
            return;
        }
        showRadarModal(data, false, chatForScan);
    } catch (err) {
        // @ts-ignore
        const message = err?.message === 'invalid_map'
            ? tr('Ответ содержит некорректную структуру карты. Попробуйте ещё раз.', 'The response has an invalid map structure. Please try again.')
            : err.message;
        toastr.error(tr('Ошибка карты: ', 'Map error: ') + message, 'BB Map');
    } finally {
        scanInProgress = false;
        btnElement.innerHTML = oldHtml;
        btnElement.disabled = false;
    }
}

function resetAutoUpdate() {
    clearTimeout(autoScanTimer);
    autoScanTimer = null;
    pendingReply = null;
    generationSnapshot = null;
    autoCandidate = null;
    autoCandidateChat = null;
    autoCandidateBase = null;
    autoStatus = 'idle';
}

function queueAutoScan(chatForScan) {
    clearTimeout(autoScanTimer);
    if (autoStatus !== 'waiting' && settings.autoUpdate && !autoCandidate
        && isSameChat(chatForScan, SillyTavern.getContext()) && getMapDataForCurrentChat()?.raw) {
        autoStatus = 'waiting';
        renderMapWidget();
    }
    autoScanTimer = setTimeout(async () => {
        autoScanTimer = null;
        if (!settings.autoUpdate || generationStopped || autoCandidate) return;
        if (!isSameChat(chatForScan, SillyTavern.getContext())) return;
        if (!getMapDataForCurrentChat()?.raw) {
            autoStatus = 'idle';
            return;
        }
        if (document.body.dataset.generating || isChatSaving || scanInProgress) {
            queueAutoScan(chatForScan);
            return;
        }
        const reply = chatForScan.chat?.at(-1);
        const replyText = reply?.mes;
        const baseMap = getMapDataForCurrentChat();
        scanInProgress = true;
        autoStatus = 'scanning';
        renderMapWidget();
        try {
            const candidate = await createMapCandidate(chatForScan, settings.scanScale);
            if (!candidate || generationStopped || !settings.autoUpdate || getMapDataForCurrentChat() !== baseMap
                || chatForScan.chat?.at(-1) !== reply || reply?.mes !== replyText
                || !isSameChat(chatForScan, SillyTavern.getContext())) {
                if (isSameChat(chatForScan, SillyTavern.getContext())) autoStatus = 'idle';
                return;
            }
            if (settings.autoApply) {
                chat_metadata.bb_map_data = createSavedMap(candidate, baseMap);
                await saveChatConditional();
                if (isSameChat(chatForScan, SillyTavern.getContext())) {
                    autoStatus = 'updated';
                    injectCurrentMapContext();
                    setupExtensionSettings(true);
                }
                return;
            }
            autoCandidate = candidate;
            autoCandidateChat = chatForScan;
            autoCandidateBase = getMapDataForCurrentChat();
            autoStatus = 'ready';
        } catch {
            if (isSameChat(chatForScan, SillyTavern.getContext())) {
                console.warn('[BB Map] Automatic scan failed. Check the selected connection and try a manual scan.');
                autoStatus = 'error';
            }
        } finally {
            scanInProgress = false;
            if (isSameChat(chatForScan, SillyTavern.getContext())) renderMapWidget();
        }
    }, 1500);
}

function handleGenerationStarted(type) {
    generationStopped = false;
    pendingReply = null;
    const context = SillyTavern.getContext();
    const last = context.chat?.at(-1);
    generationSnapshot = type === 'quiet' || type === 'impersonate' ? null : {
        context, last, text: last?.mes, finished: last?.gen_finished,
    };
}

function handleMessageReceived(messageId, type) {
    if (!settings.autoUpdate || generationStopped || type === 'first_message' || type === 'extension') return;
    const chatForReply = SillyTavern.getContext();
    const message = chatForReply.chat?.[messageId];
    if (!message || message.is_user || !message.mes) return;
    pendingReply = chatForReply;
    queueAutoScan(chatForReply);
}

function handleGenerationEnded() {
    if (!pendingReply && settings.autoUpdate && !generationStopped && generationSnapshot
        && isSameChat(generationSnapshot.context, SillyTavern.getContext())) {
        const latest = SillyTavern.getContext().chat?.at(-1);
        if (latest && !latest.is_user && latest.mes
            && (latest !== generationSnapshot.last || latest.mes !== generationSnapshot.text
                || latest.gen_finished !== generationSnapshot.finished)) {
            queueAutoScan(generationSnapshot.context);
        }
    }
    pendingReply = null;
    generationSnapshot = null;
}

function handleGenerationStopped() {
    generationStopped = true;
    clearTimeout(autoScanTimer);
    autoScanTimer = null;
    pendingReply = null;
    generationSnapshot = null;
    if (autoStatus === 'waiting') {
        autoStatus = 'idle';
        renderMapWidget();
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
    description.textContent = tr('Сканирование и управление памятью находятся в настройках.', 'Scan and manage map memory here.');
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
    function action(parent, label, handler, className = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `menu_button ${className}`.trim();
        button.textContent = label;
        button.onclick = handler;
        parent.append(button);
        return button;
    }

    const general = group(tr('Интерфейс', 'Interface'), '⚙', 'general');
    select(general, tr('Язык интерфейса', 'Interface language'), settings.uiLanguage,
        [['auto', tr('Как в браузере', 'Browser language')], ['ru', 'Русский'], ['en', 'English']], value => {
            settings.uiLanguage = value;
            saveSettingsDebounced();
            setupExtensionSettings(true);
            renderMapWidget();
        });
    checkbox(general, tr('Показывать виджет сохранённой карты', 'Show saved map widget'), settings.showWidget, checked => {
        settings.showWidget = checked;
        saveSettingsDebounced();
        renderMapWidget();
    });
    checkbox(general, tr('Подсвечивать упоминания карты в чате', 'Highlight map mentions in chat'), settings.highlightMentions, checked => {
        settings.highlightMentions = checked;
        saveSettingsDebounced();
        chatMapLinks?.refresh();
    });
    note(general, tr('Нажмите на подсвеченное имя, предмет или зону для описания. Для персонажей также распознаются однозначные имя и фамилия; неоднозначные упоминания пропускаются.',
        'Click a highlighted name, object, or zone for its description. Unique character first and last names also match; ambiguous mentions are skipped.'));

    // Map management stays in extension settings.
    const mapTools = group(tr('Карта текущего чата', 'Current chat map'), '▦', 'map');
    const chatForTools = SillyTavern.getContext();
    const savedMap = getMapDataForCurrentChat();
    const modeSelect = select(mapTools, tr('Режим текущего чата', 'Current chat mode'), getMapMode(chat_metadata),
        [['classic', tr('Классический', 'Classic')], ['game', tr('Игровой', 'Game')]], value => {
            if (!isSameChat(chatForTools, SillyTavern.getContext()) || !chatForTools.chat?.length
                || document.body.dataset.generating || isChatSaving || scanInProgress) {
                modeSelect.value = getMapMode(chat_metadata);
                toastr.warning(tr('Дождитесь завершения ответа или сканирования в текущем чате.', 'Wait for the reply or scan to finish in the current chat.'), 'BB Map');
                return;
            }
            chat_metadata.bb_map_mode = value;
            mapTravelController?.abort();
            saveChatDebounced();
            resetAutoUpdate();
            document.getElementById('bb-map-overlay')?.remove();
            injectCurrentMapContext();
            renderMapWidget();
            setupExtensionSettings(true);
        });
    modeSelect.disabled = chatForTools.chatId == null || !chatForTools.chat?.length;
    const writingSelect = select(mapTools, tr('Подготовка перехода', 'Travel writing'), settings.travelWriting,
        [['simple', tr('Простой текст', 'Simple text')], ['enhance', tr('Через Enhance Gen', 'Through Enhance Gen')]], value => {
            mapTravelController?.abort();
            settings.travelWriting = value; saveSettingsDebounced();
            document.getElementById('bb-map-overlay')?.remove();
        });
    writingSelect.querySelector('option[value="enhance"]').disabled = !getEnhanceActionAPI();
    if (!getEnhanceActionAPI()) note(mapTools, tr('Генерация переходов доступна с Enhance Gen, поддерживающим API действий карты.', 'Generated travel requires Enhance Gen with the map action API.'));
    note(mapTools, tr('В игровом режиме выберите соседнюю зону на полной карте, чтобы подготовить действие перехода. Центральная зона — текущее положение по карте.',
        'In game mode, select a neighboring zone on the full map to prepare a travel action. The center zone is your current position on the map.'));
    note(mapTools, savedMap?.context
        ? tr('Память локации активна.', 'Location memory is active.')
        : tr('Память локации пуста.', 'Location memory is empty.'));
    select(mapTools, tr('Масштаб нового скана', 'New scan scale'), settings.scanScale,
        [['local', tr('Комната', 'Room')], ['global', tr('Здание', 'Building')]], value => {
            settings.scanScale = value;
            saveSettingsDebounced();
        });
    checkbox(mapTools, tr('Готовить обновление после реплики', 'Prepare an update after each reply'), settings.autoUpdate, checked => {
        settings.autoUpdate = checked;
        if (!checked) resetAutoUpdate();
        saveSettingsDebounced();
        renderMapWidget();
    });
    checkbox(mapTools, tr('Сохранять обновление автоматически', 'Save updates automatically'), settings.autoApply, checked => {
        settings.autoApply = checked;
        if (checked) resetAutoUpdate();
        saveSettingsDebounced();
        renderMapWidget();
    });
    note(mapTools, tr('После ответа персонажа — один запрос к выбранной модели. Без автосохранения обновление ждёт проверки; с автосохранением карта сразу заменяется, а предыдущую можно восстановить.',
        'After a character reply, one request goes to the selected model. Without automatic saving, the update waits for review; with it, the map is replaced and the previous version can be restored.'));
    const scan = action(mapTools, tr('Запустить новый скан', 'Start new scan'), () => {
        void triggerMapScan(scan, settings.scanScale);
    });
    if (savedMap?.raw) action(mapTools, tr('Открыть сохранённую карту', 'Open saved map'), () => {
        if (!isSameChat(chatForTools, SillyTavern.getContext())) return setupExtensionSettings(true);
        showRadarModal(getMapDataForCurrentChat().raw, true);
    });
    if (savedMap?.previous?.raw) action(mapTools, tr('Восстановить предыдущую карту', 'Restore previous map'), () => {
        if (!isSameChat(chatForTools, SillyTavern.getContext())) return setupExtensionSettings(true);
        const restored = restorePreviousMap(getMapDataForCurrentChat());
        if (!restored || !chat_metadata) return;
        chat_metadata.bb_map_data = restored;
        saveChatDebounced();
        injectCurrentMapContext();
        renderMapWidget();
        setupExtensionSettings(true);
        toastr.success(tr('Предыдущая карта восстановлена.', 'Previous map restored.'), 'BB Map');
    });
    const view = action(mapTools, tr('Посмотреть текст памяти', 'View memory text'), () => {
        if (!isSameChat(chatForTools, SillyTavern.getContext())) return setupExtensionSettings(true);
        memoryText.textContent = getMapDataForCurrentChat()?.context || tr('Память карты пуста.', 'Map memory is empty.');
        memoryText.hidden = !memoryText.hidden;
        view.setAttribute('aria-expanded', String(!memoryText.hidden));
    });
    view.setAttribute('aria-expanded', 'false');
    const memoryText = document.createElement('pre');
    memoryText.className = 'bb-map-memory-text';
    memoryText.hidden = true;
    mapTools.append(memoryText);
    if (savedMap) action(mapTools, tr('Очистить текст памяти', 'Clear memory text'), () => {
        if (!isSameChat(chatForTools, SillyTavern.getContext())) return setupExtensionSettings(true);
        delete chat_metadata.bb_map_data;
        saveChatDebounced();
        resetAutoUpdate();
        injectCurrentMapContext();
        renderMapWidget();
        setupExtensionSettings(true);
        toastr.success(tr('Память карты для этого чата очищена!', 'Map memory cleared for this chat!'), 'BB Map');
    }, 'bb-map-danger-action');

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
    chatMapLinks?.refresh();
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
            ${autoStatus !== 'idle' && settings.autoUpdate ? `<span class="bb-map-widget-badge" aria-live="polite">${autoStatus === 'scanning'
                ? tr('СКАН', 'SCAN') : autoStatus === 'waiting' ? tr('ЖДЁТ', 'WAIT')
                    : autoStatus === 'ready' ? tr('НОВОЕ', 'NEW') : autoStatus === 'updated' ? tr('ГОТОВО', 'DONE') : tr('СБОЙ', 'ERROR')}</span>` : ''}
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
            ${settings.autoUpdate && autoStatus !== 'idle' ? `<div class="bb-map-widget-update" role="status">${autoStatus === 'scanning'
                ? tr('Готовится обновление карты…', 'Preparing a map update…')
                : autoStatus === 'waiting'
                    ? tr('Ожидает запуска сканирования…', 'Waiting to start the scan…')
                : autoStatus === 'ready'
                    ? tr('Обновление готово к проверке', 'Update ready for review')
                    : autoStatus === 'updated'
                        ? tr('Карта обновлена', 'Map updated')
                    : tr('Не удалось подготовить обновление', 'Could not prepare an update')}</div>` : ''}
            ${autoStatus === 'ready' ? `<button type="button" class="bb-map-widget-review">${tr('Проверить обновление', 'Review update')} ↗</button>` : ''}
            ${autoStatus === 'ready' ? `<button type="button" class="bb-map-widget-discard">${tr('Отклонить обновление', 'Discard update')}</button>` : ''}
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
    const review = widget.querySelector('.bb-map-widget-review');
    if (review) review.onclick = () => {
        if (autoCandidate && isSameChat(autoCandidateChat, SillyTavern.getContext())
            && getMapDataForCurrentChat() === autoCandidateBase) {
            showRadarModal(autoCandidate, false, autoCandidateChat, autoCandidateBase);
        } else {
            resetAutoUpdate();
            renderMapWidget();
        }
    };
    const discard = widget.querySelector('.bb-map-widget-discard');
    if (discard) discard.onclick = () => {
        resetAutoUpdate();
        renderMapWidget();
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

jQuery(async () => {
    try {
        const { eventSource, event_types } = SillyTavern.getContext();
        chatMapLinks = createChatMapLinks({
            getMap: () => getMapDataForCurrentChat()?.raw,
            isEnabled: () => settings.highlightMentions,
            getLabels: () => ({
                language: currentLanguage(),
                types: { zone: tr('Зона', 'Zone'), character: tr('Персонаж', 'Character'), object: tr('Предмет', 'Object') },
                close: tr('Закрыть карточку', 'Close card'), openMap: tr('Открыть карту ↗', 'Open map ↗'),
                noDescription: tr('Описание на карте отсутствует.', 'No description on the map.'),
                source: tr('По сохранённой карте', 'From the saved map'),
                mood: tr('Состояние', 'Mood'), attitude: tr('Отношение', 'Attitude'), reason: tr('Обстановка', 'Conditions'),
                position: mapPositionLabel, threat: mapThreatLabel,
            }),
            onOpenMap: () => {
                const current = getMapDataForCurrentChat();
                if (current?.raw) showRadarModal(current.raw, true);
            },
        });
        for (const type of [event_types.CHAT_LOADED, event_types.MORE_MESSAGES_LOADED, event_types.USER_MESSAGE_RENDERED,
            event_types.CHARACTER_MESSAGE_RENDERED, event_types.MESSAGE_UPDATED, event_types.MESSAGE_SWIPED]) {
            eventSource.on(type, () => chatMapLinks.refresh());
        }
        
        // РЕГИСТРАЦИЯ МАКРОСА В TAVERN API
        const context = SillyTavern.getContext();
        if (context.registerMacro) {
            context.registerMacro('bb_map', () => {
                return extension_settings[MODULE_NAME].useMacro ? getMapContextForCurrentChat() : '';
            });
            console.log('[BB Map] Макрос {{bb_map}} зарегистрирован');
        }

        eventSource.on(event_types.APP_READY, () => {
            setupExtensionSettings();
            injectCurrentMapContext(); 
            renderMapWidget();
        });
        
        eventSource.on(event_types.CHAT_CHANGED, () => {
            mapTravelController?.abort();
            resetAutoUpdate();
            document.getElementById('bb-map-overlay')?.remove();
            injectCurrentMapContext();
            renderMapWidget();
            setupExtensionSettings(true);
        });
        eventSource.on(event_types.GENERATION_STARTED, handleGenerationStarted);
        eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
        eventSource.on(event_types.GENERATION_ENDED, handleGenerationEnded);
        eventSource.on(event_types.GENERATION_STOPPED, handleGenerationStopped);
        window.addEventListener('resize', () => {
            if (document.getElementById('bb-map-widget')) renderMapWidget();
        });
        window.addEventListener('bb-enhance-gen:ready', () => setupExtensionSettings(true));

        // ЖЕЛЕЗОБЕТОННЫЙ ПЕРЕХВАТЧИК МАКРОСА
        eventSource.on(event_types.GENERATE_AFTER_DATA, (generate_data) => {
            if (extension_settings[MODULE_NAME].useMacro && generate_data && Array.isArray(generate_data.messages)) {
                const promptText = getMapContextForCurrentChat();
                generate_data.messages.forEach(msg => {
                    if (msg && msg.content && typeof msg.content === 'string' && msg.content.includes('{{bb_map}}')) {
                        msg.content = msg.content.replace(/\{\{bb_map\}\}/g, promptText);
                    }
                });
            }
        });

        setTimeout(() => {
            setupExtensionSettings();
            renderMapWidget();
        }, 2000);
    } catch (e) { console.error("[BB Map] Ошибка запуска:", e); }
});
