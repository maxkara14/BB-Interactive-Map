// Real automatic scan, review, acceptance and follow-up saves on a synthetic chat.
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
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px;background:#10151b;color:#e2e8f0;font-family:system-ui"><div id="extensions_settings" style="width:440px;max-width:100%"></div></body>');
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-topology-view.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'en', autoUpdate: true, autoApply: true, widgetCollapsed: false } };
            var chat_metadata = {}, writes = 0, requests = 0, notices = [];
            var context = { chatId: 'train', characterId: 1, groupId: null, chatMetadata: chat_metadata,
                name1: 'Player', chat: [{ name: 'Character', mes: 'Player stands on the train roof.', is_user: false }] };
            var SillyTavern = { getContext: () => context }, toastr = { warning: text => notices.push(text), error: text => { throw Error(text); } };
            var saveSettingsDebounced = () => {}, saveChatConditional = async () => { writes++; }, saveChatDebounced = () => { writes++; };
            var isChatSaving = false, setExtensionPrompt = () => {}, extension_prompt_types = { IN_CHAT: 0 }, extension_prompt_roles = { USER: 0 };
            var response = { layout: 'graph', scope: 'scene', schematic_name: 'Train', player_place_id: 'roof',
                zones: [{ id: 'roof', name: 'Carriage roof', kind: 'outdoor' }, { id: 'inside', name: 'Carriage interior', kind: 'room', uncertain: true }],
                connections: [{ from: 'roof', to: 'inside', name: 'Hatch', kind: 'opening', status: 'uncertain', direction: 'both' }] };
            var generateQuietPrompt = async () => { requests++; return JSON.stringify(response); };
            ${strip(read('index.js').split('jQuery(async () => {')[0])}
            chat_metadata.bb_map_data = createSavedMap(normalizeGraphMapData({ ...response,
                zones: response.zones.map(zone => ({ ...zone, uncertain: false })),
                connections: response.connections.map(edge => ({ ...edge, status: 'confirmed', evidence: 'The hatch is open.' })) }));
            setupExtensionSettings(); renderMapWidget();
        ` });
        const reply = async () => {
            await page.evaluate(() => { context.chat[0].mes += ' Another event.'; handleMessageReceived(0, 'normal'); });
            await page.waitForFunction(() => !scanInProgress && ['ready', 'updated'].includes(autoStatus));
        };
        await reply();
        assert.equal(await page.evaluate(() => writes), 0);
        assert.equal(await page.evaluate(() => notices.length), 1);
        assert.match(await page.locator('.bb-map-widget-update').innerText(), /Automatic saving paused.*unconfirmed places: 1; unconfirmed passages: 1/);
        assert.match(await page.locator('[data-section="map"] .bb-map-review-status').textContent(), /Review the map manually/);
        await page.evaluate(() => { response.atmosphere = 'Night'; response.connections[0].evidence = 'A hatch may lead inside.'; });
        await reply();
        assert.equal(await page.evaluate(() => notices.length), 1, 'Same pending concerns do not repeat the toast');
        assert.equal(await page.evaluate(() => writes), 0);
        await page.evaluate(() => { settings.uiLanguage = 'ru'; setupExtensionSettings(true); renderMapWidget(); });
        assert.match(await page.locator('.bb-map-widget-update').innerText(), /Автосохранение приостановлено.*неподтверждённых мест: 1/);
        if (process.argv[3]) fs.mkdirSync(process.argv[3], { recursive: true });
        for (const width of [1440, 768, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            assert.ok(await page.locator('#bb-map-widget').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
            if (process.argv[3]) await page.locator('#bb-map-widget').screenshot({ path: path.join(process.argv[3], `status-${width}.png`) });
        }
        await page.locator('.bb-map-widget-review').click();
        assert.match(await page.locator('#bb-map-save-btn').innerText(), /СОХРАНИТЬ С НЕОПРЕДЕЛЁННОСТЬЮ/);
        await page.waitForFunction(() => getComputedStyle(document.getElementById('bb-map-overlay')).opacity === '1');
        for (const width of [1440, 768, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            assert.ok(await page.locator('.bb-map-modal').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
            if (process.argv[3]) await page.locator('.bb-map-modal').screenshot({ path: path.join(process.argv[3], `review-${width}.png`) });
        }
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => writes), 1);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.zones[1].uncertain), true);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.connections[0].status), 'uncertain');
        assert.equal(await page.evaluate(() => getMapRoute(chat_metadata.bb_map_data.raw, chat_metadata.bb_map_data.raw.zones[1].id)), null);
        await page.locator('#bb-map-back-btn').click();
        await reply();
        assert.equal(await page.evaluate(() => writes), 2);
        assert.equal(await page.evaluate(() => notices.length), 1);
        assert.equal(await page.evaluate(() => autoStatus), 'updated');
        await page.evaluate(() => { response.connections[0].direction = 'forward'; });
        await reply();
        assert.equal(await page.evaluate(() => notices.length), 2, 'Changed uncertain passage needs review');
        assert.equal(await page.evaluate(() => writes), 2);
        assert.match(await page.locator('.bb-map-widget-update').innerText(), /неподтверждённых проходов: 1/);
        await reply();
        assert.equal(await page.evaluate(() => notices.length), 2);
        await page.locator('.bb-map-widget-review').click(); await page.locator('#bb-map-save-btn').click();
        await page.locator('#bb-map-back-btn').click();
        await page.evaluate(() => { response.player_place_id = null; });
        await reply();
        assert.equal(await page.evaluate(() => writes), 3);
        assert.match(await page.locator('.bb-map-widget-update').innerText(), /положение игрока неизвестно/);
        assert.equal(await page.evaluate(() => notices.length), 3);
        await page.evaluate(() => { settings.autoApply = false; setupExtensionSettings(true); renderMapWidget(); });
        await reply();
        assert.equal(await page.evaluate(() => notices.length), 3, 'Disabled automatic saving does not warn about being paused');
        await page.locator('.bb-map-widget-review').click();
        assert.match(await page.locator('.bb-map-change-warning').first().innerText(), /Карта требует проверки/);
        assert.doesNotMatch(await page.locator('.bb-map-change-warning').first().innerText(), /Автосохранение приостановлено/);
        // Quick confirmation works on a saved map and changes only a draft until Save map.
        await page.evaluate(() => {
            removeMapOverlay();
            const raw = chat_metadata.bb_map_data.raw;
            const long = { ...raw, zones: raw.zones.map(zone => ({ ...zone, name: zone.name + ' — длинное описание участка крыши пассажирского вагона' })) };
            chat_metadata.bb_map_data = createSavedMap(normalizeGraphMapData(long, raw), chat_metadata.bb_map_data);
            globalThis.beforeQuick = JSON.stringify(chat_metadata.bb_map_data);
            showRadarModal(chat_metadata.bb_map_data.raw, true);
        });
        assert.equal(await page.locator('.bb-map-quick-review button').count(), 2);
        assert.equal(await page.locator('.bb-map-quick-review').evaluate(block => block.nextElementSibling.classList.contains('bb-map-scan-controls')), true);
        for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.locator('.bb-map-quick-review').scrollIntoViewIfNeeded();
            assert.ok(await page.locator('.bb-map-modal').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
            assert.ok(await page.locator('.bb-map-quick-review').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
            for (const button of await page.locator('.bb-map-quick-review button').all()) {
                assert.ok(await button.evaluate(node => node.offsetHeight >= 44 && node.scrollWidth <= node.clientWidth + 1));
                await button.scrollIntoViewIfNeeded();
                assert.ok(await button.evaluate(node => {
                    const footer = node.closest('.bb-map-modal').querySelector('.bb-map-controls');
                    return getComputedStyle(footer).position !== 'sticky' || node.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top;
                }), 'Sticky save controls do not cover quick actions');
            }
            await page.locator('.bb-map-quick-review').scrollIntoViewIfNeeded();
            if (process.argv[3]) await page.locator('.bb-map-quick-review').screenshot({ path: path.join(process.argv[3], `quick-${width}.png`) });
        }
        await page.locator('[data-review-type="place"]').click();
        await page.waitForFunction(() => document.activeElement?.dataset.reviewType === 'connection');
        assert.equal(await page.evaluate(() => JSON.stringify(chat_metadata.bb_map_data) === beforeQuick), true);
        assert.equal(await page.locator('.bb-map-quick-review button').count(), 1);
        assert.equal(await page.locator('#bb-map-save-btn').isEnabled(), true);
        await page.locator('[data-review-type="connection"]').click();
        await page.waitForFunction(() => document.activeElement?.id === 'bb-map-save-btn');
        assert.equal(await page.evaluate(() => JSON.stringify(chat_metadata.bb_map_data) === beforeQuick), true);
        assert.equal(await page.locator('.bb-map-quick-review').count(), 0);
        assert.match(await page.locator('#bb-map-save-btn').innerText(), /СОХРАНИТЬ КАРТУ/);
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.zones[1].uncertain), false);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.connections[0].status), 'confirmed');
        assert.match(await page.evaluate(() => chat_metadata.bb_map_data.raw.connections[0].evidence), /подтверждены пользователем/);
        assert.equal(await page.evaluate(() => !!getMapRoute(chat_metadata.bb_map_data.raw, chat_metadata.bb_map_data.raw.zones[1].id)), true);
        // Stale chat guards also apply to quick actions; archive snapshots stay read-only.
        await page.evaluate(() => {
            const raw = chat_metadata.bb_map_data.raw;
            const uncertain = { ...raw, zones: raw.zones.map(zone => ({ ...zone, uncertain: true })) };
            showRadarModal(uncertain, false);
            context.chatId = 'other';
        });
        await page.locator('[data-review-type="place"]').first().click();
        assert.match(await page.evaluate(() => notices.at(-1)), /Чат, режим или карта изменились/);
        assert.equal(await page.locator('.bb-map-quick-review button').count(), 2);
        await page.evaluate(() => {
            context.chatId = 'train';
            const raw = chat_metadata.bb_map_data.raw;
            globalThis.uncertainQuick = { ...raw, zones: raw.zones.map(zone => ({ ...zone, uncertain: true })) };
            showRadarModal(uncertainQuick, false);
            context.chat[0].mes += ' The scene changes before confirmation.';
        });
        await page.locator('[data-review-type="place"]').first().click();
        assert.equal(await page.locator('.bb-map-quick-review button').count(), 2);
        await page.evaluate(() => { showRadarModal(uncertainQuick, false); });
        await page.locator('[data-review-type="place"]').first().click();
        await page.waitForFunction(() => document.activeElement?.dataset.reviewType === 'place');
        const writesBeforeStaleSave = await page.evaluate(() => writes);
        await page.evaluate(() => { context.chat[0].mes += ' The scene changes before saving.'; });
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => writes), writesBeforeStaleSave);
        assert.match(await page.evaluate(() => notices.at(-1)), /Сцена изменилась/);
        await page.evaluate(() => { const snapshot = createSavedMap(uncertainQuick); showRadarModal(snapshot.raw, true, context, snapshot, true); });
        assert.equal(await page.locator('.bb-map-quick-review').count(), 0);
        assert.deepEqual(errors, []);
        console.log('Review notifications, uncertainty acceptance, quick confirmation drafts/save, mobile controls, stale scene/chat and read-only archive passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
