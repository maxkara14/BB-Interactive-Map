// Run explicitly with Playwright available: node tests/map-review.browser.cjs [module path] [screenshots directory].
// This isolated page stubs persistence and never opens or saves a SillyTavern chat.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const state = fs.readFileSync(path.join(root, 'map-state.js'), 'utf8').replace(/^export /gm, '');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const setup = source.slice(0, source.indexOf('jQuery(async () => {')).replace(/^import .*;\r?\n/gm, '');

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<body style="margin:0;background:#10151b;color:#e2e8f0"></body>');
        await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'style.css'), 'utf8') });
        await page.addScriptTag({ content: `${state}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'ru', showWidget: false } };
            var chat_metadata = {};
            var saves = 0;
            var notices = [];
            var context = { chatId: 'test', characterId: 1, groupId: null, chatMetadata: chat_metadata, name1: 'Player' };
            var SillyTavern = { getContext: () => context };
            var toastr = { error: message => notices.push(message), success: () => {} };
            var saveChatDebounced = () => { saves++; };
            ${setup}
            injectCurrentMapContext = () => {};
            renderMapWidget = () => {};
            setupExtensionSettings = () => {};
            var oldMap = normalizeMapData({ schematic_name: 'Поместье', atmosphere: 'Утро', zones: [
                { position: 'center', name: 'Двор', poi: ['Ключ'], characters: [{ name: 'Мира', mood: 'Спокойна' }] },
                { position: 'north', name: 'Зал' }
            ] });
            chat_metadata.bb_map_data = createSavedMap(oldMap);
            var candidate = normalizeMapData({ schematic_name: 'Поместье', atmosphere: 'Ночь', zones: [
                { position: 'center', name: 'Двор', threat_level: 'danger', threat_reason: 'Пожар' },
                { position: 'north', name: 'Зал', poi: ['Ключ'], characters: [{ name: 'Мира', mood: 'Насторожена' }] }
            ] }, oldMap);
            autoCandidate = candidate;
            showRadarModal(candidate, false, context, chat_metadata.bb_map_data);
        ` });
        await page.locator('.bb-map-review').waitFor();
        assert.match(await page.locator('.bb-map-review').innerText(), /Перемещение/);
        const screenshots = process.argv[3];
        for (const width of [1440, 768, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            const fits = await page.locator('.bb-map-modal').evaluate(element => element.scrollWidth <= element.clientWidth + 1);
            assert.ok(fits, `Preview overflows at ${width}px`);
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        if (screenshots) {
            fs.mkdirSync(screenshots, { recursive: true });
            await page.locator('.bb-map-modal').evaluate(element => { element.scrollTop = element.scrollHeight; });
            await page.screenshot({ path: path.join(screenshots, 'map-review-desktop.png') });
        }
        await page.locator('#bb-map-edit-btn').click();
        await page.locator('.bb-map-edit-fields [name="schematic_name"]').fill('Исправленное поместье');
        await page.locator('.bb-map-edit-zone').nth(1).locator('summary').click();
        const mira = page.locator('[data-entity-type="character"]');
        await mira.locator('[name="destination"]').selectOption('0');
        await page.locator('[data-entity-type="object"] .bb-map-edit-remove').click();
        await page.locator('.bb-map-edit-zone').nth(0).getByRole('button', { name: '+ Предмет', exact: true }).click();
        await page.getByRole('button', { name: 'ПРОВЕРИТЬ ПРАВКИ', exact: true }).click();
        assert.equal(await page.locator('.bb-map-editor').count(), 1);
        assert.equal(await page.evaluate(() => saves), 0);
        await page.locator('[data-entity-type="object"] [name="name"]').fill('<img src=x onerror="window.bad=true">');
        await page.getByRole('button', { name: 'ПРОВЕРИТЬ ПРАВКИ', exact: true }).click();
        assert.equal(await page.evaluate(() => saves), 0);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.schematic_name), 'Поместье');
        assert.equal(await page.evaluate(() => autoCandidate.schematic_name), 'Исправленное поместье');
        assert.equal(await page.locator('.bb-map-review img').count(), 0);
        assert.equal(await page.evaluate(() => window.bad), undefined);
        await page.locator('#bb-map-save-btn').click();
        const saved = await page.evaluate(() => ({ saves, raw: chat_metadata.bb_map_data.raw, previous: chat_metadata.bb_map_data.previous.raw }));
        assert.equal(saved.saves, 1);
        assert.equal(saved.raw.schematic_name, 'Исправленное поместье');
        assert.equal(saved.raw.zones[0].characters[0].name, 'Мира');
        assert.equal(saved.raw.zones[1].poi.length, 0);
        assert.equal(saved.previous.schematic_name, 'Поместье');

        await page.evaluate(() => showRadarModal(chat_metadata.bb_map_data.raw, true, context, chat_metadata.bb_map_data));
        await page.locator('#bb-map-edit-btn').click();
        await page.locator('.bb-map-edit-fields [name="schematic_name"]').fill('Несохранённое');
        await page.getByRole('button', { name: 'ОТМЕНИТЬ ПРАВКИ', exact: true }).click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.schematic_name), 'Исправленное поместье');
        assert.equal(await page.evaluate(() => saves), 1);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#bb-map-edit-btn').click();
        const bounds = await page.locator('.bb-map-modal').evaluate(element => ({
            left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
            scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
        }));
        assert.ok(bounds.left >= 0 && bounds.right <= 390);
        assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1);
        if (screenshots) await page.screenshot({ path: path.join(screenshots, 'map-editor-mobile.png') });
        await page.evaluate(() => { context = { ...context, chatId: 'another' }; });
        await page.getByRole('button', { name: 'ПРОВЕРИТЬ ПРАВКИ', exact: true }).click();
        assert.match(await page.locator('.bb-map-edit-error').innerText(), /Чат или сохранённая карта изменились/);
        assert.equal(await page.evaluate(() => saves), 1);
        await page.evaluate(() => {
            context = { ...context, chatId: 'test' };
            settings.uiLanguage = 'en';
            showRadarModal(chat_metadata.bb_map_data.raw, false, context, chat_metadata.bb_map_data);
        });
        assert.match(await page.locator('.bb-map-review').innerText(), /No changes/);
        await page.locator('#bb-map-edit-btn').click();
        assert.equal(await page.getByRole('button', { name: 'PREVIEW EDITS', exact: true }).count(), 1);
        await page.evaluate(() => { chat_metadata.bb_map_data = createSavedMap(oldMap); });
        await page.getByRole('button', { name: 'PREVIEW EDITS', exact: true }).click();
        assert.match(await page.locator('.bb-map-edit-error').innerText(), /The chat or saved map changed/);
        assert.equal(await page.evaluate(() => saves), 1);
        assert.deepEqual(errors, []);
        console.log('Review, edits, preview, save, rollback snapshot, cancel, chat guard, escaping, and mobile layout passed.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
