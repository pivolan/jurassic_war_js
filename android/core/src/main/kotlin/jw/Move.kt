package jw

/**
 * Движение, сетки и поиск пути — порт reimpl/js/port/move.js (он же построчный порт pwar.exe).
 *
 * Поиск пути в оригинале не строит маршрут заранее. Юнит идёт напрямую, а упёршись в преграду,
 * обходит её «вдоль стены»: две симуляции обхода — левым и правым боком, — и выбирается та,
 * что подходит ближе к цели. Отсюда и знаменитое топтание у препятствий.
 */
object Move {
    private fun w16(x: Int) = x and 0xffff
    private fun abs16(x0: Int): Int { val x = x0 and 0xffff; return if ((x and 0x8000) != 0) (0x10000 - x) and 0xffff else x }
    private fun lo8(r: Int, v: Int) = (r and 0xff.inv()) or (v and 0xff)

    fun register() {
        // 0x1e685: можно ли встать на тайл. ZF=false только если проходим и свободен.
        F[0x1e685] = { e, r ->
            val m = e.m; val esi = r.esi; val ebp = r.ebp
            val edx = w16(r.edx) ushr 5
            var ebx = w16(r.ebx) ushr 5
            when {
                edx >= m.u32(G.mapW) -> Regs(eax = 0, zf = true)
                ebx >= m.u32(G.mapH) -> Regs(eax = 0, zf = true)
                m.u8(UNITS + esi + U.TYPE) == 0xb -> {                      // летающий: своя сетка MO
                    val idx = edx + (ebx shl 8)
                    when {
                        (m.u8(MO + idx) and 0xf0) == 0 -> Regs(eax = 1, zf = false)
                        (m.u8(MO + idx) and 0x0f) == 0 -> Regs(eax = 1, zf = true)
                        else -> Regs(eax = 2, zf = true)
                    }
                }
                else -> {
                    ebx = ebx shl 9
                    val ax = m.u16(BG + ebx + edx * 2)
                    if ((ax and 0xf800) != 0) Regs(eax = 0, zf = true)      // крупный объект
                    else {
                        val al = m.u8(0x3183c + ax)
                        ebx = ebx shr 1
                        if ((al and 1) == 0) Regs(eax = 0, zf = true)       // непроходимый тайл
                        else {
                            fun occ(a: Int) = if ((m.u8(a) and 0x0f) != 0) Regs(eax = 2, zf = true) else Regs(eax = 1, zf = true)
                            if ((m.u8(BI + edx + ebx) and 0xfc) != 0) occ(MO + edx + ebx)
                            else {
                                val cell = ebx + edx
                                var off = m.i32(0x37910 + ebp * 8)
                                var cmp = m.u8(0x37958 + ebp * 2)
                                if (m.u8(MO + cell + off) == cmp) occ(MO + cell + off)
                                else {
                                    off = m.i32(0x37914 + ebp * 8); cmp = m.u8(0x37959 + ebp * 2)
                                    if (m.u8(MO + cell + off) == cmp) occ(MO + cell + off)
                                    else Regs(eax = 0, zf = false)
                                }
                            }
                        }
                    }
                }
            }
        }

        // 0x1e56d: занять тайл — направление в MO, владелец в BI
        F[0x1e56d] = { e, r ->
            val m = e.m; val esi = r.esi
            val edx = w16(r.edx) ushr 5
            var ebx = w16(r.ebx) ushr 5
            m.w8(UNITS + esi + 0x53, edx); m.w8(UNITS + esi + 0x54, ebx)
            ebx = (ebx shl 8) + edx
            val cl = m.u8(UNITS + esi + U.DIR)
            var al = (m.u8(UNITS + esi + U.OWNER) + 1) and 0xff
            if (m.u8(UNITS + esi + U.TYPE) != 0xb) {
                m.w8(MO + ebx, (m.u8(MO + ebx) and 0xf0) or cl)
                al = (al shl 2) and 0xff
                m.w8(BI + ebx, (m.u8(BI + ebx) and 3) or al)
            } else {
                al = ((al shl 4) and 0xff) or cl
                m.w8(MO + ebx, al)
            }
            r
        }

        // 0x1e5cc: освободить тайл
        F[0x1e5cc] = { e, r ->
            val m = e.m; val esi = r.esi
            val edx = w16(r.edx) ushr 5
            var ebx = w16(r.ebx) ushr 5
            m.w8(UNITS + esi + 0x53, edx); m.w8(UNITS + esi + 0x54, ebx)
            ebx = (ebx shl 8) + edx
            if (m.u8(UNITS + esi + U.TYPE) != 0xb) {
                m.w8(MO + ebx, m.u8(MO + ebx) and 0xf0); m.w8(BI + ebx, m.u8(BI + ebx) and 3)
            } else m.w8(MO + ebx, 0)
            r
        }

        // 0x1a463: цель ещё в радиусе обзора? (с шансом «бросить погоню»)
        F[0x1a463] = { e, r ->
            val m = e.m; val esi = r.esi
            m.w32(G.rngRange, m.u8(UNITS + esi + U.SPD))
            val rnd = e.randRaw()
            if (rnd < 0x10) Regs(zf = rnd == 0x10)
            else {
                val eax = m.u8(UNITS + esi + U.SPD) ushr 4
                var ecx = m.u32(0x3058c + eax * 4)
                var edi = 0
                var нашли = false
                while (true) {
                    var ax = w16(((m.u16(UNITS + esi + U.X) ushr 5) + m.u16(0x305d0 + edi)) shl 5)
                    if (ax == w16(r.edx)) {
                        ax = w16(((m.u16(UNITS + esi + U.Y) ushr 5) + m.u16(0x305d2 + edi)) shl 5)
                        if (ax == w16(r.ebx)) { нашли = true; break }
                    }
                    edi += 4; ecx--
                    if (ecx == 0) break
                }
                Regs(zf = нашли)
            }
        }

        F[0x1a344] = { e, r -> e.m.w8(UNITS + r.esi + U.ORDER, 0x2f); r }
        F[0x1a386] = { e, r ->
            e.m.w8(UNITS + r.edi + U.ORDER, r.eax and 0xff)
            e.m.w32(UNITS + r.edi + 0x47, r.esi); r
        }

        // 0x1a6e3: следующий кадр ходьбы
        F[0x1a6e3] = { e, r ->
            val m = e.m; val esi = r.esi
            val type = m.u8(UNITS + esi + U.TYPE)
            var bx: Int; val al: Int
            if (type < 9) {
                bx = m.u16(0x36e38 + type * 2)
                bx = w16(bx + m.u16(0x36e18 + m.u8(UNITS + esi + U.ATKCTR) * 2))
                bx = w16(bx + m.u16(0x36e68 + m.u16(UNITS + esi + U.DIR) * 2))
                al = m.u16(UNITS + esi + U.DIR) and 0xff
            } else {
                bx = m.u16(0x36e38 + type * 2)
                bx = w16(bx + m.u16(0x36e28 + m.u8(UNITS + esi + U.ATKCTR) * 2))
                bx = w16(bx + m.u16(0x36e7a + m.u8(UNITS + esi + U.DIR) * 2))
                al = m.u8(UNITS + esi + U.DIR)
            }
            m.w16(UNITS + esi + U.SPR, bx)
            val c = (m.u8(UNITS + esi + U.ATKCTR) + 1) and 0xff
            m.w8(UNITS + esi + U.ATKCTR, c)
            if (c > 7) m.w8(UNITS + esi + U.ATKCTR, 0)
            Regs(eax = al)
        }

        // 0x1a984: поправка направления по соотношению |dx|:|dy|
        F[0x1a984] = { e, r ->
            val m = e.m; val esi = r.esi
            val dir = r.eax
            var al = r.eax and 0xff
            val dx = abs16(w16(r.edx) - m.u16(UNITS + esi + U.X))
            val bx = abs16(w16(r.ebx) - m.u16(UNITS + esi + U.Y))
            if (dir == 2 || dir == 6) {
                if (dx < bx) { if (bx > dx) al = (al - 1) and 0xff }
                else if (dx > bx) al = (al + 1) and 0xff
            } else if (dir == 4 || dir == 8) {
                if (dx <= bx) { if (bx > dx) { al = (al + 1) and 0xff; if (al >= 9) al = 1 } }
                else al = (al - 1) and 0xff
            }
            Regs(eax = lo8(r.eax, al))
        }

        // 0x1e19b / 0x1e11e: симуляции обхода вдоль стены и выбор лучшей стороны
        F[0x1e19b] = { e, r ->
            val m = e.m
            m.w8(0x37988, 1)
            if (m.u8(UNITS + r.esi + 0x3f) == 1) { call(e, 0x1e1c5, r); Regs(ecx = m.u16(0x37978)) }
            else { call(e, 0x1e399, r); Regs(ecx = m.u16(0x3796c)) }
        }
        F[0x1e11e] = { e, r ->
            val m = e.m; val esi = r.esi
            m.w8(0x37988, 0)
            call(e, 0x1e399, r); call(e, 0x1e1c5, r)
            fun side0() = Regs(eax = 0, edx = m.u16(0x37970), ebx = m.u16(0x37972), ecx = m.u16(0x37974))
            fun side1() = Regs(eax = 1, edx = m.u16(0x3797c), ebx = m.u16(0x3797e), ecx = m.u16(0x37980))
            var ax = m.u16(0x3796e); var b = m.u16(0x3797a)
            when {
                b > ax -> side0()
                b < ax -> side1()
                else -> {
                    ax = m.u16(0x37976); b = m.u16(0x37982)
                    when {
                        b < ax -> side1()
                        b > ax -> side0()
                        else -> {
                            ax = m.u16(0x37974); b = m.u16(0x37980)
                            when {
                                b < ax -> side1()
                                b > ax -> side0()
                                else -> if (m.u8(UNITS + esi + 0x3f) == 1) side1() else side0()
                            }
                        }
                    }
                }
            }
        }
        F[0x1e399] = { e, r -> wallSim(e, r, 0); r }
        F[0x1e1c5] = { e, r -> wallSim(e, r, 1); r }

        // 0x1df84: куда шагать и надо ли обходить
        F[0x1df84] = { e, r -> chooseDir(e, r) }

        // 0x1de57: следующее направление на границе тайла
        F[0x1de57] = { e, r -> nextDir(e, r) }

        // 0x1db94: начало движения к точке [+37]/[+39]
        F[0x1db94] = { e, r ->
            val m = e.m; val esi = r.esi
            var ушёл = false
            if (m.u8(0x32aec + m.u8(UNITS + esi + U.OWNER)) != 0) {
                val c = call(e, 0x14873, Regs(esi = esi, eax = 0x1a))
                if (!c.cf) {
                    var dx = abs16(m.u16(UNITS + esi + U.X) - m.u16(UNITS + esi + U.DSTX))
                    val bx = abs16(m.u16(UNITS + esi + U.Y) - m.u16(UNITS + esi + U.DSTY))
                    if (dx < bx) dx = bx
                    if (dx >= 0x140) {                          // далеко — ИИ телепортируется
                        call(e, 0x1a393, Regs(esi = esi, eax = 0xb2,
                            edx = m.u16(UNITS + esi + U.DSTX), ebx = m.u16(UNITS + esi + U.DSTY)))
                        ушёл = true
                    }
                }
            }
            if (!ушёл) {
                m.w16(UNITS + esi + 0x3b, 0); m.w8(UNITS + esi + 0x40, 0); m.w8(UNITS + esi + U.ATKCTR, 0)
                val d = call(e, 0x1a95d, Regs(esi = esi, edx = m.u16(UNITS + esi + U.DSTX), ebx = m.u16(UNITS + esi + U.DSTY))).eax
                if (d != 0) m.w16(UNITS + esi + U.DIR, d)
                call(e, 0x1a773, Regs(esi = esi))
                call(e, 0x1e56d, Regs(esi = esi, edx = m.u16(UNITS + esi + U.X), ebx = m.u16(UNITS + esi + U.Y)))
            }
            r
        }

        // 0x1dc43: шаг движения. eax = 0 — пришли на место
        F[0x1dc43] = { e, r -> stepMove(e, r) }
    }

