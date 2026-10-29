// Real settings, event registration and rendering, with isolated chat/model/persistence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const screenshots = process.argv[3];
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const strip = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#10151b;color:#e2e8f0;font:14px Segoe UI"><div id="extensions_settings" style="width:min(440px,100%);box-sizing:border-box;padding:12px"></div><textarea id="send_textarea"></textarea><div id="chat"><div class="mes"><div class="mes_text">Alice found a Key in the Hall.</div></div></div></body>');
        // Use the installed host's actual input styling rather than browser-default white inputs.
        const hostCss = fs.readFileSync(path.resolve(root, '../../../../style.css'), 'utf8');
        await page.addStyleTag({ content: ':root { --black30a:rgba(0,0,0,.3); --SmartThemeBodyColor:#dcdcd2; --SmartThemeBorderColor:#444; --mainFontFamily:Segoe UI; }'
            + hostCss.match(/\.text_pole \{[^}]+\}/)[0] });
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${['map-state.js', 'map-object-mentions.js', 'map-links.js', 'map-topology-view.js'].map(file => strip(read(file))).join('\n')}
            var handlers = new Map(), writes = 0, requests = 0, settingsWrites = 0;
            var event_types = Object.fromEntries(['CHAT_LOADED','MORE_MESSAGES_LOADED','USER_MESSAGE_RENDERED','CHARACTER_MESSAGE_RENDERED','MESSAGE_UPDATED','MESSAGE_SWIPED','APP_READY','CHAT_CHANGED','GENERATION_STARTED','MESSAGE_RECEIVED','GENERATION_ENDED','GENERATION_STOPPED','GENERATE_AFTER_DATA'].map(key => [key, key]));
            var eventSource = { on: (event, fn) => { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); } };
            var emit = async (event, ...args) => { for (const fn of handlers.get(event) || []) await fn(...args); };
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'en', autoUpdate: true, widgetCollapsed: false, highlightMentions: true } };
            var raw = normalizeGraphMapData({ layout:'graph', scope:'scene', schematic_name:'Garden house', atmosphere:'Noon | Clear', player_place_id:'hall',
                zones:[{id:'hall',name:'Hall',kind:'room',characters:[{name:'Alice',description:'Guard',mood:'Calm',attitude:'Friendly',thought:'Keep watch'}],poi:[{name:'Key'}]},
                    {id:'garden',name:'Garden',kind:'outdoor',threat_level:'tension',threat_reason:'Voices'}],
                connections:[{from:'hall',to:'garden',name:'Door',kind:'door',status:'confirmed',evidence:'Open door',direction:'both'}] });
            var chat_metadata = { bb_map_data:createSavedMap(raw) };
            var context = { chatId:'test',characterId:1,chatMetadata:chat_metadata,name1:'Player',chat:[{name:'Alice',mes:'Player is in the hall.',is_user:false}],eventSource,event_types,registerMacro:()=>{} };
            var SillyTavern={getContext:()=>context}, isChatSaving=false;
            var saveSettingsDebounced=()=>{settingsWrites++},saveChatConditional=async()=>{writes++},saveChatDebounced=()=>{writes++};
            var setExtensionPrompt=()=>{}, extension_prompt_types={IN_CHAT:0},extension_prompt_roles={USER:0};
            var toastr={warning:()=>{},info:()=>{},success:()=>{},error:text=>{throw Error(text)}};
            var getTokenCountAsync=async text=>Array.from(text).length;
            var generateQuietPrompt=async()=>{requests++;return JSON.stringify(raw)};
            var jQuery=fn=>{globalThis.initialized=fn()};
            ${strip(read('index.js'))}
        ` });
        await page.evaluate(async () => { await initialized; await emit('APP_READY'); });
        assert.equal(await page.evaluate(() => handlers.get('MESSAGE_RECEIVED').length), 1);
        await page.locator('#bb-map-settings-wrapper > .inline-drawer-content').evaluate(el => { el.style.display = 'block'; });
        for (const section of ['context', 'tracking', 'map', 'colors']) await page.locator(`details[data-section="${section}"]`).evaluate(el => { el.open = true; });
        // Keep the chat in its own visible surface: scrolling the document intentionally closes cards.
        await page.locator('#chat').evaluate(el => { el.style.cssText = 'position:fixed;right:8px;top:8px;width:320px'; });
        for (const [type, label, hex, rgb] of [
            ['character', 'Character mentions', '#bfa0f1', 'rgb(191, 160, 241)'],
            ['object', 'Object mentions', '#a1c4ef', 'rgb(161, 196, 239)'],
            ['zone', 'Place mentions', '#f1b1aa', 'rgb(241, 177, 170)'],
        ]) {
            const mention = page.locator(`#chat .bb-map-mention-${type}`);
            await mention.waitFor();
            await mention.click();
            const cardLabel = page.locator(`.bb-map-mention-card-${type} > small:first-child`);
            await cardLabel.waitFor();
            // Changing a color updates both existing mentions and an already-open card.
            await page.getByLabel(label, { exact: true }).evaluate((field, value) => {
                field.value = value;
                field.dispatchEvent(new Event('change', { bubbles: true }));
            }, hex);
            assert.equal(await mention.evaluate(el => getComputedStyle(el).color), rgb);
            assert.equal(await cardLabel.evaluate(el => getComputedStyle(el).color), rgb);
            await page.keyboard.press('Escape');
        }
        assert.equal(await page.locator('#chat .mes_text').innerText(), 'Alice found a Key in the Hall.');
        await page.locator('#chat').evaluate(el => { el.removeAttribute('style'); });
        const snapshot = await page.evaluate(() => JSON.stringify(chat_metadata));
        await page.getByLabel('Recent messages', { exact: true }).fill('8');
        await page.getByLabel('Recent messages', { exact: true }).dispatchEvent('change');
        await page.getByLabel('History token limit (0 = unlimited)', { exact: true }).fill('2000');
        await page.getByLabel('History token limit (0 = unlimited)', { exact: true }).dispatchEvent('change');
        await page.getByLabel('Update every N character responses', { exact: true }).fill('2');
        await page.getByLabel('Update every N character responses', { exact: true }).dispatchEvent('change');
        await page.getByLabel('Count continuations (Continue)', { exact: true }).uncheck();
        await page.getByLabel('Count regenerations and swipes', { exact: true }).uncheck();
        for (const label of ['Mood','Thoughts','Objects']) await page.getByLabel(label, { exact:true }).uncheck();
        assert.equal(await page.evaluate(() => JSON.stringify(chat_metadata)), snapshot);
        assert.doesNotMatch(await page.evaluate(() => BBInteractiveMap.getContext()), /Calm|Key/);
        await page.getByLabel('Accent and route', { exact: true }).fill('#e6ae63');
        await page.getByLabel('Accent and route', { exact: true }).dispatchEvent('change');
        await page.getByLabel('Background', { exact: true }).fill('#202634');
        await page.getByLabel('Background', { exact: true }).dispatchEvent('change');
        if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
        for (const width of [1440,768,390]) {
            await page.setViewportSize({width,height:900});
            await page.locator('#extensions_settings').scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            const overflow = await page.locator('.bb-map-field').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().right > innerWidth + 1).length);
            assert.equal(overflow,0);
            if (screenshots) await page.screenshot({path:path.join(screenshots,`settings-${width}.png`),fullPage:true});
            await page.evaluate(() => showRadarModal(chat_metadata.bb_map_data.raw,true));
            await page.waitForTimeout(450);
            assert.equal(await page.locator('.bb-dossier-tabs [data-category="objects"]').count(),0);
            assert.equal(await page.locator('.bb-dossier-tabs [data-category="characters"]').count(),1);
            assert.doesNotMatch(await page.locator('.bb-topology-detail').innerText(),/Calm|Keep watch/);
            assert.equal(await page.locator('.bb-map-graph-modal').evaluate(el => getComputedStyle(el).backgroundColor),'rgb(32, 38, 52)');
            assert.equal(await page.locator('.bb-topology-current').first().evaluate(el=>getComputedStyle(el).color),'rgb(230, 174, 99)');
            if (screenshots) await page.screenshot({path:path.join(screenshots,`map-${width}.png`)});
            await page.getByRole('button',{name:'EDIT MAP',exact:true}).click();
            assert.equal(await page.locator('[name="mood"], [name="thought"]').count(),0);
            assert.equal(await page.getByRole('button',{name:'+ Object',exact:true}).count(),0);
            await page.evaluate(() => removeMapOverlay());
        }
        await page.getByLabel('Characters',{exact:true}).uncheck();
        await page.evaluate(() => showRadarModal(chat_metadata.bb_map_data.raw,true));
        assert.equal(await page.locator('.bb-dossier-tabs [role="tab"]').count(),1);
        await page.locator('.bb-dossier-tabs [role="tab"]').press('End');
        await page.evaluate(() => removeMapOverlay());
        // Complete events pass through the registered handlers, using the configured interval.
        await page.evaluate(async () => { context.chat.push({name:'Alice',mes:'One',is_user:false}); await emit('MESSAGE_RECEIVED',1,'normal'); await emit('MESSAGE_RECEIVED',1,'normal'); });
        await page.waitForTimeout(1700); assert.equal(await page.evaluate(()=>requests),0);
        await page.evaluate(async () => { context.chat.push({name:'Alice',mes:'Two',is_user:false}); await emit('MESSAGE_RECEIVED',2,'normal'); });
        await page.waitForFunction(()=>requests===1 && autoStatus==='ready');
        await page.evaluate(async () => { await emit('GENERATION_STARTED','continue'); context.chat.at(-1).mes+=' continued'; await emit('MESSAGE_RECEIVED',2,'continue'); await emit('GENERATION_ENDED'); });
        await page.waitForTimeout(1700); assert.equal(await page.evaluate(()=>requests),1);
        await page.evaluate(() => { resetAutoUpdate(); autoStatus='blocked'; autoWaitReason='saving'; renderMapWidget(); setupExtensionSettings(true); });
        await page.getByRole('button',{name:'Retry',exact:true}).first().click();
        await page.waitForFunction(()=>requests===2);
        assert.equal(await page.evaluate(()=>writes),0);
        await page.getByRole('button',{name:'Reset colors',exact:true}).click();
        assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--bb-map-accent')),'');
        assert.equal(await page.locator('.bb-map-section-icon').first().evaluate(el=>getComputedStyle(el).color),'rgb(91, 192, 190)');
        // Restore tracking to check all three original mention colors after palette reset.
        await page.getByLabel('Characters', { exact: true }).check();
        await page.getByLabel('Objects', { exact: true }).check();
        for (const [type, rgb] of [['character','rgb(131, 216, 211)'],['object','rgb(232, 199, 142)'],['zone','rgb(165, 201, 173)']]) {
            const mention = page.locator(`#chat .bb-map-mention-${type}`);
            await mention.waitFor();
            assert.equal(await mention.evaluate(el => getComputedStyle(el).color), rgb);
        }
        await page.evaluate(() => { settings.uiLanguage='ru'; setupExtensionSettings(true); renderMapWidget(); });
        await page.locator('#extensions_settings').scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (screenshots) await page.screenshot({path:path.join(screenshots,'settings-390-ru.png'),fullPage:true});
        assert.deepEqual(errors,[]);
        console.log('Settings, registered events, interval, field exclusions, palette, retry and 1440/768/390px rendering passed.');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
