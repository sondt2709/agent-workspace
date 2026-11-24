package com.agentworkspace.control

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The phone peers over the workspaces (openspec revoke-device, gap M21): a device whose device key
 * or sync device id one workspace revoked is no peer of any folder, as on awd.
 */
class RecordPeersTest {
    private val mac = "CLYYKI3-6JVFTIF-CRK4YG6-AE5MVQQ-C2JKFAK-CS45ZZF-4RQXQCT-GNZA4QG"
    private val server = "MWAQSX5-ZFSDHGU-35OVA2B-KC7KOTN-6WWXH2J-T652RXX-EB32OIJ-N5QZ2A5"
    private val phone = "5NRSCRM-EBSEQFK-QNF5TAK-VWPOCL5-ZSWAWL3-RGEZFBQ-4Z53HNX-4RPKHQV"

    private fun record(
        slug: String,
        key: String,
        sync: String,
        revoked: Boolean = false,
    ): JsonObject =
        buildJsonObject {
            put("kind", "device")
            put("slug", slug)
            put("role", if (slug == "pixel-9") "mobile" else "remote")
            put("keys", buildJsonObject { put("ed25519", key) })
            put("sync_device_id", sync)
            put("revoked", revoked)
            put("addresses", buildJsonArray {})
        }

    @Test
    fun dropsADeviceThatAnotherWorkspaceRevoked() {
        val personal =
            listOf(record("pixel-9", "a", phone), record("mac-mini-lab", "b", mac), record("ubuntu-01", "c", server))
        val side = listOf(record("pixel-9", "a", phone), record("mac-mini-lab", "b", mac, revoked = true))
        val peers = RecordPeers.plan(listOf(personal, side), "pixel-9")
        assertEquals(listOf("ubuntu-01"), peers?.map { it.device })
    }

    @Test
    fun dropsTheSameKeyOrSyncIdUnderAnotherSlug() {
        val personal = listOf(record("mac-mini-lab", "b", mac), record("ubuntu-01", "c", server))
        // Another slug with the key of mac-mini-lab, and another one with the sync id of ubuntu-01.
        val side =
            listOf(record("old-mac", "b", phone, revoked = true), record("old-server", "z", server, revoked = true))
        assertEquals(emptyList(), RecordPeers.plan(listOf(personal, side), "pixel-9")?.map { it.device })
    }

    @Test
    fun keepsTheDevicesThatNoWorkspaceRevoked() {
        val personal = listOf(record("mac-mini-lab", "b", mac))
        val side = listOf(record("mac-mini-lab", "b", mac), record("ubuntu-01", "c", server))
        val peers = RecordPeers.plan(listOf(personal, side), "pixel-9")
        assertEquals(listOf("mac-mini-lab", "ubuntu-01"), peers?.map { it.device })
    }
}
