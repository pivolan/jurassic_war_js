// Тема D: магия, предметы, решения юнита перед диспетчером (FUN_000163e4). Порт pwar.exe, адреса в именах.
import { F, call } from '../fn.js';
import { G, U, UNITS, BI, MO, PROJ, ITEMS } from '../mem.js';
const A = UNITS;
/** Усечение до 8/16/32 бит — как в оригинале, где регистры узкие. */
const b8 = v => v & 0xff, w16 = v => v & 0xffff, d32 = v => v >>> 0;
/** 16-битное со знаком. */
const s16 = v => (v << 16) >> 16;

// ---------- звук: 0x2000d (запрос на воспроизведение, пишет 0x38870+id*8), 0x1ffaa (звук заклинания), 0x1ffb6 (звук предмета)
F[0x2000d] = (eng, r) => { // eax=id, esi=юнит
  const m = eng.m, esi = r.esi, eax = d32(r.eax);
  const camx = d32((m.u32(0x31af0) << 4) + m.u32(0x31ae8));
  let ecx = d32(m.u16(A + esi + U.X) - camx), ebx;
  if (m.u16(A + esi + U.X) < camx) { ecx = d32(-ecx) >>> 5; ebx = m.u8(0x39060 + ecx); } else { ecx >>>= 5; ebx = m.u8(0x39161 + ecx); }
  let edx; ecx = d32(m.u16(A + esi + U.X) - camx);
  if (m.u16(A + esi + U.X) < camx) { ecx = d32(-ecx) >>> 5; edx = m.u8(0x39161 + ecx); } else { ecx >>>= 5; edx = m.u8(0x39060 + ecx); }
  ecx = d32(0xf0 + m.u32(0x31aec));
  let edi = d32(m.u16(A + esi + U.Y) - ecx); if (m.u16(A + esi + U.Y) < ecx) edi = d32(-edi); edi >>>= 5;
  ecx = m.u8(0x39262 + edi);
  const vol = m.u16(0x300a2); if (vol <= ecx) return { edi, ebx, edx, ecx };
  edi = vol - ecx; ecx = 0xf - edi;   // ecx может быть отрицательным (32-бит)
  ecx = d32(ecx);
  ebx = ebx < ecx ? 0 : ebx - ecx; edx = edx < ecx ? 0 : edx - ecx;
  if (d32(ebx + edx) === 0) return { edi, ebx, edx, ecx: d32(ebx + edx) };
  const slot = 0x38870 + eax * 8;
  if (m.u32(slot) === 0) { m.w32(slot, eax); m.w16(slot + 4, ebx); m.w16(slot + 6, edx); }
  else { if (m.u16(slot + 4) <= (ebx & 0xffff)) m.w16(slot + 4, ebx); if (m.u16(slot + 6) <= (edx & 0xffff)) m.w16(slot + 6, edx); }
  return { edi, ebx, edx, ecx: d32(ebx + edx) };
};
F[0x1ffaa] = (eng, r) => { const eax = eng.m.u32(0x38f98 + d32(r.ebx) * 4); if (eax !== 0) return call(eng, 0x2000d, { eax, esi: r.esi }); return { eax }; };
F[0x1ffb6] = (eng, r) => { const m = eng.m; if (m.u8(0x30c4c) !== 1) return { cf: 1 }; const eax = m.u32(0x38fe4 + d32(r.eax) * 4); return call(eng, 0x2000d, { eax, esi: r.esi }); };

// ---------- умения / мана
F[0x14873] = (eng, r) => { // al=бит умения, esi → cf=1 если недоступно или маны меньше стоимости
  const m = eng.m, esi = r.esi, bit = r.eax & 0xff;
  if (((m.u32(A + esi + U.SKILLS) >>> bit) & 1) === 0) return { cf: 1, eax: bit };
  const ebx = m.u32(0x30bbe + bit * 4); const bl = m.u8(ebx + 0x30b41);
  return { cf: m.u8(A + esi + U.MANA) < bl ? 1 : 0, eax: bit, ebx: (ebx & 0xffffff00) | bl };
};
F[0x1c092] = (eng, r) => { // al=заклинание: списать ману
  const m = eng.m, esi = r.esi, eax = d32(r.eax) & 0x7f; const ebx = m.u32(0x30bbe + eax * 4); const cost = m.u8(ebx + 0x30b61);
  const mana = m.u8(A + esi + U.MANA); m.w8(A + esi + U.MANA, mana < cost ? 0 : mana - cost); return { eax: (eax & ~0xff) | cost, ebx };
};
F[0x1c1b2] = (eng, r) => { // al=лечение, edi=цель
  const m = eng.m, edi = r.edi, al = r.eax & 0xff; const hp = m.u8(A + edi + U.HP) + al, mx = m.u8(A + edi + U.HPMAX);
  if (hp > 0xff) m.w8(A + edi + U.HP, mx); else { m.w8(A + edi + U.HP, hp); if (hp > mx) m.w8(A + edi + U.HP, mx); }
  return { eax: (r.eax & ~0xff) | mx };
};
F[0x1f475] = (eng, r) => { // открыть заклинания по MAG
  const m = eng.m, esi = r.esi; if (m.u8(A + esi + U.TYPE) >= 9) return {};
  const dl = m.u8(A + esi + U.MAG); const ptr = m.u32(0x30e64 + m.u8(A + esi + U.SLOT) * 4); const ebx = m.u32(ptr + m.u8(A + esi + U.TYPE) * 4);
  const eax = m.u32(A + esi + U.SKILLS); let cl = 0;
  const T = [[0x100, 0x30b60], [0x200, 0x30b64], [0x400, 0x30b68], [0x800, 0x30b6c], [0x1000, 0x30b70], [0x4000, 0x30b78], [0x8000, 0x30b7c], [0x10000, 0x30b80], [0x20000, 0x30b84], [0x80000, 0x30b8c], [0x100000, 0x30b90], [0x200000, 0x30b94], [0x400000, 0x30b98], [0x1000000, 0x30ba0], [0x2000000, 0x30ba4], [0x4000000, 0x30ba8]];
  for (const [bit, thr] of T) { if ((ebx & bit) === 0) continue; if (m.u8(thr) > dl) continue; if (eax & bit) continue; m.w32(A + esi + U.SKILLS, m.u32(A + esi + U.SKILLS) | bit); cl++; }
  // 0x1f6e6: открылись новые заклинания — обновить их ряд в панели выделенного юнита
  if (cl && m.u32(0x31adc) === esi && F[0x2673d]) F[0x2673d](eng, { esi });
  return {};
};