    /** Симуляция обхода одной стороной: side=0 — левым боком (0x1e399), 1 — правым (0x1e1c5). */
    private fun wallSim(eng: Engine, r: Regs, side: Int) {
        val m = eng.m; val esi = r.esi
        val pos: Int; val cnt: Int; val bestcnt: Int; val best: Int; val res: Int; val rotA: Int; val rotB: Int
        if (side == 1) { pos = 0x3797c; cnt = 0x3797a; bestcnt = 0x37982; best = 0x37980; res = 0x37978; rotA = 0x37818; rotB = 0x377f4 }
        else { pos = 0x37970; cnt = 0x3796e; bestcnt = 0x37976; best = 0x37974; res = 0x3796c; rotA = 0x377f4; rotB = 0x37818 }
        val saved = m.u32(UNITS + esi + U.X)
        m.w16(UNITS + esi + U.X, m.u16(UNITS + esi + U.X) ushr 5)
        m.w16(UNITS + esi + U.Y, m.u16(UNITS + esi + U.Y) ushr 5)
        m.w32(pos, m.u32(UNITS + esi + U.X))
        val tx = m.u16(UNITS + esi + U.DSTX) ushr 5
        val ty = m.u16(UNITS + esi + U.DSTY) ushr 5
        m.w16(0x37984, tx); m.w16(0x37986, ty); m.w16(cnt, 0); m.w16(bestcnt, 0)
        m.w16(best, w16(abs16(tx - m.u16(UNITS + esi + U.X)) + abs16(ty - m.u16(UNITS + esi + U.Y))))
        var ebp = m.u16(UNITS + esi + U.DIR)
        var edi = m.u16(UNITS + esi + 0x3b)
        while (true) {
            val x = m.u16(UNITS + esi + U.X); val y = m.u16(UNITS + esi + U.Y)
            if (x == m.u16(0x37984) && y == m.u16(0x37986)) { m.w16(res, 0); break }
            if (edi == 0) ebp = call(eng, 0x1a95d, Regs(esi = esi, edx = m.u16(0x37984), ebx = m.u16(0x37986))).eax
            var ecx = 2
            while (edi != 0) { ebp = m.u32(rotA + ebp * 4); edi--; ecx--; if (ecx == 0) break }
            var moved = false
            var cl = 8
            while (cl > 0) {
                val dx = w16((x + m.u16(0x30504 + ebp * 4)) shl 5)
                val bx = w16((y + m.u16(0x30506 + ebp * 4)) shl 5)
                val t = call(eng, 0x1e685, Regs(esi = esi, edx = dx, ebx = bx, ebp = ebp))
                if (!t.zf || (t.eax and 0xff) > 1) { moved = true; break }
                edi++; ebp = m.u32(rotB + ebp * 4)
                cl--
            }
            if (!moved) { m.w16(res, 1); break }
            m.w16(UNITS + esi + U.X, w16(x + m.u16(0x30504 + ebp * 4)))
            m.w16(UNITS + esi + U.Y, w16(y + m.u16(0x30506 + ebp * 4)))
            m.w16(cnt, m.u16(cnt) + 1)
            if (m.u16(cnt) >= 0xc8) { m.w16(res, 1); break }
            val nx = m.u16(UNITS + esi + U.X); val ny = m.u16(UNITS + esi + U.Y)
            val d = w16(abs16(m.u16(0x37984) - nx) + abs16(m.u16(0x37986) - ny))
            if (m.u16(best) > d) { m.w16(best, d); m.w16(bestcnt, m.u16(cnt)); m.w16(pos, nx); m.w16(pos + 2, ny) }
        }
        m.w16(pos, w16(m.u16(pos) shl 5)); m.w16(pos + 2, w16(m.u16(pos + 2) shl 5))
        m.w32(UNITS + esi + U.X, saved)
    }

