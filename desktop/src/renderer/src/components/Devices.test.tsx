import { focusManager } from "@tanstack/react-query";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DeviceEntryView,
  PairingView,
  SyncNowReply,
  WorkspaceSummary,
} from "../../../shared/channels.ts";
import { installBridge, makeTask, renderApp } from "../testing.tsx";
import { DevicesPage, RevokeDialog } from "./Devices.tsx";
import { DialogsProvider } from "./dialogs.tsx";
import { PairDialog } from "./Pairing.tsx";
import { AssignDeviceDialog, SyncDialog } from "./SyncDialog.tsx";
import { NeedsYouCards } from "./TaskDetail.tsx";

afterEach(cleanup);

const noop = () => undefined;

function argsOf(call: ReturnType<typeof installBridge>, method: string) {
  return call.mock.calls.filter(([m]) => m === method).map(([, args]) => args);
}

const PEER = {
  device: "ubuntu-01",
  connected: false,
  needItems: 3,
  needBytes: 900,
  inSync: false,
  text: "3 changes not synced to ubuntu-01 (offline)",
  folders: [
    {
      folder: "aw-w-tasks",
      workspace: "w",
      kind: "tasks",
      needItems: 3,
      needBytes: 900,
      remoteState: "valid",
      inSync: false,
    },
  ],
};

const STATUS = {
  engine: "running",
  device: "macbook-pro",
  sync_id: null,
  paused: false,
  pids: [],
  peers: [PEER],
};

function device(slug: string, extra: Partial<DeviceEntryView> = {}): DeviceEntryView {
  return {
    slug,
    name: slug === "macbook-pro" ? "MacBook Pro" : "ubuntu-01",
    role: slug === "macbook-pro" ? "local" : "remote",
    state: "valid",
    sync_device_id: "X",
    seq: 1,
    paired_at: "2026-11-23T09:00:00.000Z",
    revoked_at: null,
    this_device: slug === "macbook-pro",
    ...extra,
  };
}

