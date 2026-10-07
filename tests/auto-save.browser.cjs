// Isolated settings -> reply -> scan -> save path; no real chat or model requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const strip = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<body><div id="extensions_settings"></div></body>');
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'en', showWidget: false, autoUpdate: true } };
            var chat_metadata = {}, writes = 0, requests = 0;
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata,
                name1: 'Player', chat: [{ name: 'Character', mes: 'Player stands in the hall.', is_user: false }] };
            var SillyTavern = { getContext: () => context }, toastr = { error: text => { throw Error(text); } };
            var saveSettingsDebounced = () => {}, saveChatConditional = async () => { writes++; };
            var isChatSaving = false, setExtensionPrompt = () => {}, extension_prompt_types = { IN_CHAT: 0 }, extension_prompt_roles = { USER: 0 };
            var response = { layout: 'graph', scope: 'scene', schematic_name: 'Hall', player_place_id: 'hall',
                zones: [{ id: 'hall', name: 'Hall', kind: 'room' }], connections: [] };
            var generateQuietPrompt = async () => { requests++; return JSON.stringify(response); };
            ${strip(read('index.js').split('jQuery(async () => {')[0])}
            chat_metadata.bb_map_data = createSavedMap(normalizeGraphMapData(response));
            globalThis.original = chat_metadata.bb_map_data;
            setupExtensionSettings();
        ` });
        // SillyTavern owns the outer drawer toggle; expose its content in the isolated host.
        await page.locator('#bb-map-settings-wrapper > .inline-drawer-content').evaluate(el => { el.style.display = 'block'; });
        await page.locator('details[data-section="map"] > summary').click();
        const autoSave = () => page.getByLabel('Save updates automatically', { exact: true });
        await page.evaluate(() => handleMessageReceived(0, 'normal'));
        await page.waitForFunction(() => autoStatus === 'ready');
        await autoSave().check();
        await page.waitForFunction(() => writes === 1);
        assert.equal(await page.evaluate(() => requests), 1);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.previous.raw === original.raw), true);
        assert.equal(await page.evaluate(() => autoCandidate), null);
        await autoSave().uncheck();
        await page.evaluate(() => { response.zones[0].uncertain = true; context.chat[0].mes += ' Maybe.'; handleMessageReceived(0, 'normal'); });
        await page.waitForFunction(() => autoStatus === 'ready');
        await autoSave().check();
        assert.equal(await page.evaluate(() => writes), 1);
        assert.equal(await page.evaluate(() => !!autoCandidate), true);
        await page.evaluate(() => {
            resetAutoUpdate(); delete chat_metadata.bb_map_data;
            response.zones[0].uncertain = false; settings.autoApply = false; settings.autoUpdate = false;
            setupExtensionSettings(true);
        });
        await autoSave().check();
        assert.equal(await page.getByLabel('Prepare an update after each reply', { exact: true }).isChecked(), true);
        await page.evaluate(() => handleMessageReceived(0, 'normal'));
        await page.waitForFunction(() => writes === 2);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.previous), null);
        assert.deepEqual(errors, []);
        console.log('Automatic-save toggle, safe/ambiguous proposals and first-map settings integration passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
