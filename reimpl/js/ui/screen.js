// Примитивы оболочки (логотипы, меню, выбор клана, брифинг): рисование картинок из архивов
// в кадровый буфер оригинала 0x1235f4, смена палитры 0x44980, чтение мыши и вывод текста.
//
// Оболочка сознательно НЕ является портом: кода меню оригинала (0x20515, 0x20acb, 0x14c90) в
// дизассемблере не разбирали, разбирали только ресурсы. Поэтому экраны собираются из готовых
// картинок паков 01/02/03/09, а разметка кликабельных зон лежит данными в data/ui_screens.json.
// Всё остальное — настоящие подсистемы оригинала: тот же кадровый буфер, та же палитра,
// те же шрифты и тот же программный курсор со своими 27 формами и анимациями.
import { F, call } from '../fn.js'; import { Archive } from '../archive.js'; import { FB, ROWS } from '../render/scene.js';

export const PAL = 0x44980;                       // палитра VGA, 768 байт, компоненты 0..255
const M = { x: 0x45098, y: 0x4509c, btn: 0x450a8, ring: 0x450e4, wr: 0x450dc, rd: 0x450e0, moved: 0x450ac };
const CUR_ON = 0x4626c, CUR_SHAPE = 0x46270;
const TXT = { x: 0x47004, y: 0x47008, col: 0x4700c, bg: 0x4700d, shcol: 0x4700e, style: 0x4700f, shx: 0x47010, shy: 0x47014, gap: 0x47018,
  cx0: 0x46ff4, cy0: 0x46ff8, cx1: 0x46ffc, cy1: 0x47000, buf: 0x46f10 };
const SCRATCH = 0x647000;                          // хвост сегмента данных: строки для 0x29c38 (движок сюда не пишет)

// ---- архивы: разбор кешируется, файлы приходят готовыми Uint8Array
const cache = new WeakMap();
/** Забыть разобранный архив: нужно, когда вместо облегчённого набора приехал полный пак. */
export function invalidateArch(files, name) { const byName = cache.get(files); if (byName) delete byName[name]; }
/** Разобранный архив пака (кэш на набор файлов): повторный разбор 9 МБ стоил бы кадра. */
export function arch(files, name) {
  let byName = cache.get(files); if (!byName) cache.set(files, byName = {});
  const buf = files[name]; if (!buf) throw new Error('нет архива ' + name);
  return byName[name] || (byName[name] = new Archive(buf));
}

// ---- палитра
export function setPal(m, pal) { m.b.set(pal.subarray(0, 768), PAL); }
/** Палитра из записи архива (файлы .PAL — 768 байт как есть, см. render-spec §12). */
export function setPalFrom(m, files, file, entry) { setPal(m, arch(files, file).data(entry)); }

