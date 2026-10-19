package jw

import java.io.File
import java.util.zip.InflaterInputStream
import kotlin.test.Test
import kotlin.test.assertTrue

/** Партия действительно идёт: за сотню шагов юниты меняют координаты, и ничего не падает. */
class TickTest {
    @Test
    fun `за тысячу шагов мир оживает`() {
        val boot = InflaterInputStream(File("../../reimpl/data/boot_snap.bin.z").readBytes().inputStream()).readBytes()
        val m = Mem.ofSize(); m.set(0x30000, boot); m.w32(0x46c, 110)
        val files = listOf("_PWAR01.TRC", "_PWAR05.TRS", "_PWAR08.TRC", "_PWAR09.TRC")
            .associateWith { File("../../PWAR", it).readBytes() }
        Jw.registerAll()
        Sprites.fixSlotPointers(m)
        val eng = Loader.loadMission(m, files, 1, 5, 1)

        fun снимок(): Map<Int, Pair<Int, Int>> {
            val out = HashMap<Int, Pair<Int, Int>>()
            var i = m.u32(G.unitHead)
            while (i != 0) { out[i] = m.u16(UNITS + i + U.X) to m.u16(UNITS + i + U.Y); i = m.u32(UNITS + i + U.NEXT) }
            return out
        }
        val было = снимок()
        eng.todo.clear()
        repeat(1000) { eng.timer = eng.timer + 1; eng.tick() }
        val стало = снимок()
        val сдвинулись = стало.count { (i, p) -> было[i] != null && было[i] != p }
        val состояния = HashMap<Int, Int>()
        var i2 = m.u32(G.unitHead)
        while (i2 != 0) { val st = m.u8(UNITS + i2 + U.STATE); состояния[st] = (состояния[st] ?: 0) + 1; i2 = m.u32(UNITS + i2 + U.NEXT) }
        println("шаг движка: ${m.u32(G.step)}, тик: ${eng.timer}")
        println("состояния: " + состояния.entries.sortedBy { it.key }.joinToString(" ") { "0x%02x:%d".format(it.key, it.value) })
        println("FLAGS50 у зверей: " + run {
            val v = ArrayList<Int>(); var k = m.u32(G.unitHead)
            while (k != 0) { if (m.u8(UNITS + k + U.TYPE) in 14..23) v.add(m.u8(UNITS + k + U.FLAGS50)); k = m.u32(UNITS + k + U.NEXT) }
            v.take(12).joinToString(",") })
        val трупов = состояния.filterKeys { it == 0x60 || it == 0x6f }.values.sum()
        val ранены = run { var n = 0; var k = m.u32(G.unitHead)
            while (k != 0) { if (m.u8(UNITS + k + U.HP) < m.u8(UNITS + k + U.HPMAX)) n++; k = m.u32(UNITS + k + U.NEXT) }; n }
        println("шагов 1000, юнитов ${стало.size}, сдвинулись $сдвинулись, ранены $ранены, трупов $трупов")
        println("не портировано за прогон: " + eng.todo.sorted().joinToString(" "))
        assertTrue(сдвинулись > 0, "хоть кто-то должен был пойти")
    }
}
