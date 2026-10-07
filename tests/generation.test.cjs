const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const setupSource = source.slice(0, source.indexOf('jQuery(async () => {'))
    .replace(/^import .*;\r?\n/gm, '');

function loadMap(initialSettings, service, fetch, quietPrompt = async () => '{"main":true}') {
    const setting = { ...initialSettings };
    const context = {
        extension_settings: { 'BB-Interactive-Map': setting },
        SillyTavern: { getContext: () => ({ ConnectionManagerRequestService: service }) },
        navigator: { language: 'en-US' },
        generateQuietPrompt: quietPrompt,
        fetch,
        console: { warn() {} },
    };
    vm.runInNewContext(`${setupSource}\nglobalThis.mapTest = { generateMapFast, currentLanguage, settings };`, context);
    return context.mapTest;
}

test('legacy Custom API setting selects the custom source', () => {
    const map = loadMap({ useCustomApi: true }, null);
    assert.equal(map.settings.generationSource, 'custom');
    assert.equal(map.settings.uiLanguage, 'auto');
    assert.equal(map.currentLanguage(), 'en');
});

test('profile source sends an English JSON request and reads the result', async () => {
    let called = false;
    const service = {
        getSupportedProfiles: () => [{ id: 'profile-1' }],
        sendRequest: async (id, messages, maxTokens, options) => {
            called = true;
            assert.equal(id, 'profile-1');
            assert.equal(messages[0].role, 'system');
            assert.match(messages[0].content, /JSON/);
            assert.equal(messages[1].content, 'Map this scene');
            assert.equal(maxTokens, 10000);
            assert.equal(options.stream, false);
            assert.equal(options.includePreset, true);
            return { content: '{"zones":[]}' };
        },
    };
    const map = loadMap({ generationSource: 'profile', connectionProfileId: 'profile-1' }, service);
    assert.equal(await map.generateMapFast('Map this scene'), '{"zones":[]}');
    assert.equal(called, true);
});

test('missing profile fails before sending a request', async () => {
    const service = {
        getSupportedProfiles: () => [],
        sendRequest: () => { throw new Error('unexpected request'); },
    };
    const map = loadMap({ generationSource: 'profile', connectionProfileId: 'gone' }, service);
    await assert.rejects(map.generateMapFast('Map this scene'), /Select an available connection profile/);
});

test('main source uses SillyTavern generation', async () => {
    let requestedPrompt;
    let responseLength;
    const map = loadMap({ generationSource: 'main' }, null,
        async () => { throw new Error('Custom API must not be called'); },
        async params => { requestedPrompt = params.quietPrompt; responseLength = params.responseLength; return '{"main":true}'; });
    assert.equal(await map.generateMapFast('Map this scene'), '{"main":true}');
    assert.equal(requestedPrompt, 'Map this scene');
    assert.equal(responseLength, 10000);
});

test('empty profile result is rejected', async () => {
    const service = {
        getSupportedProfiles: () => [{ id: 'profile-1' }],
        sendRequest: async () => ({ content: '  ' }),
    };
    const map = loadMap({ generationSource: 'profile', connectionProfileId: 'profile-1' }, service);
    await assert.rejects(map.generateMapFast('Map this scene'), /empty response/);
});

test('existing Custom API fallback still uses the main connection', async () => {
    const map = loadMap({ useCustomApi: true, customApiUrl: 'https://example.test/v1', customApiModel: 'test' },
        null, async () => { throw new Error('offline'); });
    assert.equal(await map.generateMapFast('Map this scene'), '{"main":true}');
});

test('Custom API source sends the selected model and reads the result', async () => {
    const map = loadMap({ generationSource: 'custom', customApiUrl: 'https://example.test/v1', customApiModel: 'model-1' },
        null, async (url, options) => {
            assert.equal(url, 'https://example.test/v1/chat/completions');
            const payload = JSON.parse(options.body);
            assert.equal(payload.model, 'model-1');
            assert.equal(payload.messages[1].content, 'Map this scene');
            assert.equal(payload.max_tokens, 10000);
            return { ok: true, json: async () => ({ choices: [{ message: { content: '{"zones":[]}' } }] }) };
        });
    assert.equal(await map.generateMapFast('Map this scene'), '{"zones":[]}');
});

