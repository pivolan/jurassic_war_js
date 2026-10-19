// Функции старта миссии (порт FUN_00015070, 15127, 1545a, 15da1, 244c3, 26521, 24503). Владелец: координатор.
const DUP = {}; // дубли функций, живут в другом модуле (см. dupes.mjs)
import { F, call } from '../fn.js'; import { G, U, UNITS, BI, MO } from '../mem.js'; import { Archive } from '../archive.js';
const A = (m, a, v) => m.w8(a, m.u8(a) + v);   // add byte
F[0x15070] = (eng) => { // очистка сеток + повторная простановка юнитов
  const m = eng.m; for (let k = 0; k < 0xb000; k++) { m.b[BI + k] = 0; m.b[MO + k] = 0; }
  for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue; const st = m.u8(UNITS + i + U.STATE); if (st === 0x60 || st === 0x6f) continue;
    if (m.u8(UNITS + i + U.TYPE) < 0x1a) call(eng, 0x1a3db, { esi: i, edx: m.u8(UNITS + i + 0x53) << 5, ebx: m.u8(UNITS + i + 0x54) << 5 });
    else call(eng, 0x1dac2, { esi: i });
    let al = 0; const w = m.u8(UNITS + i + U.WEAPON); if (w !== 0xff) al = m.u8(UNITS + i + U.INV + w); m.w8(UNITS + i + U.F09, al);
    al = 0; const s = m.u8(UNITS + i + U.SHIELD); if (s !== 0xff) al = m.u8(UNITS + i + U.INV + s); m.w8(UNITS + i + U.F0A, al);
  }
};
F[0x15127] = (eng) => { const m = eng.m; for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(UNITS + i + U.NEXT)) { if (m.u8(UNITS + i + U.TYPE) < 0xe) { m.w32(UNITS + i + U.SKILLS, 0x3f); call(eng, 0x1f475, { esi: i }); } } };
F[0x1545a] = (eng) => { // модификатор сложности
  const m = eng.m; const d = m.u8(G.difficulty); if (d === 1) return; const head = m.u32(G.unitHead); if (head === 0) return;
  const al = m.u8(G.humanOwner); const ah = m.u8(0x303b2 + d);
  if (d < 1) { // easy: свои +15, чужие −10 (мин 5 / 0), +5000 еды человеку
    for (let i = head; i !== 0; i = m.u32(UNITS + i + U.NEXT)) {
      if (m.u8(UNITS + i + U.OWNER) === al && m.u8(UNITS + i + U.TYPE) < 0x1a) { for (const f of [U.HPMAX, U.HP, U.ATK, U.DEF, U.MAG, U.MANA, U.SPD]) A(m, UNITS + i + f, ah); call(eng, 0x1f475, { esi: i }); }
      else { const dec = (off, floor) => { const v = m.u8(UNITS + i + off) - 10; m.w8(UNITS + i + off, v < 0 ? floor : v); };
        dec(U.HPMAX, 5); m.w8(UNITS + i + U.HP, m.u8(UNITS + i + U.HPMAX)); dec(U.ATK, 5); dec(U.DEF, 5); dec(U.MAG, 0); m.w8(UNITS + i + U.MANA, m.u8(UNITS + i + U.MAG)); }
    }
    const h = m.u16(G.humanOwner); m.w32(G.food + h * 4, m.u32(G.food + h * 4) + 0x1388);
  } else { // hard: чужим +15, врагам +20000 еды
    for (let i = head; i !== 0; i = m.u32(UNITS + i + U.NEXT)) {
      if (m.u8(UNITS + i + U.OWNER) !== al && m.u8(UNITS + i + U.TYPE) < 0x1a) { for (const f of [U.HPMAX, U.HP, U.ATK, U.DEF, U.MAG, U.MANA, U.SPD]) A(m, UNITS + i + f, ah); call(eng, 0x1f475, { esi: i }); }
    }
    const h = m.u16(G.humanOwner) & 0xff; for (let s = 0; s < 8; s++) if (m.u8(0x32ae4 + s) !== h) m.w32(G.food + s * 4, m.u32(G.food + s * 4) + 0x4e20);
  }
};
DUP[0x15da1] = (eng) => { // инициализация ИИ по слотам
  const m = eng.m; m.w32(G.rngN, 4);
  for (let b = 0; b < 8; b++) {
    m.w8(0x32afc + b, 1); const dl = call(eng, 0x204a6, {}).edx & 0xff; m.w8(0x32af4 + b, dl);
    const edi = (b << 5) + m.u8(0x32afc + b); m.w8(0x32b04 + b, m.u8(0x32d2c + edi + dl * 8));
    if (m.u8(0x32aec + b) !== 0) { m.w8(0x32aec + b, 1); const e = b * 10; m.w8(0x32bcc + e, 8); m.w8(0x32bcd + e, 0); m.w8(0x32c1c + e, 8); m.w8(0x32c1d + e, 0);
      let v = m.u16(0x32c7c + b * 2) + 0xc8; const d = m.u8(G.difficulty); if (d !== 2) { v += 0x50; if (d !== 1) v += 0x50; } m.w16(0x32c7c + b * 2, v); }
  }
};
F[0x244c3] = (eng) => { const m = eng.m; for (let k = 0; k < 0xb000; k++) m.b[BI + k] &= 0xfe;
  for (let i = m.u32(G.unitHead); i !== 0; i = m.u32(UNITS + i + U.NEXT)) if (!(m.u8(UNITS + i + U.FLAGS5B) & 1)) call(eng, 0x1a3ba, { esi: i, edx: m.u16(UNITS + i + U.X), ebx: m.u16(UNITS + i + U.Y) }); };
