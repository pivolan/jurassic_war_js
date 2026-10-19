// Снимки экранов кампании для сайта (наше): заставка стадии, экран победы, финал племени, поражение.
//   node tools/campaign_shots.mjs [out/site/campaign]
//
// Что откуда. Заставка брифинга и картинка победы лежат в паке 09 и зависят только от НОМЕРА
// СТАДИИ, не от племени: все восемь кампаний идут по одним и тем же двенадцати картинкам, меняется
// только текст. Финальная картинка (GRPEND) — наоборот, своя у каждого племени. Экран поражения
// один на всех. Там, где вместо картинки победы лежит NULLDAT.DAT, в оригинале играл ролик из
// пака 11 — он перекодирован в out/video/winNN.*, и на сайте вместо картинки ставится видео.
//
// Текст на заставке гасим (briefHead/briefBody пустые): на странице он идёт обычным HTML — его
// можно читать, переводить и искать. Подпись на экране победы гасится тем же приёмом.
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const КУДА = process.argv[2] || '../out/site/campaign';
const ПОРТ = 8819;
fs.mkdirSync(КУДА, { recursive: true });
const сервер = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const бр = await chromium.launch();
const стр = await бр.newPage({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 1 });
const ош = []; стр.on('pageerror', e => ош.push(e.message));
const пауза = (мс) => new Promise(r => setTimeout(r, мс));
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html`, { waitUntil: 'load' });
await стр.waitForFunction(() => window.__jw && window.__jw.shell, null, { timeout: 40000 });
// Экраны кампании живут в полном паке; ждём, пока он доедет.
await стр.evaluate(() => window.__jw.shell.withFullPack(() => {}));
await стр.waitForFunction(() => window.__jw.shell.fullPack, null, { timeout: 180000 });
// Заставки и экраны победы лежат в паке 09 (тексты брифингов — там же), он грузится отдельно.
await стр.evaluate(() => window.__jw.shell.need('_PWAR09.TRC'));
await стр.waitForFunction(() => { try { window.__jw.shell.loadBrief(); return true; } catch { return false; } }, null, { timeout: 180000 });
// Снимаем канву в её родном размере, а не в подогнанном под окно.
await стр.evaluate(() => { const c = document.querySelector('canvas'); c.style.width = '640px'; c.style.height = '480px'; });
const канва = await стр.$('canvas');

// Курсор рисует сам движок по координатам в памяти (0x45098/0x4509c). Уводим его за нижний край,
// иначе белая стрелка остаётся на каждом снимке.
const убратьКурсор = () => стр.evaluate(() => { window.__jw.mem.w32(0x45098, 700); window.__jw.mem.w32(0x4509c, 600); });

async function снять(имя, дело, арг) {
  await стр.evaluate(дело, арг);
  await убратьКурсор();
  await пауза(260);
  await канва.screenshot({ path: `${КУДА}/${имя}.png` });
}

// 1. Заставки стадий (те же для всех племён).
for (let м = 0; м < 12; м++) {
  await снять(`brief-${String(м + 1).padStart(2, '0')}`, (м) => {
    const s = window.__jw.shell; s.mission = м; s.tribe = 0;
    s.loadBrief(); s.briefHead = []; s.briefBody = []; s.screen = 'briefing'; s.dirty = true;
  }, м);
}
// 2. Картинки победы. Где вместо картинки NULLDAT.DAT — там ролик, снимок не нужен.
// Картинки WIN лежат только у стадий 2, 4, 6, 7, 8, 9, 10; у остальных на их месте NULLDAT.DAT,
// и вместо картинки в оригинале играл ролик (out/video/winNN.*). Снимаем только настоящие.
const С_КАРТИНКОЙ = [2, 4, 6, 7, 8, 9, 10];
for (const ст of С_КАРТИНКОЙ) {
  await снять(`win-${String(ст).padStart(2, '0')}`, (ст) => {
    const s = window.__jw.shell; s.mission = ст - 1; s.tribe = 0; s.подписьИтога = ' ';
    s.screen = 'victory'; s.dirty = true;
  }, ст);
}
// 3. Финал. В коде он берётся по племени (запись 38 + племя*2), но в паке все восемь записей —
// один и тот же GRPEND1: концовка у всех племён одинаковая. Снимаем её один раз.
await снять('ending', () => { const s = window.__jw.shell; s.tribe = 0; s.mission = 11; s.подписьИтога = ' '; s.screen = 'ending'; s.dirty = true; });
// 4. Поражение — одно на всех.
await снять('defeat', () => { const s = window.__jw.shell; s.подписьИтога = ' '; s.screen = 'defeat'; s.dirty = true; });

console.log(ош.length ? 'ОШИБКИ: ' + ош.slice(0, 5).join(' | ') : 'ошибок нет');
console.log('снимки в ' + КУДА + ':', fs.readdirSync(КУДА).length);
await бр.close(); сервер.kill();
