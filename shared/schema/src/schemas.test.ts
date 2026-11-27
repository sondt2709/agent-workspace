// Valid and invalid samples for each schema. Each sample runs against the zod schema and against
// the generated JSON Schema with an independent validator (@cfworker/json-schema).
import { Validator } from "@cfworker/json-schema";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventEnvelope, eventTypes, eventV1 } from "./events.ts";
import { schemaEntries } from "./registry.ts";
import { FIXTURE_TASK_ID, fixtureDocuments, fixtureEvents } from "./testing/fixtures.ts";
import {
  docLine,
  documentSamples,
  event,
  eventSamples,
  fixtureDocument,
  validData,
} from "./testing/samples.ts";

const zodByName = new Map(schemaEntries.map((entry) => [entry.name, entry.schema]));

function jsonSchemaValidator(name: string): Validator {
  const url = new URL(`../../../contracts/schemas/${name}.schema.json`, import.meta.url);
  const schema = JSON.parse(readFileSync(url, "utf8")) as object;
  return new Validator(schema, "2020-12", false);
}

/** Runs a value through both validators. Returns the zod issue paths. */
function check(name: string, value: unknown): { zod: boolean; json: boolean; paths: string[] } {
  const schema = zodByName.get(name);
  if (!schema) throw new Error(`No schema ${name}`);
  const result = schema.safeParse(value);
  const json = jsonSchemaValidator(name).validate(value).valid;
  const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  return { zod: result.success, json, paths };
}

describe("document samples", () => {
  const cases = documentSamples;

  it.each(cases)("$name", ({ schema, value, invalidPath }) => {
    const result = check(schema, value());
    const valid = invalidPath === undefined;
    expect(result.zod).toBe(valid);
    expect(result.json).toBe(valid);
    if (invalidPath !== undefined) expect(result.paths).toContain(invalidPath);
  });

  it("gives use_orca false to a bindings file with no use_orca", () => {
    const doc = fixtureDocument("bindings");
    delete doc.use_orca;
    expect(zodByName.get("bindings.v1")!.parse(doc)).toMatchObject({ use_orca: false });
  });

  it("keeps an unknown field", () => {
    const parsed = zodByName
      .get("task.v1")!
      .parse({ ...fixtureDocument("task"), priority_hint: "high" });
    expect(parsed).toMatchObject({ priority_hint: "high" });
  });
});

describe("event samples", () => {
  it("has valid data for each event type", () => {
    expect(Object.keys(validData).sort()).toEqual([...eventTypes].sort());
  });

  it.each(eventTypes)("%s: valid data passes, data null fails", (type) => {
    expect(check("event.v1", event(type, validData[type]))).toEqual({
      zod: true,
      json: true,
      paths: [],
    });
    const invalid = check("event.v1", event(type, null));
    expect(invalid.zod).toBe(false);
    expect(invalid.json).toBe(false);
  });

  const cases = eventSamples;

  it.each(cases)("$name", ({ value, invalidPath }) => {
    const result = check("event.v1", value);
    const valid = invalidPath === undefined;
    expect(result.zod).toBe(valid);
    expect(result.json).toBe(valid);
    if (invalidPath !== undefined) expect(result.paths).toContain(invalidPath);
  });

  it("rejects an unknown type in event.v1, and the envelope accepts it", () => {
    const value = event("task.teleported", { to: "mars" });
    expect(check("event.v1", value).zod).toBe(false);
    expect(check("event.v1", value).json).toBe(false);
    expect(eventEnvelope.safeParse(value).success).toBe(true);
  });

  it("parses the docs line into typed data", () => {
    const parsed = eventV1.parse(docLine);
    expect(parsed.type).toBe("gate.answered");
    if (parsed.type === "gate.answered") expect(parsed.data.answer).toBe("1000/min");
  });

  it("gives switch_branch true to the session options of an older event", () => {
    const parsed = eventV1.parse(
      event("task.assigned", {
        assignee: "claude@ubuntu-01",
        session_options: { work_in: "checkout" },
      }),
    );
    if (parsed.type !== "task.assigned") throw new Error(parsed.type);
    expect(parsed.data.session_options?.switch_branch).toBe(true);
  });

  it("heartbeat.v1 accepts a heartbeat and rejects another type", () => {
    expect(
      check("heartbeat.v1", event("device.heartbeat", validData["device.heartbeat"])).zod,
    ).toBe(true);
    const other = check("heartbeat.v1", event("task.done", {}));
    expect(other.zod).toBe(false);
    expect(other.json).toBe(false);
  });
});

describe("fixture folder", () => {
  it.each(fixtureDocuments().map((doc) => [doc.path, doc.value] as const))(
    "%s is valid with zod and with its JSON Schema",
    (_path, value) => {
      expect(check(`${String(value.kind)}.v${String(value.schema)}`, value)).toEqual({
        zod: true,
        json: true,
        paths: [],
      });
    },
  );

  it.each(fixtureEvents().map((e) => [`${e.path}:${e.line}`, e.value] as const))(
    "%s is valid with zod and with the JSON Schema event.v1",
    (_where, value) => {
      expect(check("event.v1", value)).toEqual({ zod: true, json: true, paths: [] });
    },
  );

  it("has 3 devices with the 3 roles, and a task log of each device", () => {
    const roles = fixtureDocuments()
      .filter((doc) => doc.value.kind === "device")
      .map((doc) => `${String(doc.value.slug)}:${String(doc.value.role)}`)
      .sort();
    expect(roles).toEqual(["macbook-pro:local", "pixel-9:mobile", "ubuntu-01:remote"]);
    const taskLogs = new Set(
      fixtureEvents()
        .filter((e) => e.path.startsWith(`tasks/${FIXTURE_TASK_ID}/log/`))
        .map((e) => e.value.dev),
    );
    expect([...taskLogs].sort()).toEqual(["macbook-pro", "pixel-9", "ubuntu-01"]);
  });

  it("has unique event ids, and each log is in HLC order", () => {
    const events = fixtureEvents();
    expect(new Set(events.map((e) => e.value.id)).size).toBe(events.length);
    for (const path of new Set(events.map((e) => e.path))) {
      const hlcs = events.filter((e) => e.path === path).map((e) => String(e.value.hlc));
      expect(hlcs).toEqual([...hlcs].sort());
    }
  });
});
