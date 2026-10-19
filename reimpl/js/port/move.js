// Тема A: диспетчер состояний юнитов, движение, охрана/простой, поиск пути, сетки.
// Порт pwar.exe (адреса оригинала в комментариях). Все регистры 32-битные, поля юнита — UNITS + esi + off.
import { F, call } from '../fn.js';
import { G, U, UNITS, BI, MO, BG } from '../mem.js';

/** Усечение до 16 бит. */
const w16 = x => x & 0xffff;
/** Модуль 16-битного, как в оригинале (neg dx после sub). */
const abs16 = x => { x &= 0xffff; return x & 0x8000 ? (0x10000 - x) & 0xffff : x; }; // neg dx после sub
/** Запись в младший байт регистра. */
const lo8 = (r, v) => ((r & ~0xff) | (v & 0xff)) >>> 0;   // запись в al/dl/bl/cl
/** Запись в младшее слово регистра. */
const lo16 = (r, v) => ((r & ~0xffff) | (v & 0xffff)) >>> 0;

// ---------- таблицы/сетки ----------
// 0x1e685: проверка тайла (dx,bx — пиксели; ebp — направление). Возвращает {eax: al, zf}.
// ZF=0 только если тайл проходим и свободен (al=0); занят → al=1/2, ZF=1; непроходим/вне карты → al=0, ZF=1.
F[0x1e685] = (eng, r) => {
  const m = eng.m, esi = r.esi, ebp = r.ebp >>> 0;
  let edx = w16(r.edx) >>> 5, ebx = w16(r.ebx) >>> 5;
  if (edx >= m.u32(G.mapW)) return { eax: 0, zf: 1 };
  if (ebx >= m.u32(G.mapH)) return { eax: 0, zf: 1 };
  if (m.u8(UNITS + esi + U.TYPE) === 0xb) {                        // летающий
    const idx = edx + (ebx << 8);
    if ((m.u8(MO + idx) & 0xf0) === 0) return { eax: 1, zf: 0 };     // or al,1
    if ((m.u8(MO + idx) & 0x0f) === 0) return { eax: 1, zf: 1 };
    return { eax: 2, zf: 1 };
  }
  ebx <<= 9;
  const ax = m.u16(BG + ebx + edx * 2);
  if (ax & 0xf800) return { eax: 0, zf: 1 };
  let al = m.u8(0x3183c + ax); ebx >>= 1;
  if ((al & 1) === 0) return { eax: 0, zf: 1 };
  // 0x1e6d3: проверка младшего ниббла MO по адресу edx+ebx — из ветки 0x1e6e7 это СОСЕДНЯЯ клетка (edx = смещение из таблицы)
  const occ = (a) => ((m.u8(a) & 0x0f) !== 0) ? { eax: 2, zf: 1 } : { eax: 1, zf: 1 };
  if ((m.u8(BI + edx + ebx) & 0xfc) !== 0) return occ(MO + edx + ebx);
  const cell = ebx + edx;
  let off = m.i32(0x37910 + ebp * 8); let cmp = m.u8(0x37958 + ebp * 2);
  if (m.u8(MO + cell + off) === cmp) return occ(MO + cell + off);
  off = m.i32(0x37914 + ebp * 8); cmp = m.u8(0x37959 + ebp * 2);
  if (m.u8(MO + cell + off) === cmp) return occ(MO + cell + off);
  return { eax: 0, zf: 0 };
};

