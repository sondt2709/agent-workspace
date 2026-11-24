// The learning step of a task (docs/workflow.md 4.10.2, decision D3, openspec agent-learning): a
// learned item (a new knowledge file) or "Nothing new". Each step writes `task.learned` to the task
// log, so the thread shows it. The local API route, the aw CLI (through the route) and the MCP tool
// `learn` call only this function.
import type { LearnResult } from "@aw/client/knowledge";
import type { TaskView } from "@aw/core";
import type { EventData } from "@aw/schema";
import { invalid, ServiceError } from "./errors.ts";
import type { KnowledgeCaller } from "./knowledge.ts";
import type { WorkspaceService } from "./workspace.ts";

export interface LearningInput {
  task: TaskView;
  /** True: record "Nothing new". Then no title, content or shared. */
  nothing_new?: boolean | undefined;
  title?: string | undefined;
  content?: string | undefined;
  shared?: boolean | undefined;
  author?: string | undefined;
  from_person?: string | undefined;
}

/**
 * The result of a learning step for the agent: an error when the merge did not apply the
 * `task.learned` event, so the agent never takes a step that does not count as done (review
 * agent-learning low 3). The CLI exits 1 for the same case.
 */
export function appliedLearning(result: LearnResult): LearnResult {
  if (result.task_event && !result.task_event.applied) {
    throw new ServiceError(
      "refused",
      `AW wrote task.learned ${result.task_event.id}, but the merge did not apply it: ${result.task_event.reason ?? "unknown reason"}. The learning step is not recorded.`,
      { task_event: result.task_event.id },
    );
  }
  return result;
}

/** Records the learning step of a task for the person or the agent of a session. */
export async function recordLearning(
  service: WorkspaceService,
  input: LearningInput,
  caller: KnowledgeCaller = null,
): Promise<LearnResult> {
  const nothingNew = input.nothing_new === true;
  if (nothingNew && (input.title !== undefined || input.content !== undefined || input.shared)) {
    throw invalid("Give nothing_new: true alone, or a title and a content: not both", [
      { path: "nothing_new", message: "not with title, content or shared" },
    ]);
  }
  if (!nothingNew && (input.title === undefined || input.content === undefined)) {
    throw invalid(
      'Give a title and a content for a learned item, or nothing_new: true for "Nothing new"',
      [{ path: input.title === undefined ? "title" : "content", message: "required" }],
    );
  }
  const author = service.knowledge.learner(input.task, input.author, caller);
  // Only the owner device writes task.learned (the merge ignores it from another device). Refuse
  // before the knowledge write, so a refused step leaves no file and a retry no copy (fix list 0-0c).
  const owner = input.task.owner;
  if (owner !== null && owner !== service.device.slug) {
    throw new ServiceError(
      "not_available",
      `${input.task.key ?? input.task.id} is owned by ${owner}: record its learning step there (aw learn on ${owner}), or by its agent.`,
      { owner },
    );
  }
  if (nothingNew) {
    const written = await service.writeLearned(input.task.id, { nothing_new: true }, author);
    return {
      change: null,
      suggestion: null,
      unchanged: false,
      task_event: { id: written.event.id, applied: written.applied, reason: written.reason },
    };
  }
  const result = await service.knowledge.learn(
    {
      task: input.task,
      title: input.title!,
      content: input.content!,
      shared: input.shared,
      author: input.author,
      from_person: input.from_person,
    },
    caller,
  );
  const path = result.change?.path ?? result.suggestion?.path;
  if (path === undefined) return { ...result, task_event: null };
  const data: EventData<"task.learned"> = {
    nothing_new: false,
    path,
    change: result.change?.id ?? null,
    suggestion: result.change ? null : (result.suggestion?.id ?? null),
  };
  const written = await service.writeLearned(input.task.id, data, author);
  return {
    ...result,
    task_event: { id: written.event.id, applied: written.applied, reason: written.reason },
  };
}
