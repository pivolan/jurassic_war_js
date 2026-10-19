// Тема E: очередь приказов, раздача приказов из UI, ИИ компьютерного игрока, функции конца шага, проверка победы.
// Порт pwar.exe (адреса оригинала в комментариях). Память — только через eng.m по адресам оригинала.
import { F, call } from '../fn.js';
import { G, U, UNITS } from '../mem.js';
import { человек } from './humans.js';   // люди в партии — общие для всех машин (сетевая игра)

/** Адрес поля off в записи юнита i. */
const u = (i, off) => UNITS + i + off;
/** 16-битное со знаком. */
const s16 = v => (v << 16) >> 16;

// ---------------------------------------------------------------- очередь приказов
// 0x14895: добавить запись (al=код, si=юнит, di=цель, dx=X, bx=Y); сетевая часть (контрольная сумма/COM) — только при [31b69]!=0
F[0x14895] = (eng, r) => {
  const m = eng.m; const ecx = m.u32(0x33c7c);
  m.w8(ecx + 1, r.eax & 0xff); m.w16(ecx + 2, r.esi); m.w16(ecx + 4, r.edi); m.w16(ecx + 6, r.edx); m.w16(ecx + 8, r.ebx);
  m.w8(ecx, m.u8(0x333c0)); m.w32(0x33c7c, ecx + 10);
  if (m.u8(0x31b69) !== 0) {                    // сеть: контрольная сумма (отправка в COM-порт не портируется)
    let v = m.u16(0x33c86); v = (v + (r.eax & 0xff)) & 0xffff; // add byte + adc — эквивалентно 16-битному сложению
    v = (v + (r.esi & 0xffff) + (r.edi & 0xffff) + (r.edx & 0xffff) + (r.ebx & 0xffff)) & 0xffff; m.w16(0x33c86, v);
  }
};

// 0x14854: снять «ожидающий клик-приказ»: al=[31acc], esi=[31ad0], edx=[31ad4], ebx=[31ad8]; [31acc]=0xff
F[0x14854] = (eng) => {
  const m = eng.m; const r = { eax: m.u8(0x31acc), esi: m.u32(0x31ad0), edx: m.u32(0x31ad4), ebx: m.u32(0x31ad8) };
  m.w8(0x31acc, 0xff); return r;
};

const TAB_141f8 = [0x14398, 0x145cd, 0x14621, 0x14621, 0x14642, 0x14673, 0x1468c, 0x1468d];
// Полная таблица 0x14218 — 72 записи (коды приказов 0xa0..0xe7), снята с образа. Раньше здесь
// было только 16, и всё, что дальше 0xaf, валилось с исключением: в частности приказ стройки
// 0xe0 и приказ кнопок панели 0xe1 (полосы статов, инвентарь).
const TAB_14218 = [
  0x1469a, 0x1469a, 0x1469a, 0x1469a, 0x1469a, 0x141f7, 0x146c5, 0x146c5,   // 0xa0..0xa7
  0x146c5, 0x1469a, 0x141f7, 0x1469a, 0x146c5, 0x146fa, 0x146c5, 0x141f7,   // 0xa8..0xaf
  0x1472c, 0x1472c, 0x146c5, ...Array(45).fill(0x141f7),                     // 0xb0..0xdf
  0x1474a, 0x14764, ...Array(6).fill(0x141f7),                               // 0xe0..0xe7
];
// 0x1472c: приказ «на себя» (0xb0/0xb1 — разведка рейнджера): ставит в очередь запись на
// выделенного юнита и помечает ему +0x43 битом 2. Раньше не был портирован — заклинания
// разведки просто пропадали из очереди.
F[0x1472c] = (eng, r) => { const m = eng.m; const esi = m.u32(0x31adc); if (esi === 0) return;
  m.w8(u(esi, U.FX43), m.u8(u(esi, U.FX43)) | 2);
  return F[0x14895](eng, { eax: r.eax, esi, edi: esi, edx: r.edx, ebx: r.ebx }); };
// 0x1474a: приказ стройки (0xe0) — ставит в очередь запись на выделенного юнита
F[0x1474a] = (eng, r) => { const m = eng.m; const esi = m.u32(0x31adc); if (esi === 0) return;
  return F[0x14895](eng, { eax: r.eax, esi, edi: esi, edx: r.edx, ebx: r.ebx }); };
// 0x14764: приказ кнопок панели (0xe1) — номер кнопки приходит в esi, юнит берётся выделенный
F[0x14764] = (eng, r) => { const m = eng.m; const sel = m.u32(0x31adc); if (sel === 0) return;
  return F[0x14895](eng, { eax: r.eax, esi: sel, edi: r.esi, edx: r.edx, ebx: r.ebx }); };
F[0x141f7] = () => {};
F[0x1468c] = () => {};
// 0x1419e: раздача ожидающих приказов UI по обработчикам
F[0x1419e] = (eng) => {
  const m = eng.m; m.w16(0x33c86, 0);
  let edi = 0;   // в оригинале edi при входе — мусор; для первой таблицы edi = код>>4 (mov edi,eax; shr edi,4)
  globalThis.__сч3 = 0;
  for (;;) { if (++globalThis.__сч3 > 3e6) throw new Error("ЦИКЛ orders_ai.js:56");
    const r = F[0x14854](eng); const al = r.eax & 0xff;
    if (al === 0xff) break;
    let h;
    if (al < 0x80) { h = TAB_141f8[al >> 4]; edi = al >> 4; }
    else { const idx = (al - 0xa0) & 0xff; if (idx >= TAB_14218.length) throw new Error('0x1419e: код приказа 0x' + al.toString(16)); h = TAB_14218[idx]; }
    call(eng, h, { eax: al, esi: r.esi, edx: r.edx, ebx: r.ebx, edi });
  }
  if (m.u8(0x31b69) !== 0) throw new Error('0x1419e: сеть не поддерживается');
};

// применение одной записи очереди к юниту (общий кусок 0x1403b/0x1409a/0x140f5/0x14150)
function applyRecord(m, ecx) {
  const esi = m.u16(ecx + 2);
  if (m.u8(u(esi, 0x46)) === 0x6f) return;
  const st = m.u8(u(esi, U.STATE)); if (st === 0x6f || st === 0x60) return;
  m.w8(u(esi, 0x46), m.u8(ecx + 1)); m.w32(u(esi, 0x47), m.u16(ecx + 4)); m.w16(u(esi, 0x4b), m.u16(ecx + 6)); m.w16(u(esi, 0x4d), m.u16(ecx + 8));
}
// 0x13f4c: начало шага — сброс очереди, раздача приказов UI, применение записей
F[0x13f4c] = (eng) => {
  const m = eng.m; m.w32(0x33c7c, 0x33c88);
  F[0x1419e](eng);
  if (m.u8(0x31b69) !== 0) throw new Error('0x13f4c: сеть не поддерживается');
  const end = m.u32(0x33c7c);
  if (m.u8(0x333c0) !== 0) {           // ветка 0x1402d (маркер игрока != 0): сначала записи 0xff, потом остальные
    for (let c = 0x33c88; c !== end; c += 10) if (m.u8(c) === 0xff) applyRecord(m, c);
    for (let c = 0x33c88; c !== end; c += 10) if (m.u8(c) !== 0xff) applyRecord(m, c);
  } else {                              // ветка 0x140e7: сначала не-0xff, потом 0xff
    for (let c = 0x33c88; c !== end; c += 10) if (m.u8(c) !== 0xff) applyRecord(m, c);
    for (let c = 0x33c88; c !== end; c += 10) if (m.u8(c) === 0xff) applyRecord(m, c);
  }
};

