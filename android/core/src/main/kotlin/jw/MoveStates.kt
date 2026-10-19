package jw

/**
 * Состояния юнита и мелкие помощники к ним — продолжение порта move.js, плюс те функции из
 * combat/economy/magic, без которых движение не работает: кадр стойки, поиск цели вокруг,
 * проверка тайла под приказ, проверка доступности умения.
 *
 * Состояния в оригинале — старший ниббл байта +0x2b: 0x0x движение, 0x2x отдых, 0x3x охрана
 * и простой. Диспетчер выбирает обработчик по нибблу, и это же деление сохранено здесь.
 */
object MoveStates {
    private fun w16(x: Int) = x and 0xffff
    private fun abs16(x0: Int): Int { val x = x0 and 0xffff; return if ((x and 0x8000) != 0) (0x10000 - x) and 0xffff else x }
    private fun lo8(r: Int, v: Int) = (r and 0xff.inv()) or (v and 0xff)

    fun register() {
        registerBack()
        // 0x1a773: кадр стойки (не ходьбы)
        F[0x1a773] = { e, r ->
            val m = e.m; val s = UNITS + r.esi; val t = m.u8(s + U.TYPE)
            if (t != 0xb) m.w16(s + U.SPR, (m.u16(0x36dd6 + t * 2) + m.u16(0x36e06 + m.u8(s + U.DIR) * 2)) and 0xffff)
            else {
                var ax = m.u16(0x36e38 + t * 2)
                ax += m.u16(0x36e28 + (m.u8(s + U.ATKCTR) ushr 1) * 2)
                ax += m.u16(0x36e7a + m.u8(s + U.DIR) * 2)
                m.w16(s + U.SPR, ax and 0xffff)
            }
            r
        }
        // 0x1e0e0: освободить клетку под собой (направление из MO)
        F[0x1e0e0] = { e, r ->
            val m = e.m; val b = UNITS + r.esi
            val gi = m.u8(b + 0x53) + (m.u8(b + 0x54) shl 8)
            if (m.u8(b + U.TYPE) != 0xb) m.w8(MO + gi, m.u8(MO + gi) and 0xf0)
            else {
                val cl = ((m.u8(b + U.OWNER) + 1) shl 4) and 0xff
                m.w8(MO + gi, (m.u8(MO + gi) and 0xf) or cl)
            }
            r
        }
        F[0x1a34c] = { e, r -> e.m.w8(UNITS + r.esi + U.ORDER, 0x3f); r }

        // 0x1a95d: грубое направление к точке по таблице 0x304f6
        F[0x1a95d] = { e, r ->
            val m = e.m; val b = UNITS + r.esi
            var eax = 0
            val x = m.u16(b + U.X); val y = m.u16(b + U.Y)
            val dx = r.edx and 0xffff; val bx = r.ebx and 0xffff
            if (x != dx) { if (x >= dx) eax = 6; eax += 2 }
            if (y != bx) { if (y <= bx) eax += 3; eax += 1 }
            Regs(eax = lo8(r.eax, m.u8(0x304f6 + eax)))
        }

        // 0x1aa10: уточнение направления по соотношению |dx|:|dy|
        F[0x1aa10] = { e, r ->
            val m = e.m; val base = UNITS + r.esi
            val al = r.eax and 0xff
            fun refine(flip: Boolean): Int {
                var dx = abs16((r.edx and 0xffff) - m.u16(base + U.X))
                var bx = abs16((r.ebx and 0xffff) - m.u16(base + U.Y))
                var res = al
                if (dx < bx) {
                    bx = bx shr 1
                    if (bx < dx) return al
                    res = if (flip) al + 1 else al - 1
                    if (flip && (res and 0xff) >= 9) res = 1
                } else {
                    dx = dx shr 1
                    if (dx <= bx) return al
                    res = if (flip) al - 1 else al + 1
                }
                return res and 0xff
            }
            val res = when (al) {
                2, 6 -> refine(false)
                4, 8 -> refine(true)
                else -> al
            }
            Regs(eax = lo8(r.eax, res))
        }

        // 0x1e609: годится ли тайл под приказ (проще, чем 0x1e685: без соседей)
        F[0x1e609] = { e, r ->
            val m = e.m; val s = UNITS + r.esi
            var eax = 0
            val edx = (r.edx and 0xffff) ushr 5
            var ebx: Int
            var готово: Regs? = null
            if (edx < m.u32(G.mapW)) {
                ebx = (r.ebx and 0xffff) ushr 5
                if (ebx < m.u32(G.mapH)) {
                    if (m.u8(s + U.TYPE) == 0xb) {
                        ebx = ebx shl 8
                        готово = if ((m.u8(MO + edx + ebx) and 0xf0) != 0) Regs(zf = true, eax = 1) else Regs(zf = false, eax = 1)
                    } else {
                        ebx = ebx shl 9
                        eax = m.u16(BG + ebx + edx * 2)
                        if ((eax and 0xf800) != 0) готово = Regs(zf = true, eax = 0)
                        else { eax = m.u8(0x3183c + eax); ebx = ebx ushr 1 }
                    }
                } else ebx = 0
            } else ebx = 0
            готово ?: run {
                if ((eax and 1) == 0) Regs(zf = true, eax = 0)
                else if ((m.u8(BI + edx + ebx) and 0xfc) != 0) Regs(zf = true, eax = 1)
                else Regs(zf = false, eax = 0)
            }
        }

        // 0x14873: доступно ли умение и хватает ли маны
        F[0x14873] = { e, r ->
            val m = e.m; val esi = r.esi; val bit = r.eax and 0xff
            if (((m.u32(UNITS + esi + U.SKILLS) ushr bit) and 1) == 0) Regs(cf = true, eax = bit)
            else {
                val ebx = m.u32(0x30bbe + bit * 4)
                val bl = m.u8(ebx + 0x30b41)
                Regs(cf = m.u8(UNITS + esi + U.MANA) < bl, eax = bit, ebx = (ebx and 0xffffff00.toInt()) or bl)
            }
        }
        // 0x1a393: приказ самому себе в точку
        F[0x1a393] = { e, r ->
            val m = e.m; val esi = r.esi
            m.w8(UNITS + esi + U.ORDER, r.eax and 0xff)
            m.w32(UNITS + esi + 0x47, 0)
            m.w16(UNITS + esi + 0x4b, r.edx and 0xffe0)
            m.w16(UNITS + esi + 0x4d, r.ebx and 0xffe0)
            Regs(edx = r.edx and 0xffe0, ebx = r.ebx and 0xffe0)
        }

        // 0x1a692: кто стоит на тайле
        F[0x1a692] = { e, r ->
            val m = e.m
            val dx = r.edx and 0xffff; val bx = r.ebx and 0xffff
            var found = 0
            var i = m.u32(G.unitHead)
            while (i != 0) {
                val b = UNITS + i
                if ((m.u8(b + U.FLAGS5B) and 1) == 0 && m.u8(b + U.STATE) != 0x6f && m.u8(b + U.ORDER) != 0x6f &&
                    (m.u16(b + U.X) ushr 5) == dx && (m.u16(b + U.Y) ushr 5) == bx) { found = i; break }
                i = m.u32(b + U.NEXT)
            }
            Regs(esi = found)
        }

        // 0x1a526 / 0x1a531: поиск цели кольцами вокруг поста
        F[0x1a526] = { e, r -> Regs(edi = findTarget(e, r.esi, (e.m.u8(UNITS + r.esi + U.SPD) ushr 5) + 1)) }
        F[0x1a531] = { e, r -> Regs(edi = findTarget(e, r.esi, r.ebx)) }

        // 0x19fdf: увидел врага — перейти в атаку из охраны
        F[0x19fdf] = { e, r ->
            val m = e.m; val b = UNITS + r.esi; val t = UNITS + r.edi
            if (m.u8(t + U.OWNER) != m.u8(b + U.OWNER)) {
                if (m.u8(b + 0x42) == 0) {
                    val ty = m.u8(b + U.TYPE)
                    if (ty in 0xe..0x18) opt(e, 0x1ff88, Regs(esi = r.esi))       // рык зверя
                }
                if ((m.u8(t + U.FLAGS5B) and 1) != 0) call(e, 0x1a34c, Regs(esi = r.esi))
                else {
                    m.w8(b + U.ORDER, 0x33); m.w32(b + 0x47, r.edi)
                    m.w16(b + 0x4b, m.u16(b + U.X) and 0xffe0)
                    m.w16(b + 0x4d, m.u16(b + U.Y) and 0xffe0)
                }
            }
            r
        }

        // ---------- обработчики состояний ----------
        // 0x18b35: 0x0x — движение
        F[0x18b35] = { e, r ->
            val m = e.m; val esi = r.esi
            if (m.u8(UNITS + esi + U.STATE) == 0x0f) {
                m.w8(UNITS + esi + U.STATE, 0)
                call(e, 0x1db94, r)
            } else {
                val t = call(e, 0x1dc43, r)
                if ((t.eax and 0xff) == 0) {                       // пришли
                    if (m.u8(UNITS + esi + U.ANIM) == 1 && m.u8(UNITS + esi + U.TYPE) == 4) {
                        opt(e, 0x1d1cf, r)                         // конструктор превращается в стройку
                    } else {
                        val bl = m.u8(UNITS + esi + U.F08)
                        if (bl != 0) {
                            val slot = m.u8(UNITS + esi + U.SLOT)
                            val a = (if (bl == 1) 0x32b6c else 0x32bbc) + slot * 2
                            m.w16(a, m.u16(a) + 1)
                        }
                        val v = (m.u8(UNITS + esi + 0x52) + 1) and 0xff
                        m.w8(UNITS + esi + 0x52, v)
                        if (v == 0) m.w8(UNITS + esi + U.STATE, 0x2f)   // счётчик прибытий переполнился — отдых
                        else { call(e, 0x1a773, Regs(esi = esi)); call(e, 0x1a34c, Regs(esi = esi)) }
                    }
                }
            }
            r
        }

        // 0x18e0b: 0x2x — отдых, восстановление здоровья и маны
        F[0x18e0b] = { e, r ->
            val m = e.m; val esi = r.esi
            if (m.u8(UNITS + esi + U.STATE) == 0x2f) {
                m.w8(UNITS + esi + U.STATE, 0x20); m.w8(UNITS + esi + U.ATKCTR, 0)
                call(e, 0x1e0e0, Regs(esi = esi)); call(e, 0x1a773, Regs(esi = esi))
            } else {
                val c = (m.u8(UNITS + esi + U.ATKCTR) + 1) and 0xff
                m.w8(UNITS + esi + U.ATKCTR, c)
                if (c >= 0x20) {
                    m.w8(UNITS + esi + U.ATKCTR, 0)
                    if ((m.u8(UNITS + esi + 0x42) and 1) == 0) {
                        m.w32(G.rngN, 0xd); call(e, 0x204a6, Regs(esi = esi))   // мёртвый вызов, но ГСЧ двигает
                    }
                    if (m.u8(UNITS + esi + U.HP) < m.u8(UNITS + esi + U.HPMAX))
                        m.w8(UNITS + esi + U.HP, m.u8(UNITS + esi + U.HP) + 1)
                    if (m.u8(UNITS + esi + U.MANA) < m.u8(UNITS + esi + U.MAG))
                        m.w8(UNITS + esi + U.MANA, m.u8(UNITS + esi + U.MANA) + 1)
                }
            }
            r
        }

        // 0x18e89: 0x3x — охрана, простой, возврат на пост. Ветка 0x30..0x33 (атака из охраны)
        // живёт в боевом модуле и здесь пока не обрабатывается.
        F[0x18e89] = { e, r ->
            val m = e.m; val esi = r.esi
            val st = m.u8(UNITS + esi + U.STATE)
            fun x() = m.u16(UNITS + esi + U.X)
            fun y() = m.u16(UNITS + esi + U.Y)
            fun onTile() = (x() and 0x1f) == 0 && (y() and 0x1f) == 0
            when {
                st == 0x38 -> {                                    // стоим на посту, изредка озираемся
                    val c = (m.u8(UNITS + esi + U.ATKCTR) - 1) and 0xff
                    m.w8(UNITS + esi + U.ATKCTR, c)
                    if (c != 0) {
                        if (m.u8(UNITS + esi + U.TYPE) == 0xb) call(e, 0x1a773, Regs(esi = esi))
                    } else {
                        val f = call(e, 0x1a526, Regs(esi = esi))
                        if (f.edi != 0) call(e, 0x19fdf, Regs(esi = esi, edi = f.edi))
                        else {
                            val dl: Int
                            if (m.u8(UNITS + esi + U.TYPE) == 0xb) dl = 0x10
                            else { m.w32(G.rngRange, 0x14); dl = (e.randRaw() + 5) and 0xff }
                            m.w8(UNITS + esi + U.ATKCTR, dl)
                            m.w8(UNITS + esi + U.FLAGS50, m.u8(UNITS + esi + U.FLAGS50) + 1)
                            if (dl != 0x18) call(e, 0x1a773, Regs(esi = esi))
                            else {                                  // раз в сколько-то — поворот на месте
                                m.w32(G.rngRange, 3)
                                val dx = w16(e.randRaw() - 1)
                                val d = w16(m.u16(UNITS + esi + U.DIR) + dx)
                                m.w16(UNITS + esi + U.DIR, d)
                                if (d >= 9) m.w16(UNITS + esi + U.DIR, 1) else if (d == 0) m.w16(UNITS + esi + U.DIR, 8)
                                call(e, 0x1a773, Regs(esi = esi))
                            }
                        }
                    }
                }
                st == 0x3f -> {                                    // запомнить пост и встать
                    m.w8(UNITS + esi + 0x44, x() ushr 5); m.w8(UNITS + esi + 0x45, y() ushr 5)
                    m.w8(UNITS + esi + U.STATE, 0x38); m.w8(UNITS + esi + U.ATKCTR, 1)
                    m.w8(UNITS + esi + U.FLAGS50, 0)
                    call(e, 0x1e0e0, Regs(esi = esi))
                }
                st == 0x36 -> {                                    // идём на пост
                    val t = call(e, 0x1dc43, r)
                    if ((t.eax and 0xff) != 0) {
                        if (onTile()) {
                            val f = call(e, 0x1a526, Regs(esi = esi))
                            if (f.edi != 0) call(e, 0x19fdf, Regs(esi = esi, edi = f.edi))
                        }
                    } else {
                        m.w8(UNITS + esi + U.STATE, 0x38); m.w8(UNITS + esi + U.ATKCTR, 1)
                        call(e, 0x1e0e0, Regs(esi = esi))
                    }
                }
                st == 0x37 -> {                                    // вернуться на пост
                    if (onTile()) {
                        m.w8(UNITS + esi + U.STATE, 0x36)
                        m.w16(UNITS + esi + U.DSTX, m.u8(UNITS + esi + 0x44) shl 5)
                        m.w16(UNITS + esi + U.DSTY, m.u8(UNITS + esi + 0x45) shl 5)
                        call(e, 0x1db94, r)
                    }
                }
                else -> guardAttack(e, r, st)                      // 0x30..0x33 — бой из охраны
            }
            r
        }
    }

