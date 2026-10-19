package jw

/**
 * Очередь приказов и раздача приказов интерфейса — порт reimpl/js/port/orders_ai.js в той части,
 * что относится к игроку (ИИ компьютерных игроков пока не портирован).
 *
 * Как это устроено в оригинале. Клик мышью не приказывает юниту напрямую: он кладёт «ожидающий
 * приказ» в четыре ячейки (0x31acc код, 0x31ad0 цель, 0x31ad4 X, 0x31ad8 Y). В начале шага
 * 0x13f4c обнуляет очередь, зовёт 0x1419e — та снимает ожидающий приказ и по таблице 0x141f8
 * (индекс = код>>4) раскладывает его на записи очереди по 10 байт, одну на юнита, — а потом
 * записи применяются: код уходит юниту в +0x46, цель в +0x47, точка в +0x4b/+0x4d. Дальше уже
 * диспетчер состояний (Move/MoveStates) превращает приказ в состояние.
 *
 * Тот же путь используют и наши приказы в браузерной обвязке (патруль), поэтому порт очереди —
 * это и есть «сделать игру управляемой»: всё остальное уже работает.
 */
object Orders {
    private fun u(i: Int, off: Int) = UNITS + i + off
    private fun selected(m: Mem, i: Int) = (m.u8(u(i, U.F07)) and 0x80) != 0
    private inline fun forEachUnit(m: Mem, fn: (Int) -> Unit) {
        var i = m.u32(G.unitHead)
        while (i != 0) { val next = m.u32(u(i, U.NEXT)); fn(i); i = next }
    }
    private fun add(eng: Engine, code: Int, esi: Int, edi: Int, dx: Int, bx: Int) =
        call(eng, 0x14895, Regs(eax = code, esi = esi, edi = edi, edx = dx and 0xffff, ebx = bx and 0xffff))

    /** Таблица 0x141f8: обработчик по старшему нибблу кода приказа. */
    private val TAB_141F8 = intArrayOf(0x14398, 0x145cd, 0x14621, 0x14621, 0x14642, 0x14673, 0x1468c, 0x1468d)
    /** Таблица 0x14218: коды 0xa0..0xe7. Заклинания и кнопки панели — пока заглушки 0x141f7. */
    private val TAB_14218 = IntArray(72) { 0x141f7 }.also {
        val карта = mapOf(
            0x0 to 0x1469a, 0x1 to 0x1469a, 0x2 to 0x1469a, 0x3 to 0x1469a, 0x4 to 0x1469a,
            0x6 to 0x146c5, 0x7 to 0x146c5, 0x8 to 0x146c5, 0x9 to 0x1469a, 0xb to 0x1469a,
            0xc to 0x146c5, 0xd to 0x146fa, 0xe to 0x146c5,
            0x10 to 0x1472c, 0x11 to 0x1472c, 0x12 to 0x146c5, 0x40 to 0x1474a, 0x41 to 0x14764)
        for ((k, v) in карта) it[k] = v
    }

