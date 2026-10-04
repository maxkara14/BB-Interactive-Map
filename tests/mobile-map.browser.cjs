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
        const page = await browser.newPage({ viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#10151b;color:#e2e8f0"><div id="extensions_settings"></div><textarea id="send_textarea"></textarea></body>');
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-links.js'))}\n${strip(read('map-topology-view.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'ru', widgetCollapsed: false } }, chat_metadata = { bb_map_mode: 'game' }, writes = 0, scans = 0, notices = [];
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata, chat: [{ name: 'Character', mes: 'Мира стоит в трапезной.' }], name1: 'Player' };
            var SillyTavern = { getContext: () => context }, toastr = Object.fromEntries(['error','warning','info','success'].map(key => [key, text => notices.push(text)]));
            var saveChatDebounced = () => writes++, saveChatConditional = async () => writes++, saveSettingsDebounced = () => {};
            var extension_prompt_types = { IN_CHAT: 0 }, extension_prompt_roles = { USER: 0 }, setExtensionPrompt = () => {}, isChatSaving = false;
            ${strip(read('index.js').split('jQuery(async () => {')[0])}
            var raw = normalizeGraphMapData({ layout: 'graph', scope: 'scene', schematic_name: 'Поместье Бабочки — трапезная', player_place_id: 'dining',
                zones: [{ id: 'dining', name: 'Трапезная', kind: 'room', summary: 'Просторная светлая комната с татами и низкими столиками. '.repeat(12),
                    characters: Array.from({ length: 5 }, (_, i) => ({ name: 'Персонаж ' + i, description: 'Описание', mood: 'Искреннее сочувствие' })), poi: [{ name: 'Чайник' }, { name: 'Чашка' }] },
                    { id: 'garden', name: 'Сад', kind: 'outdoor' }], connections: [{ from: 'dining', to: 'garden', name: 'Проём', kind: 'opening', evidence: 'Открытый проём в сад.', status: 'confirmed', direction: 'both' }] });
            var generateQuietPrompt = async () => { scans++; return JSON.stringify(raw); };
            renderMapWidget(); setupExtensionSettings();
        ` });
        assert.deepEqual(errors, []);
        for (const [width, height] of [[390,640], [320,568], [740,360]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(() => renderMapWidget());
            assert.equal(await page.locator('.bb-map-widget-launch').isVisible(), true);
            const size = await page.locator('#bb-map-widget').boundingBox();
            assert.equal(size.width, 44); assert.ok(size.height <= 46);
            await page.locator('.bb-map-widget-launch').click();
            assert.equal(await page.locator('#bb-map-create-btn').isVisible(), true);
            assert.equal(await page.evaluate(() => scans), 0);
            await page.locator('#bb-map-back-btn').click();
        }
        await page.setViewportSize({ width:390, height:640 });
        const launchBox = await page.locator('.bb-map-widget-launch').boundingBox();
        await page.mouse.move(launchBox.x + 22, launchBox.y + 22); await page.mouse.down();
        await page.mouse.move(launchBox.x - 70, launchBox.y - 70, { steps: 5 }); await page.mouse.up();
        assert.equal(await page.locator('#bb-map-overlay').count(), 0); // Dragging does not open the map.
        assert.ok(await page.evaluate(() => Number.isFinite(settings.widgetPosition?.x)));

        await page.locator('.bb-map-widget-launch').click();
        await page.locator('#bb-map-create-btn').click();
        assert.equal(await page.evaluate(() => scans), 1);
        assert.equal(await page.evaluate(() => writes), 0);
        assert.equal(await page.locator('#bb-map-save-btn').count(), 1);
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => writes), 1);
        await page.locator('#bb-map-back-btn').click();
        for (const [width, height] of [[390,640], [320,568], [740,360]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(() => renderMapWidget());
            assert.equal(await page.locator('.bb-map-widget-content').isVisible(), false);
            await page.locator('.bb-map-widget-launch').click();
            await page.waitForFunction(() => getComputedStyle(document.getElementById('bb-map-overlay')).opacity === '1');
            await page.locator('.bb-map-modal').evaluate(modal => { modal.scrollTop = modal.scrollHeight; });
            const close = await page.locator('#bb-map-back-btn').boundingBox();
            assert.ok(close.x >= 0 && close.x + close.width <= width + 1);
            assert.ok(close.y >= 0 && close.y + close.height <= height - 4, 'Close button fits visible phone viewport');
            assert.equal(await page.locator('.bb-map-modal').evaluate(modal => modal.scrollWidth <= modal.clientWidth + 1), true);
            if (process.argv[3]) { fs.mkdirSync(process.argv[3], { recursive: true }); await page.screenshot({ path: path.join(process.argv[3], 'phone-map-' + width + '.png') }); }
            await page.locator('#bb-map-back-btn').click();
        }
        await page.evaluate(() => { autoCandidate = raw; autoCandidateChat = context; autoCandidateBase = chat_metadata.bb_map_data; autoStatus = 'ready'; settings.autoUpdate = true; renderMapWidget(); });
        assert.equal(await page.locator('.bb-map-widget-launch.has-update').count(), 1);
        await page.locator('.bb-map-widget-launch').click();
        assert.equal(await page.locator('#bb-map-save-btn').count(), 1); // Phone still offers pending update review.
        await page.locator('#bb-map-back-btn').click();
        await page.evaluate(() => { resetAutoUpdate(); });
        await page.evaluate(() => { context = { ...context, chatId: 'two', chatMetadata: {} }; chat_metadata = context.chatMetadata; renderMapWidget(); });
        await page.locator('.bb-map-widget-launch').click();
        assert.equal(await page.locator('#bb-map-create-btn').isVisible(), true);
        await page.locator('#bb-map-back-btn').click();
        await page.evaluate(() => { settings.uiLanguage = 'en'; setupExtensionSettings(true); });
        assert.doesNotMatch(await page.locator('#bb-map-settings-wrapper').textContent(), /center zone|central zone|current grid/i);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(() => renderMapWidget());
        assert.equal(await page.locator('.bb-map-widget-launch').isVisible(), true); // No map: desktop also offers creation.
        await page.locator('.bb-map-widget-launch').click();
        const before = await page.evaluate(() => scans);
        await page.evaluate(() => { context = { ...context, chatId: 'three', chatMetadata: {} }; chat_metadata = context.chatMetadata; });
        await page.locator('#bb-map-create-btn').click();
        assert.equal(await page.evaluate(() => scans), before); // Stale dialog never scans a new chat.
        await page.evaluate(() => { settings.showWidget = false; renderMapWidget(); });
        assert.equal(await page.locator('#bb-map-widget').count(), 0);
        assert.deepEqual(errors, []);
        console.log('Phone square launcher, empty-chat map prompt, guarded scan/preview, saved map, viewport/footer, chat isolation and disabled widget passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
