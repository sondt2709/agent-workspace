package com.agentworkspace.engine

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readText

/** A peer record that is not valid, or that clashes with this device or another peer. */
class PeerInputException(
    message: String,
) : Exception(message)

@Serializable
private data class PeersFile(
    val peers: List<PeerRecord>,
)

/**
 * The peer list of the phone: `<filesDir>/sync-peers.json` (mode 0600), the format of awd
 * (`plugins/sync-syncthing/src/peers.ts`). identity-pairing replaces it with the signed device records.
 */
class PeerStore(
    private val file: Path,
) {
    private val json =
        Json {
            prettyPrint = true
            ignoreUnknownKeys = true
        }

    fun read(): List<PeerRecord> {
        if (!file.exists()) return emptyList()
        return json.decodeFromString(serializer<PeersFile>(), file.readText()).peers
    }

    fun write(peers: List<PeerRecord>) {
        Files.createDirectories(file.parent)
        EngineHome.writePrivate(file, json.encodeToString(serializer<PeersFile>(), PeersFile(peers)) + "\n")
    }

    /** Adds or replaces the peer with the same slug. */
    fun add(
        peer: PeerRecord,
        myId: String?,
    ): List<PeerRecord> {
        check(peer)
        val others = read().filter { it.device != peer.device }
        if (peer.syncId == myId) throw PeerInputException("The device id ${peer.syncId} is the id of this device")
        others.firstOrNull { it.syncId == peer.syncId }?.let {
            throw PeerInputException("The device id ${peer.syncId} is already the id of ${it.device}")
        }
        val next = others + peer
        write(next)
        return next
    }

    /** Removes a peer by its slug or its device id. */
    fun remove(device: String): List<PeerRecord> {
        val next = read().filterNot { it.device == device || it.syncId == device }
        write(next)
        return next
    }

    companion object {
        private val SLUG = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$")
        private val SYNC_ID = Regex("^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$")
        private const val BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        private const val RADIX = 32
        private const val GROUPS = 4
        private const val GROUP_CHARS = 14
        private val ROLES = setOf("local", "remote", "mobile")

        /** The Luhn mod-32 check character of a group of 13 base32 characters (the engine rule). */
        private fun luhnBase32(group: String): Char {
            var factor = 1
            var sum = 0
            for (char in group) {
                val addend = factor * BASE32.indexOf(char)
                factor = if (factor == 2) 1 else 2
                sum += addend / RADIX + addend % RADIX
            }
            return BASE32[(RADIX - sum % RADIX) % RADIX]
        }

        /** True when a device id has the form and the 4 check characters of an engine device id. */
        fun isSyncId(id: String): Boolean {
            if (!SYNC_ID.matches(id)) return false
            val chars = id.replace("-", "")
            return (0 until GROUPS).all { group ->
                val part = chars.substring(group * GROUP_CHARS, group * GROUP_CHARS + GROUP_CHARS)
                luhnBase32(part.substring(0, GROUP_CHARS - 1)) == part[GROUP_CHARS - 1]
            }
        }

        /** What is wrong with a peer record, or null. */
        fun problem(peer: PeerRecord): String? =
            when {
                !SLUG.matches(peer.device) -> "The device slug ${peer.device} is not valid"

                !isSyncId(peer.syncId) -> "The device id ${peer.syncId} is not a valid device id"

                peer.role !in ROLES -> "The role ${peer.role} is not local, remote or mobile"

                peer.addresses.isEmpty() ||
                    peer.addresses.any {
                        it.isEmpty()
                    }
                -> "The peer ${peer.device} needs at least one address"

                else -> null
            }

        fun check(peer: PeerRecord) {
            problem(peer)?.let { throw PeerInputException(it) }
        }
    }
}
