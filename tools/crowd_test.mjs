// Проверка «некуда ставить»: здание в тесноте не должно ни вешать игру, ни терять заказ,
// ни ставить юнита в занятую клетку. Как освободится место — юнит выходит.
//   node tools/crowd_test.mjs
import { движок } from './ai_duel.mjs';
import { loadMission } from '../reimpl/js/loader.js';
import { расставить, стартовыеПозиции } from '../reimpl/js/port/skirmish.js';
import { G, U, UNITS, BI } from '../reimpl/js/mem.js';
const eng = движок(); const m = eng.m;
loadMission(m, eng.files, 206, 0, 1);
const т = стартовыеПозиции(m); const ц = Object.keys(т).map(Number).sort((a,b)=>a-b)[0];
расставить(eng, [{ цвет: ц, племя: 0, кто: 'компьютер' }], {});
m.w8(0x32aec + ц, 0); m.w32(G.food + ц * 4, 200000);
let дом = 0;
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
  if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
  if (m.u8(UNITS + i + U.OWNER) === ц && m.u8(UNITS + i + U.TYPE) === 0x1a + 9) дом = i;
}
const счёт = () => { let n = 0; for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) { if (m.u8(UNITS+i+U.FLAGS5B)&1) continue; if (m.u8(UNITS+i+U.OWNER)===ц && m.u8(UNITS+i+U.TYPE)===9) n++; } return n; };
console.log('дом велоцирапторов', дом, 'рапторов', счёт());
// забиваем всё вокруг: свободных клеток нет
for (let k = 0; k < 0xb000; k++) m.b[BI + k] |= 2;
const тик = (n) => { const t0 = Date.now(); for (let k = 0; k < n; k++) { eng.timer++; eng.tick(); } return Date.now() - t0; };
m.w8(UNITS + дом + U.ORDER, 0x7f); m.w32(UNITS + дом + 0x47, 0);
console.log(`в тесноте: ${тик(3000)} мс на 3000 шагов, рапторов ${счёт()}, еда ${m.u32(G.food + ц*4)}`);
// освобождаем место — раптор должен выйти
for (let k = 0; k < 0xb000; k++) m.b[BI + k] &= ~2;
console.log(`после освобождения: ${тик(1500)} мс, рапторов ${счёт()}`);
