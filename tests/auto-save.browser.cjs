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
        await page.setContent('<body><div id="extensions_settings"></div><button id="scan">Scan</button></body>');
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-topology-view.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'en', showWidget: false, autoUpdate: true } };
            var chat_metadata = {}, writes = 0, requests = 0;
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata,
                name1: 'Player', chat: [{ name: 'Character', mes: 'Player stands in the hall.', is_user: false }] };
            var notices = [], SillyTavern = { getContext: () => context }, toastr = { warning: text => notices.push(text), error: text => { throw Error(text); } };
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
        // An unresolved Hall proposal must not block the next reply in a new location.
        await page.evaluate(() => {
            response = { layout: 'graph', scope: 'scene', schematic_name: 'Forest', player_place_id: 'clearing',
                zones: [{ id: 'clearing', name: 'Clearing', kind: 'outdoor' }], connections: [], archive_location_id: null,
                location_change: 'new', location_change_evidence: 'Player reaches the forest clearing.' };
            context.chat.push({ name: 'Character', mes: 'Player reaches the forest clearing.', is_user: false });
            handleMessageReceived(1, 'normal');
        });
        await page.waitForFunction(() => writes === 2 && autoStatus === 'updated');
        assert.equal(await page.evaluate(() => requests), 3);
        assert.equal(await page.evaluate(() => autoCandidate), null);
        assert.deepEqual(await page.evaluate(() => chat_metadata.bb_map_archive.locations.map(entry => entry.snapshot.raw.schematic_name)), ['Hall', 'Forest']);
        assert.equal(await page.locator('[data-section="map"] [data-map-review]').count(), 0);
        // Both checkboxes stay enabled, but a manual scan is still only a preview.
        await page.evaluate(async () => { await triggerMapScan(document.getElementById('scan')); });
        assert.equal(await page.evaluate(() => writes), 2);
        assert.equal(await page.locator('#bb-map-save-btn').isEnabled(), true);
        await page.locator('#bb-map-back-btn').click();
        await page.evaluate(() => {
            resetAutoUpdate(); delete chat_metadata.bb_map_data;
            response.zones[0].uncertain = false; settings.autoApply = false; settings.autoUpdate = false;
            setupExtensionSettings(true);
        });
        await autoSave().check();
        assert.equal(await page.getByLabel('Prepare an update after each reply', { exact: true }).isChecked(), true);
        await page.evaluate(() => handleMessageReceived(1, 'normal'));
        await page.waitForFunction(() => writes === 3);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.previous), null);
        assert.deepEqual(errors, []);
        console.log('Automatic-save toggle, proposal freshness, location changes, manual preview and first-map settings integration passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