    /**
     * 0x19011: бой из охраны. Отличается от обычной атаки тем, что юнит помнит пост: если цель
     * ушла за радиус обзора, он не преследует её бесконечно, а возвращается (0x1a354).
     */
    private fun guardAttack(eng: Engine, r: Regs, st: Int) {
        val m = eng.m; val esi = r.esi
        val edi = m.u32(UNITS + esi + U.TARGET)
        val tst = m.u8(UNITS + edi + U.STATE)
        fun onTile() = (m.u16(UNITS + esi + U.X) and 0x1f) == 0 && (m.u16(UNITS + esi + U.Y) and 0x1f) == 0
        fun chase() {                                          // 0x1915b
            m.w8(UNITS + esi + U.STATE, 0x31)
            m.w16(UNITS + esi + U.DSTX, m.u16(UNITS + edi + U.X) and 0xffe0)
            m.w16(UNITS + esi + U.DSTY, m.u16(UNITS + edi + U.Y) and 0xffe0)
            call(eng, 0x1db94, r)
        }
        fun cooldown() {                                       // 0x1914e
            val c = (m.u8(UNITS + esi + U.ATKCTR) - 1) and 0xff
            m.w8(UNITS + esi + U.ATKCTR, c)
            if (c == 0) chase() else call(eng, 0x1a773, Regs(esi = esi))
        }
        fun step31() {                                         // 0x190e2
            if (st != 0x31) {
                m.w8(UNITS + esi + U.STATE, 0x32)
                m.w8(UNITS + esi + U.ATKCTR, (0x10 - (m.u8(UNITS + esi + U.SPD) ushr 4)) and 0xff)
                return
            }
            val t = call(eng, 0x1dc43, r)
            if ((t.eax and 0xff) != 0) return
            val e2 = m.u32(UNITS + esi + U.TARGET)
            val dx = m.u16(UNITS + e2 + U.X) and 0xffe0
            val bx = m.u16(UNITS + e2 + U.Y) and 0xffe0
            val z = call(eng, 0x1a463, Regs(esi = esi, edx = dx, ebx = bx))
            if (!z.zf) { call(eng, 0x1a354, Regs(esi = esi)); return }   // цель ушла — назад на пост
            m.w16(UNITS + esi + U.DSTX, dx); m.w16(UNITS + esi + U.DSTY, bx)
            call(eng, 0x1db94, r)
        }
        when {
            st == 0x33 -> chase()
            tst == 0x60 || tst == 0x6f -> {
                if (onTile()) call(eng, 0x1a354, Regs(esi = esi))
                else if (st == 0x32) cooldown() else step31()
            }
            st == 0x32 -> cooldown()
            (call(eng, 0x1a051, Regs(esi = esi, edi = edi)).eax and 0xff) != 0 -> step31()
            else -> {
                if (st != 0x30) {
                    m.w8(UNITS + esi + U.STATE, 0x30); m.w8(UNITS + esi + U.ATKCTR, 2)
                    call(eng, 0x1e0e0, Regs(esi = esi))
                }
                val ty = m.u8(UNITS + edi + U.TYPE)
                val dx = w16(m.u16(UNITS + edi + U.X) + m.u16(0x30456 + ty * 4)) and 0xffe0
                val bx = w16(m.u16(UNITS + edi + U.Y) + m.u16(0x30458 + ty * 4)) and 0xffe0
                m.w16(UNITS + esi + U.DSTX, dx); m.w16(UNITS + esi + U.DSTY, bx)
                var eax = call(eng, 0x1a95d, Regs(esi = esi, edx = dx, ebx = bx)).eax
                eax = call(eng, 0x1aa10, Regs(esi = esi, eax = eax, edx = dx, ebx = bx)).eax
                m.w16(UNITS + esi + U.DIR, eax)
                call(eng, 0x1a7cb, Regs(esi = esi, edi = edi, eax = eax))
            }
        }
    }

