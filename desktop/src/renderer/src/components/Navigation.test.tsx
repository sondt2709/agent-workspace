// The navigation of the prototype (openspec navigation-prototype): the workspace switcher, the
// sidebar counts and the sync state, the breadcrumb, the project tabs, All tasks and the Inbox
// list and detail. The app routes run in a memory router at 1280 px or 400 px.
import { createAppTheme } from "@aw/ui";
import { ThemeProvider } from "@mui/material";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Issue, KnowledgeChange, SyncStatusReply } from "../../../shared/channels.ts";
import { ClockContext } from "../clock.ts";
import { createQueryClient } from "../queries.ts";
import { routes } from "../routes.tsx";
import {
  fixedClock,
  installBridge,
  makeGate,
  makeTask,
  PROJECT,
  stubWindowWidth,
  type Handlers,
} from "../testing.tsx";

const WORKSPACES = [
  { id: "ws-1", name: "Personal", path: "/tmp/AW/Personal", open_gates: 1 },
  { id: "ws-2", name: "Side projects", path: "/tmp/AW/Side", open_gates: 0 },
];
const WEB = { ...PROJECT, slug: "web-app", name: "web-app", devices: ["ubuntu-01"] };
const BLOG = { ...PROJECT, slug: "blog", name: "blog" };

const assign = makeTask({
  id: "t1",
  key: "AW-1",
  title: "Add an audit log",
  stage: "backlog",
  assignee: null,
  needs_you_lane: true,
  needs_you_reasons: [{ reason: "assign" }],
});
const question = makeGate({
  gate: "g4",
  kind: "question",
  title: "Round half up?",
  options: ["Half up", "Half to even"],
});
const ask = makeTask({
  id: "t4",
  key: "AW-4",
  title: "Fix rounding",
  stage: "discuss",
  needs_you_lane: true,
  needs_you_reasons: [{ reason: "gate", kind: "question" }],
  gates: [question],
});
const working = makeTask({
  id: "t8",
  key: "AW-8",
  title: "Speed up the dashboard",
  stage: "implement",
});
const web = makeTask({
  id: "t9",
  key: "AW-9",
  title: "Dark mode",
  project: "web-app",
  stage: "review",
});
const TASKS = [assign, ask, working, web];

const BAD: Issue = {
  code: "bad_document",
  path: "tasks/projects/broken/project.yaml",
  line: 5,
  event: null,
  task: null,
  reason: null,
  message: "name: unclosed list",
};

const SYNC: SyncStatusReply = {
  engine: "running",
  device: "macbook-pro",
  sync_id: "x",
  paused: false,
  pids: [],
  peers: [
    {
      device: "ubuntu-01",
      connected: false,
      needItems: 3,
      needBytes: 10,
      inSync: false,
      text: "3 changes not synced to ubuntu-01 (offline)",
    },
  ],
};

const LEARNED: KnowledgeChange = {
  id: "c1",
  hlc: "x",
  at: "2026-11-23T09:59:00.000Z",
  dev: "ubuntu-01",
  path: "projects/billing-api/learned/2026-11-23-aw-8-index.md",
  hash: "a".repeat(64),
  base: null,
  author: "claude@ubuntu-01",
  by: null,
  task: "t8",
  task_key: "AW-8",
  kind: "learned",
  suggestion: null,
  label: "Learned by claude@ubuntu-01 on AW-8",
};

function handlers(extra: Handlers = {}): Handlers {
  return {
    workspaces: () => WORKSPACES,
    projects: (args: { ws: string }) => (args.ws === "ws-2" ? [BLOG] : [PROJECT, WEB]),
    tasks: (args: { ws: string; query?: { project?: string } }) =>
      args.ws === "ws-2"
        ? []
        : TASKS.filter((t) => !args.query?.project || t.project === args.query.project),
    task: (args: { task: string }) => TASKS.find((t) => t.id === args.task),
    issues: () => [BAD],
    syncStatus: () => SYNC,
    kbDigest: () => ({
      date: "2026-11-23",
      learned: [LEARNED],
      changes: [],
      pending: [],
      text: "",
    }),
    ...extra,
  };
}

let restore: (() => void) | null = null;

function renderAt(url: string, width = 1280) {
  restore = stubWindowWidth(width);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <ThemeProvider theme={createAppTheme()}>
      <ClockContext.Provider value={fixedClock(Date.parse("2026-11-23T10:00:00Z"))}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ClockContext.Provider>
    </ThemeProvider>,
  );
  return router;
}

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
});

