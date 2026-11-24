package com.agentworkspace.control

import com.agentworkspace.engine.PeerRecord
import com.agentworkspace.engine.PeerStore
import com.agentworkspace.identity.Encoding
import com.agentworkspace.identity.Records
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/** The identity of the phone after a pairing: the user id and the master public key (base64). */
data class PhoneIdentity(
    val user: String,
    val masterPublic: String,
)

/**
 * The identity files of the phone in its private storage (openspec add-android-pairing, design
 * decision 6): `identity.json`, `device-slug` (the engine name and the writer of the phone logs),
 * `records/<workspace>.json` (the signed records of the pairing response, until `tasks` syncs) and the
 * pairing folders `pairing/<nonce>/`.
 */
class PhoneIdentityStore(
    private val root: Path,
) {
    private val json = Json { prettyPrint = true }

    val identityFile: Path = root.resolve("identity.json")
    val slugFile: Path = root.resolve("device-slug")

    fun pairingDir(nonce: String): Path {
        require(NONCE.matches(nonce)) { "A pairing nonce has 32 hex characters" }
        return root.resolve("pairing").resolve(nonce)
    }

    private fun recordsFile(workspace: String): Path {
        require(WORKSPACE.matches(workspace)) { "The workspace id $workspace is not valid" }
        return root.resolve("records").resolve("$workspace.json")
    }

    fun identity(): PhoneIdentity? {
        if (!Files.isRegularFile(identityFile)) return null
        val o =
            runCatching {
                Json.parseToJsonElement(Files.readAllBytes(identityFile).decodeToString()) as? JsonObject
            }.getOrNull()
        val user = (o?.get("user") as? JsonPrimitive)?.contentOrNull ?: return null
        val master = (o["master_public"] as? JsonPrimitive)?.contentOrNull ?: return null
        return PhoneIdentity(user, master)
    }

    fun saveIdentity(identity: PhoneIdentity) =
        write(
            identityFile,
            json.encodeToString(
                JsonObject.serializer(),
                buildJsonObject {
                    put("kind", "aw-identity")
                    put("schema", 1)
                    put("user", identity.user)
                    put("master_public", identity.masterPublic)
                },
            ) + "\n",
        )

    /** The record check of the merge, or null before a pairing. */
    fun verifier(): ((JsonElement) -> Boolean)? =
        identity()?.let { id -> Encoding.fromBase64OrNull(id.masterPublic)?.let(Records::verifier) }

    /** The stored slug of the phone, or null before a pairing. */
    fun slug(): String? =
        runCatching {
            if (Files.isRegularFile(slugFile)) Files.readAllBytes(slugFile).decodeToString().trim() else null
        }.getOrNull()?.takeIf { SLUG.matches(it) }

    fun saveSlug(slug: String) {
        require(SLUG.matches(slug)) { "A device name is a slug, not $slug" }
        write(slugFile, slug)
    }

    fun saveRecords(
        workspace: String,
        records: List<JsonObject>,
    ) = write(recordsFile(workspace), JsonArray(records).toString() + "\n")

    /** The cached records of the pairing response of a workspace. */
    fun records(workspace: String): List<JsonObject> {
        val file = recordsFile(workspace)
        if (!Files.isRegularFile(file)) return emptyList()
        val array =
            runCatching {
                Json.parseToJsonElement(
                    Files.readAllBytes(file).decodeToString(),
                ) as? JsonArray
            }.getOrNull()
        return array.orEmpty().filterIsInstance<JsonObject>()
    }

    private fun write(
        file: Path,
        text: String,
    ) {
        Files.createDirectories(file.parent)
        val temp = file.resolveSibling("${file.fileName}.aw-new")
        Files.write(temp, text.encodeToByteArray())
        Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }

    companion object {
        val SLUG = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$")
        private val NONCE = Regex("^[0-9a-f]{32}$")
        private val WORKSPACE = Regex("^[A-Za-z0-9][A-Za-z0-9_-]*$")
    }
}

/**
 * The peers of the phone from the signed device records (docs/phase-1.md 6.2 and 7.5): each record
 * that is not revoked and is not this phone, with a valid sync device id; its addresses, or `dynamic`.
 * A device key or sync device id that any record revokes is no peer (openspec revoke-device), as on
 * awd: give the records of all workspaces in one call.
 */
object RecordPeers {
    private fun text(
        record: JsonObject,
        key: String,
    ): String? = (record[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun isRevoked(record: JsonObject): Boolean = (record["revoked"] as? JsonPrimitive)?.content == "true"

    private fun deviceKey(record: JsonObject): String? = (record["keys"] as? JsonObject)?.let { text(it, "ed25519") }

    fun of(
        records: List<JsonObject>,
        mySlug: String?,
    ): List<PeerRecord> {
        val revoked = records.filter(::isRevoked)
        val revokedKeys = revoked.mapNotNull(::deviceKey).toSet()
        val revokedIds = revoked.mapNotNull { text(it, "sync_device_id") }.toSet()
        return records
            .mapNotNull { record ->
                val slug = text(record, "slug") ?: return@mapNotNull null
                val sync = text(record, "sync_device_id") ?: return@mapNotNull null
                val kind = (record["kind"] as? JsonPrimitive)?.content
                if (kind != "device" || isRevoked(record) || slug == mySlug) return@mapNotNull null
                if (sync in revokedIds || deviceKey(record)?.let { it in revokedKeys } == true) return@mapNotNull null
                val addresses =
                    (record["addresses"] as? JsonArray)
                        ?.mapNotNull {
                            (it as? JsonPrimitive)
                                ?.takeIf { p ->
                                    p.isString
                                }?.content
                                ?.takeIf(String::isNotEmpty)
                        }.orEmpty()
                PeerRecord(slug, sync, text(record, "role") ?: "remote", addresses.ifEmpty { listOf("dynamic") })
                    .takeIf { PeerStore.problem(it) == null }
            }.distinctBy { it.syncId }
            .sortedBy { it.device }
    }

    /**
     * The peer list after a join: the [current] peers of the other workspaces and the peers of the
     * [records] of the new workspace. A record of the new workspace replaces a current peer with the
     * same slug or sync device id; a current peer that one of the records revokes goes away.
     */
    fun withWorkspace(
        current: List<PeerRecord>,
        records: List<JsonObject>,
        mySlug: String?,
    ): List<PeerRecord> {
        val fresh = of(records, mySlug)
        val revokedIds = records.filter(::isRevoked).mapNotNull { text(it, "sync_device_id") }.toSet()
        val kept =
            current.filter { old ->
                old.syncId !in revokedIds && fresh.none { it.syncId == old.syncId || it.device == old.device }
            }
        return (kept + fresh).sortedBy { it.device }
    }

    /**
     * The peer list over each workspace (the kept records of the index of a workspace, or its cached
     * pairing records while the index has none), or null when no workspace has a record yet: the
     * index is not loaded, so the peer list stays.
     */
    fun plan(
        perWorkspace: List<List<JsonObject>>,
        mySlug: String?,
    ): List<PeerRecord>? = if (perWorkspace.all { it.isEmpty() }) null else of(perWorkspace.flatten(), mySlug)
}
