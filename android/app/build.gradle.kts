plugins {
    id("com.android.application")
    kotlin("android")
}
android {
    namespace = "de.pivolan.jw"
    compileSdk = 35
    defaultConfig {
        applicationId = "de.pivolan.jw"
        minSdk = 26                     // 8.0: ниже смысла нет, а SurfaceView и AudioTrack там уже прежние
        targetSdk = 35
        versionCode = 1
        versionName = "0.1"
    }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].kotlin.srcDir("src/main/kotlin")
}
dependencies { implementation(project(":core")) }