    /** 0x1df84 */
    private fun chooseDir(eng: Engine, r: Regs): Regs {
        val m = eng.m; val esi = r.esi
        fun x() = m.u16(UNITS + esi + U.X)
        fun y() = m.u16(UNITS + esi + U.Y)
        fun fin() = Regs(cf = false, eax = m.u8(UNITS + esi + 0x3f), edx = x(), ebx = y())
        if (m.u16(UNITS + esi + 0x3b) > 1) {
            val t = call(eng, 0x1e19b, r)
            return if ((t.ecx and 0xff) != 0) fin() else Regs(cf = true)
        }
        var dx = m.u16(UNITS + esi + U.DSTX); var bx = m.u16(UNITS + esi + U.DSTY)
        var eax = call(eng, 0x1a95d, Regs(esi = esi, edx = dx, ebx = bx)).eax
        if (m.u16(UNITS + esi + 0x3b) >= 1) eax = call(eng, 0x1a984, Regs(esi = esi, eax = eax, edx = dx, ebx = bx)).eax
        m.w16(UNITS + esi + U.DIR, eax); m.w16(UNITS + esi + 0x3b, 0)
        dx = w16(x() + m.u16(0x30528 + eax * 4)); bx = w16(y() + m.u16(0x3052a + eax * 4))
        val t = call(eng, 0x1e685, Regs(esi = esi, edx = dx, ebx = bx, ebp = eax))
        if (!t.zf) return Regs(cf = true)                        // прямо свободно
        if ((t.eax and 0xff) >= 2) return Regs(cf = true)
        val st = m.u8(UNITS + esi + U.STATE)
        var far = false
        if (st == 0x11 || st == 0x31 || st >= 0x80 || st >= 0x50) far = true
        else {
            dx = abs16(m.u16(UNITS + esi + U.DSTX) - x())
            bx = abs16(m.u16(UNITS + esi + U.DSTY) - y())
            if (bx <= dx) bx = dx
            if (bx >= 0xe0) { if (bx >= 0x180) return farPath(eng, r, false); far = true }
            else {
                val c = call(eng, 0x1e609, Regs(esi = esi, edx = m.u16(UNITS + esi + U.DSTX), ebx = m.u16(UNITS + esi + U.DSTY)))
                if (!c.zf) { if (bx >= 0x180) return farPath(eng, r, false); far = true }
                else if ((c.eax and 0xff) >= 2) far = true
                else return fin()
            }
        }
        return farPath(eng, r, far)
    }

