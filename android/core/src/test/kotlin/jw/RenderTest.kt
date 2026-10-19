package jw

import java.io.File
import java.util.zip.InflaterInputStream
import kotlin.test.Test
import kotlin.test.assertTrue

/** Тот же путь, что проходит приложение на телефоне: снимок, архивы, миссия, земля, туман, ARGB. */
class RenderTest {
    @Test
    fun `земля и туман рисуются в кадр`() {
        val pwar = File("../../PWAR")
        val boot = InflaterInputStream(File("../../reimpl/data/boot_snap.bin.z").readBytes().inputStream()).readBytes()
        val m = Mem.ofSize(); m.set(0x30000, boot); m.w32(0x46c, 110)
        val files = listOf("_PWAR01.TRC", "_PWAR05.TRS", "_PWAR08.TRC", "_PWAR09.TRC").associateWith { File(pwar, it).readBytes() }
        Jw.registerAll()
        val eng = Loader.loadMission(m, files, 1, 5, 1)

        // камера на первого своего юнита, как в приложении
        val мой = m.u8(0x31b64)
        var i = m.u32(G.unitHead)
        while (i != 0) {
            if (m.u8(UNITS + i + U.OWNER) == мой && (m.u8(UNITS + i + U.FLAGS5B) and 1) == 0) {
                Render.scroll(m, m.u16(UNITS + i + U.X) - m.u32(Render.VW) / 2, m.u16(UNITS + i + U.Y) - 240); break
            }
            i = m.u32(UNITS + i + U.NEXT)
        }
        Render.drawGround(eng)
        val px = IntArray(640 * 480); val pal = IntArray(256)
        Render.toArgb(m, px, pal)

        val цветов = px.toSortedSet().size
        val ярких = px.count { (it shr 16 and 0xff) + (it shr 8 and 0xff) + (it and 0xff) > 60 }
        println("кадр: ${цветов} разных цветов, ярких пикселей $ярких из ${px.size}, камера " +
                "${m.u32(Render.CAMX)},${m.u32(Render.CAMY)} (кратна 32: ${m.u32(Render.CAMX) % 32 == 0})")
        assertTrue(цветов > 40, "картинка должна быть разноцветной, а не заливкой: цветов $цветов")
        assertTrue(ярких > 20000, "видимая часть карты должна быть освещена, ярких $ярких")
        assertTrue(m.u32(Render.CAMX) % 32 == 0 && m.u32(Render.CAMY) % 32 == 0, "камера кратна 32")
    }
}
