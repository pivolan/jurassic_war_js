// Ввод и UI-логика (порт): мышь 0x1133c, прокрутка 0x12acd, горячие клавиши 0x10d44, курсор 0x12be6, выделение, панель.
// Отрисовка (0x1f815/0x1f720/0x1f79f/0x29c38/0x23eb1/0x299b4/0x2995f...) вызывается через opt(): если рендер не портирован — пропускается.
import { F, call } from '../fn.js'; import { G, U, UNITS, BI, MO, BG, ITEMS } from '../mem.js';
/** Позвать функцию оригинала, если она портирована; иначе тихо ничего. Так экраны, до которых
 *  руки не дошли, просто не открываются, а не роняют игру. */
const opt = (eng, a, regs) => (F[a] ? F[a](eng, regs || {}) : {}) || {};
/** Поставить заглушку по адресу, если настоящей реализации ещё нет. */
const stub = (a, f) => { if (!F[a]) F[a] = f; };
// ---------- адреса
const M = { ring: 0x450e4, wr: 0x450dc, rd: 0x450e0, ev: 0x450c8, evX: 0x450cc, evY: 0x450d0, evMX: 0x450d4, evMY: 0x450d8,
  x: 0x45098, y: 0x4509c, mx: 0x450a0, my: 0x450a4, btn: 0x450a8, moved: 0x450ac, lastMask: 0x45094, savedBx: 0x46264, drawing: 0x45090, hidden: 0x45091 };
const K = { held: 0x44768, edge: 0x44708, ring: 0x447d0, wr: 0x447c8, rd: 0x447cc, lshift: 0x44792, rshift: 0x4479e, ctrl: 0x44785, alt: 0x447a0 };
const UI = { camX: 0x31ae8, camY: 0x31aec, camMaxX: 0x31b00, camMaxY: 0x31b04, viewW: 0x31af0, viewH: 0x31af4, mapFlags: 0x31ae0, page: 0x31ae4,
  sel: 0x31adc, mode: 0x31aca, cursor: 0x3034c, edge: 0x3037c, drag: 0x3034a, minimapDrag: 0x33864, mmX0: 0x30388, mmY0: 0x3038c, mmX1: 0x30398, mmY1: 0x3039c,
  mmOfsX: 0x31b2c, mmOfsY: 0x31b30, panelX: 0x488c4, human: 0x31b64, cornerA: 0x303ac, cornerB: 0x303ad, hover: 0x30384, hoverShown: 0x30380,
  cmdBtn: 0x31b34, invBtn: 0x31b3d, bldBtn: 0x31b49, statText: 0x41914, statText2: 0x41918, statLen: 0x4191e };
// ---------- драйвер мыши / клавиатуры (кольца)
F[0x2929d] = (eng) => ({ zf: eng.m.u32(M.wr) === eng.m.u32(M.rd) ? 1 : 0 });
F[0x292ac] = (eng) => { const m = eng.m; const b = m.u32(M.rd); if (m.u32(M.wr) === b) return; // оригинал ждёт события; у нас — вызывать только при наличии
  m.w32(M.ev, m.u32(M.ring + b)); m.w32(M.evX, m.u32(M.ring + b + 4)); m.w32(M.evY, m.u32(M.ring + b + 8)); m.w32(M.evMX, m.u32(M.ring + b + 12)); m.w32(M.evMY, m.u32(M.ring + b + 16));
  let n = b + 0x14; if (n >= 0x280) n = 0; m.w32(M.rd, n); };
F[0x29477] = (eng, r) => { // push события: ax=маска, ebx=кнопки, ecx=X, edx=Y, esi/edi=микки
  const m = eng.m; m.w32(M.savedBx, r.ebx >>> 0); let b = m.u32(M.wr) + 0x14; if (b >= 0x280) b = 0;
  if (m.u32(M.rd) === b) return { ebx: r.ebx }; const w = m.u32(M.wr); m.w32(M.wr, b);
  m.w16(M.ring + w, r.eax & 0xffff); m.w32(M.ring + w + 4, r.ecx >>> 0); m.w32(M.ring + w + 8, r.edx >>> 0); m.w32(M.ring + w + 12, r.esi >>> 0); m.w32(M.ring + w + 16, r.edi >>> 0);
  m.w16(M.ring + w + 2, r.ebx & 0xffff); return { ebx: r.ebx }; };
F[0x28c9d] = (eng) => { const m = eng.m; for (let i = 0; i < 0x60; i++) { m.w8(K.edge + i, 0); m.w8(K.held + i, 0); } m.w32(K.wr, 0); m.w32(K.rd, 0); };
F[0x28cce] = (eng) => ({ zf: eng.m.u32(K.wr) === eng.m.u32(K.rd) ? 1 : 0 });
F[0x28cdd] = (eng) => { const m = eng.m; const t = m.u32(K.rd); if (m.u32(K.wr) === t) return { eax: 0 }; const al = m.u8(K.ring + t); let n = t + 1; if (n >= 0x20) n = 0; m.w32(K.rd, n); return { eax: al }; };
F[0x28d11] = (eng) => { const m = eng.m; const al = F[0x28cdd](eng).eax & 0xff; let tab = 0x447f0;
  if (m.u8(K.lshift) === 1) tab = 0x44852; else if (m.u8(K.rshift) === 1) tab = 0x44852; else if (m.u8(K.alt) !== 1) tab = 0x448b4; else if (m.u8(K.ctrl) === 1) tab = 0x44916;
  return { eax: al | (m.u8(tab + al) << 8) }; };
// драйверные заглушки (аппаратура): диапазон мыши, перерисовка курсора
stub(0x29a3e, () => {}); stub(0x29a45, () => {}); stub(0x2995f, () => {}); stub(0x29a30, (eng) => ({ ebx: eng.m.u32(M.btn), ecx: eng.m.u32(M.x) << 2, edx: eng.m.u32(M.y) }));
F[0x291ce] = (eng, r) => { // смена формы курсора (ebx = id); рисование через 0x2995f (опц.)
  const m = eng.m; const id = r.ebx >>> 0; if (m.u32(0x46270) === id) return;
  m.w8(M.drawing, m.u8(M.drawing) + 1); m.w32(0x46280, m.u32(0x46278)); m.w32(0x46284, m.u32(0x4627c)); opt(eng, 0x2995f);
  m.w32(0x46270, id); const p = m.u32(0x46290 + id * 4); m.w32(0x46274, p); m.w32(0x46278, (m.u32(M.x) - m.u32(p)) >>> 0); m.w32(0x4627c, (m.u32(M.y) - m.u32(p + 4)) >>> 0);
  opt(eng, 0x2995f); m.w8(M.drawing, m.u8(M.drawing) - 1); };
/** Сменить форму курсора (только когда она правда меняется — иначе лишний перерисов). */
const setCursor = (eng, id) => { if (eng.m.u32(UI.cursor) !== id) { eng.m.w32(UI.cursor, id); F[0x291ce](eng, { ebx: id }); } };
// ---------- звуковые обёртки (при выключенном звуке 0x30c4c — пусто; иначе rand+модуль)
// Ниже — поведение оригинала: голос выбирается общим ГСЧ 0x204a6. В браузере эти два
// обработчика переопределены (web/game.js) и берут вариант из своего генератора — иначе поток
// случайных чисел зависит от звука и от кликов игрока, см. ROADMAP §7a. Здесь ветка оставлена
// как документация оригинала; в эталонных трассах звук выключен, так что она в них не работает.
const sndOn = (eng) => eng.m.u8(0x30c4c) === 1;
F[0x1fd1d] = (eng) => { if (sndOn(eng)) opt(eng, 0x30c46); };
F[0x1fd54] = F[0x1fd1d]; F[0x1ff12] = () => {};
F[0x1fdc2] = (eng, r) => { const m = eng.m; if (!sndOn(eng)) return; const t = m.u32(0x46c) & ~0xf; if (m.u32(0x3886c) === t) return; m.w32(0x3886c, t);
  const ty = m.u8(UNITS + r.esi + U.TYPE); if (ty >= 0x1a) { if (!(m.u8(UNITS + r.esi + 0x50) & 2)) { if (m.u8(UNITS + r.esi + U.HP) >= (m.u8(UNITS + r.esi + U.HPMAX) >> 1)) return; } }
  else { m.w32(G.rngN, m.u32(0x38bec + ty * 8)); call(eng, 0x204a6); } opt(eng, 0x30c46); };
F[0x1fe5e] = (eng, r) => { const m = eng.m; if (!sndOn(eng)) return; const ty = m.u8(UNITS + r.esi + U.TYPE); if (ty >= 0xe) return; m.w32(G.rngN, m.u32(0x38d2c + ty * 8)); call(eng, 0x204a6); opt(eng, 0x30c46); };
F[0x1feb7] = (eng, r) => { const m = eng.m; if (!sndOn(eng)) return; const t = m.u32(0x46c) & ~0xf; if (m.u32(0x3886c) === t) return; m.w32(0x3886c, t); opt(eng, 0x30c46); };
// ---------- камера
F[0x1113c] = (eng, r) => { // центрировать на юните esi
  const m = eng.m; const i = r.esi; let eax = m.u16(UNITS + i + U.X) & ~0x1f; let ebx = m.u32(UI.panelX) >>> 1; eax -= ebx; if (eax < 0) eax = 0; eax >>>= 5; ebx >>>= 4;
  if (m.u32(G.mapW) < ebx + eax) eax = m.u32(G.mapW) - ebx; m.w32(UI.camX, eax << 5);
  eax = m.u16(UNITS + i + U.Y) & ~0x1f; ebx = 0xf0; eax -= ebx; if (eax < 0) eax = 0; eax >>>= 5; ebx >>>= 4;
  if (m.u32(G.mapH) < ebx + eax) eax = m.u32(G.mapH) - ebx; m.w32(UI.camY, eax << 5); };
F[0x12a4e] = (eng) => { // прыжок экрана по клику на мини-карте (0x450cc/0x450d0)
  const m = eng.m; let eax = (m.u32(M.evX) - ΔП(m) - m.u32(UI.mmX0)) >>> 0; if (m.u8(UI.mapFlags) & 4) eax >>>= 1; let ebx = m.u32(UI.viewW) >>> 1; eax = (eax - ebx) | 0; if (eax < 0) eax = 0;
  eax = (eax + m.u32(UI.mmOfsX)) << 5; if (m.u32(UI.camMaxX) < (eax >>> 0)) eax = m.u32(UI.camMaxX); m.w32(UI.camX, eax);
  eax = (m.u32(M.evY) - m.u32(UI.mmY0)) >>> 0; if (m.u8(UI.mapFlags) & 4) eax >>>= 1; ebx = m.u32(UI.viewH) >>> 1; eax = (eax - ebx) | 0; if (eax < 0) eax = 0;
  eax = (eax + m.u32(UI.mmOfsY)) << 5; if (m.u32(UI.camMaxY) < (eax >>> 0)) eax = m.u32(UI.camMaxY); m.w32(UI.camY, eax); };
