// Two real extensions with provider/persistence stubs; never opens user chats.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const enhance = path.join(root, '../BB-Enhance-Gen');
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
const strip = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const events = fs.readFileSync(path.resolve(root, '../../../../scripts/events.js'), 'utf8')
    .match(/export const event_types = (\{[\s\S]*?\r?\n\});/)[1];
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<body style="background:#111;color:#ddd"><div id="chat"></div><div id="extensions_settings"></div><form id="send_form"><textarea id="send_textarea"></textarea></form></body>');
        await page.addStyleTag({ content: read(root, 'style.css') + read(enhance, 'style.css') });
        await page.addScriptTag({ content: `${['core.js', 'ui.js', 'narrative.js', 'writing.js', 'writing-ui.js', 'd20.js', 'player-action.js'].map(file => strip(read(enhance, file))).join('\n')}
            ${strip(read(root, 'map-state.js'))}\n${strip(read(root, 'map-links.js'))}
            var event_types = ${events}; var handlers = new Map();
            var eventSource = { on: (name, fn) => handlers.set(name, [...(handlers.get(name) || []), fn]) };
            var emit = async (name, ...args) => { for (const fn of handlers.get(event_types[name]) || []) await fn(...args); };
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'ru', showWidget: false }, 'BB-Enhance-Gen': { uiLanguage: 'ru', generationSource: 'main', outputLanguage: 'ru', narrativePerson: 'first' } };
            var chat_metadata = { bb_map_mode: 'game' }, writes = 0, requests = 0, stops = 0, notices = [];
            var originalMessages = Object.freeze([Object.freeze({ name: 'Player', mes: 'I stand in the hall.', is_user: true })]);
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata, chat: originalMessages,
                name1: 'Player', mainApi: 'openai', onlineStatus: 'connected', extensionSettings: extension_settings,
                eventSource, event_types, saveSettingsDebounced: () => {}, substituteParams: text => text.replaceAll('{{user}}', 'Player'),
                extractMessageFromData: data => data.text, stopGeneration: () => { stops++; },
                generateRawData: async params => { requests++; globalThis.lastParams = params; return new Promise(resolve => { globalThis.finish = text => resolve({ text }); }); } };
            var SillyTavern = { getContext: () => context }, callbacks = [], jQuery = fn => callbacks.push(fn);
            var toastr = Object.fromEntries(['error', 'info', 'warning', 'success'].map(key => [key, message => notices.push(message)]));
            var saveChatDebounced = () => { writes++; }, saveChatConditional = async () => { writes++; }, saveSettingsDebounced = () => {};
            var extension_prompt_types = { IN_CHAT: 0 }, extension_prompt_roles = { USER: 0 }, setExtensionPrompt = () => {}, isChatSaving = false;
            var rawMap = normalizeMapData({ schematic_name: 'Поместье', zones: [
                { position: 'center', name: 'Зал' }, { position: 'north', name: 'Сад', threat_level: 'danger', threat_reason: 'Пожар', poi: ['Ключ'] }
            ] }); chat_metadata.bb_map_data = createSavedMap(rawMap); var savedMap = chat_metadata.bb_map_data;
            ${strip(read(root, 'index.js'))}
        ` });
        await page.evaluate(async () => { await callbacks.shift()(); await emit('APP_READY'); });
        assert.equal(await page.locator('option[value="enhance"]').evaluate(option => option.disabled), true);
        await page.addScriptTag({ content: strip(read(enhance, 'index.js')) });
        await page.evaluate(() => callbacks.shift()());
        assert.equal(await page.evaluate(() => BBEnhanceGen.apiVersion), 1);
        assert.equal(await page.locator('option[value="enhance"]').evaluate(option => option.disabled), false);
        await page.evaluate(() => { settings.travelWriting = 'enhance'; showRadarModal(rawMap, true); });
        await page.locator('.zone-north').click();
        await page.locator('#bb-map-travel input').fill('Осторожно');
        await page.locator('#send_textarea').fill('Старый текст  ');
        const write = () => page.getByRole('button', { name: 'НАПИСАТЬ ДЕЙСТВИЕ · ENHANCE', exact: true }).click();
        await write();
        await page.waitForFunction(() => requests === 1);
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Старый текст  ');
        const params = await page.evaluate(() => lastParams);
        assert.equal(params.responseLength, 5000);
        assert.match(params.prompt, /Осторожно/); assert.match(params.prompt, /Ключ/);
        assert.match(params.prompt, /Do not invent successful arrival/); assert.match(params.prompt, /first person/);
        await page.evaluate(() => finish('Я осторожно приближаюсь к двери в сад.'));
        await page.locator('#bb-map-overlay').waitFor({ state: 'detached' });
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Старый текст  \n\nЯ осторожно приближаюсь к двери в сад.');
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data === savedMap), true);
        await page.locator('#bb-eg-undo').evaluate(button => button.click());
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Старый текст  ');

        const open = async () => { await page.evaluate(() => showRadarModal(rawMap, true)); await page.locator('.zone-north').click(); };
        await open(); await write(); await page.waitForFunction(() => requests === 2);
        await page.locator('#send_textarea').fill('Ручные правки');
        await page.evaluate(() => finish('Устаревший ответ.'));
        await page.waitForFunction(() => mapTravelController === null);
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Ручные правки');
        assert.match(await page.locator('#bb-map-travel [role="status"]').innerText(), /Черновик изменился/);

        await write(); await page.waitForFunction(() => requests === 3);
        await page.evaluate(() => { chat_metadata.bb_map_data = createSavedMap(rawMap); finish('Ответ для старой карты.'); });
        await page.waitForFunction(() => mapTravelController === null);
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Ручные правки');
        assert.match(await page.locator('#bb-map-travel [role="status"]').innerText(), /Карта или режим изменились/);

        await open(); await write(); await page.waitForFunction(() => requests === 4);
        await page.getByRole('button', { name: 'ОТМЕНИТЬ ГЕНЕРАЦИЮ', exact: true }).click();
        await page.evaluate(() => finish('Отменённый ответ.'));
        await page.waitForFunction(() => mapTravelController === null);
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Ручные правки');
        assert.match(await page.locator('#bb-map-travel [role="status"]').innerText(), /Отменено/);
        assert.ok(await page.evaluate(() => stops > 0));

        await write(); await page.waitForFunction(() => requests === 5);
        const busy = await page.evaluate(async () => { try { await BBEnhanceGen.generatePlayerAction({ kind: 'map_travel', from: rawMap.zones[0], to: rawMap.zones[1], mapContext: savedMap.context, isCurrent: () => true }); } catch (error) { return error.code; } });
        assert.equal(busy, 'busy');
        await page.evaluate(async () => { context = { ...context, chatId: 'two', chatMetadata: {} }; chat_metadata = context.chatMetadata; await emit('CHAT_CHANGED'); finish('Старый чат.'); });
        await page.waitForFunction(() => mapTravelController === null);
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Ручные правки');
        assert.equal(await page.evaluate(() => writes), 0);
        await page.evaluate(async () => {
            context = { ...context, chatId: 'three', chatMetadata: { bb_map_mode: 'game', bb_map_data: savedMap } };
            chat_metadata = context.chatMetadata;
            Object.assign(extension_settings['BB-Enhance-Gen'], { generationSource: 'custom', customApiUrl: 'https://test.invalid/v1', customApiModel: 'test', enableStreaming: true, fallbackToMain: true });
            globalThis.fetch = async (_url, options) => {
                requests++; globalThis.lastPayload = JSON.parse(options.body);
                const stream = new ReadableStream({ start(controller) { globalThis.streamController = controller; } });
                options.signal.addEventListener('abort', () => { try { streamController.error(new DOMException('Cancelled', 'AbortError')); } catch {} }, { once: true });
                streamController.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Я "}}]}\n\n'));
                return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
            };
            await emit('CHAT_CHANGED');
        });
        await open(); await write(); await page.waitForFunction(() => requests === 6);
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Ручные правки');
        assert.equal(await page.evaluate(() => lastPayload.max_tokens), 5000);
        assert.equal(await page.evaluate(() => lastPayload.stream), true);
        const screenshots = process.argv[3];
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.locator('#bb-map-travel').scrollIntoViewIfNeeded();
            assert.ok(await page.locator('.bb-map-modal').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
            if (screenshots) {
                fs.mkdirSync(screenshots, { recursive: true });
                await page.screenshot({ path: path.join(screenshots, `enhance-travel-${width}.png`) });
            }
        }
        await page.evaluate(() => { streamController.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"иду к двери."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); streamController.close(); });
        await page.locator('#bb-map-overlay').waitFor({ state: 'detached' });
        assert.equal(await page.locator('#send_textarea').inputValue(), 'Ручные правки\n\nЯ иду к двери.');
        const completedDraft = await page.locator('#send_textarea').inputValue();
        await open(); await write(); await page.waitForFunction(() => requests === 7);
        await page.evaluate(() => { streamController.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"обрыв"},"finish_reason":"length"}]}\n\n')); streamController.close(); });
        await page.waitForFunction(() => mapTravelController === null);
        assert.equal(await page.locator('#send_textarea').inputValue(), completedDraft);
        assert.equal(await page.evaluate(() => requests), 7); // No fallback for a partial response.
        await write(); await page.waitForFunction(() => requests === 8);
        await page.getByRole('button', { name: 'ОТМЕНИТЬ ГЕНЕРАЦИЮ', exact: true }).click();
        await page.waitForFunction(() => mapTravelController === null);
        assert.equal(await page.locator('#send_textarea').inputValue(), completedDraft);
        await page.evaluate(() => { extension_settings['BB-Enhance-Gen'].fallbackToMain = false; globalThis.fetch = async () => { requests++; return new Response('{}', { status: 503 }); }; });
        await write(); await page.waitForFunction(() => mapTravelController === null);
        assert.equal(await page.locator('#send_textarea').inputValue(), completedDraft);
        assert.equal(await page.evaluate(() => requests), 9);
        const invalid = await page.evaluate(async () => { try { await BBEnhanceGen.generatePlayerAction({ kind: 'unknown' }); } catch (error) { return error.code; } });
        assert.equal(invalid, 'invalid_action');
        await page.evaluate(() => { document.getElementById('bb-map-overlay').remove(); extension_settings['BB-Enhance-Gen'].generationSource = 'main'; });
        await page.locator('#bb-eg-btn-improve').evaluate(button => button.click());
        await page.waitForFunction(() => requests === 10);
        await page.evaluate(() => finish('Отредактированный черновик.'));
        await page.waitForFunction(() => document.getElementById('send_textarea').value === 'Отредактированный черновик.');
        await page.locator('#bb-eg-undo').evaluate(button => button.click());
        assert.equal(await page.locator('#send_textarea').inputValue(), completedDraft);
        assert.equal(await page.evaluate(() => originalMessages[0].mes), 'I stand in the hall.');
        assert.deepEqual(errors, []);
        console.log('Both extensions: late API availability, generation, shared limits/style, undo, manual edits, stale map/chat, cancellation, busy lock, and no chat writes passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
