// Эволюция тактика на полных партиях (наше).
//
//   node tools/ai_evolve_tactic.mjs <старт.json> [--минут=50] [--потоков=18] [--популяция=24]
//        [--карты=100,…] [--племена=0,4,6] [--секунд=600] [--проверка=110,112,115] [--штаб=out/ai/штаб2.json]
//        [--имя=тактик1]
//
// Тактик — сеть на 638 весов (js/ai/tactic.js): она выбирает, что делает главный отряд, и на что
// нацелиться. Награды по шагам у него нет (см. шапку ai_evolve_game.mjs), поэтому здесь тот же
// поиск: зеркальные возмущения, взвешенная рекомбинация верхней половины, σ по правилу одной пятой.
//
// Соперник — тот же скриптовый штаб зверского уровня (при желании с эволюционированным набором
// генов через --штаб). Стороны меняются местами; племена в паре одинаковые. Стартовые веса —
// клонирование нынешнего правила (tools/ai_tactic_bc.mjs), то есть поиск начинается с паритета,
// а не с нуля.
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import * as Ядра from './ai_ядра.mjs';   // потолок в 60% ядер и низкий приоритет
const ЭТОТ = url.fileURLToPath(import.meta.url);
const КОРЕНЬ = path.join(path.dirname(ЭТОТ), '..') + '/';
const арг = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const файл = process.argv.slice(2).find(a => !a.startsWith('--'));
const Т = await import('../reimpl/js/ai/tactic.js');

const изJSON = (j) => ({ w1: Float32Array.from(j.w1), b1: Float32Array.from(j.b1), w2: Float32Array.from(j.w2), b2: Float32Array.from(j.b2) });
const вВектор = (с) => Float64Array.from([...с.w1, ...с.b1, ...с.w2, ...с.b2]);
const изВектора = (v) => {
  let k = 0; const взять = (n) => Float32Array.from(v.slice(k, k += n));
  return { w1: взять(Т.ВХОД * Т.СКРЫТЫХ), b1: взять(Т.СКРЫТЫХ), w2: взять(Т.СКРЫТЫХ * Т.ВЫХОД), b2: взять(Т.ВЫХОД) };
};

if (!isMainThread) {
  const { движок, прогнать, сводка, ТИК_МС } = await import('./ai_duel.mjs');
  const { loadMission } = await import('../reimpl/js/loader.js');
  const { расставить, стартовыеПозиции } = await import('../reimpl/js/port/skirmish.js');
  const Скрипт = await import('../reimpl/js/port/ai_script.js');
  let штаб = null;
  parentPort.on('message', (з) => {
    if (з === 'стоп') return process.exit(0);
    if (з.штаб !== undefined && !з.задачи) { штаб = з.штаб; return parentPort.postMessage('готов'); }
    const итоги = з.задачи.map((t) => {
      try {
        const eng = движок(); const m = eng.m;
        loadMission(m, eng.files, t.задача.карта, t.задача.племя, 1);
        const точки = стартовыеПозиции(m); const цвета = Object.keys(точки).map(Number).sort((a, b) => a - b);
        const A = цвета[t.задача.местоA], B = цвета[t.задача.местоB];
        if (A === undefined || B === undefined) return { ...t, очко: 0.5, исход: 'нет' };
        const места = [{ цвет: A, племя: t.задача.племя, кто: 'компьютер' }, { цвет: B, племя: t.задача.племя, кто: 'компьютер' }];
        расставить(eng, места, {});
        const общее = { уровень: 3, характер: 'ровный', гены: штаб?.гены || null, ручки: штаб?.ручки || null, приёмы: штаб?.приёмы || null };
        m.w8(0x32aec + A, 0); Скрипт.задать(eng, A, { ...общее, тактик: изВектора(Float64Array.from(з.кандидаты[t.кандидат])) });
        m.w8(0x32aec + B, 0); Скрипт.задать(eng, B, общее);
        const предел = Math.round(t.задача.секунд * 1000 / ТИК_МС);
        const r = прогнать(eng, предел);
        const с = сводка(m); const доля = r.шагов / предел;
        const вес = (з2) => з2 ? з2.бойцов + з2.зданий * 2 : 0;
        let очко;
        if (r.победитель === A) очко = 0.75 + 0.25 * (1 - доля);
        else if (r.победитель === B) очко = 0.25 * доля;
        else { const a = вес(с[A]), b = вес(с[B]); очко = 0.5 + 0.25 * ((a - b) / Math.max(1, a + b)); }
        return { ...t, очко, исход: r.победитель === A ? 'победа' : r.победитель === B ? 'поражение' : 'ничья' };
      } catch (e) { return { ...t, очко: 0.5, исход: 'ошибка', ошибка: String(e).slice(0, 140) }; }
    });
    parentPort.postMessage(итоги);
  });
}

