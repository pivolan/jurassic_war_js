package jw

import java.io.File
import java.util.zip.InflaterInputStream
import kotlin.test.Test

/**
 * Сверка сцены с кадром из эмулятора оригинала: тот же снимок состояния, тот же кадр.
 * Сравнивается область карты — панель, мини-карта и строка «Foods=» рисуются другими функциями,
 * которые ещё не портированы.
 */
class SceneTest {
    @Test
    fun `сцена совпадает с эталонным кадром`() {
        val trace = File("../../reimpl/traces/render_m0_t0")
        val sim = File("../../reimpl/traces/m0_t0")
        if (!trace.isDirectory) return
        val snap = InflaterInputStream(File(sim, "snap0.bin.z").readBytes().inputStream()).readBytes()
        val ref = InflaterInputStream(File(trace, "frame_0000.bin.z").readBytes().inputStream()).readBytes()

        val m = Mem.ofSize(); m.set(0x30000, snap)
        val eng = Engine(m)
        eng.files = listOf("_PWAR01.TRC", "_PWAR04.TRS", "_PWAR05.TRS", "_PWAR08.TRC", "_PWAR09.TRC")
            .associateWith { File("../../PWAR", it).readBytes() }
        Jw.registerAll()
        Sprites.fixSlotPointers(m)
        Scene.draw(eng)

        val vw = m.u32(Render.VW)
        // Курсор мыши в кадр эталона попал, а рисует его другая функция (0x299b4, композит
        // курсора поверх сцены) — её порт впереди. Область курсора из сверки исключаем: ровно так
        // же поступает проверка JS-порта.
        val курсор = intArrayOf(80, 240, 97, 263)
        var плохих = 0; var всего = 0
        val карта = HashMap<Int, Int>()      // строка -> сколько расхождений, чтобы понять, где именно
        for (y in 0 until 480) {
            val row = Render.FB + m.u32(Render.ROWS + y * 4)
            for (x in 0 until vw) {
                if (x >= курсор[0] && x < курсор[2] && y >= курсор[1] && y < курсор[3]) continue
                всего++
                val наш = m.b[row + x].toInt() and 0xff
                val эталон = ref[y * 640 + x].toInt() and 0xff
                if (наш != эталон) { плохих++; карта[y / 40] = (карта[y / 40] ?: 0) + 1 }
            }
        }
        println("область карты ${vw}x480: расхождений $плохих из $всего (${"%.2f".format(плохих * 100.0 / всего)}%)")
        println("по полосам сверху вниз: " + (0..11).joinToString(" ") { (карта[it] ?: 0).toString() })
        kotlin.test.assertEquals(0, плохих, "сцена должна совпадать с оригиналом попиксельно")
    }
}
