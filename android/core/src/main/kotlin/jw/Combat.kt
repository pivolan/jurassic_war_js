package jw

/**
 * Состояния боя 0x1x — порт combat.js в объёме, нужном для движения к цели и замаха.
 * Сам расчёт урона (0x1e758) и последствия удара пока не портированы: юнит доходит до врага
 * и машет, но урон не наносится. Пропуски видны в списке eng.todo, а не спрятаны.
 */
object Combat {
    private fun lo8(r: Int, v: Int) = (r and 0xff.inv()) or (v and 0xff)
    private fun s16(v: Int) = (v shl 16) shr 16

    /** Пересекается ли цель с прямоугольником досягаемости. */
    private fun rectHit(m: Mem, edi: Int, dx0: Int, ax0: Int, bx0: Int, cx0: Int): Boolean {
        val t = UNITS + edi
        val dx = s16(dx0); val ax = s16(ax0); val bx = s16(bx0); val cx = s16(cx0)
        val x0 = m.i16(t + U.X); val y0 = m.i16(t + U.Y)
        val x1 = m.i16(0x36dd2); val y1 = m.i16(0x36dd4)
        fun inside(x: Int, y: Int) = !(x < dx || x > ax || y < bx || y > cx)
        return inside(x0, y0) || inside(x1, y0) || inside(x1, y1) || inside(x0, y1)
    }

