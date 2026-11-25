package com.agentworkspace.shared.merge

import com.agentworkspace.shared.FakeClock
import com.agentworkspace.shared.Fixtures
import com.agentworkspace.shared.SeededRandom
import com.agentworkspace.shared.model.AwJson
import com.agentworkspace.shared.model.IsoTime
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import kotlin.math.floor

private val DEVICES = listOf("macbook-pro", "ubuntu-01", "pixel-9")
private val KINDS = listOf("question", "approve_proposal", "approve_result")
private const val DAY_MS = 24 * 3600_000L

/** A UUIDv7 from a time in ms and random bits. */
fun uuid7(
    time: Long,
    random: java.util.Random,
): String {
    val hex = time.toString(16).padStart(12, '0')
    val rand = { n: Int -> (0 until n).joinToString("") { random.nextInt(16).toString(16) } }
    val variant = "89ab"[random.nextInt(4)]
    return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-7${rand(3)}-$variant${rand(3)}-${rand(12)}"
}

/** An HLC on 2026-11-22: `at("15:00:00")` is `2026-11-22T15:00:00.000Z#0000`. */
fun at(
    time: String,
    counter: Int = 0,
): String = "2026-11-22T$time.000Z#${counter.toString().padStart(4, '0')}"

/** A test event line as JSON. */
fun event(
    id: String,
    dev: String,
    type: String,
    hlc: String,
    data: JsonObject,
    task: String? = null,
    by: String? = null,
): JsonObject =
    buildJsonObject {
        put("v", 1)
        put("id", id)
        put("hlc", hlc)
        put("dev", dev)
        put("type", type)
        if (task != null) put("task", task)
        if (by != null) put("by", by)
        put("data", data)
    }

fun json(vararg pairs: Pair<String, Any?>): JsonObject =
    JsonObject(
        pairs.associate { (key, value) ->
            key to
                when (value) {
                    null -> JsonNull
                    is JsonElement -> value
                    is String -> JsonPrimitive(value)
                    is Number -> JsonPrimitive(value)
                    is Boolean -> JsonPrimitive(value)
                    is List<*> -> buildJsonArray { value.forEach { add(JsonPrimitive(it as String)) } }
                    else -> error("unsupported $value")
                }
        },
    )

/** The data of `task.created` with the defaults of the schema. */
fun createdData(
    key: String,
    parent: String? = null,
    assignee: String? = null,
): JsonObject =
    json(
        "key" to key,
        "project" to "billing-api",
        "title" to "Task $key",
        "first_message" to "/opsx:explore Task $key",
        "assignee" to assignee,
        "parent" to parent,
        "depends_on" to emptyList<String>(),
        "test_server" to null,
        "credentials" to emptyList<String>(),
        "links" to emptyList<String>(),
    )

/** A temp workspace folder: a copy of the fixture folder. */
class TestWorkspace(
    val root: Path = Fixtures.tempWorkspace(),
) {
    fun appendText(
        path: String,
        text: String,
    ) {
        val file = root.resolve(path)
        Files.createDirectories(file.parent)
        Files.writeString(file, text, StandardOpenOption.CREATE, StandardOpenOption.APPEND)
    }

    fun write(
        path: String,
        text: String,
    ) {
        val file = root.resolve(path)
        Files.createDirectories(file.parent)
        Files.writeString(file, text)
    }

    fun append(
        path: String,
        vararg events: JsonObject,
    ) = appendText(path, events.joinToString("") { "$it\n" })

    fun remove() = Fixtures.remove(root)
}

/**
 * Random but schema-valid events: the port of `random-events.ts`. The picks use the seeded generator
 * in the same order as the TypeScript test; the id bits come from a second generator with the seed.
 */
