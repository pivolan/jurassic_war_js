// Патруль и неподъёмная добыча (наше). Кладём рядом с маршрутом вещь, которую взять некуда
// (инвентарь забит), и считаем, сколько раз патрульный за ней ходит. Правильное поведение —
// сходил, не смог, забыл на время и пошёл по маршруту дальше.
//
//   node tools/patrol_loot.mjs
import { движок } from '../tools/ai_duel.mjs';
import { loadMission } from '../reimpl/js/loader.js';
import { расставить } from '../reimpl/js/port/skirmish.js';
const Патруль = await import('../reimpl/js/port/patrol.js');
const { приказ, установить } = await import('../reimpl/js/port/inject.js');
const { call } = await import('../reimpl/js/fn.js');
import { G, U, UNITS } from '../reimpl/js/mem.js';
const eng = движок(); const m = eng.m; установить();
loadMission(m, eng.files, 100, 0, 1);
расставить(eng, [{ цвет: 0, племя: 0, кто: 'компьютер' }], {});
m.w8(0x32aec, 0);
const тик = (n) => { for (let k = 0; k < n; k++) { eng.timer++; eng.tick(); } };
тик(4);
let боец = 0;
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
  const t = m.u8(UNITS + i + U.TYPE);
  if (m.u8(UNITS + i + U.OWNER) === 0 && t >= 1 && t <= 13) { боец = i; break; }
}
for (const f of [U.HPMAX, U.HP, U.DEF]) m.w8(UNITS + боец + f, 200);
for (let k = 0; k < 12; k++) m.w8(UNITS + боец + U.INV + k, 1);      // инвентарь забит доверху
const bx = m.u16(UNITS + боец + U.X) >> 5, by = m.u16(UNITS + боец + U.Y) >> 5;
// вещь-оружие в двух клетках от старта: еда ушла бы в FOOD, а оружию нужен слот
call(eng, 0x1c5a8, { eax: 1, edx: (bx + 2) << 5, ebx: by << 5, ecx: 1 });
приказ(eng, боец, Патруль.ORDER_POINT, 0, bx << 5, by << 5); тик(6);
приказ(eng, боец, Патруль.ORDER_POINT, 0, (bx + 6) << 5, by << 5); тик(6);
приказ(eng, боец, Патруль.ORDER_GO, 0, 0, 0); тик(4);
let ходок = 0, был = false, точек = 0, прошлаяТочка = -1;
for (let k = 0; k < 6000; k++) {
  eng.timer++; eng.tick();
  const ст = m.u8(UNITS + боец + U.STATE);
  const сбор = ст === 0x4a || ст === 0x4c;
  if (сбор && !был) ходок++;
  был = сбор;
  const р = Патруль.route(eng, боец);
  if (р && р.i !== прошлаяТочка) { прошлаяТочка = р.i; точек++; }
}
console.log(`походов за неподъёмной добычей: ${ходок}; смен точек маршрута: ${точек}`);
console.log(ходок > 20 ? 'ПЛОХО: ходит по кругу' : точек < 4 ? 'ПЛОХО: по маршруту не идёт' : 'хорошо: сходил, забыл, идёт по маршруту');
