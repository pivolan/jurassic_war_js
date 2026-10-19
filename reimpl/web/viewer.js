// Просмотрщик: оригинальный порт рендера (js/render/*) — та же картинка, что в DOS-версии, попиксельно.
import { Mem, G, U, UNITS, BG } from '../js/mem.js'; import { Input } from '../js/input.js'; import { F } from '../js/fn.js'; import { Engine } from '../js/engine.js'; import { loadMission } from '../js/loader.js'; import '../js/modules.browser.js';
import { FrameBuffer } from '../js/render/fb.js'; import { Renderer } from '../js/render/renderer.js';
const hud = document.getElementById('hud'); const cv = document.getElementById('c'); const ctx = cv.getContext('2d');
/** Скачать файл в байты. */
async function fetchU8(u) { const r = await fetch(u); if (!r.ok) throw new Error(u); return new Uint8Array(await r.arrayBuffer()); }
/** Разжать deflate. */
async function inflate(u8) { const ds = new DecompressionStream('deflate'); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
const q = new URLSearchParams(location.search); const mission = +(q.get('m') || 0), tribe = +(q.get('t') || 0);
const files = {}; for (const f of ['_PWAR08.TRC', '_PWAR09.TRC', '_PWAR01.TRC', '_PWAR04.TRS']) files[f] = await fetchU8('../../PWAR/' + f);
const mem = Mem.ofSize(); mem.b.set(await inflate(await fetchU8('../data/boot_snap.bin.z')), 0x30000); mem.w32(0x46c, 110);
let eng; try { eng = loadMission(mem, files, mission, tribe, 1); } catch (e) { hud.textContent = 'loadMission: ' + e.message; eng = new Engine(mem); }
const W = mem.u32(G.mapW), H = mem.u32(G.mapH);
const fb = new FrameBuffer(); const rend = new Renderer(eng, fb, files);        // рисует в буфер оригинала 0x1235f4, затем «флип» в fb.px
const img = ctx.createImageData(640, 480); let firstFrame = true;
let camX = 0, camY = 0, running = false;
/** Нарисовать кадр: первый — целиком, дальше только изменения. */
function draw() {
  try { if (firstFrame) { rend.drawFull(); firstFrame = false; } else rend.drawTick(); }
  catch (e) { hud.textContent = 'рендер: ' + e.message; return; }
  img.data.set(fb.toRGBA()); ctx.putImageData(img, 0, 0);
  hud.textContent = `миссия ${mission} племя ${tribe} карта ${W}x${H} шаг ${mem.u16(G.step)} еда ${mem.u32(G.food)} | ЛКМ/ПКМ/рамка/панель/горячие клавиши как в оригинале | курсор ${mem.u32(0x3034c)} режим ${mem.u16(0x31aca)} приказ ${mem.u8(0x31acc).toString(16)}${eng.todo.size ? ' | не портировано: ' + [...eng.todo].join(' ') : ''}`;
}
/** Один шаг симуляции. */
function step() { eng.timer++; eng.tick(); }
// Режим пальца: «тап» — абсолютные координаты, «тачпад» — относительное ведение курсора. На тач-экране по умолчанию тачпад.
const latchb = document.getElementById('latch'), pmodeb = document.getElementById('pmode'), phint = document.getElementById('phint');
let padMode = (localStorage.getItem('jw.pmode') ?? (matchMedia('(pointer: coarse)').matches ? 'pad' : 'tap')) === 'pad';
/** Ввод просмотрщика: та же обвязка, что и в игре. */
const input = new Input(mem); input.attach(cv, { pad: padMode, onButton: b => markButton(b), onLatch: on => latchb.classList.toggle('on', on) });   // события браузера → кольца мыши/клавиатуры оригинала
/** Такт интерфейса: мышь, прокрутка, клавиши, форма курсора — как в главном цикле. */
function ui() { F[0x1133c](eng); F[0x12acd](eng); F[0x10d44](eng); F[0x12be6](eng); }   // как в главном цикле: мышь, прокрутка, клавиши, курсор
setInterval(() => { ui(); camX = mem.u32(0x31ae8); camY = mem.u32(0x31aec); draw(); }, 40);
setInterval(() => { if (running) { step(); draw(); } }, 55);

// ---- экранные кнопки: то же, что физическая клавиатура и мышь, но доступно на планшете/телефоне
function markButton(b) { for (const el of document.querySelectorAll('[data-mb]')) el.classList.toggle('on', +el.dataset.mb === b); }
markButton(0);
for (const el of document.querySelectorAll('[data-mb]')) el.onclick = () => { input.touchButton = +el.dataset.mb; markButton(input.touchButton); };
/** Подпись кнопки режима пальца (тап или тачпад). */
function markMode() {                                                                     // подпись жестов меняется вместе с режимом
  pmodeb.textContent = padMode ? 'тачпад' : 'тап'; pmodeb.classList.toggle('on', padMode); latchb.hidden = !padMode;
  phint.textContent = padMode ? 'веди пальцем — курсор · тап — клик · двойной тап с удержанием или «зажать» — рамка · долгое — другая кнопка'
                              : 'тап = клик в точку · долгое нажатие = другая кнопка'; }
pmodeb.onclick = () => { padMode = !padMode; localStorage.setItem('jw.pmode', padMode ? 'pad' : 'tap'); input.setPad(padMode); markMode(); };
latchb.onclick = () => input.setLatch(!latchb.classList.contains('on'));
markMode();
for (const el of document.querySelectorAll('[data-mod]')) el.onclick = () => {           // модификаторы залипающие: нужны для Ctrl+цифра, Shift+клик
  const on = !el.classList.contains('on'); el.classList.toggle('on', on); input.holdKey(el.dataset.mod, on); };
for (const el of document.querySelectorAll('[data-key]')) {                               // остальные клавиши — нажатие с удержанием (стрелки прокручивают, пока держишь)
  let t0 = 0;
  const down = e => { e.preventDefault(); el.classList.add('on'); t0 = Date.now(); input.holdKey(el.dataset.key, true); };
  const up = () => { if (!t0) return; const wait = Math.max(0, 120 - (Date.now() - t0)); t0 = 0;   // короткий тап удерживаем ~3 кадра, иначе игра не увидит фронт
    setTimeout(() => { input.holdKey(el.dataset.key, false); el.classList.remove('on'); }, wait); };
  el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
}
const runb = document.getElementById('run');
runb.onclick = () => { running = !running; runb.textContent = running ? '⏸ стоп' : '▶ пуск'; runb.classList.toggle('on', running); };
document.getElementById('stepb').onclick = () => { step(); draw(); };
document.getElementById('fs').onclick = () => {                 // с приставкой webkit — ради Safari
  const э = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (э.requestFullscreen || э.webkitRequestFullscreen)?.call(э);
};
document.getElementById('toggle').onclick = () => document.body.classList.toggle('hidebar');
addEventListener('keydown', e => { if (e.code === 'Pause' || (e.code === 'Space' && e.ctrlKey)) runb.click(); });   // пуск/стоп симуляции просмотрщика
// Растягиваем канву под свободное место, сохраняя 4:3 (апскейл пиксельный, координаты пересчитываются по факту).
function fit() { const st = document.getElementById('stage'); const pad = 10;
  const k = Math.min((st.clientWidth - pad) / 640, (st.clientHeight - pad) / 480);
  cv.style.width = Math.max(160, Math.floor(640 * k)) + 'px'; cv.style.height = Math.max(120, Math.floor(480 * k)) + 'px'; }
fit(); addEventListener('resize', fit); addEventListener('orientationchange', fit);
new ResizeObserver(fit).observe(document.getElementById('stage'));
window.__jw = { mem, eng, input, F, draw, step, fit, fb, rend };   // отладочный доступ из консоли и автотестов
cv.focus();
draw();