// ---- картинки: 8 бит на пиксель, индекс 0 в спрайтах прозрачный
export function fill(m, col = 0) { const b = m.b; for (let y = 0; y < 480; y++) b.fill(col, FB + m.u32(ROWS + y * 4), FB + m.u32(ROWS + y * 4) + 640); }
/** Положить готовые пиксели в кадровый буфер; transparent — нулевой цвет не рисуем. */
export function blit(m, px, w, h, x0 = 0, y0 = 0, transparent = false) {
  const b = m.b;
  for (let y = 0; y < h; y++) {
    const dy = y0 + y; if (dy < 0 || dy >= 480) continue;
    const ro = FB + m.u32(ROWS + dy * 4), so = y * w;
    if (!transparent && x0 >= 0 && x0 + w <= 640) { b.set(px.subarray(so, so + w), ro + x0); continue; }
    for (let x = 0; x < w; x++) { const dx = x0 + x; if (dx < 0 || dx >= 640) continue; const c = px[so + x]; if (transparent && c === 0) continue; b[ro + dx] = c; }
  }
}
/** Полноэкранный .SCR/.raw 640×480 из записи архива. */
export function blitScreen(m, files, file, entry) { blit(m, arch(files, file).data(entry), 640, 480, 0, 0, false); }
/** Экран .SPR из TRC: 12 байт заголовка (u16 w, u16 h, 8 нулей), дальше пиксели. */
export function blitSpr(m, files, file, entry) {
  const d = arch(files, file).data(entry); const w = d[0] | (d[1] << 8), h = d[2] | (d[3] << 8);
  blit(m, d.subarray(12), w, h, 0, 0, false); return { w, h };
}
/** Есть ли в архиве запись с таким номером и данными. */
export function hasEntry(files, file, entry) { const e = arch(files, file).entries[entry]; return !!e && (e.size ?? e.stored ?? 0) > 0; }
/** Имя записи TRC (у TRS имён нет — вернёт undefined). */
export function entryName(files, file, entry) { return arch(files, file).entries[entry]?.name; }
/** Текст записи архива как строка latin1 (брифинги T{стадия}_{племя}.TXT). */
export function textFile(files, file, entry) { const d = arch(files, file).data(entry); let s = ''; for (let i = 0; i < d.length; i++) s += String.fromCharCode(d[i]); return s; }
/** Спрайт из TRS: размеры лежат в оглавлении архива. */
export function blitSprite(m, files, file, entry, x, y, transparent = true) {
  const a = arch(files, file), e = a.entries[entry]; blit(m, a.data(entry), e.w, e.h, x, y, transparent); return e;
}

