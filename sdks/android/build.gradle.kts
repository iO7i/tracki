plugins {
    // Pure Kotlin/JVM core so the conformance suite runs under plain JUnit
    // without an Android toolchain. The Android adapter (SharedPreferences
    // storage + HttpURLConnection transport) lives in Adapter.kt and only uses
    // android.* types behind a thin seam, kept out of the JVM test compile path.
    kotlin("jvm") version "1.9.22"
}

group = "app.tracki"
version = "0.1.0"

repositories {
    mavenCentral()
    google()
}

dependencies {
    // org.json is the single JSON dependency (declared here, used everywhere).
    implementation("org.json:json:20240303")
    // Structured concurrency for the async storage/transport seams.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")

    // Android SDK stubs for the adapter file. `compileOnly` so they never enter
    // the JVM test classpath; on a real Android build the platform provides them.
    compileOnly("com.google.android:android:4.1.1.4")

    testImplementation(kotlin("test"))
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.0")
}

tasks.test {
    useJUnitPlatform()
}

kotlin {
    jvmToolchain(17)
}
