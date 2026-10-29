// Production scan -> preview -> save -> highlights/cards -> editor -> JSON reload, with no external requests.
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
        const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#10151b;color:#e2e8f0;font:16px/1.7 Segoe UI"><main id="chat" style="margin:50px auto;width:min(700px,calc(100% - 32px))"><article class="mes"><div class="mes_text">Тоё задвинула бумажную раму сёдзи и остановилась у верхней ступени на веранде.</div></article></main><button id="scan">Scan</button><div id="extensions_settings" hidden></div></body>');
        const initialText = await page.locator('.mes_text').textContent();
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${['map-state.js','map-object-mentions.js','map-links.js','map-topology-view.js'].map(file => strip(read(file))).join('\n')}
            var handlers = new Map(), writes = 0, requests = 0, prompts = [], notices = [];
            var event_types = Object.fromEntries(['CHAT_LOADED','MORE_MESSAGES_LOADED','USER_MESSAGE_RENDERED','CHARACTER_MESSAGE_RENDERED','MESSAGE_UPDATED','MESSAGE_SWIPED','APP_READY','CHAT_CHANGED','GENERATION_STARTED','MESSAGE_RECEIVED','GENERATION_ENDED','GENERATION_STOPPED','GENERATE_AFTER_DATA'].map(key => [key,key]));
            var eventSource = { on: (event,fn) => { if (!handlers.has(event)) handlers.set(event,[]); handlers.get(event).push(fn); } };
            var emit = async event => { for (const fn of handlers.get(event) || []) await fn(); };
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage:'en',showWidget:false,highlightMentions:true } };
            var raw = normalizeGraphMapData({layout:'graph',scope:'scene',schematic_name:'Усадьба Асахина',player_place_id:'veranda',
                zones:[{id:'veranda',name:'Веранда дома',kind:'room',characters:[{name:'Тоё Асахина',description:'Хозяйка дома'}],
                    poi:[{name:'Раздвижные сёдзи',description:'Бумажные перегородки'},{name:'Ступени крыльца',description:'Деревянные ступени'}]}],connections:[]});
            var chat_metadata={bb_map_data:createSavedMap(raw)};
            var context={chatId:'one',characterId:1,chatMetadata:chat_metadata,name1:'Химари',chat:[{name:'Character',mes:document.querySelector('.mes_text').textContent,is_user:false}],eventSource,event_types,registerMacro:()=>{}};
            var SillyTavern={getContext:()=>context},isChatSaving=false;
            var saveChatDebounced=()=>{writes++},saveChatConditional=async()=>{writes++},saveSettingsDebounced=()=>{};
            var setExtensionPrompt=()=>{},extension_prompt_types={IN_CHAT:0},extension_prompt_roles={USER:0};
            var toastr={warning:text=>notices.push(text),info:()=>{},success:()=>{},error:text=>notices.push(text)};
            var response=structuredClone(raw);
            response.zones[0].mention_aliases=['веранде'];
            response.zones[0].characters[0].mention_aliases=['Тоё','Тоё Асахиной'];
            response.zones[0].poi[0].mention_aliases=['сёдзи','раздвижными сёдзи'];
            response.zones[0].poi[1].mention_aliases=['ступень','ступени','ступеням'];
            var generateQuietPrompt=async options=>{requests++;prompts.push(options.quietPrompt);return JSON.stringify(response)};
            var jQuery=callback=>{globalThis.startMap=callback};
            ${strip(read('index.js'))}
            document.getElementById('scan').onclick=event=>triggerMapScan(event.currentTarget,'scene');
        ` });
        await page.evaluate(async()=>{await startMap();await emit('APP_READY')});
        await page.waitForFunction(()=>document.querySelectorAll('.bb-map-mention-character').length===1);
        assert.equal(await page.locator('.bb-map-mention-object').count(),0);
        const original = await page.evaluate(()=>JSON.stringify(chat_metadata));
        await page.locator('#scan').click();
        await page.locator('#bb-map-save-btn').waitFor();
        assert.equal(await page.evaluate(()=>requests),1);
        assert.equal(await page.evaluate(()=>JSON.stringify(chat_metadata)),original);
        assert.doesNotMatch(await page.locator('.bb-map-modal').innerText(),/mention_aliases|раздвижными сёдзи/);
        assert.equal(await page.locator('.bb-map-edit-aliases').count(),0);
        await page.locator('#bb-map-save-btn').click();
        await page.locator('#bb-map-back-btn').click();
        await page.waitForFunction(()=>document.querySelectorAll('.bb-map-mention-object').length===2);
        assert.equal(await page.locator('.mes_text').textContent(),initialText);
        assert.doesNotMatch(await page.evaluate(()=>BBInteractiveMap.getContext()),/mention_aliases|раздвижными сёдзи/);
        await page.locator('.bb-map-mention-object').filter({hasText:/^сёдзи$/}).click();
        assert.equal(await page.locator('.bb-map-mention-card h3').innerText(),'Раздвижные сёдзи');
        assert.doesNotMatch(await page.locator('.bb-map-mention-card').innerText(),/раздвижными сёдзи|mention_aliases/);
        await page.keyboard.press('Escape');
        const openEditor = async()=>{
            await page.evaluate(()=>showRadarModal(chat_metadata.bb_map_data.raw,true));
            await page.locator('#bb-map-edit-btn').click();
        };
        for (const width of [1440,768,390]) {
            await page.setViewportSize({width,height:950});
            await openEditor();
            assert.equal(await page.locator('.bb-map-edit-aliases').count(),4);
            assert.equal(await page.locator('.bb-map-edit-aliases').evaluateAll(nodes=>nodes.every(node=>!node.open)),true);
            const variants=page.locator('[data-entity-type="object"]').first().locator(':scope > .bb-map-edit-aliases');
            await variants.locator(':scope > summary').click();
            assert.equal(await variants.locator('textarea').inputValue(),'сёдзи\nраздвижными сёдзи');
            assert.equal(await page.locator('.bb-map-modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
            if(screenshots){fs.mkdirSync(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,`alias-editor-${width}.png`)});}
            await page.getByRole('button',{name:'CANCEL EDITS',exact:true}).click();
            await page.locator('#bb-map-back-btn').click();
        }
        await openEditor();
        const objectVariants=page.locator('[data-entity-type="object"]').first().locator(':scope > .bb-map-edit-aliases');
        await objectVariants.locator(':scope > summary').click();
        await objectVariants.locator('textarea').fill(Array(17).fill('форма').join('\n'));
        await page.getByRole('button',{name:'PREVIEW EDITS',exact:true}).click();
        assert.match(await page.locator('.bb-map-edit-error').innerText(),/up to 16/i);
        assert.equal(await page.evaluate(()=>writes),1);
        await objectVariants.locator('textarea').fill('сёдзи\nраздвижными сёдзи\nстворки сёдзи');
        await page.getByRole('button',{name:'PREVIEW EDITS',exact:true}).click();
        await page.locator('#bb-map-save-btn').click();
        assert.deepEqual(await page.evaluate(()=>chat_metadata.bb_map_data.raw.zones[0].poi[0].mention_aliases),['сёдзи','раздвижными сёдзи','створки сёдзи']);
        await page.locator('#bb-map-back-btn').click();
        await page.evaluate(async()=>{
            chat_metadata=JSON.parse(JSON.stringify(chat_metadata));context.chatMetadata=chat_metadata;await emit('CHAT_CHANGED');
            response=structuredClone(chat_metadata.bb_map_data.raw);
            for(const zone of response.zones){delete zone.mention_aliases;for(const item of [...zone.poi,...zone.characters])delete item.mention_aliases;}
        });
        await page.waitForFunction(()=>document.querySelectorAll('.bb-map-mention-object').length===2);
        await page.locator('#scan').click();
        await page.locator('#bb-map-save-btn').click();
        assert.deepEqual(await page.evaluate(()=>chat_metadata.bb_map_data.raw.zones[0].poi[0].mention_aliases),['сёдзи','раздвижными сёдзи','створки сёдзи']);
        assert.match(await page.evaluate(()=>prompts[1]),/mention_alias_memory/);
        assert.doesNotMatch(await page.evaluate(()=>BBInteractiveMap.getContext()),/створки сёдзи|mention_aliases/);
        await page.locator('#bb-map-back-btn').click();
        await openEditor();
        const clearVariants=page.locator('[data-entity-type="object"]').first().locator(':scope > .bb-map-edit-aliases');
        await clearVariants.locator(':scope > summary').click();
        await clearVariants.locator('textarea').fill('');
        await page.getByRole('button',{name:'PREVIEW EDITS',exact:true}).click();
        await page.locator('#bb-map-save-btn').click();
        await page.locator('#bb-map-back-btn').click();
        await page.waitForFunction(()=>document.querySelectorAll('.bb-map-mention-object').length===1);
        assert.deepEqual(await page.evaluate(()=>chat_metadata.bb_map_data.raw.zones[0].poi[0].mention_aliases),[]);
        await page.evaluate(async()=>{chat_metadata={};context={...context,chatId:'other',chatMetadata:chat_metadata};await emit('CHAT_CHANGED')});
        await page.waitForFunction(()=>document.querySelectorAll('[data-bb-map-mention]').length===0);
        assert.equal(await page.evaluate(()=>requests),2);
        assert.equal(await page.evaluate(()=>writes),4);
        assert.equal(await page.locator('.mes_text').textContent(),initialText);
        assert.deepEqual(errors,[]);
        console.log('Alias generation, hidden metadata, canonical cards, collapsed editor, limits, manual edits/clear, reload, update preservation and chat isolation passed at 1440/768/390px.');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