    /** 0x1a354: вернуться на пост. */
    private fun registerBack() {
        F[0x1a354] = { e, r -> e.m.w8(UNITS + r.esi + U.ORDER, 0x37); r }
    }

    /** Поиск цели кольцами вокруг поста юнита (0x1a526/0x1a531). */
    private fun findTarget(eng: Engine, esi: Int, ebx: Int): Int {
        val m = eng.m; val b = UNITS + esi
        var ecx = m.u32(0x3058c + ebx * 4) - 1
        var ebp = 4
        val owner = m.u8(b + U.OWNER)
        val mapW = m.u16(G.mapW); val mapH = m.u16(G.mapH)
        while (true) {
            val dx = (m.u8(b + 0x44) + m.i16(0x305d0 + ebp)) and 0xffff
            if (dx < mapW) {
                val tb = (m.u8(b + 0x45) + m.i16(0x305d2 + ebp)) and 0xffff
                if (tb < mapH) {
                    val gi = dx + (tb shl 8)
                    var ok = false
                    val bi = m.u8(BI + gi)
                    if ((bi and 0xfc) != 0) ok = owner != (((bi shr 2) - 1) and 0xff)
                    else { val mo = m.u8(MO + gi); if ((mo and 0xf0) != 0) ok = owner != (((mo shr 4) - 1) and 0xff) }
                    if (ok) {
                        var edi = call(eng, 0x1a692, Regs(edx = dx, ebx = tb)).esi
                        if (edi != 0 && m.u8(UNITS + edi + U.STATE) != 0x60) {
                            if (m.u8(UNITS + edi + U.OWNER) == owner) {
                                val st = m.u8(UNITS + edi + U.STATE)
                                if (st == 0x10 || st == 0x30) {
                                    edi = m.u32(UNITS + edi + U.TARGET)
                                    if (m.u8(UNITS + edi + U.STATE) != 0x60) return edi
                                }
                            } else {
                                if (owner >= 8) return edi
                                if (m.u8(0x32aec + owner) >= 1) return edi
                                if (m.u8(UNITS + edi + U.TYPE) < 0x1a) return edi
                            }
                        }
                    }
                }
            }
            ebp += 4; ecx--
            if (ecx == 0) return 0
        }
    }
}
