package com.agentworkspace.control

import com.agentworkspace.shared.merge.EventRef
import com.agentworkspace.shared.merge.OrderKey
import com.agentworkspace.shared.merge.TaskView
import com.agentworkspace.shared.model.IsoTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.roundToLong

// The queue view of openspec queue-and-assign: the port of daemon/src/continuity/queue-view.ts. Both run
// contracts/fixtures/queue/cases.json, so the phone shows the same position and cause as awd.

/** The fields of a task that the queue rule reads. */
@Serializable
data class QueueTask(
    val id: String,
    val key: String?,
    val title: String?,
    val assignee: String?,
    val stage: String,
    val archived: Boolean,
    val created: EventRef?,
    @SerialName("claim_device") val claimDevice: String?,
    val session: QueueSession?,
    val paused: Boolean,
    @SerialName("open_gate") val openGate: Boolean,
    @SerialName("open_dependencies") val openDependencies: List<String>,
)

@Serializable
data class QueueSession(
    val device: String,
    val state: String,
)

/** The newest `queue.reordered` of an agent. */
@Serializable
data class QueueOrder(
    val agent: String,
    val tasks: List<String>,
)

/** A device: revoked, its presence (null when not known) and its last valid `health.yaml`. */
@Serializable
data class QueueDevice(
    val slug: String,
    val revoked: Boolean,
    val online: Boolean?,
    val health: JsonElement? = null,
)

@Serializable
data class QueueCause(
    val code: String,
    val text: String,
)

@Serializable
data class QueueEntry(
    val task: String,
    val key: String?,
    val title: String?,
    /** From 1; null for a task with open dependencies. */
    val position: Int?,
    /** "Queued · 2nd for claude@ubuntu-01". */
    val text: String,
    val cause: QueueCause,
)

@Serializable
data class AgentQueue(
    val agent: String,
    val device: String,
    @SerialName("max_working") val maxWorking: Int,
    val working: Int,
    val tasks: List<QueueEntry>,
)

/** The limits of a device from its health file, with the defaults. */
data class QueueLimits(
    val maxWorking: Int,
    val diskFullPercent: Double,
    val loginValid: Boolean?,
    val fiveHour: Double?,
    val disk: Double?,
)

/** The texts of the queue: ordinals and labels. */
object QueueTexts {
    private const val HUNDRED = 100
    private const val TEN = 10
    private val TEENS = 11..13

    /** English ordinals: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
    fun ordinal(n: Int): String {
        if (n % HUNDRED in TEENS) return "${n}th"
        val suffix =
            when (n % TEN) {
                1 -> "st"
                2 -> "nd"
                3 -> "rd"
                else -> "th"
            }
        return "$n$suffix"
    }

    /** "Queued · 2nd for claude@ubuntu-01", or "Queued for claude@ubuntu-01" with no position. */
    fun label(
        agent: String,
        position: Int?,
    ): String = if (position == null) "Queued for $agent" else "Queued · ${ordinal(position)} for $agent"

    fun sessions(n: Int): String = if (n == 1) "1 session working" else "$n sessions working"

    /** The fields of the task detail with the field "Queue" after the assignee, for a waiting task. */
    fun withQueue(
        fields: List<Pair<String, String>>,
        queue: QueueEntry?,
    ): List<Pair<String, String>> {
        if (queue == null) return fields
        val at = fields.indexOfFirst { it.first == "Assignee" } + 1
        return fields.take(at) + ("Queue" to "${queue.text} · ${queue.cause.text}") + fields.drop(at)
    }
}

/** The queue rule (design decisions 3 to 5 of openspec queue-and-assign). */
object QueueRules {
    const val DEFAULT_MAX_WORKING = 2
    const val DISK_FULL_PERCENT = 95.0
    const val USAGE_LIMIT = 90.0

    fun queueTask(task: TaskView): QueueTask =
        QueueTask(
            id = task.id,
            key = task.key,
            title = task.title,
            assignee = task.assignee,
            stage = task.stage,
            archived = task.archived,
            created = task.created,
            claimDevice = task.claim?.device,
            session = task.session?.let { QueueSession(it.device, it.state) },
            paused = task.paused != null,
            openGate = task.gates.any { it.state == "open" },
            openDependencies = task.openDependencies,
        )

    private fun split(assignee: String?): Pair<String, String>? {
        val at = assignee?.indexOf('@') ?: return null
        if (at <= 0 || at == assignee.length - 1) return null
        return assignee.substring(0, at) to assignee.substring(at + 1)
    }

    private fun active(task: QueueTask) = task.created != null && !task.archived && task.stage != "done"

    /** True when the task waits for a session: no claim on the device of its assignee. */
    fun isQueued(task: QueueTask): Boolean {
        val who = split(task.assignee) ?: return false
        return active(task) && task.claimDevice != who.second
    }

