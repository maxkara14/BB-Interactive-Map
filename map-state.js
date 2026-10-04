export const MAP_DATA_VERSION = 2;
export const GRAPH_MAP_DATA_VERSION = 3;

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

function objectState(source) {
    if (source?.item_state === undefined) return {};
    if (!['zone', 'held', 'unknown', 'left'].includes(source.item_state)
        || (source.uncertain !== undefined && typeof source.uncertain !== 'boolean')) throw new Error('invalid_map');
    const holder = optionalText(source.holder);
    if (source.item_state === 'held' && !holder) throw new Error('invalid_map');
    if (source.item_state === 'left' && !optionalText(source.state_reason)) throw new Error('invalid_map');
    return { item_state: source.item_state, holder: source.item_state === 'held' ? holder : '',
        state_reason: optionalText(source.state_reason), uncertain: source.uncertain === true,
        last_known: optionalText(source.last_known) };
}

export function getMapObjects(raw) {
    return [...(raw?.zones || []).flatMap(zone => (zone.poi || []).map(value => ({
        ...(typeof value === 'object' ? value : { name: value }), zone: zone.name, position: zone.position,
    }))), ...(raw?.unlocated_objects || []).map(value => ({ ...value, zone: '', position: '' }))];
}

const holderKey = name => optionalText(name).normalize('NFKC').toLowerCase();

// Zone objects belong to this scene. Only established possession follows an actor.
export function reconcileMapObjects(next, previous = null, playerName = '') {
    const previousItems = getMapObjects(previous);
    const previousById = new Map(previousItems.filter(item => item.id).map(item => [item.id, item]));
    const player = holderKey(playerName);
    const presentHolders = new Set(next.zones.flatMap(zone => (zone.characters || []).map(char => holderKey(char.name))));
    if (player) presentHolders.add(player);
    const previousHolders = new Set(previousItems.filter(item => item.item_state === 'held').map(item => holderKey(item.holder)));
    const lastKnown = item => item?.item_state === 'held' ? item.holder : item?.last_known || item?.zone || '';
    const withState = item => {
        const old = previousById.get(item.id);
        const state = objectState(item.item_state ? item : { ...old, item_state: old?.item_state || 'zone' });
        if (state.item_state === 'unknown' && !state.last_known) state.last_known = lastKnown(old);
        return { ...item, ...state };
    };
    const unlocated = (next.unlocated_objects || []).map(withState).filter(item => {
        const old = previousById.get(item.id);
        return item.item_state === 'held' ? presentHolders.has(holderKey(item.holder))
            : item.item_state === 'left' ? !!item.state_reason
                : old?.item_state === 'held' && presentHolders.has(holderKey(old.holder));
    });
    const zones = next.zones.map(zone => ({ ...zone, poi: zone.poi.map(withState).filter(item =>
        item.item_state !== 'held' || presentHolders.has(holderKey(item.holder)) || !previousHolders.has(holderKey(item.holder))) }));
    const currentNames = new Set([...zones.flatMap(zone => zone.poi), ...unlocated].map(item => entityKey('object', item.name)));
    for (const item of previousItems) {
        if (currentNames.has(entityKey('object', item.name))) continue;
        if (item.item_state !== 'held' || !presentHolders.has(holderKey(item.holder))) continue;
        unlocated.push({ id: item.id, name: item.name, description: optionalText(item.description),
            ...objectState(item) });
    }
    return { ...next, zones, unlocated_objects: unlocated,
        object_memory_scope: 'scene' };
}

export function hasLegacyObjectMemory(raw) {
    return raw?.object_memory_scope !== 'scene' && !!raw?.unlocated_objects?.some(item => item.item_state === 'unknown');
}

export function activeMapObjects(raw) {
    return { ...raw, unlocated_objects: (raw?.unlocated_objects || []).filter(item => item.item_state === 'held') };
}

