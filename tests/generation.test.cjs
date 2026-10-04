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
        SillyTavern: { getContext: () => activeChat },
        navigator: { language: 'en-US' },
        document: { body: { dataset: {} } },
        setTimeout: callback => { timers.push(callback); return timers.length; },
        clearTimeout: () => {},
        isSameChat: (a, b) => a.chatId === b.chatId && a.chatMetadata === b.chatMetadata,
        console,
    };
    vm.runInNewContext(`${setupSource}
        renderMapWidget = () => {};
        injectCurrentMapContext = () => {};
        setupExtensionSettings = () => {};
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