test('incomplete legacy Custom API settings still use the main connection', async () => {
    const map = loadMap({ useCustomApi: true, customApiUrl: '', customApiModel: '' },
        null, async () => { throw new Error('Custom API must not be called'); });
    assert.equal(await map.generateMapFast('Map this scene'), '{"main":true}');
});

async function autoSaveFixture({ saved = true, uncertain = false, mode = 'classic' } = {}) {
    const state = await import('../map-state.js');
    const raw = state.normalizeGraphMapData({ layout: 'graph', scope: 'scene', schematic_name: 'Hall',
        player_place_id: 'hall', zones: [{ id: 'hall', name: 'Hall', kind: 'room', uncertain }], connections: [] });
    const previous = { ...raw, zones: raw.zones.map(zone => ({ ...zone, uncertain: false })) };
    const metadata = { bb_map_mode: mode, ...(saved ? { bb_map_data: state.createSavedMap(previous) } : {}) };
    const chat = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: metadata,
        name1: 'Player', chat: [{ mes: 'Player is in the hall.', is_user: false }] };
    const timers = new Map();
    let timerId = 0;
    const context = { ...state,
        extension_settings: { 'BB-Interactive-Map': { autoUpdate: true } }, chat_metadata: metadata,
        SillyTavern: { getContext: () => chat }, navigator: { language: 'en' },
        document: { body: { dataset: {} }, querySelectorAll: () => [] }, AbortController,
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
        clearTimeout: id => timers.delete(id), isChatSaving: false,
        saveSettingsDebounced: () => {}, saveChatConditional: async () => { context.saves++; },
        saves: 0, requests: 0, warnings: [], toastr: { warning: message => context.warnings.push(message) }, console, raw,
    };
    vm.runInNewContext(`${setupSource}
        renderMapWidget = injectCurrentMapContext = setupExtensionSettings = () => {};
        createMapCandidate = async () => { globalThis.requests++; return raw; };
        globalThis.api = { settings, setAutoApply, handleMessageReceived, resetAutoUpdate,
            accept: () => { saveCurrentMap(autoCandidate, autoCandidateBase); resetAutoUpdate(); },
            state: () => ({ candidate: autoCandidate, status: autoStatus }) };
    `, context);
    return { context, metadata, chat, api: context.api, flush: async () => {
        const entry = timers.entries().next().value;
        assert.ok(entry, 'expected an automatic scan');
        timers.delete(entry[0]);
        await entry[1]();
    } };
}

async function placeKindFixture(response, language = 'en') {
    const state = await import('../map-state.js');
    const metadata = {};
    const chat = { chatId: 'train', characterId: 1, groupId: null, chatMetadata: metadata,
        name1: 'Player', chat: [{ mes: 'Player stands on the train roof.', is_user: false }] };
    const context = { ...state, chat_metadata: metadata,
        extension_settings: { 'BB-Interactive-Map': { uiLanguage: language } },
        SillyTavern: { getContext: () => chat }, navigator: { language }, console,
        generateQuietPrompt: async () => JSON.stringify(response),
    };
    vm.runInNewContext(`${setupSource}
        globalThis.api = { createMapCandidate, normalizeGeneratedMapData };
    `, context);
    return { ...context.api, chat, metadata, state };
}

const trainResponse = () => ({ layout: 'graph', scope: 'scene', schematic_name: 'Train',
    player_place_id: 'mt-1', zones: [
        { id: 'mt-1', name: 'Second carriage roof', kind: 'roof', threat_level: 'danger' },
        { id: 'mt-2', name: 'Tender roof', kind: 'roof', threat_level: 'danger' },
        { id: 'mt-3', name: 'Passenger salons', kind: 'interior', uncertain: true },
    ], connections: [{ from: 'mt-1', to: 'mt-2', name: 'Roof path', kind: 'path', status: 'uncertain' }] });

