const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const strip = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px;background:#10151b;color:#e2e8f0;font-family:system-ui"><div id="extensions_settings" style="width:440px;max-width:100%"></div></body>');
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-topology-view.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'en', autoUpdate: true, autoApply: true, widgetCollapsed:false } };
            var chat_metadata = {}, writes = 0, notices = [];
            var context = { chatId: 'fixture', characterId: 1, groupId: null, chatMetadata: chat_metadata,
                name1: 'Player', chat: [{ name: 'Character', mes: 'Player remains on the train roof.', is_user: false }] };
            var SillyTavern = { getContext: () => context }, toastr = Object.fromEntries(['error','warning','info','success'].map(key => [key, text => notices.push(text)]));
            var saveSettingsDebounced = () => {}, saveChatConditional = async () => writes++, saveChatDebounced = () => writes++;
            var isChatSaving = false, setExtensionPrompt = () => {}, extension_prompt_types = { IN_CHAT: 0 }, extension_prompt_roles = { USER: 0 };
            var scene = (name, place) => ({ layout:'graph', scope:'scene', schematic_name:name, player_place_id:'place',
                zones:[{id:'place',name:place,kind:'outdoor'}],connections:[] });
            var estate = createSavedMap(normalizeGraphMapData(scene('Estate','Garden')));
            var train = createSavedMap(normalizeGraphMapData(scene('Train','Carriage roof')));
        ` });
        await page.addScriptTag({ content: `
            chat_metadata.bb_map_data = train;
            chat_metadata.bb_map_archive = recordArchivedMap(recordArchivedMap(readLocationArchive({}),estate),train);
            var estateBefore = JSON.stringify(chat_metadata.bb_map_archive.locations[0]);
            var response = { ...train.raw, archive_location_id:null };
            var generateQuietPrompt = async () => JSON.stringify(response);
            ${strip(read('index.js').split('jQuery(async () => {')[0])}
            setupExtensionSettings(); renderMapWidget();
        ` });
        const reply = async () => {
            await page.evaluate(() => { context.chat[0].mes += ' Another event.'; handleMessageReceived(0,'normal'); });
            await page.waitForFunction(() => !scanInProgress && ['ready','updated'].includes(autoStatus));
        };
        for (const title of ['Train','Location','Train accident']) {
            await page.evaluate(title => { response.schematic_name = title; }, title); await reply();
            assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations.length), 2);
            assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.activeId), 'bbl-2');
            if (title === 'Location') assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.schematic_name), 'Train');
        }
        await page.evaluate(() => { response = { ...scene('Unknown area','Different place'), archive_location_id:null }; });
        await reply();
        assert.equal(await page.evaluate(() => autoStatus), 'ready');
        await page.locator('.bb-map-widget-review').click();
        assert.equal(await page.locator('#bb-map-save-btn').isEnabled(), false);
        await page.getByRole('button', { name:'UPDATE CURRENT LOCATION', exact:true }).click();
        await page.locator('#bb-map-save-btn').click(); await page.locator('#bb-map-back-btn').click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations.length), 2);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.activeId), 'bbl-2');
        await page.evaluate(() => {
            context.chat[0].mes = 'Player left this region and arrived at the mountain refuge.';
            response = { ...scene('Refuge','Refuge entrance'), archive_location_id:null,location_change:'new',location_change_evidence:context.chat[0].mes };
        }); await reply();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations.length), 3);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.activeId), 'bbl-3');
        const openArchive = async () => {
            await page.locator('#bb-map-settings-wrapper > .inline-drawer-content').evaluate(node => { node.style.display='block'; });
            await page.locator('[data-section="archive"]').evaluate(node => { node.open=true; });
        };
        await openArchive();
        assert.equal(await page.locator('[data-archive-delete="bbl-3"]').isEnabled(), false);
        const beforeCancel = await page.evaluate(() => JSON.stringify(chat_metadata.bb_map_archive));
        page.once('dialog', dialog => dialog.dismiss()); await page.locator('[data-archive-delete="bbl-2"]').click();
        assert.equal(await page.evaluate(() => JSON.stringify(chat_metadata.bb_map_archive)), beforeCancel);
        page.once('dialog', dialog => dialog.accept()); await page.locator('[data-archive-delete="bbl-2"]').click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations.length), 2);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.schematic_name), 'Refuge');
        assert.equal(await page.evaluate(() => JSON.stringify(chat_metadata.bb_map_archive.locations[0]) === estateBefore), true);
        await page.locator('[data-section="map"]').evaluate(node => { node.open=true; });
        await page.getByRole('button', { name:'Clear memory text',exact:true }).click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data), undefined);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.activeId), null);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations.length), 2);
        await openArchive();
        assert.equal(await page.locator('[data-archive-delete="bbl-3"]').isEnabled(), true);
        for (const width of [1440,768,390,320]) {
            await page.setViewportSize({width,height:1000});
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            if (process.argv[3]) { fs.mkdirSync(process.argv[3],{recursive:true}); await page.locator('[data-section="archive"]').screenshot({path:path.join(process.argv[3],`archive-delete-${width}.png`)}); }
        }
        page.once('dialog', dialog => dialog.accept()); await page.locator('[data-archive-delete="bbl-3"]').click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations.length), 1);
        await page.evaluate(() => {
            chat_metadata = { bb_map_data:train }; context.chatMetadata = chat_metadata;
            response = { ...train.raw, schematic_name:'Renamed train', archive_location_id:null };
            resetAutoUpdate();
        }); await reply();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations.length), 1, 'First update in an old chat seeds and updates a single archive entry');
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations[0].snapshot.raw.schematic_name), 'Renamed train');
        assert.deepEqual(errors,[]);
        console.log('Stable archive IDs, null/placeholder titles, ambiguous boundaries, evidenced moves, deletion cancel/confirm and memory clearing passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
