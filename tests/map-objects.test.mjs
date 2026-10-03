import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMapData, reconcileMapObjects, requiresObjectReview, getMapObjects, getMapChanges, createSavedMap, restorePreviousMap } from '../map-state.js';
import { createMapMentionIndex } from '../map-links.js';

const make = (poi, previous = null, extra = {}) => normalizeMapData({ schematic_name: 'Hall', zones: [
    { position: 'center', name: 'Rack', poi, characters: [{ name: 'Mira' }] },
], ...extra }, previous);
const item = (state, extra = {}) => ({ name: 'Bokken', item_state: state, state_reason: 'Established in the reply', ...extra });

test('a narrated transfer keeps the object ID, is reviewed and can be rolled back', () => {
    const first = reconcileMapObjects(make([item('zone')]));
    const held = reconcileMapObjects(make([item('held', { holder: 'Mira' })], first), first);
    assert.equal(held.zones[0].poi[0].id, first.zones[0].poi[0].id);
    assert.equal(requiresObjectReview(first, held), false);
    assert.ok(getMapChanges(first, held).some(change => change.fields.some(field => field.key === 'holder')));
    const saved = createSavedMap(held, createSavedMap(first));
    assert.match(saved.context, /held by Mira/);
    assert.deepEqual(restorePreviousMap(saved).raw, first);
    assert.equal(first.zones[0].poi[0].item_state, 'zone');
});

test('uncertain transfers and transfers without evidence require confirmation', () => {
    const first = make([item('zone')]);
    for (const extra of [{ uncertain: true }, { state_reason: '' }]) {
        const held = make([item('held', { holder: 'Mira', ...extra })], first);
        assert.equal(requiresObjectReview(first, held), true);
    }
    assert.equal(requiresObjectReview(first, make([item('zone')], first)), false);
});

test('unmentioned held items follow present actors without inventing loss', () => {
    const held = make([item('held', { holder: 'Mira' })]);
    const gone = reconcileMapObjects(make([], held), held);
    assert.equal(gone.zones[0].poi.length, 0);
    assert.equal(gone.unlocated_objects[0].id, held.zones[0].poi[0].id);
    assert.equal(gone.unlocated_objects[0].item_state, 'held');
    assert.equal(gone.unlocated_objects[0].holder, 'Mira');
    assert.equal(requiresObjectReview(held, gone), false);
    const again = reconcileMapObjects(make([], gone), gone);
    assert.equal(requiresObjectReview(gone, again), false);
    assert.equal(again.unlocated_objects.length, 1);
    const reported = reconcileMapObjects(make([], gone, { unlocated_objects: [item('unknown')] }), gone);
    assert.equal(reported.unlocated_objects[0].last_known, 'Mira');
    assert.equal(createMapMentionIndex(gone).entries.get('bokken').item_state, 'held');
    assert.equal(createMapMentionIndex(reported).entries.has('bokken'), false);
    const returned = reconcileMapObjects(make([item('zone')], gone), gone);
    assert.equal(returned.zones[0].poi[0].id, held.zones[0].poi[0].id);
    assert.equal(returned.unlocated_objects.length, 0);
});

test('unknown holders require review while the active player can hold an item', () => {
    const first = make([item('zone')]);
    const held = make([item('held', { holder: 'Player' })], first);
    assert.equal(requiresObjectReview(first, held), true);
    assert.equal(requiresObjectReview(first, held, 'Player'), false);
    assert.equal(requiresObjectReview(first, held, 'player'), false);
});

test('outside-grid objects validate, get unique IDs and remain in memory context', () => {
    const raw = make([], null, { unlocated_objects: [item('held', { holder: 'Player' })] });
    assert.equal(getMapObjects(raw).length, 1);
    assert.match(raw.unlocated_objects[0].id, /^bbm-\d+$/);
    assert.match(createSavedMap(raw).context, /outside the current grid: Bokken \(held by Player\)/);
    assert.throws(() => make([], null, { unlocated_objects: [item('zone')] }), /invalid_map/);
    for (const invalid of [item('held'), item('missing'), item('zone', { uncertain: 'false' })]) {
        assert.throws(() => make([invalid]), /invalid_map/);
    }
});

