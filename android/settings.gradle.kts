pluginManagement {
    repositories { gradlePluginPortal(); mavenCentral(); google() }
}
dependencyResolutionManagement {
    repositories { mavenCentral(); google() }
}
// Нативный порт Jurassic War на Android. Движок лежит в :core — это чистый Kotlin/JVM без
// зависимостей от Android, чтобы гонять его тестами прямо на машине, как сейчас гоняется
// JS-порт в Node. Модуль :app — только оболочка: экран, ввод, звук, ресурсы.
rootProject.name = "jurassic-war"
include(":core")
include(":app")
