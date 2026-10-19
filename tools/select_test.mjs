// Проверка выделения (наше): двойной щелчок по своему бойцу выделяет всех такого же типа
// в пределах видимой части карты, одиночный — только его самого.
//   node tools/select_test.mjs
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
const ПОРТ = 8803;
const сервер = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const б = await chromium.launch();
const стр = await б.newPage({ viewport: { width: 1100, height: 800 } });
const ошибки = [];
стр.on('pageerror', e => ошибки.push('pageerror: ' + e.message));
стр.on('console', m => { if (m.type() === 'error') ошибки.push('console: ' + m.text()); });
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html`, { waitUntil: 'load' });
await стр.waitForFunction(() => window.__jw && window.__jw.net, null, { timeout: 30000 });
await стр.click('#skirmbtn');
await стр.waitForFunction(() => window.__jw.net.фаза === 'лобби' && window.__jw.net.лобби.места.length, null, { timeout: 30000 });
await стр.evaluate(async () => {
  const net = window.__jw.net;
  for (let i = 1; i < net.лобби.места.length; i++) net.место(i, 'компьютер');
  await new Promise(r => setTimeout(r, 600));
  net.запустить();
});
await стр.waitForFunction(() => window.__jw.net.активна && window.__jw.net.готова, null, { timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));
const r = await стр.evaluate(async () => {
  const j = window.__jw, { mem, U, UNITS, G, eng } = j;
  const мой = mem.u8(G.humanOwner);
  const свои = [];
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const t = mem.u8(UNITS + i + U.TYPE);
    if (mem.u8(UNITS + i + U.OWNER) === мой && t >= 1 && t <= 13) свои.push({ i, t, x: mem.u16(UNITS + i + U.X), y: mem.u16(UNITS + i + U.Y) });
  }
  const по = {}; for (const с of свои) (по[с.t] ??= []).push(с);
  const тип = Object.keys(по).map(Number).sort((a, b) => по[b].length - по[a].length)[0];
  const образец = по[тип][0];
  // навести камеру на него, чтобы все такие были на экране
  mem.w32(0x31ae8, Math.max(0, образец.x - 200)); mem.w32(0x31aec, Math.max(0, образец.y - 150));
  const выделено = () => { let n = 0; for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) if (mem.u8(UNITS + i + 7) & 0x80) n++; return n; };
  const наЭкране = по[тип].filter(с => с.x >= mem.u32(0x31ae8) && с.x < mem.u32(0x31ae8) + (mem.u32(0x31af0) << 5) && с.y >= mem.u32(0x31aec) && с.y < mem.u32(0x31aec) + (mem.u32(0x31af4) << 5)).length;
  return { тип, всегоТакогоТипа: по[тип].length, наЭкране, экранX: mem.u16(UNITS + образец.i + U.X) - mem.u32(0x31ae8) + 16, экранY: mem.u16(UNITS + образец.i + U.Y) - mem.u32(0x31aec) + 16 };
});
const рамка = await стр.evaluate(() => { const c = document.getElementById('c').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
const точка = { x: рамка.x + r.экранX * рамка.w / 640, y: рамка.y + r.экранY * рамка.h / 480 };
const выделено = () => стр.evaluate(() => { const { mem, U, UNITS, G } = window.__jw; let n = 0; for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) if (mem.u8(UNITS + i + 7) & 0x80) n++; return { n, sel: mem.u32(0x31adc) }; });
await стр.mouse.click(точка.x, точка.y); await new Promise(r => setTimeout(r, 700));
const один = await выделено();
await стр.mouse.click(точка.x, точка.y); await new Promise(r => setTimeout(r, 80));
await стр.mouse.click(точка.x, точка.y); await new Promise(r => setTimeout(r, 700));
const два = await выделено();
console.log(JSON.stringify({ ...r, послеОдного: один, послеДвойного: два }));
console.log(ошибки.length ? ошибки.slice(0, 5) : 'ошибок нет');
await б.close(); сервер.kill();
