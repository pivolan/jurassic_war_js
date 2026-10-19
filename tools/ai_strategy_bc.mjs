// Стартовые веса стратега: клонирование решений скриптового штаба (наше).
//
//   node tools/ai_strategy_bc.mjs [--карты=100,…] [--племена=0,…] [--секунд=900] [--эпох=25]
//                                 [--характеры=костяк,ровный] [--имя=стратег-bc]
//
// Тот же путь, что у тактика и у бойца: сначала сеть повторяет нынешнее правило, потом правило
// улучшает отбор на партиях. Учить верхний слой с нуля над уже обученными нижними нельзя —
// notes/AI-PLAN.md, подводный камень 10.
//
// Разметка снимается прямо в партии: играют два скриптовых штаба, а `штаб()` на каждом своём
// такте зовёт `с.сборСтратега(наблюдение, метка)` — то есть метка это решение самого правила,
// а не наша догадка о нём. Берём несколько поведений сразу: у «костяка» и «агрессора» разные
// осанки в одинаковой обстановке, и сеть должна видеть обе — иначе она выучит один стиль.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const КОРЕНЬ = path.join(path.dirname(ЭТОТ), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const С = await import('../reimpl/js/ai/strategy.js');

if (!isMainThread) {
  const { движок, прогнать, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  parentPort.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    const X = [], Y = [];
    for (const t of з.задачи) {
      try {
        const eng = движок(); const m = eng.m;
        loadMission(m, eng.files, t.карта, t.племяA, 1);
        const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
        const A = цвета[0], B = цвета[1]; if (A === undefined || B === undefined) continue;
        расставить(eng, [{ цвет: A, племя: t.племяA, кто: 'компьютер' }, { цвет: B, племя: t.племяB, кто: 'компьютер' }], {});
        for (const [ц, х] of [[A, t.характерA], [B, t.характерB]]) {
          m.w8(0x32aec + ц, 0);
          const с = Скрипт.задать(eng, ц, { уровень: 3, характер: х });
          с.сборСтратега = (вх, метка) => { X.push(Array.from(вх)); Y.push(метка); };
        }
        прогнать(eng, Math.round(t.секунд * 1000 / ТИК_МС));
      } catch (e) { /* партия не собралась — пропускаем, данных и так много */ }
    }
    parentPort.postMessage({ X, Y });
  });
}

