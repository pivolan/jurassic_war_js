package jw

/**
 * Боковая панель оригинала (x 512..639) — порт reimpl/js/render/panel.js и той части
 * js/port/input.js, что наполняет панель и разбирает нажатия по ней.
 *
 * Панель — это не «интерфейс поверх игры», а часть кадра: фон, портрет юнита, кнопки приказов,
 * иконки заклинаний, инвентарь, полосы статов и переключатели прокачки рисуются спрайтами из
 * пака 05 в тот же кадровый буфер 0x1235f4. Раскладка кнопок — таблицы прямоугольников
 * 0x30c64 (страница юнита, 28 штук) и 0x30d44 (страница здания, 17 штук), они же служат
 * для попадания нажатием.
 *
 * Что здесь есть: рисование панели целиком и нажатия — приказы (кнопки команд), заклинания,
 * заказ юнитов в здании и переключатели прокачки. Чего нет: подписей текстом (шрифты
 * оригинала на Kotlin ещё не портированы) и мини-карты внутри панели.
 */
object Panel {
    private const val SLOTS = Sprites.SLOTS
    private const val ROWS = Render.ROWS
    private const val FB = Render.FB
    private const val XBASE = 0x488c0
    private const val LUT_SHADOW = 0x44f80
    private const val TEAM = 0x488e8
    private const val UIFL = 0x31ae0          // бит 0 — панель видна
    private const val SEL = 0x31adc
    private const val PAGE = 0x31ae4
    private const val CMD = 0x31b34           // 9 кнопок приказов
    private const val INV = 0x31b3d           // 12 ячеек инвентаря
    private const val BLD = 0x31b49           // 15 кнопок здания
    private const val RECTS0 = 0x30c64        // 28 прямоугольников страницы юнита
    private const val RECTS1 = 0x30d44        // 17 прямоугольников страницы здания

    private fun own(e: Engine, i: Int) = e.m.u8(UNITS + i + U.OWNER) == e.m.u8(G.humanOwner)
    private fun видна(m: Mem) = (m.u8(UIFL) and 1) != 0

    // ---- 0x1f815: спрайт без отсечения (панель целиком лежит в кадре)
    private fun blit(m: Mem, slot: Int, x0: Int, y0: Int, режим: Int) {
        val b = m.b
        val e = SLOTS + slot * 16
        val w = m.u16(e + 4); val h = m.u16(e + 6)
        var src = m.u32(e)
        val x = x0 + m.i16(e + 8); var y = y0 + m.i16(e + 0xa)
        val base = m.u32(XBASE); val team = m.u8(TEAM)
        m.w32(0x488d4, w); m.w32(0x488d8, h)
        for (row in 0 until h) {
            if (y in 0..479) {
                val d = base + m.u32(ROWS + y * 4) + x
                for (k in 0 until w) {
                    var p = b[src + k].toInt() and 0xff
                    if (p != 0) {
                        if (режим > 0) {
                            if (p == 1) p = m.u8(LUT_SHADOW + (b[d + k].toInt() and 0xff))
                            else if (p in 0xc0..0xc3) p = (p + team) and 0xff
                            if (режим == 2) p = m.u8(LUT_SHADOW + p)      // недоступная кнопка — темнее
                        }
                        b[d + k] = p.toByte()
                    }
                }
            }
            src += w; y++
        }
    }

