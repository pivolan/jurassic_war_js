package jw

/**
 * Выделение юнитов и отдача приказов — та часть reimpl/js/port/input.js, что не зависит от
 * мыши и клавиатуры. Сам ввод (тапы, рамка пальцем) живёт в модуле :app, а сюда попадают уже
 * мировые координаты: так логика остаётся проверяемой тестами без Android.
 *
 * Приказ отдаётся не напрямую, а через «ожидающий приказ» оригинала (0x31acc..0x31ad8): его в
 * начале следующего шага разберёт 0x1419e и разложит по очереди (Orders). Благодаря этому путь
 * приказа на Android ровно тот же, что у мыши в оригинале, — и такой же воспроизводимый.
 */
object Ui {
    const val SEL = 0x31adc          // выделенный вожак
    const val MODE = 0x31aca         // режим курсора
    const val PENDING = 0x31acc      // ожидающий приказ: код, цель, X, Y
    const val CAMX = 0x31ae8
    const val CAMY = 0x31aec
    private const val HITBOX = 0x33978

    fun own(eng: Engine, i: Int) = eng.m.u8(UNITS + i + U.OWNER) == eng.m.u8(G.humanOwner)
    private fun statSum(m: Mem, i: Int): Int {
        if (i == 0) return 0
        var ax = m.u8(UNITS + i + U.HPMAX)
        for (f in intArrayOf(U.MAG, U.ATK, U.DEF, U.SPD)) ax += m.u8(UNITS + i + f)
        return ax
    }

    /** Ожидающий приказ: код, цель, точка. Разберётся в начале следующего шага. */
    fun pending(m: Mem, code: Int, target: Int, x: Int, y: Int) {
        m.w8(PENDING, code and 0xff); m.w32(0x31ad0, target); m.w32(0x31ad4, x); m.w32(0x31ad8, y)
    }
    /** «Идти» всем выделенным (строем, как в оригинале). */
    fun orderMove(eng: Engine, x: Int, y: Int) = pending(eng.m, 0x0f, 0, x and 0xffe0, y and 0xffe0)
    /** «Атаковать» цель всеми выделенными. */
    fun orderAttack(eng: Engine, target: Int, x: Int, y: Int) =
        pending(eng.m, 0x1f, target, x and 0xffe0, y and 0xffe0)
    /** «Стоять» (0x3f — приказ покоя оригинала). */
    fun orderHold(eng: Engine) = pending(eng.m, 0x2f, 0, 0, 0)

    /** Есть ли живой юнит игрока среди выделенных. */
    fun anySelected(m: Mem): Boolean {
        var i = m.u32(G.unitHead)
        while (i != 0) {
            if ((m.u8(UNITS + i + U.F07) and 0x80) != 0) return true
            i = m.u32(UNITS + i + U.NEXT)
        }
        return false
    }
    fun selectedCount(m: Mem): Int {
        var n = 0; var i = m.u32(G.unitHead)
        while (i != 0) { if ((m.u8(UNITS + i + U.F07) and 0x80) != 0) n++; i = m.u32(UNITS + i + U.NEXT) }
        return n
    }

    /**
     * Тап по карте (мировые координаты). Свой юнит — выделяем только его; чужой — приказ атаки,
     * если есть кого послать, иначе просто показываем его; пусто — приказ идти.
     * Возвращает, что произошло: для строки состояния.
     */
    fun tap(eng: Engine, x: Int, y: Int): String {
        val m = eng.m
        val hit = call(eng, 0x130c6, Regs(edx = x, ebx = y)).esi
        if (hit != 0 && own(eng, hit)) {
            // Как в браузерной версии: клик по бойцу оставляет выделенным ровно его.
            m.w8(UNITS + hit + U.F07, m.u8(UNITS + hit + U.F07) and 0x7f)
            call(eng, 0x11c13, Regs(esi = hit))
            return "выбран юнит"
        }
        if (!anySelected(m)) {
            if (hit != 0) { call(eng, 0x11c13, Regs(esi = hit)); return "чужой юнит" }
            return "никто не выделен"
        }
        if (hit != 0) { orderAttack(eng, hit, x, y); return "в атаку" }
        orderMove(eng, x, y)
        return "идут"
    }

    /**
     * Что делает щелчок по карте в режиме курсора. Таблица режимов оригинала 0x1179c: кнопка
     * панели через 0x13237 кладёт в [0x31aca] номер команды, а щелчок по карте превращается в
     * приказ с нужным кодом. Здесь тот же разбор, только без мыши: 1 — цель под пальцем нужна,
     * 2 — точка, 3 — на себя.
     */
    private val РЕЖИМЫ = HashMap<Int, Pair<Int, Int>>().apply {
        put(1, 0x0f to 2); put(2, 0x1f to 1); put(3, 0x2f to 3); put(4, 0x3f to 3)
        put(5, 0x4c to 2); put(6, 0x51 to 1)
        put(9, 0xa0 to 1); put(10, 0xa1 to 1); put(11, 0xa2 to 1); put(12, 0xa3 to 1); put(13, 0xa4 to 1)
        put(15, 0xa6 to 1); put(16, 0xa7 to 1); put(17, 0xa8 to 1); put(18, 0xa9 to 1)
        put(20, 0xab to 2); put(21, 0xac to 2); put(22, 0xad to 2); put(23, 0xae to 2)
        put(25, 0xb0 to 3); put(26, 0xb1 to 3); put(27, 0xb2 to 2)
    }

