import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGraphMapData, normalizeMapData, readMapState, createSavedMap, restorePreviousMap,
    getMapRoute, buildMapContextString, reconcileMapObjects, reconcileMapEffects } from '../map-state.js';

const place = (id, name = id, extra = {}) => ({ id, name, kind: 'room', ...extra });
const passage = (from, to, extra = {}) => ({ from, to, name: 'Door', kind: 'door', status: 'confirmed', evidence: 'An open door joins the rooms.', ...extra });
const input = extra => ({ layout: 'graph', scope: 'scene', schematic_name: 'House', player_place_id: 'hall',
    zones: [place('hall', 'Hall'), place('garden', 'Garden', { kind: 'outdoor' }), place('clinic', 'Clinic')],
    connections: [passage('hall', 'garden'), passage('garden', 'clinic', { kind: 'path', name: 'Footpath' })], ...extra });

test('graph normalization remaps every reference, retains isolated places and does not mutate input', () => {
    const source = input({ zones: [...input().zones, place('shed', 'Shed')] });
    const snapshot = JSON.stringify(source);
    const raw = normalizeGraphMapData(source);
    assert.match(raw.zones[0].id, /^bbp-\d+$/);
    assert.equal(raw.player_place_id, raw.zones[0].id);
    assert.equal(raw.connections[0].to, raw.zones[1].id);
    assert.equal(raw.zones[0].position, undefined);
    assert.equal(getMapRoute(raw, raw.zones[3].id), null);
    assert.equal(JSON.stringify(source), snapshot);
});

test('unique names retain IDs when response keys/order change; explicit prior IDs allow renaming', () => {
    const first = normalizeGraphMapData(input());
    const next = normalizeGraphMapData(input({ zones: [place('c', 'Clinic'), place('g', 'Garden', { kind: 'outdoor' }), place('h', 'Hall')],
        player_place_id: 'h', connections: [passage('g', 'h'), passage('g', 'c', { kind: 'path', name: 'Footpath' })] }), first);
    assert.equal(next.player_place_id, first.player_place_id);
    assert.deepEqual(next.zones.map(p => p.id), [...first.zones].reverse().map(p => p.id));
    assert.equal(next.connections[0].id, first.connections[0].id);
    const renamed = normalizeGraphMapData({ ...first, zones: [place('new', 'Storage'),
        ...first.zones.map(p => p.id === first.player_place_id ? { ...p, name: 'Training hall' } : p)] }, first);
    assert.equal(renamed.zones[1].id, first.player_place_id);
    assert.equal(new Set(renamed.zones.map(p => p.id)).size, 4);
});

test('repeated names receive separate IDs and name-only matching never guesses an identity', () => {
    const first = normalizeGraphMapData(input({ zones: [place('hall', 'Room'), place('garden', 'Room')], connections: [] }));
    const next = normalizeGraphMapData(input({ zones: [place('a', 'Room'), place('b', 'Room')], player_place_id: 'a', connections: [] }), first);
    assert.equal(new Set(next.zones.map(p => p.id)).size, 2);
    assert.ok(next.zones.every(p => !first.zones.some(old => old.id === p.id)));
    const differentScene = normalizeGraphMapData(input({ schematic_name: 'Another house', connections: [] }), first);
    assert.ok(differentScene.zones.every(p => !first.zones.some(old => old.id === p.id)));
});

test('invalid topology rejects dangling references, duplicate IDs/links and unsupported values', () => {
    for (const extra of [
        { scope: 'building' }, { layout: 'grid' }, { player_place_id: 'missing' }, { player_place_id: undefined },
        { zones: [place('hall'), place('hall')] }, { zones: [place('../hall')] },
        { zones: [place('hall', 'Hall', { kind: 'planet' })] }, { zones: [place('hall', 'Hall', { uncertain: 'false' })] },
        { connections: [passage('hall', 'missing')] }, { connections: [passage('hall', 'hall')] },
        { connections: [passage('hall', 'garden'), passage('garden', 'hall')] },
        { connections: [passage('hall', 'garden', { direction: 'sideways' })] },
        { connections: [passage('hall', 'garden', { status: 'open' })] },
        { connections: [passage('hall', 'garden', { kind: 'teleport' })] },
        { connections: [passage('hall', 'garden', { evidence: '' })] },
        { connections: [passage('hall', 'garden', { status: 'blocked', evidence: '' })] },
    ]) assert.throws(() => normalizeGraphMapData(input(extra)), /invalid_map/);
});

test('bounded graph accepts 24 places/48 directed links and rejects excess or oversized text', () => {
    const zones = Array.from({ length: 24 }, (_, i) => place(`p${i}`));
    const connections = [];
    for (let i = 1; i < zones.length; i++) connections.push(passage('p0', `p${i}`, { direction: 'forward' }), passage(`p${i}`, 'p0', { direction: 'forward' }));
    connections.push(passage('p1', 'p2', { direction: 'forward' }), passage('p2', 'p1', { direction: 'forward' }));
    assert.equal(normalizeGraphMapData(input({ zones, connections, player_place_id: null })).connections.length, 48);
    for (const extra of [{ zones: [...zones, place('p24')] }, { zones, connections: [...connections, passage('p2', 'p3')] },
        { zones: [place('hall', 'x'.repeat(1501))], connections: [] },
        { connections: [passage('hall', 'garden', { name: 'x'.repeat(1501) })] }]) {
        assert.throws(() => normalizeGraphMapData(input(extra)), /invalid_map/);
    }
});