    fun register() {
        // 0x14895: добавить запись очереди (al код, si юнит, di цель, dx X, bx Y).
        // Сетевая контрольная сумма считается только в сетевой игре ([0x31b69] != 0).
        F[0x14895] = { e, r ->
            val m = e.m
            val ecx = m.u32(0x33c7c)
            m.w8(ecx + 1, r.eax and 0xff); m.w16(ecx + 2, r.esi); m.w16(ecx + 4, r.edi)
            m.w16(ecx + 6, r.edx); m.w16(ecx + 8, r.ebx)
            m.w8(ecx, m.u8(G.netflag))
            m.w32(0x33c7c, ecx + 10)
            if (m.u8(0x31b69) != 0) {
                var v = m.u16(0x33c86)
                v = (v + (r.eax and 0xff) + (r.esi and 0xffff) + (r.edi and 0xffff) +
                        (r.edx and 0xffff) + (r.ebx and 0xffff)) and 0xffff
                m.w16(0x33c86, v)
            }
            Regs()
        }
        // 0x14854: снять «ожидающий приказ» интерфейса; 0xff — очередь пуста
        F[0x14854] = { e, _ ->
            val m = e.m
            val r = Regs(eax = m.u8(0x31acc), esi = m.u32(0x31ad0), edx = m.u32(0x31ad4), ebx = m.u32(0x31ad8))
            m.w8(0x31acc, 0xff)
            r
        }
        // 0x1419e: разложить ожидающие приказы по обработчикам
        F[0x1419e] = { e, _ ->
            val m = e.m
            m.w16(0x33c86, 0)
            var edi = 0
            while (true) {
                val r = call(e, 0x14854)
                val al = r.eax and 0xff
                if (al == 0xff) break
                val h: Int
                if (al < 0x80) { h = TAB_141F8[al shr 4]; edi = al shr 4 }
                else {
                    val idx = (al - 0xa0) and 0xff
                    h = if (idx < TAB_14218.size) TAB_14218[idx] else 0x141f7
                }
                opt(e, h, Regs(eax = al, esi = r.esi, edx = r.edx, ebx = r.ebx, edi = edi))
            }
            Regs()
        }
        F[0x141f7] = { _, _ -> Regs() }
        F[0x1468c] = { _, _ -> Regs() }

        // 0x13f4c: начало шага — обнулить очередь, разложить приказы интерфейса, применить записи
        F[0x13f4c] = { e, _ ->
            val m = e.m
            m.w32(0x33c7c, 0x33c88)
            call(e, 0x1419e)
            val end = m.u32(0x33c7c)
            // Порядок применения зависит от маркера игрока: сначала «чужие» записи, потом свои
            // (у оригинала это ветки 0x1402d и 0x140e7 — они отличаются только порядком).
            val свой = m.u8(G.netflag) != 0
            var c = 0x33c88
            while (c != end) { if ((m.u8(c) == 0xff) == свой) applyRecord(m, c); c += 10 }
            c = 0x33c88
            while (c != end) { if ((m.u8(c) == 0xff) != свой) applyRecord(m, c); c += 10 }
            Regs()
        }

        // 0x14398: «идти» (0x0f) всем выделенным с построением
        F[0x14398] = { e, r ->
            val m = e.m; val edi = r.esi
            m.w16(0x33be4, r.edx and 0xffff); m.w16(0x33be6, r.ebx and 0xffff)
            m.w32(0x33be8, -1); m.w32(0x33bec, 0); m.w32(0x33be0, 0)
            forEachUnit(m) { i ->
                if (selected(m, i)) {
                    val x = m.u16(u(i, U.X)); val y = m.u16(u(i, U.Y))
                    if (m.u16(0x33be8) >= x) m.w16(0x33be8, x)
                    if (m.u16(0x33bec) <= x) m.w16(0x33bec, x)
                    if (m.u16(0x33bea) >= y) m.w16(0x33bea, y)
                    if (m.u16(0x33bee) <= y) m.w16(0x33bee, y)
                    m.w32(0x33be0, m.u32(0x33be0) + 1)
                }
            }
            m.w32(0x33bec, m.u32(0x33bec) + 0x200020)
            m.w32(0x33be8, m.u32(0x33be8) and 0xffe0ffe0.toInt())
            m.w32(0x33bec, m.u32(0x33bec) and 0xffe0ffe0.toInt())
            val ax = (m.u16(0x33bec) - m.u16(0x33be8)) and 0xffff
            val bx = (m.u16(0x33bee) - m.u16(0x33bea)) and 0xffff
            m.w16(0x33bf0, ax); m.w16(0x33bf2, bx)
            // Shift держит строй: на Android клавиш нет, байты 0 — значит строимся сеткой.
            var сдвигом = m.u8(0x44792) == 1 || m.u8(0x4479e) == 1
            if (!сдвигом) {
                val eax = ((ax.toLong() * bx.toLong()) / 0x400).toInt() ushr 1
                if (m.u32(0x33be0) >= eax) сдвигом = true
                else {
                    call(e, 0x1477e)
                    forEachUnit(m) { i ->
                        if (selected(m, i)) {
                            val p = call(e, 0x147e7)
                            val dx = p.edx and 0xffff; val by = p.ebx and 0xffff
                            if (!(m.u8(u(i, U.STATE)) == 0 && m.u16(u(i, U.DSTX)) == dx && m.u16(u(i, U.DSTY)) == by))
                                add(e, 0x0f, i, edi, p.edx, p.ebx)
                        }
                    }
                }
            }
            if (сдвигом) {                                  // 0x144e7: сдвиг строя целиком
                val cx = ((m.u16(0x33bf0) ushr 1) + m.u16(0x33be8)) and 0xffe0
                val cy = ((m.u16(0x33bf2) ushr 1) + m.u16(0x33bea)) and 0xffe0
                m.w16(0x33bf4, cx); m.w16(0x33bf6, cy)
                forEachUnit(m) { i ->
                    if (selected(m, i)) {
                        var dx = (((m.u16(u(i, U.X)) and 0xffe0) - m.u16(0x33bf4) + m.u16(0x33be4)) and 0xffff).toShort().toInt()
                        var by = (((m.u16(u(i, U.Y)) and 0xffe0) - m.u16(0x33bf6) + m.u16(0x33be6)) and 0xffff).toShort().toInt()
                        dx = dx shr 5
                        dx = if (dx < 0) 0 else (if (m.u32(G.mapW) > dx) dx shl 5 else (m.u32(G.mapW) - 1) shl 5)
                        by = by shr 5
                        by = if (by < 0) 0 else (if (m.u32(G.mapH) > by) by shl 5 else (m.u32(G.mapH) - 1) shl 5)
                        if (!(m.u8(u(i, U.STATE)) == 0 && m.u16(u(i, U.DSTX)) == (dx and 0xffff) && m.u16(u(i, U.DSTY)) == (by and 0xffff)))
                            add(e, 0x0f, i, edi, dx, by)
                    }
                }
            }
            Regs()
        }
        // 0x1477e: сетка построения по числу выделенных
        F[0x1477e] = { e, _ ->
            val m = e.m; val cnt = m.u32(0x33be0)
            var edx = 0
            for (k in 0 until 0x1c) { if (m.u32(0x33c0c + edx * 4) >= cnt) break; edx++ }
            edx += 1
            m.w32(0x33c04, edx); m.w32(0x33c08, edx)
            val off = (edx ushr 1) shl 5
            var cx = m.u16(0x33be4) - off; if (cx < 0) cx = 0
            var bx = m.u16(0x33be6) - off; if (bx < 0) bx = 0
            m.w16(0x33bf8, cx); m.w16(0x33bfa, bx)
            m.w32(0x33bfc, 1); m.w32(0x33c00, 1)
            Regs()
        }
        // 0x147e7: следующая клетка построения
        F[0x147e7] = { e, _ ->
            val m = e.m
            var edx = m.u32(0x33bfc); var ebx = m.u32(0x33c00)
            m.w32(0x33bfc, edx + 1)
            if (m.u32(0x33c04) <= edx) { m.w32(0x33bfc, 1); m.w32(0x33c00, ebx + 1) }
            edx = edx shl 5; ebx = ebx shl 5
            edx = (edx and 0xffff0000.toInt()) or ((edx + m.u16(0x33bf8)) and 0xffff)
            ebx = (ebx and 0xffff0000.toInt()) or ((ebx + m.u16(0x33bfa)) and 0xffff)
            if (m.u32(G.mapW) <= (edx ushr 5)) edx = (m.u32(G.mapW) - 1) shl 5
            if (m.u32(G.mapH) <= (ebx ushr 5)) ebx = (m.u32(G.mapH) - 1) shl 5
            Regs(edx = edx, ebx = ebx)
        }
        // 0x145cd: атаковать цель всеми выделенными
        F[0x145cd] = { e, r ->
            val m = e.m; val edi = r.esi; val code = r.eax and 0xff
            forEachUnit(m) { i ->
                if (selected(m, i) && edi != i) {
                    m.w8(u(edi, U.FX43), m.u8(u(edi, U.FX43)) or 2)
                    val тоже = (m.u8(u(i, U.STATE)) and 0xf0) == 0x10 && m.u32(u(i, U.TARGET)) == edi &&
                            m.u16(u(i, U.DSTX)) == (r.edx and 0xffff) && m.u16(u(i, U.DSTY)) == (r.ebx and 0xffff)
                    if (!тоже) add(e, code, i, edi, r.edx, r.ebx)
                }
            }
            Regs()
        }
        // 0x14621: приказ всем выделенным без проверок
        F[0x14621] = { e, r ->
            val m = e.m
            forEachUnit(m) { i -> if (selected(m, i)) add(e, r.eax and 0xff, i, r.esi, r.edx, r.ebx) }
            Regs()
        }
        // 0x14642: приказ выделенному вожаку, если он уже не идёт туда же
        F[0x14642] = { e, r ->
            val m = e.m; val esi = m.u32(0x31adc)
            if (esi != 0) {
                val тоже = (m.u8(u(esi, U.STATE)) and 0xf0) == 0x40 &&
                        m.u16(u(esi, U.DSTX)) == (r.edx and 0xffff) && m.u16(u(esi, U.DSTY)) == (r.ebx and 0xffff)
                if (!тоже) add(e, r.eax and 0xff, esi, r.edi, r.edx, r.ebx)
            }
            Regs()
        }
        // 0x14673: приказ вожаку с целью + пометка цели
        F[0x14673] = { e, r ->
            val m = e.m; val edi = r.esi; val esi = m.u32(0x31adc)
            if (esi != 0) { add(e, r.eax and 0xff, esi, edi, r.edx, r.ebx); m.w8(u(edi, U.FX43), m.u8(u(edi, U.FX43)) or 2) }
            Regs()
        }
        // 0x1468d: приказ вожаку (цель — из приказа)
        F[0x1468d] = { e, r -> add(e, r.eax and 0xff, e.m.u32(0x31adc), r.esi, r.edx, r.ebx); Regs() }
        // 0x1474a: приказ стройки (0xe0) вожаку
        F[0x1474a] = { e, r ->
            val m = e.m; val esi = m.u32(0x31adc)
            if (esi != 0) add(e, r.eax and 0xff, esi, esi, r.edx, r.ebx)
            Regs()
        }
        // 0x14764: приказ кнопок панели (0xe1): номер кнопки приходит в esi
        F[0x14764] = { e, r ->
            val m = e.m; val sel = m.u32(0x31adc)
            if (sel != 0) add(e, r.eax and 0xff, sel, r.esi, r.edx, r.ebx)
            Regs()
        }
        // 0x1472c: приказ «на себя» (разведка): помечает юнита и ставит запись на него же
        F[0x1472c] = { e, r ->
            val m = e.m; val esi = m.u32(0x31adc)
            if (esi != 0) {
                m.w8(u(esi, U.FX43), m.u8(u(esi, U.FX43)) or 2)
                add(e, r.eax and 0xff, esi, esi, r.edx, r.ebx)
            }
            Regs()
        }
    }

    /** Применение записи очереди к юниту — общий кусок 0x1403b/0x1409a/0x140f5/0x14150. */
    private fun applyRecord(m: Mem, ecx: Int) {
        val esi = m.u16(ecx + 2)
        if (m.u8(u(esi, U.ORDER)) == 0x6f) return
        val st = m.u8(u(esi, U.STATE))
        if (st == 0x6f || st == 0x60) return
        m.w8(u(esi, U.ORDER), m.u8(ecx + 1))
        m.w32(u(esi, 0x47), m.u16(ecx + 4))
        m.w16(u(esi, 0x4b), m.u16(ecx + 6))
        m.w16(u(esi, 0x4d), m.u16(ecx + 8))
    }
}
