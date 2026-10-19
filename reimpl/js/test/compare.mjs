// Сверка JS-движка с трассой эталона: node js/test/compare.mjs traces/m0_t0 [steps]
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import crypto from 'node:crypto';
import { Mem, G, U, UNITS, UNIT_SZ } from '../mem.js'; import { Engine } from '../engine.js'; import '../modules.js';
const dir = process.argv[2] || 'traces/m0_t0'; const maxSteps = +(process.argv[3] || 1e9);
const ix = JSON.parse(fs.readFileSync(path.join(dir, 'index.json')));
const snap = zlib.inflateSync(fs.readFileSync(path.join(dir, 'snap0.bin.z')));
const mem = Mem.ofSize(); mem.b.set(snap, ix.data_lo);
const steps = fs.readFileSync(path.join(dir, 'steps.bin')); const REC = 57600 + 32;
const eng = new Engine(mem); let ok = 0;
/** Короткий отпечаток блока памяти: по нему видно, разошлись ли движки. */
const md5 = b => crypto.createHash('md5').update(b).digest('hex').slice(0, 12);
/** Поля записи юнита по возрастанию смещения — чтобы назвать байт, в котором расхождение. */
const FIELDS = Object.entries(U).sort((a, b) => a[1] - b[1]);
/** Имя поля по смещению внутри записи юнита (ближайшее слева, с добавкой). */
function fieldName(off) { let n = '?'; for (const [k, v] of FIELDS) if (v <= off) n = k + (v === off ? '' : '+' + (off - v)); return n; }
for (let k = 0; k < Math.min(ix.steps, maxSteps); k++) {
  for (const od of (ix.orders || [])) if (od.step === k) {   // как oracle.order(): выделить юнита и положить «ожидающий клик»
    for (let i = mem.u32(G.unitHead); i !== 0; i = mem.u32(UNITS + i + U.NEXT)) mem.w8(UNITS + i + 7, mem.u8(UNITS + i + 7) & 0x7f);
    if (od.unit) { mem.w8(UNITS + od.unit + 7, mem.u8(UNITS + od.unit + 7) | 0x80); mem.w32(0x31adc, od.unit); }
    mem.w8(0x31acc, od.code); mem.w32(0x31ad0, od.target || 0); mem.w32(0x31ad4, od.x || 0); mem.w32(0x31ad8, od.y || 0);
  }
  const rec0 = ix.per_step[k]; eng.timer = rec0.timer; eng.tick();
  const exp = steps.subarray(k * REC, k * REC + 57600); const got = mem.slice(UNITS, 57600);
  const rec = ix.per_step[k];
  if (md5(got) !== rec.hash.pool) {
    let diffs = []; for (let a = 0; a < 57600 && diffs.length < 12; a++) if (got[a] !== exp[a]) diffs.push(a);
    console.log(`step ${rec.step}: пул расходится (совпало шагов: ${ok}). первые различия:`);
    for (const a of diffs) { const idx = a < 4 ? 0 : Math.floor((a - 4) / UNIT_SZ) * UNIT_SZ; const off = a - idx; console.log(`  unit@${idx.toString(16)} +${off.toString(16)} ${fieldName(off)} (type ${exp[idx + 4]}, state ${exp[idx+0x2b].toString(16)}): got ${got[a]} exp ${exp[a]}`); }
    break;
  }
  ok++;
}
console.log(`совпало шагов: ${ok}/${Math.min(ix.steps, maxSteps)}; непортированные вызовы: ${[...eng.todo].join(' ')}`);
