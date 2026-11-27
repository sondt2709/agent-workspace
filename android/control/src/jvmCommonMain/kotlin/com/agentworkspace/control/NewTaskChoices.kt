package com.agentworkspace.control

/** The choices of the phone New task that the desktop New task also has (openspec polish-skip-default). */
object NewTaskChoices {
    /**
     * "Start the agent now" of New task: the default agent of the project on its first device, the
     * first of [ScreenStates.agentChoices]; null for a project with no device (as `startAgent` of the desktop).
     */
    fun startAgent(
        snapshot: WorkspaceSnapshot,
        project: String?,
    ): String? = project?.let { ScreenStates.agentChoices(snapshot, it).firstOrNull() }

    /**
     * The assignee of New task. "Start the agent now" is on at the start (openspec session-options):
     * while the person did not change the assignee ([changed] false), it is [startAgent] of the
     * project and follows a project change. Else it is [picked] when the project shows it, else none.
     */
    fun assignee(
        snapshot: WorkspaceSnapshot,
        project: String?,
        changed: Boolean,
        picked: String?,
    ): String? =
        if (changed) {
            picked?.takeIf { project != null && it in ScreenStates.agentChoices(snapshot, project) }
        } else {
            startAgent(snapshot, project)
        }

    /**
     * The parent choices of New task: the tasks of the project that are not done or archived, as
     * (task id, "AW-3 · title"), as the desktop lists them.
     */
    fun parentChoices(
        snapshot: WorkspaceSnapshot,
        project: String?,
    ): List<Pair<String, String>> =
        snapshot.tasks
            .filter { it.project == project && it.stage != "done" && !it.archived }
            .map { it.id to "${Texts.taskLabel(it.id, it.key)} · ${it.title.orEmpty()}" }

    /**
     * The credential names that the phone knows: the names that the tasks of the workspace use.
     * The phone has no `secure/` folder, so a name that no task uses yet is typed (docs/phase-1.md 10.2).
     */
    fun credentialNames(snapshot: WorkspaceSnapshot): List<String> =
        snapshot.tasks
            .flatMap { it.credentials }
            .distinct()
            .sorted()
}
