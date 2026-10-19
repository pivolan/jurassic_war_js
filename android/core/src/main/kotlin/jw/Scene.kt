package jw

/**
 * Слой юнитов, предметов и вывод спрайтов — порт reimpl/js/render/scene.js.
 *
 * Порядок сцены у оригинала такой: земля, предметы на земле, юниты, эффекты, туман. Юниты
 * рисуются не по списку, а по клеткам сверху вниз — иначе дальний юнит перекрыл бы ближнего.
 */
object Scene {
    private const val SLOTS = Sprites.SLOTS
    private const val LUT_SHADOW = 0x44f80
    private const val LUT_GLASS = 0x38210
    private val FB = Render.FB
    private val ROWS = Render.ROWS
    private val CAMX = Render.CAMX
    private val CAMY = Render.CAMY
    private val VW = Render.VW
    private val VH = Render.VH
    private const val XBASE = 0x488c0

    /** Отсечение спрайта по окну карты. Возвращает null, если спрайт целиком за краем. */
    private class Clip(val src: Int, val cx: Int, val cy: Int, val lclip: Int, val rclip: Int, val vis: Int, val vh: Int)

    private fun clip(m: Mem, slot: Int, x: Int, y: Int, mirrored: Boolean, fixedVW: Boolean): Clip? {
        val e = SLOTS + slot * 16
        val w0 = if (fixedVW) 640 else m.i32(VW)
        val h0 = if (fixedVW) 480 else m.i32(VH)
        val hx = m.i16(e + (if (mirrored) 0xc else 8))
        val hy = m.i16(e + (if (mirrored) 0xe else 0xa))
        val w = m.u16(e + 4); val h = m.u16(e + 6)
        var cx = x + hx; if (cx >= w0) return null
        var lclip = 0; if (cx < 0) { lclip = -cx; cx = 0 }
        var cy = y + hy; if (cy >= h0) return null
        var tclip = 0; if (cy < 0) { tclip = -cy; cy = 0 }
        var vis = w
        val t = cx + w; if (t < 0) return null
        var rclip = 0; if (t > w0) { rclip = t - w0; vis -= rclip }
        vis -= lclip; if (vis <= 0) return null
        var vh = h
        val b = cy + h; if (b < 0) return null
        if (b > h0) vh -= (b - h0)
        vh -= tclip; if (vh <= 0) return null
        m.w32(0x488cc, cx); m.w32(0x488dc, lclip); m.w32(0x488d0, cy); m.w32(0x488e0, tclip)
        m.w32(0x488e4, rclip); m.w32(0x488d4, vis); m.w32(0x488d8, vh)
        return Clip(w * tclip + m.u32(e), cx, cy, lclip, rclip, vis, vh)
    }

    /**
     * Вывод спрайта. Режимы: 0 — обычный, пиксель 1 даёт тень через таблицу; 1 — силуэт;
     * 2 — цвета команды (0xc0..0xc3 сдвигаются на цвет владельца) плюс тень; 3 — простая копия;
     * 4 — стекло через таблицу.
     */
    private fun blit(m: Mem, slot: Int, x: Int, y: Int, mode: Int, mirrored: Boolean, fixedVW: Boolean = false): Int {
        val c = clip(m, slot, x, y, mirrored, fixedVW) ?: return 1
        val b = m.b
        var src = c.src
        val base = m.u32(XBASE)
        val sil = m.u8(0x488e9)
        val team = m.u8(0x488e8)
        for (row in 0 until c.vh) {
            val y2 = c.cy + row
            var d = base + m.u32(ROWS + y2 * 4) + c.cx
            if (!mirrored) src += c.lclip else { src += c.rclip; d += c.vis - 1 }
            for (k in 0 until c.vis) {
                val p = b[src++].toInt() and 0xff
                if (p != 0) {
                    var v = p
                    when (mode) {
                        0 -> if (p == 1) v = b[LUT_SHADOW + (b[d].toInt() and 0xff)].toInt() and 0xff
                        1 -> if (p != 1) v = sil
                        2 -> if (p == 1) v = b[LUT_SHADOW + (b[d].toInt() and 0xff)].toInt() and 0xff
                             else if (p in 0xc0..0xc3) v = (p + team) and 0xff
                        4 -> v = b[LUT_GLASS + (((p - 0xb) and 0xff) shl 8) + (b[d].toInt() and 0xff)].toInt() and 0xff
                    }
                    b[d] = v.toByte()
                }
                if (!mirrored) d++ else d--
            }
            if (!mirrored) src += c.rclip else src += c.lclip
        }
        return 0
    }

