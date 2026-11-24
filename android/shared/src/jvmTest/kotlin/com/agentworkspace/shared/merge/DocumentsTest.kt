package com.agentworkspace.shared.merge

import com.agentworkspace.shared.FakeClock
import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.index.openWorkspaceIndex
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import kotlin.io.path.readText
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The documents of the merge: the identity of the folder and the last valid value (rule 7.3.5). */
class DocumentsTest {
    private val ws = TestWorkspace()
    private val path = "tasks/devices/pixel-9/device.yaml"

    @AfterTest
    fun cleanup() = ws.remove()

    private fun deviceName(update: MergeUpdate) =
        update.view.devices
            .first { it.slug == "pixel-9" }
            .name

    @Test
    fun refusesADocumentWhoseIdentityDiffersFromItsFolder() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            val name = deviceName(engine.update())
            ws.write(
                path,
                ws.root
                    .resolve(path)
                    .readText()
                    .replace("slug: pixel-9", "slug: pixel-8"),
            )
            val update = engine.update()
            val issue = update.view.issues.single { it.code == "bad_document" }
            assertEquals(path, issue.path)
            assertEquals("schema_error", issue.reason)
            assertEquals("slug is \"pixel-8\", not pixel-9 (the name of the folder)", issue.message)
            // The document keeps its last valid value.
            assertEquals(name, deviceName(update))
        }

    @Test
    fun readsAHugeHexOrOctalNumberAsABadDocumentAndGoesOn() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            val name = deviceName(engine.update())
            val text = ws.root.resolve(path).readText()
            for (value in listOf("0x1FFFFFFFFFFFFFFFFF", "0o7777777777777777777777777")) {
                // A person edits the file by hand: the number is too large for a Long.
                ws.write(path, text.replace(Regex("(?m)^name: .*$"), "name: $value"))
                val update = engine.update()
                val issue = update.view.issues.single { it.code == "bad_document" }
                assertEquals(path, issue.path, value)
                assertEquals("schema_error", issue.reason, value)
                assertTrue(issue.message.contains("name"), issue.message)
                assertEquals(name, deviceName(update), value)
            }
            // The next update still works, and a fixed file is valid again.
            ws.write(path, text)
            assertTrue(
                engine
                    .update()
                    .view.issues
                    .isEmpty(),
            )
        }

    @Test
    fun keepsTheLastValidValueAfterARestartFromTheIndex() =
        runTest {
            val clock = FakeClock("2026-11-22T14:30:00.000Z")
            val engine = MergeEngine(NioWorkspaceFiles(ws.root), clock)
            val index = openWorkspaceIndex(null)
            try {
                val first = engine.update()
                index.write(first, engine)
                ws.write(
                    path,
                    ws.root
                        .resolve(path)
                        .readText()
                        .replace("role: mobile", "role: server"),
                )
                // A new process: the engine starts from the documents of the index.
                val restarted = MergeEngine(NioWorkspaceFiles(ws.root), clock, lastValid = index.documents())
                val update = restarted.update()
                assertEquals(
                    "bad_document",
                    update.view.issues
                        .single()
                        .code,
                )
                assertEquals(
                    "mobile",
                    update.view.devices
                        .first { it.slug == "pixel-9" }
                        .role,
                )
                val kept = restarted.documents().first { it.path == path }.value
                assertEquals("mobile", kept.getValue("role").jsonPrimitive.content)
                // With no last valid value, the device has no record.
                val fresh = MergeEngine(NioWorkspaceFiles(ws.root), clock).update()
                assertEquals(
                    null,
                    fresh.view.devices
                        .first { it.slug == "pixel-9" }
                        .role,
                )
            } finally {
                index.close()
            }
        }
}
