// Round trip of the shared fixture folder through the files API (test plan item 2), and the API
// rules: the write guard, the redaction and the HLC of new events.
import { eventV1, schemaEntries, type DeviceRole } from "@aw/schema";
import { FIXTURE_TASK_ID, fixtureFiles, readFixtureText } from "@aw/schema/testing";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { FakeClock } from "../clock.ts";
import { NewerVersionError, SchemaError, WriteRefusedError } from "./errors.ts";
import { classifyPath } from "./ownership.ts";
import { openWorkspace, type WorkspaceFiles, type WriteHook } from "./workspace.ts";

const roles: Record<string, DeviceRole> = {
  "macbook-pro": "local",
  "ubuntu-01": "remote",
  "pixel-9": "mobile",
};
const owners: Record<string, string> = { [FIXTURE_TASK_ID]: "ubuntu-01" };

let root: string;
let clock: FakeClock;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aw-ws-"));
  clock = new FakeClock("2026-11-22T14:30:00.000Z");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function open(device: string, onWrite?: WriteHook): WorkspaceFiles {
  return openWorkspace({
    root,
    device,
    role: roles[device]!,
    hasMasterKey: device !== "ubuntu-01",
    clock,
    taskOwner: (task) => owners[task],
    ...(onWrite ? { onWrite } : {}),
  });
}

/** The device that writes a fixture file: the owner device, or macbook-pro for a shared file. */
function writerOf(path: string): string {
  const info = classifyPath(path);
  if ("reason" in info) throw new Error(info.reason);
  const writer = info.writer;
  if (writer.type === "device") return writer.device;
  if (writer.type === "task-owner") return owners[writer.task]!;
  return "macbook-pro";
}

describe("round trip of the fixture folder", () => {
  it("writes each file through the API and reads back the same values", async () => {
    const files = fixtureFiles();
    for (const path of files) {
      const ws = open(writerOf(path));
      const text = readFixtureText(path);
      if (path.endsWith(".yaml")) {
        await ws.writeDocument(path, parse(text) as Parameters<typeof ws.writeDocument>[1]);
      } else if (path.endsWith(".jsonl")) {
        for (const line of text.trimEnd().split("\n")) await ws.appendEvent(path, JSON.parse(line));
      } else {
        await ws.writeFile(path, text);
      }
    }

    const reader = open("macbook-pro");
    for (const path of files) {
      const text = readFixtureText(path);
      if (path.endsWith(".yaml")) {
        const doc = await reader.readDocument(path);
        const expected = schemaEntries
          .find((e) => e.name === `${doc.kind}.v1`)!
          .schema.parse(parse(text));
        expect(doc.value, path).toEqual(expected);
      } else if (path.endsWith(".jsonl")) {
        const result = await reader.readEvents(path);
        expect(result.errors, path).toEqual([]);
        expect(result.partialTail).toBeNull();
        const expected = text
          .trimEnd()
          .split("\n")
          .map((line) => eventV1.parse(JSON.parse(line)));
        expect(result.events, path).toEqual(expected);
      } else {
        expect(await reader.readText(path), path).toBe(text);
      }
    }
  });
});

