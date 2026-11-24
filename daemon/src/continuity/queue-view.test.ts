// The queue view runs each case of the shared contract fixture (the Kotlin port runs the same file).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentQueues,
  healthLimits,
  ordinal,
  queueLabel,
  type AgentQueue,
  type QueueDevice,
  type QueueOrder,
  type QueueTask,
} from "./queue-view.ts";

interface Case {
  name: string;
  description: string;
  now: string;
  tasks: QueueTask[];
  orders: QueueOrder[];
  devices: QueueDevice[];
  expected: AgentQueue[];
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../contracts/fixtures/queue/cases.json", import.meta.url)),
    "utf8",
  ),
) as { ordinals: [number, string][]; cases: Case[] };

describe("queue view (contracts/fixtures/queue)", () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(
      agentQueues({
        tasks: c.tasks,
        orders: c.orders,
        devices: c.devices,
        now: Date.parse(c.now),
      }),
    ).toEqual(c.expected);
  });

  it("writes the English ordinals", () => {
    for (const [n, text] of fixture.ordinals) expect(ordinal(n)).toBe(text);
  });

  it("writes the label with and without a position", () => {
    expect(queueLabel("claude@ubuntu-01", 2)).toBe("Queued · 2nd for claude@ubuntu-01");
    expect(queueLabel("claude@ubuntu-01", null)).toBe("Queued for claude@ubuntu-01");
  });

  it("reads the defaults from a missing or broken health file", () => {
    const now = Date.parse("2026-11-22T14:30:00.000Z");
    expect(healthLimits(null, now)).toEqual({
      maxWorking: 2,
      diskFullPercent: 95,
      loginValid: null,
      fiveHour: null,
      disk: null,
    });
    expect(healthLimits({ queue: "x", usage: "y", disk: 3 }, now).maxWorking).toBe(2);
  });
});
