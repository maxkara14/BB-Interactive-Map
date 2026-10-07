import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGraphMapData, normalizeMapData, createSavedMap, readLocationArchive, recordArchivedMap,
    matchArchivedLocation, renameArchivedLocation, archivedLocationTopology, locationNormalizationMemory } from '../map-state.js';
import { resolveLocationUpdate, deleteArchivedLocation } from '../map-state.js';

const saved = name => createSavedMap(normalizeGraphMapData({ layout: 'graph', scope: 'scene', schematic_name: name,
    player_place_id: 'hall', zones: [{ id: 'hall', name: 'Hall', kind: 'room', summary: 'Old surroundings',
        threat_level: 'danger', threat_reason: 'Old fire', characters: [{ name: 'Old visitor' }],
        poi: [{ name: 'Old sofa' }] }, { id: 'garden', name: 'Garden', kind: 'outdoor' }],
    connections: [{ from: 'hall', to: 'garden', name: 'Door', kind: 'door', status: 'blocked', evidence: 'Old locked door' }] }));

test('null IDs, renamed scenes and ordinary updates keep the active location; ambiguous and evidenced moves differ', () => {
    const current = saved('Train').raw;
    const archive = recordArchivedMap(readLocationArchive({}), createSavedMap(current));
    const recent = 'Player left the train and arrived at the mountain refuge.';
    for (const title of ['Train', 'Location', 'A dramatic train incident']) {
        const result = resolveLocationUpdate(archive, current, { ...current, schematic_name: title, archive_location_id: null }, recent);
        assert.equal(result.locationId, archive.activeId);
        assert.equal(result.needsLocationChoice, false);
    }
    const different = { ...saved('Refuge').raw, zones: [{ id: 'refuge', name: 'Mountain refuge', kind: 'room' }], archive_location_id: null };
    assert.equal(resolveLocationUpdate(archive, current, different, recent).needsLocationChoice, true);
    assert.equal(resolveLocationUpdate(archive, current, { ...different, location_change: 'new', location_change_evidence: recent }, recent).locationId, null);
    assert.equal(resolveLocationUpdate(archive, current, { ...different, location_change: 'new', location_change_evidence: 'Not in the story' }, recent).needsLocationChoice, true);
    const duplicates = recordArchivedMap(archive, createSavedMap({ ...current, schematic_name: 'Location' }));
    const update = resolveLocationUpdate(duplicates, { ...current, schematic_name: 'Location' }, current, recent);
    assert.equal(update.locationId, duplicates.activeId, 'A title matching an old duplicate does not imply a return');
    assert.equal(update.needsConfirmation, false);
});

test('deleting an inactive snapshot preserves other entries and forbids deleting the active one', () => {
    const archive = recordArchivedMap(recordArchivedMap(readLocationArchive({}), saved('Estate')), saved('Forest'));
    const before = structuredClone(archive);
    const result = deleteArchivedLocation(archive, 'bbl-1');
    assert.deepEqual(result.locations, [archive.locations[1]]);
    assert.equal(result.activeId, 'bbl-2');
    assert.deepEqual(archive, before);
    assert.throws(() => deleteArchivedLocation(archive, 'bbl-2'), /invalid_archive/);
    assert.throws(() => deleteArchivedLocation(archive, 'missing'), /invalid_archive/);
});

test('reading an old chat leaves its map and metadata unchanged', () => {
    const metadata = { bb_map_data: saved('Estate') }, before = structuredClone(metadata);
    assert.deepEqual(readLocationArchive(metadata), { version: 1, activeId: null, locations: [] });
    assert.deepEqual(metadata, before);
});

