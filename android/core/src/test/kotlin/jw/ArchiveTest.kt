package jw

import java.io.File
import java.util.zip.InflaterInputStream
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Сверка с JS-портом: те же архивы, те же записи — должны получиться те же байты.
 * Эталонные хеши сняты запуском reimpl/js/archive.js в Node, поэтому тест ловит расхождение
 * распаковщика LZSS и разбора заголовков, не требуя ни устройства, ни эмулятора.
 */
class ArchiveTest {
    private val pwar = File("../../PWAR")
    private val data = File("../../reimpl/data")

    private fun fnv(b: ByteArray): String {
        var h = -0x7ee3623b                                   // 0x811c9dc5
        for (x in b) { h = h xor (x.toInt() and 0xff); h *= 0x01000193 }
        return java.lang.Integer.toHexString(h)
    }

    @Test
    fun `секции карты распаковываются как в JS-порте`() {
        val a = Archive(File(pwar, "_PWAR08.TRC").readBytes())
        assertEquals(864, a.n, "число записей в паке 08")
        assertEquals(33376, a.base, "смещение данных")

        val idx = 1 * 8 + 5                                   // миссия 2, племя Koomba
        val эталон = listOf(
            30 to "9bd2b65b", 7072 to "4ee9253a", 57600 to "ec248c2a", 8000 to "2d074bc0",
            10800 to "a213e107", 45056 to "e515ca7a", 160 to "2187e45", 90112 to "6bf3993a",
            45056 to "41305dc5",
        )
        for (k in 0 until 9) {
            val d = a.data(idx * 9 + k)
            val (len, hash) = эталон[k]
            assertEquals(len, d.size, "длина секции $k")
            assertEquals(hash, fnv(d), "содержимое секции $k")
        }
    }

    @Test
    fun `снимок движка читается целиком`() {
        val gz = File(data, "boot_snap.bin.z").readBytes()
        val out = InflaterInputStream(gz.inputStream()).readBytes()
        assertEquals(6390720, out.size)
        assertEquals("a9f6fcf8", fnv(out))
    }

    @Test
    fun `память отдаёт те же числа, что JS`() {
        val m = Mem.ofSize()
        m.w32(0x31ab4, -0x21524111)                           // 0xdeadbeef
        assertEquals(0xef, m.u8(0x31ab4))
        assertEquals(0xbeef, m.u16(0x31ab4))
        assertEquals(0xdeadbeefL, m.u32u(0x31ab4))
        m.w16(0x100, 0x1ff01)                                 // лишние биты должны отсекаться
        assertEquals(0xff01, m.u16(0x100))
        assertEquals(-255, m.i16(0x100))
    }
}
