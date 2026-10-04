// Production graph scans/editor/widget/travel; no real chats or external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const strip = text => text.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<body style="background:#10151b;color:#e2e8f0"><div id="extensions_settings"></div><textarea id="send_textarea"></textarea><button id="scan">Scan</button></body>');
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-links.js'))}\n${strip(read('map-topology-view.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'ru', scanScale: 'global', widgetCollapsed: false, autoApply: true, autoUpdate: true } };
            var chat_metadata = { bb_map_mode: 'game' }, saves = 0, calls = [], notices = [];
            var messages = Object.freeze([Object.freeze({ name: 'Player', mes: 'Я стою в зале.', is_user: true }), Object.freeze({ name: 'Мира', mes: 'Мира открывает дверь в галерею.' })]);
            var response = { layout: 'graph', scope: 'surroundings', schematic_name: 'Поместье Бабочки — северное крыло', player_place_id: 'hall', zones: [
                { id: 'hall', name: 'Зал', kind: 'room', poi: [{ name: 'Ключ', item_state: 'zone', state_reason: 'Ключ на столе.' }], characters: [{ name: 'Мира' }] },
                { id: 'gallery', name: 'Галерея', kind: 'passage', threat_level: 'danger', threat_reason: 'Дым' }, { id: 'garden', name: 'Сад', kind: 'outdoor' }
            ], connections: [
                { from: 'hall', to: 'gallery', name: 'Дверь', kind: 'door', status: 'confirmed', direction: 'both', evidence: 'Мира открыла дверь.' },
                { from: 'gallery', to: 'garden', name: 'Ступени', kind: 'stairs', status: 'confirmed', direction: 'forward', evidence: 'Ступени ведут в сад.' }
            ] };
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata, name1: 'Player', chat: messages,
                ConnectionManagerRequestService: { getSupportedProfiles: () => [{ id: 'profile' }], sendRequest: async (id, messages, tokens) => { calls.push({ source: 'profile', prompt: messages[1].content, tokens }); return { content: JSON.stringify(response) }; } } };
            var SillyTavern = { getContext: () => context }, toastr = Object.fromEntries(['error','warning','info','success'].map(key => [key, text => notices.push(text)]));
            var saveChatDebounced = () => saves++, saveChatConditional = async () => saves++, saveSettingsDebounced = () => {}, isChatSaving = false;
            var generateQuietPrompt = async params => { calls.push({ source: 'main', prompt: params.quietPrompt, tokens: params.responseLength }); return JSON.stringify(response); };
            var fetch = async (url, options) => { const body = JSON.parse(options.body); calls.push({ source: 'custom', prompt: body.messages[1].content, tokens: body.max_tokens }); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }; };
            ${strip(read('index.js').split('jQuery(async () => {')[0])}
            var buildSettings = setupExtensionSettings; injectCurrentMapContext = () => {}; setupExtensionSettings = () => {};
            var oldGrid = createSavedMap(normalizeMapData({ schematic_name: 'Поместье', zones: [{ position: 'center', name: 'Зал', poi: ['Ключ'] }] }));
            chat_metadata.bb_map_data = oldGrid;
        ` });
        assert.equal(await page.evaluate(() => settings.scanScale), 'surroundings');
        for (const source of ['main', 'profile', 'custom']) {
            await page.evaluate(async source => {
                settings.generationSource = source; settings.connectionProfileId = 'profile'; settings.customApiUrl = 'https://fixture.invalid'; settings.customApiModel = 'fixture';
                const before = chat_metadata.bb_map_data;
                globalThis.candidate = await createMapCandidate(context, 'surroundings');
                if (before !== chat_metadata.bb_map_data || candidate.layout !== 'graph') throw Error('Scan wrote data');
            }, source);
            const call = await page.evaluate(() => calls.at(-1));
            assert.equal(call.source, source); assert.equal(call.tokens, 10000);
            assert.match(call.prompt, /scope "surroundings"/); assert.match(call.prompt, /player_place_id/);
            assert.doesNotMatch(call.prompt, /fill the entire 3x3|Invent logical surrounding/);
        }
        await page.evaluate(async () => { settings.generationSource = 'main'; await triggerMapScan(document.getElementById('scan'), 'surroundings'); });
        assert.equal(await page.locator('.bb-topology-place').count(), 3);
        assert.equal(await page.evaluate(() => saves), 0);
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.version), 3);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.previous.raw === oldGrid.raw), true);
        assert.equal(await page.locator('.bb-map-widget-place[data-place-id]').count(), 2);
        assert.match(await page.locator('.bb-map-widget-content').innerText(), /Поместье Бабочки — северное крыло/);
        await page.getByRole('button', { name: 'Сад', exact: false }).filter({ has: page.locator('small', { hasText: 'Открытое место' }) }).click();
        assert.match(await page.locator('#bb-map-travel').innerText(), /Зал → Галерея → Сад/);
        assert.match(await page.locator('#bb-map-travel').innerText(), /Галерея · Опасность · Дым/);
        await page.locator('#send_textarea').fill('Мой текст');
        const currentPlace = await page.evaluate(() => chat_metadata.bb_map_data.raw.player_place_id);
        await page.getByRole('button', { name: 'ПОДГОТОВИТЬ ПЕРЕХОД', exact: true }).click();
        assert.match(await page.locator('#send_textarea').inputValue(), /Мой текст\n\nЯ направляюсь по маршруту: «Зал» → «Галерея» → «Сад»/);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.player_place_id), currentPlace);
        assert.equal(await page.locator('#bb-map-overlay').count(), 0);
        assert.doesNotMatch(await page.locator('.bb-map-widget').innerText(), /Подтвержд|Confirmed/);
        assert.equal(await page.locator('.bb-map-widget-arrow').count(), 2);
        if (process.argv[3]) {
            fs.mkdirSync(process.argv[3], { recursive: true });
            await page.locator('.bb-map-widget').screenshot({ path: path.join(process.argv[3], 'mini-one.png') });
        }
        await page.locator('.bb-map-widget-place[data-place-id]').first().click();
        assert.match(await page.locator('.bb-topology-detail').innerText(), /Галерея/);
        await page.locator('#bb-map-edit-btn').click();
        // A place/connection can be added without mutating the saved map.
        await page.getByRole('button', { name: '+ Место', exact: true }).click();
        const added = page.locator('[data-zone-index]').last();
        await added.locator('[name="name"]').fill('Лазарет');
        await added.locator('[name="kind"]').selectOption('room');
        await added.locator('[name="uncertain"]').selectOption('false');
        await page.getByRole('button', { name: '+ Проход', exact: true }).click();
        const edge = page.locator('[data-connection]').last();
        await edge.locator('[name="name"]').fill('Дверь лазарета');
        await edge.locator('[name="from"]').selectOption({ label: 'Галерея' });
        await edge.locator('[name="to"]').selectOption({ label: 'Лазарет' });
        await edge.locator('[name="status"]').selectOption('confirmed');
        await edge.locator('[name="evidence"]').fill('Дверь открыта в галерею.');
        await page.getByRole('button', { name: 'ПРОВЕРИТЬ ПРАВКИ', exact: true }).click();
        assert.equal(await page.locator('.bb-topology-place').count(), 4);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.zones.length), 3);
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.connections.length), 3);
        await page.locator('#bb-map-edit-btn').click();
        await page.locator('[data-zone-index]').last().locator('summary').click();
        await page.locator('[data-zone-index]').last().locator('button', { hasText: 'Убрать место' }).click();
        await page.getByRole('button', { name: 'ПРОВЕРИТЬ ПРАВКИ', exact: true }).click();
        assert.equal(await page.locator('.bb-map-edit-error').isVisible(), true); // Dangling passage is not silently reassigned.
        await page.locator('[data-connection]').last().locator('button').click();
        await page.getByRole('button', { name: 'ПРОВЕРИТЬ ПРАВКИ', exact: true }).click();
        assert.equal(await page.locator('.bb-topology-place').count(), 3);
        await page.locator('#bb-map-save-btn').click();
        await page.keyboard.press('Escape');
        // Uncertain topology stops automatic saving in both modes.
        for (const mode of ['classic', 'game']) {
            await page.evaluate(mode => { chat_metadata.bb_map_mode = mode; response.connections[0].status = 'uncertain'; resetAutoUpdate(); queueAutoScan(context); }, mode);
            await page.waitForFunction(() => autoStatus === 'ready');
            const before = await page.evaluate(() => saves);
            await page.locator('.bb-map-widget-review').click();
            assert.match(await page.locator('.bb-map-change-warning').first().innerText(), /Положение или проходы/);
            if (mode === 'game') {
                await page.getByRole('button', { name: 'Сад', exact: false }).filter({ has: page.locator('small', { hasText: 'Открытое место' }) }).click();
                assert.equal(await page.locator('#bb-map-travel button').count(), 0);
            }
            assert.equal(await page.evaluate(() => saves), before);
            await page.keyboard.press('Escape');
            await page.locator('.bb-map-widget-discard').click();
        }
        await page.evaluate(() => { response.connections[0].status = 'confirmed'; queueAutoScan(context); });
        await page.waitForFunction(() => autoStatus === 'updated');
        assert.equal(await page.evaluate(() => autoCandidate), null);
        // Unknown position is distinct from a blocked route and requires review.
        await page.evaluate(() => { response.player_place_id = null; queueAutoScan(context); });
        await page.waitForFunction(() => autoStatus === 'ready');
        await page.locator('.bb-map-widget-review').click();
        assert.match(await page.locator('.bb-map-header-container').innerText(), /Положение неизвестно/);
        await page.getByRole('button', { name: 'Сад', exact: false }).filter({ has: page.locator('small', { hasText: 'Открытое место' }) }).click();
        assert.equal(await page.locator('#bb-map-travel button').count(), 0);
        // Representative rendered full map, widget and editor at all target widths.
        await page.evaluate(() => { resetAutoUpdate(); settings.uiLanguage = 'en'; renderMapWidget(); showRadarModal(chat_metadata.bb_map_data.raw, true); });
        await page.waitForTimeout(350);
        for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(50);
            assert.ok(await page.locator('.bb-map-modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            if (process.argv[3]) { fs.mkdirSync(process.argv[3], { recursive: true }); await page.screenshot({ path: path.join(process.argv[3], `integrated-${width}.png`) }); }
        }
        await page.locator('#bb-map-edit-btn').click();
        assert.match(await page.locator('.bb-map-edit-fields').innerText(), /Player position/);
        assert.ok(await page.locator('.bb-map-modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        await page.evaluate(() => { context = { ...context, chatId: 'other' }; });
        await page.getByRole('button', { name: 'PREVIEW EDITS', exact: true }).click();
        assert.match(await page.locator('.bb-map-edit-error').innerText(), /chat or saved map changed/);
        assert.equal(await page.evaluate(() => messages[0].mes), 'Я стою в зале.');
        await page.evaluate(() => {
            removeMapOverlay(); settings.uiLanguage = 'ru';
            const hub = { layout: 'graph', scope: 'scene', schematic_name: 'Карантинный двор — Каменный умывальник', player_place_id: 'center',
                zones: [{ id: 'center', name: 'Каменный умывальник', kind: 'room' },
                    { id: 'a', name: 'Забрызганный гравий', kind: 'outdoor' }, { id: 'b', name: 'Карниз веранды', kind: 'passage' },
                    { id: 'c', name: 'Тренировочный зал', kind: 'room' }, { id: 'd', name: 'Бамбуковая роща', kind: 'outdoor' }],
                connections: ['a','b','c','d'].map((id, i) => ({ from: i === 1 ? id : 'center', to: i === 1 ? 'center' : id,
                    name: 'Проход ' + id, kind: 'path', direction: i ? 'forward' : 'both', status: i === 2 ? 'uncertain' : i === 3 ? 'blocked' : 'confirmed', evidence: 'Fixture' })) };
            chat_metadata.bb_map_data = createSavedMap(normalizeGraphMapData(hub)); renderMapWidget();
        });
        for (const width of [1440, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            const geometry = await page.locator('.bb-map-widget-places').evaluate(field => {
                const rect = field.getBoundingClientRect();
                return { width: rect.width, height: rect.height, nodes: [...field.querySelectorAll('.bb-map-widget-place')].map(node => {
                    const r = node.getBoundingClientRect(); return { x: r.x - rect.x, y: r.y - rect.y, width: r.width, height: r.height };
                }) };
            });
            assert.equal(geometry.nodes.length, 5);
            assert.ok(geometry.height < 230);
            for (const node of geometry.nodes) {
                assert.ok(node.x >= 0 && node.y >= 0 && node.x + node.width <= geometry.width + 1 && node.y + node.height <= geometry.height + 1);
                assert.ok(node.width < 110 && node.height < 52);
            }
            assert.equal(await page.locator('.bb-map-widget-edge[data-connection-id]').count(), 4);
            assert.equal(await page.locator('.bb-map-widget-arrow').count(), 1);
            assert.equal(await page.locator('.bb-map-widget-arrow.is-blocked').count(), 0);
            assert.doesNotMatch(await page.locator('.bb-map-widget').innerText(), /Подтвержд|Confirmed/);
            if (process.argv[3]) await page.locator('.bb-map-widget').screenshot({ path: path.join(process.argv[3], 'mini-' + width + '.png') });
        }
        await page.evaluate(() => {
            globalThis.miniHub = chat_metadata.bb_map_data;
            const raw = structuredClone(miniHub.raw); raw.connections = raw.connections.slice(0,2);
            chat_metadata.bb_map_data = createSavedMap(raw); renderMapWidget();
        });
        assert.equal(await page.locator('.bb-map-widget-place').count(), 3);
        assert.equal(await page.locator('.bb-map-widget-arrow').count(), 1);
        if (process.argv[3]) await page.locator('.bb-map-widget').screenshot({ path: path.join(process.argv[3], 'mini-two.png') });
        await page.evaluate(() => { settings.uiLanguage = 'en'; renderMapWidget(); });
        await page.setViewportSize({ width: 1440, height: 1000 });
        assert.match(await page.locator('.bb-map-widget-open').innerText(), /OPEN MAP/i);
        assert.doesNotMatch(await page.locator('.bb-map-widget').innerText(), /Confirmed/);
        await page.evaluate(() => {
            const raw = structuredClone(miniHub.raw); raw.player_place_id = null;
            chat_metadata.bb_map_data = createSavedMap(raw); renderMapWidget();
        });
        assert.equal(await page.locator('.bb-map-widget-place').count(), 0);
        assert.match(await page.locator('.bb-map-widget').innerText(), /Position unknown/);
        assert.equal(await page.locator('.bb-map-widget-threat').innerText(), 'Position unknown');
        await page.evaluate(() => { settings.uiLanguage = 'ru'; chat_metadata.bb_map_data = miniHub; renderMapWidget(); });
        await page.locator('.bb-map-widget-place[data-place-id]').first().click();
        assert.match(await page.locator('.bb-topology-detail').innerText(), /Забрызганный гравий/);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => {
            removeMapOverlay(); settings.mapAnimations = true;
            const raw = structuredClone(miniHub.raw); raw.zones[1].threat_level = 'tension'; raw.zones[2].threat_level = 'danger';
            chat_metadata.bb_map_data = createSavedMap(raw); renderMapWidget();
        });
        assert.equal(await page.locator('.bb-map-widget-threat').innerText(), 'Безопасно');
        assert.equal(await page.locator('.bb-map-widget.bb-map-widget-safe').count(), 1);
        assert.equal(await page.locator('.bb-map-widget-place.is-changed').count(), 2);
        await page.evaluate(() => renderMapWidget());
        assert.equal(await page.locator('.bb-map-widget-place.is-changed').count(), 0);
        assert.equal(await page.locator('.bb-map-widget-current-label').innerText(), 'Вы здесь');
        const animation = locator => locator.evaluate(node => getComputedStyle(node).animationName);
        assert.equal(await animation(page.locator('.bb-map-widget-place.is-current').locator('span')), 'none');
        assert.equal(await page.locator('.bb-map-widget-place.is-current').evaluate(node => getComputedStyle(node, '::before').animationName), 'bb-map-breathe');
        assert.equal(await page.locator('.bb-map-widget-shape.is-tension').evaluate(node => getComputedStyle(node).stroke), 'rgb(216, 180, 106)');
        assert.equal(await page.locator('.bb-map-widget-shape.is-danger').evaluate(node => getComputedStyle(node).stroke), 'rgb(215, 125, 125)');
        for (const [level, duration] of [['safe','0s'], ['tension','6s'], ['danger','2s']]) {
            const shape = page.locator('.bb-map-widget-shape.is-' + level).first();
            assert.equal(await shape.evaluate(node => getComputedStyle(node).animationDuration), duration);
            assert.equal(await animation(shape), level === 'safe' ? 'none' : level === 'tension' ? 'bb-map-perimeter' : 'bb-map-alert');
            assert.equal(await shape.evaluate(node => getComputedStyle(node).strokeDasharray), level === 'tension' ? '6px, 5px' : 'none');
        }
        const perimeter = page.locator('.bb-map-widget-shape.is-tension');
        const perimeterOffset = await perimeter.evaluate(node => getComputedStyle(node).strokeDashoffset);
        await page.waitForFunction(before => getComputedStyle(document.querySelector('.bb-map-widget-shape.is-tension')).strokeDashoffset !== before, perimeterOffset, { timeout: 3000 });
        const neighbor = page.locator('.bb-map-widget-place[data-place-id]').first();
        await neighbor.hover();
        const flowing = page.locator('.bb-map-widget-edge.is-line.is-hover');
        assert.equal(await animation(flowing), 'bb-map-flow');
        const offset = await flowing.evaluate(node => getComputedStyle(node).strokeDashoffset);
        await page.waitForTimeout(180);
        assert.notEqual(await flowing.evaluate(node => getComputedStyle(node).strokeDashoffset), offset);
        await page.locator('.bb-map-widget-place.is-danger').hover();
        assert.equal(await page.locator('.bb-map-widget-edge.is-hover').count(), 0); // Incoming-only passage.
        await page.locator('.bb-map-widget-place[data-place-id]').nth(2).hover();
        assert.equal(await page.locator('.bb-map-widget-edge.is-hover').count(), 0); // Uncertain passage.
        await page.locator('.bb-map-widget-place[data-place-id]').nth(3).hover();
        assert.equal(await page.locator('.bb-map-widget-edge.is-hover').count(), 0); // Blocked passage.
        if (process.argv[3]) await page.locator('.bb-map-widget').screenshot({ path: path.join(process.argv[3], 'motion-mini.png') });
        await page.evaluate(() => { settings.mapAnimations = false; renderMapWidget(); });
        await page.locator('.bb-map-widget-place[data-place-id]').first().hover();
        assert.equal(await animation(page.locator('.bb-map-widget-edge.is-hover')), 'none');
        assert.equal(await page.locator('.bb-map-widget-place.is-current').evaluate(node => getComputedStyle(node, '::before').animationName), 'none');
        await page.evaluate(() => { settings.mapAnimations = true; renderMapWidget(); });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.locator('.bb-map-widget-place[data-place-id]').first().hover();
        assert.equal(await animation(page.locator('.bb-map-widget-edge.is-hover')), 'none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.locator('.bb-map-widget-place[data-place-id]').first().click();
        assert.equal(await animation(page.locator('.bb-topology-edge.is-line.is-route')), 'bb-map-flow');
        assert.equal(await animation(page.locator('.bb-topology-current')), 'bb-map-breathe');
        assert.equal(await page.locator('.bb-topology-arrow.is-route').count(), 1);
        assert.equal(await page.locator('.bb-topology-arrow.is-route').getAttribute('data-destination-id'), await page.locator('.bb-topology-place[aria-pressed="true"]').getAttribute('data-place-id'));
        assert.equal(await page.locator('.bb-topology-shape.is-danger').evaluate(node => getComputedStyle(node).stroke), 'rgb(215, 125, 125)');
        await page.evaluate(() => buildSettings(true));
        const toggle = page.locator('label').filter({ hasText: /^Анимации карты$/ }).locator('input[type="checkbox"]');
        await toggle.evaluate(node => { node.checked = false; node.dispatchEvent(new Event('change', { bubbles: true })); });
        assert.equal(await page.evaluate(() => settings.mapAnimations), false);
        assert.equal(await animation(page.locator('.bb-topology-edge.is-line.is-route')), 'none');
        assert.equal(await animation(page.locator('.bb-topology-shape.is-tension')), 'none');
        await toggle.evaluate(node => { node.checked = true; node.dispatchEvent(new Event('change', { bubbles: true })); });
        assert.equal(await animation(page.locator('.bb-topology-edge.is-line.is-route')), 'bb-map-flow');
        assert.equal(await animation(page.locator('.bb-topology-shape.is-tension')), 'bb-map-perimeter');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await animation(page.locator('.bb-topology-edge.is-line.is-route')), 'none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForTimeout(600);
        if (process.argv[3]) await page.locator('.bb-map-graph-modal').screenshot({ path: path.join(process.argv[3], 'motion-full.png') });
        // A second-hop zone appears on both maps with its intermediate passage preserved.
        await page.evaluate(() => {
            removeMapOverlay();
            const raw = normalizeGraphMapData({ layout: 'graph', scope: 'scene', schematic_name: 'Карантинный двор', player_place_id: 'sink',
                zones: [{ id: 'sink', name: 'Каменный умывальник', kind: 'area' }, { id: 'gravel', name: 'Забрызганный гравий', kind: 'outdoor', threat_level: 'tension' },
                    { id: 'cornice', name: 'Карниз веранды', kind: 'area' }, { id: 'kitchen', name: 'Кухонный переход', kind: 'passage' }],
                connections: [{ from: 'gravel', to: 'sink', name: 'Тропинка', kind: 'path', direction: 'both', status: 'confirmed', evidence: 'Fixture' },
                    { from: 'sink', to: 'cornice', name: 'Проём', kind: 'opening', direction: 'both', status: 'confirmed', evidence: 'Fixture' },
                    { from: 'gravel', to: 'kitchen', name: 'Проход', kind: 'passage', direction: 'both', status: 'confirmed', evidence: 'Fixture' }] });
            chat_metadata.bb_map_data = createSavedMap(raw); renderMapWidget();
        });
        for (const width of [1440, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            assert.equal(await page.locator('.bb-map-widget-place').count(), 4);
            assert.equal(await page.locator('.bb-map-widget-arrow').count(), 3);
            assert.match(await page.locator('.bb-map-widget-places').innerText(), /Кухонный переход/);
            if (width <= 600) {
                assert.equal(await page.locator('.bb-map-widget-launch').isVisible(), false);
                assert.equal(await page.locator('.bb-map-widget-content').isVisible(), true);
            } else await page.locator('.bb-map-widget-places').evaluate(field => {
                const current = field.querySelector('.is-current'), labels = [...field.querySelectorAll('.bb-map-widget-place')];
                for (const label of labels) if (label.scrollHeight > label.clientHeight + 1) throw Error('Mini label overflows');
                const box = current.getBoundingClientRect();
                for (const child of current.children) if (child.getBoundingClientRect().bottom > box.bottom - 2) throw Error('Current-place text is clipped');
                for (const arrow of field.querySelectorAll('.bb-map-widget-arrow')) {
                    const destination = labels.find(label => label.dataset.placeId === arrow.dataset.destinationId);
                    if (!destination || destination === current) throw Error('Arrow does not lead to a destination');
                }
            });
            if (process.argv[3]) await page.locator('.bb-map-widget').screenshot({ path: path.join(process.argv[3], 'kitchen-mini-' + width + '.png') });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator('.bb-map-widget-place').filter({ hasText: 'Кухонный переход' }).click();
        assert.equal(await page.locator('.bb-topology-arrow.is-route').count(), 2);
        assert.equal(await page.locator('.bb-topology-edge.is-line.is-route.is-reverse').count(), 1);
        assert.match(await page.locator('#bb-map-travel').innerText(), /Каменный умывальник → Забрызганный гравий → Кухонный переход/);
        assert.doesNotMatch(await page.locator('.bb-topology-detail').innerText(), /Каменный умывальник → Забрызганный гравий/);
        await page.locator('.bb-topology-field').evaluate(field => {
            const arrows = [...field.querySelectorAll('.bb-topology-arrow.is-route')];
            for (const arrow of arrows) {
                const line = field.querySelector('.is-line[data-connection-id="' + arrow.dataset.arrowFor + '"]');
                const coords = arrow.getAttribute('d').match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi).map(Number);
                const length = line.getTotalLength();
                const point = line.getPointAtLength(line.classList.contains('is-reverse') ? 0 : length);
                if (Math.hypot(coords[2] - point.x, coords[3] - point.y) > .1) throw Error('Arrow points against the route');
            }
        });
        assert.ok(await page.locator('#bb-map-travel').evaluate(node => node.getBoundingClientRect().height < 180), 'Travel stays compact at 320px');
        if (process.argv[3]) {
            await page.locator('#bb-map-travel').screenshot({ path: path.join(process.argv[3], 'travel-320.png') });
            await page.waitForTimeout(600);
            await page.locator('.bb-map-graph-modal').screenshot({ path: path.join(process.argv[3], 'kitchen-full.png') });
        }
        assert.deepEqual(errors, []);
        console.log('Graph providers, scopes, editor places/passages, widget, route drafts, ambiguity/auto-save, unknown position, stale chat and responsive checks passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