    /** 0x1e099 / 0x1e0a0 — дальний обход. */
    private fun farPath(eng: Engine, r: Regs, flag: Boolean): Regs {
        val m = eng.m; val esi = r.esi
        if (flag) m.w8(0x377f1, 1)
        val t = call(eng, 0x1e11e, r)
        m.w8(0x377f1, 0)
        val ret = Regs(cf = false, eax = t.eax, edx = t.edx, ebx = t.ebx, ecx = t.ecx)
        if ((t.eax and 0xff) == 0) { if (m.u16(0x3796e) < 0xc3) return ret }
        else if (m.u16(0x3797a) < 0xc3) return ret
        if ((t.ecx and 0xffff) <= 0xf) return ret
        ret.edx = m.u16(UNITS + esi + U.X); ret.ebx = m.u16(UNITS + esi + U.Y)
        return ret
    }

    /** 0x1de57 */
    private fun nextDir(eng: Engine, r: Regs): Regs {
        val m = eng.m; val esi = r.esi
        fun x() = m.u16(UNITS + esi + U.X)
        fun y() = m.u16(UNITS + esi + U.Y)
        if (m.u32(UNITS + esi + U.X) == m.u32(UNITS + esi + U.DSTX)) return Regs(eax = 0)
        val p = chooseDir(eng, r)
        if (!p.cf) {
            m.w8(UNITS + esi + 0x3f, p.eax and 0xff)
            m.w16(UNITS + esi + U.DSTX, p.edx); m.w16(UNITS + esi + U.DSTY, p.ebx)
        }
        if (m.u32(UNITS + esi + U.X) == m.u32(UNITS + esi + U.DSTX)) return Regs(eax = 0)
        var di = m.u16(UNITS + esi + 0x3b)
        var ebp = m.u16(UNITS + esi + U.DIR)
        m.w16(0x377f2, di)
        var cl = 2
        while (di != 0) {
            di--
            ebp = m.u32((if (m.u8(UNITS + esi + 0x3f) != 0) 0x37818 else 0x377f4) + ebp * 4)
            cl--; if (cl == 0) break
        }
        m.w8(0x377f0, 0)
        var edi = di
        cl = 8
        while (cl > 0) {
            val dx = w16(x() + m.u16(0x30528 + ebp * 4))
            val bx = w16(y() + m.u16(0x3052a + ebp * 4))
            val t = call(eng, 0x1e685, Regs(esi = esi, edx = dx, ebx = bx, ebp = ebp))
            if (!t.zf) {
                if (edi == 0) m.w8(UNITS + esi + 0x40, 0)
                return Regs(eax = ebp, ecx = 0, edi = edi)
            }
            if (m.u8(UNITS + esi + 0x40) < 1)
                return Regs(eax = m.u16(UNITS + esi + U.DIR), edi = m.u16(0x377f2), ecx = 3)
            edi++
            ebp = m.u32((if (m.u8(UNITS + esi + 0x3f) != 0) 0x377f4 else 0x37818) + ebp * 4)
            cl--
        }
        return if (m.u8(0x377f0) == 0) Regs(eax = 0)
        else Regs(eax = m.u16(UNITS + esi + U.DIR), edi = m.u16(0x377f2), ecx = 3)
    }

