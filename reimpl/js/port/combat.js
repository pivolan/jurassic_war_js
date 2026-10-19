// Тема B: бой, снаряды, смерть, поиск цели — построчный порт pwar.exe (адреса оригинала в комментариях).
const DUP = {}; // дубли функций, живут в другом модуле (см. dupes.mjs)
import { F, call } from '../fn.js';
import { G, U, UNITS, BI, MO, PROJ } from '../mem.js';
import { человек } from './humans.js';   // люди в партии — общие для всех машин (сетевая игра)

const P = PROJ;                       // пул снарядов 0xf2504: запись 36 байт, индекс = смещение
const PROJ_HEAD = 0x31b74, PROJ_FREE = 0x31b78;
/** Короткие чтения памяти — код порта повторяет регистровые обращения оригинала. */
const u8 = (m, a) => m.u8(a), i16 = (m, a) => m.i16(a), u16 = (m, a) => m.u16(a);
/** Записать в младший байт регистра (mov al, v). */
const lo8 = (r, v) => ((r >>> 0) & 0xffffff00) | (v & 0xff);      // mov al, v
/** Записать в младшее слово регистра. */
const lo16 = (r, v) => ((r >>> 0) & 0xffff0000) | (v & 0xffff);
/** Модуль 16-битного значения так, как его берёт оригинал (sub/jae/neg). */
const abs16 = v => { v &= 0xffff; return v & 0x8000 ? (0x10000 - v) & 0xffff : v; }; // sub/jae/neg dx (беззнаковая логика)

// ---- 0x1ea75: базовый урон al = ((ATK-DEF)|0 >>4) + (ATK>>5) + 1 ; esi атакующий, edi цель
F[0x1ea75] = (eng, r) => {
  const m = eng.m; const atk = m.u8(UNITS + r.esi + U.ATK); let al = atk - m.u8(UNITS + r.edi + U.DEF);
  if (al < 0) al = 0; al = (al >> 4) + (atk >> 5) + 1; return { eax: lo8(r.eax, al) };
};
// ---- 0x1ea92: ценность цели edi для опыта: ((HPmax+MAG+ATK+DEF+SPD)^2 >> 2) + XP
F[0x1ea92] = (eng, r) => {
  const m = eng.m, b = UNITS + r.edi; const s = (m.u8(b + U.HPMAX) + m.u8(b + U.MAG) + m.u8(b + U.ATK) + m.u8(b + U.DEF) + m.u8(b + U.SPD)) & 0xffff;
  return { eax: (Math.imul(s, s) >>> 2) + m.u32(b + U.XP) >>> 0 };
};
// ---- 0x1f6f3: стоимость +1 к стату: (al*al >> 1) + 10
F[0x1f6f3] = (eng, r) => { const al = r.eax & 0xff; return { eax: (((al * al) & 0xffff) >>> 1) + 10 }; };
// ---- 0x1f6fe: превращение Commoner: HPmax>=70 → Muscle-man(2), ATK>=70 → Warrior(3)
F[0x1f6fe] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi; let al = m.u8(b + U.TYPE);
  if (al === 1) { if (m.u8(b + U.HPMAX) >= 0x46) al = 2; else if (m.u8(b + U.ATK) >= 0x46) al = 3; }
  return { eax: lo8(r.eax, al) };
};
// ---- 0x1a692: юнит на тайле (dx,bx) → esi (0 если нет); мёртвые/трупы/с приказом 0x6f не считаются
F[0x1a692] = (eng, r) => {
  const m = eng.m; const dx = r.edx & 0xffff, bx = r.ebx & 0xffff;
  for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(UNITS + i + U.NEXT)) {
    const b = UNITS + i;
    if (m.u8(b + U.FLAGS5B) & 1) continue; if (m.u8(b + U.STATE) === 0x6f) continue; if (m.u8(b + U.ORDER) === 0x6f) continue;
    if ((m.u16(b + U.X) >>> 5) !== dx) continue; if ((m.u16(b + U.Y) >>> 5) !== bx) continue;
    return { esi: i };
  }
  return { esi: 0 };
};
// ---- 0x1a526 / 0x1a531: поиск цели вокруг esi по кольцам радиуса; → edi (0 нет)
function findTarget(eng, esi, ebx) {
  const m = eng.m, b = UNITS + esi; let ecx = m.u32(0x3058c + ebx * 4) - 1; let ebp = 4;
  const owner = m.u8(b + U.OWNER); const mapW = m.u16(G.mapW), mapH = m.u16(G.mapH);
  globalThis.__сч7 = 0;
  for (;;) { if (++globalThis.__сч7 > 3e6) throw new Error("ЦИКЛ combat.js:47");
    let dx = (m.u8(b + 0x44) + m.i16(0x305d0 + ebp)) & 0xffff;
    if (dx < mapW) {
      let tb = (m.u8(b + 0x45) + m.i16(0x305d2 + ebp)) & 0xffff;
      if (tb < mapH) {
        const gi = dx + (tb << 8); let ok = false;
        const bi = m.u8(BI + gi);
        if (bi & 0xfc) { ok = owner !== ((bi >> 2) - 1) & 0xff; }
        else { const mo = m.u8(MO + gi); if (mo & 0xf0) ok = owner !== (((mo >> 4) - 1) & 0xff); }
        if (ok) {
          let edi = call(eng, 0x1a692, { edx: dx, ebx: tb }).esi;
          if (edi !== 0 && m.u8(UNITS + edi + U.STATE) !== 0x60) {
            if (m.u8(UNITS + edi + U.OWNER) === owner) {
              const st = m.u8(UNITS + edi + U.STATE);
              if (st === 0x10 || st === 0x30) { edi = m.u32(UNITS + edi + U.TARGET); if (m.u8(UNITS + edi + U.STATE) !== 0x60) return edi; }
            } else {
              if (owner >= 8) return edi; if (m.u8(0x32aec + owner) >= 1) return edi; if (m.u8(UNITS + edi + U.TYPE) < 0x1a) return edi;
            }
          }
        }
      }
    }
    ebp += 4; ecx = (ecx - 1) >>> 0; if (ecx === 0) return 0;
  }
}
F[0x1a526] = (eng, r) => ({ edi: findTarget(eng, r.esi, (eng.m.u8(UNITS + r.esi + U.SPD) >>> 5) + 1) });
F[0x1a531] = (eng, r) => ({ edi: findTarget(eng, r.esi, r.ebx >>> 0) });
// ---- 0x1a95d: грубое направление от esi к (dx,bx) → al (таблица 0x304f6)
F[0x1a95d] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi; let eax = 0; const x = m.u16(b + U.X), y = m.u16(b + U.Y), dx = r.edx & 0xffff, bx = r.ebx & 0xffff;
  if (x !== dx) { if (x >= dx) eax = 6; eax += 2; }
  if (y !== bx) { if (y <= bx) eax += 3; eax += 1; }
  return { eax: lo8(r.eax, m.u8(0x304f6 + eax)) };
};
// ---- 0x1aa10: уточнение направления по соотношению |dx|:|dy| (таблица 0x1aa88 → 0x1aa18 для 2,6; 0x1aa4d для 4,8)
function refineDir(m, base, al, dx, bx, flip) {
  dx = abs16(dx - m.u16(base + U.X)); bx = abs16(bx - m.u16(base + U.Y));
  if (dx < bx) { bx >>= 1; if (bx < dx) return al; al = flip ? al + 1 : al - 1; if (flip && (al & 0xff) >= 9) al = 1; }
  else { dx >>= 1; if (dx <= bx) return al; al = flip ? al - 1 : al + 1; }
  return al & 0xff;
}
F[0x1aa10] = (eng, r) => {
  const al = r.eax & 0xff; let res = al;
  if (al === 2 || al === 6) res = refineDir(eng.m, UNITS + r.esi, al, r.edx, r.ebx, false);
  else if (al === 4 || al === 8) res = refineDir(eng.m, UNITS + r.esi, al, r.edx, r.ebx, true);
  return { eax: lo8(r.eax, res) };
};
// ---- 0x1c1dc / 0x1c205: то же для снаряда ebp (координаты 0xf2510/0xf2512)
F[0x1c1dc] = (eng, r) => {
  const m = eng.m, p = P + r.ebp; let eax = 0; const x = m.u16(p + 0xc), y = m.u16(p + 0xe), dx = r.edx & 0xffff, bx = r.ebx & 0xffff;
  if (x !== dx) { if (x >= dx) eax = 6; eax += 2; }
  if (y !== bx) { if (y <= bx) eax += 3; eax += 1; }
  return { eax: lo8(r.eax, m.u8(0x304f6 + eax)) };
};
F[0x1c205] = (eng, r) => {
  const m = eng.m, p = P + r.ebp; const al = r.eax & 0xff; let res = al;
  const go = flip => { let dx = abs16(r.edx - m.u16(p + 0xc)), bx = abs16(r.ebx - m.u16(p + 0xe)); let a = al;
    if (dx < bx) { bx >>= 1; if (bx < dx) return a; a = flip ? a + 1 : a - 1; if (flip && (a & 0xff) >= 9) a = 1; }
    else { dx >>= 1; if (dx <= bx) return a; a = flip ? a - 1 : a + 1; } return a & 0xff; };
  if (al === 2 || al === 6) res = go(false); else if (al === 4 || al === 8) res = go(true);
  return { eax: lo8(r.eax, res) };
};
// ---- 0x1c2a4: взять снаряд из free-списка → esi, CF=1 если нет; 0x1c2ef: вернуть esi в free-список
F[0x1c2a4] = (eng, r) => {
  const m = eng.m; if (m.u32(PROJ_FREE) === 0) return { cf: 1, esi: r.esi };
  const esi = m.u32(PROJ_FREE); let edi = m.u32(P + esi + 0x20); m.w32(P + edi + 0x1c, 0); m.w32(PROJ_FREE, edi);
  edi = m.u32(PROJ_HEAD); m.w32(P + esi + 0x1c, 0); m.w32(P + esi + 0x20, edi); m.w32(P + edi + 0x1c, esi); m.w32(PROJ_HEAD, esi);
  return { cf: 0, esi, edi };
};
F[0x1c2ef] = (eng, r) => {
  const m = eng.m, esi = r.esi; let edi = m.u32(P + esi + 0x1c); const eax = m.u32(P + esi + 0x20);
  if (edi === 0) m.w32(PROJ_HEAD, eax); else m.w32(P + edi + 0x20, eax);
  if (eax !== 0) m.w32(P + eax + 0x1c, edi);
  edi = m.u32(PROJ_FREE); m.w32(P + esi + 0x1c, 0); m.w32(P + esi + 0x20, edi); m.w32(PROJ_FREE, esi);
  if (edi !== 0) m.w32(P + edi + 0x1c, esi);
  return { eax, edi };
};
// ---- 0x1e0e0: снять владельца летающего (тип 0xb) из MO-сетки на тайле (+53,+54) / очистить младший ниббл
F[0x1e0e0] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi; const gi = m.u8(b + 0x53) + (m.u8(b + 0x54) << 8);
  if (m.u8(b + U.TYPE) !== 0xb) { m.w8(MO + gi, m.u8(MO + gi) & 0xf0); return; }
  const cl = ((m.u8(b + U.OWNER) + 1) << 4) & 0xff; m.w8(MO + gi, (m.u8(MO + gi) & 0xf) | cl);
};
// ---- 0x19fbf: приказ ИИ «идти в точку» (dx,bx)
DUP[0x19fbf] = (eng, r) => { const m = eng.m, b = UNITS + r.esi; m.w32(b + 0x47, 0); m.w8(b + U.ORDER, 0x1f); m.w16(b + 0x4b, r.edx); m.w16(b + 0x4d, r.ebx); };
// ---- 0x19fdf: ответ на удар: esi жертва, edi агрессор → приказ 0x33 (атака из охраны) на агрессора
F[0x19fdf] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi, t = UNITS + r.edi;
  if (m.u8(t + U.OWNER) === m.u8(b + U.OWNER)) return;
  if (m.u8(b + 0x42) === 0) { const ty = m.u8(b + U.TYPE); if (ty >= 0xe && ty <= 0x18) call(eng, 0x1ff88, { esi: r.esi }); }
  if (m.u8(t + U.FLAGS5B) & 1) { call(eng, 0x1a34c, { esi: r.esi }); return; }
  m.w8(b + U.ORDER, 0x33); m.w32(b + 0x47, r.edi); m.w16(b + 0x4b, m.u16(b + U.X) & 0xffe0); m.w16(b + 0x4d, m.u16(b + U.Y) & 0xffe0);
};
// ---- 0x2593e: сообщение HUD «атакован» (только указатели текста)
F[0x2593e] = (eng) => { eng.m.w32(0x41910, 0x41a10); eng.m.w16(0x41922, 0x12); };
// ---- 0x1a051: цель edi в зоне досягаемости esi? → al=0 в зоне, 1 нет. Пишет 0x36dd2/0x36dd4.
function rectHit(m, edi, dx, ax, bx, cx) {
  const t = UNITS + edi; const s16 = v => (v << 16) >> 16; dx = s16(dx); ax = s16(ax); bx = s16(bx); cx = s16(cx);
  const x0 = m.i16(t + U.X), y0 = m.i16(t + U.Y), x1 = m.i16(0x36dd2), y1 = m.i16(0x36dd4);
  const inside = (x, y) => !(x < dx || x > ax || y < bx || y > cx);
  return inside(x0, y0) || inside(x1, y0) || inside(x1, y1) || inside(x0, y1);
}
F[0x1a051] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi;
  if ((m.u8(b + U.X) & 0x1f) || (m.u8(b + U.Y) & 0x1f)) return { eax: lo8(r.eax, 1) };
  let dx = m.u16(b + U.X), bx = m.u16(b + U.Y); const ty = m.u8(b + U.TYPE);
  let ax = (dx + m.u16(0x303b6 + ty * 4)) & 0xffff, cx = (bx + m.u16(0x303b8 + ty * 4)) & 0xffff;
  let ebp = -1;
  if (ty < 5) { const ws = m.i8(b + U.WEAPON); if (ws !== -1) { const it = m.u8(b + U.INV + ws); if (it === 4) ebp = m.u8(b + U.SPD) >> 6; else if (it >= 5 && it <= 7) ebp = m.u8(b + U.SPD) >> 5; } }
  else if (ty <= 8) ebp = m.u8(b + U.SPD) >> 5; else if (ty === 0xd) ebp = 0;
  if (ebp >= 0) {
    const rx = m.u16(0x3055e + ebp * 4), ry = m.u16(0x30560 + ebp * 4);
    dx = dx >= rx ? dx - rx : 0; bx = bx >= ry ? bx - ry : 0; ax = (ax + rx) & 0xffff; cx = (cx + ry) & 0xffff;
  }
  const t = UNITS + r.edi, tt = m.u8(t + U.TYPE);
  m.w16(0x36dd2, m.u16(t + U.X) + m.u16(0x303b6 + tt * 4)); m.w16(0x36dd4, m.u16(t + U.Y) + m.u16(0x303b8 + tt * 4));
  return { eax: lo8(ax, rectHit(m, r.edi, dx, ax, bx, cx) ? 0 : 1) };
};
// ---- 0x1a1e4: соседство esi и edi с запасом ebp (для заклинаний): al=0 рядом
F[0x1a1e4] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi;
  if ((m.u8(b + U.X) & 0x1f) || (m.u8(b + U.Y) & 0x1f)) return { eax: lo8(r.eax, 1) };
  const ty = m.u8(b + U.TYPE), t = UNITS + r.edi;
  m.w16(0x36dd2, m.u16(t + U.X) + m.u16(0x303b6 + ty * 4)); m.w16(0x36dd4, m.u16(t + U.Y) + m.u16(0x303b8 + ty * 4));
  const ebp = r.ebp | 0; const edx = m.u16(b + U.X) - ebp, ebx = m.u16(b + U.Y) - ebp;
  const eax = ((m.u16(b + U.X) + m.u16(0x303b6 + ty * 4)) & 0xffff) + ebp, ecx = ((m.u16(b + U.Y) + m.u16(0x303b8 + ty * 4)) & 0xffff) + ebp;
  return { eax: lo8(eax, rectHit(m, r.edi, edx, eax, ebx, ecx) ? 0 : 1) };
};
// ---- звуковые обёртки: если звук включён ([0x30c4c]==1) — id → 0x2000d (очередь звуков)
const SND_ON = 0x30c4c;
/** Заявка на звук от юнита esi. */
const snd = (eng, eax, esi) => call(eng, 0x2000d, { eax, esi });
DUP[0x1ff1c] = (eng, r) => { const m = eng.m; if (m.u8(SND_ON) !== 1) return; snd(eng, m.u32(0x38d98 + m.u8(UNITS + r.esi + U.TYPE) * 4), r.esi); };
F[0x1ff39] = (eng, r) => { const m = eng.m; if (m.u8(SND_ON) !== 1) return; const b = UNITS + r.esi, ty = m.u8(b + U.TYPE);
  if (m.u32(0x38ef8 + ty * 4) !== 0) return snd(eng, m.u32(0x38ef8 + ty * 4), r.esi);
  let ebx = 0; const ws = m.i8(b + U.WEAPON); if (ws !== -1) ebx = m.u8(b + U.INV + ws);
  const eax = m.u32(0x38e98 + ebx * 4); if (eax >= 0x44) snd(eng, eax, r.esi); };
