// Патруль отрядом: много юнитов на один маршрут (наше). Ищем зависших — тех, кто стоит на месте
// и при этом не в бою, хотя маршрут у него есть.
//
//   node tools/patrol_many.mjs [сколько=8] [шагов=6000]
//
// Жалоба: «когда выставляешь патруль множеству юнитов, они бывают зависают где-то на середине
// пути и не реагируют ни на что внешнее». Проверяем ровно это: доля юнитов, которые простояли
// без движения дольше ЗАВИС шагов, и в каком они при этом состоянии.
import { движок } from '../tools/ai_duel.mjs';
import { loadMission } from '../reimpl/js/loader.js';
import { расставить } from '../reimpl/js/port/skirmish.js';
const Патруль = await import('../reimpl/js/port/patrol.js');
const { приказ, установить } = await import('../reimpl/js/port/inject.js');
import { G, U, UNITS } from '../reimpl/js/mem.js';

const СКОЛЬКО = +(process.argv[2] || 8), ШАГОВ = +(process.argv[3] || 6000);
const КАРТА = +(process.argv[4] || 100);
const ЗАВИС = 400;                       // шагов без движения — считаем зависшим
const eng = движок(); const m = eng.m; установить();
loadMission(m, eng.files, КАРТА, 0, 1);
расставить(eng, [{ цвет: 0, племя: 0, кто: 'компьютер' }], {});
m.w8(0x32aec, 0);                        // штатный ИИ молчит: командуем только мы

// На картах у игрока всего три-четыре бойца, а жалоба именно про «множество юнитов». Досыпаем
// своих рядом со стартом тем же вызовом, каким игра создаёт юнита (0x1caf0).
const { call } = await import('../reimpl/js/fn.js');
{
  let образец = 0;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const t = m.u8(UNITS + i + U.TYPE);
    if (m.u8(UNITS + i + U.OWNER) === 0 && t >= 1 && t <= 13) { образец = i; break; }
  }
  if (образец) {
    const слот = m.u8(UNITS + образец + U.SLOT), тип = m.u8(UNITS + образец + U.TYPE);
    const ox = m.u16(UNITS + образец + U.X) >> 5, oy = m.u16(UNITS + образец + U.Y) >> 5;
    let создано = 0;
    for (let dy = -3; dy <= 3 && создано < СКОЛЬКО; dy++) for (let dx = -3; dx <= 3 && создано < СКОЛЬКО; dx++) {
      if (!dx && !dy) continue;
      const r = call(eng, 0x1caf0, { eax: тип | (слот << 8), ecx: 0, edx: (ox + dx) << 5, ebx: (oy + dy) << 5 });
      if (!(r && r.cf)) создано++;
    }
    console.log('досыпано бойцов:', создано);
  }
}

const бойцы = [];
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
  const t = m.u8(UNITS + i + U.TYPE);
  if (m.u8(UNITS + i + U.OWNER) !== 0 || t < 1 || t > 13) continue;
  for (const f of [U.HPMAX, U.HP, U.ATK, U.DEF]) m.w8(UNITS + i + f, 200);   // чтобы не поумирали
  бойцы.push(i); if (бойцы.length >= СКОЛЬКО) break;
}
const тик = (n) => { for (let k = 0; k < n; k++) { eng.timer++; eng.tick(); } };
тик(4);
const b0 = { x: m.u16(UNITS + бойцы[0] + U.X) >> 5, y: m.u16(UNITS + бойцы[0] + U.Y) >> 5 };
const R = +(process.argv[5] || 10);
const точки = [{ x: b0.x, y: b0.y }, { x: b0.x + R, y: b0.y }, { x: b0.x + R, y: b0.y + R }, { x: b0.x, y: b0.y + R }];
console.log('бойцов', бойцы.length, '| маршрут', точки.map(т => `${т.x},${т.y}`).join(' → '));
for (const т of точки) { for (const i of бойцы) приказ(eng, i, Патруль.ORDER_POINT, 0, т.x << 5, т.y << 5); тик(6); }
for (const i of бойцы) приказ(eng, i, Патруль.ORDER_GO, 0, 0, 0);
тик(4);
console.log('маршруты выданы:', бойцы.filter(i => Патруль.route(eng, i)).length);

// Отдельно следим за сбором добычи: если юнит долго ходит в состоянии 0x4a, а еда и вещи не
// прибавляются, значит он бегает за кучкой, которую взять не может, — это и есть «что-то пытается
// сделать и не может».
const прошлое = new Map(бойцы.map(i => [i, { x: -1, y: -1, стоит: 0, максСтоит: 0, сост: new Map(),
                                             сбор: 0, максСбор: 0, еда: -1 }]));
for (let k = 0; k < ШАГОВ; k++) {
  eng.timer++; eng.tick();
  for (const i of бойцы) {
    const п = прошлое.get(i);
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    const x = m.u16(UNITS + i + U.X), y = m.u16(UNITS + i + U.Y);
    const ст = m.u8(UNITS + i + U.STATE);
    if (x === п.x && y === п.y) { п.стоит++; if (п.стоит > п.максСтоит) { п.максСтоит = п.стоит; п.где = `${x >> 5},${y >> 5}`; п.состЗависа = ст; } }
    else { п.стоит = 0; п.x = x; п.y = y; }
    п.сост.set(ст, (п.сост.get(ст) || 0) + 1);
    const еда = m.u16(UNITS + i + U.FOOD);
    if (ст === 0x4a || ст === 0x4c) { if (еда === п.еда) { п.сбор++; if (п.сбор > п.максСбор) п.максСбор = п.сбор; } else п.сбор = 0; }
    else п.сбор = 0;
    п.еда = еда;
  }
}
let зависших = 0;
for (const i of бойцы) {
  const п = прошлое.get(i);
  const топ = [...п.сост].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([с, n]) => `0x${с.toString(16)}×${n}`).join(' ');
  const плохо = п.максСтоит >= ЗАВИС;
  if (плохо) зависших++;
  console.log(`  юнит ${i}: без движения ${п.максСтоит}${плохо ? ' ← ЗАВИС' : ''} · подряд за добычей без прибавки ${п.максСбор} | ${топ}`);
}
console.log(`зависших: ${зависших} из ${бойцы.length}`);