    private fun plot(m: Mem, x: Int, y: Int, col: Int) {
        if (x in 0 until m.u32(VW) && y in 0 until m.u32(VH)) m.b[FB + m.u32(ROWS + y * 4) + x] = col.toByte()
    }

    private fun rect(m: Mem, x: Int, y: Int, w: Int, h: Int, col: Int) {
        for (k in 0 until w) { plot(m, x + k, y, col); plot(m, x + k, y + h - 1, col) }
        for (k in 0 until h) { plot(m, x, y + k, col); plot(m, x + w - 1, y + k, col) }
    }

    /** Таблица 0x3eb00: чем выводить юнита — зависит от пары «идёт/стоит» и направления. */
    private val BLIT4 = intArrayOf(0x2c970, 0x2c460, 0x2c82f, 0x2c320)

    private fun unitBlit(eng: Engine, i: Int, slot: Int, x: Int, y: Int): Int {
        val m = eng.m
        val idx = ((m.u8(UNITS + i + U.FX43) and 1) shl 1) or (if (m.u8(UNITS + i + U.DIR) < 6) 1 else 0)
        return if (call(eng, BLIT4[idx], Regs(eax = slot, edx = x, ebx = y)).cf) 1 else 0
    }

    /** Таблица 0x250b0: чем рисовать юнита по его типу. */
    private fun unitDraw(t: Int): Int = when {
        t == 0 -> 0x25150
        t < 9 -> 0x25151
        t < 24 -> 0x2540a
        t < 26 -> 0x254b6
        else -> 0x2550f
    }

    private fun afterBlit(m: Mem, i: Int, cl: Int): Boolean {
        m.w8(UNITS + i + 0x42, (m.u8(UNITS + i + 0x42) and 0xfe) or cl)
        return cl != 0
    }

