// Unit tests of the pure rules of setup.ts. The route and CLI tests are in api/setup-routes.test.ts.
import type { WorkspaceDocument } from "@aw/schema";
import { describe, expect, it } from "vitest";
import { editedWorkspace, isInside } from "./setup.ts";
import { newProjectMode } from "./workspace.ts";

describe("isInside (cf-2)", () => {
  const root = "/Users/example/AW/Personal";

  it("is true for the workspace folder and each folder in it", () => {
    expect(isInside(root, root)).toBe(true);
    expect(isInside(`${root}/code/billing-api`, root)).toBe(true);
    expect(isInside(`${root}/..dots`, root)).toBe(true);
  });

  it("is false for a parent, a sibling with the same name start, and another folder", () => {
    expect(isInside("/Users/example/AW", root)).toBe(false);
    expect(isInside(`${root}-code`, root)).toBe(false);
    expect(isInside("/Users/example/dev/example-org/billing-api", root)).toBe(false);
  });
});

describe("the permission mode of a new project (openspec permissions-default)", () => {
  it("takes the mode of the request first, then the workspace default, then skip", () => {
    expect(newProjectMode("accept_edits", { new_project_permission_mode: "skip" })).toBe(
      "accept_edits",
    );
    expect(newProjectMode(undefined, { new_project_permission_mode: "skip" })).toBe("skip");
    // No workspace value: the product default skip (openspec polish-skip-default).
    expect(newProjectMode(undefined, {})).toBe("skip");
    expect(newProjectMode(undefined, null)).toBe("skip");
    expect(newProjectMode("default", null)).toBe("default");
  });

  it("changes only the given workspace fields", () => {
    const old = {
      kind: "workspace",
      schema: 1,
      id: "0193a7c2-5b1e-7c3a-9f20-6d1e2a4b8c09",
      name: "Personal",
      key_prefix: "AW",
      device_order: ["macbook-pro"],
      switches: { community_relays: true },
      new_project_permission_mode: "default",
    } satisfies WorkspaceDocument;
    expect(editedWorkspace(old, { new_project_permission_mode: "skip" })).toEqual({
      ...old,
      new_project_permission_mode: "skip",
    });
    expect(editedWorkspace(old, { name: "  Acme  " })).toEqual({ ...old, name: "Acme" });
    expect(old.new_project_permission_mode).toBe("default");
  });
});
