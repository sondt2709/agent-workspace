// `aw queue` (openspec queue-and-assign): the text of the queues, the command against awd, and the
// refusal in a session.
import type { QueuesReply } from "@aw/client/queues";
import { afterEach, describe, expect, it } from "vitest";
import { startTestDaemon, type TestDaemon } from "../testing.ts";
import { formatQueues } from "./queue.ts";

const reply: QueuesReply = {
  device: "macbook-pro",
  agents: [
    {
      agent: "claude@ubuntu-01",
      device: "ubuntu-01",
      max_working: 2,
      working: 2,
      tasks: [
        {
          task: "01a2038e-0000-7000-8000-000000000003",
          key: "AW-3",
          title: "Rate limit",
          position: 1,
          text: "Queued · 1st for claude@ubuntu-01",
          cause: { code: "max_working", text: "2 sessions working" },
        },
        {
          task: "01a2038e-0000-7000-8000-000000000004",
          key: "AW-4",
          title: "Docs",
          position: 2,
          text: "Queued · 2nd for claude@ubuntu-01",
          cause: { code: "max_working", text: "2 sessions working" },
        },
        {
          task: "01a2038e-0000-7000-8000-000000000006",
          key: "AW-6",
          title: "Release",
          position: null,
          text: "Queued for claude@ubuntu-01",
          cause: { code: "dependencies", text: "waits for AW-3" },
        },
      ],
    },
  ],
  unassigned: [
    {
      task: "01a2038e-0000-7000-8000-000000000005",
      key: "AW-5",
      title: "Write the tests",
      created_by: "claude@ubuntu-01",
      by_agent: true,
    },
  ],
};

describe("formatQueues", () => {
  it("prints each agent, the position, the key, the title and the cause", () => {
    expect(formatQueues(reply)).toBe(
      [
        "claude@ubuntu-01 · 2 of 2 sessions working",
        "  1st  AW-3  Rate limit  2 sessions working",
        "  2nd  AW-4  Docs        2 sessions working",
        "  -    AW-6  Release     waits for AW-3",
        "Needs an assignee:",
        "  AW-5  Write the tests  created by claude@ubuntu-01",
      ].join("\n"),
    );
  });

  it("says when no task waits", () => {
    expect(formatQueues({ device: "macbook-pro", agents: [], unassigned: [] })).toBe(
      "No task waits for a session.",
    );
  });
});

describe("aw queue", () => {
  let d: TestDaemon;
  afterEach(async () => {
    await d.close();
  });

  it("prints the queues of awd, and refuses the command in a session", async () => {
    d = await startTestDaemon({ workspace: true });
    await d.client.createTask("-", {
      project: "billing-api",
      title: "Parked idea",
      first_message: "x",
    });
    const shown = await d.aw(["queue"]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toBe(
      "No task waits for a session.\nNeeds an assignee:\n  AW-1  Parked idea  created by human@macbook-pro\n",
    );
    const json = await d.aw(["--json", "queue"]);
    expect((JSON.parse(json.stdout) as QueuesReply).unassigned[0]?.by_agent).toBe(false);
    const inSession = await d.aw(["queue"], {
      env: { AW_HOME: d.home, HOME: d.home, AW_SESSION: "0198a5c3-0000-7000-8000-000000000001" },
    });
    expect(inSession.code).toBe(1);
    expect(inSession.stderr).toContain("aw queue is a command of a person");
  });
});