// ---------------------------------------------------------------- обработчики приказов UI (таблицы 0x141f8 / 0x14218)
const selected = (m, i) => (m.u8(u(i, U.F07)) & 0x80) !== 0;
/** Пройти весь список юнитов карты. */
function forEachUnit(m, fn) { for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(u(i, U.NEXT))) fn(i); }
/** Положить приказ в очередь движка (та же 0x14895, что и у игрока). */
const add = (eng, code, esi, edi, dx, bx) => F[0x14895](eng, { eax: code, esi, edi, edx: dx & 0xffff, ebx: bx & 0xffff });

// 0x1477e: расчёт сетки построения по числу выделенных [33be0]
F[0x1477e] = (eng) => {
  const m = eng.m; const cnt = m.u32(0x33be0); let edx = 0, found = false;
  for (let k = 0; k < 0x1c; k++) { if (m.u32(0x33c0c + edx * 4) >= cnt) { found = true; break; } edx++; }
  edx = edx + 1; m.w32(0x33c04, edx); m.w32(0x33c08, edx);
  edx = (edx >>> 1) << 5;
  let cx = m.u16(0x33be4) - (edx & 0xffff); if (cx < 0) cx = 0; let bx = m.u16(0x33be6) - (edx & 0xffff); if (bx < 0) bx = 0;
  m.w16(0x33bf8, cx); m.w16(0x33bfa, bx); m.w32(0x33bfc, 1); m.w32(0x33c00, 1);
};
// 0x147e7: следующая позиция в сетке построения -> edx, ebx
F[0x147e7] = (eng) => {
  const m = eng.m; let edx = m.u32(0x33bfc), ebx = m.u32(0x33c00);
  m.w32(0x33bfc, edx + 1);
  if (!(m.u32(0x33c04) > edx)) { m.w32(0x33bfc, 1); m.w32(0x33c00, ebx + 1); }
  edx = (edx << 5) >>> 0; ebx = (ebx << 5) >>> 0;
  edx = ((edx & 0xffff0000) | ((edx + m.u16(0x33bf8)) & 0xffff)) >>> 0; ebx = ((ebx & 0xffff0000) | ((ebx + m.u16(0x33bfa)) & 0xffff)) >>> 0;
  if (!(m.u32(G.mapW) > (edx >>> 5))) edx = ((m.u32(G.mapW) - 1) << 5) >>> 0;
  if (!(m.u32(G.mapH) > (ebx >>> 5))) ebx = ((m.u32(G.mapH) - 1) << 5) >>> 0;
  return { edx, ebx };
};
// 0x14398: приказ «идти» (0x0f) всем выделенным с построением
F[0x14398] = (eng, r) => {
  const m = eng.m; const edi = r.esi; const dx0 = r.edx & 0xffff, bx0 = r.ebx & 0xffff;
  m.w16(0x33be4, dx0); m.w16(0x33be6, bx0); m.w32(0x33be8, 0xffffffff); m.w32(0x33bec, 0); m.w32(0x33be0, 0);
  forEachUnit(m, i => {
    if (!selected(m, i)) return;
    const x = m.u16(u(i, U.X)), y = m.u16(u(i, U.Y));
    if (!(m.u16(0x33be8) < x)) m.w16(0x33be8, x);
    if (!(m.u16(0x33bec) > x)) m.w16(0x33bec, x);
    if (!(m.u16(0x33bea) < y)) m.w16(0x33bea, y);
    if (!(m.u16(0x33bee) > y)) m.w16(0x33bee, y);
    m.w32(0x33be0, m.u32(0x33be0) + 1);
  });
  m.w32(0x33bec, m.u32(0x33bec) + 0x200020); m.w32(0x33be8, m.u32(0x33be8) & 0xffe0ffe0); m.w32(0x33bec, m.u32(0x33bec) & 0xffe0ffe0);
  const ax = (m.u16(0x33bec) - m.u16(0x33be8)) & 0xffff; const bx = (m.u16(0x33bee) - m.u16(0x33bea)) & 0xffff;
  m.w16(0x33bf0, ax); m.w16(0x33bf2, bx);
  let offsetMove = m.u8(0x44792) === 1 || m.u8(0x4479e) === 1;
  if (!offsetMove) {
    const prod = ax * bx;                                 // mul bx -> dx:ax
    const q = Math.floor(prod / 0x400); if (q > 0xffff) throw new Error('0x14398: div overflow');
    const eax = q >>> 1;
    if (m.u32(0x33be0) >= eax) offsetMove = true;
    else {
      F[0x1477e](eng);
      forEachUnit(m, i => {
        if (!selected(m, i)) return;
        const p = F[0x147e7](eng); const dx = p.edx & 0xffff, by = p.ebx & 0xffff;
        if (m.u8(u(i, U.STATE)) === 0 && m.u16(u(i, U.DSTX)) === dx && m.u16(u(i, U.DSTY)) === by) return;
        add(eng, 0x0f, i, edi, p.edx, p.ebx);
      });
      return;
    }
  }
  // 0x144e7: сдвиг всей группы с сохранением взаимного расположения
  let cx = ((m.u16(0x33bf0) >>> 1) + m.u16(0x33be8)) & 0xffe0; let cy = ((m.u16(0x33bf2) >>> 1) + m.u16(0x33bea)) & 0xffe0;
  m.w16(0x33bf4, cx); m.w16(0x33bf6, cy);
  forEachUnit(m, i => {
    if (!selected(m, i)) return;
    let dx = s16(((m.u16(u(i, U.X)) & 0xffe0) - m.u16(0x33bf4) + m.u16(0x33be4)) & 0xffff);
    let by = s16(((m.u16(u(i, U.Y)) & 0xffe0) - m.u16(0x33bf6) + m.u16(0x33be6)) & 0xffff);
    dx >>= 5; if (dx < 0) dx = 0; else { if (!(s16(m.u16(G.mapW)) > dx)) dx = m.u32(G.mapW) - 1; dx = (dx << 5) >>> 0; }
    by >>= 5; if (by < 0) by = 0; else { if (!(s16(m.u16(G.mapH)) > by)) by = m.u32(G.mapH) - 1; by = (by << 5) >>> 0; }
    if (m.u8(u(i, U.STATE)) === 0 && m.u16(u(i, U.DSTX)) === (dx & 0xffff) && m.u16(u(i, U.DSTY)) === (by & 0xffff)) return;
    add(eng, 0x0f, i, edi, dx, by);
  });
};
// 0x145cd: атаковать цель edi всеми выделенными
F[0x145cd] = (eng, r) => {
  const m = eng.m; const edi = r.esi; const code = r.eax & 0xff;
  forEachUnit(m, i => {
    if (!selected(m, i) || edi === i) return;
    m.w8(u(edi, U.FX43), m.u8(u(edi, U.FX43)) | 2);
    if ((m.u8(u(i, U.STATE)) & 0xf0) === 0x10 && m.u32(u(i, U.TARGET)) === edi && m.u16(u(i, U.DSTX)) === (r.edx & 0xffff) && m.u16(u(i, U.DSTY)) === (r.ebx & 0xffff)) return;
    add(eng, code, i, edi, r.edx, r.ebx);
  });
};
// 0x14621: приказ всем выделенным без проверок
F[0x14621] = (eng, r) => { const m = eng.m; forEachUnit(m, i => { if (selected(m, i)) add(eng, r.eax & 0xff, i, r.esi, r.edx, r.ebx); }); };
// 0x14642: приказ выбранному юниту [31adc], если он не в состоянии 0x4x с той же целью
F[0x14642] = (eng, r) => {
  const m = eng.m; const esi = m.u32(0x31adc); if (esi === 0) return;
  if ((m.u8(u(esi, U.STATE)) & 0xf0) === 0x40 && m.u16(u(esi, U.DSTX)) === (r.edx & 0xffff) && m.u16(u(esi, U.DSTY)) === (r.ebx & 0xffff)) return;
  add(eng, r.eax & 0xff, esi, r.edi, r.edx, r.ebx);   // цель = edi (в 0x1419e это код>>4)
};
// 0x14673: приказ выбранному юниту с целью edi + пометка цели
F[0x14673] = (eng, r) => {
  const m = eng.m; const edi = r.esi; const esi = m.u32(0x31adc); if (esi === 0) return;
  add(eng, r.eax & 0xff, esi, edi, r.edx, r.ebx); m.w8(u(edi, U.FX43), m.u8(u(edi, U.FX43)) | 2);
};
// 0x1468d: приказ выбранному юниту (цель = esi из приказа)
F[0x1468d] = (eng, r) => { const m = eng.m; add(eng, r.eax & 0xff, m.u32(0x31adc), r.esi, r.edx, r.ebx); };
// 0x1469a: заклинание на цель edi выбранным юнитом (проверка доступности 0x14873)
F[0x1469a] = (eng, r) => {
  const m = eng.m; if (m.u32(0x31adc) === 0) return;
  const edi = r.esi, esi = m.u32(0x31adc); m.w8(u(edi, U.FX43), m.u8(u(edi, U.FX43)) | 2);
  const chk = call(eng, 0x14873, { eax: ((r.eax & 0xff) - 0x98) & 0xff, esi, edi, edx: r.edx, ebx: r.ebx });
  if (chk.cf) return;
  add(eng, r.eax & 0xff, esi, edi, r.edx, r.ebx);
};
// 0x146c5: заклинание на цель всеми выделенными
F[0x146c5] = (eng, r) => {
  const m = eng.m; const edi = r.esi; m.w8(u(edi, U.FX43), m.u8(u(edi, U.FX43)) | 2);
  forEachUnit(m, i => {
    if (!selected(m, i)) return;
    const chk = call(eng, 0x14873, { eax: ((r.eax & 0xff) - 0x98) & 0xff, esi: i, edi, edx: r.edx, ebx: r.ebx });
    if (chk.cf) return;
    add(eng, r.eax & 0xff, i, edi, r.edx, r.ebx);
  });
};
// 0x146fa: заклинание в точку курсора [31ae8],[31aec] выбранным юнитом
F[0x146fa] = (eng, r) => {
  const m = eng.m; if (m.u32(0x31adc) === 0) return;
  const edi = r.esi, esi = m.u32(0x31adc);
  const chk = call(eng, 0x14873, { eax: ((r.eax & 0xff) - 0x98) & 0xff, esi, edi, edx: r.edx, ebx: r.ebx });
  if (chk.cf) return;
  add(eng, r.eax & 0xff, esi, edi, m.u16(0x31ae8), m.u16(0x31aec));
};

