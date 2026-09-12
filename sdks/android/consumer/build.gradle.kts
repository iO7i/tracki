plugins {
    id("com.android.application")
    kotlin("android")
}

repositories {
    google()
    mavenCentral()
}

android {
    namespace = "app.tracki.consumer"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.tracki.consumer"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }
}

dependencies {
    implementation(project(":sdk"))
}
