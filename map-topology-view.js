import { getMapRoute, poiName } from './map-state.js';

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

export function createMapTopologyView(raw, { language = 'ru', onSelect = () => {} } = {}) {
    const tr = (ru, en) => language === 'ru' ? ru : en;
    const element = document.createElement('section'); element.className = 'bb-topology';
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
        const focusedMore = detail.querySelector('summary') === document.activeElement;
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
            make('path', { d: path.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '), class: `bb-topology-edge is-${edge.status}${active ? ' is-route' : ''}`, 'data-connection-id': edge.id });
            if (edge.direction === 'forward') {
                const last = segments.at(-1), ux = (last.b.x - last.a.x) / last.length, uy = (last.b.y - last.a.y) / last.length, ex = last.b.x, ey = last.b.y;
                make('path', { d: `M ${ex - ux * 10 - uy * 4} ${ey - uy * 10 + ux * 4} L ${ex} ${ey} L ${ex - ux * 10 + uy * 4} ${ey - uy * 10 - ux * 4}`,
                    class: `bb-topology-edge is-${edge.status}${active ? ' is-route' : ''}` });
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
            const cls = `bb-topology-shape is-${node.kind}${node.id === selected ? ' is-selected' : ''}`;
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
        const node = byId.get(selected), expanded = detail.querySelector('details')?.open && detail.dataset.placeId === selected;
        detail.replaceChildren(); detail.dataset.placeId = selected;
        const heading = document.createElement('div'); heading.className = 'bb-topology-detail-heading';
        const title = document.createElement('h3'); title.textContent = node.name;
        const condition = document.createElement('span'); condition.className = 'bb-topology-condition is-' + node.threat_level;
        condition.textContent = node.threat_level === 'danger' ? tr('Опасность', 'Danger') : node.threat_level === 'tension' ? tr('Напряжение', 'Tension') : tr('Безопасно', 'Safe');
        condition.title = node.threat_reason; heading.append(title, condition); detail.append(heading);
        paragraph('', node.summary, detail, 'bb-topology-summary');
        if (node.uncertain) paragraph('', tr('Сведения о месте не подтверждены.', 'The place information is unconfirmed.'));
        paragraph(tr('Маршрут', 'Route'), selected === raw.player_place_id ? tr('Текущее место', 'Current place')
            : route ? route.places.map(id => byId.get(id).name).join(' → ')
                : !raw.player_place_id ? tr('Положение игрока неизвестно.', 'The player position is unknown.') : tr('Подтверждённого маршрута нет.', 'No confirmed route.'), detail, 'bb-topology-route');
        const adjacent = raw.connections.filter(edge => edge.from === selected || edge.to === selected);
        if (adjacent.length) paragraph(tr('Проходы', 'Passages'), adjacent.map(edge => (edge.name.length <= 32 ? edge.name : tr(...passageKinds[edge.kind]))
            + (edge.status === 'confirmed' ? '' : ' · ' + tr(...states[edge.status]))).join(' · '), detail, 'bb-topology-route');
        const contents = document.createElement('div'); contents.className = 'bb-topology-contents';
        paragraph(tr('Персонажи', 'Characters'), node.characters.map(char => char.name).join(', '), contents);
        paragraph(tr('Предметы', 'Objects'), node.poi.map(poiName).join(', '), contents); detail.append(contents);
        const extra = document.createElement('details'); extra.className = 'bb-topology-more'; extra.open = !!expanded;
        const more = document.createElement('summary'); more.textContent = tr('Подробнее', 'Details'); extra.append(more);
        paragraph('', node.summary, extra);
        paragraph(tr('Обстановка', 'Conditions'), node.threat_reason, extra);
        for (const char of node.characters) {
            paragraph(char.name, [char.description, char.mood, char.attitude, char.thought].filter(Boolean).join(' · '), extra);
        }
        for (const item of node.poi) paragraph(poiName(item), item.description, extra);
        for (const edge of adjacent) {
            const other = byId.get(edge.from === selected ? edge.to : edge.from);
            paragraph(tr('Проход', 'Passage'), `${edge.name} · ${other.name} · ${tr(...states[edge.status])}${edge.direction === 'forward' ? ` · ${byId.get(edge.from).name} → ${byId.get(edge.to).name}` : ''}${edge.evidence ? ' · ' + edge.evidence : ''}`, extra);
        }
        if (extra.querySelector('p')) detail.append(extra);
        if (focusedId) places.querySelector(`[data-place-id="${focusedId}"]`)?.focus({ preventScroll: true });
        else if (focusedMore) detail.querySelector('summary')?.focus({ preventScroll: true });
    }
    const observer = new ResizeObserver(draw); observer.observe(field);
    return { element, refresh: draw, select: id => {
        if (!raw.zones.some(zone => zone.id === id)) return;
        selected = id; draw(); onSelect(raw.zones.find(zone => zone.id === id));
    }, destroy: () => observer.disconnect() };
}
