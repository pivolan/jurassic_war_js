// Текст: выбор шрифта и отрисовка строк (0x29bbd/0x29c26/0x29c38/0x29c82/0x29c93/0x29d40/0x29e71).
// Состояние текста живёт в памяти оригинала: 0x47004 x, 0x47008 y, 0x4700c цвет, 0x4700d фон (0 — прозрачно),
// 0x4700e цвет тени, 0x4700f флаги (бит 0 — тень), 0x47010/0x47014 сдвиг тени, 0x47018 межсимвольный интервал.
// Клип: 0x46ff4 x0, 0x46ff8 y0, 0x46ffc x1, 0x47000 y1. Буфер — [0x46f10] (обычно закадровый 0x1235f4).
import { F, call } from '../fn.js'; import { ROWS, ряды } from './scene.js'; import { U, UNITS } from '../mem.js';

const FONTS = 0x46f14, FSTRIDE = 0x1c;            // таблица шрифтов: флаги, ширина, высота, база, байт/глиф, байт/строку, смещение данных
const CUR = 0x47020, FL = 0x47024, W = 0x47028, H = 0x4702c, BASE = 0x47030, GSZ = 0x47034, ROWB = 0x47038, DOFF = 0x4703c;
const GW = 0x47040, PAD = 0x47044, LEFT = 0x47048, ROWSLEFT = 0x4704c;
const X = 0x47004, Y = 0x47008, COL = 0x4700c, BG = 0x4700d, SHCOL = 0x4700e, STYLE = 0x4700f, SHX = 0x47010, SHY = 0x47014, GAP = 0x47018;
const CX0 = 0x46ff4, CY0 = 0x46ff8, CX1 = 0x46ffc, CY1 = 0x47000, BUF = 0x46f10;

// Указатели шрифтов в снимке эталона живут со сдвигом +0x100000 (как указатели слотов спрайтов, см. fixSlotPointers).
export function fixFontPointers(m) {
  for (let i = 0; i < 8; i++) { const e = FONTS + i * FSTRIDE + 0xc; const p = m.u32(e); if (p >= 0x110000 && p < 0x7483c0) m.w32(e, p - 0x100000); }
  const p = m.u32(BASE); if (p >= 0x110000 && p < 0x7483c0) m.w32(BASE, p - 0x100000);   // и в текущем дескрипторе
}

// ---- 0x29bbd: выбрать шрифт al (0..7). CF=1 — шрифта нет или у него не выставлен бит 1 флагов.
F[0x29bbd] = (eng, r) => {
  const m = eng.m, id = r.eax & 0xff; if (id >= 8) return { cf: 1 };
  const e = FONTS + id * FSTRIDE; if (!(m.u8(e) & 2)) return { cf: 1 };
  m.b[CUR] = id; m.b[FL] = m.u8(e);
  for (let k = 0; k < 6; k++) m.w32(W + k * 4, m.u32(e + 4 + k * 4));
  return { cf: 0 };
};