// ---------------------------------------------------------------- прямые приказы (без очереди)
// 0x19f43: «идти в точку» (dx,bx) для юнита esi
F[0x19f43] = (eng, r) => { const m = eng.m; m.w32(u(r.esi, 0x47), 0); m.w8(u(r.esi, 0x46), 0x0f); m.w16(u(r.esi, 0x4b), r.edx); m.w16(u(r.esi, 0x4d), r.ebx); };

// ---------------------------------------------------------------- сетки: занять/освободить тайл
// 0x1a3db: записать владельца юнита в сетку (BI биты 2..7, для летающих 0x0b — MO старший ниббл); dx,bx = пиксели
F[0x1a3db] = (eng, r) => {
  const m = eng.m; const esi = r.esi; const tx = (r.edx & 0xffff) >>> 5, ty = (r.ebx & 0xffff) >>> 5;
  m.w8(u(esi, 0x53), tx); m.w8(u(esi, 0x54), ty);
  const cell = (ty << 8) + tx; const al = (m.u8(u(esi, U.OWNER)) + 1) & 0xff;
  if (m.u8(u(esi, U.TYPE)) !== 0x0b) { m.w8(0x10ce74 + cell, (m.u8(0x10ce74 + cell) & 3) | ((al << 2) & 0xff)); }
  else { m.w8(0x117e74 + cell, (m.u8(0x117e74 + cell) & 0xf) | ((al << 4) & 0xff)); }
};
// 0x1a42c: освободить тайл
F[0x1a42c] = (eng, r) => {
  const m = eng.m; const esi = r.esi; const tx = (r.edx & 0xffff) >>> 5, ty = (r.ebx & 0xffff) >>> 5;
  m.w8(u(esi, 0x53), tx); m.w8(u(esi, 0x54), ty);
  const cell = (ty << 8) + tx;
  if (m.u8(u(esi, U.TYPE)) !== 0x0b) m.w8(0x10ce74 + cell, m.u8(0x10ce74 + cell) & 3);
  else m.w8(0x117e74 + cell, m.u8(0x117e74 + cell) & 0xf);
};

// ---------------------------------------------------------------- конец шага
// 0x200fe: очередь звуков (звук не портируется): при включённом звуке [30c4c]==1 обнулить все ненулевые заявки
F[0x200fe] = (eng) => {
  const m = eng.m; if (m.u8(0x30c4c) !== 1) return;
  for (let i = 0; i < 0x6f; i++) if (m.u32(0x38870 + i * 8) !== 0) m.w32(0x38870 + i * 8, 0);
};
// таблицы обработчиков снарядов (0x1ab84 по типу 0..0x44, 0x1ac98 по типу-0x80)
const TAB_1ab84 = [0x1ab80, ...Array(56).fill(0x1ad3c), 0x1ab80, 0x1aeaf, 0x1ab80, ...Array(8).fill(0x1ad3c), 0x1aef4];
const TAB_1ac98 = [0x1b02c, 0x1b040, 0x1b054, 0x1b08f, 0x1b0ca, 0x1ab80, 0x1ab80, 0x1b277, 0x1b2a9, 0x1b2db, 0x1ab80, 0x1b2ef, 0x1b3de, 0x1b3df, 0x1b529, 0x1ab80, 0x1b58f, 0x1b637, 0x1b6a3,
  ...Array(13).fill(0x1ab80), ...Array(9).fill(0x1b0de)];
