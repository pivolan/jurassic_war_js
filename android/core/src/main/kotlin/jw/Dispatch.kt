package jw

/**
 * Диспетчер состояний юнита — порт хвоста move.js. Состояние лежит в байте +0x2b, обработчик
 * выбирается по старшему нибблу через таблицу 0x182a8 (состояния до 0x7f) или 0x182c8 (0x80 и выше).
 *
 * Приказ применяется только когда юнит стоит ровно на границе тайла — так в оригинале, и это
 * важно: иначе приказ затирает цель раньше времени и юнит дёргается посреди клетки.
 */
object Dispatch {
    private fun w16(x: Int) = x and 0xffff
    private fun lo8(r: Int, v: Int) = (r and 0xff.inv()) or (v and 0xff)

    val TAB_182A8 = intArrayOf(0x18b35, 0x18bb3, 0x18e0b, 0x18e89, 0x1918c, 0x19229, 0x19693, 0x197e4)
    val TAB_182C8 = intArrayOf(
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
        0x1d1cf, 0x19bbe, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267, 0x18267)

    private fun dispatchState(eng: Engine, esi: Int) {
        val al = eng.m.u8(UNITS + esi + U.STATE)
        val h = if (al < 0x80) TAB_182A8[al ushr 4] else TAB_182C8.getOrElse(al - 0x80) { 0x18267 }
        if (h == 0x18267 || h == 0x197e4) return                  // в оригинале там ret
        opt(eng, h, Regs(esi = esi))
    }

    /** 0x181d7 / 0x18211: отложенный приказ становится состоянием. */
    private fun applyOrder(m: Mem, esi: Int, al: Int, resetAnim: Boolean) {
        m.w8(UNITS + esi + U.STATE, al)
        m.w32(UNITS + esi + U.TARGET, m.u32(UNITS + esi + 0x47))
        m.w16(UNITS + esi + U.DSTX, m.u16(UNITS + esi + 0x4b))
        m.w16(UNITS + esi + U.DSTY, m.u16(UNITS + esi + 0x4d))
        m.w8(UNITS + esi + U.ORDER, 0xff)
        if (resetAnim) m.w8(UNITS + esi + U.ANIM, 0)
    }

    fun register() {
        // 0x19fbf: приказ ИИ «идти в точку»
        F[0x19fbf] = { e, r ->
            val m = e.m; val esi = r.esi
            m.w32(UNITS + esi + 0x47, 0); m.w8(UNITS + esi + U.ORDER, 0x1f)
            m.w16(UNITS + esi + 0x4b, r.edx); m.w16(UNITS + esi + 0x4d, r.ebx)
            r
        }

        // 0x18154: люди и ручные ящеры (типы 1..13)
        F[0x18154] = { e, r ->
            val m = e.m; val esi = r.esi
            if (m.u16(G.stepLow) == 0) opt(e, 0x18ab2, Regs(esi = esi, eax = 1))
            val ord = m.u8(UNITS + esi + U.ORDER)
            var стоп = false
            if (ord != 0xff && (m.u16(UNITS + esi + U.X) and 0x1f) == 0 && (m.u16(UNITS + esi + U.Y) and 0x1f) == 0) {
                if (ord == 0x6f) {
                    val s = m.u8(UNITS + esi + U.STATE)
                    if (s == 0x6f || s == 0x60) стоп = true
                }
                if (!стоп) {
                    when (ord ushr 4) {
                        1, 2 -> applyOrder(m, esi, ord, true)
                        0xe -> if (ord == 0xe0) applyOrder(m, esi, ord, false)
                               else { m.w8(UNITS + esi + U.ORDER, 0xff); opt(e, 0x19bbe, Regs(esi = esi)) }
                        0xf -> стоп = true
                        else -> applyOrder(m, esi, ord, false)
                    }
                }
            }
            if (!стоп) {
                opt(e, 0x163e4, Regs(esi = esi))                  // решения мага/лечение — другой модуль
                dispatchState(e, esi)
            }
            r
        }

        // 0x184c8: дикие звери (типы 14..23)
        F[0x184c8] = { e, r ->
            val m = e.m; val esi = r.esi
            if (m.u16(G.stepLow) == 0) opt(e, 0x18ab2, Regs(esi = esi, eax = 1))
            if ((m.u16(UNITS + esi + U.X) and 0x1f) == 0 && (m.u16(UNITS + esi + U.Y) and 0x1f) == 0) {
                call(e, 0x172c5, Regs(esi = esi))
                val ord = m.u8(UNITS + esi + U.ORDER)
                if (ord != 0xff) applyOrder(m, esi, ord, false)
            }
            val al = m.u8(UNITS + esi + U.STATE)
            if (al <= 0x6f) opt(e, TAB_182A8[al ushr 4], Regs(esi = esi))
            r
        }

        // 0x172c5: решение зверя — подобрать еду рядом или пастись в своём прямоугольнике
        F[0x172c5] = { e, r ->
            val m = e.m; val esi = r.esi
            if (m.u8(UNITS + esi + U.FLAGS50) >= 0xe) {
                if ((m.u8(UNITS + esi + U.STATE) and 0xf0) != 0x40) {
                    val f = opt(e, 0x170f6, Regs(esi = esi))       // поиск еды — другой модуль
                    if (f != null && f.edi != 0) {
                        m.w8(UNITS + esi + U.ORDER, 0x44)
                        m.w16(UNITS + esi + 0x4b, w16(f.edx shl 5))
                        m.w16(UNITS + esi + 0x4d, w16(f.ebx shl 5))
                    } else {
                        var eax = (m.u8(UNITS + esi + 0x58) - m.u8(UNITS + esi + 0x56)) and 0xff
                        m.w32(G.rngRange, eax)
                        val dl = e.randRaw() and 0xff
                        var ebx = (m.u8(UNITS + esi + 0x56) + dl) and 0xff
                        eax = (m.u8(UNITS + esi + 0x57) - m.u8(UNITS + esi + 0x55)) and 0xff
                        m.w32(G.rngRange, eax)
                        var edx = e.randRaw()
                        edx = lo8(edx, (edx + m.u8(UNITS + esi + 0x55)) and 0xff)
                        edx = edx shl 5; ebx = ebx shl 5
                        val c = call(e, 0x1e609, Regs(esi = esi, edx = edx, ebx = ebx))
                        if (!c.zf) call(e, 0x19fbf, Regs(esi = esi, edx = edx, ebx = ebx))
                    }
                }
                m.w8(UNITS + esi + U.FLAGS50, 0)
            }
            r
        }
    }
}
