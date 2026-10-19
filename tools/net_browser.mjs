// Сетевая партия в двух настоящих вкладках (наше): playwright, локальный статический сервер и
// релей из supervisor (ws://127.0.0.1:8791/). Хост и клиент входят в одну комнату, хост стартует,
// оба крутят локстеп ~N секунд; сверяем ходы и хеши, снимаем скриншоты.
//
//   node tools/net_browser.mjs [секунд] [игроков] [out/img/сеть] [public]
//
// public — та же проверка через боевой сайт: http://127.0.0.1:8000 (basic auth) и wss-релей.
//
// Запускать из каталога вне <project> (там локальный playwright без браузеров), см. заметку
// в памяти: рабочий — глобальный /usr/lib/node_modules/playwright.
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const СЕК = +(process.argv[2] || 40), ИГРОКОВ = +(process.argv[3] || 2), КУДА = process.argv[4] || '../out/img/сеть';
const ПУБЛИЧНО = process.argv[5] === 'public';
const ПОРТ = 8797, РЕЛЕЙ = ПУБЛИЧНО ? 'ws://127.0.0.1:8791/' : 'ws://127.0.0.1:8791/';
fs.mkdirSync(КУДА, { recursive: true });
const сервер = ПУБЛИЧНО ? null : spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const комната = 'проверка-' + Date.now();
const база = ПУБЛИЧНО ? 'http://127.0.0.1:8000/reimpl/web/game.html' : `http://127.0.0.1:${ПОРТ}/reimpl/web/game.html`;
const url = (k) => `${база}?net=${encodeURIComponent(РЕЛЕЙ)}&room=${комната}&name=вкладка${k}&auto=1&players=${ИГРОКОВ}&tribe=${k}`;

// Если вкладка перестала отвечать (вечный цикл в JS), останавливаем её отладчиком, печатаем стек
// и номер шага симуляции (растёт — значит просто медленно, стоит — значит зациклилась).
const cdp = new Map();
async function следить(p) { const c = await p.context().newCDPSession(p); await c.send('Debugger.enable'); cdp.set(p, c);
  c.on('Debugger.paused', async (e) => {
    let шаг = '?'; try { const r = await c.send('Debugger.evaluateOnCallFrame', { callFrameId: e.callFrames[0].callFrameId, expression: 'window.__jw && window.__jw.mem.u32(0x31ab4)' }); шаг = r.result.value; } catch {}
    console.log(`НЕ ОТВЕЧАЕТ (шаг ${шаг}), стек:`, e.callFrames.slice(0, 8).map(f => `${f.functionName || '?'}:${f.location.lineNumber + 1}`).join(' ← '));
    c.send('Debugger.resume').catch(() => {}); }); }
function сТаймаутом(p, обещание, мс = 8000) {
  let т; const сторож = new Promise((_, no) => { т = setTimeout(async () => { try { await cdp.get(p)?.send('Debugger.pause'); } catch {} setTimeout(() => no(new Error('вкладка не отвечает')), 4000); }, мс); });
  return Promise.race([обещание.finally(() => clearTimeout(т)), сторож]);
}
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const вкладки = [];
for (let k = 0; k < ИГРОКОВ; k++) {
  const ctx = await b.newContext({ viewport: { width: 900, height: 620 }, httpCredentials: undefined });
  const p = await ctx.newPage(); const лог = [];
  p.on('pageerror', e => лог.push('pageerror: ' + e.message));
  p.on('response', r => { if (r.status() >= 400) лог.push(`${r.status()} ${r.url()}`); });
  await p.goto(url(k), { waitUntil: 'domcontentloaded' });
  await следить(p);
  вкладки.push({ p, лог, k });
  await new Promise(r => setTimeout(r, 700));      // хост входит первым — он и станет хостом
}
const состояние = (p) => сТаймаутом(p, p.evaluate(() => { const n = window.__jw?.net; const л = n?.лс;
  return { фаза: n?.фаза, я: n?.я, хост: n?.канал?.хост, готова: n?.готова, племя: n?.моёПлемя, ход: л?.ход, шаг: л?.шаг,
           хеш: л ? (л.хеши.get(л.ход - 1) ?? null) : null, расхождение: л?.расхождение || null, ждём: л?.ждём || null,
           журнал: (n?.журнал || []).slice(-6), экран: window.__jw?.shell?.screen, шагПамяти: window.__jw?.mem.u32(0x31ab4),
           записей: window.__jw?.rec?.recs?.length ?? 0 }; }));
