// Render the reported narrow three-place map; model and chat services are not used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const strip = text => text.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<body style="margin:0;background:#10151b;color:#e2e8f0;font-family:system-ui"><main style="width:560px;max-width:calc(100vw - 32px);margin:16px;padding:12px;box-sizing:border-box;background:#11191b"></main></body>');
        await page.addStyleTag({ content: read('style.css') });
        await page.addScriptTag({ content: `${strip(read('map-state.js'))}\n${strip(read('map-topology-view.js'))}
            var raw = normalizeGraphMapData({ layout: 'graph', scope: 'scene', schematic_name: 'Никко — базальтовое ущелье', player_place_id: 'entrance',
                zones: [{ id: 'entrance', name: 'Вход в базальтовое ущелье Никко', kind: 'outdoor', threat_level: 'danger' },
                    { id: 'passage', name: 'Узкий проход в ущелье Никко', kind: 'passage', threat_level: 'danger' },
                    { id: 'ledge', name: 'Базальтовый карниз над ущельем', kind: 'outdoor', threat_level: 'danger', uncertain: true }],
                connections: [{ from: 'entrance', to: 'passage', name: 'Тропинка', kind: 'path', status: 'blocked', evidence: 'Путь перекрыт' },
                    { from: 'passage', to: 'ledge', name: 'Связь', kind: 'unknown', status: 'uncertain' }] });
            var view = createMapTopologyView(raw, { language: 'ru', animations: false });
            document.querySelector('main').append(view.element); view.refresh();
        ` });
        const check = async () => {
            await page.locator('.bb-topology-place').first().waitFor();
            await page.locator('.bb-topology-field').evaluate(field => {
                const buttons = [...field.querySelectorAll('.bb-topology-place')];
                for (const button of buttons) {
                    const box = button.getBoundingClientRect();
                    for (const child of button.children) {
                        if (child.scrollHeight > child.clientHeight + 1) throw Error('Clipped place text: ' + child.textContent);
                        const range = document.createRange(); range.selectNodeContents(child);
                        const text = range.getBoundingClientRect();
                        if (text.top < box.top + 6 || text.bottom > box.bottom - 6 || text.left < box.left || text.right > box.right + 1)
                            throw Error('Place text exceeds its shape: ' + child.textContent);
                    }
                    for (const other of buttons.filter(value => value !== button)) {
                        const next = other.getBoundingClientRect();
                        if (box.left < next.right && box.right > next.left && box.top < next.bottom && box.bottom > next.top)
                            throw Error('Place shapes overlap');
                    }
                }
                if (field.scrollWidth > field.clientWidth + 1) throw Error('Map exceeds available width');
            });
        };
        for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.evaluate(() => view.refresh());
            await check();
            await page.getByRole('button', { name: /Базальтовый карниз/ }).click();
            assert.match(await page.locator('.bb-topology-detail').innerText(), /Базальтовый карниз над ущельем/);
            if (process.argv[3]) { fs.mkdirSync(process.argv[3], { recursive: true });
                await page.screenshot({ path: path.join(process.argv[3], `place-labels-${width}.png`) }); }
        }
        // Longer names, a different inherited font size and all flags must remain readable.
        await page.evaluate(() => {
            view.destroy(); view.element.remove(); raw.zones[0].name = 'ОченьДлинноеНазваниеБезПробелов'.repeat(4);
            raw.zones[0].uncertain = true;
            view = createMapTopologyView(raw, { language: 'ru', animations: false });
            document.querySelector('main').append(view.element); view.refresh();
        });
        await page.addStyleTag({ content: '.bb-topology-place { font-size:18px; }' });
        await page.evaluate(() => view.refresh());
        await check();
        await page.evaluate(() => {
            document.querySelector('main').style.transform = 'scale(.8)';
            document.querySelector('main').style.transformOrigin = 'top left';
            view.refresh();
        });
        await check();
        assert.deepEqual(errors, []);
        console.log('Full place names, flags, shape bounds, selection, long words and responsive layout passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