// 0x1e56d: поставить юнита на тайл (dx,bx) — записать направление в MO и владельца в BI
F[0x1e56d] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  let edx = w16(r.edx) >>> 5, ebx = w16(r.ebx) >>> 5;
  m.w8(UNITS + esi + 0x53, edx); m.w8(UNITS + esi + 0x54, ebx);
  ebx = (ebx << 8) + edx;
  const cl = m.u8(UNITS + esi + U.DIR); let al = (m.u8(UNITS + esi + U.OWNER) + 1) & 0xff;
  if (m.u8(UNITS + esi + U.TYPE) !== 0xb) {
    m.w8(MO + ebx, (m.u8(MO + ebx) & 0xf0) | cl);
    al = (al << 2) & 0xff;
    m.w8(BI + ebx, (m.u8(BI + ebx) & 3) | al);
  } else {
    al = ((al << 4) & 0xff) | cl; m.w8(MO + ebx, al);
  }
};
// 0x1e5cc: снять юнита с тайла (dx,bx)
F[0x1e5cc] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  let edx = w16(r.edx) >>> 5, ebx = w16(r.ebx) >>> 5;
  m.w8(UNITS + esi + 0x53, edx); m.w8(UNITS + esi + 0x54, ebx);
  ebx = (ebx << 8) + edx;
  if (m.u8(UNITS + esi + U.TYPE) !== 0xb) { m.w8(MO + ebx, m.u8(MO + ebx) & 0xf0); m.w8(BI + ebx, m.u8(BI + ebx) & 3); }
  else m.w8(MO + ebx, 0);
};
// 0x1a3ba: поставить на тайл + туман для локального игрока
F[0x1a3ba] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  if (m.u8(UNITS + esi + U.FLAGS5B) & 1) return;
  call(eng, 0x1a3db, r);
  if (m.u8(G.humanOwner) === m.u8(UNITS + esi + U.OWNER)) return call(eng, 0x1a4cc, r);
};
// 0x1a4cc: открыть туман (бит 0 BI) в кольце радиуса SPD>>4 вокруг юнита
F[0x1a4cc] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  const ebx0 = m.u8(UNITS + esi + U.SPD) >>> 4; let ecx = m.u32(0x3058c + ebx0 * 4);
  const edx = m.u16(UNITS + esi + U.X) >>> 5, ebx = m.u16(UNITS + esi + U.Y) >>> 5;
  let edi = 0;
  while (ecx !== 0) {
    const eax = (m.i16(0x305d0 + edi) + edx) >>> 0;
    if (eax < 0x100) {
      const ebp = (m.i16(0x305d2 + edi) + ebx) >>> 0;
      if (ebp < 0xb0) m.w8(BI + (ebp << 8) + eax, m.u8(BI + (ebp << 8) + eax) | 1);
    }
    edi += 4; ecx = (ecx - 1) >>> 0;
  }
};
// 0x1a463: цель (dx,bx — пиксели, выровненные) ещё в радиусе обзора? Возвращает {zf}: ZF=1 — да
F[0x1a463] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  m.w32(G.rngRange, m.u8(UNITS + esi + U.SPD));
  const rnd = eng.rand_raw();
  if (rnd < 0x10) return { zf: rnd === 0x10 ? 1 : 0 };
  const eax = m.u8(UNITS + esi + U.SPD) >>> 4; let ecx = m.u32(0x3058c + eax * 4);
  let edi = 0, ax = 0;
  globalThis.__сч14 = 0;
  while (true) { if (++globalThis.__сч14 > 3e6) throw new Error("ЦИКЛ move.js:95");
    ax = w16(((m.u16(UNITS + esi + U.X) >>> 5) + m.u16(0x305d0 + edi)) << 5);
    if (ax === w16(r.edx)) {
      ax = w16(((m.u16(UNITS + esi + U.Y) >>> 5) + m.u16(0x305d2 + edi)) << 5);
      if (ax === w16(r.ebx)) return { zf: 1 };
    }
    edi += 4; ecx = (ecx - 1) >>> 0; if (ecx === 0) break;
  }
  return { zf: 0 };  // or al,1
};
// 0x1a344: [+46]=0x2f (приказ «отдых»)
F[0x1a344] = (eng, r) => { eng.m.w8(UNITS + r.esi + U.ORDER, 0x2f); };
// 0x1a386: приказ цели edi: [edi+46]=al, [edi+47]=esi
F[0x1a386] = (eng, r) => { eng.m.w8(UNITS + r.edi + U.ORDER, r.eax & 0xff); eng.m.w32(UNITS + r.edi + 0x47, r.esi); };

// 0x1a6e3: следующий кадр ходьбы
F[0x1a6e3] = (eng, r) => {
  const m = eng.m, esi = r.esi; const type = m.u8(UNITS + esi + U.TYPE);
  let bx, al;
  if (type < 9) {
    bx = m.u16(0x36e38 + type * 2);
    bx = w16(bx + m.u16(0x36e18 + m.u8(UNITS + esi + U.ATKCTR) * 2));
    bx = w16(bx + m.u16(0x36e68 + m.u16(UNITS + esi + U.DIR) * 2));
    al = m.u16(UNITS + esi + U.DIR) & 0xff;
  } else {
    bx = m.u16(0x36e38 + type * 2);
    bx = w16(bx + m.u16(0x36e28 + m.u8(UNITS + esi + U.ATKCTR) * 2));
    bx = w16(bx + m.u16(0x36e7a + m.u8(UNITS + esi + U.DIR) * 2));
    al = m.u8(UNITS + esi + U.DIR);
  }
  m.w16(UNITS + esi + U.SPR, bx);
  const c = (m.u8(UNITS + esi + U.ATKCTR) + 1) & 0xff; m.w8(UNITS + esi + U.ATKCTR, c);
  if (c > 7) m.w8(UNITS + esi + U.ATKCTR, 0);
  return { eax: al };
};

// 0x1a984: поправка направления eax по разнице |dx-X|,|bx-Y| (таблица 0x1a9ec, 9 входов)
F[0x1a984] = (eng, r) => {
  const m = eng.m, esi = r.esi; const dir = r.eax >>> 0; let al = r.eax & 0xff;
  const dx = abs16(w16(r.edx) - m.u16(UNITS + esi + U.X)), bx = abs16(w16(r.ebx) - m.u16(UNITS + esi + U.Y));
  if (dir === 2 || dir === 6) {           // 0x1a98c
    if (dx < bx) { if (bx > dx) al = (al - 1) & 0xff; }
    else if (dx > bx) al = (al + 1) & 0xff;
  } else if (dir === 4 || dir === 8) {    // 0x1a9b9 (таблица 0x1a9ec: входы 4 и 8)
    if (dx <= bx) { if (bx > dx) { al = (al + 1) & 0xff; if (al >= 9) al = 1; } }
    else al = (al - 1) & 0xff;
  }
  return { eax: lo8(r.eax, al) };
};

