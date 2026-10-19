package jw

/**
 * Загрузка миссии — порт FUN_00015026 и цепочки старта (reimpl/js/loader.js и js/port/loader.js).
 *
 * Карта в оригинале — это снимок памяти: девять секций пака 08 кладутся по фиксированным адресам,
 * и дальше движок доводит состояние сам. Здесь же — те функции старта, без которых загрузка
 * неполна: расстановка юнитов по сеткам, открытие тумана, модификатор сложности, инициализация ИИ.
 */
object Sections {
    // SI GI OB OI OM BI EV BG MO
    val list = arrayOf(
        intArrayOf(0x31a90, 30), intArrayOf(0x31aae, 7072), intArrayOf(0xe4404, 57600),
        intArrayOf(0xf4f34, 8000), intArrayOf(0xf2504, 10800), intArrayOf(0x10ce74, 45056),
        intArrayOf(0x31b88, 160), intArrayOf(0xf6e74, 90112), intArrayOf(0x117e74, 45056),
    )
    const val TILE_TRT = 0x49b2c
    const val TILE_INF = 0x3183c
    const val TILESET_LOADED = 0x33839
    const val TILESET_CUR = 0x3364a
}

object Loader {
    /** Регистрация функций старта. Вызывается один раз перед первой загрузкой. */
    fun register() {
        // 0x204a6: второй ГСЧ, подмешивает таймер BIOS. Голоса юнитов на него не заводить —
        // иначе поток случайных чисел зависит от звука (см. ROADMAP §7a).
        F[0x204a6] = { e, _ ->
            val m = e.m
            val n = m.u32(0x393a8)
            if (n == 0) Regs(edx = 0) else {
                val eax = (m.u32u(0x393a4) + m.u32u(0x46c)) and 0xffffffffL
                val q = (eax / (n.toLong() and 0xffffffffL)).toInt()
                val rem = (eax % (n.toLong() and 0xffffffffL)).toInt()
                m.w32(0x393a4, m.u32(0x393a4) + q)
                m.w32(0x393a4, m.u32(0x393a4) xor m.u32(0x393ac + (q ushr 28)))
                Regs(edx = rem)
            }
        }
        // 0x1a3db: отметить юнита в сетке занятости (птеродактиль 0x0b — в своей сетке MO)
        F[0x1a3db] = { e, r ->
            val m = e.m; val esi = r.esi
            val tx = (r.edx and 0xffff) ushr 5; val ty = (r.ebx and 0xffff) ushr 5
            m.w8(UNITS + esi + 0x53, tx); m.w8(UNITS + esi + 0x54, ty)
            val cell = (ty shl 8) + tx
            val al = (m.u8(UNITS + esi + U.OWNER) + 1) and 0xff
            if (m.u8(UNITS + esi + U.TYPE) != 0x0b)
                m.w8(BI + cell, (m.u8(BI + cell) and 3) or ((al shl 2) and 0xff))
            else
                m.w8(MO + cell, (m.u8(MO + cell) and 0xf) or ((al shl 4) and 0xff))
            r
        }
        // 0x1a4cc: открыть туман (бит 0 в BI) кольцом вокруг юнита; радиус по скорости
        F[0x1a4cc] = { e, r ->
            val m = e.m; val esi = r.esi
            var ecx = m.u32(0x3058c + (m.u8(UNITS + esi + U.SPD) ushr 4) * 4)
            val edx = m.u16(UNITS + esi + U.X) ushr 5
            val ebx = m.u16(UNITS + esi + U.Y) ushr 5
            var edi = 0
            while (ecx != 0) {
                val eax = m.i16(0x305d0 + edi) + edx
                if (eax in 0..0xff) {
                    val ebp = m.i16(0x305d2 + edi) + ebx
                    if (ebp in 0..0xaf) m.w8(BI + (ebp shl 8) + eax, m.u8(BI + (ebp shl 8) + eax) or 1)
                }
                edi += 4; ecx--
            }
            r
        }
        F[0x1a3ba] = { e, r ->
            val m = e.m
            if ((m.u8(UNITS + r.esi + U.FLAGS5B) and 1) == 0) {
                call(e, 0x1a3db, r)
                if (m.u8(G.humanOwner) == m.u8(UNITS + r.esi + U.OWNER)) call(e, 0x1a4cc, r)
            }
            r
        }
        // 0x1dac2: отпечаток здания в сетке занятости по таблице клеток 0x3176c/0x31770
        F[0x1dac2] = { e, r ->
            val m = e.m; val b = UNITS + r.esi
            val k = m.u8(b + U.TYPE) - 0x1a
            var ebp = m.u32(0x31770 + k * 8)
            var ecx = m.u32(0x3176c + k * 8)
            val al = ((m.u8(b + U.OWNER) + 1) shl 2) and 0xff
            while (ecx > 0) {
                val gi = (((m.u16(b + U.Y) + m.u32(ebp + 4)) ushr 5) shl 8) + ((m.u16(b + U.X) + m.u32(ebp)) ushr 5)
                m.w8(BI + gi, (m.u8(BI + gi) and 3) or al)
                ecx--; ebp += 8
            }
            r
        }
        // 0x1f475: открыть заклинания, доступные по силе магии
        val spellBits = arrayOf(
            intArrayOf(0x100, 0x30b60), intArrayOf(0x200, 0x30b64), intArrayOf(0x400, 0x30b68),
            intArrayOf(0x800, 0x30b6c), intArrayOf(0x1000, 0x30b70), intArrayOf(0x4000, 0x30b78),
            intArrayOf(0x8000, 0x30b7c), intArrayOf(0x10000, 0x30b80), intArrayOf(0x20000, 0x30b84),
            intArrayOf(0x80000, 0x30b8c), intArrayOf(0x100000, 0x30b90), intArrayOf(0x200000, 0x30b94),
            intArrayOf(0x400000, 0x30b98), intArrayOf(0x1000000, 0x30ba0), intArrayOf(0x2000000, 0x30ba4),
            intArrayOf(0x4000000, 0x30ba8),
        )
        F[0x1f475] = { e, r ->
            val m = e.m; val esi = r.esi
            if (m.u8(UNITS + esi + U.TYPE) < 9) {
                val dl = m.u8(UNITS + esi + U.MAG)
                val ptr = m.u32(0x30e64 + m.u8(UNITS + esi + U.SLOT) * 4)
                val ebx = m.u32(ptr + m.u8(UNITS + esi + U.TYPE) * 4)
                val eax = m.u32(UNITS + esi + U.SKILLS)
                for (t in spellBits) {
                    if ((ebx and t[0]) == 0) continue
                    if (m.u8(t[1]) > dl) continue
                    if ((eax and t[0]) != 0) continue
                    m.w32(UNITS + esi + U.SKILLS, m.u32(UNITS + esi + U.SKILLS) or t[0])
                }
            }
            r
        }
        // 0x15070: очистка сеток и повторная простановка всех юнитов
        F[0x15070] = { e, _ ->
            val m = e.m
            for (k in 0 until 0xb000) { m.b[BI + k] = 0; m.b[MO + k] = 0 }
            var i = m.u32(G.unitHead)
            while (i != 0) {
                if ((m.u8(UNITS + i + U.FLAGS5B) and 1) == 0) {
                    val st = m.u8(UNITS + i + U.STATE)
                    if (st != 0x60 && st != 0x6f) {
                        if (m.u8(UNITS + i + U.TYPE) < 0x1a)
                            call(e, 0x1a3db, Regs(esi = i, edx = m.u8(UNITS + i + 0x53) shl 5, ebx = m.u8(UNITS + i + 0x54) shl 5))
                        else
                            call(e, 0x1dac2, Regs(esi = i))
                        var al = 0
                        val w = m.u8(UNITS + i + U.WEAPON)
                        if (w != 0xff) al = m.u8(UNITS + i + U.INV + w)
                        m.w8(UNITS + i + U.F09, al)
                        al = 0
                        val s = m.u8(UNITS + i + U.SHIELD)
                        if (s != 0xff) al = m.u8(UNITS + i + U.INV + s)
                        m.w8(UNITS + i + U.F0A, al)
                    }
                }
                i = m.u32(UNITS + i + U.NEXT)
            }
            Regs()
        }
        F[0x15127] = { e, _ ->
            val m = e.m
            var i = m.u32(G.unitHead)
            while (i != 0) {
                if (m.u8(UNITS + i + U.TYPE) < 0xe) {
                    m.w32(UNITS + i + U.SKILLS, 0x3f)
                    call(e, 0x1f475, Regs(esi = i))
                }
                i = m.u32(UNITS + i + U.NEXT)
            }
            Regs()
        }
        // 0x1545a: модификатор сложности (0 easy, 1 normal — ничего не делает, 2 hard)
        F[0x1545a] = { e, _ ->
            val m = e.m
            val d = m.u8(G.difficulty)
            val head = m.u32(G.unitHead)
            if (d != 1 && head != 0) {
                val al = m.u8(G.humanOwner)
                val ah = m.u8(0x303b2 + d)
                fun add(a: Int, v: Int) = m.w8(a, m.u8(a) + v)
                val stats = intArrayOf(U.HPMAX, U.HP, U.ATK, U.DEF, U.MAG, U.MANA, U.SPD)
                if (d < 1) {
                    var i = head
                    while (i != 0) {
                        if (m.u8(UNITS + i + U.OWNER) == al && m.u8(UNITS + i + U.TYPE) < 0x1a) {
                            for (f in stats) add(UNITS + i + f, ah)
                            call(e, 0x1f475, Regs(esi = i))
                        } else {
                            fun dec(off: Int, floor: Int) {
                                val v = m.u8(UNITS + i + off) - 10
                                m.w8(UNITS + i + off, if (v < 0) floor else v)
                            }
                            dec(U.HPMAX, 5); m.w8(UNITS + i + U.HP, m.u8(UNITS + i + U.HPMAX))
                            dec(U.ATK, 5); dec(U.DEF, 5); dec(U.MAG, 0)
                            m.w8(UNITS + i + U.MANA, m.u8(UNITS + i + U.MAG))
                        }
                        i = m.u32(UNITS + i + U.NEXT)
                    }
                    val h = m.u16(G.humanOwner)
                    m.w32(G.food + h * 4, m.u32(G.food + h * 4) + 0x1388)
                } else {
                    var i = head
                    while (i != 0) {
                        if (m.u8(UNITS + i + U.OWNER) != al && m.u8(UNITS + i + U.TYPE) < 0x1a) {
                            for (f in stats) add(UNITS + i + f, ah)
                            call(e, 0x1f475, Regs(esi = i))
                        }
                        i = m.u32(UNITS + i + U.NEXT)
                    }
                    val h = m.u16(G.humanOwner) and 0xff
                    for (s in 0 until 8) if (m.u8(0x32ae4 + s) != h) m.w32(G.food + s * 4, m.u32(G.food + s * 4) + 0x4e20)
                }
            }
            Regs()
        }
        // 0x15da1: раздача врагов слотам ИИ (единственное живое место, где нужен второй ГСЧ)
        F[0x15da1] = { e, _ ->
            val m = e.m
            m.w32(G.rngN, 4)
            for (b in 0 until 8) {
                m.w8(0x32afc + b, 1)
                val dl = call(e, 0x204a6).edx and 0xff
                m.w8(0x32af4 + b, dl)
                val edi = (b shl 5) + m.u8(0x32afc + b)
                m.w8(0x32b04 + b, m.u8(0x32d2c + edi + dl * 8))
                if (m.u8(0x32aec + b) != 0) {
                    m.w8(0x32aec + b, 1)
                    val o = b * 10
                    m.w8(0x32bcc + o, 8); m.w8(0x32bcd + o, 0)
                    m.w8(0x32c1c + o, 8); m.w8(0x32c1d + o, 0)
                    var v = m.u16(0x32c7c + b * 2) + 0xc8
                    val d = m.u8(G.difficulty)
                    if (d != 2) { v += 0x50; if (d != 1) v += 0x50 }
                    m.w16(0x32c7c + b * 2, v)
                }
            }
            Regs()
        }
        F[0x244c3] = { e, _ ->
            val m = e.m
            for (k in 0 until 0xb000) m.b[BI + k] = (m.b[BI + k].toInt() and 0xfe).toByte()
            var i = m.u32(G.unitHead)
            while (i != 0) {
                if ((m.u8(UNITS + i + U.FLAGS5B) and 1) == 0)
                    call(e, 0x1a3ba, Regs(esi = i, edx = m.u16(UNITS + i + U.X), ebx = m.u16(UNITS + i + U.Y)))
                i = m.u32(UNITS + i + U.NEXT)
            }
            Regs()
        }
        F[0x24503] = { e, _ ->
            val m = e.m
            for (k in 0 until 0x24f) m.b[0x3e8aa + k] = m.b[0x49b2c + 0x200 + k * 0x400]
            Regs()
        }
        // 0x24564: таблицы ограничения прокрутки и прямоугольник мини-карты
        F[0x24564] = { e, _ ->
            val m = e.m
            val w = m.u32(G.mapW); val h = m.u32(G.mapH)
            val big = (m.u8(0x31ae0) and 4) == 0
            if (big) {
                for (b in 0 until w) m.w8(0x3e6f0 + b, b - 0x34)
                for (b in 0 until 0x34) m.w8(0x3e6f0 + b, 0)
                run {
                    val bx = if (w < 0x44) 0 else w - 0x44
                    val al = if (w < 0x78) 0 else w - 0x78
                    for (k in 0 until 0x44) m.w8(0x3e6f0 + bx + k, al)
                }
                for (b in 0 until h) m.w8(0x3e7f0 + b, b - 0x35)
                for (b in 0 until 0x35) m.w8(0x3e7f0 + b, 0)
                run {
                    val bx = if (h < 0x43) 0 else h - 0x43
                    val al = if (h < 0x78) 0 else h - 0x78
                    for (k in 0 until 0x43) m.w8(0x3e7f0 + bx + k, al)
                }
                m.w32(0x30388, 0x204); m.w32(0x30390, 0x78)
                if (w < 0x78) {
                    m.w32(0x30390, w)
                    m.w32(0x30388, if ((m.u8(0x31ae0) and 1) != 0) ((0x78 - w) ushr 1) + 0x204 else 0x27c - w)
                }
                m.w32(0x3038c, 4); m.w32(0x30394, 0x78)
                if (h < 0x78) {
                    m.w32(0x30394, h)
                    if ((m.u8(0x31ae0) and 1) != 0) m.w32(0x3038c, ((0x78 - h) ushr 1) + 4)
                }
            } else {
                for (b in 0 until w) m.w8(0x3e6f0 + b, b - 0x16)
                for (b in 0 until 0x16) m.w8(0x3e6f0 + b, 0)
                run {
                    val bx = w - 0x26
                    val al = if (w < 0x3c) 0 else w - 0x3c
                    for (k in 0 until 0x26) m.w8(0x3e6f0 + bx + k, al)
                }
                for (b in 0 until h) m.w8(0x3e7f0 + b, b - 0x16)
                for (b in 0 until 0x16) m.w8(0x3e7f0 + b, 0)
                run {
                    val bx = h - 0x25
                    val al = if ((h and 0xff) < 0x3c) 0 else (h and 0xff) - 0x3c
                    for (k in 0 until 0x25) m.w8(0x3e7f0 + bx + k, al)
                }
                m.w32(0x30388, 0x204); m.w32(0x30390, 0x78)
                if (w < 0x3c) {
                    m.w32(0x30390, w shl 1)
                    m.w32(0x30388, if ((m.u8(0x31ae0) and 1) != 0) ((0x78 - w - w) ushr 1) + 0x204 else 0x27c - (w shl 1))
                }
                m.w32(0x3038c, 4); m.w32(0x30394, 0x78)
                if (h < 0x3c) {
                    m.w32(0x30394, h shl 1)
                    if ((m.u8(0x31ae0) and 1) != 0) m.w32(0x3038c, ((0x78 - h - h) ushr 1) + 4)
                }
            }
            m.w32(0x30398, m.u32(0x30388) + m.u32(0x30390))
            m.w32(0x3039c, m.u32(0x3038c) + m.u32(0x30394))
            Regs()
        }
        // 0x26521: размеры окна просмотра карты
        F[0x26521] = { e, _ ->
            val m = e.m
            m.w32(0x488c8, m.u32(0x31af4) * 0x20)
            fun sub() {
                m.w32(0x31b00, (m.u32(G.mapW) - m.u32(0x31af0)) shl 5)
                m.w32(0x31b04, (m.u32(G.mapH) - m.u32(0x31af4)) shl 5)
            }
            if ((m.u8(0x31ae0) and 1) != 0) {
                m.w32(0x31af0, 0x10); m.w32(0x488c4, 0x200); m.w32(0x46ffc, 0x1ff)
                sub(); call(e, 0x24564); m.w32(0x424d0, 0x1cc); m.w32(0x424d4, 3)
            } else {
                m.w32(0x31af0, 0x14); m.w32(0x488c4, 0x280); m.w32(0x46ffc, 0x27f)
                sub()
                val end = (m.u32(0x31ae8) ushr 5) + 0x14
                if (m.u32(G.mapW) < end) m.w32(0x31ae8, (m.u32(G.mapW) - 0x14) shl 5)
                if ((m.u8(0x31ae0) and 8) != 0) {
                    call(e, 0x24564)
                    m.w32(0x424d0, m.u32(0x30388) - 0x34); m.w32(0x424d4, m.u32(0x3038c) - 1)
                } else {
                    m.w32(0x424d0, 0x24c); m.w32(0x424d4, 4)
                }
            }
            Regs()
        }
        // 0x10713: палитра из пака 01 (запись 4, MAIN.PAL)
        F[0x10713] = { e, _ ->
            val f = e.files["_PWAR01.TRC"]
            if (f != null) e.m.set(0x44980, Archive(f).data(4), 0, 768)
            Regs()
        }
    }

