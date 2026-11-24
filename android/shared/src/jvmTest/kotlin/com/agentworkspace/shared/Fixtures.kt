package com.agentworkspace.shared

import com.agentworkspace.shared.files.NioWorkspaceFiles
import com.agentworkspace.shared.merge.MergeEngine
import com.agentworkspace.shared.merge.MergeUpdate
import com.agentworkspace.shared.model.AwJson
import com.agentworkspace.shared.model.IsoTime
import com.agentworkspace.shared.model.TimeSource
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.math.BigDecimal
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.copyToRecursively
import kotlin.io.path.deleteRecursively
import kotlin.io.path.readText

/** The shared fixtures of contracts/, from the Gradle system property `aw.schema.dir`. */
object Fixtures {
    val contractsDir: Path =
        Path.of(
            requireNotNull(System.getProperty("aw.schema.dir")) { "Run the tests with Gradle: it sets aw.schema.dir" },
        )
    val workspace: Path = contractsDir.resolve("fixtures/workspace")
    val mergeCases: Path = contractsDir.resolve("fixtures/merge")
    val hlcVectors: Path = contractsDir.resolve("test-vectors/hlc.json")
    val schemaSamples: Path = contractsDir.resolve("samples/schema-samples.json")

    const val FIXTURE_TASK = "01a2038e-7f00-70eb-b429-fa86d481c263"

    fun json(path: Path): JsonElement = AwJson.parseToJsonElement(path.readText())

    fun caseNames(): List<String> =
        Files.list(mergeCases).use { s -> s.map { it.fileName.toString() }.toList() }.sorted()

    /** A temp copy of the fixture folder, or an empty folder. */
    @OptIn(ExperimentalPathApi::class)
    fun tempWorkspace(fixture: Boolean = true): Path {
        val root = Files.createTempDirectory("aw-kt-")
        if (fixture) workspace.copyToRecursively(root, followLinks = false, overwrite = true)
        return root
    }

    /** The folder of a merge case: the fixture folder plus the `files/` overlay of the case. */
    @OptIn(ExperimentalPathApi::class)
    fun materializeCase(name: String): Path {
        val root = tempWorkspace()
        val overlay = mergeCases.resolve(name).resolve("files")
        if (Files.isDirectory(overlay)) {
            overlay.copyToRecursively(root, followLinks = false, overwrite = true)
        }
        return root
    }

    @OptIn(ExperimentalPathApi::class)
    fun remove(root: Path) = root.deleteRecursively()
}

/** A clock that the test sets. */
class FakeClock(
    var time: Long,
) : TimeSource {
    constructor(iso: String) : this(IsoTime.parseMillis(iso)!!)

    override fun now(): Long = time

    fun advance(ms: Long) {
        time += ms
    }
}

/** One run of a merge case at the `now` of its `case.json`. */
class CaseRun(
    val root: Path,
    val clock: FakeClock,
    val engine: MergeEngine,
    val update: MergeUpdate,
)

suspend fun runMergeCase(
    name: String,
    readOrder: (List<String>) -> List<String> = { it },
): CaseRun {
    val case = Fixtures.json(Fixtures.mergeCases.resolve(name).resolve("case.json")).jsonObject
    val root = Fixtures.materializeCase(name)
    val clock = FakeClock(case.getValue("now").jsonPrimitive.content)
    val skew = case["max_skew_ms"]?.jsonPrimitive?.longOrNull
    val engine =
        if (skew == null) {
            MergeEngine(NioWorkspaceFiles(root), clock, readOrder = readOrder)
        } else {
            MergeEngine(NioWorkspaceFiles(root), clock, skew, readOrder)
        }
    return CaseRun(root, clock, engine, engine.update())
}

/** The expected-file value of a merge update: `{view, presence}`. */
fun expectedOf(update: MergeUpdate): JsonElement =
    buildJsonObject {
        put(
            "view",
            AwJson.encodeToJsonElement(
                com.agentworkspace.shared.merge.WorkspaceView
                    .serializer(),
                update.view,
            ),
        )
        put(
            "presence",
            AwJson.encodeToJsonElement(
                com.agentworkspace.shared.merge.PresenceView
                    .serializer(),
                update.presence,
            ),
        )
    }

/**
 * The first difference of 2 JSON values, as `<path>: <expected> != <actual>`, or null when they are
 * equal. Numbers compare by value (`1` equals `1.0`), and keys in any order.
 */
fun jsonDiff(
    expected: JsonElement,
    actual: JsonElement,
    path: String = "$",
): String? =
    when {
        expected is JsonObject && actual is JsonObject -> {
            val keys = (expected.keys + actual.keys).sorted()
            keys.firstNotNullOfOrNull { key ->
                val e = expected[key]
                val a = actual[key]
                if (e == null ||
                    a == null
                ) {
                    "$path.$key: ${e ?: "(missing)"} != ${a ?: "(missing)"}"
                } else {
                    jsonDiff(e, a, "$path.$key")
                }
            }
        }

        expected is JsonArray && actual is JsonArray -> {
            if (expected.size != actual.size) {
                "$path: ${expected.size} items != ${actual.size} items: $expected != $actual"
            } else {
                expected.indices.firstNotNullOfOrNull { jsonDiff(expected[it], actual[it], "$path[$it]") }
            }
        }

        expected is JsonNull || actual is JsonNull -> {
            if (expected == actual) null else "$path: $expected != $actual"
        }

        expected is JsonPrimitive && actual is JsonPrimitive -> {
            val same =
                if (!expected.isString && !actual.isString && expected.content.toBigDecimalOrNull() != null) {
                    expected.content.toBigDecimalOrNull()?.compareTo(
                        actual.content.toBigDecimalOrNull() ?: BigDecimal.ONE.negate(),
                    ) ==
                        0
                } else {
                    expected.isString == actual.isString && expected.content == actual.content
                }
            if (same) null else "$path: $expected != $actual"
        }

        else -> {
            "$path: $expected != $actual"
        }
    }
