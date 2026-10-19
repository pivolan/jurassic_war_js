// Стенд для видеодемонстрации поиска пути: пять готовых сцен, переключение кнопкой, приказ
// одним кликом. Всё внутри настоящего движка — карта, юниты и препятствия собираются прямо в
// его памяти (js/ui/pathscenes.js), поэтому работают те же приказы и те же режимы обхода,
// что и в игре: кнопка path переключает orig / orig+ / astar на лету.
import { Mem, G, U, UNITS } from '../js/mem.js';
import { Engine } from '../js/engine.js';
import { loadMission } from '../js/loader.js';
import '../js/modules.browser.js';
import { F } from '../js/fn.js';
import { FrameBuffer } from '../js/render/fb.js';
import { Renderer } from '../js/render/renderer.js';
import { fixSlotPointers } from '../js/render/scene.js';
import { fixFontPointers } from '../js/render/text.js';
import { MODES, pathMode, setPathMode } from '../js/port/path.js';
import { СЦЕНЫ, собрать, МИССИЯ, ПЛЕМЯ, РАЗМЕР } from '../js/ui/pathscenes.js';

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const note = document.getElementById('note');
/** Строка состояния стенда поиска пути. */
const say = (s) => { note.textContent = s; };

// Кнопка MENU оригинала рисуется поверх карты в правом нижнем углу — на стенде она лишняя.
F[0x26e4d] = () => {}; F[0x26e62] = () => {};
// И живность стенду не нужна: движок исправно возрождает убранных зверей (0x1cfcb) и отращивает
// ядовитые растения (0x1d12e), и через полминуты по краю карты идёт стадо. Здесь это выключено —
// сцена должна оставаться ровно такой, какой её собрали.
F[0x1cfcb] = () => {}; F[0x1d12e] = () => {};

const RAW = { '_PWAR01.TRC': 1566374, '_PWAR08.TRC': 2648326, '_PWAR09.TRC': 6804453, '_PWAR05.TRS': 910384 };
/** Скачать и разжать пак игры. */
async function качать(имя) {
  const r = await fetch('../../PWAR/' + имя + '.gz');
  if (r.ok) {
    const ds = new DecompressionStream('gzip');
    return new Uint8Array(await new Response(r.body.pipeThrough(ds)).arrayBuffer());
  }
  return new Uint8Array(await (await fetch('../../PWAR/' + имя)).arrayBuffer());
}

