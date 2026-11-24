package com.agentworkspace.control

import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.files.NioWorkspaceWriter
import com.agentworkspace.shared.index.WorkspaceIndex
import com.agentworkspace.shared.index.openWorkspaceIndex
import com.agentworkspace.shared.merge.MergeEngine
import com.agentworkspace.shared.model.HybridLogicalClock
import com.agentworkspace.shared.model.IsoTime
import com.agentworkspace.shared.model.TimeSource
import com.agentworkspace.shared.write.EventWriter
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.appendText
import kotlin.io.path.copyToRecursively
import kotlin.io.path.deleteRecursively

/** A clock that the test moves. */
class TestClock(
    var time: Long,
) : TimeSource {
    override fun now(): Long = time
}

/**
 * A temp copy of the shared workspace fixture (contracts/fixtures/workspace) with the real merge, the
 * real Room index (in memory) and the real event writer of the phone `pixel-9`.
 */
@OptIn(ExperimentalPathApi::class)
class TestWorkspace(
    now: String = "2026-11-22T14:21:30.000Z",
) : AutoCloseable {
    val root: Path = Files.createTempDirectory("aw-control-")
    val clock = TestClock(IsoTime.parseMillis(now)!!)
    val files = NioWorkspaceWriter(root)
    val merge: MergeEngine
    val index: WorkspaceIndex = openWorkspaceIndex(null)
    val refreshed = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
    val writer = EventWriter(files, PHONE, HybridLogicalClock(clock), clock)
    val written = mutableListOf<String>()

    init {
        val fixture = Path.of(requireNotNull(System.getProperty("aw.schema.dir"))).resolve("fixtures/workspace")
        fixture.copyToRecursively(root, followLinks = false, overwrite = true)
        merge = MergeEngine(NioWorkspaceFiles(root), clock)
    }

    /** Runs the merge and writes the index, like the IndexRefresher of the engine. */
    suspend fun refresh() {
        index.write(merge.update(), merge)
    }

    fun model(scope: CoroutineScope) = WorkspaceModel(WORKSPACE, { PHONE }, index, scope, refreshed, clock)

    fun actions(model: WorkspaceModel) =
        PhoneActions(writer, { model.snapshot.value }, { path -> written.add(path) }, clock, io)

    /** Appends a raw line of another device (the test plays that device). */
    fun appendRaw(
        path: String,
        line: String,
    ) {
        val file = root.resolve(path)
        Files.createDirectories(file.parent)
        file.appendText("$line\n")
    }

    override fun close() {
        index.close()
        root.deleteRecursively()
    }

    companion object {
        /** The file writes run on the test thread. */
        @Suppress("InjectDispatcher")
        val io: CoroutineDispatcher = Dispatchers.Unconfined

        const val PHONE = "pixel-9"
        const val WORKSPACE = "01a2038e-7f00-721a-b230-e03772a58aff"
        const val AW7 = "01a2038e-7f00-70eb-b429-fa86d481c263"
        const val SESSION = "01a20390-53c0-73f3-af1e-cebbd1410ab4"
        const val GATE = "01a203a2-0000-7000-8000-00000000a001"

        /** An open question gate of ubuntu-01 on AW-7, at 14:21:10. */
        fun questionLine(
            gate: String = GATE,
            options: String = "\"100/min\",\"1000/min\"",
        ) = "{\"v\":1,\"id\":\"01a203a2-0000-7000-8000-00000000b001\",\"hlc\":\"2026-11-22T14:21:10.000Z#0000\"," +
            "\"dev\":\"ubuntu-01\",\"type\":\"gate.opened\",\"task\":\"$AW7\",\"by\":\"claude@ubuntu-01\"," +
            "\"data\":{\"gate\":\"$gate\",\"kind\":\"question\",\"version\":1,\"title\":\"Which limit per client?\"," +
            "\"text\":\"The API has no limit now.\",\"options\":[$options]}}"
    }
}
