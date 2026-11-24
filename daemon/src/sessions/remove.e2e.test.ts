// The remove of a workspace with sessions (openspec workspace-setup, fix list 0-14): awd stops the
// session manager first, so a session start in its queue ends before the check. A running session
// gives 409 and the workspace stays registered with its manager. Real tmux on a private socket and
// the fake agent.
import { AwApiError } from "@aw/client";
import { SetupClient } from "@aw/client/setup";
import { afterEach, describe, expect, it } from "vitest";
import { startSessionDaemon, TEST_TMUX, waitFor, type SessionTestDaemon } from "./testing.ts";

let awd: SessionTestDaemon | null = null;

afterEach(async () => {
  await awd?.close();
  awd = null;
});

const data = (row: { event: unknown }) => (row.event as { data: Record<string, unknown> }).data;

describe.skipIf(!TEST_TMUX)("remove a workspace with sessions", () => {
  it("refuses a remove while a session runs, and keeps the manager", async () => {
    awd = await startSessionDaemon();
    const task = await awd.createTask("ask Which limit per client? | 100/min|1000/min");
    await awd.waitRow(task.id, (r) => r.type === "gate.opened" && data(r).kind === "question");
    const session = awd.session(task.id);
    const error = await new SetupClient(awd.client)
      .removeWorkspace("acme")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AwApiError);
    expect((error as AwApiError).status).toBe(409);
    expect((error as AwApiError).details).toEqual({ sessions: [session] });
    // Still registered, and the manager runs again: the session shows and stops on request.
    expect((await awd.client.workspaces()).map((w) => w.name)).toEqual(["acme"]);
    expect(awd.server.daemon.sessions!.list().find((r) => r.id === session)?.state).toBe("running");
    expect((await awd.aw(["session", "stop", session])).code).toBe(0);
    await new SetupClient(awd.client).removeWorkspace("acme");
    expect(await awd.client.workspaces()).toEqual([]);
  }, 60_000);

  it("never leaves a session that starts during the remove", async () => {
    awd = await startSessionDaemon();
    // The claim and the session start run in the manager queue after the create.
    const task = await awd.createTask("reply working");
    const removed = await new SetupClient(awd.client).removeWorkspace("acme").then(
      () => true,
      (e: unknown) => {
        expect((e as AwApiError).status).toBe(409);
        return false;
      },
    );
    const windows = async () =>
      (await awd!.host.list()).filter((p) => p.name === `aw-${task.id}` && !p.dead);
    if (removed) {
      // No manager watches the workspace: no window may open later.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(await windows()).toEqual([]);
    } else {
      await waitFor(async () => (await windows()).length === 1, 10_000);
      expect(awd.server.daemon.sessions!.list().some((r) => r.task === task.id)).toBe(true);
    }
  }, 60_000);
});
