package com.agentworkspace.shared.model

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The names from before openspec proposal-and-discussion (`shared/schema/src/legacy.ts`). The logs
 * are append-only, so a reader maps each old name to its new name when it parses a line or a task
 * snapshot. A writer writes only the new names. Both ports test the map with
 * `contracts/fixtures/legacy/names.json`.
 */
object Legacy {
    /** Old event type → new event type. */
    val EVENT_TYPES: Map<String, String> = mapOf("approach.proposed" to "proposal.proposed")

    /** Old gate kind → new gate kind. */
    val GATE_KINDS: Map<String, String> = mapOf("confirm_approach" to "approve_proposal")

    /**
     * The event with the new names: the type of `approach.proposed`, and the kind of a `gate.opened`
     * `confirm_approach`. Other values come back unchanged (the same object).
     */
    fun upgradeEvent(value: JsonElement): JsonElement {
        if (value !is JsonObject) return value
        val oldType = value.string("type")
        val type = oldType?.let { EVENT_TYPES[it] }
        val data = value["data"] as? JsonObject
        val kind = if (oldType == "gate.opened") data?.string("kind")?.let { GATE_KINDS[it] } else null
        if (type == null && kind == null) return value
        val fields = LinkedHashMap(value)
        if (type != null) fields["type"] = JsonPrimitive(type)
        if (kind != null && data != null) {
            fields["data"] = JsonObject(LinkedHashMap(data).apply { put("kind", JsonPrimitive(kind)) })
        }
        return JsonObject(fields)
    }

    /**
     * The task snapshot with the field `proposal: {latest, approved}` (old snapshots have
     * `approach: {latest, confirmed}`). A snapshot that has `proposal` stays as it is.
     */
    fun upgradeTaskDocument(value: JsonElement): JsonElement {
        if (value !is JsonObject || value.string("kind") != "task") return value
        if ("approach" !in value || "proposal" in value) return value
        val fields = LinkedHashMap<String, JsonElement>()
        for ((key, item) in value) {
            if (key == "approach") fields["proposal"] = proposalOf(item) else fields[key] = item
        }
        return JsonObject(fields)
    }

    private fun proposalOf(approach: JsonElement): JsonElement {
        if (approach !is JsonObject) return approach
        val fields = LinkedHashMap<String, JsonElement>()
        for ((key, item) in approach) if (key != "confirmed") fields[key] = item
        fields["approved"] = approach["confirmed"] ?: JsonNull
        return JsonObject(fields)
    }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
}
