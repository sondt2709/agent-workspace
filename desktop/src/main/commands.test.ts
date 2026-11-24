import { describe, expect, it } from "vitest";
import type { AppCommand } from "../shared/channels.ts";
import { CommandQueue } from "./commands.ts";

describe("CommandQueue (fix list 0-12)", () => {
  it("keeps the command of a new window until its renderer listens", () => {
    const sent: AppCommand[] = [];
    const queue = new CommandQueue((command) => sent.push(command));
    // A notification click makes a new window: the page loads, then React subscribes.
    queue.reset();
    queue.send({ open: "task", ws: "w1", task: "t1" });
    expect(sent).toEqual([]);
    queue.ready();
    expect(sent).toEqual([{ open: "task", ws: "w1", task: "t1" }]);
    queue.ready();
    expect(sent).toHaveLength(1);
  });

  it("sends at once while the renderer listens, and waits again after a new load", () => {
    const sent: AppCommand[] = [];
    const queue = new CommandQueue((command) => sent.push(command));
    queue.ready();
    queue.send("sync-now");
    expect(sent).toEqual(["sync-now"]);
    queue.reset();
    queue.send("new-task");
    queue.send("sync-now");
    expect(sent).toEqual(["sync-now"]);
    queue.ready();
    expect(sent).toEqual(["sync-now", "sync-now"]);
  });
});