    fun register() {
        // Блиттеры. cf несёт cl оригинала: 1 — спрайт целиком за краем окна.
        val блит = { mode: Int, mirror: Boolean, fixed: Boolean ->
            { e: Engine, r: Regs -> Regs(cf = blit(e.m, r.eax, r.edx, r.ebx, mode, mirror, fixed) != 0) }
        }
        F[0x2c1df] = блит(0, false, false)
        F[0x2c320] = блит(1, false, false)
        F[0x2c460] = блит(2, false, false)
        F[0x2c5b5] = блит(3, false, true)
        F[0x2c6e7] = блит(0, true, false)
        F[0x2c82f] = блит(1, true, false)
        F[0x2c970] = блит(2, true, false)
        F[0x1f875] = блит(4, false, false)

        // 0x23f44: уголки выделения и полоска здоровья у выделенного юнита
        F[0x23f44] = { e, r ->
            val m = e.m; val b = m.b; val i = r.esi
            if ((m.u8(UNITS + i + U.F07) and 0x80) != 0) {
                val owner = m.u8(UNITS + i + U.OWNER)
                val col = if (m.u8(G.humanOwner) == owner && m.u32(0x31adc) == i) 0xfc else m.u8(0x3054d + owner)
                m.w8(0x3d1b5, 4)
                var sh = m.u32(0x3d1b8 + m.u8(UNITS + i + U.TYPE) * 4)
                val x = m.u16(UNITS + i + U.X) - m.u32(CAMX)
                val y = m.u16(UNITS + i + U.Y) - m.u32(CAMY)
                val w = m.u32(VW); val h = m.u32(VH)
                for (c in 0 until 4) {
                    val yy = y + m.i32(sh + 4)
                    if (yy in 0 until h) {
                        var xx = x + m.i32(sh); var n = m.i32(sh + 8); val ro = m.u32(ROWS + yy * 4)
                        while (n != 0) { if (xx in 0 until w) b[FB + ro + xx] = col.toByte(); n--; xx++ }
                    }
                    val xx2 = x + m.i32(sh + 0xc)
                    if (xx2 in 0 until w) {
                        var yy2 = y + m.i32(sh + 0x10); var n = m.i32(sh + 0x14)
                        while (n != 0) { if (yy2 in 0 until h) b[FB + m.u32(ROWS + yy2 * 4) + xx2] = col.toByte(); n--; yy2++ }
                    }
                    m.w8(0x3d1b5, m.u8(0x3d1b5) - 1)
                    sh += 0x18
                }
                val rx = x + m.i32(sh); val ry = y + m.i32(sh + 4)
                rect(m, rx, ry, m.i32(sh + 8), m.i32(sh + 0xc), col)
                val by = ry + 1
                val hpmax = m.u8(UNITS + i + U.HPMAX)
                if (by < 0x1e0 && hpmax != 0) {
                    var len = (((m.i32(sh + 8) - 2) and 0xffff) * m.u8(UNITS + i + U.HP)) and 0xffff
                    len = (len / hpmax) and 0xff
                    if (len != 0) {
                        val hcol = m.u8(0x3e3d8 + m.u8(UNITS + i + U.HP))
                        val ro = m.u32(ROWS + by * 4)
                        var xx = rx
                        while (len != 0) {
                            xx++
                            if (w <= xx) break
                            for (k in 0 until 4) if (by + k in 0 until h) b[FB + ro + k * 640 + xx] = hcol.toByte()
                            len--
                        }
                    }
                }
            }
            r
        }

        F[0x25150] = { _, r -> r }                                   // тип 0 — не рисуется

        // 0x25151: люди и ручные ящеры — тело, оружие, щит, рамка, «отдых»
        F[0x25151] = { e, r ->
            val m = e.m; val i = r.esi
            m.w32(0x41640, i)
            m.w8(0x488e8, m.u8(0x30556 + m.u8(UNITS + i + U.OWNER)))
            val x = m.u16(UNITS + i + U.X) - m.u32(CAMX)
            val y = m.u16(UNITS + i + U.Y) - m.u32(CAMY)
            m.w32(0x41648, x); m.w32(0x4164c, y)
            val spr = m.u16(UNITS + i + U.SPR)
            m.w32(0x41644, spr)
            val st = m.u8(UNITS + i + U.STATE)
            val t = m.u8(UNITS + i + U.TYPE)
            val weapon = m.u8(UNITS + i + U.WEAPON); val shield = m.u8(UNITS + i + U.SHIELD)
            fun drawEquip(slot: Int) {
                val item = m.u8(UNITS + i + U.INV + slot)
                val s = spr - m.u32(0x416b4 + t * 4) + m.u32(0x41650 + item * 4)
                unitBlit(e, i, s, x, y)
            }
            if (st == 0x10 || st == 0x30) {
                var s = spr
                if (weapon != 0xff) {
                    val item = m.u8(UNITS + i + U.INV + weapon)
                    if (item in 5..7) s += m.u32(0x416c4 + t * 4)
                }
                if (!afterBlit(m, i, unitBlit(e, i, s, x, y))) {
                    if (weapon != 0xff) drawEquip(weapon)
                    if (shield != 0xff) drawEquip(shield)
                    call(e, 0x23f44, Regs(esi = i))
                }
            } else if (!afterBlit(m, i, unitBlit(e, i, spr, x, y))) {
                if (weapon != 0xff) drawEquip(weapon)
                if (shield != 0xff) drawEquip(shield)
                call(e, 0x23f44, Regs(esi = i))
                if (st == 0x20) call(e, 0x2c1df, Regs(eax = (m.u8(UNITS + i + U.ATKCTR) shr 3) + 0xaea, edx = x, ebx = y))
            }
            r
        }

        // 0x2540a: дикие звери и летающие
        F[0x2540a] = { e, r ->
            val m = e.m; val i = r.esi
            m.w8(0x488e8, m.u8(0x30556 + m.u8(UNITS + i + U.OWNER)))
            val x = m.u16(UNITS + i + U.X) - m.u32(CAMX)
            val y = m.u16(UNITS + i + U.Y) - m.u32(CAMY)
            m.w32(0x41648, x); m.w32(0x4164c, y); m.w32(0x41640, i)
            if (!afterBlit(m, i, unitBlit(e, i, m.u16(UNITS + i + U.SPR), x, y))) {
                call(e, 0x23f44, Regs(esi = i))
                if (m.u8(UNITS + i + U.STATE) == 0x20)
                    call(e, 0x2c1df, Regs(eax = (m.u8(UNITS + i + U.ATKCTR) shr 3) + 0xaea, edx = x, ebx = y))
            }
            r
        }

        // 0x254b6: растения
        F[0x254b6] = { e, r ->
            val m = e.m; val i = r.esi
            m.w32(0x41640, i)
            val x = m.u16(UNITS + i + U.X) - m.u32(CAMX)
            val y = m.u16(UNITS + i + U.Y) - m.u32(CAMY)
            val метод = if ((m.u8(UNITS + i + U.FX43) and 1) != 0) 0x2c320 else 0x2c1df
            val cl = if (call(e, метод, Regs(eax = m.u16(UNITS + i + U.SPR), edx = x, ebx = y)).cf) 1 else 0
            if (!afterBlit(m, i, cl)) call(e, 0x23f44, Regs(esi = i))
            r
        }

        // 0x2550f: здания, включая руины, «строится» и дымок
        F[0x2550f] = { e, r ->
            val m = e.m; val i = r.esi
            m.w32(0x41640, i)
            m.w8(0x41904, 0)
            m.w8(0x488e8, m.u8(0x30556 + m.u8(UNITS + i + U.OWNER)))
            val t = m.u8(UNITS + i + U.TYPE)
            val f50 = m.u8(UNITS + i + U.FLAGS50)
            var готово = false
            var spr = 0
            if ((f50 and 2) == 0) {
                if (m.u8(UNITS + i + U.STATE) == 0x60) {          // руины
                    spr = 0x982 + m.u8(UNITS + i + U.ATKCTR)
                    val k = (t - 0x1a) and 0xff
                    val x = ((m.i16(0x418cc + k * 4) + m.u16(UNITS + i + U.X)) and 0xffff) - m.u32(CAMX)
                    val y = ((m.i16(0x418ce + k * 4) + m.u16(UNITS + i + U.Y)) and 0xffff) - m.u32(CAMY)
                    call(e, 0x2c1df, Regs(eax = spr, edx = x, ebx = y))
                    готово = true
                } else {
                    spr = m.u32(0x416d4 + ((t - 0x1a) * 8 + m.u8(UNITS + i + U.SLOT)) * 4)
                    if (m.u8(UNITS + i + U.HP) < (m.u8(UNITS + i + U.HPMAX) shr 1)) { spr++; m.w8(0x41904, 1) }
                }
            } else {
                spr = if (m.u8(UNITS + i + 0x51) < (m.u8(UNITS + i + U.HPMAX) shr 1))
                    m.u32(0x41894 + (t - 0x1a) * 4)
                else m.u32(0x416d4 + ((t - 0x1a) * 8 + m.u8(UNITS + i + U.SLOT)) * 4) + 2
            }
            if (!готово) {
                m.w16(UNITS + i + U.SPR, spr)
                val x = m.u16(UNITS + i + U.X) - m.u32(CAMX)
                val y = m.u16(UNITS + i + U.Y) - m.u32(CAMY)
                val метод = if ((m.u8(UNITS + i + U.FX43) and 1) != 0) 0x2c320 else 0x2c460
                val cl = if (call(e, метод, Regs(eax = spr and 0xffff, edx = x, ebx = y)).cf) 1 else 0
                if (!afterBlit(m, i, cl)) {
                    call(e, 0x23f44, Regs(esi = i))
                    if (m.u8(0x41904) != 0) {                      // горит: анимация огня
                        var a = (m.u8(UNITS + i + U.XP) + 1) and 0xff
                        if (a >= 6) a = 0
                        m.w8(UNITS + i + U.XP, a)
                        val fx = (((m.i16(0x30456 + t * 4) + m.u16(UNITS + i + U.X)) shl 16) shr 16) - m.u32(CAMX)
                        val fy = (((m.i16(0x30458 + t * 4) + m.u16(UNITS + i + U.Y)) shl 16) shr 16) - m.u32(CAMY)
                        call(e, 0x2c1df, Regs(eax = a + 0xae0, edx = fx, ebx = fy))
                    } else if ((f50 and 2) == 0 && t in 0x1c..0x1d) {
                        var a = (m.u8(UNITS + i + 0x28) + 1) and 0xff
                        if (a >= 4) a = 0
                        m.w8(UNITS + i + 0x28, a)
                        call(e, 0x2c1df, Regs(eax = a + 0xae6, edx = x, ebx = y))
                    }
                }
            }
            r
        }

        // 0x26498: предметы на земле
        F[0x26498] = { e, _ ->
            val m = e.m
            val camX = m.u32(CAMX); val camY = m.u32(CAMY)
            var i = m.u32(0x31b7c)
            while (i != 0) {
                var spr = m.u8(ITEMS + i) + 0x9de
                val x = (m.u8(ITEMS + i + 1) shl 5) - camX
                val y = (m.u8(ITEMS + i + 2) shl 5) - camY
                if (spr == 0x9fc) {                                // еда: три размера кучи
                    val amt = m.u16(ITEMS + i + 6)
                    spr = if (amt >= 0xbb8) 0x9fe else if (amt >= 0x1f4) 0x9fc else 0x9fd
                }
                call(e, 0x2c1df, Regs(eax = spr, edx = x, ebx = y))
                i = m.u32(ITEMS + i + 0xc)
            }
            Regs()
        }

        // 0x24d70: слой юнитов. Сначала трупы, потом живые — по клеткам сверху вниз, чтобы
        // ближние перекрывали дальних; летающие рисуются последними, поверх всех.
        F[0x24d70] = { e, _ ->
            val m = e.m
            val head = m.u32(G.unitHead)
            var i = head
            while (i != 0) {
                val nx = m.u32(UNITS + i + U.NEXT)
                if ((m.u8(UNITS + i + U.FLAGS5B) and 1) == 0 && m.u8(UNITS + i + U.STATE) == 0x60 &&
                    m.u8(UNITS + i + U.TYPE) < 0x1a)
                    call(e, unitDraw(m.u8(UNITS + i + U.TYPE)), Regs(esi = i))
                i = nx
            }
            m.w32(0x3eb1c, 0)
            for (k in 0 until 0x228) {
                m.w32(0x3eb20 + k * 4, 0); m.w32(0x3f3c0 + k * 4, 0)
                m.w32(0x3fc60 + k * 4, 0); m.w32(0x40500 + k * 4, 0)
            }
            val camX = m.u32(CAMX); val camY = m.u32(CAMY)
            val x0 = if (camX < 0x80) 0 else camX - 0x80
            val y0 = if (camY < 0x80) 0 else camY - 0x80
            val x1 = minOf(camX + 0x280, 0x2000)
            val y1 = minOf(camY + 0x260, 0x1600)
            m.w32(0x3eb10, x0 ushr 5); m.w32(0x3eb14, y0 ushr 5)
            if (head != 0) {
                i = head
                while (i != 0) { m.w8(UNITS + i + 0x42, 1); i = m.u32(UNITS + i + U.NEXT) }
                i = head
                while (i != 0) {
                    val next = m.u32(UNITS + i + U.NEXT)
                    val пропустить = (m.u8(UNITS + i + U.FLAGS5B) and 1) != 0 ||
                        (m.u8(UNITS + i + U.TYPE) < 0x1a && m.u8(UNITS + i + U.STATE) == 0x60)
                    if (!пропустить) {
                        val ux = m.u16(UNITS + i + U.X); val uy = m.u16(UNITS + i + U.Y)
                        if (ux in x0 until x1 && uy in y0 until y1) {
                            val cell = ((ux ushr 5) - (x0 ushr 5)) + ((uy ushr 5) - (y0 ushr 5)) * 0x18
                            if (m.u8(UNITS + i + U.TYPE) == 0xb) {          // летающие — в отдельный список
                                val n = m.u32(0x3eb1c)
                                m.w32(0x40da0 + n * 4, i); m.w32(0x3eb1c, n + 1)
                            } else if (m.u32(0x3eb20 + cell * 4) == 0) m.w32(0x3eb20 + cell * 4, i)
                            else if (m.u32(0x3f3c0 + cell * 4) == 0) m.w32(0x3f3c0 + cell * 4, i)
                            else m.w32(0x3fc60 + cell * 4, i)
                        }
                    }
                    i = next
                }
            }
            // крупные объекты рельефа (деревья, скалы) — из старших битов сетки тайлов
            run {
                val dx0 = x0 ushr 4; val dx1 = x1 ushr 4
                var rowOff = (y0 ushr 5) shl 9
                val rowEnd = (y1 ushr 5) shl 9
                var ebp = 0
                while (rowOff < rowEnd) {
                    var eax = 0; var d = dx0
                    while (d < dx1) {
                        val v = m.u16(BG + d + rowOff)
                        if ((v and 0xf800) != 0) m.w32(0x40500 + ebp + eax, v ushr 11)
                        d += 2; eax += 4
                    }
                    rowOff += 0x200; ebp += 0x60
                }
            }
            var ebx = 0
            for (row in 0 until 0x17) {
                var esi = 0x5c
                while (esi >= 0) {
                    val ov = m.u32(0x40500 + esi + ebx)
                    if (ov != 0) {
                        val x = (((esi ushr 2) + m.u32(0x3eb10)) shl 5) - camX
                        val y = ((row + m.u32(0x3eb14)) shl 5) - camY
                        call(e, 0x2c1df, Regs(eax = ov + 0xaf7, edx = x, ebx = y))
                    }
                    val u1 = m.u32(0x3eb20 + esi + ebx)
                    if (u1 != 0) {
                        call(e, unitDraw(m.u8(UNITS + u1 + U.TYPE)), Regs(esi = u1))
                        val u2 = m.u32(0x3f3c0 + esi + ebx)
                        if (u2 != 0) {
                            call(e, unitDraw(m.u8(UNITS + u2 + U.TYPE)), Regs(esi = u2))
                            val u3 = m.u32(0x3fc60 + esi + ebx)
                            if (u3 != 0) call(e, unitDraw(m.u8(UNITS + u3 + U.TYPE)), Regs(esi = u3))
                        }
                    }
                    esi -= 4
                }
                ebx += 0x60
            }
            val nf = m.u32(0x3eb1c)
            if (nf != 0) {
                for (k in 0 until nf) {                              // тень летающего на земле
                    val u = m.u32(0x40da0 + k * 4)
                    call(e, 0x2c1df, Regs(eax = 0xadf, edx = m.u16(UNITS + u + U.X) - camX, ebx = m.u16(UNITS + u + U.Y) - camY))
                }
                for (k in 0 until nf) {
                    call(e, 0x2540a, Regs(esi = m.u32(0x40da0 + k * 4)))
                    m.w32(0x3eb1c, m.u32(0x3eb1c) - 1)
                }
            }
            Regs()
        }
    }

    /** Кадр сцены без интерфейса: земля, предметы, юниты, туман. */
    fun draw(eng: Engine) {
        call(eng, 0x242d4)
        call(eng, 0x26498)
        call(eng, 0x24d70)
        call(eng, 0x2438e)
    }
}