// ---- 0x29e71: глиф 8 бит на пиксель (шрифты FE****RD: байт глифа 0 — прозрачно, иначе цвет = байт + [0x4700c] − 1)
F[0x29e71] = (eng, r) => {
  const m = eng.m, b = m.b, ch = r.eax & 0xff;
  let src = (ch * m.u32(GSZ) + m.u32(DOFF) + m.u32(BASE)) >>> 0;
  let w;                                                        // [0x47048] — ширина для сдвига пера, [0x47040] — сколько реально рисуем
  if (m.u8(FL) === 6) { w = m.u32(W); m.w32(LEFT, w); }         // моноширинный
  else { w = m.u8(m.u32(BASE) + ch); m.w32(LEFT, w); if (w > m.u32(W)) w = m.u32(W); } // таблица ширин — первые 256 байт шрифта
  m.w32(GW, w); m.w32(ROWSLEFT, m.u32(H));
  let y = m.i32(Y) | 0;
  globalThis.__сч100 = 0;
  for (;;) { if (++globalThis.__сч100 > 3e6) throw new Error("ЦИКЛ text.js:37");
    if (y >= m.i32(CY0)) {                                      // строка выше клипа — пропускаем, ниже/за экраном — обрываем глиф
      if (y > m.i32(CY1) || y >= 0x1e0) break;
      if (y >= 0) {
        const dst = (m.u32(ряды(m) + y * 4) + m.u32(BUF)) >>> 0; let x = m.i32(X) | 0; let s = src;
        for (let n = m.u32(GW); n > 0; n--, x++) {
          let p = b[s++];
          if (x >= m.i32(CX0) && x <= m.i32(CX1) && (x >>> 0) < 0x280) {
            if (p === 0) { p = b[BG]; if (p === 0) continue; } else p = (p + b[COL] - 1) & 0xff;
            b[(dst + x) >>> 0] = p;
          }
        }
      }
    }
    src = (src + m.u32(ROWB)) >>> 0; y++;
    if (!(m.w32(ROWSLEFT, (m.u32(ROWSLEFT) - 1) >>> 0), m.u32(ROWSLEFT))) break;
  }
  m.w32(X, (m.i32(X) + m.u32(GAP) + m.u32(LEFT)) | 0);
};

// ---- 0x29d40: глиф 1 бит на пиксель (в трассах не встречается — ни один загруженный шрифт не идёт этим путём)
F[0x29d40] = (eng, r) => {
  const m = eng.m, b = m.b, ch = r.eax & 0xff;
  let src = (ch * m.u32(GSZ) + m.u32(DOFF) + m.u32(BASE)) >>> 0;
  const w = m.u8(FL) === 2 ? m.u32(W) : m.u8(m.u32(BASE) + ch);
  m.w32(GW, w); m.w32(ROWSLEFT, m.u32(H));
  let y = m.i32(Y) | 0;
  globalThis.__сч101 = 0;
  for (;;) { if (++globalThis.__сч101 > 3e6) throw new Error("ЦИКЛ text.js:64");
    if (y >= m.i32(CY0)) {
      if (y > m.i32(CY1) || y >= 0x1e0) break;
      if (y >= 0) {
        m.w32(PAD, m.u32(GAP)); const dst = (m.u32(ряды(m) + y * 4) + m.u32(BUF)) >>> 0;
        m.w32(LEFT, m.u32(GW)); let x = m.i32(X) | 0; let bits = 0, cnt = 0, pad = false;
        globalThis.__сч102 = 0;
        for (;;) { if (++globalThis.__сч102 > 3e6) throw new Error("ЦИКЛ text.js:70");
          if (cnt === 0) { bits = pad ? 0 : b[src++]; cnt = 8; }
          if (x >= m.i32(CX0) && x <= m.i32(CX1) && (x >>> 0) < 0x280) {
            const p = (bits & 0x80) ? b[COL] : b[BG];
            if (p !== 0) b[(dst + x) >>> 0] = p;
          }
          bits = (bits << 1) & 0xff; x++; cnt--;
          m.w32(LEFT, (m.u32(LEFT) - 1) >>> 0);
          if (m.u32(LEFT) === 0) {                              // после глифа — [0x47018] пикселей фоном
            if (m.u32(PAD) === 0) break;
            m.w32(LEFT, m.u32(PAD)); m.w32(PAD, 0); bits = 0; pad = true; cnt = 8;
          }
        }
        y++; if (!(m.w32(ROWSLEFT, (m.u32(ROWSLEFT) - 1) >>> 0), m.u32(ROWSLEFT))) break; continue;
      }
    }
    src = (src + m.u32(ROWB)) >>> 0; y++;
    if (!(m.w32(ROWSLEFT, (m.u32(ROWSLEFT) - 1) >>> 0), m.u32(ROWSLEFT))) break;
  }
  m.w32(X, (m.i32(X) + m.u32(GAP) + m.u32(GW)) | 0);
};

