import { poiName } from './map-state.js';

const MARKER = 'data-bb-map-mention';
const SKIP = `a, button, input, textarea, select, label, summary, pre, code, script, style, svg, math, [hidden], [aria-hidden="true"], [contenteditable], [role="button"], [${MARKER}]`;
const escapedPattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Match visual separators without rewriting text or changing DOM offsets.
const separators = '[\\s\\u3164\\uFFA0\\u2800\\u200B]';
const mentionKey = text => text.replace(new RegExp(`${separators}+`, 'gu'), ' ').trim().toLowerCase();

export function createMapMentionIndex(raw) {
    const groups = new Map();
    const add = (entry, name = entry.name) => {
        if (!entry.name) return;
        const key = mentionKey(name);
        if (!key) return;
        groups.set(key, [...(groups.get(key) || []), entry]);
    };
    for (const zone of Array.isArray(raw?.zones) ? raw.zones : []) {
        if (!zone || typeof zone !== 'object') continue;
        const location = { zone: zone.name || '', position: zone.position };
        if (typeof zone.name === 'string') add({ type: 'zone', name: zone.name.trim(), description: zone.summary || '',
            threat: zone.threat_level || 'safe', reason: zone.threat_reason || '', ...location });
        for (const value of Array.isArray(zone.poi) ? zone.poi : []) {
            add({ type: 'object', name: poiName(value), description: value?.description || '',
                item_state: value?.item_state, holder: value?.holder || '', last_known: value?.last_known || '', ...location });
        }
        for (const value of Array.isArray(zone.characters) ? zone.characters : []) {
            const entry = { type: 'character', name: poiName(value), description: value?.description || '',
                mood: value?.mood || '', attitude: value?.attitude || '', ...location };
            add(entry);
            const parts = mentionKey(entry.name).split(' ');
            if (parts.length > 1) {
                for (const part of new Set([parts[0], parts.at(-1)])) {
                    if (/^[\p{L}\p{M}]{2,}$/u.test(part)) add(entry, part);
                }
            }
        }
    }
    for (const item of raw?.unlocated_objects || []) {
        add({ ...item, type: 'object', zone: '', position: '' });
    }
    const entries = new Map([...groups].filter(([, values]) => values.length === 1).map(([key, values]) => [key, values[0]]));
    // Ambiguous long names still block shorter matches inside their phrase.
    const names = [...groups.keys()].sort((a, b) => b.length - a.length);
    // Unicode boundaries also work for Cyrillic; a hyphenated word is not a partial match.
    const word = '[\\p{L}\\p{M}\\p{N}_-]';
    const left = `(?:(?<!${word})|(?<=[\\u3164\\uFFA0]))`;
    const right = `(?:(?!${word})|(?=[\\u3164\\uFFA0]))`;
    const honorific = `(?=-(?:сан|сама|кун|чан|сенсей|san|sama|kun|chan|sensei)${right})`;
    const alternatives = names.map(name => {
        const phrase = name.split(' ').map(escapedPattern).join(`${separators}+`);
        const ending = entries.get(name)?.type === 'character' ? `(?:${right}|${honorific})` : right;
        return `${phrase}${ending}`;
    });
    const pattern = entries.size ? new RegExp(`${left}(?:${alternatives.join('|')})`, 'giu') : null;
    return { entries, pattern };
}

export function findMapMentions(text, index) {
    if (!index.pattern) return [];
    return [...text.matchAll(index.pattern)].filter(match => index.entries.has(mentionKey(match[0]))).map(match => ({
        start: match.index, end: match.index + match[0].length, text: match[0], key: mentionKey(match[0]),
    }));
}

