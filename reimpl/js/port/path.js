// Поиск пути: три режима, переключаются на лету кнопкой «path» в панели под картинкой.
//
//   orig   — как в оригинале. Маршрута нет: движок гоняет две зеркальные симуляции обхода
//            «прижатием к стене» (0x1e399 и 0x1e1c5) не длиннее 200 шагов и берёт из них точку,
//            ближе всего подошедшую к цели. В лабиринтах и вдоль длинных стен застревает.
//   orig+  — тот же обход, но без пустого ожидания. Упёршийся юнит держит в [+0x40] счётчик
//            3..12 и каждый тик переспрашивает, не освободилась ли клетка впереди; для другого
//            юнита это разумно, для стены или здания ждать нечего. Различает их сам 0x1e685
//            (eax 2 — там юнит, 1 и 0 — здание или ландшафт).
//   astar  — маршрут A* по сетке, и юнит идёт по нему шаг за шагом.
//
// Про режим astar важное. Точку назначения движок держит в DSTX/DSTY и сам же затирает её тем,
// что вернёт 0x1e11e (0x1de57, ветка после 0x1df84). Поэтому «вернуть промежуточную точку
// маршрута» нельзя: дойдя до неё, юнит видит X == DSTX и считает приказ выполненным — так в
// первой попытке юниты вставали на полпути. Здесь вместо этого подменяется сам выбор шага
// (0x1de57): цель не трогаем вообще, а на каждом тайле отдаём движку направление на следующую
// клетку маршрута. Прибытие тогда наступает ровно на настоящей цели.
//
// Режим общий для всех: и юниты игрока, и компьютерные, и звери.
import { F, call } from '../fn.js';
import { G, U, UNITS, BI, BG, MO } from '../mem.js';

export const MODES = ['orig', 'orig+', 'astar'];
// По умолчанию astar: замер на «доме поперёк дороги» — orig стоит на месте 20 тиков из 77
// (ждёт, что здание уйдёт), orig+ 8 из 65, astar 0 из 57. Оригинальный обход остаётся кнопкой.
let MODE = 'astar';
/** Текущий способ поиска пути (в игре всегда astar; остальные — для стенда). */
export const pathMode = () => MODE;
/** Сменить способ поиска пути; неизвестное имя откатывается к оригинальному. */
export function setPathMode(v) { MODE = MODES.includes(v) ? v : 'orig'; return MODE; }

const TILE_INF = 0x3183c;
const DIR_TILE = 0x30504, DIR_PIX = 0x30528;   // смещения направления 1..8: в клетках и в пикселях
const W = 256, N = W * W;
const LIMIT = 12000;                  // потолок раскрытых клеток за вызов
const UNIT_COST = 12;                 // клетка занята чужим юнитом: пройти можно, но неохотно
const SQUEEZE_COST = 40;              // протискивание по диагонали между двумя занятыми клетками
const WAIT_CAP = 6;                   // столько тиков ждём, пока чужой юнит уйдёт, потом объезд

// ---------------------------------------------------------------- проходимость
// Ландшафт за партию не меняется — считаем один раз. Занятость читаем каждый раз из BI/MO:
// в BI у занятой клетки стоит (владелец+1)<<2 и у юнита, и у здания, а различает их младший
// ниббл MO — у наземного юнита там направление 1..8, у здания 0 (так же делает 0x1e685).
function terrain(eng) {
  const m = eng.m;
  const w = m.u32(G.mapW), h = m.u32(G.mapH);
  const stamp = (w << 20) | (h << 8) | m.u8(0x33839);
  if (eng._terrStamp === stamp && eng._terr) return eng._terr;
  const t = new Uint8Array(N);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const tile = m.u16(BG + (y << 9) + x * 2);
      t[x + (y << 8)] = (tile & 0xf800) ? 0 : (m.u8(TILE_INF + tile) & 1);
    }
  eng._terr = t; eng._terrStamp = stamp; eng._terrW = w; eng._terrH = h;
  return t;
}

/** 0 — не пройти, 1 — свободно, 2 — стоит юнит (пройти можно, но дорого). */
function cell(eng, t, x, y) {
  if (x < 0 || y < 0 || x >= eng._terrW || y >= eng._terrH) return 0;
  const i = x + (y << 8), m = eng.m;
  if (!t[i]) return 0;
  if (m.u8(BI + i) & 0xfc) return (m.u8(MO + i) & 0x0f) ? 2 : 0;
  return 1;
}

