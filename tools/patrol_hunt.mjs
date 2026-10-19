// Патруль отрядом по охотничьим угодьям (наше): что просят в Discord — поставил троих патрулировать
// пастбище, они бьют зверьё, подбирают мясо и **возвращаются на маршрут**, и так по кругу.
//
//   node tools/patrol_hunt.mjs [бойцов] [шагов]
//
// Одиночный случай уже проверен (tools/patrol_test.mjs). Здесь ищем то, что ломается в живой
// партии: отряд, несколько точек, зверь возрождается, добыча полными руками, чужой боец на пути.
import { движок } from '../tools/ai_duel.mjs';
import { loadMission } from '../reimpl/js/loader.js';
import { расставить } from '../reimpl/js/port/skirmish.js';
const Патруль = await import('../reimpl/js/port/patrol.js');
const { приказ, установить } = await import('../reimpl/js/port/inject.js');
import { G, U, UNITS } from '../reimpl/js/mem.js';

const БОЙЦОВ = +(process.argv[2] || 3), ШАГОВ = +(process.argv[3] || 12000);
const eng = движок(); const m = eng.m; установить();
loadMission(m, eng.files, 100, 0, 1);
расставить(eng, [{ цвет: 0, племя: 0, кто: 'компьютер' }], {});
m.w8(0x32aec, 0);                                    // встроенный ИИ не нужен: приказы даём сами

const кл = (i) => ({ x: m.u16(UNITS + i + U.X) >> 5, y: m.u16(UNITS + i + U.Y) >> 5 });
const жив = (i) => i && !(m.u8(UNITS + i + U.FLAGS5B) & 1);
const бойцы = [], звери = [];
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if (!жив(i)) continue;
  const t = m.u8(UNITS + i + U.TYPE);
  if (m.u8(UNITS + i + U.OWNER) === 0 && t >= 1 && t <= 13) бойцы.push(i);
  else if (t >= 14 && t <= 23) звери.push(i);
}
const отряд = бойцы.slice(0, БОЙЦОВ);
for (const i of отряд) for (const f of [U.HPMAX, U.HP, U.ATK, U.DEF]) m.w8(UNITS + i + f, 160);

// Маршрут: три точки вокруг ближайшего скопления зверья — это и есть «охотничьи угодья».
const дом = кл(отряд[0]);
звери.sort((a, b) => {
  const A = кл(a), B = кл(b);
  return (Math.abs(A.x - дом.x) + Math.abs(A.y - дом.y)) - (Math.abs(B.x - дом.x) + Math.abs(B.y - дом.y));
});
const центр = кл(звери[0]);
const точки = [{ x: центр.x - 4, y: центр.y }, { x: центр.x + 4, y: центр.y }, { x: центр.x, y: центр.y + 4 }]
  .map(т => ({ x: Math.max(1, Math.min(m.u32(G.mapW) - 2, т.x)), y: Math.max(1, Math.min(m.u32(G.mapH) - 2, т.y)) }));
console.log(`отряд ${отряд.join(', ')} от ${дом.x},${дом.y}; угодья вокруг ${центр.x},${центр.y}; точки ${точки.map(т => `${т.x},${т.y}`).join(' → ')}`);

const тик = (n) => { for (let k = 0; k < n; k++) { eng.timer++; eng.tick(); } };
тик(4);
for (const т of точки) { for (const i of отряд) приказ(eng, i, Патруль.ORDER_POINT, 0, т.x << 5, т.y << 5); тик(6); }
for (const i of отряд) приказ(eng, i, Патруль.ORDER_GO, 0, 0, 0);
тик(2);
console.log('маршруты заданы: ' + отряд.map(i => (Патруль.route(eng, i)?.pts.length ?? 0) + ' точек').join(', '));

let убито = 0, потеряли = 0;
const былиЖивы = new Map(звери.map(з => [з, true]));
const срыв = new Map(отряд.map(i => [i, 0])); const павшие = new Set();         // на каком шаге у бойца пропал маршрут
for (let k = 1; k <= ШАГОВ; k++) {
  eng.timer++; eng.tick();
  for (const з of звери) if (былиЖивы.get(з) && !жив(з)) { былиЖивы.set(з, false); убито++; }
  for (const i of отряд) if (!срыв.get(i) && жив(i) && !Патруль.route(eng, i)) { срыв.set(i, k); потеряли++; }
  for (const i of отряд) if (!павшие.has(i) && !жив(i)) {          // кто убил: смотрим, кто рядом
    павшие.add(i);
    const c = кл(i); const рядом = [];
    for (let j = m.u32(G.unitHead); j; j = m.u32(UNITS + j + U.NEXT)) {
      if (!жив(j) || j === i) continue;
      const t = m.u8(UNITS + j + U.TYPE); if (t < 14 || t > 23) continue;
      const п = кл(j); if (Math.abs(п.x - c.x) + Math.abs(п.y - c.y) <= 3) рядом.push(`т${t}`);
    }
    console.log(`  шаг ${k}: #${i} погиб в ${c.x},${c.y}; зверьё рядом: ${рядом.join(', ') || 'нет'}`);
  }
  if (k % 2000 === 0) {
    const с = отряд.map(i => {
      const p = Патруль.route(eng, i);
      return `#${i} ${жив(i) ? 'жив' : 'мёртв'} ${p ? 'точка ' + p.i : 'БЕЗ МАРШРУТА'} сост ${m.u8(UNITS + i + U.STATE).toString(16)} еда ${m.u16(UNITS + i + 0x51)}`;
    }).join(' | ');
    console.log(`шаг ${String(k).padStart(5)}: убито зверей ${убито} · ${с}`);
  }
}
console.log(`\nитог: зверей убито ${убито}; маршрут потеряли ${потеряли} из ${отряд.length}` +
  (потеряли ? ' (' + [...срыв].filter(([, ш]) => ш).map(([i, ш]) => `#${i} на шаге ${ш}`).join(', ') + ')' : ''));
