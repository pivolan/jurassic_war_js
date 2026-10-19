// Сверка прямого прохода: torch (tools/ai_net.py) против js/ai/net.js на одних и тех же входах.
//   node tools/ai_netcheck.mjs [веса.json]
// Без аргумента — случайные веса из Python. Печатает максимальное расхождение логитов и ценности.
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
import { загрузить, вперёд } from '../reimpl/js/ai/net.js';
import { ОКНО, СЛОЁВ, ВЕКТОР } from '../reimpl/js/ai/obs.js';
import { КОРЕНЬ } from './ai_lib.mjs';

const тмп = process.env.TMPDIR || '/tmp';
const путь = process.argv[2] || `${тмп}/ai_netcheck_w.json`;
const py = `
import sys, json, torch; sys.path.insert(0, '${КОРЕНЬ}tools')
import ai_net
torch.manual_seed(3)
w = ${process.argv[2] ? `ai_net.загрузить('${путь}')` : `ai_net.Сеть()`}
${process.argv[2] ? '' : `ai_net.сохранить(w, '${путь}', 'проверка')`}
окно = torch.rand(4, ai_net.СЛОЁВ, ai_net.ОКНО, ai_net.ОКНО); окно[okno_mask := окно < 0.6] = 0
вектор = torch.rand(4, ai_net.ВЕКТОР) * 2 - 1
л, v = w(окно, вектор)
json.dump({'окна': окно.flatten().tolist(), 'векторы': вектор.flatten().tolist(), 'логиты': л.tolist(), 'ценности': v.tolist(),
           'параметров': w.параметров()}, open('${тмп}/ai_netcheck_io.json', 'w'))
`;
execFileSync('python3', ['-c', py], { stdio: 'inherit' });
const io = JSON.parse(fs.readFileSync(`${тмп}/ai_netcheck_io.json`));
const сеть = загрузить(fs.readFileSync(путь, 'utf8'));
let худш = 0, худшV = 0;
const n = СЛОЁВ * ОКНО * ОКНО;
for (let k = 0; k < 4; k++) {
  const наб = { окно: Float32Array.from(io.окна.slice(k * n, (k + 1) * n)), вектор: Float32Array.from(io.векторы.slice(k * ВЕКТОР, (k + 1) * ВЕКТОР)) };
  const { логиты, ценность } = вперёд(сеть, наб);
  for (let a = 0; a < логиты.length; a++) худш = Math.max(худш, Math.abs(логиты[a] - io.логиты[k][a]));
  худшV = Math.max(худшV, Math.abs(ценность - io.ценности[k]));
}
const наб = { окно: Float32Array.from(io.окна.slice(0, n)), вектор: Float32Array.from(io.векторы.slice(0, ВЕКТОР)) };
for (let k = 0; k < 200; k++) вперёд(сеть, наб);
const t0 = process.hrtime.bigint(); const N = 2000;
for (let k = 0; k < N; k++) вперёд(сеть, наб);
const мкс = Number(process.hrtime.bigint() - t0) / 1e3 / N;
console.log(`параметров ${io.параметров}; расхождение логитов ${худш.toExponential(2)}, ценности ${худшV.toExponential(2)} ` +
            `(${худш < 1e-4 ? 'СОВПАДАЕТ' : 'НЕ СОВПАДАЕТ'}); прямой проход на JS ${мкс.toFixed(0)} мкс`);
