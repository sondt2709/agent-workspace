// The revoke rule and the check of device records (openspec add-identity-and-pairing, design
// decisions 7 and 8).
import { materializeMergeCase, mergeCases } from "@aw/schema/testing";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { FakeClock } from "../clock.ts";
import { MergeEngine } from "./engine.ts";
import { expectedOf, runMergeCase } from "./testing.ts";

const RECORD = "tasks/devices/ubuntu-01/device.yaml";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aw-devices-"));
  materializeMergeCase("base", root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function editRecord(change: Record<string, unknown>): Promise<void> {
  const path = join(root, ...RECORD.split("/"));
  const value = parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, stringify({ ...value, ...change }));
}

async function editRecordText(
  path: string,
  text: string,
  change: Record<string, unknown>,
): Promise<void> {
  await writeFile(path, stringify({ ...(parse(text) as object), ...change }));
}

function recordOf(engine: MergeEngine): Record<string, unknown> | undefined {
  return engine.documents().find((doc) => doc.path === RECORD)?.value as
    Record<string, unknown> | undefined;
}

describe("revoked device", () => {
  it("folds again after a revoke record arrives, and equals the full merge of device-revoked", async () => {
    const item = mergeCases().find((c) => c.name === "device-revoked")!;
    const clock = new FakeClock(item.now);
    const engine = new MergeEngine({ root, clock });
    const before = await engine.update();
    expect(before.view.tasks[0]!.progress).toBe("Run the tests");

    await editRecord({ seq: 2, revoked: true, revoked_at: "2026-11-22T14:20:00.000Z#0000" });
    const after = await engine.update();
    expect(after.full).toBe(false);
    const full = await runMergeCase(item);
    try {
      expect(expectedOf(after)).toEqual(expectedOf(full.update));
    } finally {
      await full.cleanup();
    }
    const reasons = after.view.issues.filter((i) => i.reason === "device_revoked");
    expect(reasons.map((i) => i.message)).toEqual([
      "task.progress of ubuntu-01 not applied: device_revoked",
      "message.agent of ubuntu-01 not applied: device_revoked",
      "slot.released of ubuntu-01 not applied: device_revoked",
    ]);
  });

  it("keeps the event at the revoke time", async () => {
    const clock = new FakeClock("2026-11-22T14:21:30.000Z");
    await editRecord({ seq: 2, revoked: true, revoked_at: "2026-11-22T14:20:01.123Z#0000" });
    const update = await new MergeEngine({ root, clock }).update();
    expect(update.view.tasks[0]!.progress).toBe("Run the tests");
  });
});

describe("device record check", () => {
  // A stand-in for the master-key signature: the check accepts a record whose name is not
  // "tampered". awd gives the real Ed25519 check (@aw/identity verifyRecord).
  const verifyDeviceRecord = (raw: unknown) => (raw as { name?: unknown }).name !== "tampered";

  it("keeps the last valid record when the check refuses a new text", async () => {
    const clock = new FakeClock("2026-11-22T14:21:30.000Z");
    const engine = new MergeEngine({ root, clock, verifyDeviceRecord });
    await engine.update();
    await editRecord({ name: "tampered", role: "local" });
    const update = await engine.update();
    expect(update.view.devices.find((d) => d.slug === "ubuntu-01")!.role).toBe("remote");
    expect(update.view.issues).toContainEqual(
      expect.objectContaining({ code: "bad_document", path: RECORD, reason: "bad_signature" }),
    );
  });

  it("keeps the higher sequence number, also after a restart with the index documents", async () => {
    const clock = new FakeClock("2026-11-22T14:21:30.000Z");
    const engine = new MergeEngine({ root, clock, verifyDeviceRecord });
    await editRecord({ seq: 2, name: "ubuntu-01 v2" });
    await engine.update();
    expect(recordOf(engine)?.seq).toBe(2);

    await editRecord({ seq: 1, name: "ubuntu-01 v1" });
    const update = await engine.update();
    expect(recordOf(engine)?.name).toBe("ubuntu-01 v2");
    expect(update.view.issues).toContainEqual(
      expect.objectContaining({ path: RECORD, reason: "old_sequence" }),
    );

    const restarted = new MergeEngine({
      root,
      clock,
      verifyDeviceRecord,
      lastValid: engine.documents(),
    });
    await restarted.update();
    expect(recordOf(restarted)?.name).toBe("ubuntu-01 v2");
  });

  it("keeps a revoke when the file is removed or a valid record without the revoke replaces it", async () => {
    const item = mergeCases().find((c) => c.name === "device-revoked")!;
    const clock = new FakeClock(item.now);
    const engine = new MergeEngine({ root, clock, verifyDeviceRecord });
    const path = join(root, ...RECORD.split("/"));
    const valid = await readFile(path, "utf8");
    await editRecord({ seq: 2, revoked: true, revoked_at: "2026-11-22T14:20:00.000Z#0000" });
    const revokedText = await readFile(path, "utf8");
    const revoked = await engine.update();
    const ignored = (u: typeof revoked) =>
      u.view.issues.filter((i) => i.reason === "device_revoked").length;
    expect(ignored(revoked)).toBe(3);

    // The revoked device removes the revoke file: the revoke stays.
    await rm(path);
    const removed = await engine.update();
    expect(recordOf(engine)).toMatchObject({ revoked: true, seq: 2 });
    expect(removed.view.issues).toContainEqual(
      expect.objectContaining({ path: RECORD, reason: "revoke_removed" }),
    );
    expect(ignored(removed)).toBe(3);

    // It writes its old valid record (seq 1) back: refused, the revoke stays, also after a restart.
    await writeFile(path, valid);
    const replayed = await engine.update();
    expect(recordOf(engine)).toMatchObject({ revoked: true, seq: 2 });
    expect(replayed.view.issues).toContainEqual(
      expect.objectContaining({ path: RECORD, reason: "old_sequence" }),
    );
    expect(ignored(replayed)).toBe(3);
    await rm(path);
    const restarted = new MergeEngine({
      root,
      clock,
      verifyDeviceRecord,
      lastValid: engine.documents(),
    });
    expect(ignored(await restarted.update())).toBe(3);

    // A valid record with a higher seq and no revoke does not count either.
    await editRecordText(path, valid, { seq: 3 });
    const higher = await restarted.update();
    expect(recordOf(restarted)).toMatchObject({ revoked: true, seq: 2 });
    expect(ignored(higher)).toBe(3);

    // The revoke file comes back: no issue.
    await writeFile(path, revokedText);
    const back = await restarted.update();
    expect(back.view.issues.filter((i) => i.path === RECORD)).toEqual([]);
  });

  it("uses each record that passes its schema when no check is given", async () => {
    const clock = new FakeClock("2026-11-22T14:21:30.000Z");
    await editRecord({ name: "tampered" });
    const engine = new MergeEngine({ root, clock });
    await engine.update();
    expect(recordOf(engine)?.name).toBe("tampered");
  });
});