// прокрутка по краю/стрелкам: обработчики 0x3390c[bits] (0x13318 = ничего)
const redraw = (eng) => { opt(eng, 0x23eb1); opt(eng, 0x299b4); };
// Нижний предел камеры: в оригинале окно карты всегда было 15 клеток в высоту и предел был зашит
// как (высота карты − 15). В широком кадре (js/render/wide.js) окно выше, и по старому пределу
// камера уезжала за нижний край карты — под окном оставалась чёрная полоса. Берём высоту окна
// из 0x31af4, как её задаёт сам кадр.
const пределY = (m) => (m.u32(G.mapH) - (m.u32(UI.viewH) || 0xf)) << 5;
const scrollFns = {
  0x13318: () => 0,
  0x24bca: (eng) => { const m = eng.m; if (m.i32(UI.camX) <= 0) return 0; m.w32(UI.camX, m.u32(UI.camX) - 0x20); redraw(eng); return 1; },
  0x24be9: (eng) => { const m = eng.m; const lim = (m.u32(G.mapW) - m.u32(UI.viewW)) << 5; if (m.i32(UI.camX) >= lim) return 0; m.w32(UI.camX, m.u32(UI.camX) + 0x20); redraw(eng); return 1; },
  0x24c16: (eng) => { const m = eng.m; if (m.i32(UI.camY) <= 0) return 0; m.w32(UI.camY, m.u32(UI.camY) - 0x20); redraw(eng); return 1; },
  0x24c35: (eng) => { const m = eng.m; const lim = пределY(m); if (m.i32(UI.camY) >= lim) return 0; m.w32(UI.camY, m.u32(UI.camY) + 0x20); redraw(eng); return 1; },
  0x24c5f: (eng) => { const m = eng.m; let al = 0; if (m.i32(UI.camY) > 0) { m.w32(UI.camY, m.u32(UI.camY) - 0x20); al += 1; } const lim = (m.u32(G.mapW) - m.u32(UI.viewW)) << 5; if (m.i32(UI.camX) < lim) { m.w32(UI.camX, m.u32(UI.camX) + 0x20); al += 2; } if (!al) return 0; redraw(eng); return 1; },
  0x24ca4: (eng) => { const m = eng.m; let al = 0; const limY = пределY(m); if (m.i32(UI.camY) < limY) { m.w32(UI.camY, m.u32(UI.camY) + 0x20); al += 1; } const lim = (m.u32(G.mapW) - m.u32(UI.viewW)) << 5; if (m.i32(UI.camX) < lim) { m.w32(UI.camX, m.u32(UI.camX) + 0x20); al += 2; } if (!al) return 0; redraw(eng); return 1; },
  0x24cf4: (eng) => { const m = eng.m; let al = 0; if (m.i32(UI.camY) > 0) { m.w32(UI.camY, m.u32(UI.camY) - 0x20); al += 1; } if (m.i32(UI.camX) > 0) { m.w32(UI.camX, m.u32(UI.camX) - 0x20); al += 2; } if (!al) return 0; redraw(eng); return 1; },
  0x24d2b: (eng) => { const m = eng.m; let al = 0; const limY = пределY(m); if (m.i32(UI.camY) < limY) { m.w32(UI.camY, m.u32(UI.camY) + 0x20); al += 1; } if (m.i32(UI.camX) > 0) { m.w32(UI.camX, m.u32(UI.camX) - 0x20); al += 2; } if (!al) return 0; redraw(eng); return 1; },
};
for (const [a, f] of Object.entries(scrollFns)) F[+a] = (eng) => ({ eax: f(eng) });
/** Прокрутка карты по маске направлений: таблица 0x3390c переводит биты в функцию сдвига. */
const scrollBy = (eng, bits) => { const h = eng.m.u32(0x3390c + bits * 4); const f = scrollFns[h]; if (!f) throw new Error('scroll handler 0x' + h.toString(16)); return f(eng); };
F[0x12acd] = (eng) => { // FUN_00012acd: прокрутка (правая/левая кнопка у края, стрелки)
  const m = eng.m; const btn = m.u32(M.btn) & 3;
  const keysum = (m.u8(0x447b0) + m.u8(0x447b8) + m.u8(0x447b3) + m.u8(0x447b5)) & 0xff;
  const stamp = () => m.w16(0x30342, m.u16(0x46c));
  if (btn || keysum) {
    if (m.u16(0x3009a) !== 1) { const ax = m.u16(0x46c); if (m.u16(0x33860) === ax) return; m.w16(0x33860, ax); const c = (m.u16(0x3033e) - 1) & 0xffff; m.w16(0x3033e, c); if (c !== 0) return; m.w16(0x3033e, (m.u16(0x3009a) - 1) & 0xffff); }
    if (btn) { if (scrollBy(eng, m.u32(UI.edge)) & 0xff) { stamp(); return; } }
    let bx = m.u8(0x447b3); bx = (bx << 1) & 0xffff; bx = (bx + m.u8(0x447b8)) & 0xffff; bx = (bx << 1) & 0xffff; bx = (bx + m.u8(0x447b5)) & 0xffff; bx = (bx << 1) & 0xffff; bx = (bx + m.u8(0x447b0)) & 0xffff;
    if (scrollBy(eng, bx) & 0xff) stamp(); return;
  }
  if (m.u16(0x3009c) === 6) return;
  if (m.u16(0x3009c) !== 1) { const ax = m.u16(0x46c); if (m.u16(0x33862) === ax) return; m.w16(0x33862, ax); const c = (m.u16(0x30340) - 1) & 0xffff; m.w16(0x30340, c); if (c !== 0) return; m.w16(0x30340, (m.u16(0x3009c) - 1) & 0xffff); }
  if (scrollBy(eng, m.u32(UI.edge)) & 0xff) stamp(); };
// ---------- мышь: диспетчер 0x1133c
const own = (eng, i) => eng.m.u8(UNITS + i + U.OWNER) === eng.m.u8(UI.human);
/** Мини-карта сейчас на панели (а не страница здания или инвентарь). */
const inMinimapMode = (m) => (m.u8(UI.mapFlags) & 1) || ((m.u8(UI.mapFlags) & 8) && (m.u8(UI.mapFlags) & 2));
/** Точка экрана попала в прямоугольник мини-карты. */
const inMinimap = (m, x0, y) => { const x = x0 - ΔП(m);   // мини-карта живёт в панели, координаты её же
  return y < m.u32(UI.mmY1) && y >= m.u32(UI.mmY0) && x >= m.u32(UI.mmX0) && x < m.u32(UI.mmX1); };
F[0x1133c] = (eng) => { const m = eng.m;
  globalThis.__сч13 = 0;
  for (;;) { if (++globalThis.__сч13 > 3e6) throw new Error("ЦИКЛ input.js:95");
    if (m.u32(M.wr) === m.u32(M.rd)) { if (m.u32(M.moved) === 0) return; m.w32(M.moved, 0); F[0x113a5](eng); continue; }
    F[0x292ac](eng); const ev = m.u16(M.ev);
    if (ev & 2) F[0x114f1](eng); if (ev & 4) F[0x11672](eng); if (ev & 8) F[0x1188c](eng); if (ev & 0x10) F[0x1194c](eng);
  } };
/** Прижать координату камеры к границам карты. */
const clampCam = (m, a, maxA) => { const v = m.u32(a), mx = m.u32(maxA); if (v > mx) { if (m.i32(a) > (mx | 0)) m.w32(a, mx); else m.w32(a, 0); } }; // cmp/jbe/jg — знаковая/беззнаковая пара
F[0x113a5] = (eng) => { // движение мыши
  const m = eng.m; const d = m.u8(UI.drag);
  if (d !== 0) { if (d >= 2) return; let dx = (m.u32(0x30358) - m.u32(M.x)) | 0; if (dx < 0) dx = -dx; let far = dx > 0xc;
    if (!far) { let dy = (m.u32(0x3035c) - m.u32(M.y)) | 0; if (dy < 0) dy = -dy; far = dy > 0xc; } if (!far) return;
    m.w8(UI.drag, 2); opt(eng, 0x29a3e); opt(eng, 0x29a45); return; }
  const btn = m.u32(M.btn);
  // Перетаскивания карты правой кнопкой у нас нет: она отдаёт приказ (современная схема) или
  // снимает выделение (классическая), а двигать карту есть чем — полоски у края, WASD, стрелки,
  // мини-карта и тачпад. Раньше эта механика ещё и швыряла камеру в случайный угол при нажатии
  // вне окна, потому что точка отсчёта оставалась от прошлого раза.
  if (btn & 2) { if (m.u8(UI.minimapDrag) === 1) { m.w32(M.evX, m.u32(M.x)); m.w32(M.evY, m.u32(M.y)); return F[0x12a4e](eng); } return; }
  if ((btn & 1) && m.u8(UI.minimapDrag) === 1) { m.w32(M.evX, m.u32(M.x)); m.w32(M.evY, m.u32(M.y)); return F[0x12a4e](eng); } };
const EDGE_OK = [1,0,0,0,0,1,0,1,0,0,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1]; // 0x11657
F[0x11960] = (eng) => { F[0x12a4e](eng); opt(eng, 0x29a3e); opt(eng, 0x29a45); eng.m.w8(UI.minimapDrag, 1); };
F[0x114f1] = (eng) => { // ЛКМ нажата
  const m = eng.m; if (EDGE_OK[m.u32(UI.edge)] === 0) return; const x = m.u32(M.evX), y = m.u32(M.evY);
  if (x - ΔП(m) >= 0x268 && y >= 0x1c8) { m.w8(UI.cornerA, 1); F[0x1fd1d](eng); if (m.u8(UI.mapFlags) & 1) opt(eng, 0x26e62); return; }
  // Наше отличие от оригинала: клик по мини-карте — всегда только перенос камеры.
  // В оригинале при выделенном своём бойце нажатие по мини-карте камеру не двигало, а отпускание
  // уходило в 0x11672 как приказ в это место карты — то есть отряд можно было случайно отправить
  // через полкарты, просто ткнув в мини-карту. Теперь любое нажатие включает перетаскивание камеры
  // (0x11960), а раз minimapDrag = 1, отпускание до приказа уже не доходит.
  if (inMinimapMode(m) && inMinimap(m, x, y)) return F[0x11960](eng);
  if ((m.u8(UI.mapFlags) & 1) && m.u32(UI.panelX) <= x) { if (y < 0x1be || x - ΔП(m) < 0x205) return; m.w8(UI.cornerB, 1); F[0x1fd1d](eng); opt(eng, 0x26e38); return; }
  const was = m.u8(UI.drag); m.w8(UI.drag, 1); if (was >= 2) { opt(eng, 0x29a3e); opt(eng, 0x29a45); }
  const cx = m.u32(UI.camX), cy = m.u32(UI.camY); m.w32(0x30350, cx); m.w32(0x30354, cy); m.w32(0x30358, x); m.w32(0x30360, (x + cx) >>> 0); m.w32(0x3035c, y); m.w32(0x30364, (y + cy) >>> 0); };
F[0x1199b] = (eng) => { opt(eng, 0x29a3e); opt(eng, 0x29a45); eng.m.w8(UI.minimapDrag, 0); };
F[0x11672] = (eng) => { // ЛКМ отпущена
  const m = eng.m; if (m.u8(UI.minimapDrag) === 1) return F[0x1199b](eng);
  const was = m.u8(UI.drag); m.w8(UI.drag, 0);
  if (was > 1) { F[0x119dd](eng); opt(eng, 0x29a3e); opt(eng, 0x29a45); opt(eng, 0x29a3e); opt(eng, 0x29a45); return; }
  if (m.u8(UI.cornerA) === 1) { m.w8(UI.cornerA, 0); F[0x1fd54](eng); return F[0x26510](eng); } m.w8(UI.cornerA, 0);
  let x = m.u32(M.evX), y = m.u32(M.evY);
  if (inMinimapMode(m) && inMinimap(m, x, y)) { x = (x - ΔП(m) - m.u32(UI.mmX0)) >>> 0; y = (y - m.u32(UI.mmY0)) >>> 0; if (m.u8(UI.mapFlags) & 4) { x >>>= 1; y >>>= 1; } x = ((x + m.u32(UI.mmOfsX)) << 5) >>> 0; y = ((y + m.u32(UI.mmOfsY)) << 5) >>> 0; }
  else { if (x >= m.u32(UI.panelX)) return F[0x120c0](eng); x = (x + m.u32(UI.camX)) >>> 0; y = (y + m.u32(UI.camY)) >>> 0; }
  if (СХЕМА.современная && m.u16(UI.mode) === 0) return selectAt(eng, x, y);   // левая только выделяет
  return cursorModeDispatch(eng, x, y); };
// таблица режимов курсора 0x1179c (индекс = 0x31aca), режим 0 → по форме курсора 0x3034c через 0x11820
const MODE_TAB = [0x1178e,0x11c92,0x11cc5,0x11ce6,0x11cfe,0x11d0b,0x11d25,0x116d7,0x116d7,0x11d89,0x11db6,0x11de9,0x11e1c,0x11e4f,0x116d7,0x11f2b,0x11f5e,0x11f91,0x11fc4,0x116d7,0x11ff7,0x1201b,0x1203f,0x12063,0x116d7,0x1206f,0x12085,0x120b4,0x116d7,0x116d7,0x116d7,0x116d7,0x116d7];
const SHAPE_TAB = [0x116d7,0x116d7,0x116d7,0x116d7,0x116d7,0x11b86,0x116d7,0x11d0b,0x116d7,0x116d7,0x11cc5,0x11c92,0x116d7,0x116d7,0x11d0b,0x11d0b,0x11cc5,0x11cc5,0x11c92,0x11c92,0x11c92,0x11c92,0x11c92,0x11c92,0x11d25,0x11d25,0x11d25];
// Shift и очередь приказов (наше). С зажатым Shift щелчок не отдаёт приказ, а добавляет шаг в
// очередь выделенных (js/port/orderqueue.js); без Shift любой приказ игрока очередь очищает —
// новое решение человека всегда важнее старого плана. Обвязка ставит сюда свой обработчик,
// потому что список выделенных и отправка в сеть живут у неё.
export const ШИФТ = { нажат: false };
let onQueue = null;
/** fn(код, цель, x, y, шифт) → true, если щелчок ушёл в очередь и обычный приказ не нужен. */
export function setQueueHandler(fn) { onQueue = fn; }
/**
 * Положить «ожидающий приказ» игрока: код, цель и точка. Слот один на всех (0x31acc), поэтому
 * очередь по Shift сначала спрашивает обвязку — не забрать ли приказ себе.
 */
const pending = (m, al, esi, edx, ebx) => {
  if (onQueue && onQueue(al, esi >>> 0, edx >>> 0, ebx >>> 0, ШИФТ.нажат)) return;
  m.w8(0x31acc, al); m.w32(0x31ad0, esi >>> 0); m.w32(0x31ad4, edx >>> 0); m.w32(0x31ad8, ebx >>> 0);
};
F[0x129cb] = (eng, r) => pending(eng.m, r.eax & 0xff, r.esi, r.edx, r.ebx);
/** Куда идёт щелчок по карте: по курсорному режиму (магия, патруль, стройка), иначе по форме курсора. */
function cursorModeDispatch(eng, x, y) { const m = eng.m; let h = MODE_TAB[m.u16(UI.mode)]; if (h === 0x1178e) h = SHAPE_TAB[m.u32(UI.cursor)] ?? 0x116d7; if (h === 0x116d7 || h === undefined) return; return CLICK[h](eng, x, y); }
// обработчики клика в поле (edx=x, ebx=y — мировые координаты)
const findAt = (eng, x, y) => { const r = F[0x130c6](eng, { edx: x, ebx: y }); return { esi: r.esi >>> 0, al: r.eax & 0xff }; };
/**
 * Цель для приказа атаки с поправкой на палец. Точное попадание по спрайту требует точности в
 * несколько точек, а палец накрывает пол-клетки: игрок целится во врага, промахивается на волосок
 * и вместо атаки получает «идти сюда» — или, хуже, попадает в своего. Поэтому под тач-схемой:
 * сперва честный поиск движка, а если он дал пусто или СВОЕГО — ищем ближайшего ЧУЖОГО в радиусе
 * пальца. Своих при этом не подставляем никогда: приказ «бей своего» — это не то, чего хотели.
 */
