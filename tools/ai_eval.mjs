// Оценка политик игрой: скриптовый учитель, случайная и нейронка (по файлам весов) на всех
// сценах, проверочные вариации (от ПРОВЕРОЧНАЯ_ВАРИАЦИЯ) — их в обучении не было (наше).
//
//   node tools/ai_eval.mjs [веса.json ...] [--n=20] [--t=1] [--потоков=16] [--md=файл] [--сцена=подстрока]
//
// Печатает таблицу: средний итог и доля «успехов» по сценам (успех — итог ≥ 0.5, для ролей
// с очевидным исходом это «дошёл / перебил / собрал / объект цел»), плюс сводку по ролям.
import fs from 'node:fs'; import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет

const арг = process.argv.slice(2);
const опц = Object.fromEntries(арг.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const веса = арг.filter(a => !a.startsWith('--'));

if (isMainThread) {
  const { КОРЕНЬ, СЦЕНЫ, ПРОВЕРОЧНАЯ_ВАРИАЦИЯ, РОЛИ, среднее } = await import('./ai_lib.mjs');
  const N = +(опц.n || 20), ПОТОКОВ = Ядра.потоков(опц.потоков, 16), T = +(опц.t || 1);
  const политики = ['скрипт', 'случайная', ...веса];
  const сцены = СЦЕНЫ.map((с, i) => i).filter(i => !опц.сцена || СЦЕНЫ[i].имя.includes(опц.сцена));
  const задания = [];
  for (const п of политики) for (const с of сцены) for (let v = 0; v < N; v++) задания.push([п, с, ПРОВЕРОЧНАЯ_ВАРИАЦИЯ + v]);
  const итоги = new Map();   // политика|сцена → [итог...]
  const t0 = Date.now();
  await Promise.all(Array.from({ length: ПОТОКОВ }, (_, k) => new Promise((ок, нет) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { k, T, задания: задания.filter((_, i) => i % ПОТОКОВ === k) } });
    w.on('message', (м) => { for (const [ключ, итог, причина] of м) { if (!итоги.has(ключ)) итоги.set(ключ, []); итоги.get(ключ).push([итог, причина]); } });
    w.on('error', нет); w.on('exit', (c) => c ? нет(new Error('поток упал ' + c)) : ок());
  })));
  const имя = (п) => п === 'скрипт' || п === 'случайная' ? п : path.basename(п, '.json');
  const успех = (r) => r[0] >= 0.5;
  const строки = [];
  строки.push(`| сцена | роль | ${политики.map(п => `${имя(п)} итог | успех`).join(' | ')} |`);
  строки.push(`|---|---|${политики.map(() => '---:|---:').join('|')}|`);
  const поРолям = new Map();
  for (const с of сцены) {
    const сц = СЦЕНЫ[с];
    const ячейки = политики.map(п => {
      const r = итоги.get(п + '|' + с) || [];
      const ср = среднее(r.map(x => x[0])), у = r.length ? r.filter(успех).length / r.length : 0;
      const ключ = п + '|' + сц.роль + (сц.проверочная ? '|проверочные' : '|учебные');
      if (!поРолям.has(ключ)) поРолям.set(ключ, []); поРолям.get(ключ).push(...r);
      return `${ср >= 0 ? '+' : ''}${ср.toFixed(2)} | ${(у * 100).toFixed(0)}%`;
    });
    строки.push(`| ${сц.проверочная ? '· ' : ''}${сц.имя} | ${сц.роль} | ${ячейки.join(' | ')} |`);
  }
  строки.push('');
  строки.push(`| роль | набор | ${политики.map(п => `${имя(п)} итог | успех`).join(' | ')} |`);
  строки.push(`|---|---|${политики.map(() => '---:|---:').join('|')}|`);
  for (const роль of [...РОЛИ, 'ВСЕ']) for (const набор of ['учебные', 'проверочные']) {
    const ячейки = политики.map(п => {
      let r = [];
      if (роль === 'ВСЕ') for (const [k, v] of поРолям) { if (k.startsWith(п + '|') && k.endsWith('|' + набор)) r.push(...v); }
      else r = поРолям.get(п + '|' + роль + '|' + набор) || [];
      if (!r.length) return '— | —';
      return `${среднее(r.map(x => x[0])) >= 0 ? '+' : ''}${среднее(r.map(x => x[0])).toFixed(2)} | ${(r.filter(успех).length / r.length * 100).toFixed(0)}%`;
    });
    if (ячейки.every(я => я === '— | —')) continue;
    строки.push(`| ${роль === 'ВСЕ' ? '**все**' : роль} | ${набор} | ${ячейки.join(' | ')} |`);
  }
  const текст = строки.join('\n');
  console.log(текст);
  console.log(`\n${задания.length} эпизодов за ${((Date.now() - t0) / 1000).toFixed(1)} с; вариации ${ПРОВЕРОЧНАЯ_ВАРИАЦИЯ}..${ПРОВЕРОЧНАЯ_ВАРИАЦИЯ + N - 1}, температура ${T}`);
  if (опц.md) fs.writeFileSync(опц.md, текст + '\n', 'utf8');
} else {
  const { СЦЕНЫ, эпизод, решение, ЧИСЛО_ДЕЙСТВИЙ } = await import('./ai_lib.mjs');
  const { политикаСети, генератор } = await import('../reimpl/js/ai/policy_net.js');
  const { k, T, задания } = workerData;
  const сети = new Map();
  const сл = генератор(k + 77);
  const случайная = () => Math.floor(сл() * ЧИСЛО_ДЕЙСТВИЙ);
  const out = [];
  for (const [п, с, v] of задания) {
    let политика;
    if (п === 'скрипт') политика = (e, i, э) => решение(e, i, э);
    else if (п === 'случайная') политика = случайная;
    else {
      if (!сети.has(п)) сети.set(п, политикаСети(fs.readFileSync(п, 'utf8'), { температура: T, seed: k * 1000 + 7 }));
      политика = сети.get(п);
    }
    const эп = эпизод(СЦЕНЫ[с], v, политика);
    out.push([п + '|' + с, эп.итого, эп.причина]);
  }
  parentPort.postMessage(out);
}
