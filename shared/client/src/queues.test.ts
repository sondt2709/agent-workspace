// The queues reply (openspec queue-and-assign): awd checks its reply with the closed list of cause
// codes; a client reads any code, so a newer awd does not break an older desktop (review low 4).
import { describe, expect, it } from "vitest";
import { queuesReply, queuesReplyRead } from "./queues.ts";

const reply = (code: string) => ({
  device: "macbook-pro",
  agents: [
    {
      agent: "claude@ubuntu-01",
      device: "ubuntu-01",
      max_working: 2,
      working: 0,
      tasks: [
        {
          task: "t1",
          key: "AW-3",
          title: "Task 3",
          position: 1,
          text: "Queued · 1st for claude@ubuntu-01",
          cause: { code, text: "Waiting for test slot" },
        },
      ],
    },
  ],
  unassigned: [],
});

describe("queues reply", () => {
  it("reads a cause code of a newer awd, and awd still checks its own codes", () => {
    expect(queuesReplyRead.safeParse(reply("test_slot")).success).toBe(true);
    expect(queuesReply.safeParse(reply("test_slot")).success).toBe(false);
    expect(queuesReply.safeParse(reply("starting")).success).toBe(true);
  });
});