    /** Щелчок по карте, когда панель перевела курсор в режим приказа. true — приказ отдан. */
    fun tapInMode(eng: Engine, x: Int, y: Int): Boolean {
        val m = eng.m
        val режим = m.u16(MODE)
        val п = РЕЖИМЫ[режим] ?: return false
        var (код, вид) = п
        if (код == 0x51) код = (0x51 + m.u8(UNITS + m.u32(SEL) + 0x51)) and 0xff
        val цель = if (вид == 1) call(eng, 0x130c6, Regs(edx = x, ebx = y)).esi else 0
        if (вид == 1 && цель == 0) return false                      // мимо: режим не сбрасываем
        when (вид) {
            3 -> pending(m, код, 0, 0, 0)
            else -> pending(m, код, цель, x and 0xffe0, y and 0xffe0)
        }
        m.w16(MODE, 0)
        return true
    }

    /** Рамка выделения по мировым координатам (порт 0x119dd без чтения мыши). */
    fun boxSelect(eng: Engine, x0i: Int, y0i: Int, x1i: Int, y1i: Int) {
        val m = eng.m
        val ax = minOf(x0i, x1i) and 0xffff; val dx = maxOf(x0i, x1i) and 0xffff
        val bp = minOf(y0i, y1i) and 0xffff; val bx = maxOf(y0i, y1i) and 0xffff
        m.w32(0x33868, 0)
        var i = m.u32(G.unitHead)
        while (i != 0) {
            var inside = false
            if ((m.u8(UNITS + i + U.FLAGS5B) and 1) == 0 && m.u8(UNITS + i + U.STATE) != 0x60 &&
                own(eng, i) && m.u8(UNITS + i + U.TYPE) < 0x1a) {
                val ux = m.u16(UNITS + i + U.X); val uy = m.u16(UNITS + i + U.Y)
                if (ux <= dx && ((ux + 0x20) and 0xffff) >= ax && uy <= bx && ((uy + 0x20) and 0xffff) >= bp) inside = true
            }
            if (inside) {
                if (statSum(m, m.u32(0x33868)) < statSum(m, i)) m.w32(0x33868, i)
                m.w8(UNITS + i + U.F07, m.u8(UNITS + i + U.F07) or 0x80)
            } else m.w8(UNITS + i + U.F07, m.u8(UNITS + i + U.F07) and 0x7f)
            i = m.u32(UNITS + i + U.NEXT)
        }
        val sel = m.u32(SEL)
        if (sel != 0 && (m.u8(UNITS + sel + U.F07) and 0x80) != 0) return
        val lead = m.u32(0x33868)
        if (lead != 0) call(eng, 0x11c13, Regs(esi = lead)) else opt(eng, 0x1a65d)
    }

    fun register() {
        // 0x130c6: кто стоит в точке (мировые координаты edx,ebx). Прямоугольники — таблица 0x33978.
        F[0x130c6] = { e, r ->
            val m = e.m; val x = r.edx; val y = r.ebx
            val cell = ((x ushr 5) and 0xff) + (((y ushr 5) and 0xff) shl 8)
            if ((m.u8(BI + cell) and 1) == 0) Regs(esi = 0, eax = 0)
            else {
                val al = m.u8(BI + cell) and 2
                val ah = m.u8(MO + cell) shr 4
                val dx = x.toShort().toInt(); val bx = y.toShort().toInt()
                var found = 0
                var i = m.u32(G.unitHead)
                while (i != 0) {
                    val skip = (m.u8(UNITS + i + U.FLAGS5B) and 1) != 0 || m.u8(UNITS + i + U.STATE) == 0x60
                    if (!skip) {
                        val t = m.u8(UNITS + i + U.TYPE)
                        val ux = m.u16(UNITS + i + U.X); val uy = m.u16(UNITS + i + U.Y)
                        val ok = dx >= (((ux + m.i16(HITBOX + t * 8)) shl 16) shr 16) &&
                                bx >= (((uy + m.i16(HITBOX + t * 8 + 2)) shl 16) shr 16) &&
                                (x and 0xffff) <= ((ux + m.i16(HITBOX + t * 8 + 4)) and 0xffff) &&
                                (y and 0xffff) <= ((uy + m.i16(HITBOX + t * 8 + 6)) and 0xffff)
                        if (ok && (ah == 0 || t == 0xb)) { found = i; break }
                    }
                    i = m.u32(UNITS + i + U.NEXT)
                }
                Regs(esi = found, eax = al)
            }
        }
        // 0x119c1: снять выделение со всех
        F[0x119c1] = { e, _ ->
            val m = e.m; var i = m.u32(G.unitHead)
            while (i != 0) { m.w8(UNITS + i + U.F07, m.u8(UNITS + i + U.F07) and 0x7f); i = m.u32(UNITS + i + U.NEXT) }
            Regs()
        }
        // 0x11c13: сделать юнита вожаком выделения. Панель и звук — через opt(): их ещё нет.
        F[0x11c13] = { e, r ->
            val m = e.m; val i = r.esi
            opt(e, 0x259e4, Regs(esi = i))
            m.w32(SEL, i)
            if ((m.u8(UNITS + i + U.F07) and 0x80) == 0) {
                call(e, 0x119c1)
                m.w8(UNITS + i + U.F07, m.u8(UNITS + i + U.F07) or 0x80)
            }
            if (own(e, i)) opt(e, 0x1fdc2, Regs(esi = i))
            m.w16(MODE, 0)
            if (m.u8(UNITS + i + U.TYPE) < 0x1a) {
                m.w32(0x31ae4, 0)
                opt(e, 0x2673d, Regs(esi = i)); opt(e, 0x26671, Regs(esi = i)); opt(e, 0x2698e)
            } else {
                m.w8(0x31ae4, (m.u8(UNITS + i + U.TYPE) - 0x19) and 0xff)
                m.w32(0x31ae4, m.u8(0x31ae4))
                opt(e, 0x26a5d, Regs(esi = i))
            }
            Regs(esi = m.u32(SEL))
        }
    }
}
