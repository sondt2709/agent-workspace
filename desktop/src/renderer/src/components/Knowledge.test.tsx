import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type {
  HistoryEntry,
  KnowledgeChange,
  KnowledgeFile,
  Suggestion,
} from "../../../shared/channels.ts";
import { FakeCallError, installBridge, renderApp } from "../testing.tsx";
import { DigestCard, KnowledgePage, SuggestionCard } from "./Knowledge.tsx";

afterEach(cleanup);

const PATH = "projects/billing-api/learned/rate-limit.md";
const FM = {
  apply: "auto",
  description: null,
  globs: [],
  locked: false,
  source: null,
  author: "claude@ubuntu-01",
  task: "t1",
  learned_at: null,
  validated_at: null,
};

function file(path: string, extra: Partial<KnowledgeFile> = {}): KnowledgeFile {
  return {
    path,
    scope: path.startsWith("shared/") ? "shared" : "project",
    project: path.startsWith("shared/") ? null : "billing-api",
    size: 10,
    hash: "a".repeat(64),
    rule: path.includes("/rules/"),
    learned: path.includes("/learned/"),
    title: null,
    front_matter: FM as KnowledgeFile["front_matter"],
    front_matter_error: null,
    last_change: null,
    ...extra,
  };
}

function change(extra: Partial<KnowledgeChange> = {}): KnowledgeChange {
  return {
    id: "c1",
    hlc: "x",
    at: "2026-11-23T09:59:00.000Z",
    dev: "ubuntu-01",
    path: PATH,
    hash: "a".repeat(64),
    base: null,
    author: "claude@ubuntu-01",
    by: null,
    task: "t1",
    task_key: "AW-7",
    kind: "learned",
    suggestion: null,
    label: "Learned by claude@ubuntu-01 on AW-7",
    ...extra,
  };
}

function suggestion(extra: Partial<Suggestion> = {}): Suggestion {
  return {
    id: "s1",
    hlc: "x",
    at: "2026-11-23T09:59:00.000Z",
    dev: "ubuntu-01",
    path: "shared/rules/review.md",
    content: "# Review rule\n",
    hash: null,
    base: null,
    author: "claude@ubuntu-01",
    task: "t1",
    task_key: "AW-7",
    kind: "edit",
    reasons: ["rule", "shared"],
    state: "pending",
    resolved_by: null,
    comment: null,
    change: null,
    late_resolutions: 0,
    ...extra,
  };
}

function argsOf(call: ReturnType<typeof installBridge>, method: string) {
  return call.mock.calls.filter(([m]) => m === method).map(([, args]) => args);
}

describe("KnowledgePage", () => {
  it("shows the project and shared trees, the file, its learned label and Undo", async () => {
    const history: HistoryEntry[] = [
      { ...change(), available: true, base_available: true, diff: "+# Rate limit" },
    ];
    const call = installBridge({
      kbList: (args: { scope: string }) =>
        args.scope === "shared"
          ? [file("shared/rules/review.md")]
          : [file(PATH), file("projects/billing-api/notes.md")],
      kbSuggestions: () => [],
      kbDigest: () => ({ date: "2026-11-23", learned: [], changes: [], pending: [], text: "" }),
      kbRead: () => ({
        path: PATH,
        hash: "a".repeat(64),
        content: "---\napply: auto\n---\n# Rate limit\n\nUse 100/min.\n",
        front_matter: FM,
        front_matter_error: null,
        current: true,
      }),
      kbHistory: () => history,
      kbUndo: () => ({
        change: change({ id: "c2", kind: "undo" }),
        suggestion: null,
        unchanged: false,
      }),
    });
    renderApp(<KnowledgePage scope="project" />, {
      route: "/w/:ws/p/:project/knowledge",
      url: `/w/ws-1/p/billing-api/knowledge?path=${encodeURIComponent(PATH)}`,
    });
    expect(await screen.findByText("Rate limit")).toBeTruthy();
    expect(screen.queryByText("apply: auto")).toBeNull();
    expect(await screen.findByText("Learned by claude@ubuntu-01 on AW-7")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /History/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(argsOf(call, "kbUndo")).toEqual([{ ws: "ws-1", change: "c1" }]));
    expect(await screen.findByText("Undone.")).toBeTruthy();
  });
});

