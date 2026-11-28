package com.agentworkspace.control

import com.agentworkspace.shared.files.WorkspaceFiles
import com.agentworkspace.shared.files.WorkspaceWriter
import com.agentworkspace.shared.model.AwJson
import com.agentworkspace.shared.model.DocumentException
import com.agentworkspace.shared.model.DocumentReader
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * One Web Push subscription of the phone for one computer (docs/phase-1.md 8.2): the UnifiedPush
 * endpoint, the RFC 8291 keys of the phone (`p256dh`, `auth`, base64url) and the VAPID public key
 * of the computer that the instance was registered with.
 */
data class PushSubscription(
    val computer: String,
    val endpoint: String,
    val p256dh: String,
    val auth: String,
    val vapidPublicKey: String,
    val distributor: String?,
    val updated: String,
)

/**
 * `tasks/devices/<phone>/push.yaml`: the push endpoints of the phone, one per computer. Only the
 * phone writes it (ownership rule `device-push`); the computer that owns a gate reads its own entry
 * to send the push (task-loop).
 */
data class PushFile(
    val device: String,
    val subscriptions: List<PushSubscription>,
) {
    /** Adds or replaces the subscription of a computer. The list stays sorted by computer. */
    fun with(subscription: PushSubscription): PushFile =
        copy(
            subscriptions =
                (
                    subscriptions.filter {
                        it.computer != subscription.computer
                    } + subscription
                ).sortedBy { it.computer },
        )

    fun without(computer: String): PushFile = copy(subscriptions = subscriptions.filter { it.computer != computer })

    /** The YAML text: block style, each text double-quoted (a JSON string is a valid YAML double-quoted scalar). */
    fun render(): String =
        buildString {
            append("# Push endpoints of this phone (docs/phase-1.md 8). Written by the phone only.\n")
            append("kind: push\n")
            append("schema: 1\n")
            append("device: ").append(quote(device)).append('\n')
            if (subscriptions.isEmpty()) {
                append("subscriptions: []\n")
                return@buildString
            }
            append("subscriptions:\n")
            for (s in subscriptions) {
                append("  - computer: ").append(quote(s.computer)).append('\n')
                append("    endpoint: ").append(quote(s.endpoint)).append('\n')
                append("    p256dh: ").append(quote(s.p256dh)).append('\n')
                append("    auth: ").append(quote(s.auth)).append('\n')
                append("    vapid_public_key: ").append(quote(s.vapidPublicKey)).append('\n')
                append("    distributor: ").append(s.distributor?.let(::quote) ?: "null").append('\n')
                append("    updated: ").append(quote(s.updated)).append('\n')
            }
        }

    companion object {
        fun path(device: String): String = "tasks/devices/$device/push.yaml"

        private fun quote(text: String): String = JsonPrimitive(text).toString()

        private fun JsonObject.text(key: String): String? =
            (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

        /** Reads the file. A missing or broken file gives an empty file of [device]: the phone writes it again. */
        fun read(
            files: WorkspaceFiles,
            device: String,
        ): PushFile {
            val text = files.readText(path(device)) ?: return PushFile(device, emptyList())
            val value =
                try {
                    DocumentReader.parseYaml(text) as? JsonObject
                } catch (_: DocumentException) {
                    null
                } ?: return PushFile(device, emptyList())
            val list =
                (value["subscriptions"] as? JsonArray).orEmpty().mapNotNull { item ->
                    val o = item as? JsonObject ?: return@mapNotNull null
                    PushSubscription(
                        computer = o.text("computer") ?: return@mapNotNull null,
                        endpoint = o.text("endpoint") ?: return@mapNotNull null,
                        p256dh = o.text("p256dh") ?: return@mapNotNull null,
                        auth = o.text("auth") ?: return@mapNotNull null,
                        vapidPublicKey = o.text("vapid_public_key") ?: return@mapNotNull null,
                        distributor = o.text("distributor"),
                        updated = o.text("updated").orEmpty(),
                    )
                }
            return PushFile(device, list.sortedBy { it.computer })
        }
    }
}

/** The push registrations of the phone: which computer gets which UnifiedPush instance. */
object PushRegistry {
    /** A VAPID public key: an uncompressed P-256 point, base64url with no padding (87 characters). */
    private val VAPID = Regex("^B[A-Za-z0-9_-]{86}$")

    /**
     * The VAPID public key of each computer, from the `vapid_public_key` of its `bindings.yaml`
     * (a loose key until task-loop adds it to the schema). A mobile device, a revoked device and a
     * key of a wrong form are left out.
     */
    fun vapidKeys(snapshot: WorkspaceSnapshot): Map<String, String> =
        snapshot.devices
            .filter { it.slug != snapshot.phone && it.role != "mobile" && !it.revoked }
            .mapNotNull { device ->
                val key = (snapshot.bindings[device.slug]?.get("vapid_public_key") as? JsonPrimitive)?.contentOrNull
                key?.takeIf { VAPID.matches(it) }?.let { device.slug to it }
            }.toMap()

    /** The instance name of a computer in one workspace: `<workspace>/<computer>`. */
    fun instance(
        workspace: String,
        computer: String,
    ): String = "$workspace/$computer"

    /** The workspace and the computer of an instance name, or null for an instance of another form. */
    fun parseInstance(instance: String): Pair<String, String>? {
        val parts = instance.split("/")
        return if (parts.size == 2 && parts.all { it.isNotEmpty() }) parts[0] to parts[1] else null
    }

    /**
     * The registration changes: the computers to register (new, or with a changed key) and the
     * instances to remove (a computer with no key any more).
     */
    fun plan(
        keys: Map<String, String>,
        current: PushFile,
    ): Pair<Map<String, String>, List<String>> {
        val register =
            keys.filter { (computer, key) ->
                current.subscriptions.none {
                    it.computer == computer &&
                        it.vapidPublicKey == key
                }
            }
        val remove = current.subscriptions.map { it.computer }.filter { it !in keys }
        return register to remove
    }

    /** Writes the file atomically. */
    fun write(
        files: WorkspaceWriter,
        file: PushFile,
    ) = files.writeAtomic(PushFile.path(file.device), file.render().encodeToByteArray())
}

/**
 * The decrypted preview of a gate push (docs/phase-1.md 8.3): the event id, the task, the task key,
 * the gate kind and one line, at most 3 KB.
 */
data class PushPreview(
    val event: String?,
    val task: String?,
    val key: String?,
    val gateKind: String?,
    val text: String,
    /** `gate`, `done`, `login_expired` or `login_ends` (gate-full-context, M23); null in an older push. */
    val kind: String? = null,
) {
    /** The notification title: "AW-7 · Answer question", "AW-12 · Done", "AW-12 · Login expired". */
    val title: String
        get() {
            // A card with high urgency (openspec inbox-mattermost): "Inbox · Question".
            if (kind == "inbox") return "Inbox · ${CATEGORIES[gateKind] ?: "Card"}"
            val label = KIND_LABELS[kind] ?: gateKind?.let(Texts::gateLabel) ?: "A gate needs you"
            return key?.let { "$it · $label" } ?: "AW · $label"
        }

    /** The notification id: the event id when the push has one, else the task. */
    val tag: String get() = event ?: task ?: "aw-push"

    companion object {
        const val MAX_BYTES = 3 * 1024

        /** The category of a card push (`gate_kind` of the preview). */
        private val CATEGORIES = mapOf("action" to "Action", "question" to "Question", "info" to "Info")

        /** The title of a push that is not about a gate. */
        private val KIND_LABELS =
            mapOf("done" to "Done", "login_expired" to "Login expired", "login_ends" to "Login ends soon")

        private fun JsonObject.text(key: String): String? =
            (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

        /** Reads a decrypted push. A push of an unknown form gives the generic preview. */
        fun parse(content: ByteArray): PushPreview {
            val generic = PushPreview(null, null, null, null, "Open AW to see it.")
            if (content.size > MAX_BYTES) return generic
            val value =
                try {
                    AwJson.parseToJsonElement(content.decodeToString()) as? JsonObject
                } catch (_: SerializationException) {
                    null
                } catch (_: IllegalArgumentException) {
                    null
                } ?: return generic
            return PushPreview(
                event = value.text("event"),
                task = value.text("task")?.takeIf { TASK_ID.matches(it) },
                key = value.text("key"),
                gateKind = value.text("gate_kind"),
                text = value.text("text") ?: generic.text,
                kind = value.text("kind"),
            )
        }

        private val TASK_ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    }
}

/**
 * The gate notifications to remove (verify-journeys low 15): the tag of a gate push is the event id of
 * its `gate.opened`. A notification whose gate is in [snapshot] and is no longer open goes away; a tag
 * that this snapshot does not know (another workspace, a done push) stays.
 */
object ResolvedNotifications {
    fun of(
        snapshot: WorkspaceSnapshot,
        tags: Collection<String>,
    ): List<String> {
        if (tags.isEmpty() || !snapshot.loaded) return emptyList()
        val closed =
            snapshot.tasks
                .flatMap { it.gates }
                .filter { it.state != "open" }
                .map { it.opened.event }
                .toSet()
        return tags.filter { it in closed }
    }
}
