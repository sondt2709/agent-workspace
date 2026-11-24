package com.agentworkspace.shared.merge

import com.agentworkspace.schema.TaskV1

/**
 * The `task.yaml` value of a task view (`snapshot.ts`), or null when the task has no `task.created`
 * event. The owner device writes it; the merge itself reads the logs only.
 */
fun toTaskDocument(task: TaskView): TaskV1? {
    val key = task.key ?: return null
    val project = task.project ?: return null
    val title = task.title ?: return null
    return TaskV1(
        kind = "task",
        schema = 1,
        id = task.id,
        key = key,
        project = project,
        title = title,
        firstMessage = task.firstMessage.orEmpty(),
        stage = task.stage,
        needsYou = task.needsYou,
        paused = task.paused?.let { TaskV1.Paused(it.cause, it.since, it.resumesAt, it.nextStep, it.needsHuman) },
        assignee = task.assignee,
        claim = task.claim?.let { TaskV1.Claim(it.epoch, it.device, it.session) },
        approach = TaskV1.Approach(task.approach.latest, task.approach.confirmed),
        ready = task.ready?.let { TaskV1.Ready(it.passedOn, it.missing) },
        testServer = task.testServer,
        credentials = task.credentials,
        parent = task.parent,
        subtasks = task.subtasks,
        dependsOn = task.dependsOn,
        links = task.links,
        branch = task.branch,
        includes = task.includes,
        archived = task.archived,
    )
}
