package com.agentworkspace.control

import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.files.WorkspaceWriter
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SealedOutboxCleanupTest {
    private fun importedLine(
        id: String,
        dev: String,
        from: String,
        sealed: String,
    ) = "{\"v\":1,\"id\":\"$id\",\"hlc\":\"2026-11-22T14:21:20.000Z#0000\",\"dev\":\"$dev\"," +
        "\"type\":\"credential.imported\",\"by\":\"aw@$dev\"," +
        "\"data\":{\"name\":\"staging-api-key\",\"from\":\"$from\",\"sealed\":\"$sealed\"}}"

    private fun TestWorkspace.sealed(
        phone: String,
        id: String,
    ): String {
        val path = SealedOutboxCleanup.sealedPath(phone, id)
        files.writeAtomic(path, "age-encryption.org/v1 sealed".encodeToByteArray())
        return path
    }

    private fun TestWorkspace.exists(path: String) = Files.exists(root.resolve(path))

    @Test
    fun thePhoneRemovesTheSealedFileOfAnImportOfAComputer() =
        runTest {
            TestWorkspace().use { ws ->
                val imported = ws.sealed("pixel-9", SEALED_A)
                val waiting = ws.sealed("pixel-9", SEALED_B)
                val otherPhone = ws.sealed("pixel-9", SEALED_C)
                val byPhone = ws.sealed("pixel-9", SEALED_D)
                // ubuntu-01 (a computer) imported A; the import of C names another phone; the phone
                // itself (a mobile record) wrote the import of D.
                ws.appendRaw("tasks/log/ubuntu-01.jsonl", importedLine(ID_1, "ubuntu-01", "pixel-9", SEALED_A))
                ws.appendRaw("tasks/log/ubuntu-01.jsonl", importedLine(ID_2, "ubuntu-01", "pixel-8", SEALED_C))
                ws.files.appendLine("tasks/log/pixel-9.jsonl", importedLine(ID_3, "pixel-9", "pixel-9", SEALED_D))
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val cleanup = SealedOutboxCleanup(ws.index, NioWorkspaceFiles(ws.root), ws.files, TestWorkspace.io)

                assertEquals(listOf(imported), cleanup.run(snapshot))
                assertFalse(ws.exists(imported))
                assertTrue(ws.exists(waiting))
                assertTrue(ws.exists(otherPhone))
                assertTrue(ws.exists(byPhone))
                // A second refresh finds no file to remove.
                assertEquals(emptyList(), cleanup.run(snapshot))
            }
        }

    @Test
    fun aRevokedComputerDoesNotCount() =
        runTest {
            TestWorkspace().use { ws ->
                val path = ws.sealed("pixel-9", SEALED_A)
                ws.appendRaw("tasks/log/ubuntu-01.jsonl", importedLine(ID_1, "ubuntu-01", "pixel-9", SEALED_A))
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                val revoked =
                    snapshot.copy(
                        records =
                            snapshot.records.mapValues { (slug, record) ->
                                if (slug != "ubuntu-01") {
                                    record
                                } else {
                                    kotlinx.serialization.json.JsonObject(
                                        record + ("revoked" to kotlinx.serialization.json.JsonPrimitive(true)),
                                    )
                                }
                            },
                    )
                val cleanup = SealedOutboxCleanup(ws.index, NioWorkspaceFiles(ws.root), ws.files, TestWorkspace.io)
                assertEquals(emptyList(), cleanup.run(revoked))
                assertTrue(ws.exists(path))
                assertEquals(setOf("macbook-pro", "ubuntu-01"), SealedOutboxCleanup.computers(snapshot.records))
            }
        }

    @Test
    fun anErrorIsLoggedAndTheNextSnapshotRemovesTheFile() =
        runTest {
            TestWorkspace().use { ws ->
                val path = ws.sealed("pixel-9", SEALED_A)
                ws.appendRaw("tasks/log/ubuntu-01.jsonl", importedLine(ID_1, "ubuntu-01", "pixel-9", SEALED_A))
                ws.refresh()
                val snapshot = ws.model(backgroundScope).reload()
                var fail = true
                val flaky =
                    object : WorkspaceWriter by ws.files {
                        override fun delete(path: String) {
                            if (fail) {
                                fail = false
                                throw java.io.IOException("disk error")
                            }
                            ws.files.delete(path)
                        }
                    }
                val cleanup = SealedOutboxCleanup(ws.index, NioWorkspaceFiles(ws.root), flaky, TestWorkspace.io)
                val scanned = mutableListOf<String>()
                cleanup.follow(flowOf(snapshot, snapshot)) { scanned.add(it) }
                assertEquals(listOf(path), scanned)
                assertFalse(ws.exists(path))
            }
        }

    private companion object {
        const val SEALED_A = "01a203a2-1111-7000-8000-00000000c001"
        const val SEALED_B = "01a203a2-1111-7000-8000-00000000c002"
        const val SEALED_C = "01a203a2-1111-7000-8000-00000000c003"
        const val SEALED_D = "01a203a2-1111-7000-8000-00000000c004"
        const val ID_1 = "01a203a2-2222-7000-8000-00000000d001"
        const val ID_2 = "01a203a2-2222-7000-8000-00000000d002"
        const val ID_3 = "01a203a2-2222-7000-8000-00000000d003"
    }
}
