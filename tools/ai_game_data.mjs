// Датасет для бойца из НАСТОЯЩИХ партий (наше), а не из сцен арены.
//
//   node tools/ai_game_data.mjs <имя> [--карты=100,…] [--племена=0,…] [--секунд=900] [--потоков=16]
//                               [--шум=0.15] [--уровень=3]
//
// Зачем. Сеть бойца училась на 89 сценах арены: 20×15 клеток, один-три бойца, роль выдана сверху
// и не меняется, нет ни оружия, ни своих домов, ни экономики. В партии всё иначе, и замер это
// показал прямо: сеть проиграла учителю 3:7 при перевесе −35 %. Значит учить надо там, где
// играть, — на партиях против скриптового штаба.
//
// Как снимается. Штаб и так ведёт каждый отряд через `вестиОтряд` → `решение()` учителя, а если
// у него задана `бойСеть`, то через неё, причём готовое наблюдение приходит четвёртым доводом.
// Подставляем вместо сети сборщик: он спрашивает учителя, записывает пару «наблюдение → метка»
// и возвращает либо ответ учителя, либо (с вероятностью «шум») случайное действие. Случайные
// ходы нужны не для разнообразия ради, а чтобы в датасет попали состояния ПОСЛЕ ошибок, из
// которых сеть потом должна выбираться, — та же идея DAgger, что и на арене.
//
// Награда на запись — грубая, но честная: сколько еды боец добыл и сколько здоровья потерял
// между решениями. Исход партии для его цвета кладётся в «итог». Этого хватает голове ценности,
// чтобы стартовать не с нуля; тонкую награду считает уже PPO по ходу партии.
//
// Формат — тот же, что у tools/ai_dataset.mjs, поэтому tools/ai_train_bc.py читает его как есть.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const КОРЕНЬ = path.join(path.dirname(ЭТОТ), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const позиц = process.argv.slice(2).filter(a => !a.startsWith('--'));

