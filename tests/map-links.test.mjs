import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapMentionIndex, findMapMentions } from '../map-links.js';

const raw = { zones: [{ position: 'center', name: 'Двор', summary: 'Солнечный двор',
    poi: ['Ключ', { name: 'Медный ключ', description: 'Старая вещь' }, 'C++'],
    characters: [{ name: 'Ибуки Куробати', mood: 'Сердита' }],
}] };

test('message scope counts a character once across full name, aliases, case and honorifics', () => {
    const index = createMapMentionIndex(raw);
    const seen = new Set();
    assert.deepEqual(findMapMentions('Ибуки Куробати; ИБУКИ; Куробати; Ибуки-сан.', index, seen).map(m => m.text), ['Ибуки Куробати']);
    assert.deepEqual(findMapMentions('Куробати и Ибуки. Двор, ДВОР. Медный ключ, медныйㅤключ.', index, seen).map(m => m.text), ['Двор', 'Медный ключ']);
    assert.deepEqual(findMapMentions('Куробати. Ибуки Куробати.', index, new Set()).map(m => m.text), ['Куробати']);
});

test('English aliases share one slot; distinct entities and a new message retain their slots', () => {
    const index = createMapMentionIndex({ zones: [{ name: 'Hall', poi: ['Key'], characters: [{ name: 'John Smith' }, { name: 'Jane Brown' }] }] });
    const text = 'John-san, John Smith, SMITH, Jane Brown, Brown. Key, KEY. Hall, Hall.';
    const expected = ['John', 'Jane Brown', 'Key', 'Hall'];
    assert.deepEqual(findMapMentions(text, index, new Set()).map(m => m.text), expected);
    assert.deepEqual(findMapMentions(text, index, new Set()).map(m => m.text), expected);
});

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

test('character short names, surnames and honorifics match across visual separators without changing offsets', () => {
    const index = createMapMentionIndex({ zones: [{ name: 'Зал', poi: ['Кедровые половицы'], characters: [
        { name: 'Ибуки Куробати' }, { name: 'Танджиро Камадо' }, { name: 'Аой Кандзаки' },
    ] }] });
    const text = '🔑 ВоздухㅤТанджироㅤИбукиㅤКамадо,ㅤКуробати!ㅤАой-санㅤИбуки-сан. Кандзаки. Кедровыеㅤполовицы.';
    const matches = findMapMentions(text, index);
    assert.deepEqual(matches.map(match => match.text), ['Танджиро', 'Ибуки', 'Камадо', 'Куробати', 'Аой', 'Ибуки', 'Кандзаки', 'Кедровыеㅤполовицы']);
    assert.equal(index.entries.get(matches[0].key).name, 'Танджиро Камадо');
    for (const match of matches) assert.equal(text.slice(match.start, match.end), match.text);
    for (const separator of [' ', '\u00a0', 'ㅤ', '\uffa0', '\u2800', '\u200b', '\t']) {
        const full = `Ибуки${separator}Куробати`;
        assert.deepEqual(findMapMentions(full, index).map(match => match.text), [full]);
    }
    assert.deepEqual(findMapMentions('Ибукина Ибуки-подделка Аой-санка Куробатиным', index), []);
});

test('short aliases remain ambiguous across characters, objects and zones', () => {
    const index = createMapMentionIndex({ zones: [{ name: 'Мира', poi: ['Куробати', 'Ключ'], characters: [
        { name: 'Ибуки Куробати' }, { name: 'Ибуки Камадо' }, { name: 'Мира Даль' },
    ] }] });
    assert.deepEqual(findMapMentions('Ибуки Куробати; Ибуки, Куробати, Мира, Камадо, Даль. Ключ-сан.', index).map(match => match.text),
        ['Ибуки Куробати', 'Камадо', 'Даль']);
});
