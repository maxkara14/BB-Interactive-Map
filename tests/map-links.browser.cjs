// Isolated rendering test; persistence and generation are stubbed.
// node tests/map-links.browser.cjs [Playwright module path] [screenshots directory]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const state = read('map-state.js').replace(/^export /gm, '');
const links = read('map-links.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const topology = read('map-topology-view.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const source = read('index.js').replace(/^import .*;\r?\n/gm, '');
const events = fs.readFileSync(path.resolve(root, '../../../../scripts/events.js'), 'utf8')
    .match(/export const event_types = (\{[\s\S]*?\r?\n\});/)[1];

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.setContent(`<body style="margin:0;background:#111820;color:#dce3ec;font:16px/1.8 'Segoe UI',sans-serif">
            <main id="chat" style="width:min(740px,calc(100% - 32px));margin:70px auto">
            <small style="color:#8293a5">ПОМЕСТЬЕ · ВЕЧЕР</small>
            <article class="mes" style="background:#1b242e;padding:24px;border-radius:12px;margin-top:12px">
            <b style="color:#8d9ead">Персонаж</b><div class="mes_text">
            <p>Мира подняла Медный ключ и посмотрела на Хозяйственный двор.</p>
            <p>У стены лежал <em>Колун</em>. Ключ и ключик остались в стороне.</p>
            <p><code>Мира</code> · <a href="#">Мира</a></p><pre>Медный ключ</pre>
            <textarea aria-label="Редактор">Мира</textarea><button>Медный ключ</button><span contenteditable="true">Колун</span>
            </div></article></main><div id="extensions_settings" hidden></div></body>`);
        const initialText = await page.locator('.mes_text').textContent();
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${state}\n${links}\n${topology}
            var event_types = ${events};
            var handlers = new Map();
            var eventSource = { on: (name, callback) => handlers.set(name, [...(handlers.get(name) || []), callback]) };
            var emit = async name => { for (const callback of handlers.get(event_types[name]) || []) await callback(); };
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'ru', showWidget: false, highlightMentions: true } };
            var chat_metadata = {};
            var originalMessages = Object.freeze([Object.freeze({ mes: 'Мира подняла Медный ключ.' })]);
            document.querySelector('code').replaceChildren(document.createTextNode('Ми'), document.createTextNode('ра'));
            var codeTail = document.querySelector('code').lastChild;
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata, chat: originalMessages, eventSource, event_types };
            var SillyTavern = { getContext: () => context };
            var writes = 0, requests = 0;
            var saveChatDebounced = () => { writes++; };
            var saveChatConditional = async () => { writes++; };
            var saveSettingsDebounced = () => {};
            var extension_prompt_types = { IN_CHAT: 0 }, extension_prompt_roles = { USER: 0 };
            var setExtensionPrompt = () => {};
            var isChatSaving = false;
            var generateQuietPrompt = async () => { requests++; throw Error('No requests allowed'); };
            var startMap;
            var jQuery = callback => { startMap = callback; };
            var rawMap = normalizeMapData({ schematic_name: 'Поместье', zones: [
                { position: 'center', name: 'Хозяйственный двор', summary: 'Тихий задний двор.', poi: [
                    { name: 'Медный ключ', description: 'Потёртый ключ из меди. На кольце сохранилась синяя лента.' }, 'Ключ',
                    { name: 'Колун', description: 'Тяжёлый топор для раскалывания дров.' }],
                    characters: [{ name: 'Мира', description: '<img src=x onerror="window.bad=true">', mood: 'Насторожена', attitude: 'Доверяет игроку' }] },
                { position: 'north', name: 'Зал', poi: ['Ключ'] }
            ] });
            chat_metadata.bb_map_data = createSavedMap(rawMap);
            ${source}
        ` });
        await page.evaluate(async () => { await startMap(); await emit('APP_READY'); });
        const mentions = page.locator('[data-bb-map-mention]');
        await page.waitForFunction(() => document.querySelectorAll('[data-bb-map-mention]').length === 4);
        assert.equal(await page.locator('pre [data-bb-map-mention], code [data-bb-map-mention], a [data-bb-map-mention], button [data-bb-map-mention], [contenteditable] [data-bb-map-mention]').count(), 0);
        assert.equal(await page.locator('.mes_text').textContent(), initialText);
        await page.locator('.mes_text p').first().evaluate(element => element.setAttribute('contenteditable', 'true'));
        await page.waitForFunction(() => document.querySelectorAll('[data-bb-map-mention]').length === 1);
        await page.locator('.mes_text p').first().evaluate(element => element.removeAttribute('contenteditable'));
        await page.waitForFunction(() => document.querySelectorAll('[data-bb-map-mention]').length === 4);
        await page.getByRole('button', { name: 'Предмет: Медный ключ', exact: true }).click();
        assert.match(await page.locator('#bb-map-mention-card').innerText(), /По сохранённой карте/);
        const screenshots = process.argv[3];
        if (screenshots) {
            fs.mkdirSync(screenshots, { recursive: true });
            await page.screenshot({ path: path.join(screenshots, 'map-mentions-desktop.png') });
        }
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Персонаж: Мира', exact: true }).focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#bb-map-mention-card img').count(), 0);
        assert.equal(await page.evaluate(() => window.bad), undefined);
        assert.match(await page.locator('#bb-map-mention-card').innerText(), /Доверяет игроку/);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('button', { name: 'Персонаж: Мира', exact: true }).evaluate(element => element === document.activeElement), true);
        await page.getByRole('button', { name: 'Зона: Хозяйственный двор', exact: true }).click();
        await page.getByRole('button', { name: 'Открыть карту ↗', exact: true }).click();
        await page.locator('#bb-map-overlay').waitFor();
        await page.locator('#bb-map-back-btn').click();
        await page.locator('#bb-map-overlay').waitFor({ state: 'detached' });

        await page.evaluate(async () => {
            const article = document.createElement('article');
            article.innerHTML = '<div class="mes_text" id="new-reply">Мира вошла в Зал.</div>';
            document.getElementById('chat').append(article);
            await emit('CHARACTER_MESSAGE_RENDERED');
        });
        await page.waitForFunction(() => document.querySelectorAll('#new-reply [data-bb-map-mention]').length === 2);
        assert.equal(await page.locator('[data-bb-map-mention] [data-bb-map-mention]').count(), 0);
        await page.evaluate(() => { renderMapWidget(); renderMapWidget(); });
        assert.equal(await mentions.count(), 6);

        await page.evaluate(() => {
            const draft = JSON.parse(JSON.stringify(rawMap));
            const key = draft.zones[0].poi.shift();
            draft.zones[1].poi.push(key);
            chat_metadata.bb_map_data = createSavedMap(normalizeMapData(draft, rawMap));
            renderMapWidget();
        });
        await page.waitForFunction(() => document.querySelector('[data-bb-map-mention="медный ключ"]'));
        await page.getByRole('button', { name: 'Предмет: Медный ключ', exact: true }).click();
        assert.match(await page.locator('.bb-map-mention-location').innerText(), /Зал/);
        await page.evaluate(async () => {
            document.getElementById('new-reply').innerHTML = 'Колун остался в <em data-other-extension="formatting">Зал</em>.';
            await emit('MESSAGE_UPDATED');
        });
        await page.waitForFunction(() => document.querySelectorAll('#new-reply [data-bb-map-mention]').length === 2);
        assert.equal(await page.locator('[data-other-extension] [data-bb-map-mention]').count(), 1);
        const toggle = async checked => page.evaluate(checked => {
            const input = [...document.querySelectorAll('.checkbox_label')].find(label => label.textContent.includes('Подсвечивать упоминания')).querySelector('input');
            input.checked = checked;
            input.dispatchEvent(new Event('change'));
        }, checked);
        await toggle(false);
        await page.waitForFunction(() => document.querySelectorAll('[data-bb-map-mention]').length === 0);
        assert.equal(await page.locator('.mes_text').first().textContent(), initialText);
        assert.equal(await page.evaluate(() => document.querySelector('code').lastChild === codeTail), true);
        assert.equal(await page.locator('[data-other-extension]').textContent(), 'Зал');
        await toggle(true);
        await page.waitForFunction(() => document.querySelectorAll('[data-bb-map-mention]').length === 6);
        await page.evaluate(async () => { context = { ...context, chatId: 'two' }; delete chat_metadata.bb_map_data; await emit('CHAT_CHANGED'); });
        await page.waitForFunction(() => document.querySelectorAll('[data-bb-map-mention]').length === 0);

        await page.evaluate(() => {
            settings.uiLanguage = 'en';
            chat_metadata.bb_map_data = createSavedMap(rawMap);
            renderMapWidget();
        });
        await page.waitForFunction(() => document.querySelectorAll('[data-bb-map-mention]').length === 6);
        for (const width of [768, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await page.getByRole('button', { name: 'Object: Медный ключ', exact: true }).click();
            assert.match(await page.locator('#bb-map-mention-card').innerText(), /From the saved map/);
            const bounds = await page.locator('#bb-map-mention-card').evaluate(element => {
                const bounds = element.getBoundingClientRect();
                return { left: bounds.left, right: bounds.right, bottom: bounds.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
            });
            assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.bottom <= 844);
            assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1);
            if (width === 768) await page.keyboard.press('Escape');
        }
        if (screenshots) await page.screenshot({ path: path.join(screenshots, 'map-mentions-mobile.png') });
        await page.evaluate(() => {
            chat_metadata.bb_map_data = createSavedMap(normalizeMapData({ schematic_name: 'Додзё', zones: [
                { position: 'center', name: 'Зал', poi: ['Кедровые половицы'], characters: [
                    { name: 'Ибуки Куробати' }, { name: 'Танджиро Камадо' }, { name: 'Аой Кандзаки' },
                ] },
            ] }));
            document.getElementById('new-reply').textContent = 'ТанджироㅤИбукиㅤАой-сан. ИбукиㅤКуробати. Кедровыеㅤполовицы.';
            renderMapWidget();
        });
        await page.waitForFunction(() => document.querySelectorAll('#new-reply [data-bb-map-mention]').length === 4);
        assert.equal(await page.locator('#new-reply').textContent(), 'ТанджироㅤИбукиㅤАой-сан. ИбукиㅤКуробати. Кедровыеㅤполовицы.');
        await page.getByRole('button', { name: 'Character: Аой Кандзаки', exact: true }).click();
        assert.match(await page.locator('#bb-map-mention-card').innerText(), /Аой Кандзаки/);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('button', { name: 'Character: Ибуки Куробати', exact: true }).count(), 1);
        await page.evaluate(() => {
            document.getElementById('new-reply').innerHTML = '<p>Аой Кандзаки взяла Кедровые половицы.</p><p><em>Аой</em> и <b>Кандзаки</b>. АОЙ-сан. Кедровыеㅤполовицы.</p>';
            const message = document.createElement('article');
            message.className = 'mes';
            message.innerHTML = '<div class="mes_text" id="user-reply"><p>Кандзаки. Аой Кандзаки.</p><p>Кедровые половицы. Кедровые половицы.</p></div>';
            document.getElementById('chat').append(message);
            chatMapLinks.refresh();
        });
        await page.waitForFunction(() => document.querySelectorAll('#new-reply [data-bb-map-mention]').length === 2
            && document.querySelectorAll('#user-reply [data-bb-map-mention]').length === 2);
        assert.equal(await page.locator('#new-reply [data-bb-map-mention]').first().textContent(), 'Аой Кандзаки');
        assert.equal(await page.locator('#user-reply [data-bb-map-mention]').first().textContent(), 'Кандзаки');
        assert.equal(await page.locator('#new-reply em').textContent(), 'Аой');
        await page.locator('#new-reply [data-bb-map-mention]').first().click();
        assert.match(await page.locator('#bb-map-mention-card').innerText(), /Аой Кандзаки/);
        await page.keyboard.press('Escape');
        await page.evaluate(() => { chatMapLinks.refresh(); chatMapLinks.refresh(); });
        await page.waitForTimeout(250);
        assert.equal(await page.locator('#new-reply [data-bb-map-mention]').count(), 2);
        assert.equal(await page.locator('#user-reply [data-bb-map-mention]').count(), 2);
        await page.evaluate(() => {
            const graph = normalizeGraphMapData({ layout: 'graph', scope: 'scene', schematic_name: 'Додзё', player_place_id: 'hall', zones: [
                { id: 'hall', name: 'Зал', kind: 'room' }, { id: 'garden', name: 'Сад', kind: 'outdoor', characters: [{ name: 'Аой Кандзаки' }], poi: ['Кедровые половицы'] }
            ], connections: [{ from: 'hall', to: 'garden', name: 'Дверь', kind: 'door', status: 'confirmed', evidence: 'Дверь открыта.' }] });
            chat_metadata.bb_map_data = createSavedMap(graph); renderMapWidget();
        });
        await page.locator('#new-reply [data-bb-map-mention]').first().click();
        assert.match(await page.locator('.bb-map-mention-location').innerText(), /Сад/);
        assert.doesNotMatch(await page.locator('.bb-map-mention-location').innerText(), /undefined|bbp-/);
        await page.locator('.bb-map-mention-open').click();
        assert.equal(await page.locator('.bb-topology-place[aria-pressed="true"]').getAttribute('title'), 'Сад');
        await page.keyboard.press('Escape');
        await page.evaluate(() => chatMapLinks.destroy());
        assert.equal(await mentions.count(), 0);
        assert.equal(await page.locator('.mes_text').first().textContent(), initialText);
        assert.equal(await page.evaluate(() => writes), 0);
        assert.equal(await page.evaluate(() => requests), 0);
        assert.equal(await page.evaluate(() => originalMessages[0].mes), 'Мира подняла Медный ключ.');
        assert.deepEqual(errors, []);
        console.log('Mentions, exclusions, cards, keyboard, map updates, rendered replies, disabling, chat switching, escaping, RU/EN, and mobile layout passed; no message writes or model requests.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
