const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    .split('jQuery(async () => {')[0].replace(/^import .*;\r?\n/gm, '');

async function fixture(options = {}) {
    const state = await import('../map-state.js');
    const raw = state.normalizeGraphMapData({ layout: 'graph', scope: 'scene', schematic_name: 'Hall', atmosphere: 'Noon',
        player_place_id: 'hall', zones: [{ id: 'hall', name: 'Hall', kind: 'room',
            characters: [{ name: 'Alice', description: 'Guard', mood: 'Calm', attitude: 'Friendly', thought: 'Keep watch' }],
            poi: [{ name: 'Key' }] }], connections: [] });
    const metadata = { bb_map_data: state.createSavedMap(raw) };
    let chat = { chatId: 'test', characterId: 1, chatMetadata: metadata, name1: 'Player',
        chat: [{ name: 'Alice', mes: 'Player is in the hall.', is_user: false }] };
    let time = 0, timerId = 0;
    const timers = new Map(), requests = [];
    const properties = new Map();
    const context = { ...state, chat_metadata: metadata, extension_settings: { 'BB-Interactive-Map': options },
        SillyTavern: { getContext: () => chat }, navigator: { language: 'en' }, AbortController, DOMException, console,
        Date: { now: () => time }, isChatSaving: false,
        document: { body: { dataset: {} }, querySelectorAll: () => [], documentElement: { style: {
            setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key),
        } } },
        getTokenCountAsync: async text => Array.from(text).length,
        generateQuietPrompt: async params => { requests.push(params); return JSON.stringify(raw); },
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
        saveChatConditional: async () => {}, saveSettingsDebounced: () => {}, toastr: { warning: () => {} },
    };
    vm.runInNewContext(`${source}
        renderMapWidget = setupExtensionSettings = injectCurrentMapContext = () => {};
        globalThis.api = { settings, scanHistoryText, mapSceneText, trackedMapData, getMentionMapData, getMapContextForCurrentChat,
            createMapCandidate, saveCurrentMap, applyMapColors, resetAutoUpdate, retryAutoScan,
            handleMessageReceived, handleGenerationStarted, handleGenerationEnded, handleGenerationStopped,
            setScanning: value => { scanInProgress = value; },
            status: () => autoStatus, reason: () => autoWaitReason, message: autoWaitMessage };
    `, context);
    return { api: context.api, raw, metadata, context, requests, timers, properties, get chat() { return chat; },
        changeChat: () => { chat = { ...chat, chatId: 'other', chat: [] }; },
        advance: ms => { time += ms; },
        flush: async () => {
            const entry = timers.entries().next().value;
            assert.ok(entry, 'a scheduled scan is expected');
            timers.delete(entry[0]); await entry[1]();
        },
        reply: (text, type = 'normal') => {
            chat.chat.push({ name: 'Alice', mes: text, is_user: false });
            context.api.handleMessageReceived(chat.chat.length - 1, type);
        },
    };
}

