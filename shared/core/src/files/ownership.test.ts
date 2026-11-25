import { describe, expect, it } from "vitest";
import { WriteRefusedError } from "./errors.ts";
import { checkWrite, classifyPath, type WriterContext } from "./ownership.ts";

const TASK = "01a2038e-7f00-70eb-b429-fa86d481c263";
const owners: Record<string, string> = { [TASK]: "ubuntu-01" };

function context(device: string, role: WriterContext["role"], hasMasterKey = false): WriterContext {
  return { device, role, hasMasterKey, taskOwner: (task) => owners[task] };
}

const macbook = context("macbook-pro", "local", true);
const ubuntu = context("ubuntu-01", "remote");
const pixel = context("pixel-9", "mobile", true);

function allowed(path: string, ctx: WriterContext, exists = false): boolean {
  try {
    checkWrite(path, ctx, { exists });
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(WriteRefusedError);
    return false;
  }
}

describe("write guard", () => {
  const cases: [string, WriterContext, boolean][] = [
    [`tasks/${TASK}/log/macbook-pro.jsonl`, macbook, true],
    [`tasks/${TASK}/log/ubuntu-01.jsonl`, macbook, false],
    [`tasks/${TASK}/task.yaml`, ubuntu, true],
    [`tasks/${TASK}/task.yaml`, macbook, false],
    [`tasks/${TASK}/proposal/v2.md`, ubuntu, true],
    [`tasks/${TASK}/proposal/v2.md`, pixel, false],
    [`tasks/${TASK}/approach/v2.md`, ubuntu, false],
    [`tasks/${TASK}/artifacts/ubuntu-01/report/index.html`, ubuntu, true],
    [`tasks/${TASK}/artifacts/ubuntu-01/report.html`, macbook, false],
    [`tasks/${TASK}/terminal/ubuntu-01.txt`, ubuntu, true],
    ["tasks/workspace.yaml", pixel, true],
    ["tasks/projects/billing-api/project.yaml", pixel, true],
    ["tasks/projects/billing-api/project.yaml", ubuntu, true],
    ["tasks/log/pixel-9.jsonl", pixel, true],
    ["tasks/log/pixel-9.jsonl", macbook, false],
    ["tasks/devices/ubuntu-01/device.yaml", macbook, true],
    ["tasks/devices/ubuntu-01/device.yaml", ubuntu, false],
    ["tasks/devices/ubuntu-01/health.yaml", ubuntu, true],
    ["tasks/devices/ubuntu-01/health.yaml", macbook, false],
    ["tasks/devices/ubuntu-01/bindings.yaml", ubuntu, true],
    ["tasks/devices/pixel-9/heartbeat/2026-11-22.jsonl", pixel, true],
    ["tasks/devices/pixel-9/heartbeat/2026-11-22.jsonl", ubuntu, false],
    ["tasks/devices/pixel-9/push.yaml", pixel, true],
    ["tasks/devices/pixel-9/sealed/stripe-test.age", pixel, true],
    ["tasks/schemas/task.v1.schema.json", ubuntu, true],
    ["knowledge/shared/rules/testing.md", pixel, true],
    ["knowledge/projects/billing-api/learned/2026-11-22-test-db-reset.md", ubuntu, true],
    ["knowledge/log/ubuntu-01.jsonl", ubuntu, true],
    ["knowledge/log/ubuntu-01.jsonl", macbook, false],
    ["secure/test-servers.yaml", macbook, true],
    ["secure/test-servers.yaml", pixel, false],
    ["secure/credentials/stripe-test.age", ubuntu, true],
    ["secure/credentials/stripe-test.age", pixel, false],
    ["secure/keys/ubuntu-01.age", macbook, true],
    ["secure/keys/pixel-9.age", pixel, false],
    ["secure/keys/Ubuntu_01.age", macbook, false],
    // Paths outside the layout.
    ["tasks/notes.txt", macbook, false],
    ["tasks/AW-7/task.yaml", macbook, false],
    ["../outside.yaml", macbook, false],
    [`tasks/${TASK}/../workspace.yaml`, macbook, false],
    ["/etc/passwd", macbook, false],
    ["tasks/workspace.yaml.1234-ab.aw-tmp", macbook, false],
    ["tasks/workspace.sync-conflict-20261122-142001-ABCDEFG.yaml", macbook, false],
  ];

  it.each(cases)("%s by %o", (path, ctx, expected) => {
    expect(allowed(path, ctx)).toBe(expected);
  });

  it("refuses a folder with a temp or a conflict copy name, which the sync engine ignores", () => {
    const reason = (path: string) => {
      const info = classifyPath(path);
      return "reason" in info ? info.reason : null;
    };
    expect(reason("knowledge/shared/notes.aw-tmp/a.md")).toContain("aw-tmp");
    expect(
      reason(`tasks/${TASK}/artifacts/ubuntu-01/x.sync-conflict-20261122-120000-ABC/a.txt`),
    ).toContain("sync-conflict");
  });

  it("names the field of a document that must match its folder", () => {
    expect(classifyPath(`tasks/${TASK}/task.yaml`)).toMatchObject({
      identity: { field: "id", value: TASK },
    });
    expect(classifyPath("tasks/projects/billing-api/project.yaml")).toMatchObject({
      identity: { field: "slug", value: "billing-api" },
    });
    expect(classifyPath("tasks/devices/pixel-9/device.yaml")).toMatchObject({
      identity: { field: "slug", value: "pixel-9" },
    });
    expect(classifyPath("tasks/devices/pixel-9/bindings.yaml")).toMatchObject({
      identity: { field: "device", value: "pixel-9" },
    });
  });

  it("names the path and the rule in the refusal", () => {
    expect(() =>
      checkWrite(`tasks/${TASK}/log/ubuntu-01.jsonl`, macbook, { exists: false }),
    ).toThrow(
      `tasks/${TASK}/log/ubuntu-01.jsonl: write refused: only ubuntu-01 writes this file (task-log), not macbook-pro`,
    );
  });

  it("refuses a second write of a proposal version", () => {
    expect(allowed(`tasks/${TASK}/proposal/v1.md`, ubuntu, true)).toBe(false);
  });

  it("refuses a task snapshot when the owner is not known", () => {
    const unknown: WriterContext = { device: "ubuntu-01", role: "remote", hasMasterKey: false };
    expect(allowed(`tasks/${TASK}/task.yaml`, unknown)).toBe(false);
  });

  it("classifies the format and the device of a log", () => {
    expect(classifyPath(`tasks/${TASK}/log/pixel-9.jsonl`)).toMatchObject({
      folder: "tasks",
      rule: "task-log",
      task: TASK,
      format: { type: "log", device: "pixel-9" },
    });
    expect(classifyPath(`./tasks//${TASK}/task.yaml`)).toMatchObject({
      path: `tasks/${TASK}/task.yaml`,
      format: { type: "document", kind: "task" },
    });
  });
});
