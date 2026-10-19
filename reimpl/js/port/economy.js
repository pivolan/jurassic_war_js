// Тема C economy: добыча/перенос (состояния 0x4x/0x5x), здания (0x186b3), растения (0x18568),
// регенерация (0x18ab2), предметы на земле (пул 0xf4f34), создание юнитов (0x1caf0), очередь звуков (0x2000d).
// Построчный порт pwar.exe; адрес оригинала в имени/комментарии каждой функции.
const DUP = {}; // дубли функций, живут в другом модуле (см. dupes.mjs)
import { F, call } from '../fn.js';
import { G, U, UNITS, BI, MO, BG, ITEMS } from '../mem.js';
import { человек } from './humans.js';   // люди в партии — общие для всех машин (сетевая игра)
import * as Очередь from './prodqueue.js';   // очередь производства в здании (наше)

const SEL = 0x31adc;           // выделенный юнит (UI)
const FOOD = 0x31c28;          // еда по владельцу u32[8]
const NSTORE = 0x31c48;        // число складов по владельцу u32[8]
const ITEM_HEAD = 0x31b7c, ITEM_FREE = 0x31b80;
/** Усечение до 16 бит. */
const u16w = (v) => v & 0xffff;

// --- мелкие помощники приказов (0x1a34c / 0x1a354 / 0x1a35c)
F[0x1a34c] = (eng, r) => { eng.m.w8(UNITS + r.esi + U.ORDER, 0x3f); };
F[0x1a354] = (eng, r) => { eng.m.w8(UNITS + r.esi + U.ORDER, 0x37); };
F[0x1a35c] = (eng, r) => { // al=слот → приказ 0x51+слот, цель edi, точка dx/bx
  const m = eng.m, s = UNITS + r.esi;
  m.w8(s + U.ORDER, (r.eax + 0x51) & 0xff); m.w32(s + 0x47, r.edi); m.w16(s + 0x4b, r.edx); m.w16(s + 0x4d, r.ebx);
};

// --- 0x17fb4: обработчик типа 0 — пусто
F[0x17fb4] = () => {};

// --- UI-заглушки (панель выделенного юнита; памяти симуляции не касаются)
// В оригинале в этих местах вызывается 0x26671 (перерисовать инвентарь и статы выбранного юнита),
// а при потере выделения — полная перерисовка панели. В порту стояла пустая заглушка, из-за чего
// панель показывала устаревшее состояние: отданный предмет висел в инвентаре, пока не переключишь
// юнита, полоса заказа не двигалась и так далее.
// Всегда полная перерисовка (0x2661c): она сама разбирает, что выделено — юнит или здание.
// Дёргать напрямую 0x26671/0x2673d нельзя: у здания поверх его страницы окажется инвентарь юнита.
const ui = (eng) => { if (eng && F[0x2661c]) F[0x2661c](eng, {}); };
// 0x1a65d: снять выделение
F[0x1a65d] = (eng) => { const m = eng.m; m.w32(SEL, 0); m.w16(0x31aca, 0); m.w32(0x3034c, 0); ui(eng); };

// --- звук: 0x2000d кладёт запрос в очередь 0x38870 (8 байт на id); eax = id, esi = юнит
DUP[0x2000d] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi, eax = r.eax >>> 0;
  const view = ((m.u32(0x31af0) << 4) + m.u32(0x31ae8)) >>> 0;
  const x = m.u16(s + U.X);
  let c = (x - view) | 0, ebx, edx;
  if (c < 0) { c = (-c) >>> 5; ebx = m.u8(0x39060 + c); } else { c >>>= 5; ebx = m.u8(0x39161 + c); }
  c = (x - view) | 0;
  if (c < 0) { c = (-c) >>> 5; edx = m.u8(0x39161 + c); } else { c >>>= 5; edx = m.u8(0x39060 + c); }
  const cy = (0xf0 + m.u32(0x31aec)) >>> 0; let dy = (m.u16(s + U.Y) - cy) | 0; if (dy < 0) dy = -dy; dy >>>= 5;
  const att = m.u8(0x39262 + dy); let vol = m.u16(0x300a2) - att; if (vol <= 0) return;
  const k = (0xf - vol) >>> 0; ebx = (ebx >>> 0) < k ? 0 : (ebx - k) >>> 0; edx = (edx >>> 0) < k ? 0 : (edx - k) >>> 0;
  if (ebx + edx === 0) return;
  const q = 0x38870 + eax * 8;
  if (m.u32(q) === 0) { m.w32(q, eax); m.w16(q + 4, ebx); m.w16(q + 6, edx); return; }
  if (m.u16(q + 4) <= ebx) m.w16(q + 4, ebx);
  if (m.u16(q + 6) <= edx) m.w16(q + 6, edx);
};
/** Заявка на звук, если звук вообще включён. */
const sound = (eng, esi, id) => { if (eng.m.u8(0x30c4c) === 1) F[0x2000d](eng, { eax: id >>> 0, esi }); };
F[0x1ff1c] = (eng, r) => { const m = eng.m; if (m.u8(0x30c4c) === 1) F[0x2000d](eng, { eax: m.u32(0x38d98 + m.u8(UNITS + r.esi + U.TYPE) * 4), esi: r.esi }); };
F[0x1ffeb] = (eng, r) => sound(eng, r.esi, 0x6a);
DUP[0x1ffb6] = (eng, r) => { const m = eng.m; if (m.u8(0x30c4c) === 1) F[0x2000d](eng, { eax: m.u32(0x38fe4 + (r.eax >>> 0) * 4), esi: r.esi }); };
F[0x1fd8b] = () => {};   // прямой вызов звукового модуля — без эффекта в памяти

// --- 0x18568: растения (типы 24/25)
F[0x18568] = (eng, r) => {
  const m = eng.m, esi = r.esi, s = UNITS + esi; const st = m.u8(s + U.STATE);
  if (st === 0x60) { // анимация гибели
    const ebx = m.u8(s + U.TYPE) === 0x18 ? 0x975 : 0x97a;
    m.w16(s + U.SPR, ((m.u8(s + U.ATKCTR) >>> 2) + ebx) & 0xffff);
    m.w8(s + U.ATKCTR, m.u8(s + U.ATKCTR) + 1);
    if (m.u8(s + U.ATKCTR) > 0x14) { m.w8(s + U.FLAGS5B, m.u8(s + U.FLAGS5B) | 1); m.w16(s + U.ANIM, 0); }
    return;
  }
  if (st === 0x6f) {
    m.w8(s + U.ORDER, 0xff); m.w8(s + U.STATE, 0x60); m.w8(s + U.ATKCTR, 0); m.w8(s + U.F07, 0);
    call(eng, 0x1a42c, { esi, edx: m.u8(s + 0x53) << 5, ebx: m.u8(s + 0x54) << 5 });
    if (m.u32(SEL) === esi) F[0x1a65d](eng, { esi });
    F[0x1ff1c](eng, { esi }); return;
  }
  if (m.u16(G.stepLow) === 0) { F[0x18ab2](eng, { eax: 1, esi }); return; }
  if (st === 0x10) { m.w8(s + U.ATKCTR, m.u8(s + U.ATKCTR) + 1); if (m.u8(s + U.ATKCTR) >= 0x17) m.w8(s + U.STATE, 0x20); }
  else { m.w8(s + U.ATKCTR, m.u8(s + U.ATKCTR) - 1); if (m.u8(s + U.ATKCTR) === 0) m.w8(s + U.STATE, 0x10); }
  let ebx, tab;
  if (m.u8(s + U.TYPE) === 0x18) { tab = 0x36f94; ebx = 4; } else { tab = 0x36fac; ebx = 3; }
  m.w16(s + U.SPR, m.u16(tab + (m.u8(s + U.ATKCTR) & 0xfe)));
  const t = call(eng, 0x1a531, { esi, ebx });
  if ((t.edi >>> 0) !== 0) call(eng, 0x1ead3, { eax: 1, esi, edi: t.edi });
};

