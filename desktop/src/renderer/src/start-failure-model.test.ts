import { describe, expect, it } from "vitest";
import { canRestart, startFailureText } from "./start-failure-model.ts";
import { makeTask } from "./testing.tsx";

describe("start failure model (restart-agent)", () => {
  const failure = {
    device: "ubuntu-01",
    text: "The session did not start on ubuntu-01: Orca is not available. AW tries again in 60 s.",
    at: "2026-11-27T10:00:00.000Z#0000",
    retrying: false,
  };

  it("cuts the prefix and the retry sentence from the cause", () => {
    expect(startFailureText(failure)).toBe("Did not start on ubuntu-01: Orca is not available");
    expect(startFailureText({ ...failure, text: "Another text" })).toBe(
      "Did not start on ubuntu-01: Another text",
    );
    expect(startFailureText({ ...failure, retrying: true })).toBe("Starting again on ubuntu-01…");
  });

  it("offers Restart agent only with an assignee and no running session", () => {
    expect(canRestart(makeTask({ assignee: "claude@ubuntu-01", session: null }))).toBe(true);
    expect(
      canRestart(makeTask({ assignee: "claude@ubuntu-01", session: { state: "ended" } })),
    ).toBe(true);
    expect(
      canRestart(makeTask({ assignee: "claude@ubuntu-01", session: { state: "running" } })),
    ).toBe(false);
    expect(canRestart(makeTask({ assignee: null, session: null }))).toBe(false);
  });
});
