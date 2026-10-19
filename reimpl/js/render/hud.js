// HUD: мини-карта (0x24843) и программный курсор мыши (0x29720/0x29771/0x297b5, flip 0x299b4).
// Всё рисуется в закадровый буфер оригинала (0x1235f4) через eng.m; «VRAM» = eng.vram (Uint8Array 640*480), если задан.
import { F, call } from '../fn.js'; import { BG, BI, MO } from '../mem.js'; import { FB, ROWS, CAMX, CAMY, шаг, ряды } from './scene.js';
const LUT_SHADOW = 0x44f80, MM_X = 0x30388, MM_Y = 0x3038c, MM_W = 0x30390, MM_H = 0x30394, MM_BASE = 0x3e6e8, MM_LUTX = 0x3e6f0, MM_LUTY = 0x3e7f0;
const COL_TILE = 0x3e8aa, COL_OWNER = 0x3e8a0, UIFL = 0x31ae0;
const CUR_ON = 0x4626c, CUR_SHAPE = 0x46274, CUR_X = 0x46278, CUR_Y = 0x4627c, CUR_BG = 0x466fc, CUR_IMG = 0x462fc, CUR_DRAWN = 0x4626a, CUR_LOCK = 0x45090;

// ---- мини-карта 0x24843: клетки сетки по BI/MO/BG, рамка вьюпорта (0x12), рамка мини-карты (0xf7)
function cellColor(m, cell) { // возвращает цвет и признак «юнит/здание игрока»
  const b = m.b; if (!(b[BI + cell] & 1)) return [0xff, false];
  let o = b[MO + cell] >> 4; if (o === 0) { o = b[BI + cell] >> 2; if (o === 0) return [b[COL_TILE + (m.u16(BG + cell * 2) & 0x7ff)], false]; }
  return [b[COL_OWNER + o], true];
}
/**
 * Рамка вьюпорта на мини-карте, обрезанная по самой мини-карте. Обрезка нужна с тех пор, как
 * окно карты стало шире (js/render/wide.js): в оригинале рамка была 16×15 клеток и в мини-карту
 * влезала всегда, а окно на 46×28 клеток при камере у нижнего края вылезает за неё и рисует
 * «гребёнку» по панели — владелец это и увидел, отогнав камеру вниз.
 * (x0,y0) — левый верхний угол рамки в кадре, (шр,вр) — её размеры; (mx,my,w,h) — сама мини-карта.
 */
function рамкаВьюпорта(m, b, base, ш, x0, y0, шр, вр, mx, my, w, h) {
  const ЦВЕТ = 0x12;
  const x1 = x0 + шр - 1, y1 = y0 + вр - 1;
  const лx = Math.max(x0, mx), пx = Math.min(x1, mx + w - 1);
  const вy = Math.max(y0, my), нy = Math.min(y1, my + h - 1);
  if (лx > пx || вy > нy) return;
  const точка = (x, y) => { b[(base + m.u32(ряды(m) + y * 4) + x) >>> 0] = ЦВЕТ; };
  for (const y of [y0, y1]) if (y >= вy && y <= нy) for (let x = лx; x <= пx; x++) точка(x, y);
  for (const x of [x0, x1]) if (x >= лx && x <= пx) for (let y = вy; y <= нy; y++) точка(x, y);
}

F[0x24843] = (eng) => {
  const m = eng.m, b = m.b; const fl = b[UIFL]; if (!(fl & 1) && !(fl & 8)) return;
  const tx = m.u32(CAMX) >>> 5, ty = m.u32(CAMY) >>> 5; const ox = b[MM_LUTX + tx], oy = b[MM_LUTY + ty]; m.w32(0x31b2c, ox); m.w32(0x31b30, oy);
  const mx = m.u32(MM_X), my = m.u32(MM_Y), w = m.u32(MM_W), h = m.u32(MM_H), base = m.u32(MM_BASE);
  const cell0 = (oy << 8) | ox; const d0 = (base + m.u32(ряды(m) + my * 4) + mx) >>> 0; const vw = m.u32(0x31af0), vh = m.u32(0x31af4);
  const ш = шаг(m);                                                   // байт на строку: см. render/scene.js
  const redraw = (fl & 1) !== 0 || (fl & 2) !== 0;
  if (!(fl & 4)) { // 1 пиксель на тайл
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const d = d0 + r * ш + c; let [col, unit] = cellColor(m, cell0 + r * 0x100 + c); if (!redraw && !unit) col = b[LUT_SHADOW + b[d]]; b[d] = col;
    }
    // Рамка вьюпорта на мини-карте: низ — на (vh−1) строк ниже верха. В оригинале это было
    // зашито как 0x2300 (14 строк по 640) и «15» в цикле, потому что окно всегда было 15 клеток.
    // В широком кадре и высота другая, и шаг строки, поэтому считаем по vh и по шагу.
    рамкаВьюпорта(m, b, base, ш, mx + tx - ox, my + ty - oy, vw, vh, mx, my, w, h);
  } else { // 2×2 пикселя на тайл
    const rows = h >>> 1, cols = w >>> 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const d = d0 + r * 2 * ш + c * 2; const [col, unit] = cellColor(m, cell0 + r * 0x100 + c);   // 1280 = две строки по 640
      if (redraw || unit) { b[d] = col; b[d + 1] = col; b[d + ш] = col; b[d + ш + 1] = col; }
      else { b[d] = b[LUT_SHADOW + b[d]]; b[d + 1] = b[LUT_SHADOW + b[d + 1]]; b[d + ш] = b[LUT_SHADOW + b[d + ш]]; b[d + ш + 1] = b[LUT_SHADOW + b[d + ш + 1]]; }
    }
    рамкаВьюпорта(m, b, base, ш, mx + (tx - ox) * 2, my + (ty - oy) * 2, vw * 2, vh * 2, mx, my, w, h);
  }
  { // рамка мини-карты цветом 0xf7: строки my-1 и my+h (длина w+2), столбцы mx-1 и mx+w (h строк)
    let p = d0 - ш - 1; const off = m.u32(ряды(m) + (h + 1) * 4); for (let i = 0; i < w + 2; i++) { b[p + i] = 0xf7; b[p + i + off] = 0xf7; }   // 0x281 = строка 640 плюс пиксель
    p = d0 - 1; for (let r = 0; r < h; r++) { b[p + r * ш] = 0xf7; b[p + r * ш + w + 1] = 0xf7; }
  }
};