F[0x1ff88] = (eng, r) => { const m = eng.m; if (m.u8(SND_ON) !== 1) return; snd(eng, m.u32(0x38be8 + m.u8(UNITS + r.esi + U.TYPE) * 8), r.esi); };
DUP[0x1ffb6] = (eng, r) => { const m = eng.m; if (m.u8(SND_ON) !== 1) return; snd(eng, m.u32(0x38fe4 + (r.eax >>> 0) * 4), r.esi); };
F[0x1ffc9] = (eng, r) => { if (eng.m.u8(SND_ON) !== 1) return; snd(eng, 0x68, r.esi); };
F[0x1ffda] = (eng, r) => { if (eng.m.u8(SND_ON) !== 1) return; snd(eng, 0x69, r.esi); };
DUP[0x1ffeb] = (eng, r) => { if (eng.m.u8(SND_ON) !== 1) return; snd(eng, 0x6a, r.esi); };
F[0x1fffc] = (eng, r) => { if (eng.m.u8(SND_ON) !== 1) return; snd(eng, 0x6b, r.esi); };

// ======================= СТАДИЯ 2: нанесение урона, смерть, рост статов, реакция ИИ =======================
// ---- 0x1b8d9: эффект «+стат» (снаряд типа 0x3a): esi юнит, edx индекс стата, ax смещение кадра
F[0x1b8d9] = (eng, r) => {
  const m = eng.m; const a = call(eng, 0x1c2a4, { esi: r.esi }); if (a.cf) return { edi: a.edi };
  const p = P + a.esi; m.w8(p, 0x3a); m.w8(p + 1, 0x20); m.w16(p + 0x10, r.eax); m.w8(p + 3, 0xf8); m.w32(p + 4, r.esi); m.w32(p + 8, r.edx); m.w32(p + 0xc, 0xfffffffc);
  return { edi: a.esi };
};
// таблицы статов для роста: (бит, поле, смещение потолка в блоке игрока, глобал текущего, edx для эффекта)
const STATS = [
  { bit: 1, cur: U.HPMAX, cap: 0, g: 0x38206, edx: 0 }, { bit: 2, cur: U.ATK, cap: 4, g: 0x38208, edx: 4 },
  { bit: 4, cur: U.DEF, cap: 6, g: 0x3820a, edx: 8 }, { bit: 8, cur: U.MAG, cap: 2, g: 0x3820c, edx: 0xc, skills: true },
  { bit: 0x10, cur: U.SPD, cap: 8, g: 0x3820e, edx: 0x10 }];