    /** The order of `queueOrder`: the newest `queue.reordered`, then the creation order. */
    fun order(
        tasks: List<QueueTask>,
        order: QueueOrder?,
    ): List<QueueTask> {
        val rank =
            order
                ?.tasks
                .orEmpty()
                .withIndex()
                .associate { it.value to it.index }
        return tasks.sortedWith { a, b ->
            val ra = rank[a.id]
            val rb = rank[b.id]
            when {
                ra != null && rb != null -> ra.compareTo(rb)
                ra != null -> -1
                rb != null -> 1
                else -> keyOf(a).compareTo(keyOf(b))
            }
        }
    }

    private fun keyOf(task: QueueTask): OrderKey =
        task.created?.let { OrderKey(it.hlc, it.dev, it.event) } ?: OrderKey("", "", task.id)

    /** The limits of a device from its health file; the defaults when the file or a field is missing. */
    fun limits(
        health: JsonElement?,
        nowMs: Long,
    ): QueueLimits {
        val doc = health as? JsonObject
        val queue = doc?.get("queue") as? JsonObject
        val fiveHour =
            (doc?.get("usage") as? JsonArray)
                .orEmpty()
                .mapNotNull { usage ->
                    val window = (usage as? JsonObject)?.get("five_hour") as? JsonObject
                    val used = number(window?.get("used_percentage"))
                    val resets = (window?.get("resets_at") as? JsonPrimitive)?.contentOrNull?.let(IsoTime::parseMillis)
                    // After the reset the stored percentage is old.
                    used?.takeIf { resets == null || resets > nowMs }
                }.maxOrNull()
        return QueueLimits(
            maxWorking = number(queue?.get("max_working"))?.toInt() ?: DEFAULT_MAX_WORKING,
            diskFullPercent = number(queue?.get("disk_full_percent")) ?: DISK_FULL_PERCENT,
            loginValid = (queue?.get("login_valid") as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull,
            fiveHour = fiveHour,
            disk = number((doc?.get("disk") as? JsonObject)?.get("used_percentage")),
        )
    }

    private fun number(value: JsonElement?): Double? = (value as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

    private fun cause(
        index: Int,
        agent: Pair<String, String>,
        device: QueueDevice?,
        limits: QueueLimits,
        working: Int,
    ): QueueCause {
        val (name, slug) = agent
        val fiveHour = limits.fiveHour
        val disk = limits.disk
        return when {
            device?.revoked == true -> {
                QueueCause("device_revoked", "$slug was revoked")
            }

            device?.online == false -> {
                QueueCause("device_offline", "$slug offline")
            }

            // The real count first, then the device blocks, then the projected count (fix list 0-45).
            working >= limits.maxWorking -> {
                QueueCause("max_working", QueueTexts.sessions(working))
            }

            limits.loginValid == false -> {
                QueueCause("login_ended", "login of $name ended")
            }

            fiveHour != null && fiveHour > USAGE_LIMIT -> {
                QueueCause("usage_limit", "5-hour usage at ${fiveHour.roundToLong()} %")
            }

            disk != null && disk >= limits.diskFullPercent -> {
                QueueCause("disk_full", "disk ${disk.roundToLong()} % full")
            }

            working + index >= limits.maxWorking -> {
                QueueCause("max_working", QueueTexts.sessions(minOf(working + index, limits.maxWorking)))
            }

            else -> {
                QueueCause("starting", "starts soon")
            }
        }
    }

    private fun working(
        tasks: List<QueueTask>,
        agent: String,
        device: String,
    ): Int =
        tasks.count { t ->
            active(t) && t.assignee == agent && t.claimDevice == device && t.session?.device == device &&
                t.session.state == "running" && !t.paused && !t.openGate
        }

    /** The queue of each agent that has a queued task, sorted by the agent. */
    fun agentQueues(
        tasks: List<QueueTask>,
        orders: List<QueueOrder>,
        devices: List<QueueDevice>,
        nowMs: Long,
    ): List<AgentQueue> {
        val byId = tasks.associateBy { it.id }
        val groups = tasks.filter(::isQueued).groupBy { it.assignee.orEmpty() }.toSortedMap()
        return groups.mapNotNull { (agent, members) ->
            val who = split(agent) ?: return@mapNotNull null
            val device = devices.firstOrNull { it.slug == who.second }
            val limits = limits(device?.health, nowMs)
            val working = working(tasks, agent, who.second)
            val ordered = order(members, orders.firstOrNull { it.agent == agent })
            val ready = ordered.filter { it.openDependencies.isEmpty() }
            val waiting = ordered.filter { it.openDependencies.isNotEmpty() }

            fun entry(
                task: QueueTask,
                position: Int?,
                cause: QueueCause,
            ) = QueueEntry(task.id, task.key, task.title, position, QueueTexts.label(agent, position), cause)
            val entries =
                ready.mapIndexed { i, t -> entry(t, i + 1, cause(i, who, device, limits, working)) } +
                    waiting.map { t ->
                        val keys = t.openDependencies.joinToString(", ") { byId[it]?.key ?: it.take(ID_PREFIX) }
                        entry(t, null, QueueCause("dependencies", "waits for $keys"))
                    }
            AgentQueue(agent, who.second, limits.maxWorking, working, entries)
        }
    }

    private const val ID_PREFIX = 8
}
