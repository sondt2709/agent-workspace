package com.agentworkspace.shared.merge

import com.agentworkspace.schema.CredentialAddedV1
import com.agentworkspace.schema.CredentialImportedV1
import com.agentworkspace.schema.CredentialRemovedV1
import com.agentworkspace.schema.EventDataV1
import com.agentworkspace.schema.ProjectRemovedV1
import com.agentworkspace.schema.QueueReorderedV1
import com.agentworkspace.schema.SlotAcquiredV1
import com.agentworkspace.schema.SlotReleasedV1
import com.agentworkspace.schema.SlotRenewedV1
import com.agentworkspace.schema.SlotRevokedV1
import com.agentworkspace.shared.model.AwEvent
import com.agentworkspace.shared.model.Hlc
import com.agentworkspace.shared.model.IsoTime
import kotlinx.serialization.json.JsonObject

/** The result of the fold for one event: applied or not, and why. */
data class Decision(
    val applied: Boolean,
    /** For a rejected event, the rule; for an applied event with a change of meaning, a note. */
    val reason: String?,
) {
    companion object {
        val OK = Decision(true, null)

        fun reject(reason: String) = Decision(false, reason)
    }
}

/** The fold of the workspace logs: queues, slot leases and credential names (`workspace.ts`). */
class WorkspaceFold(
    val queues: List<QueueView>,
    val slots: List<SlotView>,
    val credentials: List<CredentialView>,
    val decisions: Map<String, Decision>,
    /** Each `project.removed` of a person, in merge order. */
    val removals: List<RemovedProjectView> = emptyList(),
) {
    companion object {
        val EMPTY = WorkspaceFold(emptyList(), emptyList(), emptyList(), emptyMap())
    }
}

/**
 * Folds the workspace events. The caller gives them in merge order. `resources` reads `bindings.yaml`;
 * `revokedAt` gives the revoke HLC of a revoked device.
 */
fun foldWorkspace(
    lines: List<LogLine>,
    revokedAt: (String) -> String? = { null },
    resources: (String) -> Map<String, Long>?,
): WorkspaceFold {
    val queues = HashMap<String, QueueView>()
    val credentials = Credentials()
    val slots = SlotLeases(resources)
    val decisions = HashMap<String, Decision>()
    val removals = ArrayList<RemovedProjectView>()
    for (line in lines) {
        val e = line.event
        if (isAfterRevoke(e, revokedAt)) {
            decisions[e.id] = Decision.reject("device_revoked")
            continue
        }
        decisions[e.id] =
            when (val data = e.data) {
                null -> {
                    Decision.reject("unknown_type")
                }

                is QueueReorderedV1 -> {
                    // The newest order wins (docs/architecture.md 4.6.8).
                    queues[data.agent] = QueueView(e.id, e.dev, e.hlc, data.agent, data.tasks)
                    Decision.OK
                }

                is CredentialAddedV1, is CredentialImportedV1, is CredentialRemovedV1 -> {
                    credentials.apply(e, data)
                }

                is SlotAcquiredV1, is SlotRenewedV1, is SlotReleasedV1, is SlotRevokedV1 -> {
                    slots.apply(e, data)
                }

                is ProjectRemovedV1 -> {
                    // Only a person removes a project (principle 4, openspec project-remove).
                    val by = e.by
                    if (by == null || !isHuman(by)) {
                        Decision.reject("not_human")
                    } else {
                        // The document with the defaults of its schema, as the zod output.
                        val document = (e.json["data"] as JsonObject)["document"] as JsonObject
                        removals.add(
                            RemovedProjectView(data.project, data.name, RemovalRef(e.id, e.dev, e.hlc, by), document),
                        )
                        Decision.OK
                    }
                }

                else -> {
                    Decision.reject("wrong_log")
                }
            }
    }
    return WorkspaceFold(
        queues = queues.values.sortedBy { it.agent },
        slots = slots.views(),
        credentials = credentials.views(),
        decisions = decisions,
        removals = removals,
    )
}

/** The credential names: added, imported on a computer, removed. */
private class Credentials {
    private val entries = HashMap<String, CredentialView>()