// 0x1e19b: одна симуляция обхода по стороне [+3f] → {ecx}
F[0x1e19b] = (eng, r) => {
  const m = eng.m, esi = r.esi; m.w8(0x37988, 1);
  if (m.u8(UNITS + esi + 0x3f) === 1) { call(eng, 0x1e1c5, r); return { ecx: m.u16(0x37978) }; }
  call(eng, 0x1e399, r); return { ecx: m.u16(0x3796c) };
};
// 0x1e11e: обе симуляции, выбор лучшей → {eax: al(сторона), edx, ebx, ecx}
F[0x1e11e] = (eng, r) => {
  const m = eng.m, esi = r.esi; m.w8(0x37988, 0);
  call(eng, 0x1e399, r); call(eng, 0x1e1c5, r);
  const side0 = () => ({ eax: 0, edx: m.u16(0x37970), ebx: m.u16(0x37972), ecx: m.u16(0x37974) });
  const side1 = () => ({ eax: 1, edx: m.u16(0x3797c), ebx: m.u16(0x3797e), ecx: m.u16(0x37980) });
  let ax = m.u16(0x3796e), b = m.u16(0x3797a);
  if (b > ax) return side0(); if (b < ax) return side1();
  ax = m.u16(0x37976); b = m.u16(0x37982); if (b < ax) return side1(); if (b > ax) return side0();
  ax = m.u16(0x37974); b = m.u16(0x37980); if (b < ax) return side1(); if (b > ax) return side0();
  return m.u8(UNITS + esi + 0x3f) === 1 ? side1() : side0();
};
// общая симуляция «вдоль стены»: side=0 → 0x1e399 (таблицы 0x37970..), side=1 → 0x1e1c5 (0x3797c..)
function wallSim(eng, r, side) {
  const m = eng.m, esi = r.esi;
  const P = side ? { pos: 0x3797c, cnt: 0x3797a, bestcnt: 0x37982, best: 0x37980, res: 0x37978, rotA: 0x37818, rotB: 0x377f4 }
                 : { pos: 0x37970, cnt: 0x3796e, bestcnt: 0x37976, best: 0x37974, res: 0x3796c, rotA: 0x377f4, rotB: 0x37818 };
  const saved = m.u32(UNITS + esi + U.X);
  m.w16(UNITS + esi + U.X, m.u16(UNITS + esi + U.X) >>> 5); m.w16(UNITS + esi + U.Y, m.u16(UNITS + esi + U.Y) >>> 5);
  m.w32(P.pos, m.u32(UNITS + esi + U.X));
  const tx = m.u16(UNITS + esi + U.DSTX) >>> 5, ty = m.u16(UNITS + esi + U.DSTY) >>> 5;
  m.w16(0x37984, tx); m.w16(0x37986, ty); m.w16(P.cnt, 0); m.w16(P.bestcnt, 0);
  m.w16(P.best, w16(abs16(tx - m.u16(UNITS + esi + U.X)) + abs16(ty - m.u16(UNITS + esi + U.Y))));
  let ebp = m.u16(UNITS + esi + U.DIR), edi = m.u16(UNITS + esi + 0x3b);
  globalThis.__сч15 = 0;
  for (;;) { if (++globalThis.__сч15 > 3e6) throw new Error("ЦИКЛ move.js:175");                                                      // 0x1e421 / 0x1e24d
    const X = m.u16(UNITS + esi + U.X), Y = m.u16(UNITS + esi + U.Y);
    if (X === m.u16(0x37984) && Y === m.u16(0x37986)) { m.w16(P.res, 0); break; }
    if (edi === 0) ebp = call(eng, 0x1a95d, { esi, edx: m.u16(0x37984), ebx: m.u16(0x37986) }).eax >>> 0;
    let ecx = 2;
    while (edi !== 0) { ebp = m.u32(P.rotA + ebp * 4); edi--; ecx--; if (ecx === 0) break; }
    let moved = false;
    for (let cl = 8; cl > 0; cl--) {
      const dx = w16((X + m.u16(0x30504 + ebp * 4)) << 5), bx = w16((Y + m.u16(0x30506 + ebp * 4)) << 5);
      const t = call(eng, 0x1e685, { esi, edx: dx, ebx: bx, ebp });
      if (!t.zf || (t.eax & 0xff) > 1) { moved = true; break; }
      edi++; ebp = m.u32(P.rotB + ebp * 4);
    }
    if (!moved) { m.w16(P.res, 1); break; }
    m.w16(UNITS + esi + U.X, w16(X + m.u16(0x30504 + ebp * 4))); m.w16(UNITS + esi + U.Y, w16(Y + m.u16(0x30506 + ebp * 4)));
    m.w16(P.cnt, m.u16(P.cnt) + 1);
    if (m.u16(P.cnt) >= 0xc8) { m.w16(P.res, 1); break; }
    const nx = m.u16(UNITS + esi + U.X), ny = m.u16(UNITS + esi + U.Y);
    const d = w16(abs16(m.u16(0x37984) - nx) + abs16(m.u16(0x37986) - ny));
    if (m.u16(P.best) > d) { m.w16(P.best, d); m.w16(P.bestcnt, m.u16(P.cnt)); m.w16(P.pos, nx); m.w16(P.pos + 2, ny); }
  }
  m.w16(P.pos, w16(m.u16(P.pos) << 5)); m.w16(P.pos + 2, w16(m.u16(P.pos + 2) << 5));
  m.w32(UNITS + esi + U.X, saved);
}
F[0x1e399] = (eng, r) => wallSim(eng, r, 0);
F[0x1e1c5] = (eng, r) => wallSim(eng, r, 1);