test('generated train roofs and interiors become supported kinds without mutating the response or saving', async () => {
    const response = trainResponse();
    const snapshot = JSON.stringify(response);
    const fixture = await placeKindFixture(response);
    const candidate = await fixture.createMapCandidate(fixture.chat, 'scene');
    assert.deepEqual(Array.from(candidate.zones, zone => zone.kind), ['outdoor', 'outdoor', 'room']);
    assert.equal(candidate.player_place_id, candidate.zones[0].id);
    assert.equal(candidate.connections[0].to, candidate.zones[1].id);
    assert.equal(candidate.zones[0].threat_level, 'danger');
    assert.equal(candidate.zones[2].uncertain, true);
    fixture.normalizeGeneratedMapData(response);
    assert.equal(JSON.stringify(response), snapshot);
    assert.deepEqual(fixture.metadata, {});
    assert.throws(() => fixture.state.normalizeGraphMapData(response), /invalid_map/);
});

test('generated canonical kinds remain unchanged and other invalid fields still fail validation', async () => {
    const response = trainResponse();
    response.zones = ['room', 'outdoor', 'passage', 'area', 'unknown'].map((kind, i) => ({ id: `mt-${i + 1}`, name: kind, kind }));
    const fixture = await placeKindFixture(response);
    const candidate = await fixture.createMapCandidate(fixture.chat, 'scene');
    assert.deepEqual(Array.from(candidate.zones, zone => zone.kind), response.zones.map(zone => zone.kind));
    assert.throws(() => fixture.normalizeGeneratedMapData({ ...response, player_place_id: 'missing' }), /invalid_map/);
    assert.throws(() => fixture.normalizeGeneratedMapData({ ...response, connections: [{ ...response.connections[0], kind: 'roof' }] }), /invalid_map/);
});

test('unsupported generated place kinds report the exact field safely in both languages', async () => {
    for (const language of ['en', 'ru']) {
        const response = trainResponse();
        response.zones[2].kind = '<img src=x onerror=alert(1)>';
        const fixture = await placeKindFixture(response, language);
        await assert.rejects(fixture.createMapCandidate(fixture.chat, 'scene'), error => {
            assert.match(error.message, /zones\[2\]\.kind/);
            assert.match(error.message, /room, outdoor, passage, area, unknown/);
            assert.match(error.message, language === 'en' ? /Unsupported place type/ : /Неподдерживаемый тип места/);
            assert.doesNotMatch(error.message, /<img/);
            return true;
        });
        assert.deepEqual(fixture.metadata, {});
    }
});

test('enabling automatic saving applies a ready safe update without another request', async () => {
    const { context, metadata, api, flush } = await autoSaveFixture();
    const original = metadata.bb_map_data;
    api.handleMessageReceived(0, 'normal'); await flush();
    assert.ok(api.state().candidate);
    await api.setAutoApply(true);
    assert.equal(context.saves, 1);
    assert.equal(context.requests, 1);
    assert.equal(api.state().status, 'updated');
    assert.equal(api.state().candidate, null);
    assert.equal(metadata.bb_map_data.previous.raw, original.raw);
});

test('enabling automatic saving preserves ambiguous updates for manual review', async () => {
    const { context, api, flush } = await autoSaveFixture({ uncertain: true });
    api.handleMessageReceived(0, 'normal'); await flush();
    const candidate = api.state().candidate;
    await api.setAutoApply(true);
    assert.equal(api.state().candidate, candidate);
    assert.equal(api.state().status, 'ready');
    assert.equal(context.saves, 0);
});

