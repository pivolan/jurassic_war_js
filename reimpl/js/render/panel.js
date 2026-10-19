// Боковая панель (x 512..639): фон/кнопки/иконки/полосы. Логика состояния панели (0x26671/0x2673d/0x2698e/0x26a5d/0x26b34/0x26c4f/0x26d29/0x26d8c/0x2693c/0x2696a/0x26dfd)
// портирована в js/port/input.js и вызывает блиттеры через opt(); здесь — сами блиттеры 0x1f720/0x1f79f, обёртки 0x2661c/0x2665d/0x26e23/0x26e38/0x26e4d/0x26e62,
// полосы статов 0x26e77 (0x2700c/0x27188; подписи шрифтом 0x29c38 — не портированы), цель 0x26c0a. Всё рисуется в закадровый буфер оригинала 0x1235f4 через eng.m.
import { F, call } from '../fn.js'; import { U, UNITS } from '../mem.js'; import { FB, ROWS, SLOTS, XBASE, шаг, ряды } from './scene.js';
import { сПанельнойБазой } from './scene.js';
const LUT_SHADOW = 0x44f80, TEAM = 0x488e8, UIFL = 0x31ae0, SEL = 0x31adc, PAGE = 0x31ae4, STATFL = 0x31ac7;
/** Поставить реализацию, если по этому адресу ещё никто ничего не поставил. */
const stub = (a, f) => { if (!F[a]) F[a] = f; }; // claims заняты другим агентом (input), но не реализованы — регистрируем, если никто не сделал

// ---- 0x1f720: спрайт eax в (edx,ebx) без отсечения; 1 → тень (LUT по фону), 0xc0..0xc3 → +[0x488e8] (командный цвет)
F[0x1f720] = (eng, r) => сПанельнойБазой(eng.m, () => {
  const m = eng.m, b = m.b; const e = SLOTS + r.eax * 16; const w = m.u16(e + 4), h = m.u16(e + 6); m.w32(0x488d4, w); m.w32(0x488d8, h); let src = m.u32(e);
  const x = (r.edx | 0) + m.i16(e + 8); let y = (r.ebx | 0) + m.i16(e + 0xa); const base = m.u32(XBASE), team = b[TEAM];
  for (let row = 0; row < h; row++, y++) { const d = (base + m.u32(ряды(m) + y * 4) + x) >>> 0; for (let k = 0; k < w; k++) { let p = b[src++]; if (!p) continue; if (p === 1) p = b[LUT_SHADOW + b[d + k]]; else if (p >= 0xc0 && p < 0xc4) p = (p + team) & 0xff; b[d + k] = p; } }
});
// ---- 0x1f79f: то же, но каждый пиксель спрайта (после командного цвета) затемняется через LUT (недоступная кнопка)
F[0x1f79f] = (eng, r) => сПанельнойБазой(eng.m, () => {
  const m = eng.m, b = m.b; const e = SLOTS + r.eax * 16; const w = m.u16(e + 4), h = m.u16(e + 6); m.w32(0x488d4, w); m.w32(0x488d8, h); let src = m.u32(e);
  const x = (r.edx | 0) + m.i16(e + 8); let y = (r.ebx | 0) + m.i16(e + 0xa); const base = m.u32(XBASE), team = b[TEAM];
  for (let row = 0; row < h; row++, y++) { const d = (base + m.u32(ряды(m) + y * 4) + x) >>> 0; for (let k = 0; k < w; k++) { let p = b[src++]; if (!p) continue; if (p >= 0xc0 && p < 0xc4) p = (p + team) & 0xff; b[d + k] = b[LUT_SHADOW + p]; } }
});

// ---- обёртки: фон панели 0xb17 (512,0); вкладки 0xb1b/0xb1c (512,446); кнопка MENU 0xb27/0xb28 (616,456)
const spr = (slot, x, y) => (eng) => { call(eng, 0x1f815, { eax: slot, edx: x, ebx: y }); };
/**
 * Достелить панель вниз. Фон панели — спрайт 128×480, а кадр у широкого окна (js/render/wide.js)
 * выше 480 строк, и под панелью оставалась чёрная плешь. Повторяем нижнюю строку фона до низа
 * кадра: рисунок панели там уже кончился, и получается ровная полоса её же цвета.
 */