// 0x1df84: выбор направления/стороны обхода → {cf, eax: al, edx, ebx}
F[0x1df84] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  const X = () => m.u16(UNITS + esi + U.X), Y = () => m.u16(UNITS + esi + U.Y);
  const fin = () => ({ cf: 0, eax: m.u8(UNITS + esi + 0x3f), edx: X(), ebx: Y() });   // 0x1e07c
  if (m.u16(UNITS + esi + 0x3b) > 1) {
    const t = call(eng, 0x1e19b, r);
    if ((t.ecx & 0xff) !== 0) return fin();
    return { cf: 1 };
  }
  let dx = m.u16(UNITS + esi + U.DSTX), bx = m.u16(UNITS + esi + U.DSTY);
  let eax = call(eng, 0x1a95d, { esi, edx: dx, ebx: bx }).eax >>> 0;
  if (m.u16(UNITS + esi + 0x3b) >= 1) eax = call(eng, 0x1a984, { esi, eax, edx: dx, ebx: bx }).eax >>> 0;
  m.w16(UNITS + esi + U.DIR, eax); m.w16(UNITS + esi + 0x3b, 0);
  dx = w16(X() + m.u16(0x30528 + eax * 4)); bx = w16(Y() + m.u16(0x3052a + eax * 4));
  const t = call(eng, 0x1e685, { esi, edx: dx, ebx: bx, ebp: eax });
  if (!t.zf) return { cf: 1 };                 // прямо свободно — обход не нужен (jne 0x1df9b: stc)
  if ((t.eax & 0xff) >= 2) return { cf: 1 };
  const st = m.u8(UNITS + esi + U.STATE);
  let far = false;
  if (st === 0x11 || st === 0x31 || st >= 0x80 || st >= 0x50) far = true;
  else {
    dx = abs16(m.u16(UNITS + esi + U.DSTX) - X()); bx = abs16(m.u16(UNITS + esi + U.DSTY) - Y());
    if (bx <= dx) bx = dx;
    if (bx >= 0xe0) { if (bx >= 0x180) return farPath(eng, r, false); far = true; }
    else {
      const c = call(eng, 0x1e609, { esi, edx: m.u16(UNITS + esi + U.DSTX), ebx: m.u16(UNITS + esi + U.DSTY) });
      if (!c.zf) { if (bx >= 0x180) return farPath(eng, r, false); far = true; }
      else if ((c.eax & 0xff) >= 2) far = true;
      else return fin();
    }
  }
  return farPath(eng, r, far);
};
/** 0x1e099/0x1e0a0: длинный маршрут — построить путь и пойти по нему. */
function farPath(eng, r, flag) {          // 0x1e099 / 0x1e0a0
  const m = eng.m, esi = r.esi;
  if (flag) m.w8(0x377f1, 1);
  const t = call(eng, 0x1e11e, r); m.w8(0x377f1, 0);
  const ret = { cf: 0, eax: t.eax, edx: t.edx, ebx: t.ebx, ecx: t.ecx };
  if ((t.eax & 0xff) === 0) { if (m.u16(0x3796e) < 0xc3) return ret; }
  else if (m.u16(0x3797a) < 0xc3) return ret;
  if ((t.ecx & 0xffff) <= 0xf) return ret;
  ret.edx = m.u16(UNITS + esi + U.X); ret.ebx = m.u16(UNITS + esi + U.Y); return ret;
}

// 0x1de57: следующее направление на тайле → {eax, ecx: cl, edi: di}
F[0x1de57] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  const X = () => m.u16(UNITS + esi + U.X), Y = () => m.u16(UNITS + esi + U.Y);
  if (m.u32(UNITS + esi + U.X) === m.u32(UNITS + esi + U.DSTX)) return { eax: 0 };
  const p = call(eng, 0x1df84, r);
  if (!p.cf) { m.w8(UNITS + esi + 0x3f, p.eax & 0xff); m.w16(UNITS + esi + U.DSTX, p.edx); m.w16(UNITS + esi + U.DSTY, p.ebx); }
  if (m.u32(UNITS + esi + U.X) === m.u32(UNITS + esi + U.DSTX)) return { eax: 0 };
  let di = m.u16(UNITS + esi + 0x3b), ebp = m.u16(UNITS + esi + U.DIR);
  m.w16(0x377f2, di);
  let cl = 2;
  while (di !== 0) { di--; ebp = m.u32((m.u8(UNITS + esi + 0x3f) !== 0 ? 0x37818 : 0x377f4) + ebp * 4); cl--; if (cl === 0) break; }
  m.w8(0x377f0, 0);
  let edi = di;
  for (cl = 8; cl > 0; cl--) {
    const dx = w16(X() + m.u16(0x30528 + ebp * 4)), bx = w16(Y() + m.u16(0x3052a + ebp * 4));
    const t = call(eng, 0x1e685, { esi, edx: dx, ebx: bx, ebp });
    if (!t.zf) {                                               // 0x1df72
      if (edi === 0) m.w8(UNITS + esi + 0x40, 0);
      return { eax: ebp, ecx: 0, edi };
    }
    if (m.u8(UNITS + esi + 0x40) < 1) return { eax: m.u16(UNITS + esi + U.DIR), edi: m.u16(0x377f2), ecx: 3 };  // 0x1df61
    edi++; ebp = m.u32((m.u8(UNITS + esi + 0x3f) !== 0 ? 0x377f4 : 0x37818) + ebp * 4);
  }
  if (m.u8(0x377f0) === 0) return { eax: 0 };
  return { eax: m.u16(UNITS + esi + U.DIR), edi: m.u16(0x377f2), ecx: 3 };
};

