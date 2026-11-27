import { describe, expect, it } from "vitest";
import { effectiveSessionOptions } from "./session-options.ts";

const own = {
  permission_mode: "accept_edits" as const,
  agent_teams: true,
  work_in: "folder" as const,
  folder: "/work/api",
  switch_branch: true,
};

describe("effectiveSessionOptions", () => {
  it("takes the options of the task", () => {
    expect(
      effectiveSessionOptions({ session_options: own, created_by: "human@pixel-9" }, null),
    ).toEqual(own);
  });

  it("gives the defaults with no options and no project", () => {
    expect(effectiveSessionOptions({ session_options: null, created_by: null }, null)).toEqual({
      permission_mode: "default",
      agent_teams: false,
      work_in: "worktree",
      folder: null,
      switch_branch: true,
    });
  });

  it("takes the project default for a task with no mode", () => {
    const task = {
      session_options: { ...own, permission_mode: null },
      created_by: "human@macbook-pro",
    };
    expect(effectiveSessionOptions(task, { permission_mode: "skip" }).permission_mode).toBe("skip");
  });

  it("never gives the project skip to a task of an agent", () => {
    for (const by of ["claude@ubuntu-01", "aw@ubuntu-01", null]) {
      const task = { session_options: null, created_by: by };
      expect(effectiveSessionOptions(task, { permission_mode: "skip" }).permission_mode).toBe(
        "default",
      );
    }
    const task = { session_options: null, created_by: "claude@ubuntu-01" };
    expect(effectiveSessionOptions(task, { permission_mode: "accept_edits" }).permission_mode).toBe(
      "accept_edits",
    );
  });

  it("keeps the folder only for work_in folder", () => {
    const task = {
      session_options: { ...own, work_in: "checkout" as const },
      created_by: "human@pixel-9",
    };
    expect(effectiveSessionOptions(task, null).folder).toBeNull();
  });

  it("keeps switch_branch false for a session in the checkout", () => {
    const task = {
      session_options: { ...own, work_in: "checkout" as const, switch_branch: false },
      created_by: "human@pixel-9",
    };
    expect(effectiveSessionOptions(task, null).switch_branch).toBe(false);
  });
});
