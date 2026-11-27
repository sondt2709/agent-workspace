@file:OptIn(ExperimentalSerializationApi::class)

package com.agentworkspace.shared.merge

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

// The merged view of a workspace: `shared/core/src/merge/view.ts`. The JSON names are snake_case,
// so the JSON of a view equals the `expected.json` of the merge cases.

/** Where an event came from. */
@Serializable
data class EventRef(
    val event: String,
    val dev: String,
    val hlc: String,
)

/** One issue of the view: a bad line, a held line, a duplicate, an ignored event or a bad document. */
@Serializable
data class MergeIssue(
    /**
     * `bad_line`, `partial_tail`, `future_hlc`, `duplicate_event`, `ignored`, `unknown_type`, `bad_document`,
     * and `read_error`: a log or a document that cannot be read (awd and the phone go on with the others).
     */
    val code: String,
    val path: String,
    val line: Int?,
    val event: String?,
    val task: String?,
    val reason: String?,
    val message: String,
)

/** Why a task is in the "Needs you" lane (docs/workflow.md 3). */
@Serializable
@JsonClassDiscriminator("reason")
sealed interface NeedsYouReason {
    @Serializable
    @SerialName("gate")
    data class Gate(
        val gate: String,
        val kind: String,
        @SerialName("waiting_for_owner") val waitingForOwner: Boolean,
    ) : NeedsYouReason

    @Serializable
    @SerialName("assign")
    data object Assign : NeedsYouReason

    @Serializable
    @SerialName("paused")
    data class Paused(
        val cause: String,
    ) : NeedsYouReason
}

@Serializable
data class AnswerView(
    val event: String,
    val dev: String,
    val hlc: String,
    val by: String?,
    val version: Long,
    val answer: String,
    val comment: String?,
    /** `pending` until the gate is resolved; `used` for the answer of the resolution; else `comment`. */
    val use: String,
)

@Serializable
data class GateView(
    val gate: String,
    val kind: String,
    val version: Long,
    val title: String,
    val options: List<String>,
    val file: String?,
    val opened: EventRef,
    val state: String,
    val answer: String?,
    @SerialName("answer_event") val answerEvent: String?,
    @SerialName("resolved_by") val resolvedBy: String?,
    val answers: List<AnswerView>,
)

@Serializable
data class CommentView(
    val event: String,
    val dev: String,
    val hlc: String,
    val by: String?,
    val text: String,
    /** `comment` for `comment.added`; `late_answer` for a gate answer that became a comment. */
    val source: String,
    val gate: String?,
)

@Serializable
data class PauseView(
    val cause: String,
    val since: String,
    @SerialName("resumes_at") val resumesAt: String?,
    @SerialName("next_step") val nextStep: String,
    @SerialName("needs_human") val needsHuman: Boolean,
)

@Serializable
data class ClaimView(
    val epoch: Long,
    val device: String,
    val session: String,
    val event: String,
)

@Serializable
data class SessionView(
    val session: String,
    val device: String,
    val host: String,
    val state: String,
    val reason: String?,
    /** The working folder on the session device (`session.started`), or null for an older event. */
    val cwd: String? = null,
    /** The branch of the session, or null (a session in another folder has none). */
    val branch: String? = null,
    /** The options of the session (openspec session-options), or null for an older event. */
    @SerialName("permission_mode") val permissionMode: String? = null,
    @SerialName("agent_teams") val agentTeams: Boolean? = null,
    @SerialName("work_in") val workIn: String? = null,
    /** The link to the agent session and its terminal (openspec agent-pushes-updates), or null. */
    val name: String? = null,
    val terminal: TerminalView? = null,
    val pid: Long? = null,
)

/** The window and pane of the session host (openspec agent-pushes-updates). */
@Serializable
data class TerminalView(
    val window: String?,
    val pane: String?,
)

