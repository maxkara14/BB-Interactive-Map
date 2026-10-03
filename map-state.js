export const MAP_DATA_VERSION = 2;

export function isSameChat(initial, current) {
    return initial?.chatId != null
        && initial.chatId === current?.chatId
        && initial.characterId === current.characterId
        && initial.groupId === current.groupId
        && initial.chatMetadata === current.chatMetadata;
}

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

export function getMapMode(metadata) {
    return metadata?.bb_map_mode === 'game' ? 'game' : 'classic';
}

// The grid is centered on the player's last saved position. A draft never moves it.
export function getMapTransition(raw, position) {
    if (!POSITIONS.has(position) || position === 'center') return null;
    const center = raw?.zones?.find(zone => zone.position === 'center');
    const destination = raw?.zones?.find(zone => zone.position === position);
    return center && destination ? { from: center, to: destination } : null;
}

export function createTravelDraft(existing, transition, language) {
    const action = language === 'ru'
        ? `Я направляюсь из зоны «${transition.from.name}» в зону «${transition.to.name}».`
        : `I head from "${transition.from.name}" to "${transition.to.name}".`;
    return existing ? `${existing}\n\n${action}` : action;
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

// Compare visible facts, not generated IDs. Legacy maps may have no IDs at all.
export function getMapChanges(previous, next) {
    const changes = [];
    const fieldsChanged = (before, after, keys) => keys
        .filter(key => optionalText(before?.[key]) !== optionalText(after?.[key]))
        .map(key => ({ key, before: optionalText(before?.[key]), after: optionalText(after?.[key]) }));
    const sceneFields = fieldsChanged(previous, next, ['schematic_name', 'atmosphere']);
    if (previous && sceneFields.length) changes.push({ type: 'scene', action: 'changed', name: next.schematic_name, fields: sceneFields });
    const oldZones = new Map((previous?.zones || []).map(zone => [zone.position, zone]));
    const newZones = new Map((next?.zones || []).map(zone => [zone.position, zone]));
    for (const position of new Set([...oldZones.keys(), ...newZones.keys()])) {
        const before = oldZones.get(position);
        const after = newZones.get(position);
        if (!before || !after) {
            changes.push({ type: 'zone', action: before ? 'removed' : 'added', name: (after || before).name, position, fields: [] });
            continue;
        }
        const fields = fieldsChanged({ ...before, threat_level: before.threat_level || 'safe' },
            { ...after, threat_level: after.threat_level || 'safe' }, ['name', 'summary', 'threat_level', 'threat_reason']);
        if (fields.length) changes.push({ type: 'zone', action: 'changed', name: after.name, position, fields });
    }
    const entries = (raw, type) => {
        const groups = new Map();
        for (const zone of raw?.zones || []) {
            for (const value of zone[type === 'character' ? 'characters' : 'poi'] || []) {
                const name = poiName(value);
                if (!name) continue;
                const key = entityKey(type, name);
                const entry = { name, description: optionalText(value?.description), position: zone.position };
                if (type === 'character') {
                    for (const field of ['mood', 'attitude', 'thought']) entry[field] = optionalText(value?.[field]);
                }
                groups.set(key, [...(groups.get(key) || []), entry]);
            }
        }
        return groups;
    };
    for (const type of ['character', 'object']) {
        const beforeGroups = entries(previous, type);
        const afterGroups = entries(next, type);
        for (const key of new Set([...beforeGroups.keys(), ...afterGroups.keys()])) {
            const before = beforeGroups.get(key) || [];
            const after = afterGroups.get(key) || [];
            const name = (after[0] || before[0]).name;
            if (before.length <= 1 && after.length <= 1) {
                const keys = type === 'character' ? ['description', 'mood', 'attitude', 'thought'] : ['description'];
                if (before.length && after.length) keys.unshift('name');
                const fields = fieldsChanged(before[0], after[0], keys);
                const action = !before.length ? 'added' : !after.length ? 'removed'
                    : before[0].position !== after[0].position ? 'moved' : 'changed';
                if (action !== 'changed' || fields.length) changes.push({
                    type, action, name, from: before[0]?.position, to: after[0]?.position, fields,
                });
                continue;
            }
            const signature = group => group.map(entry => JSON.stringify(entry)).sort().join('\n');
            if (signature(before) !== signature(after)) changes.push({
                type, action: !before.length ? 'added' : !after.length ? 'removed' : 'changed',
                name, ambiguous: !!(before.length && after.length), fields: [],
                from: before.map(entry => entry.position), to: after.map(entry => entry.position),
            });
        }
    }
    return changes;
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