const ПАЛЕЦ = 24;                          // точек (три четверти клетки) — примерно подушечка пальца
function целиться(eng, x, y) {
  const m = eng.m; const { esi, al } = findAt(eng, x, y);
  if (!ТАЧСХЕМА.замок) return { esi, al };
  if (esi && !own(eng, esi)) return { esi, al };                     // уже чужой — лучше не придумаешь
  let лучший = 0, d0 = ПАЛЕЦ * ПАЛЕЦ;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1 || m.u8(UNITS + i + U.STATE) === 0x60) continue;
    if (own(eng, i)) continue;
    const ux = m.u16(UNITS + i + U.X) + 16, uy = m.u16(UNITS + i + U.Y) + 16;
    const dx = ux - x, dy = uy - y, d = dx * dx + dy * dy;
    if (d < d0) { d0 = d; лучший = i; }
  }
  return лучший ? { esi: лучший, al } : { esi, al };
}
const CLICK = {
  0x11c92: (eng, x, y) => { const m = eng.m; m.w32(0x30370, 0); m.w32(0x30374, x); m.w32(0x30378, y); pending(m, 0x0f, 0, x & ~0x1f, y & ~0x1f); F[0x1fe5e](eng, { esi: m.u32(UI.sel) }); },
  0x11cc5: (eng, x, y) => { const m = eng.m; const { esi } = целиться(eng, x, y); pending(m, 0x1f, esi, x & ~0x1f, y & ~0x1f); F[0x1fe5e](eng, { esi: m.u32(UI.sel) }); },
  // Кнопка «zzz» (команда 3, она же Z) — родной сон оригинала, приказ 0x2f. Не трогать: состояние
  // 0x2x разбирает 0x18e0b (js/port/move.js), и там у спящего раз в 32 такта идёт +1 HP И +1 маны
  // сверх общей регенерации, а над юнитом рисуется значок «zzz». Была попытка подменить его нашим
  // «быстрым сном» на своём коде 0x3a — пропали и значок, и восстановление маны. Тот модуль снят
  // совсем: тренировочные сцены ИИ тоже спят родным сном, иначе сеть учится не тем правилам.
  0x11ce6: (eng) => { const m = eng.m; pending(m, 0x2f, 0, 0, 0); F[0x1feb7](eng, { esi: m.u32(UI.sel) }); },
  0x11cfe: (eng) => pending(eng.m, 0x3f, 0, 0, 0),
  0x11d0b: (eng, x, y) => { const m = eng.m; pending(m, 0x4c, 0, x & ~0x1f, y & ~0x1f); F[0x1fe5e](eng, { esi: m.u32(UI.sel) }); },
  0x11d25: (eng, x, y) => { const m = eng.m; const { esi } = findAt(eng, x, y); const sel = m.u32(UI.sel);
    // Ткнул в самого себя — это не передача, а промах: просто выходим из режима, ничего не отдавая.
    // (Слова владельца: «если нажал в любое другое место, типа передал сам себе, действие должно
    // сброситься сразу».) Земля остаётся законной целью — туда вещь кладут.
    if (esi && esi === sel) { m.w16(UI.mode, 0); F[0x1308c](eng); F[0x259b3](eng); return F[0x1fdc2](eng, { esi: sel }); }
    pending(m, (0x51 + m.u8(UNITS + sel + 0x51)) & 0xff, esi, x & ~0x1f, y & ~0x1f); m.w16(UI.mode, 0); F[0x1fdc2](eng, { esi: m.u32(UI.sel) }); },
  0x11b86: (eng, x, y) => selectAt(eng, x, y),
  // Наше: щелчок в режиме патруля. Точку принимает обвязка (она копит их до пяти и в конце
  // отдаёт приказами 0x34/0x35, см. js/port/patrol.js), режим остаётся включённым.
  0x11b87: (eng, x, y) => { onPatrolPoint?.(x & ~0x1f, y & ~0x1f); F[0x1fe5e](eng, { esi: eng.m.u32(UI.sel) }); },
};
// Режим курсора «патруль»: свободный индекс за концом таблицы 0x1179c. Правая кнопка снимает
// его так же, как любой другой режим (0x1188c), — отдельного выхода не надо.
export const PATROL_MODE = MODE_TAB.length;
MODE_TAB[PATROL_MODE] = 0x11b87;
let onPatrolPoint = null;
/** Куда отдавать точки маршрута: обвязка ставит сюда свой сборщик. */
export function setPatrolHandler(fn) { onPatrolPoint = fn; }

// Наше: режим «отметить место стройки». Щелчок по карте отдаём обвязке (она кладёт план через
// очередь приказов, js/port/buildplan.js), режим остаётся включённым до правой кнопки.
CLICK[0x11b88] = (eng, x, y) => { onBuildPoint?.(x & ~0x1f, y & ~0x1f); F[0x1fe5e](eng, { esi: eng.m.u32(UI.sel) }); };
export const BUILD_MODE = MODE_TAB.length;
MODE_TAB[BUILD_MODE] = 0x11b88;
let onBuildPoint = null;
/** Куда отдавать отметку места постройки: обвязка ставит сюда свой обработчик. */
export function setBuildHandler(fn) { onBuildPoint = fn; }
/** Щелчок заклинанием: найти цель нужного вида и положить приказ каста. */
// Заклинания одноразовые (владелец: «нажал, выбрал — и активация сбросилась, курсор сразу обычный»):
// после применения режим курсора снимаем. Щелчок мимо цели режим не снимает — можно щёлкнуть ещё раз.
const сброситьРежим = (eng) => { eng.m.w16(UI.mode, 0); F[0x1308c](eng); F[0x259b3](eng); };
const magicClick = (code, finder) => (eng, x, y) => { const m = eng.m; const { esi, al } = finder(eng, x, y); if (!esi) return; pending(m, code, esi, 0, 0); сброситьРежим(eng); };
for (const [h, code] of [[0x11d89,0xa0],[0x11db6,0xa1],[0x11de9,0xa2],[0x11e1c,0xa3],[0x11f2b,0xa6],[0x11f5e,0xa7],[0x11f91,0xa8],[0x11fc4,0xa9]]) CLICK[h] = magicClick(code, findAt);
CLICK[0x11e4f] = magicClick(0xa4, (eng, x, y) => { const r = F[0x11e6a](eng, { edx: x, ebx: y }); return { esi: r.esi >>> 0, al: r.eax & 0xff }; });
// Заклинания по точке (ядовитое облако, огненный танец, землетрясение, самоподрыв, телепорт рейнджера) —
// тоже одноразовые.
for (const [h, code] of [[0x11ff7,0xab],[0x1201b,0xac],[0x1203f,0xad],[0x12063,0xae],[0x120b4,0xb2]])
  CLICK[h] = (eng, x, y) => { pending(eng.m, code, 0, x, y); сброситьРежим(eng); };
CLICK[0x1206f] = (eng) => pending(eng.m, 0xb0, 0, 0, 0); CLICK[0x12085] = (eng) => pending(eng.m, 0xb1, 0, 0, 0);
// Двойной щелчок по своему бойцу выделяет всех таких же в пределах экрана (наше). Выделение —
// дело зрительское (lockstep.F07_ЗРИТЕЛЬ), на симуляцию не влияет и по сети не едет, поэтому и
// время здесь настоящее, а не игровое.
const ДВОЙНОЙ_МС = 400;
let прошлыйЩелчок = { юнит: 0, когда: -1e9 };
/** Двойной щелчок: выделить всех своих юнитов того же вида в пределах видимой части карты. */
function выделитьТаких(eng, образец) {
  const m = eng.m; const т = m.u8(UNITS + образец + U.TYPE);
  // Видимая часть карты в мировых пикселях: камера плюс окно (viewW/viewH — в клетках).
  const x0 = m.u32(UI.camX), y0 = m.u32(UI.camY);
  const x1 = x0 + (m.u32(UI.viewW) << 5), y1 = y0 + (m.u32(UI.viewH) << 5);
  F[0x119c1](eng);                                                   // снять выделение со всех
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if (m.u8(UNITS + i + U.STATE) === 0x60) continue;                // труп не выделяем
    if (m.u8(UNITS + i + U.TYPE) !== т || !own(eng, i)) continue;
    const ux = m.u16(UNITS + i + U.X), uy = m.u16(UNITS + i + U.Y);
    if (ux + 0x20 < x0 || ux > x1 || uy + 0x20 < y0 || uy > y1) continue;
    m.w8(UNITS + i + 7, m.u8(UNITS + i + 7) | 0x80);
  }
  m.w8(UNITS + образец + 7, m.u8(UNITS + образец + 7) | 0x80);       // 0x11c13 не должен сбросить отряд
  return F[0x11c13](eng, { esi: образец });
}

/**
 * Тач-схема управления (включается из игры, js/web/game.js). На десктопе выключена — там старое
 * управление сохраняется байт в байт.
 *
 * `замок` — защита выделения. Жалоба владельца: «пытаешься юнита отвести, а случайно нажимаешь на
 * другого, и выделяется он, а тот умирает». На мыши это лечится правой кнопкой, на пальце лечить
 * нечем — поэтому, пока отряд выделен, ОДИНОЧНЫЙ тап по своему юниту выделение не меняет. Сменить
 * его можно рамкой или двойным тапом по нужному бойцу.
 */
export const ТАЧСХЕМА = { замок: false, силой: false };
/**
 * Наши действия, повешенные на кнопки панели в тач-схеме (их ставит js/web/game.js).
 * Просьба владельца: иконку «отнести на базу» переназначить на отступление, а само «отнести»
 * оставить на долгом нажатии; долгое нажатие по мясу в инвентаре — собрать всё мясо (как клавиша T).
 */
export const ТАЧКНОПКИ = { отступление: null, сборМяса: null };

/**
 * Выделить того, кто под точкой, в обход замка — это делает ДОЛГИЙ тап.
 * (Слова владельца: «длинный тап выделяет другого юнита».)
 */
export function выделитьСилой(eng, x, y) {
  ТАЧСХЕМА.силой = true;
  try { selectAt(eng, x, y); } finally { ТАЧСХЕМА.силой = false; }
}

/** Есть ли сейчас выделенные свои юниты. */
function естьВыделение(eng) {
  const m = eng.m;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue;
    if ((m.u8(UNITS + i + 7) & 0x80) && own(eng, i) && m.u8(UNITS + i + U.TYPE) < 0x1a) return true;
  }
  return false;
}