    fun apply(
        e: AwEvent,
        data: EventDataV1,
    ): Decision {
        when (data) {
            is CredentialAddedV1 -> {
                entries[data.name] =
                    CredentialView(data.name, refOf(e), entries[data.name]?.importedOn.orEmpty())
            }

            is CredentialImportedV1 -> {
                val entry = entries[data.name] ?: CredentialView(data.name, null, emptyList())
                entries[data.name] =
                    if (e.dev in
                        entry.importedOn
                    ) {
                        entry
                    } else {
                        entry.copy(importedOn = (entry.importedOn + e.dev).sorted())
                    }
            }

            is CredentialRemovedV1 -> {
                entries.remove(data.name)
            }

            else -> {
                return Decision.reject("wrong_log")
            }
        }
        return Decision.OK
    }

    fun views(): List<CredentialView> = entries.values.sortedBy { it.name }
}

/** The test slot leases (docs/architecture.md 4.7): only the device of the resource gives out a lease. */
private class SlotLeases(
    private val resources: (String) -> Map<String, Long>?,
) {
    private val leases = HashMap<String, SlotView>()

    /** The highest fencing token of each slot: a token never goes back. */
    private val tokens = HashMap<String, Long>()

    private fun problem(
        dev: String,
        resource: String,
        slot: Long,
    ): String? {
        val capacity = resources(dev)?.get(resource) ?: return "not_resource_device"
        return if (slot >= capacity) "no_such_slot" else null
    }

    fun apply(
        e: AwEvent,
        data: EventDataV1,
    ): Decision =
        when (data) {
            is SlotAcquiredV1 -> {
                acquire(e, data)
            }

            is SlotRenewedV1 -> {
                change(e.dev, data.resource, data.slot, data.fencingToken) { id, lease ->
                    leases[id] =
                        lease.copy(ttlMs = data.ttlMs, renewedHlc = e.hlc, expiresAt = expiry(e.hlc, data.ttlMs))
                }
            }

            is SlotReleasedV1 -> {
                change(e.dev, data.resource, data.slot, data.fencingToken) { id, _ -> leases.remove(id) }
            }

            is SlotRevokedV1 -> {
                change(e.dev, data.resource, data.slot, data.fencingToken) { id, _ -> leases.remove(id) }
            }

            else -> {
                Decision.reject("wrong_log")
            }
        }

    private fun acquire(
        e: AwEvent,
        data: SlotAcquiredV1,
    ): Decision {
        problem(e.dev, data.resource, data.slot)?.let { return Decision.reject(it) }
        val id = "${e.dev}/${data.resource}/${data.slot}"
        if (data.fencingToken <= (tokens[id] ?: 0L)) return Decision.reject("stale_fencing_token")
        tokens[id] = data.fencingToken
        leases[id] =
            SlotView(
                device = e.dev,
                resource = data.resource,
                slot = data.slot,
                fencingToken = data.fencingToken,
                ttlMs = data.ttlMs,
                task = data.task,
                session = data.session,
                acquired = refOf(e),
                renewedHlc = e.hlc,
                expiresAt = expiry(e.hlc, data.ttlMs),
            )
        return Decision.OK
    }

    /** A renew, a release or a revoke of a lease: only for the current token. */
    private inline fun change(
        dev: String,
        resource: String,
        slot: Long,
        token: Long,
        apply: (String, SlotView) -> Unit,
    ): Decision {
        problem(dev, resource, slot)?.let { return Decision.reject(it) }
        val id = "$dev/$resource/$slot"
        val current = leases[id]
        if (current == null || current.fencingToken != token) return Decision.reject("no_such_lease")
        apply(id, current)
        return Decision.OK
    }

    /** The renew time plus the TTL, by the HLC time. The resource device decides the real expiry. */
    private fun expiry(
        hlc: String,
        ttlMs: Long,
    ): String = IsoTime.format(Hlc.millis(hlc) + ttlMs)

    fun views(): List<SlotView> =
        leases.values.sortedWith(
            compareBy<SlotView>({
                it.device
            }, { it.resource }).thenBy { it.slot },
        )
}
