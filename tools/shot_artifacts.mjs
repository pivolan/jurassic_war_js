// Два маленьких снимка для показа сообществу: кнопка включения украшений и подсказка по предмету.
//   node tools/shot_artifacts.mjs [out/img/показ]
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const КУДА = process.argv[2] || '../out/img/показ';
const ПОРТ = 8813;
fs.mkdirSync(КУДА, { recursive: true });
const сервер = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const бр = await chromium.launch(); const стр = await бр.newPage({ viewport: { width: 1100, height: 800 } });
const ош = []; стр.on('pageerror', e => ош.push(e.message));
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html`, { waitUntil: 'load' });
await стр.waitForFunction(() => window.__jw && window.__jw.shell, null, { timeout: 30000 });
for (let k = 0; k < 60; k++) { const ок = await стр.evaluate(() => { try { window.__jw.startMission(1, 0, 1); return true; } catch { return false; } }); if (ок) break; await new Promise(r => setTimeout(r, 2000)); }
await стр.waitForFunction(() => window.__jw.shell.screen === 'game', null, { timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
// включаем украшения и даём юниту артефакт
await стр.evaluate(() => {
  const { mem, eng, F, G, U, UNITS, Артефакты } = window.__jw;
  if (!Артефакты.включено()) document.getElementById('artbtn').click();
  let мой = 0;
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const t = mem.u8(UNITS + i + U.TYPE);
    if (t >= 1 && t <= 13 && mem.u8(UNITS + i + U.OWNER) === mem.u8(G.humanOwner)) { мой = i; break; }
  }
  mem.w8(UNITS + мой + U.INV + 9, 20);          // Dragon's Eye
  mem.w32(0x31adc, мой);
  F[0x259e4](eng, { esi: мой }); F[0x26671](eng, { esi: мой });
  const b = 0x30c9c + 9 * 8;
  mem.w32(0x45098, (mem.u16(b) + mem.u16(b + 4)) >> 1);
  mem.w32(0x4509c, (mem.u16(b + 2) + mem.u16(b + 6)) >> 1);
});
await new Promise(r => setTimeout(r, 1200));
// 1. кнопка украшений в нижней полосе
const кн = await стр.locator('#artbtn').boundingBox();
await стр.screenshot({ path: КУДА + '/кнопка-украшений.png',
  clip: { x: Math.max(0, кн.x - 210), y: кн.y - 10, width: 420, height: кн.height + 20 } });
// 2. подсказка внизу игрового поля
const cv = await стр.locator('canvas').first().boundingBox();
await стр.screenshot({ path: КУДА + '/подсказка.png',
  clip: { x: cv.x, y: cv.y + cv.height - 130, width: Math.min(cv.width, 720), height: 130 } });
console.log('снято:', КУДА);
console.log(ош.length ? 'ОШИБКИ: ' + ош.slice(0, 4).join(' | ') : 'ошибок нет');
await бр.close(); сервер.kill();