if (isMainThread) {
  if (!файл) { console.error('нужен файл стартовых весов, например out/ai/weights/тактик-bc.json'); process.exit(1); }
  const МИНУТ = +(арг.минут || 50), ПОТОКОВ = Ядра.потоков(арг.потоков, 18), ПОП = +(арг.популяция || 24);
  const имя = арг.имя || 'тактик1', СЕКУНД = +(арг.секунд || 600);
  const карты = (арг.карты || '100,101,102,103,105,107').split(',').map(Number);
  const племена = (арг.племена || '0,4,6').split(',').map(Number);
  const проверКарты = (арг.проверка || '110,112,115').split(',').map(Number);
  const штаб = арг.штаб ? JSON.parse(fs.readFileSync(арг.штаб, 'utf8')) : null;

  const задачи = [], провер = [];
  for (const карта of карты) for (const племя of племена) for (const [a, b] of [[0, 1], [1, 0]]) задачи.push({ карта, племя, местоA: a, местоB: b, секунд: СЕКУНД });
  for (const карта of проверКарты) for (const племя of племена) for (const [a, b] of [[0, 1], [1, 0]]) провер.push({ карта, племя, местоA: a, местоB: b, секунд: СЕКУНД });

  fs.mkdirSync(path.join(КОРЕНЬ, 'out/ai/logs'), { recursive: true });
  const лог = fs.createWriteStream(path.join(КОРЕНЬ, 'out/ai/logs', `evolve-${имя}.log`), { flags: 'a' });
  const скажи = (s) => { console.log(s); лог.write(s + '\n'); };

  let seed = +(арг.сид || 424242); const сл = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  const гаусс = () => { const u = Math.max(1e-9, сл()), v = сл(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  const потоки = Array.from({ length: ПОТОКОВ }, () => new Worker(ЭТОТ));
  const занять = (w, п) => new Promise((ок) => { w.once('message', ок); w.postMessage(п); });
  await Promise.all(потоки.map(w => занять(w, { штаб })));

  async function оценить(кандидаты, набор) {
    const все = [];
    кандидаты.forEach((_, i) => набор.forEach((задача) => все.push({ кандидат: i, задача })));
    const куски = Array.from({ length: ПОТОКОВ }, (_, k) => все.filter((_, i) => i % ПОТОКОВ === k));
    const плоские = кандидаты.map(v => Array.from(v));
    const итоги = (await Promise.all(потоки.map((w, k) => занять(w, { кандидаты: плоские, задачи: куски[k] })))).flat();
    const свод = кандидаты.map(() => ({ f: 0, n: 0, победы: 0, ничьи: 0, поражения: 0 }));
    for (const и of итоги) {
      const с = свод[и.кандидат]; с.f += и.очко; с.n++;
      if (и.исход === 'победа') с.победы++; else if (и.исход === 'поражение') с.поражения++; else с.ничьи++;
    }
    return свод.map(с => ({ ...с, f: с.f / Math.max(1, с.n) }));
  }

  let θ = вВектор(изJSON(JSON.parse(fs.readFileSync(файл, 'utf8'))));
  const масштаб = Math.sqrt(θ.reduce((s, x) => s + x * x, 0) / θ.length) || 0.1;   // шаг — от разброса самих весов
  let σ = +(арг.сигма || 0.5);
  скажи(`\n=== эволюция тактика «${имя}» ===`);
  скажи(`весов ${θ.length}; популяция ${ПОП}; задач в поколении ${задачи.length}; старт ${path.basename(файл)}` +
        `${арг.штаб ? '; штаб ' + path.basename(арг.штаб) : ''}`);
  let [оц] = await оценить([θ], задачи);
  скажи(`поколение 0: старт F=${оц.f.toFixed(4)} (побед ${оц.победы}/${оц.n}, ничьих ${оц.ничьи}, поражений ${оц.поражения})`);
  let лучшая = { θ: θ.slice(), f: оц.f, оц };

  // Задачи меняются от поколения к поколению. Прежде набор был жёстко один и тот же, и отбор
  // выучивал именно эти шесть карт: у «штаб4» приспособленность на обучении выросла 0.52 → 0.69,
  // а на отложенных картах не сдвинулась вовсе; у «тактик2» на обучении 0.51 → 0.65, а на
  // отложенных стало ХУЖЕ клона. Поэтому теперь каждое поколение получает свою выборку из общего
  // пула — запомнить конкретную карту становится нечем, и растёт только то, что переносится.
  const пул = задачи.slice();
  const выборка = (n) => {
    const к = пул.slice();
    for (let i = к.length - 1; i > 0; i--) { const j = (сл() * (i + 1)) | 0; [к[i], к[j]] = [к[j], к[i]]; }
    return к.slice(0, Math.max(6, Math.min(к.length, n)));
  };
  const НАБОР = +(арг.наборЗадач || Math.max(12, Math.round(пул.length * 0.6)));
  const t0 = Date.now(); let поколение = 0;
  while ((Date.now() - t0) / 60000 < МИНУТ) {
    поколение++;
    const дети = [];
    for (let k = 0; k < ПОП / 2; k++) {
      const ε = Array.from(θ, () => гаусс() * масштаб * σ);
      дети.push(Float64Array.from(θ, (x, i) => x + ε[i]));
      дети.push(Float64Array.from(θ, (x, i) => x - ε[i]));
    }
    const набор = выборка(НАБОР);            // своя выборка задач на это поколение
    const свод = await оценить([θ, ...дети], набор);
    const порядок = свод.map((с, i) => ({ i, ...с })).sort((a, b) => b.f - a.f);
    const верх = порядок.filter(п => п.i !== 0).slice(0, Math.max(2, дети.length >> 1));
    const веса = верх.map((_, k) => Math.log(верх.length + 0.5) - Math.log(k + 1));
    const сум = веса.reduce((a, b) => a + b, 0);
    θ = Float64Array.from(θ, (x, j) => x + верх.reduce((s, п, k) => s + веса[k] / сум * (дети[п.i - 1][j] - x), 0));
    const удачных = порядок.filter(п => п.i !== 0 && п.f > свод[0].f).length / дети.length;
    σ = Math.max(0.1, Math.min(1.5, σ * (удачных > 0.2 ? 1.15 : 0.9)));
    const лучший = порядок[0];
    if (лучший.f > лучшая.f) лучшая = { θ: (лучший.i === 0 ? θ : дети[лучший.i - 1]).slice(), f: лучший.f, оц: лучший };
    скажи(`поколение ${поколение}: лучший F=${лучший.f.toFixed(4)} (побед ${лучший.победы}/${лучший.n}, ничьих ${лучший.ничьи}, поражений ${лучший.поражения})` +
          `  родитель ${свод[0].f.toFixed(4)}  σ=${σ.toFixed(3)}  ${((Date.now() - t0) / 60000).toFixed(1)} мин`);
    const с = изВектора(лучшая.θ);
    fs.writeFileSync(path.join(КОРЕНЬ, 'out/ai/weights', `${имя}.json`), JSON.stringify({
      имя, поколение, F: лучшая.f, вход: Т.ВХОД, скрытых: Т.СКРЫТЫХ, выход: Т.ВЫХОД,
      w1: [...с.w1], b1: [...с.b1], w2: [...с.w2], b2: [...с.b2] }));
  }

  const [нашПров] = await оценить([лучшая.θ], провер);
  const [стартОбуч] = await оценить([вВектор(изJSON(JSON.parse(fs.readFileSync(файл, 'utf8'))))], провер);
  скажи(`\nитог «${имя}»: обучение F=${лучшая.f.toFixed(4)}; проверка F=${нашПров.f.toFixed(4)} (стартовые веса на проверке ${стартОбуч.f.toFixed(4)})`);
  скажи(`  на проверке побед ${нашПров.победы}/${нашПров.n}, ничьих ${нашПров.ничьи}, поражений ${нашПров.поражения}`);
  for (const w of потоки) w.postMessage('стоп');
  process.exit(0);
}
