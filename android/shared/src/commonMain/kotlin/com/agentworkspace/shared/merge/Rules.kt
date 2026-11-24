package com.agentworkspace.shared.merge

import com.agentworkspace.shared.model.Hlc
import com.agentworkspace.shared.model.IsoTime
import com.agentworkspace.shared.model.MAX_SAFE_INTEGER

// Device priority, task keys and presence: `priority.ts`, `keys.ts` and `presence.ts` of
// shared/core/src/merge.

private val ROLE_RANK = mapOf("local" to 0, "remote" to 1, "mobile" to 2)
private const val NO_ROLE_RANK = 3

/** The roles of the devices (`device.yaml`) and `workspace.yaml` `device_order`. */
data class PriorityInput(
    val roles: Map<String, String>,
    val order: List<String>,
)

/** Sorts device slugs from the highest priority to the lowest: local > remote (in order) > mobile. */
fun sortByPriority(
    devices: Iterable<String>,
    input: PriorityInput,
): List<String> {
    fun position(slug: String): Int = input.order.indexOf(slug).let { if (it == -1) Int.MAX_VALUE else it }

    fun role(slug: String): Int = input.roles[slug]?.let { ROLE_RANK[it] } ?: NO_ROLE_RANK
    return devices.distinct().sortedWith(
        compareBy<String>({ role(it) }, { position(it) }).thenComparator { a, b -> a.compareTo(b) },
    )
}

/** A function that gives the rank of a device: 0 is the highest priority. */
fun priorityRank(
    devices: Iterable<String>,
    input: PriorityInput,
): (String) -> Int {
    val sorted = sortByPriority(devices, input)
    val ranks = sorted.withIndex().associate { (index, slug) -> slug to index }
    return { slug -> ranks[slug] ?: sorted.size }
}

/** The task with the higher-priority creating device keeps a key; the others are `duplicate`. */
fun markDuplicateKeys(
    tasks: List<TaskView>,
    rank: (String) -> Int,
): List<TaskView> {
    val groups = LinkedHashMap<String, MutableList<TaskView>>()
    for (task in tasks) {
        if (task.key != null && task.created != null) groups.getOrPut(task.key) { mutableListOf() }.add(task)
    }
    val duplicates = HashMap<String, String>()
    for (group in groups.values) {
        if (group.size < 2) continue
        val sorted =
            group.sortedWith { a, b ->
                val x = checkNotNull(a.created)
                val y = checkNotNull(b.created)
                (rank(x.dev) - rank(y.dev)).takeIf { it != 0 }
                    ?: compareOrder(OrderKey(x.hlc, x.dev, x.event), OrderKey(y.hlc, y.dev, y.event))
            }
        for (task in sorted.drop(1)) duplicates[task.id] = checkNotNull(task.created).dev
    }
    return tasks.map { task ->
        val by = duplicates[task.id]
        task.copy(keyState = if (by == null) "ok" else "duplicate", rekeyBy = by)
    }
}

private fun keyNumber(
    key: String?,
    prefix: String,
): Long? {
    if (key == null || !key.startsWith("$prefix-")) return null
    // Only a safe integer of JavaScript counts, as in TypeScript.
    return key.substring(prefix.length + 1).toLongOrNull()?.takeIf { it in 0..MAX_SAFE_INTEGER }
}

/**
 * True when the project is live (openspec project-remove): no person removed its slug, or a person added it
 * again after the newest removal (`added_at` sorts after the HLC of the removal).
 */
fun isLiveProject(
    addedAt: String?,
    removal: RemovedProjectView?,
): Boolean = removal == null || (addedAt != null && addedAt > removal.removed.hlc)

/**
 * The next free key that the view knows: 1 above each number of the keys and the created keys. Give the
 * removed tasks too, so no new task gets the key and the branch of a removed task (openspec project-remove).
 */
fun nextFreeKey(
    tasks: List<TaskView>,
    prefix: String,
): String {
    var highest = 0L
    for (task in tasks) {
        for (key in listOf(task.key, task.createdKey)) {
            val number = keyNumber(key, prefix)
            if (number != null && number > highest) highest = number
        }
    }
    return "$prefix-${highest + 1}"
}

/** One `task.rekeyed` that a device must write: `rekeyPlan` of `keys.ts`. */
data class RekeyItem(
    val task: String,
    val from: String,
    val to: String,
)

/**
 * The rekeys that [device] must write (docs/architecture.md 4.3.3 item 3): one item for each task with
 * `key_state: duplicate` and `rekey_by: device`, in the order of their `task.created` events. The
 * first new key is the next free key, and each next item adds 1. It equals `rekeyPlan` of TypeScript
 * (contracts/fixtures/merge/task-key-collision/rekeys.json).
 */