// выбор юнита/предмета в точке (0x11b86)
function selectAt(eng, x, y) { const m = eng.m; const { esi, al } = findAt(eng, x, y);
  if (!esi) { if (!al) return; const t = F[0x1c3d3](eng, { edx: x, ebx: y }).eax & 0xff; if (!t) return; return F[0x25abd](eng, { esi: findItem(eng, x, y) }); }
  const shift = m.u8(K.lshift) === 1 || m.u8(K.rshift) === 1;
  // Замок выделения: одиночный тап по своему бойцу, когда отряд уже выбран, ничего не меняет.
  // Двойной тап проходит — им и выбирают нового; рамка тоже проходит, она идёт мимо этой функции.
  if (ТАЧСХЕМА.замок && !ТАЧСХЕМА.силой && !shift && own(eng, esi) && m.u8(UNITS + esi + U.TYPE) < 0x1a) {
    const сейчас = Date.now();
    const двойной = esi === прошлыйЩелчок.юнит && сейчас - прошлыйЩелчок.когда < ДВОЙНОЙ_МС;
    const было = естьВыделение(eng);
    // Тап по бойцу ИЗ ОТРЯДА делает его главным, а отряд остаётся выделенным. Так удобно дать
    // одному конкретное дело — «вот этот сходи и собери», — не разбирая группу (просьба владельца).
    // Движок это умеет сам: 0x11c13 разгоняет отряд только у юнита БЕЗ бита выделения, а у нашего
    // он стоит, поэтому меняется только вожак.
    if (m.u8(UNITS + esi + 7) & 0x80) { прошлыйЩелчок = { юнит: esi, когда: сейчас }; return F[0x11c13](eng, { esi }); }
    // Замок: одиночный тап по ЧУЖОМУ для отряда бойцу, когда отряд уже выбран, ничего не меняет.
    if (!двойной && было) { прошлыйЩелчок = { юнит: esi, когда: сейчас }; return; }
    // Двойной тап при ЗАНЯТОМ выделении берёт ровно одного — «выцепить конкретного из кучи».
    // Пачку (всех такого же вида рядом) двойной тап собирает только когда не выделено никого.
    if (двойной && было) {
      прошлыйЩелчок = { юнит: 0, когда: -1e9 };
      m.w8(UNITS + esi + 7, m.u8(UNITS + esi + 7) & 0x7f);
      return F[0x11c13](eng, { esi });
    }
  }
  if (!shift && own(eng, esi) && m.u8(UNITS + esi + U.TYPE) < 0x1a) {
    const сейчас = Date.now();
    if (esi === прошлыйЩелчок.юнит && сейчас - прошлыйЩелчок.когда < ДВОЙНОЙ_МС) {
      прошлыйЩелчок = { юнит: 0, когда: -1e9 };                      // третий щелчок начинает заново
      return выделитьТаких(eng, esi);
    }
    прошлыйЩелчок = { юнит: esi, когда: сейчас };
  }
  if (shift && m.u8(UNITS + esi + U.TYPE) !== 0x1a && own(eng, esi)) { const sel = m.u32(UI.sel);
    if (m.u8(UNITS + sel + U.TYPE) !== 0x1a && own(eng, sel)) {
      if (!(m.u8(UNITS + esi + 7) & 0x80)) { m.w8(UNITS + esi + 7, m.u8(UNITS + esi + 7) | 0x80); if (sel === 0) return F[0x11c13](eng, { esi }); return; }
      m.w8(UNITS + esi + 7, m.u8(UNITS + esi + 7) & 0x7f); if (sel === esi) return call(eng, 0x1a62d, { esi }); return; } }
  // Наше отличие от оригинала: клик без Shift оставляет выделенным ровно того, по кому кликнули.
  // В оригинале 0x11c13 разгонял отряд только если у юнита не стоял бит выделения (+0x07 бит 7),
  // то есть щелчок по бойцу из уже выделенной толпы просто делал его вожаком, а толпа оставалась
  // выделенной — вытащить одного из кучи было нечем. Снимаем бит заранее, и дальше 0x11c13 сам
  // сбросит выделение со всех (0x119c1) и поставит его этому юниту. Shift-клик не трогаем: он
  // как и был добавляет и убирает бойцов из отряда.
  m.w8(UNITS + esi + 7, m.u8(UNITS + esi + 7) & 0x7f);
  return F[0x11c13](eng, { esi }); }
/** Предмет, лежащий в этой клетке (для приказа «подобрать»). */
const findItem = (eng, x, y) => { const m = eng.m; const tx = (x >>> 5) & 0xff, ty = (y >>> 5) & 0xff; for (let i = m.u32(0x31b7c); i; i = m.u32(ITEMS + i + 12)) if (m.u8(ITEMS + i + 1) === tx && m.u8(ITEMS + i + 2) === ty) return i; return 0; };
F[0x1c3d3] = (eng, r) => { const m = eng.m; const tx = (r.edx >>> 5) & 0xff, ty = (r.ebx >>> 5) & 0xff; for (let i = m.u32(0x31b7c); i; i = m.u32(ITEMS + i + 12)) if (m.u8(ITEMS + i + 1) === tx && m.u8(ITEMS + i + 2) === ty) return { eax: m.u8(ITEMS + i), esi: i }; return { eax: 0, esi: 0 }; };
F[0x119c1] = (eng) => { const m = eng.m; for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) m.w8(UNITS + i + 7, m.u8(UNITS + i + 7) & 0x7f); };
/** Сумма характеристик — по ней выбирается лидер выделенной группы. */
const statSum = (m, i) => { let ax = m.u8(UNITS + i + U.HPMAX); for (const f of [U.MAG, U.ATK, U.DEF, U.SPD]) { ax += m.u8(UNITS + i + f); } return ax; }; // add al / adc ah,0 == 16-битная сумма
F[0x119dd] = (eng) => { // рамка выделения
  const m = eng.m; let x1 = (m.u32(M.evX) + m.u32(UI.camX)) >>> 0, y1 = (m.u32(M.evY) + m.u32(UI.camY)) >>> 0; let x0 = m.u32(0x30360), y0 = m.u32(0x30364);
  if (x0 > x1) { m.w32(0x30360, x1); x1 = x0; x0 = m.u32(0x30360); } if (y0 > y1) { m.w32(0x30364, y1); y1 = y0; y0 = m.u32(0x30364); }
  const ax = x0 & 0xffff, bp = y0 & 0xffff, dx = x1 & 0xffff, bx = y1 & 0xffff; m.w32(0x33868, 0); const shift = () => m.u8(K.lshift) === 1 || m.u8(K.rshift) === 1;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    let inside = false;
    if (!(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.STATE) !== 0x60 && own(eng, i) && m.u8(UNITS + i + U.TYPE) < 0x1a) {
      const ux = m.u16(UNITS + i + U.X), uy = m.u16(UNITS + i + U.Y);
      if (ux <= dx && ((ux + 0x20) & 0xffff) >= ax && uy <= bx && ((uy + 0x20) & 0xffff) >= bp) inside = true; }
    if (inside) { const lead = m.u32(0x33868); if (statSum(m, lead) < statSum(m, i)) m.w32(0x33868, i); m.w8(UNITS + i + 7, m.u8(UNITS + i + 7) | 0x80); }
    else if (!shift()) m.w8(UNITS + i + 7, m.u8(UNITS + i + 7) & 0x7f); }
  const sel = m.u32(UI.sel); if (sel !== 0 && (m.u8(UNITS + sel + 7) & 0x80)) return;
  const lead = m.u32(0x33868); if (lead) return F[0x11c13](eng, { esi: lead }); return call(eng, 0x1a65d); };
F[0x11c13] = (eng, r) => { // выбрать юнит esi (лидер), обновить панель
  const m = eng.m; const i = r.esi; F[0x259e4](eng, { esi: i }); m.w32(UI.sel, i);
  if (!(m.u8(UNITS + i + 7) & 0x80)) { F[0x119c1](eng); m.w8(UNITS + i + 7, m.u8(UNITS + i + 7) | 0x80); }
  if (own(eng, i)) F[0x1fdc2](eng, { esi: i }); m.w16(UI.mode, 0);
  if (m.u8(UNITS + i + U.TYPE) < 0x1a) { m.w32(UI.page, 0); F[0x2673d](eng, { esi: i }); F[0x26671](eng, { esi: i }); F[0x2698e](eng); return { esi: m.u32(UI.sel) }; }
  m.w8(UI.page, (m.u8(UNITS + i + U.TYPE) - 0x19) & 0xff); m.w32(UI.page, m.u8(UI.page)); F[0x26a5d](eng, { esi: i }); return { esi: m.u32(UI.sel) }; };
F[0x1188c] = (eng) => { // ПКМ нажата
  const m = eng.m; m.w32(0x3386c, 0); m.w32(0x30368, m.u32(M.evMX)); m.w32(0x3036c, m.u32(M.evMY)); const x = m.u32(M.evX), y = m.u32(M.evY); m.w32(0x33870, x); m.w32(0x33874, y);
  if (x - ΔП(m) >= 0x268 && y >= 0x1c8) return F[0x24525](eng);
  if (inMinimapMode(m) && inMinimap(m, x, y)) return F[0x11960](eng);
  if (m.u16(UI.mode) !== 0) { m.w16(UI.mode, 0); return; }
  if (m.u32(UI.panelX) <= x) return F[0x12214](eng);
  if (СХЕМА.современная) return;                                      // правая — это приказ, выделение не трогаем
  F[0x119c1](eng); if (m.u32(UI.sel) !== 0) return call(eng, 0x1a65d, { esi: 0 }); };
F[0x1194c] = (eng) => { const m = eng.m; m.w32(0x3386c, 0);
  if (m.u8(UI.minimapDrag) === 1) return F[0x1199b](eng);
  if (!СХЕМА.современная || m.u16(UI.mode) !== 0) return;
  const x = m.u32(M.evX), y = m.u32(M.evY);
  if (x >= m.u32(UI.panelX) || (x - ΔП(m) >= 0x268 && y >= 0x1c8)) return;   // панель и угловые кнопки — не карта
  if (inMinimapMode(m) && inMinimap(m, x, y)) return;
  // Если правой кнопкой тащили камеру, приказа не даём: это была прокрутка, а не щелчок.
  if (!m.u32(UI.sel)) return;
  действиеПКМ(eng, (x + m.u32(UI.camX)) >>> 0, (y + m.u32(UI.camY)) >>> 0);
};

/**
 * Современная схема управления (наше). В оригинале всё делает левая кнопка: что под курсором, то
 * и произойдёт — по своему зданию она выделит здание вместо того, чтобы увести бойца, и отряд
 * гибнет из-за промаха. Здесь как в нынешних стратегиях: левая только выделяет, правая приказывает.
 *   по врагу      — атаковать;
 *   по своему     — идти за ним (js/port/follow.js);
 *   по всему иному (земля, свой дом, предмет) — идти туда.
 * Режим курсора (магия, патруль, отметка стройки) работает по-старому: он включён с панели, левая
 * кнопка его применяет, правая отменяет.
 */
export const СХЕМА = { современная: false };
/** Схема управления: современная (левая выделяет, правая приказывает) или как в оригинале. */
export function задатьСхему(современная) { СХЕМА.современная = !!современная; return СХЕМА.современная; }
let onFollow = null;
/** Куда отдавать «следовать за целью»: обвязка ставит сюда свой обработчик (нужен номер цели). */
export function setFollowHandler(fn) { onFollow = fn; }
/** Правая кнопка в современной схеме: враг — атака, свой — «иду за ним», земля — идти. */
function действиеПКМ(eng, x, y) {
  const m = eng.m; const { esi } = findAt(eng, x, y);
  const мой = m.u8(UI.human);
  if (esi) {
    const вл = m.u8(UNITS + esi + U.OWNER), т = m.u8(UNITS + esi + U.TYPE);
    if (вл !== мой) { pending(m, 0x1f, esi, x & ~0x1f, y & ~0x1f); return F[0x1fe5e](eng, { esi: m.u32(UI.sel) }); }
    if (т < 0x1a && onFollow && !ШИФТ.нажат) { onFollow(esi); return F[0x1fe5e](eng, { esi: m.u32(UI.sel) }); }
  }
  // Под курсором лежит вещь — подобрать её (тот же приказ 0x4c, что и по «руке» в оригинале).
  // Иначе правой кнопкой по мясу отряд просто проходил мимо.
  if (!esi && (F[0x1c3d3](eng, { edx: x, ebx: y }).eax & 0xff)) {
    pending(m, 0x4c, 0, x & ~0x1f, y & ~0x1f);
    return F[0x1fe5e](eng, { esi: m.u32(UI.sel) });
  }
  m.w32(0x30370, 0); m.w32(0x30374, x); m.w32(0x30378, y);
  pending(m, 0x0f, 0, x & ~0x1f, y & ~0x1f);
  F[0x1fe5e](eng, { esi: m.u32(UI.sel) });
}
F[0x26510] = (eng) => { const m = eng.m; m.w8(UI.mapFlags, m.u8(UI.mapFlags) ^ 1); call(eng, 0x26521); opt(eng, 0x2661c); };
F[0x24525] = (eng) => { const m = eng.m; const f = m.u8(UI.mapFlags);
  if (!(f & 1)) { if (f & 8) m.w8(UI.mapFlags, f + 2); else m.w8(UI.mapFlags, f | 8); return call(eng, 0x26521); }
  m.w8(UI.mapFlags, f ^ 4); if (m.u8(UI.mapFlags) & 4) return call(eng, 0x24564); opt(eng, 0x2665d); return call(eng, 0x24564); };
// ---------- объект под точкой (мировые координаты edx,ebx)
const HITBOX = 0x33978;
F[0x130c6] = (eng, r) => { const m = eng.m; const x = r.edx >>> 0, y = r.ebx >>> 0; const cell = ((x >>> 5) & 0xff) + (((y >>> 5) & 0xff) << 8);
  if (!(m.u8(BI + cell) & 1)) return { esi: 0, eax: 0 }; const al = m.u8(BI + cell) & 2; const ah = m.u8(MO + cell) >> 4; const dx = (x << 16) >> 16, bx = (y << 16) >> 16;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue; if (m.u8(UNITS + i + U.STATE) === 0x60) continue; const t = m.u8(UNITS + i + U.TYPE); const ux = m.u16(UNITS + i + U.X), uy = m.u16(UNITS + i + U.Y);
    if (dx < (((ux + m.i16(HITBOX + t * 8)) << 16) >> 16)) continue; if (bx < (((uy + m.i16(HITBOX + t * 8 + 2)) << 16) >> 16)) continue;
    if ((x & 0xffff) > ((ux + m.i16(HITBOX + t * 8 + 4)) & 0xffff)) continue; if ((y & 0xffff) > ((uy + m.i16(HITBOX + t * 8 + 6)) & 0xffff)) continue;
    if (ah === 0 || t === 0xb) return { esi: i, eax: al }; }
  return { esi: 0, eax: al }; };
