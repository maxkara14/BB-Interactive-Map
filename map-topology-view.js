import { getMapRoute, poiName } from './map-state.js';

// Visual changes only; map data remains unchanged.
export function getMapVisualChanges(raw, previous) {
    const places = new Map([...(previous?.zones || []), ...(previous?.connections || [])].map(place => [place.id, place]));
    return new Map([...raw.zones, ...(raw.connections || [])].map(place => [place.id, !places.has(place.id) ? 'is-new' : JSON.stringify(place) !== JSON.stringify(places.get(place.id)) ? 'is-changed' : '']));
}

export function layoutMiniMap(raw) {
    const current = raw.zones.find(zone => zone.id === raw.player_place_id);
    if (!current) return { nodes: [], edges: [], height: 0, extra: 0 };
    // Breadth-first neighborhood includes places reached through an intermediate zone.
    const ids = [current.id], seen = new Set(ids);
    for (let i = 0; i < ids.length; i++) {
        for (const edge of raw.connections) {
            const next = edge.from === ids[i] ? edge.to : edge.to === ids[i] ? edge.from : null;
            if (next && !seen.has(next)) { seen.add(next); ids.push(next); }
        }
    }
    const visible = ids.slice(1, 5), count = visible.length;
    const height = count > 2 ? 226 : count ? 142 : 62;
    const nodes = [{ ...current, x: 128, y: count > 2 ? 113 : 29, width: 104, height: 48, band: 0 }];
    visible.forEach((id, i) => {
        const row = count > 2 && i < 2 ? 0 : 1;
        const single = count === 1 || count === 3 && i === 2;
        nodes.push({ ...raw.zones.find(zone => zone.id === id), x: single ? 128 : i % 2 ? 202 : 54,
            y: count > 2 ? row ? 197 : 29 : 113, width: 100, height: 48, band: row });
    });
    const shown = new Set([current.id, ...visible]);
    const edges = raw.connections.filter(edge => shown.has(edge.from) && shown.has(edge.to));
    if (edges.some(edge => edge.from !== current.id && edge.to !== current.id)) {
        const slots = count > 2 ? [[202,29], [202,197], [54,29], [54,197]] : [[202,29], [202,113]];
        nodes[0].x = 54; nodes[0].y = count > 2 ? 113 : 71;
        nodes.slice(1).forEach((node, i) => { [node.x, node.y] = slots[i]; node.band = 0; });
    }
    return { nodes, edges, height, extra: ids.length - 1 - visible.length };
}

export function layoutMapPlaces(raw, width) {
    const columns = width < 500 ? 2 : 3;
    const gap = width < 500 ? 70 : 90;
    const cell = (width - 24 - gap * (columns - 1)) / columns;
    const size = zone => {
        const w = Math.min(cell, zone.kind === 'passage' ? 198 : zone.kind === 'outdoor' ? 186 : 168);
        const lines = Math.min(3, Math.ceil(zone.name.length / Math.max(10, (w - 20) / 7)));
        const flags = Number(zone.id === raw.player_place_id) + Number(zone.threat_level !== 'safe') + Number(zone.uncertain);
        return { w, height: Math.max(zone.kind === 'passage' ? 78 : zone.kind === 'outdoor' ? 118 : 106, 42 + lines * 19 + flags * 19) };
    };
    const tallest = Math.max(...raw.zones.map(zone => size(zone).height));
    const root = raw.zones.find(zone => zone.id === raw.player_place_id) || raw.zones[0];
    const distances = new Map([[root.id, 0]]), queue = [root.id];
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        for (const edge of raw.connections) {
            const next = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
            if (!next || distances.has(next)) continue;
            distances.set(next, distances.get(id) + 1); queue.push(next);
        }
    }
    const pitch = tallest + (raw.connections.some(edge => distances.get(edge.from) === distances.get(edge.to)) ? 70 : 27);
    const last = Math.max(...distances.values()) + 1;
    const groups = new Map();
    for (const zone of raw.zones) {
        const depth = distances.get(zone.id) ?? last;
        groups.set(depth, [...(groups.get(depth) || []), zone]);
    }
    const nodes = [];
    let top = 22;
    for (let band = 0; band <= Math.floor(last / columns); band++) {
        const depths = [...groups.keys()].filter(depth => Math.floor(depth / columns) === band);
        if (!depths.length) continue;
        const rows = Math.max(...depths.map(depth => groups.get(depth).length));
        const bandHeight = rows * pitch;
        for (const depth of depths) groups.get(depth).forEach((zone, i, entries) => {
            const { w, height } = size(zone);
            const col = depth % columns;
            nodes.push({ ...zone, band, x: 12 + col * (cell + gap) + cell / 2,
                y: top + bandHeight / 2 + (i - (entries.length - 1) / 2) * pitch, width: w, height });
        });
        top += bandHeight + 30;
    }
    return { nodes, height: Math.max(190, top) };
}