describe("KnowledgePage history order (screens-align check)", () => {
  it("shows the newest change as the last change and the current version", async () => {
    // The history route gives the changes oldest first (kb-files history(): merge order).
    const history: HistoryEntry[] = [
      {
        ...change({
          id: "c0",
          kind: "edit",
          author: "human@macbook-pro",
          dev: "macbook-pro",
          at: "2026-11-20T09:00:00.000Z",
          label: "Edited by human@macbook-pro",
        }),
        available: true,
        base_available: false,
        diff: null,
      },
      {
        ...change({ id: "c1", label: "Changed by claude@ubuntu-01" }),
        available: true,
        base_available: true,
        diff: null,
      },
    ];
    installBridge({
      kbList: () => [file(PATH)],
      kbSuggestions: () => [],
      kbDigest: () => ({ date: "2026-11-23", learned: [], changes: [], pending: [], text: "" }),
      kbRead: () => ({
        path: PATH,
        hash: "a".repeat(64),
        content: "# Rate limit\n",
        front_matter: FM,
        front_matter_error: null,
        current: true,
      }),
      kbHistory: () => history,
    });
    renderApp(<KnowledgePage scope="project" />, {
      route: "/w/:ws/p/:project/knowledge",
      url: `/w/ws-1/p/billing-api/knowledge?path=${encodeURIComponent(PATH)}`,
    });
    const last = await screen.findByRole("group", { name: "Last change" });
    await waitFor(() => expect(last.textContent).toContain("claude@ubuntu-01 · on ubuntu-01"));
    await userEvent.click(screen.getByRole("tab", { name: /History/ }));
    const current = await screen.findByText("Current version");
    expect(current.parentElement?.textContent).toContain("Changed by claude@ubuntu-01");
    expect(current.parentElement?.textContent).not.toContain("Edited by human@macbook-pro");
  });
});

describe("KnowledgePage tree", () => {
  it("lists the project and shared files in groups, with the pending count (narrow window)", async () => {
    installBridge({
      kbList: (args: { scope: string }) =>
        args.scope === "shared"
          ? [file("shared/rules/review.md")]
          : [file(PATH), file("projects/billing-api/notes.md")],
      kbSuggestions: () => [suggestion()],
      kbDigest: () => ({
        date: "2026-11-23",
        learned: [change()],
        changes: [],
        pending: [],
        text: "",
      }),
    });
    const { router } = renderApp(<KnowledgePage scope="project" />, {
      route: "/w/:ws/p/:project/knowledge",
      url: "/w/ws-1/p/billing-api/knowledge",
    });
    expect(await screen.findByText("review.md")).toBeTruthy();
    expect(screen.getByText("Rules · 1")).toBeTruthy();
    expect(screen.getByText("Learned · 1")).toBeTruthy();
    expect(screen.getByText("Knowledge · 1")).toBeTruthy();
    expect(screen.getByText("Waits for approval · 1")).toBeTruthy();
    expect(screen.getByText("Learned today · 1")).toBeTruthy();
    await userEvent.click(screen.getByText("notes.md"));
    expect(router.state.location.search).toBe("?path=projects%2Fbilling-api%2Fnotes.md");
  });
});

/** A window of 1280 px: each MUI media query of `up(...)` matches. */
function stubWideWindow() {
  const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
  const wide = (query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: wide });
  return () => {
    if (original) Object.defineProperty(window, "matchMedia", original);
    else Reflect.deleteProperty(window, "matchMedia");
  };
}

