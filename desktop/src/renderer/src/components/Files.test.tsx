import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FakeCallError, installBridge, makeTask, renderApp } from "../testing.tsx";
import { FilesPage, FixFileCards } from "./Files.tsx";

afterEach(cleanup);

function argsOf(call: ReturnType<typeof installBridge>, method: string) {
  return call.mock.calls.filter(([m]) => m === method).map(([, args]) => args);
}

const ISSUE = {
  code: "bad_document",
  path: "tasks/projects/billing-api/project.yaml",
  line: 3,
  event: null,
  task: null,
  reason: "schema_error",
  message: "slug: Expected a string",
};

describe("FixFileCards", () => {
  it("shows a card for a schema error with Open file and Restore last valid version", async () => {
    const call = installBridge({
      issues: () => [ISSUE, { ...ISSUE, code: "ignored", path: "tasks/x/log/a.jsonl" }],
      restoreDocument: () => ({ path: ISSUE.path, kind: "project", restored: true }),
      openWorkspaceFile: () => ({ opened: true }),
    });
    renderApp(<FixFileCards ws="ws-1" />);
    expect(await screen.findByText(`${ISSUE.path}:3`)).toBeTruthy();
    expect(screen.getAllByText("Fix a file")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Open file" }));
    await userEvent.click(screen.getByRole("button", { name: "Restore last valid version" }));
    await waitFor(() => {
      expect(argsOf(call, "openWorkspaceFile")).toEqual([{ ws: "ws-1", path: ISSUE.path }]);
      expect(argsOf(call, "restoreDocument")).toEqual([{ ws: "ws-1", path: ISSUE.path }]);
    });
  });

  it("shows the reason when the restore is refused", async () => {
    installBridge({
      issues: () => [ISSUE],
      restoreDocument: () => {
        throw new FakeCallError("not_found", "This device never read a valid version", 404);
      },
    });
    renderApp(<FixFileCards ws="ws-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Restore last valid version" }),
    );
    expect(await screen.findByText("This device never read a valid version")).toBeTruthy();
  });
});

describe("FilesPage", () => {
  it("shows the folder of a task and the text of a file, read-only", async () => {
    const task = makeTask({ id: "0193a000-0000-7000-8000-0000000000aa" });
    const root = `tasks/${task.id}`;
    installBridge({
      tasks: () => [task],
      taskFiles: () => ({
        task: task.id,
        root,
        truncated: false,
        entries: [
          { path: `${root}/log`, name: "log", kind: "dir", size: 0, modified: "x" },
          {
            path: `${root}/log/macbook-pro.jsonl`,
            name: "log/macbook-pro.jsonl",
            kind: "file",
            size: 120,
            modified: "x",
          },
          { path: `${root}/task.yaml`, name: "task.yaml", kind: "file", size: 80, modified: "x" },
        ],
      }),
      taskFile: () => ({
        path: `${root}/log/macbook-pro.jsonl`,
        size: 120,
        modified: "x",
        text: '{"type":"task.created"}\n',
        reason: null,
      }),
    });
    renderApp(<FilesPage />, {
      route: "/w/:ws/p/:project/files",
      url: `/w/ws-1/p/billing-api/files?task=${task.id}`,
    });
    await userEvent.click(await screen.findByText("macbook-pro.jsonl"));
    expect(await screen.findByText(/"type":"task.created"/)).toBeTruthy();
    expect(screen.getByText(/read-only/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("log/")).toBeTruthy();
  });

  it("lists the tasks by key, title and stage, with no task id (F-28)", async () => {
    const task = makeTask({ id: "0193a000-0000-7000-8000-0000000000aa", stage: "review" });
    installBridge({ tasks: () => [task] });
    renderApp(<FilesPage />, {
      route: "/w/:ws/p/:project/files",
      url: "/w/ws-1/p/billing-api/files",
    });
    const row = await screen.findByRole("button", { name: /AW-3/ });
    expect(row.textContent).toContain(`AW-3 · ${task.title}`);
    expect(row.textContent).toContain("Review");
    expect(screen.queryByText(task.id)).toBeNull();
    expect(document.body.textContent).not.toContain(task.id);
  });
});
