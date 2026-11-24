import { describe, expect, it } from "vitest";
import {
  checkoutProblem,
  folderName,
  isInside,
  sessionFolder,
  SLUG,
  slugFrom,
  startAgent,
} from "./create-model.ts";

describe("folderName and slugFrom (the common layout ~/dev/<org>/<repo>)", () => {
  it("takes the repository folder as the name and the slug", () => {
    const name = folderName("/Users/example/dev/example-org/billing-api/");
    expect(name).toBe("billing-api");
    expect(slugFrom(name)).toBe("billing-api");
  });

  it("makes a valid slug from any name", () => {
    expect(slugFrom("  Billing API v2 ")).toBe("billing-api-v2");
    expect(slugFrom("web_app.Next")).toBe("web-app-next");
    expect(slugFrom("ÄÖ")).toBe("");
    const long = slugFrom(`${"a".repeat(63)} b`);
    expect(long.length).toBeLessThanOrEqual(63);
    expect(SLUG.test(long)).toBe(true);
  });

  it("keeps the slug at most 63 characters, the limit of awd (cfc-5)", () => {
    expect(slugFrom("a".repeat(70))).toHaveLength(63);
    expect(slugFrom(`${"a".repeat(62)}-b`)).toBe("a".repeat(62));
    expect(SLUG.test("a".repeat(63))).toBe(true);
    expect(SLUG.test("a".repeat(64))).toBe(false);
  });
});

describe("checkoutProblem", () => {
  it("refuses a folder inside the workspace folder", () => {
    expect(isInside("/Users/example/AW/Personal/code", "/Users/example/AW/Personal")).toBe(true);
    expect(isInside("/Users/example/AW/Personal", "/Users/example/AW/Personal/")).toBe(true);
    expect(isInside("/Users/example/AW/Personal-2", "/Users/example/AW/Personal")).toBe(false);
    expect(
      checkoutProblem("/Users/example/AW/Personal/repo", "/Users/example/AW/Personal"),
    ).toMatch(/inside the workspace folder/);
    expect(
      checkoutProblem("/Users/example/dev/example-org/billing-api", "/Users/example/AW/Personal"),
    ).toBeNull();
    expect(checkoutProblem("/Users/example/dev/x", null)).toBeNull();
  });
});

describe("startAgent", () => {
  it("is the default agent on the first device of the project", () => {
    expect(startAgent({ default_agent: "claude", devices: ["macbook-pro", "ubuntu-01"] })).toBe(
      "claude@macbook-pro",
    );
    expect(startAgent({ default_agent: "claude", devices: [] })).toBeNull();
    expect(startAgent(undefined)).toBeNull();
  });
});

describe("sessionFolder", () => {
  const info = {
    self: {
      device: "macbook-pro",
      checkouts: [{ project: "billing-api", path: "/Users/example/dev/example-org/billing-api" }],
    },
    devices: [
      { device: "macbook-pro", checkouts: [{ project: "billing-api" }] },
      { device: "ubuntu-01", checkouts: [] },
    ],
  };

  it("shows the checkout path of this device", () => {
    expect(sessionFolder(info, "macbook-pro", "billing-api", "AW-1")).toEqual({
      text: "Works in a git worktree aw-AW-1 of /Users/example/dev/example-org/billing-api on the branch aw/AW-1.",
      missing: false,
    });
  });

  it("shows the checkout and another folder of the session options (session-options)", () => {
    const where = (workIn: "checkout" | "folder", folder = "") => ({ workIn, folder });
    expect(sessionFolder(info, "macbook-pro", "billing-api", "AW-1", where("checkout"))?.text).toBe(
      "Works in the checkout /Users/example/dev/example-org/billing-api on the branch aw/AW-1.",
    );
    expect(
      sessionFolder(info, "ubuntu-01", "web-app", "AW-1", where("folder", "/srv/web"))?.text,
    ).toBe("Works in /srv/web on ubuntu-01, as it is: no worktree and no branch change.");
  });

  it("says when a device has no checkout of the project", () => {
    expect(sessionFolder(info, "macbook-pro", "web-app", "AW-2")).toMatchObject({ missing: true });
    expect(sessionFolder(info, "ubuntu-01", "billing-api", null)?.text).toBe(
      "ubuntu-01 has no checkout of billing-api. Set the folder in the project settings on ubuntu-01.",
    );
  });

  it("is null while the data loads or with no device", () => {
    expect(
      sessionFolder({ self: undefined, devices: undefined }, "ubuntu-01", "billing-api", null),
    ).toBeNull();
    expect(sessionFolder(info, "", "billing-api", null)).toBeNull();
  });
});
