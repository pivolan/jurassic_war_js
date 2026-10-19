// Просмотрщик тренировочных арен ИИ (наше).
//
// То же, что стенд поиска пути, но вместо режимов обхода — политика, которая ведёт бойцов:
// скриптовый учитель или сеть. Видно роль и вес приказа, выбранное каждым бойцом действие,
// накопленную награду и её разбор. На арене всё настоящее: движок, приказы, поиск пути.
import { Mem, G, U, UNITS } from '../js/mem.js';
import { Engine } from '../js/engine.js';
import { loadMission } from '../js/loader.js';
import '../js/modules.browser.js';
import { F } from '../js/fn.js';
import { FrameBuffer } from '../js/render/fb.js';
import { Renderer } from '../js/render/renderer.js';
import { fixSlotPointers } from '../js/render/scene.js';
import { fixFontPointers } from '../js/render/text.js';
import { setPathMode } from '../js/port/path.js';
import { ДЕЙСТВИЯ, ЧИСЛО_ДЕЙСТВИЙ, жив, спит } from '../js/ai/act.js';
import { собрать, МИССИЯ, ПЛЕМЯ, РАЗМЕР } from '../js/ai/arena.js';
import { СЦЕНЫ as АРЕНЫ } from '../js/ai/scenes.js?v=2';
import { решение } from '../js/ai/policy_script.js';
import { начать, шаг as шагЭпизода, завершить, ИНТЕРВАЛ } from '../js/ai/episode.js';
import { ВЕСА, ВЕКТОР } from '../js/ai/obs.js';
import { политикаСети, генератор } from '../js/ai/policy_net.js';

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const парам = new URLSearchParams(location.search);
const note = document.getElementById('note'), табло = document.getElementById('табло');
/** Строка состояния стенда арены. */
const скажи = (s) => { note.textContent = s; };

F[0x26e4d] = () => {}; F[0x26e62] = () => {};      // кнопка MENU поверх карты — лишняя
F[0x1cfcb] = () => {}; F[0x1d12e] = () => {};      // возрождение зверья и рост растений — тоже

const RAW = { '_PWAR01.TRC': 1566374, '_PWAR08.TRC': 2648326, '_PWAR09.TRC': 6804453, '_PWAR05.TRS': 910384 };
/** Скачать и разжать пак игры (на стенде берём сразу сжатые .gz). */
async function качать(имя) {
  const r = await fetch('../../PWAR/' + имя + '.gz');
  if (r.ok) return new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return new Uint8Array(await (await fetch('../../PWAR/' + имя)).arrayBuffer());
}

