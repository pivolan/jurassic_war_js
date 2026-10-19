// Проверка современной схемы управления и приказа «следовать» (наше).
//   node tools/scheme_test.mjs
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
const ПОРТ = 8805;
const сервер = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const бр = await chromium.launch(); const стр = await бр.newPage({ viewport: { width: 1100, height: 800 } });
const ош = []; стр.on('pageerror', e => ош.push(e.message)); стр.on('console', m => { if (m.type() === 'error') ош.push(m.text()); });
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html`, { waitUntil: 'load' });
await стр.waitForFunction(() => window.__jw && window.__jw.shell, null, { timeout: 30000 });
for (let k = 0; k < 60; k++) { const ок = await стр.evaluate(() => { try { window.__jw.startMission(1, 0, 1); return true; } catch { return false; } }); if (ок) break; await new Promise(r => setTimeout(r, 2000)); }
await стр.waitForFunction(() => window.__jw.shell.screen === 'game', null, { timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
await стр.click('#schemebtn');
const схема = await стр.evaluate(() => window.__jw.Ввод.СХЕМА.современная);
console.log('схема современная:', схема);

// Выделим двух своих бойцов и ткнём правой по земле, затем правой по своему юниту.
const итог = await стр.evaluate(async () => {
  const { mem, eng, F, G, U, UNITS, Ввод, Следом } = window.__jw;
  const свои = [];
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const t = mem.u8(UNITS + i + U.TYPE);
    if (t >= 1 && t <= 13 && mem.u8(UNITS + i + U.OWNER) === mem.u8(G.humanOwner)) свои.push(i);
  }
  const [a, b, c] = свои;
  for (const i of [a, b]) mem.w8(UNITS + i + U.F07, mem.u8(UNITS + i + U.F07) | 0x80);
  mem.w32(0x31adc, a);
  // правая по пустой земле в двух клетках от a
  const x = (mem.u16(UNITS + a + U.X) + 128) & 0xffff, y = mem.u16(UNITS + a + U.Y);
  const экр = (wx, wy) => [(wx - mem.u32(0x31ae8)), (wy - mem.u32(0x31aec))];
  const [sx, sy] = экр(x, y);
  mem.w32(0x450cc, sx); mem.w32(0x450d0, sy);           // evX/evY
  mem.w32(0x33870, sx); mem.w32(0x33874, sy);           // «где нажали» — без протяжки
  F[0x1194c](eng);
  const приказЗемля = mem.u8(0x31acc);                   // код ожидающего клика
  // правая по своему юниту c
  const [cx, cy] = экр(mem.u16(UNITS + c + U.X), mem.u16(UNITS + c + U.Y));
  mem.w32(0x450cc, cx); mem.w32(0x450d0, cy); mem.w32(0x33870, cx); mem.w32(0x33874, cy);
  F[0x1194c](eng);
  await new Promise(r => setTimeout(r, 600));
  const ведомые = [...Следом.ведомые(eng).entries()].map(([i, с]) => [i, с.цель]);
  // Положим вещь на землю рядом и ткнём в неё правой: должен уйти приказ «подобрать» (0x4c).
  const ITEMS = 0xf4f34;
  const ix = (mem.u16(UNITS + a + U.X) >> 5) + 2, iy = mem.u16(UNITS + a + U.Y) >> 5;
  F[0x1c5a8](eng, { eax: 1, edx: ix, ebx: iy, ecx: 1, edi: F[0x1ca54](eng, {}).esi });
  const [px, py] = экр(ix << 5, iy << 5);
  mem.w32(0x450cc, px + 8); mem.w32(0x450d0, py + 8); mem.w32(0x33870, px + 8); mem.w32(0x33874, py + 8);
  mem.w8(0x31acc, 0xff);
  F[0x1194c](eng);
  const приказВещь = mem.u8(0x31acc);
  return { свои: свои.length, a, b, c, приказЗемля, ведомые, приказВещь };
});
console.log('итог:', JSON.stringify(итог));
console.log(ош.length ? 'ОШИБКИ: ' + ош.slice(0, 5).join(' | ') : 'ошибок нет');
await бр.close(); сервер.kill();