F[0x1ab80] = () => {};
// 0x1ab4c: обход списка снарядов [31b74] с диспетчером по типу [esi+0xf2504]
F[0x1ab4c] = (eng) => {
  const m = eng.m;
  for (let esi = m.u32(0x31b74); esi !== 0;) {
    const next = m.u32(esi + 0xf2524); const al = m.u8(esi + 0xf2504);
    let h; if (al < 0x80) { h = TAB_1ab84[al]; } else { h = TAB_1ac98[al - 0x80]; }
    if (h === undefined) throw new Error('0x1ab4c: тип снаряда 0x' + al.toString(16));
    call(eng, h, { esi, eax: al < 0x80 ? al : al - 0x80 });
    esi = next;
  }
};
// 0x1c340: отметить тайлы с предметами (бит 1 BI)
F[0x1c340] = (eng) => {
  const m = eng.m;
  for (let esi = m.u32(0x31b7c); esi !== 0; esi = m.u32(esi + 0xf4f40)) {
    const cell = (m.u8(esi + 0xf4f36) << 8) + m.u8(esi + 0xf4f35);
    m.w8(0x10ce74 + cell, m.u8(0x10ce74 + cell) | 2);
  }
};
// 0x1c370: гниение трупов / исчезновение предметов (раз в 128 шагов из ИИ-диспетчера)
F[0x1c370] = (eng) => {
  const m = eng.m; let esi = m.u32(0x31b7c);
  while (esi !== 0) {
    const t = m.u8(esi + 0xf4f34); let remove = false;
    if (t === 0x1e) { remove = ((m.u16(esi + 0xf4f3a) - 1) & 0xffff) === 0; m.w16(esi + 0xf4f3a, m.u16(esi + 0xf4f3a) - 1); }
    else if (t < 0x0f) {
      const c = (m.u16(esi + 0xf4f38) - 1) & 0xffff; m.w16(esi + 0xf4f38, c);
      if (c === 0) { const d = (m.u16(esi + 0xf4f3a) - 1) & 0xffff; m.w16(esi + 0xf4f3a, d); remove = d === 0; }
    }
    if (remove) {
      const cell = (m.u8(esi + 0xf4f36) << 8) + m.u8(esi + 0xf4f35);
      m.w8(0x10ce74 + cell, m.u8(0x10ce74 + cell) & 0xfd);
      const next = m.u32(esi + 0xf4f40); call(eng, 0x1ca9f, { esi }); esi = next;
    } else esi = m.u32(esi + 0xf4f40);
  }
};

// ---------------------------------------------------------------- ИИ компьютерного игрока
const slotOwner = (m, s) => m.u8(0x32ae4 + s);
/** Состояние машины ИИ оригинала для слота s (таблица 0x32aec). */
const aiState = (m, s) => m.u8(0x32aec + s);
/** Слово из таблицы ИИ по слоту. */
const A16 = (m, base, s) => m.u16(base + s * 2);
/** Записать слово в таблицу ИИ по слоту. */
const W16 = (m, base, s, v) => m.w16(base + s * 2, v);
/** Адрес записи «задача атаки» слота s. */
const taskAttack = (m, s) => m.u32(0x36684 + s * 4) + 0x32c1c;
/** Адрес записи «задача обороны» слота s. */
const taskDefense = (m, s) => m.u32(0x36684 + s * 4) + 0x32bcc;

F[0x157e9] = (eng, r) => { eng.m.w8(0x32aec + r.ebx, 0); };
F[0x157f1] = (eng, r) => { eng.m.w8(0x32aec + r.ebx, 1); };
F[0x157fb] = (eng, r) => { eng.m.w8(0x32aec + r.ebx, 4); W16(eng.m, 0x32b7c, r.ebx, 0); };