// 0x1db94: начало движения к [+37]/[+39]
F[0x1db94] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  if (m.u8(0x32aec + m.u8(UNITS + esi + U.OWNER)) !== 0) {
    const c = call(eng, 0x14873, { esi, eax: 0x1a });
    if (!c.cf) {
      let dx = abs16(m.u16(UNITS + esi + U.X) - m.u16(UNITS + esi + U.DSTX)), bx = abs16(m.u16(UNITS + esi + U.Y) - m.u16(UNITS + esi + U.DSTY));
      if (dx < bx) dx = bx;
      if (dx >= 0x140) return call(eng, 0x1a393, { esi, eax: 0xb2, edx: m.u16(UNITS + esi + U.DSTX), ebx: m.u16(UNITS + esi + U.DSTY) });
    }
  }
  m.w16(UNITS + esi + 0x3b, 0); m.w8(UNITS + esi + 0x40, 0); m.w8(UNITS + esi + U.ATKCTR, 0);
  const d = call(eng, 0x1a95d, { esi, edx: m.u16(UNITS + esi + U.DSTX), ebx: m.u16(UNITS + esi + U.DSTY) }).eax >>> 0;
  if (d !== 0) m.w16(UNITS + esi + U.DIR, d);
  call(eng, 0x1a773, { esi });
  return call(eng, 0x1e56d, { esi, edx: m.u16(UNITS + esi + U.X), ebx: m.u16(UNITS + esi + U.Y) });
};

// 0x1dc43: шаг движения → {eax}; al==0 — прибыли
F[0x1dc43] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  const X = () => m.u16(UNITS + esi + U.X), Y = () => m.u16(UNITS + esi + U.Y);
  const arrive = () => {                                    // 0x1dcfe
    const edx = m.u8(UNITS + esi + 0x53), ebx = m.u8(UNITS + esi + 0x54) << 8;
    if (m.u8(UNITS + esi + U.TYPE) !== 0xb) m.w8(MO + edx + ebx, m.u8(MO + edx + ebx) & 0xf0);
    else { const cl = ((m.u8(UNITS + esi + U.OWNER) + 1) << 4) & 0xff; m.w8(MO + edx + ebx, (m.u8(MO + edx + ebx) & 0x0f) | cl); }
    if (m.u8(G.humanOwner) === m.u8(UNITS + esi + U.OWNER)) call(eng, 0x1a4cc, { esi });
    return { eax: 0 };
  };
  if (m.u8(UNITS + esi + 0x40) > 1) {
    if (m.u16(UNITS + esi + 0x3b) > 0) { m.w8(UNITS + esi + 0x40, m.u8(UNITS + esi + 0x40) - 1); call(eng, 0x1a773, { esi }); return { eax: m.u16(UNITS + esi + U.DIR) }; }
    let blocked = false;
    if (m.u8(UNITS + esi + 0x40) >= 0xc) blocked = true;
    else {
      const ebp = m.u16(UNITS + esi + U.DIR);
      const t = call(eng, 0x1e685, { esi, edx: w16(X() + m.u16(0x30528 + ebp * 4)), ebx: w16(Y() + m.u16(0x3052a + ebp * 4)), ebp });
      if (t.zf) { m.w8(UNITS + esi + 0x40, m.u8(UNITS + esi + 0x40) + 1); call(eng, 0x1a773, { esi }); return { eax: m.u16(UNITS + esi + U.DIR) }; }  // тайл занят — продолжаем вдоль стены
      blocked = true;   // тайл свободен (jne 0x1dcb5) — пробуем выйти на прямую
    }
    if (blocked) {                                          // 0x1dcb5
      if (m.u32(UNITS + esi + U.X) === m.u32(UNITS + esi + U.DSTX)) return arrive();
      const p = call(eng, 0x1df84, r);
      if (!p.cf) { m.w8(UNITS + esi + 0x3f, p.eax & 0xff); m.w16(UNITS + esi + U.DSTX, p.edx); m.w16(UNITS + esi + U.DSTY, p.ebx); }
      m.w8(UNITS + esi + 0x40, 1);
    }
  }
  if ((m.u32(UNITS + esi + U.X) & 0x1f001f) === 0) {         // на тайле
    const n = call(eng, 0x1de57, r);
    if ((n.eax & 0xff) === 0) return arrive();
    m.w16(UNITS + esi + U.DIR, n.eax);
    if ((n.ecx & 0xff) !== 0) { m.w8(UNITS + esi + 0x40, n.ecx & 0xff); return { eax: n.eax }; }
    m.w16(UNITS + esi + 0x3b, n.edi);
    call(eng, 0x1e5cc, { esi, edx: w16(m.u8(UNITS + esi + 0x53) << 5), ebx: w16(m.u8(UNITS + esi + 0x54) << 5) });
    const eax = n.eax & 0xffff;
    call(eng, 0x1e56d, { esi, edx: w16(m.u16(0x30528 + eax * 4) + X()), ebx: w16(m.u16(0x3052a + eax * 4) + Y()) });
    if (m.u8(G.humanOwner) === m.u8(UNITS + esi + U.OWNER)) call(eng, 0x1a4cc, { esi });
  }
  // 0x1ddc1: собственно шаг
  const eax = m.u16(UNITS + esi + U.DIR);
  const c = (m.u8(UNITS + esi + 0x41) - 1) & 0xff; m.w8(UNITS + esi + 0x41, c);
  if (c === 0) {
    let bl = (0xff - m.u8(UNITS + esi + U.SPD)) & 0xff; bl = (bl >>> 5) + 1; m.w8(UNITS + esi + 0x41, bl);
    m.w16(UNITS + esi + U.X, w16(X() + m.u16(0x3788a + eax * 4))); m.w16(UNITS + esi + U.Y, w16(Y() + m.u16(0x37888 + eax * 4)));
  }
  m.w16(UNITS + esi + U.X, w16(X() + m.u16(0x37866 + eax * 4))); m.w16(UNITS + esi + U.Y, w16(Y() + m.u16(0x37864 + eax * 4)));
  m.w16(UNITS + esi + U.X, w16(X() + m.u16(0x378d0 + (X() & 0x1f) * 2)));
  m.w16(UNITS + esi + U.Y, w16(Y() + m.u16(0x378d0 + (Y() & 0x1f) * 2)));
  return call(eng, 0x1a6e3, { esi });
};