test('a new reply or reroll replaces a stale proposal and resumes automatic saving in a new location', async () => {
    for (const change of ['reply', 'reroll']) {
        const { context, metadata, chat, api, flush } = await autoSaveFixture({ uncertain: true });
        api.settings.autoApply = true;
        api.handleMessageReceived(0, 'normal'); await flush();
        const pending = api.state().candidate;
        assert.equal(context.saves, 0);
        const text = 'Player arrives in the forest.';
        if (change === 'reply') chat.chat.push({ mes: text, is_user: false });
        else chat.chat[0].mes = text;
        context.raw = (await import('../map-state.js')).normalizeGraphMapData({ layout: 'graph', scope: 'scene',
            schematic_name: 'Forest', player_place_id: 'clearing',
            zones: [{ id: 'clearing', name: 'Clearing', kind: 'outdoor' }], connections: [] });
        api.handleMessageReceived(chat.chat.length - 1, change === 'reroll' ? 'swipe' : 'normal'); await flush();
        assert.equal(context.requests, 2, change);
        assert.equal(context.saves, 1, change);
        assert.equal(api.state().candidate, null);
        assert.notEqual(metadata.bb_map_data.raw, pending);
        assert.equal(metadata.bb_map_data.raw.schematic_name, 'Forest');
        assert.equal(metadata.bb_map_data.previous.raw.schematic_name, 'Hall');
    }
});

test('duplicate events for the same reply preserve its unresolved proposal without a new request', async () => {
    const { context, metadata, api, flush } = await autoSaveFixture({ uncertain: true });
    api.settings.autoApply = true;
    api.handleMessageReceived(0, 'normal'); await flush();
    const pending = api.state().candidate, saved = metadata.bb_map_data;
    api.handleMessageReceived(0, 'normal'); await flush();
    assert.equal(context.requests, 1);
    assert.equal(context.saves, 0);
    assert.equal(api.state().candidate, pending);
    assert.equal(metadata.bb_map_data, saved);
});

test('review warnings do not repeat across replies and accepting uncertainty resumes saving without confirming facts', async () => {
    const { context, metadata, chat, api, flush } = await autoSaveFixture({ uncertain: true });
    api.settings.autoApply = true;
    api.handleMessageReceived(0, 'normal'); await flush();
    assert.equal(context.warnings.length, 1);
    assert.match(context.warnings[0], /Automatic saving paused.*unconfirmed places: 1/);
    chat.chat[0].mes += ' The same place remains uncertain.';
    api.handleMessageReceived(0, 'normal'); await flush();
    assert.equal(context.requests, 2);
    assert.equal(context.warnings.length, 1);
    assert.equal(context.saves, 0);
    api.accept();
    assert.equal(metadata.bb_map_data.raw.zones[0].uncertain, true);
    chat.chat[0].mes += ' Another reply.';
    api.handleMessageReceived(0, 'normal'); await flush();
    assert.equal(context.saves, 1);
    assert.equal(context.warnings.length, 1);
    assert.equal(metadata.bb_map_data.raw.zones[0].uncertain, true);
    context.raw = { ...context.raw, zones: context.raw.zones.map(zone => ({ ...zone, kind: 'outdoor' })) };
    chat.chat[0].mes += ' The uncertain place changes.';
    api.handleMessageReceived(0, 'normal'); await flush();
    assert.equal(context.saves, 1);
    assert.equal(context.warnings.length, 2);
    assert.equal(api.state().status, 'ready');
});

test('automatic saving enables updates and creates the first saved map after a reply', async () => {
    for (const mode of ['classic', 'game']) {
        const { context, metadata, api, flush } = await autoSaveFixture({ saved: false, mode });
        api.settings.autoUpdate = false;
        await api.setAutoApply(true);
        assert.equal(api.settings.autoUpdate, true);
        assert.equal(context.requests, 0);
        api.handleMessageReceived(0, 'normal'); await flush();
        assert.equal(context.saves, 1);
        assert.equal(metadata.bb_map_data.raw.schematic_name, 'Hall');
        assert.equal(metadata.bb_map_data.previous, null);
    }
});