// --- 0x18ab2: регенерация (al = прибавка, esi = юнит)
F[0x18ab2] = (eng, r) => {
  const m = eng.m, esi = r.esi, s = UNITS + esi, al = r.eax & 0xff;
  if (m.u8(s + U.STATE) === 0x6f) return;
  const bl = m.u8(s + U.HPMAX);
  if (m.u8(s + U.HP) < bl) {
    let heal = true;
    if (m.u8(s + U.TYPE) < 0xe && (m.u8(s + U.HP) & 3) === 0) { const t = F[0x1c6e9](eng, { eax: 1, esi }); if ((t.eax & 0xffff) !== 0) heal = false; }
    if (heal) {
      let v = m.u8(s + U.HP) + al; if (v > 0xff) v = 0xff; m.w8(s + U.HP, v);
      if (m.u8(s + U.HP) > bl) m.w8(s + U.HP, bl);
    }
  }
  const mg = m.u8(s + U.MAG);
  if (m.u8(s + U.MANA) < mg) {
    let v = m.u8(s + U.MANA) + al; if (v > 0xff) v = 0xff; m.w8(s + U.MANA, v);
    if (m.u8(s + U.MANA) > mg) m.w8(s + U.HP, mg);   // баг оригинала: пишет в HP
  }
};

// --- 0x1c6e9: съесть/списать ax еды из инвентаря (слоты 6..8 = 0x1e). Возвращает ax=0 при успехе, иначе ax без изменений
F[0x1c6e9] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi, ax = r.eax & 0xffff;
  if (m.u16(s + U.FOOD) < ax) return { eax: r.eax >>> 0 };
  let edx = -1; for (let d = 6; d <= 8; d++) if (m.u8(s + U.INV + d) === 0x1e) { edx = d; break; }
  if (edx < 0) return { eax: r.eax >>> 0 };
  const v = u16w(m.u16(s + U.FOOD) - ax); m.w16(s + U.FOOD, v);
  if (v === 0) m.w8(s + U.INV + edx, 0);
  return { eax: 0 };
};

// --- 0x1c679: добавить ax еды юниту (слот 0x1e или пустой 6..8). Возвращает ax=0, при переполнении — ax=сумма по модулю, еда=0xffff; при отсутствии слота ax без изменений
F[0x1c679] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi, ax = r.eax & 0xffff;
  let edx = -1; for (let d = 6; d <= 8; d++) if (m.u8(s + U.INV + d) === 0x1e) { edx = d; break; }
  if (edx < 0) {
    for (let d = 6; d <= 8; d++) if (m.u8(s + U.INV + d) === 0) { edx = d; break; }
    if (edx < 0) return { eax: r.eax >>> 0 };
    m.w8(s + U.INV + edx, 0x1e);
  }
  const sum = m.u16(s + U.FOOD) + ax;
  if (sum > 0xffff) { m.w16(s + U.FOOD, sum & 0xffff); const t = m.u16(s + U.FOOD); m.w16(s + U.FOOD, 0xffff); return { eax: (r.eax & 0xffff0000 | t) >>> 0 }; }
  m.w16(s + U.FOOD, sum); return { eax: 0 };
};

// --- 0x1c791: выбор оружия в руки (слоты 0..2) по владельцу/классу
F[0x1c791] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi;
  const cls = (id) => m.u16(0x3095c + m.u32(0x30a9e + id * 4));
  let edx = -1;
  if (m.u8(s + U.WEAPON) !== 0xff) {
    if (человек(m, m.u8(s + U.OWNER))) return;
    for (let d = 0; d < 3 && edx < 0; d++) if (cls(m.u8(s + U.INV + d)) === 0x13) edx = d;
    if (edx < 0) {
      const al = m.u8(s + U.F09); if (al === 0) return;
      if (m.u8(s + U.INV + m.u8(s + U.WEAPON)) === al) return;
      for (let d = 0; d < 3 && edx < 0; d++) if (m.u8(s + U.INV + d) === al) edx = d;
      if (edx < 0) return;
    }
  } else {
    const al = m.u8(s + U.F09);
    if (al !== 0) for (let d = 0; d < 3 && edx < 0; d++) if (m.u8(s + U.INV + d) === al) edx = d;
    if (edx < 0) for (let d = 0; d < 3 && edx < 0; d++) if (m.u8(s + U.INV + d) !== 0) edx = d;
    if (edx < 0) return;
  }
  m.w8(s + U.WEAPON, edx);
  const al = m.u8(s + U.INV + edx); if (al >= 5 && al <= 7) m.w8(s + U.SHIELD, 0xff);
};
// --- 0x1c8ec: выбор щита (слоты 3..5)
F[0x1c8ec] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi;
  const cls = (id) => m.u16(0x3095c + m.u32(0x30a9e + id * 4));
  let edx = -1;
  if (m.u8(s + U.SHIELD) !== 0xff) {
    if (человек(m, m.u8(s + U.OWNER))) return;
    for (let d = 3; d < 6 && edx < 0; d++) if (cls(m.u8(s + U.INV + d)) === 0x15) edx = d;
    if (edx < 0) {
      const al = m.u8(s + U.F0A); if (al === 0) return;
      if (m.u8(s + U.INV + 3 + m.u8(s + U.SHIELD)) === al) return;   // квирк оригинала: [0xe441e + слот]
      for (let d = 3; d < 6 && edx < 0; d++) if (m.u8(s + U.INV + d) === al) edx = d;
      if (edx < 0) return;
    }
  } else {
    const al = m.u8(s + U.F0A);
    if (al !== 0) for (let d = 3; d < 6 && edx < 0; d++) if (m.u8(s + U.INV + d) === al) edx = d;
    if (edx < 0) for (let d = 3; d < 6 && edx < 0; d++) if (m.u8(s + U.INV + d) !== 0) edx = d;
    if (edx < 0) return;
  }
  if (m.u8(s + U.WEAPON) !== 0xff) {
    const al = m.u8(s + U.INV + m.u8(s + U.WEAPON));
    if (al >= 5 && al <= 7) return;   // двуручное оружие — щит нельзя
  }
  m.w8(s + U.SHIELD, edx);
};