// ---------- обработчики состояний ----------
// 0x18b35: состояния 0x0x (движение)
F[0x18b35] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  if (m.u8(UNITS + esi + U.STATE) === 0x0f) { m.w8(UNITS + esi + U.STATE, 0); return call(eng, 0x1db94, r); }
  const t = call(eng, 0x1dc43, r);
  if ((t.eax & 0xff) !== 0) return;
  if (m.u8(UNITS + esi + U.ANIM) === 1 && m.u8(UNITS + esi + U.TYPE) === 4) return call(eng, 0x1d1cf, r);
  const bl = m.u8(UNITS + esi + U.F08);
  if (bl !== 0) {
    const slot = m.u8(UNITS + esi + U.SLOT);
    const a = (bl === 1 ? 0x32b6c : 0x32bbc) + slot * 2; m.w16(a, m.u16(a) + 1);
  }
  const v = (m.u8(UNITS + esi + 0x52) + 1) & 0xff; m.w8(UNITS + esi + 0x52, v);
  if (v === 0) { m.w8(UNITS + esi + U.STATE, 0x2f); return; }
  call(eng, 0x1a773, { esi }); return call(eng, 0x1a34c, { esi });
};
// 0x18e0b: состояния 0x2x (отдых)
F[0x18e0b] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  if (m.u8(UNITS + esi + U.STATE) === 0x2f) {
    m.w8(UNITS + esi + U.STATE, 0x20); m.w8(UNITS + esi + U.ATKCTR, 0); call(eng, 0x1e0e0, { esi }); return call(eng, 0x1a773, { esi });
  }
  const c = (m.u8(UNITS + esi + U.ATKCTR) + 1) & 0xff; m.w8(UNITS + esi + U.ATKCTR, c);
  if (c < 0x20) return;
  m.w8(UNITS + esi + U.ATKCTR, 0);
  if ((m.u8(UNITS + esi + 0x42) & 1) === 0) { m.w32(G.rngN, 0xd); call(eng, 0x204a6, { esi }); }
  if (m.u8(UNITS + esi + U.HP) < m.u8(UNITS + esi + U.HPMAX)) m.w8(UNITS + esi + U.HP, m.u8(UNITS + esi + U.HP) + 1);
  if (m.u8(UNITS + esi + U.MANA) < m.u8(UNITS + esi + U.MAG)) m.w8(UNITS + esi + U.MANA, m.u8(UNITS + esi + U.MANA) + 1);
};
// 0x18e89: состояния 0x3x (охрана / простой / атака из охраны)
F[0x18e89] = (eng, r) => {
  const m = eng.m, esi = r.esi; const st = m.u8(UNITS + esi + U.STATE);
  const X = () => m.u16(UNITS + esi + U.X), Y = () => m.u16(UNITS + esi + U.Y);
  const onTile = () => (X() & 0x1f) === 0 && (Y() & 0x1f) === 0;
  if (st === 0x38) {
    const c = (m.u8(UNITS + esi + U.ATKCTR) - 1) & 0xff; m.w8(UNITS + esi + U.ATKCTR, c);
    if (c !== 0) { if (m.u8(UNITS + esi + U.TYPE) === 0xb) return call(eng, 0x1a773, { esi }); return; }
    const f = call(eng, 0x1a526, { esi });
    if ((f.edi >>> 0) !== 0) return call(eng, 0x19fdf, { esi, edi: f.edi >>> 0 });
    let dl;
    if (m.u8(UNITS + esi + U.TYPE) === 0xb) dl = 0x10;
    else { m.w32(G.rngRange, 0x14); dl = (eng.rand_raw() + 5) & 0xff; }
    m.w8(UNITS + esi + U.ATKCTR, dl); m.w8(UNITS + esi + U.FLAGS50, m.u8(UNITS + esi + U.FLAGS50) + 1);
    if (dl !== 0x18) return call(eng, 0x1a773, { esi });
    m.w32(G.rngRange, 3); const dx = w16(eng.rand_raw() - 1);
    let d = w16(m.u16(UNITS + esi + U.DIR) + dx); m.w16(UNITS + esi + U.DIR, d);
    if (d >= 9) m.w16(UNITS + esi + U.DIR, 1); else if (d === 0) m.w16(UNITS + esi + U.DIR, 8);
    return call(eng, 0x1a773, { esi });
  }
  if (st === 0x3f) {
    m.w8(UNITS + esi + 0x44, X() >>> 5); m.w8(UNITS + esi + 0x45, Y() >>> 5);
    m.w8(UNITS + esi + U.STATE, 0x38); m.w8(UNITS + esi + U.ATKCTR, 1); m.w8(UNITS + esi + U.FLAGS50, 0);
    return call(eng, 0x1e0e0, { esi });
  }
  if (st === 0x36) {
    const t = call(eng, 0x1dc43, r);
    if ((t.eax & 0xff) !== 0) {
      if (!onTile()) return;
      const f = call(eng, 0x1a526, { esi });
      if ((f.edi >>> 0) !== 0) return call(eng, 0x19fdf, { esi, edi: f.edi >>> 0 });
      return;
    }
    m.w8(UNITS + esi + U.STATE, 0x38); m.w8(UNITS + esi + U.ATKCTR, 1); return call(eng, 0x1e0e0, { esi });
  }
  if (st === 0x37) {
    if (!onTile()) return;
    m.w8(UNITS + esi + U.STATE, 0x36);
    m.w16(UNITS + esi + U.DSTX, m.u8(UNITS + esi + 0x44) << 5); m.w16(UNITS + esi + U.DSTY, m.u8(UNITS + esi + 0x45) << 5);
    return call(eng, 0x1db94, r);
  }
  // 0x19011: атака из охраны 0x30..0x33
  const edi = m.u32(UNITS + esi + U.TARGET);
  const tst = m.u8(UNITS + edi + U.STATE);
  const chase = () => {                                     // 0x1915b
    m.w8(UNITS + esi + U.STATE, 0x31);
    m.w16(UNITS + esi + U.DSTX, m.u16(UNITS + edi + U.X) & 0xffe0); m.w16(UNITS + esi + U.DSTY, m.u16(UNITS + edi + U.Y) & 0xffe0);
    return call(eng, 0x1db94, r);
  };
  const cooldown = () => {                                  // 0x1914e
    const c = (m.u8(UNITS + esi + U.ATKCTR) - 1) & 0xff; m.w8(UNITS + esi + U.ATKCTR, c);
    if (c === 0) return chase(); return call(eng, 0x1a773, { esi });
  };
  const step31 = () => {                                    // 0x190e2
    if (st !== 0x31) { m.w8(UNITS + esi + U.STATE, 0x32); m.w8(UNITS + esi + U.ATKCTR, (0x10 - (m.u8(UNITS + esi + U.SPD) >>> 4)) & 0xff); return; }
    const t = call(eng, 0x1dc43, r);
    if ((t.eax & 0xff) !== 0) return;
    const e = m.u32(UNITS + esi + U.TARGET);
    const dx = m.u16(UNITS + e + U.X) & 0xffe0, bx = m.u16(UNITS + e + U.Y) & 0xffe0;
    const z = call(eng, 0x1a463, { esi, edx: dx, ebx: bx });
    if (!z.zf) return call(eng, 0x1a354, { esi });
    m.w16(UNITS + esi + U.DSTX, dx); m.w16(UNITS + esi + U.DSTY, bx); return call(eng, 0x1db94, r);
  };
  if (st === 0x33) return chase();
  if (tst === 0x60 || tst === 0x6f) {
    if (onTile()) return call(eng, 0x1a354, { esi });
    if (st === 0x32) return cooldown();
    return step31();
  }
  if (st === 0x32) return cooldown();
  const a = call(eng, 0x1a051, { esi, edi });
  if ((a.eax & 0xff) !== 0) return step31();
  if (st !== 0x30) { m.w8(UNITS + esi + U.STATE, 0x30); m.w8(UNITS + esi + U.ATKCTR, 2); call(eng, 0x1e0e0, { esi }); }
  const ty = m.u8(UNITS + edi + U.TYPE);
  const dx = w16(m.u16(UNITS + edi + U.X) + m.u16(0x30456 + ty * 4)) & 0xffe0, bx = w16(m.u16(UNITS + edi + U.Y) + m.u16(0x30458 + ty * 4)) & 0xffe0;
  m.w16(UNITS + esi + U.DSTX, dx); m.w16(UNITS + esi + U.DSTY, bx);
  let eax = call(eng, 0x1a95d, { esi, edx: dx, ebx: bx }).eax >>> 0;
  eax = call(eng, 0x1aa10, { esi, eax, edx: dx, ebx: bx }).eax >>> 0;
  m.w16(UNITS + esi + U.DIR, eax);
  return call(eng, 0x1a7cb, { esi, edi, eax });
};