F[0x26521] = (eng) => { // вьюпорт (FUN_00026521)
  const m = eng.m; m.w32(0x488c8, m.u32(0x31af4) * 0x20);
  const sub = () => { m.w32(0x31b00, (m.u32(G.mapW) - m.u32(0x31af0)) << 5); m.w32(0x31b04, (m.u32(G.mapH) - m.u32(0x31af4)) << 5); };
  if (m.u8(0x31ae0) & 1) { m.w32(0x31af0, 0x10); m.w32(0x488c4, 0x200); m.w32(0x46ffc, 0x1ff); sub(); call(eng, 0x24564); m.w32(0x424d0, 0x1cc); m.w32(0x424d4, 3); return; }
  m.w32(0x31af0, 0x14); m.w32(0x488c4, 0x280); m.w32(0x46ffc, 0x27f); sub();
  const e = (m.u32(0x31ae8) >>> 5) + 0x14; if (m.u32(G.mapW) < e) m.w32(0x31ae8, (m.u32(G.mapW) - 0x14) << 5);
  if (m.u8(0x31ae0) & 8) { call(eng, 0x24564); m.w32(0x424d0, m.u32(0x30388) - 0x34); m.w32(0x424d4, m.u32(0x3038c) - 1); } else { m.w32(0x424d0, 0x24c); m.w32(0x424d4, 4); }
};
F[0x24503] = (eng) => { const m = eng.m; for (let k = 0; k < 0x24f; k++) m.b[0x3e8aa + k] = m.b[0x49b2c + 0x200 + k * 0x400]; };

F[0x10713] = (eng) => { // перезагрузка палитры: _PWAR01.TRC запись 4 (MAIN.PAL) -> 0x44980
  if (!eng.files || !eng.files['_PWAR01.TRC']) return; const a = new (eng.Archive || Archive)(eng.files['_PWAR01.TRC']); eng.m.b.set(a.data(4).subarray(0, 768), 0x44980);
};
F[0x24564] = (eng) => { // таблицы кламп-прокрутки 0x3e6f0/0x3e7f0 и прямоугольник мини-карты (FUN_00024564)
  const m = eng.m; const W = m.u32(G.mapW), H = m.u32(G.mapH); const big = !(m.u8(0x31ae0) & 4);
  if (big) {
    // X: ofs 0x34, хвост 0x44 (ebx = W-0x44, если <0 → 0), al = W-0x78 или 0
    for (let b = 0; b < W; b++) m.w8(0x3e6f0 + b, b - 0x34); for (let b = 0; b < 0x34; b++) m.w8(0x3e6f0 + b, 0);
    { let bx = W - 0x44; if (W < 0x44) bx = 0; let al = W - 0x78; if (W < 0x78) al = 0; for (let k = 0; k < 0x44; k++) m.w8(0x3e6f0 + bx + k, al); }
    for (let b = 0; b < H; b++) m.w8(0x3e7f0 + b, b - 0x35); for (let b = 0; b < 0x35; b++) m.w8(0x3e7f0 + b, 0);
    { let bx = H - 0x43; if (H < 0x43) bx = 0; let al = H - 0x78; if (H < 0x78) al = 0; for (let k = 0; k < 0x43; k++) m.w8(0x3e7f0 + bx + k, al); }
    m.w32(0x30388, 0x204); m.w32(0x30390, 0x78);
    if (W < 0x78) { m.w32(0x30390, W); m.w32(0x30388, (m.u8(0x31ae0) & 1) ? (((0x78 - W) >>> 1) + 0x204) : (0x27c - W)); }
    m.w32(0x3038c, 4); m.w32(0x30394, 0x78);
    if (H < 0x78) { m.w32(0x30394, H); if (m.u8(0x31ae0) & 1) m.w32(0x3038c, ((0x78 - H) >>> 1) + 4); }
  } else {
    for (let b = 0; b < W; b++) m.w8(0x3e6f0 + b, b - 0x16); for (let b = 0; b < 0x16; b++) m.w8(0x3e6f0 + b, 0);
    { const bx = (W - 0x26) | 0; let al = W - 0x3c; if (W < 0x3c) al = 0; for (let k = 0; k < 0x26; k++) m.w8(0x3e6f0 + bx + k, al); }
    for (let b = 0; b < H; b++) m.w8(0x3e7f0 + b, b - 0x16); for (let b = 0; b < 0x16; b++) m.w8(0x3e7f0 + b, 0);
    { const bx = (H - 0x25) | 0; let al = (H & 0xff) - 0x3c; if ((H & 0xff) < 0x3c) al = 0; for (let k = 0; k < 0x25; k++) m.w8(0x3e7f0 + bx + k, al); }
    m.w32(0x30388, 0x204); m.w32(0x30390, 0x78);
    if (W < 0x3c) { m.w32(0x30390, W << 1); m.w32(0x30388, (m.u8(0x31ae0) & 1) ? (((0x78 - W - W) >>> 1) + 0x204) : (0x27c - (W << 1))); }
    m.w32(0x3038c, 4); m.w32(0x30394, 0x78);
    if (H < 0x3c) { m.w32(0x30394, H << 1); if (m.u8(0x31ae0) & 1) m.w32(0x3038c, ((0x78 - H - H) >>> 1) + 4); }
  }
  m.w32(0x30398, m.u32(0x30388) + m.u32(0x30390)); m.w32(0x3039c, m.u32(0x3038c) + m.u32(0x30394));
};