// --- пул объектов на земле (0xf4f34, 16 байт): +0 тип, +1 tx, +2 ty, +4 таймер, +6 количество, +8 prev, +12 next
F[0x1ca54] = (eng) => { // взять слот из свободного списка → esi
  const m = eng.m; if (m.u32(ITEM_FREE) === 0) return { cf: 1 };
  const esi = m.u32(ITEM_FREE), edi = m.u32(ITEMS + esi + 12);
  m.w32(ITEMS + edi + 8, 0); m.w32(ITEM_FREE, edi);
  const head = m.u32(ITEM_HEAD); m.w32(ITEMS + esi + 8, 0); m.w32(ITEMS + esi + 12, head); m.w32(ITEMS + head + 8, esi); m.w32(ITEM_HEAD, esi);
  return { cf: 0, esi };
};
F[0x1ca9f] = (eng, r) => { // вернуть слот esi в свободный список
  const m = eng.m, esi = r.esi; const prev = m.u32(ITEMS + esi + 8), next = m.u32(ITEMS + esi + 12);
  if (prev === 0) m.w32(ITEM_HEAD, next); else m.w32(ITEMS + prev + 12, next);
  if (next !== 0) m.w32(ITEMS + next + 8, prev);
  const fr = m.u32(ITEM_FREE); m.w32(ITEMS + esi + 8, 0); m.w32(ITEMS + esi + 12, fr); m.w32(ITEM_FREE, esi);
  if (fr !== 0) m.w32(ITEMS + fr + 8, esi);
};
F[0x1c5a8] = (eng, r) => { // положить: al тип, dl/bl тайл, cx количество, edi слот
  const m = eng.m, it = ITEMS + r.edi, dl = r.edx & 0xff, bl = r.ebx & 0xff;
  m.w8(it, r.eax & 0xff); m.w8(it + 1, dl); m.w8(it + 2, bl); m.w16(it + 6, r.ecx & 0xffff); m.w16(it + 4, 0x19);
  const a = BI + dl + ((r.ebx & 0xffffff) << 8 >>> 0); m.w8(a, m.u8(a) | 2);
};
// 0x1ce81: тайл (edx,ebx px) свободен? → zf=0 если свободен; bl = байт BI
F[0x1ce81] = (eng, r) => {
  const m = eng.m; let eax = 0; const edx = (r.edx & 0xffff) >>> 5; let ebx = r.ebx >>> 0;
  if (edx < m.u32(G.mapW)) {
    ebx = (r.ebx & 0xffff) >>> 5;
    if (ebx < m.u32(G.mapH)) {
      ebx <<= 9; eax = m.u16(BG + ebx + edx * 2);
      if (eax & 0xf800) return { zf: 1, eax: 0, ebx };
      eax = m.u8(0x3183c + eax); ebx >>>= 1;
    }
  }
  if ((eax & 1) === 0) return { zf: 1, eax: 0, ebx };
  const bl = m.u8(BI + edx + ebx); ebx = (ebx & 0xffffff00) | bl;
  if (bl & 0xfc) return { zf: 1, eax: 1, ebx };
  return { zf: 0, eax: 0, ebx };
};
// 0x1e609: как 0x1ce81, но с учётом летающих (тип 0xb) → zf=0 если свободен
F[0x1e609] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi; let eax = 0; const edx = (r.edx & 0xffff) >>> 5; let ebx = r.ebx >>> 0;
  if (edx < m.u32(G.mapW)) {
    ebx = (r.ebx & 0xffff) >>> 5;
    if (ebx < m.u32(G.mapH)) {
      if (m.u8(s + U.TYPE) === 0xb) {
        ebx <<= 8;
        if (m.u8(MO + edx + ebx) & 0xf0) return { zf: 1, eax: 1 };
        return { zf: 0, eax: 1 };
      }
      ebx <<= 9; eax = m.u16(BG + ebx + edx * 2);
      if (eax & 0xf800) return { zf: 1, eax: 0 };
      eax = m.u8(0x3183c + eax); ebx >>>= 1;
    }
  }
  if ((eax & 1) === 0) return { zf: 1, eax: 0 };
  if (m.u8(BI + edx + ebx) & 0xfc) return { zf: 1, eax: 1 };
  return { zf: 0, eax: 0 };
};
// 0x1cd2d: место под здание вида al — расширяющимися прямоугольниками ищем тайл, где свободен
// весь отпечаток (смещения 0x31770[вид], число 0x3176c[вид]). Возвращает найденный тайл в edx/ebx.
F[0x1cd2d] = (eng, r) => {
  const m = eng.m; const kind = r.eax & 0xff;
  const cnt = m.u32(0x3176c + kind * 8), offs = m.u32(0x31770 + kind * 8);
  let ox = m.u16(UNITS + r.esi + U.X) & 0xffe0, oy = m.u16(UNITS + r.esi + U.Y) & 0xffe0;
  let w = 1, h = 1;
  for (let ring = 0; ring < 64; ring++) {
    let by = oy;
    for (let j = 0; j < h; j++) {
      let bx = ox;
      for (let i = 0; i < w; i++) {
        let ok = true;
        for (let k = 0, p = offs; k < cnt; k++, p += 8) {
          const t = F[0x1ce81](eng, { edx: (bx + m.u32(p)) & 0xffff, ebx: (by + m.u32(p + 4)) & 0xffff });
          if (t.zf) { ok = false; break; }
        }
        if (ok) return { edx: bx, ebx: by };
        bx = (bx + 0x20) & 0xffff;
      }
      by = (by + 0x20) & 0xffff;
    }
    ox = (ox - 0x20) & 0xffff; oy = (oy - 0x20) & 0xffff; w += 2; h += 2;
  }
  return { edx: ox, ebx: oy };
};

// 0x1d1cf: состояние 0xe0 — конструктор ставит здание. Если подходящее место не там, где он
// стоит, он идёт туда; если там же — сам превращается в недостроенное здание (тип = вид + 0x1a,
// HP 0, флаг «строится»), кладёт инвентарь на землю и занимает клетки отпечатком.
F[0x1d1cf] = (eng, r) => {
  const m = eng.m, esi = r.esi, s = UNITS + esi;
  if (m.u8(s + U.F07) & 0x80) {                       // снять выделение с этого и прочих юнитов
    if (m.u32(0x31adc) === esi) {
      for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(UNITS + i + U.NEXT))
        if (i !== esi && (m.u8(UNITS + i + U.F07) & 0x80)) m.w8(UNITS + i + U.F07, m.u8(UNITS + i + U.F07) & 0x7f);
      m.w8(s + U.F07, m.u8(s + U.F07) & 0xf0);
    } else m.w8(s + U.F07, m.u8(s + U.F07) & 0x70);
  }
  const kind = m.u8(s + 0x59);
  call(eng, 0x1a42c, { esi, edx: m.u16(s + U.X), ebx: m.u16(s + U.Y) });      // освободить свою клетку
  const site = F[0x1cd2d](eng, { eax: kind, esi });
  if (m.u16(s + U.X) !== site.edx || m.u16(s + U.Y) !== site.ebx) {           // место в стороне — идём туда
    call(eng, 0x19f43, { esi, edx: site.edx, ebx: site.ebx });
    return call(eng, 0x1a3db, { esi, edx: m.u16(s + U.X), ebx: m.u16(s + U.Y) });
  }
  if (F[0x1ffc9]) F[0x1ffc9](eng, { esi });                                    // звук стройки
  const type = (kind + 0x1a) & 0xff;
  m.w8(s + U.TYPE, type); m.w8(s + U.STATE, 0); m.w8(s + U.FLAGS50, 2);        // «строится»
  const st = m.u32(0x30a9e + type * 4);
  m.w8(s + U.HPMAX, m.u8(st + 0x37654)); m.w8(s + U.HP, 0); m.w8(s + 0x51, 0);
  const mag = m.u8(st + 0x37656); m.w8(s + U.MAG, mag); m.w8(s + U.MANA, mag);
  m.w8(s + U.ATK, m.u8(st + 0x37657)); m.w8(s + U.DEF, m.u8(st + 0x37658)); m.w8(s + U.SPD, m.u8(st + 0x37659));
  call(eng, 0x1dac2, { esi });                                                 // отпечаток здания в сетке
  for (let k = 0; k < 12; k++) {                                               // инвентарь — на землю
    const it = m.u8(s + U.INV + k); if (it === 0) continue;
    const res = call(eng, 0x1cdf3, { eax: it, esi, edx: m.u16(s + U.X), ebx: m.u16(s + U.Y) });
    const edi = res.esi >>> 0;
    if (it === 0x1e && edi) m.w16(ITEMS + edi + 6, m.u16(s + U.FOOD));         // еда переносит количество
    m.w8(s + U.INV + k, 0);
  }
  if (m.u8(s + U.TYPE) === 0x1e) m.w32(0x31c48 + m.u8(s + U.OWNER) * 4, m.u32(0x31c48 + m.u8(s + U.OWNER) * 4) + 1);
  if (m.u32(0x31adc) === esi) {                                                // панель: страница здания
    m.w8(0x31ae4, (m.u8(s + U.TYPE) - 0x19) & 0xff);
    if (F[0x26a5d]) F[0x26a5d](eng, { esi }); if (F[0x1a4cc]) F[0x1a4cc](eng, { esi });
  }
};

