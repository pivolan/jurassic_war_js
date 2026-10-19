// Адаптер ввода: браузерные события → кольца мыши/клавиатуры оригинала (то, что делали обработчики int 33h и int 9).
// Координаты — в системе кадра игры. Раньше это всегда было 640×480, теперь кадр может быть
// шире (js/render/wide.js), поэтому масштабируем в РАЗМЕР КАНВЫ: она и есть кадр один к одному. Маска события мыши: 1 движение, 2 ЛКМ нажата, 4 ЛКМ отпущена, 8 ПКМ нажата, 0x10 ПКМ отпущена, 0x20/0x40 средняя.
const M = { ring: 0x450e4, wr: 0x450dc, rd: 0x450e0, x: 0x45098, y: 0x4509c, mx: 0x450a0, my: 0x450a4, btn: 0x450a8, moved: 0x450ac, lastMask: 0x45094, savedBx: 0x46264, hidden: 0x45091 };
const K = { held: 0x44768, edge: 0x44708, ring: 0x447d0, wr: 0x447c8, rd: 0x447cc };
const FLAG = { 2: 0x450b0, 4: 0x450b4, 8: 0x450b8, 0x10: 0x450bc, 0x20: 0x450c0, 0x40: 0x450c4 };
// Границы кадра: пока кадр был всегда 640×480, здесь стояли зашитые 639/479, и в широком окне
// (js/render/wide.js) курсор упирался в них посреди экрана — до правого и нижнего краёв мышь
// просто не доходила, поэтому и автопрокрутка на этих краях не срабатывала. Берём размер
// из самого кадра (0x6483c4/0x6483c8); в меню там 640×480, как и было.
const КАДР_Ш = 0x6483c4, КАДР_В = 0x6483c8;
export class Input {
  constructor(mem) { this.m = mem; this.buttons = 0; this.mickX = 0; this.mickY = 0; }
  /** Ширина/высота текущего кадра игры в пикселях (640×480, если кадр ещё не задан). */
  ширК() { return this.m.u32(КАДР_Ш) || 640; }
  высК() { return this.m.u32(КАДР_В) || 480; }
  // --- мышь (порт обработчика 0x29352 + 0x29477)
  _event(mask, x, y) { const m = this.m; this.mickX += 0; m.w32(M.lastMask, mask); m.w32(M.btn, this.buttons);
    if (m.u8(M.hidden) !== 1) { m.w32(M.x, x); m.w32(M.y, y); } m.w32(M.mx, this.mickX >>> 0); m.w32(M.my, this.mickY >>> 0);
    if (mask & 0x7e) this._push(mask, x, y); for (const b of [2, 4, 8, 0x10, 0x20, 0x40]) if (mask & b) m.w32(FLAG[b], 1);
    if (mask & 1) m.w32(M.moved, 1); }
  _push(mask, x, y) { const m = this.m; m.w32(M.savedBx, this.buttons); let b = m.u32(M.wr) + 0x14; if (b >= 0x280) b = 0; if (m.u32(M.rd) === b) return; const w = m.u32(M.wr); m.w32(M.wr, b);
    m.w16(M.ring + w, mask & 0xffff); m.w16(M.ring + w + 2, this.buttons & 0xffff); m.w32(M.ring + w + 4, x >>> 0); m.w32(M.ring + w + 8, y >>> 0); m.w32(M.ring + w + 12, this.mickX >>> 0); m.w32(M.ring + w + 16, this.mickY >>> 0); }
  mouseMove(x, y) { x = Math.max(0, Math.min(this.ширК() - 1, x | 0)); y = Math.max(0, Math.min(this.высК() - 1, y | 0)); const ox = this.m.u32(M.x), oy = this.m.u32(M.y); this.mickX = (this.mickX + (x - ox) * 8) | 0; this.mickY = (this.mickY + (y - oy) * 8) | 0; this._event(1, x, y); }
  mouseDown(button, x, y) { const bit = button === 0 ? 1 : button === 2 ? 2 : 4; this.buttons |= bit; this._event(button === 0 ? 2 : button === 2 ? 8 : 0x20, x, y); }
  mouseUp(button, x, y) { const bit = button === 0 ? 1 : button === 2 ? 2 : 4; this.buttons &= ~bit; this._event(button === 0 ? 4 : button === 2 ? 0x10 : 0x40, x, y); }
  // --- клавиатура (порт обработчика int 9 @0x28c40): скан-коды набора 1
  keyDown(sc) { const m = this.m; if (sc >= 0x60) return; if (!m.u8(K.held + sc)) { m.w8(K.edge + sc, 1); const w = m.u32(K.wr); let n = w + 1; if (n >= 0x20) n = 0; if (n !== m.u32(K.rd)) { m.w8(K.ring + w, sc); m.w32(K.wr, n); } } m.w8(K.held + sc, 1); }
  keyUp(sc) { if (sc < 0x60) this.m.w8(K.held + sc, 0); }
  // KeyboardEvent.code → скан-код набора 1
  static scancode(code) { return SCAN[code] ?? -1; }
  // Ввод в браузере: pointer-события с захватом (рамка не рвётся, если палец/курсор ушёл за canvas),
  // масштабирование любого размера canvas в систему 640×480, кнопка мыши для тач-устройств.
  // Два режима для пальца: «тап» — абсолютные координаты (как было), «тачпад» — относительное ведение
  // виртуального курсора с ускорением. Мышь (pointerType === 'mouse') всегда работает абсолютно.
  attach(canvas, opts = {}) {
    this.touchButton = 0;                 // какой кнопкой «кликает» палец: 0 ЛКМ, 2 ПКМ (переключается в UI)
    this.padMode = !!opts.pad;            // тачпад включён
    this.onButton = opts.onButton || null;   // колбэк для подсветки кнопки в UI (длинное нажатие временно инвертирует)
    this.onLatch = opts.onLatch || null;     // колбэк состояния защёлки «зажать кнопку»
    canvas.style.touchAction = 'none';    // иначе браузер заберёт перетаскивание себе (скролл/зум)
    if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
    const map = e => { const r = canvas.getBoundingClientRect();
      return [Math.round((e.clientX - r.left) * canvas.width / r.width), Math.round((e.clientY - r.top) * canvas.height / r.height)]; };

    let held = null;                      // { id, button, x, y, cx, cy, t0, t, longTimer, moved, down, pad }
    let vx = 320, vy = 240;               // виртуальный курсор тачпада (дробный, чтобы медленное ведение не терялось)
    let latched = -1;                     // кнопка, зажатая защёлкой (-1 — нет)
    let tapT = 0, tapUp = null;           // время прошлого тапа (для двойного тапа) и отложенное отпускание клика
    const clampV = () => { vx = Math.min(this.ширК() - 1, Math.max(0, vx)); vy = Math.min(this.высК() - 1, Math.max(0, vy)); };
    const px = () => vx | 0, py = () => vy | 0;
    // Курсор игры — источник истины: игра сама его двигает (центрирование, диалоги). Пока он не скрыт, подхватываем.
    const syncV = () => { if (this.m.u8(M.hidden) !== 1) { vx = this.m.u32(M.x); vy = this.m.u32(M.y); clampV(); } };
    const flushTap = () => { if (!tapUp) return; clearTimeout(tapUp.t); const b = tapUp.b; tapUp = null; this.mouseUp(b, px(), py()); };
    this.setPad = on => { this.setLatch(false); this.padMode = !!on; syncV(); };
    this.setLatch = on => {               // защёлка: кнопка остаётся зажатой между жестами (рамка выделения, мини-карта)
      on = !!on; if (on === (latched >= 0)) return;
      flushTap(); syncV();
      if (on) { latched = this.touchButton; this.mouseDown(latched, px(), py()); }
      else { const b = latched; latched = -1; this.mouseUp(b, px(), py()); }
      if (this.onLatch) this.onLatch(on);
    };

    // ---- отдельная область-тачпад (внизу страницы). Жесты те же, что пальцем по канве, но
    // ведение считается в пикселях самой области: свайп во всю её ширину проходит весь экран.
    // Курсор при этом никуда не «прыгает» — это именно тачпад, а не второй экран.
    // hooks.skip(e) — отдать нажатие соседу: половина области занята стиком прокрутки карты.
    this.attachPad = (el, hooks = {}) => {
      el.style.touchAction = 'none';
      let ph = null;                       // { id, cx, cy, t, moved, dist, down, long, longTimer }
      const paint = (x, y, state) => hooks.onPaint && hooks.onPaint(x, y, state);
      el.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (hooks.skip && hooks.skip(e)) return;      // палец лёг в чужую половину (стик карты)
        flushTap(); syncV();
        const now = performance.now();
        ph = { id: e.pointerId, cx: e.clientX, cy: e.clientY, t: now, t0: now, moved: false, dist: 0, down: false, long: false, longTimer: 0 };
        if (latched < 0 && now - tapT < 320) { ph.down = true; this.mouseDown(this.touchButton, px(), py()); }
        else if (latched < 0) {
          ph.longTimer = setTimeout(() => {          // долгое удержание без движения — другая кнопка
            if (!ph || ph.moved || ph.down) return;
            ph.button = this.touchButton === 0 ? 2 : 0; ph.down = ph.long = true;
            if (this.onButton) this.onButton(ph.button, true);
            this.mouseDown(ph.button, px(), py());
          }, 450);
        }
        try { el.setPointerCapture(e.pointerId); } catch {}
        paint(e.clientX, e.clientY, 'down'); e.preventDefault();
      });
      el.addEventListener('pointermove', e => {
        if (!ph || e.pointerId !== ph.id) return;
        const r = el.getBoundingClientRect(); const k = canvas.width / Math.max(1, r.width);
        const dx = (e.clientX - ph.cx) * k, dy = (e.clientY - ph.cy) * k;
        const now = performance.now(); const dt = Math.max(1, now - ph.t);
        ph.cx = e.clientX; ph.cy = e.clientY; ph.t = now;
        const len = Math.hypot(dx, dy);
        const f = Math.min(2.6, 0.55 + len / dt * 0.6) * (this.padScale || 1);
        vx += dx * f; vy += dy * f; clampV();
        ph.dist += len; if (ph.dist > 8) { ph.moved = true; clearTimeout(ph.longTimer); }
        this.mouseMove(px(), py());
        paint(e.clientX, e.clientY, 'move'); e.preventDefault();
      });
      const padUp = e => {
        if (!ph || e.pointerId !== ph.id) return; clearTimeout(ph.longTimer);
        if (ph.down) { this.mouseUp(ph.button ?? this.touchButton, px(), py()); if (ph.long && this.onButton) this.onButton(this.touchButton, false); }
        else if (!ph.moved && performance.now() - ph.t0 < 400) {
          if (latched >= 0) this.setLatch(false);
          else { const b = this.touchButton; tapT = performance.now(); this.mouseDown(b, px(), py());
            tapUp = { b, t: setTimeout(() => { tapUp = null; this.mouseUp(b, px(), py()); }, 90) };
            paint(e.clientX, e.clientY, 'tap'); }
        }
        ph = null; paint(0, 0, 'up');
        try { el.releasePointerCapture(e.pointerId); } catch {}
      };
      el.addEventListener('pointerup', padUp); el.addEventListener('pointercancel', padUp);
    };

    const пальцы = new Map();                                // живые касания: нужно, чтобы отличить два пальца от одного
    canvas.addEventListener('pointerdown', e => {
      canvas.focus({ preventScroll: true });
      const touch = e.pointerType !== 'mouse';
      const pad = touch && this.padMode;
      flushTap();
      const [ax, ay] = map(e);
      if (!pad) this.mouseMove(ax, ay);                       // позиция ДО нажатия: у тача нет hover, игра читает курсор из своего состояния
      else if (!held) syncV();
      if (held) { clearTimeout(held.longTimer); if (held.down) this.mouseUp(held.button, held.pad ? px() : ax, held.pad ? py() : ay); }
      const now = performance.now();
      held = { id: e.pointerId, x: ax, y: ay, cx: e.clientX, cy: e.clientY, t0: now, t: now,
               button: touch ? this.touchButton : e.button, moved: false, dist: 0, down: false, long: false, pad, longTimer: 0 };
      if (pad) {
        if (latched < 0 && now - tapT < 320) {                // двойной тап: второе касание не отпускаем — тянем рамку
          held.down = true; this.mouseDown(held.button, px(), py());
        } else if (latched < 0) {
          held.longTimer = setTimeout(() => {                 // долгое удержание без движения = другая кнопка
            if (!held || held.moved || held.down) return;
            held.button = held.button === 0 ? 2 : 0; held.down = held.long = true;
            if (this.onButton) this.onButton(held.button, true);
            this.mouseDown(held.button, px(), py());
          }, 450);
        }
      } else if (touch && this.тащитьКарту && this.тащитьКарту(ax, ay)) {
        // Тач-схема. Один палец: по своему юниту — тянем приказ, по пустому месту — рамка
        // выделения. Два пальца — везём карту. Долгое удержание — выделить того, кто под пальцем,
        // в обход замка. Так это и просил владелец.
        held.жест = this.жестСюда ? this.жестСюда(ax, ay) : 'рамка';
        held.x0 = ax; held.y0 = ay;
        // Кнопку НЕ нажимаем сразу: если следом придёт второй палец (везём карту), отпускание
        // превратилось бы в щелчок по земле — и отряд получал приказ идти туда (жалоба владельца:
        // «когда двумя пальцами жму, это ещё отдаёт команду юнитам двигаться»). Рамку начинаем
        // только когда палец действительно поехал, а одиночный тап отдаём на отпускании.
        // ТАЧ-СХЕМА: палец по карте ТАЩИТ КАРТУ, а не тянет рамку выделения. Нажатие не отдаём
        // сразу — сперва смотрим, что это: протяжка (везём камеру), короткий тап (клик) или
        // долгое удержание (тогда начинаем рамку, как раньше это делал сразу же палец).
        held.карта = true;
        held.longTimer = setTimeout(() => {
          if (!held || held.moved) return;
          held.longTimer = 0;
          if (held.down) { this.mouseUp(held.button, held.x, held.y); held.down = false; }   // рамку не начинаем
          if (held.жест === 'приказ') {                       // долго держим СВОЕГО — выделяем его
            held.жест = 'выделено';
            if (this.выделитьСилой) this.выделитьСилой(held.x, held.y);
          } else if (this.кругОткрыть) {                      // долго держим ЗЕМЛЮ — круговое меню
            held.жест = 'круг';
            this.кругОткрыть(held.x, held.y);
          }
        }, 450);
      } else {
        if (touch) held.longTimer = setTimeout(() => {        // долгое нажатие без движения = другая кнопка (ПКМ на планшете)
          if (!held || held.moved) return;
          this.mouseUp(held.button, held.x, held.y);
          held.button = held.button === 0 ? 2 : 0; held.long = true;
          if (this.onButton) this.onButton(held.button, true);
          this.mouseDown(held.button, held.x, held.y);
        }, 450);
        held.down = true; this.mouseDown(held.button, ax, ay);
      }
      // Второй палец при живом первом — это «везём карту»: начатую рамку отпускаем, приказ бросаем.
      if (touch && this.тащитьКарту && пальцы.size === 1 && held && held.жест) {
        if (held.down) { this.mouseUp(held.button, ax, ay); held.down = false; }
        clearTimeout(held.longTimer);
        if (this.ведётПриказ) this.ведётПриказ(null);
        held.жест = 'карта2'; held.moved = true;
        held.сx2 = (held.x + ax) / 2; held.сy2 = (held.y + ay) / 2;
      }
      if (touch) пальцы.set(e.pointerId, { x: ax, y: ay });
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    });
    const move = e => {
      if (пальцы.has(e.pointerId)) { const [x0, y0] = map(e); пальцы.set(e.pointerId, { x: x0, y: y0 }); }
      if (held && held.жест === 'карта2' && пальцы.size >= 2) {   // два пальца везут карту по своей середине
        let сx = 0, сy = 0; for (const п of пальцы.values()) { сx += п.x; сy += п.y; }
        сx /= пальцы.size; сy /= пальцы.size;
        if (this.везтиКарту) this.везтиКарту(сx - held.сx2, сy - held.сy2);
        held.сx2 = сx; held.сy2 = сy; return;
      }
      if (held && e.pointerId !== held.id) return;            // пока жест идёт, чужие указатели игнорируем
      if (held && held.pad) {
        const r = canvas.getBoundingClientRect(), k = canvas.width / r.width;
        const dx = (e.clientX - held.cx) * k, dy = (e.clientY - held.cy) * k;
        const now = performance.now(), dt = Math.max(8, now - held.t), len = Math.hypot(dx, dy);
        held.cx = e.clientX; held.cy = e.clientY; held.t = now;
        // Ускорение: медленно ведёшь — меньше единицы (попасть в кнопку 20×20), быстро — до 2.6× (экран по диагонали одним махом).
        const f = Math.min(2.6, 0.55 + len / dt * 0.6) * (this.padScale || 1);   // padScale — ползунок «Mouse Sensitive»
        vx += dx * f; vy += dy * f; clampV();
        held.dist += len; if (held.dist > 8) { held.moved = true; clearTimeout(held.longTimer); }
        this.mouseMove(px(), py()); return;
      }
      const [x, y] = map(e);
      if (held && held.карта) {
        const dx = x - held.x, dy = y - held.y;
        // Порог «палец поехал». Шесть точек кадра — это около десяти-двенадцати пикселей экрана:
        // столько дрожит любая рука за те полсекунды, что держится долгое нажатие, и таймер
        // круга не доживал до срабатывания. Пока долгое нажатие ещё ждёт, порог втрое больше.
        // Порог «палец поехал» меряем ОТ ТОЧКИ КАСАНИЯ, а не от прошлого события: шаги пальца
        // мелкие, по отдельности они в порог не укладываются, и рамка не начиналась вовсе.
        const ушёл = Math.hypot(x - held.x0, y - held.y0);
        const порог = held.longTimer ? 18 : 6;
        if (held.жест !== 'круг' && !held.moved && ушёл > порог) { held.moved = true; clearTimeout(held.longTimer); held.longTimer = 0; }
        // Круговое меню открыто: палец водит по нему курсор и ничего больше не делает —
        // ни карту не везёт, ни рамку не тянет.
        if (held.жест === 'круг') { held.x = x; held.y = y; if (this.кругВести) this.кругВести(x, y); return; }
        // Протяжка ОТ своего юнита — приказ: показываем игре линию, камеру не трогаем.
        if (held.жест === 'приказ') { held.x = x; held.y = y; if (held.moved && this.ведётПриказ) this.ведётПриказ(held.x0, held.y0, x, y); return; }
        // Рамка: нажимаем в ТОЧКЕ НАЧАЛА, как только стало ясно, что палец ведут, и дальше ведём.
        if (held.moved && !held.down) { held.down = true; this.mouseMove(held.x0, held.y0); this.mouseDown(held.button, held.x0, held.y0); }
        held.x = x; held.y = y; if (held.down) this.mouseMove(x, y); return;
      }
      if (held && (Math.abs(x - held.x) > 6 || Math.abs(y - held.y) > 6)) { held.moved = true; clearTimeout(held.longTimer); }
      this.mouseMove(x, y);
    };
    canvas.addEventListener('pointermove', move);
    const up = e => {
      пальцы.delete(e.pointerId);
      if (held && held.жест === 'карта2') { if (пальцы.size === 0) held = null; try { canvas.releasePointerCapture(e.pointerId); } catch {} return; }
      if (!held || e.pointerId !== held.id) return; clearTimeout(held.longTimer);
      if (held.pad) {
        if (held.down) { this.mouseUp(held.button, px(), py()); if (held.long && this.onButton) this.onButton(this.touchButton, false); }
        else if (!held.moved && performance.now() - held.t0 < 400) {
          if (latched >= 0) this.setLatch(false);             // при зажатой защёлке тап её отпускает — так заканчивают рамку
          else {                                              // короткий тап = клик текущей кнопкой; отпускаем через кадр, иначе игра не увидит нажатие
            // Там, где цели крупные и неподвижные (боковая панель, мини-карта, экраны меню),
            // тап работает как обычное нажатие: курсор прыгает под палец. По карте так нельзя —
            // там нужна точность, поэтому остаётся относительное ведение.
            const [ax, ay] = map(e);
            if (this.directTap && this.directTap(ax, ay)) { vx = ax; vy = ay; clampV(); this.mouseMove(px(), py()); }
            const b = this.touchButton; tapT = performance.now(); this.mouseDown(b, px(), py());
            tapUp = { b, t: setTimeout(() => { tapUp = null; this.mouseUp(b, px(), py()); }, 90) };
          }
        }
      } else if (held.карта) {
        const [x, y] = map(e);
        if (held.жест === 'круг') {                            // отпустили над сектором — выполняем
          if (this.кругВыбрать) this.кругВыбрать(x, y);
          held = null; try { canvas.releasePointerCapture(e.pointerId); } catch {} return;
        }
        if (held.жест === 'приказ' && held.moved) {            // дотянули приказ до цели — отдаём его
          if (this.отдатьПриказ) this.отдатьПриказ(held.x0, held.y0, x, y);
          if (this.ведётПриказ) this.ведётПриказ(null);
          held = null; try { canvas.releasePointerCapture(e.pointerId); } catch {} return;
        }
        if (this.ведётПриказ) this.ведётПриказ(null);
        if (held.down) { this.mouseMove(x, y); this.mouseUp(held.button, x, y); }        // рамка закончилась
        else if (held.жест !== 'выделено' && !held.moved && performance.now() - held.t0 < 400) {
          // Короткий тап по своему юниту: нажатие-отпускание через кадр, иначе игра его не увидит.
          this.mouseMove(x, y);
          const b = held.button; this.mouseDown(b, x, y);
          tapUp = { b, t: setTimeout(() => { tapUp = null; this.mouseUp(b, x, y); }, 90) };
        }
      } else {
        const [x, y] = map(e); this.mouseMove(x, y); this.mouseUp(held.button, x, y);
        if (held.long && this.onButton) this.onButton(this.touchButton, false);
      }
      held = null; try { canvas.releasePointerCapture(e.pointerId); } catch {} };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    // В плитке (multi.html) курсор, ушедший за край холста, оставался «у края» и карта ехала без
    // остановки — отводим его на шаг внутрь. В обычной вкладке край холста и есть край экрана.
    if (window !== window.top) canvas.addEventListener('pointerleave', e => { if (held) return;
      const [x, y] = map(e); this.mouseMove(Math.max(1, Math.min(this.ширК() - 2, x)), Math.max(1, Math.min(this.высК() - 2, y))); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('contextmenu', e => { if (e.target === canvas) e.preventDefault(); });

    const вПоле = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '');   // поля форм (сетевая игра) — не игре
    addEventListener('keydown', e => {
      if (e.metaKey || вПоле(e)) return;                       // Cmd-сочетания оставляем браузеру (Cmd+R, Cmd+W и т.п.)
      const sc = Input.scancode(e.code); if (sc < 0) return;
      this.keyDown(sc); if (!e.repeat) e.preventDefault();
    });
    addEventListener('keyup', e => { if (вПоле(e)) return; const sc = Input.scancode(e.code); if (sc >= 0) this.keyUp(sc); });
    addEventListener('blur', () => { for (let sc = 0; sc < 0x60; sc++) this.keyUp(sc); });  // иначе клавиша «залипает», когда окно теряет фокус
    syncV();
  }
  // Нажатие экранной кнопки: держим клавишу ~3 кадра, чтобы игра успела увидеть фронт в своём тике.
  tapKey(code, ms = 120) { const sc = Input.scancode(code); if (sc < 0) return; this.keyDown(sc); setTimeout(() => this.keyUp(sc), ms); }
  holdKey(code, on) { const sc = Input.scancode(code); if (sc < 0) return; if (on) this.keyDown(sc); else this.keyUp(sc); }
}
const SCAN = { Escape: 1, Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 0xa, Digit0: 0xb, Minus: 0xc, Equal: 0xd, Backspace: 0xe, Tab: 0xf,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c, ControlLeft: 0x1d,
  KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2a, Backslash: 0x2b,
  KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35, ShiftRight: 0x36, NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3a,
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, NumLock: 0x45, ScrollLock: 0x46, Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4a,
  Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d, NumpadAdd: 0x4e, Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52, NumpadDecimal: 0x53, ArrowUp: 0x48, ArrowLeft: 0x4b, ArrowRight: 0x4d, ArrowDown: 0x50, PrintScreen: 0x37, ControlRight: 0x1d, AltRight: 0x38 };