fun rekeyPlan(
    tasks: List<TaskView>,
    prefix: String,
    device: String,
): List<RekeyItem> {
    val own =
        tasks
            .filter { it.keyState == "duplicate" && it.rekeyBy == device && it.key != null && it.created != null }
            .sortedWith { a, b ->
                val x = checkNotNull(a.created)
                val y = checkNotNull(b.created)
                compareOrder(OrderKey(x.hlc, x.dev, x.event), OrderKey(y.hlc, y.dev, y.event))
            }
    if (own.isEmpty()) return emptyList()
    val first = checkNotNull(keyNumber(nextFreeKey(tasks, prefix), prefix))
    return own.mapIndexed { index, task -> RekeyItem(task.id, checkNotNull(task.key), "$prefix-${first + index}") }
}

/**
 * A device is offline after 90 s with no new heartbeat. Its tasks wait: presence never opens a gate
 * or moves a task (docs/decisions/2026-11-23-manual-move.md).
 */
const val OFFLINE_AFTER_MS = 90_000L

/** The last heartbeat of a device that this device received, and the local time of the receipt. */
data class Receipt(
    val hlc: String,
    val receivedAt: Long,
)

/**
 * Updates the receipts from the last heartbeat HLC of each device. The first receipt of a device uses
 * the earlier of the local time and the HLC time. A later, newer heartbeat uses the local time.
 */
fun updateReceipts(
    receipts: MutableMap<String, Receipt>,
    lastHeartbeats: Map<String, String>,
    now: Long,
) {
    for ((device, hlc) in lastHeartbeats) {
        val old = receipts[device]
        if (old == null) {
            receipts[device] = Receipt(hlc, minOf(now, Hlc.millis(hlc)))
        } else if (hlc > old.hlc) {
            receipts[device] = Receipt(hlc, now)
        }
    }
}

/** The device of a task for the presence: the device of the assignee, else of the claim. */
private fun workDevice(task: TaskView): String? {
    val assignee = task.assignee
    val at = assignee?.lastIndexOf('@') ?: -1
    return if (assignee != null && at >= 0) assignee.substring(at + 1) else task.claim?.device
}

/**
 * The presence layer of a view at the local time `now`. `revokedAt` gives the `revoked_at` HLC of a
 * revoked device: its tasks show `device_revoked` (docs/phase-1.md 6.8.2), also over their own pause.
 */
fun presenceOf(
    devices: List<DeviceView>,
    tasks: List<TaskView>,
    receipts: Map<String, Receipt>,
    now: Long,
    revokedAt: (String) -> String? = { null },
): PresenceView {
    val presence =
        devices
            .map { device ->
                val receipt = receipts[device.slug]
                if (receipt == null) {
                    DevicePresence(device.slug, false, null, null, null)
                } else {
                    val online = now - receipt.receivedAt <= OFFLINE_AFTER_MS
                    DevicePresence(
                        device = device.slug,
                        online = online,
                        lastHeartbeatHlc = receipt.hlc,
                        receivedAt = IsoTime.format(receipt.receivedAt),
                        offlineSince = if (online) null else IsoTime.format(receipt.receivedAt + OFFLINE_AFTER_MS),
                    )
                }
            }.sortedBy { it.device }
    val offline = presence.mapNotNull { p -> p.offlineSince?.let { p.device to it } }.toMap()
    val revoked = devices.filter { it.revoked }.map { it.slug }.toSet()
    val offlineTasks =
        tasks
            .mapNotNull { task ->
                if (task.stage == "done" || task.archived) return@mapNotNull null
                val device = workDevice(task)
                if (device != null && device in revoked) {
                    val at = revokedAt(device)?.let(Hlc::timeOf) ?: now
                    return@mapNotNull OfflineTask(task.id, device, "device_revoked", IsoTime.format(at))
                }
                val claim = task.claim ?: return@mapNotNull null
                // The person moved the task away from a revoked device: the new device claims it.
                if (claim.device in revoked) return@mapNotNull null
                val since = offline[claim.device] ?: return@mapNotNull null
                if (task.owner != claim.device) return@mapNotNull null
                if (task.paused != null) return@mapNotNull null
                OfflineTask(
                    task = task.id,
                    device = claim.device,
                    cause = "device_offline",
                    since = since,
                )
            }.sortedBy { it.task }
    return PresenceView(IsoTime.format(now), presence, offlineTasks)
}