// Сколько колец спирали перебирать, прежде чем сдаться. В оригинале спираль бесконечна: в DOS
// свободная клетка в конце концов находилась, а если нет — игра просто вешалась, и это никого не
// волновало. В браузере вечный цикл вешает вкладку целиком, поэтому кольца ограничены размером
// карты: не нашли — возвращаем исходную клетку, юнит встанет поверх, но игра живёт.
const КОЛЕЦ = 80;
// 0x1ce37: спираль вокруг (edx,ebx px) — первый свободный тайл без объектов → edx,ebx (px, выровнено)
F[0x1ce37] = (eng, r) => {
  const нач = { edx: (r.edx & ~0x1f) >>> 0, ebx: (r.ebx & ~0x1f) >>> 0 };
  let edx = нач.edx, ebx = нач.ebx, w = 1, h = 1;
  for (let кольцо = 0; кольцо < КОЛЕЦ; кольцо++) {
    let by = ebx;
    for (let j = 0; j < h; j++) {
      let bx = edx;
      for (let i = 0; i < w; i++) {
        const t = F[0x1ce81](eng, { edx: bx, ebx: by });
        if (t.zf === 0 && (t.ebx & 0xfe) === 0) return { edx: bx, ebx: by };
        bx = (bx + 0x20) >>> 0;
      }
      by = (by + 0x20) >>> 0;
    }
    edx = (edx - 0x20) >>> 0; ebx = (ebx - 0x20) >>> 0; w += 2; h += 2;
  }
  return нач;
};
// 0x1ccdd: спираль для размещения юнита esi (16-битный шаг по x, как в оригинале) → edx,ebx
F[0x1ccdd] = (eng, r) => {
  const m = eng.m; m.w32(0x37574, r.esi);
  const нач = { edx: (r.edx & ~0x1f) >>> 0, ebx: (r.ebx & ~0x1f) >>> 0 };
  let edx = нач.edx, ebx = нач.ebx, w = 1, h = 1;
  for (let кольцо = 0; кольцо < КОЛЕЦ; кольцо++) {
    let by = ebx;
    for (let j = 0; j < h; j++) {
      let bx = edx;
      for (let i = 0; i < w; i++) {
        const t = F[0x1e609](eng, { esi: m.u32(0x37574), edx: bx, ebx: by });
        if (t.zf === 0) return { edx: bx, ebx: by, cf: 0 };
        bx = ((bx & 0xffff0000) | ((bx + 0x20) & 0xffff)) >>> 0;
      }
      by = (by + 0x20) >>> 0;
    }
    edx = (edx - 0x20) >>> 0; ebx = (ebx - 0x20) >>> 0; w += 2; h += 2;
  }
  return { ...нач, cf: 1 };            // свободной клетки нет — пусть решает вызывающий
};
// 0x1cdf3: создать объект типа al рядом с (edx,ebx px) → esi слот, cf
F[0x1cdf3] = (eng, r) => {
  const m = eng.m; const a = F[0x1ca54](eng, {}); if (a.cf) return { cf: 1, esi: r.esi };
  const esi = a.esi; m.w8(ITEMS + esi, r.eax & 0xff);
  const p = F[0x1ce37](eng, { edx: r.edx, ebx: r.ebx }); const dx = p.edx >>> 5, bx = p.ebx >>> 5;
  m.w8(ITEMS + esi + 1, dx & 0xff); m.w8(ITEMS + esi + 2, bx & 0xff); m.w16(ITEMS + esi + 6, 1); m.w16(ITEMS + esi + 4, 0x19);
  const g = BI + dx + ((bx << 8) >>> 0); m.w8(g, m.u8(g) | 2);
  return { cf: 0, esi };
};
// 0x1c470: юнит edi подбирает объект esi → cf=1 если не влез
F[0x1c470] = (eng, r) => {
  const m = eng.m, it = ITEMS + r.esi, u = UNITS + r.edi, edi = r.edi; const al = m.u8(it);
  let edx = -1;
  if (al === 0x1e) {
    for (let d = 6; d <= 8; d++) if (m.u8(u + U.INV + d) === 0x1e) { edx = d; break; }
    if (edx < 0) for (let d = 6; d <= 8; d++) if (m.u8(u + U.INV + d) === 0) { edx = d; break; }
    if (edx < 0) return fail();
    const t = F[0x1c679](eng, { eax: m.u16(it + 6), esi: edi });
    if ((t.eax & 0xffff) !== 0) { m.w16(it + 6, (t.eax + 1) & 0xffff); return { cf: 0, esi: r.esi, edi }; }
    return take(0x1e);
  }
  const fl = m.u16(0x3095c + m.u32(0x30a9e + al * 4));
  const base = (fl & 2) ? 0 : (fl & 4) ? 3 : (fl & 0x10) ? 9 : 6;
  for (let d = base; d < base + 3; d++) if (m.u8(u + U.INV + d) === 0) { edx = d; break; }
  if (edx < 0) return fail();
  return take(al);
  function take(v) {
    m.w8(u + U.INV + edx, v);
    const g = BI + m.u8(it + 1) + (m.u8(it + 2) << 8); m.w8(g, m.u8(g) & 0xfd);
    F[0x1ca9f](eng, { esi: r.esi });
    return { cf: 0, esi: edi, edi };
  }
  function fail() { if ((m.u8(u + 0x42) & 1) === 0) F[0x1fd8b](eng, {}); return { cf: 1, esi: r.esi, edi }; }
};
// 0x1c409: подобрать всё с тайла юнита esi → cf=1 если ничего не взято
F[0x1c409] = (eng, r) => {
  const m = eng.m, u = UNITS + r.esi; m.w8(0x37550, 0);
  const dl = (m.u16(u + U.X) >>> 5) & 0xff, bl = (m.u16(u + U.Y) >>> 5) & 0xff;
  let it = m.u32(ITEM_HEAD);
  while (it !== 0) {
    if (m.u8(ITEMS + it + 1) === dl && m.u8(ITEMS + it + 2) === bl) {
      const next = m.u32(ITEMS + it + 12); const t = F[0x1c470](eng, { esi: it, edi: r.esi });
      if (!t.cf) m.w8(0x37550, m.u8(0x37550) + 1);
      it = next;
    } else it = m.u32(ITEMS + it + 12);
  }
  return { cf: m.u8(0x37550) < 1 ? 1 : 0 };
};

// --- 0x23da0: ближайший склад владельца → edi, cf=1 если нет
F[0x23da0] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi; let edi = m.u32(G.unitHead); if (edi === 0) return { cf: 1 };
  let cx = 0xffff, best = 0; const own = m.u8(s + U.OWNER);
  for (; edi !== 0; edi = m.u32(UNITS + edi + U.NEXT)) {
    const t = UNITS + edi;
    if (m.u8(t + U.TYPE) !== 0x1e || (m.u8(t + U.FLAGS5B) & 1) || m.u8(t + U.OWNER) !== own) continue;
    let dx = (m.u16(s + U.X) - m.u16(t + U.X)) & 0xffff; if (dx & 0x8000) dx = (-dx) & 0xffff;
    let bx = (m.u16(s + U.Y) - m.u16(t + U.Y)) & 0xffff; if (bx & 0x8000) bx = (-bx) & 0xffff;
    if (bx <= dx) bx = dx;
    if (cx > bx) { cx = bx; best = edi; }
  }
  if (cx === 0xffff) return { cf: 1 };
  return { cf: 0, edi: best };
};
// --- 0x17361: перегруз — нести еду на ближайший склад
F[0x17361] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi; const t = F[0x23da0](eng, { esi: r.esi }); if (t.cf) return;
  let slot = -1; for (let d = 6; d <= 8; d++) if (m.u8(s + U.INV + d) === 0x1e) { slot = d; break; }
  if (slot < 0) return;
  F[0x1a35c](eng, { eax: slot, esi: r.esi, edi: t.edi, edx: m.u16(UNITS + t.edi + U.X), ebx: m.u16(UNITS + t.edi + U.Y) });
};

// --- 0x1954f: дошли ли до цели переноса → cf=0 да
F[0x1954f] = (eng, r) => {
  const m = eng.m, esi = r.esi, s = UNITS + esi; const edi = m.u32(s + U.TARGET);
  if (edi === 0) return { cf: (m.u16(s + U.DSTX) !== m.u16(s + U.X) || m.u16(s + U.DSTY) !== m.u16(s + U.Y)) ? 1 : 0 };
  const t = UNITS + edi;
  if ((m.u8(t + U.FLAGS5B) & 1) || m.u8(t + U.STATE) === 0x60) { F[0x1a34c](eng, { esi }); return { cf: 0 }; }
  const tt = m.u8(t + U.TYPE);
  const absd = (a, b) => { let v = (a - b) & 0xffff; if (v & 0x8000) v = (-v) & 0xffff; return v; };
  if (tt < 0x1a) {
    if (absd(m.u16(s + U.X), m.u16(t + U.X)) > 0x20) return { cf: 1 };
    if (absd(m.u16(s + U.Y), m.u16(t + U.Y)) > 0x20) return { cf: 1 };
    return { cf: 0 };
  }
  const sx = m.i16(s + U.X), sy = m.i16(s + U.Y), tx = m.i16(t + U.X), ty = m.i16(t + U.Y);
  if (tt === 0x1e) {
    if (sx < ((tx - 0x20) << 16 >> 16) || sx > ((tx + 0x40) << 16 >> 16)) return { cf: 1 };
    if (sy < ((ty - 0x20) << 16 >> 16) || sy > ((ty + 0x40) << 16 >> 16)) return { cf: 1 };
    return { cf: 0 };
  }
  if (tt === 0x1c || tt === 0x1d) {
    if (sx < ((tx - 0x20) << 16 >> 16) || sx > ((tx + 0x60) << 16 >> 16)) return { cf: 1 };
    if (sy < ((ty - 0x20) << 16 >> 16) || sy > ((ty + 0x40) << 16 >> 16)) return { cf: 1 };
    return { cf: 0 };
  }
  F[0x1a34c](eng, { esi }); F[0x1fd8b](eng, {}); return { cf: 1 };
};