// 0x15d79: есть ли живой юнит владельца al -> cf=1
F[0x15d79] = (eng, r) => {
  const m = eng.m; const al = r.eax & 0xff;
  for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(u(i, U.NEXT))) if (m.u8(u(i, U.OWNER)) === al && (m.u8(u(i, U.FLAGS5B)) & 1) === 0) return { cf: 1, edi: i };
  return { cf: 0, edi: 0 };
};
// 0x15e45: следующий враг из таблицы 0x32d2c для слота [36680]
F[0x15e45] = (eng) => {
  const m = eng.m; const ebx = m.u32(0x36680);
  let al = (m.u8(0x32afc + ebx) + 1) & 0xff; if (al >= 8) al = 1; m.w8(0x32afc + ebx, al);
  const edx = m.u8(0x32af4 + ebx); const edi = (ebx << 5) + m.u8(0x32afc + ebx);
  m.w8(0x32b04 + ebx, m.u8(0x32d2c + edi + edx * 8));
};
// 0x15c07: поиск чужого юнита в прямоугольнике edi (u16 x1,y1,x2,y2) с HP < ax и ATK+DEF < dx -> cf=0, ebp=юнит
F[0x15c07] = (eng, r) => {
  const m = eng.m; const edi = r.edi; const ax = r.eax & 0xffff, dx = r.edx & 0xffff;
  const owner = slotOwner(m, m.u8(0x36680));
  for (let p = m.u32(G.unitHead); p !== 0; p = m.u32(u(p, U.NEXT))) {
    if (m.u8(u(p, U.FLAGS5B)) & 1) continue;
    const x = m.u16(u(p, U.X)); if (m.u16(edi) > x || m.u16(edi + 4) < x) continue;
    const y = m.u16(u(p, U.Y)); if (m.u16(edi + 2) > y || m.u16(edi + 6) < y) continue;
    const st = m.u8(u(p, U.STATE)); if (st >= 0x60 && st <= 0x6f) continue;
    if (m.u8(u(p, U.OWNER)) === owner) continue;
    if (ax <= m.u8(u(p, U.HP))) continue;
    const ad = m.u8(u(p, U.ATK)) + m.u8(u(p, U.DEF)); if (dx <= ad) continue;
    return { cf: 0, ebp: p };
  }
  return { cf: 1 };
};
// 0x15ca1: найти юнит владельца al, ближайший... к юниту своей группы edi (см. оригинал: выбирается максимум по [36a00]); cf=0, ebp=юнит
F[0x15ca1] = (eng, r) => {
  const m = eng.m; const al = r.eax & 0xff; let ebp = m.u32(G.unitHead); if (ebp === 0) return { cf: 1 };
  const cl = m.u8(0x36680); const ch = slotOwner(m, cl); if (ch === al) return { cf: 1 };
  for (; ebp !== 0; ebp = m.u32(u(ebp, U.NEXT))) {
    if (m.u8(u(ebp, U.SLOT)) !== cl || m.u8(u(ebp, U.OWNER)) !== ch || m.u8(u(ebp, U.FLAGS5B)) !== 1) continue;
    if (m.u8(u(ebp, U.F08)) === (r.edi & 0xff)) break;
  }
  if (ebp === 0) return { cf: 1 };
  for (let esi = m.u32(G.unitHead); esi !== 0; esi = m.u32(u(esi, U.NEXT))) {
    if (m.u8(u(esi, U.OWNER)) !== al || (m.u8(u(esi, U.FLAGS5B)) & 1)) continue;
    const px = m.u16(u(ebp, U.X)), sx = m.u16(u(esi, U.X)), py = m.u16(u(ebp, U.Y)), sy = m.u16(u(esi, U.Y));
    let dx = (px - sx) & 0xffff; if (px < sx) dx = (-dx) & 0xffff;   // sub/jae/neg — по беззнаковому переносу
    let ax = (py - sy) & 0xffff; if (py < sy) ax = (-ax) & 0xffff;
    if (!(dx < ax)) dx = ax;
    if (m.u16(0x36a00) >= dx) continue;
    m.w16(0x36a00, dx); m.w32(0x369fc, esi);
  }
  if (m.u32(0x369fc) === 0) return { cf: 1 };
  return { cf: 0, ebp: m.u32(0x369fc) };
};
// 0x15b20: выбрать цель для задачи атаки esi слота ebx (здания владельца-цели с шансом 50%, иначе юниты)
function fillTask(m, esi, unit) {
  m.w8(esi, 4); m.w32(esi + 2, unit);
  m.w16(esi + 6, m.u16(u(unit, U.X)) & 0xffe0); m.w16(esi + 8, m.u16(u(unit, U.Y)));   // shl ax,0xe0 -> сдвиг на 0 бит
}
F[0x15b20] = (eng, r) => {
  const m = eng.m; const esi = r.esi, ebx = r.ebx;
  m.w8(0x36a02, 1); m.w32(G.rngRange, 0x32); const dl = eng.rand_raw() & 0xff;
  const cl = m.u8(0x32b04 + ebx);
  // ВНИМАНИЕ: в оригинале обе петли по списку юнитов содержат `or edx,edx; je <начало>` (ошибка: je вместо jne):
  // проверяется только первый юнит списка; если его next == 0 — переход к записи 0 и дальше по её next. Воспроизводим буквально.
  const scan = (buildings) => {
    let edx = m.u32(G.unitHead); let guard = 0;
    globalThis.__сч4 = 0;
    for (;;) { if (++globalThis.__сч4 > 3e6) throw new Error("ЦИКЛ orders_ai.js:357");
      if (m.u8(u(edx, U.OWNER)) === cl && (m.u8(u(edx, U.TYPE)) >= 0x1a) === buildings && (m.u8(u(edx, U.FLAGS5B)) & 1) === 0) return edx;
      edx = m.u32(u(edx, U.NEXT));
      if (edx !== 0) return 0;
      if (++guard > 100000) throw new Error('0x15b20: зацикливание на записи 0');
    }
  };
  let mode = dl < 0x19 ? 'B' : 'U';
  globalThis.__сч5 = 0;
  for (;;) { if (++globalThis.__сч5 > 3e6) throw new Error("ЦИКЛ orders_ai.js:365");
    if (mode === 'B') { const e = scan(true); if (e) { fillTask(m, esi, e); return; } m.w8(0x36a02, 0); }
    const e = scan(false); if (e) { fillTask(m, esi, e); return; }
    if (m.u8(0x36a02) === 1) { mode = 'B'; continue; }
    m.w8(esi, 0xc); m.w8(esi + 1, 3); return;
  }
};
// 0x15ac6: всем юнитам слота ebx с группой dl — приказ идти к точке спавна
F[0x15ac6] = (eng, r) => {
  const m = eng.m; const bl = r.ebx & 0xff; const bh = slotOwner(m, r.ebx); const al = r.edx & 0xff;
  for (let esi = m.u32(G.unitHead); esi !== 0; esi = m.u32(u(esi, U.NEXT))) {
    if (m.u8(u(esi, U.SLOT)) !== bl || m.u8(u(esi, U.OWNER)) !== bh || m.u8(u(esi, U.F08)) !== al || (m.u8(u(esi, U.FLAGS5B)) & 1)) continue;
    F[0x19f43](eng, { esi, edx: m.u8(u(esi, 0x59)) << 5, ebx: m.u8(u(esi, 0x5a)) << 5 });
  }
};
// 0x15e82: «заказать» копию ударного юнита слота [36680] (создаёт юнит и сразу помечает мёртвым — таймер типа приведёт к заказу)
F[0x15e82] = (eng) => {
  const m = eng.m; const ah = m.u8(0x36680); const cl = slotOwner(m, ah);
  let edi = m.u32(G.unitHead);
  for (; edi !== 0; edi = m.u32(u(edi, U.NEXT))) if (m.u8(u(edi, U.SLOT)) === ah && m.u8(u(edi, U.OWNER)) === cl && m.u8(u(edi, U.F08)) === 2) break;
  if (edi === 0) return;
  const al = m.u8(u(edi, U.TYPE));
  const c = call(eng, 0x1caf0, { eax: (ah << 8) | al, edx: m.u8(u(edi, 0x59)) << 5, ebx: m.u8(u(edi, 0x5a)) << 5, esi: 0, edi, ecx: cl });   // ah = слот, cl = владелец
  if (c.cf) return;
  const esi = c.esi;
  m.w8(u(esi, U.F08), 2); m.w8(u(esi, U.FLAGS5B), 3); m.w16(u(esi, 0x4f), 0);
  F[0x1a42c](eng, { esi, edx: m.u16(u(esi, U.X)), ebx: m.u16(u(esi, U.Y)) });
  const ebx = m.u32(0x36680); W16(m, 0x32b1c, ebx, A16(m, 0x32b1c, ebx) + 1);
};
// 0x15f1c: набрать до 5 юнитов в группу обороны (f08=1) слота ebx владельца al
F[0x15f1c] = (eng, r) => {
  const m = eng.m; const bl = r.ebx & 0xff, al = r.eax & 0xff, ebx = r.ebx;
  for (let esi = m.u32(G.unitHead); esi !== 0; esi = m.u32(u(esi, U.NEXT))) {
    if (m.u8(u(esi, U.SLOT)) !== bl || m.u8(u(esi, U.OWNER)) !== al || (m.u8(u(esi, U.FLAGS5B)) & 1)) continue;
    if ((m.u8(u(esi, U.STATE)) & 0x60) === 0) continue;
    if (m.u8(u(esi, U.TYPE)) > 0x0d || m.u8(u(esi, U.F08)) !== 0) continue;
    m.w8(u(esi, U.F08), 1); W16(m, 0x32b0c, ebx, A16(m, 0x32b0c, ebx) + 1);
    if (((A16(m, 0x32b0c, ebx) - A16(m, 0x32b2c, ebx)) & 0xffff) >= 5) return;
  }
};
// 0x15a3e: вернуть на пост праздных юнитов слота esi
F[0x15a3e] = (eng, r) => {
  const m = eng.m; const cl = r.esi & 0xff; const ch = slotOwner(m, r.esi);
  for (let esi = m.u32(G.unitHead); esi !== 0; esi = m.u32(u(esi, U.NEXT))) {
    if (m.u8(u(esi, U.SLOT)) !== cl || m.u8(u(esi, U.OWNER)) !== ch || (m.u8(u(esi, U.FLAGS5B)) & 1)) continue;
    const st = m.u8(u(esi, U.STATE)); if (st === 0x60 || st === 0x6f) continue;
    if (m.u8(u(esi, U.F08)) !== 0) continue;
    const t = m.u8(u(esi, U.TYPE)); if (t >= 0x18 || t === 4) continue;
    if (st < 0x36 || st > 0x3f) continue;
    m.w16(u(esi, 0x44), m.u16(u(esi, 0x59)));
    call(eng, 0x1a354, { esi });
  }
};
// 0x15a0a: раз в 8192 шагов — «отвязка» для всех ИИ-слотов (кроме состояния 5)
F[0x15a0a] = (eng) => {
  const m = eng.m;
  for (let esi = 7; esi >= 0; esi--) {
    if (человек(m, slotOwner(m, esi))) continue;
    const st = aiState(m, esi); if (st === 0 || st === 5) continue;
    F[0x15a3e](eng, { esi });
  }
};
// 0x157e1: esi=ebx; 0x15a3e
F[0x157e1] = (eng, r) => { F[0x15a3e](eng, { esi: r.ebx }); };