test('history depth and budget keep newest messages; default history remains three messages', async () => {
    const f = await fixture();
    f.chat.chat = ['old', 'one', 'two', 'three'].map(mes => ({ name: 'A', mes }));
    assert.equal(await f.api.scanHistoryText(f.chat), 'A: one\n\nA: two\n\nA: three');
    f.api.settings.historyMessages = 2;
    f.api.settings.historyTokenLimit = 8;
    assert.equal(await f.api.scanHistoryText(f.chat), 'A: three');
    f.chat.chat = [{ name: 'A', mes: '😀'.repeat(30) + 'LATEST' }];
    const text = await f.api.scanHistoryText(f.chat);
    assert.ok(Array.from(text).length <= 8);
    assert.ok(text.endsWith('LATEST'));
    assert.doesNotMatch(text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
    await assert.rejects(f.api.scanHistoryText(f.chat, AbortSignal.abort()), { name: 'AbortError' });
});

test('invalid token counts fail before a generation request; response allowance stays 10000', async () => {
    const f = await fixture({ historyTokenLimit: 20 });
    f.context.getTokenCountAsync = async () => NaN;
    await assert.rejects(f.api.createMapCandidate(f.chat, 'scene'), /Could not count/);
    assert.equal(f.requests.length, 0);
    f.context.getTokenCountAsync = async text => text.length;
    await f.api.createMapCandidate(f.chat, 'scene');
    assert.equal(f.requests[0].responseLength, 10000);
    const history = f.requests[0].quietPrompt.match(/Recent chat: """([\s\S]*?)"""/)[1];
    assert.ok(history.length <= 20);
});

test('interval counts unique eligible responses and resets on chat switch', async () => {
    const f = await fixture({ autoUpdate: true, autoUpdateInterval: 2 });
    f.reply('One'); f.api.handleMessageReceived(1, 'normal');
    f.reply('User', 'extension');
    assert.equal(f.timers.size, 0);
    f.reply('Two'); await f.flush();
    assert.equal(f.requests.length, 1);
    f.api.handleMessageReceived(3, 'normal');
    assert.equal(f.timers.size, 0);
    f.reply('Three'); assert.equal(f.api.status(), 'idle');
    f.changeChat(); f.reply('Other one'); assert.equal(f.timers.size, 0);
    f.reply('Other two'); await f.flush(); assert.equal(f.requests.length, 2);
});

test('Continue and rerolls can be excluded on both event paths; quiet and user messages never count', async () => {
    const f = await fixture({ autoUpdate: true, updateOnContinue: false, updateOnRegenerate: false });
    for (const type of ['continue', 'swipe', 'regenerate', 'quiet', 'impersonate']) {
        f.api.handleGenerationStarted(type);
        f.chat.chat.at(-1).mes += type;
        f.api.handleGenerationEnded();
        f.api.handleMessageReceived(0, type);
    }
    f.chat.chat.push({ mes: 'User', is_user: true }); f.api.handleMessageReceived(1, 'normal');
    f.chat.chat.push({ mes: 'System notice', is_system: true }); f.api.handleMessageReceived(2, 'normal');
    assert.equal(f.timers.size, 0);
    f.api.settings.updateOnContinue = true;
    f.reply('Continued', 'continue'); await f.flush(); assert.equal(f.requests.length, 1);
});

test('each busy reason is visible, times out safely and recovers only after the blocker clears', async () => {
    for (const reason of ['generation', 'saving', 'scan']) {
        const f = await fixture({ autoUpdate: true });
        const busy = value => {
            if (reason === 'generation') f.context.document.body.dataset.generating = value ? 'true' : undefined;
            if (reason === 'saving') f.context.isChatSaving = value;
            if (reason === 'scan') f.api.setScanning(value);
        };
        busy(true); f.reply('Ready'); await f.flush();
        assert.equal(f.api.reason(), reason); assert.match(f.api.message(), /Waiting for/);
        f.advance(120000); await f.flush();
        assert.equal(f.api.status(), 'blocked'); assert.equal(f.timers.size, 0); assert.equal(f.requests.length, 0);
        f.api.retryAutoScan(); await f.flush(); assert.equal(f.requests.length, 0);
        busy(false); await f.flush(); assert.equal(f.requests.length, 1);
    }
});

test('disabled fields affect prompts, views and context without rewriting existing snapshots', async () => {
    const f = await fixture({ trackedFields: { mood: false, thought: false, atmosphere: false, objects: false } });
    const snapshot = JSON.stringify(f.metadata);
    const filtered = f.api.trackedMapData(f.raw);
    assert.equal(filtered.zones[0].characters[0].attitude, 'Friendly');
    assert.equal(filtered.zones[0].characters[0].mood, '');
    assert.equal(filtered.zones[0].poi.length, 0);
    assert.doesNotMatch(f.api.getMapContextForCurrentChat(), /Calm|Key|Atmosphere/);
    const candidate = await f.api.createMapCandidate(f.chat, 'scene');
    assert.equal(candidate.zones[0].characters[0].thought, '');
    assert.equal(candidate.zones[0].poi.length, 0);
    assert.match(f.requests[0].quietPrompt, /TRACKING OVERRIDE/);
    assert.doesNotMatch(f.requests[0].quietPrompt.match(/<previous_topology>([\s\S]*?)<\/previous_topology>/)[1], /Calm|Key|Noon/);
    assert.equal(JSON.stringify(f.metadata), snapshot);
    f.api.settings.trackedFields.characters = false;
    assert.equal(f.api.trackedMapData(f.raw).zones[0].characters.length, 0);
    assert.doesNotMatch(f.api.getMapContextForCurrentChat(), /Alice/);
});

test('palette values are validated and reset removes custom properties', async () => {
    const f = await fixture({ colors: { accent: '#123456', danger: 'red;display:none' } });
    f.api.applyMapColors();
    assert.equal(f.properties.get('--bb-map-accent'), '#123456');
    assert.equal(f.properties.has('--bb-map-danger'), false);
    f.api.settings.colors.accent = '#79d7d3'; f.api.applyMapColors();
    assert.equal(f.properties.has('--bb-map-accent'), false);
});

test('mention colors have independent defaults, validation and reset', async () => {
    const f = await fixture({ colors: { 'mention-character': '#bfa0f1', 'mention-object': '#a1c4ef', 'mention-zone': 'invalid' } });
    f.api.applyMapColors();
    assert.equal(f.properties.get('--bb-map-mention-character'), '#bfa0f1');
    assert.equal(f.properties.get('--bb-map-mention-object'), '#a1c4ef');
    assert.equal(f.properties.has('--bb-map-mention-zone'), false);
    assert.equal(f.properties.has('--bb-map-accent'), false);
    f.api.settings.colors['mention-character'] = '#83d8d3';
    f.api.settings.colors['mention-object'] = '#e8c78e';
    f.api.applyMapColors();
    assert.equal(f.properties.has('--bb-map-mention-character'), false);
    assert.equal(f.properties.has('--bb-map-mention-object'), false);
});

test('chat, mode and settings changes during token counting discard the scan before generation', async () => {
    for (const change of ['chat', 'mode', 'settings']) {
        const f = await fixture({ historyTokenLimit: 100 });
        f.context.getTokenCountAsync = async text => {
            if (change === 'chat') f.changeChat();
            if (change === 'mode') f.metadata.bb_map_mode = 'game';
            if (change === 'settings') f.api.settings.trackedFields.mood = false;
            return text.length;
        };
        assert.equal(await f.api.createMapCandidate(f.chat, 'scene'), null);
        assert.equal(f.requests.length, 0);
    }
});

test('projecting disabled fields preserves archive and scene freshness checks before saving', async () => {
    const f = await fixture({ trackedFields: { mood: false } });
    const candidate = f.api.trackedMapData(await f.api.createMapCandidate(f.chat, 'scene'));
    f.chat.chat[0].mes += ' Changed.';
    assert.throws(() => f.api.saveCurrentMap(candidate, f.metadata.bb_map_data), /scene changed/i);
    f.chat.chat[0].mes = 'Player is in the hall.';
    f.metadata.bb_map_archive = {};
    assert.throws(() => f.api.saveCurrentMap(candidate, f.metadata.bb_map_data), /archive changed/i);
});

test('unchanged filtered mention data stays stable across widget refreshes', async () => {
    const f = await fixture({ trackedFields: { mood: false } });
    const first = f.api.getMentionMapData();
    assert.equal(f.api.getMentionMapData(), first);
    f.api.settings.trackedFields.objects = false;
    const changed = f.api.getMentionMapData();
    assert.notEqual(changed, first);
    assert.equal(changed.zones[0].poi.length, 0);
    assert.equal(f.api.getMentionMapData(), changed);
    assert.equal(f.raw.zones[0].poi.length, 1);
});

test('all three generation sources request and read aliases in the same map request', async () => {
    for (const source of ['main', 'profile', 'custom']) {
        const f = await fixture({ generationSource: source, connectionProfileId: 'test', customApiUrl: 'https://example.invalid/v1', customApiModel: 'test' });
        const response = structuredClone(f.raw);
        response.zones[0].mention_aliases = ['PLACE_ALIAS_ONLY'];
        response.zones[0].characters[0].mention_aliases = ['CHARACTER_ALIAS_ONLY'];
        response.zones[0].poi[0].mention_aliases = ['OBJECT_ALIAS_ONLY'];
        const prompts = [];
        f.context.generateQuietPrompt = async options => { prompts.push(options.quietPrompt); return JSON.stringify(response); };
        f.chat.ConnectionManagerRequestService = {
            getSupportedProfiles: () => [{ id: 'test' }],
            sendRequest: async (_id, messages) => { prompts.push(messages.at(-1).content); return { content: JSON.stringify(response) }; },
        };
        f.context.fetch = async (_url, options) => {
            prompts.push(JSON.parse(options.body).messages.at(-1).content);
            return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) };
        };
        const candidate = await f.api.createMapCandidate(f.chat, 'scene');
        assert.equal(prompts.length, 1, source);
        assert.match(prompts[0], /mention_aliases: an array of up to 16/);
        assert.deepEqual(Array.from(candidate.zones[0].poi[0].mention_aliases), ['OBJECT_ALIAS_ONLY']);
        f.api.saveCurrentMap(candidate, f.metadata.bb_map_data);
        assert.doesNotMatch(f.api.getMapContextForCurrentChat(), /ALIAS_ONLY|mention_aliases/);
    }
});

test('scan-only alias memory retains manual variants and is excluded when an entity type is disabled', async () => {
    const f = await fixture();
    f.raw.zones[0].mention_aliases = ['PLACE_ALIAS_ONLY'];
    f.raw.zones[0].poi[0].mention_aliases = ['OBJECT_ALIAS_ONLY'];
    await f.api.createMapCandidate(f.chat, 'scene');
    const memory = f.requests[0].quietPrompt.match(/<mention_alias_memory>([\s\S]*?)<\/mention_alias_memory>/)[1];
    assert.match(memory, /PLACE_ALIAS_ONLY/);
    assert.match(memory, /OBJECT_ALIAS_ONLY/);
    assert.doesNotMatch(f.api.getMapContextForCurrentChat(), /ALIAS_ONLY/);
    f.api.settings.trackedFields.objects = false;
    await f.api.createMapCandidate(f.chat, 'scene');
    const filtered = f.requests[1].quietPrompt.match(/<mention_alias_memory>([\s\S]*?)<\/mention_alias_memory>/)[1];
    assert.doesNotMatch(filtered, /OBJECT_ALIAS_ONLY/);
});