    fun register() {
        // 0x1a051: цель в зоне досягаемости? al=0 — да
        F[0x1a051] = { e, r ->
            val m = e.m; val b = UNITS + r.esi
            if ((m.u8(b + U.X) and 0x1f) != 0 || (m.u8(b + U.Y) and 0x1f) != 0) Regs(eax = lo8(r.eax, 1))
            else {
                var dx = m.u16(b + U.X); var bx = m.u16(b + U.Y)
                val ty = m.u8(b + U.TYPE)
                var ax = (dx + m.u16(0x303b6 + ty * 4)) and 0xffff
                var cx = (bx + m.u16(0x303b8 + ty * 4)) and 0xffff
                var ebp = -1
                if (ty < 5) {
                    val ws = m.i8(b + U.WEAPON)
                    if (ws != -1) {
                        val it = m.u8(b + U.INV + ws)
                        if (it == 4) ebp = m.u8(b + U.SPD) shr 6
                        else if (it in 5..7) ebp = m.u8(b + U.SPD) shr 5
                    }
                } else if (ty <= 8) ebp = m.u8(b + U.SPD) shr 5
                else if (ty == 0xd) ebp = 0
                if (ebp >= 0) {
                    val rx = m.u16(0x3055e + ebp * 4); val ry = m.u16(0x30560 + ebp * 4)
                    dx = if (dx >= rx) dx - rx else 0
                    bx = if (bx >= ry) bx - ry else 0
                    ax = (ax + rx) and 0xffff; cx = (cx + ry) and 0xffff
                }
                val t = UNITS + r.edi; val tt = m.u8(t + U.TYPE)
                m.w16(0x36dd2, m.u16(t + U.X) + m.u16(0x303b6 + tt * 4))
                m.w16(0x36dd4, m.u16(t + U.Y) + m.u16(0x303b8 + tt * 4))
                Regs(eax = lo8(ax, if (rectHit(m, r.edi, dx, ax, bx, cx)) 0 else 1))
            }
        }

        // 0x1a7cb: кадр замаха и сам удар на нужном кадре
        F[0x1a7cb] = { e, r ->
            val m = e.m; val esi = r.esi; val b = UNITS + esi
            val ty = m.u8(b + U.TYPE)
            if (ty < 9) {
                m.w8(b + U.ATKCTR, m.u8(b + U.ATKCTR) + 1)
                if (m.u8(b + U.ATKCTR) > 7) {
                    m.w8(b + U.ATKCTR, 0)
                    opt(e, 0x1e758, Regs(esi = esi, edi = m.u32(b + U.TARGET)))   // урон — ещё не портирован
                    opt(e, 0x1c72b, Regs(esi = esi))
                }
                val ty1 = m.u8(b + U.TYPE)        // тип перечитывается: убийство могло повысить юнита
                var bx = (m.u16(0x36e8c + ty1 * 2) + m.u16(0x36ecc + m.u16(b + U.DIR) * 2)) and 0xffff
                val f = m.u8(b + U.ATKCTR)
                val ws = m.u8(b + U.WEAPON)
                var ranged = false
                if (ws != 0xff) { val it = m.u8(b + U.INV + ws); ranged = it in 5..7 }
                bx = (bx + m.u16((if (ranged) 0x36ef0 else 0x36f00) + f * 2)) and 0xffff
                m.w16(b + U.SPR, bx)
            } else {
                if (m.u8(b + U.ATKCTR) == 6) {
                    opt(e, 0x1e758, Regs(esi = esi, edi = m.u32(b + U.TARGET)))
                    if (m.u8(b + U.TYPE) < 0xe) opt(e, 0x1c72b, Regs(esi = esi))
                }
                m.w8(b + U.ATKCTR, m.u8(b + U.ATKCTR) + 1)
                var вышли = false
                if (m.u8(b + U.ATKCTR) > 7) {
                    m.w8(b + U.ATKCTR, 2)
                    if (m.u8(b + U.TYPE) == 0xd) { m.w8(b + U.STATE, 0x12); m.w8(b + U.ATKCTR, 8); вышли = true }
                }
                if (!вышли) {
                    val ty2 = m.u8(b + U.TYPE)
                    val bx = (m.u16(0x36e8c + ty2 * 2) + m.u16(0x36ebc + m.u8(b + U.ATKCTR) * 2) +
                              m.u16(0x36ede + m.u16(b + U.DIR) * 2)) and 0xffff
                    m.w16(b + U.SPR, bx)
                }
            }
            r
        }

        // 0x18bb3: состояния 0x1x — подойти к цели и бить
        F[0x18bb3] = { e, r ->
            val m = e.m; val esi = r.esi; val b = UNITS + esi
            var edi = m.u32(b + U.TARGET)
            val st = m.u8(b + U.STATE)

            fun setDstToTarget() {
                val t = UNITS + edi
                m.w16(b + U.DSTX, m.u16(t + U.X) and 0xffe0)
                m.w16(b + U.DSTY, m.u16(t + U.Y) and 0xffe0)
            }
            fun afterMove() {                                     // 0x18c17
                if ((m.u8(b + U.X) and 0x1f) != 0 || (m.u8(b + U.Y) and 0x1f) != 0) return
                m.w8(b + 0x44, m.u16(b + U.X) ushr 5); m.w8(b + 0x45, m.u16(b + U.Y) ushr 5)
                val bx = ((m.u8(b + U.SPD) shr 6) + 2) and 0xffff
                val f = call(e, 0x1a531, Regs(esi = esi, ebx = bx)).edi
                if (f != 0) call(e, 0x19fdf, Regs(esi = esi, edi = f))
            }
            fun start() {                                          // 0x18dc4
                if (edi != 0) { setDstToTarget(); m.w8(b + U.STATE, 0x11); call(e, 0x1db94, Regs(esi = esi)) }
                else { m.w8(b + U.STATE, 0x11); call(e, 0x1db94, Regs(esi = esi)); afterMove() }
            }
            fun state12() {
                m.w8(b + U.ATKCTR, m.u8(b + U.ATKCTR) - 1)
                if (m.u8(b + U.ATKCTR) == 0) start() else call(e, 0x1a773, Regs(esi = esi))
            }
            fun state11() {                                        // 0x18d57
                if (st == 0x11) {
                    if ((call(e, 0x1dc43, Regs(esi = esi)).eax and 0xff) != 0) return
                    edi = m.u32(b + U.TARGET); setDstToTarget(); call(e, 0x1db94, Regs(esi = esi))
                } else {
                    m.w8(b + U.STATE, 0x12)
                    m.w8(b + U.ATKCTR, (0x10 - (m.u8(b + U.SPD) shr 4)) and 0xff)
                }
            }

            if (st == 0x1f) start()
            else if (edi == 0) {                                   // 0x18c09
                if ((call(e, 0x1dc43, Regs(esi = esi)).eax and 0xff) == 0) call(e, 0x1a34c, Regs(esi = esi))
                else afterMove()
            } else {
                val ts = m.u8(UNITS + edi + U.STATE)
                if (ts == 0x60 || ts == 0x6f) {                    // цель мертва
                    if ((m.u8(b + U.X) and 0x1f) == 0 && (m.u8(b + U.Y) and 0x1f) == 0) call(e, 0x1a34c, Regs(esi = esi))
                    else if (st == 0x12) state12() else state11()
                } else if (st == 0x12) state12()
                else if ((call(e, 0x1a051, Regs(esi = esi, edi = edi)).eax and 0xff) != 0) {
                    val ty = m.u8(b + U.TYPE)
                    var передумал = false
                    if (ty in 0xe..0x17) {
                        m.w32(G.rngRange, 0xc8)
                        if (e.randRaw() == 0x64) { call(e, 0x1a34c, Regs(esi = esi)); передумал = true }
                    }
                    if (!передумал) state11()
                } else {
                    if (st != 0x10) {
                        if (m.u8(b + U.TYPE) == 4 && m.u8(UNITS + edi + U.TYPE) >= 0x1a &&
                            m.u8(b + 0x59) == 0xe && m.u8(UNITS + edi + U.OWNER) != m.u8(b + U.OWNER)) {
                            opt(e, 0x1d9cd, Regs(esi = esi, edi = edi))       // конструктор чинит/строит
                        }
                        m.w8(b + U.STATE, 0x10); m.w8(b + U.ATKCTR, 2)
                        call(e, 0x1e0e0, Regs(esi = esi))
                    }
                    val t = UNITS + edi; val tt = m.u8(t + U.TYPE)
                    val dx = (m.u16(t + U.X) + m.u16(0x30456 + tt * 4)) and 0xffe0
                    val bx = (m.u16(t + U.Y) + m.u16(0x30458 + tt * 4)) and 0xffe0
                    m.w16(b + U.DSTX, dx); m.w16(b + U.DSTY, bx)
                    val d0 = call(e, 0x1a95d, Regs(esi = esi, edx = dx, ebx = bx, eax = 0)).eax
                    val d1 = call(e, 0x1aa10, Regs(esi = esi, edx = dx, ebx = bx, eax = d0)).eax
                    m.w16(b + U.DIR, d1 and 0xffff)
                    call(e, 0x1a7cb, Regs(esi = esi))
                }
            }
            r
        }
    }
}