function достелить(eng) {
  const m = eng.m, b = m.b; const в = m.u32(0x6483c8) || 480; if (в <= 480) return;
  const база = m.u32(XBASE), ш = шаг(m), x0 = ш - 128;                // панель прижата к правому краю
  const из = (база + m.u32(ряды(m) + 479 * 4) + x0) >>> 0;
  for (let y = 480; y < в; y++) b.copyWithin((база + m.u32(ряды(m) + y * 4) + x0) >>> 0, из, из + 128);
}
stub(0x2665d, (eng) => { spr(0xb17, 0x200, 0)(eng); достелить(eng); }); stub(0x26e23, spr(0xb1b, 0x200, 0x1be)); stub(0x26e38, spr(0xb1c, 0x200, 0x1be)); stub(0x26e4d, spr(0xb27, 0x268, 0x1c8)); stub(0x26e62, spr(0xb28, 0x268, 0x1c8));
stub(0x26a5c, () => {});
stub(0x2661c, (eng) => { // полная перерисовка панели (старт миссии, смена режима 0x26510)
  const m = eng.m; if (!(m.u8(UIFL) & 1)) return; call(eng, 0x2665d); const s = m.u32(SEL);
  if (m.u8(UNITS + s + U.TYPE) < 0x1a) { call(eng, 0x26671, { esi: s }); call(eng, 0x2673d, { esi: s }); call(eng, 0x2698e); call(eng, 0x26a5c); } else call(eng, 0x26a5d, { esi: s });
  call(eng, 0x26e23);
});

// ---- полосы статов 0x2700c (текущее dl / максимум dh) и 0x27188 (одно значение dl): рамка 50×10 цветом 0x1f в ([0x424d0],[0x424d8]),
// заполнение 8 строк: (v>>3)+(v>>4) пикселей цветом 0x19, до максимума — 0x11, остаток до 48 — затемнение фона через LUT
function barFrame(m, x, y) { const b = m.b; const ш = шаг(m); const d = (m.u32(XBASE) + m.u32(ряды(m) + y * 4) + x) >>> 0; for (let i = 0; i < 0x32; i++) { b[d + i] = 0x1f; b[d + i + 9 * ш] = 0x1f; } for (let r = 1; r <= 8; r++) { b[d + r * ш] = 0x1f; b[d + r * ш + 0x31] = 0x1f; } return d + ш + 1; }
/** Длина полоски в пикселях по значению 0..255. */
const len = v => ((v >> 3) + (v >> 4)) & 0xff;
/** Залить n столбцов высотой 8 цветом col. */
function fill(b, d, n, col, ш) { for (let i = 0; i < n; i++, d++) for (let r = 0; r < 8; r++) b[d + r * ш] = col; return d; }
/** Затемнить n столбцов высотой 8 через таблицу теней. */
function dark(b, d, n, ш) { for (let i = 0; i < n; i++, d++) for (let r = 0; r < 8; r++) b[d + r * ш] = b[LUT_SHADOW + b[d + r * ш]]; }
F[0x2700c] = (eng, r) => сПанельнойБазой(eng.m, () => { const m = eng.m, b = m.b, ш = шаг(m); let d = barFrame(m, m.u32(0x424d0), m.u32(0x424d8)); const cur = len(r.edx & 0xff), mx = len((r.edx >> 8) & 0xff);
  d = fill(b, d, cur, 0x19, ш); const rest = (mx - cur) & 0xff; d = fill(b, d, rest, 0x11, ш); const n = (0x30 - mx) & 0xff; if (mx < 0x30) dark(b, d, n, ш); });
