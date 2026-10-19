// node js/test/fntest.mjs CASEDIR [CASEDIR...] — прогнать JS-порт функции на состояниях из fncheck.py
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import { Mem, UNITS, UNIT_SZ, U } from '../mem.js'; import { Engine } from '../engine.js'; import { F } from '../fn.js'; import '../modules.js';
const DATA_LO = 0x30000; let pass = 0, fail = 0;
for (const dir of process.argv.slice(2)) {
  if (!fs.existsSync(path.join(dir, 'case.json'))) continue;
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'))); const pre = zlib.inflateSync(fs.readFileSync(path.join(dir, 'pre.bin.z')));
  const mem = Mem.ofSize(); mem.b.set(pre, DATA_LO); const before = new Uint8Array(mem.b); const eng = new Engine(mem); eng.timer = c.timer;
  const f = F[c.fn]; if (!f) { console.log(`${dir}: НЕ ПОРТИРОВАНО 0x${c.fn.toString(16)}`); fail++; continue; }
  let ret; try { ret = f(eng, c.regs_in) || {}; } catch (e) { console.log(`${dir}: исключение ${e.message}`); fail++; continue; }
  const exp = new Map(c.diff.map(([a, o, n]) => [a, n])); const errs = [];
  for (const [a, o, n] of c.diff) if (mem.b[a] !== n) errs.push(`  0x${a.toString(16)}: ожидалось ${n}, получено ${mem.b[a]} (было ${o})`);
  for (let a = DATA_LO; a < mem.b.length && errs.length < 20; a++) if (mem.b[a] !== before[a] && !exp.has(a)) errs.push(`  0x${a.toString(16)}: лишнее изменение ${before[a]} -> ${mem.b[a]}`);
  for (const r of ['eax', 'edx']) if (ret[r] !== undefined && (ret[r] >>> 0) !== (c.regs_out[r] >>> 0)) errs.push(`  ${r}: ожидалось 0x${c.regs_out[r].toString(16)}, получено 0x${(ret[r]>>>0).toString(16)}`);
  if (ret.cf !== undefined && (ret.cf ? 1 : 0) !== c.cf) errs.push(`  cf: ожидалось ${c.cf}, получено ${ret.cf ? 1 : 0}`);
  if (errs.length) { fail++; console.log(`${dir}: FAIL fn 0x${c.fn.toString(16)} (изменений в эталоне: ${c.diff.length})`); console.log(errs.slice(0, 20).join('\n')); }
  else { pass++; console.log(`${dir}: ok (${c.diff.length} байт)`); }
}
console.log(`итого: ok ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