// --- 0x1918c: состояние добычи 0x4x
F[0x1918c] = (eng, r) => {
  const m = eng.m, esi = r.esi, s = UNITS + esi; const st = m.u8(s + U.STATE);
  if (st & 4) { m.w8(s + U.STATE, (st & 0xfb) | 2); return call(eng, 0x1db94, { esi }); }
  if (st & 1) {
    const t = F[0x1c409](eng, { esi });
    if (!t.cf) {
      if (m.u8(s + U.TYPE) < 4) { F[0x1c791](eng, { esi }); F[0x1c8ec](eng, { esi }); }
      if (m.u8(s + U.TYPE) >= 0xe) return F[0x1a34c](eng, { esi });
      if (m.u16(s + U.FOOD) >= ((m.u8(s + U.HPMAX) << 6) & 0xffff)) return F[0x17361](eng, { esi });
      if (m.u32(SEL) === esi) ui(eng);
    }
    if (m.u8(s + U.STATE) & 8) return F[0x1a34c](eng, { esi });
    return F[0x1a354](eng, { esi });
  }
  const mv = call(eng, 0x1dc43, { esi }); if ((mv.eax & 0xff) !== 0) return;
  m.w8(s + U.STATE, (m.u8(s + U.STATE) & 0xfd) | 1);
};

// --- 0x19229: перенос 0x50 / 0x51+n
F[0x19229] = (eng, r) => {
  const m = eng.m, esi = r.esi, s = UNITS + esi;
  if (m.u8(s + U.STATE) !== 0x50) {
    m.w8(s + 0x51, (m.u8(s + U.STATE) - 0x51) & 0xff); m.w8(s + U.STATE, 0x50);
    if (F[0x1954f](eng, { esi }).cf) return call(eng, 0x1db94, { esi });
  } else {
    let arrived = false;
    if ((m.u16(s + U.X) & 0x1f) === 0 && (m.u16(s + U.Y) & 0x1f) === 0) arrived = !F[0x1954f](eng, { esi }).cf;
    if (!arrived) {
      const mv = call(eng, 0x1dc43, { esi }); if ((mv.eax & 0xff) !== 0) return;
      if (F[0x1954f](eng, { esi }).cf) return F[0x1a34c](eng, { esi });
    }
  }
  // 0x19288
  const ecx = m.u8(s + 0x51); if (m.u8(s + U.INV + ecx) === 0) return F[0x1a34c](eng, { esi });
  const target = m.u32(s + U.TARGET);
  if (target === 0) { // выложить на землю
    const a = F[0x1ca54](eng, {}); if (a.cf) return F[0x1a34c](eng, { esi });
    let al, cx;
    if (m.u8(s + U.INV + ecx) === 0x1e) {
      let ax = m.u16(s + U.FOOD); if (ax !== 1) ax >>>= 1;
      F[0x1c6e9](eng, { eax: ax, esi }); al = 0x1e; cx = ax;
    } else {
      if (m.u8(s + U.WEAPON) === ecx) m.w8(s + U.WEAPON, 0xff); else if (m.u8(s + U.SHIELD) === ecx) m.w8(s + U.SHIELD, 0xff);
      al = m.u8(s + U.INV + ecx); m.w8(s + U.INV + ecx, 0); cx = 1;
    }
    F[0x1c5a8](eng, { eax: al, edx: m.u16(s + U.X) >>> 5, ebx: m.u16(s + U.Y) >>> 5, ecx: cx, edi: a.esi });
    if (m.u32(SEL) === esi) ui(eng);
    return F[0x1a34c](eng, { esi });
  }
  const t = UNITS + target; if (m.u8(t + U.STATE) === 0x60) return F[0x1a34c](eng, { esi });
  const tt = m.u8(t + U.TYPE);
  if (tt === 0x1e) { // склад: оставить себе 50, остальное сдать
    const own = m.u8(t + U.OWNER); let ecx2 = m.u16(s + U.FOOD); if (ecx2 > 0x32) ecx2 -= 0x32;
    m.w32(FOOD + own * 4, (m.u32(FOOD + own * 4) + ecx2) >>> 0);
    m.w16(s + U.FOOD, m.u16(s + U.FOOD) - ecx2);
    if (m.u16(s + U.FOOD) !== 0) return F[0x1a354](eng, { esi });
    m.w8(s + U.INV + m.u8(s + 0x51), 0);
    if (m.u32(SEL) === esi) ui(eng);
    return F[0x1a354](eng, { esi });
  }
  if (tt === 0x1c || tt === 0x1d) { // арсенал: продать за половину
    const bl = m.u8(s + U.INV + ecx);
    if (bl >= 0xf) { F[0x1a34c](eng, { esi }); return F[0x1fd8b](eng, {}); }
    m.w8(s + U.INV + ecx, 0);
    const price = m.u32(0x30fac + bl * 4); let ax = ((price & 0xff) * m.u8(0x315ec + bl)) & 0xffff; ax >>>= 1;
    F[0x1c679](eng, { eax: ax, esi });
    if (m.u32(SEL) === esi) ui(eng);
    return F[0x1a354](eng, { esi });
  }
  if (tt >= 0x1a) return F[0x1a34c](eng, { esi });
  // передать юниту
  const a = F[0x1ca54](eng, {}); if (a.cf) return F[0x1a34c](eng, { esi });
  let al = m.u8(s + U.INV + ecx), cx;
  if (al === 0x1e) { cx = m.u16(s + U.FOOD); if (cx !== 1) cx >>>= 1; al = 0x1e; } else cx = 1;
  F[0x1c5a8](eng, { eax: al, edx: m.u16(s + U.X) >>> 5, ebx: m.u16(s + U.Y) >>> 5, ecx: cx, edi: a.esi });
  const tk = F[0x1c470](eng, { esi: a.esi, edi: target });
  if (tk.cf) { const g = BI + m.u8(ITEMS + a.esi + 1) + (m.u8(ITEMS + a.esi + 2) << 8); m.w8(g, m.u8(g) & 0xfd); F[0x1ca9f](eng, { esi: a.esi }); return F[0x1a34c](eng, { esi }); }
  const c2 = m.u8(s + 0x51);
  if (m.u8(s + U.INV + c2) === 0x1e) { let ax = m.u16(s + U.FOOD); if (ax !== 1) ax >>>= 1; F[0x1c6e9](eng, { eax: ax, esi }); }
  else {
    m.w8(s + U.INV + c2, 0);
    if (m.u8(s + U.WEAPON) === c2) m.w8(s + U.WEAPON, 0xff); else if (m.u8(s + U.SHIELD) === c2) m.w8(s + U.SHIELD, 0xff);
    if (m.u8(t + U.TYPE) < 4) { F[0x1c791](eng, { esi: target }); F[0x1c8ec](eng, { esi: target }); }
  }
  if (m.u32(SEL) === esi) ui(eng); else if (m.u32(SEL) === target) ui(eng);
  return F[0x1a34c](eng, { esi });
};

