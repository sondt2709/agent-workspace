// FileKnowledgeStore on a temp AW folder that 2 devices share (macbook-pro and ubuntu-01).
import { FakeClock } from "@aw/core";
import { eventV1 } from "@aw/schema";
import { fixtureRoot } from "@aw/schema/testing";
import { cp, mkdir, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Of } from "./history.ts";
import { KnowledgeError, SETTLE_MS } from "./store.ts";
import { SECRET, TASK, TestFolder, type Device } from "./testing.ts";

let folder: TestFolder;
let mac: Device;
let ubuntu: Device;

beforeEach(async () => {
  folder = await TestFolder.create();
  mac = folder.device("macbook-pro");
  ubuntu = folder.device("ubuntu-01");
});

afterEach(async () => {
  await folder.cleanup();
});

const HUMAN = "human@macbook-pro";

async function settle(device: Device) {
  const first = await device.store.reconcile();
  folder.clock.advance(SETTLE_MS);
  const second = await device.store.reconcile();
  return { first, second };
}

describe("write, read, list", () => {
  it("copies before write, writes the change event, and stores both versions", async () => {
    await folder.edit("shared/testing.md", "# Testing\n\nv1\n");
    await settle(mac);
    const v1 = sha256Of("# Testing\n\nv1\n");

    const result = await mac.store.write({
      path: "shared/testing.md",
      content: "# Testing\n\nv2\n",
      base: v1,
      author: HUMAN,
      kind: "edit",
    });
    const v2 = sha256Of("# Testing\n\nv2\n");
    expect(result.change).toMatchObject({
      path: "shared/testing.md",
      hash: v2,
      base: v1,
      kind: "edit",
    });
    expect(await folder.text("shared/testing.md")).toBe("# Testing\n\nv2\n");
    expect(await mac.store.historyStore.has(v1)).toBe(true);
    expect(await mac.store.historyStore.has(v2)).toBe(true);
    const log = await folder.log("macbook-pro");
    expect(log.at(-1)).toMatchObject({
      type: "knowledge.changed",
      by: HUMAN,
      data: { path: "shared/testing.md", hash: v2, base: v1, author: HUMAN, kind: "edit" },
    });
    for (const line of log) expect(eventV1.safeParse(line).success).toBe(true);
    expect((await stat(mac.historyDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(mac.historyDir, v2))).mode & 0o777).toBe(0o600);
  });

  it("copies a file that this device did not see yet before it writes it", async () => {
    await folder.edit("shared/unseen.md", "unseen\n");
    await mac.store.write({
      path: "shared/unseen.md",
      content: "new\n",
      author: HUMAN,
      kind: "edit",
    });
    expect((await mac.store.historyStore.get(sha256Of("unseen\n")))!.toString()).toBe("unseen\n");
    const history = await mac.store.history("shared/unseen.md");
    expect(history[0]).toMatchObject({ base: sha256Of("unseen\n"), base_available: true });
  });

  it("refuses an old base, a path outside the scopes, and writes nothing for the same content", async () => {
    await mac.store.write({
      path: "shared/a.md",
      content: "a\n",
      base: null,
      author: HUMAN,
      kind: "edit",
    });
    const error = await mac.store
      .write({ path: "shared/a.md", content: "b\n", base: null, author: HUMAN, kind: "edit" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KnowledgeError);
    expect(error).toMatchObject({ code: "conflict", details: { current: sha256Of("a\n") } });
    expect(await folder.text("shared/a.md")).toBe("a\n");
    await expect(
      mac.store.write({ path: "log/x.jsonl", content: "x", author: HUMAN, kind: "edit" }),
    ).rejects.toMatchObject({ code: "refused" });
    const same = await mac.store.write({
      path: "shared/a.md",
      content: "a\n",
      author: HUMAN,
      kind: "edit",
    });
    expect(same).toEqual({ change: null, suggestion: null, unchanged: true });
    expect(await folder.log("macbook-pro")).toHaveLength(1);
  });

  it("lists by scope with the front matter and the last change; reads a version", async () => {
    await cp(join(fixtureRoot, "knowledge"), join(folder.root, "knowledge"), { recursive: true });
    const all = await mac.store.list();
    expect(all.map((f) => f.path)).toEqual([
      "projects/billing-api/learned/2026-11-22-test-db-reset.md",
      "shared/rules/testing.md",
    ]);
    const rule = all.find((f) => f.path === "shared/rules/testing.md")!;
    expect(rule).toMatchObject({
      rule: true,
      title: "Testing rules",
      front_matter: { apply: "always", locked: true },
      last_change: { dev: "macbook-pro", kind: "edit" },
    });
    // The fixture hash is the hash of the fixture file.
    const fixtureEvent = (await folder.log("macbook-pro"))[0]!.data as { hash: string };
    expect(rule.hash).toBe(fixtureEvent.hash);
    expect(
      (await mac.store.list({ kind: "project", project: "billing-api" })).map((f) => f.path),
    ).toEqual(["projects/billing-api/learned/2026-11-22-test-db-reset.md"]);
    expect((await mac.store.list({ kind: "shared" })).map((f) => f.path)).toEqual([
      "shared/rules/testing.md",
    ]);
    const current = await mac.store.read("shared/rules/testing.md");
    expect(current).toMatchObject({ current: true, front_matter: { locked: true } });
    await expect(mac.store.read("shared/rules/testing.md", "b".repeat(64))).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("lists the other files when one has a bad front matter, and refuses a changed stored version", async () => {
    await mac.store.write({
      path: "shared/bad.md",
      content: "---\napply: sometimes\n---\nx\n",
      author: HUMAN,
      kind: "edit",
    });
    await mac.store.write({
      path: "shared/good.md",
      content: "# Good\n",
      author: HUMAN,
      kind: "edit",
    });
    const list = await mac.store.list();
    expect(list.map((f) => [f.path, f.front_matter.apply, f.front_matter_error !== null])).toEqual([
      ["shared/bad.md", "auto", true],
      ["shared/good.md", "auto", false],
    ]);
    const hash = sha256Of("# Good\n");
    expect((await mac.store.read("shared/good.md", hash)).content).toBe("# Good\n");
    await writeFile(join(mac.historyDir, hash), "changed\n");
    await expect(mac.store.read("shared/good.md", hash)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("reconcile: direct edits and sync changes", () => {
  it("logs a human edit and a human delete after the settle time", async () => {
    await folder.edit("projects/billing-api/notes.md", "one\n");
    const first = await mac.store.reconcile();
    expect(first.changes).toEqual([]);
    expect(first.waiting).toEqual(["projects/billing-api/notes.md"]);
    expect(first.next_check_at).toBe(folder.clock.now() + SETTLE_MS);
    folder.clock.advance(SETTLE_MS - 1);
    const early = await mac.store.reconcile();
    expect(early).toMatchObject({ changes: [], waiting: ["projects/billing-api/notes.md"] });
    folder.clock.advance(1);
    const second = await mac.store.reconcile();
    expect(second.changes).toEqual([
      expect.objectContaining({ kind: "edit", author: HUMAN, base: null, hash: sha256Of("one\n") }),
    ]);

    await folder.edit("projects/billing-api/notes.md", "two\n");
    const edit = await settle(mac);
    expect(edit.second.changes).toEqual([
      expect.objectContaining({ kind: "edit", base: sha256Of("one\n"), hash: sha256Of("two\n") }),
    ]);
    expect(await mac.store.historyStore.has(sha256Of("one\n"))).toBe(true);

    await folder.remove("projects/billing-api/notes.md");
    const removed = await settle(mac);
    expect(removed.second.changes).toEqual([
      expect.objectContaining({ kind: "delete", hash: null, base: sha256Of("two\n") }),
    ]);
    // Nothing more to log.
    expect((await settle(mac)).second.changes).toEqual([]);
  });

  it("logs a human edit that repeats an earlier edit of this device", async () => {
    await mac.store.write({
      path: "shared/a.md",
      content: "one\n",
      base: null,
      author: HUMAN,
      kind: "edit",
    });
    await folder.edit("shared/a.md", "two\n");
    const edit = (await settle(mac)).second.changes[0]!;
    await mac.store.undo(edit.id, HUMAN);
    await folder.edit("shared/a.md", "two\n");
    expect((await settle(mac)).second.changes).toEqual([
      expect.objectContaining({ kind: "edit", base: sha256Of("one\n"), hash: sha256Of("two\n") }),
    ]);
  });

  it("logs no event for a change that another device logged, and stores its version", async () => {
    await ubuntu.store.write({
      path: "shared/testing.md",
      content: "remote\n",
      author: "human@ubuntu-01",
      kind: "edit",
    });
    const { first, second } = await settle(mac);
    expect(first.changes).toEqual([]);
    expect(first.waiting).toEqual([]);
    expect(second.changes).toEqual([]);
    expect(await mac.store.historyStore.has(sha256Of("remote\n"))).toBe(true);
    expect(await folder.log("macbook-pro")).toEqual([]);

    await ubuntu.store.write({
      path: "shared/testing.md",
      content: null,
      author: "human@ubuntu-01",
      kind: "delete",
    });
    expect((await settle(mac)).second.changes).toEqual([]);
    expect(await folder.log("macbook-pro")).toEqual([]);
  });

  it("takes a version that skips a change of another device as a sync change", async () => {
    await mac.store.write({
      path: "shared/a.md",
      content: "A\n",
      base: null,
      author: HUMAN,
      kind: "edit",
    });
    // ubuntu-01 changes A to B, then B to C; this device sees only C.
    const other = folder.device("ubuntu-01");
    await other.store.write({
      path: "shared/a.md",
      content: "B\n",
      author: "human@ubuntu-01",
      kind: "edit",
    });
    await other.store.write({
      path: "shared/a.md",
      content: "C\n",
      author: "human@ubuntu-01",
      kind: "edit",
    });
    expect((await settle(mac)).second).toMatchObject({ changes: [], waiting: [] });
    expect(await folder.log("macbook-pro")).toHaveLength(1);
  });

  it("sorts an undo after the change of a device whose clock runs ahead", async () => {
    const ahead = new FakeClock(folder.clock.now() + 60_000);
    const fast = folder.device("ubuntu-01", { clock: ahead });
    await mac.store.write({
      path: "shared/a.md",
      content: "one\n",
      base: null,
      author: HUMAN,
      kind: "edit",
    });
    const remote = await fast.store.write({
      path: "shared/a.md",
      content: "two\n",
      author: "human@ubuntu-01",
      kind: "edit",
    });
    await settle(mac);
    await mac.store.undo(remote.change!.id, HUMAN);
    const history = await mac.store.history("shared/a.md");
    expect(history.map((h) => `${h.dev}:${h.kind}`)).toEqual([
      "macbook-pro:edit",
      "ubuntu-01:edit",
      "macbook-pro:undo",
    ]);
  });

  it("waits for the log line when the file arrives first", async () => {
    // The file arrives; its log line comes 1 s later.
    await folder.edit("shared/late.md", "late\n");
    const first = await mac.store.reconcile();
    expect(first.waiting).toEqual(["shared/late.md"]);
    folder.clock.advance(1_000);
    await ubuntu.files.writeEvent("knowledge/log/ubuntu-01.jsonl", "knowledge.changed", {
      path: "shared/late.md",
      hash: sha256Of("late\n"),
      base: null,
      author: "human@ubuntu-01",
      kind: "edit",
    });
    folder.clock.advance(SETTLE_MS);
    const second = await mac.store.reconcile();
    expect(second.changes).toEqual([]);
    expect(second.waiting).toEqual([]);
    expect(await folder.log("macbook-pro")).toEqual([]);
  });

  it("logs the decision of the sync conflict resolver as a replaced change with Undo", async () => {
    const path = "shared/testing.md";
    await mac.store.write({ path, content: "base\n", base: null, author: HUMAN, kind: "edit" });
    await settle(ubuntu);
    // Both devices change the file between 2 syncs. The engine keeps the ubuntu-01 version.
    await mac.store.write({ path, content: "mac\n", author: HUMAN, kind: "edit" });
    await ubuntu.files.writeEvent("knowledge/log/ubuntu-01.jsonl", "knowledge.changed", {
      path,
      hash: sha256Of("ubuntu\n"),
      base: sha256Of("base\n"),
      author: "human@ubuntu-01",
      kind: "edit",
    });
    await folder.edit(path, "ubuntu\n");
    // The resolver on macbook-pro keeps its own version.
    const result = await mac.store.replace({
      path,
      winner: Buffer.from("mac\n"),
      loser: Buffer.from("ubuntu\n"),
      by: "aw@macbook-pro",
    });
    expect(await folder.text(path)).toBe("mac\n");
    expect(result.change).toMatchObject({
      kind: "replaced",
      hash: sha256Of("mac\n"),
      base: sha256Of("ubuntu\n"),
      author: HUMAN,
      by: "aw@macbook-pro",
      label: "Replaced by the macbook-pro version",
    });
    expect(eventV1.safeParse((await folder.log("macbook-pro")).at(-1)).success).toBe(true);
    // Each device explains the new version: no human edit is logged.
    expect((await settle(mac)).second.changes).toEqual([]);
    expect((await settle(ubuntu)).second.changes).toEqual([]);
    expect(await folder.log("ubuntu-01")).toHaveLength(1);
    expect((await ubuntu.store.history(path)).at(-1)?.label).toBe(
      "Replaced by the macbook-pro version",
    );
    // The resolver stored the losing version: Undo gives it back.
    expect((await mac.store.history(path)).at(-1)).toMatchObject({
      kind: "replaced",
      base_available: true,
    });
    await mac.store.undo(result.change!.id, HUMAN);
    expect(await folder.text(path)).toBe("ubuntu\n");
  });

  it("logs a replaced change for a winner that is on disk already, with the author of the winner", async () => {
    const path = "shared/kept.md";
    await ubuntu.store.write({
      path,
      content: "ubuntu\n",
      base: null,
      author: "human@ubuntu-01",
      kind: "edit",
    });
    const before = await stat(folder.abs(path));
    const result = await mac.store.replace({
      path,
      winner: Buffer.from("ubuntu\n"),
      loser: Buffer.from("mac\n"),
      by: "aw@macbook-pro",
    });
    expect(result.change).toMatchObject({
      dev: "macbook-pro",
      author: "human@ubuntu-01",
      label: "Replaced by the ubuntu-01 version",
    });
    expect((await stat(folder.abs(path))).mtimeMs).toBe(before.mtimeMs);
    expect(await mac.store.historyStore.has(sha256Of("mac\n"))).toBe(true);
    // The same version on both sides is no conflict: nothing is logged.
    const same = await mac.store.replace({
      path,
      winner: Buffer.from("ubuntu\n"),
      loser: Buffer.from("ubuntu\n"),
      by: "aw@macbook-pro",
    });
    expect(same).toMatchObject({ change: null, unchanged: true });
  });

  it("writes a direct edit with a secret back redacted, and keeps only the redacted version", async () => {
    mac.store.setSecrets([SECRET]);
    const raw = `token: ${SECRET.value}\n`;
    await folder.edit("shared/ops.md", raw);
    const { second } = await settle(mac);
    const redacted = "token: [redacted:stripe-test]\n";
    expect(await folder.text("shared/ops.md")).toBe(redacted);
    expect(second.changes).toEqual([expect.objectContaining({ hash: sha256Of(redacted) })]);
    expect(await mac.store.historyStore.has(sha256Of(raw))).toBe(false);
    const stored = await readdir(mac.historyDir);
    for (const name of stored.filter((n) => /^[0-9a-f]{64}$/.test(n))) {
      expect((await mac.store.historyStore.get(name))!.toString()).not.toContain(SECRET.value);
    }
    expect(JSON.stringify(await folder.log("macbook-pro"))).not.toContain(SECRET.value);
  });
});

describe("history and undo", () => {
  it("undoes a local edit and shows the diff", async () => {
    await mac.store.write({
      path: "shared/a.md",
      content: "one\n",
      base: null,
      author: HUMAN,
      kind: "edit",
    });
    const second = await mac.store.write({
      path: "shared/a.md",
      content: "two\n",
      author: HUMAN,
      kind: "edit",
    });
    const undo = await mac.store.undo(second.change!.id, HUMAN);
    expect(undo.change).toMatchObject({
      kind: "undo",
      hash: sha256Of("one\n"),
      base: sha256Of("two\n"),
    });
    expect(await folder.text("shared/a.md")).toBe("one\n");
    const history = await mac.store.history("shared/a.md");
    expect(history.map((h) => h.kind)).toEqual(["edit", "edit", "undo"]);
    expect(history[1]).toMatchObject({ available: true, base_available: true });
    expect(history[1]!.diff).toContain("-one");
    expect(history[1]!.diff).toContain("+two");
    expect(history[2]!.label).toBe(`Undone by ${HUMAN}`);
  });

  it("undoes a change that came from another device", async () => {
    await mac.store.write({
      path: "shared/testing.md",
      content: "laptop\n",
      base: null,
      author: HUMAN,
      kind: "edit",
    });
    await settle(ubuntu);
    const remote = await ubuntu.store.write({
      path: "shared/testing.md",
      content: "server\n",
      author: "human@ubuntu-01",
      kind: "edit",
    });
    await settle(mac);
    const undo = await mac.store.undo(remote.change!.id, HUMAN);
    expect(undo.change).toMatchObject({
      kind: "undo",
      dev: "macbook-pro",
      hash: sha256Of("laptop\n"),
    });
    expect(await folder.text("shared/testing.md")).toBe("laptop\n");
    // The undo sorts after the remote change on each device.
    const history = await ubuntu.store.history("shared/testing.md");
    expect(history.map((h) => `${h.dev}:${h.kind}`)).toEqual([
      "macbook-pro:edit",
      "ubuntu-01:edit",
      "macbook-pro:undo",
    ]);
  });

  it("removes a learned file at its undo, and refuses a version that is not in the store", async () => {
    const learned = await mac.store.learn({
      project: "billing-api",
      task: TASK,
      title: "Reset the DB",
      content: "Run make db-reset.\n",
      author: "claude@macbook-pro",
    });
    const path = learned.change!.path;
    const undo = await mac.store.undo(learned.change!.id.slice(0, 12), HUMAN);
    expect(undo.change).toMatchObject({ kind: "undo", hash: null });
    expect(await folder.text(path)).toBeNull();

    await ubuntu.files.writeEvent("knowledge/log/ubuntu-01.jsonl", "knowledge.changed", {
      path: "shared/x.md",
      hash: "c".repeat(64),
      base: "d".repeat(64),
      author: "human@ubuntu-01",
      kind: "edit",
    });
    const unknown = (await folder.log("ubuntu-01")).at(-1)!.id as string;
    await expect(mac.store.undo(unknown, HUMAN)).rejects.toMatchObject({ code: "not_found" });
    await expect(mac.store.undo("0000000000", HUMAN)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("learned entries and suggestions", () => {
  it("writes each learned item to a new file with the provenance", async () => {
    const first = await mac.store.learn({
      project: "billing-api",
      task: TASK,
      title: "Reset the DB",
      content: "Run make db-reset.\n",
      author: "claude@macbook-pro",
    });
    const second = await mac.store.learn({
      project: "billing-api",
      task: TASK,
      title: "Reset the DB",
      content: "---\napply: manual\n---\n# Own title\n\nAgain.\n",
      author: "claude@macbook-pro",
    });
    expect(first.change).toMatchObject({
      path: "projects/billing-api/learned/2026-11-22-reset-the-db.md",
      kind: "learned",
      base: null,
      label: "Learned by claude@macbook-pro on AW-7",
    });
    expect(second.change!.path).toBe("projects/billing-api/learned/2026-11-22-reset-the-db-2.md");
    const one = await mac.store.read(first.change!.path);
    expect(one.front_matter).toMatchObject({
      apply: "auto",
      description: "Reset the DB",
      source: "claude@macbook-pro on AW-7",
      author: "claude@macbook-pro",
      task: TASK,
    });
    expect(one.content).toContain("# Reset the DB\n\nRun make db-reset.");
    const two = await mac.store.read(second.change!.path);
    expect(two.front_matter.apply).toBe("manual");
    expect(two.content).toContain("# Own title");
    expect(two.content).not.toContain("# Reset the DB");
  });

  it("makes a suggestion of an agent change to a locked rule, and a human accepts it", async () => {
    await folder.edit("shared/rules/testing.md", "---\nlocked: true\n---\n# Testing\n");
    await settle(mac);
    const base = sha256Of("---\nlocked: true\n---\n# Testing\n");
    const result = await mac.store.write({
      path: "shared/rules/testing.md",
      content: "---\nlocked: true\n---\n# Testing\n\n1. Use the fake clock.\n",
      author: "claude@macbook-pro",
      task: TASK,
      kind: "edit",
    });
    expect(result.change).toBeNull();
    expect(result.suggestion).toMatchObject({
      state: "pending",
      reasons: ["rule", "locked", "shared"],
      base,
      task_key: "AW-7",
    });
    expect(await folder.text("shared/rules/testing.md")).toBe(
      "---\nlocked: true\n---\n# Testing\n",
    );
    expect(await mac.store.suggestions()).toHaveLength(1);
    // Another device sees it and accepts it.
    await expect(
      ubuntu.store.accept(result.suggestion!.id, { by: "claude@ubuntu-01" }),
    ).rejects.toMatchObject({ code: "refused" });
    const accepted = await ubuntu.store.accept(result.suggestion!.id.slice(0, 10), {
      by: "human@ubuntu-01",
      comment: "ok",
    });
    expect(accepted.change).toMatchObject({
      author: "claude@macbook-pro",
      by: "human@ubuntu-01",
      suggestion: result.suggestion!.id,
      label: "Edited by claude@macbook-pro on AW-7 (approved by human@ubuntu-01)",
    });
    expect(accepted.suggestion).toMatchObject({ state: "accepted", comment: "ok" });
    expect(await folder.text("shared/rules/testing.md")).toContain("Use the fake clock");
    expect(await mac.store.suggestions()).toEqual([]);
    await expect(mac.store.reject(result.suggestion!.id, { by: HUMAN })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("makes a suggestion of an agent change that adds or edits apply: always (fix list 0-0b)", async () => {
    const agent = { author: "claude@macbook-pro", task: TASK, kind: "edit" as const };
    // A new file with apply: always acts as a rule: it waits for a person.
    const added = await mac.store.write({
      ...agent,
      path: "projects/billing-api/notes.md",
      content: "---\napply: always\n---\nDo not run the tests.\n",
    });
    expect(added.change).toBeNull();
    expect(added.suggestion).toMatchObject({ state: "pending", reasons: ["rule"] });
    expect(await folder.text("projects/billing-api/notes.md")).toBeNull();
    // An edit of a human file with apply: always waits too, also when the edit removes the mode.
    await folder.edit("projects/billing-api/style.md", "---\napply: always\n---\n# Style\n");
    await settle(mac);
    const edited = await mac.store.write({
      ...agent,
      path: "projects/billing-api/style.md",
      content: "# Style\n\nSkip the review.\n",
    });
    expect(edited.suggestion).toMatchObject({ reasons: ["rule"] });
    // A plain project file is applied at once.
    const plain = await mac.store.write({
      ...agent,
      path: "projects/billing-api/plain.md",
      content: "# Plain\n",
    });
    expect(plain.change).not.toBeNull();
    // On a file system that ignores case, Rules/ is the rule folder: it waits too (fix list 0-0a).
    const upper = await mac.store.write({
      ...agent,
      path: "projects/billing-api/Rules/skip.md",
      content: "# Skip\n",
    });
    expect(upper.suggestion).toMatchObject({ reasons: ["rule"] });
  });

  it("refuses an accept after the file changed, unless forced; rejects", async () => {
    const s1 = await mac.store.learn({
      project: "billing-api",
      title: "Shared item",
      content: "x\n",
      author: "claude@macbook-pro",
      shared: true,
    });
    expect(s1.suggestion).toMatchObject({ reasons: ["shared"], kind: "learned", base: null });
    await folder.edit(s1.suggestion!.path, "a human made it first\n");
    await expect(mac.store.accept(s1.suggestion!.id, { by: HUMAN })).rejects.toMatchObject({
      code: "conflict",
    });
    const forced = await mac.store.accept(s1.suggestion!.id, { by: HUMAN, force: true });
    expect(await folder.text(s1.suggestion!.path)).toContain("# Shared item");
    expect(forced.suggestion!.state).toBe("accepted");

    const s2 = await mac.store.write({
      path: "shared/team.md",
      content: "team\n",
      author: "claude@macbook-pro",
      kind: "edit",
      from_person: "a-friend",
    });
    expect(s2.suggestion!.reasons).toEqual(["shared", "other_person"]);
    const rejected = await mac.store.reject(s2.suggestion!.id, { by: HUMAN, comment: "no" });
    expect(rejected).toMatchObject({ state: "rejected", resolved_by: HUMAN, comment: "no" });
    expect(await folder.text("shared/team.md")).toBeNull();
    expect((await mac.store.suggestions("all")).map((s) => s.state)).toEqual([
      "accepted",
      "rejected",
    ]);
  });

  it("counts the first resolution in merge order and reports the late one", async () => {
    const s = await mac.store.write({
      path: "shared/x.md",
      content: "x\n",
      author: "claude@macbook-pro",
      kind: "edit",
    });
    await mac.store.reject(s.suggestion!.id, { by: HUMAN });
    folder.clock.advance(10);
    await ubuntu.files.writeEvent(
      "knowledge/log/ubuntu-01.jsonl",
      "knowledge.suggestion_resolved",
      {
        suggestion: s.suggestion!.id,
        decision: "accepted",
      },
    );
    const [only] = await mac.store.suggestions("all");
    expect(only).toMatchObject({ state: "rejected", late_resolutions: 1 });
  });

  it("refuses a suggestion over 48 KiB", async () => {
    await expect(
      mac.store.write({
        path: "shared/big.md",
        content: "x".repeat(49 * 1024),
        author: "claude@macbook-pro",
        kind: "edit",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("digest", () => {
  it("counts the agent items of the day and the pending suggestions", async () => {
    expect((await mac.store.digest()).text).toBe("Agents learned nothing new.");
    await mac.store.learn({
      project: "billing-api",
      task: TASK,
      title: "One",
      content: "x\n",
      author: "claude@macbook-pro",
    });
    await mac.store.write({
      path: "shared/s.md",
      content: "s\n",
      author: "claude@macbook-pro",
      kind: "edit",
    });
    await mac.store.write({ path: "shared/h.md", content: "h\n", author: HUMAN, kind: "edit" });
    const digest = await mac.store.digest();
    expect(digest).toMatchObject({ date: "2026-11-22" });
    expect(digest.learned).toHaveLength(1);
    expect(digest.pending).toHaveLength(1);
    expect(digest.text).toBe("Agents learned 1 thing. 1 change waits for approval.");
    expect((await mac.store.digest("2026-11-21")).learned).toEqual([]);
  });
});

describe("redaction", () => {
  it("redacts a learned item, its stored version, its log line and a suggestion", async () => {
    mac.store.setSecrets([SECRET]);
    const learned = await mac.store.learn({
      project: "billing-api",
      task: TASK,
      title: "Stripe key",
      content: `Use ${SECRET.value} for the test.\n`,
      author: "claude@macbook-pro",
    });
    const text = (await folder.text(learned.change!.path))!;
    expect(text).toContain("[redacted:stripe-test]");
    expect(text).not.toContain(SECRET.value);
    expect(sha256Of(text)).toBe(learned.change!.hash);
    expect((await mac.store.historyStore.get(learned.change!.hash!))!.toString()).toBe(text);
    await mac.store.write({
      path: "shared/s.md",
      content: `secret ${Buffer.from(SECRET.value).toString("base64")}\n`,
      author: "claude@macbook-pro",
      kind: "edit",
    });
    const log = JSON.stringify(await folder.log("macbook-pro"));
    expect(log).toContain("[redacted:stripe-test]");
    expect(log).not.toContain(SECRET.value);
    expect(log).not.toContain(Buffer.from(SECRET.value).toString("base64"));
  });
});

describe("search and context", () => {
  it("searches by scope and builds the context of a task", async () => {
    await cp(join(fixtureRoot, "knowledge"), join(folder.root, "knowledge"), { recursive: true });
    const hits = await mac.store.search("reset invoice");
    expect(hits.map((h) => h.path)).toEqual([
      "projects/billing-api/learned/2026-11-22-test-db-reset.md",
    ]);
    expect(await mac.store.search("reset", { scope: { kind: "shared" } })).toEqual([]);
    const context = await mac.store.context({
      id: TASK,
      key: "AW-7",
      project: "billing-api",
      title: "Fix the flaky invoice test",
      first_message: "x",
    });
    expect(context.files.map((f) => `${f.section}:${f.path}`)).toEqual([
      "relevant:projects/billing-api/learned/2026-11-22-test-db-reset.md",
      "read_now:shared/rules/testing.md",
    ]);
    expect(context.text).toContain(mac.store.folder);
  });
});

describe("synced links (final check fc1-3)", () => {
  it("never reads a knowledge file through a link or a linked folder", async () => {
    const outside = join(folder.root, "..", "private.txt");
    await writeFile(outside, "PRIVATE-KEY-BYTES\n");
    await mkdir(join(folder.root, "knowledge", "shared"), { recursive: true });
    await symlink(outside, join(folder.root, "knowledge", "shared", "notes.md"));
    await symlink(join(folder.root, ".."), join(folder.root, "knowledge", "shared", "up"));
    await expect(mac.store.read("shared/notes.md")).rejects.toMatchObject({ code: "not_found" });
    await expect(mac.store.read("shared/up/private.txt")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
