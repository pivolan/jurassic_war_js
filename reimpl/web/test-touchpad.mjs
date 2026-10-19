// Проверка тачпада и жестов пальцем (наше). Гоняет игру в headless-браузере через CDP и шлёт
// настоящие touch-события: тап, ведение, прокрутка от края, выделение рамкой, двойной тап.
// Всё, что ниже — линейный сценарий: короткие const внутри него это шаги проверки, а не функции
// (p — страница, T — отправка касания, pos/log — снятие состояния из памяти движка).
//
//   node reimpl/web/test-touchpad.mjs
// node reimpl/web/test-touchpad.mjs [URL] — проверка режима «тачпад» (playwright, тач-события через CDP).
// Скриншоты кладёт рядом: touchpad-*.png
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:8731/reimpl/web/index.html';
const OUT = process.argv[3] || '/tmp/claude-0/-var-www-rts/b998dabc-a3b7-4ada-9bf8-905b21426108/scratchpad';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let fails = 0;
const ok = (n, c, info = '') => { console.log((c ? '  ok  ' : ' FAIL ') + n + (info ? '  ' + info : '')); if (!c) fails++; };

// --- телефон
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const logs = []; p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.location()?.url || '')) logs.push(m.text() + ' @ ' + (m.location()?.url || '')); }); p.on('pageerror', e => logs.push('pageerror: ' + e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500);
const cdp = await ctx.newCDPSession(p);
const T = async (type, pts) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, radiusX: 8, radiusY: 8, force: 1 })) }); };
const pos = () => p.evaluate(() => [__jw.mem.u32(0x45098), __jw.mem.u32(0x4509c), __jw.mem.u32(0x46278) | 0, __jw.mem.u32(0x4627c) | 0]);
const rect = await p.evaluate(() => { const r = document.getElementById('c').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
// журнал вызовов кнопок мыши
await p.evaluate(() => { window.__log = []; const i = __jw.input;
  const d = i.mouseDown.bind(i), u = i.mouseUp.bind(i);
  i.mouseDown = (b, x, y) => { __log.push(['down', b, x, y]); d(b, x, y); };
  i.mouseUp = (b, x, y) => { __log.push(['up', b, x, y]); u(b, x, y); }; });
const log = () => p.evaluate(() => { const l = window.__log; window.__log = []; return l; });
// свайп: from → to за n шагов, каждый шаг с паузой dt мс (медленно = точно, быстро = ускорение)
async function swipe(fx, fy, tx, ty, n = 10, dt = 16, holdEnd = 0) {
  await T('touchStart', [[fx, fy]]);
  for (let i = 1; i <= n; i++) { await T('touchMove', [[fx + (tx - fx) * i / n, fy + (ty - fy) * i / n]]); await p.waitForTimeout(dt); }
  if (holdEnd) await p.waitForTimeout(holdEnd);
  await T('touchEnd', []);
}
const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;

console.log('\n== телефон 390×844 ==');
ok('режим по умолчанию — тачпад', await p.evaluate(() => __jw.input.padMode));
ok('кнопка режима подписана «тачпад»', (await p.textContent('#pmode')) === 'тачпад');
ok('подсказка про жесты видна', (await p.textContent('#phint')).includes('веди пальцем'));
await p.screenshot({ path: OUT + '/touchpad-phone-1-start.png' });

// 1. тап без движения = клик текущей кнопкой, курсор НЕ прыгает в точку касания
await p.evaluate(() => __jw.input.mouseMove(320, 240));
const before = await pos();
await T('touchStart', [[rect.x + 40, rect.y + 40]]); await p.waitForTimeout(60); await T('touchEnd', []);
await p.waitForTimeout(160);
const afterTap = await pos(); const lg1 = await log();
ok('тап не телепортирует курсор', before[0] === afterTap[0] && before[1] === afterTap[1], `${before.slice(0, 2)} → ${afterTap.slice(0, 2)}`);
ok('тап = нажатие+отпускание ЛКМ', lg1.length === 2 && lg1[0][0] === 'down' && lg1[0][1] === 0 && lg1[1][0] === 'up', JSON.stringify(lg1));

// 2. медленное ведение — точность, кнопка не нажата (ждём, чтобы не попасть в окно двойного тапа)
await p.waitForTimeout(400);
await p.evaluate(() => __jw.input.mouseMove(320, 240));
await swipe(cx, cy, cx + 30, cy, 10, 40);
const slow = await pos(); const lg2 = await log();
ok('медленный драг двигает курсор вправо', slow[0] > 325 && slow[0] < 420, 'x=' + slow[0]);
ok('драг без нажатия кнопки', lg2.length === 0, JSON.stringify(lg2));

// 3. быстрый флик — экран по диагонали одним движением
await p.evaluate(() => __jw.input.mouseMove(2, 2));
await swipe(rect.x + 20, rect.y + 20, rect.x + rect.w - 20, rect.y + rect.h - 20, 8, 6);
const flick = await pos();
ok('один быстрый флик проходит экран по диагонали', flick[0] >= 639 && flick[1] >= 479, `→ ${flick[0]},${flick[1]}`);
ok('курсор доезжает ровно до правого/нижнего края', flick[0] === 639 && flick[1] === 479);
const scrollRB = await p.evaluate(() => { __jw.F[0x12be6](__jw.eng); return __jw.mem.u32(0x3037c); });
ok('на правом/нижнем крае взведены биты прокрутки', (scrollRB & 6) !== 0, 'bl=' + scrollRB);

// 4. обратно в 0,0 (левый/верхний край — прокрутка влево/вверх)
await swipe(rect.x + rect.w - 20, rect.y + rect.h - 20, rect.x + 20, rect.y + 20, 8, 6);
const corner = await pos();
ok('курсор доезжает ровно до 0,0', corner[0] === 0 && corner[1] === 0, `→ ${corner[0]},${corner[1]}`);
await p.evaluate(() => { __jw.mem.w32(0x31ae8, 64); __jw.mem.w32(0x31aec, 64); __jw.F[0x12be6](__jw.eng); });
const scrollLT = await p.evaluate(() => __jw.mem.u32(0x3037c));
ok('на левом/верхнем крае взведены биты прокрутки', (scrollLT & 9) !== 0, 'bl=' + scrollLT);

// 5. точность: попасть в цель 20×20 небольшим медленным движением
await p.evaluate(() => __jw.input.mouseMove(300, 300));
await swipe(cx, cy, cx + 12, cy + 12, 6, 45);
const fine = await pos();
ok('медленное движение 12px даёт шаг < 20px по каждой оси', Math.abs(fine[0] - 300) < 20 && Math.abs(fine[1] - 300) < 20, `→ ${fine[0]},${fine[1]}`);
await log();

// 6. долгое удержание без движения = другая кнопка (ПКМ), отпускается при отрыве
await T('touchStart', [[cx, cy]]); await p.waitForTimeout(600); await T('touchEnd', []); await p.waitForTimeout(60);
const lg6 = await log();
ok('долгое нажатие даёт ПКМ', lg6.length === 2 && lg6[0][0] === 'down' && lg6[0][1] === 2 && lg6[1][0] === 'up' && lg6[1][1] === 2, JSON.stringify(lg6));

// 7. двойной тап с удержанием → рамка: кнопка зажата, курсор едет, отпускается на отрыве
await p.evaluate(() => __jw.input.mouseMove(200, 200));
await T('touchStart', [[cx, cy]]); await p.waitForTimeout(60); await T('touchEnd', []); await p.waitForTimeout(120);
await swipe(cx, cy, cx + 80, cy + 60, 10, 20);
await p.waitForTimeout(60);
const lg7 = await log(); const dragEnd = await pos();
const dIdx = lg7.findIndex(r => r[0] === 'down' && r[1] === 0), uIdx = lg7.map(r => r[0]).lastIndexOf('up');
ok('двойной тап с удержанием зажимает ЛКМ', dIdx >= 0 && uIdx > dIdx, JSON.stringify(lg7));
ok('во время удержания курсор уехал (рамка тянется)', dragEnd[0] > 240 && dragEnd[1] > 230, `→ ${dragEnd[0]},${dragEnd[1]}`);
await p.screenshot({ path: OUT + '/touchpad-phone-2-drag.png' });

// 8. защёлка «зажать»: кнопка держится между жестами, тап по канве отпускает
await p.evaluate(() => __jw.input.mouseMove(200, 200));
await p.click('#latch');
const lg8a = await log();
ok('«зажать» нажимает ЛКМ', lg8a.length === 1 && lg8a[0][0] === 'down' && lg8a[0][1] === 0, JSON.stringify(lg8a));
ok('кнопка «зажать» подсвечена', await p.evaluate(() => document.getElementById('latch').classList.contains('on')));
await swipe(cx, cy, cx + 60, cy + 40, 8, 25);
const lg8b = await log(); const latchPos = await pos();
ok('с защёлкой курсор едет, кнопка не отпускается', lg8b.length === 0 && latchPos[0] > 230, JSON.stringify(lg8b) + ' x=' + latchPos[0]);
await p.screenshot({ path: OUT + '/touchpad-phone-3-latch.png' });
await T('touchStart', [[cx, cy]]); await p.waitForTimeout(60); await T('touchEnd', []); await p.waitForTimeout(60);
const lg8c = await log();
ok('тап при защёлке отпускает кнопку', lg8c.length === 1 && lg8c[0][0] === 'up', JSON.stringify(lg8c));
ok('подсветка «зажать» снята', await p.evaluate(() => !document.getElementById('latch').classList.contains('on')));

// 9. ПКМ-режим: тап кликает выбранной кнопкой
await p.click('[data-mb="2"]');
await T('touchStart', [[cx, cy]]); await p.waitForTimeout(60); await T('touchEnd', []); await p.waitForTimeout(160);
const lg9 = await log();
ok('после выбора ПКМ тап кликает правой', lg9.length === 2 && lg9[0][1] === 2, JSON.stringify(lg9));
await p.click('[data-mb="0"]');

// 10. переключение в «тап»: абсолютные координаты, режим сохраняется в localStorage
await p.click('#pmode');
ok('режим переключился в «тап»', !(await p.evaluate(() => __jw.input.padMode)));
ok('localStorage запомнил режим', (await p.evaluate(() => localStorage.getItem('jw.pmode'))) === 'tap');
ok('кнопка «зажать» скрыта в режиме тапа', await p.evaluate(() => document.getElementById('latch').hidden));
await log();
await T('touchStart', [[rect.x + rect.w * 0.25, rect.y + rect.h * 0.25]]); await p.waitForTimeout(60); await T('touchEnd', []); await p.waitForTimeout(60);
const abs = await pos(); const lg10 = await log();
ok('в режиме «тап» курсор прыгает в точку касания', Math.abs(abs[0] - 160) < 12 && Math.abs(abs[1] - 120) < 12, `→ ${abs[0]},${abs[1]}`);
ok('в режиме «тап» нажатие происходит сразу на касании', lg10.length === 2 && lg10[0][0] === 'down', JSON.stringify(lg10));
await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500);
ok('режим «тап» пережил перезагрузку', !(await p.evaluate(() => __jw.input.padMode)));
await p.screenshot({ path: OUT + '/touchpad-phone-4-tapmode.png' });
ok('ошибок в консоли нет', logs.length === 0, logs.join(' | '));
await ctx.close();

// --- десктоп: мышь абсолютна и в режиме тачпада
console.log('\n== десктоп 1100×800 ==');
const ctx2 = await b.newContext({ viewport: { width: 1100, height: 800 } });
const p2 = await ctx2.newPage(); const logs2 = [];
p2.on('pageerror', e => logs2.push('pageerror: ' + e.message));
await p2.goto(URL, { waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(4500);
ok('на десктопе по умолчанию режим «тап»', !(await p2.evaluate(() => __jw.input.padMode)));
const r2 = await p2.evaluate(() => { const r = document.getElementById('c').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await p2.evaluate(() => { window.__log = []; const i = __jw.input; const d = i.mouseDown.bind(i), u = i.mouseUp.bind(i);
  i.mouseDown = (b, x, y) => { __log.push(['down', b, x, y]); d(b, x, y); }; i.mouseUp = (b, x, y) => { __log.push(['up', b, x, y]); u(b, x, y); }; });
await p2.mouse.move(r2.x + r2.w * 0.5, r2.y + r2.h * 0.5);
const hover = await p2.evaluate(() => [__jw.mem.u32(0x45098), __jw.mem.u32(0x4509c)]);
ok('мышь без кнопок ходит абсолютно (hover)', Math.abs(hover[0] - 320) < 6 && Math.abs(hover[1] - 240) < 6, hover.join(','));
await p2.mouse.down(); await p2.mouse.move(r2.x + r2.w * 0.75, r2.y + r2.h * 0.75, { steps: 6 }); await p2.mouse.up();
const dragTo = await p2.evaluate(() => [__jw.mem.u32(0x45098), __jw.mem.u32(0x4509c)]);
ok('рамка мышью: курсор пришёл в абсолютную точку', Math.abs(dragTo[0] - 480) < 8 && Math.abs(dragTo[1] - 360) < 8, dragTo.join(','));
// теперь включаем тачпад — мышь всё равно должна остаться абсолютной
await p2.click('#pmode');
ok('тачпад включён кнопкой', await p2.evaluate(() => __jw.input.padMode));
await p2.mouse.move(r2.x + r2.w * 0.2, r2.y + r2.h * 0.2, { steps: 4 });
const mAbs = await p2.evaluate(() => [__jw.mem.u32(0x45098), __jw.mem.u32(0x4509c)]);
ok('мышь абсолютна и при включённом тачпаде', Math.abs(mAbs[0] - 128) < 8 && Math.abs(mAbs[1] - 96) < 8, mAbs.join(','));
// экранные кнопки клавиатуры не сломаны
await p2.evaluate(() => window.__k = __jw.mem.u32(0x447c8));
await p2.click('[data-key="Space"]'); await p2.waitForTimeout(200);
ok('экранная кнопка клавиатуры по-прежнему шлёт скан-код', await p2.evaluate(() => __jw.mem.u32(0x447c8) !== window.__k));
await p2.screenshot({ path: OUT + '/touchpad-desktop.png' });
ok('ошибок в консоли нет (десктоп)', logs2.length === 0, logs2.join(' | '));

// --- сквозная проверка: рамкой с тачпада реально выделяются юниты (0x31adc — «лидер» выделения)
console.log('\n== выделение рамкой с тачпада ==');
const ctx3 = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p3 = await ctx3.newPage();
await p3.addInitScript(() => localStorage.setItem('jw.pmode', 'pad'));
await p3.goto(URL, { waitUntil: 'domcontentloaded' }); await p3.waitForTimeout(4500);
const cdp3 = await ctx3.newCDPSession(p3);
const T3 = (type, pts) => cdp3.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, radiusX: 8, radiusY: 8, force: 1 })) });
const r3 = await p3.evaluate(() => { const r = document.getElementById('c').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
ok('до рамки никто не выделен', (await p3.evaluate(() => __jw.mem.u32(0x31adc))) === 0);
await p3.evaluate(() => __jw.input.mouseMove(150, 150));
await p3.click('#latch');                                        // защёлка = «зажать ЛКМ»
const c3x = r3.x + r3.w / 2, c3y = r3.y + r3.h / 2;
await T3('touchStart', [[c3x, c3y]]);
for (let i = 1; i <= 12; i++) { await T3('touchMove', [[c3x + i * 12, c3y + i * 9]]); await p3.waitForTimeout(30); }
await T3('touchEnd', []);
const selPos = await p3.evaluate(() => [__jw.mem.u32(0x45098), __jw.mem.u32(0x4509c)]);
await p3.screenshot({ path: OUT + '/touchpad-select-1-rect.png' });
ok('рамка растянута курсором', selPos[0] > 300 && selPos[1] > 250, selPos.join(','));
await T3('touchStart', [[c3x, c3y]]); await p3.waitForTimeout(60); await T3('touchEnd', []); await p3.waitForTimeout(300);
const leader = await p3.evaluate(() => __jw.mem.u32(0x31adc));
ok('после отпускания рамки юниты выделены', leader !== 0, 'лидер=' + leader);
await p3.screenshot({ path: OUT + '/touchpad-select-2-done.png' });

await b.close();
console.log(fails ? `\n${fails} проверок упало` : '\nвсе проверки прошли');
process.exit(fails ? 1 : 0);