/** Адрес блока потолков роста для этого племени и типа юнита. */
function capBlock(m, esi) { const b = UNITS + esi; return (m.u32(0x30dd8 + m.u8(b + U.SLOT) * 4) + m.u32(0x30dfc + m.u8(b + U.TYPE) * 4)) >>> 0; }
// один блок роста стата; mode 'first' (растущие) / 'second' (нерастущие). Возврат: 'cont' | 'switchFirst'
function growStat(eng, esi, edi, st, d, mode) {
  const m = eng.m, b = UNITS + esi; const growing = (m.u8(b + U.STAT0B) & d.bit) !== 0;
  if (mode === 'first' ? !growing : growing) return 'cont';
  const prod = (st.ecx & 0xffff) * m.u16(edi + d.cap); const bx = st.ebx & 0xffff; const ax = bx ? Math.floor(prod / bx) & 0xffff : 0;
  if (m.u16(d.g) >= ax) return 'cont';
  const cur = m.u8(b + d.cur); if (m.u8(edi + d.cap) <= cur) return mode === 'first' ? 'cont' : 'switchFirst';
  const cost = call(eng, 0x1f6f3, { eax: cur }).eax >>> 0; if (m.u32(b + U.XP) < cost) return 'cont';
  m.w8(b + d.cur, cur + 1); m.w16(d.g, m.u16(d.g) + 1); m.w32(b + U.XP, m.u32(b + U.XP) - cost);
  if (d.skills) call(eng, 0x1f475, { esi });
  call(eng, 0x1b8d9, { esi, edx: d.edx, eax: m.u16(0x38204) }); m.w32(0x38200, m.u32(0x38200) + 1); st.ecx = (st.ecx + 1) >>> 0; m.w16(0x38204, m.u16(0x38204) + 0x10);
  return 'cont';
}
// ---- 0x1ec47: рост статов человека/ручного динозавра (типы < 0xe) после убийства
F[0x1ec47] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; const edi = capBlock(m, esi);
  m.w16(0x38204, 0); m.w8(0x38206, m.u8(b + U.HPMAX)); m.w8(0x38208, m.u8(b + U.ATK)); m.w8(0x3820a, m.u8(b + U.DEF)); m.w8(0x3820c, m.u8(b + U.MAG)); m.w8(0x3820e, m.u8(b + U.SPD));
  const grow = m.u8(b + U.STAT0B); const st = { ecx: 0, ebx: 0 }; let eax = 0; m.w32(0x381fc, 0);
  const sums = (mode) => { eax = 0; st.ebx = 0; st.ecx = 0; for (const d of STATS) { const g = (grow & d.bit) !== 0; if (mode === 'first' ? g : !g) { st.ecx = (st.ecx + m.u16(d.g)) & 0xffff; st.ebx = (st.ebx + m.u16(edi + d.cap)) & 0xffff; eax++; } } };
  const runChain = (startK, mode) => { // выполнить блоки startK..4 в режиме mode; возврат true если ушли в first-цепочку
    for (let k = startK; k < 5; k++) { const res = growStat(eng, esi, edi, st, STATS[k], mode); if (res === 'switchFirst') { for (let j = k + 1; j < 5; j++) growStat(eng, esi, edi, st, STATS[j], 'first'); return true; } }
    return false; };
  sums('first');
  let firstLoop = eax !== 0 && st.ecx < st.ebx;
  if (firstLoop) { m.w32(0x381fc, eax); st.ecx = (st.ecx + eax) >>> 0; }
  globalThis.__сч8 = 0;
  for (;;) { if (++globalThis.__сч8 > 3e6) throw new Error("ЦИКЛ combat.js:228");
    if (firstLoop) { do { m.w32(0x38200, 0); runChain(0, 'first'); } while (m.u32(0x38200) !== 0); }
    if (m.u32(0x381fc) >= 1) return;
    sums('second'); if (eax === 0 || st.ecx >= st.ebx) return; st.ecx = (st.ecx + eax) >>> 0;
    globalThis.__сч9 = 0;
    for (;;) { if (++globalThis.__сч9 > 3e6) throw new Error("ЦИКЛ combat.js:232"); m.w32(0x38200, 0); const sw = runChain(0, 'second'); if (sw) { firstLoop = m.u32(0x38200) !== 0; break; } if (m.u32(0x38200) === 0) return; }
    if (!firstLoop) continue;   // после first-цепочки [38200]==0 → 1ef4f
  }
};
// ---- 0x1f20f: рост статов дикого зверя (потолок — только SPD-cap, как в оригинале)
F[0x1f20f] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; const edi = capBlock(m, esi);
  m.w16(0x38204, 0); m.w8(0x38206, m.u8(b + U.HPMAX)); m.w8(0x38208, m.u8(b + U.ATK)); m.w8(0x3820a, m.u8(b + U.DEF)); m.w8(0x3820e, m.u8(b + U.SPD));
  let ecx = (m.u16(0x38206) + m.u16(0x38208) + m.u16(0x3820a) + m.u16(0x3820e)) & 0xffff; const ebx = m.u16(edi + 8);
  if (ecx >= ebx) return; ecx += 4;
  const one = (d) => { const prod = (ecx & 0xffff) * m.u16(edi + d.cap); const ax = ebx ? Math.floor(prod / ebx) & 0xffff : 0;
    if (m.u16(d.g) >= ax) return; const cur = m.u8(b + d.cur); if (m.u8(edi + d.cap) <= cur) return;
    const cost = call(eng, 0x1f6f3, { eax: cur }).eax >>> 0; if (m.u32(b + U.XP) < cost) return;
    m.w8(b + d.cur, cur + 1); m.w16(d.g, m.u16(d.g) + 1); m.w32(b + U.XP, m.u32(b + U.XP) - cost);
    call(eng, 0x1b8d9, { esi, edx: d.edx, eax: m.u16(0x38204) }); m.w32(0x38200, m.u32(0x38200) + 1); ecx = (ecx + 1) >>> 0; m.w16(0x38204, m.u16(0x38204) + 0x10); };
  do { m.w32(0x38200, 0); one(STATS[0]); one(STATS[1]); one(STATS[2]); one(STATS[4]); } while (m.u32(0x38200) !== 0);
};
// ---- 0x1f426: рост HPmax растений/зданий за опыт (без потолка)
F[0x1f426] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; if (m.u8(b + U.HPMAX) === 0xff) return; m.w16(0x38204, 0);
  globalThis.__сч10 = 0;
  for (;;) { if (++globalThis.__сч10 > 3e6) throw new Error("ЦИКЛ combat.js:252"); const cur = m.u8(b + U.HPMAX); const cost = call(eng, 0x1f6f3, { eax: cur }).eax >>> 0; if (m.u32(b + U.XP) < cost) return;
    m.w32(b + U.XP, m.u32(b + U.XP) - cost); m.w8(b + U.HPMAX, cur + 1); call(eng, 0x1b8d9, { esi, edx: 0, eax: m.u16(0x38204) }); m.w16(0x38204, m.u16(0x38204) + 0x10); }
};
// ---- 0x160fe: реакция ИИ на удар по зданию: esi агрессор, edi здание. Собирает силы врага в квадрате ±0x40..+0xa0 и шлёт своих
F[0x160fe] = (eng, r) => {
  const m = eng.m, esi = r.esi; m.w32(0x366a4, esi); m.w32(0x366a8, r.edi);
  const sx = m.u16(UNITS + esi + U.X), sy = m.u16(UNITS + esi + U.Y);
  const dx = (sx - 0x40) << 16 >> 16, bx = (sy - 0x40) << 16 >> 16, ax = (dx + 0xa0) << 16 >> 16, bp = (bx + 0xa0) << 16 >> 16;
  m.w32(0x366ac, 0); m.w32(0x366b0, 0); const cl = m.u8(UNITS + r.edi + U.OWNER);
  const sum4 = (b) => (m.u8(b + U.HP) + m.u8(b + U.ATK) + m.u8(b + U.DEF) + m.u8(b + U.MANA)) & 0xffff;
  for (let e = m.u32(G.unitHead); e !== 0; e = m.u32(UNITS + e + U.NEXT)) {
    const b = UNITS + e; if (m.u8(b + U.OWNER) === cl) continue;
    const x = m.i16(b + U.X), y = m.i16(b + U.Y); if (x < dx || x >= ax || y < bx || y >= bp) continue;
    if (m.u8(b + U.FLAGS5B) & 1) continue; if (m.u8(b + U.STATE) === 0x60) continue;
    m.w32(0x366ac, m.u32(0x366ac) + sum4(b)); m.w32(0x366b0, m.u32(0x366b0) + 1);
  }
  m.w32(0x366bc, 0); m.w32(0x366c0, 0x10); m.w16(0x366c4, 0xffff); m.w32(0x366cc, 0xffffffff); m.w32(0x366d0, 0xffffffff);
  for (let e = m.u32(G.unitHead); e !== 0; e = m.u32(UNITS + e + U.NEXT)) {
    const b = UNITS + e; if (m.u8(b + U.OWNER) !== cl) continue; const ty = m.u8(b + U.TYPE); if (ty >= 0x1a || ty === 4) continue;
    if (m.u8(b + U.FLAGS5B) & 1) continue; if (m.u8(b + U.STATE) === 0x60) continue;
    let a = abs16(m.u16(b + U.X) - sx), bb = abs16(m.u16(b + U.Y) - sy); if (a <= bb) a = bb;
    let ebx = m.u32(0x366bc);
    globalThis.__сч11 = 0;
    for (;;) { if (++globalThis.__сч11 > 3e6) throw new Error("ЦИКЛ combat.js:274");
      if (m.u16(ebx + 0x366c4) >= a) {
        if (m.u32(0x366c0) < 0x320) {
          const ecx = m.u32(0x366c0); m.w32(0x366c0, ecx + 0x10); m.w16(ecx + 0x366c4, a); m.w32(ecx + 0x366c8, e); m.w32(ecx + 0x366d0, ebx);
          const eax = m.u32(ebx + 0x366cc); m.w32(ecx + 0x366cc, eax); m.w32(ebx + 0x366cc, ecx);
          if (eax === 0xffffffff) m.w32(0x366bc, ecx); else m.w32(eax + 0x366d0, ecx);
        } else { m.w16(ebx + 0x366c4, a); m.w32(ebx + 0x366c8, e); }
        break;
      }
      if (m.u32(ebx + 0x366d0) === 0xffffffff) break; ebx = m.u32(ebx + 0x366d0);
    }
  }
  const dif = m.u8(G.difficulty); m.w32(0x366ac, m.u32(0x366ac) + m.u32(0x369e4 + dif * 4)); m.w32(0x366b0, m.u32(0x366b0) + m.u32(0x369f0 + dif * 4));
  m.w32(0x366b4, 0); m.w32(0x366b8, 0); const tx = sx & 0xffe0, ty2 = sy & 0xffe0;
  let eax = m.u32(0x366bc);
  while (m.u32(eax + 0x366d0) !== 0xffffffff) {
    const u = m.u32(eax + 0x366c8), b = UNITS + u; m.w32(0x366b4, m.u32(0x366b4) + sum4(b)); m.w32(0x366b8, m.u32(0x366b8) + 1);
    const st = m.u8(b + U.STATE);
    if (!(st & 0x80) && (st < 0x10 || st > 0x33)) call(eng, 0x19fbf, { esi: u, edx: tx, ebx: ty2 });
    eax = m.u32(eax + 0x366d0);
    if (m.u32(0x366ac) >= m.u32(0x366b4)) continue; if (m.u32(0x366b0) >= m.u32(0x366b8)) continue; break;
  }
  return { esi: m.u32(0x366a4), edi: m.u32(0x366a8) };
};
// ---- 0x1eada / 0x1eaca / 0x1ead3: нанести al урона цели edi от esi (с ответом, реакцией ИИ и смертью)
function applyDamage(eng, r) {
  const m = eng.m, esi = r.esi, edi = r.edi, al = r.eax & 0xff; const t = UNITS + edi, b = UNITS + esi;
  if (m.u8(t + U.FLAGS5B) & 1) return call(eng, 0x1a34c, { esi });
  let dead = false;
  const sub = (v) => { const hp = m.u8(t + U.HP); const nv = hp - v; m.w8(t + U.HP, nv); return nv <= 0; };
  if (m.u8(t + U.TYPE) >= 0x1a) {
    const bl = m.u8(t + U.HPMAX) >> 1;
    if (m.u8(t + U.HP) < bl) dead = sub(al);
    else { dead = sub(al); if (!dead && m.u8(t + U.HP) < bl) { call(eng, 0x1ffda, { esi, edi }); const hp = m.u8(t + U.HP); m.w8(t + U.HP, hp - 2); dead = hp < 2; } }
  } else dead = sub(al);
  if (dead) return death(eng, esi, edi);
  if (m.u8(t + U.TYPE) >= 0x1a) {
    const ow = m.u8(t + U.OWNER);
    if (m.u8(G.humanOwner) === ow) call(eng, 0x2593e, {});                 // сообщение — только зрителю
    if (человек(m, ow)) return;                                              // реакция ИИ — не за людей (одинаково на всех машинах)
    if (m.u8(0x32aec + ow) === 0) return;
    const ao = m.u8(b + U.OWNER); if (ao === 8) return call(eng, 0x160fe, { esi, edi });
    if (m.u8(0x32aec + ao) === 0) return call(eng, 0x160fe, { esi, edi }); return;
  }
  if (m.u8(b + U.TYPE) >= 0x18) return; if (m.u8(t + U.ORDER) !== 0xff) return;
  const st = m.u8(t + U.STATE);
  const retaliate = () => call(eng, 0x19fdf, { esi: edi, edi: esi });
  if (st === 0x20 || st === 0x32) return retaliate();
  if (st >= 0x36 && st <= 0x3f) return retaliate();
  const ss = m.u8(b + U.STATE); if (ss !== 0x10 && ss !== 0x30) return;
  const ebp = m.u32(t + U.TARGET); if (m.u8(UNITS + ebp + U.TYPE) >= 0x18) return retaliate();
}
/** 0x1ebdc: цель убита — обнулить здоровье, начислить опыт убийце, запустить смерть. */
function death(eng, esi, edi) { // 0x1ebdc
  const m = eng.m, t = UNITS + edi, b = UNITS + esi; m.w8(t + U.HP, 0);
  const st = m.u8(t + U.STATE); if (st === 0x6f || st === 0x60) return; m.w8(t + U.STATE, 0x6f);
  if (m.u8(t + U.TYPE) >= 0x1a) return;
  const eax = call(eng, 0x1ea92, { edi }).eax >>> 0; m.w32(b + U.XP, (m.u32(b + U.XP) + eax) >>> 0); m.w8(b + U.FLAGS50, 0xd);
  const ty = m.u8(b + U.TYPE);
  if (ty < 0xe) { call(eng, 0x1ec47, { esi }); const a = call(eng, 0x1f6fe, { esi, eax: 0 }); m.w8(b + U.TYPE, a.eax & 0xff); return; }
  if (ty < 0x18) return call(eng, 0x1f20f, { esi }); return call(eng, 0x1f426, { esi });
}
F[0x1eada] = (eng, r) => applyDamage(eng, r);
F[0x1eaca] = (eng, r) => { eng.m.w8(0x31b68, 1); return applyDamage(eng, r); };
F[0x1ead3] = (eng, r) => { eng.m.w8(0x31b68, 0); return applyDamage(eng, r); };
F[0x1ebdc] = (eng, r) => death(eng, r.esi, r.edi);

