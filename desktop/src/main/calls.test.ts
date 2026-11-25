import { AwApiError, AwUnreachableError } from "@aw/client";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Appearance } from "../shared/channels.ts";
import {
  dispatchCall,
  isTrustedSender,
  type CallClient,
  type CallDeps,
  type DesktopCallClient,
  type HostDeps,
  type IdentityCallClient,
  type KnowledgeCallClient,
} from "./calls.ts";
import { openableFolder, openablePath } from "./files.ts";
import type { SetupCallClient } from "./setup-calls.ts";
import type { TerminalLauncher } from "./terminal.ts";

function deps(
  client: Partial<CallClient> = {},
  more: {
    identity?: Partial<IdentityCallClient>;
    knowledge?: Partial<KnowledgeCallClient>;
    desktop?: Partial<DesktopCallClient>;
    setup?: Partial<SetupCallClient>;
    host?: Partial<HostDeps>;
    terminal?: TerminalLauncher;
  } = {},
): CallDeps & { opened: ReturnType<typeof vi.fn> } {
  const opened = vi.fn(() => Promise.resolve());
  return {
    client: client as CallClient,
    identity: (more.identity ?? {}) as IdentityCallClient,
    knowledge: (more.knowledge ?? {}) as KnowledgeCallClient,
    desktop: (more.desktop ?? {}) as DesktopCallClient,
    setup: (more.setup ?? {}) as SetupCallClient,
    host: (more.host ?? {}) as HostDeps,
    connection: () => ({ state: "connecting" }),
    openExternal: opened,
    terminal: more.terminal ?? { inTerminal: vi.fn(), orcaWorktree: vi.fn() },
    opened,
  };
}

describe("isTrustedSender", () => {
  it("accepts app://aw and the dev server, and refuses other frames", () => {
    expect(isTrustedSender("app://aw/index.html#/inbox", null)).toBe(true);
    expect(isTrustedSender("http://localhost:5173/", "http://localhost:5173")).toBe(true);
    expect(isTrustedSender("http://localhost:5173/", null)).toBe(false);
    expect(isTrustedSender("https://example.com/", "http://localhost:5173")).toBe(false);
    expect(isTrustedSender("app://other/index.html", null)).toBe(false);
    expect(isTrustedSender(undefined, null)).toBe(false);
  });
});