F[0x27188] = (eng, r) => сПанельнойБазой(eng.m, () => { const m = eng.m, b = m.b, ш = шаг(m); let d = barFrame(m, m.u32(0x424d0), m.u32(0x424d8)); const cur = len(r.edx & 0xff);
  d = fill(b, d, cur, 0x19, ш); if (cur < 0x30) dark(b, d, (0x30 - cur) & 0xff, ш); });
/** Позвать функцию оригинала, если она есть. */
const opt = (eng, a, regs) => (F[a] ? F[a](eng, regs || {}) : {}) || {};
/** Подпись слева от полоски статов. */
const label = (eng, str) => сПанельнойБазой(eng.m, () => { const m = eng.m; m.w32(0x47004, (m.u32(0x424d0) - 0x12) >>> 0); m.w32(0x47008, m.u32(0x424d8)); opt(eng, 0x29c38, { esi: str }); });
F[0x26e77] = (eng) => { // статы выделенного юнита по битам [0x31ac7]: 0x10 HP/HPmax, 8 OP, 4 DP, 2 MP/MPmax, 1 VP; подписи 0x427bc.. шрифтом (опц.)
  const m = eng.m; const fl = m.u8(STATFL); const s = m.u32(SEL); if (!fl || !s || m.u8(UNITS + s + U.TYPE) >= 0x1a) return;
  const saveCol = m.u32(0x47020); opt(eng, 0x29bbd, { eax: 0 }); m.w32(0x424d8, m.u32(0x424d4));
  const bar2 = (cur, mx, str) => { call(eng, 0x2700c, { edx: (mx << 8) | cur }); label(eng, str); m.w32(0x424d8, m.u32(0x424d8) + 0xc); };
  const bar1 = (cur, str) => { call(eng, 0x27188, { edx: cur }); label(eng, str); m.w32(0x424d8, m.u32(0x424d8) + 0xc); };
  const u = UNITS + s;
  if (fl & 0x10) bar2(m.u8(u + 0x0e), m.u8(u + 0x0c), 0x427bc);
  if (fl & 8) bar1(m.u8(u + 0x0f), 0x427bf);
  if (fl & 4) bar1(m.u8(u + 0x10), 0x427c2);
  if (fl & 2) bar2(m.u8(u + 0x11), m.u8(u + 0x0d), 0x427c5);
  if (fl & 1) bar1(m.u8(u + 0x12), 0x427c8);
  opt(eng, 0x29bbd, { eax: saveCol });
};

// ---- 0x26c0a: подсказка/цель на странице здания — перерисовать 0x26c4f при смене [0x30384]
F[0x26c0a] = (eng) => { const m = eng.m; if (!(m.u8(UIFL) & 1) || m.u32(PAGE) === 0) return; const s = m.u32(SEL);
  if (m.u8(UNITS + s + 0x50) & 1) m.w32(0x30384, (m.u32(UNITS + s + 0x33) + 1) >>> 0);
  if (m.u32(0x30380) !== m.u32(0x30384)) { m.w32(0x30380, m.u32(0x30384)); call(eng, 0x26c4f); } };

// ---- последовательности HUD (0x23eb1 полная сцена, блок рендера в 0x17e1c)
export function panelPreTick(eng) { const m = eng.m; const s = m.u32(SEL); if (!s) return; call(eng, 0x26a5c); const t = m.u8(UNITS + s + U.TYPE); if (t > 4 && t < 9) call(eng, 0x2673d, { esi: s }); }
/** Панель поверх сцены: статы, мини-карта, кнопки — в том же порядке, что и в оригинале. */
export function hudAfterScene(eng, full) { const m = eng.m; for (const f of [0x26e77, 0x2572f, 0x24843, 0x26c0a]) call(eng, f, {}); // порядок оригинала; тексты — js/render/text.js
  if (full || !(m.u8(UIFL) & 1)) call(eng, m.u8(0x303ac) === 1 ? 0x26e62 : 0x26e4d);
  if (full) достелить(eng); }                                        // полоса под панелью в высоком кадре