function normalizeEffects(input, previous = []) {
    if (!Array.isArray(input) || input.length > 16) throw new Error('invalid_effects');
    let nextId = Math.max(0, ...previous.map(effect => Number(/^bbe-(\d+)$/.exec(effect.id || '')?.[1]) || 0)) + 1;
    const key = effect => `${effect.scope}:${holderKey(effect.target)}:${holderKey(effect.name)}`;
    const used = new Set();
    return input.map(value => {
        if (!value || !['scene', 'zone', 'character'].includes(value.scope)
            || !['active', 'ended'].includes(value.status || 'active')
            || (value.uncertain !== undefined && typeof value.uncertain !== 'boolean')) throw new Error('invalid_effects');
        const text = field => {
            if (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > 1500) throw new Error('invalid_effects');
            return value[field].trim();
        };
        const effect = { name: text('name'), scope: value.scope, target: text('target'), description: text('description'),
            source: text('source'), expires_when: text('expires_when'), status: value.status || 'active',
            evidence: optionalText(value.evidence), uncertain: value.uncertain === true };
        if (effect.evidence.length > 1500 || (effect.status === 'ended' && !effect.evidence)) throw new Error('invalid_effects');
        const identity = key(effect);
        if (used.has(identity)) throw new Error('invalid_effects');
        used.add(identity);
        const old = previous.filter(entry => key(entry) === identity);
        effect.id = old.length === 1 ? old[0].id : `bbe-${nextId++}`;
        return effect;
    });
}

export function isMapEffectApplicable(effect, raw, playerName = '') {
    return effect.scope === 'scene' ? holderKey(effect.target) === holderKey(raw.schematic_name)
        : effect.scope === 'zone' ? raw.zones.some(zone => holderKey(zone.name) === holderKey(effect.target))
            : (playerName && holderKey(effect.target) === holderKey(playerName))
                || raw.zones.some(zone => (zone.characters || []).some(char => holderKey(char.name) === holderKey(effect.target)));
}

export function reconcileMapEffects(next, previous = null, playerName = '') {
    const applicable = effect => isMapEffectApplicable(effect, next, playerName);
    const effects = (next.effects || []).filter(applicable);
    for (const old of previous?.effects || []) {
        if (old.status !== 'active' || !applicable(old) || effects.some(effect => effect.id === old.id)) continue;
        // Omission is not termination. Scans must report an ended effect with evidence.
        effects.push({ ...old });
    }
    if (effects.length > 16) throw new Error('invalid_effects');
    return { ...next, effects };
}

export function getMapEffectChanges(previous, next) {
    const old = new Map((previous?.effects || []).map(effect => [effect.id, effect]));
    const current = new Map((next?.effects || []).map(effect => [effect.id, effect]));
    const changes = [];
    for (const id of new Set([...old.keys(), ...current.keys()])) {
        const before = old.get(id), after = current.get(id);
        const fields = ['name', 'scope', 'target', 'description', 'source', 'expires_when', 'status', 'evidence', 'uncertain'];
        if (before && after && fields.every(field => before[field] === after[field])) continue;
        changes.push({ before, after, action: !after ? 'removed' : !before ? 'added'
            : after.status === 'ended' && before.status !== 'ended' ? 'ended' : 'changed' });
    }
    return changes;
}

export function requiresEffectReview(previous, next) {
    return getMapEffectChanges(previous, next).some(change => change.after
        && (change.after.uncertain || !change.after.evidence));
}

export function buildMapEffectsContext(raw, playerName = '') {
    const effects = (raw?.effects || []).filter(effect => effect.status === 'active' && isMapEffectApplicable(effect, raw, playerName));
    if (!effects.length) return '';
    return `\n[Temporary scene effects: ${effects.map(effect => `${effect.name}; target (${effect.scope}): ${effect.target}; description: ${effect.description}; source: ${effect.source}; ends when: ${effect.expires_when}`).join(' | ')}. These are narrative circumstances, not automatic damage, penalties, rolls, or permission to act for the player.]`;
}