скажи('загрузка ресурсов…');
const mem = Mem.ofSize();
const сжатый = await (await fetch('../data/boot_snap.bin.z')).arrayBuffer();
const снимок = new Uint8Array(await new Response(
  new Blob([сжатый]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
const files = {};
for (const имя of Object.keys(RAW)) files[имя] = await качать(имя);

setPathMode('astar');                              // в игре поиск пути всегда astar
let eng = new Engine(mem); eng.files = files;
const fb = new FrameBuffer();
const rend = new Renderer(eng, fb, files);
const img = ctx.createImageData(640, 480);

const ШАГ_МС = 55, СКОРОСТИ = [1, 2, 3, 6];
let скорость = 3, арена = 0, вариация = 0, пауза = false, эп = null, конец = null;
// По умолчанию на стенде ведёт нейронка (её и надо смотреть); если весов нет, ниже сама
// переключится на скриптового учителя. Явный выбор — параметром ?p=скрипт.
let политика = ['скрипт', 'сеть', 'случайная'].includes(парам.get('p')) ? парам.get('p') : 'сеть';

/** Собрать тренировочную сцену номер n в варианте в и начать её сначала. */
function загрузить(n = арена, в = вариация) {
  арена = n; вариация = в; конец = null;
  mem.b.set(снимок, 0x30000);
  mem.w32(0x46c, 110);
  // Указатели слотов спрайтов и шрифтов в снимке сдвинуты на +0x100000, а снимок кладётся
  // заново на каждой сцене — значит и чинить их надо каждый раз (иначе полосатый мусор).
  fixSlotPointers(mem); fixFontPointers(mem);
  eng = new Engine(mem); eng.files = files;
  rend.eng = eng;
  loadMission(mem, files, МИССИЯ, ПЛЕМЯ, 1);
  эп = начать(eng, собрать(eng, АРЕНЫ[арена], вариация));
  rend.drawFull();
  кнопки();
  скажи(`${АРЕНЫ[арена].имя} · ${АРЕНЫ[арена].подпись}`);
}

// ---- политики: скрипт, нейронка (веса из out/ai/weights, отдаются как /jw/ai/weights/), случайная
const слСлуч = генератор(5);
let сеть = null, весаИмя = '', температура = 1;
const политики = {
  скрипт: (e, i, э) => решение(e, i, э),
  сеть: (e, i, э, наб) => сеть ? сеть(e, i, э, наб) : решение(e, i, э),
  случайная: () => Math.floor(слСлуч() * ЧИСЛО_ДЕЙСТВИЙ),
};
const списокВесов = document.getElementById('веса');
/** Подгрузить веса нейросети-бойца; пустое имя — играть скриптом. */
async function загрузитьВеса(файл) {
  if (!файл) { сеть = null; весаИмя = ''; return; }
  try {
    const w = await (await fetch('../../ai/weights/' + файл)).json();
    сеть = политикаСети(w, { температура, seed: 11 });
    весаИмя = w.имя || файл;
    скажи(`нейронка «${весаИмя}»: ${w.описание || ''}`);
  } catch (e) { сеть = null; скажи('веса не загрузились: ' + e.message); }
}
// В списке показываем только РАБОЧИЕ веса. Остальные (заготовки bc*, вся цепочка ppo1…ppo12b,
// переносы, пробы и тупики) — это след обучения: смотреть их незачем, а выбирать из тридцати
// строк мешает. Признак «основной» ставит tools/ai_оглавление.mjs; галочка «все веса» возвращает
// полный список, когда надо сравнить с предком.
const всеВеса = document.getElementById('всевеса');
let оглавление = [];
/** Наполнить выпадающий список: рабочие веса или все. */
function заполнитьВеса() {
  const было = списокВесов.value;
  const видно = всеВеса.checked ? оглавление : oглавлениеРабочие();
  списокВесов.innerHTML = '';
  for (const w of видно) {
    const o = document.createElement('option'); o.value = w.файл; o.textContent = w.имя; o.title = w.описание; списокВесов.appendChild(o);
  }
  if (видно.some(w => w.файл === было)) списокВесов.value = было;
  return видно;
}
/** Рабочие: помеченные оглавлением, а если пометок нет (старое оглавление) — все. */
const oглавлениеРабочие = () => (оглавление.some(w => w.основной) ? оглавление.filter(w => w.основной) : оглавление);
(async () => {
  try {
    const весь = await (await fetch('../../ai/weights/index.json')).json();
    // Старые веса с другим размером входа (наблюдение росло) в список не идут — они не загрузятся.
    // Порядок — от свежих к старым по дате, и по умолчанию берём самые свежие подходящие.
    // Арена ведёт ОДНОГО бойца, значит и веса тут годятся только бойцовские: тактик, комдив и
    // поведенец — сети других слоёв, с другим входом и выходом, и подсунуть их сюда нельзя (а
    // список их показывал, и по умолчанию выбирался тактик).
    // Вдобавок наблюдение бойца с тех пор росло: из 29 бойцовских весов под нынешний вход
    // подходят только два, остальные просто не загрузятся — их и не показываем.
    оглавление = весь.filter(w => (w.слой || 'боец') === 'боец')
                     .filter(w => !((w.вектор && w.вектор !== ВЕКТОР) || (w.действий && w.действий !== ЧИСЛО_ДЕЙСТВИЙ)))
                     .sort((a, b) => String(b.дата || b.имя).localeCompare(String(a.дата || a.имя)));
    const видно = заполнитьВеса();
    if (видно.length) await загрузитьВеса(видно[0].файл);
    if (политика === 'сеть' && !сеть) политика = 'скрипт';       // весов нет — показываем учителя
    const хочу = парам.get('w');
    if (хочу && оглавление.some(w => w.файл === хочу)) {          // ссылка может звать и спрятанные
      if (!oглавлениеРабочие().some(w => w.файл === хочу)) { всеВеса.checked = true; заполнитьВеса(); }
      списокВесов.value = хочу; await загрузитьВеса(хочу);
    }
  } catch (e) { скажи('список весов недоступен: ' + e.message); }
})();
всеВеса.onchange = () => { const видно = заполнитьВеса();
  скажи(всеВеса.checked ? `весов в списке: ${видно.length} (со всеми промежуточными)` : `в списке только рабочие веса: ${видно.length}`); };
списокВесов.onchange = () => загрузитьВеса(списокВесов.value);

// ---- кнопки
const полоса = document.getElementById('арены');
АРЕНЫ.forEach((а, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1}. ${а.имя}`;
  b.style.padding = '4px 7px';
  if (а.проверочная) b.classList.add('проверочная');
  b.title = а.подпись + ' · роль ' + а.роль;
  b.onclick = () => загрузить(i, вариация);
  полоса.appendChild(b);
});
/** Подсветить кнопку выбранной сцены. */
function кнопки() {
  [...полоса.children].forEach((b, i) => b.classList.toggle('on', i === арена));
  document.getElementById('политика').textContent = 'политика: ' + (политика === 'сеть' ? 'нейронка' : политика);
  document.getElementById('вариация').textContent = 'вариация ' + вариация;
  document.getElementById('скорость').textContent = '×' + скорость;
  document.getElementById('пауза').textContent = пауза ? '▶' : '⏸';
}
document.getElementById('политика').onclick = () => {
  политика = { скрипт: 'сеть', сеть: 'случайная', случайная: 'скрипт' }[политика];
  кнопки();
  скажи(политика === 'сеть' ? (сеть ? `ведёт нейронка «${весаИмя}»` : 'весов нет — ведёт скриптовый учитель')
      : политика === 'случайная' ? 'случайные действия — нижняя планка' : 'ведёт скриптовый учитель');
};
document.getElementById('температура').onclick = () => {
  температура = { 1: 0.5, 0.5: 0, 0: 1 }[температура];
  document.getElementById('температура').textContent = 't=' + температура;
  if (сеть) загрузитьВеса(списокВесов.value);
};
document.getElementById('вариация').onclick = () => загрузить(арена, (вариация + 1) % 20);
document.getElementById('скорость').onclick = () => {
  скорость = СКОРОСТИ[(СКОРОСТИ.indexOf(скорость) + 1) % СКОРОСТИ.length];
  следующий = performance.now(); кнопки();
};
document.getElementById('пауза').onclick = () => { пауза = !пауза; кнопки(); };
document.getElementById('шаг').onclick = () => { пауза = true; тик(); кнопки(); };
document.getElementById('сброс').onclick = () => загрузить();
document.getElementById('путь').onclick = () => { location.href = 'path.html'; };
document.getElementById('игра').onclick = () => { location.href = 'game.html'; };
document.getElementById('прогон').onclick = () => прогонПачкой(20);

// ---- ход
// Когда бой закончился, стенд раньше просто замирал на итоге, и это читалось как зависание:
// нейронка добивает врагов за сотню шагов из тысячи восьмисот, а картинка стоит. Теперь после
// короткой паузы сцена сама перезапускается со следующей вариацией, пока не нажата пауза.
const ПАУЗА_ПОСЛЕ_БОЯ = 1800;
let времяКонца = 0;
/** Один шаг сцены: политика решает за бойцов, движок считает, награда копится. */
function тик() {
  if (конец) return;
  const причина = шагЭпизода(eng, эп, политики[политика]);
  if (причина) { завершить(eng, эп, причина); конец = причина; времяКонца = performance.now(); }
}

let следующий = performance.now();
/** Кадр стенда: нарисовать сцену и обновить обе панели чисел. */
function кадр(t) {
  requestAnimationFrame(кадр);
  if (!пауза && !конец) {
    let n = 0;
    const шаг = ШАГ_МС / скорость;
    while (t >= следующий && n < 8 * скорость) { тик(); следующий += шаг; n++; }
    if (n === 0 && t > следующий + 400) следующий = t;
  } else {
    следующий = t;
    if (конец && !пауза && t - времяКонца > ПАУЗА_ПОСЛЕ_БОЯ) загрузить(арена, (вариация + 1) % 20);
  }
  try { rend.drawTick(); } catch (e) { скажи('рендер: ' + e.message); }
  fb.pal.set(mem.b.subarray(0x44980, 0x44980 + 768));
  fb.blitTo(img);
  ctx.putImageData(img, 0, 0);
  поверх();
  показать();
}

/** Поверх кадра: метка цели и подпись выбранного действия у каждого бойца. */
function поверх() {
  ctx.save();
  ctx.lineWidth = 2;
  if (эп.точка) {
    const t = performance.now() / 600;
    ctx.strokeStyle = `rgba(220,40,40,${0.55 + 0.35 * Math.sin(t)})`;
    ctx.beginPath(); ctx.arc(эп.точка.x * 32 + 16, эп.точка.y * 32 + 16, 13 + 2 * Math.sin(t), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const i of эп.наши) {
    if (!жив(mem, i)) continue;
    const x = mem.u16(UNITS + i + U.X) + 16, y = mem.u16(UNITS + i + U.Y);
    const п = эп.последние.get(i);
    if (!п) continue;
    const s = (спит(eng, i) ? 'спит · ' : '') + ДЕЙСТВИЯ[п.действие];
    ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineWidth = 3; ctx.strokeText(s, x, y - 6);
    ctx.fillStyle = '#ffe9a8'; ctx.fillText(s, x, y - 6);
  }
  ctx.restore();
}

/** Строка «имя: значение» для панели. */
function строка(имя, знач) { return `<div>${имя}: <b>${знач}</b></div>`; }
/** Панель состояния сцены: здоровье, мана, вещи, награда, исход. */
function показать() {
  const m = mem;
  const живых = эп.наши.filter(i => жив(m, i)).length;
  const враговЖивых = эп.враги.filter(i => жив(m, i)).length;
  табло.innerHTML =
    строка('роль', `${эп.роль} · ${ВЕСА[эп.вес] || эп.вес}`) +
    строка('шаг', `${эп.тик} / ${эп.шаговВсего} (решение раз в ${ИНТЕРВАЛ})`) +
    строка('решений', эп.решений) +
    строка('наши', `${живых} / ${эп.наши.length}`) +
    строка('враги', `${враговЖивых} / ${эп.враговВсего}`) +
    (эп.охраняемый ? строка('дом', `${m.u8(UNITS + эп.охраняемый + U.HP)} / ${эп.охраняемыйHPмакс}`) : '') +
    строка('подсказки', эп.награда.toFixed(3)) +
    (конец ? строка('исход', `${эп.исход.toFixed(3)} → итого ${эп.итого.toFixed(3)}`) : '') +
    (конец ? строка('конец', конец) : '');
  показатьСеть();
}

/** Что думает нейронка на последнем решении: три самых вероятных действия и оценка ситуации. */
const панельСети = document.getElementById('сеть');
/** Панель нейросети: вероятности действий и оценка ценности на этом шаге. */
function показатьСеть() {
  if (политика !== 'сеть' || !сеть || !сеть.последнее) { панельСети.innerHTML = ''; return; }
  const п = сеть.последнее;
  const топ = [...п.вер].map((v, a) => [v, a]).sort((x, y) => y[0] - x[0]).slice(0, 4);
  панельСети.innerHTML = `<span>нейронка: <b>${весаИмя}</b></span>` +
    топ.map(([v, a]) => `<span>${ДЕЙСТВИЯ[a]} <b>${(v * 100).toFixed(0)}%</b></span>`).join('') +
    `<span>выбрано: <b>${ДЕЙСТВИЯ[п.действие]}</b></span><span>оценка ситуации: <b>${п.ценность.toFixed(2)}</b></span>`;
}

/** Прогон пачкой без графики — быстрая проверка, что политика в среднем делает. */
function прогонПачкой(n) {
  скажи(`прогон ${n} эпизодов…`);
  setTimeout(() => {
    const итоги = [];
    const было = { арена, вариация };
    for (let k = 0; k < n; k++) {
      загрузить(арена, k % 20);
      let причина = null;
      while (!(причина = шагЭпизода(eng, эп, политики[политика]))) { /* крутим */ }
      завершить(eng, эп, причина);
      итоги.push(эп.итого);
    }
    const ср = итоги.reduce((s, x) => s + x, 0) / итоги.length;
    загрузить(было.арена, было.вариация);
    скажи(`${n} эпизодов «${АРЕНЫ[арена].имя}» политикой «${политика}»: средний итог ${ср.toFixed(3)} ` +
          `(лучший ${Math.max(...итоги).toFixed(2)}, худший ${Math.min(...итоги).toFixed(2)})`);
  }, 20);
}

window.__ai = { mem, get eng() { return eng; }, get эп() { return эп; }, загрузить, АРЕНЫ };
// Арену, вариацию, веса и политику можно дать ссылкой: arena.html?a=4&v=2&w=файл.json&p=сеть — удобно и для съёмки,
// и чтобы прислать конкретный случай. Нумерация человеческая, с единицы.
загрузить(Math.min(Math.max(+(парам.get('a') || 1), 1), АРЕНЫ.length) - 1, Math.max(0, +(парам.get('v') || 0)));
requestAnimationFrame(кадр);