// автомат задачи атаки, вариант из состояния 1 (0x1580e)
F[0x1580e] = (eng, r) => {
  const m = eng.m; const ebx = r.ebx; const esi = taskAttack(m, ebx);
  switch (m.u8(esi)) {
    case 0: if (A16(m, 0x32b1c, ebx) > A16(m, 0x32bbc, ebx)) return; m.w8(esi, 8); return;          // 0x15838
    case 4: return;
    case 8: { const c = F[0x15c07](eng, { eax: A16(m, 0x32b8c, ebx), edx: A16(m, 0x32b9c, ebx), edi: 0x32f4c + ebx * 8 });   // 0x1584f
      if (c.cf) { m.w8(esi, 0xc); m.w8(esi + 1, 3); } else { m.w8(esi, 4); m.w32(esi + 2, c.ebp); } return; }
    case 0xc: { const v = (m.u8(esi + 1) - 1) & 0xff; m.w8(esi + 1, v); if (v === 0) m.w8(esi, 8); return; }               // 0x1587c
    default: throw new Error('0x1580e: состояние задачи ' + m.u8(esi));
  }
};
// автомат задачи обороны (0x15885)
F[0x15885] = (eng, r) => {
  const m = eng.m; const ebx = r.ebx; const esi = taskDefense(m, ebx);
  switch (m.u8(esi)) {
    case 0: if (A16(m, 0x32b0c, ebx) > A16(m, 0x32b6c, ebx)) return; m.w8(esi, 8); return;          // 0x158ac
    case 4: return;
    case 8: { const c = F[0x15c07](eng, { eax: A16(m, 0x32b3c, ebx), edx: A16(m, 0x32b4c, ebx), edi: 0x32f4c + ebx * 8 });   // 0x158c3
      if (c.cf) { m.w8(esi, 0xc); m.w8(esi + 1, 3); } else { m.w8(esi, 4); m.w32(esi + 2, c.ebp); } return; }
    case 0xc: { const v = (m.u8(esi + 1) - 1) & 0xff; m.w8(esi + 1, v); if (v === 0) m.w8(esi, 8); return; }
    default: throw new Error('0x15885: состояние задачи ' + m.u8(esi));
  }
};
// общий хвост 0x1593b/0x159c3: цель для задачи по владельцу-цели
function targetByOwner(eng, m, esi, ebx, group) {
  const c = F[0x15ca1](eng, { eax: m.u8(0x32b04 + ebx), edi: group });
  if (!c.cf) { m.w8(esi, 4); m.w32(esi + 2, c.ebp); return; }
  const al = m.u8(0x32b04 + ebx);
  if (slotOwner(m, ebx) === al) { F[0x15e45](eng); return; }
  const d = F[0x15d79](eng, { eax: al });
  if (!d.cf) { F[0x15e45](eng); return; }
  m.w8(esi, 4); m.w32(esi + 2, d.edi);   // edi = найденный 0x15d79 живой юнит владельца
}
// автомат задачи атаки, вариант из состояний 4/5 (0x158fb)
F[0x158fb] = (eng, r) => {
  const m = eng.m; const ebx = r.ebx; const esi = taskAttack(m, ebx);
  switch (m.u8(esi)) {
    case 0: if (A16(m, 0x32b1c, ebx) > A16(m, 0x32bbc, ebx)) return; m.w8(esi, 8); return;
    case 4: return;
    case 8: targetByOwner(eng, m, esi, ebx, 2); return;
    case 0xc: { const v = (m.u8(esi + 1) - 1) & 0xff; m.w8(esi + 1, v); if (v === 0) m.w8(esi, 8); return; }
    default: throw new Error('0x158fb: состояние задачи ' + m.u8(esi));
  }
};
// автомат задачи обороны, вариант состояния 5 (0x15982)
F[0x15982] = (eng, r) => {
  const m = eng.m; const ebx = r.ebx; const esi = taskDefense(m, ebx);
  switch (m.u8(esi)) {
    case 0: if (A16(m, 0x32b0c, ebx) > A16(m, 0x32b6c, ebx)) return; m.w8(esi, 8); return;
    case 4: return;
    case 8: targetByOwner(eng, m, esi, ebx, 1); return;
    case 0xc: { const v = (m.u8(esi + 1) - 1) & 0xff; m.w8(esi + 1, v); if (v === 0) m.w8(esi, 8); return; }
    default: throw new Error('0x15982: состояние задачи ' + m.u8(esi));
  }
};
// обработчики по состоянию ИИ (ветка «раз в 16 шагов», таблица 0x156d0)
const TAB_156d0 = [0x157b6, 0x157b7, 0x157c4, 0x157c5, 0x157c6, 0x157d6, 0x157e0];
F[0x157b6] = () => {}; F[0x157c4] = () => {}; F[0x157c5] = () => {}; F[0x157e0] = () => {};
F[0x157b7] = (eng, r) => { F[0x15885](eng, r); F[0x1580e](eng, { ebx: eng.m.u32(0x36680) }); };
F[0x157c6] = (eng, r) => { F[0x15885](eng, r); F[0x158fb](eng, { ebx: eng.m.u32(0x36680) }); };
F[0x157d6] = (eng, r) => { F[0x15982](eng, r); F[0x158fb](eng, r); };
/** Хвост такта ИИ: разослать управление по состоянию слота (таблица 0x156d0). */
function tail156a5(eng, ebx) { const st = aiState(eng.m, ebx); const h = TAB_156d0[st]; if (h === undefined) throw new Error('ИИ: состояние ' + st); F[h](eng, { ebx }); }
// обработчики по состоянию ИИ (ветка «раз в 32 шага», таблица 0x156b4)
const TAB_156b4 = [0x156ec, 0x156ed, 0x1572d, 0x1572e, 0x1572f, 0x157ab, 0x157b5];
F[0x156ec] = () => {}; F[0x1572d] = () => {}; F[0x1572e] = () => {}; F[0x157b5] = () => {};
// 0x156ed: состояние 1 — накопление; при силе >= порога переход в атаку
F[0x156ed] = (eng, r) => {
  const m = eng.m; const ebx = r.ebx;
  const ax = (A16(m, 0x32b8c, ebx) + A16(m, 0x32b9c, ebx)) & 0xffff;
  if (ax < A16(m, 0x32c7c, ebx)) return;
  F[0x157fb](eng, { ebx }); const esi = taskAttack(m, ebx); W16(m, 0x32bbc, ebx, 0);
  F[0x15b20](eng, { esi, ebx }); tail156a5(eng, ebx);
};
// 0x1572f: состояние 4 — атака идёт; когда все ударные прибыли — подкрепление или отбой
F[0x1572f] = (eng, r) => {
  const m = eng.m; const ebx = r.ebx;
  if (A16(m, 0x32b7c, ebx) < A16(m, 0x32b1c, ebx)) return;
  m.w32(G.rngRange, 0x64); const dl = eng.rand_raw() & 0xff;
  if (dl < 0x32) F[0x15e82](eng);
  else { W16(m, 0x32c7c, ebx, A16(m, 0x32c7c, ebx) + 0x64); if (A16(m, 0x32c7c, ebx) > A16(m, 0x32bac, ebx)) W16(m, 0x32c7c, ebx, A16(m, 0x32bac, ebx)); }
  F[0x157f1](eng, { ebx }); W16(m, 0x32bbc, ebx, 0); F[0x15ac6](eng, { ebx, edx: 2 }); tail156a5(eng, ebx);
};
// 0x157ab: состояние 5 -> 1
F[0x157ab] = (eng, r) => { F[0x157f1](eng, r); tail156a5(eng, r.ebx); };
F[0x13f48] = () => {};
// 0x15634: диспетчер ИИ (конец шага)
F[0x15634] = (eng) => {
  const m = eng.m; const step = m.u32(G.step); const lo = step & 0xff;
  if ((lo & 0x1f) === 0) {
    F[0x13f48](eng);
    if ((lo & 0x7f) === 0) { F[0x1c370](eng); if ((step & 0x1fff) === 0) F[0x15a0a](eng); }
    const ebx = lo >>> 5; m.w32(0x36680, ebx);
    const st = aiState(m, ebx); const h = TAB_156b4[st]; if (h === undefined) throw new Error('ИИ: состояние ' + st);
    F[h](eng, { ebx });
  }
  if ((lo & 0xf) !== 0) return;
  const ebx = (lo & 0x70) >>> 4; m.w32(0x36680, ebx);
  if (aiState(m, ebx) === 0) return;
  tail156a5(eng, ebx);
};
// 0x15da1: инициализация ИИ при старте партии (не в тике)
F[0x15da1] = (eng) => {
  const m = eng.m;
  for (let ebx = 0; ebx < 8; ebx++) {
    m.w32(G.rngN, 4); m.w8(0x32afc + ebx, 1);
    const dl = call(eng, 0x204a6, {}).edx & 0xff; m.w8(0x32af4 + ebx, dl);
    m.w8(0x32b04 + ebx, m.u8(0x32d2c + (ebx << 5) + m.u8(0x32afc + ebx) + dl * 8));
    if (aiState(m, ebx) !== 0) {
      m.w8(0x32aec + ebx, 1); const edx = ebx * 10;
      m.w8(0x32bcc + edx, 8); m.w8(0x32bcd + edx, 0); m.w8(0x32c1c + edx, 8); m.w8(0x32c1d + edx, 0);
      W16(m, 0x32c7c, ebx, A16(m, 0x32c7c, ebx) + 0xc8);
      if (m.u8(G.difficulty) !== 2) { W16(m, 0x32c7c, ebx, A16(m, 0x32c7c, ebx) + 0x50); if (m.u8(G.difficulty) !== 1) W16(m, 0x32c7c, ebx, A16(m, 0x32c7c, ebx) + 0x50); }
    }
  }
};
// 0x17dd4: пересчитать цель ИИ-слота ax после смены владельцев
F[0x17dd4] = (eng, r) => {
  const m = eng.m; const eax = r.eax & 0xffff; const dl = slotOwner(m, eax); const esi = eax * 0x20; let ebx = m.u8(0x32af4 + eax) << 3; let ecx = 0; let edi;
  globalThis.__сч6 = 0;
  for (;;) { if (++globalThis.__сч6 > 3e6) throw new Error("ЦИКЛ orders_ai.js:549"); edi = m.u8(0x32d2c + esi + ebx); if (slotOwner(m, edi) !== dl) break; ebx++; ecx++; if (ecx >= 8) { edi = m.u8(0x32d2c + esi + ebx); break; } }
  m.w8(0x32afc + eax, ecx & 0xff); m.w8(0x32b04 + eax, edi & 0xff);
};
F[0x17d94] = (eng, r) => { const m = eng.m; const ebx = r.eax & 0xffff; if (человек(m, slotOwner(m, ebx))) return; F[0x157f1](eng, { ebx }); F[0x17dd4](eng, { eax: ebx }); };
F[0x17db1] = (eng, r) => { const m = eng.m; const ebx = r.eax & 0xffff; if (человек(m, slotOwner(m, ebx))) { F[0x157e9](eng, { ebx }); return; } F[0x157f1](eng, { ebx }); F[0x17dd4](eng, { eax: ebx }); };

