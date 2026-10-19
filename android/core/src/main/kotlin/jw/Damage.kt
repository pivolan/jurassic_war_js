package jw

/**
 * Урон, смерть и её последствия — порт combat.js в объёме ближнего боя.
 *
 * Урон в оригинале **без единой случайности**: `(max(ATK − DEF, 0) >> 4) + (ATK >> 5) + 1`, дальше
 * прибавка от оружия и вычет от щита по таблицам. Именно поэтому бой полностью воспроизводим,
 * а реплеи сходятся байт в байт.
 *
 * Дальний бой и магия (снаряды, заклинания) пока не портированы — их ветки вызываются через opt
 * и просто не срабатывают, что видно в списке пропущенного.
 */
object Damage {
    private fun lo8(r: Int, v: Int) = (r and 0xff.inv()) or (v and 0xff)

    fun register() {
        // 0x1ea75: базовый урон
        F[0x1ea75] = { e, r ->
            val m = e.m
            val atk = m.u8(UNITS + r.esi + U.ATK)
            var al = atk - m.u8(UNITS + r.edi + U.DEF)
            if (al < 0) al = 0
            al = (al shr 4) + (atk shr 5) + 1
            Regs(eax = lo8(r.eax, al))
        }

        // 0x1ea92: ценность цели в опыте
        F[0x1ea92] = { e, r ->
            val m = e.m; val b = UNITS + r.edi
            val s = (m.u8(b + U.HPMAX) + m.u8(b + U.MAG) + m.u8(b + U.ATK) + m.u8(b + U.DEF) + m.u8(b + U.SPD)) and 0xffff
            Regs(eax = ((s * s) ushr 2) + m.u32(b + U.XP))
        }

        F[0x1eada] = { e, r -> applyDamage(e, r); r }
        F[0x1eaca] = { e, r -> e.m.w8(0x31b68, 1); applyDamage(e, r); r }
        F[0x1ead3] = { e, r -> e.m.w8(0x31b68, 0); applyDamage(e, r); r }
        F[0x1ebdc] = { e, r -> death(e, r.esi, r.edi); r }

        // 0x1a42c: снять юнита с сетки занятости
        F[0x1a42c] = { e, r ->
            val m = e.m; val esi = r.esi
            val tx = (r.edx and 0xffff) ushr 5; val ty = (r.ebx and 0xffff) ushr 5
            m.w8(UNITS + esi + 0x53, tx); m.w8(UNITS + esi + 0x54, ty)
            val cell = (ty shl 8) + tx
            if (m.u8(UNITS + esi + U.TYPE) != 0x0b) m.w8(BI + cell, m.u8(BI + cell) and 3)
            else m.w8(MO + cell, m.u8(MO + cell) and 0xf)
            r
        }

        // 0x1a8dc: кадр смерти
        F[0x1a8dc] = { e, r ->
            val m = e.m; val b = UNITS + r.esi
            val ty = m.u8(b + U.TYPE)
            var cl = m.u8(b + U.ATKCTR) shr 5
            val dir = m.u16(b + U.DIR)
            val bx = if (cl >= 2) { cl -= 2; m.u16(0x36f12 + ty * 4) + m.u16(0x36f72 + dir * 4) }
                     else m.u16(0x36f10 + ty * 4) + m.u16(0x36f70 + dir * 4)
            m.w16(b + U.SPR, (bx + cl) and 0xffff)
            r
        }

        // 0x1aaf7: убрать запись из активного списка в список свободных
        F[0x1aaf7] = { e, r ->
            val m = e.m; val esi = r.esi; val b = UNITS + esi
            m.w8(b + U.FLAGS5B, m.u8(b + U.FLAGS5B) or 1)
            var edi = m.u32(b + U.PREV)
            val eax = m.u32(b + U.NEXT)
            if (edi == 0) m.w32(G.unitHead, eax) else m.w32(UNITS + edi + U.NEXT, eax)
            if (eax != 0) m.w32(UNITS + eax + U.PREV, edi)
            edi = m.u32(0x31b70)
            m.w32(b + U.PREV, 0); m.w32(b + U.NEXT, edi); m.w32(0x31b70, esi)
            if (edi != 0) m.w32(UNITS + edi + U.PREV, esi)
            Regs(eax = eax, edi = edi)
        }

        // 0x19693: состояние 0x6x — умирание, труп, выпадение инвентаря
        F[0x19693] = { e, r ->
            val m = e.m; val esi = r.esi; val b = UNITS + esi
            if (m.u8(b + U.STATE) == 0x6f) {
                m.w8(b + U.STATE, 0x60)
                call(e, 0x1e0e0, Regs(esi = esi))
                m.w32(G.rngRange, 0x36)
                m.w16(b + U.ANIM, e.randRaw() and 0xff)
                call(e, 0x1a42c, Regs(esi = esi, edx = m.u8(b + 0x53) shl 5, ebx = m.u8(b + 0x54) shl 5))
                if (m.u32(0x31adc) == esi) opt(e, 0x1a62d, Regs(esi = esi))
                m.w8(b + U.F07, 0)
                opt(e, 0x1ff1c, Regs(esi = esi))                      // звук смерти
                m.w8(b + U.ATKCTR, 0); m.w8(b + U.WEAPON, 0xff); m.w8(b + U.SHIELD, 0xff)
                val bp = m.u16(b + 0x53)
                for (k in 0 until 0xc) {                              // всё из инвентаря падает на землю
                    val it = m.u8(b + U.INV + k)
                    if (it == 0) continue
                    val a = opt(e, 0x1ca54, Regs()) ?: break
                    if (a.cf) break
                    val ip = ITEMS + a.esi
                    m.w8(ip, it); m.w16(ip + 6, 1)
                    if (it == 0x1e) m.w16(ip + 6, m.u16(b + U.FOOD))
                    m.w16(ip + 1, bp)
                }
                val ty = m.u8(b + U.TYPE)
                if (ty in 0xe until 0x18) m.w32(0x33358 + ty * 4, m.u32(0x33358 + ty * 4) + 1)   // счётчик убитых зверей
            } else {
                var готово = false
                if (m.u8(b + U.TYPE) < 0xe) {
                    if (m.u8(b + U.ATKCTR) >= 0xc0) {                  // труп истлел
                        if (m.u8(b + U.F08) != 0) {
                            val sl = m.u8(b + U.SLOT)
                            val a = if (m.u8(b + U.F08) == 1) 0x32b2c else 0x32b7c
                            m.w16(a + sl * 2, m.u16(a + sl * 2) + 1)
                        }
                        if ((m.u8(b + U.FLAGS5B) and 2) == 0) call(e, 0x1aaf7, Regs(esi = esi))
                        else m.w8(b + U.FLAGS5B, m.u8(b + U.FLAGS5B) or 1)
                        готово = true
                    }
                } else if (m.u8(b + U.ATKCTR) >= 0xc0) {
                    m.w8(b + U.FLAGS5B, m.u8(b + U.FLAGS5B) or 1); готово = true
                }
                if (!готово) {
                    call(e, 0x1a8dc, Regs(esi = esi))
                    m.w8(b + U.ATKCTR, m.u8(b + U.ATKCTR) + 1)
                }
            }
            r
        }

        // 0x1e758: удар. Магия и стрелковое — отдельными ветками, они пока не портированы.
        F[0x1e758] = { e, r ->
            val m = e.m; val b = UNITS + r.esi; val t = UNITS + r.edi
            m.w32(b + U.XP, m.u32(b + U.XP) + 1)
            m.w32(t + U.XP, m.u32(t + U.XP) + 1)
            opt(e, 0x1ff39, Regs(esi = r.esi))                        // звук удара
            val ty = m.u8(b + U.TYPE)
            when {
                ty == 0 || ty >= 24 -> {}
                ty in 5..8 -> opt(e, 0x1b876, Regs(esi = r.esi))      // маги: снаряд заклинания
                ty == 13 -> opt(e, 0x1b876, Regs(esi = r.esi))
                else -> {                                             // 0x1e934: обычная атака
                    var al = call(e, 0x1ea75, r).eax and 0xff
                    val ecx = m.u8(t + U.TYPE)
                    var edx = 0x37b54
                    val ws = m.u8(b + U.WEAPON)
                    var wid = -1
                    if (ws != 0xff) {
                        wid = m.u8(b + U.INV + ws)
                        edx = m.u32(0x37af4 + wid * 4)
                        al = (al + m.u8(ecx + edx)) and 0xff
                    }
                    val ss = m.u8(t + U.SHIELD)
                    if (ss != 0xff) {
                        val cl = m.u8(t + U.INV + ss)
                        val v = al - m.u8(cl + edx + 0x28)
                        al = if (v <= 0) 1 else v
                    }
                    val дальний = wid == 4 || wid in 5..7
                    if (ws == 0xff || !дальний) call(e, 0x1ead3, Regs(esi = r.esi, edi = r.edi, eax = al))
                    else opt(e, 0x1c2a4, Regs(esi = r.esi))           // стрела/копьё — снаряд, пока нет
                }
            }
            r
        }
    }