    fun register() {
        F[0x1f815] = { e, r -> blit(e.m, r.eax, r.edx, r.ebx, 0); Regs() }
        F[0x1f720] = { e, r -> blit(e.m, r.eax, r.edx, r.ebx, 1); Regs() }
        F[0x1f79f] = { e, r -> blit(e.m, r.eax, r.edx, r.ebx, 2); Regs() }

        // ---- фон панели, вкладки и кнопка MENU
        F[0x2665d] = { e, _ -> blit(e.m, 0xb17, 0x200, 0, 0); Regs() }
        F[0x26e23] = { e, _ -> blit(e.m, 0xb1b, 0x200, 0x1be, 0); Regs() }
        F[0x26e38] = { e, _ -> blit(e.m, 0xb1c, 0x200, 0x1be, 0); Regs() }
        F[0x26e4d] = { e, _ -> blit(e.m, 0xb27, 0x268, 0x1c8, 0); Regs() }
        F[0x26e62] = { e, _ -> blit(e.m, 0xb28, 0x268, 0x1c8, 0); Regs() }
        F[0x26a5c] = { _, _ -> Regs() }

        // ---- 0x2693c/0x2696a/0x26dfd: чистые страницы панели
        F[0x2693c] = { e, _ ->
            val m = e.m; m.w32(PAGE, 0); blit(m, 0xb19, 0x200, 0x100, 0)
            for (k in 0 until 12) m.w8(INV + k, 0); Regs()
        }
        F[0x2696a] = { e, _ ->
            val m = e.m; blit(m, 0xb18, 0x200, 0x80, 0)
            for (k in 0 until 9) m.w8(CMD + k, 0); Regs()
        }
        F[0x26dfd] = { e, _ ->
            val m = e.m; blit(m, 0xb1a, 0x200, 0x80, 0)
            for (k in 0 until 15) m.w8(BLD + k, 0); Regs()
        }

        // ---- 0x26671: инвентарь выбранного
        F[0x26671] = { e, r ->
            val m = e.m
            if (видна(m)) {
                call(e, 0x2693c)
                val i = r.esi
                if (i != 0 && own(e, i)) {
                    for (k in 0 until 12) {
                        val it = m.u8(UNITS + i + U.INV + k)
                        if (it != 0) {
                            m.w8(INV + k, it)
                            blit(m, it + 0x9de, m.u16(0x30c9c + k * 8), m.u16(0x30c9e + k * 8), 0)
                        }
                    }
                    val w = m.u8(UNITS + i + U.WEAPON)
                    if (w != 0xff) blit(m, 0xa0a, m.u16(0x30c9c + w * 8) - 4, m.u16(0x30c9e + w * 8) - 3, 0)
                    val sh = m.u8(UNITS + i + U.SHIELD)
                    if (sh != 0xff) blit(m, 0xa0a, m.u16(0x30c9c + sh * 8) - 4, m.u16(0x30c9e + sh * 8) - 3, 0)
                }
            }
            Regs()
        }

        // ---- 0x2673d: портрет и кнопки приказов, включая иконки заклинаний
        F[0x2673d] = { e, r ->
            val m = e.m
            if (видна(m)) {
                call(e, 0x2696a)
                val i = r.esi
                if (i != 0 && own(e, i)) {
                    m.w8(TEAM, m.u8(0x30dcc + m.u8(UNITS + i + U.OWNER)))
                    blit(m, m.u32(0x424dc + m.u8(UNITS + i + U.TYPE) * 4), m.u16(0x30cfc), m.u16(0x30cfe) - 4, 1)
                    blit(m, 0x9ff, m.u16(0x30d04), m.u16(0x30d06), 1)
                    blit(m, 0xa00, m.u16(0x30d0c), m.u16(0x30d0e), 1)
                    m.w8(CMD, 2); m.w8(CMD + 1, 6); m.w8(CMD + 2, 3)
                    if (m.u8(UNITS + i + U.TYPE) == 4) {                     // конструктор: кнопка стройки
                        val k = m.u8(UNITS + i + 0x59)
                        val spr = if (k < 2) m.u8(UNITS + i + U.SLOT) * 2 + k + 0xa0b else k + 0xa19
                        blit(m, spr, m.u16(0x30d14), m.u16(0x30d16), 1)
                        m.w8(CMD + 3, (k + 1) and 0xff)
                    } else {
                        var ebp = m.u32(UNITS + i + U.SKILLS) ushr 8
                        var edi = 3
                        var ecx = 8
                        while (ecx <= 0x1f && edi < 9) {
                            val bit = ebp and 1; ebp = ebp ushr 1
                            if (bit != 0) {
                                m.w8(CMD + edi, (ecx + 1) and 0xff)
                                val нельзя = call(e, 0x14873, Regs(eax = ecx, esi = i)).cf
                                val sx = m.u16(0x30cfc + edi * 8) + m.u32(0x42540 + ecx * 16)
                                val sy = m.u16(0x30cfe + edi * 8) + m.u32(0x42544 + ecx * 16)
                                if (!нельзя) blit(m, m.u32(0x4253c + ecx * 16), sx, sy, 1)
                                else {
                                    blit(m, m.u32(0x4253c + ecx * 16), sx, sy, 2)
                                    // полоска «сколько маны накоплено» под затемнённой иконкой
                                    val div = m.u8(0x30b41 + m.u32(0x30bbe + ecx * 4))
                                    var al = if (div != 0) ((0x1e * m.u8(UNITS + i + U.MANA)) and 0xffff) / div and 0xff else 0
                                    if (al != 0) {
                                        var edx = m.u16(0x30cfc + edi * 8) + 2
                                        val rb = m.u32(0x122ee8 + m.u16(0x30cfe + edi * 8) * 4)
                                        while (al > 0) {
                                            edx++
                                            for (o in intArrayOf(0, 0x280, 0x500, 0x780)) m.w8(FB + edx + rb + o, 0x1e)
                                            al--
                                        }
                                    }
                                }
                                edi++
                            }
                            ecx++
                        }
                    }
                }
            }
            Regs()
        }

        // ---- 0x2698e: переключатели прокачки статов
        F[0x2698e] = { e, _ ->
            val m = e.m
            if (видна(m)) {
                m.w8(0x427cb, 0)
                val s = m.u32(SEL)
                if (s != 0 && own(e, s)) m.w8(0x427cb, m.u8(UNITS + s + U.STAT0B))
                val f = m.u8(0x427cb)
                var x = 0x200
                for ((spr, bit) in listOf(0xb1d to 1, 0xb1f to 2, 0xb21 to 4, 0xb23 to 8, 0xb25 to 0x10)) {
                    blit(m, spr + (if ((f and bit) != 0) 1 else 0), x, 0x1a8, 0)
                    x += 0x19
                }
            }
            Regs()
        }

        // ---- 0x26b34: ряд кнопок заказа. Какие доступны — биты в edi, иконки идут подряд с eax.
        F[0x26b34] = { e, r ->
            val m = e.m
            var eax = r.eax; var ebx = r.ebx; var ecx = r.ecx; var edi = r.edi
            val s = m.u32(SEL)
            while (ecx > 0) {
                val bit = edi and 1; edi = edi ushr 1
                if (bit != 0) {
                    val bx = m.u16(0x30d54 + ebx * 8); val by = m.u16(0x30d56 + ebx * 8)
                    if ((m.u8(0x427ad) and 1) != 0) {           // здание уже что-то строит
                        if (m.u8(0x427ac) == (ebx and 0xff)) {
                            m.w8(BLD + ebx, 1); blit(m, eax, bx, by, 1)
                            val p = m.u32(UNITS + s + 0x33)
                            blit(m, 0xa0a, m.u16(0x30d54 + p * 8) - 4, m.u16(0x30d56 + p * 8) - 3, 0)
                            opt(e, 0x26d29)
                        } else blit(m, eax, bx, by, 2)
                    } else { m.w8(BLD + ebx, 1); blit(m, eax, bx, by, 1) }
                }
                eax++; ebx++; ecx--
            }
            Regs()
        }
        // ---- 0x26c4f: подпись под кнопками. Шрифтов на Kotlin ещё нет — рисуем только подложку.
        F[0x26c4f] = { e, _ -> blit(e.m, 0xb29, 0x20b, 0xbc, 0); e.m.w32(0x30384, 0); Regs() }

        // ---- 0x26a5d: страница здания (кнопки заказа юнитов)
        F[0x26a5d] = { e, r ->
            val m = e.m
            if (видна(m)) {
                val i = r.esi
                if (!own(e, i)) { call(e, 0x2693c); call(e, 0x2696a); call(e, 0x2698e) }
                else {
                    call(e, 0x26dfd)
                    val s = m.u32(SEL)
                    m.w8(TEAM, m.u8(0x30dcc + m.u8(UNITS + s + U.OWNER)))
                    m.w8(0x427ac, m.u8(UNITS + s + 0x33))
                    val al = m.u8(UNITS + s + 0x50)
                    if ((al and 2) == 0) {
                        m.w8(0x427ad, al)
                        val ebx = m.u8(UNITS + s + U.TYPE) - 0x1a
                        val edi = m.u32(m.u32(0x30e88 + m.u8(UNITS + s + U.SLOT) * 4) + ebx * 4)
                        if (ebx == 0) {
                            call(e, 0x26b34, Regs(eax = m.u8(UNITS + s + U.SLOT) * 2 + 0xa0b, ecx = 2, ebx = 0, edi = edi))
                            call(e, 0x26b34, Regs(eax = 0xa1b, ecx = 0xd, ebx = 2, edi = edi ushr 2))
                        } else call(e, 0x26b34, Regs(ecx = m.u32(0x4273c + ebx * 8), eax = m.u32(0x42740 + ebx * 8), ebx = 0, edi = edi))
                        call(e, 0x26c4f)
                    }
                }
            }
            Regs()
        }

        // ---- полосы статов 0x2700c (текущее/максимум) и 0x27188 (одно значение)
        F[0x2700c] = { e, r ->
            val m = e.m
            var d = рамка(m, m.u32(0x424d0), m.u32(0x424d8))
            val cur = длина(r.edx and 0xff); val mx = длина((r.edx shr 8) and 0xff)
            d = залить(m, d, cur, 0x19)
            d = залить(m, d, (mx - cur) and 0xff, 0x11)
            if (mx < 0x30) затемнить(m, d, (0x30 - mx) and 0xff)
            Regs()
        }
        F[0x27188] = { e, r ->
            val m = e.m
            var d = рамка(m, m.u32(0x424d0), m.u32(0x424d8))
            val cur = длина(r.edx and 0xff)
            d = залить(m, d, cur, 0x19)
            if (cur < 0x30) затемнить(m, d, (0x30 - cur) and 0xff)
            Regs()
        }

        // ---- 0x2661c: перерисовать панель целиком
        F[0x2661c] = { e, _ ->
            val m = e.m
            if (видна(m)) {
                call(e, 0x2665d)
                val s = m.u32(SEL)
                if (s != 0 && m.u8(UNITS + s + U.TYPE) < 0x1a) {
                    call(e, 0x26671, Regs(esi = s)); call(e, 0x2673d, Regs(esi = s)); call(e, 0x2698e)
                } else if (s != 0) call(e, 0x26a5d, Regs(esi = s))
                call(e, 0x26e23)
            }
            Regs()
        }
    }