describe("WorkspaceFiles", () => {
  const taskLog = (device: string) => `tasks/${FIXTURE_TASK_ID}/log/${device}.jsonl`;

  it("writes new events with an id and an HLC from the fake clock", async () => {
    const ws = open("ubuntu-01");
    const first = await ws.writeEvent(
      taskLog("ubuntu-01"),
      "task.progress",
      { text: "Run the tests" },
      {
        task: FIXTURE_TASK_ID,
        by: "claude@ubuntu-01",
      },
    );
    const second = await ws.writeEvent(taskLog("ubuntu-01"), "task.progress", {
      text: "Tests passed",
    });
    expect(first.hlc).toBe("2026-11-22T14:30:00.000Z#0000");
    expect(second.hlc).toBe("2026-11-22T14:30:00.000Z#0001");
    expect(first.id.slice(0, 13)).toBe(second.id.slice(0, 13));
    const read = await ws.readEvents(taskLog("ubuntu-01"));
    expect(read.events.map((e) => e.data)).toEqual([
      { text: "Run the tests" },
      { text: "Tests passed" },
    ]);
  });

  it("removes only a heartbeat log of this device", async () => {
    const own = "tasks/devices/macbook-pro/heartbeat/2026-11-01.jsonl";
    const other = "tasks/devices/ubuntu-01/heartbeat/2026-11-01.jsonl";
    const ws = open("macbook-pro");
    await ws.writeEvent(own, "device.heartbeat", { boot_time: "2026-11-01T08:00:00.000Z" });
    await ws.writeEvent(taskLog("macbook-pro"), "comment.added", { text: "keep" });
    await mkdir(join(root, "tasks/devices/ubuntu-01/heartbeat"), { recursive: true });
    await writeFile(join(root, ...other.split("/")), "{}\n");

    await ws.removeHeartbeatLog(own);
    await expect(readFile(join(root, ...own.split("/")), "utf8")).rejects.toThrow(/ENOENT/);
    await expect(ws.removeHeartbeatLog(other)).rejects.toThrow(WriteRefusedError);
    await expect(ws.removeHeartbeatLog(taskLog("macbook-pro"))).rejects.toThrow(
      /only a heartbeat log/,
    );
    expect(await readFile(join(root, ...other.split("/")), "utf8")).toBe("{}\n");
    expect(await readFile(join(root, ...taskLog("macbook-pro").split("/")), "utf8")).toContain(
      "keep",
    );
  });

  it("removes a knowledge file, and refuses a knowledge log and another path", async () => {
    const hooked: [string, string | Uint8Array | null][] = [];
    const ws = open("macbook-pro", (path, content) => hooked.push([path, content]));
    const file = "knowledge/projects/billing-api/learned/2026-11-22-x.md";
    await ws.writeFile(file, "# X\n");
    await ws.writeEvent("knowledge/log/macbook-pro.jsonl", "knowledge.changed", {
      path: "projects/billing-api/learned/2026-11-22-x.md",
      hash: "a".repeat(64),
      base: null,
      author: "human@macbook-pro",
      kind: "edit",
    });

    hooked.length = 0;
    await ws.removeKnowledgeFile(file);
    await expect(readFile(join(root, ...file.split("/")), "utf8")).rejects.toThrow(/ENOENT/);
    // The delete goes to the write hook (the targeted scan of sync), as each other write.
    expect(hooked).toEqual([[file, null]]);
    await expect(ws.removeKnowledgeFile("knowledge/log/macbook-pro.jsonl")).rejects.toThrow(
      /only a knowledge file/,
    );
    await expect(ws.removeKnowledgeFile("tasks/workspace.yaml")).rejects.toThrow(WriteRefusedError);
    expect(hooked).toEqual([[file, null]]);
    expect(await readFile(join(root, "knowledge/log/macbook-pro.jsonl"), "utf8")).toContain(
      "knowledge.changed",
    );
  });

  it("removes a credential file and refuses each other path", async () => {
    const ws = open("macbook-pro");
    const file = "secure/credentials/stripe-test.age";
    await ws.writeFile(file, new Uint8Array([1, 2, 3]));
    await ws.writeFile("secure/keys/ubuntu-01.age", new Uint8Array([4]));
    await ws.removeCredentialFile(file);
    await expect(readFile(join(root, ...file.split("/")))).rejects.toThrow(/ENOENT/);
    await expect(ws.removeCredentialFile("secure/keys/ubuntu-01.age")).rejects.toThrow(
      /only a credential file/,
    );
    await expect(ws.removeCredentialFile("tasks/workspace.yaml")).rejects.toThrow(
      WriteRefusedError,
    );
    expect(await readFile(join(root, "secure/keys/ubuntu-01.age"))).toEqual(Buffer.from([4]));
  });

  it("refuses a write to the log of another device", async () => {
    const ws = open("macbook-pro");
    await expect(
      ws.writeEvent(taskLog("ubuntu-01"), "comment.added", { text: "hi" }),
    ).rejects.toThrow(WriteRefusedError);
  });

  it("refuses an event whose dev is not the device of the log", async () => {
    const ws = open("ubuntu-01");
    const event = { ...ws.newEvent("comment.added", { text: "hi" }), dev: "pixel-9" };
    await expect(ws.appendEvent(taskLog("ubuntu-01"), event)).rejects.toThrow(WriteRefusedError);
  });

  it("refuses the secure folder on the phone and a second approach version write", async () => {
    const phone = open("pixel-9");
    await expect(
      phone.writeDocument("secure/test-servers.yaml", {
        kind: "test-servers",
        schema: 1,
        servers: [],
      }),
    ).rejects.toThrow("computers only");
    const owner = open("ubuntu-01");
    await owner.writeFile(`tasks/${FIXTURE_TASK_ID}/approach/v1.md`, "# Approach v1\n");
    await expect(
      owner.writeFile(`tasks/${FIXTURE_TASK_ID}/approach/v1.md`, "# Changed\n"),
    ).rejects.toThrow("written once");
  });

  it("redacts the session secrets in each event", async () => {
    const ws = open("ubuntu-01");
    const value = "fake-credential-value-for-tests";
    ws.setSecrets([{ name: "stripe-test", value }]);
    await ws.writeEvent(taskLog("ubuntu-01"), "message.agent", {
      text: `Use ${value} or ${Buffer.from(value).toString("base64")} or ${encodeURIComponent(`${value}/x`)}`,
    });
    const text = await readFile(join(root, ...taskLog("ubuntu-01").split("/")), "utf8");
    expect(text).not.toContain(value);
    expect(text).not.toContain(Buffer.from(value).toString("base64"));
    expect(text.match(/\[redacted:stripe-test\]/g)).toHaveLength(3);
  });

  it("writes events in 2026 with the 4-digit secret 2026", async () => {
    const ws = open("ubuntu-01");
    ws.setSecrets([{ name: "pin", value: "2026" }]);
    const written = await ws.writeEvent(
      taskLog("ubuntu-01"),
      "gate.answered",
      { gate: "01a2038e-7f00-7000-8000-000000002026", version: 1, answer: "PIN 2026" },
      { task: FIXTURE_TASK_ID, by: "human@ubuntu-01" },
    );
    expect(written.hlc).toBe("2026-11-22T14:30:00.000Z#0000");
    expect(written.data).toMatchObject({
      gate: "01a2038e-7f00-7000-8000-000000002026",
      answer: "PIN [redacted:pin]",
    });
    const read = await ws.readEvents(taskLog("ubuntu-01"));
    expect(read.errors).toEqual([]);
    expect(read.events).toEqual([written]);
  });

  it("refuses an event of another task or of a type that does not belong in the log", async () => {
    const ws = open("macbook-pro");
    const other = "01a2038e-7f00-7000-8000-0000000000aa";
    await expect(
      ws.writeEvent(taskLog("macbook-pro"), "task.done", {}, { task: other }),
    ).rejects.toThrow(`of task ${other}`);
    await expect(
      ws.writeEvent("tasks/devices/macbook-pro/heartbeat/2026-11-22.jsonl", "gate.answered", {
        gate: "01a2038e-7f00-7000-8000-000000000001",
        version: 1,
        answer: "yes",
      }),
    ).rejects.toThrow(WriteRefusedError);
    const slot = {
      resource: "k3d",
      slot: 0,
      fencing_token: 1,
      ttl_ms: 60000,
      task: FIXTURE_TASK_ID,
      session: "01a20390-53c0-73f3-af1e-cebbd1410ab4",
    };
    await expect(
      ws.writeEvent("knowledge/log/macbook-pro.jsonl", "slot.acquired", slot),
    ).rejects.toThrow("does not belong in a knowledge log");
    await expect(ws.writeEvent(taskLog("macbook-pro"), "slot.acquired", slot)).rejects.toThrow(
      "does not belong in a task log",
    );
    await expect(
      ws.writeEvent("tasks/log/macbook-pro.jsonl", "slot.acquired", slot),
    ).resolves.toMatchObject({ type: "slot.acquired" });
    expect((await ws.readEvents(taskLog("macbook-pro"))).events).toEqual([]);
  });

  it("redacts the session secrets in a terminal snapshot", async () => {
    const ws = open("ubuntu-01");
    const value = "fake-credential-value-for-tests";
    ws.setSecrets([{ name: "stripe-test", value }]);
    const path = `tasks/${FIXTURE_TASK_ID}/terminal/ubuntu-01.txt`;
    await ws.writeFile(path, `$ echo $KEY\n${value}\n`);
    expect(await ws.readText(path)).toBe("$ echo $KEY\n[redacted:stripe-test]\n");
    await ws.writeFile(path, Buffer.from(`token=${encodeURIComponent(value)}\n`));
    expect(await ws.readText(path)).toBe("token=[redacted:stripe-test]\n");
  });

  it("redacts terminal bytes that are not strict UTF-8 (a byte 0xE9, a NUL byte)", async () => {
    const ws = open("ubuntu-01");
    const value = "fake-credential-value-for-tests";
    ws.setSecrets([{ name: "stripe-test", value }]);
    const path = `tasks/${FIXTURE_TASK_ID}/terminal/ubuntu-01.txt`;
    const bytes = Buffer.concat([Buffer.from([0xe9]), Buffer.from(` ${value}\n\0`)]);
    const written = await ws.writeFile(path, bytes);
    expect(Buffer.from(written).toString("utf8")).toBe("\ufffd [redacted:stripe-test]\n\0");
    expect(await ws.readText(path)).toBe("\ufffd [redacted:stripe-test]\n\0");
  });

  describe("text files of a task (credential-redaction)", () => {
    const value = "stg_live_9f8e7d6c5b4a";
    const token = `awt_${"A".repeat(43)}`;
    const task = (rest: string) => `tasks/${FIXTURE_TASK_ID}/${rest}`;
    const disk = (path: string) => readFile(join(root, ...path.split("/")));
    function secretOpen(): WorkspaceFiles {
      const ws = open("ubuntu-01");
      ws.setSecrets([
        { name: "staging-api-key", value },
        { name: "mcp-token", value: token },
      ]);
      return ws;
    }

    it("redacts an approach version and returns the written text", async () => {
      const ws = secretOpen();
      const path = task("approach/v1.md");
      const written = await ws.writeFile(path, `# Plan\n\nCall staging with ${value}.\n`);
      expect(written).toBe("# Plan\n\nCall staging with [redacted:staging-api-key].\n");
      expect((await disk(path)).toString("utf8")).toBe(written);
    });

    it("redacts a text artifact given as a string or as UTF-8 bytes", async () => {
      const ws = secretOpen();
      const long = task("artifacts/ubuntu-01/text-0193a7d0.md");
      await ws.writeFile(long, `reply ${value} token ${token} ünïcode\n`);
      expect((await disk(long)).toString("utf8")).toBe(
        "reply [redacted:staging-api-key] token [redacted:mcp-token] ünïcode\n",
      );
      const notes = task("artifacts/ubuntu-01/notes.txt");
      const written = await ws.writeFile(
        notes,
        Buffer.from(
          `url=${encodeURIComponent(value)}&b64=${Buffer.from(value).toString("base64")}`,
        ),
      );
      const text = "url=[redacted:staging-api-key]&b64=[redacted:staging-api-key]";
      expect(Buffer.from(written).toString("utf8")).toBe(text);
      expect((await disk(notes)).toString("utf8")).toBe(text);
    });

    it("keeps the byte order mark of a redacted UTF-8 file (review low 8)", async () => {
      const ws = secretOpen();
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const csv = Buffer.concat([bom, Buffer.from(`name,key\nCafé,${value}\n`)]);
      const path = task("artifacts/ubuntu-01/notes.csv");
      await ws.writeFile(path, csv);
      const onDisk = await disk(path);
      expect(onDisk.subarray(0, 3).equals(bom)).toBe(true);
      expect(onDisk.subarray(3).toString("utf8")).toBe(
        "name,key\nCafé,[redacted:staging-api-key]\n",
      );
    });

    it("redacts a text with a byte that is not UTF-8, and a UTF-16 text (fix list 0-42)", async () => {
      const ws = secretOpen();
      // One Latin-1 byte (0xE9) in a log: the value is replaced, the other bytes stay.
      const log = Buffer.concat([
        Buffer.from("curl -H 'X-Key: "),
        Buffer.from(value),
        Buffer.from([0x27, 0x0a, 0x63, 0x61, 0x66, 0xe9, 0x0a]),
      ]);
      const logPath = task("artifacts/ubuntu-01/build.log");
      const written = Buffer.from(await ws.writeFile(logPath, log));
      expect(written.includes(Buffer.from(value))).toBe(false);
      expect(written.toString("latin1")).toBe(
        "curl -H 'X-Key: [redacted:staging-api-key]'\ncaf\u00e9\n",
      );
      expect((await disk(logPath)).equals(written)).toBe(true);
      // UTF-16 with a byte order mark (PowerShell >), little and big endian, and with no mark.
      const le = (text: string) => Buffer.from(text, "utf16le");
      const be = (text: string) => Buffer.from(text, "utf16le").swap16();
      for (const [name, bytes, marker] of [
        ["ps-le.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), le(`key=${value}\r\n`)]), le],
        ["ps-be.txt", Buffer.concat([Buffer.from([0xfe, 0xff]), be(`key=${value}\r\n`)]), be],
        ["ps-nobom.txt", le(`key=${value} and ${token}\r\n`), le],
      ] as const) {
        const path = task(`artifacts/ubuntu-01/${name}`);
        await ws.writeFile(path, bytes);
        const onDisk = await disk(path);
        expect(onDisk.includes(marker(value)), name).toBe(false);
        expect(onDisk.includes(marker("[redacted:staging-api-key]")), name).toBe(true);
      }
    });

    it("keeps the bytes of a binary artifact and of a text with no secret", async () => {
      const ws = secretOpen();
      // A PNG header (not UTF-8, with NUL bytes): the value inside stays, the bytes are the same.
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48]),
        Buffer.from(value),
      ]);
      const image = task("artifacts/ubuntu-01/image.png");
      expect(await ws.writeFile(image, png)).toBe(png);
      expect((await disk(image)).equals(png)).toBe(true);
      // Valid UTF-8 with a NUL byte is binary too.
      const nul = Buffer.concat([Buffer.from("data\0"), Buffer.from(value)]);
      const blob = task("artifacts/ubuntu-01/blob.bin");
      await ws.writeFile(blob, nul);
      expect((await disk(blob)).equals(nul)).toBe(true);
      // A text with no secret: the same object is written and returned.
      const clean = Buffer.from("no secret here\r\n");
      expect(await ws.writeFile(task("artifacts/ubuntu-01/clean.txt"), clean)).toBe(clean);
    });

    it("writes a sealed file and a credential file as they are", async () => {
      const ws = open("macbook-pro");
      ws.setSecrets([{ name: "staging-api-key", value }]);
      const bytes = Buffer.from(`age-encryption.org/v1\n${value}\n`);
      const sealed = "tasks/devices/macbook-pro/sealed/0193a7d0-0000-7000-8000-000000000009.age";
      await ws.writeFile(sealed, bytes);
      expect((await disk(sealed)).equals(bytes)).toBe(true);
      const credential = "secure/credentials/staging-api-key.age";
      await ws.writeFile(credential, bytes);
      expect((await disk(credential)).equals(bytes)).toBe(true);
    });

    it("gives the same redaction for a compare", () => {
      const ws = secretOpen();
      expect(ws.redactText(`a ${value} b ${token}`)).toBe(
        "a [redacted:staging-api-key] b [redacted:mcp-token]",
      );
    });
  });

  it("refuses to write over a document of a newer major version", async () => {
    const path = "tasks/projects/billing-api/project.yaml";
    const newer = readFixtureText(path).replace(/^schema: 1$/m, "schema: 2") + "new_v2_field: x\n";
    expect(newer).toContain("schema: 2");
    await mkdir(join(root, "tasks/projects/billing-api"), { recursive: true });
    await writeFile(join(root, path), newer);
    const ws = open("macbook-pro");
    const value = parse(readFixtureText(path)) as Parameters<typeof ws.writeDocument>[1];
    await expect(ws.writeDocument(path, value)).rejects.toThrow(NewerVersionError);
    expect(await ws.readText(path)).toBe(newer);
  });

  it("compares the id, slug or device of a document with its folder", async () => {
    const health = (device: string) =>
      ({ ...parse(readFixtureText("tasks/devices/ubuntu-01/health.yaml")), device }) as never;
    const ubuntu = open("ubuntu-01");
    await expect(
      ubuntu.writeDocument("tasks/devices/ubuntu-01/health.yaml", health("macbook-pro")),
    ).rejects.toThrow("the name of the folder");
    await ubuntu.writeDocument("tasks/devices/ubuntu-01/health.yaml", health("ubuntu-01"));

    const task = parse(readFixtureText(`tasks/${FIXTURE_TASK_ID}/task.yaml`)) as never;
    const other = "01a2038e-7f00-7000-8000-0000000000aa";
    owners[other] = "ubuntu-01";
    await expect(ubuntu.writeDocument(`tasks/${other}/task.yaml`, task)).rejects.toThrow(
      WriteRefusedError,
    );
    delete owners[other];

    const project = readFixtureText("tasks/projects/billing-api/project.yaml");
    await mkdir(join(root, "tasks/projects/other-api"), { recursive: true });
    await writeFile(join(root, "tasks/projects/other-api/project.yaml"), project);
    const error: unknown = await ubuntu
      .readDocument("tasks/projects/other-api/project.yaml")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SchemaError);
    expect((error as SchemaError).issues[0]).toMatchObject({ field: "slug" });
  });

  it("keeps the HLC above an event that it wrote with a later HLC", async () => {
    const ws = open("ubuntu-01");
    await ws.appendEvent(taskLog("ubuntu-01"), {
      ...ws.newEvent("comment.added", { text: "from a restored log" }),
      hlc: "2026-11-22T15:00:00.000Z#0003",
    });
    expect((await ws.writeEvent(taskLog("ubuntu-01"), "comment.added", { text: "next" })).hlc).toBe(
      "2026-11-22T15:00:00.000Z#0004",
    );
  });

  it("validates a document before the write and writes nothing on an error", async () => {
    const ws = open("macbook-pro");
    await expect(
      ws.writeDocument("tasks/workspace.yaml", {
        kind: "workspace",
        schema: 1,
        name: "x",
      } as never),
    ).rejects.toMatchObject({ code: "schema_error" });
    await expect(ws.readText("tasks/workspace.yaml")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("synced links (final check fc1-1, fc1-3)", () => {
  const log = `tasks/${FIXTURE_TASK_ID}/log/ubuntu-01.jsonl`;

  it("never appends an event through a link in place of the own log", async () => {
    const outside = join(root, "..", `${root.split("/").at(-1)}-rc`);
    await writeFile(outside, "# a shell start file\n");
    await mkdir(join(root, "tasks", FIXTURE_TASK_ID, "log"), { recursive: true });
    await symlink(outside, join(root, ...log.split("/")));
    const ws = open("ubuntu-01");
    await expect(
      ws.writeEvent(log, "comment.added", { text: "ok $(touch /tmp/x)" }),
    ).rejects.toMatchObject({ code: "ENOTREG" });
    expect(await readFile(outside, "utf8")).toBe("# a shell start file\n");
    await rm(outside);
  });

  it("never writes into a folder of the layout that is a link", async () => {
    const outside = await mkdtemp(join(tmpdir(), "aw-ws-outside-"));
    await mkdir(join(root, "tasks", FIXTURE_TASK_ID), { recursive: true });
    await symlink(outside, join(root, "tasks", FIXTURE_TASK_ID, "log"));
    const ws = open("ubuntu-01");
    await expect(ws.writeEvent(log, "comment.added", { text: "hello" })).rejects.toMatchObject({
      code: "ENOTREG",
    });
    expect(await readdirOrEmpty(outside)).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });

  it("never reads a text file or a document through a link", async () => {
    const outside = join(root, "..", `${root.split("/").at(-1)}-private`);
    await writeFile(outside, "kind: workspace\nprivate: key\n");
    const approach = `tasks/${FIXTURE_TASK_ID}/approach/v1.md`;
    await mkdir(join(root, "tasks", FIXTURE_TASK_ID, "approach"), { recursive: true });
    await symlink(outside, join(root, ...approach.split("/")));
    await symlink(outside, join(root, "tasks", "workspace.yaml"));
    const ws = open("macbook-pro");
    await expect(ws.readText(approach)).rejects.toMatchObject({ code: "ENOTREG" });
    await expect(ws.readDocument("tasks/workspace.yaml")).rejects.toMatchObject({
      code: "ENOTREG",
    });
    await rm(outside);
  });
});

async function readdirOrEmpty(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return readdir(dir).catch(() => []);
}
