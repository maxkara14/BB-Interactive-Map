import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMapData, createSavedMap, restorePreviousMap, buildMapContextString, isSameChat } from '../map-state.js';

test('chat guard rejects a different chat even when SillyTavern reuses the message array', () => {
    const messages = [];
    const first = { chatId: 'first', characterId: 1, groupId: null, chatMetadata: {}, chat: messages };
    const second = { ...first, chatId: 'second', chatMetadata: {} };
    assert.equal(isSameChat(first, first), true);
    assert.equal(isSameChat(first, second), false);
    assert.equal(first.chat, second.chat);
});

test('chat guard rejects a reloaded chat and an unselected chat', () => {
    const first = { chatId: 'first', characterId: 1, groupId: null, chatMetadata: {} };
    assert.equal(isSameChat(first, { ...first, chatMetadata: {} }), false);
    assert.equal(isSameChat({ ...first, chatId: undefined }, first), false);
});

const zone = (position, extras = {}) => ({
    position,
    name: position,
    summary: 'A room',
    threat_level: 'safe',
    poi: [],
    characters: [],
    ...extras,
});

test('legacy string objects become named records only in a new candidate', () => {
    const legacy = { schematic_name: 'House', zones: [zone('center', { poi: ['Copper key'] })] };
    const candidate = normalizeMapData(legacy);
    assert.equal(legacy.zones[0].poi[0], 'Copper key');
    assert.equal(candidate.zones[0].poi[0].name, 'Copper key');
    assert.equal(candidate.zones[0].poi[0].description, '');
    assert.match(candidate.zones[0].poi[0].id, /^bbm-\d+$/);
    assert.match(buildMapContextString(candidate), /Objects: Copper key/);
});

test('unique character and object keep IDs after moving zones', () => {
    const first = normalizeMapData({
        schematic_name: 'House', zones: [zone('center', {
            poi: [{ name: 'Copper key', description: 'On the table' }],
            characters: [{ name: 'Mira', description: 'A guard' }],
        })],
    });
    const next = normalizeMapData({
        schematic_name: 'House', zones: [zone('north', {
            poi: [{ name: 'Copper key', description: 'In the drawer' }],
            characters: [{ name: 'Mira', description: 'A guard' }],
        })],
    }, first);
    assert.equal(next.zones[0].poi[0].id, first.zones[0].poi[0].id);
    assert.equal(next.zones[0].characters[0].id, first.zones[0].characters[0].id);
    assert.equal(next.zones[0].poi[0].description, 'In the drawer');
});

test('ambiguous repeated names receive separate IDs', () => {
    const map = normalizeMapData({
        schematic_name: 'House', zones: [zone('north', { poi: ['Key'] }), zone('south', { poi: ['Key'] })],
    });
    assert.notEqual(map.zones[0].poi[0].id, map.zones[1].poi[0].id);
});

test('duplicate positions merge without hiding danger', () => {
    const map = normalizeMapData({
        schematic_name: 'House', zones: [
            zone('center', { poi: ['Table'] }),
            zone('center', { threat_level: 'danger', threat_reason: 'Fire', poi: ['Door'] }),
        ],
    });
    assert.equal(map.zones.length, 1);
    assert.equal(map.zones[0].threat_level, 'danger');
    assert.equal(map.zones[0].poi.length, 2);
});

test('invalid positions and threat values reject the scan', () => {
    assert.throws(() => normalizeMapData({ schematic_name: 'House', zones: [zone('above')] }), /invalid_map/);
    assert.throws(() => normalizeMapData({ schematic_name: 'House', zones: [zone('center', { threat_level: '__proto__' })] }), /invalid_map/);
});

test('saving a new scan preserves one legacy snapshot for recovery', () => {
    const old = { raw: { schematic_name: 'Old', zones: [zone('center', { poi: ['Key'] })] }, context: 'Old context' };
    const candidate = normalizeMapData({ schematic_name: 'New', zones: [zone('center')] }, old.raw);
    const saved = createSavedMap(candidate, old);
    assert.equal(saved.version, 2);
    assert.equal(saved.previous.version, 1);
    assert.equal(saved.previous.raw, old.raw);
    assert.equal(old.raw.zones[0].poi[0], 'Key');
    assert.equal(saved.previous.previous, undefined);
    const restored = restorePreviousMap(saved);
    assert.equal(restored.version, 1);
    assert.equal(restored.raw, old.raw);
    assert.equal(restored.previous.raw, candidate);
    assert.equal(restorePreviousMap(restored).raw, candidate);
});
