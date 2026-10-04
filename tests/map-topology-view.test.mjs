import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutMapPlaces, layoutMapPassage } from '../map-topology-view.js';
import { normalizeGraphMapData, getMapChanges } from '../map-state.js';

test('layout keeps connected/disconnected places within bounds and apart at 320/390/768 widths', () => {
    const raw = normalizeGraphMapData({ layout: 'graph', scope: 'scene', schematic_name: 'House', player_place_id: 'p0',
        zones: Array.from({ length: 24 }, (_, i) => ({ id: `p${i}`, name: `Place ${i}`, kind: ['room', 'outdoor', 'passage'][i % 3] })),
        connections: Array.from({ length: 17 }, (_, i) => ({ from: 'p0', to: `p${i + 1}`, name: 'Door', kind: 'door', status: 'confirmed', evidence: 'Open door.' })) });
    const snapshot = JSON.stringify(raw);
    for (const width of [270, 320, 390, 768]) {
        const { nodes, height } = layoutMapPlaces(raw, width);
        assert.equal(nodes.length, 24);
        for (const node of nodes) {
            assert.ok(node.x - node.width / 2 >= 0 && node.x + node.width / 2 <= width);
            assert.ok(node.y - node.height / 2 >= 0 && node.y + node.height / 2 <= height);
            for (const other of nodes.filter(other => other.id !== node.id)) {
                assert.ok(Math.abs(other.x - node.x) >= (other.width + node.width) / 2 || Math.abs(other.y - node.y) >= (other.height + node.height) / 2);
            }
        }
        assert.deepEqual(layoutMapPlaces(raw, width), layoutMapPlaces(raw, width));
    }
    assert.equal(JSON.stringify(raw), snapshot);
});

test('graph review detects object movement, player position and passage changes without grid positions', () => {
    const input = { layout: 'graph', scope: 'scene', schematic_name: 'House', player_place_id: 'hall',
        zones: [{ id: 'hall', name: 'Hall', kind: 'room', poi: ['Key'] }, { id: 'garden', name: 'Garden', kind: 'outdoor' }],
        connections: [{ from: 'hall', to: 'garden', kind: 'door', name: 'Door', status: 'confirmed', evidence: 'Open door.' }] };
    const before = normalizeGraphMapData(input), snapshot = JSON.stringify(before);
    const after = normalizeGraphMapData({ ...input, player_place_id: 'garden', zones: input.zones.map((zone, i) => ({ ...zone, poi: i ? ['Key'] : [] })),
        connections: [{ ...input.connections[0], status: 'blocked', evidence: 'The door was locked.' }] }, before);
    const changes = getMapChanges(before, after);
    const key = changes.find(change => change.name === 'Key');
    assert.equal(key.action, 'moved'); assert.equal(key.from, before.zones[0].id); assert.equal(key.to, after.zones[1].id);
    assert.ok(changes.find(change => change.type === 'connection').fields.some(field => field.key === 'status' && field.after === 'blocked'));
    assert.ok(changes.find(change => change.type === 'scene').fields.some(field => field.key === 'player_place_id'));
    assert.deepEqual(getMapChanges(after, after), []);
    assert.equal(JSON.stringify(before), snapshot);
});

test('a passage detours around an intervening place instead of drawing through it', () => {
    const p = { id: 'a', x: 100, y: 100, width: 110, height: 80, band: 0 };
    const q = { id: 'b', x: 100, y: 400, width: 110, height: 80, band: 1 };
    const obstacle = { id: 'c', x: 100, y: 240, width: 110, height: 80, band: 0 };
    const route = layoutMapPassage(p, q, [p, q, obstacle], 320);
    assert.equal(route.length, 4);
    assert.ok(route[1].x > obstacle.x + obstacle.width / 2);
    assert.equal(route[1].x, route[2].x);
});

test('short passage labels have room between places on a narrow map', () => {
    const raw = normalizeGraphMapData({ layout: 'graph', scope: 'scene', schematic_name: 'House', player_place_id: 'hall',
        zones: [{ id: 'hall', name: 'Hall', kind: 'room' }, { id: 'garden', name: 'Garden', kind: 'outdoor' }],
        connections: [{ from: 'hall', to: 'garden', name: 'Door', kind: 'door', status: 'confirmed', evidence: 'Open door.' }] });
    for (const width of [270, 320, 390, 600]) {
        const { nodes } = layoutMapPlaces(raw, width);
        const [a, b] = layoutMapPassage(nodes[0], nodes[1], nodes, width);
        assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= 70);
    }
});
