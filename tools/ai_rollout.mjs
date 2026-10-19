// Прогон эпизодов нейронкой для RL: пачка эпизодов текущими весами, траектории в файлы (наше).
//
//   node tools/ai_rollout.mjs <веса.json> <папка> [эпизодов=1600] [потоков=16] [seed=1] [температура=1]
//
// Формат тот же, что у tools/ai_dataset.mjs (окна, векторы, действие, награда, конец, сцена,
// вариация, итог), плюс logp.f32 (лог-вероятность выбранного действия) и ценность.f32 (оценка
// критика) — они нужны PPO. Поле учитель.u8 — тоже пишется (решение учителя в том же состоянии),
// чтобы можно было мерить, насколько сеть от него ушла.
// Сцены — только учебные, вариации — ниже ПРОВЕРОЧНАЯ_ВАРИАЦИЯ, выбираются по seed.
import fs from 'node:fs'; import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет

if (isMainThread) {
  const { СЦЕНЫ, УЧЕБНЫЕ, ПРОВЕРОЧНАЯ_ВАРИАЦИЯ, ОКНО, СЛОЁВ, ВЕКТОР, ЧИСЛО_ДЕЙСТВИЙ, РОЛИ, среднее } = await import('./ai_lib.mjs');
  const [веса, папка] = process.argv.slice(2);
  const ЭПИЗОДОВ = +(process.argv[4] || 1600), ПОТОКОВ = Ядра.потоков(process.argv[5], 16), SEED = +(process.argv[6] || 1), T = +(process.argv[7] || 1);
  fs.mkdirSync(папка, { recursive: true });
  for (const f of fs.readdirSync(папка)) if (f.startsWith('part-')) fs.unlinkSync(path.join(папка, f));
  // Веса сцен: AI_ВЕС_СЦЕН='{"три на три (ИИ)":10}' — сцена попадает в прогон в 10 раз чаще
  // остальных (для прицельного обучения на одной сцене, §4л).
  const весаСцен = process.env.AI_ВЕС_СЦЕН ? JSON.parse(process.env.AI_ВЕС_СЦЕН) : {};
  const колода = [];
  for (const сц of УЧЕБНЫЕ) for (let r = 0; r < Math.max(1, Math.round(весаСцен[сц.имя] || 1)); r++) колода.push(сц);
  const задания = [];
  for (let k = 0; k < ЭПИЗОДОВ; k++) {
    const сц = колода[k % колода.length];
    задания.push([СЦЕНЫ.indexOf(сц), (SEED * 1000003 + k * 7919 + 11) % ПРОВЕРОЧНАЯ_ВАРИАЦИЯ]);
  }
  const t0 = Date.now();
  let записей = 0; const итоги = [];
  await Promise.all(Array.from({ length: ПОТОКОВ }, (_, k) => new Promise((ок, нет) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { k, веса, папка, T, seed: SEED * 131 + k, задания: задания.filter((_, i) => i % ПОТОКОВ === k) } });
    w.on('message', (м) => { записей += м.записей; итоги.push(...м.итоги); });
    w.on('error', нет); w.on('exit', (c) => c ? нет(new Error('поток упал ' + c)) : ок());
  })));
  const поРолям = {};
  for (const [с, итог] of итоги) { const р = СЦЕНЫ[с].роль; (поРолям[р] ||= []).push(итог); }
  const сводка = { эпизодов: итоги.length, записей, итог: среднее(итоги.map(x => x[1])),
                   поРолям: Object.fromEntries(Object.entries(поРолям).map(([р, a]) => [р, среднее(a)])),
                   поСценам: Object.fromEntries(СЦЕНЫ.map((сц, i) => [сц.имя, среднее(итоги.filter(x => x[0] === i).map(x => x[1]))]).filter(([, v]) => !Number.isNaN(v))),
                   секунд: (Date.now() - t0) / 1000 };
  fs.writeFileSync(path.join(папка, 'meta.json'), JSON.stringify({ окно: ОКНО, слоёв: СЛОЁВ, вектор: ВЕКТОР, действий: ЧИСЛО_ДЕЙСТВИЙ, вариаций: ПРОВЕРОЧНАЯ_ВАРИАЦИЯ, ...сводка }), 'utf8');
  console.log(JSON.stringify(сводка));
} else {
  const { СЦЕНЫ, эпизод, решение, ОКНО, СЛОЁВ, ВЕКТОР } = await import('./ai_lib.mjs');
  const { политикаСети } = await import('../reimpl/js/ai/policy_net.js');
  const { k, веса, папка, T, seed, задания } = workerData;
  const сеть = политикаСети(fs.readFileSync(веса, 'utf8'), { температура: T, seed });
  const П = СЛОЁВ * ОКНО * ОКНО;
  const юнит = [], эпизодИд = [], окна = [], векторы = [], учитель = [], действие = [], награда = [], конец = [], сцена = [], вариация = [], итог = [], logp = [], ценность = [];
  const итоги = []; let записей = 0, эпизодов = 0;
  for (const [номер, в] of задания) {
    const доп = [];
    const эп = эпизод(СЦЕНЫ[номер], в, (e, i, э, наб) => {
      const у = решение(e, i, э);
      const a = сеть(e, i, э, наб);
      доп.push([у, Math.log(Math.max(1e-8, сеть.последнее.вер[a])), сеть.последнее.ценность]);
      return a;
    }, true);
    эп.записи.forEach((з, j) => {
      const о = new Uint8Array(П);
      for (let i = 0; i < П; i++) о[i] = Math.round(з.окно[i] * 255);
      окна.push(о); векторы.push(з.вектор); учитель.push(доп[j][0]); действие.push(з.действие);
      награда.push(з.награда); конец.push(з.конец ? 1 : 0); юнит.push(з.юнит); эпизодИд.push(эпизодов);
      сцена.push(номер); вариация.push(в); итог.push(эп.итого); logp.push(доп[j][1]); ценность.push(доп[j][2]);
    });
    записей += эп.записи.length; итоги.push([номер, эп.итого]); эпизодов++;
  }
  const N = записей;
  const пиши = (имя, arr) => fs.writeFileSync(path.join(папка, `part-${k}.${имя}`), Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
  const о = new Uint8Array(N * П); окна.forEach((x, i) => о.set(x, i * П)); пиши('окна.u8', о);
  const в = new Float32Array(N * ВЕКТОР); векторы.forEach((x, i) => в.set(x, i * ВЕКТОР)); пиши('векторы.f32', в);
  пиши('учитель.u8', Uint8Array.from(учитель)); пиши('действие.u8', Uint8Array.from(действие));
  пиши('награда.f32', Float32Array.from(награда)); пиши('конец.u8', Uint8Array.from(конец));
  пиши('сцена.u16', Uint16Array.from(сцена)); пиши('вариация.u16', Uint16Array.from(вариация));
  пиши('режим.u8', new Uint8Array(N).fill(9)); пиши('итог.f32', Float32Array.from(итог)); пиши('юнит.u16', Uint16Array.from(юнит)); пиши('эпизод.u32', Uint32Array.from(эпизодИд));
  пиши('logp.f32', Float32Array.from(logp)); пиши('ценность.f32', Float32Array.from(ценность));
  parentPort.postMessage({ записей, итоги });
}