// ---------------------------------------------------------------- A*
// Буферы живут на движке и переиспользуются: массивы на 65536 клеток слишком дороги, чтобы
// заводить их на каждый вызов. Вместо очистки — номер поколения в seen[]/closed[].
function buffers(eng) {
  let b = eng._astar;
  if (!b) b = eng._astar = { g: new Int32Array(N), from: new Int32Array(N), f: new Int32Array(N),
                             seen: new Int32Array(N), closed: new Int32Array(N), heap: new Int32Array(4096), gen: 0 };
  b.gen++;
  return b;
}

const DIRS = [];                      // [dx, dy, направление 1..8]
/** Восемь направлений шага в клетках — из таблицы движка, считается один раз. */
function dirs(eng) {
  if (!DIRS.length) { const m = eng.m; for (let d = 1; d <= 8; d++) DIRS.push([m.i16(DIR_TILE + d * 4), m.i16(DIR_TILE + d * 4 + 2), d]); }
  return DIRS;
}
/** Направление 1..8 по смещению на одну клетку, 0 — если смещение не соседнее. */
function dirOf(eng, dx, dy) {
  for (const [ax, ay, d] of dirs(eng)) if (ax === dx && ay === dy) return d;
  return 0;
}

/** A* от клетки юнита до (gx,gy). Возвращает массив клеток [x,y] без стартовой или null. */
export function findPath(eng, esi, gx, gy) {
  const m = eng.m, t = terrain(eng);
  const sx = m.u16(UNITS + esi + U.X) >>> 5, sy = m.u16(UNITS + esi + U.Y) >>> 5;
  if (sx === gx && sy === gy) return null;
  if (gx < 0 || gy < 0 || gx >= eng._terrW || gy >= eng._terrH || !t[gx + (gy << 8)]) return null;
  const b = buffers(eng), { g, from, f, seen, closed, gen } = b;
  const start = sx + (sy << 8), goal = gx + (gy << 8);
  const oct = (x, y) => { const a = Math.abs(x - gx), c = Math.abs(y - gy); return 10 * (a + c) - 6 * (a < c ? a : c); };
  let heap = b.heap, hn = 0;
  const push = (n) => {
    if (hn === heap.length) { const nh = new Int32Array(hn * 2); nh.set(heap); heap = b.heap = nh; }
    let i = hn++; heap[i] = n;
    while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[heap[i]]) break; const q = heap[p]; heap[p] = heap[i]; heap[i] = q; i = p; }
  };
  const pop = () => {
    const top = heap[0]; heap[0] = heap[--hn];
    for (let i = 0;;) { const l = i * 2 + 1, r = l + 1; let s = i;
      if (l < hn && f[heap[l]] < f[heap[s]]) s = l;
      if (r < hn && f[heap[r]] < f[heap[s]]) s = r;
      if (s === i) break; const q = heap[s]; heap[s] = heap[i]; heap[i] = q; i = s; }
    return top;
  };
  seen[start] = gen; g[start] = 0; f[start] = oct(sx, sy); from[start] = -1;
  push(start);
  const D = dirs(eng);
  let expanded = 0, found = false;
  while (hn) {
    const cur = pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (cur === goal) { found = true; break; }
    if (++expanded > LIMIT) return null;
    const cx = cur & 0xff, cy = cur >> 8;
    for (let k = 0; k < 8; k++) {
      const dx = D[k][0], dy = D[k][1], nx = cx + dx, ny = cy + dy;
      const c = (nx === gx && ny === gy) ? 1 : cell(eng, t, nx, ny);   // в саму цель пускаем всегда
      if (!c) continue;
      // Диагональ между двумя занятыми клетками движок пропускает: 0x1e685 смотрит у соседей
      // только младший ниббл MO и сравнивает его с конкретным направлением, то есть ловит
      // встречный ход юнита, а не стену. Раньше мы такие ходы запрещали совсем — и запертый
      // между постройками юнит получал «пути нет» там, где оригинал спокойно проходил.
      // Теперь протискивание разрешено, но дорого: обычный обход всегда выгоднее.
      let squeeze = 0;
      if (dx && dy) {
        const a = cell(eng, t, cx + dx, cy), b2 = cell(eng, t, cx, cy + dy);
        if (!a && !b2) squeeze = SQUEEZE_COST;
        else if (!a || !b2) squeeze = SQUEEZE_COST >> 2;
      }
      const n = nx + (ny << 8);
      if (closed[n] === gen) continue;
      const ng = g[cur] + (dx && dy ? 14 : 10) + (c === 2 ? UNIT_COST : 0) + squeeze;
      if (seen[n] === gen && ng >= g[n]) continue;
      seen[n] = gen; g[n] = ng; from[n] = cur; f[n] = ng + oct(nx, ny); push(n);
    }
  }
  if (!found) return null;
  const path = [];
  for (let n = goal; n !== start && n !== -1; n = from[n]) path.push([n & 0xff, n >> 8]);
  path.reverse();
  return path.length ? path : null;
}