describe("Sidebar", () => {
  it("has the items of the prototype in order, with the Needs you count of the Inbox rows", async () => {
    installBridge(handlers());
    renderAt("/w/ws-1/inbox");
    const nav = await screen.findByRole("navigation", { name: "Navigation" });
    await within(nav).findByText("web-app");
    const items = () =>
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent);
    // Inbox: 2 tasks in the lane + 1 file to fix (not the 1 open gate, F-10). All tasks: 4 active.
    await waitFor(() =>
      expect(items()).toEqual([
        "Inbox3",
        "All tasks4",
        "BBilling API2 · 1", // the letter tile, the name, needs you · working
        "Wweb-app0 · 1",
        "Shared knowledge",
        "Credentials",
        "Devices & sync",
        "Settings",
        "3 changes not synced",
      ]),
    );
    expect(within(nav).getByText("Projects")).toBeTruthy();
    expect(within(nav).getByText("This device")).toBeTruthy();
    expect(within(nav).getByText("MacBook Pro · this device")).toBeTruthy();
  });

  it("switches the workspace in the switcher and shows only its projects", async () => {
    installBridge(handlers());
    const router = renderAt("/w/ws-1/inbox");
    const nav = await screen.findByRole("navigation", { name: "Navigation" });
    await within(nav).findByText("Billing API");
    await userEvent.click(within(nav).getByRole("button", { name: "Switch workspace" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("/tmp/AW/Side")).toBeTruthy();
    await userEvent.click(within(menu).getByText("Side projects"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-2/inbox"));
    expect(await within(nav).findByText("blog")).toBeTruthy();
    expect(within(nav).queryByText("Billing API")).toBeNull();
  });

  it("opens the Board of a project from its row, and the header tabs open the other pages", async () => {
    installBridge(handlers({ bindings: () => ({ checkouts: [] }) }));
    const router = renderAt("/w/ws-1/inbox");
    const nav = await screen.findByRole("navigation", { name: "Navigation" });
    await userEvent.click(await within(nav).findByRole("link", { name: /^Billing API/ }));
    expect(router.state.location.pathname).toBe("/w/ws-1/p/billing-api/board");
    const tabs = await screen.findByRole("tablist", { name: "Billing API pages" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Board", "List", "Knowledge", "Files", "Settings"]);
    await userEvent.click(within(tabs).getByRole("tab", { name: "List" }));
    expect(router.state.location.pathname).toBe("/w/ws-1/p/billing-api/list");
    expect(
      within(nav)
        .getByRole("link", { name: /^Billing API/ })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

describe("Top bar", () => {
  it("shows the breadcrumb of a task and the Needs you count", async () => {
    installBridge(
      handlers({
        thread: () => ({
          task: { id: "t4", key: "AW-4", title: null },
          events: [],
          next: null,
          prev: null,
          ancestors: [],
        }),
      }),
    );
    const router = renderAt("/w/ws-1/tasks/t4");
    const crumb = await screen.findByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(crumb.textContent).toBe("PPersonalBilling APIAW-4"));
    await userEvent.click(within(crumb).getByRole("link", { name: "Billing API" }));
    expect(router.state.location.pathname).toBe("/w/ws-1/p/billing-api/board");
    await userEvent.click(screen.getByRole("link", { name: "Needs you: 3" }));
    expect(router.state.location.pathname).toBe("/w/ws-1/inbox");
  });

  it("shows only the last part of the breadcrumb and icons at 400 px", async () => {
    installBridge(handlers());
    renderAt("/w/ws-1/p/billing-api/list", 400);
    const crumb = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(crumb.textContent).toBe("List");
    expect(screen.getByRole("button", { name: "New task" })).toBeTruthy();
    expect(screen.queryByText("New session")).toBeNull();
  });
});

describe("Project frame", () => {
  it("opens the Board on a project URL with no tab (fix list npc-8)", async () => {
    installBridge(handlers());
    const router = renderAt("/w/ws-1/p/billing-api");
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/p/billing-api/board"));
    expect(await screen.findByRole("region", { name: "Backlog" })).toBeTruthy();
  });
});

describe("All tasks", () => {
  it("shows the tasks of each project of the workspace, as Board and as List", async () => {
    installBridge(handlers());
    const router = renderAt("/w/ws-1/tasks");
    expect(await screen.findByRole("button", { name: /^AW-9 / })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^AW-8 / })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "List" }));
    expect(router.state.location.search).toBe("?view=list");
    expect(await screen.findByRole("list", { name: "Needs you" })).toBeTruthy();
  });
});

describe("Inbox list and detail", () => {
  it("shows the first row in the detail at 1280 px, and a row opens its gate card", async () => {
    installBridge(handlers());
    const router = renderAt("/w/ws-1/inbox");
    const rows = await screen.findByRole("list", { name: "Needs you" });
    expect(
      within(rows)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "Assign task: AW-1 Add an audit log",
      "Answer question: AW-4 Fix rounding",
      "Fix a file: tasks/projects/broken/project.yaml",
    ]);
    // The other active tasks are under the rows.
    expect(
      within(screen.getByRole("list", { name: "Working now" })).getByText("Speed up the dashboard"),
    ).toBeTruthy();
    expect(await screen.findByRole("region", { name: "AW-1 needs you" })).toBeTruthy();
    await userEvent.click(within(rows).getByRole("button", { name: /AW-4/ }));
    expect(router.state.location.search).toBe("?item=task%3At4");
    const card = await screen.findByRole("region", { name: "AW-4 needs you" });
    expect(within(card).getByRole("button", { name: "Half up" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(router.state.location.pathname).toBe("/w/ws-1/tasks/t4");
  });

  it("shows the first row when the selected row left the list (an answered gate)", async () => {
    installBridge(handlers());
    renderAt("/w/ws-1/inbox?item=task%3Agone");
    expect(await screen.findByRole("region", { name: "AW-1 needs you" })).toBeTruthy();
    expect(screen.queryByText("Nothing selected")).toBeNull();
  });

  it("lists the knowledge of today and the devices not synced in Updates", async () => {
    installBridge(handlers());
    renderAt("/w/ws-1/inbox");
    await userEvent.click(await screen.findByRole("tab", { name: "Updates 2" }));
    const rows = await screen.findByRole("list", { name: "Updates" });
    expect(
      within(rows)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "Knowledge: Knowledge today",
      "Not synced: 3 changes not synced to ubuntu-01 (offline)",
    ]);
    expect(await screen.findByLabelText("Knowledge today")).toBeTruthy();
  });

  it("moves the focus between the rows with the arrow keys", async () => {
    installBridge(handlers());
    renderAt("/w/ws-1/inbox", 400);
    const rows = await screen.findByRole("list", { name: "Needs you" });
    const buttons = within(rows).getAllByRole("button");
    buttons[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(buttons[1]);
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(buttons[0]);
    // At 400 px Enter opens the detail in place of the list, with Back.
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("region", { name: "AW-1 needs you" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("list", { name: "Needs you" })).toBeTruthy();
  });
});

/** The ⌘ keys work on macOS: the user agent of jsdom names no Mac (platform.ts). */
function asMac() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/40",
  );
}

describe("Command menu", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens with ⌘K and opens a task by its key", async () => {
    asMac();
    installBridge(handlers());
    const router = renderAt("/w/ws-1/inbox");
    await screen.findByRole("navigation", { name: "Navigation" });
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Command menu" });
    within(dialog).getByRole("combobox", { name: "Search commands" });
    expect(within(dialog).getByRole("option", { name: /New task/ }).textContent).toContain("⌘N");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command menu" })).toBeNull());
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const again = await screen.findByRole("dialog", { name: "Command menu" });
    const field2 = within(again).getByRole("combobox", { name: "Search commands" });
    await userEvent.type(field2, "AW-9");
    await waitFor(() => expect(within(again).getAllByRole("option")).toHaveLength(1));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/w/ws-1/tasks/t9"));
    expect(screen.queryByRole("dialog", { name: "Command menu" })).toBeNull();
  });

  it("runs an action with Ctrl+K on other systems: New task opens its dialog", async () => {
    installBridge(handlers({ credentials: () => [] }));
    renderAt("/w/ws-1/p/billing-api/board");
    await screen.findByRole("navigation", { name: "Navigation" });
    await userEvent.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Command menu" });
    await userEvent.type(within(dialog).getByRole("combobox"), "new task");
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: /^New task/ })).toBeTruthy();
  });

  it("opens the screens with ⌘1 to ⌘4", async () => {
    asMac();
    installBridge(handlers());
    const router = renderAt("/w/ws-1/inbox");
    await screen.findByRole("navigation", { name: "Navigation" });
    await userEvent.keyboard("{Meta>}2{/Meta}");
    expect(router.state.location.pathname).toBe("/w/ws-1/tasks");
    await userEvent.keyboard("{Meta>}3{/Meta}");
    expect(router.state.location.pathname).toBe("/w/ws-1/devices");
    await userEvent.keyboard("{Meta>}4{/Meta}");
    expect(router.state.location.pathname).toBe("/settings");
    // Settings has no workspace in its route: ⌘1 opens the Inbox of the last workspace.
    await userEvent.keyboard("{Meta>}1{/Meta}");
    expect(router.state.location.pathname).toBe("/w/ws-1/inbox");
  });

  it("gives each row its own key: 2 projects with the same name (fix list npc-4)", async () => {
    asMac();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const twin = { ...WEB, slug: "web-app-2" };
    installBridge(handlers({ projects: () => [PROJECT, WEB, twin] }));
    renderAt("/w/ws-1/inbox");
    await screen.findByRole("navigation", { name: "Navigation" });
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Command menu" });
    await userEvent.type(within(dialog).getByRole("combobox"), "web-app");
    await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(3));
    const same = errors.mock.calls.filter((c) => String(c[0]).includes("same key"));
    expect(same).toEqual([]);
  });

  it("runs no key while another dialog is open (fix list npc-2)", async () => {
    asMac();
    installBridge(handlers({ credentials: () => [] }));
    const router = renderAt("/w/ws-1/p/billing-api/board");
    await screen.findByRole("navigation", { name: "Navigation" });
    await userEvent.click(screen.getByRole("button", { name: /^New task/ }));
    await screen.findByRole("dialog", { name: /^New task/ });
    await userEvent.keyboard("{Meta>}2{/Meta}");
    expect(router.state.location.pathname).toBe("/w/ws-1/p/billing-api/board");
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(screen.queryByRole("dialog", { name: "Command menu" })).toBeNull();
  });
});
