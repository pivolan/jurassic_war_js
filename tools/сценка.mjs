// СЦЕНКА: проверить одну гипотезу о бое в чистых условиях, без остальной карты.
//
//   node tools/сценка.mjs <племя> <миссия> <типы зверей через запятую> [расстояние=6] [секунд=60] [зёрен=10]
//   пример: node tools/сценка.mjs 0 2 22        — четвёрка Тирано против одного леопарда
//           node tools/сценка.mjs 0 2 22,23 6   — против леопарда и пса сразу
//
// Всё зверьё, кроме нужного числа указанных типов, снимается с карты насовсем; оставшиеся
// ставятся на заданном расстоянии от отряда. Дальше ВОЖАК играет как обычно. Печатает по каждому
// зерну: убит ли зверь, за сколько секунд, сколько наших погибло и сколько жизней осталось.
import { движок, ТИК_МС } from './ai_duel.mjs';
const { loadMission } = await import('../reimpl/js/loader.js');
const { G, U, UNITS } = await import('../reimpl/js/mem.js');
const Обр = await import('../reimpl/js/ai/образец.js');
const { проходима } = await import('../reimpl/js/ai/act.js');
const [ПЛ, МИС, ТИПЫ, РАССТ = 6, СЕК = 60, ЗЁРЕН = 10] = process.argv.slice(2);
const нужны = String(ТИПЫ).split(',').map(Number);
const итоги = [];
for (let з = 0; з < +ЗЁРЕН; з++) {
  const eng = движок(); const m = eng.m;
  loadMission(m, eng.files, +МИС - 1, +ПЛ, 2);
  m.w32(G.rngState, (m.u32(G.rngState) ^ ((з + 1) * 2654435761)) >>> 0);
  const мой = m.u8(G.humanOwner); m.w8(0x32aec + мой, 0);
  const жив = (i) => !(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.HP) > 0 && (m.u8(UNITS + i + U.STATE) & 0xf0) !== 0x60;
  const наши = []; let сx = 0, сy = 0;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT))
    if (жив(i) && m.u8(UNITS + i + U.OWNER) === мой && m.u8(UNITS + i + U.TYPE) < 0x1a && m.u8(UNITS + i + U.TYPE) !== 4) {
      наши.push(i); сx += m.u16(UNITS + i + U.X); сy += m.u16(UNITS + i + U.Y); }
  сx = Math.round(сx / наши.length); сy = Math.round(сy / наши.length);
  const остаются = [], осталось = [...нужны];
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    const т = m.u8(UNITS + i + U.TYPE);
    if (т < 14 || т > 25) continue;
    const н = осталось.indexOf(т);
    if (н >= 0) { осталось.splice(н, 1); остаются.push(i); continue; }
    m.w8(UNITS + i + U.FLAGS5B, m.u8(UNITS + i + U.FLAGS5B) | 1); m.w16(UNITS + i + U.ANIM, 0xffff);
  }
  // Ставим оставшихся на РАССТ клеток от отряда, рядом друг с другом.
  // Ставим на проходимые клетки, достижимые от отряда: заливкой по проходимости от середины
  // отряда берём клетки на расстоянии РАССТ (±1). Иначе зверь попадал в лес за стеной, и драки
  // не было вовсе.
  const W = m.u32(G.mapW), H = m.u32(G.mapH), ox = сx >> 5, oy = сy >> 5;
  const дист = new Map([[ox + ',' + oy, 0]]), очередь = [[ox, oy]];
  while (очередь.length) { const [x, y] = очередь.shift(); const д = дист.get(x + ',' + y);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy, к = nx + ',' + ny;
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || дист.has(к) || !проходима(m, nx, ny)) continue;
      дист.set(к, д + 1); очередь.push([nx, ny]); } }
  const места = [...дист.entries()].filter(([, д]) => Math.abs(д - +РАССТ) <= 1).map(([к]) => к.split(',').map(Number));
  остаются.forEach((i, н) => { const [x, y] = места[(н * 3) % Math.max(1, места.length)] || [ox + +РАССТ, oy];
    m.w16(UNITS + i + U.X, x << 5); m.w16(UNITS + i + U.Y, y << 5); });
  // --на-дом: зверь идёт грызть наше здание (как делает сам движок, когда видит дом рядом).
  const НА_ДОМ = process.argv.includes('--на-дом');
  if (НА_ДОМ) for (let т = 0; т < 30; т++) { eng.timer++; eng.tick(); }        // Святилище успеет встать
  let дом = 0;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT))
    if (!(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.OWNER) === мой && m.u8(UNITS + i + U.TYPE) >= 0x1a) { дом = i; break; }
  if (НА_ДОМ && дом) for (const i of остаются) {
    m.w16(UNITS + i + U.X, (m.u16(UNITS + дом + U.X) + 64) & ~31); m.w16(UNITS + i + U.Y, m.u16(UNITS + дом + U.Y) & ~31);
    m.w32(UNITS + i + U.TARGET, дом); m.w8(UNITS + i + U.STATE, 0x31);
  }
  const hp0дома = дом ? m.u8(UNITS + дом + U.HP) : 0;
  const с = Обр.новое(); const hp0 = остаются.map(i => m.u8(UNITS + i + U.HP));
  let убиты = null;
  for (let т = 0; т < +СЕК * 1000 / ТИК_МС; т++) {
    const п = Обр.шаг(eng, наши.filter(жив), с); eng.timer++; eng.tick();
    if (process.env.JW_СЦЕНКА_ЛОГ && т % 36 === 0 && з === 0)
      console.log(`  ${(т*ТИК_МС/1000).toFixed(0)}с ${п?.режим}/${п?.подрежим||''} цель ${с.цель} | зверь ${остаются.map(i => `${m.u16(UNITS+i+U.X)>>5},${m.u16(UNITS+i+U.Y)>>5} hp${m.u8(UNITS+i+U.HP)} жив${+жив(i)}`).join(' ')} | наши ${наши.map(i => `${m.u16(UNITS+i+U.X)>>5},${m.u16(UNITS+i+U.Y)>>5}`).join(' ')}`);
    if (!убиты && остаются.every(i => !жив(i))) { убиты = +(т * ТИК_МС / 1000).toFixed(1); break; }
  }
  const живых = наши.filter(жив);
  итоги.push({ з, убиты, погибло: наши.length - живых.length, жизни: живых.map(i => m.u8(UNITS + i + U.HP)).join('/'),
               дом: дом ? `${hp0дома}→${m.u8(UNITS + дом + U.HP)}` : '' });
}
const побед = итоги.filter(и => и.убиты !== null).length, потери = итоги.reduce((a, и) => a + и.погибло, 0);
console.log(`зверь ${ТИПЫ}: убит в ${побед}/${итоги.length}, наших погибло всего ${потери}, среднее время ${
  (итоги.filter(и => и.убиты).reduce((a, и) => a + и.убиты, 0) / Math.max(1, побед)).toFixed(1)} с`);
for (const и of итоги) console.log(`  зерно ${и.з}: ${и.убиты ? 'убит за ' + и.убиты + ' с' : 'НЕ убит'}, погибло ${и.погибло}, жизни ${и.жизни}${и.дом ? ', дом ' + и.дом : ''}`);