    private fun рамка(m: Mem, x: Int, y: Int): Int {
        val b = m.b
        val d = FB + m.u32(ROWS + y * 4) + x
        for (i in 0 until 0x32) { b[d + i] = 0x1f; b[d + i + 9 * 640] = 0x1f }
        for (r in 1..8) { b[d + r * 640] = 0x1f; b[d + r * 640 + 0x31] = 0x1f }
        return d + 641
    }
    private fun длина(v: Int) = ((v shr 3) + (v shr 4)) and 0xff
    private fun залить(m: Mem, d0: Int, n: Int, col: Int): Int {
        var d = d0
        for (i in 0 until n) { for (r in 0 until 8) m.b[d + r * 640] = col.toByte(); d++ }
        return d
    }
    private fun затемнить(m: Mem, d0: Int, n: Int) {
        var d = d0
        for (i in 0 until n) { for (r in 0 until 8) m.b[d + r * 640] = m.b[LUT_SHADOW + (m.b[d + r * 640].toInt() and 0xff)]; d++ }
    }

    /** Нажатие по панели в экранных координатах. Возвращает подпись для строки состояния. */
    fun click(eng: Engine, x: Int, y: Int): String {
        val m = eng.m
        if (m.u32(PAGE) == 0) {
            val i = прямоугольник(m, RECTS0, 0x1c, x, y)
            if (i < 0) return ""
            return страницаЮнита(eng, i)
        }
        val i = прямоугольник(m, RECTS1, 0x11, x, y)
        if (i < 0) return ""
        if (i == 0 || i == 1) return ""
        val k = i - 2
        val s = m.u32(SEL)
        if (m.u8(BLD + k) != 1) return ""
        Ui.pending(m, 0x7f, k, 0, 0)
        return "заказ"
    }