// ---------- приказы (маленькие сеттеры)
F[0x1a379] = (eng, r) => { eng.m.w8(A + r.esi + U.ORDER, r.eax & 0xff); eng.m.w32(A + r.esi + 0x47, d32(r.edi)); return {}; };
F[0x1a393] = (eng, r) => { const m = eng.m, esi = r.esi; m.w8(A + esi + U.ORDER, r.eax & 0xff); m.w32(A + esi + 0x47, 0); m.w16(A + esi + 0x4b, r.edx & 0xffe0); m.w16(A + esi + 0x4d, r.ebx & 0xffe0); return { edx: (r.edx & ~0xffff) | (r.edx & 0xffe0), ebx: (r.ebx & ~0xffff) | (r.ebx & 0xffe0) }; };
F[0x19fbf] = (eng, r) => { const m = eng.m, esi = r.esi; m.w32(A + esi + 0x47, 0); m.w8(A + esi + U.ORDER, 0x1f); m.w16(A + esi + 0x4b, r.edx); m.w16(A + esi + 0x4d, r.ebx); return {}; };
F[0x19f63] = (eng, r) => { // приказ атаки цели edi (баг оригинала: Y берётся у esi)
  const m = eng.m, esi = r.esi, edi = r.edi; if (m.u8(A + edi + U.OWNER) === m.u8(A + esi + U.OWNER)) return {};
  m.w8(A + esi + U.ORDER, 0x1f); m.w32(A + esi + 0x47, d32(edi)); const dx = m.u16(A + edi + U.X) & 0xffe0, bx = m.u16(A + esi + U.Y) & 0xffe0;
  m.w16(A + esi + 0x4b, dx); m.w16(A + esi + 0x4d, bx); return { edx: dx, ebx: bx };
};
F[0x1a2f2] = (eng, r) => { // al=1 если (dx,bx) вне квадрата ±bp вокруг esi или esi не на тайле (ah — остаток последнего ax, как в оригинале)
  const m = eng.m, esi = r.esi, dx = s16(r.edx), bx = s16(r.ebx), bp = s16(r.ebp); const hi = d32(r.eax) & 0xffff0000;
  if ((m.u8(A + esi + U.X) & 0x1f) || (m.u8(A + esi + U.Y) & 0x1f)) return { eax: hi | (r.eax & 0xff00) | 1 };
  let ax = w16(m.u16(A + esi + U.X) - bp); const ret = al => ({ eax: hi | (ax & 0xff00) | al });
  if (dx < s16(ax)) return ret(1); ax = w16(ax + bp + bp); if (dx > s16(ax)) return ret(1);
  ax = w16(m.u16(A + esi + U.Y) - bp); if (bx < s16(ax)) return ret(1); ax = w16(ax + bp + bp); if (bx > s16(ax)) return ret(1);
  return ret(0);
};

// ---------- пулы: юнит из free-list 0x1aaac
F[0x1aaac] = (eng, r) => {
  const m = eng.m; const free = m.u32(0x31b70); if (free === 0) return { cf: 1, esi: r.esi };
  const esi = free; const edi = m.u32(A + esi + U.NEXT); m.w32(A + edi + U.PREV, 0); m.w32(0x31b70, edi);
  const head = m.u32(0x31b6c); m.w32(A + esi + U.PREV, 0); m.w32(A + esi + U.NEXT, head); m.w32(A + head + U.PREV, esi); m.w32(0x31b6c, esi);
  return { cf: 0, esi, edi: head };
};

// ---------- поиск юнитов в области
function scanEnemy(eng, esi, edi) { // 0x1c0b8: первый чужой живой юнит в квадрате 0x120 вокруг (X-0x80,Y-0x80), беззнаковые сравнения
  const m = eng.m; const dx = (m.u16(A + esi + U.X) - 0x80) & 0xffe0, bx = (m.u16(A + esi + U.Y) - 0x80) & 0xffe0; const cx = w16(dx + 0x120), bp = w16(bx + 0x120); const al = m.u8(A + esi + U.OWNER);
  while (edi !== 0) {
    const x = m.u16(A + edi + U.X), y = m.u16(A + edi + U.Y);
    if (!(x < dx || x >= cx || y < bx || y >= bp || m.u8(A + edi + U.OWNER) === al || m.u8(A + edi + U.STATE) === 0x60) && (m.u8(A + edi + U.FLAGS5B) & 1) === 0) return edi;
    edi = m.u32(A + edi + U.NEXT);
  }
  return 0;
}
F[0x1c0b2] = (eng, r) => ({ edi: scanEnemy(eng, r.esi, eng.m.u32(0x31b6c)) });
F[0x1c0b8] = (eng, r) => ({ edi: scanEnemy(eng, r.esi, r.edi) });
/** 0x1c13b: продолжить обход квадрата вокруг точки с сохранённым состоянием обхода. */
function scanArea(eng, st) { // 0x1c13b: продолжение сканирования с сохранёнными dx,bx,cx,bp,al; знаковые сравнения
  const m = eng.m; let edi = st.edi;
  while (edi !== 0) {
    const x = m.i16(A + edi + U.X), y = m.i16(A + edi + U.Y);
    if (!(x < st.dx || x >= st.cx || y < st.bx || y >= st.bp || m.u8(A + edi + U.OWNER) === st.al || m.u8(A + edi + U.STATE) === 0x60) && (m.u8(A + edi + U.FLAGS5B) & 1) === 0) return edi;
    edi = m.u32(A + edi + U.NEXT);
  }
  return 0;
}
/** 0x1c135: обойти квадрат вокруг цели заклинания и собрать, кого зацепило. */
function area1c135(eng, esi, al) { // 0x1c135: квадрат вокруг [esi+0xf2510]/[esi+0xf2512] (используется с индексом юнита — как в оригинале)
  const m = eng.m; const dx = s16((m.u16(0xf2510 + esi) - 0x80) & 0xffe0), bx = s16((m.u16(0xf2512 + esi) - 0x80) & 0xffe0);
  return { dx, bx, cx: s16(dx + 0x120), bp: s16(bx + 0x120), al, edi: m.u32(0x31b6c) };
}
F[0x1c135] = (eng, r) => { const st = area1c135(eng, r.esi, r.eax & 0xff); return { edi: scanArea(eng, st) }; };
F[0x1c13b] = (eng, r) => ({ edi: scanArea(eng, { dx: s16(r.edx), bx: s16(r.ebx), cx: s16(r.ecx), bp: s16(r.ebp), al: r.eax & 0xff, edi: r.edi }) });