F[0x130ae] = (eng) => { const m = eng.m; return F[0x130c6](eng, { edx: (m.u32(M.x) + m.u32(UI.camX)) >>> 0, ebx: (m.u32(M.y) + m.u32(UI.camY)) >>> 0 }); };
F[0x11e6a] = (eng, r) => { // труп (state 0x60, тип < 0xe) под точкой
  const m = eng.m; const x = r.edx >>> 0, y = r.ebx >>> 0; const cell = ((x >>> 5) & 0xff) + (((y >>> 5) & 0xff) << 8); if (!(m.u8(BI + cell) & 1)) return { esi: 0, eax: 0 };
  const al = m.u8(BI + cell) & 2; const dx = (x << 16) >> 16, bx = (y << 16) >> 16;
  for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) {
    if (m.u8(UNITS + i + U.STATE) !== 0x60) continue; if (m.u8(UNITS + i + U.FLAGS5B) & 1) continue; const t = m.u8(UNITS + i + U.TYPE); if (t >= 0xe) continue;
    const ux = m.u16(UNITS + i + U.X), uy = m.u16(UNITS + i + U.Y);
    if (dx < (((ux + m.i16(HITBOX + t * 8)) << 16) >> 16)) continue; if (bx < (((uy + m.i16(HITBOX + t * 8 + 2)) << 16) >> 16)) continue;
    if ((x & 0xffff) > ((ux + m.i16(HITBOX + t * 8 + 4)) & 0xffff)) continue; if ((y & 0xffff) > ((uy + m.i16(HITBOX + t * 8 + 6)) & 0xffff)) continue; return { esi: i, eax: al }; }
  return { esi: 0, eax: al }; };
// ---------- форма курсора и край экрана (0x12be6)
const CURSOR_BY_MODE = [0x12d15,0x12e69,0x12eb1,0x12e54,0x12e54,0x12ed7,0x12f15,0x12e54,0x12e54,0x12f2d,0x12f2d,0x12f2d,0x12f2d,0x12f2d,0x12e54,0x12f49,0x12f49,0x12f49,0x12f49,0x12e54,0x12f49,0x12f49,0x12f49,0x12f49,0x12e54,0x12e54,0x12e54,0x12f2d,0x12e54,0x12e54,0x12e54,0x12e54,0x12e54];
CURSOR_BY_MODE[PATROL_MODE] = 0x12e69;   // в режиме патруля курсор «идти», как у обычного приказа
const cursorConst = { 0x12e54: 0, 0x12efd: 5, 0x12f15: 0x18, 0x12f2d: 0xb, 0x12f49: 0xa };
// Отметка места стройки — свой курсор: указательный палец (24-й в MOUSECUR.27). Раньше здесь
// стояли «следы», и это читалось как приказ идти: тестер решил, что зданием показывают, куда
// шагать. Палец означает ровно то, что нужно, — «ткни, где ставить».
const КУРСОР_ПАЛЕЦ = 0x12ff0;            // ключ наш: своего обработчика на палец в оригинале нет
cursorConst[КУРСОР_ПАЛЕЦ] = 24;
CURSOR_BY_MODE[BUILD_MODE] = КУРСОР_ПАЛЕЦ;

/** Курсор-«шаги»: анимация из четырёх кадров, пока юнит идёт. */
function cursorWalk(eng) { const m = eng.m; let ebx = m.u32(0x33878); if (!(m.u8(G.ticks) & 1)) { const t = m.u32(G.ticks); if (m.u32(0x3387c) !== t) { m.w32(0x3387c, t); ebx++; if (ebx > 0x17) ebx = 0x12; } } m.w32(0x33878, ebx); setCursor(eng, ebx); }
/** Поставить курсор по обработчику, на который сейчас указывает режим. */
function cursorGo(eng, h) { const m = eng.m; if (h in cursorConst) return setCursor(eng, cursorConst[h]); if (h === 0x12e69) return cursorWalk(eng);
  if (h === 0x12eb1) return setCursor(eng, (m.u8(G.ticks) & 4) ? 0x10 : 0x11); if (h === 0x12ed7) return setCursor(eng, (m.u8(G.ticks) & 4) ? 0xf : 0xe); throw new Error('cursor ' + h.toString(16)); }
// Полоса прокрутки у края. В оригинале край — ровно один пиксель: мышь упиралась в рамку DOS-окна
// и всё работало. В браузере курсор в край не упереть, поэтому зону можно расширить — сколько
// именно, решает обвязка (web/game.js рисует по краям серые полоски той же ширины).
export const КРАЙ = { ширина: 0 };
/** Тестовая страница демона (?demon=1): разрешить приказы своему демону (тип 18). Вне её — как в оригинале. */
export const СВОЙ_ДЕМОН = { вкл: false };
F[0x12be6] = (eng) => { const m = eng.m; const x = m.u32(M.x), y = m.u32(M.y); let bl = 0;
  const ш = КРАЙ.ширина;
  // Прокрутка — только от края ЭКРАНА, с любой стороны. В оригинале иначе и не могло быть: мышь
  // упиралась в рамку окна DOS. Раньше правый край считался по краю карты (перед панелью), и
  // тестер справедливо жаловался: ведёшь мышь к кнопкам панели — карта сама уезжает вправо.
  // Вариант «край карты у панели» убран совсем, остался только край экрана.
  // Край экрана считаем от НАСТОЯЩЕГО размера кадра: в широком окне (js/render/wide.js) он больше
  // 640×480, и зашитые 0x27d/0x1df срабатывали посреди экрана — карта уезжала сама, стоило
  // довести мышь до середины. Смещения от края оставлены теми же, что в оригинале.
  const Ш = ширКадра(m), В = высКадра(m);
  const правый = (Ш - 3) - ш;
  const нижний = ш ? (В - 1) - ш : В - 9;
  // Нижний предел камеры — высота карты минус окно в клетках (0x31af4), а не всегда 15.
  const оконВыс = m.u32(UI.viewH) || 0xf;
  if (x <= ш && m.u32(UI.camX) !== 0) bl += 8;
  if (x >= правый && m.u32(UI.camX) < ((m.u32(G.mapW) - m.u32(UI.viewW)) << 5) >>> 0) bl += 2;
  if (y <= ш && m.u32(UI.camY) !== 0) bl += 1; if (y >= нижний && m.u32(UI.camY) < ((m.u32(G.mapH) - оконВыс) << 5) >>> 0) bl += 4;
  m.w32(UI.edge, bl); if (bl) return setCursor(eng, bl);
  if (m.u8(UI.mapFlags) & 1) { if (x - ΔП(m) >= 0x200 && y >= 0x1be) return cursorGo(eng, 0x12e54); } else if (x - ΔП(m) >= 0x268 && y >= 0x1c8) return cursorGo(eng, 0x12e54);
  let esi, al;
  if (inMinimapMode(m) && inMinimap(m, x, y)) { if (m.u8(UI.minimapDrag) === 1) return; esi = 0; al = 0; }
  else { const h = CURSOR_BY_MODE[m.u16(UI.mode)]; if (h !== 0x12d15) return cursorGo(eng, h);
    if ((m.u8(UI.mapFlags) & 1) && m.u32(M.x) >= m.u32(UI.panelX)) { // 0x12d8d: подсветка кнопки здания
      if (m.u32(UI.page) === 0) return cursorGo(eng, 0x12e54);
      for (let i = 0; i < 15; i++) { const b = 0x30d54 + i * 8; if (m.u16(b) <= x && m.u16(b + 2) <= y && m.u16(b + 4) > x && m.u16(b + 6) > y) { m.w32(UI.hover, 0); if (m.u8(UI.bldBtn + i)) m.w32(UI.hover, i + 1); return cursorGo(eng, 0x12e54); } }
      m.w32(UI.hover, 0); return cursorGo(eng, 0x12e54); }
    const r = F[0x130ae](eng); esi = r.esi >>> 0; al = r.eax & 0xff; }
  if (esi) al = (((m.u8(UNITS + esi + U.OWNER) + 1) << 2) | 1) & 0xff; else if (al) al = 3;
  const tx = ((x + m.u32(UI.camX)) >>> 5) & 0xff, ty = ((y + m.u32(UI.camY)) >>> 5); const tile = m.u16(BG + ((ty << 9) + tx * 2)); const bl2 = m.u8(0x3183c + tile);
  const sel = m.u32(UI.sel); const st = m.u8(UNITS + sel + U.TYPE);
  if (st === 0 || st >= 24) return cursorGo(eng, (al & 0xfe) ? 0x12efd : 0x12e54);
  // Звери (14+) в оригинале всегда дикие — им курсор только «стрелка». Исключение — ТОЛЬКО наш демон (тип 18,
  // свой) на тестовой странице ?demon=1 (СВОЙ_ДЕМОН.вкл ставит web/game.js). Первая версия разрешала всех «своих»
  // зверей во всей игре — владелец: «теперь могу управлять любым юнитом», откатили.
  const свойДемон = СВОЙ_ДЕМОН.вкл && (st === 18 || st === 15) && m.u8(UI.human) === m.u8(UNITS + sel + U.OWNER);   // демон и бронтозавр
  if (st >= 14 && !свойДемон) { if (!(al & 1)) return cursorGo(eng, 0x12e54); return cursorGo(eng, (al & 0xfe) ? 0x12efd : 0x12e54); }
  if (m.u8(UI.human) === m.u8(UNITS + sel + U.OWNER)) {
    if (!(al & 1)) return cursorGo(eng, 0x12e69);
    if (al & 0xfc) { const o = ((al >> 2) - 1) & 0xff; return cursorGo(eng, m.u8(UI.human) === o ? 0x12efd : 0x12eb1); }
    if (al & 2) return cursorGo(eng, 0x12ed7); if (bl2 & 3) return cursorGo(eng, 0x12e54); return cursorGo(eng, 0x12e69); }
  if (!(al & 1)) return cursorGo(eng, 0x12e54); return cursorGo(eng, (al & 0xfe) ? 0x12efd : 0x12e54); };
F[0x1308c] = (eng) => { const m = eng.m; setCursor(eng, m.u32(0x33888 + m.u16(UI.mode) * 4)); };
// ---------- команды по номеру (0x13237, eax = номер) и статус-тексты
const setStatus = (m, p1, p2 = 0x41938) => { m.w32(UI.statText, p1); m.w32(UI.statText2, p2); m.w16(UI.statLen, 0x24); };
F[0x259b3] = (eng) => { const m = eng.m; const md = m.u16(UI.mode); if (md) setStatus(m, m.u32(0x41ed8 + md * 4)); };
const CMD_TAB = [0x13285,0x13285,0x13285,0x11ce6,0x11cfe,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x13285,0x12003,0x12027,0x1204b,0x13285,0x1206f,0x12085,0x13285,0x13285,0x13285,0x13285,0x13285];
F[0x13237] = (eng, r) => { const m = eng.m; const eax = r.eax >>> 0; const i = m.u32(UI.sel); if (!i) return; if (m.u8(UNITS + i + 0x43) & 0xfc) return;
  if (m.u8(UNITS + i + U.TYPE) >= 0x19) return call(eng, 0x1fd8b);
  if (m.u8(UI.human) !== m.u8(UNITS + i + U.OWNER) || m.u8(UNITS + i + U.STATE) === 0x60) return call(eng, 0x1fd8b);
  if (call(eng, 0x14873, { eax: (eax - 1) >>> 0, esi: i }).cf) return call(eng, 0x1fd8b);
  const h = CMD_TAB[eax]; const wx = (m.u32(M.x) + m.u32(UI.camX)) >>> 0, wy = (m.u32(M.y) + m.u32(UI.camY)) >>> 0;
  switch (h) { case 0x11ce6: return CLICK[0x11ce6](eng); case 0x11cfe: return CLICK[0x11cfe](eng);
    case 0x12003: return pending(m, 0xac, 0, wx, wy); case 0x12027: return pending(m, 0xad, 0, wx, wy); case 0x1204b: return pending(m, 0xae, 0, wx, wy);
    case 0x1206f: return pending(m, 0xb0, 0, 0, 0); case 0x12085: return pending(m, 0xb1, 0, 0, 0);
    default: m.w16(UI.mode, eax & 0xffff); F[0x1308c](eng); return F[0x259b3](eng); } };