    private fun страницаЮнита(eng: Engine, i: Int): String {
        val m = eng.m
        val s = m.u32(SEL)
        return when {
            i in 2..6 -> {                                    // переключатели прокачки
                if (s == 0 || !own(eng, s)) "" else { Ui.pending(m, 0xe1, i - 2, 2, i - 2); "прокачка" }
            }
            i in 7..15 -> {                                   // инвентарь
                val n = i - 7
                if (m.u8(INV + n) == 0) "" else { Ui.pending(m, 0xe1, n, 0, n); "предмет" }
            }
            i in 19..27 -> {                                  // кнопки приказов и заклинаний
                val v = m.u8(CMD + (i - 19))
                if (v == 0) "" else командa(eng, v)
            }
            else -> ""
        }
    }

    /**
     * Кнопка приказа. Простые приказы отдаём сразу, а заклинания и всё, что требует указать
     * точку, переводят курсор в свой режим — как в оригинале (0x13237): следующий тап по карте
     * и будет этим приказом.
     */
    private fun командa(eng: Engine, v: Int): String {
        val m = eng.m
        val s = m.u32(SEL)
        if (s == 0 || !own(eng, s)) return ""
        if (call(eng, 0x14873, Regs(eax = v - 1, esi = s)).cf) return "нельзя"   // не хватает маны или умения
        return when (v) {
            3 -> { Ui.orderHold(eng); "стоять" }                  // 0x11ce6 — покой
            4 -> { Ui.pending(m, 0x3f, 0, 0, 0); "стоп" }         // 0x11cfe — стоп
            25, 26 -> { Ui.pending(m, if (v == 25) 0xb0 else 0xb1, 0, 0, 0); "готово" }
            else -> { m.w16(Ui.MODE, v); "укажите цель на карте" }
        }
    }

