// Умеет ли ИИ в железо (наше): строит ли оружейную, сколько предметов заказывает и надевает ли их.
//   node tools/ai_gear.mjs [карта] [секунд] [племя] [уровень]
import { партия, прогнать, ТИК_МС } from './ai_duel.mjs';
import { G, U, UNITS } from '../reimpl/js/mem.js';
import { стартовыеПозиции } from '../reimpl/js/port/skirmish.js';

const КАРТА = +(process.argv[2] || 100), СЕК = +(process.argv[3] || 1800);
const ПЛЕМЯ = +(process.argv[4] || 3), УР = +(process.argv[5] || 3);
const ITEMS = 0xf4f34, ГОЛОВА = 0x31b7c;
const СТАТ = (m, id, поле) => m.u8(0x30954 + m.u32(0x30a9e + id * 4) + поле);
const пробный = партия(КАРТА, [{ цвет: 0, племя: 0 }, { цвет: 3, племя: 0 }]);
const цвета = Object.keys(стартовыеПозиции(пробный.m)).map(Number).sort((a, b) => a - b);
const места = [{ цвет: цвета[0], племя: ПЛЕМЯ, кто: 'компьютер', ии: 'скрипт', уровень: УР },
               { цвет: цвета[1], племя: ПЛЕМЯ, кто: 'компьютер', ии: 'скрипт', уровень: УР }];
const eng = партия(КАРТА, места);
const m = eng.m;
const мой = места[0].цвет;
console.log(`карта ${КАРТА}, племя ${ПЛЕМЯ}, уровень ${УР}: смотрим за цветом ${мой}`);
const срез = () => {
  let дома = [], людей = 0, надето = 0, вСумке = 0, наЗемле = 0;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (m.u8(UNITS + i + U.OWNER) !== мой) continue;
    const t = m.u8(UNITS + i + U.TYPE);
    if (t >= 0x1a) { дома.push(t - 0x1a); continue; }
    if (t < 1 || t > 3) continue;
    людей++;
    if (m.u8(UNITS + i + U.WEAPON) !== 0xff) надето++;
    if (m.u8(UNITS + i + U.SHIELD) !== 0xff) надето++;
    for (let k = 0; k < 6; k++) { const id = m.u8(UNITS + i + U.INV + k); if (id) вСумке++; }
  }
  for (let it = m.u32(ГОЛОВА); it; it = m.u32(ITEMS + it + 0xc)) {
    const т = m.u8(ITEMS + it); if (т === 0x1e) continue;
    if (СТАТ(m, т, 3) || СТАТ(m, т, 4)) наЗемле++;
  }
  return { дома: дома.sort((a, b) => a - b).join(','), людей, надето, вСумке, наЗемле, еда: m.u32(G.food + мой * 4) };
};
const ШАГ = Math.round(120000 / ТИК_МС);
прогнать(eng, Math.round(СЕК * 1000 / ТИК_МС), { наШаге: (e, k) => {
  if (k % ШАГ) return;
  const с = срез();
  console.log(`${String(Math.round(k * ТИК_МС / 1000)).padStart(4)} с  дома [${с.дома}] людей ${с.людей} надето ${с.надето} в сумках ${с.вСумке} на земле ${с.наЗемле} еда ${с.еда}`);
} });
const с = срез();
console.log(`итог: дома [${с.дома}] людей ${с.людей} надето ${с.надето} в сумках ${с.вСумке} железа на земле ${с.наЗемле}`);