// Presentation only: this controller never reads or writes the stored message array.
export function createChatMapLinks({ getMap, isEnabled, getLabels, onOpenMap }) {
    let root = null;
    let index = createMapMentionIndex(null);
    let timer = null;
    let card = null;
    let anchor = null;
    let refreshAll = false;
    let lastMap;
    let lastLanguage;
    let lastEnabled;
    let destroyed = false;
    const pending = new Set();
    const closeCard = (restoreFocus = false) => {
        card?.remove();
        card = null;
        if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
        anchor = null;
    };
    const unwrap = text => {
        const parents = new Set();
        for (const span of text.querySelectorAll(`[${MARKER}]`)) {
            parents.add(span.parentNode);
            span.replaceWith(...span.childNodes);
        }
        // Merge only the siblings we split. Recursive normalize() would also touch code and editors.
        for (const parent of parents) {
            let node = parent.firstChild;
            while (node) {
                const next = node.nextSibling;
                if (node.nodeType === Node.TEXT_NODE && next?.nodeType === Node.TEXT_NODE) {
                    node.appendData(next.data);
                    next.remove();
                } else node = next;
            }
        }
    };
    const decorate = text => {
        if (!text.isConnected) return;
        unwrap(text);
        if (!isEnabled() || !index.pattern) return;
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT, {
            acceptNode: node => node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            const matches = findMapMentions(node.data, index);
            if (!matches.length) continue;
            const fragment = document.createDocumentFragment();
            let offset = 0;
            for (const match of matches) {
                fragment.append(document.createTextNode(node.data.slice(offset, match.start)));
                const span = document.createElement('span');
                const entry = index.entries.get(match.key);
                span.className = `bb-map-mention bb-map-mention-${entry.type}`;
                span.setAttribute(MARKER, match.key);
                span.setAttribute('role', 'button');
                span.setAttribute('tabindex', '0');
                span.setAttribute('aria-haspopup', 'dialog');
                span.setAttribute('aria-label', `${getLabels().types[entry.type]}: ${entry.name}`);
                span.textContent = match.text;
                fragment.append(span);
                offset = match.end;
            }
            fragment.append(document.createTextNode(node.data.slice(offset)));
            node.replaceWith(fragment);
        }
    };
    const observe = () => {
        if (root && isEnabled() && index.pattern) observer.observe(root, {
            childList: true, characterData: true, subtree: true, attributes: true,
            attributeFilter: ['contenteditable', 'hidden', 'aria-hidden', 'role'],
        });
    };
    const flush = () => {
        timer = null;
        observer.disconnect();
        const texts = refreshAll ? root?.querySelectorAll('.mes_text') || [] : [...pending];
        refreshAll = false;
        pending.clear();
        try { for (const text of texts) decorate(text); }
        finally { observe(); }
        if (anchor && !anchor.isConnected) closeCard();
    };
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(flush, 150);
    };
    const queueNode = (node, descendants = false) => {
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        const text = element?.closest('.mes_text');
        if (text) pending.add(text);
        if (descendants) for (const child of element?.querySelectorAll?.('.mes_text') || []) pending.add(child);
    };
    const observer = new MutationObserver(records => {
        for (const record of records) {
            queueNode(record.target, record.type === 'attributes');
            for (const node of record.addedNodes) queueNode(node, true);
        }
        if (anchor && !anchor.isConnected) closeCard();
        if (pending.size) schedule();
    });
    const openCard = span => {
        const entry = index.entries.get(span.getAttribute(MARKER));
        if (!entry || !isEnabled()) return;
        if (anchor === span) { closeCard(true); return; }
        closeCard();
        anchor = span;
        const labels = getLabels();
        card = document.createElement('section');
        card.id = 'bb-map-mention-card';
        card.className = `bb-map-mention-card bb-map-mention-card-${entry.type}`;
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-labelledby', 'bb-map-mention-title');
        const tag = document.createElement('small');
        tag.textContent = labels.types[entry.type];
        const heading = document.createElement('h3');
        heading.id = 'bb-map-mention-title';
        heading.textContent = entry.name;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'bb-map-mention-close';
        close.textContent = '×';
        close.setAttribute('aria-label', labels.close);
        close.onclick = () => closeCard(true);
        const description = document.createElement('p');
        description.textContent = entry.description || labels.noDescription;
        const location = document.createElement('p');
        location.className = 'bb-map-mention-location';
        location.textContent = entry.type === 'object' && entry.item_state && labels.objectState
            ? `📍 ${labels.objectState(entry)}${entry.item_state !== 'unknown' && entry.zone ? ` · ${entry.zone}` : ''}`
            : `📍 ${entry.zone} · ${labels.position(entry.position)}`;
        card.append(tag, heading, close, description, location);
        for (const [field, title] of [['mood', labels.mood], ['attitude', labels.attitude], ['reason', labels.reason]]) {
            if (!entry[field]) continue;
            const detail = document.createElement('p');
            const strong = document.createElement('strong');
            strong.textContent = `${title}: `;
            detail.append(strong, document.createTextNode(entry[field]));
            card.append(detail);
        }
        if (entry.type === 'zone') {
            const threat = document.createElement('p');
            threat.className = `bb-map-mention-threat is-${['safe', 'tension', 'danger'].includes(entry.threat) ? entry.threat : 'safe'}`;
            threat.textContent = labels.threat(entry.threat);
            card.append(threat);
        }
        const source = document.createElement('small');
        source.className = 'bb-map-mention-source';
        source.textContent = labels.source;
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'bb-map-mention-open';
        open.textContent = labels.openMap;
        open.onclick = () => { closeCard(); onOpenMap(); };
        card.append(source, open);
        document.body.append(card);
        if (window.innerWidth > 600) {
            const bounds = span.getBoundingClientRect();
            const size = card.getBoundingClientRect();
            const top = bounds.bottom + 8 + size.height <= window.innerHeight - 8 ? bounds.bottom + 8 : bounds.top - size.height - 8;
            card.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - size.width - 8))}px`;
            card.style.top = `${Math.max(8, Math.min(top, window.innerHeight - size.height - 8))}px`;
        }
        close.focus({ preventScroll: true });
    };
    const click = event => {
        if (event.type === 'click' && window.getSelection()?.isCollapsed === false) return;
        const span = event.target.closest?.(`[${MARKER}]`);
        if (span && root?.contains(span)) { event.preventDefault(); event.stopPropagation(); openCard(span); }
    };
    const keydown = event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.(`[${MARKER}]`)) click(event);
    };
    const outside = event => { if (card && !card.contains(event.target) && !anchor?.contains(event.target)) closeCard(); };
    const escape = event => { if (card && event.key === 'Escape') { event.preventDefault(); closeCard(true); } };
    const scroll = event => { if (card && !card.contains(event.target)) closeCard(); };
    const resize = () => closeCard();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return {
        refresh() {
            if (destroyed) return;
            const nextRoot = document.getElementById('chat');
            const enabled = isEnabled();
            const map = enabled ? getMap() : null;
            const language = getLabels().language;
            if (root === nextRoot && map === lastMap && language === lastLanguage && enabled === lastEnabled) return;
            lastMap = map;
            lastLanguage = language;
            lastEnabled = enabled;
            closeCard();
            observer.disconnect();
            if (root !== nextRoot) {
                root?.removeEventListener('click', click);
                root?.removeEventListener('keydown', keydown);
                root = nextRoot;
                root?.addEventListener('click', click);
                root?.addEventListener('keydown', keydown);
            }
            index = createMapMentionIndex(map);
            refreshAll = true;
            schedule();
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            clearTimeout(timer);
            observer.disconnect();
            closeCard();
            for (const text of root?.querySelectorAll('.mes_text') || []) unwrap(text);
            root?.removeEventListener('click', click);
            root?.removeEventListener('keydown', keydown);
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('keydown', escape);
            document.removeEventListener('scroll', scroll, true);
            window.removeEventListener('resize', resize);
            pending.clear();
        },
    };
}