// ---------- панель: клики (0x120c0 ЛКМ, 0x12214 ПКМ)
const RECTS0 = 0x30c64, RECTS1 = 0x30d44;
// Сдвиг панели в широком окне (js/render/wide.js). Кадр там больше 640, панель уезжает к правому
// краю, а все её координаты в коде оригинала абсолютные и посчитаны от 512: прямоугольники кнопок
// (0x30c64), углы (0x268, 0x1c8), рамка мини-карты. Поэтому точку экрана переводим в «панельные»
// координаты вычитанием сдвига — саму таблицу прямоугольников не трогаем, она данные оригинала.
// В обычном кадре сдвиг нулевой, и всё считается как раньше, байт в байт.
const ШИРИНА_КАДРА = 0x6483c4, ВЫСОТА_КАДРА = 0x6483c8;
const ширКадра = (m) => m.u32(ШИРИНА_КАДРА) || 640, высКадра = (m) => m.u32(ВЫСОТА_КАДРА) || 480;
const ΔП = (m) => ((m.u32(ШИРИНА_КАДРА) || 640) - 640) | 0;
/** Номер прямоугольника панели, в который попала точка (таблицы 0x30c64 и 0x30d44). */
const hitRect = (m, base, n, x0, y) => { const x = x0 - ΔП(m); for (let i = 0; i < n; i++) { const b = base + i * 8; if (m.u16(b) > x) continue; if (m.u16(b + 4) < x) continue; if (m.u16(b + 2) > y) continue; if (m.u16(b + 6) >= y) return i; } return -1; };
const RECT_PTR = (i) => (0x130c64 + i * 8) >>> 0; // edx после поиска прямоугольника = адрес записи (в образе эталона данные сдвинуты на +0x100000)
/** Маленькая кнопка панели (переключатели прокачки): приказ 0xe1 с номером кнопки. */
const smallBtn = (n) => (eng, i) => { const m = eng.m; const s = m.u32(UI.sel); if (!s || !own(eng, s)) return; pending(m, 0xe1, n, (RECT_PTR(i) & ~0xff) | 2, i); };
/** Клетка инвентаря: левая кнопка надевает или применяет предмет. */
/** Режим «отдать/выложить вещь из ячейки n» — то же, что правый щелчок по ячейке. */
function отдатьИзЯчейки(eng, n) {
  const m = eng.m; const s = m.u32(UI.sel); if (!s) return;
  m.w8(UNITS + s + 0x51, n); return F[0x13237](eng, { eax: 6 });
}
const invBtn = (n) => (eng, i) => { const m = eng.m; if (!m.u8(UI.invBtn + n)) return; const s = m.u32(UI.sel);
  // Мясо надеть нельзя, и раньше левый тап по нему просто ничего не делал. Теперь короткий тап —
  // «собрать мясо вокруг» (уточнение владельца: это нужно чаще), а передача переехала на долгое
  // нажатие, то есть на правую кнопку — см. PANEL_R ниже.
  if (n >= 6 && m.u8(UI.invBtn + n) === 0x1e) {
    if (!ТАЧСХЕМА.замок) return;
    return ТАЧКНОПКИ.сборМяса ? ТАЧКНОПКИ.сборМяса() : отдатьИзЯчейки(eng, n);
  }
  if (n < 6 && m.u8(UNITS + s + U.TYPE) >= 4) return call(eng, 0x1fd8b);
  pending(m, 0xe1, n, RECT_PTR(i) & ~0xff, i); };
/** Долгое нажатие по ячейке инвентаря: сразу режим передачи, что бы там ни лежало. */
export function долгоПоЯчейке(eng, n) {
  const m = eng.m; if (!m.u8(UI.invBtn + n)) return false;
  отдатьИзЯчейки(eng, n); return true;
}
/** Кнопка команды k: то же, что и её горячая клавиша — вызов 0x13237 с номером команды. */
// Повторное нажатие той же командной кнопки СБРАСЫВАЕТ режим. Молоток («атака»), «идти», сон —
// все они включают режим курсора и ждут щелчка по цели; передумал — некуда деться, кроме правой
// кнопки, а на пальце её нет. Просьба владельца: «при повторном нажатии это действие должно
// сброситься».
const cmdBtn = (k) => (eng) => { const m = eng.m; const v = m.u8(UI.cmdBtn + k); if (!v) return;
  if (m.u16(UI.mode) === (v & 0xffff)) { m.w16(UI.mode, 0); F[0x1308c](eng); return F[0x259b3](eng); }
  return F[0x13237](eng, { eax: v }); };
/** Левая кнопка по панели: номер прямоугольника → что делать. 0 мини-карта, 1 меню, 2-6 прокачка,
 *  7-15 инвентарь, 19-27 кнопки команд (в том числе заклинания). */
const PANEL_L = { 0: (eng) => F[0x26510](eng), 1: (eng) => opt(eng, 0x20acb), 2: smallBtn(0), 3: smallBtn(1), 4: smallBtn(2), 5: smallBtn(3), 6: smallBtn(4),
  7: invBtn(0), 8: invBtn(1), 9: invBtn(2), 10: invBtn(3), 11: invBtn(4), 12: invBtn(5), 13: invBtn(6), 14: invBtn(7), 15: invBtn(8), 16: () => {}, 17: () => {}, 18: () => {},
  // 20 — иконка «отнести на базу». Короткий тап под тач-схемой уводит отряд в отступление (это
  // нужно куда чаще), а само «отнести» переехало на долгое нажатие — см. PANEL_R ниже.
  19: cmdBtn(0), 20: (eng) => (ТАЧСХЕМА.замок && ТАЧКНОПКИ.отступление) ? ТАЧКНОПКИ.отступление() : storeBtn(eng), 21: cmdBtn(2), 22: (eng) => buildBtn(eng), 23: cmdBtn(4), 24: cmdBtn(5), 25: cmdBtn(6), 26: cmdBtn(7), 27: cmdBtn(8) };
/** Кнопка «отнести еду»: найти ближайший склад и отправить туда выделенного. */
function storeBtn(eng) { const m = eng.m; if (!m.u8(UI.cmdBtn + 1)) return; const s = m.u32(UI.sel); if (m.u8(UNITS + s + 0x43) & 0xfc) return; if (m.u16(UNITS + s + U.FOOD) === 0) return call(eng, 0x1fd8b);
  const r = call(eng, 0x23da0, { esi: s }); if (r.cf) { call(eng, 0x1fd8b); return F[0x25c1e](eng); } const edi = r.edi >>> 0; const ex = m.u16(UNITS + edi + U.X), ey = m.u16(UNITS + edi + U.Y);
  let al = 6; if (m.u8(UNITS + s + 0x21) !== 0x1e) { al++; if (m.u8(UNITS + s + 0x22) !== 0x1e) { al++; if (m.u8(UNITS + s + 0x23) !== 0x1e) return call(eng, 0x1fd8b); } }
  m.w8(UNITS + s + 0x51, al); pending(m, (al + 0x51) & 0xff, edi, ex, ey); F[0x1fe5e](eng, { esi: m.u32(UI.sel) }); }
/** Кнопка стройки: у строителя открывает список зданий, у прочих — обычная команда. */
function buildBtn(eng) { const m = eng.m; const v = m.u8(UI.cmdBtn + 3); if (!v) return; const s = m.u32(UI.sel); if (m.u8(UNITS + s + U.TYPE) !== 4) return F[0x13237](eng, { eax: v });
  if (m.u8(UNITS + s + 0x59) === 0xe) return F[0x25c5a](eng); const tx = m.u8(UNITS + s + 0x53) << 5, ty = m.u8(UNITS + s + 0x54) << 5;
  call(eng, 0x1a42c, { esi: s, edx: tx, ebx: ty }); const ok = !F[0x1cdb1](eng, { esi: s }).cf; call(eng, 0x1a3db, { esi: s, edx: tx, ebx: ty });
  if (!ok) { F[0x25c3c](eng); return call(eng, 0x1fd8b); } pending(m, 0xe0, 0, 0, 0); }
F[0x1cdb1] = (eng, r) => { const m = eng.m; const s = r.esi; const k = m.u8(UNITS + s + 0x59); let ecx = m.u32(0x3176c + k * 8), edi = m.u32(0x31770 + k * 8); const tx = m.u8(UNITS + s + 0x53) << 5, ty = m.u8(UNITS + s + 0x54) << 5;
  for (; ecx; ecx--) { const z = call(eng, 0x1ce81, { esi: s, edx: (tx + m.u32(edi)) >>> 0, ebx: (ty + m.u32(edi + 4)) >>> 0 }); edi += 8; if (z.zf) return { cf: 1 }; } return { cf: 0 }; };
F[0x120c0] = (eng) => { const m = eng.m; if (m.u8(UI.cornerB) === 1) { m.w8(UI.cornerB, 0); F[0x1fd54](eng); opt(eng, 0x26e23); return opt(eng, 0x20acb); } m.w8(UI.cornerB, 0);
  const x = m.u32(M.evX), y = m.u32(M.evY); if (m.u8(UI.page) === 0) { const i = hitRect(m, RECTS0, 0x1c, x, y); if (i < 0) return; return PANEL_L[i](eng, i); }
  const i = hitRect(m, RECTS1, 0x11, x, y); if (i < 0) return; if (i === 0) return F[0x26510](eng); if (i === 1) return opt(eng, 0x20acb); return F[0x129e3](eng, { ebx: i }); };
F[0x129e3] = (eng, r) => { // заказ юнита в здании (кнопка ebx); при занятом здании — в очередь (prodqueue.js)
  const m = eng.m; const s = m.u32(UI.sel); const f = m.u8(UNITS + s + 0x50); if (f & 2) return;   // стройка/ремонт
  if (m.u8(UNITS + s + U.TYPE) === 0x1e && m.u32(G.food + m.u8(UNITS + s + U.OWNER) * 4) === 0) return call(eng, 0x1fd8b);
  const k = r.ebx - 2; if (m.u8(UI.bldBtn + k) !== 1) return; pending(m, 0x7f, k, 0, 0); F[0x1ff12](eng); };
F[0x12a2c] = (eng, r) => { const m = eng.m; const k = r.ebx - 2; if (m.u8(UI.bldBtn + k) !== 1) return; const s = m.u32(UI.sel); if (!(m.u8(UNITS + s + 0x50) & 1)) return; pending(m, 0x7e, k, 0, 0); F[0x1ff12](eng); };
/** Кнопка-флажок под мини-картой (сетка, номера и прочее). */
const flagBtn = (bit, n) => (eng) => { const m = eng.m; m.w8(0x31ac7, m.u8(0x31ac7) ^ bit); return F[0x25ba9](eng, { eax: n }); };
/** Правая кнопка по клетке инвентаря: снять надетое или выбросить. */
const invRight = (n) => (eng, i) => { const m = eng.m; if (!m.u8(UI.invBtn + n)) return; const s = m.u32(UI.sel);
  if (n < 6) { const slot = n < 3 ? U.WEAPON : U.SHIELD; if (m.u8(UNITS + s + slot) === n) return pending(m, 0xe1, n, (RECT_PTR(i) & ~0xff) | 1, i); }
  m.w8(UNITS + s + 0x51, n); return F[0x13237](eng, { eax: 6 }); };
/** Правая кнопка по панели: снять надетое, выбросить, отменить заказ, переключить флажки. */
const PANEL_R = { 0: (eng) => F[0x24525](eng), 1: () => {}, 2: flagBtn(0x10, 4), 3: flagBtn(8, 3), 4: flagBtn(4, 2), 5: flagBtn(2, 1), 6: flagBtn(1, 0) };
for (let n = 0; n < 12; n++) PANEL_R[7 + n] = invRight(n);
// Долгое нажатие приходит сюда как правая кнопка. По иконке «отнести на базу» это то самое
// «отнести», которое короткий тап уступил отступлению. По мясу долгое нажатие оставляем обычным
// правым щелчком — то есть передачей: короткий тап у мяса теперь занят сбором вокруг.
PANEL_R[20] = (eng) => storeBtn(eng);
F[0x12214] = (eng) => { const m = eng.m; const x = m.u32(M.evX), y = m.u32(M.evY);
  if (m.u8(UI.page) === 0) { const i = hitRect(m, RECTS0, 0x1c, x, y); if (i < 0) return; const h = PANEL_R[i]; return h ? h(eng, i) : undefined; }
  const i = hitRect(m, RECTS1, 0x11, x, y); if (i < 0) return; if (i === 0) return F[0x24525](eng); if (i === 1) return; return F[0x12a2c](eng, { ebx: i }); };
// ---------- приказ 0xe1: кнопки панели (0x19bbe). Номер кнопки — в +0x47, разновидность — в +0x4b:
// 0 инвентарь (надеть/применить/выбросить), 1 снять надетое, 2 переключатели прокачки статов.
// Раньше эта ветка не была портирована, и любое нажатие по инвентарю или по кнопкам HP/OP/DP/MP/VP
// валилось с «not ported: 0x19bbe».
const invAt = (m, esi, k) => m.u8(UNITS + esi + U.INV + k);
/** Строка состояния про предмет: его имя из таблицы 0x420b0 плюс приписка «надето/снято/применено». */
const statusOf = (m, item, second) => { m.w32(UI.statText, m.u32(0x420b0 + item * 4)); m.w32(UI.statText2, second); m.w16(UI.statLen, 0x24); };
F[0x25b06] = (eng, r) => statusOf(eng.m, r.eax & 0xff, 0x41939);   // «надето»
F[0x25b2a] = (eng, r) => statusOf(eng.m, r.eax & 0xff, 0x41940);   // «снято»
F[0x25b4e] = (eng, r) => statusOf(eng.m, r.eax & 0xff, 0x4194a);   // «использовано»
F[0x25b72] = (eng, r) => { const m = eng.m, n = r.eax & 0xff;      // подпись переключателя прокачки
  m.w32(UI.statText, m.u32(0x42290 + n * 4)); m.w16(UI.statLen, 0x24);
  m.w32(UI.statText2, ((m.u8(UNITS + r.esi + U.STAT0B) >> n) & 1) ? 0x41958 : 0x41967); };
