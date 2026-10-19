package jw

/**
 * Спрайты — порт reimpl/js/render/sprites.js. Слоты лежат таблицей по 16 байт
 * (указатель на пиксели, ширина, высота и четыре точки привязки), сами пиксели — в куче
 * до 0x5177f0. Загружаются они ровно так же, как в оригинале: запись архива копируется
 * в кучу, слот получает её размеры.
 */
object Sprites {
    const val SLOTS = 0x16e5f4
    const val NSLOTS = 0x48870
    const val HEAP = 0x48874
    const val HEAP_END = 0x5177f0

    private val кэш = HashMap<String, Archive>()

    /**
     * Указатели слотов в снимке эталона сдвинуты на +0x100000 — их надо поправить ОДИН раз.
     * Повторный вызов вычтет ещё раз и порвёт спрайты.
     */
    fun fixSlotPointers(m: Mem) {
        val n = m.u32(NSLOTS)
        var s = 0
        while (s < n && s < 0xb6e) {
            val p = m.u32(SLOTS + s * 16)
            if (p >= 0x110000 && p < 0x7483c0) m.w32(SLOTS + s * 16, p - 0x100000)
            s++
        }
    }

    /** Архив может быть не загружен (например, headless-прогон без спрайтов) — тогда null. */
    fun архив(eng: Engine, файл: String): Archive? {
        val данные = eng.files[файл] ?: return null
        return кэш.getOrPut(файл) { Archive(данные) }
    }

    /** 0x2bcc0: запись архива → новый слот. */
    fun loadEntry(eng: Engine, файл: String, индекс: Int): Int {
        val m = eng.m
        val arc = архив(eng, файл) ?: return -1
        val e = arc.entries[индекс]
        val slot = m.u32(NSLOTS)
        if (slot >= 0xb6e) return -1
        m.w32(NSLOTS, slot + 1)
        val size = e.w * e.h
        val ptr = m.u32(HEAP)
        if (ptr + size > HEAP_END) return -1
        m.w32(HEAP, ptr + size)
        val o = SLOTS + slot * 16
        m.w32(o, ptr); m.w16(o + 4, e.w); m.w16(o + 6, e.h)
        for (k in 0 until 4) m.w16(o + 8 + k * 2, e.hx[k] and 0xffff)
        val сырой = arc.raw(индекс)
        m.set(ptr, сырой, 0, minOf(size, сырой.size))
        return slot
    }

    fun register() {
        // 0x2bbbd: освободить слоты начиная с eax
        F[0x2bbbd] = { e, r ->
            val m = e.m; val n = r.eax
            when {
                m.u32(NSLOTS) == n -> Regs(cf = false)
                m.u32(NSLOTS) < n -> Regs(cf = true)
                else -> {
                    m.w32(NSLOTS, n)
                    val p = m.u32(SLOTS + n * 16)
                    if (m.u32(HEAP) >= p) m.w32(HEAP, p)
                    Regs(cf = false)
                }
            }
        }
        // 0x10b29: спрайты выбранного племени — 19 записей пака 05 со слота 0xb17
        F[0x10b29] = { e, r ->
            val m = e.m; val племя = r.eax and 0xff
            if (m.u8(0x33838) == племя) Regs(cf = false)
            else {
                m.w8(0x33838, племя)
                if (call(e, 0x2bbbd, Regs(eax = 0xb17)).cf) Regs(cf = true)
                else {
                    var плохо = false
                    for (k in 0 until 0x13) if (loadEntry(e, "_PWAR05.TRS", племя * 0x13 + k) < 0) { плохо = true; break }
                    Regs(cf = плохо)
                }
            }
        }
    }
}
