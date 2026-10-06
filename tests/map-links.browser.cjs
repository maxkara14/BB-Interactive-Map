// Isolated rendering test; persistence and generation are stubbed.
// node tests/map-links.browser.cjs [Playwright module path] [screenshots directory]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const state = read('map-state.js').replace(/^export /gm, '');
const links = read('map-object-mentions.js').replace(/^export /gm, '') + '\n'
    + read('map-links.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const topology = read('map-topology-view.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const source = read('index.js').replace(/^import .*;\r?\n/gm, '');
const keyboard = fs.readFileSync(path.resolve(root, '../../../../scripts/keyboard.js'), 'utf8').replace(/^export /gm, '');
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

        // A collapsed CSS scene-state widget contains the same names as the narrative.
        await page.evaluate(() => {
            chat_metadata.bb_map_data = createSavedMap(normalizeGraphMapData({ layout: 'graph', scope: 'scene',
                schematic_name: 'Класс', player_place_id: 'class', zones: [{ id: 'class', name: 'Класс', kind: 'room',
                    characters: ['Рин', 'Кёдзиро Ренгоку', 'Аой Канзаки', 'Юи Хошикава', 'Канао Цуюри', 'Нэзуко Камадо',
                        'Две спорящие ученицы', 'Неустановленный ученик с заднего ряда'].map(name => ({ name })),
                    poi: ['Доска', 'Учительский стол', 'Парты и проход между рядами', 'Школьное окно'] }], connections: [] }));
            document.getElementById('new-reply').innerHTML = `<style>
                .test-scene-body { display:grid; grid-template-rows:0fr; opacity:0; }
                .test-scene-body > div { overflow:hidden; }
                .test-scene:has(input:checked) .test-scene-body { grid-template-rows:1fr; opacity:1; }
                </style><div class="test-scene"><label><input id="scene-toggle" type="checkbox">Состояние сцены</label>
                <div class="test-scene-body"><div>Рин. Кёдзиро Ренгоку. Аой Канзаки. Юи Хошикава. Канао Цуюри. Нэзуко Камадо. Доска. Учительский стол.</div></div></div>
                <div style="display:none">Рин. Учительский стол.</div><div style="visibility:hidden">Аой Канзаки.</div>
                <details><summary>Закрытая сводка</summary>Юи Хошикава.</details>
                <p id="scene-narrative">Две девочки с заднего ряда. Рин. Кёдзиро Ренгоку. Аой Канзаки. Юи Хошикава. Канао Цуюри. Нэзуко Камадо. Доска. Учительский стол. Ренгоку.</p>`;
            renderMapWidget();
        });
        await page.waitForFunction(() => document.querySelectorAll('#scene-narrative [data-bb-map-mention]').length === 8);
        assert.equal(await page.locator('.test-scene-body [data-bb-map-mention]').count(), 0);
        assert.equal(await page.locator('#new-reply [data-bb-map-mention="две"], #new-reply [data-bb-map-mention="ряда"]').count(), 0);
        await page.locator('#scene-toggle').check();
        await page.waitForFunction(() => document.querySelectorAll('.test-scene-body [data-bb-map-mention]').length === 8);
        assert.equal(await page.locator('#scene-narrative [data-bb-map-mention]').count(), 0);
        await page.locator('#scene-toggle').uncheck();
        await page.waitForFunction(() => document.querySelectorAll('#scene-narrative [data-bb-map-mention]').length === 8);

        // A real touch context, with an unrelated retained selection and a child click handler.
        const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const touchPage = await phone.newPage();
        touchPage.on('pageerror', error => errors.push(error.message));
        await touchPage.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="sheld"><div id="chat" style="height:400px"><div class="mes_text"><p id="selected">Ранее выделенный текст</p><p id="touch-message">Аой Канзаки взяла Медный ключ.</p></div></div></div></body>');
        await touchPage.addStyleTag({ content: fs.readFileSync(path.resolve(root, '../../../../style.css'), 'utf8').replace(/^@import .*;$/gm, '') });
        await touchPage.addStyleTag({ content: fs.readFileSync(path.resolve(root, '../../../../css/mobile-styles.css'), 'utf8') });
        // Real Tavern has a zero-height transformed root above its fixed mobile body.
        await touchPage.addStyleTag({ content: 'html { height:0; transform:translateZ(0); } body { position:fixed; }' });
        await touchPage.addStyleTag({ content: read('style.css') });
        await touchPage.addScriptTag({ content: `${state}\n${links}\n
            let raw = { zones: [{ name:'Класс 1-Б академии Кимэцу', characters:[{name:'Аой Канзаки',
                description:'Ученица в форме с испачканными чернилами пальцами; прячет руку под партой и держит сломанную ручку.',
                mood:'Растерянная и смущенная', attitude:'Пытается преуменьшить значение письма и остановить обострение.'}], poi:['Медный ключ'] }] };
            const controller = createChatMapLinks({ getMap:()=>raw, isEnabled:()=>true,
                getLabels:()=>({language:'en', types:{character:'Character', object:'Object', zone:'Zone'}, close:'Close',
                    noDescription:'No description', position:()=>'', mood:'Состояние', attitude:'Отношение', source:'По сохранённой карте', openMap:'Открыть карту ↗'}), onOpenMap:()=>{} });
            controller.refresh();
            document.getElementById('touch-message').addEventListener('click', event=>event.stopPropagation());
        ` });
        await touchPage.locator('[data-bb-map-mention]').first().waitFor();
        await touchPage.evaluate(() => {
            const range = document.createRange(); range.selectNodeContents(document.getElementById('selected'));
            getSelection().removeAllRanges(); getSelection().addRange(range);
            document.querySelector('[data-bb-map-mention]').click();
        });
        assert.match(await touchPage.locator('#bb-map-mention-card').innerText(), /Аой Канзаки/);
        await touchPage.locator('.bb-map-mention-close').tap();
        await touchPage.evaluate(() => getSelection().removeAllRanges());
        await touchPage.locator('[data-bb-map-mention]').first().tap();
        await touchPage.waitForTimeout(300);
        assert.match(await touchPage.locator('#bb-map-mention-card').innerText(), /Аой Канзаки/);
        const initialCardBounds = await touchPage.locator('#bb-map-mention-card').boundingBox();
        const initialMentionBounds = await touchPage.locator('[data-bb-map-mention]').first().boundingBox();
        assert.ok(initialCardBounds.width <= 260, 'Mobile cards must remain narrow');
        assert.ok(Math.abs(initialCardBounds.y - initialMentionBounds.y - initialMentionBounds.height - 8) < 1,
            'With room below, the mobile card must open directly under the mention');
        assert.ok(initialCardBounds.y >= 0 && initialCardBounds.y + initialCardBounds.height <= 844,
            `Touch-opened card must be visible with Tavern's zero-height root: ${JSON.stringify(initialCardBounds)}`);
        if (screenshots) await touchPage.screenshot({ path: path.join(screenshots, 'map-mention-compact-phone.png') });
        await touchPage.locator('.bb-map-mention-close').tap();

        await touchPage.evaluate(() => {
            document.getElementById('touch-message').style.cssText = 'position:fixed;top:730px;left:200px;width:180px';
        });
        await touchPage.locator('[data-bb-map-mention]').first().tap();
        const edgeCardBounds = await touchPage.locator('#bb-map-mention-card').boundingBox();
        const edgeMentionBounds = await touchPage.locator('[data-bb-map-mention]').first().boundingBox();
        assert.ok(edgeCardBounds.y + edgeCardBounds.height <= edgeMentionBounds.y - 7,
            'Near the bottom, the mobile card must open above the mention');
        assert.ok(edgeCardBounds.x >= 8 && edgeCardBounds.x + edgeCardBounds.width <= 382,
            'Near the right edge, the mobile card must stay inside the screen');
        await touchPage.locator('.bb-map-mention-close').tap();
        await touchPage.evaluate(() => document.getElementById('touch-message').removeAttribute('style'));
        await touchPage.waitForTimeout(100);

        // Tavern resets menu scroll when focus leaves a scroll-reset-container.
        await touchPage.evaluate(() => {
            const menu = document.createElement('div');
            menu.id = 'test-tavern-menu'; menu.className = 'scroll-reset-container';
            menu.style.cssText = 'height:35px;overflow:auto';
            menu.innerHTML = '<div style="height:200px"><button id="test-menu-focus">Menu</button></div>';
            document.body.append(menu);
        });
        await touchPage.addScriptTag({ content: `${keyboard}\ninitKeyboard();` });
        await touchPage.evaluate(() => {
            const menu = document.getElementById('test-tavern-menu');
            document.getElementById('test-menu-focus').focus(); menu.scrollTop = 100;
        });
        await touchPage.waitForTimeout(100);
        await touchPage.evaluate(() => document.querySelector('[data-bb-map-mention]').click());
        await touchPage.waitForTimeout(300);
        assert.equal(await touchPage.locator('#bb-map-mention-card').count(), 1, 'Tavern menu focus reset must not dismiss the card');
        await touchPage.evaluate(() => {
            document.getElementById('test-tavern-menu').dispatchEvent(new Event('scroll'));
        });
        assert.equal(await touchPage.locator('#bb-map-mention-card').count(), 1, 'Unrelated menu scrolling must not dismiss the card');
        await touchPage.setViewportSize({ width: 390, height: 640 });
        assert.equal(await touchPage.locator('#bb-map-mention-card').count(), 1, 'Mobile keyboard viewport changes must preserve the card');
        const cardBounds = await touchPage.locator('#bb-map-mention-card').boundingBox();
        assert.ok(cardBounds.x >= 0 && cardBounds.x + cardBounds.width <= 390 && cardBounds.y >= 0 && cardBounds.y + cardBounds.height <= 640,
            `Card must be inside the mobile screen: ${JSON.stringify(cardBounds)}`);
        await touchPage.evaluate(() => document.getElementById('chat').dispatchEvent(new Event('scroll')));
        assert.equal(await touchPage.locator('#bb-map-mention-card').count(), 0, 'Scrolling the message must still dismiss the card');
        await touchPage.locator('[data-bb-map-mention]').first().focus();
        await touchPage.keyboard.press('Enter');
        assert.equal(await touchPage.locator('.bb-map-mention-close').evaluate(element => element === document.activeElement), true);
        await touchPage.waitForTimeout(100);
        assert.equal(await touchPage.locator('#bb-map-mention-card').count(), 1, 'Keyboard activation remains available with Tavern handlers');
        await touchPage.locator('.bb-map-mention-close').tap();
        await touchPage.evaluate(() => {
            const range = document.createRange(); range.selectNodeContents(document.querySelector('[data-bb-map-mention]'));
            getSelection().removeAllRanges(); getSelection().addRange(range);
            document.querySelector('[data-bb-map-mention]').click();
        });
        assert.equal(await touchPage.locator('#bb-map-mention-card').count(), 0, 'Selecting a mention must not open its card');
        await touchPage.evaluate(() => {
            getSelection().removeAllRanges();
            document.getElementById('touch-message').textContent = 'Она открыла дверь медным ключом. Ключ, медного ключа.';
        });
        await touchPage.waitForFunction(() => document.querySelectorAll('#touch-message [data-bb-map-mention]').length === 1);
        assert.equal(await touchPage.locator('#touch-message [data-bb-map-mention]').textContent(), 'медным ключом');
        await touchPage.locator('#touch-message [data-bb-map-mention]').tap();
        assert.equal(await touchPage.locator('#bb-map-mention-title').textContent(), 'Медный ключ');
        await touchPage.locator('.bb-map-mention-close').tap();
        await touchPage.evaluate(() => {
            raw = { ...raw, zones: [{ ...raw.zones[0], poi: ['Медный ключ', 'Железный ключ'] }] };
            document.getElementById('touch-message').textContent = 'Ключом. Медного ключа. Железным ключом.';
            controller.refresh();
        });
        await touchPage.waitForFunction(() => document.querySelectorAll('#touch-message [data-bb-map-mention]').length === 2);
        assert.deepEqual(await touchPage.locator('#touch-message [data-bb-map-mention]').allTextContents(), ['Медного ключа', 'Железным ключом']);
        await touchPage.locator('#touch-message [data-bb-map-mention]').last().tap();
        assert.equal(await touchPage.locator('#bb-map-mention-title').textContent(), 'Железный ключ');
        await phone.close();
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