/** The session options of a task, as a person set them (openspec session-options). */
@Serializable
data class SessionOptionsView(
    /** Null: the project default. */
    @SerialName("permission_mode") val permissionMode: String?,
    @SerialName("agent_teams") val agentTeams: Boolean,
    @SerialName("work_in") val workIn: String,
    /** The absolute folder of `work_in: folder`, else null. */
    val folder: String?,
    /** `work_in: checkout`: false keeps the branch of the checkout. */
    @SerialName("switch_branch") val switchBranch: Boolean = true,
)

/**
 * The last failed start of the session of a task (openspec restart-agent): the `start_failed`
 * comment of awd. [retrying] is true after a newer person assignment ("Restart agent").
 */
@Serializable
data class StartFailureView(
    val device: String,
    val text: String,
    /** The HLC of the comment. */
    val at: String,
    val retrying: Boolean,
)

@Serializable
data class ProposalView(
    val latest: Long,
    val approved: Long?,
)

@Serializable
data class ReadyView(
    @SerialName("passed_on") val passedOn: String?,
    val missing: List<String>,
)

@Serializable
data class TaskView(
    val id: String,
    val key: String?,
    @SerialName("created_key") val createdKey: String?,
    @SerialName("key_state") val keyState: String,
    @SerialName("rekey_by") val rekeyBy: String?,
    val project: String?,
    val title: String?,
    @SerialName("first_message") val firstMessage: String?,
    val priority: String?,
    val stage: String,
    @SerialName("needs_you") val needsYou: List<String>,
    @SerialName("needs_you_reasons") val needsYouReasons: List<NeedsYouReason>,
    @SerialName("needs_you_lane") val needsYouLane: Boolean,
    val paused: PauseView?,
    val assignee: String?,
    val owner: String?,
    val created: EventRef?,
    /** The actor of `task.created` (`human@…` for a person), or null. */
    @SerialName("created_by") val createdBy: String? = null,
    /** The session options of the newest event of a person that set them, or null. */
    @SerialName("session_options") val sessionOptions: SessionOptionsView? = null,
    /** The last failed start, until a newer claim (openspec restart-agent). */
    @SerialName("start_failure") val startFailure: StartFailureView? = null,
    val claim: ClaimView?,
    @SerialName("moving_to") val movingTo: String?,
    @SerialName("released_epoch") val releasedEpoch: Long?,
    val proposal: ProposalView,
    val ready: ReadyView?,
    @SerialName("test_server") val testServer: String?,
    val credentials: List<String>,
    val parent: String?,
    val subtasks: List<String>,
    @SerialName("depends_on") val dependsOn: List<String>,
    @SerialName("open_dependencies") val openDependencies: List<String>,
    val links: List<String>,
    val branch: String?,
    val session: SessionView?,
    val progress: String?,
    val result: String?,
    val artifacts: List<String>,
    val learned: Boolean,
    val archived: Boolean,
    val gates: List<GateView>,
    val comments: List<CommentView>,
    val includes: Map<String, Long>,
    @SerialName("last_hlc") val lastHlc: String?,
    @SerialName("event_count") val eventCount: Int,
)