// пять переключателей прокачки: бит маски +0x0b, спрайт кнопки и её x на панели
const STAT_TOGGLE = [[1, 0xb1d, 0x200], [2, 0xb1f, 0x219], [4, 0xb21, 0x232], [8, 0xb23, 0x24b], [0x10, 0xb25, 0x264]];
/** Переключатель прокачки: инвертировать бит в маске +0x0b и перерисовать кнопку. */
const statToggle = (n) => (eng, esi) => { const m = eng.m; const [bit, spr, x] = STAT_TOGGLE[n];
  m.w8(UNITS + esi + U.STAT0B, m.u8(UNITS + esi + U.STAT0B) ^ bit);
  const on = (m.u8(UNITS + esi + U.STAT0B) & bit) !== 0;
  if (m.u32(UI.sel) === esi && (m.u8(UI.mapFlags) & 1) && m.u8(UI.human) === m.u8(UNITS + esi + U.OWNER))
    opt(eng, 0x1f815, { eax: spr + (on ? 1 : 0), edx: x, ebx: 0x1a8 });
  F[0x25b72](eng, { eax: n, esi: m.u32(UI.sel) || esi });
};
/** Надеть оружие из клетки k (двуручное снимает щит). */
const equipWeapon = (eng, esi, k) => { const m = eng.m; m.w8(UNITS + esi + U.WEAPON, k);
  const it = invAt(m, esi, k); if (it >= 5 && it <= 7) m.w8(UNITS + esi + U.SHIELD, 0xff);   // двуручное снимает щит
  if (m.u32(UI.sel) === esi) F[0x26671](eng, { esi }); F[0x25b06](eng, { eax: invAt(m, esi, k) }); };
/** Надеть щит из клетки k (с двуручным оружием он не уживается). */
const equipShield = (eng, esi, k) => { const m = eng.m; m.w8(UNITS + esi + U.SHIELD, k);
  const w = m.u8(UNITS + esi + U.WEAPON);
  if (w !== 0xff) { const it = invAt(m, esi, w); if (it >= 5 && it <= 7) m.w8(UNITS + esi + U.WEAPON, 0xff); }
  if (m.u32(UI.sel) === esi) F[0x26671](eng, { esi }); F[0x25b06](eng, { eax: invAt(m, esi, k) }); };
/** Применить расходник: бонусы, звук, клетка пустеет. */
const useItem = (eng, esi, k) => { const m = eng.m; const it = invAt(m, esi, k);
  call(eng, 0x1c5d6, { eax: it, esi });                       // применить бонусы предмета
  opt(eng, 0x1ffb6, { eax: it, esi });                        // звук предмета
  m.w8(UNITS + esi + U.INV + k, 0);                           // предмет израсходован
  if (m.u32(UI.sel) === esi) { F[0x25b4e](eng, { eax: it }); F[0x26671](eng, { esi }); } };
/** Снять надетое из слота (оружие или щит). */
const unequip = (slot) => (eng, esi, k) => { const m = eng.m; m.w8(UNITS + esi + slot, 0xff);
  if (m.u32(UI.sel) === esi) { F[0x25b2a](eng, { eax: invAt(m, esi, k) }); F[0x26671](eng, { esi }); } };
F[0x19bbe] = (eng, r) => {
  const m = eng.m, esi = r.esi; const k = m.u8(UNITS + esi + 0x47), kind = m.u8(UNITS + esi + 0x4b);
  if (kind === 0) {                                            // таблица 0x19ee4
    if (k < 3) return equipWeapon(eng, esi, k);
    if (k < 6) return equipShield(eng, esi, k);
    if (k < 9) return useItem(eng, esi, k);
    return;                                                    // 9..11 — украшения: их не применяют, они просто надеты
  }
  if (kind === 1) {                                            // таблица 0x19f08
    if (k < 3) return unequip(U.WEAPON)(eng, esi, k);
    if (k < 6) return unequip(U.SHIELD)(eng, esi, k);
    return statToggle(k - 6)(eng, esi);
  }
  if (k < 5) return statToggle(k)(eng, esi);                    // таблица 0x19f20
};

F[0x25ba9] = (eng, r) => { const m = eng.m; const n = r.eax >>> 0; m.w32(UI.statText2, 0x41938); m.w16(UI.statLen, 0x24); m.w32(UI.statText, (m.u16(0x31ac7) >> n) & 1 ? m.u32(0x422f0 + n * 4) : m.u32(0x4237c + n * 4)); };
F[0x25c1e] = (eng) => setStatus(eng.m, 0x419a1); F[0x25c3c] = (eng) => setStatus(eng.m, 0x419b6); F[0x25c5a] = (eng) => setStatus(eng.m, 0x419c8);
F[0x25abd] = (eng, r) => { const m = eng.m; const i = r.esi; const t = m.u8(ITEMS + i); setStatus(m, m.u32(0x420b0 + t * 4)); if (t !== 0x1e) return;
  let n = m.u16(ITEMS + i + 6); let p = 0x446e8; do { p--; m.w8(p, 0x30 + (n % m.u16(0x446ee))); n = Math.floor(n / m.u16(0x446ee)); } while (n); // 0x28ab9 itoa
  let d = 0x42286; for (;;) { const c = m.u8(p++); m.w8(d++, c); if (!c) break; } };
// ---------- панель: заполнение состояния (рисование через opt)
const blit = (eng, fn, eax, edx, ebx, esi) => opt(eng, fn, { eax, edx, ebx, esi });
F[0x2693c] = (eng) => { const m = eng.m; m.w32(UI.page, 0); blit(eng, 0x1f815, 0xb19, 0x200, 0x100); for (let b = 0; b < 12; b++) m.w8(UI.invBtn + b, 0); };
F[0x2696a] = (eng) => { const m = eng.m; blit(eng, 0x1f815, 0xb18, 0x200, 0x80); for (let b = 0; b < 9; b++) m.w8(UI.cmdBtn + b, 0); };
F[0x26dfd] = (eng) => { const m = eng.m; blit(eng, 0x1f815, 0xb1a, 0x200, 0x80); for (let b = 0; b < 15; b++) m.w8(UI.bldBtn + b, 0); };
F[0x26671] = (eng, r) => { const m = eng.m; if (!(m.u8(UI.mapFlags) & 1)) return; F[0x2693c](eng); const i = r.esi; if (!i || !own(eng, i)) return;
  for (let k = 0; k < 12; k++) { const it = m.u8(UNITS + i + U.INV + k); if (!it) continue; m.w8(UI.invBtn + k, it); blit(eng, 0x1f815, it + 0x9de, m.u16(0x30c9c + k * 8), m.u16(0x30c9e + k * 8), i); }
  const w = m.u8(UNITS + i + U.WEAPON); if (w !== 0xff) blit(eng, 0x1f815, 0xa0a, m.u16(0x30c9c + w * 8) - 4, m.u16(0x30c9e + w * 8) - 3, i);
  const sh = m.u8(UNITS + i + U.SHIELD); if (sh !== 0xff) blit(eng, 0x1f815, 0xa0a, m.u16(0x30c9c + sh * 8) - 4, m.u16(0x30c9e + sh * 8) - 3, i); };
const FB = 0x1235f4; const ROW = 0x122ee8;
F[0x2673d] = (eng, r) => { const m = eng.m; if (!(m.u8(UI.mapFlags) & 1)) return; F[0x2696a](eng); const i = r.esi; if (!i || !own(eng, i)) return;
  m.w8(0x488e8, m.u8(0x30dcc + m.u8(UNITS + i + U.OWNER)));
  blit(eng, 0x1f720, m.u32(0x424dc + m.u8(UNITS + i + U.TYPE) * 4), m.u16(0x30cfc), m.u16(0x30cfe) - 4, i); blit(eng, 0x1f720, 0x9ff, m.u16(0x30d04), m.u16(0x30d06), i); blit(eng, 0x1f720, 0xa00, m.u16(0x30d0c), m.u16(0x30d0e), i);
  m.w8(UI.cmdBtn, 2); m.w8(UI.cmdBtn + 1, 6); m.w8(UI.cmdBtn + 2, 3);
  if (m.u8(UNITS + i + U.TYPE) === 4) { const k = m.u8(UNITS + i + 0x59); const spr = k < 2 ? (m.u8(UNITS + i + U.SLOT) * 2 + k + 0xa0b) : (k + 0xa19); blit(eng, 0x1f720, spr, m.u16(0x30d14), m.u16(0x30d16), i); m.w8(UI.cmdBtn + 3, (k + 1) & 0xff); return; }
  let ebp = m.u32(UNITS + i + U.SKILLS) >>> 8; let edi = 3;
  for (let ecx = 8; ecx <= 0x1f; ecx++) { const bit = ebp & 1; ebp >>>= 1; if (!bit) continue;
    m.w8(UI.cmdBtn + edi, (ecx + 1) & 0xff); const cannot = call(eng, 0x14873, { eax: ecx, esi: i }).cf;
    const sx = m.u16(0x30cfc + edi * 8) + m.u32(0x42540 + ecx * 16), sy = m.u16(0x30cfe + edi * 8) + m.u32(0x42544 + ecx * 16);
    if (!cannot) blit(eng, 0x1f720, m.u32(0x4253c + ecx * 16), sx, sy, i);
    else { blit(eng, 0x1f79f, m.u32(0x4253c + ecx * 16), sx, sy, i);
      const prod = (0x1e * m.u8(UNITS + i + U.MANA)) & 0xffff; const div = m.u8(0x30b41 + m.u32(0x30bbe + ecx * 4)); let al = div ? Math.floor(prod / div) & 0xff : 0;
      if (al) { let edx = m.u16(0x30cfc + edi * 8) + 2; const rb = m.u32(ROW + m.u16(0x30cfe + edi * 8) * 4); for (; al; al--) { edx++; for (const o of [0, 0x280, 0x500, 0x780]) m.w8(FB + edx + rb + o, 0x1e); } } }
    edi++; if (edi >= 9) return; } };
F[0x2698e] = (eng) => { const m = eng.m; if (!(m.u8(UI.mapFlags) & 1)) return; m.w8(0x427cb, 0); const s = m.u32(UI.sel); if (s && own(eng, s)) m.w8(0x427cb, m.u8(UNITS + s + U.STAT0B));
  const f = m.u8(0x427cb); let x = 0x200; for (const [spr, bit] of [[0xb1d, 1], [0xb1f, 2], [0xb21, 4], [0xb23, 8], [0xb25, 0x10]]) { blit(eng, 0x1f815, spr + ((f & bit) ? 1 : 0), x, 0x1a8); x += 0x19; } };
/** Напечатать строку шрифтом игры в кадровый буфер (адреса 0x47004/0x47008 — координаты вывода). */
const text = (eng, str, x, y) => { const m = eng.m; m.w32(0x47004, x); m.w32(0x47008, y); m.w8(0x4700c, 0xf8); opt(eng, 0x29c38, { esi: str }); };
F[0x25a46] = (eng, r) => { const m = eng.m; const save = m.u32(0x46ffc); m.w32(0x46ffc, 0x27f); const str = m.u32(0x41b18 + (m.u8(UNITS + r.esi + U.TYPE) - 0x1a) * 4); m.w32(0x47004, 0x20b); m.w32(0x47008, 0x95); m.w8(0x4700c, 0xf8); m.w8(0x4700d, 0); opt(eng, 0x29c38, { esi: str }); m.w32(0x46ffc, save); };
F[0x26d29] = (eng) => { const m = eng.m; if (!(m.u8(UI.mapFlags) & 1)) return; const s = m.u32(UI.sel); const edi = m.u32(UNITS + s + 0x33); let edx = m.u16(0x30d54 + edi * 8); const by = m.u16(0x30d56 + edi * 8);
  const d = m.u8(UNITS + s + U.F09); if (!d) return; let ecx = Math.floor((m.u8(UNITS + s + U.F0A) * 0x1e) / d) & 0xff; if (!ecx) return; const rb = m.u32(0x122e78 + by * 4);
  for (; ecx; ecx--) { edx++; for (const o of [0, 0x280, 0x500, 0x780]) m.w8(FB + edx + rb + o, 0x1e); } };
F[0x26d8c] = (eng, r) => { const m = eng.m; if (!(m.u8(UI.mapFlags) & 1)) return; const edi = m.u32(UNITS + r.esi + 0x33); const x = m.u16(0x30d54 + edi * 8) - 1, y = m.u16(0x30d56 + edi * 8) + 0x1a;
  m.w32(0x47004, x); m.w32(0x47008, y); m.w8(0x4700c, 0xf8); m.w8(0x4700d, 0); const save = m.u32(0x46ffc); m.w32(0x46ffc, 0x27f); const col = m.u32(0x47020); opt(eng, 0x29bbd, { eax: 0 }); opt(eng, 0x29c38, { esi: 0x427ae }); opt(eng, 0x29bbd, { eax: col }); m.w32(0x46ffc, save); };
F[0x26b34] = (eng, r) => { const m = eng.m; let { eax, ebx, ecx, edi, edx } = r; const s = m.u32(UI.sel);
  for (; ecx; ecx--) { const bit = edi & 1; edi >>>= 1;
    if (bit) { const bx = m.u16(0x30d54 + ebx * 8), by = m.u16(0x30d56 + ebx * 8);
      if (m.u8(0x427ad) & 1) { if (m.u8(0x427ac) === (ebx & 0xff)) { m.w8(UI.bldBtn + ebx, 1); blit(eng, 0x1f720, eax, bx, by, s); const p = m.u32(UNITS + s + 0x33); blit(eng, 0x1f815, 0xa0a, m.u16(0x30d54 + p * 8) - 4, m.u16(0x30d56 + p * 8) - 3, s); F[0x26d29](eng); if (m.u8(UNITS + s + 0x50) & 4) F[0x26d8c](eng, { esi: s }); }
        // Пока дом кого-то учит, остальные портреты раньше гасились и НЕ нажимались: заказать в
        // этом доме кого-то ещё было нельзя, пока не доучится текущий. Делалось это ради паузы по
        // еде — чтобы палец не промахнулся мимо нужной клетки и заказ не ушёл в очередь вместо
        // снятия паузы. Пауза теперь снимается сама, как только мясо донесли (economy.js), так что
        // повод отпал, а запрет мешал: жалоба владельца — «при постройке в здании блокируешь все
        // остальные постройки». Портреты снова живые, любой вид можно поставить в очередь.
        else { m.w8(UI.bldBtn + ebx, 1); blit(eng, 0x1f720, eax, bx, by, s); } }
      else { m.w8(UI.bldBtn + ebx, 1); blit(eng, 0x1f720, eax, bx, by, s); } }
    eax++; ebx++; edx = (edx + 1) >>> 0; } };
