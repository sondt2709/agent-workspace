// The pause from the presence (openspec move-paused-task).
import { describe, expect, it } from "vitest";
import { deviceNames, presencePauseText, shownPauseText, withPresencePause } from "./pause.ts";

const usage = {
  cause: "usage_limit",
  since: "2026-11-23T22:00:00.000Z",
  resumes_at: null,
  next_step: "AW continues at the reset.",
  needs_human: false,
};
const tasks = [
  { id: "t1", key: "AW-21", paused: null },
  { id: "t2", key: "AW-22", paused: usage },
  { id: "t3", key: "AW-23", paused: null },
];
const presence = {
  offline_tasks: [
    {
      task: "t1",
      device: "macbook-pro",
      cause: "device_offline",
      since: "2026-11-23T23:01:30.000Z",
    },
    {
      task: "t2",
      device: "macbook-pro",
      cause: "device_offline",
      since: "2026-11-23T23:01:30.000Z",
    },
  ],
};
const names = deviceNames([
  { slug: "macbook-pro", name: "MacBook Pro" },
  { slug: "ubuntu-01", name: null },
]);

describe("withPresencePause", () => {
  it("gives a task of an offline device the pause with the device and its name", () => {
    const [t1, t2, t3] = withPresencePause(tasks, presence, names);
    expect(t1!.paused).toEqual({
      cause: "device_offline",
      since: "2026-11-23T23:01:30.000Z",
      resumes_at: null,
      next_step:
        "It continues when MacBook Pro is back. Assign it to another device to continue now.",
      needs_human: false,
      device: "macbook-pro",
      device_name: "MacBook Pro",
    });
    // The pause event of the session device wins; other tasks stay the same objects.
    expect(t2).toBe(tasks[1]);
    expect(t3).toBe(tasks[2]);
  });

  it("needs the human only for a revoked device, and works with no presence", () => {
    const revoked = {
      offline_tasks: [{ task: "t1", device: "ubuntu-01", cause: "device_revoked", since: "x" }],
    };
    const [t1] = withPresencePause(tasks, revoked, names);
    expect(t1!.paused).toMatchObject({ needs_human: true, device: "ubuntu-01" });
    expect(withPresencePause(tasks, undefined)).toEqual(tasks);
  });
});

describe("withPresencePause for a revoked device (openspec revoke-device)", () => {
  const revoked = {
    offline_tasks: [
      {
        task: "t2",
        device: "ubuntu-01",
        cause: "device_revoked",
        since: "2026-11-23T23:00:00.000Z",
      },
    ],
  };
  const lane = [
    { id: "t2", paused: usage, needs_you_lane: false, needs_you_reasons: [] as unknown[] },
  ];

  it("replaces the own pause, and puts the task in the Needs you lane", () => {
    const [t2] = withPresencePause(lane, revoked, names);
    expect(t2!.paused).toEqual({
      cause: "device_revoked",
      since: "2026-11-23T23:00:00.000Z",
      resumes_at: null,
      next_step: "Change the assignee to continue on another device.",
      needs_human: true,
      device: "ubuntu-01",
      device_name: "ubuntu-01",
    });
    expect(t2!.needs_you_lane).toBe(true);
    expect(t2!.needs_you_reasons).toEqual([{ reason: "paused", cause: "device_revoked" }]);
    // The input stays the same.
    expect(lane[0]!.needs_you_lane).toBe(false);
  });

  it("adds no Needs you reason for an offline device", () => {
    const offline = {
      offline_tasks: [{ ...revoked.offline_tasks[0]!, cause: "device_offline" }],
    };
    const [t2] = withPresencePause([{ ...lane[0]!, paused: null }], offline, names);
    expect(t2!.needs_you_lane).toBe(false);
    expect(t2!.needs_you_reasons).toEqual([]);
  });
});

describe("presencePauseText", () => {
  it("names the device, else uses the slug", () => {
    expect(presencePauseText("device_offline", "macbook-pro", names)).toBe("MacBook Pro offline");
    expect(presencePauseText("device_offline", "ubuntu-01", names)).toBe("ubuntu-01 offline");
    expect(presencePauseText("device_revoked", "macbook-pro", names)).toBe(
      "MacBook Pro was revoked",
    );
    const [t1] = withPresencePause(tasks, presence, names);
    expect(shownPauseText(t1!.paused!, (c) => c)).toBe("MacBook Pro offline");
    expect(shownPauseText(usage, (c) => c.replace("_", " "))).toBe("usage limit");
  });
});
