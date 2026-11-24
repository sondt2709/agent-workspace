// The `task.yaml` snapshot of a task view (docs/phase-1.md 3.2, docs/architecture.md 4.2.5). The
// owner device writes it through the files layer; the merge itself reads the logs only.
import type { TaskDocument } from "@aw/schema";
import type { TaskView } from "./view.ts";

/** The `task.yaml` value of a task, or null when the task has no `task.created` event. */
export function toTaskDocument(task: TaskView): TaskDocument | null {
  if (task.key === null || task.project === null || task.title === null) return null;
  return {
    kind: "task",
    schema: 1,
    id: task.id,
    key: task.key,
    project: task.project,
    title: task.title,
    first_message: task.first_message ?? "",
    stage: task.stage,
    needs_you: [...task.needs_you],
    paused: task.paused ? { ...task.paused } : null,
    assignee: task.assignee,
    claim: task.claim
      ? { epoch: task.claim.epoch, device: task.claim.device, session: task.claim.session }
      : null,
    approach: { ...task.approach },
    ready: task.ready
      ? { passed_on: task.ready.passed_on, missing: [...task.ready.missing] }
      : null,
    test_server: task.test_server,
    credentials: [...task.credentials],
    parent: task.parent,
    subtasks: [...task.subtasks],
    depends_on: [...task.depends_on],
    links: [...task.links],
    branch: task.branch,
    includes: { ...task.includes },
    archived: task.archived,
  };
}