// ---------- оценка заклинаний (0x16c1f … 0x16f5e); все возвращают {ebx, edi}
F[0x16c1f] = (eng, r) => { // подчинение: сумма HP врагов − своих в области (edi=цель)
  const m = eng.m, esi = r.esi; let edi = r.edi; if (m.u8(A + esi + U.HP) >= 0xf) return { ebx: 0, edi };
  m.w32(0x36a24, edi); const st = area1c135(eng, esi, r.eax & 0xff); edi = scanArea(eng, st);
  if (edi !== 0) {
    m.w32(0x36a28, 0); m.w32(0x36a2c, 0);
    globalThis.__сч0 = 0;
    for (;;) { if (++globalThis.__сч0 > 3e6) throw new Error("ЦИКЛ magic.js:119");
      let ecx = m.u8(0x30b96); if (m.u8(A + edi + U.HP) < ecx) ecx = m.u8(A + edi + U.HP);
      st.al = m.u8(A + esi + U.OWNER);
      if (m.u8(A + edi + U.OWNER) !== st.al) m.w32(0x36a28, m.u32(0x36a28) + ecx); else m.w32(0x36a2c, m.u32(0x36a2c) + ecx);
      edi = m.u32(A + edi + U.NEXT); if (edi === 0) break; st.edi = edi; edi = scanArea(eng, st); if (edi === 0) break;
    }
    const ebx = m.u32(0x36a28); if (m.u32(0x36a2c) < ebx) return { ebx: d32(ebx - m.u32(0x36a2c)), edi: m.u32(0x36a24) };
  }
  return { ebx: 0, edi: m.u32(0x36a24) };
};
F[0x16cb9] = (eng, r) => { // бой в прямоугольнике 640×480 вокруг esi: сумма min(30,HP)
  const m = eng.m, esi = r.esi; m.w32(0x36a24, r.edi); m.w32(0x36a28, 0); m.w32(0x36a2c, 0);
  const dx = m.u16(A + esi + U.X) - 0x140, bx = m.u16(A + esi + U.Y) - 0xf0, cx = dx + 0x280, bp = bx + 0x1e0;
  for (let edi = m.u32(0x31b6c); edi !== 0; edi = m.u32(A + edi + U.NEXT)) {
    const x = m.i16(A + edi + U.X), y = m.i16(A + edi + U.Y);
    if (x < s16(dx) || x >= s16(cx) || y < s16(bx) || y >= s16(bp)) continue; if (m.u8(A + edi + U.STATE) === 0x60) continue; if (m.u8(A + edi + U.FLAGS5B) & 1) continue;
    let eax = m.u8(0x30b92); if (m.u8(A + edi + U.HP) < eax) eax = m.u8(A + edi + U.HP);
    if (m.u8(A + edi + U.OWNER) !== m.u8(A + esi + U.OWNER)) m.w32(0x36a28, m.u32(0x36a28) + eax); else m.w32(0x36a2c, m.u32(0x36a2c) + eax);
  }
  const ebx = m.u32(0x36a28); return { edi: m.u32(0x36a24), ebx: m.u32(0x36a2c) < ebx ? d32(ebx - m.u32(0x36a2c)) : 0 };
};
F[0x16da7] = (eng, r) => { // огненный снаряд: сумма min(10,HP) врагов в области
  const m = eng.m, esi = r.esi; m.w32(0x36a24, r.edi); let edi = scanEnemy(eng, esi, m.u32(0x31b6c));
  if (edi !== 0) {
    m.w32(0x36a28, 0); m.w32(0x36a2c, 0);
    globalThis.__сч1 = 0;
    for (;;) { if (++globalThis.__сч1 > 3e6) throw new Error("ЦИКЛ magic.js:144");
      let ecx = m.u8(0x30b76); if (m.u8(A + edi + U.HP) < ecx) ecx = m.u8(A + edi + U.HP);
      if (m.u8(A + edi + U.OWNER) !== m.u8(A + esi + U.OWNER)) m.w32(0x36a28, m.u32(0x36a28) + ecx); else m.w32(0x36a2c, m.u32(0x36a2c) + ecx);
      edi = m.u32(A + edi + U.NEXT); if (edi === 0) break; edi = scanEnemy(eng, esi, edi); if (edi === 0) break;
    }
    const ebx = m.u32(0x36a28); if (m.u32(0x36a2c) < ebx) return { edi: m.u32(0x36a24), ebx: d32(ebx - m.u32(0x36a2c)) };
  }
  return { edi: m.u32(0x36a24), ebx: 0 };
};
F[0x16e32] = (eng, r) => { // число врагов − своих в квадрате ±32 вокруг цели edi (тип 7 не считается)
  const m = eng.m, esi = r.esi, tgt = r.edi; const tx = m.i16(A + tgt + U.X), ty = m.i16(A + tgt + U.Y); const dx = tx - 0x20, bx = ty - 0x20, cx = tx + 0x20, bp = ty + 0x20;
  m.w32(0x36a24, tgt); const al = m.u8(A + esi + U.OWNER); m.w32(0x36a28, 0); m.w32(0x36a2c, 0);
  for (let edi = m.u32(0x31b6c); edi !== 0; edi = m.u32(A + edi + U.NEXT)) {
    if (m.u8(A + edi + U.FLAGS5B) & 1) continue; const x = m.i16(A + edi + U.X), y = m.i16(A + edi + U.Y);
    if (x < s16(dx) || x >= s16(cx) || y < s16(bx) || y >= s16(bp)) continue; if (m.u8(A + edi + U.STATE) === 0x60) continue; if (m.u8(A + edi + U.TYPE) === 7) continue;
    if (m.u8(A + edi + U.OWNER) === al) m.w32(0x36a2c, m.u32(0x36a2c) + 1); else m.w32(0x36a28, m.u32(0x36a28) + 1);
  }
  const ebx = m.u32(0x36a28); return { edi: m.u32(0x36a24), ebx: m.u32(0x36a2c) < ebx ? d32(ebx - m.u32(0x36a2c)) : 0 };
};
F[0x16eef] = (eng, r) => ({ ebx: (eng.m.u8(A + r.edi + 0x43) & 0xfc) ? 0 : eng.m.u8(A + r.edi + U.HP), edi: r.edi });
/** Сколько лечить: не больше остатка до максимума и не больше потолка заклинания. */
const minHp = (eng, r, cap) => { const hp = eng.m.u8(A + r.edi + U.HP); return { ebx: hp > cap ? cap : hp, edi: r.edi }; };
F[0x16f01] = (eng, r) => minHp(eng, r, eng.m.u8(0x30b7e));
F[0x16f08] = (eng, r) => minHp(eng, r, eng.m.u8(0x30b7a));
F[0x16f0f] = (eng, r) => minHp(eng, r, eng.m.u8(0x30b76));
F[0x16f4a] = (eng, r) => { const m = eng.m, al = r.eax & 0xff; let bl = b8(m.u8(A + r.edi + U.HPMAX) - m.u8(A + r.edi + U.HP)); if (bl > al) bl = al; return { ebx: bl, edi: r.edi }; };
F[0x16f24] = (eng, r) => F[0x16f4a](eng, { ...r, eax: eng.m.u8(A + r.edi + U.HP) });
F[0x16f2c] = (eng, r) => F[0x16f4a](eng, { ...r, eax: b8(eng.m.u8(A + r.edi + U.HP) - 1) });
F[0x16f43] = (eng, r) => F[0x16f4a](eng, { ...r, eax: eng.m.u8(0x30b5e) });
F[0x16f36] = (eng, r) => F[0x16f5e](eng, { ...r, ecx: eng.m.u32(0x3058c), eax: eng.m.u8(0x30b62) });
F[0x16f5e] = (eng, r) => { // массовое лечение: сумма недостающего HP своих в кольце (с багом проверки границ, как в оригинале)
  const m = eng.m, esi = r.esi; let edi = r.edi; m.w16(0x36a18, 0); m.w8(0x36a1a, r.eax & 0xff);
  const edx0 = m.u16(A + edi + U.X) >>> 5, ebx0 = m.u16(A + edi + U.Y) >>> 5;
  for (let ecx = d32(r.ecx); ecx !== 0; ecx = d32(ecx - 1)) {
    const dx = w16(edx0 + m.i16(0x305d0 + ecx * 4)); if (m.u16(0x31af8) >= dx) continue;
    const bx = w16(ebx0 + m.i16(0x305d2 + ecx * 4)); if (m.u16(0x31afc) >= bx) continue;
    let eax = m.u8(BI + dx + (bx << 8)) >>> 2;
    if (eax === 0) { eax = m.u8(MO + dx + 0) >>> 4; if (eax === 0) continue; eax = m.u8(0x32ae4 + eax - 1); if (m.u8(A + edi + U.OWNER) !== eax) continue; }
    else { eax = m.u8(0x32ae4 + eax - 1); if (m.u8(A + edi + U.OWNER) !== eax) continue; }
    const u = call(eng, 0x1a692, { esi, edx: dx, ebx: bx }).esi; edi = u; if (!u) continue;
    const rr = F[0x16f4a](eng, { eax: m.u8(0x36a1a), edi }); m.w16(0x36a18, m.u16(0x36a18) + rr.ebx);
  }
  return { ebx: m.u16(0x36a18), edi };
};

