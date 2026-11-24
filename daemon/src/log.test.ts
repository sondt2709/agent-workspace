// The logger redaction and the warning filter (design decisions 15 and 16).
import { afterEach, describe, expect, it } from "vitest";
import { installWarningFilter, isSqliteExperimentalWarning } from "./log.ts";
import { memoryLogger } from "./testing.ts";

describe("logger", () => {
  it("redacts the fields named like a secret at depth 1 and 2 and in request headers", () => {
    const { log, lines } = memoryLogger("info");
    log.info(
      {
        token: "fake-credential-1",
        session: { secret: "fake-credential-2", name: "keep" },
        req: {
          headers: { authorization: "Bearer fake-credential-3", cookie: "a=fake-credential-4" },
        },
      },
      "a line",
    );
    const text = JSON.stringify(lines());
    expect(text).not.toContain("fake-credential");
    expect(lines()[0]).toMatchObject({
      token: "[Redacted]",
      session: { secret: "[Redacted]", name: "keep" },
      req: { headers: { authorization: "[Redacted]", cookie: "[Redacted]" } },
    });
  });
});

describe("warning filter", () => {
  const original = process.listeners("warning");
  afterEach(() => {
    process.removeAllListeners("warning");
    for (const listener of original) process.on("warning", listener);
  });

  it("knows the SQLite ExperimentalWarning", () => {
    const sqlite = Object.assign(
      new Error("SQLite is an experimental feature and might change at any time"),
      {
        name: "ExperimentalWarning",
      },
    );
    const other = Object.assign(new Error("WASI is an experimental feature"), {
      name: "ExperimentalWarning",
    });
    expect(isSqliteExperimentalWarning(sqlite)).toBe(true);
    expect(isSqliteExperimentalWarning(other)).toBe(false);
    expect(
      isSqliteExperimentalWarning(
        Object.assign(new Error("SQLite x"), { name: "DeprecationWarning" }),
      ),
    ).toBe(false);
  });

  it("drops only the SQLite warning and logs the other warnings", async () => {
    const { log, lines } = memoryLogger("info");
    installWarningFilter(() => log);
    process.emitWarning(
      "SQLite is an experimental feature and might change at any time",
      "ExperimentalWarning",
    );
    process.emitWarning("Something else is experimental", "ExperimentalWarning");
    await new Promise((resolve) => setImmediate(resolve));
    const warnings = lines().map((line) => (line.warning as { message: string }).message);
    expect(warnings).toEqual(["Something else is experimental"]);
  });
});