// ждём старта
let t0 = Date.now();
while (Date.now() - t0 < 90000) {
  const с = await Promise.all(вкладки.map(в => состояние(в.p)));
  if (с.every(x => x.фаза === 'игра' && x.готова)) break;
  await new Promise(r => setTimeout(r, 500));
}
console.log('после входа:', JSON.stringify(await Promise.all(вкладки.map(в => состояние(в.p)))).slice(0, 600));
// Приказ через слот «ожидающего клика» (как делает патруль): выделить своего бойца и послать его
// в точку. Дальше всё по-настоящему: 0x1419e → 0x14895 → пакет хода → очередь на всех машинах.
const мойБоец = (p) => p.evaluate(() => { const j = window.__jw, m = j.mem, U = 0xe4400, h = m.u8(0x31b64);
  for (let i = m.u32(0x31b6c); i; i = m.u32(U + i + 0x60)) { const t = m.u8(U + i + 4); if (t >= 1 && t <= 13 && m.u8(U + i + 6) === h && !(m.u8(U + i + 0x5b) & 1)) return { i, x: m.u16(U + i + 0x2f), y: m.u16(U + i + 0x31) }; } return null; });
const где = (p, i) => сТаймаутом(p, p.evaluate((i) => { const m = window.__jw.mem, U = 0xe4400; return { x: m.u16(U + i + 0x2f), y: m.u16(U + i + 0x31), st: m.u8(U + i + 0x2b) }; }, i));
const бойцы = [];
for (const в of вкладки) {
  const б = await мойБоец(в.p); бойцы.push(б); if (!б) continue;
  await в.p.evaluate(({ i, x, y }) => { const m = window.__jw.mem, U = 0xe4400;
    m.w32(0x31adc, i); m.w8(U + i + 7, m.u8(U + i + 7) | 0x80);                       // выделить
    m.w8(0x31acc, 0x0f); m.w32(0x31ad0, 0); m.w32(0x31ad4, (x + 160) & 0xffff); m.w32(0x31ad8, y); }, б);   // идти на 5 клеток вправо
}
await new Promise(r => setTimeout(r, СЕК * 1000 / 2));
// тот же боец глазами каждой вкладки: позиции обязаны совпасть у всех и отличаться от стартовой
const шаг = (т) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}с] ${т}`);
for (const [k, б] of бойцы.entries()) if (б) {
  шаг('смотрим бойца ' + k);
  const у = await Promise.all(вкладки.map(в => где(в.p, б.i)));
  console.log(`боец вкладки ${k} (${б.i.toString(16)}): старт ${б.x},${б.y} → ` + у.map(v => `${v.x},${v.y}`).join(' | '),
              у.every(v => v.x === у[0].x && v.y === у[0].y) ? 'совпало' : 'РАЗНОЕ', (у[0].x !== б.x || у[0].y !== б.y) ? 'сдвинулся' : 'НЕ СДВИНУЛСЯ');
}
// приказ: мышью — выделить рамкой центр карты и щёлкнуть правой кнопкой в угол. Это идёт через
// настоящий разбор ввода 0x1419e → 0x14895 → пакет хода.
for (const в of вкладки) {
  const c = await в.p.$('#c'); const box = await c.boundingBox();
  const X = (x) => box.x + box.width * x / 640, Y = (y) => box.y + box.height * y / 480;
  await в.p.mouse.move(X(60), Y(60)); await в.p.mouse.down(); await в.p.mouse.move(X(300), Y(300), { steps: 8 }); await в.p.mouse.up();
  await new Promise(r => setTimeout(r, 300));
  await в.p.mouse.click(X(320 + в.k * 40), Y(200 + в.k * 30), { button: 'right' });
}
await new Promise(r => setTimeout(r, СЕК * 1000 / 2));
// Рассинхрон: последней вкладке нарочно портим состояние (HP её же бойца). Локстеп обязан поймать
// это по хешу, запросить снимок у хоста и продолжить, а не встать.
let восстановилась = 'не проверялось';
if (ИГРОКОВ >= 2 && бойцы[ИГРОКОВ - 1]) {
  шаг('порча состояния у последней вкладки');
  const в = вкладки[ИГРОКОВ - 1];
  await в.p.evaluate((i) => { const m = window.__jw.mem, U = 0xe4400; m.w8(U + i + 0x0e, m.u8(U + i + 0x0e) ^ 0x20); }, бойцы[ИГРОКОВ - 1].i);
  const t1 = Date.now(); восстановилась = 'НЕТ';
  while (Date.now() - t1 < 20000) {
    const с = await состояние(в.p);
    if (с.журнал.some(т => т.startsWith('состояние восстановлено'))) { восстановилась = `да, за ${Date.now() - t1} мс`; break; }
    await new Promise(r => setTimeout(r, 300));
  }
  await new Promise(r => setTimeout(r, 4000));
  const после = await Promise.all(вкладки.map(в => состояние(в.p)));
  console.log('после порчи:', после.map(с => `ход ${с.ход} хеш ${(с.хеш >>> 0).toString(16)}${с.расхождение ? ' РАСХОЖДЕНИЕ' : ''}`).join(' | '), '· восстановление:', восстановилась);
}
шаг('итог');
const итог = await Promise.all(вкладки.map(в => состояние(в.p)));
for (const [k, с] of итог.entries()) console.log(`вкладка ${k}:`, JSON.stringify(с));
for (const в of вкладки) { await в.p.screenshot({ path: `${КУДА}/вкладка${в.k}.png` }); if (в.лог.length) console.log(`ошибки вкладки ${в.k}:`, в.лог.slice(0, 8).join(' | ')); }
// Выход игрока: закрываем последнюю вкладку — остальные должны доиграть его пакеты и идти дальше без него.
let безУшедшего = 'не проверялось';
if (ИГРОКОВ >= 2) {
  const было = (await состояние(вкладки[0].p)).ход;
  await вкладки[ИГРОКОВ - 1].p.context().close();
  await new Promise(r => setTimeout(r, 5000));
  const с = await состояние(вкладки[0].p);
  безУшедшего = с.ход > было + 5 && !с.ждём?.length ? `да, ход ${было} → ${с.ход}` : `НЕТ: ход ${было} → ${с.ход}, ждём ${JSON.stringify(с.ждём)}`;
  console.log('после выхода игрока:', безУшедшего, '·', с.журнал.slice(-2).join(' / '));
}
const ходы = итог.map(с => с.ход), хеши = итог.map(с => с.хеш);
const близко = Math.max(...ходы) - Math.min(...ходы) <= 3;
const одинХеш = new Set(итог.filter(с => с.ход === Math.min(...ходы)).map(с => с.хеш)).size <= 1;
console.log(близко && итог.every(с => !с.расхождение) ? `ОК: ходы ${ходы.join('/')}, расхождений нет, хеши ${хеши.map(h => (h >>> 0).toString(16)).join('/')}` : `ПЛОХО: ходы ${ходы.join('/')}, расхождения ${JSON.stringify(итог.map(с => с.расхождение))}`);
await b.close(); сервер?.kill();
process.exit(близко && итог.every(с => !с.расхождение) ? 0 : 1);
