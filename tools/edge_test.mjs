// Проверка: полоски у края, прокрутка мышью и WASD.
//   node tools/edge_test.mjs
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
const ПОРТ = 8815;
const сервер = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const бр = await chromium.launch(); const стр = await бр.newPage({ viewport: { width: 1100, height: 800 } });
const ош = []; стр.on('pageerror', e => ош.push(e.message));
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html`, { waitUntil: 'load' });
await стр.waitForFunction(() => window.__jw && window.__jw.shell, null, { timeout: 30000 });
for (let k = 0; k < 60; k++) { const ок = await стр.evaluate(() => { try { window.__jw.startMission(1, 0, 1); return true; } catch { return false; } }); if (ок) break; await new Promise(r => setTimeout(r, 2000)); }
await стр.waitForFunction(() => window.__jw.shell.screen === 'game', null, { timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
const камера = () => стр.evaluate(() => [window.__jw.mem.u32(0x31ae8), window.__jw.mem.u32(0x31aec)]);
// WASD
await стр.evaluate(() => document.querySelector('canvas').focus());
const до = await камера();
await стр.keyboard.down('d'); await new Promise(r => setTimeout(r, 900)); await стр.keyboard.up('d');
const послеD = await камера();
await стр.keyboard.down('s'); await new Promise(r => setTimeout(r, 900)); await стр.keyboard.up('s');
const послеS = await камера();
console.log(`WASD: до ${до}, после D ${послеD}, после S ${послеS}`);
// Полоски: включаем и ведём мышь к левому краю
await стр.click('#edgebtn');
await new Promise(r => setTimeout(r, 1200));
await стр.screenshot({ path: '../out/img/показ/полоски.png', clip: { x: 95, y: 0, width: 730, height: 500 } });
const cv = await стр.locator('canvas').first().boundingBox();
const мышь = async (x, y, мс) => { await стр.mouse.move(cv.x + x, cv.y + y); await new Promise(r => setTimeout(r, мс)); };
await мышь(300, 240, 200);
const доКрая = await камера();
await мышь(6, 240, 1200);                     // левый край
const послеЛево = await камера();
await мышь(300, 474, 1200);                   // нижний край
const послеНиз = await камера();
console.log(`край: до ${доКрая}, после левого ${послеЛево}, после нижнего ${послеНиз}`);
console.log('вкл:', await стр.evaluate(() => window.__jw.mem.u16(0x3009c)));
console.log(ош.length ? 'ОШИБКИ: ' + ош.slice(0, 4).join(' | ') : 'ошибок нет');
await бр.close(); сервер.kill();
