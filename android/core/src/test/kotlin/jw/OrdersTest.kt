package jw

import java.io.File
import java.util.zip.InflaterInputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Управление: выделение и приказы проходят тем же путём, что мышь в оригинале, —
 * «ожидающий приказ» → 0x1419e → очередь 0x14895 → +0x46 у юнита → состояние.
 */
class OrdersTest {
    private fun запустить(): Pair<Engine, Mem> {
        val boot = InflaterInputStream(File("../../reimpl/data/boot_snap.bin.z").readBytes().inputStream()).readBytes()
        val m = Mem.ofSize(); m.set(0x30000, boot); m.w32(0x46c, 110)
        val files = listOf("_PWAR01.TRC", "_PWAR05.TRS", "_PWAR08.TRC", "_PWAR09.TRC")
            .associateWith { File("../../PWAR", it).readBytes() }
        Jw.registerAll(); Sprites.fixSlotPointers(m)
        val eng = Loader.loadMission(m, files, 0, 0, 1)
        return eng to m
    }
    private fun мои(m: Mem): List<Int> {
        val out = ArrayList<Int>(); var i = m.u32(G.unitHead)
        while (i != 0) {
            if (m.u8(UNITS + i + U.OWNER) == m.u8(G.humanOwner) && m.u8(UNITS + i + U.TYPE) < 0xe) out.add(i)
            i = m.u32(UNITS + i + U.NEXT)
        }
        return out
    }

    @Test
    fun `тап по своему выделяет только его, тап по земле уводит отряд`() {
        val (eng, m) = запустить()
        val отряд = мои(m).take(3)
        assertTrue(отряд.size >= 2, "в первой миссии должно быть несколько бойцов")
        for (i in отряд) m.w8(UNITS + i + U.F07, m.u8(UNITS + i + U.F07) or 0x80)
        m.w32(Ui.SEL, отряд[0])
        assertEquals(отряд.size, Ui.selectedCount(m), "рамкой выделили троих")

        // тап по второму бойцу — выделен ровно он
        val b1 = UNITS + отряд[1]
        Ui.tap(eng, m.u16(b1 + U.X) + 8, m.u16(b1 + U.Y) + 8)
        assertEquals(1, Ui.selectedCount(m), "после тапа по бойцу выделен только он")
        assertEquals(отряд[1], m.u32(Ui.SEL), "и он же вожак")

        // выделяем всех рамкой и отправляем в точку в шести клетках правее
        val x0 = m.u16(UNITS + отряд[0] + U.X); val y0 = m.u16(UNITS + отряд[0] + U.Y)
        Ui.boxSelect(eng, x0 - 96, y0 - 96, x0 + 96, y0 + 96)
        val выделено = Ui.selectedCount(m)
        assertTrue(выделено >= 2, "рамка должна взять несколько бойцов, взяла $выделено")
        val цельX = x0 + 6 * 32
        Ui.tap(eng, цельX, y0)
        eng.todo.clear()
        repeat(3) { eng.timer = eng.timer + 1; eng.tick() }
        val приказ = m.u8(UNITS + отряд[0] + U.ORDER)
        val сост = m.u8(UNITS + отряд[0] + U.STATE)
        assertTrue(приказ == 0x0f || сост < 0x10, "приказ дошёл до юнита: приказ=0x%x состояние=0x%x".format(приказ, сост))

        val былX = m.u16(UNITS + отряд[0] + U.X)
        repeat(200) { eng.timer = eng.timer + 1; eng.tick() }
        val сталX = m.u16(UNITS + отряд[0] + U.X)
        println("вожак шёл с $былX на $сталX (цель $цельX), выделено было $выделено")
        println("не портировано за прогон: " + eng.todo.sorted().joinToString(" "))
        assertTrue(сталX > былX, "по приказу отряд пошёл вправо")
    }

    @Test
    fun `тап по чужому юниту отдаёт приказ атаки`() {
        val (eng, m) = запустить()
        val свой = мои(m).first()
        m.w8(UNITS + свой + U.F07, m.u8(UNITS + свой + U.F07) or 0x80)
        m.w32(Ui.SEL, свой)
        var чужой = 0
        var i = m.u32(G.unitHead)
        while (i != 0) {
            if (m.u8(UNITS + i + U.OWNER) != m.u8(G.humanOwner) && m.u8(UNITS + i + U.TYPE) < 0x1a &&
                m.u8(UNITS + i + U.STATE) != 0x60) { чужой = i; break }
            i = m.u32(UNITS + i + U.NEXT)
        }
        assertTrue(чужой != 0, "на карте есть звери и чужие юниты")
        val b = UNITS + чужой
        // Клик работает только по разведанной клетке (0x130c6 проверяет бит 0 в BI) — как в
        // оригинале: в тумане цель не выбрать. Открываем клетку, как это делает разведка.
        val клетка = ((m.u16(b + U.X) ushr 5) and 0xff) + (((m.u16(b + U.Y) ushr 5) and 0xff) shl 8)
        m.w8(BI + клетка, m.u8(BI + клетка) or 1)
        val что = Ui.tap(eng, m.u16(b + U.X) + 8, m.u16(b + U.Y) + 8)
        assertEquals("в атаку", что)
        eng.todo.clear()
        repeat(3) { eng.timer = eng.timer + 1; eng.tick() }
        val цель = m.u32(UNITS + свой + U.TARGET)
        val сост = m.u8(UNITS + свой + U.STATE)
        println("после приказа: состояние 0x%x, цель %d (ждали %d)".format(сост, цель, чужой))
        assertTrue(цель == чужой || (сост and 0xf0) == 0x10, "боец взял цель")
    }
}
