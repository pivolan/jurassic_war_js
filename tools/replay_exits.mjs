// Какие выходы из партии сохраняют реплей и отправляют его на сервер (наше).
//
//   node tools/replay_exits.mjs
//
// Зачем. Реплеи нужны для разбора живых партий, и обидно потерять запись из-за того, что игрок
// вышел «не той кнопкой». Здесь по очереди проверяются все способы закончить партию: кнопка
// «меню» в верхней панели, кнопка «уровни», круглое меню (выход, рестарт, загрузка), рестарт
// скирмиша, победа и просто закрытая вкладка. После каждого — смотрим, прибавилось ли записей
// у релея (он поднимается тут же, на своём порту, с временным каталогом).
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ПОРТ = 8797, РЕЛЕЙ = 8796;
const хранилище = fs.mkdtempSync(path.join(os.tmpdir(), 'jwreplays-'));
const статика = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'], { cwd: '<web root>', stdio: 'ignore' });
const релей = spawn('node', ['../tools/net_server.mjs', String(РЕЛЕЙ)], { stdio: 'ignore', env: { ...process.env, 'JW_РЕПЛЕИ': хранилище } });
await new Promise(r => setTimeout(r, 1200));

const реплеев = async () => {
  try { const о = await fetch(`http://127.0.0.1:${РЕЛЕЙ}/replays`); return (await о.json()).length; } catch (e) { console.log('релей не отвечает:', e.message); return -1; }
};
const браузер = await chromium.launch();

/** Открыть вкладку, начать партию и прокрутить её немного (реплей пишется от старта). */
async function партия(стр, { скирмиш = false } = {}) {
  await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html`, { waitUntil: 'load' });
  await стр.waitForFunction(() => window.__jw && window.__jw.net, null, { timeout: 30000 });
  // Релей стенда — наш временный: адрес лежит в поле лобби, оттуда его берёт отправка реплея.
  await стр.evaluate((п) => { document.getElementById('netaddr').value = `ws://127.0.0.1:${п}/`; }, РЕЛЕЙ);
  if (скирмиш) {
    await стр.click('#skirmbtn');
    await стр.waitForFunction(() => window.__jw.net.фаза === 'лобби' && window.__jw.net.лобби.места.length, null, { timeout: 30000 });
    // Адрес релея ставим ДО старта: промежуточная отправка (раз в минуту) читает поле в момент
    // отправки, и если там ещё стоит адрес по умолчанию, первая копия уедет в никуда.
    await стр.evaluate((п) => { document.getElementById('netaddr').value = `ws://127.0.0.1:${п}/`; }, РЕЛЕЙ);
    await стр.evaluate(async () => { await new Promise(r => setTimeout(r, 600)); await window.__jw.net.запустить(); });
    await стр.waitForFunction(() => window.__jw.net.активна && window.__jw.net.готова, null, { timeout: 40000 });
  } else {
    await стр.evaluate(() => window.__jw.startMission(1, 0, 1));       // миссия, племя, сложность
  }
  // Ждём больше 200 шагов: короче этого запись сознательно не сохраняется («вышли сразу же»).
  await стр.waitForFunction(() => window.__jw.mem.u32(0x31ab4) > 460, null, { timeout: 60000 });
  // Адрес релея ставим ПОСЛЕ старта: открытие лобби перетирает поле значением по умолчанию
  // (оно берётся из адреса страницы). Отправка реплея читает поле в момент сохранения.
  await стр.evaluate((п) => { document.getElementById('netaddr').value = `ws://127.0.0.1:${п}/`; }, РЕЛЕЙ);
  // Ждём промежуточную отправку: с первой минуты партия уже лежит на сервере, и закрытая
  // вкладка её не теряет.
  await стр.evaluate(() => new Promise(r => setTimeout(r, 18000)));
}

const итоги = [];
async function проверить(имя, действие, опции = { скирмиш: true }) {
  const было = await реплеев();
  const стр = await браузер.newPage({ viewport: { width: 1100, height: 800 } });
  стр.on('pageerror', e => console.log('   ошибка страницы:', String(e.message).slice(0, 120)));
  стр.on('console', m => { if (m.type() === 'error') console.log('   консоль:', m.text().slice(0, 120)); });
  let ошибка = null;
  try { await партия(стр, опции); await действие(стр); await стр.evaluate(() => new Promise(r => setTimeout(r, 1500))).catch(() => {}); }
  catch (e) { ошибка = String(e.message).slice(0, 80); }
  await new Promise(r => setTimeout(r, 800));
  const стало = await реплеев();
  await стр.close().catch(() => {});
  итоги.push({ имя, сохранил: стало > было, ошибка });
  console.log(`${стало > было ? '✔' : '✘'} ${имя}${ошибка ? '  (' + ошибка + ')' : ''}`);
}

await проверить('контроль: saveReplay напрямую', с => с.evaluate(() => window.__jw.saveReplay('victory')));
await проверить('кнопка «меню» в верхней панели', с => с.click('#menu'));
await проверить('кнопка «уровни» в верхней панели', async с => {
  с.on('dialog', d => d.accept());                       // спрашивает «выйти? партия не сохранится»
  await с.click('#levels'); await с.waitForTimeout(1500);
});
await проверить('кнопка «сдаться и сохранить реплей»', async с => {
  с.on('dialog', d => d.accept());
  await с.click('#netsurrender'); await с.waitForTimeout(2500);
});
await проверить('кнопка «выйти и сохранить реплей»', async с => { await с.click('#netquit'); await с.waitForTimeout(1500); });
await проверить('круглое меню → выход', с => с.evaluate(() => { const s = window.__jw.shell; s.onLeaveGame?.('exit'); s.toMenu(); }));
await проверить('круглое меню → рестарт', с => с.evaluate(() => { const s = window.__jw.shell; s.onLeaveGame?.('restart'); }));
await проверить('кнопка «заново» в панели скирмиша', с => с.click('#netrestart'));
await проверить('закрытая вкладка', async с => { await с.close({ runBeforeUnload: true }); await new Promise(r => setTimeout(r, 1200)); });

console.log('\nсводка:');
for (const и of итоги) console.log(`  ${и.сохранил ? 'сохраняет' : 'ТЕРЯЕТ  '}  ${и.имя}`);
await браузер.close(); статика.kill(); релей.kill();
fs.rmSync(хранилище, { recursive: true, force: true });
process.exit(0);
