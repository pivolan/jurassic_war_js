// Прогон МИССИЙ КАМПАНИИ нейронкой для обучения (наше): то же, что tools/ai_game_rollout.mjs,
// только вместо скирмиша — настоящая миссия кампании, а противник — встроенный ИИ оригинала.
//
//   node tools/ai_кампания_прогон.mjs <веса.json> <папка> [эпизодов=64] [потоков=16] [seed=1] [температура=1]
//
// Порядок доводов совпадает с ai_rollout.mjs и ai_game_rollout.mjs нарочно: tools/ai_ppo.py зовёт
// прогон именно так, и подменить арену на кампанию можно одним ключом `--прогон`.
//
// Зачем отдельный прогон. Словами владельца: «заново значит будем писать. либо параллельно
// запустить эту сцену и нейронку натренить». Арена учит драться в вакууме, скирмиш — воевать с
// таким же компьютером, а кампания ставит ЗАДАЧУ: первая миссия требует набрать 3000 мяса в
// руках, и никакой войны там нет вовсе. Сеть, обученная на скирмише, этой задачи не видела.
//
// Награда. Считаем то, что боец меняет своими руками, и ровно в том, чем меряется миссия:
//   + прибавка мяса В РУКАХ между решениями (первая миссия засчитывает именно его, 0x17989);
//   − потерянное здоровье (за размен собой платит племя);
//   + опыт за убийство (в этой игре это и есть рост: (сумма статов жертвы)² >> 2);
//   − смерть (разово), ± продвижение к цели миссии в конце эпизода.
// Числа мелкие: подсказки не должны перевешивать итог, иначе сеть учится копить и не охотиться.
//
// Какие миссии и племена — через окружение (кириллицу в именах bash не принимает):
//   JW_CAMP_MISSIONS=0        миссии (0 — первая), через запятую
//   JW_CAMP_TRIBES=0,1,2,…    племена
//   JW_CAMP_DIFF=0,1,2        сложности
//   JW_CAMP_SEC=900           игровых секунд на эпизод
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const среда = globalThis.process?.env || {};
const МИССИИ = (среда.JW_CAMP_MISSIONS ? среда.JW_CAMP_MISSIONS.split(',').map(Number) : [0]);
const ПЛЕМЕНА = (среда.JW_CAMP_TRIBES ? среда.JW_CAMP_TRIBES.split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6, 7]);
const СЛОЖНОСТИ = (среда.JW_CAMP_DIFF ? среда.JW_CAMP_DIFF.split(',').map(Number) : [0, 1, 2]);
const СЕКУНД = +(среда.JW_CAMP_SEC || 900);