describe("SyncDialog", () => {
  it("syncs once, shows the devices that are not synced, and suggests no move", async () => {
    const reply: SyncNowReply = {
      at: "2026-11-23T10:00:00.000Z",
      pending: [{ device: "ubuntu-01", items: 3, reason: "offline" }],
      status: STATUS,
    } as SyncNowReply;
    const call = installBridge({ syncNow: () => reply });
    renderApp(<SyncDialog onClose={noop} />);
    expect(await screen.findAllByText("3 changes not synced to ubuntu-01 (offline)")).toHaveLength(
      2,
    );
    expect(argsOf(call, "syncNow")).toHaveLength(1);
    expect(screen.queryByText(/move|assign/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sync again" }));
    await waitFor(() => expect(argsOf(call, "syncNow")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

const WORKSPACE: WorkspaceSummary = {
  id: "ws-1",
  name: "demo",
  path: "/Users/example/Work/demo",
  ready: true,
  error: null,
  tasks: 0,
  open_gates: 0,
  issues: 0,
  notices: [],
  last_hlc: null,
};

describe("DevicesPage", () => {
  it("shows each device with its sync text, folders and Revoke only for another device", async () => {
    installBridge({
      devices: () => [device("macbook-pro"), device("ubuntu-01")],
      presence: () => ({
        now: "2026-11-23T10:00:00.000Z",
        devices: [
          {
            device: "ubuntu-01",
            online: false,
            last_heartbeat_hlc: "x",
            received_at: "2026-11-23T09:00:00.000Z",
            offline_since: "2026-11-23T09:01:30.000Z",
          },
        ],
        offline_tasks: [],
      }),
      syncStatus: () => STATUS,
    });
    renderApp(<DevicesPage />, { route: "/w/:ws/devices", url: "/w/ws-1/devices" });
    expect(await screen.findByText("3 changes not synced to ubuntu-01 (offline)")).toBeTruthy();
    expect(screen.getByText(/^Offline since/)).toBeTruthy();
    expect(screen.getByText("Tasks · 3 not synced")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });
});

describe("DevicesPage cards (openspec screens-align)", () => {
  it("shows the agent, sessions, hosts, Use Orca, checkouts and test slots of each computer", async () => {
    const running = makeTask({
      assignee: "claude@macbook-pro",
      owner: "macbook-pro",
      session: {
        session: "s",
        device: "macbook-pro",
        host: "tmux",
        state: "running",
        reason: null,
      },
      claim: { epoch: 1, device: "macbook-pro", session: "s" },
    });
    installBridge({
      tasks: () => [running],
      devices: () => [device("ubuntu-01"), device("macbook-pro")],
      presence: () => ({ now: "2026-11-23T10:00:00.000Z", devices: [], offline_tasks: [] }),
      syncStatus: () => STATUS,
      queues: () => ({
        device: "macbook-pro",
        unassigned: [],
        agents: [
          {
            agent: "claude@ubuntu-01",
            device: "ubuntu-01",
            max_working: 3,
            working: 0,
            tasks: [
              {
                task: "t",
                key: "AW-3",
                title: null,
                position: 1,
                text: "Queued · 1st for claude@ubuntu-01",
                cause: { code: "max_working", text: "x" },
              },
            ],
          },
        ],
      }),
      sessionHosts: () => ({
        device: "macbook-pro",
        devices: [
          {
            device: "macbook-pro",
            may_run: true,
            use_orca: true,
            checkouts: [{ project: "billing-api", session_host: null }],
            orca: { available: true, version: "1.4.257", reason: null },
          },
          {
            device: "ubuntu-01",
            may_run: true,
            use_orca: false,
            checkouts: [{ project: "web-app", session_host: "tmux" }],
            orca: null,
          },
        ],
      }),
      bindings: () => ({
        device: "macbook-pro",
        may_run: true,
        use_orca: true,
        checkouts: [],
        resources: { k3d: 1, browser: 2 },
      }),
      workspaces: () => [
        { ...WORKSPACE, id: "ws-0", path: "/Users/example/AW/Personal" },
        { ...WORKSPACE, id: "ws-1", path: "/Users/example/Work/demo-aw1" },
      ],
    });
    renderApp(<DevicesPage />, { route: "/w/:ws/devices", url: "/w/ws-1/devices" });
    const mine = await screen
      .findByRole("article", { name: "Device MacBook Pro" })
      .catch(() => screen.findByLabelText("Device MacBook Pro"));
    // No queue entry: the agent comes from the project, and "working" from the running session.
    expect(await within(mine).findByText("1 working · queue 0")).toBeTruthy();
    expect(within(mine).getByText("claude@macbook-pro")).toBeTruthy();
    expect(within(mine).getByText("tmux · default · Orca 1.4.257 found")).toBeTruthy();
    expect(within(mine).getByText("billing-api · Orca (default)")).toBeTruthy();
    expect(within(mine).getByText("browser · 2 slots, k3d · 1 slot")).toBeTruthy();
    expect(within(mine).getByText("Local computer · this device ·")).toBeTruthy();
    // The folder of the current workspace, only on the card of this device (workspace-folder).
    expect((await within(mine).findByRole("group", { name: "Workspace folder" })).textContent).toBe(
      "Workspace folder/Users/example/Work/demo-aw1",
    );
    const other = screen.getByLabelText("Device ubuntu-01");
    expect(within(other).getByText("0 working of 3 · queue 1")).toBeTruthy();
    expect(within(other).getByText("tmux · default")).toBeTruthy();
    expect(within(other).getByText("web-app · tmux")).toBeTruthy();
    expect(within(other).queryByText(/slot/)).toBeNull();
    expect(within(other).queryByRole("group", { name: "Workspace folder" })).toBeNull();
    expect(within(other).getByRole("group", { name: "Use Orca" }).textContent).toBe("Use OrcaOff");
  });
});

describe("RevokeDialog", () => {
  it("names the sessions that stop, then the credentials to add again", async () => {
    const running = makeTask({
      session: { session: "s", device: "ubuntu-01", host: "tmux", state: "running", reason: null },
    });
    const call = installBridge({
      tasks: () => [running],
      revokeDevice: () => ({
        device: "ubuntu-01",
        seq: 2,
        revoked_at: "x",
        credentials: 1,
        closed: ["stripe-test"],
        delivered: false,
      }),
    });
    renderApp(<RevokeDialog ws="ws-1" device={device("ubuntu-01")} onClose={noop} />);
    expect(await screen.findByText(/These sessions stop: AW-3 Rate limit/)).toBeTruthy();
    expect(screen.getByText(/keeps its copy of the files/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Revoke device" }));
    expect(await screen.findByText(/Add these credentials again: stripe-test/)).toBeTruthy();
    expect(
      screen.getByText(/ubuntu-01 did not get the revoke, so its agent sessions/),
    ).toBeTruthy();
    expect(argsOf(call, "revokeDevice")).toEqual([{ ws: "ws-1", device: "ubuntu-01" }]);
  });
});

describe("PairDialog", () => {
  const ID = "0123456789abcdef0123456789abcdef";
  const base: PairingView = {
    id: ID,
    side: "show",
    state: "waiting",
    workspace: { id: "w", name: "acme" },
    device: "macbook-pro",
    expires_at: "2026-11-23T10:10:00.000Z",
    check_code: null,
    new_device: null,
    error: null,
    folder: null,
    folder_note: null,
    code: "aw1:abc",
    qr_svg: "<svg xmlns='http://www.w3.org/2000/svg'/>",
  };

  it("shows the QR code and the code while it waits", async () => {
    installBridge({ startPairing: () => base, pairing: () => base });
    renderApp(<PairDialog ws="ws-1" onClose={noop} />);
    expect(await screen.findByAltText("Pairing QR code")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Pairing code").value).toBe("aw1:abc");
    // The label sits above the input (docs/design.md 8.8): Copy aligns with the input, not the label.
    const row = screen.getByRole("button", { name: "Copy" }).parentElement as HTMLElement;
    expect(getComputedStyle(row).alignItems).toBe("flex-end");
  });

  it("keeps polling while the window is hidden (verify-journeys finding 11)", async () => {
    focusManager.setFocused(false);
    try {
      let state: PairingView["state"] = "waiting";
      installBridge({
        startPairing: () => base,
        pairing: () => ({
          ...base,
          state,
          check_code: "482 913",
          new_device: { slug: "ubuntu-01", name: "ubuntu-01", role: "remote" },
        }),
      });
      renderApp(<PairDialog ws="ws-1" onClose={noop} />);
      expect(await screen.findByAltText("Pairing QR code")).toBeTruthy();
      state = "check";
      expect(
        await screen.findByLabelText("Check code on the new device", {}, { timeout: 3000 }),
      ).toBeTruthy();
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it("approves with the code that the new device shows, and never shows its own first", async () => {
    const check: PairingView = {
      ...base,
      state: "check",
      check_code: "482 913",
      new_device: { slug: "ubuntu-01", name: "ubuntu-01", role: "remote" },
    };
    const call = installBridge({
      startPairing: () => base,
      pairing: () => check,
      approvePairing: () => ({ ...check, state: "approved" }),
    });
    renderApp(<PairDialog ws="ws-1" onClose={noop} />);
    const field = await screen.findByLabelText("Check code on the new device");
    expect(screen.queryByText(/482 913/)).toBeNull();
    const approve = screen.getByRole("button", { name: "Approve device" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(field, "482913");
    await userEvent.click(approve);
    await waitFor(() =>
      expect(argsOf(call, "approvePairing")).toEqual([{ id: ID, check_code: "482 913" }]),
    );
  });
});

describe("Assign to another device", () => {
  it("opens from the paused card and selects no device for the person", async () => {
    const task = makeTask({
      assignee: "claude@macbook-pro",
      paused: {
        cause: "device_offline",
        since: "x",
        resumes_at: null,
        next_step: "Waits for macbook-pro.",
        needs_human: false,
      },
    });
    const call = installBridge({ assignTask: () => ({ applied: true }) });
    renderApp(
      <DialogsProvider ws="ws-1">
        <NeedsYouCards ws="ws-1" task={task} />
      </DialogsProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Assign to another device…" }));
    const assign = await screen.findByRole("button", { name: "Assign" });
    const radio = await screen.findByRole("radio", { name: "claude@ubuntu-01" });
    expect((radio as HTMLInputElement).checked).toBe(false);
    expect((assign as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("radio", { name: "claude@macbook-pro" })).toBeNull();
    await userEvent.click(radio);
    await userEvent.click(assign);
    await waitFor(() =>
      expect(argsOf(call, "assignTask")).toEqual([
        // The host list failed (no fake): the person picked no host, so awd decides (fix list 0-11).
        { ws: "ws-1", task: task.id, assignee: "claude@ubuntu-01" },
      ]),
    );
  });

  it("shows the session host after a choice and sends Orca when the person picks it", async () => {
    const task = makeTask({ assignee: "claude@macbook-pro" });
    const call = installBridge({
      assignTask: () => ({ applied: true }),
      sessionHosts: () => ({
        device: "macbook-pro",
        devices: [
          {
            device: "ubuntu-01",
            may_run: true,
            use_orca: true,
            checkouts: [{ project: "billing-api", session_host: "tmux" }],
            orca: null,
          },
        ],
      }),
    });
    renderApp(<AssignDeviceDialog ws="ws-1" task={task} onClose={noop} />);
    expect(screen.queryByRole("radio", { name: "tmux · default" })).toBeNull();
    await userEvent.click(await screen.findByRole("radio", { name: "claude@ubuntu-01" }));
    // The checkout of the project asks for tmux: the dialog selects it first.
    const tmux = await screen.findByRole("radio", { name: "tmux · default" });
    expect((tmux as HTMLInputElement).checked).toBe(true);
    await userEvent.click(await screen.findByRole("radio", { name: "Orca" }));
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() =>
      expect(argsOf(call, "assignTask")).toEqual([
        { ws: "ws-1", task: task.id, assignee: "claude@ubuntu-01", session_host: "orca" },
      ]),
    );
  });

  it("shows a hint when the project has no other device", async () => {
    installBridge({
      projects: () => [{ slug: "billing-api", devices: ["macbook-pro"], default_agent: "claude" }],
    });
    renderApp(
      <AssignDeviceDialog
        ws="ws-1"
        task={makeTask({ assignee: "claude@macbook-pro" })}
        onClose={noop}
      />,
    );
    expect(await screen.findByText(/no other device/)).toBeTruthy();
  });
});