// ---------------------------------------------------------------- победа / поражение (только симуляционная часть, без экранов)
// 0x17d5f: нет живых юнитов игрока -> [30349]=1, cf=1
F[0x17d5f] = (eng) => {
  const m = eng.m; const al = m.u8(G.humanOwner);
  for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(u(i, U.NEXT))) if (m.u8(u(i, U.OWNER)) === al && (m.u8(u(i, U.FLAGS5B)) & 1) === 0) return { cf: 0 };
  m.w8(G.endcode, 1); return { cf: 1 };
};
// 0x17879: счёт достроенных зданий владельца al по типу -> байты 0x36bc6+type (0x36be0..0x36bed)
F[0x17879] = (eng, r) => {
  const m = eng.m; const al = r.eax & 0xff; for (let a = 0x36be0; a < 0x36bf0; a++) m.w8(a, 0);
  for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(u(i, U.NEXT))) {
    if (m.u8(u(i, U.OWNER)) !== al || (m.u8(u(i, U.FLAGS5B)) & 1)) continue;
    const t = m.u8(u(i, U.TYPE)); if (t < 0x1a || (m.u8(u(i, U.FLAGS50)) & 2)) continue;
    m.w8(0x36bc6 + t, m.u8(0x36bc6 + t) + 1);
  }
};
// 0x178e7: счёт живых юнитов по владельцу -> u16 0x36bf0[owner]
F[0x178e7] = (eng) => {
  const m = eng.m; for (let a = 0x36bf0; a < 0x36c04; a += 2) m.w16(a, 0);
  for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(u(i, U.NEXT))) { if (m.u8(u(i, U.FLAGS5B)) & 1) continue; const o = m.u8(u(i, U.OWNER)); m.w16(0x36bf0 + o * 2, m.u16(0x36bf0 + o * 2) + 1); }
};
// 0x17947: счёт живых юнитов по типу -> u16 0x36c04[type]
F[0x17947] = (eng) => {
  const m = eng.m; for (let k = 0; k < 0x28; k++) m.w16(0x36c04 + k * 2, 0);
  for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(u(i, U.NEXT))) { if (m.u8(u(i, U.FLAGS5B)) & 1) continue; const t = m.u8(u(i, U.TYPE)); m.w16(0x36c04 + t * 2, m.u16(0x36c04 + t * 2) + 1); }
};
// 0x17989: миссия 1 — еда при юнитах игрока >= 3000 -> победа (cf=1); нет юнитов вообще -> поражение
F[0x17989] = (eng) => {
  const m = eng.m; let esi = m.u32(G.unitHead); if (esi === 0) { m.w8(G.endcode, 1); return { cf: 1 }; }
  const al = m.u8(G.humanOwner); let dx = 0;
  for (; esi !== 0; esi = m.u32(u(esi, U.NEXT))) {
    if (m.u8(u(esi, U.OWNER)) !== al || (m.u8(u(esi, U.FLAGS5B)) & 1)) continue;
    dx = (dx + m.u16(u(esi, U.FOOD))) & 0xffff; if (dx >= 0xbb8) { m.w8(G.endcode, 2); return { cf: 1 }; }
  }
  return { cf: 0 };
};
// 0x179d6: RaDumBa, миссия 1 — еда >= 3000 и уничтожен владелец 0
F[0x179d6] = (eng) => {
  const m = eng.m; if (!F[0x17989](eng).cf) return; if (m.u8(G.endcode) === 1) return;
  for (let esi = m.u32(G.unitHead); esi !== 0; esi = m.u32(u(esi, U.NEXT))) if (m.u8(u(esi, U.OWNER)) === 0 && (m.u8(u(esi, U.FLAGS5B)) & 1) === 0) { m.w8(G.endcode, 0); return; }
  m.w8(G.endcode, 2);
};
/** Байт памяти. */
const b = (m, a) => m.u8(a);
/** Условие победы «построить столько-то домов»: пересчитать и, если сошлось, поставить исход. */
const buildingsGoal = (cond) => (eng) => { const m = eng.m; F[0x17879](eng, { eax: m.u8(G.humanOwner) }); if (cond(m)) m.w8(G.endcode, 2); };
F[0x17a19] = buildingsGoal(m => b(m, 0x36be1) >= 3 && b(m, 0x36be9) >= 3);
F[0x17a3d] = buildingsGoal(m => b(m, 0x36be1) >= 2 && b(m, 0x36be5) >= 2);
F[0x17a61] = buildingsGoal(m => b(m, 0x36be8) >= 2 && b(m, 0x36be4) >= 4);
F[0x17a85] = buildingsGoal(m => ((b(m, 0x36be2) + b(m, 0x36be3)) & 0xff) >= 4 && b(m, 0x36be1) >= 3);
F[0x17aaf] = buildingsGoal(m => b(m, 0x36be1) >= 3 && b(m, 0x36be6) >= 3);
F[0x17ad3] = buildingsGoal(m => b(m, 0x36be1) >= 3 && ((b(m, 0x36be2) + b(m, 0x36be3)) & 0xff) >= 2);
F[0x17afd] = buildingsGoal(m => ((b(m, 0x36be2) + b(m, 0x36be3)) & 0xff) >= 3 && b(m, 0x36be4) >= 4);
F[0x17b27] = buildingsGoal(m => b(m, 0x36beb) >= 3);
/** Условие победы «такое-то племя истреблено». */
const ownerDead = (a) => (eng) => { const m = eng.m; F[0x178e7](eng); if (m.u16(a) === 0) m.w8(G.endcode, 2); };
F[0x17b42] = ownerDead(0x36bf2); F[0x17b59] = ownerDead(0x36bf0); F[0x17b70] = ownerDead(0x36bf6); F[0x17b87] = ownerDead(0x36bf4);
F[0x17b9e] = ownerDead(0x36bfa); F[0x17bb5] = ownerDead(0x36bf8); F[0x17bcc] = ownerDead(0x36bfe); F[0x17be3] = ownerDead(0x36bfc);
// 0x17bfa: миссия 5 — артефакт племени в инвентаре живого юнита игрока
F[0x17bfa] = (eng) => {
  const m = eng.m; const al = m.u8(G.humanOwner); const bl = m.u8(0x36c54 + al);
  for (let esi = m.u32(G.unitHead); esi !== 0; esi = m.u32(u(esi, U.NEXT))) {
    if (m.u8(u(esi, U.OWNER)) !== al || (m.u8(u(esi, U.FLAGS5B)) & 1)) continue;
    for (const off of [0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x24, 0x25, 0x26]) if (m.u8(u(esi, off)) === bl) { m.w8(G.endcode, 2); return; }
  }
};
// 0x17c79: миссия 6 — захватить святилище из таблицы 0x36c5c
F[0x17c79] = (eng) => {
  const m = eng.m; const al = m.u16(G.humanOwner); const esi = m.u32(0x36c5c + al * 4);
  if (m.u8(u(esi, U.FLAGS5B)) & 1) { m.w8(G.endcode, 1); return; }
  if (m.u8(u(esi, U.OWNER)) === (al & 0xff)) m.w8(G.endcode, 2);
};
// 0x17ca9: миссия 7 — истребить типы 14,16,17,19
F[0x17ca9] = (eng) => { const m = eng.m; F[0x17947](eng); if (m.u16(0x36c20) === 0 && m.u16(0x36c24) === 0 && m.u16(0x36c26) === 0 && m.u16(0x36c2a) === 0) m.w8(G.endcode, 2); };
// 0x17cde: миссия 8 — захватить два святилища из таблицы 0x36c7c
F[0x17cde] = (eng) => {
  const m = eng.m; const al = m.u16(G.humanOwner); const esi = m.u32(0x36c7c + al * 8), edi = m.u32(0x36c80 + al * 8);
  if ((m.u8(u(esi, U.FLAGS5B)) & 1) || (m.u8(u(edi, U.FLAGS5B)) & 1)) { m.w8(G.endcode, 1); return; }
  if (m.u8(u(esi, U.OWNER)) !== (al & 0xff) || m.u8(u(edi, U.OWNER)) !== (al & 0xff)) return;
  m.w8(G.endcode, 2);
};
// 0x17d28: миссии 9–12 — уничтожить всех чужих владельцев
F[0x17d28] = (eng) => {
  const m = eng.m; F[0x178e7](eng); const al = m.u8(G.humanOwner);
  for (let edi = 0; edi < 8; edi++) { if (slotOwner(m, edi) === al) continue; if (m.u16(0x36bf0 + edi * 2) !== 0) return; }
  m.w8(G.endcode, 2);
};
F[0x17d26] = (eng) => F[0x17d28](eng); F[0x17d59] = (eng) => F[0x17d28](eng); F[0x17d5c] = (eng) => F[0x17d28](eng);
// 0x17861: вызов обработчика цели миссии из таблицы 0x36a60[mission*8+tribe]
F[0x17861] = (eng) => {
  const m = eng.m; const ebx = (m.u8(G.mission) * 8 + m.u16(G.humanOwner)) & 0xffff;
  const h = m.u32(0x36a60 + ebx * 4); const f = F[h]; if (!f) throw new Error('0x17861: обработчик миссии 0x' + h.toString(16)); f(eng);
};
// 0x17728: проверка конца партии (одиночная игра); экраны победы/поражения не портируются
F[0x17728] = (eng) => {
  const m = eng.m; if (m.u8(0x31b69) === 1) throw new Error('0x17728: сеть не поддерживается');
  if (F[0x17d5f](eng).cf) return { cf: 1 };
  F[0x17861](eng);
  return { cf: 0 };
};