export function requiresObjectReview(previous, next, playerName = '') {
    if (hasLegacyObjectMemory(previous)) return true;
    const changed = getMapChanges(previous, next).filter(change => change.type === 'object');
    const objects = getMapObjects(next);
    const holders = new Set([playerName, ...(previous?.zones || []).flatMap(zone => (zone.characters || []).map(char => char.name)),
        ...(next?.zones || []).flatMap(zone => (zone.characters || []).map(char => char.name))].filter(Boolean).map(holderKey));
    return changed.some(change => change.ambiguous || objects.some(item => item.name === change.name
        && (item.uncertain || item.item_state === 'unknown' || (item.item_state === 'held' && !holders.has(holderKey(item.holder)))
            || (item.item_state && !item.state_reason
                && (change.action === 'moved' || change.fields.some(field => ['item_state', 'holder'].includes(field.key))))))
        || (change.action === 'removed' && playerName && getMapObjects(previous).some(item => item.name === change.name
            && item.item_state === 'held' && holderKey(item.holder) === holderKey(playerName))));
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
    for (const item of previousRaw?.unlocated_objects || []) {
        if (!item?.name || typeof item.id !== 'string') continue;
        const key = entityKey('object', item.name);
        names.set(key, [...(names.get(key) || []), item.id]);
        const match = /^bbm-(\d+)$/.exec(item.id);
        if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
    }
    return { names, nextId };
}

export function normalizeMapData(input, previousRaw = null) {
    return normalizeMapState(input, previousRaw, false);
}

// Approved local topology: places and evidenced passages; no inferred grid adjacency.
export function normalizeGraphMapData(input, previousRaw = null) {
    return normalizeMapState(input, previousRaw, true);
}