test('separate locations survive updates and snapshots contain no recursive undo history', () => {
    const estate = saved('Estate'), forest = saved('Forest');
    let archive = recordArchivedMap(readLocationArchive({}), estate, null, 10);
    const original = structuredClone(archive);
    archive = recordArchivedMap(archive, forest, null, 20);
    assert.equal(archive.locations.length, 2);
    assert.equal(archive.locations[0].snapshot.raw.schematic_name, 'Estate');
    archive = recordArchivedMap(archive, createSavedMap(estate.raw, forest), 'bbl-1', 30);
    assert.equal(archive.locations.length, 2);
    assert.equal(archive.activeId, 'bbl-1');
    assert.equal(archive.locations[0].updatedAt, 30);
    assert.equal(archive.locations[0].snapshot.previous, undefined);
    estate.raw.schematic_name = 'Changed elsewhere';
    assert.equal(archive.locations[0].snapshot.raw.schematic_name, 'Estate');
    assert.equal(original.locations[0].updatedAt, 10);
    assert.equal(readLocationArchive({ bb_map_archive: archive }), archive);
});

test('matching never guesses between repeated labels or accepts an unknown model ID', () => {
    let archive = recordArchivedMap(readLocationArchive({}), saved('Estate'));
    const first = archive.locations[0];
    assert.equal(matchArchivedLocation(archive, null, ' estate '), first);
    assert.equal(matchArchivedLocation(archive, 'invented', 'Estate'), null);
    archive = recordArchivedMap(archive, saved('Estate'));
    assert.equal(matchArchivedLocation(archive, null, 'Estate'), null);
    assert.equal(matchArchivedLocation(archive, 'bbl-1', 'Renamed scene').id, 'bbl-1');
    archive = renameArchivedLocation(archive, 'bbl-1', 'Northern estate');
    assert.equal(matchArchivedLocation(archive, null, 'Northern estate').id, 'bbl-1');
    assert.equal(archive.locations[0].snapshot.raw.schematic_name, 'Estate');
    assert.throws(() => renameArchivedLocation(archive, 'bbl-1', ' '));
});

test('return topology excludes old occupants, objects, effects, position and passage state', () => {
    const snapshot = saved('Estate'), before = structuredClone(snapshot);
    const topology = archivedLocationTopology(snapshot);
    assert.equal(topology.player_place_id, null);
    assert.equal(topology.zones[0].name, 'Hall');
    assert.equal(topology.zones[0].summary, '');
    assert.deepEqual(topology.zones[0].characters, []);
    assert.deepEqual(topology.zones[0].poi, []);
    assert.equal(topology.zones[0].threat_level, 'safe');
    assert.equal(topology.connections[0].status, 'uncertain');
    assert.equal(topology.connections[0].evidence, '');
    assert.deepEqual(topology.effects, []);
    assert.deepEqual(snapshot, before);
    const current = saved('Forest').raw;
    const memory = locationNormalizationMemory(topology, current);
    assert.equal(memory.zones[0].poi[0].id, current.zones[0].poi[0].id);
    assert.equal(memory.zones[0].id, topology.zones[0].id);
    assert.deepEqual(topology.zones[0].poi, []);
});

test('invalid archives and future snapshot versions are rejected without mutations', () => {
    const archive = recordArchivedMap(readLocationArchive({}), saved('Estate'));
    for (const broken of [{ ...archive, version: 99 }, { ...archive, activeId: 'bbl-99' },
        { ...archive, locations: [archive.locations[0], archive.locations[0]] },
        { ...archive, locations: [{ ...archive.locations[0], snapshot: { ...archive.locations[0].snapshot, version: 99 } }] }]) {
        const before = structuredClone(broken);
        assert.throws(() => readLocationArchive({ bb_map_archive: broken }));
        assert.deepEqual(broken, before);
    }
});

test('legacy grid snapshots can be archived and viewed without conversion', () => {
    const legacy = createSavedMap(normalizeMapData({ schematic_name: 'Old lodge',
        zones: [{ position: 'center', name: 'Hall', poi: ['Old lamp'] }] }));
    const archive = recordArchivedMap(readLocationArchive({}), legacy);
    assert.equal(archive.locations[0].snapshot.version, 2);
    const topology = archivedLocationTopology(archive.locations[0].snapshot);
    assert.equal(topology.layout, undefined);
    assert.equal(topology.zones[0].position, 'center');
    assert.deepEqual(topology.zones[0].poi, []);
    assert.equal(archive.locations[0].snapshot.raw.zones[0].poi[0].name, 'Old lamp');
});
