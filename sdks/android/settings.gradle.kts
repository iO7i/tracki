pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        id("com.android.library") version "8.5.2"
        id("com.android.application") version "8.5.2"
        kotlin("android") version "1.9.22"
    }
}

rootProject.name = "tracki-android"
include(":sdk", ":consumer")