if (isMainThread) {
  const [веса, папка] = process.argv.slice(2);
  const ЭПИЗОДОВ = +(process.argv[4] || 64), ПОТОКОВ = Ядра.потоков(process.argv[5], 16), SEED = +(process.argv[6] || 1), T = +(process.argv[7] || 1);
  fs.mkdirSync(папка, { recursive: true });
  for (const f of fs.readdirSync(папка)) if (f.startsWith('part-')) fs.unlinkSync(path.join(папка, f));
  // Раскладываем по кругу: миссия × племя × сложность, со сдвигом по сиду — каждая итерация
  // обучения получает свой набор, и сеть не заучивает одну расу.
  const задания = [];
  for (let k = 0; k < ЭПИЗОДОВ; k++) {
    const i = SEED * 7919 + k * 104729;
    задания.push({ миссия: МИССИИ[i % МИССИИ.length],
                   племя: ПЛЕМЕНА[(i / МИССИИ.length | 0) % ПЛЕМЕНА.length],
                   сложность: СЛОЖНОСТИ[(i / (МИССИИ.length * ПЛЕМЕНА.length) | 0) % СЛОЖНОСТИ.length],
                   секунд: СЕКУНД });
  }
  const t0 = Date.now();
  let записей = 0; const итоги = []; let побед = 0;
  await Promise.all(Array.from({ length: ПОТОКОВ }, (_, k) => new Promise((ок, нет) => {
    const w = new Worker(ЭТОТ, { workerData: { k, веса, папка, T, seed: SEED * 131 + k, задания: задания.filter((_, i) => i % ПОТОКОВ === k) } });
    w.on('message', (м) => { записей += м.записей; итоги.push(...м.итоги); побед += м.побед; });
    w.on('error', нет); w.on('exit', (c) => c ? нет(new Error('поток упал ' + c)) : ок());
  })));
  const { ОКНО, СЛОЁВ, ВЕКТОР } = await import('../reimpl/js/ai/obs.js');
  const { ЧИСЛО_ДЕЙСТВИЙ } = await import('../reimpl/js/ai/act.js');
  const средн = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const сводка = { эпизодов: итоги.length, записей, итог: средн(итоги.map(x => x[1])), побед,
                   поражений: итоги.filter(и => и[1] < 0.05).length,
                   ничьих: итоги.length - побед, секунд: (Date.now() - t0) / 1000 };
  fs.writeFileSync(path.join(папка, 'meta.json'), JSON.stringify({ окно: ОКНО, слоёв: СЛОЁВ, вектор: ВЕКТОР,
    действий: ЧИСЛО_ДЕЙСТВИЙ, источник: 'кампания', ...сводка }), 'utf8');
  console.log(JSON.stringify(сводка));
} else {
  const { k, веса, папка, T, seed, задания } = workerData;
  const { движок, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  const Кампания = await import('../reimpl/js/ai/кампания.js');
  const { политикаСети } = await import('../reimpl/js/ai/policy_net.js');
  const { решение } = await import('../reimpl/js/ai/policy_script.js');
  const { ОКНО, СЛОЁВ, ВЕКТОР } = await import('../reimpl/js/ai/obs.js');
  const { G, U, UNITS } = await import('../reimpl/js/mem.js');
  const { F, call } = await import('../reimpl/js/fn.js');

  /** Насколько племя продвинулось к цели миссии, 0..1 — та же мерка, что в tools/ai_кампания.mjs. */
  const прогресс = (m, з, мой, было) => {
    if (!з) return 0;
    const счёт = (вл) => { let ю = 0, д = 0, еда = 0;
      for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
        if (m.u8(UNITS + i + U.FLAGS5B) & 1 || m.u8(UNITS + i + U.OWNER) !== вл) continue;
        if (m.u8(UNITS + i + U.TYPE) >= 0x1a) д++; else ю++;
        еда += m.u16(UNITS + i + U.FOOD);
      }
      return { ю, д, еда }; };
    if (з.вид === 'еда') return Math.min(1, счёт(мой).еда / з.сколько);
    if (з.вид === 'дома') { let есть = 0, надо = 0; const по = new Map();
      for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
        if (m.u8(UNITS + i + U.FLAGS5B) & 1 || m.u8(UNITS + i + U.OWNER) !== мой) continue;
        const t = m.u8(UNITS + i + U.TYPE); if (t < 0x1a || (m.u8(UNITS + i + U.FLAGS50) & 2)) continue;
        по.set(t - 0x1a, (по.get(t - 0x1a) || 0) + 1); }
      for (const п of з.надо) { надо += п.n; let e = 0; for (const в of п.виды) e += по.get(в) || 0; есть += Math.min(п.n, e); }
      return надо ? есть / надо : 0; }
    if (з.вид === 'владелец') { const б = было[з.кого] || 1; const с2 = счёт(з.кого); return 1 - Math.min(1, (с2.ю + с2.д) / б); }
    if (з.вид === 'все') { let б = 0, стало = 0;
      for (let вл = 0; вл < 8; вл++) { if (вл === мой) continue; б += было[вл] || 0; const с2 = счёт(вл); стало += с2.ю + с2.д; }
      return б ? 1 - Math.min(1, стало / б) : 0; }
    return 0;
  };

  const сеть = политикаСети(fs.readFileSync(веса, 'utf8'), { температура: T, seed });
  const П = СЛОЁВ * ОКНО * ОКНО;
  const окна = [], векторы = [], учитель = [], действие = [], награда = [], конец = [], сцена = [], вариация = [],
        итог = [], юнит = [], эпизодИд = [], logp = [], ценность = [];
  const итоги = []; let эпизодов = 0, побед = 0;

  for (const з of задания) {
    const eng = движок(); const m = eng.m;
    loadMission(m, eng.files, з.миссия, з.племя, з.сложность);
    const мой = m.u8(G.humanOwner);
    m.w8(0x32aec + мой, 0);                       // нашим местом распоряжаемся мы, врагами — оригинал
    const задание = Кампания.задание(m, мой);
    const было = {}; for (let вл = 0; вл < 8; вл++) { let n = 0;
      for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) if (!(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.OWNER) === вл) n++;
      было[вл] = n; }
    const прошлое = new Map();                    // юнит → { hp, еда, опыт, индекс записи }
    const мои = [];
    const политика = (e, i, эп, наб) => {
      const у = решение(e, i, эп);
      const a = сеть(e, i, эп, наб);
      const hp = m.u8(UNITS + i + U.HP), еда = m.u16(UNITS + i + U.FOOD) | 0, опыт = m.u32(UNITS + i + U.XP) >>> 0;
      const п = прошлое.get(i);
      if (п) {
        // Мясо в руках — это и есть цель первой миссии; опыт — рост, которым берутся звери
        // покрупнее; здоровье — плата. Всё зажато в [-1, 1], чтобы один удачный кусок не
        // перевесил весь эпизод.
        const р = Math.max(-1, Math.min(1, (еда - п.еда) / 400 - (п.hp - hp) / 50 + Math.min(0.3, Math.max(0, опыт - п.опыт) / 20000)));
        награда[п.индекс] = р;
      }
      const о = new Uint8Array(П);
      for (let t = 0; t < П; t++) о[t] = Math.round(наб.окно[t] * 255);
      прошлое.set(i, { hp, еда, опыт, индекс: окна.length });
      мои.push(окна.length);
      окна.push(о); векторы.push(Float32Array.from(наб.вектор));
      учитель.push(у); действие.push(a); награда.push(0); конец.push(0);
      сцена.push(з.миссия); вариация.push(з.племя * 4 + з.сложность); итог.push(0);
      юнит.push(i & 0xffff); эпизодИд.push(эпизодов);
      logp.push(Math.log(Math.max(1e-8, сеть.последнее.вер[a]))); ценность.push(сеть.последнее.ценность);
      return a;
    };
    // Хозяйство ведёт наш скрипт (охота, стройка, отряды), а за каждого бойца решает сеть.
    Скрипт.задать(eng, мой, { уровень: 3, характер: 'ровный', стратегПравило: true, бойСеть: политика });
    const шагов = Math.round(з.секунд * 1000 / ТИК_МС);
    let лучший = 0, победа = false;
    for (let шаг = 0; шаг < шагов; шаг++) {
      eng.timer++; eng.tick();
      if ((m.u32(G.step) & 0x1f) === 0) {
        try { call(eng, 0x17728, {}); } catch { /* посчитается на следующем */ }
        const код = m.u8(G.endcode);
        if (код) { победа = код === 2; break; }
        if ((m.u32(G.step) & 0xff) === 0) { const п = прогресс(m, задание, мой, было); if (п > лучший) лучший = п; }
      }
    }
    const исход = победа ? 1 : Math.max(лучший, прогресс(m, задание, мой, было));
    // Конец цепочки у каждого бойца: последняя его запись получает итог миссии и штраф за смерть.
    const последняя = new Map();
    for (const idx of мои) { итог[idx] = исход; последняя.set(юнит[idx], idx); }
    for (const [i, idx] of последняя) {
      конец[idx] = 1;
      const мёртв = (m.u8(UNITS + i + U.FLAGS5B) & 1) !== 0;
      награда[idx] += (исход - 0.5) + (мёртв ? -0.3 : 0);
    }
    итоги.push([з.миссия, исход]); эпизодов++; if (победа) побед++;
  }

  const N = окна.length;
  const пиши = (имя, arr) => fs.writeFileSync(path.join(папка, `part-${k}.${имя}`), Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
  const о = new Uint8Array(N * П); окна.forEach((x, i) => о.set(x, i * П)); пиши('окна.u8', о);
  const в = new Float32Array(N * ВЕКТОР); векторы.forEach((x, i) => в.set(x, i * ВЕКТОР)); пиши('векторы.f32', в);
  пиши('учитель.u8', Uint8Array.from(учитель)); пиши('действие.u8', Uint8Array.from(действие));
  пиши('награда.f32', Float32Array.from(награда)); пиши('конец.u8', Uint8Array.from(конец));
  пиши('сцена.u16', Uint16Array.from(сцена)); пиши('вариация.u16', Uint16Array.from(вариация));
  пиши('режим.u8', new Uint8Array(N).fill(10)); пиши('итог.f32', Float32Array.from(итог));
  пиши('юнит.u16', Uint16Array.from(юнит)); пиши('эпизод.u32', Uint32Array.from(эпизодИд));
  пиши('logp.f32', Float32Array.from(logp)); пиши('ценность.f32', Float32Array.from(ценность));
  parentPort.postMessage({ записей: N, итоги, побед });
}
