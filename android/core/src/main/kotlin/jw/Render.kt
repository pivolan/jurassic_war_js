package jw

/**
 * Отрисовка сцены — порт reimpl/js/render/scene.js. Пока портирована та часть, что рисует землю:
 * тайлы карты и туман войны поверх них. Юниты, здания, эффекты и панель — следующий шаг.
 *
 * Всё пишется в буфер кадра оригинала (0x1235f4, 640 байт на строку, таблица начал строк 0x122e74)
 * ровно так же, как в DOS-версии: один байт на пиксель, цвет берётся из палитры 0x44980.
 */
object Render {
    const val FB = 0x1235f4
    const val ROWS = 0x122e74
    const val CAMX = 0x31ae8
    const val CAMY = 0x31aec
    const val VW = 0x488c4
    const val VH = 0x488c8
    const val PAL = 0x44980
    private const val TILES = 0x49b2c

    fun register() {
        // 0x242d4: земля. Строка сетки берётся как camY*0x10 + camX>>4 — поэтому камера обязана
        // быть кратна 32, иначе смещение перестаёт быть кратным длине строки и карта уезжает.
        F[0x242d4] = { e, _ ->
            val m = e.m; val b = m.b
            val camX = m.u32(CAMX); val camY = m.u32(CAMY)
            val tw = m.u32(0x31af0); val th = m.u32(0x31af4)
            val fb = m.u32(0x46f00)
            var bgRow = camY * 0x10 + (camX shr 4)
            for (ty in 0 until th) {
                var bg = bgRow
                for (tx in 0 until tw) {
                    val src = TILES + (m.u16(BG + bg) and 0x7ff) * 0x400
                    val dst = fb + m.u32(ROWS + ty * 32 * 4) + tx * 32
                    for (row in 0 until 32)
                        System.arraycopy(b, src + row * 32, b, dst + row * 640, 32)
                    bg += 2
                }
                bgRow += 0x200
            }
            Regs()
        }
        // 0x24446 / 0x2438e: туман. Код клетки складывается из бита «разведано» у неё и четырёх
        // соседей, тайлы 0..14 накладываются поверх земли по ИЛИ — поэтому светлый текст сквозь
        // туман остаётся виден, как в оригинале.
        F[0x2438e] = { e, _ ->
            val m = e.m; val b = m.b
            val camX = m.u32(CAMX); val camY = m.u32(CAMY)
            val tw = m.u32(0x31af0); val th = m.u32(0x31af4)
            val fb = m.u32(0x46f00)
            var esi = (camX ushr 5) + camY * 8
            for (ty in 0 until th) {
                var cell = esi
                for (tx in 0 until tw) {
                    val code = fogCode(m, cell)
                    if (code != 0xf) {
                        val src = TILES + (code shl 10)
                        val dst = fb + m.u32(ROWS + ty * 32 * 4) + tx * 32
                        for (row in 0 until 32) {
                            val d = dst + row * 640; val s = src + row * 32
                            for (k in 0 until 32) b[d + k] = (b[d + k].toInt() or b[s + k].toInt()).toByte()
                        }
                    }
                    cell++
                }
                esi += 0x100
            }
            Regs()
        }
    }

    private fun fogCode(m: Mem, esi: Int): Int {
        val b = m.b
        if ((b[BI + esi].toInt() and 1) != 0) return 0xf
        var v = 0
        if (esi != 0 && (b[BI + esi - 1].toInt() and 1) != 0) v = 8
        if (esi < 0xafff && (b[BI + esi + 1].toInt() and 1) != 0) v += 2
        if (esi >= 0x100 && (b[BI + esi - 0x100].toInt() and 1) != 0) v += 1
        if (esi < 0xaf00 && (b[BI + esi + 0x100].toInt() and 1) != 0) v += 4
        return v
    }

    /** Кадр: земля и туман. */
    fun drawGround(eng: Engine) {
        call(eng, 0x242d4)
        call(eng, 0x2438e)
    }

    /**
     * Буфер кадра (по байту на пиксель) в ARGB. Строки берутся через таблицу 0x122e74 — в
     * оригинале они не идут подряд.
     */
    fun toArgb(m: Mem, out: IntArray, palette: IntArray) {
        for (i in 0 until 256) {
            val o = PAL + i * 3
            palette[i] = (0xff shl 24) or ((m.u8(o) and 0xff) shl 16) or ((m.u8(o + 1) and 0xff) shl 8) or (m.u8(o + 2) and 0xff)
        }
        var p = 0
        for (y in 0 until 480) {
            val row = FB + m.u32(ROWS + y * 4)
            for (x in 0 until 640) out[p++] = palette[m.b[row + x].toInt() and 0xff]
        }
    }

    /** Сдвиг камеры целыми клетками: движок сам ходит по 32 px, и меньше ему нельзя. */
    fun scroll(m: Mem, dx: Int, dy: Int) {
        val maxX = maxOf(0, (m.u32(0x31af8) shl 5) - m.u32(VW))
        val maxY = maxOf(0, (m.u32(0x31afc) shl 5) - m.u32(VH))
        m.w32(CAMX, (m.u32(CAMX) + dx).coerceIn(0, maxX) and 31.inv())
        m.w32(CAMY, (m.u32(CAMY) + dy).coerceIn(0, maxY) and 31.inv())
    }
}