/** A project: the fields of `project.yaml` (with defaults and unknown keys) and the ids of its tasks. */
@Serializable(with = ProjectViewSerializer::class)
data class ProjectView(
    val document: JsonObject,
    val tasks: List<String>,
) {
    val slug: String get() = document.getValue("slug").jsonPrimitive.content

    /** An archived project gets no new tasks (`archived`, default false). */
    val archived: Boolean get() = (document["archived"] as? JsonPrimitive)?.booleanOrNull ?: false

    /** The default permission mode of new sessions (`permission_mode`, missing: `skip`, polish-skip-default). */
    val permissionMode: String
        get() = (document["permission_mode"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "skip"

    /** The HLC of the add after a remove (`added_at`), or null (openspec project-remove). */
    val addedAt: String?
        get() = (document["added_at"] as? JsonPrimitive)?.takeIf { it.isString }?.content
}

/** The event of a removal: the ref and the person (openspec project-remove). */
@Serializable
data class RemovalRef(
    val event: String,
    val dev: String,
    val hlc: String,
    val by: String,
)

/** One `project.removed` of a person: the slug, the name and the `project.yaml` at the remove. */
@Serializable
data class RemovedProjectView(
    val slug: String,
    val name: String,
    val removed: RemovalRef,
    val document: JsonObject,
)

/** Writes a project view as one object: `{...project, tasks}`, like the TypeScript view. */
object ProjectViewSerializer : KSerializer<ProjectView> {
    override val descriptor: SerialDescriptor = JsonObject.serializer().descriptor

    override fun serialize(
        encoder: Encoder,
        value: ProjectView,
    ) {
        val tasks = JsonArray(value.tasks.map { JsonPrimitive(it) })
        encoder.encodeSerializableValue(JsonObject.serializer(), JsonObject(value.document + ("tasks" to tasks)))
    }

    override fun deserialize(decoder: Decoder): ProjectView {
        val json = decoder.decodeSerializableValue(JsonObject.serializer())
        val tasks = json["tasks"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
        return ProjectView(JsonObject(json - "tasks"), tasks)
    }
}

@Serializable
data class DeviceHealthView(
    val updated: String,
    @SerialName("boot_time") val bootTime: String,
    @SerialName("disk_used_percentage") val diskUsedPercentage: Double,
)

@Serializable
data class DeviceHeartbeatView(
    @SerialName("last_hlc") val lastHlc: String,
    @SerialName("boot_time") val bootTime: String,
    val count: Int,
)

@Serializable
data class DeviceView(
    val slug: String,
    val name: String?,
    val role: String?,
    val revoked: Boolean,
    /** 0 is the highest priority. */
    val priority: Int,
    @SerialName("may_run") val mayRun: Boolean?,
    val resources: Map<String, Long>,
    val health: DeviceHealthView?,
    val heartbeat: DeviceHeartbeatView?,
)

@Serializable
data class CredentialView(
    val name: String,
    val added: EventRef?,
    @SerialName("imported_on") val importedOn: List<String>,
)

@Serializable
data class QueueView(
    val event: String,
    val dev: String,
    val hlc: String,
    val agent: String,
    val tasks: List<String>,
)

@Serializable
data class SlotView(
    val device: String,
    val resource: String,
    val slot: Long,
    @SerialName("fencing_token") val fencingToken: Long,
    @SerialName("ttl_ms") val ttlMs: Long,
    val task: String,
    val session: String,
    val acquired: EventRef,
    @SerialName("renewed_hlc") val renewedHlc: String,
    @SerialName("expires_at") val expiresAt: String,
)

/** The merged view. It depends only on the files and the local time of the HLC bound. */
@Serializable
data class WorkspaceView(
    val workspace: JsonObject?,
    val credentials: List<CredentialView>,
    /** The live projects: a removed project is in `removedProjects`. */
    val projects: List<ProjectView>,
    /** The tasks of the live projects (and the tasks with no project yet). */
    val tasks: List<TaskView>,
    /** Each removal of a project by a person, in merge order (openspec project-remove). */
    @SerialName("removed_projects") val removedProjects: List<RemovedProjectView> = emptyList(),
    /** The tasks that a removal took out of `tasks`, by id. AW keeps their files. */
    @SerialName("removed_tasks") val removedTasks: List<TaskView> = emptyList(),
    val devices: List<DeviceView>,
    val queues: List<QueueView>,
    val slots: List<SlotView>,
    val issues: List<MergeIssue>,
    @SerialName("last_hlc") val lastHlc: String?,
)

@Serializable
data class DevicePresence(
    val device: String,
    val online: Boolean,
    @SerialName("last_heartbeat_hlc") val lastHeartbeatHlc: String?,
    @SerialName("received_at") val receivedAt: String?,
    @SerialName("offline_since") val offlineSince: String?,
)

@Serializable
data class OfflineTask(
    val task: String,
    val device: String,
    val cause: String,
    val since: String,
)

/** Presence: it depends on the local receive times of the heartbeats (docs/phase-1.md 9.6.3). */
@Serializable
data class PresenceView(
    val now: String,
    val devices: List<DevicePresence>,
    @SerialName("offline_tasks") val offlineTasks: List<OfflineTask>,
)