// ---- 0x29c93: один символ; при [0x4700f]&1 сначала тень цветом [0x4700e] со сдвигом [0x47010]/[0x47014], потом сам символ
const glyph = (eng, ch) => call(eng, (eng.m.u8(FL) & 4) ? 0x29e71 : 0x29d40, { eax: ch });
F[0x29c93] = (eng, r) => {
  const m = eng.m, ch = r.eax & 0xff;
  if (!(m.u8(STYLE) & 1)) { glyph(eng, ch); return; }
  const col0 = m.u8(COL), bg0 = m.u8(BG), x0 = m.u32(X), y0 = m.u32(Y);   // push word[0x4700c] — это пара цвет+фон
  m.b[COL] = m.u8(SHCOL); m.w32(X, (x0 + m.u32(SHX)) >>> 0); m.w32(Y, (y0 + m.u32(SHY)) >>> 0);
  glyph(eng, ch);
  m.w32(Y, y0); m.w32(X, x0); m.b[COL] = col0; m.b[BG] = bg0; m.b[BG] = 0;
  glyph(eng, ch);
  m.b[COL] = col0; m.b[BG] = bg0;
};

// ---- 0x29c38: строка по esi до нуля; байт с битом 0x80 — первый из пары (двухбайтовый символ, 0x29f68)
F[0x29c38] = (eng, r) => {
  const m = eng.m; let p = r.esi >>> 0;
  globalThis.__сч103 = 0;
  for (;;) { if (++globalThis.__сч103 > 3e6) throw new Error("ЦИКЛ text.js:108");
    const c = m.u8(p++); if (c === 0) return;
    if (c & 0x80) { const c2 = m.u8(p++); call(eng, 0x29f68, { eax: (c << 8) | c2 }); }
    else call(eng, 0x29c93, { eax: c });
  }
};
// ---- 0x29c26: перед строкой взять x,y из [esi]/[esi+4]
F[0x29c26] = (eng, r) => { const m = eng.m; m.w32(X, m.u32(r.esi)); m.w32(Y, m.u32(r.esi + 4)); call(eng, 0x29c38, { esi: (r.esi + 8) >>> 0 }); };
// ---- 0x29c82: строка без разбора двухбайтовых символов
F[0x29c82] = (eng, r) => { const m = eng.m; let p = r.esi >>> 0; for (;;) { const c = m.u8(p); if (c === 0) return; call(eng, 0x29c93, { eax: c }); p++; } };

// ---- 0x28a94 / 0x28ab9: число → десятичная строка, запись задом наперёд от 0x446e8−1; возвращает edx — начало строки
F[0x28a94] = (eng, r) => { const m = eng.m; let a = r.eax >>> 0, p = 0x446e8, d = m.u32(0x446ea);
  do { p--; m.b[p] = 0x30 + (a % d); a = (a / d) >>> 0; } while (a); return { edx: p }; };
F[0x28ab9] = (eng, r) => { const m = eng.m; let a = r.eax & 0xffff, p = 0x446e8, d = m.u16(0x446ee);
  do { p--; m.b[p] = 0x30 + (a % d); a = (a / d) | 0; } while (a); return { edx: p }; };
F[0x28add] = (eng, r) => call(eng, 0x28ab9, { eax: r.eax & 0xff });