export function layoutMapPassage(p, q, nodes, width) {
    const dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
    const clearance = node => Math.min(Math.abs(ux) > 1e-6 ? node.width / 2 / Math.abs(ux) : Infinity,
        Math.abs(uy) > 1e-6 ? node.height / 2 / Math.abs(uy) : Infinity);
    const start = clearance(p), end = length - clearance(q);
    const a = { x: p.x + ux * start, y: p.y + uy * start }, b = { x: p.x + ux * end, y: p.y + uy * end };
    const hit = nodes.some(node => {
        if (node.id === p.id || node.id === q.id) return false;
        let lo = 0, hi = 1;
        for (const [position, delta, min, max] of [[a.x, b.x - a.x, node.x - node.width / 2 - 5, node.x + node.width / 2 + 5],
            [a.y, b.y - a.y, node.y - node.height / 2 - 5, node.y + node.height / 2 + 5]]) {
            if (Math.abs(delta) < 1e-6) { if (position < min || position > max) return false; }
            else { const t1 = (min - position) / delta, t2 = (max - position) / delta; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); }
        }
        return lo <= hi;
    });
    if (!hit) return [a, b];
    if (Math.abs(dx) > width * .5 && p.band !== q.band) {
        const upper = Math.min(p.band, q.band), lower = Math.max(p.band, q.band);
        const middle = (Math.max(...nodes.filter(node => node.band === upper).map(node => node.y + node.height / 2))
            + Math.min(...nodes.filter(node => node.band === lower).map(node => node.y - node.height / 2))) / 2;
        const side = node => node.x < width / 2 ? 4 : width - 4;
        const ps = side(p), qs = side(q);
        return [{ x: p.x + Math.sign(ps - p.x) * p.width / 2, y: p.y }, { x: ps, y: p.y }, { x: ps, y: middle },
            { x: qs, y: middle }, { x: qs, y: q.y }, { x: q.x + Math.sign(qs - q.x) * q.width / 2, y: q.y }];
    }
    if (Math.abs(dx) > 1) {
        const sign = Math.sign(dx), sx = p.x + sign * p.width / 2, ex = q.x - sign * q.width / 2, middle = (sx + ex) / 2;
        return [{ x: sx, y: p.y }, { x: middle, y: p.y }, { x: middle, y: q.y }, { x: ex, y: q.y }];
    }
    const half = Math.max(...nodes.filter(node => Math.abs(node.x - p.x) < 1).map(node => node.width / 2));
    const right = p.x + half + 13, channel = right < width - 6 ? right : p.x - half - 13;
    return [{ x: p.x + Math.sign(channel - p.x) * p.width / 2, y: p.y }, { x: channel, y: p.y },
        { x: channel, y: q.y }, { x: q.x + Math.sign(channel - q.x) * q.width / 2, y: q.y }];
}