// ---------- выбор заклинания
function pickHeal(eng, esi, edi, tab) { // общая часть 0x1674b/0x16916: [36a10]=код*4, [36a14]=оценка
  const m = eng.m; m.w32(0x36a10, 0); m.w32(0x36a14, 0);
  const steps = [[8, 0x16f43, 4], [9, 0x16f36, 8], [0xa, 0x16f2c, 0xc], [0xb, 0x16f24, 0x10]];
  for (const [bit, fn, code] of steps) { if (F[0x14873](eng, { eax: bit, esi }).cf) break; const x = F[fn](eng, { esi, edi }); edi = x.edi; const ebx = x.ebx; if (m.u32(0x36a14) > ebx) continue; m.w32(0x36a14, ebx); m.w32(0x36a10, code); }
  const sel = m.u32(0x36a10);
  if (sel === 0) return tab === 'self' ? F[0x16841](eng, { esi }) : {};
  return F[0x1a379](eng, { eax: 0xa0 + (sel >> 2) - 1, esi, edi });
}
F[0x1674b] = (eng, r) => pickHeal(eng, r.esi, r.esi, 'self');
F[0x16916] = (eng, r) => pickHeal(eng, r.esi, r.edi, 'ally');
F[0x16841] = (eng, r) => { // ИИ: случайная прогулка
  const m = eng.m, esi = r.esi; if (m.u8(A + esi + U.F08) === 0) return {}; if (m.u8(0x32aec + m.u8(A + esi + U.OWNER)) === 0) return {};
  if (!F[0x14873](eng, { eax: 0x1a, esi }).cf) {
    m.w8(A + esi + 0x52, 0xff); m.w32(0x31b58, m.u32(0x31afc)); const ebx = eng.rand_raw() << 5; m.w32(0x31b58, m.u32(0x31af8)); const edx = eng.rand_raw() << 5;
    return F[0x1a393](eng, { eax: 0xb2, esi, edx, ebx });
  }
  m.w32(0x31b58, 8); const ebp = eng.rand_raw() * 4; m.w32(0x31b58, 5); const edx = eng.rand_raw() - 2;
  let bx = w16(m.i16(0x36a38 + ebp) + edx + m.u16(A + esi + U.Y)), dx = w16(edx + m.i16(0x36a36 + ebp) + m.u16(A + esi + U.X)); dx &= 0xffe0; bx &= 0xffe0;
  const p = call(eng, 0x1e609, { esi, edx: dx, ebx: bx }); if (p.zf) return {};
  m.w8(A + esi + U.ORDER, 0xf); m.w16(A + esi + 0x4b, dx); m.w16(A + esi + 0x4d, bx); m.w8(A + esi + 0x52, 0xff); return {};
};
F[0x17014] = (eng, r) => { // союзник в бою с HP ≤ половины в кольцах вокруг esi → cf=0, edi
  const m = eng.m, esi = r.esi; let edi = r.edi; const rings = m.u32(0x3058c + ((m.u8(A + esi + U.SPD) >>> 4) + 1) * 4); let ecx = d32(rings - 1);
  m.w8(A + esi + 0x44, m.u16(A + esi + U.X) >>> 5); m.w8(A + esi + 0x45, m.u16(A + esi + U.Y) >>> 5);
  for (let ebp = 4; ecx !== 0; ebp += 4, ecx = d32(ecx - 1)) {
    const dx = w16(m.u8(A + esi + 0x44) + m.i16(0x305d0 + ebp)); if (dx >= m.u16(0x31af8)) continue;
    const bx = w16(m.u8(A + esi + 0x45) + m.i16(0x305d2 + ebp)); if (bx >= m.u16(0x31afc)) continue;
    edi = bx << 8; let al = m.u8(BI + dx + edi) >>> 2;
    if (al !== 0) { if (m.u8(A + esi + U.OWNER) !== al - 1) continue; } else { al = m.u8(MO + dx + edi) >>> 4; if (al === 0) continue; if (m.u8(A + esi + U.OWNER) !== al - 1) continue; }
    edi = call(eng, 0x1a692, { esi, edx: dx, ebx: bx }).esi; if (!edi) continue;
    const st = m.u8(A + edi + U.STATE); if ((st & 0xf0) === 0x10 || (st >= 0x30 && st <= 0x33)) { if (m.u8(A + edi + U.HP) <= (m.u8(A + edi + U.HPMAX) >>> 1)) return { cf: 0, edi }; }
  }
  return { cf: 1, edi };
};
F[0x171d3] = (eng, r) => { // флаги свободных слотов инвентаря → eax
  const m = eng.m, esi = r.esi; const inv = k => m.u8(A + esi + U.INV + k); let eax = 0x1000;
  if (inv(6) === 0x1e || inv(7) === 0x1e || inv(8) === 0x1e) { if (m.u16(A + esi + U.FOOD) === 0xffff) eax = 0; }
  else if (!(inv(6) === 0 || inv(7) === 0 || inv(8) === 0)) eax = 0;
  let al = eax & 0xff, ah = (eax >>> 8) & 0xff;
  for (let k = 0; k < 12; k++) if (inv(k) === 0) { ah |= [1, 1, 1, 2, 2, 2, 4, 4, 4, 8, 8, 8][k]; al = b8(al + 1); }
  return { eax: (eax & 0xffff0000) | (ah << 8) | al };
};
F[0x170f6] = (eng, r) => { // предмет на земле рядом, который юнит может взять → edi (запись OI), edx/ebx = тайл
  const m = eng.m, esi = r.esi; const ax = F[0x171d3](eng, { esi }).eax & 0xffff; if ((ax & 0x10ff) === 0) return { edi: 0 };
  const ah = ax >>> 8; let ecx = m.u32(0x3058c + ((m.u8(A + esi + U.SPD) >>> 4) + 1) * 4);
  for (let ebp = 0; ; ebp += 4) {
    let found = 0, dx = 0, bx = 0;
    dx = w16((m.u16(A + esi + U.X) >>> 5) + m.i16(0x305d0 + ebp));
    if (dx < m.u16(0x31af8)) { bx = w16((m.u16(A + esi + U.Y) >>> 5) + m.i16(0x305d2 + ebp));
      if (bx < m.u16(0x31afc) && (m.u8(BI + dx + (bx << 8)) & 2)) {
        for (let edi = m.u32(0x31b7c); edi !== 0; edi = m.u32(ITEMS + edi + 0xc)) {
          if (m.u8(ITEMS + edi + 1) !== (dx & 0xff) || m.u8(ITEMS + edi + 2) !== (bx & 0xff)) continue;
          const t = m.u8(ITEMS + edi); if (t === 0x1e) { if (ah & 0x10) { found = edi; break; } continue; }
          ecx = m.u32(0x30a9e + t * 4); const cl = m.u16(ecx + 0x3095c); ecx = (ecx & 0xffff0000) | cl;
          if (!(cl & 1)) { if (ah & 8) { found = edi; break; } } else if (cl & 2) { if (ah & 1) { found = edi; break; } } else if (cl & 4) { if (ah & 2) { found = edi; break; } } else if (ah & 4) { found = edi; break; }
        }
        if (found) return { edi: found, edx: dx, ebx: bx };
      } }
    ecx = d32(ecx - 1); if (ecx === 0) return { edi: 0, edx: dx, ebx: bx };
  }
};
F[0x16612] = (eng, r) => { const m = eng.m, esi = r.esi; if (m.u8(A + esi + 0x50) < 0xe) return {}; const f = F[0x170f6](eng, { esi }); if (f.edi) { m.w8(A + esi + U.ORDER, 0x44); m.w16(A + esi + 0x4b, w16(f.edx << 5)); m.w16(A + esi + 0x4d, w16(f.ebx << 5)); } m.w8(A + esi + 0x50, 0); return {}; };
F[0x1664a] = (eng, r) => { const m = eng.m, esi = r.esi, edi = r.edi; if (m.u8(A + esi + U.STATE) <= 0xf) return {};
  let dx = w16(m.u16(edi + 6) - m.u16(A + esi + U.X)); if (m.u16(edi + 6) < m.u16(A + esi + U.X)) dx = w16(-dx);
  if (dx <= 0xa0) { let dy = w16(m.u16(edi + 8) - m.u16(A + esi + U.Y)); if (m.u16(edi + 8) < m.u16(A + esi + U.Y)) dy = w16(-dy); if (dy <= 0xa0) return {}; }
  m.w8(A + esi + U.ORDER, 0xf); m.w16(A + esi + 0x4b, m.u16(edi + 6)); m.w16(A + esi + 0x4d, m.u16(edi + 8)); return {}; };
