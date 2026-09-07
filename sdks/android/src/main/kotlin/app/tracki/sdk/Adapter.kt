package app.tracki.sdk

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Android adapters — the only file that touches `android.*`. The android SDK is
 * a `compileOnly` dependency, so this file does not enter the pure-JVM test
 * classpath; the conformance suite runs without an Android toolchain.
 */

private const val PREFS_NAME = "tracki_sdk"

/**
 * [KeyValueStorage] backed by SharedPreferences. Reads/writes hop to the IO
 * dispatcher so the suspend contract is honoured off the main thread.
 */
class SharedPreferencesStorage(context: Context) : KeyValueStorage {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override suspend fun get(key: String): String? = withContext(Dispatchers.IO) {
        prefs.getString(key, null)
    }

    override suspend fun set(key: String, value: String) {
        withContext(Dispatchers.IO) {
            prefs.edit().putString(key, value).apply()
        }
    }
}
