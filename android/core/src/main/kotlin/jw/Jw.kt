package jw

/**
 * Единая регистрация портированных функций. Реестр F — общее состояние, поэтому регистрировать
 * модули по отдельности опасно: результат начинает зависеть от того, кто успел первым.
 * Всё, что портировано, поднимается здесь и только здесь.
 */
object Jw {
    @Volatile private var готово = false

    fun registerAll() {
        if (готово) return
        готово = true
        Loader.register()
        Render.register(); Sprites.register(); Scene.register()
        Move.register(); MoveStates.register(); Dispatch.register()
        Combat.register(); Damage.register()
        Orders.register(); Ui.register(); Panel.register(); Hud.register()
    }
}