// таблицы диспетчера
const TAB_182A8 = [0x18b35, 0x18bb3, 0x18e0b, 0x18e89, 0x1918c, 0x19229, 0x19693, 0x197e4];
const TAB_182C8 = [ // полная таблица 0x182c8 (состояния 0x80..0xdf; дополнена темой D по дампу оригинала)
  0x197e5, 0x197e5, 0x197e5, 0x197e5, 0x19872, 0x18267, 0x1990c, 0x1999e,
  0x1999e, 0x1999e, 0x18267, 0x19a2b, 0x19a91, 0x19abd, 0x19adc, 0x18267,
  0x19afb, 0x19afb, 0x19afb, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267,
  0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267,
  0x19b0a, 0x19b0a, 0x19b0a, 0x19b0a, 0x19b0a, 0x18267, 0x19b0a, 0x19b0a,
  0x19b0a, 0x19b0a, 0x18267, 0x19b41, 0x19b0a, 0x19b49, 0x19b51, 0x18267,
  0x19b59, 0x19b59, 0x19b59, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267,
  0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267,
  0x19b78, 0x19b78, 0x19b78, 0x19b78, 0x19b78, 0x18267, 0x19b8c, 0x19b8c,
  0x19b8c, 0x19b78, 0x18267, 0x19b78, 0x19b78, 0x19b78, 0x19ba7, 0x18267,
  0x19b78, 0x19b78, 0x19b78, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267,
  0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267,
  // 0xe0 стройка и 0xe1 команда панели — раньше таблица обрывалась на 0xdf, и оба состояния
  // молча ничего не делали: конструктор навсегда застывал в «строится».
  0x1d1cf, 0x19bbe, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267];
