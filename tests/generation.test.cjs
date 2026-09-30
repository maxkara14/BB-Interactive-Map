const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const setupSource = source.slice(0, source.indexOf('jQuery(async () => {'))
    .replace(/^import .*;\r?\n/gm, '');

function loadMap(initialSettings, service, fetch) {
    const setting = { ...initialSettings };
    const context = {
        extension_settings: { 'BB-Interactive-Map': setting },
        SillyTavern: { getContext: () => ({ ConnectionManagerRequestService: service }) },
        navigator: { language: 'en-US' },
        generateQuietPrompt: async () => '{"main":true}',
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
            assert.equal(maxTokens, 4000);
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
    const map = loadMap({ generationSource: 'main' }, null,
        async () => { throw new Error('Custom API must not be called'); });
    assert.equal(await map.generateMapFast('Map this scene'), '{"main":true}');
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
            return { ok: true, json: async () => ({ choices: [{ message: { content: '{"zones":[]}' } }] }) };
        });
    assert.equal(await map.generateMapFast('Map this scene'), '{"zones":[]}');
});

test('incomplete legacy Custom API settings still use the main connection', async () => {
    const map = loadMap({ useCustomApi: true, customApiUrl: '', customApiModel: '' },
        null, async () => { throw new Error('Custom API must not be called'); });
    assert.equal(await map.generateMapFast('Map this scene'), '{"main":true}');
});
