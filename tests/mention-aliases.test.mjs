import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGraphMapData, normalizeMapData, normalizeMentionAliases, createSavedMap, readMapState,
    buildMapContextString, readLocationArchive, recordArchivedMap, restorePreviousMap, reconcileMapObjects, getMapChanges } from '../map-state.js';
import { createMapMentionIndex, findMapMentions } from '../map-links.js';

const scene = (extras = {}) => ({ layout: 'graph', scope: 'scene', schematic_name: 'Estate', player_place_id: 'veranda',
    zones: [{ id: 'veranda', name: 'Веранда дома', kind: 'room', mention_aliases: ['веранде'],
        characters: [{ name: 'Химари', mention_aliases: ['Химари-сан', 'Химари Асахина'] }],
        poi: [{ name: 'Раздвижные сёдзи', mention_aliases: ['сёдзи', 'раздвижными сёдзи'] },
            { name: 'Ступени крыльца', mention_aliases: ['ступень', 'ступени', 'ступеням', 'ступени крыльца'] }], ...extras }], connections: [] });
const matches = (text, raw, seen) => findMapMentions(text, createMapMentionIndex(raw), seen);

test('supplied shoji and porch forms link to their canonical objects', () => {
    const raw = normalizeGraphMapData(scene());
    const index = createMapMentionIndex(raw);
    const text = 'Тоё задвинула бумажную раму сёдзи и остановилась у верхней ступени. Писарь подошёл к ступеням.';
    const found = findMapMentions(text, index, new Set());
    assert.deepEqual(found.map(match => match.text), ['сёдзи', 'ступени']);
    assert.deepEqual(found.map(match => index.entries.get(match.key).name), ['Раздвижные сёдзи', 'Ступени крыльца']);
    for (const match of found) assert.equal(text.slice(match.start, match.end), match.text);
});

test('explicit aliases work for arbitrary new nouns, names and languages without dictionary additions', () => {
    for (const [name, aliases] of [
        ['Эбонитовый зажим', ['зажима', 'зажимом']], ['Корзина с рыбой', ['корзина', 'корзиной']],
        ['Orb of Tides', ['tide orb', 'the orb']], ['星の灯籠', ['灯籠の光', '星灯籠']],
    ]) {
        const raw = normalizeGraphMapData(scene({ poi: [{ name, mention_aliases: aliases }] }));
        const index = createMapMentionIndex(raw);
        for (const alias of aliases) {
            const found = findMapMentions(`✨ ${alias} ✨`, index);
            assert.equal(found.length, 1, alias);
            assert.equal(index.entries.get(found[0].key).name, name);
        }
    }
});

test('place and character aliases share the canonical entry and one slot across text nodes', () => {
    const index = createMapMentionIndex(normalizeGraphMapData(scene())), seen = new Set();
    assert.deepEqual(findMapMentions('Химари-сан на веранде.', index, seen).map(match => match.text), ['Химари-сан', 'веранде']);
    assert.deepEqual(findMapMentions('Химари Асахина, Химари, Веранда дома.', index, seen), []);
});

test('conflicting aliases across objects, places and characters are skipped, including a longer conflicting phrase', () => {
    const raw = normalizeGraphMapData(scene({ mention_aliases: ['корзина'], characters: [{ name: 'Рыбак', mention_aliases: ['гость'] }],
        poi: [{ name: 'Корзина с рыбой', mention_aliases: ['корзина', 'гость', 'рыбная корзина'] },
            { name: 'Корзина с бельём', mention_aliases: ['корзина', 'рыбная корзина'] }] }));
    assert.deepEqual(matches('корзина, гость, рыбная корзина.', raw), []);
    assert.deepEqual(matches('Корзина с рыбой, Корзина с бельём.', raw).map(match => match.text), ['Корзина с рыбой', 'Корзина с бельём']);
});

test('regex metacharacters are literal and Unicode word boundaries remain strict', () => {
    const raw = normalizeGraphMapData(scene({ poi: [{ name: 'Frame seven', mention_aliases: ['секция [7]', 'C++', 'сёдзи'] }] }));
    assert.deepEqual(matches('секция [7], C++, сёдзи.', raw).map(match => match.text), ['секция [7]', 'C++', 'сёдзи']);
    assert.deepEqual(matches('сёдзик сёдзи-подделка C++X секция 7', raw), []);
});

test('alias validation trims, deduplicates and removes the canonical label', () => {
    assert.deepEqual(normalizeMentionAliases([' сёдзи ', 'СЁДЗИ', 'Раздвижные\u3164сёдзи', '', 'раздвижными сёдзи'], 'Раздвижные сёдзи'),
        ['сёдзи', 'раздвижными сёдзи']);
    for (const value of [null, 'сёдзи', {}, [1], ['a'], ['a'.repeat(121)], Array(17).fill('сёдзи'), ['<img src=x>'], ['line\nbreak'], ['a\0b']]) {
        assert.throws(() => normalizeMentionAliases(value), /invalid_mention_aliases/);
        assert.throws(() => normalizeGraphMapData(scene({ mention_aliases: value })), /invalid_mention_aliases/);
    }
});