if (isMainThread) {
  const карты = (арг.карты || '100,101,102,104,106,108,110,112,114,116').split(',').map(Number);
  const племена = (арг.племена || '0,1,2,3,4,5,6,7').split(',').map(Number);
  const характеры = (арг.характеры || 'костяк,ровный,агрессор,черепаха').split(',');
  const секунд = +(арг.секунд || 900), потоков = Ядра.потоков(арг.потоков, 16);
  const эпох = +(арг.эпох || 25), имя = арг.имя || 'стратег-bc';

  const задачи = [];
  for (const карта of карты) for (const племяA of племена) {
    const племяB = (племяA + 1 + (карта % 7)) % 8;
    const характерA = характеры[(карта + племяA) % характеры.length];
    const характерB = характеры[(карта + племяA + 1) % характеры.length];
    задачи.push({ карта, племяA, племяB, характерA, характерB, секунд });
  }
  const потоки = Array.from({ length: потоков }, () => new Worker(ЭТОТ));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  const t0 = Date.now();
  const части = await Promise.all(потоки.map((w, k) => занять(w, { задачи: задачи.filter((_, i) => i % потоков === k) })));
  for (const w of потоки) w.postMessage('стоп');
  const X = части.flatMap(ч => ч.X), Y = части.flatMap(ч => ч.Y);
  console.log(`собрано ${X.length} решений из ${задачи.length} партий за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  if (!X.length) { console.error('данных нет'); process.exit(1); }
  const имена = [С.ОСАНКИ, С.СТРОЙКА, С.ПРОИЗВОДСТВО, С.ПОЛЕ];
  for (let гр = 0; гр < 4; гр++) {
    const счёт = {};
    for (const y of Y) { const k = имена[гр][y[гр]]; счёт[k] = (счёт[k] || 0) + 1; }
    console.log(`  ${['осанка', 'стройка', 'производство', 'поле'][гр]}: ` + Object.entries(счёт).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${(n * 100 / Y.length).toFixed(0)}%`).join(', '));
  }

  // ---- обучение: четыре softmax-головы поверх общего скрытого слоя
  const сеть = С.случайная(12345);
  const скр = new Float32Array(С.СКРЫТЫХ), вых = new Float32Array(С.ВЫХОД);
  const gw1 = new Float32Array(сеть.w1.length), gb1 = new Float32Array(С.СКРЫТЫХ);
  const gw2 = new Float32Array(сеть.w2.length), gb2 = new Float32Array(С.ВЫХОД);
  const mw1 = new Float32Array(сеть.w1.length), mb1 = new Float32Array(С.СКРЫТЫХ);
  const mw2 = new Float32Array(сеть.w2.length), mb2 = new Float32Array(С.ВЫХОД);
  const lr = +(арг.шаг || 0.05), момент = 0.9, батч = 256;
  const порядок = X.map((_, i) => i);
  let сид = 7; const сл = () => { сид = (сид * 1103515245 + 12345) & 0x7fffffff; return сид / 0x80000000; };
  let последняя = 0;
  for (let эпоха = 1; эпоха <= эпох; эпоха++) {
    for (let i = порядок.length - 1; i > 0; i--) { const j = (сл() * (i + 1)) | 0; [порядок[i], порядок[j]] = [порядок[j], порядок[i]]; }
    let потеря = 0, верно = 0, n = 0;
    for (let б = 0; б < порядок.length; б += батч) {
      gw1.fill(0); gb1.fill(0); gw2.fill(0); gb2.fill(0);
      const конец = Math.min(порядок.length, б + батч);
      for (let k = б; k < конец; k++) {
        const idx = порядок[k], вх = X[idx], y = Y[idx];
        С.вперёд(сеть, вх, скр, вых);
        const дВых = new Float32Array(С.ВЫХОД);
        С.ГРАНИЦЫ.forEach(([от, до], гр) => {
          let макс = -Infinity; for (let a = от; a < до; a++) if (вых[a] > макс) макс = вых[a];
          let сум = 0; const p = new Float64Array(до - от);
          for (let a = от; a < до; a++) { p[a - от] = Math.exp(вых[a] - макс); сум += p[a - от]; }
          for (let a = от; a < до; a++) p[a - от] /= сум;
          потеря -= Math.log(Math.max(1e-9, p[y[гр]]));
          let лучш = 0; for (let a = 1; a < до - от; a++) if (p[a] > p[лучш]) лучш = a;
          if (лучш === y[гр]) верно++;
          for (let a = от; a < до; a++) дВых[a] = p[a - от] - (a - от === y[гр] ? 1 : 0);
        });
        n++;
        const дСкр = new Float32Array(С.СКРЫТЫХ);
        for (let a = 0; a < С.ВЫХОД; a++) {
          const g = дВых[a]; if (!g) continue; gb2[a] += g; const б2 = a * С.СКРЫТЫХ;
          for (let j = 0; j < С.СКРЫТЫХ; j++) { gw2[б2 + j] += g * скр[j]; дСкр[j] += g * сеть.w2[б2 + j]; }
        }
        for (let j = 0; j < С.СКРЫТЫХ; j++) {
          if (скр[j] <= 0) continue; const g = дСкр[j]; if (!g) continue;
          gb1[j] += g; const б1 = j * С.ВХОД;
          for (let i2 = 0; i2 < С.ВХОД; i2++) gw1[б1 + i2] += g * вх[i2];
        }
      }
      const мас = lr / Math.max(1, конец - б);
      for (let i2 = 0; i2 < сеть.w1.length; i2++) { mw1[i2] = момент * mw1[i2] - мас * gw1[i2]; сеть.w1[i2] += mw1[i2]; }
      for (let i2 = 0; i2 < С.СКРЫТЫХ; i2++) { mb1[i2] = момент * mb1[i2] - мас * gb1[i2]; сеть.b1[i2] += mb1[i2]; }
      for (let i2 = 0; i2 < сеть.w2.length; i2++) { mw2[i2] = момент * mw2[i2] - мас * gw2[i2]; сеть.w2[i2] += mw2[i2]; }
      for (let i2 = 0; i2 < С.ВЫХОД; i2++) { mb2[i2] = момент * mb2[i2] - мас * gb2[i2]; сеть.b2[i2] += mb2[i2]; }
    }
    последняя = верно / Math.max(1, n * 4);
    console.log(`эпоха ${эпоха}: потеря ${(потеря / Math.max(1, n)).toFixed(4)}, совпадение по головам ${(последняя * 100).toFixed(1)} %`);
  }
  const файл = path.join(КОРЕНЬ, 'out/ai/weights', `${имя}.json`);
  fs.writeFileSync(файл, JSON.stringify({ имя, слой: 'стратег', вход: С.ВХОД, выход: С.ВЫХОД, скрытых: С.СКРЫТЫХ,
    описание: `клон решений штаба: ${X.length} решений, ${эпох} эпох, совпадение ${(последняя * 100).toFixed(1)} %`,
    дата: new Date().toISOString().slice(0, 19),
    w1: Array.from(сеть.w1), b1: Array.from(сеть.b1), w2: Array.from(сеть.w2), b2: Array.from(сеть.b2) }));
  console.log('веса →', файл);
}
