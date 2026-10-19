// Эволюция только головы политики (наше): всё, кроме последнего слоя, заморожено; ищутся веса
// pw/pb (21×128 + 21 ≈ 2.7 тыс. чисел) той же (μ, λ)-стратегией с зеркальными возмущениями, что
// и у констант учителя (tools/ai_evolve.mjs). Приспособленность — та же свёртка критерия
// владельца (F = 0.5·убито + 0.3·(1 − потери) + 0.2·(1 − HP врагов)), сеть играет argmax
// (температура 0), чтобы оценка кандидата была детерминированной.
//
//   node tools/ai_evolve_head.mjs <веса.json> [--минут=45] [--потоков=6] [--популяция=24] [--вариаций=2] [--имя=es-head]
import fs from 'node:fs'; import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет

const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const СЦЕНЫ_НАБОРА = ['три на три (ИИ)', 'три на три (скрипт)', 'стычка: равные', 'стычка: у врага маг', 'стычка: нас меньше',
                      'стычка: нас больше', 'один против двоих', 'дилофозавр против бегунов', 'два пса', 'оборона дома', 'отвлечь двоих'];

if (isMainThread) {
  const { КОРЕНЬ, СЦЕНЫ } = await import('./ai_lib.mjs');
  const файл = process.argv.slice(2).find(a => !a.startsWith('--'));
  const МИНУТ = +(арг.минут || 45), ПОТОКОВ = Ядра.потоков(арг.потоков, 6), ПОП = +(арг.популяция || 24), ВАР = +(арг.вариаций || 2);
  const имя = арг.имя || 'es-head';
  const w = JSON.parse(fs.readFileSync(файл, 'utf8'));
  const база = { pw: w.слои.pw.slice(), pb: w.слои.pb.slice() };
  const n = база.pw.length + база.pb.length;
  const масштаб = Math.sqrt(база.pw.reduce((s, x) => s + x * x, 0) / база.pw.length) || 0.1;   // шаг возмущения — от разброса весов
  const сцены = СЦЕНЫ_НАБОРА.map(н => СЦЕНЫ.findIndex(s => s.имя === н)).filter(i => i >= 0);
  const задачиЭпизодов = []; for (const с of сцены) for (let v = 0; v < ВАР; v++) задачиЭпизодов.push([с, v]);
  const лог = fs.createWriteStream(path.join(КОРЕНЬ, 'out/ai/logs', `evolve-${имя}.log`), { flags: 'a' });
  const скажи = (s) => { console.log(s); лог.write(s + '\n'); };
  let seed = 777; const сл = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  const гаусс = () => { const u = Math.max(1e-9, сл()), v = сл(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  async function оценить(кандидаты) {
    const задачи = []; кандидаты.forEach((к, i) => { for (const [с, v] of задачиЭпизодов) задачи.push([i, с, v]); });
    const суммы = кандидаты.map(() => ({ f: 0, n: 0, убито: 0, потери: 0, hp: 0 }));
    await Promise.all(Array.from({ length: ПОТОКОВ }, (_, k) => new Promise((ок, нет) => {
      const wk = new Worker(new URL(import.meta.url), { workerData: { w, кандидаты, задачи: задачи.filter((_, i) => i % ПОТОКОВ === k) } });
      wk.on('message', (м) => { for (const [i, f, у, п, h] of м) { const s = суммы[i]; s.f += f; s.n++; s.убито += у; s.потери += п; s.hp += h; } });
      wk.on('error', нет); wk.on('exit', (c) => c ? нет(new Error('поток ' + c)) : ок());
    })));
    return суммы.map(s => ({ f: s.f / s.n, убито: s.убито / s.n, потери: s.потери / s.n, hp: s.hp / s.n }));
  }
  const t0 = Date.now();
  let [оц0] = await оценить([база]);
  скажи(`# старт ${path.basename(файл)}: F=${оц0.f.toFixed(4)} (убито ${(оц0.убито*100).toFixed(0)}%, потери ${(оц0.потери*100).toFixed(0)}%, HP врагов ${(оц0.hp*100).toFixed(0)}%); голова ${n} чисел, масштаб ${масштаб.toFixed(3)}, набор ${сцены.length}×${ВАР}, популяция ${ПОП}`);
  let лучший = { п: база, оц: оц0 }, σ = 0.3, элита = [лучший], поколение = 0;
  while ((Date.now() - t0) / 60000 < МИНУТ) {
    поколение++;
    const дети = [];
    for (let p = 0; p < Math.floor((ПОП - элита.length) / 2); p++) {
      const εw = лучший.п.pw.map(() => гаусс()), εb = лучший.п.pb.map(() => гаусс());
      дети.push({ pw: лучший.п.pw.map((x, j) => x + σ * масштаб * εw[j]), pb: лучший.п.pb.map((x, j) => x + σ * масштаб * εb[j]) });
      дети.push({ pw: лучший.п.pw.map((x, j) => x - σ * масштаб * εw[j]), pb: лучший.п.pb.map((x, j) => x - σ * масштаб * εb[j]) });
    }
    const оц = await оценить(дети);
    const всеДети = дети.map((п, i) => ({ п, оц: оц[i] })).sort((a, b) => b.оц.f - a.оц.f);
    const обошёл = всеДети[0].оц.f > лучший.оц.f;
    σ = Math.max(0.02, Math.min(1, σ * (обошёл ? 1.15 : 0.85)));
    if (обошёл) лучший = всеДети[0];
    элита = [...элита, ...всеДети].sort((a, b) => b.оц.f - a.оц.f).slice(0, 2);
    скажи(`поколение ${поколение}: лучший F=${лучший.оц.f.toFixed(4)} (убито ${(лучший.оц.убито*100).toFixed(0)}%, потери ${(лучший.оц.потери*100).toFixed(0)}%, HP врагов ${(лучший.оц.hp*100).toFixed(0)}%), лучший ребёнок ${всеДети[0].оц.f.toFixed(4)}, σ=${σ.toFixed(3)}, ${((Date.now() - t0) / 60000).toFixed(1)} мин`);
  }
  const дата = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const имяФ = `${имя}-${дата}`;
  const нов = { ...w, имя: имяФ, дата: new Date().toISOString().slice(0, 19),
    описание: `эволюция головы поверх ${path.basename(файл, '.json')}: ${поколение} поколений, F ${оц0.f.toFixed(4)} → ${лучший.оц.f.toFixed(4)} (argmax) на ${сцены.length} сценах × ${ВАР}`,
    слои: { ...w.слои, pw: лучший.п.pw.map(x => +x.toFixed(6)), pb: лучший.п.pb.map(x => +x.toFixed(6)) } };
  const папка = path.join(КОРЕНЬ, 'out/ai/weights');
  fs.writeFileSync(path.join(папка, имяФ + '.json'), JSON.stringify(нов), 'utf8');
  fs.writeFileSync(path.join(папка, имяФ + '.md'), `# ${имяФ}\n\n${нов.описание}.\n\n- свёртка: F = 0.5·убито + 0.3·(1 − потери) + 0.2·(1 − HP врагов)\n- популяция ${ПОП}, зеркальные возмущения, σ адаптивная, элита 2\n- лог out/ai/logs/evolve-${имя}.log\n`);
  // оглавление для стенда (как ai_net.оглавление)
  const список = fs.readdirSync(папка).filter(f => f.endsWith('.json') && f !== 'index.json').sort().map(f => {
    try { const j = JSON.parse(fs.readFileSync(path.join(папка, f), 'utf8')); return { файл: f, имя: j.имя || f.slice(0, -5), описание: j.описание || '', дата: j.дата || '', вектор: j.вектор, действий: j.действий }; } catch { return null; } }).filter(Boolean);
  fs.writeFileSync(path.join(папка, 'index.json'), JSON.stringify(список, null, 1), 'utf8');
  скажи(`веса → out/ai/weights/${имяФ}.json`);
} else {
  const { СЦЕНЫ, эпизод } = await import('./ai_lib.mjs');
  const { загрузить, вперёд, выбрать } = await import('../reimpl/js/ai/net.js');
  const { w, кандидаты, задачи } = workerData;
  const сеть = загрузить(w);
  const out = [];
  let текущий = -1;
  for (const [i, с, v] of задачи) {
    if (i !== текущий) { сеть.pw = Float32Array.from(кандидаты[i].pw); сеть.pb = Float32Array.from(кандидаты[i].pb); текущий = i; }
    const эп = эпизод(СЦЕНЫ[с], v, (e, б, э, наб) => выбрать(вперёд(сеть, наб).вер, Math.random, 0));
    const к = эп.критерий; out.push([i, к.F, к.убито, к.потери, к.hpВрагов]);
  }
  parentPort.postMessage(out);
}
