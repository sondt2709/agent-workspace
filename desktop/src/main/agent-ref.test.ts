import { assignBody } from "@aw/client/schemas";
import { describe, expect, it } from "vitest";
import { isAgentRef } from "../shared/agent-ref.ts";

describe("isAgentRef", () => {
  it("accepts and refuses the same values as the assign route of awd", () => {
    const values = [
      "claude@ubuntu-01",
      "claude@mac-mini-lab",
      "codex-2@pixel-9",
      "claude@ubuntu-",
      "claude@ubuntu--01",
      "claude@-ubuntu",
      "Claude@ubuntu-01",
      "claude@",
      "@ubuntu-01",
      "claude@ubuntu 01",
      `claude@${"a".repeat(130)}`,
    ];
    for (const value of values) {
      expect(isAgentRef(value), value).toBe(assignBody.shape.assignee.safeParse(value).success);
    }
  });
});
