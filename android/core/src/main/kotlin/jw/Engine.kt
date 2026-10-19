package jw

/**
 * Ядро симуляции — построчный порт pwar.exe, следом за JS-версией (reimpl/js/engine.js).
 * Шаг целиком целочисленный, никакой плавающей арифметики: от этого зависит и совпадение
 * с оригиналом, и воспроизводимость реплеев.
 */
class Engine(@JvmField val m: Mem) {
    @JvmField var files: Map<String, ByteArray> = emptyMap()
    @JvmField var vram: ByteArray? = null
    @JvmField val todo = LinkedHashSet<String>()

    var timer: Int
        get() = m.u32(G.timer)
        set(v) = m.w32(G.timer, v)

    // ---- ГСЧ: FUN_00020469 (основной) и FUN_000204a6 (с таймером BIOS, см. Loader)
    fun randRaw(): Int {                                  // 0x20469
        val range = m.u32(G.rngRange)
        if (range == 0) return 0
        val eax = (m.u32u(G.rngState) + m.u32u(G.step)) and 0xffffffffL
        val r = range.toLong() and 0xffffffffL
        val q = (eax / r).toInt()
        val rem = (eax % r).toInt()
        m.w32(G.rngState, m.u32(G.rngState) + q)
        m.w32(G.rngState, m.u32(G.rngState) xor m.u32(G.rngTab + (q ushr 28)))
        m.w32(G.rngCount, m.u32(G.rngCount) + 1)
        return rem
    }

    // ---- шаг симуляции: FUN_00017e1c (только логика, без отрисовки)
    fun tick() {
        if (m.u32(G.lastTimer) == timer) return
        m.w32(G.ticks, m.u32(G.ticks) + 1)
        m.w32(G.lastTimer, timer)
        val cd = (m.u16(G.countdown) - 1) and 0xffff
        m.w16(G.countdown, cd)
        if (cd != 0) return
        m.w16(G.countdown, m.u16(G.speed))
        m.w32(G.step, m.u32(G.step) + 1)
        m.w16(G.stepLow, (m.u16(G.stepLow) + 1) and 0xf)
        phase(0x13f4c)                                     // очередь приказов
        sumStats()                                         // 0x15f86
        unitLoop()
        phase(0x200fe); phase(0x1ab4c); phase(0x1c340); phase(0x15634)
    }

    fun unitLoop() {
        var i = m.u32(G.unitHead)
        while (i != 0) {
            if ((m.u8(UNITS + i + U.FLAGS5B) and 1) == 0) {
                val f43 = m.u8(UNITS + i + U.FX43)
                if (f43 == 0) { val nx = m.u32(UNITS + i + U.NEXT); dispatch(i); i = nx; continue }
                if ((f43 and 3) != 0) m.w8(UNITS + i + U.FX43, f43 - 1)
                if ((m.u8(UNITS + i + U.FX43) and 0xfc) == 0) { val nx = m.u32(UNITS + i + U.NEXT); dispatch(i); i = nx; continue }
                if ((m.u32(G.step) and 3) == 0) m.w8(UNITS + i + U.FX43, m.u8(UNITS + i + U.FX43) - 4)
                if (m.u8(UNITS + i + U.STATE) == 0x6f) {
                    m.w8(UNITS + i + U.FX43, 0); val nx = m.u32(UNITS + i + U.NEXT); dispatch(i); i = nx; continue
                }
                i = m.u32(UNITS + i + U.NEXT)
            } else {
                val nx = m.u32(UNITS + i + U.NEXT); phase(0x18058, Regs(esi = i)); i = nx
            }
        }
    }

    /** Таблица 0x17fb8: люди 0x18154, звери 0x184c8, растения 0x18568, здания 0x186b3. */
    fun dispatch(i: Int): Regs {
        val t = m.u8(UNITS + i + U.TYPE)
        val h = when {
            t == 0 -> 0x17fb4
            t < 14 -> 0x18154
            t < 24 -> 0x184c8
            t < 26 -> 0x18568
            else -> 0x186b3
        }
        return phase(h, Regs(esi = i))
    }

    fun phase(addr: Int, r: Regs = Regs()): Regs {
        val f = F[addr] ?: run { todo.add("0x${addr.toString(16)}"); return Regs() }
        return f(this, r)
    }

    /** FUN_00015f86: суммы статов по слотам игроков, считается каждый шаг. */
    fun sumStats() {
        val a = intArrayOf(0x32b8c, 0x32b9c, 0x32bac, 0x32b3c, 0x32b4c, 0x32b5c)
        for (base in a) for (s in 0 until 8) m.w16(base + s * 2, 0)
        var i = m.u32(G.unitHead)
        while (i != 0) {
            val next = m.u32(UNITS + i + U.NEXT)
            val f08 = m.u8(UNITS + i + U.F08)
            val slot = m.u8(UNITS + i + U.SLOT)
            val t = m.u8(UNITS + i + U.TYPE)
            if (f08 != 0 && (m.u8(UNITS + i + U.FLAGS5B) and 1) == 0 && slot < 8 && t < 0x1a) {
                val bx = slot * 2
                val grp = if (f08 == 1) 3 else 0
                fun add(addr: Int, v: Int) = m.w16(addr, m.u16(addr) + v)
                add(a[grp] + bx, m.u8(UNITS + i + U.HPMAX)); add(a[grp] + bx, m.u8(UNITS + i + U.MAG))
                add(a[grp + 1] + bx, m.u8(UNITS + i + U.ATK)); add(a[grp + 1] + bx, m.u8(UNITS + i + U.DEF))
                val edi = m.u32(0x30dd8 + bx * 2) + m.u32(0x30dfc + t * 4)
                add(a[grp + 2] + bx, m.u8(edi)); add(a[grp + 2] + bx, m.u8(edi + 2))
                add(a[grp + 2] + bx, m.u8(edi + 4)); add(a[grp + 2] + bx, m.u8(edi + 6))
            }
            i = next
        }
    }
}