// --- 0x1a773: индекс спрайта по типу/направлению
F[0x1a773] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi; const t = m.u8(s + U.TYPE);
  if (t !== 0xb) { m.w16(s + U.SPR, (m.u16(0x36dd6 + t * 2) + m.u16(0x36e06 + m.u8(s + U.DIR) * 2)) & 0xffff); return; }
  let ax = m.u16(0x36e38 + t * 2); ax += m.u16(0x36e28 + (m.u8(s + U.ATKCTR) >>> 1) * 2); ax += m.u16(0x36e7a + m.u8(s + U.DIR) * 2);
  m.w16(s + U.SPR, ax & 0xffff);
};
// --- 0x1db19: снять отпечаток здания с BI (&=3)
F[0x1db19] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi; const k = m.u8(s + U.TYPE) - 0x1a;
  let ebp = m.u32(0x31770 + k * 8), ecx = m.u32(0x3176c + k * 8);
  for (; ecx > 0; ecx--) {
    const edx = ((m.u16(s + U.X) + m.u32(ebp)) >>> 0) >>> 5, ebx = ((m.u16(s + U.Y) + m.u32(ebp + 4)) >>> 0) >>> 5;
    const a = BI + edx + ((ebx << 8) >>> 0); m.w8(a, m.u8(a) & 3); ebp += 8;
  }
};
// --- 0x1db5e: применить пакет бонусов ebx (4 байта: HP, MAG, ATK/DEF, SPD)
F[0x1db5e] = (eng, r) => {
  const m = eng.m, s = UNITS + r.esi, b = r.ebx;
  const add = (o, v) => m.w8(s + o, m.u8(s + o) + v);
  add(U.HPMAX, m.u8(b)); add(U.HP, m.u8(b)); add(U.MAG, m.u8(b + 1)); add(U.MANA, m.u8(b + 1));
  add(U.ATK, m.u8(b + 2)); add(U.DEF, m.u8(b + 2)); add(U.SPD, m.u8(b + 3));
};

// --- 0x1caf0: создать юнита (al тип, ah слот, cl владелец, dx/bx px) → esi, cf
F[0x1caf0] = (eng, r) => {
  const m = eng.m; const a = call(eng, 0x1aaac, {}); if (a.cf) return { cf: 1 };
  const esi = a.esi, s = UNITS + esi;
  m.w8(s + U.TYPE, r.eax & 0xff); m.w8(s + U.SLOT, (r.eax >>> 8) & 0xff); m.w8(s + U.OWNER, r.ecx & 0xff);
  const p = F[0x1ccdd](eng, { esi, edx: r.edx, ebx: r.ebx });
  // Ставить некуда: возвращаем запись в свободный список и говорим «не вышло». Раньше спираль
  // искала место вечно и вешала вкладку, а если ставить силой — юнит попадал в занятую клетку и
  // портил сетку. Здание попробует выпустить его снова на следующем такте производства.
  if (p.cf) { call(eng, 0x1aaf7, { esi }); return { cf: 1, esi: 0 }; }
  m.w16(s + U.X, p.edx); m.w16(s + U.Y, p.ebx);
  const dl = ((p.edx & 0xffff) >>> 5) & 0xff, bl = ((p.ebx & 0xffff) >>> 5) & 0xff;
  m.w8(s + 0x44, dl); m.w8(s + 0x45, bl); m.w8(s + 0x59, dl); m.w8(s + 0x5a, bl);
  m.w8(s + U.F07, 0); m.w8(s + U.F08, 0); m.w8(s + U.F09, 0); m.w8(s + U.F0A, 0);
  const t = m.u8(s + U.TYPE); m.w8(s + U.STAT0B, m.u8(0x3757c + t));
  const st = m.u32(0x30a9e + t * 4);
  m.w8(s + U.HPMAX, m.u8(st + 0x37654)); m.w8(s + U.HP, m.u8(st + 0x37654)); m.w8(s + U.MAG, m.u8(st + 0x37655)); m.w8(s + U.MANA, m.u8(st + 0x37656));
  m.w8(s + U.ATK, m.u8(st + 0x37657)); m.w8(s + U.DEF, m.u8(st + 0x37658)); m.w8(s + U.SPD, m.u8(st + 0x37659)); m.w16(s + U.FOOD, m.u16(st + 0x3765a));
  m.w16(s + U.WEAPON, 0xffff); m.w32(s + U.SKILLS, 0x3f); m.w32(s + 0x1b, 0); m.w32(s + 0x1f, 0); m.w32(s + 0x23, 0); m.w8(s + 0x21, 0x1e); m.w32(s + U.XP, 0);
  m.w32(G.rngRange, 8); const dx = (eng.rand_raw() + 1) & 0xffff; m.w16(s + U.DIR, dx); m.w8(s + 0x41, 0);
  F[0x1a773](eng, { esi });
  m.w8(s + U.FX43, 0); m.w8(s + U.ORDER, 0x3f); m.w16(s + U.ANIM, 0); m.w8(s + U.FLAGS50, 0); m.w8(s + U.FLAGS5B, 0);
  let v = m.u8(s + 0x44) - 3; if (v < 0) v = 0; m.w8(s + 0x55, v);
  v = m.u8(s + 0x45) - 3; if (v < 0) v = 0; m.w8(s + 0x56, v);
  v = (m.u8(s + 0x44) + 3) & 0xff; if (m.u8(G.mapW) < v) v = m.u8(G.mapW); m.w8(s + 0x57, v);
  v = (m.u8(s + 0x45) + 3) & 0xff; if (m.u8(G.mapH) < v) v = m.u8(G.mapH); m.w8(s + 0x58, v);
  call(eng, 0x1f475, { esi });
  call(eng, 0x1a3db, { esi, edx: m.u16(s + U.X), ebx: m.u16(s + U.Y) });
  return { cf: 0, esi };
};

