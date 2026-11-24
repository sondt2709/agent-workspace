import { describe, expect, it } from "vitest";
import { applyStreamMessage } from "./events.ts";
import { createQueryClient, keys } from "./queries.ts";

function seeded() {
  const client = createQueryClient();
  const data = {
    task3: keys.task("ws-1", "t3"),
    thread3: keys.thread("ws-1", "t3"),
    task4: keys.task("ws-1", "t4"),
    list: keys.tasks("ws-1", { project: "billing-api" }),
    gates: keys.gates("ws-1"),
    projects: keys.projects("ws-1"),
    hosts: keys.sessionHosts("ws-1"),
    other: keys.tasks("ws-2"),
  };
  for (const key of Object.values(data)) client.setQueryData(key, []);
  const stale = () =>
    Object.fromEntries(
      Object.entries(data).map(([name, key]) => [name, client.getQueryState(key)?.isInvalidated]),
    );
  return { client, stale };
}

const changed = (extra: object) => ({
  type: "changed" as const,
  workspace: "ws-1",
  tasks: ["t3"],
  workspace_changed: false,
  documents_changed: false,
  full: false,
  ...extra,
});

describe("applyStreamMessage", () => {
  it("invalidates the listed task, its thread, the task lists and the gates of the workspace", async () => {
    const { client, stale } = seeded();
    await applyStreamMessage(client, changed({}));
    expect(stale()).toEqual({
      task3: true,
      thread3: true,
      task4: false,
      list: true,
      gates: true,
      projects: false,
      hosts: false,
      other: false,
    });
  });

  it("invalidates the projects and the session hosts when the documents changed", async () => {
    const { client, stale } = seeded();
    await applyStreamMessage(client, changed({ tasks: [], documents_changed: true }));
    expect(stale()).toMatchObject({ projects: true, hosts: true, task3: false });
  });

  it("invalidates the whole workspace for a full change, and no other workspace", async () => {
    const { client, stale } = seeded();
    await applyStreamMessage(client, changed({ tasks: [], full: true }));
    expect(stale()).toEqual({
      task3: true,
      thread3: true,
      task4: true,
      list: true,
      gates: true,
      projects: true,
      hosts: true,
      other: false,
    });
  });

  it("invalidates the thread of a subtask when its parent changes (desktop-shell review, workflow 2)", async () => {
    const client = createQueryClient();
    const sub = [...keys.thread("ws-1", "t9"), "window", 1];
    const page = (task: string) => ({ task: { id: task }, events: [], next: null, prev: null });
    client.setQueryData(sub, { ...page("t9"), ancestors: [page("t1"), page("t3")] });
    const unrelated = [...keys.thread("ws-1", "t8"), "window", 1];
    client.setQueryData(unrelated, { ...page("t8"), ancestors: [] });
    await applyStreamMessage(client, changed({}));
    expect(client.getQueryState(sub)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it("does nothing for hello", async () => {
    const { client, stale } = seeded();
    await applyStreamMessage(client, { type: "hello", version: "0.0.0" });
    expect(Object.values(stale()).every((v) => v === false)).toBe(true);
  });
});