    /** 0x1dc43 */
    private fun stepMove(eng: Engine, r: Regs): Regs {
        val m = eng.m; val esi = r.esi
        fun x() = m.u16(UNITS + esi + U.X)
        fun y() = m.u16(UNITS + esi + U.Y)
        fun arrive(): Regs {                                      // 0x1dcfe
            val edx = m.u8(UNITS + esi + 0x53)
            val ebx = m.u8(UNITS + esi + 0x54) shl 8
            if (m.u8(UNITS + esi + U.TYPE) != 0xb) m.w8(MO + edx + ebx, m.u8(MO + edx + ebx) and 0xf0)
            else {
                val cl = ((m.u8(UNITS + esi + U.OWNER) + 1) shl 4) and 0xff
                m.w8(MO + edx + ebx, (m.u8(MO + edx + ebx) and 0x0f) or cl)
            }
            if (m.u8(G.humanOwner) == m.u8(UNITS + esi + U.OWNER)) call(eng, 0x1a4cc, Regs(esi = esi))
            return Regs(eax = 0)
        }
        if (m.u8(UNITS + esi + 0x40) > 1) {
            if (m.u16(UNITS + esi + 0x3b) > 0) {
                m.w8(UNITS + esi + 0x40, m.u8(UNITS + esi + 0x40) - 1)
                call(eng, 0x1a773, Regs(esi = esi))
                return Regs(eax = m.u16(UNITS + esi + U.DIR))
            }
            var blocked = false
            if (m.u8(UNITS + esi + 0x40) >= 0xc) blocked = true
            else {
                val ebp = m.u16(UNITS + esi + U.DIR)
                val t = call(eng, 0x1e685, Regs(esi = esi,
                    edx = w16(x() + m.u16(0x30528 + ebp * 4)), ebx = w16(y() + m.u16(0x3052a + ebp * 4)), ebp = ebp))
                if (t.zf) {                                        // тайл занят — идём вдоль стены дальше
                    m.w8(UNITS + esi + 0x40, m.u8(UNITS + esi + 0x40) + 1)
                    call(eng, 0x1a773, Regs(esi = esi))
                    return Regs(eax = m.u16(UNITS + esi + U.DIR))
                }
                blocked = true
            }
            if (blocked) {
                if (m.u32(UNITS + esi + U.X) == m.u32(UNITS + esi + U.DSTX)) return arrive()
                val p = chooseDir(eng, r)
                if (!p.cf) {
                    m.w8(UNITS + esi + 0x3f, p.eax and 0xff)
                    m.w16(UNITS + esi + U.DSTX, p.edx); m.w16(UNITS + esi + U.DSTY, p.ebx)
                }
                m.w8(UNITS + esi + 0x40, 1)
            }
        }
        if ((m.u32(UNITS + esi + U.X) and 0x1f001f) == 0) {         // ровно на тайле
            val n = nextDir(eng, r)
            if ((n.eax and 0xff) == 0) return arrive()
            m.w16(UNITS + esi + U.DIR, n.eax)
            if ((n.ecx and 0xff) != 0) { m.w8(UNITS + esi + 0x40, n.ecx and 0xff); return Regs(eax = n.eax) }
            m.w16(UNITS + esi + 0x3b, n.edi)
            call(eng, 0x1e5cc, Regs(esi = esi,
                edx = w16(m.u8(UNITS + esi + 0x53) shl 5), ebx = w16(m.u8(UNITS + esi + 0x54) shl 5)))
            val eax = n.eax and 0xffff
            call(eng, 0x1e56d, Regs(esi = esi,
                edx = w16(m.u16(0x30528 + eax * 4) + x()), ebx = w16(m.u16(0x3052a + eax * 4) + y())))
            if (m.u8(G.humanOwner) == m.u8(UNITS + esi + U.OWNER)) call(eng, 0x1a4cc, Regs(esi = esi))
        }
        // 0x1ddc1: сам сдвиг на несколько пикселей
        val eax = m.u16(UNITS + esi + U.DIR)
        val c = (m.u8(UNITS + esi + 0x41) - 1) and 0xff
        m.w8(UNITS + esi + 0x41, c)
        if (c == 0) {
            var bl = (0xff - m.u8(UNITS + esi + U.SPD)) and 0xff
            bl = (bl ushr 5) + 1
            m.w8(UNITS + esi + 0x41, bl)
            m.w16(UNITS + esi + U.X, w16(x() + m.u16(0x3788a + eax * 4)))
            m.w16(UNITS + esi + U.Y, w16(y() + m.u16(0x37888 + eax * 4)))
        }
        m.w16(UNITS + esi + U.X, w16(x() + m.u16(0x37866 + eax * 4)))
        m.w16(UNITS + esi + U.Y, w16(y() + m.u16(0x37864 + eax * 4)))
        m.w16(UNITS + esi + U.X, w16(x() + m.u16(0x378d0 + (x() and 0x1f) * 2)))
        m.w16(UNITS + esi + U.Y, w16(y() + m.u16(0x378d0 + (y() and 0x1f) * 2)))
        return call(eng, 0x1a6e3, Regs(esi = esi))
    }
}
