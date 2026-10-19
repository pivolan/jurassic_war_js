package jw

import java.io.File
import java.util.zip.InflaterInputStream
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Главная сверка порта: загрузить миссию и получить ровно то же состояние, что даёт JS-порт
 * (а он, в свою очередь, сверен с эмулятором оригинала). Хеши сняты запуском js/loader.js в Node
 * на том же снимке движка и тех же архивах.
 *
 * Области хеширования те же, что у реплеев (js/ui/replay.js): только состояние симуляции —
 * записи юнитов без байта выделения, предметы, сетки BI и MO, и небольшой набор глобалов.
 * Интерфейс, камера и второй ГСЧ в сверку не идут: они зависят от того, куда смотрел игрок.
 */
class LoaderTest {
    private val pwar = File("../../PWAR")
    private val data = File("../../reimpl/data")

    private fun fnv(mix: ((Int) -> Unit) -> Unit): String {
        var h = -0x7ee3623b
        mix { v -> h = h xor (v and 0xff); h *= 0x01000193 }
        return Integer.toHexString(h)
    }

    private fun boot(): Mem {
        val gz = File(data, "boot_snap.bin.z").readBytes()
        val snap = InflaterInputStream(gz.inputStream()).readBytes()
        val m = Mem.ofSize()
        m.set(0x30000, snap)
        m.w32(0x46c, 110)                       // таймер BIOS: в порту он стартует с фиксированного числа
        return m
    }

    private fun files(vararg names: String): Map<String, ByteArray> =
        names.associateWith { File(pwar, it).readBytes() }

    @Test
    fun `состояние после загрузки миссии совпадает с JS-портом`() {
        val m = boot()
        Jw.registerAll()
        val eng = Loader.loadMission(m, files("_PWAR01.TRC", "_PWAR05.TRS", "_PWAR08.TRC", "_PWAR09.TRC"), 1, 5, 1)

        val units = fnv { mix ->
            var i = 0xe4400
            while (i < 0xf2500) { for (k in 0 until 96) if (k != 7) mix(m.u8(i + k)); i += 96 }
        }
        val world = fnv { mix ->
            for (r in arrayOf(0xf4f34 to 0xf6e74, 0x10ce74 to 0x122e74))
                for (i in r.first until r.second) mix(m.u8(i))
        }
        val glob = fnv { mix ->
            for (r in arrayOf(0x31b58 to 0x31b70, 0x31c28 to 0x31c68, 0x32aec to 0x32d00,
                    0x33358 to 0x333c8, 0x393a0 to 0x393a4))
                for (i in r.first until r.second) mix(m.u8(i))
        }

        var живых = 0
        var i = m.u32(G.unitHead)
        while (i != 0) { живых++; i = m.u32(UNITS + i + U.NEXT) }

        assertEquals(38, живых, "юнитов в списке")
        assertEquals(4000, m.u32(G.food + 5 * 4), "стартовая еда игрока")
        assertEquals("3,3,0,3,3,3,0,3", (0x32af4 until 0x32afc).joinToString(",") { m.u8(it).toString() },
            "раздача врагов слотам ИИ (её делает второй ГСЧ)")
        assertEquals("ca09269a", units, "записи юнитов")
        assertEquals("a7a2dbb3", world, "предметы и сетки")
        assertEquals("1e2b6deb", glob, "глобалы")
        assertEquals(0, eng.todo.size, "непортированных вызовов быть не должно: ${eng.todo}")
    }
}
