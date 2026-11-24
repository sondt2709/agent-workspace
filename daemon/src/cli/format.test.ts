// The text output of aw thread: a long thread is never cut with no word (principle 8).
import type { Task, ThreadReply } from "@aw/client";
import { withPresencePause } from "@aw/client/pause";
import { describe, expect, it } from "vitest";
import { formatTask, formatTasks, formatThread } from "./format.ts";

const page = (key: string, next: string | null) => ({
  task: { id: `${key}-id`, key, title: `Task ${key}` },
  events: [],
  next,
  prev: null,
});

describe("formatThread", () => {
  it("prints the next cursor of each page that has more events, also of a parent", () => {
    const reply: ThreadReply = {
      ...page("AW-2", null),
      ancestors: [page("AW-1", "2026-11-23T10:00:00.000Z-0000~ubuntu-01~e1")],
    };
    const text = formatThread(reply);
    expect(text).toContain(
      "More events: aw thread AW-1 --after '2026-11-23T10:00:00.000Z-0000~ubuntu-01~e1'",
    );
    expect(text).not.toContain("aw thread AW-2 --after");
  });
});

describe("the pause from the presence (openspec move-paused-task)", () => {
  const task = {
    id: "t21",
    key: "AW-21",
    key_state: "ok",
    title: "Add rate limit",
    project: "billing-api",
    stage: "implement",
    archived: false,
    assignee: "claude@macbook-pro",
    owner: "macbook-pro",
    priority: null,
    parent: null,
    needs_you_lane: false,
    needs_you_reasons: [],
    first_message: "Add a rate limit.",
    gates: [],
    paused: null,
  } as unknown as Task;
  const presence = {
    offline_tasks: [
      {
        task: "t21",
        device: "macbook-pro",
        cause: "device_offline",
        since: "2026-11-23T23:01:30Z",
      },
    ],
  };
  const [shown] = withPresencePause([task], presence, new Map([["macbook-pro", "MacBook Pro"]]));

  it("adds the pause to the stage in aw task list", () => {
    expect(formatTasks([shown!])).toContain("AW-21  implement (paused: MacBook Pro offline)");
    expect(formatTasks([task])).not.toContain("paused");
  });

  it("prints a Paused line with the next step in aw task show", () => {
    expect(formatTask(shown!)).toContain(
      "Paused:    MacBook Pro offline. It continues when MacBook Pro is back. Assign it to another device to continue now.",
    );
  });
});

describe("the pause of a revoked device (openspec revoke-device)", () => {
  const task = {
    id: "t1",
    key: "AW-1",
    key_state: "ok",
    title: "Add rate limit",
    project: "billing-api",
    stage: "implement",
    archived: false,
    assignee: "claude@ubuntu-01",
    owner: "ubuntu-01",
    priority: null,
    parent: null,
    needs_you_lane: false,
    needs_you_reasons: [],
    first_message: "Add a rate limit.",
    gates: [],
    paused: null,
  } as unknown as Task;
  const presence = {
    offline_tasks: [
      { task: "t1", device: "ubuntu-01", cause: "device_revoked", since: "2026-11-23T22:00:00Z" },
    ],
  };
  const [shown] = withPresencePause([task], presence);

  it("prints the revoke and the next step in aw task show and aw task list", () => {
    expect(formatTask(shown!)).toContain(
      "Paused:    ubuntu-01 was revoked. Change the assignee to continue on another device.",
    );
    expect(formatTasks([shown!])).toContain("AW-1  implement (paused: ubuntu-01 was revoked)");
  });
});
