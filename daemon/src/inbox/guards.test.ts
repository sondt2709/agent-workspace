// The guards of the Inbox (openspec inbox-mattermost): the phone is never the collecting device
// (spec inbox-sources "Phone is not a choice"), and an Inbox route is a person route, so a session
// token gets 403 and writes no event (spec local-api "Agent token").
import { AwApiError, AwClient } from "@aw/client";
import { InboxClient } from "@aw/client/inbox-api";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "../service/errors.ts";
import type { WorkspaceService } from "../service/workspace.ts";
import { sessionsRoot } from "../sessions/records.ts";
import { startTestDaemon, type TestDaemon } from "../testing.ts";
import { configureSource } from "./service.ts";

let d: TestDaemon | null = null;
afterEach(async () => {
  await d?.close();
  d = null;
});

describe("Inbox guards", () => {
  it("refuses a phone as the collecting device before it writes", async () => {
    const write = vi.fn();
    const service = {
      view: {
        devices: [
          { slug: "macbook-pro", role: "local" },
          { slug: "pixel-9", role: "mobile" },
        ],
        projects: [],
      },
      writeEvent: write,
    } as unknown as WorkspaceService;
    const error = await configureSource(service, "mattermost", {
      name: "Mattermost",
      server_url: "https://chat.example.com",
      credential: "mattermost-alex",
      collector: "pixel-9",
      conversations: [],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe("invalid_input");
    expect((error as Error).message).toBe(
      "pixel-9 is a phone. Select a computer as the collecting device.",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("answers 403 refused to a session token on the reply route", async () => {
    d = await startTestDaemon({
      workspace: true,
      sessions: true,
      env: { AW_TMUX: "/nonexistent/tmux", AW_CLAUDE: "/nonexistent/claude" },
    });
    const session = "s-fake";
    const ws = d.server.daemon.workspace().id;
    vi.spyOn(d.server.daemon.sessions!, "caller").mockImplementation((id) => {
      if (id !== session) throw new Error(`unknown session ${id}`);
      return { agent: "claude@macbook-pro", session, task: "AW-1", workspace: ws };
    });
    await mkdir(join(sessionsRoot(d.home), session), { recursive: true, mode: 0o700 });
    const token = await d.server.daemon.sessions!.tokens.ensure(session);
    const agent = new InboxClient(new AwClient({ socketPath: d.settings.socketPath, token }));
    const error = await agent.reply("-", "01a21d30-084c-736f-86fd-788c9a200db7", "Hi").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AwApiError);
    expect((error as AwApiError).status).toBe(403);
    expect((error as AwApiError).code).toBe("refused");
  });
});
