import { describe, expect, it } from "vitest";
import {
  changedOptionsBody,
  DEFAULT_FORM,
  formOf,
  formProblem,
  nextOptions,
  optionsBody,
  shownOptions,
  worksInText,
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
    });
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
    expect(form).toEqual({ mode: "skip", teams: true, workIn: "worktree", folder: "" });
    expect(changedOptionsBody(form, task)).toBeUndefined();
    // Back to the defaults: the full object replaces the options of the task.
    expect(changedOptionsBody(DEFAULT_FORM, task)).toEqual({
      permission_mode: null,
      agent_teams: false,
      work_in: "worktree",
      folder: null,
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