// --- сброс статов по таблице (общий хвост 0x1d404 / 0x1d597; MAG берётся из [+2] — как в оригинале)
function reinitStats(eng, esi) {
  const m = eng.m, s = UNITS + esi; const st = m.u32(0x30a9e + m.u8(s + U.TYPE) * 4);
  m.w8(s + U.HPMAX, m.u8(st + 0x37654)); m.w8(s + U.HP, m.u8(st + 0x37654)); m.w8(s + U.MAG, m.u8(st + 0x37656)); m.w8(s + U.MANA, m.u8(st + 0x37656));
  m.w8(s + U.ATK, m.u8(st + 0x37657)); m.w8(s + U.DEF, m.u8(st + 0x37658)); m.w8(s + U.SPD, m.u8(st + 0x37659)); m.w16(s + U.FOOD, m.u16(st + 0x3765a));
  m.w8(s + U.WEAPON, 0xff); m.w8(s + U.SHIELD, 0xff); m.w32(s + U.SKILLS, 0); m.w32(s + 0x1b, 0); m.w32(s + 0x1f, 0); m.w32(s + 0x23, 0); m.w32(s + 0x21, 0x1e); m.w32(s + U.XP, 0);
  m.w8(s + U.FX43, 0); m.w8(s + U.FLAGS50, 0); m.w8(s + U.FLAGS5B, m.u8(s + U.FLAGS5B) & 0xfe);
  F[0x1a773](eng, { esi });
  call(eng, 0x1a3db, { esi, edx: m.u16(s + U.X), ebx: m.u16(s + U.Y) });
}
// 0x1d511: выпустить «гостя» из здания (общий хвост производства): esi = здание, edx/ebx = точка выхода
function releaseGuest(eng, bld, edx, ebx) {
  const m = eng.m, b = UNITS + bld; const esi = m.u32(b + 0x23); m.w32(b + 0x23, 0); const s = UNITS + esi;
  m.w16(s + U.ANIM, 0);
  const p = F[0x1ccdd](eng, { esi, edx, ebx }); m.w16(s + U.X, p.edx); m.w16(s + U.Y, p.ebx);
  m.w32(G.rngRange, (m.u8(s + 0x58) - m.u8(s + 0x56)) & 0xff); let dl = eng.rand_raw();
  let bl = (m.u8(s + 0x56) + dl) & 0xff;
  m.w32(G.rngRange, (m.u8(s + 0x57) - m.u8(s + 0x55)) & 0xff); dl = eng.rand_raw(); dl = (dl & 0xffffff00) | ((dl + m.u8(s + 0x55)) & 0xff);
  call(eng, 0x19fbf, { esi, edx: (dl << 5) >>> 0, ebx: (bl << 5) >>> 0 });
  m.w8(s + U.STATE, 0x3f); m.w8(s + U.ATKCTR, 0);
  reinitStats(eng, esi);
}
// 0x1d36f: Sanctuary → Constructor
F[0x1d36f] = (eng, r) => {
  const m = eng.m, bld = r.esi, b = UNITS + bld;
  const edx = m.u16(b + U.X), ebx = (m.u16(b + U.Y) + 0x40) >>> 0;
  if (m.u32(b + 0x23) === 0) {
    const c = F[0x1caf0](eng, { eax: 4 | (m.u8(b + U.SLOT) << 8), ecx: m.u8(b + U.OWNER), edx, ebx, esi: bld });
    if (c.cf) return { cf: 1 };
    m.w8(UNITS + c.esi + 0x59, m.u8(b + 0x33)); return;
  }
  const esi = m.u32(b + 0x23); m.w32(b + 0x23, 0); const s = UNITS + esi;
  const p = F[0x1ccdd](eng, { esi, edx, ebx }); m.w16(s + U.X, p.edx); m.w16(s + U.Y, p.ebx);
  m.w16(s + U.ANIM, 1); m.w8(s + U.TYPE, 4);
  call(eng, 0x19f43, { esi, edx: m.u8(s + 0x55) << 5, ebx: m.u8(s + 0x56) << 5 });
  m.w8(s + U.ATKCTR, 0);
  reinitStats(eng, esi);
};
// 0x1d4df: Barracks → тип [33]+1
F[0x1d4df] = (eng, r) => {
  const m = eng.m, bld = r.esi, b = UNITS + bld;
  const edx = m.u16(b + U.X), ebx = (m.u16(b + U.Y) + 0x40) >>> 0;
  if (m.u32(b + 0x23) === 0) { const c = F[0x1caf0](eng, { eax: ((m.u8(b + 0x33) + 1) & 0xff) | (m.u8(b + U.SLOT) << 8), ecx: m.u8(b + U.OWNER), edx, ebx, esi: bld }); return c.cf ? { cf: 1 } : c; }
  releaseGuest(eng, bld, edx, ebx);
};
// 0x1d673: Armory → предмет [33]+1 на землю
F[0x1d673] = (eng, r) => { const m = eng.m, b = UNITS + r.esi; return F[0x1cdf3](eng, { eax: (m.u8(b + 0x33) + 1) & 0xff, edx: m.u16(b + U.X), ebx: (m.u16(b + U.Y) + 0x60) >>> 0, esi: r.esi }); };
// 0x1d691: Food-storage → выдать 10/100/1000/10000 еды кучкой
F[0x1d691] = (eng, r) => {
  const m = eng.m, bld = r.esi, b = UNITS + bld; const own = m.u8(b + U.OWNER);
  if (m.u32(FOOD + own * 4) === 0) return F[0x1fd8b](eng, {});
  const c = F[0x1cdf3](eng, { eax: 0x1e, edx: m.u16(b + U.X), ebx: (m.u16(b + U.Y) + 0x40) >>> 0, esi: bld });
  let eax = m.u32(0x37564 + m.u8(b + 0x33) * 4); if (m.u32(FOOD + own * 4) < eax) eax = m.u32(FOOD + own * 4);
  m.w32(FOOD + own * 4, (m.u32(FOOD + own * 4) - eax) >>> 0);
  m.w16(ITEMS + c.esi + 6, eax & 0xffff);
};
// 0x1d6f4..0x1d97c: тренировка магов 5..8 и динозавров 9..13 с пакетом бонусов
function trainer(type, table) {
  return (eng, r) => {
    const m = eng.m, bld = r.esi, b = UNITS + bld; m.w8(0x37560, m.u8(b + 0x33));
    const edx = m.u16(b + U.X), ebx = (m.u16(b + U.Y) + 0x40) >>> 0;
    if (m.u32(b + 0x23) !== 0) return releaseGuest(eng, bld, edx, ebx);
    const c = F[0x1caf0](eng, { eax: type | (m.u8(b + U.SLOT) << 8), ecx: m.u8(b + U.OWNER), edx, ebx, esi: bld });
    if (c.cf) return { cf: 1 };                                   // места нет — повторим на следующем такте
    F[0x1db5e](eng, { esi: c.esi, ebx: table + m.u8(0x37560) * 8 });
  };
}
F[0x1d6f4] = trainer(5, 0x375a4); F[0x1d745] = trainer(6, 0x375c4); F[0x1d796] = trainer(7, 0x375dc); F[0x1d7e7] = trainer(8, 0x375f4);
F[0x1d838] = trainer(9, 0x37604); F[0x1d889] = trainer(10, 0x37614); F[0x1d8da] = trainer(11, 0x37624); F[0x1d92b] = trainer(12, 0x37634); F[0x1d97c] = trainer(13, 0x37644);
const PROD = [0x1d36f, 0x1d4df, 0x1d673, 0x1d673, 0x1d691, 0x1d6f4, 0x1d745, 0x1d796, 0x1d7e7, 0x1d838, 0x1d889, 0x1d8da, 0x1d92b, 0x1d97c];