/** Разослать юнита по обработчику его состояния (старший полубайт STATE). */
function dispatchState(eng, esi) {
  const al = eng.m.u8(UNITS + esi + U.STATE);
  const h = al < 0x80 ? TAB_182A8[al >>> 4] : TAB_182C8[al - 0x80];
  if (h === 0x18267 || h === 0x197e4 || h === undefined) return;   // ret
  return call(eng, h, { esi });
}
/** 0x181d7/0x18211: применить приказ на клетке — сменить состояние и, если надо, сбросить анимацию. */
function applyOrder(eng, esi, al, resetAnim) {                     // 0x181d7 / 0x18211
  const m = eng.m;
  m.w8(UNITS + esi + U.STATE, al);
  m.w32(UNITS + esi + U.TARGET, m.u32(UNITS + esi + 0x47));
  m.w16(UNITS + esi + U.DSTX, m.u16(UNITS + esi + 0x4b)); m.w16(UNITS + esi + U.DSTY, m.u16(UNITS + esi + 0x4d));
  m.w8(UNITS + esi + U.ORDER, 0xff);
  if (resetAnim) m.w8(UNITS + esi + U.ANIM, 0);
}
// 0x18154: обработчик людей и ручных динозавров (типы 1..13)
F[0x18154] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  if (m.u16(G.stepLow) === 0) call(eng, 0x18ab2, { esi, eax: 1 });
  const ord = m.u8(UNITS + esi + U.ORDER);
  if (ord !== 0xff && (m.u16(UNITS + esi + U.X) & 0x1f) === 0 && (m.u16(UNITS + esi + U.Y) & 0x1f) === 0) {
    const al = ord;
    if (al === 0x6f) { const s = m.u8(UNITS + esi + U.STATE); if (s === 0x6f || s === 0x60) return; }
    const hi = al >>> 4;
    if (hi === 1 || hi === 2) applyOrder(eng, esi, al, true);
    else if (hi === 0xe) { if (al === 0xe0) applyOrder(eng, esi, al, false); else { m.w8(UNITS + esi + U.ORDER, 0xff); call(eng, 0x19bbe, { esi }); } }
    else if (hi === 0xf) return;
    else applyOrder(eng, esi, al, false);
  }
  call(eng, 0x163e4, { esi });
  return dispatchState(eng, esi);
};
// 0x184c8: обработчик диких зверей (типы 14..23)
F[0x184c8] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  if (m.u16(G.stepLow) === 0) call(eng, 0x18ab2, { esi, eax: 1 });
  if ((m.u16(UNITS + esi + U.X) & 0x1f) === 0 && (m.u16(UNITS + esi + U.Y) & 0x1f) === 0) {
    call(eng, 0x172c5, { esi });
    const ord = m.u8(UNITS + esi + U.ORDER);
    if (ord !== 0xff) applyOrder(eng, esi, ord, false);
  }
  const al = m.u8(UNITS + esi + U.STATE);
  if (al > 0x6f) return;
  return call(eng, TAB_182A8[al >>> 4], { esi });
};
// 0x172c5: решение дикого зверя раз в 14 «простоев»: подобрать еду рядом или пастись в своём прямоугольнике
F[0x172c5] = (eng, r) => {
  const m = eng.m, esi = r.esi;
  if (m.u8(UNITS + esi + U.FLAGS50) < 0xe) return;
  if ((m.u8(UNITS + esi + U.STATE) & 0xf0) !== 0x40) {
    const f = call(eng, 0x170f6, { esi });
    if ((f.edi >>> 0) !== 0) {
      m.w8(UNITS + esi + U.ORDER, 0x44);
      m.w16(UNITS + esi + 0x4b, w16(f.edx << 5)); m.w16(UNITS + esi + 0x4d, w16(f.ebx << 5));
    } else {
      let eax = (m.u8(UNITS + esi + 0x58) - m.u8(UNITS + esi + 0x56)) & 0xff; m.w32(G.rngRange, eax);
      let dl = eng.rand_raw() & 0xff;
      let ebx = (m.u8(UNITS + esi + 0x56) + dl) & 0xff;
      eax = (m.u8(UNITS + esi + 0x57) - m.u8(UNITS + esi + 0x55)) & 0xff; m.w32(G.rngRange, eax);
      let edx = eng.rand_raw(); edx = lo8(edx, (edx + m.u8(UNITS + esi + 0x55)) & 0xff);
      edx = (edx << 5) >>> 0; ebx = (ebx << 5) >>> 0;
      const c = call(eng, 0x1e609, { esi, edx, ebx });
      if (!c.zf) call(eng, 0x19fbf, { esi, edx, ebx });
    }
  }
  m.w8(UNITS + esi + U.FLAGS50, 0);
};
