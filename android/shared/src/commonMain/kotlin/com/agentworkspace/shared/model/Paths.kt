package com.agentworkspace.shared.model

/** The kind of a JSON Lines log: which event types it holds (docs/phase-1.md 3.1). */
enum class LogKind(
    val text: String,
) {
    TASK("task"),
    WORKSPACE("workspace"),
    KNOWLEDGE("knowledge"),
    HEARTBEAT("heartbeat"),
}

/** The scope of a log file: its kind and the task of its folder. */
data class LogScope(
    val kind: LogKind,
    val task: String? = null,
)

/** A field of a document that must be the same as a part of its path. */
data class DocumentIdentity(
    val field: String,
    val value: String,
)

/** A merge source of the `tasks` folder: a log file or a document (`classifyPath` of the files layer). */
sealed interface SourcePath {
    /** The path relative to the workspace root, with `/` separators. */
    val path: String

    data class Log(
        override val path: String,
        val device: String,
        val scope: LogScope,
    ) : SourcePath

    data class Document(
        override val path: String,
        val kind: String,
        val identity: DocumentIdentity?,
    ) : SourcePath
}

/**
 * The rules of `shared/core/src/files/ownership.ts` for the files that the merge reads. A path that
 * no rule matches, a temp file (`*.aw-tmp`) and a conflict copy (`*.sync-conflict-*`) give null.
 */
object WorkspacePaths {
    private const val SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*"
    private const val UUID7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"

    private class Rule(
        val pattern: Regex,
        val source: (path: String, groups: List<String>) -> SourcePath,
    )

    private fun doc(
        kind: String,
        field: String? = null,
    ): (String, List<String>) -> SourcePath =
        { path, groups -> SourcePath.Document(path, kind, field?.let { DocumentIdentity(it, groups[1]) }) }

    // The table of docs/phase-1.md 3.1, for the files of the merge.
    private val rules =
        listOf(
            Rule(Regex("^tasks/workspace\\.yaml\\z"), doc("workspace")),
            Rule(
                Regex("^tasks/log/($SLUG)\\.jsonl\\z"),
            ) { path, g -> SourcePath.Log(path, g[1], LogScope(LogKind.WORKSPACE)) },
            Rule(Regex("^tasks/devices/($SLUG)/device\\.yaml\\z"), doc("device", "slug")),
            Rule(Regex("^tasks/devices/($SLUG)/health\\.yaml\\z"), doc("health", "device")),
            Rule(Regex("^tasks/devices/($SLUG)/bindings\\.yaml\\z"), doc("bindings", "device")),
            Rule(Regex("^tasks/devices/($SLUG)/heartbeat/\\d{4}-\\d{2}-\\d{2}\\.jsonl\\z")) { path, g ->
                SourcePath.Log(path, g[1], LogScope(LogKind.HEARTBEAT))
            },
            Rule(Regex("^tasks/projects/($SLUG)/project\\.yaml\\z"), doc("project", "slug")),
            Rule(Regex("^tasks/($UUID7)/log/($SLUG)\\.jsonl\\z")) { path, g ->
                SourcePath.Log(path, g[2], LogScope(LogKind.TASK, g[1]))
            },
        )

    fun classify(path: String): SourcePath? {
        val parts = path.split("/")
        if (parts.any { it.endsWith(".aw-tmp") || it.contains(".sync-conflict-") }) return null
        return rules.firstNotNullOfOrNull { rule ->
            rule.pattern.matchEntire(path)?.let { rule.source(path, it.groupValues) }
        }
    }
}