// ======================= СТАДИЯ 3: удар (0x1e758) и создание снаряда (0x1b730, 0x1b876) =======================
const PROJ_OFF = [[0, 0], [13, -4], [21, 1], [17, 8], [15, 14], [22, 15], [-7, 9], [-4, 2], [3, -4]]; // cs:0x1b852 — смещение точки вылета по направлению 0..8
// ---- 0x1b730: инициализация снаряда: al вид, ebp снаряд, esi стрелок, edi цель
F[0x1b730] = (eng, r) => {
  const m = eng.m, p = P + r.ebp, b = UNITS + r.esi, t = UNITS + r.edi; let al = r.eax & 0xff;
  m.w8(p, al); const ebx = m.u8(b + U.SPD) >> 5; m.w8(p + 1, ((m.u16(0x3055e + ebx * 4) + 0x28) & 0xffff) >> 1);
  m.w32(p + 4, r.esi); m.w32(p + 8, r.edi);
  const dir = m.u16(b + U.DIR); const off = PROJ_OFF[dir] || [0, 0];
  m.w16(p + 0xc, m.u16(b + U.X) + off[0]); m.w16(p + 0xe, m.u16(b + U.Y) + off[1]);
  m.w8(p, (m.u8(p) + dir) & 0xff);
  const d = call(eng, 0x1a95d, { esi: r.esi, edx: m.u16(t + U.X), ebx: m.u16(t + U.Y), eax: dir }).eax & 0xff;
  m.w16(p + 0x18, m.u16(0x30504 + d * 4) << 1); m.w16(p + 0x1a, m.u16(0x30506 + d * 4) << 1);
  const tt = m.u8(t + U.TYPE); const dx = abs16(m.u16(0x30456 + tt * 4) + m.u16(t + U.X) - m.u16(p + 0xc)), bx = abs16(m.u16(0x30458 + tt * 4) + m.u16(t + U.Y) - m.u16(p + 0xe));
  m.w16(p + 0x10, dx); m.w16(p + 0x12, bx); m.w16(p + 0x14, dx); m.w16(p + 0x16, bx); m.w8(p + 2, dx < bx ? 1 : 0);
};
// ---- 0x1b876: плевок Dilophosaurus (снаряд 0x44 к цели +33)
F[0x1b876] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi; const a = call(eng, 0x1c2a4, { esi: r.esi }); if (a.cf) return { cf: 1 };
  const p = P + a.esi; m.w8(p, 0x44); m.w8(p + 2, m.u8(b + U.DIR)); m.w8(p + 1, 0xff); m.w32(p + 4, r.esi); m.w32(p + 8, m.u32(b + U.TARGET));
  const x = m.u16(b + U.X), y = m.u16(b + U.Y); m.w16(p + 0x10, x); m.w16(p + 0x12, y); m.w16(p + 0xc, x); m.w16(p + 0xe, y); return { cf: 0, edi: a.esi };
};
// ---- 0x1e758: удар esi по edi: +1 XP обоим, звук, урон по типу атакующего (маги — снаряды 0x18/0x20/0x28/0x30, оружие 4..7 — снаряды, иначе сразу)
function magicShot(eng, r, tabA, tabB, kind) {
  const m = eng.m, t = UNITS + r.edi; let al = call(eng, 0x1ea75, r).eax & 0xff; al = (al + m.u8(tabA + m.u8(t + U.TYPE))) & 0xff;
  const dl = m.u8(t + U.SHIELD); if (dl !== 0xff) { const v = al - m.u8(tabB + dl); al = v < 0 ? 1 : v; }
  const a = call(eng, 0x1c2a4, { esi: r.esi }); if (a.cf) return; m.w8(P + a.esi + 3, al); call(eng, 0x1b730, { eax: kind, ebp: a.esi, esi: r.esi, edi: r.edi });
}
F[0x1e758] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi, t = UNITS + r.edi;
  m.w32(b + U.XP, (m.u32(b + U.XP) + 1) >>> 0); m.w32(t + U.XP, (m.u32(t + U.XP) + 1) >>> 0);
  call(eng, 0x1ff39, { esi: r.esi });
  const ty = m.u8(b + U.TYPE);
  if (ty === 0 || ty >= 24) return;
  if (ty === 5) return magicShot(eng, r, 0x37990, 0x379b8, 0x18);
  if (ty === 6) return magicShot(eng, r, 0x379d7, 0x379ff, 0x20);
  if (ty === 7) return magicShot(eng, r, 0x37a1e, 0x37a46, 0x28);
  if (ty === 8) return magicShot(eng, r, 0x37a65, 0x37a8d, 0x30);
  if (ty === 13) return call(eng, 0x1b876, { esi: r.esi });
  // 0x1e934: обычная атака с учётом оружия/щита
  let al = call(eng, 0x1ea75, r).eax & 0xff; const ecx = m.u8(t + U.TYPE); let edx = 0x37b54;
  const ws = m.u8(b + U.WEAPON); let wid = -1;
  if (ws !== 0xff) { wid = m.u8(b + U.INV + ws); edx = m.u32(0x37af4 + wid * 4); al = (al + m.u8(ecx + edx)) & 0xff; }
  const ss = m.u8(t + U.SHIELD);
  if (ss !== 0xff) { const cl = m.u8(t + U.INV + ss); const v = al - m.u8(cl + edx + 0x28); al = v <= 0 ? 1 : v; }
  if (ws === 0xff) return call(eng, 0x1ead3, { esi: r.esi, edi: r.edi, eax: al });
  const kinds = { 4: 0x3b, 5: 0, 6: 8, 7: 0x10 };
  if (!(wid in kinds)) return call(eng, 0x1ead3, { esi: r.esi, edi: r.edi, eax: al });
  const a = call(eng, 0x1c2a4, { esi: r.esi }); if (a.cf) return; m.w8(P + a.esi + 3, al);
  call(eng, 0x1b730, { eax: kinds[wid], ebp: a.esi, esi: r.esi, edi: r.edi });
};