describe("KnowledgePage one tree (openspec screens-align)", () => {
  it("shows project and shared files in one group with the shared tag, and opens the first file", async () => {
    const restore = stubWideWindow();
    try {
      const call = installBridge({
        kbList: (args: { scope: string }) =>
          args.scope === "shared"
            ? [file("shared/team.md")]
            : [file("projects/billing-api/notes.md")],
        kbSuggestions: () => [],
        kbDigest: () => ({ date: "2026-11-23", learned: [], changes: [], pending: [], text: "" }),
        kbRead: (args: { path: string }) => ({
          path: args.path,
          hash: "a".repeat(64),
          content: "# Notes\n",
          front_matter: FM,
          front_matter_error: null,
          current: true,
        }),
        kbHistory: () => [
          {
            ...change({ kind: "edit", author: "human@macbook-pro", dev: "macbook-pro" }),
            available: true,
            base_available: false,
            diff: null,
          },
        ],
      });
      renderApp(<KnowledgePage scope="project" />, {
        route: "/w/:ws/p/:project/knowledge",
        url: "/w/ws-1/p/billing-api/knowledge",
      });
      expect(await screen.findByText("Knowledge · 2")).toBeTruthy();
      expect(screen.getAllByText(/^Knowledge · /)).toHaveLength(1);
      const shared = screen.getByText("team.md").closest("[role=button], .MuiListItemButton-root");
      expect(shared?.textContent).toContain("shared");
      expect(
        screen.getByText("notes.md").closest(".MuiListItemButton-root")?.textContent,
      ).not.toContain("shared");
      await waitFor(() =>
        expect(argsOf(call, "kbRead")).toEqual([
          { ws: "ws-1", path: "projects/billing-api/notes.md" },
        ]),
      );
      expect(await screen.findByText(/^human@macbook-pro · on macbook-pro · /)).toBeTruthy();
    } finally {
      restore();
    }
  });
});

describe("SuggestionCard", () => {
  it("accepts with a comment, and offers Accept anyway after a conflict", async () => {
    let first = true;
    const call = installBridge({
      kbAccept: () => {
        if (first) {
          first = false;
          throw new FakeCallError("conflict", "The file changed");
        }
        return { change: change(), suggestion: null, unchanged: false };
      },
    });
    renderApp(<SuggestionCard ws="ws-1" suggestion={suggestion()} />);
    expect(screen.getByText(/It changes a rule and shared knowledge/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Comment (optional)"), "ok");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept anyway" }));
    await waitFor(() =>
      expect(argsOf(call, "kbAccept")).toEqual([
        { ws: "ws-1", suggestion: "s1", comment: "ok" },
        { ws: "ws-1", suggestion: "s1", force: true, comment: "ok" },
      ]),
    );
  });

  it("rejects", async () => {
    const call = installBridge({ kbReject: () => suggestion({ state: "rejected" }) });
    renderApp(<SuggestionCard ws="ws-1" suggestion={suggestion()} />);
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(argsOf(call, "kbReject")).toEqual([{ ws: "ws-1", suggestion: "s1" }]),
    );
  });
});

describe("DigestCard", () => {
  it("shows the counts and each learned item with Undo", async () => {
    installBridge({
      kbDigest: () => ({
        date: "2026-11-23",
        learned: [change()],
        changes: [],
        pending: [suggestion()],
        text: "",
      }),
    });
    renderApp(<DigestCard ws="ws-1" />);
    expect(await screen.findByText("1 learned · 1 waits for approval")).toBeTruthy();
    expect(screen.getByText("Learned by claude@ubuntu-01 on AW-7")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("shows nothing on a day with no knowledge change", async () => {
    const call = installBridge({
      kbDigest: () => ({ date: "2026-11-23", learned: [], changes: [], pending: [], text: "" }),
    });
    const { container } = renderApp(<DigestCard ws="ws-1" />);
    await waitFor(() => expect(argsOf(call, "kbDigest")).toHaveLength(1));
    expect(container.textContent).toBe("");
  });
});
