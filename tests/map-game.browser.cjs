// Isolated production handlers: no real chats, persistence or model requests.
// node tests/map-game.browser.cjs [Playwright module path] [screenshots directory]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const strip = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const events = fs.readFileSync(path.resolve(root, '../../../../scripts/events.js'), 'utf8')
    .match(/export const event_types = (\{[\s\S]*?\r?\n\});/)[1];

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<body style="margin:0;background:#10151b;color:#e2e8f0"><div id="chat"></div><div id="extensions_settings"></div><textarea id="send_textarea"></textarea></body>');
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-links.js'))}
            var event_types = ${events};
            var handlers = new Map(), macros = new Map();
            var eventSource = { on: (name, callback) => handlers.set(name, [...(handlers.get(name) || []), callback]) };
            var emit = async (name, ...args) => { for (const callback of handlers.get(event_types[name]) || []) await callback(...args); };
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'ru', showWidget: false } };
            var originalMessages = Object.freeze([Object.freeze({ name: 'Player', mes: 'I am in the hall.' })]);
            var chat_metadata = {};
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata, chat: originalMessages,
                eventSource, event_types, registerMacro: (name, callback) => macros.set(name, callback) };
            var SillyTavern = { getContext: () => context };
            var writes = 0, requests = 0, inputEvents = 0, notices = [], injected = '';
            var saveChatDebounced = () => { writes++; }, saveChatConditional = async () => { writes++; };
            var saveSettingsDebounced = () => {};
            var extension_prompt_types = { IN_CHAT: 0 }, extension_prompt_roles = { USER: 0 };
            var setExtensionPrompt = (name, value) => { injected = value; };
            var isChatSaving = false;
            var generateQuietPrompt = async () => { requests++; throw Error('No requests allowed'); };
            var toastr = { warning: message => notices.push(message), error: message => notices.push(message), success: () => {} };
            var startMap, jQuery = callback => { startMap = callback; };
            document.getElementById('send_textarea').addEventListener('input', () => inputEvents++);
            var rawMap = normalizeMapData({ schematic_name: 'Поместье Бабочки', atmosphere: 'Утро | Сухой зной', zones: [
                { position: 'center', name: 'Тренировочный зал', summary: 'Полированный кедровый пол.' },
                { position: 'north', name: 'Проём в сад', summary: 'Дорожка между цветущими деревьями.', threat_level: 'danger', threat_reason: 'На дорожке замечены враждебные демоны.' },
                { position: 'east', name: 'Оружейная стойка', summary: 'Стойка с деревянными мечами.', threat_level: 'safe', threat_reason: 'Оружие не используется.' },
            ] });
            chat_metadata.bb_map_data = createSavedMap(rawMap);
            var savedMap = chat_metadata.bb_map_data;
            ${strip(read('index.js'))}
        ` });
        await page.evaluate(async () => { await startMap(); await emit('APP_READY'); });
        const mode = () => page.locator('.bb-map-field').filter({ hasText: 'Режим текущего чата' }).locator('select');
        const changeMode = value => mode().evaluate((field, value) => { field.value = value; field.dispatchEvent(new Event('change')); }, value);
        await changeMode('game');
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_mode), 'game');
        assert.equal(await page.evaluate(() => writes), 1);
        assert.match(await page.evaluate(() => injected), /Game map/);
        await page.evaluate(() => showRadarModal(rawMap, true));
        await page.locator('.zone-north').focus();
        await page.keyboard.press('Enter');
        assert.match(await page.locator('#bb-map-travel').innerText(), /Опасность.*На дорожке замечены/);
        assert.equal(await page.locator('#bb-map-travel.is-danger').count(), 1);
        const screenshots = process.argv[3];
        for (const width of [1440, 768, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.locator('#bb-map-travel').scrollIntoViewIfNeeded();
            assert.ok(await page.locator('.bb-map-modal').evaluate(element => {
                const bounds = element.getBoundingClientRect();
                return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
            }));
            if (screenshots) {
                fs.mkdirSync(screenshots, { recursive: true });
                await page.screenshot({ path: path.join(screenshots, `map-travel-${width}.png`) });
            }
        }
        await page.locator('#send_textarea').evaluate(element => { element.value = 'Мой черновик  '; });
        await page.getByRole('button', { name: 'ПОДГОТОВИТЬ ПЕРЕХОД', exact: true }).click();
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Мой черновик  \n\nЯ направляюсь из зоны «Тренировочный зал» в зону «Проём в сад».');
        assert.equal(await page.evaluate(() => inputEvents), 1);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'send_textarea');
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data === savedMap), true);
        assert.equal(await page.evaluate(() => writes), 1);

        const open = () => page.evaluate(() => showRadarModal(rawMap, true));
        await open();
        await page.locator('.zone-center').click();
        assert.equal(await page.getByRole('button', { name: 'ПОДГОТОВИТЬ ПЕРЕХОД' }).count(), 0);
        await page.locator('.zone-east').click();
        assert.equal(await page.locator('#bb-map-travel.is-safe').count(), 1);
        const draft = await page.locator('#send_textarea').inputValue();
        await page.evaluate(() => { context = { ...context, chatId: 'other' }; });
        await page.getByRole('button', { name: 'ПОДГОТОВИТЬ ПЕРЕХОД', exact: true }).click();
        assert.equal(await page.locator('#send_textarea').inputValue(), draft);
        assert.match(await page.evaluate(() => notices.at(-1)), /Чат, режим или карта изменились/);
        await page.evaluate(() => { context = { ...context, chatId: 'one' }; chat_metadata.bb_map_data = createSavedMap(rawMap); });
        await page.getByRole('button', { name: 'ПОДГОТОВИТЬ ПЕРЕХОД', exact: true }).click();
        assert.equal(await page.locator('#send_textarea').inputValue(), draft);
        await open();
        await page.locator('.zone-east').click();
        await page.evaluate(() => { document.body.dataset.generating = 'true'; });
        await page.getByRole('button', { name: 'ПОДГОТОВИТЬ ПЕРЕХОД', exact: true }).click();
        assert.equal(await page.locator('#send_textarea').inputValue(), draft);
        await changeMode('classic');
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_mode), 'game');
        await page.evaluate(() => { delete document.body.dataset.generating; });
        await changeMode('classic');
        assert.equal(await page.evaluate(() => injected), await page.evaluate(() => chat_metadata.bb_map_data.context));
        await open();
        assert.equal(await page.locator('#bb-map-travel').count(), 0);
        await page.evaluate(() => { document.getElementById('bb-map-overlay').remove(); });

        await page.evaluate(async () => { context = { ...context, chatId: 'two', chatMetadata: {} }; chat_metadata = context.chatMetadata; await emit('CHAT_CHANGED'); });
        assert.equal(await mode().inputValue(), 'classic');
        assert.equal(await page.evaluate(() => injected), '');
        await page.evaluate(async () => {
            context = { ...context, chatId: 'one', chatMetadata: { bb_map_mode: 'game', bb_map_data: savedMap } };
            chat_metadata = context.chatMetadata;
            settings.uiLanguage = 'en'; settings.useMacro = true;
            await emit('CHAT_CHANGED');
        });
        assert.match(await page.evaluate(() => macros.get('bb_map')()), /Game map/);
        await page.evaluate(async () => { var payload = { messages: [{ content: '{{bb_map}}' }] }; await emit('GENERATE_AFTER_DATA', payload); globalThis.macroText = payload.messages[0].content; });
        assert.match(await page.evaluate(() => macroText), /A requested transition is an attempt/);
        await open();
        await page.locator('.zone-east').click();
        await page.locator('#send_textarea').evaluate(element => { element.value = ''; });
        await page.getByRole('button', { name: 'PREPARE TRAVEL', exact: true }).click();
        assert.equal(await page.locator('#send_textarea').inputValue(), 'I head from "Тренировочный зал" to "Оружейная стойка".');
        assert.equal(await page.evaluate(() => writes), 2); // Only explicit mode changes save metadata.
        assert.equal(await page.evaluate(() => requests), 0);
        assert.equal(await page.evaluate(() => originalMessages[0].mes), 'I am in the hall.');
        assert.deepEqual(errors, []);
        console.log('Travel, threat warnings, draft preservation, keyboard, stale map/chat guards, busy guard, per-chat modes, macro context, RU/EN and responsive layout passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