// ======================= СТАДИЯ 4: обработчики снарядов (таблицы 0x1ab84 / 0x1ac98, вызываются циклом 0x1ab4c) =======================
const free = (eng, esi) => call(eng, 0x1c2ef, { esi });
/** Случайное число движка (общий ГСЧ 0x20469): диапазон кладётся в 0x31b58. */
const RND = (eng, range) => { eng.m.w32(G.rngRange, range); return call(eng, 0x20469, {}).edx & 0xff; }; // mov [31b58],n; call 0x20469 → dl
// хвост 0x1b730 от 0x1b7b6: вектор шага по направлению eax и расстояние до центра цели
F[0x1b7b6] = (eng, r) => {
  const m = eng.m, p = P + r.ebp, t = UNITS + r.edi; const d = r.eax >>> 0;
  m.w16(p + 0x18, m.u16(0x30504 + d * 4) << 1); m.w16(p + 0x1a, m.u16(0x30506 + d * 4) << 1);
  const tt = m.u8(t + U.TYPE); const dx = abs16(m.u16(0x30456 + tt * 4) + m.u16(t + U.X) - m.u16(p + 0xc)), bx = abs16(m.u16(0x30458 + tt * 4) + m.u16(t + U.Y) - m.u16(p + 0xe));
  m.w16(p + 0x10, dx); m.w16(p + 0x12, bx); m.w16(p + 0x14, dx); m.w16(p + 0x16, bx); m.w8(p + 2, dx < bx ? 1 : 0);
};
// движение снаряда по Брезенхему (общая часть 0x1ad4f / 0x1b15b)
function projMove(m, p) {
  if (m.u8(p + 2) !== 0) {
    m.w16(p + 0xe, m.u16(p + 0xe) + m.u16(p + 0x1a)); let ax = (m.u16(p + 0x10) + m.u16(p + 0x14)) & 0xffff;
    if (!(m.u16(p + 0x12) > ax)) { ax = (ax - m.u16(p + 0x16)) & 0xffff; m.w16(p + 0xc, m.u16(p + 0xc) + m.u16(p + 0x18)); }
    m.w16(p + 0x10, ax);
  } else {
    m.w16(p + 0xc, m.u16(p + 0xc) + m.u16(p + 0x18)); let ax = (m.u16(p + 0x12) + m.u16(p + 0x16)) & 0xffff;
    if (!(m.u16(p + 0x10) > ax)) { m.w16(p + 0xe, m.u16(p + 0xe) + m.u16(p + 0x1a)); ax = (ax - m.u16(p + 0x14)) & 0xffff; }
    m.w16(p + 0x12, ax);
  }
}
// проверка попадания в bbox цели (+8); при попадании — урон [+3] от [+4]
function projHit(eng, p, esi, lifeOnHit) {
  const m = eng.m; if (m.u8(p + 3) === 0) return false;
  const tgt = m.u32(p + 8), t = UNITS + tgt; let dx = m.u16(t + U.X), bx = m.u16(t + U.Y);
  if (m.u16(p + 0xc) < dx || m.u16(p + 0xe) < bx) return false;
  const tt = m.u8(t + U.TYPE); dx = (dx + m.u16(0x303b6 + tt * 4)) & 0xffff; bx = (bx + m.u16(0x303b8 + tt * 4)) & 0xffff;
  if (m.u16(p + 0xc) > dx || m.u16(p + 0xe) > bx) return false;
  m.w8(p + 1, lifeOnHit); const al = m.u8(p + 3); m.w8(p + 3, 0);
  m.w8(0x31b68, 1); call(eng, 0x1eada, { eax: al, esi: m.u32(p + 4), edi: tgt }); return true;
}
// ---- 0x1ad3c: полёт снаряда, 8 подшагов; попадание оглушает цель (+43 |= 6)
F[0x1ad3c] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; m.w8(0x36fde, 8);
  globalThis.__сч12 = 0;
  for (;;) { if (++globalThis.__сч12 > 3e6) throw new Error("ЦИКЛ combat.js:426");
    const life = (m.u8(p + 1) - 1) & 0xff; m.w8(p + 1, life); if (life === 0) return free(eng, esi);
    projMove(m, p);
    if (projHit(eng, p, esi, 0xc)) {
      if (m.u8(p) < 9) { const tgt = m.u32(p + 8); const ty = m.u8(UNITS + esi + U.TYPE); // оригинал читает тип по индексу СНАРЯДА
        if (ty < 0x1a && (ty < 9 || (m.u16(G.step) & 1) === 0)) m.w8(UNITS + tgt + U.FX43, m.u8(UNITS + tgt + U.FX43) | 6); }
    }
    m.w8(0x36fde, m.u8(0x36fde) - 1); if (m.u8(0x36fde) === 0) return;
  }
};
// ---- 0x1b149: полёт (4 подшага) без оглушения
F[0x1b149] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi;
  const life = (m.u8(p + 1) - 1) & 0xff; m.w8(p + 1, life); if (life === 0) return free(eng, esi);   // время жизни — раз в тик
  for (let n = 4; n > 0; n--) { projMove(m, p); projHit(eng, p, esi, 2); }
};
// ---- 0x1aeaf: эффект над юнитом (+4): ждёт [+0x10] тиков, потом [+1] тиков со сдвигом [+0xc]++
F[0x1aeaf] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; const u = UNITS + m.u32(p + 4);
  if (m.u8(u + U.STATE) === 0x60 || m.u8(u + U.TYPE) >= 0x1a) return free(eng, esi);
  if (m.u16(p + 0x10) !== 0) { m.w16(p + 0x10, m.u16(p + 0x10) - 1); return; }
  const life = (m.u8(p + 1) - 1) & 0xff; m.w8(p + 1, life); if (life === 0) return free(eng, esi);
  m.w32(p + 0xc, m.u32(p + 0xc) + 1);
};
// ---- 0x1aef4: волна/веер (типы 0x8x с таблицами 0x37070/0x37094): урон одному юниту на тайле за тик
F[0x1aef4] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; m.w8(p + 1, m.u8(p + 1) + 1);
  if (m.u8(p + 1) >= 0xa) { const edi = m.u32(p + 8), src = m.u32(p + 4); const al = call(eng, 0x1ea75, { esi: src, edi }).eax & 0xff; call(eng, 0x1ead3, { eax: al, esi: src, edi }); return free(eng, esi); }
  const dir = m.u8(p + 2); m.w16(p + 0xc, m.u16(p + 0xc) + m.u16(0x37070 + dir * 4)); m.w16(p + 0xe, m.u16(p + 0xe) + m.u16(0x37072 + dir * 4));
  if (m.u8(p + 1) > 6) return;
  const ecx = (m.u32(0x37094 + dir * 4) + m.u8(p + 1) * 8) >>> 0; const dx = (m.u16(p + 0x10) + m.u16(ecx)) & 0xffff, bx = (m.u16(p + 0x12) + m.u16(ecx + 2)) & 0xffff;
  m.w8(0x36fdf, m.u8(ecx + 4)); m.w32(0x36fd0, m.u32(p + 8)); const src = m.u32(p + 4);
  for (let e = m.u32(G.unitHead); e !== 0; e = m.u32(UNITS + e + U.NEXT)) {
    const b = UNITS + e; if ((m.u16(b + U.X) & 0xffe0) !== dx || (m.u16(b + U.Y) & 0xffe0) !== bx) continue;
    if (m.u32(0x36fd0) === e) continue; const st = m.u8(b + U.STATE); if (st === 0x60 || st === 0x6f) continue;
    let al = call(eng, 0x1ea75, { esi: src, edi: e }).eax & 0xff; al = (al + m.u8(0x37aac + m.u8(b + U.TYPE))) & 0xff;
    const dl = m.u8(b + U.SHIELD);
    if (dl !== 0xff) { const v = al - m.u8(0x37ad4 + dl); if (v < 0) return call(eng, 0x1b876, { esi: src, eax: 1 }); al = v; }
    const v = al - m.u8(0x36fdf); return call(eng, 0x1ead3, { eax: v > 0 ? v : 1, esi: src, edi: e });
  }
};
F[0x1b02c] = (eng, r) => { const m = eng.m, p = P + r.esi; m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) >= 7) return free(eng, r.esi); };
F[0x1b040] = F[0x1b02c];
F[0x1b0ca] = (eng, r) => { const m = eng.m, p = P + r.esi; m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) >= 0xc) return free(eng, r.esi); };
// ---- 0x1b054 / 0x1b08f: лечение цели (+8): +1 HP за тик / до полного
F[0x1b054] = (eng, r) => { const m = eng.m, p = P + r.esi, t = UNITS + m.u32(p + 8);
  if (m.u8(t + U.HP) < m.u8(t + U.HPMAX)) { if (m.u8(t + U.STATE) === 0x60) return free(eng, r.esi); m.w8(t + U.HP, m.u8(t + U.HP) + 1); }
  m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) >= 0xaa) return free(eng, r.esi); };
F[0x1b08f] = (eng, r) => { const m = eng.m, p = P + r.esi, t = UNITS + m.u32(p + 8);
  if (m.u8(t + U.HP) < m.u8(t + U.HPMAX)) { if (m.u8(t + U.STATE) === 0x60) return free(eng, r.esi); m.w8(t + U.HP, m.u8(t + U.HPMAX)); }
  m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) >= 0xc8) return free(eng, r.esi); };
// ---- 0x1b0de: самонаводящийся снаряд: полёт как 0x1b149, каждые 4 тика пересчёт направления на цель
F[0x1b0de] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; call(eng, 0x1b149, { esi });
  if (m.u8(p) === 0) return free(eng, esi); if (m.u8(p + 1) & 3) return;
  const edi = m.u32(p + 8), t = UNITS + edi, tt = m.u8(t + U.TYPE);
  const dx = (m.u16(0x30456 + tt * 4) + m.u16(t + U.X)) & 0xffff, bx = (m.u16(0x30458 + tt * 4) + m.u16(t + U.Y)) & 0xffff;
  const d0 = call(eng, 0x1c1dc, { ebp: esi, edx: dx, ebx: bx, eax: 0 }).eax; const d1 = call(eng, 0x1c205, { ebp: esi, edx: dx, ebx: bx, eax: d0 }).eax & 0xff;
  m.w8(p, (d1 + 0xa0) & 0xff); call(eng, 0x1b7b6, { eax: d0, ebp: esi, edi });
};
// ---- 0x1b277 / 0x1b2a9: задержанный урон [0x30b7a]/[0x30b7e] по цели через 8/12 тиков
F[0x1b277] = (eng, r) => { const m = eng.m, p = P + r.esi; m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) < 8) return;
  free(eng, r.esi); m.w8(0x31b68, 1); call(eng, 0x1eada, { eax: m.u8(0x30b7a), esi: m.u32(p + 4), edi: m.u32(p + 8) }); };