    /** 0x1eada / 0x1eaca / 0x1ead3: снять здоровье, при нуле — смерть, иначе ответить. */
    private fun applyDamage(eng: Engine, r: Regs) {
        val m = eng.m; val esi = r.esi; val edi = r.edi
        val al = r.eax and 0xff
        val t = UNITS + edi; val b = UNITS + esi
        if ((m.u8(t + U.FLAGS5B) and 1) != 0) { call(eng, 0x1a34c, Regs(esi = esi)); return }
        fun sub(v: Int): Boolean { val hp = m.u8(t + U.HP); val nv = hp - v; m.w8(t + U.HP, nv); return nv <= 0 }
        var dead: Boolean
        if (m.u8(t + U.TYPE) >= 0x1a) {                                // здания дымят на половине здоровья
            val bl = m.u8(t + U.HPMAX) shr 1
            if (m.u8(t + U.HP) < bl) dead = sub(al)
            else {
                dead = sub(al)
                if (!dead && m.u8(t + U.HP) < bl) {
                    opt(eng, 0x1ffda, Regs(esi = esi, edi = edi))
                    val hp = m.u8(t + U.HP); m.w8(t + U.HP, hp - 2); dead = hp < 2
                }
            }
        } else dead = sub(al)
        if (dead) { death(eng, esi, edi); return }
        if (m.u8(t + U.TYPE) >= 0x1a) {
            val ow = m.u8(t + U.OWNER)
            if (m.u8(G.humanOwner) == ow) { opt(eng, 0x2593e, Regs()); return }
            if (m.u8(0x32aec + ow) == 0) return
            val ao = m.u8(b + U.OWNER)
            if (ao == 8 || m.u8(0x32aec + ao) == 0) opt(eng, 0x160fe, Regs(esi = esi, edi = edi))
            return
        }
        if (m.u8(b + U.TYPE) >= 0x18) return
        if (m.u8(t + U.ORDER) != 0xff) return
        val st = m.u8(t + U.STATE)
        fun retaliate() = call(eng, 0x19fdf, Regs(esi = edi, edi = esi))
        if (st == 0x20 || st == 0x32 || st in 0x36..0x3f) { retaliate(); return }
        val ss = m.u8(b + U.STATE)
        if (ss != 0x10 && ss != 0x30) return
        val ebp = m.u32(t + U.TARGET)
        if (m.u8(UNITS + ebp + U.TYPE) >= 0x18) retaliate()
    }

    /** 0x1ebdc: цель умерла — опыт убийце и возможное повышение. */
    private fun death(eng: Engine, esi: Int, edi: Int) {
        val m = eng.m; val t = UNITS + edi; val b = UNITS + esi
        m.w8(t + U.HP, 0)
        val st = m.u8(t + U.STATE)
        if (st == 0x6f || st == 0x60) return
        m.w8(t + U.STATE, 0x6f)
        if (m.u8(t + U.TYPE) >= 0x1a) return
        val eax = call(eng, 0x1ea92, Regs(edi = edi)).eax
        m.w32(b + U.XP, m.u32(b + U.XP) + eax)
        m.w8(b + U.FLAGS50, 0xd)
        val ty = m.u8(b + U.TYPE)
        if (ty < 0xe) {                                                // человек может вырасти в звании
            opt(eng, 0x1ec47, Regs(esi = esi))
            val a = opt(eng, 0x1f6fe, Regs(esi = esi, eax = 0))
            if (a != null) m.w8(b + U.TYPE, a.eax and 0xff)
        } else if (ty < 0x18) opt(eng, 0x1f20f, Regs(esi = esi))
        else opt(eng, 0x1f426, Regs(esi = esi))
    }
}
