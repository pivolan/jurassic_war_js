// как fntest.mjs, но игнорирует область кадрового буфера (0x1235f4..0x16e5f4), куда пишут ещё не портированные функции рисования
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import { Mem } from '../mem.js'; import { Engine } from '../engine.js'; import { F } from '../fn.js'; import '../modules.js';
const DATA_LO = 0x30000; const IGN = [[0x1235f4, 0x16e5f4], [0x462fc, 0x466fc], [0x46afc, 0x46efc], [0x47618, 0x4761c], [0x488d4, 0x488d8], [0x3eb10, 0x41900], [0x47004, 0x4704c]]; // кадр, буферы фона под курсором (0x2995f), банк VESA, scratch блиттера 0x1f720/0x1f815, состояние отрисовки сцены (0x23eb1) const ign = a => IGN.some(([l, h]) => a >= l && a < h); let pass = 0, fail = 0;
const ign = a => IGN.some(([l, h]) => a >= l && a < h); let pass = 0, fail = 0;
for (const dir of process.argv.slice(2)) {
  if (!fs.existsSync(path.join(dir, 'case.json'))) continue;
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'))); const pre = zlib.inflateSync(fs.readFileSync(path.join(dir, 'pre.bin.z')));
  const mem = Mem.ofSize(); mem.b.set(pre, DATA_LO); const before = new Uint8Array(mem.b); const eng = new Engine(mem); eng.timer = c.timer; mem.w32(0x46c, c.timer);
  const f = F[c.fn]; if (!f) { console.log(`${dir}: НЕ ПОРТИРОВАНО 0x${c.fn.toString(16)}`); fail++; continue; }
  let ret; try { ret = f(eng, c.regs_in) || {}; } catch (e) { console.log(`${dir}: исключение ${e.stack.split('\n').slice(0,3).join(' | ')}`); fail++; continue; }
  const exp = new Map(c.diff.map(([a, o, n]) => [a, n])); const errs = []; let fb = 0;
  for (const [a, o, n] of c.diff) { if (ign(a)) { fb++; continue; } if (mem.b[a] !== n) errs.push(`  0x${a.toString(16)}: ожидалось ${n}, получено ${mem.b[a]} (было ${o})`); }
  for (let a = DATA_LO; a < mem.b.length && errs.length < 20; a++) if (mem.b[a] !== before[a] && !exp.has(a) && !ign(a)) errs.push(`  0x${a.toString(16)}: лишнее изменение ${before[a]} -> ${mem.b[a]}`);
  for (const r of ['eax', 'edx']) if (ret[r] !== undefined && (ret[r] >>> 0) !== (c.regs_out[r] >>> 0)) errs.push(`  ${r}: ожидалось 0x${c.regs_out[r].toString(16)}, получено 0x${(ret[r]>>>0).toString(16)}`);
  if (errs.length) { fail++; console.log(`${dir}: FAIL fn 0x${c.fn.toString(16)} (изменений в эталоне: ${c.diff.length}, из них в кадре: ${fb})`); console.log(errs.slice(0, 20).join('\n')); }
  else { pass++; console.log(`${dir}: ok (${c.diff.length} байт, в кадре ${fb})`); }
}
console.log(`итого: ok ${pass}, fail ${fail}`); process.exit(fail ? 1 : 0);
