// Сколько опыта вообще лежит на карте (наше). Отвечает на простой вопрос: реально ли в этой
// игре «раскачать двух-трёх героев», или еды и зверья на такое просто не хватает.
//
//   node tools/ai_xp.mjs [карты через запятую]
//
// Считаем: сколько зверья на карте, сколько с них мяса (еда) и сколько опыта
// (value = (сумма статов)² >> 2 — формула движка 0x1ea92), и прогоняем настоящий рост статов
// (F[0x1ec47] + смена класса 0x1f6fe) для одного бойца, которому отдали ВЕСЬ этот опыт.
import { партия } from './ai_duel.mjs';
import { G, U, UNITS } from '../reimpl/js/mem.js';
import { call } from '../reimpl/js/fn.js';

const КАРТЫ = (process.argv[2] || '100,101,102,200,201,202').split(',').map(Number);
const стат = (m, i) => [U.HPMAX, U.MAG, U.ATK, U.DEF, U.SPD].map(f => m.u8(UNITS + i + f));
const ценность = (m, i) => { const s = стат(m, i).reduce((a, b) => a + b, 0) & 0xffff; return ((s * s) >>> 2) + m.u32(UNITS + i + U.XP); };

/** Отдать бойцу опыт кусками (как за убийства) и прогнать настоящий рост. */
function вырастить(eng, i, куски) {
  const m = eng.m;
  for (const xp of куски) {
    m.w32(UNITS + i + U.XP, Math.min(0x7fffffff, m.u32(UNITS + i + U.XP) + xp));
    call(eng, 0x1ec47, { esi: i });
    const a = call(eng, 0x1f6fe, { esi: i, eax: 0 }); m.w8(UNITS + i + U.TYPE, a.eax & 0xff);
  }
  return { тип: m.u8(UNITS + i + U.TYPE), статы: стат(m, i), остаток: m.u32(UNITS + i + U.XP) };
}

for (const карта of КАРТЫ) {
  let eng;
  try { eng = партия(карта, [{ цвет: 0, племя: 0, ии: 'скрипт' }, { цвет: 3, племя: 3, ии: 'скрипт' }]); }
  catch (e) { console.log(`карта ${карта}: не собралась (${e.message})`); continue; }
  const m = eng.m;
  const звери = [];
  let мясо = 0;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const t = m.u8(UNITS + i + U.TYPE);
    if (t < 14 || t > 23) continue;
    звери.push({ t, xp: ценность(m, i) });
    мясо += m.u16(UNITS + i + U.FOOD);
  }
  const всего = звери.reduce((a, з) => a + з.xp, 0);
  // Подопытные: с кого начинаем растить героя. Потолки статов зависят от класса
  // (простолюдин упирается в 70/70/100/100, воин и силач — в 254 по всему), поэтому кого
  // качать — не мелочь, а половина дела.
  const БАЗА = { 1: [30, 0, 20, 30, 20], 2: [70, 0, 35, 70, 30], 3: [50, 0, 70, 35, 40],
                 5: [35, 30, 25, 25, 30], 8: [40, 30, 25, 25, 70], 9: [80, 0, 50, 80, 90], 12: [130, 0, 70, 60, 50] };
  const ИМЯ = { 1: 'простолюдин', 2: 'силач', 3: 'воин', 5: 'эльф', 8: 'рейнджер', 9: 'велоцираптор', 12: 'трицератопс' };
  const по = звери.map(з => з.xp).sort((a, b) => a - b);
  const строка = (тип, доля) => {
    const eng2 = партия(карта, [{ цвет: 0, племя: 0, ии: 'скрипт' }, { цвет: 3, племя: 3, ии: 'скрипт' }]);
    const m2 = eng2.m;
    let b = 0; for (let i = m2.u32(G.unitHead); i; i = m2.u32(UNITS + i + U.NEXT))
      if (m2.u8(UNITS + i + U.OWNER) === 0 && m2.u8(UNITS + i + U.TYPE) === 1) { b = i; break; }
    if (!b) return 'нет простолюдина';
    m2.w8(UNITS + b + U.TYPE, тип);
    const [hp, mag, atk, def, spd] = БАЗА[тип];
    m2.w8(UNITS + b + U.HPMAX, hp); m2.w8(UNITS + b + U.MAG, mag); m2.w8(UNITS + b + U.ATK, atk);
    m2.w8(UNITS + b + U.DEF, def); m2.w8(UNITS + b + U.SPD, spd); m2.w32(UNITS + b + U.XP, 0);
    const n = Math.max(1, Math.round(по.length * доля));
    const р = вырастить(eng2, b, по.slice(-n));                   // сначала самая жирная дичь
    return `${(ИМЯ[р.тип] || 'тип ' + р.тип).padEnd(13)} ${р.статы.join('/')}`;
  };
  const виды = {}; for (const з of звери) виды[з.t] = (виды[з.t] || 0) + 1;
  console.log(`карта ${карта}: зверья ${звери.length} ${JSON.stringify(виды)} | мяса ${мясо} еды | опыта ${всего}`);
  for (const тип of [1, 2, 3, 8, 9]) {
    console.log(`    ${(ИМЯ[тип] + ':').padEnd(15)} четверть опыта -> ${строка(тип, 0.25)} | весь -> ${строка(тип, 1)}`);
  }
}
