// Production handlers and renderer, with isolated persistence/provider stubs.
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
        await page.setContent('<body style="background:#10151b;color:#e2e8f0"><textarea id="send_textarea"></textarea></body>');
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-topology-view.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'ru', showWidget: false } }, chat_metadata = { bb_map_mode: 'game' }, saves = 0, notices = [];
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata, name1: 'Player' };
            var SillyTavern = { getContext: () => context }, toastr = Object.fromEntries(['error','warning','success','info'].map(key => [key, text => notices.push(text)]));
            var saveChatDebounced = () => saves++;
            ${strip(read('index.js').split('jQuery(async () => {')[0])}
            injectCurrentMapContext = () => {}; renderMapWidget = () => {}; setupExtensionSettings = () => {};
            var sourceGraph = { layout: 'graph', scope: 'surroundings', schematic_name: 'Поместье Бабочки', player_place_id: 'hall', zones: [
                { id: 'hall', name: 'Тренировочный зал', kind: 'room', poi: ['Боккэн'], characters: [{ name: 'Ибуки' }] },
                { id: 'corridor', name: 'Галерея', kind: 'passage' }, { id: 'garden', name: 'Сад Бабочки', kind: 'outdoor' },
                { id: 'clinic', name: 'Лазарет', kind: 'room' }, { id: 'grove', name: 'Бамбуковая роща', kind: 'outdoor' },
                { id: 'shed', name: 'Запертый сарай', kind: 'room' }
            ], connections: [
                { from: 'hall', to: 'corridor', name: 'Дверь', kind: 'door', status: 'confirmed', evidence: 'Дверь открыта.' },
                { from: 'hall', to: 'garden', name: 'Сёдзи', kind: 'opening', status: 'confirmed', evidence: 'Сёдзи раздвинуты.' },
                { from: 'corridor', to: 'clinic', name: 'Ступени', kind: 'stairs', status: 'confirmed', direction: 'forward', evidence: 'Ступени ведут в лазарет.' },
                { from: 'garden', to: 'grove', name: 'Очень длинное название узкой тропинки между садом и бамбуковой рощей', kind: 'path', status: 'uncertain' },
                { from: 'garden', to: 'shed', name: 'Дверь сарая', kind: 'door', status: 'blocked', evidence: 'Дверь заперта.' }
            ] };
            var original = normalizeGraphMapData(sourceGraph); chat_metadata.bb_map_data = createSavedMap(original);
            var saved = chat_metadata.bb_map_data;
            showRadarModal(original, true);
        ` });
        await page.locator('.bb-topology-place').first().waitFor();
        await page.getByRole('button', { name: /Бамбуковая роща/ }).click();
        assert.match(await page.locator('.bb-topology-detail').innerText(), /Подтверждённого маршрута нет/);
        assert.match(await page.locator('.bb-topology-detail').innerText(), /Очень длинное название/);
        assert.equal(await page.locator('.bb-topology-edge-label').filter({ hasText: 'Очень длинное' }).count(), 0);
        await page.getByRole('button', { name: /Лазарет/ }).click();
        assert.match(await page.locator('.bb-topology-detail').innerText(), /Тренировочный зал → Галерея → Лазарет/);
        assert.ok(await page.locator('.bb-topology-edge.is-route').count() >= 2);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data === saved), true);
        for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.waitForTimeout(80);
            assert.ok(await page.locator('.bb-map-modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            await page.locator('.bb-topology-field').evaluate(field => {
                const boxes = [...field.querySelectorAll('button')].map(el => el.getBoundingClientRect());
                for (const label of field.querySelectorAll('.bb-topology-edge-label')) {
                    if (label.getComputedTextLength() + 16 > Number(label.dataset.span) + .1) throw Error('Label exceeds line');
                    if (Math.abs(Number(label.dataset.angle)) > 90) throw Error('Upside-down label');
                    const box = label.getBoundingClientRect();
                    if (boxes.some(b => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top)) throw Error('Label overlaps a place');
                }
            });
            if (process.argv[3]) { fs.mkdirSync(process.argv[3], { recursive: true }); await page.screenshot({ path: path.join(process.argv[3], `topology-${width}.png`) }); }
        }
        await page.evaluate(() => {
            settings.uiLanguage = 'en'; chat_metadata.bb_map_mode = 'classic'; showRadarModal(original, true);
        });
        assert.equal(await page.locator('.bb-map-effects').count(), 0);
        assert.match(await page.locator('.bb-map-header-container').innerText(), /Surroundings/);
        await page.getByRole('button', { name: /Бамбуковая роща/ }).click();
        assert.match(await page.locator('.bb-topology-detail').innerText(), /No confirmed route/);
        await page.keyboard.press('Escape'); assert.equal(await page.locator('#bb-map-overlay').count(), 0);
        await page.evaluate(() => {
            settings.uiLanguage = 'ru'; chat_metadata.bb_map_mode = 'game';
            candidate = normalizeGraphMapData({ ...sourceGraph, player_place_id: 'clinic', zones: sourceGraph.zones.map(zone => ({ ...zone, poi: zone.id === 'hall' ? [] : zone.id === 'garden' ? ['Боккэн'] : [] })),
                connections: sourceGraph.connections.map((edge, i) => i ? edge : { ...edge, status: 'blocked', evidence: 'Дверь закрыли.' }) }, original);
            showRadarModal(candidate, false);
        });
        assert.match(await page.locator('.bb-map-review').last().innerText(), /Проход · Дверь/);
        assert.match(await page.locator('.bb-map-review').last().innerText(), /Заблокирован/);
        assert.match(await page.locator('.bb-map-review').last().innerText(), /Перемещение.*Боккэн/s);
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => saves), 1);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.previous.raw === original), true);
        assert.equal(await page.evaluate(() => restorePreviousMap(chat_metadata.bb_map_data).raw === original), true);
        assert.match(await page.evaluate(() => getMapContextForCurrentChat()), /explicit player position/);
        assert.doesNotMatch(await page.evaluate(() => getMapContextForCurrentChat()), /center zone/);
        await page.evaluate(() => {
            const dangerous = normalizeGraphMapData({ ...sourceGraph, zones: sourceGraph.zones.map(zone => zone.id === 'hall' ? { ...zone, name: '<img src=x onerror="window.bad=true">' } : zone) }, original);
            showRadarModal(dangerous, false);
        });
        assert.equal(await page.locator('.bb-topology img').count(), 0);
        assert.equal(await page.evaluate(() => window.bad), undefined);
        await page.evaluate(() => { context = { ...context, chatId: 'two', chatMetadata: {} }; });
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => saves), 1);
        assert.match(await page.evaluate(() => notices.at(-1)), /изменились/);
        await page.getByRole('button', { name: 'ЗАКРЫТЬ КАРТУ', exact: true }).click();
        assert.equal(await page.evaluate(() => mapTopologyView), null);
        assert.deepEqual(errors, []);
        console.log('Graph rendering, selection, routes, labels, RU/EN, preview, save/rollback, stale chat, XSS and responsive checks passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