test('invalid aliases in a raw index caller keep exact matching safe', () => {
    const raw = scene({ poi: [{ name: 'Безопасное имя', mention_aliases: ['валидное', '<script>'] }] });
    assert.deepEqual(matches('валидное <script> Безопасное имя', raw).map(match => match.text), ['Безопасное имя']);
});

test('omission preserves variants for a unique entity across moves; explicit empty lists clear them', () => {
    const first = normalizeGraphMapData(scene());
    const input = scene({ poi: [], characters: [] });
    delete input.zones[0].mention_aliases;
    input.zones.push({ id: 'yard', name: 'Yard', kind: 'outdoor', poi: [{ name: 'Раздвижные сёдзи' }], characters: [{ name: 'Химари' }] });
    const next = normalizeGraphMapData(input, first);
    assert.deepEqual(next.zones[0].mention_aliases, first.zones[0].mention_aliases);
    assert.deepEqual(next.zones[1].poi[0].mention_aliases, first.zones[0].poi[0].mention_aliases);
    assert.deepEqual(next.zones[1].characters[0].mention_aliases, first.zones[0].characters[0].mention_aliases);
    input.zones[1].poi[0].mention_aliases = [];
    assert.deepEqual(normalizeGraphMapData(input, first).zones[1].poi[0].mention_aliases, []);
});

test('omitted aliases never migrate by name to ambiguous duplicates or silently survive a rename', () => {
    const first = normalizeGraphMapData(scene());
    const renamed = scene({ id: first.zones[0].id, name: 'New place', poi: [{ name: 'Other object' }] });
    renamed.player_place_id = renamed.zones[0].id;
    delete renamed.zones[0].mention_aliases;
    const next = normalizeGraphMapData(renamed, first);
    assert.equal(next.zones[0].mention_aliases, undefined);
    assert.equal(next.zones[0].poi[0].mention_aliases, undefined);
    const duplicate = normalizeGraphMapData(scene({ poi: [{ name: 'Раздвижные сёдзи' }, { name: 'Раздвижные сёдзи' }] }), first);
    assert.ok(duplicate.zones[0].poi.every(item => item.mention_aliases === undefined));
});

test('JSON persistence, archive reads and rollback preserve aliases without rewriting snapshots', () => {
    const first = createSavedMap(normalizeGraphMapData(scene()));
    const second = createSavedMap(normalizeGraphMapData(scene({ name: 'Updated veranda' })), first);
    const archive = recordArchivedMap(readLocationArchive({}), first);
    const metadata = JSON.parse(JSON.stringify({ bb_map_data: second, bb_map_archive: archive }));
    const snapshot = JSON.stringify(metadata);
    assert.deepEqual(readMapState(metadata.bb_map_data).zones[0].poi[0].mention_aliases, ['сёдзи', 'раздвижными сёдзи']);
    assert.deepEqual(readMapState(readLocationArchive(metadata).locations[0].snapshot).zones[0].mention_aliases, ['веранде']);
    assert.equal(restorePreviousMap(metadata.bb_map_data).raw.zones[0].name, 'Веранда дома');
    assert.equal(JSON.stringify(metadata), snapshot);
});

test('carried object aliases survive omission from the next scene and stay available to the index', () => {
    const previous = normalizeGraphMapData(scene({ poi: [{ name: 'Амулет прилива', mention_aliases: ['амулетом'], item_state: 'held', holder: 'Player' }] }));
    const next = reconcileMapObjects(normalizeGraphMapData(scene({ poi: [] }), previous), previous, 'Player');
    assert.deepEqual(next.unlocated_objects[0].mention_aliases, ['амулетом']);
    assert.equal(matches('играет амулетом', next).length, 1);
});

test('matching metadata does not enter story context or visible fact diffs', () => {
    const before = normalizeGraphMapData(scene());
    const after = normalizeGraphMapData(scene({ mention_aliases: ['PLACE_ALIAS_ONLY'],
        poi: before.zones[0].poi.map(item => ({ ...item, mention_aliases: ['OBJECT_ALIAS_ONLY'] })),
        characters: [{ name: 'Химари', mention_aliases: ['CHARACTER_ALIAS_ONLY'] }] }), before);
    assert.doesNotMatch(buildMapContextString(after), /mention_aliases|ALIAS_ONLY/);
    assert.deepEqual(getMapChanges(before, after), []);
});

test('old grids keep dictionary matching while an explicit empty list opts into canonical-only matching', () => {
    const legacy = { schematic_name: 'House', zones: [{ position: 'center', name: 'Hall', poi: ['Медный ключ'] }] };
    const snapshot = JSON.stringify(legacy);
    const map = normalizeMapData(legacy);
    assert.equal(map.zones[0].poi[0].mention_aliases, undefined);
    assert.equal(matches('медным ключом', map).length, 1);
    map.zones[0].poi[0].mention_aliases = [];
    assert.equal(matches('медным ключом', map).length, 0);
    assert.equal(matches('Медный ключ', map).length, 1);
    assert.equal(JSON.stringify(legacy), snapshot);
});
