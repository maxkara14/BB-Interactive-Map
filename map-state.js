export const MAP_DATA_VERSION = 2;

const POSITIONS = new Set(['center', 'north', 'south', 'east', 'west', 'northwest', 'northeast', 'southwest', 'southeast']);
const THREAT_RANK = { safe: 0, tension: 1, danger: 2 };

function requiredText(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('invalid_map');
    return value.trim();
}

function optionalText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function poiName(poi) {
    return typeof poi === 'string' ? poi : optionalText(poi?.name);
}

function entityKey(type, name) {
    return `${type}:${name.normalize('NFKC').trim().toLowerCase()}`;
}

function previousEntityIds(previousRaw) {
    const names = new Map();
    let nextId = 1;
    for (const zone of Array.isArray(previousRaw?.zones) ? previousRaw.zones : []) {
        if (!zone || typeof zone !== 'object') continue;
        for (const [type, entries] of [['character', zone.characters], ['object', zone.poi]]) {
            for (const entry of Array.isArray(entries) ? entries : []) {
                if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
                const name = poiName(entry);
                if (!name) continue;
                const key = entityKey(type, name);
                names.set(key, [...(names.get(key) || []), entry.id]);
                const match = /^bbm-(\d+)$/.exec(entry.id);
                if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
            }
        }
    }
    return { names, nextId };
}

export function normalizeMapData(input, previousRaw = null) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.zones)) throw new Error('invalid_map');
    const zonesByPosition = new Map();
    for (const source of input.zones) {
        if (!source || !POSITIONS.has(source.position)) throw new Error('invalid_map');
        const threat = source.threat_level || 'safe';
        if (!Object.hasOwn(THREAT_RANK, threat)) throw new Error('invalid_map');
        if (source.poi !== undefined && !Array.isArray(source.poi)) throw new Error('invalid_map');
        if (source.characters !== undefined && !Array.isArray(source.characters)) throw new Error('invalid_map');
        const zone = {
            position: source.position,
            name: requiredText(source.name),
            summary: optionalText(source.summary),
            threat_level: threat,
            threat_reason: optionalText(source.threat_reason),
            poi: (Array.isArray(source.poi) ? source.poi : []).map(item => ({
                name: requiredText(poiName(item)),
                description: typeof item === 'object' ? optionalText(item?.description) : '',
            })),
            characters: (Array.isArray(source.characters) ? source.characters : []).map(char => ({
                name: requiredText(char?.name),
                description: optionalText(char?.description),
                mood: optionalText(char?.mood),
                attitude: optionalText(char?.attitude),
                thought: optionalText(char?.thought),
            })),
        };
        const existing = zonesByPosition.get(zone.position);
        if (!existing) {
            zonesByPosition.set(zone.position, zone);
            continue;
        }
        existing.name += ` / ${zone.name}`;
        existing.summary = [existing.summary, zone.summary].filter(Boolean).join(' ');
        if (THREAT_RANK[zone.threat_level] > THREAT_RANK[existing.threat_level]) existing.threat_level = zone.threat_level;
        existing.threat_reason = [existing.threat_reason, zone.threat_reason].filter(Boolean).join(' | ');
        existing.poi.push(...zone.poi);
        existing.characters.push(...zone.characters);
    }
    if (!zonesByPosition.size) throw new Error('invalid_map');

    const zones = [...zonesByPosition.values()];
    const counts = new Map();
    for (const zone of zones) {
        for (const [type, entries] of [['character', zone.characters], ['object', zone.poi]]) {
            for (const entry of entries) {
                const key = entityKey(type, entry.name);
                counts.set(key, (counts.get(key) || 0) + 1);
            }
        }
    }
    const previous = previousEntityIds(previousRaw);
    const used = new Set();
    for (const zone of zones) {
        for (const [type, entries] of [['character', zone.characters], ['object', zone.poi]]) {
            for (const entry of entries) {
                const key = entityKey(type, entry.name);
                const ids = previous.names.get(key) || [];
                const reuse = counts.get(key) === 1 && ids.length === 1 && !used.has(ids[0]);
                entry.id = reuse ? ids[0] : `bbm-${previous.nextId++}`;
                used.add(entry.id);
            }
        }
    }
    return {
        schematic_name: requiredText(input.schematic_name),
        atmosphere: optionalText(input.atmosphere),
        zones,
    };
}

export function buildMapContextString(mapData) {
    if (!mapData || !Array.isArray(mapData.zones)) return '';
    let context = `[Map context: The player is at "${mapData.schematic_name}". Atmosphere: ${mapData.atmosphere}. `;
    for (const zone of mapData.zones) {
        const characters = Array.isArray(zone.characters) && zone.characters.length
            ? ` Characters: ${zone.characters.map(c => `${c.name} (${c.mood || ''}, attitude: ${c.attitude || ''})`).join(', ')}.` : '';
        const objects = Array.isArray(zone.poi) && zone.poi.length
            ? ` Objects: ${zone.poi.map(poiName).join(', ')}.` : '';
        let threat = '';
        if (zone.threat_level === 'danger') threat = ` [🔴 DANGER: ${zone.threat_reason || 'Unknown'}]`;
        else if (zone.threat_level === 'tension') threat = ` [🟠 Tension: ${zone.threat_reason || 'Suspicious'}]`;
        else if (zone.threat_reason) threat = ` [🟢 Safe: ${zone.threat_reason}]`;
        if (characters || objects || zone.threat_level !== 'safe' || zone.threat_reason) {
            context += `Zone "${zone.name}" (${zone.position})${threat}: ${zone.summary || ''}${characters}${objects} `;
        }
    }
    return `${context}]`;
}

export function createSavedMap(raw, current = null) {
    const previous = current?.raw ? {
        version: current.version || 1,
        raw: current.raw,
        context: current.context || '',
    } : null;
    return {
        version: MAP_DATA_VERSION,
        raw,
        context: buildMapContextString(raw),
        previous,
    };
}

export function restorePreviousMap(current) {
    if (!current?.raw || !current.previous?.raw) return null;
    return {
        version: current.previous.version || 1,
        raw: current.previous.raw,
        context: current.previous.context || '',
        previous: { version: current.version || 1, raw: current.raw, context: current.context || '' },
    };
}
