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
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-object-mentions.js'))}\n${strip(read('map-links.js'))}\n${strip(read('map-topology-view.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'ru', autoUpdate: true, autoApply: true, showWidget: false } };
            var chat_metadata = { bb_map_mode: 'game' };
            var messages = Object.freeze([Object.freeze({ name: 'Мира', mes: 'Мира берёт меч.' })]);
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata, chat: messages, name1: 'Player' };
            var SillyTavern = { getContext: () => context };
            var writes = 0, requests = 0, notices = [], requestedPrompt = '', response;
            var saveChatDebounced = () => writes++, saveChatConditional = async () => writes++;
            var isChatSaving = false, saveSettingsDebounced = () => {};
            function responseForGraph() { return { ...response, layout: 'graph', scope: 'scene', player_place_id: response.zones[0]?.position || null,
                zones: response.zones.map(zone => ({ ...zone, id: zone.position, kind: 'room' })), connections: [] }; }
            var generateQuietPrompt = async params => { requests++; requestedPrompt = params.quietPrompt; return JSON.stringify(responseForGraph()); };
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

        // Omission preserves established player possession without inventing loss.
        await page.evaluate(() => { response.zones[0].poi = []; queueAutoScan(context); });
        await page.waitForFunction(() => autoStatus === 'updated');
        assert.equal(await page.evaluate(() => writes), 2);
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
        assert.match(await page.locator('#bb-map-mention-card').innerText(), /У персонажа · Player/);
        await page.evaluate(() => links.destroy());

        // Explicit uncertainty is reviewed; it is excluded from active prompts.
        await page.evaluate(() => {
            response.unlocated_objects = [{ name: 'Боккэн', item_state: 'unknown', state_reason: 'Неясно, сохранился ли меч после падения.', uncertain: true }];
            queueAutoScan(context);
        });
        await page.waitForFunction(() => autoStatus === 'ready');
        assert.equal(await page.evaluate(() => writes), 2);
        assert.equal(await page.evaluate(() => autoCandidate.unlocated_objects[0].last_known), 'Player');
        await page.evaluate(() => showRadarModal(autoCandidate, false, context, autoCandidateBase));

        // Unknown memory can be manually placed into an existing zone, then confirmed.
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
            response.unlocated_objects = [];
            response.zones[0].poi = [{ name: 'Боккэн', item_state: 'held', holder: 'Мира', state_reason: 'Мира взяла меч.', uncertain: false }];
            queueAutoScan(context);
        });
        await page.waitForFunction(() => autoStatus === 'updated' && chat_metadata.bb_map_data.raw.zones[0].poi[0].item_state === 'held');
        assert.equal(await page.evaluate(() => writes), 4);
        await page.evaluate(async () => {
            generateQuietPrompt = async () => { context = { ...context, chatId: 'other' }; return JSON.stringify(responseForGraph()); };
            const result = await createMapCandidate(context, 'local');
            if (result !== null) throw Error('Stale candidate escaped');
        });
        assert.equal(await page.evaluate(() => writes), 4);

        // Classic retains possession data while hiding the game panel; EN labels render.
        await page.evaluate(() => { context = { ...context, chatId: 'one' }; chat_metadata.bb_map_mode = 'classic'; showRadarModal(chat_metadata.bb_map_data.raw, true); });
        assert.equal(await page.locator('.bb-map-objects').count(), 0);
        await page.evaluate(() => { chat_metadata.bb_map_mode = 'game'; settings.uiLanguage = 'en'; showRadarModal(chat_metadata.bb_map_data.raw, true); });
        await page.locator('.bb-map-objects > summary').click();
        assert.match(await page.locator('.bb-map-objects').innerText(), /Held by a character · Мира/);
        await page.locator('#bb-map-edit-btn').click();
        await object.locator('[name="destination"]').selectOption('');
        await object.locator('[name="item_state"]').selectOption('left');
        await object.locator('[name="state_reason"]').fill('Меч оставлен в предыдущем зале.');
        await page.getByRole('button', { name: 'PREVIEW EDITS', exact: true }).click();
        assert.match(await page.locator('.bb-map-review').last().innerText(), /Left outside the scene/);
        assert.equal(await page.evaluate(() => writes), 4);

        // Legacy cleanup pauses auto-apply, filters old prompt memory and preserves rollback.
        await page.evaluate(() => {
            chat_metadata.bb_map_data = { raw: normalizeMapData({ schematic_name: 'Зал', zones: [{ position: 'center', name: 'Стойка',
                poi: [{ name: 'Боккэн', item_state: 'held', holder: 'Player', state_reason: 'Игрок держит меч.' }] }],
                unlocated_objects: [{ name: 'Старые половицы', item_state: 'unknown', last_known: 'Старый зал' }] }), context: 'Старые половицы are stale' };
            globalThis.legacy = chat_metadata.bb_map_data;
            if (getMapContextForCurrentChat().includes('Старые половицы')) throw Error('Legacy context leaked');
            response = { schematic_name: 'Сад', zones: [{ position: 'center', name: 'Дорожка', poi: [{ name: 'Гравий', item_state: 'zone' }] }] };
            generateQuietPrompt = async params => { requestedPrompt = params.quietPrompt; return JSON.stringify(responseForGraph()); };
            queueAutoScan(context);
        });
        await page.waitForFunction(() => autoStatus === 'ready');
        assert.equal(await page.evaluate(() => writes), 4);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data === legacy), true);
        assert.doesNotMatch(await page.evaluate(() => requestedPrompt), /Старые половицы/);
        assert.equal(await page.evaluate(() => autoCandidate.unlocated_objects[0].holder), 'Player');
        await page.evaluate(() => showRadarModal(autoCandidate, false, context, autoCandidateBase));
        assert.match(await page.locator('.bb-map-review').last().innerText(), /Legacy memory cleanup/);
        await page.getByRole('button', { name: 'THIS IS A NEW LOCATION', exact: true }).click();
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => writes), 5);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.previous.raw === legacy.raw), true);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.unlocated_objects.length), 1);
        await page.evaluate(() => {
            response.unlocated_objects = [{ name: 'Боккэн', item_state: 'left', state_reason: 'Игрок оставил меч в старом зале.', uncertain: false }];
            queueAutoScan(context);
        });
        await page.waitForFunction(() => autoStatus === 'updated');
        assert.equal(await page.evaluate(() => writes), 6);
        assert.doesNotMatch(await page.evaluate(() => getMapContextForCurrentChat()), /Боккэн/);
        await page.evaluate(() => showRadarModal(chat_metadata.bb_map_data.raw, true));
        await page.locator('.bb-map-objects > summary').click();
        assert.doesNotMatch(await page.locator('.bb-map-objects').innerText(), /Боккэн|Старые половицы/);

        // Actual temporary-effect scan, review, editor, context and ending handlers.
        await page.evaluate(() => {
            settings.uiLanguage = 'ru';
            response.effects = [{ name: 'Дым', scope: 'zone', target: 'Дорожка', description: 'Дым мешает обзору.',
                source: 'Дымящий костёр', expires_when: 'Дым рассеется.', evidence: 'Костёр начал дымить.', uncertain: true }];
            queueAutoScan(context);
        });
        await page.waitForFunction(() => autoStatus === 'ready');
        assert.equal(await page.evaluate(() => writes), 6);
        await page.evaluate(() => showRadarModal(autoCandidate, false, context, autoCandidateBase));
        assert.match(await page.locator('.bb-map-effects').innerText(), /Источник: Дымящий костёр/);
        assert.match(await page.locator('.bb-map-effects').innerText(), /Окончание: Дым рассеется/);
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            assert.ok(await page.locator('.bb-map-modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        }
        await page.locator('#bb-map-edit-btn').click();
        await page.locator('.bb-map-edit-effects > summary').click();
        await page.locator('[data-effect] [name="expires_when"]').fill('Дым рассеется после проветривания.');
        await page.getByRole('button', { name: 'ПРОВЕРИТЬ ПРАВКИ', exact: true }).click();
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => writes), 7);
        assert.match(await page.evaluate(() => getMapContextForCurrentChat()), /Temporary scene effects.*Дым/s);
        await page.evaluate(async () => {
            const before = JSON.stringify(chat_metadata.bb_map_data);
            chat_metadata.bb_map_mode = 'classic';
            if (getMapContextForCurrentChat().includes('Temporary scene effects')) throw Error('Classic context leaked effects');
            showRadarModal(chat_metadata.bb_map_data.raw, true);
            const classicScan = await createMapCandidate(context, 'local');
            if (JSON.stringify(classicScan.effects) !== JSON.stringify(chat_metadata.bb_map_data.raw.effects)) throw Error('Classic scan changed game effects');
            if (JSON.stringify(chat_metadata.bb_map_data) !== before) throw Error('Mode switching wrote the map');
            chat_metadata.bb_map_mode = 'game'; response.effects = []; queueAutoScan(context);
        });
        assert.equal(await page.locator('.bb-map-effects').count(), 0);
        await page.waitForFunction(() => autoStatus === 'updated');
        assert.equal(await page.evaluate(() => writes), 8);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.effects[0].status), 'active');
        await page.evaluate(() => {
            response.effects = [{ ...chat_metadata.bb_map_data.raw.effects[0], status: 'ended', evidence: 'После проветривания дым полностью рассеялся.', uncertain: true }];
            queueAutoScan(context);
        });
        await page.waitForFunction(() => autoStatus === 'ready');
        assert.equal(await page.evaluate(() => writes), 8);
        await page.evaluate(() => showRadarModal(autoCandidate, false, context, autoCandidateBase));
        assert.match(await page.locator('.bb-map-effects').innerText(), /Завершён/);
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => writes), 9);
        assert.doesNotMatch(await page.evaluate(() => getMapContextForCurrentChat()), /Temporary scene effects/);
        assert.equal(await page.evaluate(() => restorePreviousMap(chat_metadata.bb_map_data).raw.effects[0].status), 'active');
        await page.evaluate(() => { response.effects = []; queueAutoScan(context); });
        await page.waitForFunction(() => autoStatus === 'updated');
        assert.equal(await page.evaluate(() => writes), 10);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.effects.length), 0);
        assert.equal(await page.evaluate(() => messages[0].mes), 'Мира берёт меч.');
        assert.deepEqual(errors, []);
        console.log('Object scan, review gate, manual corrections, save/rollback snapshot, memory, auto-apply, stale chat, modes and RU/EN passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
