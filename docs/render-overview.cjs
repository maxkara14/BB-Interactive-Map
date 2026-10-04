// Approved direction: actual extension screens on a dark teal editorial overview.
// Synthetic scene only; no live Tavern, provider calls or chat persistence.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'images');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const strip = text => text.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function scene(lang) {
    const t = (ru, en) => lang === 'ru' ? ru : en;
    const names = [t('Тренировочный зал', 'Training hall'), t('Сад глициний', 'Wisteria garden'),
        t('Крытая галерея', 'Covered gallery'), t('Трапезная', 'Dining room')];
    const player = t('Мира', 'Mira'), npc = t('Аой Кандзаки', 'Aoi Kanzaki');
    return { player, raw: { layout: 'graph', scope: 'surroundings', schematic_name: t('Поместье Бабочки', 'Butterfly Estate'),
        atmosphere: t('☀️ 28°C | 🌸 Аромат глициний | 🍃 Тихий полдень', '☀️ 28°C | 🌸 Wisteria fragrance | 🍃 Quiet noon'),
        player_place_id: 'hall', zones: [
            { id: 'hall', name: names[0], kind: 'room', threat_level: 'safe', summary: t('Солнечный зал с кедровым полом. После тренировки двери в сад открыты.', 'A sunlit hall with cedar floors. The garden doors stand open after training.'),
                characters: [{ name: npc, description: t('Стоит у открытых дверей, держа полотенце.', 'Waiting by the open doors with a towel.'), mood: t('🙂 Спокойная забота', '🙂 Quiet concern'), attitude: t('Предлагает отдохнуть в саду.', 'Suggests taking a rest in the garden.') }],
                poi: [{ name: t('Фляга', 'Water flask'), description: t('Небольшая фляга с прохладной водой.', 'A small flask of cool water.'), item_state: 'held', holder: player, state_reason: t('Мира взяла её после тренировки.', 'Mira picked it up after training.') },
                    { name: t('Кедровый настил', 'Cedar floor'), description: t('Тёплые доски в полосах солнечного света.', 'Warm boards striped with sunlight.'), item_state: 'zone' }] },
            { id: 'garden', name: names[1], kind: 'outdoor', threat_level: 'tension', threat_reason: t('На влажной тропинке легко поскользнуться.', 'The damp path is slippery.'), summary: t('Глицинии нависают над каменной тропинкой.', 'Wisteria arches over a stone path.') },
            { id: 'gallery', name: names[2], kind: 'passage', threat_level: 'safe', summary: t('Затенённая галерея ведёт к трапезной.', 'A shaded gallery leads to the dining room.') },
            { id: 'dining', name: names[3], kind: 'room', threat_level: 'safe', summary: t('Низкие столики и аромат свежего чая.', 'Low tables and the fragrance of fresh tea.') }
        ], connections: [
            { from: 'hall', to: 'garden', name: t('Сёдзи', 'Shoji'), kind: 'opening', status: 'confirmed', direction: 'both', evidence: t('Двери зала открыты в сад.', 'The hall doors open into the garden.') },
            { from: 'hall', to: 'gallery', name: t('Проём', 'Opening'), kind: 'opening', status: 'confirmed', direction: 'both', evidence: t('Из зала виден вход в галерею.', 'The gallery entrance is visible from the hall.') },
            { from: 'garden', to: 'gallery', name: t('Ступени', 'Steps'), kind: 'stairs', status: 'confirmed', direction: 'both', evidence: t('Каменные ступени соединяют сад и галерею.', 'Stone steps connect the garden and gallery.') },
            { from: 'gallery', to: 'dining', name: t('Коридор', 'Corridor'), kind: 'passage', status: 'confirmed', direction: 'both', evidence: t('Галерея заканчивается у трапезной.', 'The gallery ends at the dining room.') }
        ], effects: [{ name: t('Усталость после тренировки', 'Post-training fatigue'), scope: 'character', target: player,
            description: t('Мира переводит дыхание после спарринга.', 'Mira catches her breath after sparring.'), source: t('Долгая тренировка в зале.', 'A long training session in the hall.'),
            expires_when: t('Отдых и восстановление дыхания.', 'Rest and steady breathing.'), status: 'active' }]
    } };
}

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        for (const lang of ['ru', 'en']) {
            const demo = scene(lang), page = await browser.newPage({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.route('https://**', route => route.abort());
            await page.setContent('<meta charset="utf-8"><body style="margin:0;background:#0d1518;color:#e2e8f0;font-family:Segoe UI,sans-serif"><div id="extensions_settings" style="width:380px"></div><textarea id="send_textarea" hidden></textarea></body>');
            await page.addStyleTag({ content: read('style.css') });
            await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-links.js'))}\n${strip(read('map-topology-view.js'))}
                var extension_settings = { 'BB-Interactive-Map': { uiLanguage: ${JSON.stringify(lang)}, widgetCollapsed: false, mapAnimations: false, autoUpdate: true, travelWriting: 'enhance' } };
                var chat_metadata = { bb_map_mode: 'game' }, writes = 0;
                var context = { chatId: 'overview-fixture', characterId: 1, groupId: null, chatMetadata: chat_metadata, chat: [{ name: 'Demo', mes: 'Example scene' }], name1: ${JSON.stringify(demo.player)} };
                var SillyTavern = { getContext: () => context }, toastr = Object.fromEntries(['error','warning','info','success'].map(key => [key, () => {}]));
                var saveChatDebounced = () => writes++, saveChatConditional = async () => writes++, saveSettingsDebounced = () => {};
                var extension_prompt_types = { IN_CHAT: 0 }, extension_prompt_roles = { USER: 0 }, setExtensionPrompt = () => {}, isChatSaving = false;
                var generateQuietPrompt = async () => { throw Error('Overview must never request a model'); };
                globalThis.BBEnhanceGen = { apiVersion: 1, generatePlayerAction: async () => { throw Error('Overview must never generate an action'); } };
                ${strip(read('index.js').split('jQuery(async () => {')[0])}
                var raw = normalizeGraphMapData(${JSON.stringify(demo.raw)});
                chat_metadata.bb_map_data = createSavedMap(raw);
                renderMapWidget(); setupExtensionSettings();
                showRadarModal(raw, true);
            ` });
            await page.waitForFunction(() => getComputedStyle(document.getElementById('bb-map-overlay')).opacity === '1');
            await page.evaluate(() => document.activeElement?.blur());
            await page.locator('.bb-map-modal').screenshot({ path: path.join(out, `map.${lang}.png`) });
            await page.setViewportSize({ width: 390, height: 1200 });
            await page.locator('.bb-topology-place').filter({ hasText: demo.raw.zones[1].name }).click();
            await page.evaluate(() => document.activeElement?.blur());
            // Capture the panel alone, without the mobile sticky footer covering it.
            await page.locator('.bb-map-controls').evaluate(element => { element.style.visibility = 'hidden'; });
            assert.match(await page.locator('#bb-map-travel').textContent(), /Enhance/);
            await page.locator('#bb-map-travel').screenshot({ path: path.join(out, `travel.${lang}.png`) });
            await page.locator('.bb-map-effects').evaluate(element => { element.open = true; });
            await page.locator('.bb-map-effects').screenshot({ path: path.join(out, `effects.${lang}.png`) });
            await page.locator('.bb-map-objects').evaluate(element => { element.open = true; });
            await page.locator('.bb-map-objects').screenshot({ path: path.join(out, `objects.${lang}.png`) });
            await page.locator('.bb-map-controls').evaluate(element => { element.style.visibility = ''; });
            await page.locator('#bb-map-back-btn').click();
            await page.setViewportSize({ width: 1440, height: 1600 });
            await page.evaluate(() => renderMapWidget());
            await page.locator('#bb-map-widget').screenshot({ path: path.join(out, `widget.${lang}.png`) });
            await page.setViewportSize({ width: 390, height: 640 });
            await page.evaluate(() => { settings.widgetCollapsed = true; renderMapWidget(); });
            await page.locator('#bb-map-widget').screenshot({ path: path.join(out, `phone.${lang}.png`) });
            assert.equal(await page.evaluate(() => writes), 0);
            assert.deepEqual(errors, []);
            await page.close();

            const t = (ru, en) => lang === 'ru' ? ru : en;
            const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>BB Interactive Map — 2.0 preview</title>
                <style>*{box-sizing:border-box}body{margin:0;background:#0c1115;color:#e5f4f3;font:16px 'Segoe UI',sans-serif}main{width:1200px;margin:auto;padding:56px 48px 32px;background:radial-gradient(ellipse at 95% 0%,#17303480,transparent 45%),#0e1418}.eyebrow,h2{font-size:11px;letter-spacing:2.6px;text-transform:uppercase;color:#69cfca}h1{font-size:40px;letter-spacing:-1.2px;margin:12px 0}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #26363b;padding-bottom:30px;margin-bottom:30px}.subtitle{color:#b2c6cb;font-size:16px;margin:0}.badge{padding:9px 14px;border:1px solid #396665;border-radius:30px;font-size:12px;color:#94dad5}.layout{display:grid;grid-template-columns:700px 370px;gap:30px;align-items:start}h2{margin:0 0 14px}figure{margin:0 0 27px}img{display:block;width:100%;height:auto;border-radius:12px}figcaption{font-size:13px;color:#afc0c6;line-height:1.6;margin-top:12px}.widget{width:280px;margin:auto}.phone{width:44px;border-radius:0}aside .phone-row{display:flex;gap:18px;align-items:center;margin:16px 0 24px}.phone-row p{font-size:13px;color:#afc0c6;line-height:1.5;margin:0}.note{margin:26px 0;padding:18px 0;border-top:1px solid #26363b;color:#afc0c6;font-size:14px;line-height:1.65}.note strong{color:#e5f4f3;display:block;margin-bottom:6px}footer{display:flex;justify-content:space-between;gap:24px;border-top:1px solid #26363b;padding-top:22px;margin-top:16px;color:#9cafb6;font-size:10px;line-height:1.6}</style>
                <main><header><div><div class="eyebrow">SillyTavern extension</div><h1>BB Interactive Map</h1><p class="subtitle">${t('Места, маршруты и память вашей истории.', 'Places, routes and memory for your story.')}</p></div><span class="badge">2.0 ${t('ПРЕДРЕЛИЗ', 'PREVIEW')} · map_test</span></header>
                <div class="layout"><section><h2>${t('Карта сцены · места и проходы', 'Scene map · places and passages')}</h2><figure><img src="map.${lang}.png"><figcaption>${t('Выберите место: персонажи, предметы и проходы рядом со схемой. Обновление, редактор и сохранённое состояние — в том же окне.', 'Select a place: characters, objects and passages beside the diagram. Update, edit and saved-state controls stay in the same window.')}</figcaption></figure></section>
                <aside><h2>${t('Плавающая миникарта', 'Floating mini-map')}</h2><figure><img class="widget" src="widget.${lang}.png"><figcaption>${t('Текущее положение и ближайшие места. Полная карта — одним нажатием.', 'Your position and nearby places. Open the full map with one tap.')}</figcaption></figure>
                <div class="phone-row"><img class="phone" src="phone.${lang}.png"><p>${t('На телефоне сворачивается в кнопку.<br>Нажатие возвращает миникарту.', 'Collapses to a button on phones.<br>Tap to bring back the mini-map.')}</p></div>
                <h2>${t('Переход через Enhance Gen', 'Travel through Enhance Gen')}</h2><figure><img src="travel.${lang}.png"></figure>
                <h2>${t('Игровой режим · предметы', 'Game mode · objects')}</h2><figure><img src="objects.${lang}.png"></figure>
                <h2>${t('Временные эффекты', 'Temporary effects')}</h2><figure><img src="effects.${lang}.png"></figure>
                <div class="note"><strong>${t('Контекст для вашей модели', 'Context for your model')}</strong>${t('Память отдельно для каждого чата. Обновления после ответа персонажа. Необязательная связь с Enhance Gen и VNE.', 'Separate memory for each chat. Updates after character replies. Optional connections to Enhance Gen and VNE.')}</div></aside></div>
                <footer><span>github.com/maxkara14/BB-Interactive-Map</span><span>${t('Реальный интерфейс · пример сцены · экраны собраны для обзора', 'Actual interface · example scene · screens arranged for this overview')}</span></footer></main></html>`;
            const htmlFile = path.join(out, `overview.${lang}.html`);
            fs.writeFileSync(htmlFile, html);
            const poster = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 2 });
            await poster.goto(pathToFileURL(htmlFile).href);
            await poster.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode())); });
            assert.equal(await poster.evaluate(() => [...document.images].every(img => img.naturalWidth > 0)), true);
            assert.equal(await poster.evaluate(() => document.documentElement.scrollWidth), 1200);
            await poster.locator('main').screenshot({ path: path.join(out, `overview.${lang}.png`) });
            await poster.close();
            console.log(`${lang}: captured production components and overview; no chat writes or browser errors`);
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
