package app.tracki.sdk

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The Kotlin SDK must reproduce the shared conformance fixtures (as parsed
 * JSON). The TS reference + Flutter/Swift SDKs assert the SAME files — this is
 * what keeps the codebases on one protocol. Fixtures are loaded relative to the
 * module dir (…/sdks/android → …/sdks/conformance) and compared as parsed
 * structures (Map/List), which is order-independent for object keys.
 */

// ── Test doubles ─────────────────────────────────────────────────────────────

private class MemoryStorage : KeyValueStorage {
    private val data = HashMap<String, String>()
    override suspend fun get(key: String): String? = data[key]
    override suspend fun set(key: String, value: String) { data[key] = value }
}

private class CapturingTransport : Transport {
    data class Post(val url: String, val body: Any?)
    val posts = ArrayList<Post>()

    override suspend fun post(url: String, body: Map<String, Any?>): Any? {
        // Round-trip through org.json exactly like a real transport, so absent
        // (null) optional keys never appear in the captured body.
        val normalized = Json.decode(Json.encode(body))
        posts.add(Post(url, normalized))
        return mapOf("ok" to true)
    }

    override suspend fun get(url: String): Any? = mapOf("actions" to emptyList<Any?>())
}

private class ListRenderer : Renderer {
    val intents = ArrayList<RenderIntent>()
    override fun show(intent: RenderIntent) { intents.add(intent) }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

private fun loadFixture(name: String): Map<String, Any?> {
    // Resolve relative to the module working dir, climbing to sdks/conformance.
    val candidates = listOf(
        File("../conformance/$name"),
        File("../../conformance/$name"),
        File(System.getProperty("user.dir"), "../conformance/$name"),
    )
    val file = candidates.firstOrNull { it.exists() }
        ?: error("conformance fixture not found: $name")
    @Suppress("UNCHECKED_CAST")
    return Json.decode(file.readText()) as Map<String, Any?>
}

private fun counterIdFactory(): IdFactory {
    val counters = HashMap<String, Int>()
    return { prefix ->
        val n = (counters[prefix] ?: 0) + 1
        counters[prefix] = n
        "${prefix}_$n"
    }
}

private class ClockBox(var value: Long)

private fun dispatch(c: TrackiClient, call: String, args: List<Any?>) {
    @Suppress("UNCHECKED_CAST")
    fun props(i: Int): Map<String, Any?>? = if (args.size > i) args[i] as? Map<String, Any?> else null
    when (call) {
        "screen" -> c.screen(args[0] as String, props(1))
        "otp" -> c.otp(args[0] as String, props(1))
        "biometric" -> c.biometric(args[0] as String, props(1))
        "payment" -> c.payment(args[0] as String, props(1))
        "flow" -> c.flow(args[0] as String, args[1] as String, props(2))
        "track" -> c.track(args[0] as String, props(1))
        "identify" -> c.identify(args[0] as String)
        "deepLink" -> c.deepLink(args[0] as String, if (args.size > 1) args[1] as Boolean else true)
        "pushOpen" -> c.pushOpen(props(0))
        "backNav" -> c.backNav()
        "appForeground" -> c.appForeground(if (args.isEmpty()) "warm" else args[0] as String)
        "appBackground" -> c.appBackground()
        "error" -> c.error(args[0] as String)
        "permissionDenied" -> c.permissionDenied(args[0] as String)
        else -> error("unknown scripted call: $call")
    }
}

private suspend fun runJourney(
    scope: CoroutineScope,
    renderer: Renderer? = null,
): Pair<TrackiClient, CapturingTransport> {
    val journey = loadFixture("journey-batch.json")
    @Suppress("UNCHECKED_CAST")
    val config = journey["config"] as Map<String, Any?>
    @Suppress("UNCHECKED_CAST")
    val device = DeviceInfo.fromJson(config["device"] as Map<String, Any?>)
    val transport = CapturingTransport()
    val clock = ClockBox(1_700_000_000_000)

    val client = createTracki(
        TrackiConfig(
            key = config["key"] as String,
            endpoint = config["endpoint"] as String,
            device = device,
            storage = MemoryStorage(),
            locale = config["locale"] as? String,
            renderer = renderer,
            transport = transport,
            clock = { clock.value },
            idFactory = counterIdFactory(),
        ),
        scope = scope,
    )
    client.ready.await()

    @Suppress("UNCHECKED_CAST")
    val script = journey["script"] as List<Map<String, Any?>>
    for (step in script) {
        clock.value += 1000 // +1000ms before each step
        @Suppress("UNCHECKED_CAST")
        dispatch(client, step["call"] as String, step["args"] as List<Any?>)
    }
    client.flush()
    return client to transport
}

// ── Tests ────────────────────────────────────────────────────────────────────

class ConformanceTest {

    @Test
    fun pickVariantReplicatesJsHash() {
        // Known values computed from the TS reference logic:
        //   h = (h*31 + code)|0 over "anonId:actionId"; abs(h)%2 → A/B.
        assertEquals("A", pickVariant("anon_1", "act-1", false)) // hasB=false ⇒ A
        assertEquals("A", pickVariant("anon_1", "act-1", true))  // even hash
        assertEquals("B", pickVariant("anon_2", "act-1", true))  // odd hash
    }

    @Test
    fun producesExpectedEventsBatch() = runBlocking {
        val (_, transport) = runJourney(this)
        val batches = transport.posts.filter { it.url.endsWith("/v1/events") }
        assertEquals(1, batches.size)
        val journey = loadFixture("journey-batch.json")
        assertEquals(journey["expectedBatch"], batches[0].body)
    }

    @Test
    fun mintsExactWhatsAppHandoffBody() = runBlocking {
        val (client, transport) = runJourney(this)
        client.openWhatsApp()
        // Let the handoff coroutine settle.
        (coroutineContext[Job])?.children?.forEach { it.join() }
        val channels = loadFixture("channel-requests.json")
        @Suppress("UNCHECKED_CAST")
        val spec = channels["whatsappHandoff"] as Map<String, Any?>
        val handoff = transport.posts.firstOrNull { it.url.endsWith(spec["url"] as String) }
        assertNotNull(handoff)
        assertEquals(spec["body"], handoff!.body)
    }

    @Test
    fun sendsExactFirstChatTurn() = runBlocking {
        val renderer = ListRenderer()
        val (client, transport) = runJourney(this, renderer)
        client.openChat()
        val chat = renderer.intents.filterIsInstance<ChatIntent>().first()
        val channels = loadFixture("channel-requests.json")
        @Suppress("UNCHECKED_CAST")
        val spec = channels["chatFirstTurn"] as Map<String, Any?>
        chat.send(spec["messageUsed"] as String)
        val turn = transport.posts.firstOrNull { it.url.endsWith(spec["url"] as String) }
        assertNotNull(turn)
        assertEquals(spec["body"], turn!.body)
    }
}