export function createMapTopologyView(raw, { language = 'ru', animations = true, previous = null, showRoute = true, onSelect = () => {} } = {}) {
    const tr = (ru, en) => language === 'ru' ? ru : en;
    const element = document.createElement('section'); element.className = 'bb-topology' + (animations ? '' : ' bb-map-motion-off');
    const field = document.createElement('div'); field.className = 'bb-topology-field';
    field.setAttribute('aria-label', tr('Места и проходы', 'Places and passages'));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('bb-topology-lines'); svg.setAttribute('aria-hidden', 'true');
    const places = document.createElement('div'); field.append(svg, places);
    const legend = document.createElement('div'); legend.className = 'bb-topology-legend';
    for (const [kind, label] of [['room', tr('Помещение', 'Room')], ['outdoor', tr('Открытое место', 'Outdoors')],
        ['passage', tr('Проход', 'Passage')], ['uncertain', tr('Не подтверждён', 'Unconfirmed')], ['blocked', tr('Заблокирован', 'Blocked')]]) {
        if (['uncertain', 'blocked'].includes(kind) ? !raw.connections.some(edge => edge.status === kind) : !raw.zones.some(zone => zone.kind === kind)) continue;
        const entry = document.createElement('span'), swatch = document.createElement('i'); swatch.className = kind;
        entry.append(swatch, document.createTextNode(label)); legend.append(entry);
    }
    const detail = document.createElement('section'); detail.className = 'bb-topology-detail'; detail.setAttribute('aria-live', 'polite');
    element.append(field, legend, detail);
    let selected = raw.player_place_id || raw.zones[0].id;
    const changes = getMapVisualChanges(raw, previous);
    let initialDraw = true, detailTab = 'characters';
    const kinds = { room: ['Помещение', 'Room'], outdoor: ['Открытое место', 'Outdoors'], passage: ['Проход', 'Passage'],
        area: ['Участок', 'Area'], unknown: ['Тип неизвестен', 'Unknown type'] };
    const passageKinds = { door: ['Дверь', 'Door'], path: ['Тропинка', 'Path'], stairs: ['Ступени', 'Stairs'], opening: ['Проём', 'Opening'], passage: ['Проход', 'Passage'], unknown: ['Связь', 'Link'] };
    const states = { confirmed: ['Подтверждён', 'Confirmed'], uncertain: ['Не подтверждён', 'Unconfirmed'], blocked: ['Заблокирован', 'Blocked'] };
    const make = (tag, attrs, text) => {
        const node = document.createElementNS(svg.namespaceURI, tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
        if (text !== undefined) node.textContent = text;
        svg.append(node); return node;
    };
    const paragraph = (label, value, target = detail, className = '') => {
        if (!value) return;
        const p = document.createElement('p'); p.className = className;
        if (label) { const b = document.createElement('strong'); b.textContent = label + ': '; p.append(b); }
        p.append(document.createTextNode(value)); target.append(p);
    };
    function draw() {
        if (!field.isConnected || !field.clientWidth) return;
        const focusedId = places.querySelector(':focus')?.dataset.placeId;
        const focusedDetail = detail.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
        const width = field.clientWidth, layout = layoutMapPlaces(raw, width);
        field.style.height = `${layout.height}px`; svg.setAttribute('viewBox', `0 0 ${width} ${layout.height}`);
        svg.replaceChildren(); places.replaceChildren();
        const byId = new Map(layout.nodes.map(node => [node.id, node]));
        const route = getMapRoute(raw, selected), labelGeometry = new Map();
        for (const edge of raw.connections) {
            const p = byId.get(edge.from), q = byId.get(edge.to);
            const dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy);
            if (!length) continue;
            const path = layoutMapPassage(p, q, layout.nodes, width);
            const segments = path.slice(1).map((b, i) => ({ a: path[i], b, length: Math.hypot(b.x - path[i].x, b.y - path[i].y) }));
            const longest = [...segments].sort((a, b) => b.length - a.length)[0], span = longest.length;
            const active = route?.connections.includes(edge.id);
            make('path', { d: path.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '), class: `bb-topology-edge is-line is-${edge.status}${initialDraw ? ' ' + (changes.get(edge.id) || '') : ''}${active ? ' is-route' : ''}${active && route.places[route.connections.indexOf(edge.id)] !== edge.from ? ' is-reverse' : ''}`, 'data-connection-id': edge.id });
            if (active || edge.direction === 'forward') {
                const reverse = active && route.places[route.connections.indexOf(edge.id)] !== edge.from;
                const directed = reverse ? [...path].reverse() : path;
                const tip = directed.at(-1), before = directed.at(-2), length = Math.hypot(tip.x - before.x, tip.y - before.y);
                const ux = (tip.x - before.x) / length, uy = (tip.y - before.y) / length;
                make('path', { d: `M ${tip.x - ux * 10 - uy * 4} ${tip.y - uy * 10 + ux * 4} L ${tip.x} ${tip.y} L ${tip.x - ux * 10 + uy * 4} ${tip.y - uy * 10 - ux * 4}`,
                    class: `bb-topology-edge bb-topology-arrow is-${edge.status}${active ? ' is-route' : ''}`,
                    'data-arrow-for': edge.id, 'data-destination-id': active ? route.places[route.connections.indexOf(edge.id) + 1] : edge.to });
            }
            const cx = (longest.a.x + longest.b.x) / 2, cy = (longest.a.y + longest.b.y) / 2;
            let angle = Math.atan2(longest.b.y - longest.a.y, longest.b.x - longest.a.x) * 180 / Math.PI;
            if (angle > 90) angle -= 180; if (angle < -90) angle += 180;
            const label = make('text', { x: 0, y: 0, dy: -8, transform: `translate(${cx} ${cy}) rotate(${angle})`,
                class: 'bb-topology-edge-label', 'data-connection-id': edge.id, 'data-span': span, 'data-angle': angle }, edge.name);
            if (label.getComputedTextLength() + 16 > span) label.textContent = tr(...passageKinds[edge.kind]);
            if (label.getComputedTextLength() + 16 > span) label.remove();
            else { label.dataset.name = edge.name; labelGeometry.set(label, { segments: [...segments].sort((a, b) => b.length - a.length), name: edge.name, short: tr(...passageKinds[edge.kind]) }); }
        }
        for (const node of layout.nodes) {
            const x = node.x - node.width / 2, y = node.y - node.height / 2;
            const cls = `bb-topology-shape is-${node.kind} is-${node.threat_level}${node.id === selected ? ' is-selected' : ''}${initialDraw ? ' ' + changes.get(node.id) : ''}`;
            if (node.kind === 'outdoor') make('path', { class: cls,
                d: `M ${x + 12} ${y + 22} Q ${x + node.width * .34} ${y - 5} ${x + node.width * .7} ${y + 7} Q ${x + node.width + 6} ${y + 16} ${x + node.width - 4} ${node.y} Q ${x + node.width + 2} ${y + node.height + 7} ${node.x} ${y + node.height - 4} Q ${x - 5} ${y + node.height + 7} ${x + 2} ${node.y} Z` });
            else make('rect', { x, y, width: node.width, height: node.height, rx: node.kind === 'passage' ? 3 : 9, class: cls });
            const button = document.createElement('button'); button.type = 'button'; button.className = 'bb-topology-place';
            button.dataset.placeId = node.id; button.setAttribute('aria-pressed', String(node.id === selected));
            button.title = node.name;
            button.style.cssText = `left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px`;
            const kind = document.createElement('small'); kind.textContent = tr(...kinds[node.kind]);
            const name = document.createElement('span'); name.textContent = node.name; button.append(kind, name);
            if (node.threat_level !== 'safe') {
                const threat = document.createElement('small'); threat.className = `bb-topology-threat is-${node.threat_level}`;
                threat.textContent = node.threat_level === 'danger' ? tr('Опасность', 'Danger') : tr('Напряжение', 'Tension'); button.append(threat);
            }
            if (node.id === raw.player_place_id) { const current = document.createElement('small'); current.className = 'bb-topology-current'; current.textContent = tr('● Вы здесь', '● You are here'); button.append(current); }
            if (node.uncertain) { const uncertain = document.createElement('small'); uncertain.textContent = tr('Не подтверждено', 'Unconfirmed'); button.append(uncertain); }
            const highlight = active => {
                const hoverRoute = active ? getMapRoute(raw, node.id) : null;
                for (const line of svg.querySelectorAll('.is-line')) {
                    const index = hoverRoute?.connections.indexOf(line.dataset.connectionId) ?? -1;
                    line.classList.toggle('is-hover', index >= 0);
                    if (!line.classList.contains('is-route')) line.classList.toggle('is-reverse', index >= 0 && hoverRoute.places[index] !== raw.connections.find(edge => edge.id === line.dataset.connectionId).from);
                }
            };
            button.onpointerenter = button.onfocus = () => highlight(true);
            button.onpointerleave = button.onblur = () => highlight(false);
            button.onclick = () => { selected = node.id; draw(); places.querySelector(`[data-place-id="${node.id}"]`)?.focus({ preventScroll: true }); onSelect(node, getMapRoute(raw, node.id)); };
            places.append(button);
        }
        const boxes = [...places.children].map(button => button.getBoundingClientRect()), labels = [];
        for (const label of svg.querySelectorAll('.bb-topology-edge-label')) {
            const geometry = labelGeometry.get(label);
            let placed = false;
            for (const segment of geometry.segments) {
                label.textContent = geometry.name;
                if (label.getComputedTextLength() + 16 > segment.length) label.textContent = geometry.short;
                if (label.getComputedTextLength() + 16 > segment.length) continue;
                const cx = (segment.a.x + segment.b.x) / 2, cy = (segment.a.y + segment.b.y) / 2;
                let angle = Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x) * 180 / Math.PI;
                if (angle > 90) angle -= 180; if (angle < -90) angle += 180;
                label.setAttribute('transform', `translate(${cx} ${cy}) rotate(${angle})`);
                label.dataset.span = segment.length; label.dataset.angle = angle;
                for (const offset of [-8, 16, 4]) {
                    label.setAttribute('dy', offset);
                    const box = label.getBoundingClientRect();
                    const intersects = other => box.left - 4 < other.right && box.right + 4 > other.left && box.top - 4 < other.bottom && box.bottom + 4 > other.top;
                    if (boxes.some(intersects) || labels.some(intersects)) continue;
                    labels.push(box); placed = true; break;
                }
                if (placed) break;
            }
            if (!placed) label.remove();
        }
        const node = byId.get(selected), samePlace = detail.dataset.placeId === selected;
        const opened = new Set(samePlace ? [...detail.querySelectorAll('details[open]')].map(item => item.dataset.entryKey) : []);
        const adjacent = raw.connections.filter(edge => edge.from === selected || edge.to === selected);
        if (!samePlace) detailTab = node.characters.length ? 'characters' : node.poi.length ? 'objects' : adjacent.length ? 'passages' : 'characters';
        detail.replaceChildren(); detail.dataset.placeId = selected;
        const heading = document.createElement('div'); heading.className = 'bb-topology-detail-heading';
        const titleGroup = document.createElement('div'), kicker = document.createElement('small'); kicker.className = 'bb-dossier-kicker';
        kicker.textContent = tr(...kinds[node.kind]) + (selected === raw.player_place_id ? ' · ' + tr('Вы здесь', 'You are here') : '');
        const title = document.createElement('h3'); title.textContent = node.name; titleGroup.append(kicker, title);
        const condition = document.createElement('span'); condition.className = 'bb-topology-condition is-' + node.threat_level;
        condition.textContent = node.threat_level === 'danger' ? tr('Опасность', 'Danger') : node.threat_level === 'tension' ? tr('Напряжение', 'Tension') : tr('Безопасно', 'Safe');
        condition.title = node.threat_reason; heading.append(titleGroup, condition); detail.append(heading);
        paragraph('', node.summary, detail, 'bb-topology-summary');
        if (node.uncertain) paragraph('', tr('Сведения о месте не подтверждены.', 'The place information is unconfirmed.'));
        const disclosure = (key, name, badge, target, className = 'bb-dossier-entry') => {
            const row = document.createElement('details'); row.className = className; row.dataset.entryKey = key; row.open = opened.has(key);
            const summary = document.createElement('summary'); summary.dataset.focusKey = key;
            const text = document.createElement('strong'); text.textContent = name; summary.append(text);
            if (badge) { const tag = document.createElement('span'); tag.className = 'bb-dossier-tag'; tag.textContent = badge; summary.append(tag); }
            row.append(summary); target.append(row); return row;
        };
        if (node.threat_reason) paragraph('', node.threat_reason, disclosure('conditions', tr('Обстановка', 'Conditions'), '', detail, 'bb-topology-more'));
        if (selected !== raw.player_place_id && (showRoute || !route)) paragraph(tr('Маршрут', 'Route'), route ? route.places.map(id => byId.get(id).name).join(' → ')
            : !raw.player_place_id ? tr('Положение игрока неизвестно.', 'The player position is unknown.') : tr('Подтверждённого маршрута нет.', 'No confirmed route.'), detail, 'bb-topology-route');
        const tabs = document.createElement('div'); tabs.className = 'bb-dossier-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', tr('Сведения о зоне', 'Place details'));
        const contents = document.createElement('div'); contents.className = 'bb-topology-contents';
        const categories = [['characters', tr('Персонажи', 'Characters'), node.characters], ['objects', tr('Предметы', 'Objects'), node.poi], ['passages', tr('Проходы', 'Passages'), adjacent]];
        for (const [key, label, entries] of categories) {
            const button = document.createElement('button'); button.type = 'button'; button.id = 'bb-dossier-tab-' + key;
            button.setAttribute('role', 'tab'); button.dataset.focusKey = 'tab-' + key; button.dataset.category = key;
            button.setAttribute('aria-selected', String(detailTab === key)); button.setAttribute('aria-controls', 'bb-dossier-panel-' + key);
            button.tabIndex = detailTab === key ? 0 : -1; button.append(document.createTextNode(label + ' '));
            const count = document.createElement('span'); count.textContent = entries.length; button.append(count); tabs.append(button);
            const panel = document.createElement('div'); panel.id = 'bb-dossier-panel-' + key; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id); panel.hidden = detailTab !== key;
            if (!entries.length) paragraph('', tr('Пока нет сведений.', 'No information yet.'), panel, 'bb-dossier-empty');
            entries.forEach((entry, i) => {
                const name = key === 'objects' ? poiName(entry) : key === 'passages' ? byId.get(entry.from === selected ? entry.to : entry.from).name : entry.name;
                const other = key === 'passages' ? byId.get(entry.from === selected ? entry.to : entry.from) : null;
                const badge = key === 'characters' ? entry.mood : other ? entry.status !== 'confirmed' ? tr(...states[entry.status])
                    : other.threat_level === 'danger' ? tr('Опасность', 'Danger') : other.threat_level === 'tension' ? tr('Напряжение', 'Tension') : tr('Безопасно', 'Safe') : '';
                const row = disclosure(key + '-' + (entry.id || i), name, badge, panel);
                if (key === 'passages') {
                    paragraph('', entry.name, row);
                    paragraph(tr('Тип', 'Type'), tr(...passageKinds[entry.kind]), row);
                    paragraph(tr('Статус', 'Status'), tr(...states[entry.status]), row);
                    paragraph(tr('Направление', 'Direction'), entry.direction === 'forward' ? byId.get(entry.from).name + ' → ' + byId.get(entry.to).name : tr('В обе стороны', 'Both ways'), row);
                    paragraph(tr('Наблюдение', 'Observation'), entry.evidence, row);
                } else {
                    paragraph('', entry.description, row);
                    if (key === 'characters') { paragraph(tr('Отношение', 'Attitude'), entry.attitude, row); paragraph(tr('Мысли', 'Thoughts'), entry.thought, row); }
                }
            });
            contents.append(panel);
            button.onclick = () => {
                detailTab = key;
                for (const tab of tabs.children) { const active = tab === button; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
                for (const section of contents.children) section.hidden = section !== panel;
            };
            button.onkeydown = event => {
                const index = ['ArrowRight','ArrowLeft','Home','End'].includes(event.key) ? [...tabs.children].indexOf(button) : -1;
                if (index < 0) return;
                event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                tabs.children[next].click(); tabs.children[next].focus();
            };
        }
        detail.append(tabs, contents);
        initialDraw = false;
        if (focusedId) places.querySelector(`[data-place-id="${focusedId}"]`)?.focus({ preventScroll: true });
        else if (focusedDetail) [...detail.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusedDetail)?.focus({ preventScroll: true });
    }
    const observer = new ResizeObserver(draw); observer.observe(field);
    return { element, refresh: draw, setAnimations: enabled => {
        element.classList.toggle('bb-map-motion-off', !enabled);
        element.closest('.bb-map-graph-modal')?.classList.toggle('bb-map-motion-off', !enabled);
    }, select: id => {
        if (!raw.zones.some(zone => zone.id === id)) return;
        selected = id; draw(); onSelect(raw.zones.find(zone => zone.id === id));
    }, destroy: () => observer.disconnect() };
}