F[0x26c4f] = (eng) => { const m = eng.m; blit(eng, 0x1f815, 0xb29, 0x20b, 0xbc);
  if (m.u32(UI.hoverShown) !== 0) { const save = m.u32(0x46ffc); m.w32(0x46ffc, 0x27f); const edi = m.u32(UI.hoverShown) - 1; const pg = m.u32(UI.page) - 1; const str = m.u32(0x427cc + (pg << 7) + edi * 4);
    m.w32(0x47004, 0x20b); m.w32(0x47008, 0xbc); m.w8(0x4700c, 0xf8); opt(eng, 0x29c38, { esi: str });
    if (m.u32(UI.page) !== 5) { m.w32(0x47004, 0x20b); m.w32(0x47008, 0xce); opt(eng, 0x29c38, { esi: 0x427b4 });
      const b5 = pg << 5; const cost = (m.u8(0x315ac + edi + b5) * m.i32(0x30eac + (edi << 2) + b5 * 4)) >>> 0; // imul eax * dword
      let p = 0x446e8; let n = cost; do { p--; m.w8(p, 0x30 + (n % m.u32(0x446ea))); n = Math.floor(n / m.u32(0x446ea)); } while (n);
      opt(eng, 0x29c38, { esi: p }); opt(eng, 0x29c38, { esi: 0x427bb }); }
    m.w32(0x46ffc, save); }
  m.w32(UI.hover, 0); };
F[0x26a5d] = (eng, r) => { const m = eng.m; if (!(m.u8(UI.mapFlags) & 1)) return; const i = r.esi; if (!own(eng, i)) { F[0x2693c](eng); F[0x2696a](eng); return F[0x2698e](eng); }
  F[0x26dfd](eng); const s = m.u32(UI.sel); m.w8(0x488e8, m.u8(0x30dcc + m.u8(UNITS + s + U.OWNER))); F[0x25a46](eng, { esi: s });
  // Флаг «здание чем-то занято» пишем ДО выхода. Раньше выход по «дом ещё строится» (бит 2)
  // оставлял в 0x427ad значение от ПРЕДЫДУЩЕГО выделенного дома: если тот что-то учил, признак
  // «занято» прилипал, и у следующего дома портреты гасли ни с того ни с сего.
  m.w8(0x427ac, m.u8(UNITS + s + 0x33)); const al = m.u8(UNITS + s + 0x50); m.w8(0x427ad, al); if (al & 2) return;
  const ebx = m.u8(UNITS + s + U.TYPE) - 0x1a; const edi = m.u32(m.u32(0x30e88 + m.u8(UNITS + s + U.SLOT) * 4) + ebx * 4);
  if (ebx === 0) { F[0x26b34](eng, { eax: m.u8(UNITS + s + U.SLOT) * 2 + 0xa0b, ecx: 2, ebx: 0, edi, edx: 0 }); F[0x26b34](eng, { eax: 0xa1b, ecx: 0xd, ebx: 2, edi: edi >>> 2, edx: 0 }); }
  else F[0x26b34](eng, { ecx: m.u32(0x4273c + ebx * 8), eax: m.u32(0x42740 + ebx * 8), ebx: 0, edi, edx: 0 });
  return F[0x26c4f](eng); };
F[0x25952] = (eng, r) => { const m = eng.m; const i = r.esi; const t = m.u8(UNITS + i + U.TYPE); if (t >= 0x1a) return setStatus(m, m.u32(0x41c48 + t * 4)); const st = m.u8(UNITS + i + U.STATE); if (st > 0x60) return; setStatus(m, m.u32(0x41bdc + (st >> 4) * 4)); };
F[0x25a14] = (eng, r) => { const m = eng.m; const i = r.esi; m.w32(UI.statText, m.u32(0x41a68 + m.u8(UNITS + i + U.SLOT) * 4)); m.w32(UI.statText2, m.u32(0x41c48 + m.u8(UNITS + i + U.TYPE) * 4)); m.w16(UI.statLen, 0x24); };
F[0x259e4] = (eng, r) => { const i = r.esi; if (!own(eng, i)) { F[0x2693c](eng); F[0x2696a](eng); return F[0x25a14](eng, { esi: i }); } F[0x26671](eng, { esi: i }); F[0x2673d](eng, { esi: i }); return F[0x25952](eng, { esi: i }); };
// ---------- горячие клавиши (0x10d44)
// Цифры 1..0 (скан-коды 0x02..0x0b) — группы: с Ctrl назначить, без Ctrl выбрать (0x1107b).
// В таблице оригинала 0x10d74 они есть, а в порту их не было, и группы не работали вовсе.
const HOTKEYS = { 0x02: 0x1107b, 0x03: 0x1107b, 0x04: 0x1107b, 0x05: 0x1107b, 0x06: 0x1107b,
  0x07: 0x1107b, 0x08: 0x1107b, 0x09: 0x1107b, 0x0a: 0x1107b, 0x0b: 0x1107b,
  0x01: 0x20acb, 0x0f: 0x26510, 0x11: 0x26510, 0x19: 0x20bec, 0x1c: 0x10fbc, 0x1e: 0x1104d, 0x22: 0x11061, 0x29: 0x24525, 0x2c: 0x11057, 0x31: 0x11207, 0x37: 0x275b4, 0x39: 0x1103e, 0x3b: 0x1127e, 0x3c: 0x112a1, 0x3d: 0x112af, 0x3e: 0x112e2, 0x3f: 0x112e8, 0x40: 0x112e8, 0x41: 0x112e8, 0x42: 0x112e8, 0x44: 0x20acb, 0x4e: 0x11025 };
for (let sc = 2; sc <= 0xb; sc++) HOTKEYS[sc] = 0x1107b;
const SCREENS = new Set([0x20acb, 0x1127e, 0x112a1, 0x112af, 0x112e2, 0x275b4, 0x20bec]); // модальные экраны: только если портированы
F[0x10d44] = (eng) => { const m = eng.m;
  while (m.u32(K.wr) !== m.u32(K.rd)) { const r = F[0x28d11](eng); const al = r.eax & 0xff, ah = (r.eax >> 8) & 0xff;
    if (ah !== 0 && m.u8(0x333c9) !== 0) { F[0x10f83](eng, { eax: r.eax }); continue; }
    const h = HOTKEYS[al]; if (!h) continue; if (SCREENS.has(h)) { opt(eng, h); continue; } F[h](eng, { eax: al }); } };
F[0x1104d] = (eng) => F[0x13237](eng, { eax: 2 }); F[0x11057] = (eng) => F[0x13237](eng, { eax: 3 }); F[0x11061] = (eng) => F[0x13237](eng, { eax: 4 });
F[0x11025] = (eng) => { const m = eng.m; const v = m.u8(0x31ac8) ^ 1; m.w8(0x31ac8, v); m.w8(0x31ac7, v ? 0x1f : 0); };
F[0x1103e] = (eng) => { const s = eng.m.u32(UI.sel); if (s) F[0x1113c](eng, { esi: s }); };
F[0x11093] = (eng, r) => { // выбрать группу al
  // Владельца оригинал не проверял: в его мире цифры ставил только человек, у чужих байт всегда
  // нулевой. У нас цифры раздаёт и автопривязка, и снимок соперника может принести чужие — тогда
  // нажатие цифры выделяло вражеского юнита. Поэтому берём только своих.
  const m = eng.m; const al = r.eax & 0xff; const я = m.u8(UI.human);
  m.w32(UI.sel, 0); let i = m.u32(G.unitHead); if (!i) return call(eng, 0x1a65d);
  for (; i; i = m.u32(UNITS + i + U.NEXT)) { m.w8(UNITS + i + 7, m.u8(UNITS + i + 7) & 0x7f);
    if (m.u8(UNITS + i + 7) !== al || m.u8(UNITS + i + U.OWNER) !== я) continue;
    m.w8(UNITS + i + 7, m.u8(UNITS + i + 7) | 0x80); if (m.u32(UI.sel) === 0) m.w32(UI.sel, i); }
  const s = m.u32(UI.sel); if (s) F[0x11c13](eng, { esi: s }); };
F[0x1107b] = (eng, r) => { const m = eng.m; const al = (r.eax - 1) & 0xff;
  if (m.u8(K.ctrl) === 1) { for (let i = m.u32(G.unitHead); i; i = m.u32(UNITS + i + U.NEXT)) { if ((m.u8(UNITS + i + 7) & 0x7f) === al) m.w8(UNITS + i + 7, m.u8(UNITS + i + 7) & 0x80); if (m.u8(UNITS + i + 7) & 0x80) m.w8(UNITS + i + 7, (m.u8(UNITS + i + 7) & 0x80) | al); } return; }
  if (m.u8(K.alt) === 1) { F[0x11093](eng, { eax: al }); const s = m.u32(UI.sel); if (s) F[0x1113c](eng, { esi: s }); return; }
  return F[0x11093](eng, { eax: al }); };
F[0x11207] = (eng) => { // следующий свой юнит
  const m = eng.m; const al = m.u8(UI.human); let i = m.u32(UI.sel); const alive = (u) => !(m.u8(UNITS + u + U.FLAGS5B) & 1) && m.u8(UNITS + u + U.STATE) !== 0x60 && m.u8(UNITS + u + U.OWNER) === al;
  if (!i) { i = m.u32(G.unitHead); for (; i; i = m.u32(UNITS + i + U.NEXT)) if (alive(i)) return found(eng, i); } else { for (i = m.u32(UNITS + i + U.NEXT); i; i = m.u32(UNITS + i + U.NEXT)) if (alive(i)) return found(eng, i); }
  if (!m.u32(UI.sel)) return; for (i = m.u32(G.unitHead); m.u32(UI.sel) !== i; i = m.u32(UNITS + i + U.NEXT)) { if (!(m.u8(UNITS + i + U.FLAGS5B) & 1) && m.u8(UNITS + i + U.OWNER) === al) return found(eng, i); if (!i) return; }
  function found(eng, u) { F[0x11c13](eng, { esi: u }); F[0x1113c](eng, { esi: u }); } };
F[0x112e8] = (eng, r) => { const m = eng.m; const k = (r.eax - 0x3f) & 0xff;
  if (m.u8(K.ctrl) === 1) { m.w8(0x31b08 + k, 1); m.w32(0x31b0c + k * 8, m.u32(UI.camX)); m.w32(0x31b10 + k * 8, m.u32(UI.camY)); return; }
  if (m.u8(0x31b08 + k) !== 1) return; m.w32(UI.camX, m.u32(0x31b0c + k * 8)); m.w32(UI.camY, m.u32(0x31b10 + k * 8)); };
F[0x10fbc] = (eng) => { const m = eng.m; m.w8(0x333c9, 0xfc); m.w8(0x335ca, 0); opt(eng, 0x2a338, { esi: 0x335ca, ecx: 0x3a, edx: 0x48, ebx: 0x1b0 }); };
F[0x10fe3] = (eng) => { const m = eng.m; for (let k = 0; k < 8; k++) { if (m.u8(0x333c2 + k) === 0) continue; m.w8(0x333c1 + k, m.u8(0x333c2 + k)); m.w8(0x333b8 + k, m.u8(0x333b9 + k));
    const dst = 0x333ca + (k << 6), src = dst + 0x40; for (let c = 0; c < 0x3f; c++) { const v = m.u8(src + c); m.w8(dst + c, v); if (!v) break; if (c === 0x3e) m.w8(dst + 0x3f, 0); } } };
F[0x10f83] = (eng, r) => { const m = eng.m; if (!F[0x2a465]) return; const res = F[0x2a465](eng, r) || {}; if (res.cf) { m.w8(0x333c9, 0); return; } if ((r.eax & 0xff) !== 0x1c) return; F[0x10fe3](eng); F[0x27844](eng); m.w8(0x333c9, 0); };
F[0x27844] = (eng) => { const m = eng.m; let eax = 0, edx = 0; for (let p = 0x3358a; ; p++) { const b = m.u8(p); if (!b) break; eax = ((eax + b) << 1) >>> 0; edx++; }
  for (let k = 0; k < 12; k++) { if (m.u32(0x43560 + k * 8) === eax && m.u32(0x43564 + k * 8) === edx) return opt(eng, CHEAT_H[k]); } };
const CHEAT_H = [0x27883,0x244b1,0x244c3,0x278a1,0x27919,0x27959,0x2797e,0x2799e,0x279e0,0x27a22,0x27ae3,0x27b55]; // чит-коды чата (таблица 0x43560/0x27b98)
