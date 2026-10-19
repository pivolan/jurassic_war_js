// node reimpl/web/shot.mjs URL OUT.png [keys...]  — скриншот страницы (playwright, глобальный)
import { chromium } from 'playwright';
const [url, out, ...keys] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }); const p = await b.newPage({ viewport: { width: 660, height: 520 } });
const logs = []; p.on('console', m => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', e => logs.push('pageerror: ' + e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' }).catch(e => logs.push('goto: ' + e.message)); await p.waitForTimeout(4000);
for (const k of keys) { await p.keyboard.press(k); await p.waitForTimeout(80); }
await p.screenshot({ path: out }); console.log(logs.slice(0, 10).join('\n')); console.log('hud:', await p.textContent('#hud', { timeout: 2000 }).catch(() => '(нет #hud)')); await b.close();