test('routes use only confirmed links, honor direction, survive cycles and never move the player', () => {
    const raw = normalizeGraphMapData(input({ connections: [passage('hall', 'garden', { direction: 'forward' }),
        passage('garden', 'clinic'), passage('clinic', 'hall', { status: 'uncertain', evidence: '' })] }));
    const snapshot = JSON.stringify(raw), [hall, garden, clinic] = raw.zones;
    assert.deepEqual(getMapRoute(raw, clinic.id), { places: [hall.id, garden.id, clinic.id], connections: raw.connections.slice(0, 2).map(e => e.id) });
    assert.deepEqual(getMapRoute(raw, hall.id), { places: [hall.id], connections: [] });
    assert.equal(getMapRoute({ ...raw, player_place_id: garden.id }, hall.id), null);
    assert.equal(getMapRoute({ ...raw, connections: raw.connections.map(e => ({ ...e, status: 'blocked' })) }, clinic.id), null);
    assert.equal(getMapRoute({ ...raw, player_place_id: null }, clinic.id), null);
    assert.equal(getMapRoute(raw, 'missing'), null);
    assert.equal(JSON.stringify(raw), snapshot);
});

test('legacy read preserves original strings, context and snapshot; future versions are rejected', () => {
    const saved = { raw: { schematic_name: 'Old', zones: [{ name: 'Hall', position: 'center', poi: ['Key'] },
        { name: 'Garden', position: 'north' }] }, context: 'Original text', previous: { raw: { unchanged: true } } };
    const snapshot = JSON.stringify(saved), read = readMapState(saved);
    assert.equal(read.zones[0].poi[0].name, 'Key');
    assert.equal(read.connections, undefined); // Grid positions do not establish passages.
    assert.equal(read.layout, undefined);
    assert.equal(JSON.stringify(saved), snapshot);
    assert.equal(readMapState({ ...saved, version: 2 }).zones.length, 2);
    assert.throws(() => readMapState({ ...saved, version: 4 }), /invalid_map/);
    assert.throws(() => readMapState({ raw: normalizeGraphMapData(input()), version: 2 }), /invalid_map/);
    assert.throws(() => normalizeMapData(input()), /invalid_map/);
});

test('version 3 save/read and rollback preserve graph IDs and original version 2 data', () => {
    const old = createSavedMap(normalizeMapData({ schematic_name: 'Old', zones: [{ name: 'Hall', position: 'center' }] }));
    const raw = normalizeGraphMapData(input()), saved = createSavedMap(raw, old), snapshot = JSON.stringify(saved);
    assert.equal(saved.version, 3);
    assert.deepEqual(readMapState(saved), raw);
    assert.equal(JSON.stringify(saved), snapshot);
    const restored = restorePreviousMap(saved);
    assert.equal(restored.version, 2);
    assert.equal(restored.raw, old.raw);
    assert.equal(restorePreviousMap(restored).version, 3);
    assert.equal(restorePreviousMap(restored).raw, raw);
    assert.equal(saved.previous.previous, undefined);
});

test('graph contents preserve existing entity/effect IDs and scene possession reconciliation', () => {
    const legacy = normalizeMapData({ schematic_name: 'House', zones: [{ position: 'center', name: 'Hall',
        poi: [{ name: 'Key', item_state: 'held', holder: 'Player', state_reason: 'Picked up.' }], characters: [{ name: 'Mira' }] }],
        effects: [{ name: 'Smoke', scope: 'zone', target: 'Hall', description: 'Smoke obscures sight.', source: 'Fire', expires_when: 'Smoke clears.' }] });
    const raw = normalizeGraphMapData(input({ zones: [place('hall', 'Hall', { characters: [{ name: 'Mira' }] }), place('garden', 'Garden')],
        effects: legacy.effects, connections: [] }), legacy);
    const reconciled = reconcileMapEffects(reconcileMapObjects(raw, legacy, 'Player'), legacy, 'Player');
    assert.equal(reconciled.zones[0].characters[0].id, legacy.zones[0].characters[0].id);
    assert.equal(reconciled.unlocated_objects[0].id, legacy.zones[0].poi[0].id);
    assert.equal(reconciled.effects[0].id, legacy.effects[0].id);
});

test('reading stored graph preserves resolved IDs of repeated objects and characters', () => {
    const raw = normalizeGraphMapData(input({ zones: [place('hall', 'Hall', { poi: ['Key', 'Key'], characters: [{ name: 'Guard' }, { name: 'Guard' }] })], connections: [] }));
    const saved = createSavedMap(raw), snapshot = JSON.stringify(saved);
    assert.deepEqual(readMapState(saved), raw);
    assert.deepEqual(readMapState(saved), readMapState(saved));
    assert.equal(JSON.stringify(saved), snapshot);
    const duplicate = structuredClone(saved);
    duplicate.raw.zones[0].poi[1].id = duplicate.raw.zones[0].poi[0].id;
    assert.throws(() => readMapState(duplicate), /invalid_map/);
    const graph = createSavedMap(normalizeGraphMapData(input()));
    delete graph.raw.connections[0].id;
    assert.throws(() => readMapState(graph), /invalid_map/);
});

test('context includes empty places, explicit position and uncertain/blocked paths without claiming adjacency', () => {
    const raw = normalizeGraphMapData(input({ player_place_id: null, connections: [
        passage('hall', 'garden', { status: 'uncertain', evidence: '' }), passage('garden', 'clinic', { status: 'blocked', evidence: 'Collapsed stairs.' }),
    ] }));
    const text = buildMapContextString(raw);
    assert.match(text, /Player position: unknown/);
    assert.match(text, /Zone "Clinic"/);
    assert.match(text, /uncertain/);
    assert.match(text, /blocked.*Collapsed stairs/);
    assert.match(text, /Missing connections are unknown/);
    assert.doesNotMatch(text, /undefined|\(center\)/);
});