class RandomEvents(
    private val random: SeededRandom,
    private val clock: FakeClock,
    seed: Long,
) {
    private val idRandom = java.util.Random(seed)
    val tasks = mutableListOf(Fixtures.FIXTURE_TASK)
    private val gates = mutableListOf<String>()
    private val answers = mutableListOf<String>()

    /** The ids of the written events, for duplicate ids in other files. */
    val ids = mutableListOf<String>()

    fun <T> pick(items: List<T>): T = items[floor(random.next() * items.size).toInt()]

    fun int(
        min: Int,
        max: Int,
    ): Int = min + floor(random.next() * (max - min + 1)).toInt()

    /** An HLC up to 600 s before the local time; sometimes 2 days ahead (held back). */
    private fun hlc(): String {
        val ahead = if (random.next() < 0.04) 2 * DAY_MS else 0L
        val time = clock.now() - int(0, 600_000) + ahead
        return "${IsoTime.format(time)}#${int(0, 3).toString().padStart(4, '0')}"
    }

    fun id(): String = uuid7(clock.now(), idRandom)

    /** One random event (or a bad text) and the file it goes to. */
    @Suppress("CyclomaticComplexMethod", "LongMethod")
    fun next(): Pair<String, Any> {
        val dev = pick(DEVICES)
        val by = if (random.next() < 0.6) "human@$dev" else "claude@$dev"
        val hlc = hlc()
        val task = pick(tasks)

        fun taskPath(t: String) = "tasks/$t/log/$dev.jsonl"

        fun withTask(
            type: String,
            data: JsonObject,
            t: String = task,
            eventBy: String? = null,
        ): Pair<String, Any> = taskPath(t) to event(id(), dev, type, hlc, data, t, eventBy)
        return when (int(0, 21)) {
            0 -> {
                val id = id()
                tasks.add(id)
                val parent = if (random.next() < 0.3) pick(tasks.dropLast(1)) else null
                val assignee = if (random.next() < 0.5) "claude@${pick(DEVICES)}" else null
                taskPath(id) to
                    event(id(), dev, "task.created", hlc, createdData("AW-${int(7, 12)}", parent, assignee), id, by)
            }

            1 -> {
                withTask(
                    "task.claimed",
                    json(
                        "epoch" to int(1, 4),
                        "device" to (if (random.next() < 0.9) dev else "pixel-9"),
                        "session" to id(),
                        "based_on" to null,
                    ),
                )
            }

            2 -> {
                withTask(
                    "task.stage_changed",
                    json(
                        "from" to "backlog",
                        "to" to pick(listOf("discuss", "ready", "implement", "done")),
                    ),
                )
            }

            3 -> {
                val gate = if (random.next() < 0.5 || gates.isEmpty()) id() else pick(gates)
                gates.add(gate)
                withTask(
                    "gate.opened",
                    json(
                        "gate" to gate,
                        "kind" to pick(KINDS),
                        "version" to int(1, 2),
                        "title" to "Gate",
                        "text" to "",
                        "options" to emptyList<String>(),
                        "request_id" to null,
                        "file" to (if (random.next() < 0.5) "proposal/v1.md" else null),
                    ),
                )
            }

            4, 5 -> {
                val data =
                    json(
                        "gate" to (if (gates.isNotEmpty()) pick(gates) else id()),
                        "version" to int(1, 2),
                        "answer" to pick(listOf("confirm", "Wait", "100/min")),
                        "comment" to null,
                    )
                val e = event(id(), dev, "gate.answered", hlc, data, task, "human@$dev")
                answers.add((e["id"] as JsonPrimitive).content)
                taskPath(task) to e
            }

            6 -> {
                withTask(
                    "gate.resolved",
                    json(
                        "gate" to (if (gates.isNotEmpty()) pick(gates) else id()),
                        "version" to int(1, 2),
                        "answer_event" to (if (answers.isNotEmpty()) pick(answers) else null),
                        "answer" to "confirm",
                    ),
                )
            }

            7 -> {
                withTask("comment.added", json("text" to "comment ${int(0, 99)}"), eventBy = by)
            }

            8 -> {
                withTask(
                    "task.edited",
                    json("field" to pick(listOf("title", "first_message", "priority")), "value" to "v${int(0, 9)}"),
                    eventBy = by,
                )
            }

            9 -> {
                withTask("task.assigned", json("assignee" to "claude@${pick(DEVICES)}"), eventBy = by)
            }

            10 -> {
                withTask("task.rekeyed", json("from" to "AW-${int(7, 12)}", "to" to "AW-${int(13, 20)}"))
            }

            11 -> {
                withTask(
                    "task.paused",
                    json(
                        "cause" to "usage_limit",
                        "resumes_at" to null,
                        "next_step" to "Wait for the reset",
                        "needs_human" to (random.next() < 0.5),
                    ),
                )
            }

            12 -> {
                withTask("task.resumed", json())
            }

            13 -> {
                withTask(
                    "session.started",
                    json(
                        "session" to id(),
                        "host" to "tmux",
                        "cwd" to "/w",
                        "plugin_dir" to null,
                        "branch" to "aw/b${int(0, 9)}",
                        "credentials" to emptyList<String>(),
                        "pids" to json("pane" to null, "claude" to null, "pgid" to null),
                    ),
                )
            }

            14 -> {
                withTask("task.future_thing", json("x" to 1))
            }

            15 -> {
                "tasks/log/$dev.jsonl" to
                    event(
                        id(),
                        dev,
                        "queue.reordered",
                        hlc,
                        json(
                            "agent" to "claude@ubuntu-01",
                            "tasks" to listOf(pick(tasks)),
                        ),
                        by = by,
                    )
            }

            16 -> {
                val type = pick(listOf("slot.acquired", "slot.renewed", "slot.released", "slot.revoked"))
                val base =
                    arrayOf<Pair<String, Any?>>(
                        "resource" to "k3d",
                        "slot" to int(0, 1),
                        "fencing_token" to int(1, 5),
                    )
                val data =
                    when (type) {
                        "slot.acquired" -> json(*base, "ttl_ms" to 60_000, "task" to task, "session" to id())
                        "slot.renewed" -> json(*base, "ttl_ms" to 60_000)
                        "slot.revoked" -> json(*base, "reason" to "expired")
                        else -> json(*base)
                    }
                "tasks/log/$dev.jsonl" to event(id(), dev, type, hlc, data)
            }

            17 -> {
                "tasks/log/$dev.jsonl" to
                    event(
                        id(),
                        dev,
                        pick(listOf("credential.added", "credential.removed")),
                        hlc,
                        json("name" to pick(listOf("stripe-test", "github-bot"))),
                        by = by,
                    )
            }

            18 -> {
                "tasks/devices/$dev/heartbeat/2026-11-22.jsonl" to
                    event(id(), dev, "device.heartbeat", hlc, json("boot_time" to "2026-11-22T08:00:00.000Z"))
            }

            19 -> {
                taskPath(task) to "not json at all"
            }

            20 -> {
                withTask("message.agent", json("text" to "Done.", "session" to null), eventBy = "claude@$dev")
            }

            else -> {
                withTask("task.done", json())
            }
        }
    }
}

