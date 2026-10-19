// Рендер сцены — построчный порт pwar.exe (кадровый буфер 0x1235f4, 640 байт/строка, таблица строк 0x122e74,
// вьюпорт [0x488c4]x[0x488c8], база вывода [0x488c0]). Все функции читают/пишут только память оригинала.
import { F, call } from '../fn.js'; import { G, U, UNITS, BG, BI, ITEMS, PROJ, ХВОСТ } from '../mem.js';
export const FB = 0x1235f4, ROWS = 0x122e74, SLOTS = 0x16e5f4, CAMX = 0x31ae8, CAMY = 0x31aec, VW = 0x488c4, VH = 0x488c8, XBASE = 0x488c0;
// Байт на строку кадра. В оригинале это всегда 640, и по коду число стояло зашитым в десятке
// мест. Но и «база вывода» (0x488c0 для спрайтов, 0x46f00 для тайлов), и таблица смещений строк
// (0x122e74) — обычные переменные памяти, которые движок честно читает. Значит кадр можно
// перенести и сделать шире, если шаг брать оттуда же, а не из константы. Берём его как разницу
// смещений первой и нулевой строки — так он всегда согласован с самой таблицей.
// Адрес действующей таблицы строк. Родная (0x122e74) вмещает ровно 480 записей — сразу за ней
// начинается сам кадр, — поэтому для широкого окна таблица своя, в хвосте памяти. Здесь лежит
// указатель на ту, что сейчас в деле; ноль означает «родная».
export const УК_РЯДЫ = ХВОСТ;
export const УК_ШИРИНА = ХВОСТ + 4;                 // ширина действующего кадра (0 — родной 640)
const БУФЕР_ТЕКСТА = 0x46f10;                       // куда пишет шрифт игры (js/render/text.js)
export const ряды = (m) => m.u32(УК_РЯДЫ) || ROWS;
/**
 * Выполнить `fn` со сдвинутой базой вывода — так рисуется всё, что принадлежит боковой панели.
 * Её координаты в оригинале абсолютные и посчитаны от кадра шириной 640 (панель занимает
 * 512..639). Сдвиг базы на «ширина − 640» кладёт ту же картинку к правому краю широкого кадра,
 * и ни одной координаты в коде панели менять не надо. В родном кадре сдвиг нулевой.
 * Сдвигаем и базу спрайтов, и буфер шрифта: подписи в панели пишутся теми же координатами.
 */
// Сетка «кто в какой клетке» для слоя юнитов (0x24d70). В оригинале она фиксированная: 24×23
// клетки и четыре массива по 552 записи — этого хватало на окно 512×480 с запасом. Для широкого
// кадра клеток нужно вчетверо больше, поэтому массивы свои, в хвосте памяти сразу за кадром.
const МАКС_Ш_КАДРА = 2560, МАКС_В_КАДРА = 1600;
const СЕТКА = ХВОСТ + 0x40 + МАКС_В_КАДРА * 4 + МАКС_Ш_КАДРА * МАКС_В_КАДРА;
export function сеткаЮнитов(m) {
  const ш = m.u32(УК_ШИРИНА);
  if (!ш || ш === 640) return { a: 0x3eb20, b: 0x3f3c0, c: 0x3fc60, укр: 0x40500, кX: 0x18, кY: 0x17, шагРяда: 0x60 };
  const кX = (ш + 256) >> 5, кY = ((m.u32(ХВОСТ + 8) + 256) >> 5);
  const всего = кX * кY * 4;
  return { a: СЕТКА, b: СЕТКА + всего, c: СЕТКА + всего * 2, укр: СЕТКА + всего * 3, кX, кY, шагРяда: кX * 4 };
}

export function сПанельнойБазой(m, fn) {
  const ш = m.u32(УК_ШИРИНА);
  if (!ш || ш === 640) return fn();
  const Δ = ш - 640, б1 = m.u32(XBASE), б2 = m.u32(БУФЕР_ТЕКСТА);
  m.w32(XBASE, б1 + Δ); m.w32(БУФЕР_ТЕКСТА, б2 + Δ);
  try { return fn(); } finally { m.w32(XBASE, б1); m.w32(БУФЕР_ТЕКСТА, б2); }
}
export const шаг = (m) => { const р = ряды(m); return (m.u32(р + 4) - m.u32(р)) >>> 0; };
const TILES = 0x49b2c, LUT_SHADOW = 0x44f80, LUT_GLASS = 0x38210;
/** 16- и 8-битные со знаком: смещения спрайтов в таблицах хранятся знаковыми. */
const s16 = v => (v << 16) >> 16, s8 = v => (v << 24) >> 24;
// ---- спрайты: таблица слотов (16 байт: ptr, w, h, hx, hy, hx2, hy2); указатели в снимках эталона сдвинуты на +0x100000
export function fixSlotPointers(m) { const n = m.u32(0x48870); for (let s = 0; s < n && s < 0xb6e; s++) { const p = m.u32(SLOTS + s * 16); if (p >= 0x110000 && p < 0x7483c0) m.w32(SLOTS + s * 16, p - 0x100000); } }
// Общая часть отсечения: возвращает null, если спрайт вне вьюпорта (cl=1), иначе параметры.
function clip(m, slot, x, y, mirrored, fixedVW) {
  const e = SLOTS + slot * 16; const W = fixedVW ? 640 : m.i32(VW), H = fixedVW ? 480 : m.i32(VH);
  const hx = m.i16(e + (mirrored ? 0xc : 8)), hy = m.i16(e + (mirrored ? 0xe : 0xa)); const w = m.u16(e + 4), h = m.u16(e + 6);
  let cx = (x + hx) | 0; if (cx >= W) return null; let lclip = 0; if (cx < 0) { lclip = -cx; cx = 0; }
  let cy = (y + hy) | 0; if (cy >= H) return null; let tclip = 0; if (cy < 0) { tclip = -cy; cy = 0; }
  let vis = w; let t = (cx + w) | 0; if (t < 0) return null; let rclip = 0; if (t > W) { rclip = t - W; vis -= rclip; }   // sub edx,W; jbe → (cx+w) <= W ok (беззнаково; отрицательное cx+w отсечено выше)
  vis -= lclip; if (vis <= 0) return null;
  let vh = h; let b = (cy + h) | 0; if (b < 0) return null; if (b > H) vh -= (b - H); vh -= tclip; if (vh <= 0) return null;
  m.w32(0x488cc, cx); m.w32(0x488dc, lclip); m.w32(0x488d0, cy); m.w32(0x488e0, tclip); m.w32(0x488e4, rclip); m.w32(0x488d4, vis); m.w32(0x488d8, vh);
  return { src: (w * tclip + m.u32(e)) >>> 0, cx, cy, lclip, rclip, vis, vh };
}
/**
 * Вывести спрайт из слота в кадровый буфер. mode: 0 обычный с тенью, 1 силуэт, 2 с цветом
 * племени, 3 без тени, 4 «стекло». Возвращает cl — попал ли спрайт в кадр.
 */