function normalizeMapState(input, previousRaw, graph) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.zones)) throw new Error('invalid_map');
    if (graph && (input.layout !== 'graph' || !['scene', 'surroundings'].includes(input.scope)
        || input.zones.length > 24 || !Array.isArray(input.connections) || input.connections.length > 48)) throw new Error('invalid_map');
    const zonesByPosition = new Map();
    for (const source of input.zones) {
        if (!source || (graph ? !validTopologyId(source.id) || !['room', 'outdoor', 'passage', 'area', 'unknown'].includes(source.kind)
            || (source.uncertain !== undefined && typeof source.uncertain !== 'boolean') : !POSITIONS.has(source.position))) throw new Error('invalid_map');
        const threat = source.threat_level || 'safe';
        if (!Object.hasOwn(THREAT_RANK, threat)) throw new Error('invalid_map');
        if (source.poi !== undefined && !Array.isArray(source.poi)) throw new Error('invalid_map');
        if (source.characters !== undefined && !Array.isArray(source.characters)) throw new Error('invalid_map');
        const zone = {
            ...(graph ? { id: source.id, kind: source.kind, uncertain: source.uncertain === true } : { position: source.position }),
            name: requiredText(source.name),
            summary: optionalText(source.summary),
            threat_level: threat,
            threat_reason: optionalText(source.threat_reason),
            poi: (Array.isArray(source.poi) ? source.poi : []).map(item => ({
                name: requiredText(poiName(item)),
                description: typeof item === 'object' ? optionalText(item?.description) : '',
                ...objectState(item),
            })),
            characters: (Array.isArray(source.characters) ? source.characters : []).map(char => ({
                name: requiredText(char?.name),
                description: optionalText(char?.description),
                mood: optionalText(char?.mood),
                attitude: optionalText(char?.attitude),
                thought: optionalText(char?.thought),
            })),
        };
        if (graph && [zone.name, zone.summary, zone.threat_reason].some(text => text.length > 1500)) throw new Error('invalid_map');
        const locationKey = graph ? zone.id : zone.position;
        const existing = zonesByPosition.get(locationKey);
        if (!existing) {
            zonesByPosition.set(locationKey, zone);
            continue;
        }
        if (graph) throw new Error('invalid_map');
        existing.name += ` / ${zone.name}`;
        existing.summary = [existing.summary, zone.summary].filter(Boolean).join(' ');
        if (THREAT_RANK[zone.threat_level] > THREAT_RANK[existing.threat_level]) existing.threat_level = zone.threat_level;
        existing.threat_reason = [existing.threat_reason, zone.threat_reason].filter(Boolean).join(' | ');
        existing.poi.push(...zone.poi);
        existing.characters.push(...zone.characters);
    }
    if (!zonesByPosition.size) throw new Error('invalid_map');

    const zones = [...zonesByPosition.values()];
    if (zones.some(zone => zone.poi.some(item => item.item_state === 'left'))) throw new Error('invalid_map');
    if (input.unlocated_objects !== undefined && !Array.isArray(input.unlocated_objects)) throw new Error('invalid_map');
    const unlocated = (input.unlocated_objects || []).map(item => {
        const state = objectState(item);
        if (!state.item_state || state.item_state === 'zone') throw new Error('invalid_map');
        return { name: requiredText(item.name), description: optionalText(item.description), ...state };
    });
    const counts = new Map();
    const entityZones = [...zones, { poi: unlocated, characters: [] }];
    for (const zone of entityZones) {
        for (const [type, entries] of [['character', zone.characters], ['object', zone.poi]]) {
            for (const entry of entries) {
                const key = entityKey(type, entry.name);
                counts.set(key, (counts.get(key) || 0) + 1);
            }
        }
    }
    const previous = previousEntityIds(previousRaw);
    const used = new Set();
    for (const zone of entityZones) {
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
    if (graph && [requiredText(input.schematic_name), optionalText(input.atmosphere)].some(text => text.length > 1500)) throw new Error('invalid_map');
    const topology = graph ? normalizeTopology(input, zones, previousRaw) : {};
    return {
        schematic_name: requiredText(input.schematic_name),
        atmosphere: optionalText(input.atmosphere),
        zones,
        ...topology,
        ...(input.unlocated_objects !== undefined ? { unlocated_objects: unlocated } : {}),
        ...(input.object_memory_scope === 'scene' ? { object_memory_scope: 'scene' } : {}),
        ...(input.effects !== undefined ? { effects: normalizeEffects(input.effects, previousRaw?.effects) } : {}),
    };
}

function validTopologyId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
}