F[0x1669f] = (eng, r) => { const m = eng.m, esi = r.esi, edi = r.edi; const ebp = m.u32(edi + 2);
  if (!(m.u8(A + ebp + U.FLAGS5B) & 1) && (m.u8(A + ebp + U.STATE) & 0xf0) !== 0x60) return F[0x19fbf](eng, { esi, edx: m.u16(A + ebp + U.X) & 0xffe0, ebx: m.u16(A + ebp + U.Y) & 0xffe0 });
  m.w8(edi, 0xc); m.w8(edi + 1, 2); return {}; };
F[0x166e0] = (eng, r) => { // cf=1: юнит слаб/проигрывает (edi может стать суммой статов, как в оригинале)
  const m = eng.m, esi = r.esi; let edi = r.edi; if (m.u8(A + esi + U.HP) >= (m.u8(A + esi + U.HPMAX) >>> 1)) return { cf: 0, edi };
  if (m.u8(A + esi + U.HP) < 0xa) return { cf: 1, edi }; edi = m.u32(A + esi + U.TARGET);
  if (m.u8(A + esi + U.HP) < (m.u8(A + edi + U.HP) >>> 1)) return { cf: 1, edi };
  const sum = i => m.u8(A + i + U.HP) + m.u8(A + i + U.ATK) + m.u8(A + i + U.DEF); const t = sum(edi), s = sum(esi);
  return { cf: s < t ? 1 : 0, edi: t };
};
F[0x16a10] = (eng, r) => { // выбор атакующего заклинания по максимальной оценке
  const m = eng.m, esi = r.esi; if (m.u32(A + esi + U.TARGET) === d32(r.edi)) return {};
  const mana = m.u8(A + esi + U.MANA); if (!(mana >= m.u8(A + esi + U.HP) || mana >= (m.u8(A + esi + U.MAG) >>> 1))) return {};
  m.w32(0x36a1c, 0); m.w32(0x36a20, 0); let edi = m.u32(A + esi + U.TARGET);
  const upd = (ebx, code, strict) => { if (strict ? m.u32(0x36a1c) >= ebx : m.u32(0x36a1c) > ebx) return; m.w32(0x36a1c, ebx); m.w32(0x36a20, code); };
  if (m.u8(0x32aec + m.u8(A + esi + U.OWNER)) !== 0) {
    if (!F[0x14873](eng, { eax: 0x16, esi }).cf) { const x = F[0x16c1f](eng, { esi, edi, eax: 0x16 }); edi = x.edi; upd(x.ebx, 0x24); }
    if (!F[0x14873](eng, { eax: 0x15, esi }).cf) { const x = F[0x16cb9](eng, { esi, edi }); edi = x.edi; upd(x.ebx, 0x20); }
  }
  const rest = [[0x14, 0x16da7, 0x1c, false], [0x13, 0x16e32, 0x18, false], [0x11, 0x16eef, 0x10, true], [0x10, 0x16f01, 0xc, false], [0xf, 0x16f08, 8, false], [0xe, 0x16f0f, 4, false]];
  for (const [bit, fn, code, strict] of rest) { if (F[0x14873](eng, { eax: bit, esi }).cf) continue; const x = F[fn](eng, { esi, edi }); edi = x.edi; upd(x.ebx, code, strict); }
  const sel = m.u32(0x36a20);
  switch (sel) {
    case 4: return F[0x1a379](eng, { eax: 0xa6, esi, edi }); case 8: return F[0x1a379](eng, { eax: 0xa7, esi, edi });
    case 0xc: return F[0x1a379](eng, { eax: 0xa8, esi, edi }); case 0x10: return F[0x1a379](eng, { eax: 0xa9, esi, edi });
    case 0x18: return F[0x1a393](eng, { eax: 0xab, esi, edx: m.u16(A + edi + U.X), ebx: m.u16(A + edi + U.Y) });
    case 0x1c: return F[0x1a379](eng, { eax: 0xac, esi, edi }); case 0x20: return F[0x1a379](eng, { eax: 0xad, esi, edi }); case 0x24: return F[0x1a379](eng, { eax: 0xae, esi, edi });
    default: return {};
  }
};
F[0x16531] = (eng, r) => { // в бою: подумать о лечении/атакующей магии
  const m = eng.m, esi = r.esi; let edi = r.edi; if (m.u8(A + esi + U.ATKCTR) !== 0) return {};
  const w = F[0x166e0](eng, { esi, edi }); edi = w.edi;
  if (w.cf) { F[0x1674b](eng, { esi }); edi = esi; if (m.u32(0x36a10) !== 0) return {}; }
  const t = m.u8(A + esi + U.TYPE); if (t < 5 || t > 8) return {};
  const a = F[0x17014](eng, { esi, edi }); edi = a.edi;
  if (!a.cf) { F[0x16916](eng, { esi, edi }); if (m.u32(0x36a10) !== 0) return {}; }
  if (m.u32(A + esi + U.TARGET) !== 0) return F[0x16a10](eng, { esi, edi });
  return {};
};
F[0x16508] = (eng, r) => { const m = eng.m, esi = r.esi; if (m.u8(A + esi + U.HP) < m.u8(A + esi + U.HPMAX)) return {}; if (m.u8(A + esi + U.MANA) < m.u8(A + esi + U.MAG)) return {}; return call(eng, 0x1a34c, { esi }); };
F[0x16598] = (eng, r) => { // охрана/ИИ-задачи
  const m = eng.m, esi = r.esi; if (m.u8(A + esi + U.STATE) < 0x36) return F[0x16531](eng, r);
  if (m.u8(0x32aec + m.u8(A + esi + U.OWNER)) === 0) return F[0x16612](eng, { esi });
  let edi = m.u32(0x36684 + m.u8(A + esi + U.SLOT) * 4); const f08 = m.u8(A + esi + U.F08);
  if (f08 === 0) return F[0x16612](eng, { esi }); if (f08 > 2) throw new Error('0x16598: f08=' + f08);
  const base = f08 === 1 ? 0x32bcc : 0x32c1c; const bl = m.u8(edi + base); edi += base;
  switch (bl) { case 0: return F[0x1664a](eng, { esi, edi }); case 4: return F[0x1669f](eng, { esi, edi }); case 8: case 12: return F[0x16612](eng, { esi }); default: throw new Error('0x16598: task state ' + bl); }
};
F[0x163e4] = (eng, r) => { // каждый шаг перед диспетчером состояний
  const m = eng.m, esi = r.esi; const t = m.u8(A + esi + U.TYPE);
  if ((m.u32(0x31ab4) & 3) === 0 && t >= 5 && t <= 8) {
    const totem = [0x11, 0x1d, 0x13, 0x14][t - 5]; const inv = k => m.u8(A + esi + U.INV + k);
    if (inv(9) === totem || inv(10) === totem || inv(11) === totem) { if (m.u8(A + esi + U.MANA) < m.u8(A + esi + U.MAG)) m.w8(A + esi + U.MANA, m.u8(A + esi + U.MANA) + 1); }
  }
  switch (m.u8(A + esi + U.STATE) >>> 4) { case 1: return F[0x16531](eng, r); case 2: return F[0x16508](eng, r); case 3: return F[0x16598](eng, r); default: return {}; }
};