    private fun прямоугольник(m: Mem, base: Int, n: Int, x: Int, y: Int): Int {
        for (i in 0 until n) {
            val b = base + i * 8
            if (m.u16(b) > x) continue
            if (m.u16(b + 4) < x) continue
            if (m.u16(b + 2) > y) continue
            if (m.u16(b + 6) >= y) return i
        }
        return -1
    }
}

/**
 * Мини-карта и полосы статов — порт reimpl/js/render/hud.js (0x24843) и панельной части
 * reimpl/js/render/panel.js (0x26e77). Рисуются после сцены, каждый кадр: мини-карта показывает
 * разведанное и рамку окна карты, полосы — статы выделенного юнита по флагам 0x31ac7.
 */
object Hud {
    private const val LUT_SHADOW = 0x44f80
    private const val COL_TILE = 0x3e8aa
    private const val COL_OWNER = 0x3e8a0
    private const val MM_X = 0x30388; private const val MM_Y = 0x3038c
    private const val MM_W = 0x30390; private const val MM_H = 0x30394
    private const val MM_BASE = 0x3e6e8; private const val MM_LUTX = 0x3e6f0; private const val MM_LUTY = 0x3e7f0
    private const val UIFL = 0x31ae0
    private const val SEL = 0x31adc
    private const val STATFL = 0x31ac7
    private const val ROWS = Render.ROWS

    private fun цвет(m: Mem, cell: Int): Pair<Int, Boolean> {
        val b = m.b
        if ((m.u8(BI + cell) and 1) == 0) return 0xff to false
        var o = m.u8(MO + cell) shr 4
        if (o == 0) {
            o = m.u8(BI + cell) shr 2
            if (o == 0) return m.u8(COL_TILE + (m.u16(BG + cell * 2) and 0x7ff)) to false
        }
        return m.u8(COL_OWNER + o) to true
    }

