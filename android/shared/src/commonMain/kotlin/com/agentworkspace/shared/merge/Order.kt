package com.agentworkspace.shared.merge

import com.agentworkspace.shared.model.AwEvent

/**
 * The merge order of events (docs/phase-1.md 3.6): the HLC text, then the device slug, then the event
 * id. Text order is the order of the UTF-16 code units, like the JavaScript `<` of `order.ts`.
 */
data class OrderKey(
    val hlc: String,
    val dev: String,
    val id: String,
) : Comparable<OrderKey> {
    override fun compareTo(other: OrderKey): Int = compareOrder(this, other)
}

fun compareOrder(
    a: OrderKey,
    b: OrderKey,
): Int =
    a.hlc.compareTo(b.hlc).takeIf { it != 0 }
        ?: a.dev.compareTo(b.dev).takeIf { it != 0 }
        ?: a.id.compareTo(b.id)

/** One event of a log file, with its place. */
class LogLine(
    val event: AwEvent,
    val path: String,
    val line: Int,
) {
    val key: OrderKey get() = OrderKey(event.hlc, event.dev, event.id)
    val known: Boolean get() = event.known
}

/** Sorts lines by the merge order. */
val byOrder: Comparator<LogLine> = Comparator { a, b -> compareOrder(a.key, b.key) }

/** The place of a line: a line with a smaller path, then a smaller line number, wins a duplicate id. */
fun comparePlace(
    a: LogLine,
    b: LogLine,
): Int = a.path.compareTo(b.path).takeIf { it != 0 } ?: a.line.compareTo(b.line)

fun refOf(event: AwEvent): EventRef = EventRef(event.id, event.dev, event.hlc)