/**
 * Appends one round of random events (`appendRandomRound` of the TypeScript test): 1 to 12 lines,
 * sometimes a line twice, sometimes the id of an earlier event on another event, sometimes half a
 * line whose rest comes in the next round. Then it moves the clock.
 */
fun appendRandomRound(
    ws: TestWorkspace,
    gen: RandomEvents,
    random: SeededRandom,
    pending: MutableMap<String, String>,
    clock: FakeClock,
) {
    for ((path, rest) in pending) ws.appendText(path, rest)
    pending.clear()
    repeat(gen.int(1, 12)) {
        var (path, e) = gen.next()
        if (e is JsonObject) {
            if (gen.ids.isNotEmpty() && random.next() < 0.08) {
                e = JsonObject(e + ("id" to JsonPrimitive(gen.pick(gen.ids))))
            } else {
                gen.ids.add((e["id"] as JsonPrimitive).content)
            }
        }
        val line = "${if (e is JsonObject) AwJson.encodeToString(JsonObject.serializer(), e) else e}\n"
        ws.appendText(path, if (random.next() < 0.05) "$line$line" else line)
    }
    if (random.next() < 0.25) {
        val (path, e) = gen.next()
        if (e is JsonObject) {
            val text = "${AwJson.encodeToString(JsonObject.serializer(), e)}\n"
            val cut = gen.int(1, text.length - 2)
            ws.appendText(path, text.substring(0, cut))
            pending[path] = text.substring(cut)
        }
    }
    if (random.next() < 0.2) clock.advance(gen.int(0, 3) * DAY_MS) else clock.advance(gen.int(0, 60_000).toLong())
}