// ПЫЛЬ (наше, владелец 05.10.2026: «тени ведь рисуются прозрачными — нельзя что-то подобное для пыли?»).
// Индекс 64 в спрайтах игры не встречается ни разу (замер по _PWAR04.TRS). В наших кадрах он значит «пыль»:
// как тень (индекс 1 → таблица затемнения 0x44f80), только светлее — цвет земли под пикселем смешивается с
// песочным пополам и берётся ближайший цвет палитры. Таблица строится из текущей палитры (0x44980) и
// пересчитывается, если палитра сменилась (другая карта). Симуляцию не трогает — только картинка.
const ПЫЛЬ = 64, ПЕСОК = [200, 180, 140], ДОЛЯ_ПЫЛИ = 0.55;
let _лут = null, _подпись = -1;
function лутПыли(m) {
  const b = m.b; let п = 0; for (let i = 0; i < 768; i += 37) п = (п * 31 + b[0x44980 + i]) >>> 0;
  if (_лут && п === _подпись) return _лут;
  _подпись = п; _лут = new Uint8Array(256);
  const P = b.subarray(0x44980, 0x44980 + 768);
  for (let c = 0; c < 256; c++) {
    const r = P[c * 3] * (1 - ДОЛЯ_ПЫЛИ) + ПЕСОК[0] * ДОЛЯ_ПЫЛИ, g = P[c * 3 + 1] * (1 - ДОЛЯ_ПЫЛИ) + ПЕСОК[1] * ДОЛЯ_ПЫЛИ, bb = P[c * 3 + 2] * (1 - ДОЛЯ_ПЫЛИ) + ПЕСОК[2] * ДОЛЯ_ПЫЛИ;
    let лучший = c, мин = 1e9;
    for (let k = 2; k < 256; k++) { if (k === ПЫЛЬ || (k >= 0xc0 && k < 0xe0)) continue;
      const dr = P[k * 3] - r, dg = P[k * 3 + 1] - g, db = P[k * 3 + 2] - bb, e = dr * dr + dg * dg + db * db; if (e < мин) { мин = e; лучший = k; } }
    _лут[c] = лучший;
  }
  return _лут;
}
function blit(m, slot, x, y, mode, mirrored, fixedVW) {
  // mode: 0 copy+shadow(1→LUT), 1 silhouette [0x488e9] (1→1), 2 team colors (0xc0..0xc3 += [0x488e8]) + shadow, 3 plain copy (0 transparent), 4 glass LUT 0x38210
  const c = clip(m, slot, x, y, mirrored, fixedVW); if (!c) return 1;
  const b = m.b; let src = c.src; const base = m.u32(XBASE); const sil = b[0x488e9], team = b[0x488e8];
  for (let row = 0; row < c.vh; row++) {
    const y2 = c.cy + row; let d = (base + m.u32(ряды(m) + y2 * 4) + c.cx) >>> 0;
    if (!mirrored) { src += c.lclip; } else { src += c.rclip; d += c.vis - 1; }
    for (let k = 0; k < c.vis; k++) {
      const p = b[src++]; let v = p;
      if (p !== 0) {
        if (mode === 0) { if (p === 1) v = b[LUT_SHADOW + b[d]]; else if (p === ПЫЛЬ) v = лутПыли(m)[b[d]]; }
        else if (mode === 1) { if (p !== 1) v = sil; }
        else if (mode === 2) { if (p === 1) v = b[LUT_SHADOW + b[d]]; else if (p === ПЫЛЬ) v = лутПыли(m)[b[d]]; else if (p >= 0xc0 && p < 0xc4) v = (p + team) & 0xff; }
        else if (mode === 4) { v = b[LUT_GLASS + (((p - 0xb) & 0xff) << 8) + b[d]]; }
        b[d] = v;
      }
      if (!mirrored) d++; else d--;
    }
    if (!mirrored) src += c.rclip; else src += c.lclip;
  }
  return 0;
}
/** Заглушка-переходник: вернуть регистры как есть. */
const R = (eng, r) => r; // helper
F[0x2c1df] = (eng, r) => ({ cl: blit(eng.m, r.eax, s32(r.edx), s32(r.ebx), 0, false) });
F[0x2c320] = (eng, r) => ({ cl: blit(eng.m, r.eax, s32(r.edx), s32(r.ebx), 1, false) });
F[0x2c460] = (eng, r) => ({ cl: blit(eng.m, r.eax, s32(r.edx), s32(r.ebx), 2, false) });
F[0x2c5b5] = (eng, r) => ({ cl: blit(eng.m, r.eax, s32(r.edx), s32(r.ebx), 3, false, true) });
F[0x2c6e7] = (eng, r) => ({ cl: blit(eng.m, r.eax, s32(r.edx), s32(r.ebx), 0, true) });
F[0x2c82f] = (eng, r) => ({ cl: blit(eng.m, r.eax, s32(r.edx), s32(r.ebx), 1, true) });
F[0x2c970] = (eng, r) => ({ cl: blit(eng.m, r.eax, s32(r.edx), s32(r.ebx), 2, true) });
F[0x1f875] = (eng, r) => ({ cl: blit(eng.m, r.eax, s32(r.edx), s32(r.ebx), 4, false) });
/** 32-битное со знаком. */
function s32(v) { return v | 0; }
F[0x1f815] = (eng, r) => сПанельнойБазой(eng.m, () => { // без отсечения: спрайт eax в (edx,ebx) — панельный блиттер
  const m = eng.m, b = m.b; const e = SLOTS + r.eax * 16; const w = m.u16(e + 4), h = m.u16(e + 6); let src = m.u32(e); const x = (r.edx | 0) + m.i16(e + 8); let y = (r.ebx | 0) + m.i16(e + 0xa); const base = m.u32(XBASE);
  for (let row = 0; row < h; row++, y++) { const d = (base + m.u32(ряды(m) + y * 4) + x) >>> 0; for (let k = 0; k < w; k++) { const p = b[src++]; if (p) b[d + k] = p; } }
});
const BLIT4 = [0x2c970, 0x2c460, 0x2c82f, 0x2c320];   // таблица 0x3eb00: [пара(+0x43&1)<<1 | (dir<6)]
/** Спрайт юнита с учётом зеркала по направлению и пометки «подсвечен». */
function unitBlit(eng, i, slot, x, y) { const m = eng.m; const idx = ((m.u8(UNITS + i + U.FX43) & 1) << 1) | (m.u8(UNITS + i + U.DIR) < 6 ? 1 : 0); return call(eng, BLIT4[idx], { eax: slot, edx: x, ebx: y }).cl; }
// ---- точка/прямоугольник (0x23ef9 / 0x23f18), цвет al
function plot(m, x, y, col) { if ((x >>> 0) < m.u32(VW) && (y >>> 0) < m.u32(VH)) m.b[m.u32(XBASE) + m.u32(ряды(m) + y * 4) + x] = col; }
F[0x23ef9] = (eng, r) => { plot(eng.m, r.edx | 0, r.ebx | 0, r.eax & 0xff); };
/** Прямоугольник цветом col (0x23f18). */
function rect(m, x, y, w, h, col) { // 0x23f18: edx=x ebx=y ecx=w esi=h
  let hh = h - 1; for (let k = 0; k < w; k++) { plot(m, x + k, y, col); plot(m, x + k, y + hh, col); }
  let ww = w - 1; for (let k = 0; k < h; k++) { plot(m, x, y + k, col); plot(m, x + ww, y + k, col); }
}
F[0x23f18] = (eng, r) => { rect(eng.m, r.edx | 0, r.ebx | 0, r.ecx | 0, r.esi | 0, r.eax & 0xff); };
// ---- рамка выделения + полоса HP (0x23f44), esi=юнит
F[0x23f44] = (eng, r) => {
  const m = eng.m, b = m.b, i = r.esi; if (!(m.u8(UNITS + i + U.F07) & 0x80)) return;
  const owner = m.u8(UNITS + i + U.OWNER); let col; if (m.u8(G.humanOwner) === owner && m.u32(0x31adc) === i) col = 0xfc; else col = b[0x3054d + owner];
  b[0x3d1b5] = 4; let sh = m.u32(0x3d1b8 + m.u8(UNITS + i + U.TYPE) * 4);
  const x = m.u16(UNITS + i + U.X) - m.u32(CAMX), y = m.u16(UNITS + i + U.Y) - m.u32(CAMY); const W = m.u32(VW), H = m.u32(VH);
  for (let c = 0; c < 4; c++, sh += 0x18) {   // 0x18 = две записи по 12 байт на угол (в оригинале add ebp,0xc дважды за итерацию)
    let yy = (y + m.i32(sh + 4)) | 0; if ((yy >>> 0) < H) { let xx = (x + m.i32(sh)) | 0; let n = m.i32(sh + 8); const ro = m.u32(ряды(m) + yy * 4), б = m.u32(XBASE); for (; n !== 0; n--, xx++) if ((xx >>> 0) < W) b[б + ro + xx] = col; }
    let xx2 = (x + m.i32(sh + 0xc)) | 0; if ((xx2 >>> 0) < W) { let yy2 = (y + m.i32(sh + 0x10)) | 0; let n = m.i32(sh + 0x14); const б2 = m.u32(XBASE); for (; n !== 0; n--, yy2++) if ((yy2 >>> 0) < H) b[б2 + m.u32(ряды(m) + yy2 * 4) + xx2] = col; }
    b[0x3d1b5]--;
  }
  const rx = (x + m.i32(sh)) | 0, ry = (y + m.i32(sh + 4)) | 0; rect(m, rx, ry, m.i32(sh + 8), m.i32(sh + 0xc), col);
  // Заливка полоски здоровья. В оригинале тут стоял предел в 480 строк — высота экрана VGA. У нас
  // кадр бывает выше (широкое окно карты), и у юнита внизу рамка рисовалась, а заливка молча
  // пропускалась: получался пустой квадратик над выделенным (жалоба владельца со снимком).
  // Сравниваем с настоящей высотой кадра; отдельные строки ниже края и так отсекает проверка
  // `by + k < H` в самом цикле.
  const by = ry + 1; if ((by >>> 0) >= m.u32(VH)) return; const hpmax = m.u8(UNITS + i + U.HPMAX); if (hpmax === 0) return;
  let len = (((m.i32(sh + 8) - 2) & 0xffff) * m.u8(UNITS + i + U.HP)) & 0xffff; len = (Math.floor(len / hpmax)) & 0xff; if (len === 0) return;
  const hcol = b[0x3e3d8 + m.u8(UNITS + i + U.HP)]; const ro = m.u32(ряды(m) + by * 4); let xx = rx;
  const ш = шаг(m), база = m.u32(XBASE);
  for (; len !== 0; len--) { xx++; if (W <= (xx >>> 0)) break; for (let k = 0; k < 4; k++) if ((by + k) >>> 0 < H) b[база + ro + k * ш + xx] = hcol; }
};
// ---- слои сцены
F[0x242d4] = (eng) => { // тайлы
  const m = eng.m, b = m.b; const camX = m.u32(CAMX), camY = m.u32(CAMY); const tw = m.u32(0x31af0), th = m.u32(0x31af4); const fb = m.u32(0x46f00);
  const ш = шаг(m);
  let bgRow = (camY * 0x10 + (camX >> 4)) >>> 0;
  for (let ty = 0; ty < th; ty++, bgRow += 0x200) {
    let bg = bgRow; for (let tx = 0; tx < tw; tx++, bg += 2) {
      const src = TILES + (m.u16(BG + bg) & 0x7ff) * 0x400; const dst = fb + m.u32(ряды(m) + ty * 32 * 4) + tx * 32;
      for (let row = 0; row < 32; row++) b.copyWithin(dst + row * ш, src + row * 32, src + row * 32 + 32);
    }
  }
};
/** Код кромки тумана в клетке: по соседям решается, каким куском её закрыть. */
function fogCode(m, esi) { const b = m.b; if (b[BI + esi] & 1) return 0xf; let v = 0; if (esi !== 0 && (b[BI + esi - 1] & 1)) v = 8; if (esi < 0xafff && (b[BI + esi + 1] & 1)) v += 2; if (esi >= 0x100 && (b[BI + esi - 0x100] & 1)) v += 1; if (esi < 0xaf00 && (b[BI + esi + 0x100] & 1)) v += 4; return v; }
F[0x24446] = (eng, r) => ({ eax: fogCode(eng.m, r.esi) });
F[0x2438e] = (eng) => { // туман: OR тайлов 0..14 по коду
  const m = eng.m, b = m.b; const camX = m.u32(CAMX), camY = m.u32(CAMY); const tw = m.u32(0x31af0), th = m.u32(0x31af4); const fb = m.u32(0x46f00);
  const ш = шаг(m);
  let esi = ((camX >>> 5) + camY * 8) >>> 0;
  for (let ty = 0; ty < th; ty++, esi += 0x100) {
    let e = esi; for (let tx = 0; tx < tw; tx++, e++) {
      const code = fogCode(m, e); if (code === 0xf) continue; const src = TILES + (code << 10); const dst = fb + m.u32(ряды(m) + ty * 32 * 4) + tx * 32;
      for (let row = 0; row < 32; row++) { const d = dst + row * ш, s = src + row * 32; for (let k = 0; k < 32; k++) b[d + k] |= b[s + k]; }
    }
  }
};
F[0x26498] = (eng) => { // объекты на земле
  const m = eng.m; const camX = m.u32(CAMX), camY = m.u32(CAMY);
  for (let i = m.u32(0x31b7c); i !== 0; i = m.u32(ITEMS + i + 0xc)) {
    let spr = m.u8(ITEMS + i) + 0x9de; const x = (m.u8(ITEMS + i + 1) << 5) - camX, y = (m.u8(ITEMS + i + 2) << 5) - camY;
    if (spr === 0x9fc) { const amt = m.u16(ITEMS + i + 6); spr = amt >= 0xbb8 ? 0x9fe : amt >= 0x1f4 ? 0x9fc : 0x9fd; }
    call(eng, 0x2c1df, { eax: spr, edx: x, ebx: y });
  }
};
F[0x240c0] = (eng) => { // рамка выделения при протяжке
  const m = eng.m; if (m.u8(0x3034a) < 2) return; let x0 = m.i32(0x30358), y0 = m.i32(0x3035c), x1 = m.i32(0x45098), y1 = m.i32(0x4509c);
  if ((x1 >>> 0) < (x0 >>> 0)) [x0, x1] = [x1, x0]; if ((y1 >>> 0) < (y0 >>> 0)) [y0, y1] = [y1, y0]; rect(m, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0xfc);
};
F[0x240fb] = (eng) => { const m = eng.m; const n = m.u32(0x30370); if (n >= 9) return; const x = m.i32(0x30374) - m.u32(CAMX), y = m.i32(0x30378) - m.u32(CAMY); m.w32(0x30370, n + 1); call(eng, 0x2c1df, { eax: n + 0xaee, edx: x, ebx: y }); };
// ---- обработчики отрисовки юнитов по типу (таблица 0x250b0)
const UNIT_DRAW = t => t === 0 ? 0x25150 : t < 9 ? 0x25151 : t < 24 ? 0x2540a : t < 26 ? 0x254b6 : 0x2550f;   // граница по таблице 0x250b0: 1..8 → 0x25151, 9..23 → 0x2540a
F[0x25150] = () => {};
/** Пометить юнита «нарисован в этом кадре»: по этому биту звуки решают, слышно ли его. */
function afterBlit(eng, i, cl) { const m = eng.m; m.w8(UNITS + i + 0x42, (m.u8(UNITS + i + 0x42) & 0xfe) | cl); return cl; }
F[0x25151] = (eng, r) => { // люди и ручные динозавры
  const m = eng.m, b = m.b, i = r.esi; m.w32(0x41640, i); b[0x488e8] = b[0x30556 + m.u8(UNITS + i + U.OWNER)];
  const x = m.u16(UNITS + i + U.X) - m.u32(CAMX), y = m.u16(UNITS + i + U.Y) - m.u32(CAMY); m.w32(0x41648, x); m.w32(0x4164c, y);
  const spr = m.u16(UNITS + i + U.SPR); m.w32(0x41644, spr); const st = m.u8(UNITS + i + U.STATE); const t = m.u8(UNITS + i + U.TYPE);
  const weapon = m.u8(UNITS + i + U.WEAPON), shield = m.u8(UNITS + i + U.SHIELD);
  const drawEquip = slot => { const item = m.u8(UNITS + i + U.INV + slot); const s = (spr - m.u32(0x416b4 + t * 4) + m.u32(0x41650 + item * 4)) >>> 0; unitBlit(eng, i, s, x, y); };
  if (st === 0x10 || st === 0x30) {
    let s = spr; if (weapon !== 0xff) { const item = m.u8(UNITS + i + U.INV + weapon); if (item >= 5 && item <= 7) s = (s + m.u32(0x416c4 + t * 4)) >>> 0; }
    if (afterBlit(eng, i, unitBlit(eng, i, s, x, y))) return;
    if (weapon !== 0xff) drawEquip(weapon); if (shield !== 0xff) drawEquip(shield); call(eng, 0x23f44, { esi: i }); return;
  }
  if (afterBlit(eng, i, unitBlit(eng, i, spr, x, y))) return;
  if (weapon !== 0xff) drawEquip(weapon); if (shield !== 0xff) drawEquip(shield); call(eng, 0x23f44, { esi: i });
  if (st === 0x20) call(eng, 0x2c1df, { eax: (m.u8(UNITS + i + U.ATKCTR) >> 3) + 0xaea, edx: x, ebx: y });
};
F[0x2540a] = (eng, r) => { // дикие звери и летающие
  const m = eng.m, b = m.b, i = r.esi; b[0x488e8] = b[0x30556 + m.u8(UNITS + i + U.OWNER)]; const x = m.u16(UNITS + i + U.X) - m.u32(CAMX), y = m.u16(UNITS + i + U.Y) - m.u32(CAMY); m.w32(0x41648, x); m.w32(0x4164c, y); m.w32(0x41640, i);
  if (afterBlit(eng, i, unitBlit(eng, i, m.u16(UNITS + i + U.SPR), x, y))) return;
  call(eng, 0x23f44, { esi: i }); if (m.u8(UNITS + i + U.STATE) === 0x20) call(eng, 0x2c1df, { eax: (m.u8(UNITS + i + U.ATKCTR) >> 3) + 0xaea, edx: x, ebx: y });
};
F[0x254b6] = (eng, r) => { // растения
  const m = eng.m, i = r.esi; m.w32(0x41640, i); const x = m.u16(UNITS + i + U.X) - m.u32(CAMX), y = m.u16(UNITS + i + U.Y) - m.u32(CAMY);
  const cl = call(eng, (m.u8(UNITS + i + U.FX43) & 1) ? 0x2c320 : 0x2c1df, { eax: m.u16(UNITS + i + U.SPR), edx: x, ebx: y }).cl; if (afterBlit(eng, i, cl)) return; call(eng, 0x23f44, { esi: i });
};
F[0x2550f] = (eng, r) => { // здания
  const m = eng.m, b = m.b, i = r.esi; m.w32(0x41640, i); b[0x41904] = 0; b[0x488e8] = b[0x30556 + m.u8(UNITS + i + U.OWNER)]; const t = m.u8(UNITS + i + U.TYPE); const f50 = m.u8(UNITS + i + U.FLAGS50);
  let spr;
  if (!(f50 & 2)) {
    if (m.u8(UNITS + i + U.STATE) === 0x60) { spr = 0x982 + m.u8(UNITS + i + U.ATKCTR); const k = (t - 0x1a) & 0xff; const x = ((m.i16(0x418cc + k * 4) + m.u16(UNITS + i + U.X)) & 0xffff) - m.u32(CAMX), y = ((m.i16(0x418ce + k * 4) + m.u16(UNITS + i + U.Y)) & 0xffff) - m.u32(CAMY); call(eng, 0x2c1df, { eax: spr, edx: x, ebx: y }); return; }
    spr = m.u32(0x416d4 + ((t - 0x1a) * 8 + m.u8(UNITS + i + U.SLOT)) * 4); if (m.u8(UNITS + i + U.HP) < (m.u8(UNITS + i + U.HPMAX) >> 1)) { spr++; b[0x41904] = 1; }
  } else { if (m.u8(UNITS + i + 0x51) < (m.u8(UNITS + i + U.HPMAX) >> 1)) spr = m.u32(0x41894 + (t - 0x1a) * 4); else spr = m.u32(0x416d4 + ((t - 0x1a) * 8 + m.u8(UNITS + i + U.SLOT)) * 4) + 2; }
  m.w16(UNITS + i + U.SPR, spr); const x = m.u16(UNITS + i + U.X) - m.u32(CAMX), y = m.u16(UNITS + i + U.Y) - m.u32(CAMY);
  const cl = call(eng, (m.u8(UNITS + i + U.FX43) & 1) ? 0x2c320 : 0x2c460, { eax: spr & 0xffff, edx: x, ebx: y }).cl; if (afterBlit(eng, i, cl)) return;
  call(eng, 0x23f44, { esi: i });
  if (b[0x41904]) { let a = (m.u8(UNITS + i + U.XP) + 1) & 0xff; if (a >= 6) a = 0; m.w8(UNITS + i + U.XP, a); const fx = ((m.i16(0x30456 + t * 4) + m.u16(UNITS + i + U.X)) << 16 >> 16) - m.u32(CAMX), fy = ((m.i16(0x30458 + t * 4) + m.u16(UNITS + i + U.Y)) << 16 >> 16) - m.u32(CAMY); call(eng, 0x2c1df, { eax: a + 0xae0, edx: fx, ebx: fy }); return; }
  if (!(f50 & 2) && t >= 0x1c && t <= 0x1d) { let a = (m.u8(UNITS + i + 0x28) + 1) & 0xff; if (a >= 4) a = 0; m.w8(UNITS + i + 0x28, a); call(eng, 0x2c1df, { eax: a + 0xae6, edx: x, ebx: y }); }
};
F[0x24d70] = (eng) => { // слой юнитов и объектов
  const m = eng.m, b = m.b; const head = m.u32(G.unitHead);
  for (let i = head; i !== 0;) { const nx = m.u32(UNITS + i + U.NEXT); if (!(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.STATE) === 0x60 && m.u8(UNITS + i + U.TYPE) < 0x1a) call(eng, UNIT_DRAW(m.u8(UNITS + i + U.TYPE)), { esi: i }); i = nx; }
  // Сетка «кто в какой клетке». В оригинале она рассчитана на окно 512×480: 24×23 клетки и
  // окно перебора camX−128…camX+640. В широком кадре юниты за этими границами просто не
  // рисовались — владелец это и увидел: «только выделенная область рисуется динамически,
  // остальное просто карта». Размеры берём из js/render/wide.js: в родном кадре они те же, что
  // были, в широком — свои массивы за кадром.
  const с = сеткаЮнитов(m);
  const ЯЧЕЕК = с.кX * с.кY;
  m.w32(0x3eb1c, 0); for (let k = 0; k < ЯЧЕЕК; k++) { m.w32(с.a + k * 4, 0); m.w32(с.b + k * 4, 0); m.w32(с.c + k * 4, 0); m.w32(с.укр + k * 4, 0); }
  const camX = m.u32(CAMX), camY = m.u32(CAMY); const x0 = camX < 0x80 ? 0 : camX - 0x80, y0 = camY < 0x80 ? 0 : camY - 0x80;
  const x1 = Math.min(camX + m.u32(VW) + 0x80, 0x2000), y1 = Math.min(camY + m.u32(VH) + 0x80, 0x1600);
  m.w32(0x3eb10, x0 >>> 5); m.w32(0x3eb14, y0 >>> 5);
  if (head !== 0) {
    for (let i = head; i !== 0; i = m.u32(UNITS + i + U.NEXT)) m.w8(UNITS + i + 0x42, 1);
    for (let i = head; i !== 0; i = m.u32(UNITS + i + U.NEXT)) {
      if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue; if (m.u8(UNITS + i + U.TYPE) < 0x1a && m.u8(UNITS + i + U.STATE) === 0x60) continue;
      const ux = m.u16(UNITS + i + U.X); if (ux < x0 || ux >= x1) continue; const uy = m.u16(UNITS + i + U.Y); if (uy < y0 || uy >= y1) continue;
      const cell = ((ux >>> 5) - (x0 >>> 5)) + ((uy >>> 5) - (y0 >>> 5)) * с.кX;
      if (cell < 0 || cell >= ЯЧЕЕК) continue;
      if (m.u8(UNITS + i + U.TYPE) === 0xb) { const n = m.u32(0x3eb1c); m.w32(0x40da0 + n * 4, i); m.w32(0x3eb1c, n + 1); continue; }
      if (m.u32(с.a + cell * 4) === 0) m.w32(с.a + cell * 4, i); else if (m.u32(с.b + cell * 4) === 0) m.w32(с.b + cell * 4, i); else m.w32(с.c + cell * 4, i);
    }
  }
  { const dx0 = x0 >>> 4, dx1 = x1 >>> 4; let rowOff = (y0 >>> 5) << 9; const rowEnd = (y1 >>> 5) << 9; let ebp = 0;
    for (; rowOff < rowEnd && ebp < ЯЧЕЕК * 4; rowOff += 0x200, ebp += с.шагРяда) {
      let eax = 0;
      for (let d = dx0; d < dx1 && eax < с.шагРяда; d += 2, eax += 4) { const v = m.u16(BG + d + rowOff); if (v & 0xf800) m.w32(с.укр + ebp + eax, v >>> 11); } } }
  for (let row = 0, ebx = 0; row < с.кY; row++, ebx += с.шагРяда) {
    for (let esi = с.шагРяда - 4; esi >= 0; esi -= 4) {
      const ov = m.u32(с.укр + esi + ebx); if (ov !== 0) { const x = (((esi >>> 2) + m.u32(0x3eb10)) << 5) - camX, y = ((row + m.u32(0x3eb14)) << 5) - camY; call(eng, 0x2c1df, { eax: ov + 0xaf7, edx: x, ebx: y }); }
      const u1 = m.u32(с.a + esi + ebx); if (u1 === 0) continue; call(eng, UNIT_DRAW(m.u8(UNITS + u1 + U.TYPE)), { esi: u1 });
      const u2 = m.u32(с.b + esi + ebx); if (u2 === 0) continue; call(eng, UNIT_DRAW(m.u8(UNITS + u2 + U.TYPE)), { esi: u2 });
      const u3 = m.u32(с.c + esi + ebx); if (u3 === 0) continue; call(eng, UNIT_DRAW(m.u8(UNITS + u3 + U.TYPE)), { esi: u3 });
    }
  }
  const nf = m.u32(0x3eb1c); if (nf === 0) return;
  for (let k = 0; k < nf; k++) { const i = m.u32(0x40da0 + k * 4); call(eng, 0x2c1df, { eax: 0xadf, edx: m.u16(UNITS + i + U.X) - camX, ebx: m.u16(UNITS + i + U.Y) - camY }); }
  for (let k = 0; k < nf; k++) { call(eng, 0x2540a, { esi: m.u32(0x40da0 + k * 4) }); m.w32(0x3eb1c, m.u32(0x3eb1c) - 1); }
};
// ---- снаряды и эффекты (0x25cbc)
F[0x25cbc] = (eng) => {
  const m = eng.m; for (let p = m.u32(0x31b74); p !== 0;) { const nx = m.u32(PROJ + p + 0x20); const t = m.u8(PROJ + p); if (t & 0x80) projEffect(eng, p, t - 0x80); else projSimple(eng, p, t); p = nx; }
};
/** Экранная точка снаряда p. */
function projPos(m, p, dx = 0, dy = 0) { return { x: m.u16(PROJ + p + 0xc) - dx - m.u32(CAMX), y: m.u16(PROJ + p + 0xe) - dy - m.u32(CAMY) }; }
/** Экранная точка снаряда, привязанного к своему юниту. */
function ownerPos(m, p) { const u = m.u32(PROJ + p + 8); return { x: ((m.u16(UNITS + u + U.X) + m.u16(PROJ + p + 0xc)) & 0xffff) - m.u32(CAMX), y: ((m.u16(UNITS + u + U.Y) + m.u16(PROJ + p + 0xe)) & 0xffff) - m.u32(CAMY) }; }
/** Обычный снаряд: кадр по таблице типа. */
function projSimple(eng, p, t) {
  const m = eng.m; if (t === 0 || t === 57 || t === 59) return; const fr = m.u8(PROJ + p + 1); let spr;
  if (t === 58) { call(eng, 0x25f94, { esi: p }); return; }   // надпись над юнитом (js/render/text.js)
  if (t <= 24) spr = 0xaad + t; else if (t <= 32) spr = 0xa9a + ((fr >> 3) & 3); else if (t <= 40) spr = 0xa9e + ((fr >> 3) & 3); else if (t <= 48) spr = 0xaa2 + ((fr >> 3) & 3); else if (t <= 56) spr = 0xaa6 + ((fr >> 3) & 3); else if (t <= 67) spr = 0xaaa + ((fr >> 3) & 3);
  else { // 68: 0x26023
    const kind = m.u8(PROJ + p + 2); const s = ((fr >> 1) + m.u32(0x424a1 + kind * 4)) >>> 0; const pos = projPos(m, p); if (kind === 0) return; call(eng, kind <= 5 ? 0x2c1df : 0x2c6e7, { eax: s, edx: pos.x, ebx: pos.y }); return;
  }
  const pos = projPos(m, p); call(eng, 0x2c1df, { eax: spr, edx: pos.x, ebx: pos.y });
}
/** Эффект-снаряд (взрывы, всплывающие надписи, магия). */
function projEffect(eng, p, k) {
  const m = eng.m; const fr = m.u8(PROJ + p + 1); let pos;
  switch (k) {
    case 0: pos = ownerPos(m, p); call(eng, 0x2c1df, { eax: fr + 0xa45, edx: pos.x, ebx: pos.y }); break;
    case 1: pos = ownerPos(m, p); call(eng, 0x2c1df, { eax: fr + 0xa4c, edx: pos.x, ebx: pos.y }); break;
    case 2: pos = ownerPos(m, p); call(eng, 0x2c1df, { eax: (fr % 5) + 0xa53, edx: pos.x, ebx: pos.y }); break;
    case 3: pos = ownerPos(m, p); call(eng, 0x2c1df, { eax: (fr % 5) + 0xa58, edx: pos.x, ebx: pos.y }); break;
    case 4: pos = ownerPos(m, p); call(eng, 0x2c1df, { eax: (fr & 3) + 0xa5d, edx: pos.x, ebx: pos.y }); break;
    // 0x261cf (типы 0x86, 0xa0..0xa4) и 0x26203 (типы 0xa5..0xa8) — один и тот же расчёт,
    // отличается только блиттер: второй зеркальный. Спрайт = 0x42424[тип − 0xa0] + (кадр & 3),
    // позиция — самого снаряда. Именно сюда попадают снаряды заклинаний магов.
    case 6: case 32: case 33: case 34: case 35: case 36:
    case 37: case 38: case 39: case 40: {
      const s = (m.u32(0x42424 + ((k - 0x20) & 0xff) * 4) + (fr & 3)) >>> 0; pos = projPos(m, p);
      call(eng, k >= 37 ? 0x2c6e7 : 0x2c1df, { eax: s, edx: pos.x, ebx: pos.y }); break;
    }
    case 7: pos = ownerPos(m, p); call(eng, 0x2c1df, { eax: fr + 0xa75, edx: pos.x, ebx: pos.y }); break;
    case 8: { const u = m.u32(PROJ + p + 8); const x = s16(m.u16(UNITS + u + U.X) + m.u16(PROJ + p + 0xc) - m.u16(CAMX)), y = s16(m.u16(UNITS + u + U.Y) + m.u16(PROJ + p + 0xe) - m.u16(CAMY)); call(eng, 0x2c1df, { eax: (fr >> 1) + 0xa7d, edx: x, ebx: y }); break; }
    case 9: { const u = m.u32(PROJ + p + 8); const x = s16(m.u16(UNITS + u + U.X) + m.u16(PROJ + p + 0xc) - m.u16(CAMX)), y = s16(m.u16(UNITS + u + U.Y) + m.u16(PROJ + p + 0xe) - m.u16(CAMY)); call(eng, 0x2c1df, { eax: 0xa83, edx: x, ebx: y }); break; }
    case 11: { let s = (fr >> 1) & 3; if (s === 3) s = 1; s += 0xa84; const base = projPos(m, p, 0x20, 0x20); let y = base.y; for (let r = 0; r < 3; r++, y += 0x20) { let x = base.x; for (let c = 0; c < 3; c++, x += 0x20) { call(eng, 0x2c1df, { eax: s, edx: x, ebx: y }); s++; if (s >= 0xa88) s = 0xa84; } } break; }
    case 14: { const s = (fr >> 1) + 0xa88; const base = projPos(m, p, 0x80, 0x80); let y = base.y; for (let r = 0; r < 9; r++, y += 0x20) { let x = base.x; for (let c = 0; c < 9; c++, x += 0x20) call(eng, 0x2c1df, { eax: s, edx: x, ebx: y }); } break; }
    case 16: { if (m.i16(PROJ + p + 0x10) < 0) break; const u = m.u32(PROJ + p + 8); const x = m.u16(UNITS + u + U.X) + m.i16(PROJ + p + 0xc) - m.u32(CAMX), y = m.u16(UNITS + u + U.Y) + m.i16(PROJ + p + 0xe) - m.u32(CAMY); call(eng, 0x2c1df, { eax: fr + 0xa8d, edx: x, ebx: y }); break; }
    case 17: { const x = m.i16(PROJ + p + 0xc) - m.u32(CAMX), y = m.i16(PROJ + p + 0xe) - m.u32(CAMY); const a = m.u8(PROJ + p + 2); if (a < 5) call(eng, 0x2c1df, { eax: a + 0xa91, edx: x, ebx: y }); else call(eng, 0x2c6e7, { eax: m.u32(0x42448 + a * 4), edx: x, ebx: y }); break; }
    case 18: { const u = m.u32(PROJ + p + 4); const x = s16(m.i16(PROJ + p + 0xc) + m.u16(UNITS + u + U.X)) - m.u32(CAMX), y = s16(m.i16(PROJ + p + 0xe) + m.u16(UNITS + u + U.Y)) - m.u32(CAMY); call(eng, 0x2c1df, { eax: m.u32(0x42468 + fr * 4), edx: x, ebx: y }); break; }
    default: break; // 5, 10, 12, 13, 15, 19..31: в таблице оригинала стоит пустой обработчик
  }
}
// ---- последовательности отрисовки
export const SCENE_FULL = [0x242d4, 0x26498, 0x24d70, 0x25cbc, 0x2438e, 0x240fb];          // 0x23eb1 (без HUD: 0x26e77, 0x2572f, 0x24843, 0x26c0a, 0x26e4d/0x26e62)
export const SCENE_TICK = [0x242d4, 0x26498, 0x24d70, 0x25cbc, 0x2438e, 0x240c0, 0x240fb]; // блок рендера в 0x17e1c (плюс 0x26a5c пустая, 0x2673d панель мага)
/** Прогнать список функций отрисовки сцены по порядку. */
export function drawScene(eng, seq) { for (const f of seq) call(eng, f, {}); }
// ---- циклическая палитра (0x24132, вызывается из главного цикла каждый проход) и DAC (0x28d98)
F[0x28d98] = (eng, r) => { const m = eng.m; const i = r.eax & 0xff; if (!eng.dac) eng.dac = new Uint8Array(768); for (let k = 0; k < 3; k++) eng.dac[i * 3 + k] = (m.b[0x44980 + i * 3 + k] >> 2) << 2; };
F[0x24132] = (eng) => {
  const m = eng.m, b = m.b; const t = m.u16(0x46c); const same = t === m.u16(0x3d1b0); m.w16(0x3d1b0, t); if (same) return;
  const cd = (m.u16(0x3d1b2) - 1) & 0xffff; m.w16(0x3d1b2, cd); if (cd !== 0) return; m.w16(0x3d1b2, 4);
  const rot = (first, last, lo, hi) => { const s0 = b[0x44980 + first], s1 = b[0x44981 + first], s2 = b[0x44982 + first]; for (let k = 0; k < 6; k++) { const d = 0x44980 + first + k * 3, s = d + 3; b[d] = b[s]; b[d + 1] = b[s + 1]; b[d + 2] = b[s + 2]; } b[0x44980 + last] = s0; b[0x44981 + last] = s1; b[0x44982 + last] = s2; for (let i = lo; i <= hi; i++) call(eng, 0x28d98, { eax: i }); };
  rot(0xdb, 0xed, 0x49, 0x4f); rot(0xf0, 0x102, 0x50, 0x56);
};