function normalizeTopology(input, zones, previous) {
    const oldZones = previous?.layout === 'graph' ? previous.zones : [];
    const oldIds = new Map(oldZones.map(zone => [zone.id, zone]));
    const used = new Set(), references = new Map();
    let nextId = Math.max(0, ...oldZones.map(zone => Number(/^bbp-(\d+)$/.exec(zone.id)?.[1]) || 0)) + 1;
    // Reserve all prior IDs first; reordering must not hand an existing ID to a new place.
    for (const zone of zones) {
        if (!oldIds.has(zone.id)) continue;
        references.set(zone.id, zone.id); used.add(zone.id);
    }
    for (const zone of zones) {
        const sourceId = zone.id;
        const sameScene = holderKey(input.schematic_name) === holderKey(previous?.schematic_name);
        const matches = sameScene ? oldZones.filter(old => holderKey(old.name) === holderKey(zone.name)) : [];
        const unique = zones.filter(other => holderKey(other.name) === holderKey(zone.name)).length === 1;
        const reuse = !references.has(sourceId) && unique && matches.length === 1 && !used.has(matches[0].id);
        const id = references.get(sourceId) || (reuse ? matches[0].id : `bbp-${nextId++}`);
        references.set(sourceId, id); used.add(id); zone.id = id;
    }
    if (input.player_place_id !== null && !references.has(input.player_place_id)) throw new Error('invalid_map');
    const player_place_id = input.player_place_id === null ? null : references.get(input.player_place_id);
    const edgeKeys = new Set(), edgeIds = new Set();
    const oldEdges = previous?.layout === 'graph' ? previous.connections || [] : [];
    let nextEdgeId = Math.max(0, ...oldEdges.map(edge => Number(/^bbc-(\d+)$/.exec(edge.id)?.[1]) || 0)) + 1;
    const key = edge => JSON.stringify([edge.direction === 'forward' ? [edge.from, edge.to] : [edge.from, edge.to].sort(), edge.direction]);
    const connections = input.connections.map(source => {
        if (!source || !references.has(source.from) || !references.has(source.to) || source.from === source.to
            || !['door', 'path', 'stairs', 'opening', 'passage', 'unknown'].includes(source.kind)
            || !['confirmed', 'uncertain', 'blocked'].includes(source.status)
            || (source.direction !== undefined && !['both', 'forward'].includes(source.direction))) throw new Error('invalid_map');
        const edge = { from: references.get(source.from), to: references.get(source.to), name: requiredText(source.name),
            kind: source.kind, status: source.status, direction: source.direction || 'both', evidence: optionalText(source.evidence) };
        if ([edge.name, edge.evidence].some(text => text.length > 1500) || (edge.status !== 'uncertain' && !edge.evidence)) throw new Error('invalid_map');
        const identity = key(edge);
        if (edgeKeys.has(identity)) throw new Error('invalid_map');
        edgeKeys.add(identity);
        const matches = oldEdges.filter(old => key(old) === identity);
        edge.id = matches.length === 1 && !edgeIds.has(matches[0].id) ? matches[0].id : `bbc-${nextEdgeId++}`;
        edgeIds.add(edge.id);
        return edge;
    });
    return { layout: 'graph', scope: input.scope, player_place_id, connections };
}

// Read into a separate view. Existing saved raw/context/previous values remain untouched.
export function readMapState(saved) {
    if (!saved?.raw || ![1, 2, 3].includes(saved.version ?? 1)) throw new Error('invalid_map');
    if (saved.version === GRAPH_MAP_DATA_VERSION) {
        const view = normalizeGraphMapData(saved.raw, saved.raw), used = new Set();
        // A saved graph already resolved identity. Reading must not reassign repeated names.
        const keepIds = (entries, sources) => entries.forEach((entry, index) => {
            const id = sources[index]?.id;
            if (!validTopologyId(id) || used.has(id)) throw new Error('invalid_map');
            used.add(id); entry.id = id;
        });
        keepIds(view.zones, saved.raw.zones);
        keepIds(view.connections, saved.raw.connections);
        keepIds(view.effects || [], saved.raw.effects || []);
        view.zones.forEach((zone, index) => {
            keepIds(zone.poi, saved.raw.zones[index].poi || []);
            keepIds(zone.characters, saved.raw.zones[index].characters || []);
        });
        keepIds(view.unlocated_objects || [], saved.raw.unlocated_objects || []);
        return view;
    }
    if (saved.raw.layout === 'graph') throw new Error('invalid_map');
    return normalizeMapData(saved.raw, saved.raw);
}

export function getMapRoute(raw, destinationId) {
    if (raw?.layout !== 'graph' || !raw.player_place_id || !raw.zones.some(zone => zone.id === destinationId)) return null;
    const queue = [{ places: [raw.player_place_id], connections: [] }], seen = new Set();
    while (queue.length) {
        const route = queue.shift(), last = route.places.at(-1);
        if (last === destinationId) return route;
        if (seen.has(last)) continue;
        seen.add(last);
        for (const edge of raw.connections) {
            if (edge.status !== 'confirmed') continue;
            const next = edge.from === last ? edge.to : edge.direction === 'both' && edge.to === last ? edge.from : null;
            if (next && !seen.has(next)) queue.push({ places: [...route.places, next], connections: [...route.connections, edge.id] });
        }
    }
    return null;
}

