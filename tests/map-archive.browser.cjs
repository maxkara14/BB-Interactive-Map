// Real archive/settings/scan/view/save handlers on synthetic chats only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const strip = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const screenshots = process.argv[3];
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px;box-sizing:border-box;background:#10151b;color:#e2e8f0;font-family:system-ui"><div id="extensions_settings" style="width:440px;max-width:100%"></div><textarea id="send_textarea"></textarea></body>');
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-topology-view.js'))}
            var extension_settings = { 'BB-Interactive-Map': { uiLanguage: 'en', autoUpdate: true, autoApply: true, widgetCollapsed: false } };
            var chat_metadata = { bb_map_mode: 'game' }, writes = 0, requests = 0, notices = [], prompts = [], injected = '';
            var context = { chatId: 'one', characterId: 1, groupId: null, chatMetadata: chat_metadata, name1: 'Player',
                chat: [{ name: 'Character', mes: 'Player returned to the Estate hall.', is_user: false }] };
            var SillyTavern = { getContext: () => context };
            var toastr = Object.fromEntries(['error','warning','info','success'].map(key => [key, message => notices.push(message)]));
            var saveSettingsDebounced = () => {}, saveChatDebounced = () => writes++, saveChatConditional = async () => writes++;
            var isChatSaving = false, setExtensionPrompt = (key, text) => { injected = text; }, extension_prompt_types = { IN_CHAT: 0 }, extension_prompt_roles = { USER: 0 };
            var scene = (name, place) => ({ layout: 'graph', scope: 'scene', schematic_name: name,
                player_place_id: place, zones: [{ id: place, name: place, kind: 'room' }], connections: [] });
            var estate = scene('Estate', 'hall'); estate.zones[0].characters = [{ name: 'Old visitor' }];
            estate.zones[0].poi = [{ name: 'Old sofa' }];
            estate.effects = [{ name: 'Old smoke', scope: 'scene', target: 'Estate', description: 'Smoke filled the room',
                source: 'Old fire', expires_when: 'Ventilation', status: 'active', evidence: 'An old fire' }];
            var forest = scene('Forest', 'clearing'); forest.zones[0].kind = 'outdoor';
            forest.zones[0].poi = [{ name: 'Sword', item_state: 'held', holder: 'Player', state_reason: 'Player carried it' }];
            var originalEstate = createSavedMap(normalizeGraphMapData(estate));
            var originalForest = createSavedMap(reconcileMapObjects(normalizeGraphMapData(forest), null, 'Player'));
            chat_metadata.bb_map_data = originalForest;
            chat_metadata.bb_map_archive = recordArchivedMap(recordArchivedMap(readLocationArchive({}), originalEstate), originalForest);
            var nextResponse = { ...scene('Estate', 'hall'), archive_location_id: 'bbl-1', location_evidence: 'Player returned to the Estate hall.' };
            var hold = false, finishResponse;
            var generateQuietPrompt = async params => { requests++; prompts.push(params.quietPrompt);
                if (hold) return new Promise(resolve => { finishResponse = resolve; });
                return JSON.stringify(nextResponse); };
            ${strip(read('index.js').split('jQuery(async () => {')[0])}
            injectCurrentMapContext(); setupExtensionSettings(); renderMapWidget();
        ` });
        const openSettings = async section => {
            await page.locator('#bb-map-settings-wrapper > .inline-drawer-content').evaluate(el => { el.style.display = 'block'; });
            await page.locator(`details[data-section="${section}"]`).evaluate(el => { el.open = true; });
        };
        await page.evaluate(() => handleMessageReceived(0, 'normal'));
        await page.waitForFunction(() => autoStatus === 'ready');
        assert.equal(await page.evaluate(() => writes), 0);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data === originalForest), true);
        assert.match(await page.evaluate(() => BBInteractiveMap.getContext()), /Forest/);
        await openSettings('archive');
        assert.equal(await page.locator('.bb-map-archive-entry').count(), 2);
        if (screenshots) {
            fs.mkdirSync(screenshots, { recursive: true });
            for (const width of [1440, 768, 390]) {
                await page.setViewportSize({ width, height: 900 });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                await page.screenshot({ path: path.join(screenshots, `archive-${width}.png`) });
            }
        }
        await page.locator('[data-location-id="bbl-1"]').getByRole('button', { name: 'View', exact: true }).click();
        assert.equal(await page.locator('#bb-map-edit-btn').isVisible(), false);
        assert.equal(await page.locator('#bb-map-overlay [data-map-scan]').count(), 0);
        assert.equal(await page.locator('#bb-map-save-btn').isDisabled(), true);
        await page.locator('.bb-topology-place').first().click();
        assert.equal(await page.locator('#bb-map-travel button').count(), 0);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data === originalForest && writes === 0), true);
        await page.locator('#bb-map-back-btn').click();
        await page.evaluate(() => showRadarModal(autoCandidate, false, autoCandidateChat, autoCandidateBase));
        assert.equal(await page.locator('.bb-map-location-suggestion').count(), 1);
        assert.equal(await page.locator('#bb-map-save-btn').isDisabled(), true);
        if (screenshots) {
            await page.waitForFunction(() => getComputedStyle(document.getElementById('bb-map-overlay')).opacity === '1');
            for (const width of [1440, 768, 390]) {
                await page.setViewportSize({ width, height: 900 });
                await page.screenshot({ path: path.join(screenshots, `return-${width}.png`) });
            }
        }
        await page.getByRole('button', { name: 'RETURN AND REFRESH', exact: true }).click();
        await page.waitForFunction(() => !scanInProgress && autoStatus === 'ready' && !candidateLocations.get(autoCandidate).needsConfirmation);
        assert.equal(await page.evaluate(() => requests), 2);
        assert.equal(await page.evaluate(() => writes), 0);
        const returnPrompt = await page.evaluate(() => prompts.at(-1));
        assert.doesNotMatch(returnPrompt, /Old visitor|Old sofa|Old smoke/);
        assert.match(returnPrompt, /Sword/);
        assert.match(returnPrompt, /Selecting a map is not narrative movement/);
        // An accepted return preview still cannot save over a newer narrative.
        await page.evaluate(() => { context.chat[0].mes = 'Player leaves the Estate.'; });
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => writes), 0);
        assert.match(await page.evaluate(() => notices.at(-1)), /scene changed/i);
        await page.evaluate(() => { context.chat[0].mes = 'Player returned to the Estate hall.'; });
        // Editing the refreshed map must keep its destination archive ID.
        await page.locator('#bb-map-edit-btn').click();
        await page.locator('.bb-map-edit-fields [name="atmosphere"]').fill('Evening');
        await page.getByRole('button', { name: 'PREVIEW EDITS', exact: true }).click();
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => writes), 1);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations.length), 2);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.activeId), 'bbl-1');
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.unlocated_objects[0].name), 'Sword');
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data.raw.effects.length), 0);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations[1].snapshot.raw.schematic_name), 'Forest');
        assert.match(await page.evaluate(() => BBInteractiveMap.getContext()), /Estate/);
        await page.locator('#bb-map-back-btn').click();
        await page.setViewportSize({ width: 1440, height: 1000 });
        await openSettings('archive');
        // Selecting Forest while the story is still in Estate cannot teleport the player.
        await page.evaluate(() => { nextResponse.archive_location_id = null; });
        await page.locator('[data-location-id="bbl-2"]').getByRole('button', { name: 'Return and refresh', exact: true }).click();
        await page.waitForFunction(() => !scanInProgress);
        assert.equal(await page.evaluate(() => writes), 1);
        assert.match(await page.evaluate(() => notices.at(-1)), /does not establish a return/);
        // A ready return may explicitly be saved as a distinct same-named location.
        await page.evaluate(() => {
            context.chat[0].mes = 'Player returned to the Forest clearing.';
            nextResponse = { ...scene('Forest', 'clearing'), archive_location_id: 'bbl-2', location_evidence: context.chat[0].mes };
            handleMessageReceived(0, 'normal');
        });
        await page.waitForFunction(() => autoStatus === 'ready');
        await page.evaluate(() => showRadarModal(autoCandidate, false, autoCandidateChat, autoCandidateBase));
        await page.getByRole('button', { name: 'THIS IS A NEW LOCATION', exact: true }).click();
        await page.locator('#bb-map-save-btn').click();
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.locations.length), 3);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.activeId), 'bbl-3');
        await page.locator('#bb-map-back-btn').click();
        await openSettings('archive');
        // Cancelling a refresh cannot change the active snapshot.
        await page.evaluate(() => { hold = true; finishResponse = null; });
        await page.locator('[data-location-id="bbl-1"]').getByRole('button', { name: 'Return and refresh', exact: true }).click();
        await page.waitForFunction(() => !!finishResponse);
        await page.locator('details[data-section="archive"] [data-map-cancel]').click();
        await page.evaluate(() => finishResponse(JSON.stringify(nextResponse)));
        await page.waitForFunction(() => !scanInProgress);
        assert.equal(await page.evaluate(() => writes), 2);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_archive.activeId), 'bbl-3');
        // Late completion belongs to its original chat only.
        await page.evaluate(() => { hold = true; finishResponse = null; });
        await page.locator('[data-location-id="bbl-1"]').getByRole('button', { name: 'Return and refresh', exact: true }).click();
        await page.waitForFunction(() => !!finishResponse);
        await page.evaluate(() => {
            context = { ...context, chatId: 'two', chatMetadata: {} }; chat_metadata = context.chatMetadata;
            finishResponse(JSON.stringify(nextResponse));
        });
        await page.waitForFunction(() => !scanInProgress);
        assert.equal(await page.evaluate(() => chat_metadata.bb_map_data), undefined);
        assert.equal(await page.evaluate(() => writes), 2);
        assert.deepEqual(errors, []);
        console.log('Archive proposals, read-only views, refresh/edit/save, carried items, stale narrative, cancellation, duplicate labels and chat isolation passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
