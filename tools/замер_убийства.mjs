// Сколько секунд четверо наших убивают ближайшего зверя на высшей сложности: голая физика,
// без всякого ИИ — просто приказ «атака» по одной цели и учёт урона.
import { движок, ТИК_МС } from './ai_duel.mjs';
const { loadMission } = await import('../reimpl/js/loader.js');
const { G, U, UNITS } = await import('../reimpl/js/mem.js');
const { приказ } = await import('../reimpl/js/ai/act.js');
const КУСОК = [1, 12, 32, 43];
const жив = (m, i) => i && !(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.HP) > 0 && (m.u8(UNITS + i + U.STATE) & 0xf0) !== 0x60;
const eng = движок(); const m = eng.m;
loadMission(m, eng.files, 0, 0, 2);
const мой = m.u8(G.humanOwner); m.w8(0x32aec + мой, 0);
const [x0, y0, x1, y1] = КУСОК;
const наши = [], звери = [];
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
  const x = m.u16(UNITS + i + U.X) >> 5, y = m.u16(UNITS + i + U.Y) >> 5, т = m.u8(UNITS + i + U.TYPE);
  const внутри = x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (m.u8(UNITS + i + U.OWNER) === мой && т < 0x1a) { if (внутри) наши.push(i); continue; }
  if (!(т >= 14 && т <= 23)) continue;
  if (внутри) звери.push({ i, т, x, y, hp: m.u8(UNITS + i + U.HP) });
  else { m.w8(UNITS + i + U.FLAGS5B, m.u8(UNITS + i + U.FLAGS5B) | 1); m.w16(UNITS + i + U.ANIM, 0xffff); }
}
const нх = m.u16(UNITS + наши[0] + U.X) >> 5, ну = m.u16(UNITS + наши[0] + U.Y) >> 5;
звери.sort((a, b) => Math.hypot(a.x - нх, a.y - ну) - Math.hypot(b.x - нх, b.y - ну));
const стат = (i) => ({ hp: m.u8(UNITS + i + U.HP), max: m.u8(UNITS + i + U.HPMAX), atk: m.u8(UNITS + i + U.ATK), def: m.u8(UNITS + i + U.DEF), spd: m.u8(UNITS + i + U.SPD) });
console.log('наши:', наши.map(i => JSON.stringify({ т: m.u8(UNITS + i + U.TYPE), ...стат(i) })).join(' '));
console.log('ближайшие звери:', звери.slice(0, 4).map(з => `т${з.т} в ${з.x},${з.y} ${JSON.stringify(стат(з.i))}`).join(' | '));
const цель = звери[0];
const урон = (a, d) => { const al = Math.max(a - d, 0); return (al >> 4) + (a >> 5) + 1; };
console.log('урон наш→зверь:', урон(стат(наши[0]).atk, стат(цель.i).def), ' зверь→наш:', урон(стат(цель.i).atk, стат(наши[0]).def));
let первыйУдар = -1, убит = -1; let hpБыло = стат(цель.i).hp;
const предел = Math.round(60 * 1000 / ТИК_МС);
for (let тик = 0; тик < предел; тик++) {
  if (тик % 20 === 0) for (const i of наши) if (жив(m, i)) приказ(eng, i, 0x1f, цель.i, цель.x << 5, цель.y << 5);
  eng.timer++; eng.tick();
  const hp = жив(m, цель.i) ? m.u8(UNITS + цель.i + U.HP) : 0;
  if (первыйУдар < 0 && hp < hpБыло) { первыйУдар = тик; }
  hpБыло = hp;
  if (!жив(m, цель.i)) { убит = тик; break; }
  if (наши.filter(i => !жив(m, i)).length) { console.log('наши гибнут на', (тик * ТИК_МС / 1000).toFixed(1), 'с'); break; }
}
const сек = (t) => t < 0 ? '—' : (t * ТИК_МС / 1000).toFixed(1) + ' с';
console.log('первый удар:', сек(первыйУдар), 'зверь убит:', сек(убит),
            'наших живо:', наши.filter(i => жив(m, i)).length, 'из', наши.length);
