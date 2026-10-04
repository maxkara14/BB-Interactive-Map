import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutMiniMap, layoutMapPassage } from '../map-topology-view.js';

test('mini layout keeps direction/status, bounds nodes and limits direct neighbors without mutation', () => {
    const raw = { player_place_id: 'home', zones: ['home','a','b','c','d','e'].map(id => ({ id, name: id, kind: 'room' })),
        connections: ['a','b','c','d','e'].map((id, i) => ({ id, from: i === 1 ? id : 'home', to: i === 1 ? 'home' : id, direction: i ? 'forward' : 'both', status: i === 3 ? 'blocked' : 'confirmed' })) };
    const before = JSON.stringify(raw), layout = layoutMiniMap(raw);
    assert.equal(layout.nodes.length, 5); assert.equal(layout.extra, 1);
    assert.deepEqual(layout.edges, raw.connections.slice(0,4));
    for (const node of layout.nodes) {
        assert.ok(node.x - node.width / 2 >= 0 && node.x + node.width / 2 <= 256);
        assert.ok(node.y - node.height / 2 >= 0 && node.y + node.height / 2 <= layout.height);
    }
    for (const edge of layout.edges) {
        const from = layout.nodes.find(node => node.id === edge.from), to = layout.nodes.find(node => node.id === edge.to);
        const points = layoutMapPassage(from, to, layout.nodes, 256);
        assert.ok(Math.hypot(points.at(-1).x - points[0].x, points.at(-1).y - points[0].y) > 20);
        assert.ok(Math.hypot(points[0].x - from.x, points[0].y - from.y) < Math.hypot(points[0].x - to.x, points[0].y - to.y));
    }
    assert.equal(JSON.stringify(raw), before);
    assert.equal(layoutMiniMap({ ...raw, player_place_id: null }).nodes.length, 0);
    assert.equal(layoutMiniMap({ ...raw, connections: [] }).nodes.length, 1);
    assert.ok(layoutMiniMap({ ...raw, connections: raw.connections.slice(0,2) }).height < 150);
});