export function buildMapContextString(mapData) {
    if (!mapData || !Array.isArray(mapData.zones)) return '';
    const graph = mapData.layout === 'graph';
    const location = graph ? mapData.zones.find(zone => zone.id === mapData.player_place_id)?.name : mapData.schematic_name;
    let context = graph ? `[Map context: Scene "${mapData.schematic_name}". Scope: ${mapData.scope}. Player position: ${location ? JSON.stringify(location) : 'unknown'}. Atmosphere: ${mapData.atmosphere}. `
        : `[Map context: The player is at "${mapData.schematic_name}". Atmosphere: ${mapData.atmosphere}. `;
    for (const zone of mapData.zones) {
        const characters = Array.isArray(zone.characters) && zone.characters.length
            ? ` Characters: ${zone.characters.map(c => `${c.name} (${c.mood || ''}, attitude: ${c.attitude || ''})`).join(', ')}.` : '';
        const objects = Array.isArray(zone.poi) && zone.poi.length
            ? ` Objects: ${zone.poi.map(item => `${poiName(item)}${item.item_state === 'held' ? ` (held by ${item.holder})`
                : item.item_state === 'unknown' ? ' (whereabouts unknown)' : ''}`).join(', ')}.` : '';
        let threat = '';
        if (zone.threat_level === 'danger') threat = ` [🔴 DANGER: ${zone.threat_reason || 'Unknown'}]`;
        else if (zone.threat_level === 'tension') threat = ` [🟠 Tension: ${zone.threat_reason || 'Suspicious'}]`;
        else if (zone.threat_reason) threat = ` [🟢 Safe: ${zone.threat_reason}]`;
        if (graph || characters || objects || zone.threat_level !== 'safe' || zone.threat_reason) {
            context += `Zone "${zone.name}" (${graph ? `${zone.kind}, id: ${zone.id}${zone.uncertain ? ', uncertain' : ''}` : zone.position})${threat}: ${zone.summary || ''}${characters}${objects} `;
        }
    }
    if (graph) {
        for (const edge of mapData.connections) context += `Passage "${edge.name}": ${edge.from} ${edge.direction === 'forward' ? '->' : '<->'} ${edge.to} (${edge.kind}, ${edge.status}); evidence: ${edge.evidence || 'not established'}. `;
        context += 'Missing connections are unknown, not evidence of a blocked path. ';
    }
    const carried = (mapData.unlocated_objects || []).filter(item => item.item_state === 'held');
    if (carried.length) context += `Carried objects ${graph ? 'outside mapped places' : 'outside the current grid'}: ${carried.map(item =>
        `${item.name} (held by ${item.holder})`).join(', ')}. `;
    return `${context}]`;
}

export function createSavedMap(raw, current = null) {
    const previous = current?.raw ? {
        version: current.version || 1,
        raw: current.raw,
        context: current.context || '',
    } : null;
    return {
        version: raw.layout === 'graph' ? GRAPH_MAP_DATA_VERSION : MAP_DATA_VERSION,
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
        for (const zone of [...(raw?.zones || []), { poi: raw?.unlocated_objects || [], characters: [], position: '' }]) {
            for (const value of zone[type === 'character' ? 'characters' : 'poi'] || []) {
                const name = poiName(value);
                if (!name) continue;
                const key = entityKey(type, name);
                const entry = { name, description: optionalText(value?.description), position: zone.position };
                if (type === 'character') {
                    for (const field of ['mood', 'attitude', 'thought']) entry[field] = optionalText(value?.[field]);
                }
                else for (const field of ['item_state', 'holder', 'state_reason', 'last_known']) entry[field] = optionalText(value?.[field]);
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
                const keys = type === 'character' ? ['description', 'mood', 'attitude', 'thought'] : ['description', 'item_state', 'holder', 'state_reason', 'last_known'];
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