// ---- курсор: 32×32, форма [0x46274]+8 (0 прозрачный), позиция [0x46278]/[0x4627c] (беззнаково: за экраном — не рисуется)
// Границы кадра: у широкого окна они больше 640×480 (js/render/wide.js), поэтому берём их из
// самого кадра, а не из констант оригинала. Курсор рисуется по ним же — иначе он обрезался бы
// по старой рамке и пропадал в правой части широкого экрана.
const ширК = (m) => m.u32(0x6483c4) || 640, высК = (m) => m.u32(0x6483c8) || 480;
const inScreen = (m, x, y) => (x >>> 0) < ширК(m) && (y >>> 0) < высК(m);
F[0x29720] = (eng) => { // нарисовать курсор в буфер
  const m = eng.m, b = m.b; if (m.u32(CUR_ON) === 0) return; let src = m.u32(CUR_SHAPE) + 8; const x0 = m.u32(CUR_X), y0 = m.u32(CUR_Y);
  const б = m.u32(0x488c0), вы = высК(m), ш2 = ширК(m);
  for (let r = 0; r < 32; r++) { const y = (y0 + r) >>> 0; const row = y < вы ? m.u32(ряды(m) + y * 4) : 0; for (let c = 0; c < 32; c++, src++) { const x = (x0 + c) >>> 0; if (x < ш2 && y < вы) { const p = b[src]; if (p) b[б + row + x] = p; } } }
};
F[0x29771] = (eng, r) => { // сохранить фон под курсором из буфера в [esi] (1024 байта)
  const m = eng.m, b = m.b; if (m.u32(CUR_ON) === 0) return; let d = r.esi >>> 0; const x0 = m.u32(CUR_X), y0 = m.u32(CUR_Y);
  const б = m.u32(0x488c0), вы = высК(m);
  for (let i = 0; i < 32; i++) { const y = (y0 + i) >>> 0; const row = y < вы ? m.u32(ряды(m) + y * 4) : 0; for (let c = 0; c < 32; c++, d++) { const x = (x0 + c) >>> 0; if (inScreen(m, x, y)) b[d] = b[б + row + x]; } }
};
F[0x297b5] = (eng, r) => { // восстановить фон под курсором из [esi] в буфер
  const m = eng.m, b = m.b; if (m.u32(CUR_ON) === 0) return; let s = r.esi >>> 0; const x0 = m.u32(CUR_X), y0 = m.u32(CUR_Y);
  const б = m.u32(0x488c0), вы = высК(m);
  for (let i = 0; i < 32; i++) { const y = (y0 + i) >>> 0; const row = y < вы ? m.u32(ряды(m) + y * 4) : 0; for (let c = 0; c < 32; c++, s++) { const x = (x0 + c) >>> 0; if (inScreen(m, x, y)) b[б + row + x] = b[s]; } }
};
// Буфер → VRAM (в оригинале банками по 64К). Копируем ровно тот кадр, в который сейчас рисуем:
// в меню это родной FB 640×480, в игре — широкий кадр из js/render/wide.js.
F[0x2ade6] = (eng) => { const m = eng.m; if (!eng.vram) return;
  const б = m.u32(0x488c0), n = ширК(m) * высК(m);
  eng.vram.set(m.b.subarray(б, б + Math.min(n, eng.vram.length))); };
F[0x299b4] = (eng) => { // flip: фон под курсором → 0x466fc, курсор в буфер, буфер → VRAM, фон обратно, 0x466fc → 0x462fc
  const m = eng.m, b = m.b; b[CUR_LOCK]++; call(eng, 0x29771, { esi: CUR_BG }); call(eng, 0x29720, {}); b[CUR_DRAWN] = 1; b[CUR_LOCK]--;
  call(eng, 0x2ade6, {}); b[CUR_LOCK]++; call(eng, 0x297b5, { esi: CUR_BG }); b.copyWithin(CUR_IMG, CUR_BG, CUR_BG + 0x400); b[CUR_DRAWN] = 0; b[CUR_LOCK]--;
};

// Последовательность HUD после сцены (0x23eb1 и блок в 0x17e1c): 0x26e77 текст, 0x2572f тексты/счётчик еды, 0x24843 мини-карта, 0x26c0a цель, 0x26e62/0x26e4d — ещё не портированы.
export const HUD = [0x24843];