// ---------------------------------------------------------------- маршрут на юнита
// Кэш: пока цель та же и юнит стоит на своём маршруте, A* заново не гоняем. Запись юнита после
// смерти переиспользуется, поэтому кэш годен только если цель совпала и следующая точка
// маршрута — соседняя клетка; иначе строим заново, и устаревшая запись просто не подойдёт.
const paths = new WeakMap();          // eng → Map(esi → {gx, gy, path, i})
/** Кэш маршрутов этого движка: юнит → путь и индекс пройденной точки. */
function routeMap(eng) { let r = paths.get(eng); if (!r) paths.set(eng, r = new Map()); return r; }
/** Забыть маршрут юнита (он получил новый приказ). */
export function dropRoute(eng, esi) { routeMap(eng).delete(esi); }
/** Кэш маршрутов целиком — это часть состояния симуляции (индекс пройденной точки в том числе),
 *  в память движка он не входит, поэтому в сетевой игре едет вместе со снимком. */
export function dumpRoutes(eng) { return [...routeMap(eng)].map(([esi, c]) => [esi, c.gx, c.gy, c.i, c.path.flat()]); }
/** Маршруты из снимка: они часть состояния симуляции, а не кэш. */
export function restoreRoutes(eng, список) {
  const map = routeMap(eng); map.clear();
  for (const [esi, gx, gy, i, плоско] of список || []) {
    const path = []; for (let k = 0; k + 1 < плоско.length; k += 2) path.push([плоско[k], плоско[k + 1]]);
    map.set(esi, { gx, gy, path, i });
  }
}

/** Следующая клетка маршрута к (gx,gy) или null. */
function nextStep(eng, esi, gx, gy) {
  const m = eng.m, map = routeMap(eng);
  const sx = m.u16(UNITS + esi + U.X) >>> 5, sy = m.u16(UNITS + esi + U.Y) >>> 5;
  const near = (p) => Math.abs(p[0] - sx) <= 1 && Math.abs(p[1] - sy) <= 1 && !(p[0] === sx && p[1] === sy);
  const c = map.get(esi);
  if (c && c.gx === gx && c.gy === gy) {
    let i = c.i;
    while (i < c.path.length && c.path[i][0] === sx && c.path[i][1] === sy) i++;   // пройденные пропускаем
    if (i < c.path.length && near(c.path[i])) { c.i = i; return c.path[i]; }
  }
  const path = findPath(eng, esi, gx, gy);
  if (!path) { map.delete(esi); return null; }
  map.set(esi, { gx, gy, path, i: 0 });
  return near(path[0]) ? path[0] : null;
}

// ---- 0x1de57: выбор направления на тайле. В режиме astar ведём юнита по маршруту.
// Возврат тот же, что у оригинала: {eax: направление, ecx: 0 — шаг, 3 — стоим и ждём, edi: 0}.
// eax == 0 означает «пришли», и мы отдаём его только на самой цели — DSTX/DSTY не трогаются,
// поэтому приказ завершается именно там, где его выдали.
const orig1de57 = F[0x1de57];
F[0x1de57] = (eng, r) => {
  if (MODE !== 'astar') return orig1de57(eng, r);
  const m = eng.m, esi = r.esi;
  if (m.u8(UNITS + esi + U.TYPE) === 0xb) return orig1de57(eng, r);       // летающим препятствий нет
  if (m.u32(UNITS + esi + U.X) === m.u32(UNITS + esi + U.DSTX)) return { eax: 0 };
  const gx = m.u16(UNITS + esi + U.DSTX) >>> 5, gy = m.u16(UNITS + esi + U.DSTY) >>> 5;
  const sx = m.u16(UNITS + esi + U.X) >>> 5, sy = m.u16(UNITS + esi + U.Y) >>> 5;
  if (sx === gx && sy === gy) return { eax: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    let step = null;
    try { step = nextStep(eng, esi, gx, gy); } catch { step = null; }
    if (!step) break;
    const d = dirOf(eng, step[0] - sx, step[1] - sy);
    if (!d) { dropRoute(eng, esi); continue; }
    const t = call(eng, 0x1e685, { esi, ebp: d,
      edx: (m.u16(UNITS + esi + U.X) + m.u16(DIR_PIX + d * 4)) & 0xffff,
      ebx: (m.u16(UNITS + esi + U.Y) + m.u16(DIR_PIX + d * 4 + 2)) & 0xffff });
    if (!t.zf) { m.w8(UNITS + esi + 0x40, 0); return { eax: d, ecx: 0, edi: 0 }; }   // свободно — шаг
    if ((t.eax & 0xff) >= 2) return { eax: d, ecx: 3, edi: 0 };                      // там юнит — подождём
    dropRoute(eng, esi);                                                             // стена появилась — пересчёт
  }
  return orig1de57(eng, r);                                               // маршрута нет — как в оригинале
};