// ---------- снаряды-эффекты заклинаний
F[0x1bffc] = (eng, r) => { // al=заклинание, esi=кастер, edi=цель → edi=снаряд, cf
  const m = eng.m, esi = r.esi, ebx = r.edi; const p = call(eng, 0x1c2a4, { esi }); if (p.cf) return { cf: 1, edi: p.esi, ebx };
  const edi = p.esi; m.w8(PROJ + edi, r.eax & 0xff); m.w8(PROJ + edi + 1, 0xff); m.w32(PROJ + edi + 4, esi); m.w32(PROJ + edi + 8, ebx); m.w16(PROJ + edi + 0x10, 0);
  const t = m.u8(A + ebx + U.TYPE); m.w16(PROJ + edi + 0xc, m.u16(0x30456 + t * 4)); m.w16(PROJ + edi + 0xe, m.u16(0x30458 + t * 4)); return { cf: 0, edi, ebx: t };
};
F[0x1c052] = (eng, r) => { // эффект в точке (dx,bx)
  const m = eng.m, esi = r.esi; const p = call(eng, 0x1c2a4, { esi }); if (p.cf) return { cf: 1, edi: p.esi };
  const edi = p.esi; m.w8(PROJ + edi, r.eax & 0xff); m.w8(PROJ + edi + 1, 0xff); m.w32(PROJ + edi + 4, esi); m.w32(PROJ + edi + 8, 0); m.w16(PROJ + edi + 0x10, 0);
  m.w16(PROJ + edi + 0xc, r.edx); m.w16(PROJ + edi + 0xe, r.ebx); return { cf: 0, edi };
};
/** 0x1bc8a: пустить огненный снаряд в цель. */
function fireMissile(eng, esi, edi) { // 0x1bc8a: огненный снаряд в цель edi
  const m = eng.m; const p = call(eng, 0x1c2a4, { esi }); if (p.cf) return { cf: 1 };
  const ebp = p.esi; m.w8(PROJ + ebp + 3, m.u8(0x30b76));
  const tx = m.u16(A + edi + U.X), ty = m.u16(A + edi + U.Y); const d1 = call(eng, 0x1a95d, { esi, edi, edx: tx, ebx: ty }); const d2 = call(eng, 0x1aa10, { esi, edi, edx: tx, ebx: ty, eax: d1.eax });
  m.w16(A + esi + U.DIR, d2.eax & 0xffff);
  call(eng, 0x1b730, { eax: 0xa0, esi, edi, ebp }); m.w8(PROJ + ebp + 1, b8(m.u8(PROJ + ebp + 1) + 0x10));
  return F[0x1c092](eng, { eax: 0x86, esi });
}
F[0x1bc8a] = (eng, r) => fireMissile(eng, r.esi, r.edi);
F[0x1b917] = (eng, r) => { // эффекты заклинаний: al=id 0x80.., esi=кастер, edi=цель
  const m = eng.m, esi = r.esi; let edi = r.edi; const id = r.eax & 0xff; const idx = id - 0x80;
  const xp = n => m.w32(A + esi + U.XP, d32(m.u32(A + esi + U.XP) + n)); const snd = () => F[0x1ffaa](eng, { ebx: idx, esi });
  const effectOnTarget = () => { const e = F[0x1bffc](eng, { eax: id, esi, edi }); return e; };
  switch (id) {
    case 0x80: { xp(0x32); snd(); const e = effectOnTarget(); if (e.cf) return {}; F[0x1c1b2](eng, { eax: m.u8(0x30b5e), edi }); return F[0x1c092](eng, { eax: id, esi }); }
    case 0x81: { xp(0x46); snd(); m.w8(0x36fdd, m.u8(0x30b62)); m.w8(0x36fdc, id); m.w32(0x36fd8, m.u32(0x30590)); m.w32(0x36fd4, edi);
      const e = F[0x1bffc](eng, { eax: id, esi, edi }); if (e.cf) return {};
      F[0x1c1b2](eng, { eax: m.u8(0x36fdd), edi: m.u32(0x36fd4) });
      globalThis.__сч2 = 0;
      for (;;) { if (++globalThis.__сч2 > 3e6) throw new Error("ЦИКЛ magic.js:342");
        edi = m.u32(0x36fd4); const ecx = m.u32(0x36fd8);
        const dx = w16((m.u16(A + edi + U.X) >>> 5) + m.i16(0x305d0 + ecx * 4));
        if ((dx & 0xff) < m.u8(0x31af8)) { const bx = w16((m.u16(A + edi + U.Y) >>> 5) + m.i16(0x305d2 + ecx * 4));
          if ((bx & 0xff) < m.u8(0x31afc) && (m.u8(BI + dx + (bx << 8)) & 0xfc)) {
            const u = call(eng, 0x1a692, { esi, edx: dx, ebx: bx }).esi;
            if (u && m.u8(A + u + U.OWNER) === m.u8(A + esi + U.OWNER)) { const e2 = F[0x1bffc](eng, { eax: m.u8(0x36fdc), esi, edi: u }); if (e2.cf) break; F[0x1c1b2](eng, { eax: m.u8(0x36fdd), edi: u }); }
          } }
        m.w32(0x36fd8, d32(ecx - 1)); if (m.u32(0x36fd8) === 0) break;
      }
      return F[0x1c092](eng, { eax: m.u8(0x36fdc), esi }); }
    case 0x82: xp(0x64); snd(); if (effectOnTarget().cf) return {}; return F[0x1c092](eng, { eax: id, esi });
    case 0x83: xp(0x8c); snd(); if (effectOnTarget().cf) return {}; return F[0x1c092](eng, { eax: id, esi });
    case 0x84: { xp(0x8c); snd(); const e = F[0x1bffc](eng, { eax: id, esi, edi }); m.w32(0x36fd4, e.edi); if (e.cf) return {};
      F[0x1c092](eng, { eax: id, esi }); const al = F[0x1aaac](eng, { esi }); if (al.cf) return {}; const edx = al.esi;
      for (let c = 0; c < 0x58; c++) m.w8(A + edx + 4 + c, m.u8(A + edi + 4 + c));
      m.w16(A + edx + 5, m.u16(A + esi + 5)); m.w8(A + edx + U.F08, 0);
      const dec = (off, floor) => { const v = b8(m.u8(A + edx + off) - 0x14); m.w8(A + edx + off, (m.u8(A + edx + off) > 0x14) ? v : floor); };
      dec(U.HPMAX, 0x14); dec(U.ATK, 0x14); dec(U.DEF, 0x14); dec(U.MAG, 0); dec(U.SPD, 0x14);
      m.w8(A + edx + U.HP, m.u8(A + edx + U.HPMAX)); m.w8(A + edx + U.MANA, 0); m.w8(A + edx + U.WEAPON, 0xff); m.w8(A + edx + U.SHIELD, 0xff);
      m.w8(A + edx + U.STATE, 0x49); m.w8(A + edx + U.ATKCTR, 0); m.w32(A + edx + 0x1b, 0); m.w32(A + edx + 0x1f, 0); m.w32(A + edx + 0x23, 0); m.w16(A + edx + U.FOOD, 0); m.w8(A + edx + U.FLAGS5B, 0);
      m.w32(PROJ + m.u32(0x36fd4) + 8, edx);
      m.w32(A + edx + U.SKILLS, 0x3f); F[0x1f475](eng, { esi: edx });
      const ft = call(eng, 0x1ccdd, { esi: edx, edx: m.u16(A + edx + U.X), ebx: m.u16(A + edx + U.Y) });
      m.w16(A + edx + U.X, ft.edx); m.w16(A + edx + U.Y, ft.ebx); call(eng, 0x1a773, { esi: edx });
      call(eng, 0x1a3db, { esi: edx, edx: m.u16(A + edx + U.X), ebx: m.u16(A + edx + U.Y) });
      if (m.u8(0x31b64) === m.u8(A + edx + U.OWNER)) call(eng, 0x1a4cc, { esi: edx });
      m.w8(A + edi + U.FLAGS5B, m.u8(A + edi + U.FLAGS5B) | 1); if (!(m.u8(A + edi + U.FLAGS5B) & 2)) call(eng, 0x1aaf7, { esi: edi });
      return {}; }
    case 0x86: xp(0xa); snd(); return fireMissile(eng, esi, edi);
    case 0x87: xp(0xf); snd(); if (effectOnTarget().cf) return {}; return F[0x1c092](eng, { eax: id, esi });
    case 0x88: xp(0x14); snd(); if (effectOnTarget().cf) return {}; return F[0x1c092](eng, { eax: id, esi });
    case 0x89: { xp(0x1e); snd(); if (effectOnTarget().cf) return {}; F[0x1c092](eng, { eax: id, esi }); m.w8(A + edi + 0x43, m.u8(A + edi + 0x43) | 0xfc); return {}; }
    case 0x8b: { xp(0xa); snd(); const e = F[0x1c052](eng, { eax: id, esi, edx: m.u16(A + esi + U.DSTX), ebx: m.u16(A + esi + U.DSTY) }); if (e.cf) return {}; return F[0x1c092](eng, { eax: id, esi }); }
    case 0x8c: { xp(0x14); F[0x1ffaa](eng, { ebx: 6, esi }); edi = scanEnemy(eng, esi, m.u32(0x31b6c)); if (!edi) return {};
      m.w8(0x36fde, m.u8(A + esi + U.MANA));
      do { const nx = m.u32(A + edi + U.NEXT); fireMissile(eng, esi, edi); edi = scanEnemy(eng, esi, nx); } while (edi);
      m.w8(A + esi + U.MANA, m.u8(0x36fde)); return F[0x1c092](eng, { eax: 0x8c, esi }); }
    case 0x8d: { xp(0x1e); snd(); const e = F[0x1bffc](eng, { eax: id, esi, edi: esi }); if (e.cf) return {}; const p = e.edi;
      m.w32(PROJ + p + 0x10, m.u16(A + esi + U.X)); m.w32(PROJ + p + 0x14, m.u16(A + esi + U.Y)); m.w32(PROJ + p + 0xc, m.u32(0x31ae8)); m.w32(PROJ + p + 0x18, m.u32(0x31aec));
      return F[0x1c092](eng, { eax: id, esi }); }
    case 0x8e: { xp(0x28); snd(); const e = F[0x1bffc](eng, { eax: id, esi, edi: esi }); const p = e.edi;
      m.w16(PROJ + p + 0xc, m.u16(PROJ + p + 0xc) + m.u16(A + esi + U.X)); const y = m.u16(PROJ + p + 0xe) + m.u16(A + esi + U.Y); m.w16(PROJ + p + 0xe, y);
      if (y > 0xffff) return {}; return F[0x1c092](eng, { eax: id, esi }); }
    case 0x90: { xp(0x14); snd(); for (const v of [0xfff1, 0xfff6, 0xfffb]) { const e = F[0x1bffc](eng, { eax: id, esi, edi: esi }); if (e.cf) return {}; m.w16(PROJ + e.edi + 0x10, v); }
      const e = F[0x1bffc](eng, { eax: id, esi, edi: esi }); if (e.cf) return {}; return F[0x1c092](eng, { eax: id, esi }); }
    case 0x91: { xp(0x28); snd(); const cx = m.u16(A + esi + U.X), bp = m.u16(A + esi + U.Y);
      for (let k = 0; k < 8; k++) { const e = F[0x1bffc](eng, { eax: id, esi, edi: esi }); if (e.cf) return {}; m.w8(PROJ + e.edi + 2, k); m.w16(PROJ + e.edi + 0xc, m.u16(PROJ + e.edi + 0xc) + cx); m.w16(PROJ + e.edi + 0xe, m.u16(PROJ + e.edi + 0xe) + bp); }
      return F[0x1c092](eng, { eax: id, esi }); }
    case 0x92: { xp(0x28); snd(); const e = F[0x1bffc](eng, { eax: id, esi, edi: esi }); if (e.cf) return {}; m.w16(PROJ + e.edi + 0x10, m.u16(A + esi + U.DSTX)); m.w16(PROJ + e.edi + 0x12, m.u16(A + esi + U.DSTY)); return F[0x1c092](eng, { eax: id, esi }); }
    default: return {};   // 0x85/0x8a/0x8f: ret
  }
};

