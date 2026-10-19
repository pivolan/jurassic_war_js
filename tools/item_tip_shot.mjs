// Снимок подсказки по предмету на трёх языках (наше): кампанейская миссия, юниту выдаём меч и
// украшение, наводим курсор на слот и снимаем панель.
//
//   node tools/item_tip_shot.mjs [out/img/подсказки]
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const КУДА = process.argv[2] || '../out/img/подсказки';
const ПОРТ = 8801;
fs.mkdirSync(КУДА, { recursive: true });
const сервер = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const бр = await chromium.launch();
const стр = await бр.newPage({ viewport: { width: 1100, height: 800 } });
const ошибки = []; стр.on('pageerror', e => ошибки.push(e.message));
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html#tyrano/2`, { waitUntil: 'load' });
await стр.waitForFunction(() => window.__jw && window.__jw.playing !== undefined, null, { timeout: 30000 });
// Брифинг не проматывается кликом по канве из скрипта — заходим в партию напрямую.
// Карты подкачиваются фоном — пробуем, пока не получится.
for (let k = 0; k < 60; k++) {
  const ок = await стр.evaluate(() => { try { window.__jw.startMission(1, 0, 1); return true; } catch (e) { return false; } });
  if (ок) break;
  await new Promise(r => setTimeout(r, 2000));
}
await стр.waitForFunction(() => window.__jw.shell.screen === 'game', null, { timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
console.log('экран:', await стр.evaluate(() => window.__jw.shell.screen));
await new Promise(r => setTimeout(r, 2000));
const данные = await стр.evaluate(() => {
  const { mem, eng, F, G, U, UNITS } = window.__jw;
  let мой = 0;
  for (let i = mem.u32(G.unitHead); i; i = mem.u32(UNITS + i + U.NEXT)) {
    if (mem.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const t = mem.u8(UNITS + i + U.TYPE);
    if (t >= 1 && t <= 13 && mem.u8(UNITS + i + U.OWNER) === mem.u8(G.humanOwner)) { мой = i; break; }
  }
  if (!мой) return { ошибка: 'нет своего юнита' };
  const { mem: m2 } = window.__jw;
  mem.w8(UNITS + мой + U.INV + 0, 1);      // меч
  mem.w8(UNITS + мой + U.INV + 9, 20);     // Глаз дракона
  mem.w8(UNITS + мой + U.INV + 6, 12);     // яблоко
  mem.w32(0x31adc, мой);                   // выделенный
  try { F[0x259e4](eng, { esi: мой }); F[0x26671](eng, { esi: мой }); } catch (e) { return { ошибка: String(e) }; }
  return { юнит: мой };
});
console.log('подготовка:', JSON.stringify(данные));
const слот = async (k) => стр.evaluate((k) => {
  const { mem } = window.__jw; const b = 0x30c9c + k * 8;
  mem.w32(0x45098, (mem.u16(b) + mem.u16(b + 4)) >> 1);
  mem.w32(0x4509c, (mem.u16(b + 2) + mem.u16(b + 6)) >> 1);
}, k);
for (const я of ['en', 'ru', 'pl']) {
  await стр.evaluate((я) => window.__jw.shell.setLang ? window.__jw.shell.setLang(я) : document.querySelectorAll('#lang').forEach(s => { s.value = я; s.dispatchEvent(new Event('change')); }), я);
  await new Promise(r => setTimeout(r, 700));
  await слот(9);
  await new Promise(r => setTimeout(r, 700));
  await стр.screenshot({ path: `${КУДА}/украшение-${я}.png` });
  await слот(0);
  await new Promise(r => setTimeout(r, 700));
  await стр.screenshot({ path: `${КУДА}/оружие-${я}.png` });
  console.log('снято', я);
}
// Кнопка «★»: включаем прибавки украшений и снимаем ту же подсказку ещё раз.
await стр.evaluate(() => { const s = document.querySelector('#lang'); s.value = 'ru'; s.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 500));
await стр.click('#artbtn');
await new Promise(r => setTimeout(r, 500));
const вкл = await стр.evaluate(() => window.__jw.Артефакты.включено());
await слот(9);
await new Promise(r => setTimeout(r, 700));
await стр.screenshot({ path: `${КУДА}/украшение-вкл.png` });
console.log('после нажатия ★ прибавки включены:', вкл);
console.log(ошибки.length ? 'ОШИБКИ: ' + ошибки.slice(0, 5).join(' | ') : 'ошибок нет');
await бр.close(); сервер.kill();
