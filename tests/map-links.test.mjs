import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapMentionIndex, findMapMentions } from '../map-links.js';

const raw = { zones: [{ position: 'center', name: 'Двор', summary: 'Солнечный двор',
    poi: ['Ключ', { name: 'Медный ключ', description: 'Старая вещь' }, 'C++'],
    characters: [{ name: 'Ибуки Куробати', mood: 'Сердита' }],
}] };

test('mentions match full names case-insensitively with Cyrillic word boundaries', () => {
    const index = createMapMentionIndex(raw);
    const text = '🔑 ИБУКИ КУРОБАТИ нашла Медный ключ во дворе. Двор, ключик, ключ-подделка и ключом.';
    const matches = findMapMentions(text, index);
    assert.deepEqual(matches.map(match => match.text), ['ИБУКИ КУРОБАТИ', 'Медный ключ', 'Двор']);
    for (const match of matches) assert.equal(text.slice(match.start, match.end), match.text);
    assert.equal(index.entries.get(matches[0].key).mood, 'Сердита');
});

test('longer names win and regex punctuation is literal', () => {
    const index = createMapMentionIndex(raw);
    assert.deepEqual(findMapMentions('Медный ключ, Ключ; C++ и CXX.', index).map(match => match.text), ['Медный ключ', 'Ключ', 'C++']);
    assert.deepEqual(findMapMentions('ключ\u0301 ключник C++X', index), []);
});

test('ambiguous names across zones or entity types are skipped', () => {
    const repeated = createMapMentionIndex({ zones: [
        { ...raw.zones[0], poi: ['Ключ', 'Двор'] },
        { position: 'north', name: 'Зал', poi: ['КЛЮЧ'], characters: [] },
    ] });
    assert.deepEqual(findMapMentions('Ключ и Двор. Зал.', repeated).map(match => match.text), ['Зал']);
});

test('empty maps produce no links and indexing preserves source data', () => {
    assert.deepEqual(findMapMentions('Ключ', createMapMentionIndex(null)), []);
    const snapshot = JSON.stringify(raw);
    createMapMentionIndex(raw);
    assert.equal(JSON.stringify(raw), snapshot);
});

test('an ambiguous long name blocks a shorter entity name inside it', () => {
    const index = createMapMentionIndex({ zones: [
        { name: 'Двор', poi: ['Медный ключ', 'Ключ'] }, { name: 'Зал', poi: ['Медный ключ'] },
    ] });
    assert.deepEqual(findMapMentions('Медный ключ и Ключ.', index).map(match => match.text), ['Ключ']);
});