// ---- 0x2572f: тексты поверх карты — чат игроков (y 304, шаг 16), счётчик еды «FOODS=» в (260,0),
// сообщение в (120,380) цветом 0xc4, еда выделенного своего юнита в (0,464). Таймеры отсчитываются по [0x46c].
F[0x2572f] = (eng) => {
  const m = eng.m, b = m.b;
  b[COL] = 0xf8; b[BG] = 0; m.w32(Y, 0x130);
  for (let i = 0; i < 8; i++) {                                  // строки чата: [0x333c1+i] — сколько тиков ещё показывать
    if (b[0x333c1 + i]) {
      m.w32(X, 0);
      call(eng, 0x29c38, { esi: m.u32(0x41a38 + b[0x333b8 + i] * 4) });   // имя игрока
      call(eng, 0x29c38, { esi: 0x41a65 });                               // «] »
      call(eng, 0x29c38, { esi: (i << 6) + 0x333ca });                    // сам текст
    }
    m.w32(Y, m.u32(Y) + 0x10);
  }
  if (b[0x333c9]) { m.w32(X, 0); m.w32(Y, 0x1b0); call(eng, 0x29c38, { esi: 0x41a5c }); if (F[0x2a913]) call(eng, 0x2a913, {}); }
  b[COL] = 0xf8;
  const pl = m.u16(0x31b64);
  if (m.u32(0x31c48 + pl * 4)) {
    m.w32(X, 0x104); m.w32(Y, 0);
    call(eng, 0x29c38, { esi: 0x41924 });                                  // «FOODS=»
    const s = call(eng, 0x28a94, { eax: m.u32(0x31c28 + pl * 4) });
    call(eng, 0x29c82, { esi: s.edx });
  }
  if (m.u32(0x41910) !== 0x41938) {                                        // всплывающее сообщение живёт [0x41922] тиков таймера
    m.w32(X, 0x78); m.w32(Y, 0x17c); b[COL] = 0xc4;
    call(eng, 0x29c38, { esi: m.u32(0x41910) });
    b[COL] = 0xf8;
    const t = m.u16(0x46c);
    if (m.u16(0x41920) !== t) { m.w16(0x41920, t); m.w16(0x41922, (m.u16(0x41922) - 1) & 0xffff); if (m.u16(0x41922) === 0) m.w32(0x41910, 0x41938); }
    // В оригинале здесь стоял выход (je 0x2593d): пока висит сообщение «атакован», нижняя строка
    // на этом кадре не рисовалась. В DOS кадр совпадал с тиком таймера, поэтому выход срабатывал
    // ровно один раз и никто этого не видел. У нас кадров в разы больше, чем тиков, и выход
    // срабатывал через раз — нижняя строка мигала всё время, пока бьют дом (жалоба владельца).
    // Сверке с эталоном это не мешает: там кадр по-прежнему один на тик, и ветка не достигается.
  }
  m.w32(X, 0); m.w32(Y, 0x1d0);
  const sel = m.u32(0x31adc);
  if (sel && b[UNITS + sel + U.OWNER] === b[0x31b64] && b[UNITS + sel + U.TYPE] < 0x1a) {
    const s = call(eng, 0x28ab9, { eax: m.u16(UNITS + sel + U.FOOD) });     // еда, которую несёт юнит
    let d = 0x42286, p = s.edx; for (;;) { const c = b[p]; b[d] = c; if (!c) break; p++; d++; }
    call(eng, 0x29c38, { esi: 0x42280 });
    m.w32(X, m.u32(X) + 0x10);
  }
  if (m.u16(0x4191e)) { call(eng, 0x29c38, { esi: m.u32(0x41914) }); call(eng, 0x29c38, { esi: m.u32(0x41918) }); }
  const t = m.u16(0x46c);
  if (m.u16(0x4191c) !== t) {
    m.w16(0x4191c, t);
    if (m.u16(0x4191e)) m.w16(0x4191e, (m.u16(0x4191e) - 1) & 0xffff);
    for (let i = 0; i < 8; i++) if (b[0x333c1 + i]) b[0x333c1 + i]--;
  }
};

// ---- 0x25f94: всплывающая надпись над юнитом (эффект №58 в 0x25cbc) — строка из таблицы 0x42410, цвет из записи эффекта
F[0x25f94] = (eng, r) => {
  const m = eng.m, e = r.esi >>> 0;
  if (m.u16(e + 0xf2514)) return;
  const u = m.u32(e + 0xf2508);
  m.w32(X, (m.u16(u + 0xe442f) - m.u32(0x31ae8)) | 0);
  m.w32(Y, (m.u16(u + 0xe4431) - m.u32(e + 0xf2510) - m.u32(0x31aec)) | 0);
  m.b[COL] = m.u8(e + 0xf2507); m.b[BG] = 0;
  call(eng, 0x29c38, { esi: m.u32(m.u32(e + 0xf250c) + 0x42410) });
};
