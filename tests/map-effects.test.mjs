import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMapData, reconcileMapEffects, requiresEffectReview, getMapEffectChanges, buildMapEffectsContext,
    createSavedMap, restorePreviousMap } from '../map-state.js';

const effect = extra => ({ name: 'Smoke', scope: 'zone', target: 'Hall', description: 'Smoke obscures sight.',
    source: 'A smoking brazier', expires_when: 'The smoke disperses after ventilation.', evidence: 'The brazier started smoking.', ...extra });
const make = (effects, previous = null, scene = 'House', zone = 'Hall', chars = ['Mira']) => normalizeMapData({ schematic_name: scene,
    zones: [{ name: zone, position: 'center', characters: chars.map(name => ({ name })) }], ...(effects === undefined ? {} : { effects }) }, previous);

test('legacy maps remain unchanged; effects validate their fields, enums, duplicates and bound', () => {
    const legacy = make(undefined);
    assert.equal(legacy.effects, undefined);
    for (const patch of [{ source: '' }, { expires_when: '' }, { scope: 'inventory' }, { status: 'expired' },
        { status: 'ended', evidence: '' }, { uncertain: 'false' }, { name: 'x'.repeat(1501) }]) {
        assert.throws(() => make([effect(patch)]), /invalid_effects/);
    }
    assert.throws(() => make([effect(), effect()]), /invalid_effects/);
    assert.throws(() => make(Array.from({ length: 17 }, (_, i) => effect({ name: String(i) }))), /invalid_effects/);
});

test('omission is not expiry; evidence-backed ending keeps ID and supports rollback', () => {
    const active = reconcileMapEffects(make([effect()]));
    const snapshot = JSON.stringify(active);
    const omitted = reconcileMapEffects(make([], active), active);
    assert.equal(omitted.effects.length, 1);
    assert.equal(omitted.effects[0].id, active.effects[0].id);
    assert.equal(requiresEffectReview(active, omitted), false);
    const ended = reconcileMapEffects(make([effect({ status: 'ended', evidence: 'Open windows cleared the smoke.' })], active), active);
    assert.equal(ended.effects[0].id, active.effects[0].id);
    assert.equal(getMapEffectChanges(active, ended)[0].action, 'ended');
    assert.equal(buildMapEffectsContext(ended), '');
    assert.equal(requiresEffectReview(active, ended), false);
    const saved = createSavedMap(ended, createSavedMap(active));
    assert.deepEqual(restorePreviousMap(saved).raw, active);
    assert.equal(reconcileMapEffects(make([], ended), ended).effects.length, 0);
    assert.equal(JSON.stringify(active), snapshot);
    assert.doesNotMatch(createSavedMap(active).context, /Temporary scene effects/);
});

test('uncertain additions and endings, and additions without evidence, require review', () => {
    const active = make([effect()]);
    for (const value of [effect({ uncertain: true }), effect({ evidence: '' })]) {
        assert.equal(requiresEffectReview(make([]), make([value])), true);
    }
    assert.equal(requiresEffectReview(active, make([effect({ status: 'ended', uncertain: true })], active)), true);
});

test('scoped effects drop with old scenes/zones/NPCs, while player bodily effects follow the player', () => {
    const old = make([effect(), effect({ name: 'Cold air', scope: 'scene', target: 'House' }),
        effect({ name: 'Trembling', scope: 'character', target: 'Mira' }), effect({ name: 'Sore arm', scope: 'character', target: 'Player',
            description: 'An aching forearm.', source: 'A recent impact', expires_when: 'The pain subsides with rest.' })]);
    let previous = old;
    for (let i = 0; i < 40; i++) {
        const next = reconcileMapEffects(make([], previous, `Garden ${i}`, `Path ${i}`, []), previous, 'Player');
        assert.deepEqual(next.effects.map(e => e.name), ['Sore arm']);
        assert.match(buildMapEffectsContext(next, 'Player'), /Sore arm/);
        assert.doesNotMatch(buildMapEffectsContext(next, 'Player'), /Smoke|Cold air|Trembling/);
        previous = next;
    }
});