if (isMainThread) {
  const имя = позиц[0] || 'game1';
  const карты = (арг.карты || '100,101,102,103,105,107,110,112').split(',').map(Number);
  const племена = (арг.племена || '0,1,4,6').split(',').map(Number);
  const секунд = +(арг.секунд || 900), потоков = Ядра.потоков(арг.потоков, 16);
  const папка = path.join(КОРЕНЬ, 'out/ai/data', имя);
  fs.mkdirSync(папка, { recursive: true });
  const задания = [];
  for (const карта of карты) for (const племя of племена) for (const место of [0, 1]) задания.push({ карта, племя, место, секунд });
  const t0 = Date.now();
  let партий = 0, записей = 0; const счёт = {};
  await Promise.all(Array.from({ length: потоков }, (_, k) => new Promise((ок, нет) => {
    const w = new Worker(ЭТОТ, { workerData: { k, папка, задания: задания.filter((_, i) => i % потоков === k),
                                               шум: +(арг.шум || 0.15), уровень: +(арг.уровень || 3) } });
    w.on('message', (м) => { партий += м.партий; записей += м.записей; for (const [a, n] of Object.entries(м.счёт)) счёт[a] = (счёт[a] || 0) + n; });
    w.on('error', нет); w.on('exit', (c) => c ? нет(new Error('поток ' + k + ' упал: ' + c)) : ок());
  })));
  const { ОКНО, СЛОЁВ, ВЕКТОР, ЧИСЛО_ДЕЙСТВИЙ, ДЕЙСТВИЯ } = await import('./ai_lib.mjs');
  fs.writeFileSync(path.join(папка, 'meta.json'), JSON.stringify({
    имя, дата: new Date().toISOString(), источник: 'партии', окно: ОКНО, слоёв: СЛОЁВ, вектор: ВЕКТОР,
    действий: ЧИСЛО_ДЕЙСТВИЙ, карты, племена, секунд, шум: +(арг.шум || 0.15), партий, записей,
    метки: Object.fromEntries(ДЕЙСТВИЯ.map((д, a) => [д, счёт[a] || 0])),
  }, null, 1), 'utf8');
  console.log(`${партий} партий, ${записей} записей за ${((Date.now() - t0) / 1000).toFixed(0)} с → ${папка}`);
  const всего = Math.max(1, записей);
  console.log('метки учителя: ' + ДЕЙСТВИЯ.map((д, a) => `${д} ${((счёт[a] || 0) / всего * 100).toFixed(1)}%`).filter(с => !с.endsWith(' 0.0%')).join(', '));
} else {
  const { k, папка, задания, шум, уровень } = workerData;
  const { движок, прогнать, сводка, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  const { решение } = await import('../reimpl/js/ai/policy_script.js');
  const { ЧИСЛО_ДЕЙСТВИЙ } = await import('../reimpl/js/ai/act.js');
  const { ОКНО, СЛОЁВ, ВЕКТОР } = await import('../reimpl/js/ai/obs.js');
  const { G, U, UNITS } = await import('../reimpl/js/mem.js');
  const П = СЛОЁВ * ОКНО * ОКНО;

  let s = (k + 1) * 2654435761 >>> 0;
  const сл = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

  const окна = [], векторы = [], учитель = [], действие = [], награда = [], конец = [], сцена = [], вариация = [], режим = [], итог = [], юнит = [], эпизодИд = [];
  const счёт = {};
  let партий = 0;

  for (const з of задания) {
    const eng = движок(); const m = eng.m;
    loadMission(m, eng.files, з.карта, з.племя, 1);
    const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
    const A = цвета[з.место], B = цвета[1 - з.место];
    if (A === undefined || B === undefined) continue;
    расставить(eng, [{ цвет: A, племя: з.племя, кто: 'компьютер' }, { цвет: B, племя: з.племя, кто: 'компьютер' }], {});
    const начало = записейСейчас();
    const прошлое = new Map();          // юнит → { hp, еда } на прошлом решении
    const мои = [];                     // индексы записей этой партии
    const сборщик = (e, i, эп, наб) => {
      const у = решение(e, i, эп);
      const д = сл() < шум ? Math.floor(сл() * ЧИСЛО_ДЕЙСТВИЙ) : у;
      const о = new Uint8Array(П);
      for (let t = 0; t < П; t++) о[t] = Math.round(наб.окно[t] * 255);
      const hp = m.u8(UNITS + i + U.HP), еда = m.u16(UNITS + i + U.FOOD) | 0;
      const п = прошлое.get(i);
      // Награда за промежуток между решениями: добытая еда в плюс, потерянное здоровье в минус.
      // Числа мелкие нарочно: это подсказка голове ценности, а не цель обучения.
      const р = п ? Math.max(-1, Math.min(1, (еда - п.еда) / 500 - (п.hp - hp) / 60)) : 0;
      if (награда.length && мои.length) награда[мои[мои.length - 1]] = р;
      прошлое.set(i, { hp, еда });
      мои.push(окна.length);
      окна.push(о); векторы.push(Float32Array.from(наб.вектор));
      учитель.push(у); действие.push(д); награда.push(0); конец.push(0);
      сцена.push(з.карта); вариация.push(з.племя * 2 + з.место); режим.push(0); итог.push(0);
      юнит.push(i & 0xffff); эпизодИд.push(партий);
      счёт[у] = (счёт[у] || 0) + 1;
      return д;
    };
    for (const [ц, сеть] of [[A, сборщик], [B, null]]) {
      m.w8(0x32aec + ц, 0);
      Скрипт.задать(eng, ц, { уровень, характер: 'ровный', бойСеть: сеть });
    }
    const r = прогнать(eng, Math.round(з.секунд * 1000 / ТИК_МС));
    // Исход для собиравшей стороны: победа 1, ничья 0.5, поражение 0 — он же «итог» у всех записей.
    const исход = r.победитель === A ? 1 : r.победитель === B ? 0 : 0.5;
    for (const idx of мои) итог[idx] = исход;
    if (мои.length) конец[мои[мои.length - 1]] = 1;
    партий++;
    function записейСейчас() { return окна.length; }
    void начало;
  }

  const N = окна.length;
  const пиши = (имя, arr) => fs.writeFileSync(path.join(папка, `part-${k}.${имя}`), Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
  const о = new Uint8Array(N * П); окна.forEach((x, i) => о.set(x, i * П)); пиши('окна.u8', о);
  const в = new Float32Array(N * ВЕКТОР); векторы.forEach((x, i) => в.set(x, i * ВЕКТОР)); пиши('векторы.f32', в);
  пиши('учитель.u8', Uint8Array.from(учитель)); пиши('действие.u8', Uint8Array.from(действие));
  пиши('награда.f32', Float32Array.from(награда)); пиши('конец.u8', Uint8Array.from(конец));
  пиши('сцена.u16', Uint16Array.from(сцена)); пиши('вариация.u16', Uint16Array.from(вариация));
  пиши('режим.u8', Uint8Array.from(режим)); пиши('итог.f32', Float32Array.from(итог));
  пиши('юнит.u16', Uint16Array.from(юнит)); пиши('эпизод.u32', Uint32Array.from(эпизодИд));
  parentPort.postMessage({ партий, записей: N, счёт });
}
