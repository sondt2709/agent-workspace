import { FIXTURE_TASK_ID, readFixtureText } from "@aw/schema/testing";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseDocumentText, renderDocumentText } from "./documents.ts";
import { NewerVersionError, ParseError, SchemaError } from "./errors.ts";

const PATH = `tasks/${FIXTURE_TASK_ID}/task.yaml`;
const taskText = readFixtureText(PATH);

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected an error");
}

describe("YAML documents", () => {
  it("reads the fixture task with its defaults and its version", () => {
    const doc = parseDocumentText(taskText, PATH, "task");
    expect(doc).toMatchObject({ kind: "task", version: 1, status: "current" });
    expect(doc.value.key).toBe("AW-7");
    expect(doc.value.claim).toEqual({
      epoch: 1,
      device: "ubuntu-01",
      session: "01a20390-53c0-73f3-af1e-cebbd1410ab4",
    });
  });

  it("keeps the comments of the nodes that stay when it changes a value", () => {
    const doc = parseDocumentText(taskText, PATH, "task");
    const next = { ...doc.value, title: "Fix the flaky invoice and refund tests", stage: "review" };
    const text = renderDocumentText(next, taskText);
    expect(text).toContain("key: AW-7 # display alias");
    expect(text).toContain("stage: review # backlog, discuss, ready, implement, review, done");
    expect(text).toContain("# Log lines of each device in this snapshot.");
    expect(text).toContain("title: Fix the flaky invoice and refund tests");
    expect(parseDocumentText(text, PATH, "task").value).toEqual(next);
  });

  it("adds new keys and removes missing keys", () => {
    const text = renderDocumentText({ a: 1, b: [1, 2] }, "a: 0 # first\nc: 3\nb: [1, 2, 3]\n");
    expect(text).toBe("a: 1 # first\nb: [ 1, 2 ]\n");
  });

  it("removes a key whose new value is undefined", () => {
    const text = renderDocumentText({ a: 1, extra: undefined }, "a: 0 # first\nextra: old\n");
    expect(text).toBe("a: 1 # first\n");
  });

  it("keeps a string that looks like a number a string", () => {
    const text = renderDocumentText(
      { title: "123", flag: "true", none: "null" },
      "title: hello\nflag: x\nnone: y\n",
    );
    expect(parse(text)).toEqual({ title: "123", flag: "true", none: "null" });
  });

  it("reports a schema error with the path and the field", () => {
    const error = errorOf(() =>
      parseDocumentText(taskText.replace("stage: implement", "stage: testing"), PATH),
    );
    expect(error).toBeInstanceOf(SchemaError);
    const schemaError = error as SchemaError;
    expect(schemaError.code).toBe("schema_error");
    expect(schemaError.path).toBe(PATH);
    expect(schemaError.schema).toBe("task.v1");
    expect(schemaError.issues).toEqual([
      expect.objectContaining({ path: "stage", field: "stage" }),
    ]);
  });

  it("reports the field of a nested error", () => {
    const error = errorOf(() =>
      parseDocumentText(taskText.replace("epoch: 1", "epoch: 0"), PATH),
    ) as SchemaError;
    expect(error.issues[0]).toMatchObject({ path: "claim.epoch", field: "epoch" });
  });

  it("reports a YAML syntax error with the line", () => {
    const error = errorOf(() =>
      parseDocumentText("kind: task\nschema: 1\ntitle: [unclosed\n", PATH),
    );
    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).line).toBeGreaterThanOrEqual(3);
    expect((error as ParseError).path).toBe(PATH);
  });

  it("reports a duplicate key as a syntax error", () => {
    expect(errorOf(() => parseDocumentText("kind: task\nkind: task\n", PATH))).toBeInstanceOf(
      ParseError,
    );
  });

  it("reports a newer major version, and refuses version 0", () => {
    const newer = errorOf(() =>
      parseDocumentText(taskText.replace("schema: 1", "schema: 2"), PATH),
    );
    expect(newer).toBeInstanceOf(NewerVersionError);
    expect(newer).toMatchObject({ code: "newer_version", type: "task", version: 2 });
    expect(
      errorOf(() => parseDocumentText(taskText.replace("schema: 1", "schema: 0"), PATH)),
    ).toBeInstanceOf(SchemaError);
  });

  it("refuses a document whose kind does not match the path", () => {
    const error = errorOf(() => parseDocumentText(taskText, PATH, "project")) as SchemaError;
    expect(error.issues[0]).toMatchObject({ path: "kind", field: "kind" });
  });
});