// ---- подбор цвета под текущую палитру
// Шрифты FE****RD хранят «уровни» 1..4, цвет пикселя = уровень + [0x4700c] − 1 (render-spec §11.3),
// то есть текст занимает рампу из четырёх подряд идущих индексов начиная с заданного. У каждого
// экрана своя палитра, поэтому нужный индекс ищем в ней, а не задаём числом.
export function inkIndex(m, { light = true } = {}) {
  let best = -1, bestScore = light ? -1 : 1e9;
  for (let i = 1; i < 252; i++) {
    let lo = 1e9, hi = -1;
    for (let k = 0; k < 4; k++) { const p = PAL + (i + k) * 3; const l = m.b[p] * 0.3 + m.b[p + 1] * 0.6 + m.b[p + 2] * 0.1; if (l < lo) lo = l; if (l > hi) hi = l; }
    const score = light ? lo : hi;
    if (light ? score > bestScore : score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// ---- текст оригинальными шрифтами (0 — FE0808RD 8px, 1 — FE0816RD 16px)
/** Таблица «символ → код глифа» для дописанных в шрифт наборов (кириллица ставит её из locale.js). */
let GLYPHS = new Map();
/** Карта «символ → код в шрифте игры»: её ставит локализация, ею печатает text(). */
export function setGlyphs(map) { GLYPHS = map || new Map(); }
/**\n * Напечатать строку шрифтом игры.\n * @param {number} font 0 — мелкий 8×8, 1 — крупный 8×16 (кириллица дописана только в него)\n * @param {number} col  цвет из палитры, shadow — цвет тени, clip — прямоугольник отсечения\n */
export function text(eng, s, x, y, { font = 1, col = 0xfd, bg = 0, shadow = 0, gap = 0, clip = null } = {}) {
  const m = eng.m; call(eng, 0x29bbd, { eax: font });
  // Клип и буфер — общие с движком: миссия ставит правый край по краю карты ([0x46ffc] = [0x488c4] − 1),
  // чтобы всплывающие «HP+1» не лезли на боковую панель. Оболочка рисует во весь экран, поэтому
  // прямоугольник обязательно возвращаем на место: иначе после меню или брифинга надписи движка
  // остаются нерезаными и печатаются поверх панели.
  const save = [m.u32(TXT.cx0), m.u32(TXT.cy0), m.u32(TXT.cx1), m.u32(TXT.cy1), m.u32(TXT.buf)];
  m.w32(TXT.buf, FB);
  m.w32(TXT.cx0, clip ? clip[0] : 0); m.w32(TXT.cy0, clip ? clip[1] : 0); m.w32(TXT.cx1, clip ? clip[2] : 639); m.w32(TXT.cy1, clip ? clip[3] : 479);
  m.w32(TXT.x, x); m.w32(TXT.y, y); m.w8(TXT.col, col); m.w8(TXT.bg, bg); m.w32(TXT.gap, gap);
  m.w8(TXT.style, shadow ? 1 : 0); if (shadow) { m.w8(TXT.shcol, shadow); m.w32(TXT.shx, 1); m.w32(TXT.shy, 1); }
  // Латиница — как есть, кириллица — своими кодами 0x80.. (см. js/ui/locale.js). Печатаем через
  // 0x29c82: 0x29c38 принял бы байт со старшим битом за первую половину двухбайтового символа.
  let p = SCRATCH;
  for (const ch of s) { const c = ch.codePointAt(0); m.b[p++] = c < 0x80 ? c : (GLYPHS.get(ch) ?? 0x3f); }
  m.b[p] = 0;
  try { call(eng, 0x29c82, { esi: SCRATCH }); }
  finally { m.w32(TXT.cx0, save[0]); m.w32(TXT.cy0, save[1]); m.w32(TXT.cx1, save[2]); m.w32(TXT.cy1, save[3]); m.w32(TXT.buf, save[4]); }
  return m.u32(TXT.x) - x;                        // сколько пикселей заняла строка
}
/** Ширина строки без вывода — считаем по таблице ширин текущего шрифта через сухой прогон за экраном. */
export function textWidth(eng, s, font = 1) { return text(eng, s, 0, 2000, { font }); }

/** Разбить абзац по ширине рамки. Нужен переводу: русская строка длиннее английской,
 *  и готовая разбивка оригинала под неё не подходит. */
export function wrapText(eng, s, maxPx, font = 1) {
  const out = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? line + ' ' + word : word;
      if (line && textWidth(eng, probe, font) > maxPx) { out.push(line); line = word; }
      else line = probe;
    }
    out.push(line);
  }
  return out;
}

// ---- мышь и курсор
export function mouse(m) { return { x: m.u32(M.x), y: m.u32(M.y), btn: m.u32(M.btn) }; }
/** Забрать накопленные события мыши: 2 ЛКМ вниз, 4 ЛКМ вверх, 8 ПКМ вниз, 0x10 ПКМ вверх. */
export function drainMouse(m) {
  const out = []; let rd = m.u32(M.rd);
  while (rd !== m.u32(M.wr)) {
    out.push({ mask: m.u16(M.ring + rd), x: m.u32(M.ring + rd + 4), y: m.u32(M.ring + rd + 8) });
    rd += 0x14; if (rd >= 0x280) rd = 0; m.w32(M.rd, rd);
  }
  m.w32(M.moved, 0);
  return out;
}
/** Сменить форму курсора, если она правда меняется. */
export function setCursor(eng, id) { if (eng.m.u32(CUR_SHAPE) !== id) call(eng, 0x291ce, { ebx: id }); eng.m.w32(CUR_ON, 1); }
/** Синхронизировать позицию вывода курсора с позицией мыши (оригинал делает это в 0x291ce). */
export function syncCursor(m) {
  const p = m.u32(0x46274); if (!p) return;
  m.w32(0x46278, (m.u32(M.x) - m.u32(p)) >>> 0); m.w32(0x4627c, (m.u32(M.y) - m.u32(p + 4)) >>> 0);
}
/** Кадр на экран: курсор поверх буфера, буфер → VRAM, фон под курсором обратно (порт 0x299b4). */
export function flip(eng) { call(eng, 0x299b4, {}); }

// ---- попадание в зону
export const hit = (z, x, y) => z.r !== undefined
  ? (x - z.cx) * (x - z.cx) + (y - z.cy) * (y - z.cy) <= z.r * z.r
  : x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h;