// ---------- состояния магии (диспетчер 0x182c8)
function castNow(eng, esi, edi) { const m = eng.m; F[0x1b917](eng, { eax: m.u8(A + esi + U.STATE), esi, edi }); call(eng, 0x1a773, { esi }); m.w8(A + esi + U.ATKCTR, 0); m.w8(A + esi + U.STATE, b8(m.u8(A + esi + U.STATE) + 0x40)); return {}; }
/** Подойти к цели на дальность каста и, если дошли, скастовать. */
function approach(eng, esi, edi, add) { // идти к цели, в радиусе — каст
  const m = eng.m; const ebp = ((m.u8(A + esi + U.SPD) >>> 5) << 4) + add;
  if (call(eng, 0x1a1e4, { esi, edi, ebp }).eax & 0xff) {
    if (call(eng, 0x1dc43, { esi, edi }).eax & 0xff) return {};
    edi = m.u32(A + esi + U.TARGET); m.w16(A + esi + U.DSTX, m.u16(A + edi + U.X) & 0xffe0); m.w16(A + esi + U.DSTY, m.u16(A + edi + U.Y) & 0xffe0); return call(eng, 0x1db94, { esi, edi });
  }
  return castNow(eng, esi, edi);
}
/** Цель исчезла: вернуть юнита в обычное состояние. */
function targetGone(eng, esi) { call(eng, 0x1a34c, { esi }); return call(eng, 0x1dc43, { esi }); }
F[0x197e5] = (eng, r) => { const m = eng.m, esi = r.esi, edi = m.u32(A + esi + U.TARGET); if (m.u8(A + edi + U.STATE) === 0x60) return targetGone(eng, esi); return approach(eng, esi, edi, 0x80); };
F[0x1999e] = F[0x197e5];
F[0x19872] = (eng, r) => { // 0x84 (подчинение): цель должна быть в состоянии 0x60, иначе сброс приказа + шаг движения (инверсия относительно 0x197e5 — так в оригинале)
  const m = eng.m, esi = r.esi, edi = m.u32(A + esi + U.TARGET); if (m.u8(A + edi + U.STATE) !== 0x60) return targetGone(eng, esi); if (m.u8(A + edi + U.FLAGS5B) & 1) return call(eng, 0x1a34c, { esi }); return approach(eng, esi, edi, 0x80); };
F[0x1990c] = (eng, r) => { const m = eng.m, esi = r.esi, edi = m.u32(A + esi + U.TARGET); if (esi === edi) return call(eng, 0x1a34c, { esi }); if (m.u8(A + edi + U.STATE) === 0x60) return targetGone(eng, esi); return approach(eng, esi, edi, 0x60); };
F[0x19a2b] = (eng, r) => { const m = eng.m, esi = r.esi; const ebp = ((m.u8(A + esi + U.SPD) >>> 5) << 4) + 0x80; const dx = m.u16(A + esi + 0x4b), bx = m.u16(A + esi + 0x4d); m.w16(A + esi + U.DSTX, dx); m.w16(A + esi + U.DSTY, bx);
  if (F[0x1a2f2](eng, { esi, edx: dx, ebx: bx, ebp }).eax & 0xff) { if (call(eng, 0x1dc43, { esi, edi: r.edi }).eax & 0xff) return {}; return call(eng, 0x1a34c, { esi }); }
  return castNow(eng, esi, r.edi); };
