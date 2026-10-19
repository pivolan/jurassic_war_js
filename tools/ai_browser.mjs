// Скирмиш «компьютер против компьютера» в настоящей вкладке (наше): playwright, локальный
// статический сервер, без релея. Проверяем, что лобби заводится, наблюдатель включается,
// скриптовый ИИ ходит и отладочный слой рисуется.
//
//   node tools/ai_browser.mjs [секунд] [out/img/ии]
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const СЕК = +(process.argv[2] || 40), КУДА = process.argv[3] || '../out/img/ии';
const ПОРТ = 8799;
fs.mkdirSync(КУДА, { recursive: true });
const сервер = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const браузер = await chromium.launch();
const стр = await браузер.newPage({ viewport: { width: 1100, height: 800 } });
const ошибки = [];
стр.on('pageerror', (e) => ошибки.push('pageerror: ' + e.message));
// Отправку реплея на релей в стенде игнорируем: страницу отдаёт python -m http.server, он на
// POST отвечает 501, и браузер печатает это сам. В бою на этот адрес отвечает релей.
стр.on('console', (m) => { if (m.type() === 'error' && !m.text().includes("501 (Unsupported method ('POST'))")) ошибки.push('console: ' + m.text()); });
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html?aidebug=1`, { waitUntil: 'load' });
await стр.waitForFunction(() => window.__jw && window.__jw.net, null, { timeout: 30000 });

// Скирмиш: открыть лобби
await стр.click('#skirmbtn');
await стр.waitForFunction(() => window.__jw.net.фаза === 'лобби' && window.__jw.net.лобби.места.length, null, { timeout: 30000 });
// Все места — компьютерам, сами уходим в зрители
const мест = await стр.evaluate(async () => {
  const net = window.__jw.net;
  // Места в скирмише теперь и так за компьютером с самого начала — проверяем это, а не
  // расставляем руками, и заодно жмём «злого компьютера» (кнопка-чёрт в правилах партии).
  const сразуКомпов = net.лобби.места.filter(м => м.кто === 'компьютер').length;
  net.место(0, 'злые');
  await new Promise(r => setTimeout(r, 300));
  const зверских = net.лобби.места.filter(м => м.кто === 'компьютер' && м.уровень === 3).length;
  await new Promise(r => setTimeout(r, 600));
  await net.сменитьРоль('наблюдатель');
  await new Promise(r => setTimeout(r, 600));
  const зверскихПосле = () => net.лобби.места.filter(м => м.кто === 'компьютер' && м.уровень === 3).length;
  return { мест: net.лобби.места.length, сразуКомпов, зверских, зверскихПослеУхода: зверскихПосле(), компов: net.лобби.места.filter(м => м.кто === 'компьютер').length, роль: net.роль };
});
console.log('лобби:', JSON.stringify(мест));
await стр.screenshot({ path: КУДА + '/лобби.png' });
await стр.evaluate(() => window.__jw.net.запустить());
await стр.waitForFunction(() => window.__jw.net.активна && window.__jw.net.готова, null, { timeout: 30000 });
console.log('партия пошла');
const снять = async (имя) => { await стр.screenshot({ path: `${КУДА}/${имя}.png` }); };
for (let k = 0; k < СЕК; k += 10) {
  await new Promise(r => setTimeout(r, 10000));
  const св = await стр.evaluate(() => {
    const { mem, eng } = window.__jw; const G = 0x31ab4;
    const шаг = mem.u32(G);
    const ии = window.__jw.ИИ ? window.__jw.ИИ.все(eng).map(с => `${с.цвет}:${с.осанка} армия${с.отряды.кулак.length} раб${с.отряды.рабочие.length} еда${mem.u32(0x31c28 + с.цвет * 4)}`) : [];
    return { шаг, ии };
  });
  console.log(`  ${k + 10} с: шаг ${св.шаг}, штабы ${св.ии.join(' ') || '—'}`);
  await снять('ход-' + (k + 10));
}
// Кнопка «заново»: партия должна начаться с нуля теми же настройками.
const рестарт = await стр.evaluate(async () => {
  const { mem, __jw } = { mem: window.__jw.mem, __jw: window.__jw };
  const шагДо = mem.u32(0x31ab4);
  document.getElementById('netrestart').click();
  await new Promise(r => setTimeout(r, 2500));
  return { шагДо, шагПосле: mem.u32(0x31ab4), активна: window.__jw.net.активна, готова: window.__jw.net.готова,
           видна: !document.getElementById('netrestart').hidden };
});
console.log('рестарт:', JSON.stringify(рестарт));

// Туман: смотрим за всех и глазами разных сторон.
const туман = await стр.evaluate(async () => {
  const net = window.__jw.net, mem = window.__jw.mem;
  const BI = 0x10ce74;
  const открыто = () => { let n = 0; for (let k = 0; k < 0xb000; k++) if (mem.b[BI + k] & 1) n++; return n; };
  const из = { стороны: net.стороныВИгре() };
  net.задатьТуман('племя', из.стороны[0]); await new Promise(r => setTimeout(r, 900)); из.перваяСторона = открыто();
  net.задатьТуман('племя', из.стороны[1]); await new Promise(r => setTimeout(r, 900)); из.втораяСторона = открыто();
  net.задатьТуман('все'); await new Promise(r => setTimeout(r, 900)); из.все = открыто();
  net.задатьТуман('племя', из.стороны[0]); await new Promise(r => setTimeout(r, 900)); из.перваяСнова = открыто();
  return из;
});
console.log('туман:', JSON.stringify(туман));

// Отдаление карты: жмём лупу дважды и снимаем «всю карту».
await стр.evaluate(() => { const b = document.getElementById('zoomout'); b.click(); b.click(); });
await new Promise(r => setTimeout(r, 1500));
await стр.screenshot({ path: КУДА + '/вся-карта.png' });
const з = await стр.evaluate(() => ({ уровень: window.__jw.ЗУМ?.уровень, видно: !document.getElementById('zoomout').hidden }));
console.log('зум:', JSON.stringify(з));
console.log(ошибки.length ? 'ОШИБКИ:\n' + ошибки.slice(0, 10).join('\n') : 'ошибок в консоли нет');
await браузер.close(); сервер.kill();
