package jw

/**
 * Архивы игры и распаковщик LZSS — порт reimpl/js/archive.js (он, в свою очередь, порт
 * tools/trc.py и tools/lzss.py). Три формата в одних и тех же контейнерах:
 *   TRC — именованные записи (карты, тайлсеты, тексты), могут быть сжаты LZSS;
 *   TRS — спрайты: у каждой записи ширина, высота и четыре точки привязки;
 *   TRW — звук: длина, число каналов, частота, бит на отсчёт.
 */
object Lzss {
    fun unpack(src: ByteArray, outLen: Int): ByteArray {
        val ring = ByteArray(4096 + 64)
        var rpos = 0
        val out = ByteArray(outLen)
        var n = 0
        var bp = 0
        val nb = src.size * 8

        fun bits(k: Int): Int {
            var v = 0
            for (j in 0 until k) {
                if (bp >= nb) return -1                       // конец потока: оригинал просто обрывается
                v = (v shl 1) or ((src[bp shr 3].toInt() shr (7 - (bp and 7))) and 1)
                bp++
            }
            return v
        }

        fun put(b: Byte) { ring[rpos] = b; rpos = if (rpos + 1 > 0xfff) 0 else rpos + 1 }

        while (n < outLen) {
            val flag = bits(1)
            if (flag < 0) break
            if (flag == 0) {
                val b = bits(8); if (b < 0) break
                out[n++] = b.toByte(); put(b.toByte())
            } else {
                val ln = bits(5); val pos = bits(12)
                if (ln < 0 || pos < 0) break
                val tmp = ByteArray(ln)
                var take = 0
                for (j in 0 until ln) {
                    val b = ring[pos + j]
                    out[n++] = b
                    ring[4096 + j] = b
                    tmp[take++] = b
                    if (n >= outLen) break
                }
                if (ln < 0x1f) for (j in 0 until take) put(tmp[j])
            }
        }
        return out
    }
}

class Entry(
    @JvmField val name: String = "",
    @JvmField val off: Int = 0,
    @JvmField val size: Int = 0,
    @JvmField val stored: Int = 0,
    @JvmField val packed: Int = 0,
    @JvmField val w: Int = 0, @JvmField val h: Int = 0,
    @JvmField val hx: IntArray = IntArray(0),
    @JvmField val channels: Int = 0, @JvmField val rate: Int = 0, @JvmField val bits: Int = 0,
)

class Archive(@JvmField val b: ByteArray) {
    @JvmField val magic: String = String(charArrayOf(b[0].toInt().toChar(), b[1].toInt().toChar(), b[2].toInt().toChar()))
    @JvmField val n: Int
    @JvmField val base: Int
    @JvmField val entries: List<Entry>

    private fun u16(a: Int) = (b[a].toInt() and 0xff) or ((b[a + 1].toInt() and 0xff) shl 8)
    private fun i16(a: Int) = u16(a).toShort().toInt()
    private fun u32(a: Int) = (b[a].toInt() and 0xff) or ((b[a + 1].toInt() and 0xff) shl 8) or
            ((b[a + 2].toInt() and 0xff) shl 16) or ((b[a + 3].toInt() and 0xff) shl 24)

    init {
        n = u32(8)
        base = u32(12)
        val list = ArrayList<Entry>(n)
        for (i in 0 until n) {
            when (magic) {
                "TRC" -> {
                    val o = 0x20 + i * 32
                    val sb = StringBuilder()
                    var k = 0
                    while (k < 12 && b[o + k].toInt() != 0) { sb.append((b[o + k].toInt() and 0xff).toChar()); k++ }
                    list.add(Entry(name = sb.toString(), off = u32(o + 12), size = u32(o + 16),
                        stored = u32(o + 20), packed = b[o + 26].toInt() and 0xff))
                }
                "TRW" -> {
                    val o = 0x20 + i * 16
                    list.add(Entry(off = u32(o), size = u32(o + 4), stored = u32(o + 4),
                        channels = u16(o + 8), rate = u16(o + 10), bits = u16(o + 12)))
                }
                else -> {                                     // TRS: спрайты
                    val o = 0x20 + i * 16
                    val next = if (i + 1 < n) u32(o + 16) else b.size - base
                    list.add(Entry(off = u32(o), w = u16(o + 4), h = u16(o + 6),
                        hx = intArrayOf(i16(o + 8), i16(o + 10), i16(o + 12), i16(o + 14)),
                        stored = next - u32(o)))
                }
            }
        }
        entries = list
    }

    fun raw(i: Int): ByteArray {
        val e = entries[i]
        return b.copyOfRange(base + e.off, base + e.off + e.stored)
    }

    fun data(i: Int): ByteArray {
        val e = entries[i]
        if (e.packed == 1) return Lzss.unpack(raw(i), e.size)
        val len = if (e.size != 0) e.size else e.stored
        val r = raw(i)
        return if (len >= r.size) r else r.copyOfRange(0, len)
    }

    fun find(name: String): Int = entries.indexOfFirst { it.name == name }
}