describe("dispatchCall", () => {
  it("refuses a method that is not in the contract and calls nothing", async () => {
    const archiveTask = vi.fn();
    const result = await dispatchCall(
      { method: "deleteEverything", args: {} },
      deps({ archiveTask }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(archiveTask).not.toHaveBeenCalled();
  });

  it("refuses extra arguments", async () => {
    const tasks = vi.fn();
    const result = await dispatchCall(
      { method: "tasks", args: { ws: "-", path: "/v1/sync/now" } },
      deps({ tasks }),
    );
    expect(result.ok).toBe(false);
    expect(tasks).not.toHaveBeenCalled();
  });

  it("calls the client with the arguments and returns the value", async () => {
    const answerGate = vi.fn(() => Promise.resolve({ applied: true }));
    const result = await dispatchCall(
      {
        method: "answerGate",
        args: { ws: "-", gate: "0193a", body: { answer: "100/min", version: 2 } },
      },
      deps({ answerGate } as unknown as Partial<CallClient>),
    );
    expect(result).toEqual({ ok: true, value: { applied: true } });
    expect(answerGate).toHaveBeenCalledWith("-", "0193a", { answer: "100/min", version: 2 });
  });

  it("maps awd errors to plain data", async () => {
    const task = vi.fn(() =>
      Promise.reject(
        new AwApiError(
          404,
          { error: { code: "not_found", message: "No task AW-9" }, trace_id: "t" },
          "x",
        ),
      ),
    );
    expect(
      await dispatchCall({ method: "task", args: { ws: "-", task: "AW-9" } }, deps({ task })),
    ).toEqual({
      ok: false,
      error: { code: "not_found", message: "No task AW-9", status: 404 },
    });
    // gate-full-context: the details of an awd error reach the renderer (the answer of a gate).
    const answerGate = vi.fn(() =>
      Promise.reject(
        new AwApiError(
          409,
          {
            error: {
              code: "gate_not_open",
              message: "The gate g1 is resolved",
              details: { gate: "g1", answer: "Approve" },
            },
            trace_id: "t",
          },
          "x",
        ),
      ),
    );
    expect(
      await dispatchCall(
        { method: "answerGate", args: { ws: "-", gate: "g1", body: { answer: "No" } } },
        deps({ answerGate }),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "gate_not_open",
        message: "The gate g1 is resolved",
        status: 409,
        details: { gate: "g1", answer: "Approve" },
      },
    });
    const status = vi.fn(() => Promise.reject(new AwUnreachableError("/tmp/awd.sock", "ENOENT")));
    expect(await dispatchCall({ method: "status", args: {} }, deps({ status }))).toMatchObject({
      ok: false,
      error: { code: "unreachable", status: null },
    });
  });

  it("opens only https links", async () => {
    const d = deps();
    expect(
      (await dispatchCall({ method: "openExternal", args: { url: "file:///etc/passwd" } }, d)).ok,
    ).toBe(false);
    expect(
      await dispatchCall({ method: "openExternal", args: { url: "https://example.com/" } }, d),
    ).toEqual({
      ok: true,
      value: { opened: true },
    });
    expect(d.opened).toHaveBeenCalledTimes(1);
  });
});

describe("calls of the devices, knowledge and files screens", () => {
  it("has no call that reads a credential value", async () => {
    const result = await dispatchCall(
      { method: "credentialValue", args: { ws: "-", name: "stripe-test" } },
      deps(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("sends a credential value once, and refuses a bad name", async () => {
    const addCredential = vi.fn(() => Promise.resolve({ name: "stripe-test" }));
    const d = deps({}, { identity: { addCredential } as unknown as Partial<IdentityCallClient> });
    expect(
      (
        await dispatchCall(
          { method: "addCredential", args: { ws: "-", name: "Stripe Test", value: "x" } },
          d,
        )
      ).ok,
    ).toBe(false);
    await dispatchCall(
      { method: "addCredential", args: { ws: "-", name: "stripe-test", value: "sk_1" } },
      d,
    );
    expect(addCredential).toHaveBeenCalledExactlyOnceWith("-", "stripe-test", "sk_1");
  });

  it("splits the knowledge accept arguments into the id and the body", async () => {
    const accept = vi.fn(() =>
      Promise.resolve({ change: null, suggestion: null, unchanged: true }),
    );
    await dispatchCall(
      { method: "kbAccept", args: { ws: "-", suggestion: "s1", force: true, comment: "ok" } },
      deps({}, { knowledge: { accept } }),
    );
    expect(accept).toHaveBeenCalledWith("-", "s1", { force: true, comment: "ok" });
  });

  it("passes the Sync now timeout and checks the pairing id and check code", async () => {
    const syncNow = vi.fn(() => Promise.resolve({ at: "x", pending: [] }));
    await dispatchCall(
      { method: "syncNow", args: { timeout_ms: 5000 } },
      deps({ syncNow } as unknown as Partial<CallClient>),
    );
    expect(syncNow).toHaveBeenCalledWith({ timeout_ms: 5000 });
    const approve = vi.fn(() => Promise.resolve({}));
    const d = deps({}, { identity: { approve } as unknown as Partial<IdentityCallClient> });
    const id = "0123456789abcdef0123456789abcdef";
    expect(
      (await dispatchCall({ method: "approvePairing", args: { id, check_code: "12 34" } }, d)).ok,
    ).toBe(false);
    expect(
      (
        await dispatchCall(
          { method: "approvePairing", args: { id: "../x", check_code: "123456" } },
          d,
        )
      ).ok,
    ).toBe(false);
    await dispatchCall({ method: "approvePairing", args: { id, check_code: "482 913" } }, d);
    expect(approve).toHaveBeenCalledExactlyOnceWith(id, "482 913");
  });

  it("joins with a pairing code and an optional absolute location, no path or device name (fix list 0-16, workspace-folder)", async () => {
    const join = vi.fn(() => Promise.resolve({ id: "p1", state: "check" }));
    const d = deps({}, { identity: { join } as unknown as Partial<IdentityCallClient> });
    const short = await dispatchCall({ method: "joinPairing", args: { code: "aw1:x" } }, d);
    expect(short.ok).toBe(false);
    const extra = await dispatchCall(
      { method: "joinPairing", args: { code: "aw1:EXAMPLECODE", path: "/etc" } },
      d,
    );
    expect(extra.ok).toBe(false);
    const ok = await dispatchCall({ method: "joinPairing", args: { code: "aw1:EXAMPLECODE" } }, d);
    expect(ok).toEqual({ ok: true, value: { id: "p1", state: "check" } });
    expect(join).toHaveBeenCalledExactlyOnceWith({ code: "aw1:EXAMPLECODE" });
    const relative = await dispatchCall(
      { method: "joinPairing", args: { code: "aw1:EXAMPLECODE", parent: "Work" } },
      d,
    );
    expect(relative.ok).toBe(false);
    await dispatchCall(
      { method: "joinPairing", args: { code: "aw1:EXAMPLECODE", parent: "/Users/example/Work" } },
      d,
    );
    expect(join).toHaveBeenLastCalledWith({
      code: "aw1:EXAMPLECODE",
      parent: "/Users/example/Work",
    });
  });
});

describe("recovery phrase calls (keys-backup)", () => {
  it("sends copyPhrase and savePhrase to the phrase backup of main", async () => {
    const copyPhrase = vi.fn(() =>
      Promise.resolve({ copied: true as const, clear_after_ms: 60_000 }),
    );
    const savePhrase = vi.fn(() => Promise.resolve({ saved: true, path: "/tmp/phrase.txt" }));
    const d = deps({}, { host: { copyPhrase, savePhrase } });
    expect(await dispatchCall({ method: "copyPhrase", args: {} }, d)).toEqual({
      ok: true,
      value: { copied: true, clear_after_ms: 60_000 },
    });
    expect(await dispatchCall({ method: "savePhrase", args: {} }, d)).toEqual({
      ok: true,
      value: { saved: true, path: "/tmp/phrase.txt" },
    });
    expect(copyPhrase).toHaveBeenCalledTimes(1);
    expect(savePhrase).toHaveBeenCalledTimes(1);
  });

  it("refuses a phrase, a text or a path from the renderer", async () => {
    const copyPhrase = vi.fn();
    const savePhrase = vi.fn();
    const d = deps({}, { host: { copyPhrase, savePhrase } });
    for (const request of [
      { method: "copyPhrase", args: { text: "abandon art" } },
      { method: "savePhrase", args: { path: "/tmp/x.txt" } },
      { method: "savePhrase", args: { phrase: "abandon art" } },
    ]) {
      const result = await dispatchCall(request, d);
      expect(result.ok).toBe(false);
    }
    expect(copyPhrase).not.toHaveBeenCalled();
    expect(savePhrase).not.toHaveBeenCalled();
  });
});

describe("openWorkspaceFile", () => {
  let root: string;

  async function setup() {
    root = await mkdtemp(join(tmpdir(), "aw-open-"));
    await mkdir(join(root, "tasks", "projects", "billing-api"), { recursive: true });
    await writeFile(join(root, "tasks", "projects", "billing-api", "project.yaml"), "kind: x\n");
    await writeFile(join(root, "tasks", "run.command"), "#!/bin/sh\n");
    await symlink("/etc/hosts", join(root, "tasks", "out.yaml"));
    // Fix list 0-10: a synced link inside the folder to a program, a link in a parent folder,
    // and a folder with a document name.
    await mkdir(join(root, "tasks", "projects", "x"), { recursive: true });
    await writeFile(join(root, "tasks", "evil.command"), "#!/bin/sh\n", { mode: 0o755 });
    await symlink("../../evil.command", join(root, "tasks", "projects", "x", "project.yaml"));
    await symlink("billing-api", join(root, "tasks", "projects", "linked"));
    await mkdir(join(root, "tasks", "folder.yaml"));
  }

  function openDeps(issuePaths: string[]) {
    const openPath = vi.fn(() => Promise.resolve(""));
    const d = deps(
      {
        workspaces: () => Promise.resolve([{ id: "w1", name: "acme", path: root } as never]),
        issues: () =>
          Promise.resolve(issuePaths.map((path) => ({ code: "bad_document", path }) as never)),
      },
      { host: { openPath, openablePath } },
    );
    return { d, openPath };
  }

  it("opens the file of a schema issue inside the workspace", async () => {
    await setup();
    try {
      const path = "tasks/projects/billing-api/project.yaml";
      const { d, openPath } = openDeps([path]);
      const result = await dispatchCall(
        { method: "openWorkspaceFile", args: { ws: "w1", path } },
        d,
      );
      expect(result).toEqual({ ok: true, value: { opened: true } });
      expect(openPath).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a file with no issue, a program, a link and a folder", async () => {
    await setup();
    try {
      const cases = [
        { path: "tasks/projects/billing-api/project.yaml", issues: [] },
        { path: "tasks/run.command", issues: ["tasks/run.command"] },
        { path: "tasks/out.yaml", issues: ["tasks/out.yaml"] },
        { path: "tasks/../../etc/hosts.yaml", issues: ["tasks/../../etc/hosts.yaml"] },
        { path: "tasks/projects/x/project.yaml", issues: ["tasks/projects/x/project.yaml"] },
        {
          path: "tasks/projects/linked/project.yaml",
          issues: ["tasks/projects/linked/project.yaml"],
        },
        { path: "tasks/folder.yaml", issues: ["tasks/folder.yaml"] },
      ];
      for (const c of cases) {
        const { d, openPath } = openDeps(c.issues);
        const result = await dispatchCall(
          { method: "openWorkspaceFile", args: { ws: "w1", path: c.path } },
          d,
        );
        expect(result, c.path).toMatchObject({ ok: false, error: { code: "refused" } });
        expect(openPath).not.toHaveBeenCalled();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("setup calls (gap-setup)", () => {
  it("sends each setup call to the setup client with its arguments", async () => {
    const editBindings = vi.fn(() => Promise.resolve({ device: "macbook-pro" }));
    const setSyncSettings = vi.fn(() => Promise.resolve({ community: false }));
    const initWorkspace = vi.fn(() => Promise.resolve({ created: true }));
    const d = deps(
      {},
      {
        setup: {
          editBindings,
          setSyncSettings,
          initWorkspace,
        } as unknown as Partial<SetupCallClient>,
      },
    );
    const body = { checkouts: [{ project: "billing-api", path: "/srv/billing-api" }] };
    expect(await dispatchCall({ method: "editBindings", args: { ws: "-", body } }, d)).toEqual({
      ok: true,
      value: { device: "macbook-pro" },
    });
    expect(editBindings).toHaveBeenCalledWith("-", body);
    await dispatchCall({ method: "setSyncSettings", args: { community: false } }, d);
    expect(setSyncSettings).toHaveBeenCalledWith(false);
    await dispatchCall({ method: "initWorkspace", args: {} }, d);
    expect(initWorkspace).toHaveBeenCalledWith({});
    await dispatchCall(
      { method: "initWorkspace", args: { name: "demo", parent: "/Users/example/Work" } },
      d,
    );
    expect(initWorkspace).toHaveBeenLastCalledWith({ name: "demo", parent: "/Users/example/Work" });
    const relative = await dispatchCall(
      { method: "initWorkspace", args: { name: "demo", parent: "Work" } },
      d,
    );
    expect(relative.ok).toBe(false);
  });

  it("refuses a bad setup call and calls nothing", async () => {
    const editBindings = vi.fn();
    const d = deps({}, { setup: { editBindings } as unknown as Partial<SetupCallClient> });
    for (const args of [
      { ws: "-", body: { use_orca: "yes" } },
      { ws: "-", body: { checkouts: [{ project: "Billing API", path: "/x" }] } },
      { ws: "-", body: { vapid_public_key: "B" } },
    ]) {
      expect((await dispatchCall({ method: "editBindings", args }, d)).ok).toBe(false);
    }
    expect(editBindings).not.toHaveBeenCalled();
  });
});

describe("setAppearance (openspec screens-align)", () => {
  it("sends the choice to the host and refuses another value", async () => {
    const setAppearance = vi.fn((appearance: Appearance) =>
      Promise.resolve({
        appearance,
        proposal_text_px: 16,
        login: { supported: false, open: false, status: null },
        notifications: false,
        notification_error: null,
      }),
    );
    const d = deps({}, { host: { setAppearance } });
    const ok = await dispatchCall({ method: "setAppearance", args: { appearance: "light" } }, d);
    expect(ok).toMatchObject({ ok: true, value: { appearance: "light" } });
    expect(setAppearance).toHaveBeenCalledWith("light");
    for (const args of [{ appearance: "blue" }, { appearance: "dark", extra: 1 }, {}]) {
      const refused = await dispatchCall({ method: "setAppearance", args }, d);
      expect(refused).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(setAppearance).toHaveBeenCalledTimes(1);
  });
});

describe("setProposalTextSize (proposal-and-discussion)", () => {
  it("sends a size of 14 to 24 px in steps of 2 to the host, and refuses another value", async () => {
    const setProposalTextSize = vi.fn((px: number) =>
      Promise.resolve({
        appearance: "system" as const,
        proposal_text_px: px,
        login: { supported: false, open: false, status: null },
        notifications: false,
        notification_error: null,
      }),
    );
    const d = deps({}, { host: { setProposalTextSize } });
    const ok = await dispatchCall({ method: "setProposalTextSize", args: { px: 18 } }, d);
    expect(ok).toMatchObject({ ok: true, value: { proposal_text_px: 18 } });
    expect(setProposalTextSize).toHaveBeenCalledWith(18);
    for (const args of [{ px: 12 }, { px: 26 }, { px: 17 }, { px: 16.5 }, { px: "16" }, {}]) {
      const refused = await dispatchCall({ method: "setProposalTextSize", args }, d);
      expect(refused).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(setProposalTextSize).toHaveBeenCalledTimes(1);
  });
});

describe("chooseFolder (create-flows)", () => {
  it("sends the purpose and the start folder to the folder picker of main", async () => {
    const chooseFolder = vi.fn(() =>
      Promise.resolve({
        path: "/Users/example/dev/example-org/billing-api",
        name: "billing-api",
        git: true,
      }),
    );
    const d = deps({}, { host: { chooseFolder } });
    expect(
      await dispatchCall(
        {
          method: "chooseFolder",
          args: { purpose: "checkout", default_path: "/Users/example/dev" },
        },
        d,
      ),
    ).toEqual({
      ok: true,
      value: { path: "/Users/example/dev/example-org/billing-api", name: "billing-api", git: true },
    });
    expect(chooseFolder).toHaveBeenCalledExactlyOnceWith({
      purpose: "checkout",
      default_path: "/Users/example/dev",
    });
  });

  it("refuses a relative start folder, an unknown purpose and other fields", async () => {
    const chooseFolder = vi.fn();
    const d = deps({}, { host: { chooseFolder } });
    for (const args of [
      { purpose: "checkout", default_path: "dev/billing-api" },
      { purpose: "home" },
      { purpose: "checkout", path: "/etc" },
    ]) {
      const reply = await dispatchCall({ method: "chooseFolder", args }, d);
      expect(reply).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(chooseFolder).not.toHaveBeenCalled();
  });
});

describe("openSessionFolder (session-options)", () => {
  const session = (task: string, cwd: string, workspace = "w1") =>
    ({ id: `s-${cwd}`, workspace, task, cwd, state: "ended" }) as never;

  it("opens the folder of the newest session of the task in this workspace", async () => {
    const openPath = vi.fn(() => Promise.resolve(""));
    const d = deps(
      {
        workspaces: () => Promise.resolve([{ id: "w1", name: "acme", path: "/AW/acme" } as never]),
        sessions: () =>
          Promise.resolve([
            session("t1", "/home/user/.aw/worktrees/aw-AW-1"),
            session("t1", "/work/billing-api"),
            session("t1", "/work/other-workspace", "w2"),
            session("t2", "/tmp/other"),
          ]),
      },
      { host: { openPath, openableFolder: (path) => Promise.resolve(path) } },
    );
    const result = await dispatchCall(
      { method: "openSessionFolder", args: { ws: "w1", task: "t1" } },
      d,
    );
    expect(result).toEqual({ ok: true, value: { opened: true, path: "/work/billing-api" } });
    expect(openPath).toHaveBeenCalledWith("/work/billing-api");
  });

  it("opens nothing for a task with no session on this device, and takes no path", async () => {
    const openPath = vi.fn(() => Promise.resolve(""));
    const d = deps(
      {
        workspaces: () => Promise.resolve([{ id: "w1", name: "acme", path: "/AW/acme" } as never]),
        sessions: () => Promise.resolve([]),
      },
      { host: { openPath } },
    );
    const result = await dispatchCall(
      { method: "openSessionFolder", args: { ws: "w1", task: "t1" } },
      d,
    );
    expect(result).toMatchObject({ ok: false });
    expect(openPath).not.toHaveBeenCalled();
    const withPath = await dispatchCall(
      { method: "openSessionFolder", args: { ws: "w1", task: "t1", path: "/etc" } },
      d,
    );
    expect(withPath).toMatchObject({ ok: false });
  });

  // fc1-d4: with work_in folder, the session folder can be an app bundle. Finder starts a bundle
  // that openPath opens, so main opens only a real folder that is not a bundle.
  it("opens a real folder and refuses a bundle, a link to a bundle and a file", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-session-folder-"));
    try {
      await mkdir(join(root, "work"));
      await mkdir(join(root, "Tool.app", "Contents"), { recursive: true });
      await mkdir(join(root, "Plain", "Contents"), { recursive: true });
      await writeFile(join(root, "Plain", "Contents", "Info.plist"), "<plist/>\n");
      await symlink(join(root, "Tool.app"), join(root, "linked"));
      await writeFile(join(root, "notes.txt"), "x\n");
      const open = async (cwd: string) => {
        const openPath = vi.fn(() => Promise.resolve(""));
        const d = deps(
          {
            workspaces: () =>
              Promise.resolve([{ id: "w1", name: "acme", path: "/AW/acme" } as never]),
            sessions: () => Promise.resolve([session("t1", cwd)]),
          },
          { host: { openPath, openableFolder } },
        );
        const result = await dispatchCall(
          { method: "openSessionFolder", args: { ws: "w1", task: "t1" } },
          d,
        );
        return { result, openPath };
      };
      for (const name of ["Tool.app", "linked", "Plain", "notes.txt", "missing"]) {
        const refused = await open(join(root, name));
        expect(refused.result, name).toMatchObject({ ok: false });
        expect(refused.openPath, name).not.toHaveBeenCalled();
      }
      const work = await open(join(root, "work"));
      expect(work.result).toMatchObject({ ok: true });
      expect(work.openPath).toHaveBeenCalledWith(await realpath(join(root, "work")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
