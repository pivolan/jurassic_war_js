// Снимки настоящей страницы: что на самом деле делают маги в сцене.
//   node tools/маги_кадры.mjs [племя=moospell] [секунд=45] [куда]
//
// Владелец: «возможно ты плохо считываешь, что на самом деле маги делают; проверяй такие штуки
// рендером картинки и анимации, а потом смотри сами картинки». Поэтому тут не стенд, а тот же
// браузер и та же страница, что у него: /jw/scene/<племя>. Каждые полсекунды — кадр экрана и
// строчка состояния по каждому нашему бойцу (состояние, приказ, цель, анимация, мана).
import { chromium } from '/usr/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const ПЛЕМЯ = process.argv[2] || 'moospell';
const СЕКУНД = +(process.argv[3] || 45);
const КУДА = process.argv[4] || `../out/маги/${ПЛЕМЯ}`;
const ПОРТ = 8823;
fs.rmSync(КУДА, { recursive: true, force: true }); fs.mkdirSync(КУДА, { recursive: true });
const сервер = spawn('python3', ['-m', 'http.server', String(ПОРТ), '--bind', '127.0.0.1'],
                     { cwd: '<web root>', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const бр = await chromium.launch();
const стр = await бр.newPage({ viewport: { width: 1024, height: 768 } });
const ош = []; стр.on('pageerror', e => ош.push(e.message));
await стр.goto(`http://127.0.0.1:${ПОРТ}/reimpl/web/game.html?lab=1&scene=${ПЛЕМЯ}`, { waitUntil: 'load' });
await стр.waitForFunction(() => window.__jw && window.__jw.shell, null, { timeout: 60000 });
// Ждём, пока сцена реально запустится: появятся наши бойцы.
await стр.waitForFunction(() => {
  const j = window.__jw; if (!j?.mem) return false;
  const m = j.mem, { G, U, UNITS } = j;
  if (!m || !m.u32(G.unitHead)) return false;
  const мой = m.u8(G.humanOwner); let n = 0;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT))
    if (m.u8(UNITS + i + U.OWNER) === мой && m.u8(UNITS + i + U.TYPE) < 0x1a) n++;
  return n > 0;
}, null, { timeout: 180000 });
const строка = () => стр.evaluate(() => {
  const j = window.__jw, m = j.mem, { G, U, UNITS } = j;
  const мой = m.u8(G.humanOwner); const свои = [];
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.OWNER) !== мой || m.u8(UNITS + i + U.TYPE) >= 0x1a) continue;
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    свои.push({ н: i, тип: m.u8(UNITS + i + U.TYPE), hp: m.u8(UNITS + i + U.HP),
      сост: m.u8(UNITS + i + U.STATE).toString(16), прик: m.u8(UNITS + i + U.ORDER).toString(16),
      цель: m.u32(UNITS + i + U.TARGET), аним: m.u16(UNITS + i + U.ANIM),
      мана: m.u8(UNITS + i + U.MANA), x: m.u16(UNITS + i + U.X) >> 5, y: m.u16(UNITS + i + U.Y) >> 5 });
  }
  return { шаг: m.u32(G.step), свои };
});
const лог = [];
for (let к = 0; к <= СЕКУНД * 2; к++) {
  const имя = `к${String(к).padStart(3, '0')}`;
  лог.push({ кадр: имя, ...(await строка()) });
  await стр.screenshot({ path: `${КУДА}/${имя}.png` });
  await new Promise(r => setTimeout(r, 500));
}
fs.writeFileSync(`${КУДА}/лог.json`, JSON.stringify(лог, null, 1));
console.log('кадров', лог.length, 'в', КУДА, 'ошибок страницы', ош.length, ош.slice(0, 3));
await бр.close(); сервер.kill();
