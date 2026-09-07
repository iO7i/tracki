package app.tracki.sdk

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * JSON bridge between the SDK's `Map<String, Any?>` / `List<*>` wire bodies and
 * org.json, with omitted-absent semantics already baked into the maps the SDK
 * builds (null values never reach here for the optional wire fields).
 */
object Json {
    fun encode(value: Any?): String = toJsonValue(value).toString()

    fun decode(text: String): Any? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null
        return when (trimmed.first()) {
            '{' -> fromJsonObject(JSONObject(trimmed))
            '[' -> fromJsonArray(JSONArray(trimmed))
            else -> JSONObject("{\"v\":$trimmed}").let { it.get("v") }
        }
    }

    private fun toJsonValue(value: Any?): Any {
        return when (value) {
            null -> JSONObject.NULL
            is Map<*, *> -> {
                val o = JSONObject()
                for ((k, v) in value) o.put(k.toString(), toJsonValue(v))
                o
            }
            is List<*> -> {
                val a = JSONArray()
                for (v in value) a.put(toJsonValue(v))
                a
            }
            else -> value
        }
    }

    private fun fromJsonObject(o: JSONObject): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        for (k in o.keys()) m[k] = unwrap(o.get(k))
        return m
    }

    private fun fromJsonArray(a: JSONArray): List<Any?> {
        val list = ArrayList<Any?>(a.length())
        for (i in 0 until a.length()) list.add(unwrap(a.get(i)))
        return list
    }

    private fun unwrap(v: Any?): Any? = when (v) {
        JSONObject.NULL -> null
        is JSONObject -> fromJsonObject(v)
        is JSONArray -> fromJsonArray(v)
        else -> v
    }
}

/**
 * Default transport over HttpURLConnection (no OkHttp). Network I/O runs on the
 * IO dispatcher. Fail-silent: errors resolve to null so callers (queue / router)
 * decide what to do — telemetry never throws into the host app.
 */
class HttpUrlConnectionTransport : Transport {
    override suspend fun post(url: String, body: Map<String, Any?>): Any? = withContext(Dispatchers.IO) {
        runCatching {
            val conn = URL(url).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("content-type", "application/json")
                conn.outputStream.use { it.write(Json.encode(body).toByteArray(Charsets.UTF_8)) }
                readBody(conn)
            } finally {
                conn.disconnect()
            }
        }.getOrNull()
    }

    override suspend fun get(url: String): Any? = withContext(Dispatchers.IO) {
        runCatching {
            val conn = URL(url).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "GET"
                readBody(conn)
            } finally {
                conn.disconnect()
            }
        }.getOrNull()
    }

    private fun readBody(conn: HttpURLConnection): Any? {
        val stream = runCatching { conn.inputStream }.getOrNull() ?: conn.errorStream ?: return null
        val text = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        return runCatching { Json.decode(text) }.getOrNull()
    }
}

/** Convenience constructor mirroring the reference's `fetchTransport()`. */
fun httpTransport(): Transport = HttpUrlConnectionTransport()
