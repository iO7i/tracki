package app.tracki.consumer

import android.app.Activity
import android.os.Bundle
import app.tracki.sdk.TrackiConfig

/** Minimal consumer proof: the public SDK types resolve from an Android app. */
class MainActivity : Activity() {
    private val trackiType = TrackiConfig::class.java

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        // Keep a concrete public-type reference in the consumer compile path.
        title = "Tracki ${trackiType.simpleName}"
    }
}
