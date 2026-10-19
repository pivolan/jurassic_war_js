package jw

/**
 * Память игры — тот же приём, что в JS-порте: один массив байт, адреса как в оригинале
 * (сегмент данных 0x30000..0x6483c0, база образа 0x10000). Ничего «объектного»: движок
 * читает и пишет по адресам, поэтому состояние целиком копируется одним memcpy, а
 * сохранение/реплей — это просто кусок массива.
 *
 * Про знаковость: u32 отдаёт Int с тем же набором битов, что в оригинале. Все настоящие
 * значения (адреса, счётчики, координаты) меньше 2^31, поэтому сравнения работают как надо;
 * там, где нужен честный беззнаковый порядок, есть u32u().
 */
class Mem(val b: ByteArray) {
    companion object {
        const val SIZE = 0x6483c0
        fun ofSize() = Mem(ByteArray(SIZE))
    }

    fun u8(a: Int): Int = b[a].toInt() and 0xff
    fun i8(a: Int): Int = b[a].toInt()
    fun u16(a: Int): Int = (b[a].toInt() and 0xff) or ((b[a + 1].toInt() and 0xff) shl 8)
    fun i16(a: Int): Int = u16(a).toShort().toInt()
    fun u32(a: Int): Int = (b[a].toInt() and 0xff) or ((b[a + 1].toInt() and 0xff) shl 8) or
            ((b[a + 2].toInt() and 0xff) shl 16) or ((b[a + 3].toInt() and 0xff) shl 24)
    fun u32u(a: Int): Long = u32(a).toLong() and 0xffffffffL
    fun i32(a: Int): Int = u32(a)

    fun w8(a: Int, v: Int) { b[a] = v.toByte() }
    fun w16(a: Int, v: Int) { b[a] = v.toByte(); b[a + 1] = (v ushr 8).toByte() }
    fun w32(a: Int, v: Int) {
        b[a] = v.toByte(); b[a + 1] = (v ushr 8).toByte()
        b[a + 2] = (v ushr 16).toByte(); b[a + 3] = (v ushr 24).toByte()
    }

    fun set(dst: Int, src: ByteArray, from: Int = 0, len: Int = src.size - from) =
        System.arraycopy(src, from, b, dst, len)

    fun copyOf(from: Int, to: Int): ByteArray = b.copyOfRange(from, to)
}

/** Глобалы движка (адреса оригинала). */
object G {
    const val unitHead = 0x31b6c; const val mapW = 0x31af8; const val mapH = 0x31afc
    const val step = 0x31ab4; const val stepLow = 0x31b66; const val ticks = 0x31ab0
    const val timer = 0x46c; const val lastTimer = 0x36d80; const val countdown = 0x3033c
    const val speed = 0x30098; const val norender = 0x30346
    const val food = 0x31c28; const val endcode = 0x30349; const val gameover = 0x303b0
    const val rngState = 0x31b5c; const val rngRange = 0x31b58; const val rngCount = 0x393a0
    const val rngN = 0x393a8; const val rngTab = 0x393ac
    const val difficulty = 0x31aba; const val mission = 0x31abb
    const val humanOwner = 0x31b64; const val netflag = 0x333c0
}

const val UNITS = 0xe4400
const val UNIT_SZ = 96
const val NUNITS = 600
const val BI = 0x10ce74
const val MO = 0x117e74
const val BG = 0xf6e74
const val ITEMS = 0xf4f34
const val PROJ = 0xf2504

/** Поля записи юнита (смещения от UNITS + индекс). */
object U {
    const val TYPE = 0x04; const val SLOT = 0x05; const val OWNER = 0x06; const val F07 = 0x07
    const val F08 = 0x08; const val F09 = 0x09; const val F0A = 0x0a; const val STAT0B = 0x0b
    const val HPMAX = 0x0c; const val MAG = 0x0d; const val HP = 0x0e; const val ATK = 0x0f
    const val DEF = 0x10; const val MANA = 0x11; const val SPD = 0x12; const val FOOD = 0x13
    const val WEAPON = 0x15; const val SHIELD = 0x16; const val SKILLS = 0x17; const val INV = 0x1b
    const val XP = 0x27; const val STATE = 0x2b; const val ATKCTR = 0x2c; const val SPR = 0x2d
    const val X = 0x2f; const val Y = 0x31; const val TARGET = 0x33; const val DSTX = 0x37
    const val DSTY = 0x39; const val DIR = 0x3d; const val FX43 = 0x43; const val ORDER = 0x46
    const val ANIM = 0x4f; const val FLAGS50 = 0x50; const val FLAGS5B = 0x5b
    const val PREV = 0x5c; const val NEXT = 0x60
}