F[0x1b2a9] = (eng, r) => { const m = eng.m, p = P + r.esi; m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) < 0xc) return;
  free(eng, r.esi); m.w8(0x31b68, 1); call(eng, 0x1eada, { eax: m.u8(0x30b7e), esi: m.u32(p + 4), edi: m.u32(p + 8) }); };
// ---- 0x1b2db: маркер паралича: живёт, пока у цели (+8) есть +43 & 0xfc
F[0x1b2db] = (eng, r) => { const m = eng.m, p = P + r.esi; if ((m.u8(UNITS + m.u32(p + 8) + U.FX43) & 0xfc) === 0) return free(eng, r.esi); };
F[0x1b3de] = () => {};
// ---- 0x1b2ef: огонь 3×3 тайла вокруг точки, каждый чётный тик, по одному юниту на тайл; 0x8c тиков
F[0x1b2ef] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; m.w8(p + 1, m.u8(p + 1) + 1);
  if (m.u8(p + 1) >= 0x8c) { free(eng, esi); return { eax: lo8(r.eax, m.u8(0x30b8a)) }; }
  if (m.u8(p + 1) & 1) return;
  const ebp = m.u32(p + 4); const edx0 = (m.i16(p + 0xc) >> 5) - 1; let ebx = (m.i16(p + 0xe) >> 5) - 1;
  for (let row = 3; row > 0; row--, ebx++) {
    if ((ebx >>> 0) >= m.u32(G.mapW)) continue; const bxs = (ebx << 8) >>> 0;
    for (let col = 0, edx = edx0; col < 3; col++, edx++) {
      if ((edx >>> 0) >= m.u32(G.mapH)) continue; if ((m.u8(BI + ((edx + bxs) >>> 0)) & 0xfc) === 0) continue;
      for (let e = m.u32(G.unitHead); e !== 0; e = m.u32(UNITS + e + U.NEXT)) {
        const b = UNITS + e; if (m.u8(b + U.FLAGS5B) & 1) continue;
        if ((m.u16(b + U.X) >>> 5) !== (edx & 0xffff)) continue; if (((m.u16(b + U.Y) >>> 5) << 8 & 0xffff) !== (bxs & 0xffff)) continue;
        if (m.u8(b + U.TYPE) === 7) break;
        m.w8(0x31b68, 1); call(eng, 0x1eada, { eax: 1, esi: ebp, edi: e }); break;
      }
    }
  }
};
// ---- 0x1b3df: землетрясение: 0x14 тиков тряска камеры (0x31ae8/0x31aec), потом урон всем в области и удаление
F[0x1b3df] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; m.w8(p + 1, m.u8(p + 1) + 1);
  if (m.u8(p + 1) < 0x14) {
    const edx = RND(eng, 0xe); let ecx = (m.u32(p + 0xc) + m.i32(0x36fe0 + edx * 8)) | 0, ebx = (m.u32(p + 0x18) + m.i32(0x36fe4 + edx * 8)) | 0;
    if (ecx < 0) ecx = 0; else { const mx = ((m.u32(G.mapW) << 5) - m.u32(0x488c4)) >>> 0; if (mx < (ecx >>> 0)) ecx = mx; }
    if (ebx < 0) ebx = 0; else { const my = ((m.u32(G.mapH) << 5) - m.u32(0x488c8)) >>> 0; if (my < (ebx >>> 0)) ebx = my; }
    m.w32(0x31ae8, ecx); m.w32(0x31aec, ebx); return;
  }
  m.w32(0x31ae8, m.u32(p + 0xc)); m.w32(0x31aec, m.u32(p + 0x18));
  const dx = (m.u32(p + 0x10) - 0x140) | 0, bx = (m.u32(p + 0x14) - 0xf0) | 0, cx = dx + 0x280, bp = bx + 0x1e0;
  const s16 = v => (v << 16) >> 16; m.w32(0x36fd4, esi); const src = m.u32(p + 4);
  for (let e = m.u32(G.unitHead); e !== 0; e = m.u32(UNITS + e + U.NEXT)) {
    const b = UNITS + e; const x = m.i16(b + U.X), y = m.i16(b + U.Y);
    if (x < s16(dx) || x >= s16(cx) || y < s16(bx) || y >= s16(bp)) continue;
    if (m.u8(b + U.STATE) === 0x60 || (m.u8(b + U.FLAGS5B) & 1)) continue;
    const dl = (RND(eng, 0xf) + m.u8(0x30b92)) & 0xff; const hp = m.u8(b + U.HP); m.w8(b + U.HP, hp - dl);
    if (hp - dl > 0) continue; call(eng, 0x1ebdc, { esi: src, edi: e });
  }
  return free(eng, m.u32(0x36fd4));
};
// ---- 0x1b529: молния/чума по всем врагам рядом с точкой (через 0x1c135/0x1c13b), без обработки смерти
F[0x1b529] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) < 0xa) return;
  const eax = (m.u8(p) - 0x80) & 0xff; let edi = call(eng, 0x1c135, { esi, eax }).edi;
  if (!edi) return free(eng, esi);
  // границы области (0x1c13b пересчитывает их из координат снаряда при каждом вызове)
  const bx = (m.u16(p + 0xe) - 0x80) & 0xffe0, dx0 = (m.u16(p + 0xc) - 0x80) & 0xffe0, cx = (dx0 + 0x120) & 0xffff, bp = (bx + 0x120) & 0xffff;
  do {
    const nx = m.u32(UNITS + edi + U.NEXT); const dl = (RND(eng, 0x46) + m.u8(0x30b96)) & 0xff; const b = UNITS + edi;
    const hp = m.u8(b + U.HP); m.w8(b + U.HP, hp - dl);
    if (hp - dl <= 0) { m.w8(b + U.HP, 0); if (m.u8(b + U.STATE) !== 0x6f) m.w8(b + U.STATE, 0x6f); }
    edi = call(eng, 0x1c13b, { esi, edi: nx, eax, edx: dx0, ebx: bx, ecx: cx, ebp: bp }).edi;   // 0x1c13b сам пересчитывает границы из снаряда
  } while (edi);
  return free(eng, esi);
};
// ---- 0x1b58f: след разведки вдоль таблицы 0x37278 от цели (+8) — открывает туман игроку
F[0x1b58f] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; const n = (m.i16(p + 0x10) + 1) << 16 >> 16; m.w16(p + 0x10, n);
  if (n < 0) return; if ((n & 0xffff) >= 0x64) return free(eng, esi);
  m.w16(p + 0xc, m.u16(0x37278 + n * 4)); m.w16(p + 0xe, m.u16(0x3727a + n * 4));
  const t = UNITS + m.u32(p + 8); let edx = (m.u16(t + U.X) + m.u16(p + 0xc)) & 0xffff, ebx = (m.u16(t + U.Y) + m.u16(p + 0xe)) & 0xffff;
  if (m.u8(G.humanOwner) === m.u8(t + U.OWNER)) {
    edx >>>= 5; if (edx >= 0xff) return; ebx >>>= 5; if (ebx >= 0xaf) return; m.w8(BI + edx + (ebx << 8), m.u8(BI + edx + (ebx << 8)) | 1);
  }
  m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) >= 4) m.w8(p + 1, 0);
};
// ---- 0x1a4f1: открыть туман кольцом: ecx клеток из таблицы 0x305d0 вокруг тайла (edx,ebx)
F[0x1a4f1] = (eng, r) => {
  const m = eng.m; let ecx = r.ecx >>> 0; const edx = r.edx | 0, ebx = r.ebx | 0;
  for (let edi = 0; ecx > 0; ecx--, edi += 4) {
    const eax = (m.i16(0x305d0 + edi) + edx) | 0; if ((eax >>> 0) >= 0x100) continue;
    const ebp = (m.i16(0x305d2 + edi) + ebx) | 0; if ((ebp >>> 0) >= 0xb0) continue;
    const a = BI + ((ebp << 8) + eax); m.w8(a, m.u8(a) | 1);
  }
};
// ---- 0x1b637: летящий «глаз» разведки: движется по направлению (+2), открывает туман радиусом [0x3059c]
F[0x1b637] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) >= 0x64) return free(eng, esi);
  const d = m.u8(p + 2); m.w16(p + 0xc, m.u16(p + 0xc) + m.u16(0x37050 + d * 4)); m.w16(p + 0xe, m.u16(p + 0xe) + m.u16(0x37052 + d * 4));
  const u = UNITS + m.u32(p + 4); if (m.u8(G.humanOwner) !== m.u8(u + U.OWNER)) return;
  call(eng, 0x1a4f1, { ecx: m.u32(0x3059c), edx: m.u16(p + 0xc) >>> 5, ebx: m.u16(p + 0xe) >>> 5 });
};
// ---- 0x1b6a3: телепорт юнита (+4) в точку (+0x10,+0x12) на 4-м тике
F[0x1b6a3] = (eng, r) => {
  const m = eng.m, esi = r.esi, p = P + esi; m.w8(p + 1, m.u8(p + 1) + 1); if (m.u8(p + 1) >= 8) return free(eng, esi);
  if (m.u8(p + 1) !== 4) return;
  const u = m.u32(p + 4), b = UNITS + u; call(eng, 0x1a42c, { esi: u, edx: m.u16(b + U.X), ebx: m.u16(b + U.Y) });
  const spot = call(eng, 0x1ccdd, { esi: u, edx: m.u16(p + 0x10), ebx: m.u16(p + 0x12) });
  m.w16(b + U.X, spot.edx); m.w16(b + U.Y, spot.ebx); call(eng, 0x1a3db, { esi: u });
  if (m.u8(G.humanOwner) === m.u8(b + U.OWNER)) call(eng, 0x1a4cc, { esi: u });
  if (m.u8(b + 0x52) !== 0xff) return call(eng, 0x1a34c, { esi: u });
  m.w8(b + U.STATE, 0x2f);
};