say('загрузка ресурсов…');
const mem = Mem.ofSize();
const сжатый = await (await fetch('../data/boot_snap.bin.z')).arrayBuffer();
const снимокРаспакован = new Uint8Array(await new Response(
  new Blob([сжатый]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
mem.b.set(снимокРаспакован, 0x30000);
mem.w32(0x46c, 110);
const files = {};
for (const имя of Object.keys(RAW)) files[имя] = await качать(имя);

let eng = new Engine(mem); eng.files = files;
const fb = new FrameBuffer();
const rend = new Renderer(eng, fb, files);
const img = ctx.createImageData(640, 480);

// Шаг движка в миллисекундах. В игре это 55 мс; на стенде обход интереснее смотреть быстрее,
// поэтому есть множитель — кнопка ×1/×2/×3, по умолчанию тройная скорость.
const ШАГ = 55, СКОРОСТИ = [1, 2, 3];
let скорость = +(localStorage.getItem('jw.pathspeed') || 3);
if (!СКОРОСТИ.includes(скорость)) скорость = 3;

let сцена = 0, цель = { x: 0, y: 0 }, пауза = false;

/** Собрать сцену номер n и построить по ней маршрут. */
function загрузить(n) {
  сцена = n;
  mem.b.set(снимокРаспакован, 0x30000);
  mem.w32(0x46c, 110);
  // Снимок эталона кладётся в память заново на каждой сцене, а в нём указатели слотов спрайтов
  // и шрифтов лежат со сдвигом +0x100000. Renderer чинит их у себя в конструкторе, но он один
  // на всю страницу — значит, чинить надо здесь, после каждой перезагрузки снимка. Иначе слоты
  // указывают в упакованные данные и вместо юнитов и кустов на карте полосатый мусор.
  fixSlotPointers(mem); fixFontPointers(mem);
  eng = new Engine(mem); eng.files = files;
  rend.eng = eng;
  loadMission(mem, files, МИССИЯ, ПЛЕМЯ, 1);
  цель = собрать(eng, n);
  rend.drawFull();
  показатьКнопки();
  say(`${n + 1}. ${СЦЕНЫ[n].подпись} · режим ${pathMode()}`);
}
// ---- кнопки сцен
const bar = document.getElementById('bar');
СЦЕНЫ.forEach((с, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1}. ${с.имя}`;
  b.onclick = () => загрузить(i);
  bar.appendChild(b);
});
/** Подсветить выбранную сцену и выбранный способ поиска. */
function показатьКнопки() {
  [...bar.children].forEach((b, i) => b.classList.toggle('on', i === сцена));
  document.getElementById('path').textContent = 'path: ' + pathMode();
  document.getElementById('speed').textContent = '×' + скорость;
  document.getElementById('pause').textContent = пауза ? '▶' : '⏸';
}
document.getElementById('path').onclick = () => {
  const i = (MODES.indexOf(pathMode()) + 1) % MODES.length;
  setPathMode(MODES[i]); localStorage.setItem('jw.path', MODES[i]);
  показатьКнопки(); say(`режим поиска пути: ${pathMode()}`);
};
document.getElementById('speed').onclick = () => {
  скорость = СКОРОСТИ[(СКОРОСТИ.indexOf(скорость) + 1) % СКОРОСТИ.length];
  localStorage.setItem('jw.pathspeed', скорость);
  следующий = performance.now();
  показатьКнопки(); say(`скорость ×${скорость}`);
};
document.getElementById('reset').onclick = () => загрузить(сцена);
document.getElementById('pause').onclick = () => { пауза = !пауза; показатьКнопки(); };
document.getElementById('game').onclick = () => { location.href = 'game.html'; };

// ---- приказ: клик по карте уводит туда всех выделенных
cv.addEventListener('pointerdown', (e) => {
  const r = cv.getBoundingClientRect();
  const x = Math.round((e.clientX - r.left) * 640 / r.width);
  const y = Math.round((e.clientY - r.top) * 480 / r.height);
  if (x < 0 || y < 0 || x >= РАЗМЕР.w * 32 || y >= РАЗМЕР.h * 32) return;
  mem.w8(0x31acc, 0x0f);                     // «идти» — разберёт 0x1419e в начале шага
  mem.w32(0x31ad0, 0); mem.w32(0x31ad4, x & ~0x1f); mem.w32(0x31ad8, y & ~0x1f);
  say(`идут в ${x >> 5},${y >> 5} · режим ${pathMode()}`);
});

// ---- кадр
let следующий = performance.now();
/** Кадр стенда: карта, маршрут и числа замера. */
function кадр(t) {
  requestAnimationFrame(кадр);
  if (!пауза) {
    let шагов = 0;
    const шаг = ШАГ / скорость;
    while (t >= следующий && шагов < 4 * скорость) { eng.timer = eng.timer + 1; eng.tick(); следующий += шаг; шагов++; }
    if (шагов === 0 && t > следующий + 400) следующий = t;
  } else следующий = t;
  try { rend.drawTick(); } catch (err) { say('рендер: ' + err.message); }
  fb.pal.set(mem.b.subarray(0x44980, 0x44980 + 768));
  fb.blitTo(img);
  ctx.putImageData(img, 0, 0);
  метка();
}
/** Красное кольцо на цели — чтобы на видео было видно, куда идут. */
function метка() {
  const x = цель.x * 32 + 16, y = цель.y * 32 + 16;
  const t = performance.now() / 600;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(220,40,40,${0.55 + 0.35 * Math.sin(t)})`;
  ctx.beginPath(); ctx.arc(x, y, 13 + 2 * Math.sin(t), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

window.__st = { mem, fb, get eng() { return eng; }, rend, загрузить, get цель() { return цель; } };
setPathMode(new URLSearchParams(location.search).get('path') || localStorage.getItem('jw.path') || 'astar');
// Номер сцены можно дать ссылкой: path.html?s=2 — удобно и для съёмки, и чтобы прислать
// конкретную сцену. Нумерация человеческая, с единицы.
const стартовая = Math.min(Math.max(+(new URLSearchParams(location.search).get('s') || 1), 1), СЦЕНЫ.length) - 1;
загрузить(стартовая);
requestAnimationFrame(кадр);