// --- 0x186b3: здания
F[0x186b3] = (eng, r) => {
  const m = eng.m, esi = r.esi, s = UNITS + esi;
  if (m.u8(s + U.ORDER) !== 0xff) {
    m.w8(s + U.STATE, m.u8(s + U.ORDER)); m.w32(s + U.TARGET, m.u32(s + 0x47)); m.w8(s + U.ORDER, 0xff); m.w32(s + 0x23, 0);
  }
  const hi = m.u8(s + U.STATE) >>> 4;
  if (hi === 6) return bldDeath(eng, esi);
  if (hi === 7) return bldOrder(eng, esi);
  // 0x1871c: производство/ремонт
  // Пауза по нехватке еды снимается ТОЛЬКО нажатием на портрет (bldOrder, бит 4) — так в
  // оригинале, и так хочет владелец: «пауза по еде не должна сниматься сама, должна быть
  // возможность нажать и чтобы продолжилось». Я было сделал самопродолжение — это оказалось
  // лечением не той болезни: нажатие не доходило, потому что мой же запрет «стройка уже идёт»
  // его перехватывал. Запрет убран (reimpl/web/game.js), нажатие работает, самопродолжение снято.
  const f50 = m.u8(s + U.FLAGS50);
  if (f50 !== 0 && (f50 & 4) === 0) {
    if (f50 & 1) {
      const own = m.u8(s + U.OWNER), ebx = m.u32(s + 0x1f);
      if (m.u32(FOOD + own * 4) < ebx) return bldPause(eng, esi);
      m.w32(FOOD + own * 4, (m.u32(FOOD + own * 4) - ebx) >>> 0); m.w32(s + 0x1b, (m.u32(s + 0x1b) + ebx) >>> 0);
      m.w8(s + U.F0A, m.u8(s + U.F0A) + 1);
      if (m.u8(s + U.F09) > m.u8(s + U.F0A)) {
        // Оригинал (0x1879b) на каждом шаге перерисовывает полосу прогресса заказа. В порту здесь
        // стояла пустая заглушка ui(eng), поэтому полоса оставалась на нуле и казалось, что заказ не идёт.
        if (m.u32(SEL) === esi && m.u8(s + U.OWNER) === m.u8(G.humanOwner) && F[0x26d29]) F[0x26d29](eng);
        return bldRepair(eng, esi);
      }
      m.w8(s + U.FLAGS50, 0);
      const k = m.u8(s + U.TYPE) - 0x1a; const r = F[PROD[k]](eng, { esi, eax: m.u8(s + U.TARGET) });
      // Выпустить не удалось (вокруг всё занято) — заказ не теряем: возвращаем производство в
      // «почти готово», и здание попробует ещё раз, как только рядом освободится клетка.
      if (r && r.cf) { m.w8(s + U.FLAGS50, 1); m.w8(s + U.F0A, Math.max(0, m.u8(s + U.F09) - 1)); return; }
      const дальше = Очередь.следующий(eng, esi);                          // очередь (наше): следующий заказ сразу
      if (дальше !== undefined) { m.w32(s + U.TARGET, дальше); startProduction(m, s); }
      if (m.u32(SEL) === esi && F[0x26a5d]) F[0x26a5d](eng, { esi });      // заказ закончен — обновить страницу
      return r;
    }
    if (f50 & 2) {
      m.w8(s + U.HP, m.u8(s + U.HP) + 1); m.w8(s + 0x51, m.u8(s + 0x51) + 1);
      if (m.u8(s + 0x51) < m.u8(s + U.HPMAX)) return;
      m.w8(s + U.FLAGS50, 0);
      if (m.u32(SEL) === esi && F[0x26a5d]) F[0x26a5d](eng, { esi });      // стройка закончена
      return;
    }
  }
  return bldRepair(eng, esi);
};
/** 0x18847: самопочинка здания — +1 HP раз в 16 шагов. */
function bldRepair(eng, esi) { // 0x18847: раз в 16 шагов +1 HP
  const m = eng.m, s = UNITS + esi; if (m.u16(G.stepLow) !== 0) return;
  if (m.u8(s + U.HP) >= m.u8(s + U.HPMAX)) return; m.w8(s + U.HP, m.u8(s + U.HP) + 1);
}
/** 0x18a81: еды не хватило — производство встаёт на паузу (бит 4 в +0x50). */
function bldPause(eng, esi) { // 0x18a81: не хватает еды — пауза
  const m = eng.m, s = UNITS + esi; m.w8(s + U.FLAGS50, m.u8(s + U.FLAGS50) | 4); m.w8(s + U.STATE, 0);
  if (m.u32(SEL) !== esi) return; if (m.u8(G.humanOwner) === m.u8(s + U.OWNER)) ui(eng);
}
/** Начать производство юнита TARGET (хвост 0x189bb): длительность и цена шага — из таблиц по типу здания. */
function startProduction(m, s) {
  m.w8(s + U.F0A, 0);
  const ebx = (((m.u8(s + U.TYPE) - 0x1a) << 5) + m.u32(s + U.TARGET)) >>> 0;
  m.w8(s + U.F09, m.u8(0x315ac + ebx)); m.w32(s + 0x1f, m.u32(0x30eac + ebx * 4)); m.w32(s + 0x1b, 0);
  m.w8(s + U.STATE, 0); m.w8(s + U.FLAGS50, 1);
}
/** 0x189bb: заказ (0x7f) и отмена (0x7e) юнита в здании, с нашей очередью поверх. */
function bldOrder(eng, esi) { // 0x189bb: 0x7f заказ, 0x7e отмена — плюс очередь (наше, prodqueue.js)
  const m = eng.m, s = UNITS + esi; const st = m.u8(s + U.STATE);
  if (st === 0x7f) {
    if (m.u8(s + U.FLAGS50) & 4) { m.w8(s + U.FLAGS50, m.u8(s + U.FLAGS50) & 0xfb); m.w8(s + U.STATE, 0); if (m.u32(SEL) === esi) ui(eng); return; }
    if (m.u8(s + U.FLAGS50) & 1) {                                        // здание занято — в очередь
      Очередь.добавить(eng, esi, m.u32(s + U.TARGET) & 0xff); m.w8(s + U.STATE, 0); if (m.u32(SEL) === esi) ui(eng); return;
    }
    startProduction(m, s); if (m.u32(SEL) === esi) ui(eng); return;
  }
  if (st === 0x7e) {
    const k = m.u32(s + U.TARGET) & 0xff;
    if (Очередь.убрать(eng, esi, k)) { m.w8(s + U.STATE, 0); if (m.u32(SEL) === esi) ui(eng); return; }   // снять одного из очереди
    if ((m.u8(s + U.FLAGS50) & 1) === 0) { m.w8(s + U.STATE, 0); return; }
    // очереди по этому портрету нет — отмена текущего заказа с возвратом еды (в оригинале это был
    // второй щелчок после паузы; пауза как отдельное состояние в порту не нужна)
    m.w8(s + U.FLAGS50, m.u8(s + U.FLAGS50) & 0xfa); m.w8(s + U.STATE, 0);
    const own = m.u8(s + U.OWNER); m.w32(FOOD + own * 4, (m.u32(FOOD + own * 4) + m.u32(s + 0x1b)) >>> 0);
    const дальше = Очередь.следующий(eng, esi);                            // отменили текущий — пошёл следующий
    if (дальше !== undefined) { m.w32(s + U.TARGET, дальше); startProduction(m, s); }
    if (m.u32(SEL) === esi) ui(eng); return;
  }
  m.w8(s + U.STATE, 0);
}
/** 0x1886e: здание разрушено — очередь забыть, счётчики поправить. */
function bldDeath(eng, esi) { // 0x1886e
  const m = eng.m, s = UNITS + esi; Очередь.очистить(eng, esi);
  if (m.u8(s + U.STATE) !== 0x6f) {
    m.w8(s + U.ATKCTR, m.u8(s + U.ATKCTR) + 1); if (m.u8(s + U.ATKCTR) < 8) return;
    if (m.u32(SEL) === esi) { m.w32(SEL, 0); ui(eng); }
    if ((m.u8(s + U.FLAGS5B) & 2) === 0) return F[0x1aaf7](eng, { esi });
    m.w8(s + U.FLAGS5B, m.u8(s + U.FLAGS5B) | 1); return;
  }
  m.w8(s + U.STATE, 0x60); m.w8(s + U.ATKCTR, 0);
  call(eng, 0x1a42c, { esi, edx: m.u16(s + U.X), ebx: m.u16(s + U.Y) });
  const t = m.u8(s + U.TYPE);
  if (t === 0x1e) { // склад: доля еды пропадает, остаток кучками
    const own = m.u8(s + U.OWNER); const ecx = (m.u32(NSTORE + own * 4) + 1) >>> 0;
    let eax = Math.floor(m.u32(FOOD + own * 4) / ecx) >>> 0;
    m.w32(FOOD + own * 4, (m.u32(FOOD + own * 4) - eax) >>> 0); m.w32(NSTORE + own * 4, (m.u32(NSTORE + own * 4) - 1) >>> 0);
    if (eax >= 0x10000) eax = 0xffff;
    while (eax >= 0x32) {
      m.w32(G.rngRange, 0x40); let edx = eng.rand_raw();
      const ebx = (m.u16(s + U.Y) + edx) >>> 0;
      edx = eng.rand_raw(); edx = ((edx & 0xffff0000) | m.u16(s + U.X)) >>> 0;
      const p = F[0x1ce37](eng, { edx, ebx });
      const c = F[0x1cdf3](eng, { eax: 0x1e, edx: p.edx, ebx: p.ebx, esi });
      m.w16(ITEMS + c.esi + 6, eax & 0xffff);
      eax >>>= 1;
    }
  } else if (!(t >= 0x1c && t <= 0x1d)) {
    if ((m.u8(s + U.FLAGS50) & 5) && !человек(m, m.u8(s + U.OWNER)) && m.u32(s + 0x23) !== 0) m.w16(UNITS + m.u32(s + 0x23) + U.ANIM, 0x64);
  }
  F[0x1db19](eng, { esi }); return F[0x1ffeb](eng, { esi });
}
// --- 0x1aaf7: исключить юнита из списка живых → в свободный список
F[0x1aaf7] = (eng, r) => {
  const m = eng.m, esi = r.esi, s = UNITS + esi; m.w8(s + U.FLAGS5B, m.u8(s + U.FLAGS5B) | 1);
  const prev = m.u32(s + U.PREV), next = m.u32(s + U.NEXT);
  if (prev === 0) m.w32(G.unitHead, next); else m.w32(UNITS + prev + U.NEXT, next);
  if (next !== 0) m.w32(UNITS + next + U.PREV, prev);
  const fr = m.u32(0x31b70); m.w32(s + U.PREV, 0); m.w32(s + U.NEXT, fr); m.w32(0x31b70, esi);
  if (fr !== 0) m.w32(UNITS + fr + U.PREV, esi);
};