test('enabling automatic saving discards a candidate made stale by a reply, mode, map or chat change', async () => {
    for (const change of ['reply', 'mode', 'map', 'chat']) {
        const { context, metadata, chat, api, flush } = await autoSaveFixture();
        api.handleMessageReceived(0, 'normal'); await flush();
        if (change === 'reply') chat.chat[0].mes = 'Player is elsewhere.';
        if (change === 'mode') metadata.bb_map_mode = 'game';
        if (change === 'map') metadata.bb_map_data = { ...metadata.bb_map_data };
        if (change === 'chat') context.SillyTavern.getContext = () => ({ ...chat, chatId: 'two' });
        await api.setAutoApply(true);
        assert.equal(context.saves, 0, change);
        assert.equal(api.state().candidate, null, change);
    }
});

test('automatic scan follows character replies and saves only in automatic mode', async () => {
    const timers = [];
    const metadata = { bb_map_data: { raw: { zones: [] } } };
    const chat = { chatId: 'chat-a', characterId: 1, groupId: null, chatMetadata: metadata };
    let activeChat = chat;
    let saves = 0;
    const context = {
        extension_settings: { 'BB-Interactive-Map': {} },
        chat_metadata: metadata,
        isChatSaving: false,
        saveChatConditional: async () => { saves++; },
        createSavedMap: (candidate, previous) => ({ raw: candidate, previous }),
        getMapMode: (await import('../map-state.js')).getMapMode,
        hasLegacyObjectMemory: (await import('../map-state.js')).hasLegacyObjectMemory,
        requiresTopologyReview: (await import('../map-state.js')).requiresTopologyReview,
        getTopologyReviewIssues: (await import('../map-state.js')).getTopologyReviewIssues,
        SillyTavern: { getContext: () => activeChat },
        navigator: { language: 'en-US' },
        AbortController,
        document: { body: { dataset: {} }, querySelectorAll: () => [] },
        setTimeout: callback => { timers.push(callback); return timers.length; },
        clearTimeout: () => {},
        isSameChat: (a, b) => a.chatId === b.chatId && a.chatMetadata === b.chatMetadata,
        console,
        toastr: { warning: () => {} },
    };
    vm.runInNewContext(`${setupSource}
        renderMapWidget = () => {};
        injectCurrentMapContext = () => {};
        setupExtensionSettings = () => {};
        // This fixture isolates event sequencing; valid-map persistence is tested above.
        saveCurrentMap = (candidate, previous) => { chat_metadata.bb_map_data = createSavedMap(candidate, previous); };
        createMapCandidate = async () => {
            globalThis.requests++;
            return globalThis.holdScan
                ? new Promise(resolve => { globalThis.finishScan = resolve; })
                : { zones: [] };
        };
        globalThis.requests = 0;
        globalThis.mapTest = {
            queueAutoScan, resetAutoUpdate, settings,
            handleGenerationStarted, handleMessageReceived, handleGenerationEnded, handleGenerationStopped,
            state: () => ({ status: autoStatus, candidate: autoCandidate }),
            setGenerating: value => { document.body.dataset.generating = value ? 'true' : undefined; },
            setScanning: value => { scanInProgress = value; },
        };`, context);
    const map = context.mapTest;
    map.queueAutoScan(chat);
    await timers.shift()();
    assert.equal(context.requests, 0);

    map.settings.autoUpdate = true;
    map.queueAutoScan(chat);
    await timers.shift()();
    assert.equal(context.requests, 1);
    assert.equal(map.state().status, 'ready');
    assert.ok(map.state().candidate);
    assert.equal(metadata.bb_map_data.raw.zones.length, 0);
    assert.equal(saves, 0);

    map.resetAutoUpdate();
    map.queueAutoScan(chat);
    await timers.shift()();
    assert.equal(context.requests, 2);

    map.resetAutoUpdate();
    activeChat = { ...chat, chatId: 'chat-b', chatMetadata: {} };
    map.queueAutoScan(chat);
    await timers.shift()();
    assert.equal(context.requests, 2);

    activeChat = { ...chat, chatId: 'chat-c' };
    map.setGenerating(true);
    map.queueAutoScan(activeChat);
    await timers.shift()();
    assert.equal(context.requests, 2);
    map.setGenerating(false);
    await timers.shift()();
    assert.equal(context.requests, 3);

    map.resetAutoUpdate();
    activeChat = { ...chat, chatId: 'chat-d' };
    map.setScanning(true);
    map.queueAutoScan(activeChat);
    await timers.shift()();
    assert.equal(context.requests, 3);
    map.setScanning(false);
    await timers.shift()();
    assert.equal(context.requests, 4);

    map.resetAutoUpdate();
    activeChat = { ...chat, chatId: 'chat-e' };
    context.holdScan = true;
    map.queueAutoScan(activeChat);
    const running = timers.shift()();
    assert.equal(context.requests, 5);
    map.settings.autoUpdate = false;
    map.resetAutoUpdate();
    context.finishScan({ zones: [] });
    await running;
    assert.equal(map.state().status, 'idle');
    map.resetAutoUpdate();
    activeChat = { ...chat, chatId: 'chat-stopped', chat: [{ mes: 'Reply', is_user: false }] };
    map.settings.autoUpdate = true;
    map.handleGenerationStarted('normal');
    map.handleMessageReceived(0, 'normal');
    map.handleGenerationStopped();
    await timers.shift()();
    assert.equal(context.requests, 5);
    assert.equal(map.state().candidate, null);
    map.handleGenerationStarted('normal');
    assert.equal(map.state().candidate, null);

    context.holdScan = false;
    map.settings.autoUpdate = true;
    activeChat = { ...chat, chatId: 'chat-f', chat: [{ mes: 'Old reply', is_user: false }] };
    map.handleGenerationStarted('swipe');
    activeChat.chat[0].mes = 'New reply';
    map.handleMessageReceived(0, 'swipe'); // Some integrations omit gen_finished.
    await timers.shift()(); // MESSAGE_RECEIVED must start the scan even without GENERATION_ENDED.
    assert.equal(context.requests, 6);
    assert.equal(map.state().status, 'ready');
    map.handleGenerationEnded();

    map.resetAutoUpdate();
    activeChat = { ...chat, chatId: 'chat-g', chat: [{ mes: 'Old reply', is_user: false }] };
    map.handleGenerationStarted('swipe');
    activeChat.chat[0].mes = 'New reply';
    map.handleGenerationEnded(); // A missed MESSAGE_RECEIVED still schedules a scan.
    await timers.shift()();
    assert.equal(context.requests, 7);

    map.resetAutoUpdate();
    map.settings.autoApply = true;
    activeChat = { ...chat, chatId: 'chat-h', chat: [{ mes: 'Another reply', is_user: false }] };
    map.handleMessageReceived(0, 'normal');
    await timers.shift()();
    assert.equal(context.requests, 8);
    assert.equal(saves, 1);
    assert.equal(map.state().status, 'updated');
    assert.equal(map.state().candidate, null);
    assert.ok(metadata.bb_map_data.previous);

    map.resetAutoUpdate();
    context.holdScan = true;
    activeChat = { ...chat, chatId: 'chat-i', chat: [{ mes: 'Current reply', is_user: false }] };
    map.handleMessageReceived(0, 'normal');
    const staleScan = timers.shift()();
    activeChat.chat[0].mes = 'Rerolled reply';
    context.finishScan({ zones: [] });
    await staleScan;
    assert.equal(saves, 1);
    assert.equal(map.state().status, 'idle');
    map.handleGenerationStarted('normal');
    map.handleMessageReceived(0, 'normal');
    const stoppedScan = timers.shift()();
    map.handleGenerationStopped();
    context.finishScan({ zones: [] });
    await stoppedScan;
    assert.equal(saves, 1);
    assert.equal(map.state().candidate, null);
});
