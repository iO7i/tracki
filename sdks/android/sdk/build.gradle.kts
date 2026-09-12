plugins {
    id("com.android.library")
    kotlin("android")
}

group = "app.tracki"
version = "0.1.0"

repositories {
    google()
    mavenCentral()
}

android {
    namespace = "app.tracki.sdk"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    sourceSets["main"].java.srcDirs("../src/main/kotlin")
}

dependencies {
    implementation("org.json:json:20240303")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")
}