    /** FUN_00015026: карта — это снимок памяти, движок доводит остальное сам. */
    fun loadMission(m: Mem, files: Map<String, ByteArray>, mission: Int, tribe: Int, difficulty: Int): Engine {
        if (!F.has(0x15070)) register()
        val eng = Engine(m)
        eng.files = files
        m.w8(G.mission, mission); m.w8(G.humanOwner, tribe); m.w8(G.difficulty, difficulty)
        m.w16(G.speed, 1); m.w16(G.countdown, 1); m.w8(G.norender, 1); m.w8(0x30344, 0); m.w8(G.netflag, 0)
        call(eng, 0x10713)
        val maps = Archive(files["_PWAR08.TRC"]!!)
        val idx = mission * 8 + tribe
        for (k in 0 until 9) {
            val (dst, size) = Sections.list[k].let { it[0] to it[1] }
            val d = maps.data(idx * 9 + k)
            m.set(dst, d, 0, minOf(size, d.size))
        }
        // GI затирает эти три байта — оригинал восстанавливает их после загрузки
        m.w8(G.mission, mission); m.w8(G.difficulty, difficulty); m.w8(G.humanOwner, tribe)
        val ts = m.u32(Sections.TILESET_CUR) and 0xff
        if (m.u8(Sections.TILESET_LOADED) != ts) {
            val t9 = Archive(files["_PWAR09.TRC"]!!)
            m.set(Sections.TILE_TRT, t9.data(ts * 2), 0, 605184)
            m.set(Sections.TILE_INF, t9.data(ts * 2 + 1), 0, 591)
            m.w8(Sections.TILESET_LOADED, ts)
            call(eng, 0x24503)
        }
        opt(eng, 0x10b29, Regs(eax = tribe))            // спрайты племени: только когда есть рендер
        call(eng, 0x26521)
        call(eng, 0x15070); call(eng, 0x244c3); call(eng, 0x15127)
        call(eng, 0x1545a); call(eng, 0x15da1)
        m.w32(G.step, 0); m.w32(G.ticks, 0); m.w8(G.endcode, 0); m.w16(G.gameover, 0)
        return eng
    }
}