// ---- 0x1e11e: запасной путь — сюда попадаем, только если маршрута нет и выше ушли в
// оригинальный 0x1de57. Заново A* не гоняем (он там уже не нашёл дороги): если маршрут всё же
// лежит в кэше, отдаём неизменённую цель — так движок не затрёт DSTX/DSTY промежуточной точкой —
// и подсказываем сторону обхода по маршруту. Иначе работает оригинал как есть.
// Оба набора ячеек результата заполняем одинаково: 0x1e099 смотрит 0x3796e при стороне 0 и
// 0x3797a при стороне 1, и если заполнить только один, он сочтёт маршрут негодным и остановит юнита.
const orig1e11e = F[0x1e11e];
F[0x1e11e] = (eng, r) => {
  if (MODE !== 'astar') return orig1e11e(eng, r);
  const m = eng.m, esi = r.esi;
  const px = m.u16(UNITS + esi + U.DSTX), py = m.u16(UNITS + esi + U.DSTY);
  const gx = px >>> 5, gy = py >>> 5;
  const c = routeMap(eng).get(esi);
  if (!c || c.gx !== gx || c.gy !== gy || c.i >= c.path.length) return orig1e11e(eng, r);
  const sx = m.u16(UNITS + esi + U.X) >>> 5, sy = m.u16(UNITS + esi + U.Y) >>> 5;
  const k = Math.min(c.path.length - 1, c.i + 3);
  const side = (c.path[k][0] - sx) * (gy - sy) - (c.path[k][1] - sy) * (gx - sx) > 0 ? 1 : 0;
  m.w16(0x3796c, 0); m.w16(0x3796e, 1); m.w16(0x37970, px); m.w16(0x37972, py); m.w16(0x37974, 0); m.w16(0x37976, 1);
  m.w16(0x37978, 0); m.w16(0x3797a, 1); m.w16(0x3797c, px); m.w16(0x3797e, py); m.w16(0x37980, 0); m.w16(0x37982, 1);
  return { eax: side, edx: px, ebx: py, ecx: 0 };
};

// ---- 0x1dc43: сколько ждать, упёршись.
// orig+ : если впереди стена или здание (0x1e685 вернул eax 0, а не 2), ждать нечего — сразу
//         выставляем счётчик в 12, и оригинал в этом же тике уходит на перепланировку.
// astar : ветку ожидания оригинала не пускаем дальше вообще. Она опасна: как только клетка
//         впереди освобождается, оригинал зовёт 0x1df84, а тот при непрямом пути возвращает
//         текущие координаты юнита, они попадают в DSTX/DSTY — и приказ обрывается на полпути.
//         Поэтому решаем сами: впереди свободно — обнуляем счётчик и идём по маршруту; стоит
//         чужой юнит — ждём, но не дольше WAIT_CAP тиков, дальше строим объезд; появилась
//         стена или здание — сразу перестраиваем маршрут.
const orig1dc43 = F[0x1dc43];
F[0x1dc43] = (eng, r) => {
  const m = eng.m, esi = r.esi, w = m.u8(UNITS + esi + 0x40);
  // В режиме astar вмешиваемся только пока у юнита есть маршрут. Если A* дороги не нашёл, мы уже
  // ушли в оригинальный обход — и там счётчик ожидания должен расти до 12, иначе юнит топчется
  // на месте вечно: обнулять его каждый тик значит не давать оригиналу перепланировать.
  if (MODE === 'astar' && !routeMap(eng).has(esi)) return orig1dc43(eng, r);
  if (MODE !== 'orig' && w > 1 && m.u16(UNITS + esi + 0x3b) === 0 && m.u8(UNITS + esi + U.TYPE) !== 0xb) {
    const ebp = m.u16(UNITS + esi + U.DIR);
    const t = call(eng, 0x1e685, { esi, ebp,
      edx: (m.u16(UNITS + esi + U.X) + m.u16(DIR_PIX + ebp * 4)) & 0xffff,
      ebx: (m.u16(UNITS + esi + U.Y) + m.u16(DIR_PIX + ebp * 4 + 2)) & 0xffff });
    const занято = t.zf, юнит = (t.eax & 0xff) >= 2;
    if (MODE === 'astar') {
      if (!занято) m.w8(UNITS + esi + 0x40, 0);
      else if (!юнит || w >= WAIT_CAP) { dropRoute(eng, esi); m.w8(UNITS + esi + 0x40, 0); }
    } else if (занято && !юнит && w < 0xc) m.w8(UNITS + esi + 0x40, 0xc);
  }
  return orig1dc43(eng, r);
};
