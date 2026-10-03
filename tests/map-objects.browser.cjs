// Isolated production scan/editor/auto-update handlers; persistence and model calls are stubbed.
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
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<body style="background:#10151b;color:#e2e8f0"><div id="chat"><div class="mes"><div class="mes_text">Мира взяла Боккэн.</div></div></div></body>');
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-links.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'ru', autoUpdate: true, autoApply: true, showWidget: false } };
            var chat_metadata = { bb_map_mode: 'game' };
            var messages = Object.freeze([Object.freeze({ name: 'Мира', mes: 'Мира берёт меч.' })]);
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata, chat: messages, name1: 'Player' };
            var SillyTavern = { getContext: () => context };
            var writes = 0, requests = 0, notices = [], requestedPrompt = '', response;
            var saveChatDebounced = () => writes++, saveChatConditional = async () => writes++;
            var isChatSaving = false, saveSettingsDebounced = () => {};
            var generateQuietPrompt = async params => { requests++; requestedPrompt = params.quietPrompt; return JSON.stringify(response); };
            var toastr = { error: message => notices.push(message), success: () => {}, warning: message => notices.push(message) };
            ${strip(read('index.js').split('jQuery(async () => {')[0])}
            injectCurrentMapContext = () => {}; renderMapWidget = () => {}; setupExtensionSettings = () => {};
            var original = normalizeMapData({ schematic_name: 'Зал', zones: [{ position: 'center', name: 'Стойка',
                poi: [{ name: 'Боккэн', item_state: 'zone', state_reason: 'Лежит на стойке.' }], characters: [{ name: 'Мира' }] }] });
            chat_metadata.bb_map_data = createSavedMap(original);
            response = { schematic_name: 'Зал', zones: [{ position: 'center', name: 'Стойка',
                poi: [{ name: 'Боккэн', item_state: 'held', holder: 'Мира', state_reason: 'Мира взяла меч.', uncertain: true }], characters: [{ name: 'Мира' }] }] };
            queueAutoScan(context);
        ` });
        await page.waitForFunction(() => autoStatus === 'ready');
        assert.equal(await page.evaluate(() => writes), 0);
        assert.match(await page.evaluate(() => requestedPrompt), /item_state.*intentions to take or leave an item are not completed actions/s);
        await page.evaluate(() => showRadarModal(autoCandidate, false, context, autoCandidateBase));
        assert.match(await page.locator('.bb-map-review').last().innerText(), /автосохранение приостановлено/);
        await page.locator('.bb-map-objects > summary').click();
        assert.match(await page.locator('.bb-map-objects').innerText(), /У персонажа · Мира/);
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            assert.ok(await page.locator('.bb-map-modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        }
        await page.locator('#bb-map-edit-btn').click();
        const object = page.locator('[data-entity-type="object"]');
        await object.locator('[name="holder"]').fill('Player');
        await page.getByRole('button', { name: 'ПРОВЕРИТЬ ПРАВКИ', exact: true }).click();
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.zones[0].poi[0].holder), 'Player');
        assert.equal(await page.evaluate(() => writes), 1);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.previous.raw === original), true);

        // An absent object is retained outside the grid and requires review once.
        await page.evaluate(() => { response.zones[0].poi = []; queueAutoScan(context); });
        await page.waitForFunction(() => autoStatus === 'ready');
        assert.equal(await page.evaluate(() => writes), 1);
        assert.equal(await page.evaluate(() => autoCandidate.unlocated_objects[0].last_known), 'Player');
        await page.evaluate(() => showRadarModal(autoCandidate, false, context, autoCandidateBase));
        await page.locator('#bb-map-save-btn').click();
        await page.evaluate(() => queueAutoScan(context));
        await page.waitForFunction(() => autoStatus === 'updated');
        assert.equal(await page.evaluate(() => writes), 3);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.unlocated_objects.length), 1);
        await page.evaluate(() => {
            document.getElementById('bb-map-overlay')?.remove();
            globalThis.links = createChatMapLinks({ getMap: () => chat_metadata.bb_map_data.raw, isEnabled: () => true,
                getLabels: () => ({ language: 'ru', types: { object: 'Предмет' }, close: 'Закрыть', noDescription: 'Нет описания',
                    source: 'По сохранённой карте', openMap: 'Открыть карту', position: mapPositionLabel, objectState: mapObjectLabel }),
                onOpenMap: () => {} });
            links.refresh();
        });
        await page.locator('[data-bb-map-mention="боккэн"]').click();
        assert.match(await page.locator('#bb-map-mention-card').innerText(), /Местоположение неизвестно · ранее: Player/);
        await page.evaluate(() => links.destroy());

        // Unknown memory can be manually placed into an existing zone, then confirmed.
        await page.evaluate(() => showRadarModal(chat_metadata.bb_map_data.raw, true));
        await page.locator('#bb-map-edit-btn').click();
        await object.locator('[name="destination"]').selectOption('0');
        await object.locator('[name="item_state"]').selectOption('zone');
        await object.locator('[name="state_reason"]').fill('Меч возвращён на стойку.');
        await page.getByRole('button', { name: 'ПРОВЕРИТЬ ПРАВКИ', exact: true }).click();
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.unlocated_objects.length), 0);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.zones[0].poi[0].item_state), 'zone');

        // Explicit transfer autosaves; stale chat results never write.
        await page.evaluate(() => {
            response.zones[0].poi = [{ name: 'Боккэн', item_state: 'held', holder: 'Мира', state_reason: 'Мира взяла меч.', uncertain: false }];
            queueAutoScan(context);
        });
        await page.waitForFunction(() => autoStatus === 'updated' && chat_metadata.bb_map_data.raw.zones[0].poi[0].item_state === 'held');
        assert.equal(await page.evaluate(() => writes), 5);
        await page.evaluate(async () => {
            generateQuietPrompt = async () => { context = { ...context, chatId: 'other' }; return JSON.stringify(response); };
            const result = await createMapCandidate(context, 'local');
            if (result !== null) throw Error('Stale candidate escaped');
        });
        assert.equal(await page.evaluate(() => writes), 5);

        // Classic retains possession data while hiding the game panel; EN labels render.
        await page.evaluate(() => { context = { ...context, chatId: 'one' }; chat_metadata.bb_map_mode = 'classic'; showRadarModal(chat_metadata.bb_map_data.raw, true); });
        assert.equal(await page.locator('.bb-map-objects').count(), 0);
        await page.evaluate(() => { chat_metadata.bb_map_mode = 'game'; settings.uiLanguage = 'en'; showRadarModal(chat_metadata.bb_map_data.raw, true); });
        await page.locator('.bb-map-objects > summary').click();
        assert.match(await page.locator('.bb-map-objects').innerText(), /Held by a character · Мира/);
        assert.equal(await page.evaluate(() => messages[0].mes), 'Мира берёт меч.');
        assert.deepEqual(errors, []);
        console.log('Object scan, review gate, manual corrections, save/rollback snapshot, memory, auto-apply, stale chat, modes and RU/EN passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