    fun register() {
        // 0x24843: мини-карта. Один пиксель на клетку, а при флаге 4 — 2x2.
        F[0x24843] = { e, _ ->
            val m = e.m; val b = m.b; val fl = m.u8(UIFL)
            if ((fl and 1) != 0 || (fl and 8) != 0) {
                val tx = m.u32(Render.CAMX) ushr 5; val ty = m.u32(Render.CAMY) ushr 5
                val ox = m.u8(MM_LUTX + tx); val oy = m.u8(MM_LUTY + ty)
                m.w32(0x31b2c, ox); m.w32(0x31b30, oy)
                val mx = m.u32(MM_X); val my = m.u32(MM_Y); val w = m.u32(MM_W); val h = m.u32(MM_H)
                val base = m.u32(MM_BASE)
                val cell0 = (oy shl 8) or ox
                val d0 = base + m.u32(ROWS + my * 4) + mx
                val vw = m.u32(0x31af0); val vh = m.u32(0x31af4)
                val перерис = (fl and 1) != 0 || (fl and 2) != 0
                if ((fl and 4) == 0) {
                    for (r in 0 until h) for (c in 0 until w) {
                        val d = d0 + r * 640 + c
                        var (col, unit) = цвет(m, cell0 + r * 0x100 + c)
                        if (!перерис && !unit) col = m.u8(LUT_SHADOW + (b[d].toInt() and 0xff))
                        b[d] = col.toByte()
                    }
                    val p = base + m.u32(ROWS + (ty - oy + my) * 4) + mx + tx - ox
                    for (i in 0 until vw) { b[p + i] = 0x12; b[p + i + 0x2300] = 0x12 }
                    for (r in 0 until 15) { b[p + r * 640] = 0x12; b[p + r * 640 + vw - 1] = 0x12 }
                } else {
                    val rows = h ushr 1; val cols = w ushr 1
                    for (r in 0 until rows) for (c in 0 until cols) {
                        val d = d0 + r * 1280 + c * 2
                        val (col, unit) = цвет(m, cell0 + r * 0x100 + c)
                        if (перерис || unit) { b[d] = col.toByte(); b[d + 1] = col.toByte(); b[d + 640] = col.toByte(); b[d + 641] = col.toByte() }
                        else for (o2 in intArrayOf(0, 1, 640, 641)) b[d + o2] = m.u8(LUT_SHADOW + (b[d + o2].toInt() and 0xff)).toByte()
                    }
                    val p = base + m.u32(ROWS + ((ty - oy) * 2 + my) * 4) + mx + (tx - ox) * 2
                    val n = vw * 2; val off = m.u32(ROWS + (vh * 2 - 1) * 4)
                    for (i in 0 until n) { b[p + i] = 0x12; b[p + i + off] = 0x12 }
                    for (r in 0 until vh * 2) { b[p + r * 640] = 0x12; b[p + r * 640 + vw * 2 - 1] = 0x12 }
                }
                // рамка мини-карты
                var p = d0 - 0x281; val off = m.u32(ROWS + (h + 1) * 4)
                for (i in 0 until w + 2) { b[p + i] = 0xf7.toByte(); b[p + i + off] = 0xf7.toByte() }
                p = d0 - 1
                for (r in 0 until h) { b[p + r * 640] = 0xf7.toByte(); b[p + r * 640 + w + 1] = 0xf7.toByte() }
            }
            Regs()
        }

        // 0x26e77: полосы статов выделенного юнита. Какие показывать — биты 0x31ac7 (кнопки HP/OP/DP/MP/VP).
        F[0x26e77] = { e, _ ->
            val m = e.m; val fl = m.u8(STATFL); val s = m.u32(SEL)
            if (fl != 0 && s != 0 && m.u8(UNITS + s + U.TYPE) < 0x1a) {
                m.w32(0x424d8, m.u32(0x424d4))
                val u = UNITS + s
                fun дальше() { m.w32(0x424d8, m.u32(0x424d8) + 0xc) }
                if ((fl and 0x10) != 0) { call(e, 0x2700c, Regs(edx = (m.u8(u + 0x0c) shl 8) or m.u8(u + 0x0e))); дальше() }
                if ((fl and 8) != 0) { call(e, 0x27188, Regs(edx = m.u8(u + 0x0f))); дальше() }
                if ((fl and 4) != 0) { call(e, 0x27188, Regs(edx = m.u8(u + 0x10))); дальше() }
                if ((fl and 2) != 0) { call(e, 0x2700c, Regs(edx = (m.u8(u + 0x0d) shl 8) or m.u8(u + 0x11))); дальше() }
                if ((fl and 1) != 0) { call(e, 0x27188, Regs(edx = m.u8(u + 0x12))); дальше() }
            }
            Regs()
        }
    }

    /** Панель перед шагом: у некоторых типов кнопки приказов меняются по ходу дела. */
    fun preTick(eng: Engine) {
        val m = eng.m; val s = m.u32(SEL)
        if (s == 0) return
        val t = m.u8(UNITS + s + U.TYPE)
        if (t in 5..8) call(eng, 0x2673d, Regs(esi = s))
    }
    /** HUD после сцены: полосы статов, мини-карта, кнопка MENU. */
    fun afterScene(eng: Engine, полный: Boolean) {
        call(eng, 0x26e77); call(eng, 0x24843)
        if (полный || (eng.m.u8(UIFL) and 1) == 0) call(eng, 0x26e4d)
    }
}
