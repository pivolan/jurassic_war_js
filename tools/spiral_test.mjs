// Проверка: спирали поиска места не вешают игру, когда свободных клеток рядом нет.
//   node tools/spiral_test.mjs
import { движок } from './ai_duel.mjs';
import { loadMission } from '../reimpl/js/loader.js';
import { F } from '../reimpl/js/fn.js';
import { G, U, UNITS, BI } from '../reimpl/js/mem.js';
const eng = движок(); const m = eng.m;
loadMission(m, eng.files, 1, 0, 1);
// забиваем всю сетку занятости: свободных клеток нет вообще
for (let k = 0; k < 0xb000; k++) m.b[BI + k] |= 2;
let боец = 0;
for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) { if (m.u8(UNITS+i+U.FLAGS5B)&1) continue; if (m.u8(UNITS+i+U.OWNER)===0) { боец = i; break; } }
const x = m.u16(UNITS + боец + U.X), y = m.u16(UNITS + боец + U.Y);
for (const [имя, адрес] of [['0x1ce37 (свободный тайл)', 0x1ce37], ['0x1ccdd (место для юнита)', 0x1ccdd]]) {
  const t0 = Date.now();
  const r = F[адрес](eng, { esi: боец, edx: x, ebx: y });
  console.log(`${имя}: вернул ${r.edx >> 5},${r.ebx >> 5} за ${Date.now() - t0} мс (исходная клетка ${x >> 5},${y >> 5})`);
}
console.log('зависания нет');