F[0x19a91] = (eng, r) => { const esi = r.esi; const edi = scanEnemy(eng, esi, eng.m.u32(0x31b6c)); if (!edi) return call(eng, 0x1a34c, { esi }); return castNow(eng, esi, edi); };
F[0x19abd] = (eng, r) => castNow(eng, r.esi, r.edi);
F[0x19adc] = F[0x19abd];
F[0x19afb] = (eng, r) => { const m = eng.m, esi = r.esi; m.w8(A + esi + U.ATKCTR, 0); m.w8(A + esi + U.STATE, b8(m.u8(A + esi + U.STATE) + 0x40)); return {}; };
F[0x19b0a] = (eng, r) => { const m = eng.m, esi = r.esi, edi = m.u32(A + esi + U.TARGET); m.w16(A + esi + U.DSTX, m.u16(A + edi + U.X) & 0xffe0); m.w16(A + esi + U.DSTY, m.u16(A + edi + U.Y) & 0xffe0); call(eng, 0x1db94, { esi, edi }); m.w8(A + esi + U.STATE, b8(m.u8(A + esi + U.STATE) - 0x20)); return {}; };
F[0x19b41] = (eng, r) => { const m = eng.m; m.w8(A + r.esi + U.STATE, b8(m.u8(A + r.esi + U.STATE) - 0x20)); return {}; };
F[0x19b49] = F[0x19b41]; F[0x19b51] = F[0x19b41];
F[0x19b59] = (eng, r) => { const m = eng.m, esi = r.esi; m.w8(A + esi + U.STATE, b8(m.u8(A + esi + U.STATE) - 0x20)); m.w8(A + esi + U.ATKCTR, 4); return F[0x1b917](eng, { eax: m.u8(A + esi + U.STATE), esi, edi: m.u32(A + esi + U.TARGET) }); };
F[0x19b78] = (eng, r) => { const m = eng.m, esi = r.esi; const c = b8(m.u8(A + esi + U.ATKCTR) + 1); m.w8(A + esi + U.ATKCTR, c); if (c >= 2) return call(eng, 0x1a34c, { esi }); return {}; };
F[0x19b8c] = (eng, r) => { const m = eng.m, esi = r.esi; const c = b8(m.u8(A + esi + U.ATKCTR) + 1); m.w8(A + esi + U.ATKCTR, c); if (c < 2) return {}; return F[0x19f63](eng, { esi, edi: m.u32(A + esi + U.TARGET) }); };
F[0x19ba7] = (eng, r) => { const m = eng.m, esi = r.esi; const c = b8(m.u8(A + esi + U.ATKCTR) + 1); m.w8(A + esi + U.ATKCTR, c); if (c >= 2) m.w8(A + esi + U.ORDER, 0x6f); return {}; };

// ---------- предметы
F[0x1c5d6] = (eng, r) => { // экипировать предмет al: бонусы статов с насыщением
  const m = eng.m, esi = r.esi; const ebx = m.u32(0x30a9e + (r.eax & 0xff) * 4); const rec = k => m.u8(ebx + 0x30954 + k);
  const sat = (off, v) => { const s = m.u8(A + esi + off) + v; m.w8(A + esi + off, s > 0xff ? 0xff : s); };
  const hp = m.u8(A + esi + U.HP) + rec(0), mx = m.u8(A + esi + U.HPMAX); if (hp > 0xff) m.w8(A + esi + U.HP, mx); else { m.w8(A + esi + U.HP, hp); if (hp > mx) m.w8(A + esi + U.HP, mx); }
  sat(U.MAG, rec(1)); const mana = m.u8(A + esi + U.MANA) + rec(2), mg = m.u8(A + esi + U.MAG); if (mana > 0xff) m.w8(A + esi + U.MANA, mg); else { m.w8(A + esi + U.MANA, mana); if (mana > mg) m.w8(A + esi + U.MANA, mg); }
  sat(U.ATK, rec(3)); sat(U.DEF, rec(4)); sat(U.SPD, rec(5)); return { ebx };
};
F[0x1c72b] = (eng, r) => { // выпить зелье при HP < половины
  const m = eng.m, esi = r.esi; if (m.u8(A + esi + U.HP) >= (m.u8(A + esi + U.HPMAX) >>> 1)) return {};
  for (let edi = 6; edi < 9; edi++) { const al = m.u8(A + esi + U.INV + edi); if (al === 0) continue; if (al < 0xb || al > 0xe) continue;
    F[0x1ffb6](eng, { eax: al, esi }); m.w8(A + esi + U.INV + edi, 0); F[0x1c5d6](eng, { eax: al, esi });
    // 0x1c788: если юнит выделен — перерисовать его панель, иначе съеденное яблоко так и висит
    // в инвентаре до переключения юнита.
    if (m.u32(0x31adc) === esi && F[0x26671]) F[0x26671](eng, { esi });
    return {}; }
  return {};
};
F[0x175e8] = (eng, r) => { // снять/продать предмет из слота edi
  const m = eng.m, esi = r.esi, edi = d32(r.edi); const dl = edi & 0xff;
  if (m.u8(A + esi + U.WEAPON) === dl) m.w8(A + esi + U.WEAPON, 0xff); else if (m.u8(A + esi + U.SHIELD) === dl) m.w8(A + esi + U.SHIELD, 0xff);
  const ebx = m.u32(0x30a9e + m.u8(A + esi + U.INV + edi) * 4);
  if (m.u16(ebx + 0x3095c) & 8) { call(eng, 0x1c679, { esi, eax: m.u16(ebx + 0x3095a) }); m.w8(A + esi + U.INV + edi, 0); }
  return {};
};
F[0x1763c] = (eng, r) => { // купить предмет eax в слот edi за еду юнита
  const m = eng.m, esi = r.esi, edi = d32(r.edi); const ebx = m.u32(0x30a9e + d32(r.eax) * 4);
  if (!(m.u16(ebx + 0x3095c) & 8)) return { cf: 1 }; const dx = m.u16(A + esi + U.FOOD); if (m.u16(ebx + 0x3095a) > dx) return { cf: 1 };
  m.w8(A + esi + U.INV + edi, r.eax & 0xff); call(eng, 0x1c6e9, { esi, eax: dx }); return { cf: 0 };
};
F[0x17671] = (eng, r) => { // ближайший свой арсенал (типы 28/29) → edi, cf=1 если нет
  const m = eng.m, esi = r.esi; let edi = m.u32(0x31b6c); if (edi === 0) return { cf: 1, edi };
  m.w32(0x36a30, 0); m.w16(0x36a34, 0xffff); const al = m.u8(A + esi + U.OWNER), dx = m.u16(A + esi + U.X), bx = m.u16(A + esi + U.Y);
  for (; edi !== 0; edi = m.u32(A + edi + U.NEXT)) {
    const t = m.u8(A + edi + U.TYPE); if (t !== 0x1c && t !== 0x1d) continue; if (m.u8(A + edi + U.OWNER) !== al) continue; if (m.u8(A + edi + U.FLAGS5B) & 1) continue;
    let cx = w16(m.u16(A + edi + U.X) - dx); if (m.u16(A + edi + U.X) < dx) cx = w16(-cx); let bp = w16(m.u16(A + edi + U.Y) - bx); if (m.u16(A + edi + U.Y) < bx) bp = w16(-bp);
    if (cx < bp) bp = w16(bp + (cx >>> 1)); else bp = w16((bp >>> 1) + cx);
    if (m.u16(0x36a34) <= bp) continue; m.w16(0x36a34, bp); m.w32(0x36a30, edi);
  }
  edi = m.u32(0x36a30); return edi === 0 ? { cf: 1, edi } : { cf: 0, edi };
};