test('scene changes drop surroundings and departed NPC belongings but carry player possessions', () => {
    const old = make([item('held', { holder: 'Player' }), { name: 'Floor', item_state: 'zone' },
        { name: 'Clipboard', item_state: 'held', holder: 'Mira' }]);
    let previous = old;
    const staleNPC = normalizeMapData({ schematic_name: 'Garden', zones: [{ position: 'center', name: 'Garden',
        poi: [{ name: 'Clipboard', item_state: 'held', holder: 'Mira' }] }] }, old);
    assert.equal(getMapObjects(reconcileMapObjects(staleNPC, old, 'Player')).some(item => item.name === 'Clipboard'), false);
    for (let i = 0; i < 40; i++) {
        const scan = normalizeMapData({ schematic_name: `Scene ${i}`, zones: [{ position: 'center', name: `Room ${i}`,
            poi: [{ name: `Scenery ${i}`, item_state: 'zone' }] }] }, previous);
        const next = reconcileMapObjects(scan, previous, 'Player');
        assert.equal(next.unlocated_objects.length, 1);
        assert.equal(next.unlocated_objects[0].name, 'Bokken');
        assert.equal(next.unlocated_objects[0].id, old.zones[0].poi[0].id);
        assert.equal(getMapObjects(next).length, 2);
        const context = createSavedMap(next).context;
        assert.doesNotMatch(context, /Floor|Clipboard|Mira/);
        previous = next;
    }
    const dropped = make([], previous, { unlocated_objects: [item('left', { state_reason: 'Player left the sword at the old rack.' })] });
    const next = reconcileMapObjects(dropped, previous, 'Player');
    assert.equal(next.unlocated_objects[0].item_state, 'left');
    assert.equal(requiresObjectReview(previous, next, 'Player'), false);
    assert.doesNotMatch(createSavedMap(next).context, /Bokken/);
    assert.equal(createMapMentionIndex(next).entries.has('bokken'), false);
    assert.equal(reconcileMapObjects(make([], next), next, 'Player').unlocated_objects.length, 0);
});

test('legacy unknown lists are cleaned only in a reviewed candidate and remain recoverable', () => {
    const old = make([], null, { unlocated_objects: [{ name: 'Old floor', item_state: 'unknown', last_known: 'Old room' }] });
    const oldSnapshot = JSON.stringify(old);
    const next = reconcileMapObjects(make([], old), old, 'Player');
    assert.equal(next.unlocated_objects.length, 0);
    assert.equal(requiresObjectReview(old, next, 'Player'), true);
    assert.doesNotMatch(createSavedMap(old).context, /Old floor/);
    assert.equal(JSON.stringify(old), oldSnapshot);
    const saved = createSavedMap(next, { raw: old, context: 'old memory' });
    assert.deepEqual(restorePreviousMap(saved).raw, old);
    assert.equal(requiresObjectReview(next, reconcileMapObjects(make([], next), next, 'Player'), 'Player'), false);
});

test('explicit uncertain fate of player possessions requires review and does not become an archive', () => {
    const held = make([item('held', { holder: 'Player' })]);
    const unknown = reconcileMapObjects(make([], held, { unlocated_objects: [item('unknown', { uncertain: true })] }), held, 'Player');
    assert.equal(unknown.unlocated_objects[0].last_known, 'Player');
    assert.equal(requiresObjectReview(held, unknown, 'Player'), true);
    assert.doesNotMatch(createSavedMap(unknown).context, /Bokken/);
    assert.equal(reconcileMapObjects(make([], unknown), unknown, 'Player').unlocated_objects.length, 0);
    assert.throws(() => make([], null, { unlocated_objects: [item('left', { state_reason: '' })] }), /invalid_map/);
    assert.throws(() => make([item('left')]), /invalid_map/);
});

test('a legacy-format scan preserves tracked possession without mutating old maps', () => {
    const held = make([item('held', { holder: 'Mira' })]);
    const next = reconcileMapObjects(make(['Bokken'], held), held);
    assert.equal(next.zones[0].poi[0].item_state, 'held');
    assert.equal(next.zones[0].poi[0].holder, 'Mira');
    assert.equal(requiresObjectReview(held, next), false);
    const legacy = make(['Old floor']);
    assert.equal(legacy.zones[0].poi[0].item_state, undefined);
});
