import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getMapMode, getMapTransition, createTravelDraft, normalizeMapData, createSavedMap } from '../map-state.js';

const raw = normalizeMapData({ schematic_name: 'Поместье', zones: [
    { position: 'center', name: 'Зал' }, { position: 'north', name: 'Сад', threat_level: 'danger', threat_reason: 'Пожар' },
] });

test('mode defaults to classic and travel requires an existing neighbor and a center', () => {
    assert.equal(getMapMode(null), 'classic');
    assert.equal(getMapMode({ bb_map_mode: 'invalid' }), 'classic');
    assert.equal(getMapMode({ bb_map_mode: 'game' }), 'game');
    assert.equal(getMapTransition(raw, 'north').to.threat_reason, 'Пожар');
    for (const position of ['center', 'west', 'invalid']) assert.equal(getMapTransition(raw, position), null);
    assert.equal(getMapTransition({ zones: [raw.zones[1]] }, 'north'), null);
});

test('travel draft preserves existing text and saved state in RU and EN', () => {
    const snapshot = JSON.stringify(raw);
    const route = getMapTransition(raw, 'north');
    assert.equal(createTravelDraft('Мой текст  ', route, 'ru'), 'Мой текст  \n\nЯ направляюсь из зоны «Зал» в зону «Сад».');
    assert.equal(createTravelDraft('', route, 'en'), 'I head from "Зал" to "Сад".');
    assert.equal(JSON.stringify(raw), snapshot);
});

function runtime() {
    const state = fs.readFileSync(new URL('../map-state.js', import.meta.url), 'utf8').replace(/^export /gm, '');
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const setup = source.slice(0, source.indexOf('jQuery(async () => {')).replace(/^import .*;\r?\n/gm, '');
    const metadata = { bb_map_data: createSavedMap(raw), bb_map_mode: 'game' };
    const chat = { chatId: 'test', characterId: 1, groupId: null, chatMetadata: metadata, chat: [{ name: 'Player', mes: 'I try to reach the garden.' }] };
    const context = { chat_metadata: metadata, extension_settings: { 'BB-Interactive-Map': {} },
        SillyTavern: { getContext: () => chat }, navigator: { language: 'en' } };
    vm.runInNewContext(`${state}\n${setup}\nglobalThis.api = { getMapContextForCurrentChat, createMapCandidate };`, context);
    return { context, metadata, chat, api: context.api };
}

test('game context is temporary and classic mode restores exact saved memory', () => {
    const { api, metadata } = runtime();
    const snapshot = JSON.stringify(metadata.bb_map_data);
    assert.match(api.getMapContextForCurrentChat(), /A requested transition is an attempt/);
    metadata.bb_map_mode = 'classic';
    assert.equal(api.getMapContextForCurrentChat(), metadata.bb_map_data.context);
    assert.equal(JSON.stringify(metadata.bb_map_data), snapshot);
});

test('game scanning requires narrative support and discards results after a mode change', async () => {
    const { context, metadata, chat, api } = runtime();
    let finish;
    let prompt;
    context.generateQuietPrompt = params => {
        prompt = params.quietPrompt;
        return new Promise(resolve => { finish = resolve; });
    };
    const scanning = api.createMapCandidate(chat, 'global');
    assert.match(prompt, /A requested movement alone is not a completed transition/);
    assert.doesNotMatch(prompt, /Invent logical surrounding locations/);
    metadata.bb_map_mode = 'classic';
    finish(JSON.stringify(raw));
    assert.equal(await scanning, null);
});