// ======================= СТАДИЯ 5: состояния атаки/смерти, удаление мёртвых, кадры анимации =======================
// ---- 0x1a7cb: анимация удара: люди — удар на 8-м кадре, звери — на 6-м; выставляет спрайт (+2d)
F[0x1a7cb] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; const ty = m.u8(b + U.TYPE);
  if (ty < 9) {
    m.w8(b + U.ATKCTR, m.u8(b + U.ATKCTR) + 1);
    if (m.u8(b + U.ATKCTR) > 7) { m.w8(b + U.ATKCTR, 0); call(eng, 0x1e758, { esi, edi: m.u32(b + U.TARGET) }); call(eng, 0x1c72b, { esi }); }
    const ty1 = m.u8(b + U.TYPE);   // тип перечитывается ПОСЛЕ удара (убийство может превратить Commoner в Warrior)
    let bx = (m.u16(0x36e8c + ty1 * 2) + m.u16(0x36ecc + m.u16(b + U.DIR) * 2)) & 0xffff; const f = m.u8(b + U.ATKCTR);
    const ws = m.u8(b + U.WEAPON); let ranged = false;
    if (ws !== 0xff) { const it = m.u8(b + U.INV + ws); ranged = it >= 5 && it <= 7; }
    bx = (bx + m.u16((ranged ? 0x36ef0 : 0x36f00) + f * 2)) & 0xffff; m.w16(b + U.SPR, bx); return;
  }
  if (m.u8(b + U.ATKCTR) === 6) { call(eng, 0x1e758, { esi, edi: m.u32(b + U.TARGET) }); if (m.u8(b + U.TYPE) < 0xe) call(eng, 0x1c72b, { esi }); }
  m.w8(b + U.ATKCTR, m.u8(b + U.ATKCTR) + 1);
  if (m.u8(b + U.ATKCTR) > 7) { m.w8(b + U.ATKCTR, 2); if (m.u8(b + U.TYPE) === 0xd) { m.w8(b + U.STATE, 0x12); m.w8(b + U.ATKCTR, 8); return; } }
  const ty2 = m.u8(b + U.TYPE); const bx = (m.u16(0x36e8c + ty2 * 2) + m.u16(0x36ebc + m.u8(b + U.ATKCTR) * 2) + m.u16(0x36ede + m.u16(b + U.DIR) * 2)) & 0xffff; m.w16(b + U.SPR, bx);
};
// ---- 0x1a8dc: кадр смерти (таблицы 0x36f10/0x36f12 по типу, 0x36f70/0x36f72 по направлению)
F[0x1a8dc] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi; const ty = m.u8(b + U.TYPE); let cl = m.u8(b + U.ATKCTR) >> 5; const dir = m.u16(b + U.DIR);
  let bx; if (cl >= 2) { cl -= 2; bx = m.u16(0x36f12 + ty * 4) + m.u16(0x36f72 + dir * 4); } else bx = m.u16(0x36f10 + ty * 4) + m.u16(0x36f70 + dir * 4);
  m.w16(b + U.SPR, (bx + cl) & 0xffff);
};
// ---- 0x18bb3: состояния атаки 0x1f (старт), 0x10 (сближение), 0x11 (идём к тайлу цели), 0x12 (удар/перезарядка)
F[0x18bb3] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; let edi = m.u32(b + U.TARGET);
  const st = m.u8(b + U.STATE);
  const setDstToTarget = () => { const t = UNITS + edi; m.w16(b + U.DSTX, m.u16(t + U.X) & 0xffe0); m.w16(b + U.DSTY, m.u16(t + U.Y) & 0xffe0); };
  const start = () => { // 0x18dc4
    if (edi !== 0) { setDstToTarget(); m.w8(b + U.STATE, 0x11); return call(eng, 0x1db94, { esi }); }
    m.w8(b + U.STATE, 0x11); call(eng, 0x1db94, { esi }); return afterMove();
  };
  const afterMove = () => { // 0x18c17: пришли на тайл — ищем цель
    if ((m.u8(b + U.X) & 0x1f) || (m.u8(b + U.Y) & 0x1f)) return;
    m.w8(b + 0x44, m.u16(b + U.X) >>> 5); m.w8(b + 0x45, m.u16(b + U.Y) >>> 5);
    const bx = ((m.u8(b + U.SPD) >> 6) + 2) & 0xffff; const f = call(eng, 0x1a531, { esi, ebx: bx }).edi;
    if (f !== 0) return call(eng, 0x19fdf, { esi, edi: f });
  };
  const state12 = () => { m.w8(b + U.ATKCTR, m.u8(b + U.ATKCTR) - 1); if (m.u8(b + U.ATKCTR) === 0) return start(); return call(eng, 0x1a773, { esi }); };
  const state11 = () => { // 0x18d57
    if (st === 0x11) { if (call(eng, 0x1dc43, { esi }).eax & 0xff) return; edi = m.u32(b + U.TARGET); setDstToTarget(); return call(eng, 0x1db94, { esi }); }
    m.w8(b + U.STATE, 0x12); m.w8(b + U.ATKCTR, (0x10 - (m.u8(b + U.SPD) >> 4)) & 0xff);
  };
  if (st === 0x1f) return start();
  if (edi === 0) { // 0x18c09
    if ((call(eng, 0x1dc43, { esi }).eax & 0xff) === 0) return call(eng, 0x1a34c, { esi });
    return afterMove();
  }
  const ts = m.u8(UNITS + edi + U.STATE);
  if (ts === 0x60 || ts === 0x6f) { // цель мертва
    if (!(m.u8(b + U.X) & 0x1f) && !(m.u8(b + U.Y) & 0x1f)) return call(eng, 0x1a34c, { esi });
    if (st === 0x12) return state12(); return state11();
  }
  if (st === 0x12) return state12();
  if (call(eng, 0x1a051, { esi, edi }).eax & 0xff) { // не в зоне досягаемости
    const ty = m.u8(b + U.TYPE);
    if (ty >= 0xe && ty <= 0x17) { if (RND(eng, 0xc8) === 0x64) return call(eng, 0x1a34c, { esi }); }
    return state11();
  }
  if (st !== 0x10) {
    if (m.u8(b + U.TYPE) === 4 && m.u8(UNITS + edi + U.TYPE) >= 0x1a && m.u8(b + 0x59) === 0xe && m.u8(UNITS + edi + U.OWNER) !== m.u8(b + U.OWNER)) return call(eng, 0x1d9cd, { esi, edi });
    m.w8(b + U.STATE, 0x10); m.w8(b + U.ATKCTR, 2); call(eng, 0x1e0e0, { esi });
  }
  const t = UNITS + edi, tt = m.u8(t + U.TYPE); const dx = (m.u16(t + U.X) + m.u16(0x30456 + tt * 4)) & 0xffe0, bx = (m.u16(t + U.Y) + m.u16(0x30458 + tt * 4)) & 0xffe0;
  m.w16(b + U.DSTX, dx); m.w16(b + U.DSTY, bx);
  const d0 = call(eng, 0x1a95d, { esi, edx: dx, ebx: bx, eax: 0 }).eax; const d1 = call(eng, 0x1aa10, { esi, edx: dx, ebx: bx, eax: d0 }).eax;
  m.w16(b + U.DIR, d1 & 0xffff); return call(eng, 0x1a7cb, { esi });
};
// ---- 0x1aaf7: убрать юнит из активного списка в free-список (flags5b |= 1)
DUP[0x1aaf7] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; m.w8(b + U.FLAGS5B, m.u8(b + U.FLAGS5B) | 1);
  let edi = m.u32(b + U.PREV); const eax = m.u32(b + U.NEXT);
  if (edi === 0) m.w32(G.unitHead, eax); else m.w32(UNITS + edi + U.NEXT, eax);
  if (eax !== 0) m.w32(UNITS + eax + U.PREV, edi);
  edi = m.u32(0x31b70); m.w32(b + U.PREV, 0); m.w32(b + U.NEXT, edi); m.w32(0x31b70, esi);
  if (edi !== 0) m.w32(UNITS + edi + U.PREV, esi); return { eax, edi };
};
// ---- 0x1a62d: снять выделение с esi (UI): если выделен другой — 0x11c13, иначе 0x1a65d
F[0x1a62d] = (eng, r) => {
  const m = eng.m, edi = r.esi;
  for (let e = m.u32(G.unitHead); e !== 0; e = m.u32(UNITS + e + U.NEXT)) { if ((m.u8(UNITS + e + U.F07) & 0x80) && e !== edi) return call(eng, 0x11c13, { esi: e, edi }); }
  return call(eng, 0x1a65d, { esi: r.esi });
};
DUP[0x1a65d] = (eng, r) => { const m = eng.m; m.w32(0x31adc, 0); m.w16(0x31aca, 0); call(eng, 0x2696a, { esi: r.esi }); call(eng, 0x2693c, {}); call(eng, 0x2698e, {}); m.w32(0x3034c, 0); return call(eng, 0x291ce, { ebx: 0 }); };
// ---- 0x19693: смерть: 0x6f → 0x60 (труп), труп 0xc0 кадров (растёт +2c), потом удаление; предметы выпадают
F[0x19693] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi;
  if (m.u8(b + U.STATE) === 0x6f) {
    m.w8(b + U.STATE, 0x60); call(eng, 0x1e0e0, { esi }); m.w16(b + U.ANIM, RND(eng, 0x36));
    call(eng, 0x1a42c, { esi, edx: m.u8(b + 0x53) << 5, ebx: m.u8(b + 0x54) << 5 });
    if (m.u32(0x31adc) === esi) call(eng, 0x1a62d, { esi });
    m.w8(b + U.F07, 0);
    // 0x1975c: выложить инвентарь на землю
    call(eng, 0x1ff1c, { esi }); m.w8(b + U.ATKCTR, 0); m.w8(b + U.WEAPON, 0xff); m.w8(b + U.SHIELD, 0xff);
    const bp = m.u16(b + 0x53);
    for (let k = 0; k < 0xc; k++) {
      const it = m.u8(b + U.INV + k); if (it === 0) continue;
      const a = call(eng, 0x1ca54, {}); if (a.cf) break; const ip = 0xf4f34 + a.esi;
      m.w8(ip, it); m.w16(ip + 6, 1); if (it === 0x1e) m.w16(ip + 6, m.u16(b + U.FOOD)); m.w16(ip + 1, bp);
    }
    const ty = m.u8(b + U.TYPE); if (ty >= 0xe && ty < 0x18) m.w32(0x33358 + ty * 4, m.u32(0x33358 + ty * 4) + 1);
    return;
  }
  if (m.u8(b + U.TYPE) < 0xe) {
    if (m.u8(b + U.ATKCTR) >= 0xc0) {
      if (m.u8(b + U.F08) !== 0) { const sl = m.u8(b + U.SLOT); const a = m.u8(b + U.F08) === 1 ? 0x32b2c : 0x32b7c; m.w16(a + sl * 2, m.u16(a + sl * 2) + 1); }
      if ((m.u8(b + U.FLAGS5B) & 2) === 0) return call(eng, 0x1aaf7, { esi });
      m.w8(b + U.FLAGS5B, m.u8(b + U.FLAGS5B) | 1); return;
    }
  } else if (m.u8(b + U.ATKCTR) >= 0xc0) { m.w8(b + U.FLAGS5B, m.u8(b + U.FLAGS5B) | 1); return; }
  call(eng, 0x1a8dc, { esi }); m.w8(b + U.ATKCTR, m.u8(b + U.ATKCTR) + 1);
};
// ---- 0x18058: мёртвый юнит (flags5b&1): таймер возрождения/перезаказа ИИ по T_TYPE_TIMER, потом обработчик по типу
F[0x18058] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; const ow = m.u8(b + U.OWNER);
  if (ow !== 8 && m.u8(0x32aec + ow) === 0) return;
  if (m.u16(b + U.ANIM) === 0xffff) return;
  const ty = m.u8(b + U.TYPE); let eax = 0; if (ty >= 0xe && ty < 0x18) eax = m.u32(0x33358 + ty * 4);
  const ax = (eax + m.u16(0x36d82 + ty * 2)) & 0xffff; m.w16(b + U.ANIM, m.u16(b + U.ANIM) + 1);
  if (m.u16(b + U.ANIM) < ax) return;
  if (ty === 0) return; if (ty >= 0xe && ty < 0x18) return call(eng, 0x1cfcb, { esi }); if (ty === 0x18 || ty === 0x19) return call(eng, 0x1d12e, { esi }); return call(eng, 0x1ced8, { esi });
};
// ---- 0x1ced8: перезаказ копии погибшего юнита ИИ в своём здании (DAT_0001cfa3 по типу)
const HOME = [0,27,27,27,26,31,32,33,34,35,36,37,38,39,0,0,0,0,0,0,0,0,0,0,0,0,26,26,26,26,26,26,26,26,26,26,26,26,26,26]; // cs:0x1cfa3
F[0x1ced8] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; const ecx = m.u8(b + U.TYPE); const al = HOME[ecx] || 0; const slot16 = m.u16(b + U.SLOT);
  let edi = 0;
  for (let e = m.u32(G.unitHead); e !== 0; e = m.u32(UNITS + e + U.NEXT)) {
    const t = UNITS + e; if (m.u8(t + U.TYPE) !== al) continue; if (m.u16(t + U.SLOT) !== slot16) continue; if (m.u8(t + U.FLAGS5B) & 1) continue; if (m.u8(t + U.FLAGS50) & 7) continue; edi = e; break;
  }
  if (edi === 0) { m.w16(b + U.ANIM, 0); return; }
  const ebx = m.u8(b + U.OWNER); let edx = ((al - 0x1a) << 7) >>> 0; const price = (m.u8(edx + ecx * 4 + 0x30eac) * m.u8(ecx + (edx >>> 2) + 0x315ac)) & 0xffff;
  if (m.u32(G.food + ebx * 4) >= price) { m.w16(b + U.ANIM, 0xffff); m.w8(UNITS + edi + U.STATE, 0x7f); m.w32(UNITS + edi + U.TARGET, ecx); m.w32(UNITS + edi + 0x23, esi); return; }
  const sl = m.u8(b + U.SLOT); const ax = (m.u16(0x32b0c + sl * 2) - m.u16(0x32b2c + sl * 2)) & 0xffff;
  if (!(m.u16(0x32b0c + sl * 2) < m.u16(0x32b2c + sl * 2)) && ax >= 5) { m.w16(b + U.ANIM, 0); return; }
  call(eng, 0x15f1c, { eax: m.u8(b + U.OWNER), ebx: sl }); m.w16(b + U.ANIM, 0);
};
// ---- 0x1cfcb: возрождение дикого зверя у точки спавна (+59,+5a), случайная цель в прямоугольнике (+55..+58)
F[0x1cfcb] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; m.w16(b + U.ANIM, 0);
  const sp = call(eng, 0x1ccdd, { esi, edx: m.u8(b + 0x59) << 5, ebx: m.u8(b + 0x5a) << 5 }); m.w16(b + U.X, sp.edx); m.w16(b + U.Y, sp.ebx);
  let ebx = (m.u8(b + 0x56) + RND(eng, (m.u8(b + 0x58) - m.u8(b + 0x56)) & 0xff)) & 0xff; let edx = (RND(eng, (m.u8(b + 0x57) - m.u8(b + 0x55)) & 0xff) + m.u8(b + 0x55)) & 0xff;
  call(eng, 0x19fbf, { esi, edx: edx << 5, ebx: ebx << 5 });
  m.w8(b + U.STATE, 0x3f); m.w8(b + U.ATKCTR, 0);
  const cls = m.u32(0x30a9e + m.u8(b + U.TYPE) * 4); const s = 0x37654 + cls;
  m.w8(b + U.HPMAX, m.u8(s)); m.w8(b + U.HP, m.u8(s)); m.w8(b + U.MAG, m.u8(s + 2)); m.w8(b + U.MANA, m.u8(s + 2)); m.w8(b + U.ATK, m.u8(s + 3)); m.w8(b + U.DEF, m.u8(s + 4)); m.w8(b + U.SPD, m.u8(s + 5)); m.w16(b + U.FOOD, m.u16(s + 6));
  m.w8(b + U.WEAPON, 0xff); m.w8(b + U.SHIELD, 0xff); m.w32(b + 0x17, 0); m.w32(b + 0x1b, 0); m.w32(b + 0x1f, 0); m.w32(b + 0x23, 0); m.w32(b + 0x21, 0x1e); m.w32(b + U.XP, 0);
  m.w8(b + U.FX43, 0); m.w8(b + U.FLAGS50, 0); m.w8(b + U.FLAGS5B, m.u8(b + U.FLAGS5B) & 0xfe);
  call(eng, 0x1a773, { esi }); return call(eng, 0x1a3db, { esi, edx: m.u16(b + U.X), ebx: m.u16(b + U.Y) });
};
// ---- 0x1d12e: отрастание ядовитого растения на месте
F[0x1d12e] = (eng, r) => {
  const m = eng.m, esi = r.esi, b = UNITS + esi; const sp = call(eng, 0x1ccdd, { esi, edx: m.u16(b + U.X), ebx: m.u16(b + U.Y) });
  m.w16(b + U.X, sp.edx); m.w16(b + U.Y, sp.ebx); m.w8(b + 0x44, (sp.edx & 0xffff) >>> 5); m.w8(b + 0x45, (sp.ebx & 0xffff) >>> 5);
  m.w16(b + U.ANIM, 0); m.w8(b + U.STATE, 0x10); m.w8(b + U.ATKCTR, 0); m.w16(b + U.SPR, m.u8(b + U.TYPE) === 0x18 ? 0x8ed : 0x8f5);
  m.w8(b + U.HP, m.u8(b + U.HPMAX)); m.w32(b + U.XP, 0); m.w8(b + U.FX43, 0); m.w8(b + U.FLAGS5B, m.u8(b + U.FLAGS5B) & 0xfe);
  return call(eng, 0x1a3db, { esi, edx: m.u16(b + U.X), ebx: m.u16(b + U.Y) });
};

