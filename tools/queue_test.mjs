// Проверка очереди приказов по Shift и сбора мяса по клавише T (наше).
//   node tools/queue_test.mjs
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
const ПОРТ = 8802;
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

const шаг = (n) => new Promise(r => setTimeout(r, n));
// 1. Очередь из трёх точек: боец должен обойти их по очереди.
const очередь = await стр.evaluate(async () => {
  const j = window.__jw, { mem, U, UNITS, G, eng } = j;
  const мой = mem.u8(G.humanOwner);
  let боец = 0;
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const t = mem.u8(UNITS + i + U.TYPE);
    if (mem.u8(UNITS + i + U.OWNER) === мой && t >= 1 && t <= 13) { боец = i; break; }
  }
  if (!боец) return { нет: 'бойца' };
  mem.w8(UNITS + боец + U.F07, mem.u8(UNITS + боец + U.F07) | 0x80);
  const c = { x: mem.u16(UNITS + боец + U.X) >> 5, y: mem.u16(UNITS + боец + U.Y) >> 5 };
  j.Ввод.ШИФТ.нажат = true;
  const точки = [[c.x + 3, c.y], [c.x + 3, c.y + 3], [c.x, c.y + 3]];
  for (const [x, y] of точки) j.F[0x129cb](eng, { eax: 0x0f, esi: 0, edx: x << 5, ebx: y << 5 });
  j.Ввод.ШИФТ.нажат = false;
  return { боец, старт: c, точки, длина: j.ОчередьПриказов ? 0 : 0, вОчереди: window.__jw.eng.очередьПриказов?.get(боец)?.шаги.length ?? 0 };
});
console.log('очередь поставлена:', JSON.stringify(очередь));
await шаг(12000);
const прошёл = await стр.evaluate(() => {
  const j = window.__jw, { mem, U, UNITS } = j;
  const i = window.__зап || 0;
  return null;
});
const итог = await стр.evaluate((боец) => {
  const j = window.__jw, { mem, U, UNITS } = j;
  return { осталось: j.eng.очередьПриказов?.get(боец)?.шаги.length ?? 0,
           где: { x: mem.u16(UNITS + боец + U.X) >> 5, y: mem.u16(UNITS + боец + U.Y) >> 5 } };
}, очередь.боец);
console.log('после 12 с:', JSON.stringify(итог));

// 2. Клавиша T: разложить рядом мясо и собрать.
const мясо = await стр.evaluate(async () => {
  const j = window.__jw, { mem, U, UNITS, G, eng } = j;
  const мой = mem.u8(G.humanOwner);
  let боец = 0;
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const t = mem.u8(UNITS + i + U.TYPE);
    if (mem.u8(UNITS + i + U.OWNER) === мой && t >= 1 && t <= 13) { боец = i; break; }
  }
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT))
    if (mem.u8(UNITS + i + U.OWNER) === мой) mem.w8(UNITS + i + U.F07, mem.u8(UNITS + i + U.F07) & ~0x80);
  mem.w8(UNITS + боец + U.F07, mem.u8(UNITS + боец + U.F07) | 0x80);
  const c = { x: mem.u16(UNITS + боец + U.X) >> 5, y: mem.u16(UNITS + боец + U.Y) >> 5 };
  // положить три куска мяса рядом штатной функцией движка (0x1c247 — создать предмет)
  for (const [dx, dy] of [[2, 0], [0, 2], [-2, 1]]) j.F[0x1cdf3](eng, { eax: 0x1e, esi: 0, edx: (c.x + dx) << 5, ebx: (c.y + dy) << 5 });
  let мяса = 0; for (let it = mem.u32(0x31b7c); it; it = mem.u32(0xf4f34 + it + 0xc)) if (mem.u8(0xf4f34 + it) === 0x1e) мяса++;
  return { боец, где: c, мяса };
});
await стр.evaluate(() => document.getElementById('c').focus());
await стр.keyboard.press('KeyT');
await шаг(500);
const послеT = await стр.evaluate((боец) => ({ шагов: window.__jw.eng.очередьПриказов?.get(боец)?.шаги.length ?? 0 }), мясо.боец);
console.log('после T:', JSON.stringify(послеT));
console.log(ошибки.length ? ошибки.slice(0, 5) : 'ошибок нет');
await б.close(); сервер.kill();
