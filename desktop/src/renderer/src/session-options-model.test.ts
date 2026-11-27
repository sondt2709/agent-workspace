import { describe, expect, it } from "vitest";
import {
  changedOptionsBody,
  DEFAULT_FORM,
  formOf,
  formProblem,
  NEW_TASK_FORM,
  newSessionForm,
  nextOptions,
  optionsBody,
  shownOptions,
  withWorktreeRule,
  worksInText,
  worktreeBlocked,
} from "./session-options-model.ts";
import { makeTask } from "./testing.tsx";

const withOptions = (extra: Record<string, unknown>) => makeTask({ key: "AW-1", ...extra });

describe("session options model", () => {
  it("sends no options for New task with the defaults, and the full object else", () => {
    expect(optionsBody(DEFAULT_FORM)).toBeNull();
    expect(optionsBody({ ...DEFAULT_FORM, mode: "skip", workIn: "checkout" })).toEqual({
      permission_mode: "skip",
      agent_teams: false,
      work_in: "checkout",
      folder: null,
      switch_branch: true,
    });
    // "Switch to the task branch" off is not a default: the body has switch_branch false.
    expect(
      optionsBody({ ...DEFAULT_FORM, workIn: "checkout", switchBranch: false })?.switch_branch,
    ).toBe(false);
  });

  it("preselects Agent teams in New task, and in New session of a task with no options", () => {
    expect(NEW_TASK_FORM).toMatchObject({ mode: "skip", teams: true, switchBranch: true });
    const plain = withOptions({});
    expect(newSessionForm(plain).teams).toBe(true);
    // The task has no teams: the preselected teams are a change, so New session sends them.
    expect(changedOptionsBody(newSessionForm(plain), plain)).toMatchObject({ agent_teams: true });
    const off = withOptions({
      session_options: {
        permission_mode: null,
        agent_teams: false,
        work_in: "worktree",
        folder: null,
      },
    });
    expect(newSessionForm(off).teams).toBe(false);
  });

  it("disables Separate worktree for a checkout with no commit on that device", () => {
    const hosts = {
      devices: [
        {
          device: "macbook-pro",
          checkouts: [
            { project: "my-notes", has_commit: false },
            { project: "billing-api", has_commit: true },
            { project: "docs", has_commit: null },
          ],
        },
      ],
    };
    expect(worktreeBlocked(hosts, "macbook-pro", "my-notes")).toBe(true);
    expect(worktreeBlocked(hosts, "macbook-pro", "billing-api")).toBe(false);
    expect(worktreeBlocked(hosts, "macbook-pro", "docs")).toBe(false);
    expect(worktreeBlocked(hosts, "ubuntu-01", "my-notes")).toBe(false);
    expect(worktreeBlocked(undefined, "macbook-pro", "my-notes")).toBe(false);
    expect(withWorktreeRule(DEFAULT_FORM, true).workIn).toBe("checkout");
    expect(withWorktreeRule({ ...DEFAULT_FORM, workIn: "folder" }, true).workIn).toBe("folder");
    expect(withWorktreeRule(DEFAULT_FORM, false).workIn).toBe("worktree");
  });

  it("checks the folder of Other folder", () => {
    expect(formProblem({ ...DEFAULT_FORM, workIn: "folder" })).toMatch(/Choose the folder/);
    expect(formProblem({ ...DEFAULT_FORM, workIn: "folder", folder: "work/api" })).toMatch(
      /absolute/,
    );
    expect(formProblem({ ...DEFAULT_FORM, workIn: "folder", folder: "/work/api" })).toBeNull();
  });

  it("starts New session with the task options and sends them only when changed", () => {
    const task = withOptions({
      session_options: {
        permission_mode: "skip",
        agent_teams: true,
        work_in: "worktree",
        folder: null,
      },
    });
    const form = formOf(task);
    expect(form).toEqual({
      mode: "skip",
      teams: true,
      workIn: "worktree",
      folder: "",
      switchBranch: true,
    });
    expect(changedOptionsBody(form, task)).toBeUndefined();
    // Back to the defaults: the full object replaces the options of the task.
    expect(changedOptionsBody(DEFAULT_FORM, task)).toEqual({
      permission_mode: null,
      agent_teams: false,
      work_in: "worktree",
      folder: null,
      switch_branch: true,
    });
  });

  it("never shows the project skip for a task of an agent", () => {
    const agent = withOptions({ created_by: "claude@macbook-pro" });
    expect(nextOptions(agent, "skip").permission_mode).toBe("default");
    const person = withOptions({ created_by: "human@pixel-9" });
    expect(nextOptions(person, "skip").permission_mode).toBe("skip");
  });

  it("shows the running session values, else the next session", () => {
    const running = withOptions({
      session_options: null,
      session: {
        session: "s1",
        device: "macbook-pro",
        state: "running",
        cwd: "/home/user/.aw/worktrees/aw-AW-1",
        branch: "aw/AW-1",
        permission_mode: "skip",
        agent_teams: false,
        work_in: "worktree",
      },
    });
    const shown = shownOptions(running, "default");
    expect(shown).toMatchObject({ running: true, mode: "skip" });
    expect(worksInText(shown, "AW-1")).toBe("/home/user/.aw/worktrees/aw-AW-1 · branch aw/AW-1");
    const next = shownOptions(withOptions({}), "accept_edits");
    expect(next).toMatchObject({ running: false, mode: "accept_edits", path: null });
    expect(worksInText(next, "AW-1")).toBe("A separate worktree aw-AW-1 (next session)");
  });
});