// ---- 0x1dac2: проштамповать владельца здания esi во все его тайлы (таблица 0x3176c/0x31770 по типу)
F[0x1dac2] = (eng, r) => {
  const m = eng.m, b = UNITS + r.esi; const k = m.u8(b + U.TYPE) - 0x1a; let ebp = m.u32(0x31770 + k * 8); let ecx = m.u32(0x3176c + k * 8);
  const al = ((m.u8(b + U.OWNER) + 1) << 2) & 0xff;
  for (; ecx > 0; ecx--, ebp += 8) {
    const gi = (((m.u16(b + U.Y) + m.u32(ebp + 4)) >>> 5) << 8) + ((m.u16(b + U.X) + m.u32(ebp)) >>> 5);
    m.w8(BI + gi, (m.u8(BI + gi) & 3) | al);
  }
};
// ---- 0x1d9cd: конструктор esi захватывает чужое здание edi (склад делит еду), конструктор исчезает
F[0x1d9cd] = (eng, r) => {
  const m = eng.m, esi = r.esi, edi = r.edi, b = UNITS + esi, t = UNITS + edi;
  call(eng, 0x1a42c, { esi, edx: m.u8(b + 0x53) << 5, ebx: m.u8(b + 0x54) << 5 });
  if (m.u8(t + U.TYPE) === 0x1e) {
    const ob = m.u8(t + U.OWNER); const stor = m.u32(0x31c48 + ob * 4); const eax = stor ? Math.floor(m.u32(G.food + ob * 4) / stor) >>> 0 : 0;
    m.w32(G.food + ob * 4, m.u32(G.food + ob * 4) - eax); m.w32(0x31c48 + ob * 4, stor - 1);
    const os = m.u8(b + U.OWNER); m.w32(0x31c48 + os * 4, m.u32(0x31c48 + os * 4) + 1); m.w32(G.food + os * 4, m.u32(G.food + os * 4) + eax);
  }
  m.w8(t + U.OWNER, m.u8(b + U.OWNER));
  if (m.u8(t + U.FLAGS50) & 1) {
    m.w8(t + U.FLAGS50, m.u8(t + U.FLAGS50) & 0xfa);
    if (m.u8(t + U.TYPE) !== 0x1c && m.u8(t + U.TYPE) !== 0x1d) { const tr = m.u32(t + 0x23); m.w16(UNITS + tr + U.ANIM, 0); m.w32(t + 0x23, 0); }
  }
  call(eng, 0x1dac2, { esi: edi });
  if (m.u32(0x31adc) === esi) { m.w32(0x31adc, 0); call(eng, 0x2673d, { esi: 0 }); }
  else if (m.u32(0x31adc) === edi) call(eng, 0x26a5d, { esi });
  const al = m.u8(b + U.OWNER); call(eng, 0x1aaf7, { esi });
  if (m.u8(G.humanOwner) === al) { m.w32(0x41914, 0x419e5); m.w32(0x41918, 0x41938); m.w16(0x4191e, 0x24); }
};
