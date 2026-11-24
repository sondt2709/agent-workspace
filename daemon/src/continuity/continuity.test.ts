// Unit tests of the continuity rules (add-continuity): the resume policy, the usage limits, the
// queue, the watchdog, the pauses, the health document, the slots, the wake branch and the update.
import { TaskFold, type EventRow, type GateView, type SlotView, type TaskView } from "@aw/core";
import { healthV1 } from "@aw/schema";
import { execa } from "execa";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/records.ts";
import { authState, loginEndsSoon } from "./auth.ts";
import { HEALTH_MIN_MS, healthDocument, healthDue, healthKey, sessionState } from "./health.ts";
import { launcherScript } from "./launcher.ts";
import { pauseChanged, pauseData } from "./pause.ts";
import { parseProcessLine, runsSession } from "./processes.ts";
import { isWorking, queueOrder, startBlock } from "./queue.ts";
import {
  LAUNCH_WAIT_RETRY_MS,
  lostNote,
  MAX_LAUNCH_WAITS,
  resumePlan,
  type ResumeInput,
} from "./resume.ts";
import { SlotService, type SlotHost } from "./slots.ts";
import {
  installRelease,
  readUpdateState,
  startDecision,
  verifyRelease,
  versionPaths,
} from "./update.ts";
import { fiveHourUse, limitPlan, limitText, shortTime } from "./usage.ts";
import { pushUnpushedWork, wakeBranchName, wakeComment } from "./wake.ts";
import { LONG_QUIET_MS, newWatchState, QUIET_MS, watchStep } from "./watchdog.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse("2026-11-23T10:00:00.000Z");
const hlc = (ms: number, n = 0) => `${new Date(ms).toISOString()}#${String(n).padStart(4, "0")}`;

function task(fields: Partial<TaskView> = {}): TaskView {
  const base = new TaskFold("01a206b8-f29e-7776-b986-8ff4fc98b6b4").toView();
  return {
    ...base,
    key: "AW-7",
    title: "A task",
    stage: "implement",
    owner: "macbook-pro",
    assignee: "claude@macbook-pro",
    created: { event: "01a206b8-f29e-7776-b986-000000000001", dev: "macbook-pro", hlc: hlc(T0) },
    ...fields,
  };
}

function openGate(): GateView {
  return {
    gate: "01a206b8-f29e-7776-b986-000000000010",
    kind: "question",
    version: 1,
    title: "Which?",
    options: [],
    file: null,
    opened: { event: "01a206b8-f29e-7776-b986-000000000011", dev: "macbook-pro", hlc: hlc(T0) },
    state: "open",
    answer: null,
    answer_event: null,
    resolved_by: null,
    answers: [],
  };
}

describe("resume policy (review items 1 to 4)", () => {
  const base: ResumeInput = {
    now: T0,
    status: 1,
    firstSeen: true,
    started: true,
    conversation: true,
    resumes: 0,
    resumeTimes: [],
    restarts: 0,
    launchWaits: 0,
    openedAt: T0 - MIN,
  };

  it("resumes with the continue message, and fails after 2 resumes with no progress", () => {
    expect(resumePlan(base)).toEqual({ action: "resume", message: "continue", counted: true });
    const failed = resumePlan({ ...base, resumes: 2, resumeTimes: [T0 - 2 * MIN, T0 - MIN] });
    expect(failed).toMatchObject({ action: "failed" });
    expect((failed as { text: string }).text).toMatch(/^Resume failed: the agent made no progress/);
  });

  it("fails after 5 resumes in one hour, also with progress between them", () => {
    const times = [1, 2, 3, 4, 5].map((n) => T0 - n * 5 * MIN);
    const plan = resumePlan({ ...base, resumes: 0, resumeTimes: times });
    expect(plan.action).toBe("failed");
    expect((plan as { text: string }).text).toMatch(/5 resumes in the last hour/);
    // Older resumes do not count.
    const old = [1, 2, 3, 4, 5].map((n) => T0 - HOUR - n * MIN);
    expect(resumePlan({ ...base, resumeTimes: old })).toMatchObject({ action: "resume" });
  });

  it("does not count an aw-launch exit 3, waits 30 s, and counts after 20 in a row", () => {
    const notReady = { ...base, status: 3, resumes: 2, openedAt: T0 - 5000 };
    expect(resumePlan(notReady)).toEqual({ action: "wait" });
    expect(resumePlan({ ...notReady, openedAt: T0 - LAUNCH_WAIT_RETRY_MS })).toEqual({
      action: "resume",
      message: "continue",
      counted: false,
    });
    expect(
      resumePlan({
        ...notReady,
        openedAt: T0 - LAUNCH_WAIT_RETRY_MS,
        launchWaits: MAX_LAUNCH_WAITS,
      }),
    ).toMatchObject({ action: "failed" });
    // An agent with no conversation (aw-launch failed before the agent): a new start, no count.
    expect(
      resumePlan({
        ...notReady,
        openedAt: undefined,
        firstSeen: false,
        started: false,
        conversation: false,
        restarts: 3,
      }),
    ).toEqual({ action: "fresh", lost: false, counted: false });
  });

  it("starts again with the first input and a note when the transcript is lost", () => {
    const lost = { ...base, conversation: false, resumes: 2, resumeTimes: [T0 - MIN] };
    expect(resumePlan(lost)).toEqual({ action: "fresh", lost: true, counted: true });
    expect(resumePlan({ ...lost, restarts: 3 })).toMatchObject({ action: "failed" });
    // While resumes are left, AW still tries --resume (the adapter can be wrong).
    expect(resumePlan({ ...lost, resumes: 1 })).toMatchObject({ action: "resume" });
    expect(lostNote("AW-7")).toContain("aw thread AW-7");
  });

  it("resumes with the first input when no prompt reached the agent", () => {
    expect(resumePlan({ ...base, firstSeen: false, conversation: true })).toEqual({
      action: "resume",
      message: "first",
      counted: true,
    });
  });

  it("starts again with --session-id before the first conversation, at most 3 times", () => {
    const none = { ...base, firstSeen: false, started: false, conversation: false };
    expect(resumePlan(none)).toEqual({ action: "fresh", lost: false, counted: true });
    const failed = resumePlan({ ...none, restarts: 3 });
    expect(failed.action).toBe("failed");
    expect((failed as { text: string }).text).toMatch(/^Start failed/);
  });
});

describe("usage limits", () => {
  const usage = (
    five: [number, number | null] | null,
    week: [number, number | null] | null = null,
  ) => ({
    five_hour: five ? { used_percentage: five[0], resets_at: five[1] } : null,
    seven_day: week ? { used_percentage: week[0], resets_at: week[1] } : null,
    at: T0,
  });

  it("a 5-hour limit: Claude Code continues by itself at the reset", () => {
    const plan = limitPlan(usage([100, T0 + 2 * HOUR], [40, T0 + 3 * 24 * HOUR]), T0);
    expect(plan).toEqual({ cause: "usage_limit", resetsAt: T0 + 2 * HOUR, continueAt: null });
    expect(limitText(plan, T0, 0)).toBe(
      "Usage limit. Resumes at 12:00 UTC: Claude Code continues by itself.",
    );
  });

  it("a weekly limit: AW continues at the reset + 2 min", () => {
    const reset = T0 + 3 * 24 * HOUR;
    const plan = limitPlan(usage([30, T0 + HOUR], [100, reset]), T0);
    expect(plan).toEqual({
      cause: "usage_limit_weekly",
      resetsAt: reset,
      continueAt: reset + 2 * MIN,
    });
    expect(limitText(plan, T0, 1)).toMatch(
      /^Weekly limit\. Resumes Thu 11-26 10:00 UTC: AW continues the session \(continue 2 of 3\)\.$/,
    );
  });

  it("a reset more than 24 h away is weekly; no window gives no reset time", () => {
    expect(limitPlan(usage([100, T0 + 30 * HOUR]), T0).cause).toBe("usage_limit_weekly");
    expect(limitPlan(null, T0)).toEqual({ cause: "usage_limit", resetsAt: null, continueAt: null });
    // A late statusline: no window at 100 %, the 5-hour reset is the best guess.
    expect(limitPlan(usage([97, T0 + HOUR]), T0).resetsAt).toBe(T0 + HOUR);
  });

  it("the queue sees the highest 5-hour use that did not reset", () => {
    expect(fiveHourUse([usage([92, T0 + HOUR]), usage([40, T0 + HOUR]), null], T0)).toBe(92);
    expect(fiveHourUse([usage([92, T0 - 1])], T0)).toBeNull();
    expect(shortTime(T0 + 30 * MIN, T0)).toBe("10:30 UTC");
  });
});

describe("agent queue", () => {
  const a = task({ id: "a", created: { event: "e1", dev: "d", hlc: hlc(T0) } });
  const b = task({ id: "b", created: { event: "e2", dev: "d", hlc: hlc(T0 + 1) } });
  const c = task({ id: "c", created: { event: "e3", dev: "d", hlc: hlc(T0 + 2) } });

  it("orders by the queue event first, then by creation", () => {
    expect(queueOrder([c, b, a], undefined).map((t) => t.id)).toEqual(["a", "b", "c"]);
    const queue = { event: "q", dev: "d", hlc: hlc(T0), agent: "claude@d", tasks: ["c", "a"] };
    expect(queueOrder([a, b, c], queue).map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("counts a session as working only with no open gate and no pause", () => {
    expect(isWorking(task())).toBe(true);
    expect(isWorking(task({ gates: [openGate()] }))).toBe(false);
    expect(
      isWorking(
        task({
          paused: {
            cause: "usage_limit",
            since: hlc(T0),
            resumes_at: null,
            next_step: "x",
            needs_human: false,
          },
        }),
      ),
    ).toBe(false);
    expect(isWorking(undefined)).toBe(false);
  });

  it("blocks a new start at the maximum, an ended login, 90 % usage or a full disk", () => {
    const ok = { working: 1, max: 2, loginValid: true, fiveHour: 50, disk: 40 };
    expect(startBlock(ok)).toBeNull();
    expect(startBlock({ ...ok, working: 2 })).toBe("2 of 2 sessions work");
    expect(startBlock({ ...ok, loginValid: false })).toMatch(/login/);
    expect(startBlock({ ...ok, loginValid: null, fiveHour: null, disk: null })).toBeNull();
    expect(startBlock({ ...ok, fiveHour: 91 })).toMatch(/91 %/);
    expect(startBlock({ ...ok, disk: 95 })).toMatch(/disk/);
  });
});

describe("watchdog", () => {
  it("warns once after 2 min of quiet, then once at 15 min, and starts again after activity", () => {
    let state = newWatchState(T0);
    const step = (now: number, screen: string, lastEvent = T0, waiting = false) => {
      const result = watchStep(state, { now, lastEvent, screen, waiting });
      state = result.state;
      return result.action.kind;
    };
    expect(step(T0, "❯ working\n")).toBe("none");
    expect(step(T0 + MIN, "❯ working\n")).toBe("none");
    expect(step(T0 + QUIET_MS, "❯ working\n")).toBe("quiet");
    expect(step(T0 + QUIET_MS + 30_000, "❯ working\n")).toBe("none");
    expect(step(T0 + LONG_QUIET_MS, "❯ working\n")).toBe("long");
    expect(step(T0 + LONG_QUIET_MS + 30_000, "❯ working\n")).toBe("none");
    // A screen change starts a new quiet period.
    const t1 = T0 + LONG_QUIET_MS + MIN;
    expect(step(t1, "❯ new line\n")).toBe("none");
    expect(step(t1 + QUIET_MS, "❯ new line\n")).toBe("quiet");
    // A hook event too.
    const t2 = t1 + QUIET_MS + MIN;
    expect(step(t2, "❯ new line\n", t2)).toBe("none");
    expect(step(t2 + QUIET_MS, "❯ new line\n", t2)).toBe("quiet");
  });

  it("sees no progress in the spinner, the timer and the token count of a real turn (fix list 0h)", () => {
    // The spinner of Claude Code 2.1.330 in a turn, captured on a test server on 2026-11-23
    // (verify-journeys J3); the rest of the screen is synthetic.
    const screen = (spinner: string, clock: string) =>
      `● Running the tests\n  ⎿ npm test\n\n${spinner}\n\n❯\n  ⏸ manual mode on · esc to interrupt · ${clock}\n`;
    let state = newWatchState(T0);
    const step = (now: number, text: string, idle = false) => {
      const result = watchStep(state, { now, lastEvent: T0, screen: text, waiting: false, idle });
      state = result.state;
      return result.action.kind;
    };
    expect(step(T0, screen("✽ Hullaballooing… (28s · ↓ 3.0k tokens)", "10:00"))).toBe("none");
    expect(step(T0 + MIN, screen("✻ Discombobulating… (88s · ↓ 3.4k tokens)", "10:01"))).toBe(
      "none",
    );
    expect(step(T0 + QUIET_MS, screen("✶ Hullaballooing… (148s · ↓ 3.9k tokens)", "10:02"))).toBe(
      "quiet",
    );
    // A new line of the agent is progress.
    const t1 = T0 + QUIET_MS + MIN;
    expect(step(t1, `${screen("✽ Hullaballooing… (208s · ↓ 4.0k tokens)", "10:03")}● Done\n`)).toBe(
      "none",
    );
    // After its Stop, the agent waits for input: no warning (verify-journeys finding 9).
    const done = "● Done\n\n❯\n";
    expect(step(t1 + MIN, done, true)).toBe("none");
    expect(step(t1 + MIN + QUIET_MS, done, true)).toBe("none");
    // In a turn, the same quiet screen gives the warning.
    expect(step(t1 + MIN + QUIET_MS + 1, done)).toBe("quiet");
  });

  it("says nothing while a gate is open or the task is paused", () => {
    const result = watchStep(newWatchState(T0), {
      now: T0 + LONG_QUIET_MS,
      lastEvent: T0,
      screen: "x",
      waiting: true,
    });
    expect(result.action.kind).toBe("none");
  });

  it("gives the last terminal line", () => {
    let state = newWatchState(T0);
    state = watchStep(state, {
      now: T0,
      lastEvent: T0,
      screen: "a\nlast line  \n\n",
      waiting: false,
    }).state;
    const result = watchStep(state, {
      now: T0 + QUIET_MS,
      lastEvent: T0,
      screen: "a\nlast line  \n\n",
      waiting: false,
    });
    expect(result.action).toEqual({ kind: "quiet", line: "last line" });
  });
});

describe("pauses", () => {
  const input = {
    cause: "usage_limit" as const,
    next_step: "Usage limit.",
    resumes_at: T0 + HOUR,
    needs_human: false,
  };

  it("writes a pause only when the cause, the text or the time changed", () => {
    const data = pauseData(input);
    expect(data).toEqual({
      cause: "usage_limit",
      resumes_at: "2026-11-23T11:00:00.000Z",
      next_step: "Usage limit.",
      needs_human: false,
    });
    const current = { ...data, since: hlc(T0) };
    expect(pauseChanged(null, input)).toBe(true);
    expect(pauseChanged(current, input)).toBe(false);
    expect(pauseChanged(current, { ...input, next_step: "Other" })).toBe(true);
    expect(pauseChanged(current, { ...input, resumes_at: null })).toBe(true);
    expect(pauseChanged(current, { ...input, cause: "agent_error" })).toBe(true);
  });
});

describe("sign-in state", () => {
  it("is not valid when logged out or past the end, and warns 3 days before the end", () => {
    const expires = new Date(T0 + 2 * 24 * HOUR).toISOString();
    const state = authState({ loggedIn: true, method: "claude.ai", expiresAt: expires }, T0);
    expect(state.valid).toBe(true);
    expect(loginEndsSoon(state, T0)).toBe(true);
    expect(loginEndsSoon(state, T0 - 2 * 24 * HOUR)).toBe(false);
    expect(authState({ loggedIn: false, method: null, expiresAt: null }, T0).valid).toBe(false);
    expect(
      authState({ loggedIn: true, method: null, expiresAt: hlc(T0 - 1).slice(0, 24) }, T0).valid,
    ).toBe(false);
  });
});

describe("device health", () => {
  const record = { state: "running" } as SessionRecord;

  it("validates against health.v1 and lists the session states", () => {
    expect(sessionState(record, task())).toBe("running");
    expect(sessionState(record, task({ gates: [openGate()] }))).toBe("gate");
    expect(sessionState({ state: "ended" } as SessionRecord, task())).toBe("ended");
    const doc = healthDocument({
      device: "macbook-pro",
      updated: hlc(T0),
      bootTime: new Date(T0 - HOUR).toISOString(),
      versions: { aw: "0.0.0", claude: "2.1.330" },
      sessions: [
        {
          session: "01a206b8-f29e-7776-b986-000000000020",
          task: "01a206b8-f29e-7776-b986-8ff4fc98b6b4",
          state: "running",
        },
      ],
      usage: {
        five_hour: { used_percentage: 42, resets_at: T0 + HOUR },
        seven_day: null,
        at: T0,
      },
      loginExpiresAt: null,
      disk: 61.27,
    });
    const parsed = healthV1.parse(doc);
    expect(parsed.usage[0]!.five_hour).toEqual({
      used_percentage: 42,
      resets_at: "2026-11-23T11:00:00.000Z",
    });
    expect(parsed.disk.used_percentage).toBe(61.3);
    expect((parsed as Record<string, unknown>).last_backup).toBeNull();
    // The time alone is no change.
    expect(healthKey({ ...doc, updated: hlc(T0 + 1) })).toBe(healthKey(doc));
  });

  it("writes the queue limits for the queue view of other devices", () => {
    const doc = healthDocument({
      device: "macbook-pro",
      updated: hlc(T0),
      bootTime: new Date(T0 - HOUR).toISOString(),
      versions: {},
      sessions: [],
      usage: null,
      loginExpiresAt: null,
      disk: 40,
      queue: { maxWorking: 3, diskFullPercent: 95, loginValid: true },
    });
    expect(healthV1.parse(doc).queue).toEqual({
      max_working: 3,
      disk_full_percent: 95,
      login_valid: true,
    });
    // A change of the sign-in state is a change of the file.
    const other = healthDocument({
      ...{ device: "macbook-pro", updated: hlc(T0), bootTime: new Date(T0 - HOUR).toISOString() },
      ...{ versions: {}, sessions: [], usage: null, loginExpiresAt: null, disk: 40 },
      queue: { maxWorking: 3, diskFullPercent: 95, loginValid: false },
    });
    expect(healthKey(other)).not.toBe(healthKey(doc));
  });

  it("writes at most once per 60 s, and again only after a change or 10 min", () => {
    expect(healthDue({ now: T0, lastWrite: null, lastKey: null, key: "a" })).toBe(true);
    expect(healthDue({ now: T0 + 1000, lastWrite: T0, lastKey: "a", key: "b" })).toBe(false);
    expect(healthDue({ now: T0 + HEALTH_MIN_MS, lastWrite: T0, lastKey: "a", key: "b" })).toBe(
      true,
    );
    expect(healthDue({ now: T0 + HEALTH_MIN_MS, lastWrite: T0, lastKey: "a", key: "a" })).toBe(
      false,
    );
    expect(healthDue({ now: T0 + 10 * MIN, lastWrite: T0, lastKey: "a", key: "a" })).toBe(true);
  });
});

describe("processes", () => {
  it("reads the process group and the arguments, and matches the session id as a word", () => {
    expect(parseProcessLine("  4242 claude --resume abc -n AW-7\n")).toEqual({
      pgid: 4242,
      args: "claude --resume abc -n AW-7",
    });
    expect(parseProcessLine("")).toBeNull();
    expect(runsSession("claude --session-id abc-1 -n x", "abc-1")).toBe(true);
    expect(runsSession("claude --session-id abc-12", "abc-1")).toBe(false);
  });
});

describe("test slots", () => {
  /** A fake host: the merge view is a list that the writes change, like the workspace fold. */
  function host(capacity: Record<string, number>, owner = "ubuntu-01") {
    let now = T0;
    let n = 0;
    const leases: SlotView[] = [];
    const rows: EventRow[] = [];
    const running = new Set(["s1", "s2", "s3"]);
    const h: SlotHost & {
      leases(): SlotView[];
      advance(ms: number): void;
      stop(s: string): void;
      written: string[];
    } = {
      me: "ubuntu-01",
      now: () => now,
      ownerOf: (resource) => (resource in capacity ? owner : null),
      capacity: (resource) => capacity[resource],
      leases: () => leases,
      workspaceRows: () => rows,
      running: (s) => running.has(s),
      written: [],
      advance(ms) {
        now += ms;
      },
      stop(s) {
        running.delete(s);
      },
      write(type, data) {
        const id = `e${++n}`;
        const at = hlc(now, n);
        h.written.push(
          `${type}:${String(data.slot)}:${String(data.fencing_token)}${typeof data.reason === "string" ? `:${data.reason}` : ""}`,
        );
        rows.push({
          id,
          hlc: at,
          dev: "ubuntu-01",
          type,
          event: { id, hlc: at, dev: "ubuntu-01", type, data },
        } as unknown as EventRow);
        const i = leases.findIndex((l) => l.resource === data.resource && l.slot === data.slot);
        if (type === "slot.acquired") {
          leases.push({
            device: "ubuntu-01",
            resource: data.resource as string,
            slot: data.slot as number,
            fencing_token: data.fencing_token as number,
            ttl_ms: data.ttl_ms as number,
            task: data.task as string,
            session: data.session as string,
            acquired: { event: id, dev: "ubuntu-01", hlc: at },
            renewed_hlc: at,
            expires_at: new Date(now + (data.ttl_ms as number)).toISOString(),
          });
        } else if (type === "slot.renewed" && i >= 0) {
          leases[i] = {
            ...leases[i]!,
            renewed_hlc: at,
            expires_at: new Date(now + (data.ttl_ms as number)).toISOString(),
          };
        } else if (i >= 0) {
          leases.splice(i, 1);
        }
        return Promise.resolve();
      },
    };
    return h;
  }

  it("gives a lease with a fencing token, queues the next session, and renews", async () => {
    const h = host({ k3d: 1 });
    const slots = new SlotService(h);
    const first = await slots.acquire({ resource: "k3d", task: "t1", session: "s1" });
    expect(first.lease).toMatchObject({ slot: 0, fencing_token: 1, ttl_ms: 30 * MIN });
    const second = await slots.acquire({ resource: "k3d", task: "t2", session: "s2" });
    expect(second).toMatchObject({ lease: null, queued: 1 });
    const third = await slots.acquire({ resource: "k3d", task: "t3", session: "s3" });
    expect(third.queued).toBe(2);
    h.advance(MIN);
    const renewed = await slots.acquire({ resource: "k3d", task: "t1", session: "s1" });
    expect(renewed).toMatchObject({ renewed: true, lease: { fencing_token: 1 } });
    expect(Date.parse(renewed.lease!.expires_at)).toBe(T0 + 31 * MIN);
    // The release gives the slot to the first in the queue, with a higher token.
    await slots.release({ resource: "k3d", session: "s1" });
    expect((await slots.acquire({ resource: "k3d", task: "t3", session: "s3" })).queued).toBe(2);
    const next = await slots.acquire({ resource: "k3d", task: "t2", session: "s2" });
    expect(next.lease).toMatchObject({ slot: 0, fencing_token: 2 });
  });

  it("revokes an expired lease, releases the lease of an ended session, and revokes at a reboot", async () => {
    const h = host({ k3d: 2 });
    const slots = new SlotService(h);
    await slots.acquire({ resource: "k3d", task: "t1", session: "s1" });
    await slots.acquire({ resource: "k3d", task: "t2", session: "s2" });
    // The session heartbeat renews a running lease at ttl/3.
    h.advance(11 * MIN);
    expect(await slots.expire()).toBe(0);
    expect(h.written.slice(-2)).toEqual(["slot.renewed:0:1", "slot.renewed:1:1"]);
    h.stop("s2");
    await slots.expire();
    expect(h.written.at(-1)).toBe("slot.released:1:1");
    // awd was down longer than the TTL: the lease expired.
    h.advance(31 * MIN);
    await slots.expire();
    expect(h.written.at(-1)).toBe("slot.revoked:0:1:expired");
    expect(h.leases()).toEqual([]);
    const again = await slots.acquire({ resource: "k3d", task: "t1", session: "s1" });
    expect(again.lease).toMatchObject({ slot: 0, fencing_token: 2 });
    await slots.expire(T0 + 50 * MIN);
    expect(h.written.at(-1)).toBe("slot.revoked:0:2:reboot");
  });

  it("refuses a resource of another device and an unknown resource", async () => {
    const slots = new SlotService(host({ k3d: 1 }, "macbook-pro"));
    await expect(
      slots.acquire({ resource: "k3d", task: "t", session: "s1" }),
    ).rejects.toMatchObject({
      code: "not_available",
    });
    await expect(
      slots.acquire({ resource: "gpu", task: "t", session: "s1" }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      new SlotService(host({ k3d: 1 })).release({ resource: "k3d", session: "s1" }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("drops a queue entry that stops asking for 2 min", async () => {
    const h = host({ k3d: 1 });
    const slots = new SlotService(h);
    await slots.acquire({ resource: "k3d", task: "t1", session: "s1" });
    await slots.acquire({ resource: "k3d", task: "t2", session: "s2" });
    h.advance(3 * MIN);
    expect((await slots.acquire({ resource: "k3d", task: "t3", session: "s3" })).queued).toBe(1);
  });
});

describe("wake branch", () => {
  const git = (cwd: string, args: string[]) =>
    execa("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);

  async function repoWithOrigin(root: string) {
    const origin = join(root, "origin.git");
    await execa("git", ["init", "-q", "--bare", origin]);
    const repo = join(root, "repo");
    await execa("git", ["init", "-q", "-b", "main", repo]);
    await writeFile(join(repo, "work.txt"), "base\n");
    await git(repo, ["add", "work.txt"]);
    await git(repo, ["commit", "-q", "-m", "one"]);
    await git(repo, ["remote", "add", "origin", origin]);
    await git(repo, ["push", "-q", "origin", "main"]);
    return { origin, repo };
  }

  it("commits the tracked changes and pushes them as aw/<key>-<device>-<HHMM>", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-wake-"));
    try {
      const { origin, repo } = await repoWithOrigin(root);
      const wt = join(root, "wt");
      await git(repo, ["worktree", "add", "-q", "-b", "aw/AW-7", wt, "HEAD"]);
      // A tag with the name of the branch: the task branch is still found (review of fc1-5).
      await git(repo, ["tag", "aw/AW-7"]);
      const input = {
        cwd: wt,
        key: "AW-7",
        branch: "aw/AW-7",
        device: "macbook-pro",
        now: T0 + 15 * MIN,
      };
      // A fresh worktree: nothing to save.
      expect(await pushUnpushedWork(input)).toMatchObject({ kind: "nothing" });
      expect(wakeComment(await pushUnpushedWork(input), "macbook-pro", null)).toBeNull();
      await writeFile(join(wt, "work.txt"), "unpushed\n");
      const result = await pushUnpushedWork(input);
      expect(result).toMatchObject({ kind: "pushed", branch: "aw/AW-7-macbook-pro-1015" });
      const shown = await execa("git", ["-C", origin, "show", "aw/AW-7-macbook-pro-1015:work.txt"]);
      expect(shown.stdout).toBe("unpushed");
      expect(wakeComment(result, "macbook-pro", "ubuntu-01")).toBe(
        "Moved to ubuntu-01. Unpushed work of macbook-pro is on aw/AW-7-macbook-pro-1015.",
      );
      // A second wake at the same minute gets a new name.
      await writeFile(join(wt, "work.txt"), "more\n");
      expect(await pushUnpushedWork(input)).toMatchObject({
        kind: "pushed",
        branch: "aw/AW-7-macbook-pro-1015-2",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("commits nothing when the folder has another branch than the task branch (final check fc1-5)", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-wake-"));
    try {
      // The project checkout of a task: the person went back to main and edits a file.
      const { origin, repo } = await repoWithOrigin(root);
      await git(repo, ["branch", "aw/AW-3"]);
      await writeFile(join(repo, "work.txt"), "draft of the person\n");
      const before = (await git(repo, ["rev-parse", "main"])).stdout;
      const result = await pushUnpushedWork({
        cwd: repo,
        key: "AW-3",
        branch: "aw/AW-3",
        device: "mac",
        now: T0,
      });
      expect(result).toMatchObject({ kind: "other_branch", head: "main" });
      expect((await git(repo, ["rev-parse", "main"])).stdout).toBe(before);
      expect(await readFile(join(repo, "work.txt"), "utf8")).toBe("draft of the person\n");
      expect((await git(repo, ["diff", "--cached", "--name-only"])).stdout).toBe("");
      expect(await execa("git", ["-C", origin, "branch", "--list", "aw/*"])).toMatchObject({
        stdout: "",
      });
      expect(wakeComment(result, "mac", "ubuntu-01")).toBe(
        "Moved to ubuntu-01. AW saved no unpushed work on mac: the folder has main checked out, not aw/AW-3.",
      );
      // A session with no task branch: nothing either.
      expect(
        await pushUnpushedWork({ cwd: repo, key: "AW-3", branch: null, device: "mac", now: T0 }),
      ).toMatchObject({ kind: "other_branch" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not commit untracked files and names them in the comment", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-wake-"));
    try {
      const { origin, repo } = await repoWithOrigin(root);
      await git(repo, ["checkout", "-q", "-b", "aw/AW-9"]);
      await writeFile(join(repo, "notes.txt"), "token=abc\n");
      await writeFile(join(repo, "work.txt"), "changed\n");
      const result = await pushUnpushedWork({
        cwd: repo,
        key: "AW-9",
        branch: "aw/AW-9",
        device: "mac",
        now: T0,
      });
      expect(result).toMatchObject({
        kind: "pushed",
        untracked: { names: ["notes.txt"], count: 1 },
      });
      const files = await execa("git", [
        "-C",
        origin,
        "ls-tree",
        "--name-only",
        "aw/AW-9-mac-1000",
      ]);
      expect(files.stdout.split("\n")).toEqual(["work.txt"]);
      expect(wakeComment(result, "mac", null)).toBe(
        "Unpushed work of mac is on aw/AW-9-mac-1000. 1 untracked file stays in the worktree on mac: notes.txt.",
      );
      // Only untracked files: no branch, but the comment names them.
      const only = await pushUnpushedWork({
        cwd: repo,
        key: "AW-9",
        branch: "aw/AW-9",
        device: "mac",
        now: T0 + MIN,
      });
      expect(only).toMatchObject({ kind: "nothing" });
      expect(wakeComment(only, "mac", "ubuntu-01")).toBe(
        "Moved to ubuntu-01. 1 untracked file stays in the worktree on mac: notes.txt.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs the hooks: a refusing pre-commit and pre-push hook keep the work local", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-wake-"));
    try {
      const { origin, repo } = await repoWithOrigin(root);
      await git(repo, ["checkout", "-q", "-b", "aw/AW-5"]);
      await git(repo, ["commit", "-q", "--allow-empty", "-m", "agent commit"]);
      const ran = join(root, "hooks-ran.txt");
      for (const hook of ["pre-commit", "pre-push"]) {
        const file = join(repo, ".git", "hooks", hook);
        await writeFile(
          file,
          `#!/bin/sh\necho ${hook} >> '${ran}'\necho 'leak check failed' >&2\nexit 1\n`,
        );
        await chmod(file, 0o755);
      }
      // A commit-msg hook too: git does not say which hook refused, so the comment names both.
      const commitMsg = join(repo, ".git", "hooks", "commit-msg");
      await writeFile(commitMsg, "#!/bin/sh\nexit 0\n");
      await chmod(commitMsg, 0o755);
      await writeFile(join(repo, "work.txt"), "changed\n");
      const result = await pushUnpushedWork({
        cwd: repo,
        key: "AW-5",
        branch: "aw/AW-5",
        device: "mac",
        now: T0,
      });
      expect(result).toMatchObject({ kind: "local", branch: "aw/AW-5-mac-1000" });
      expect((await readFile(ran, "utf8")).split("\n")).toEqual(["pre-commit", "pre-push", ""]);
      expect(await execa("git", ["-C", origin, "branch", "--list", "aw/*"])).toMatchObject({
        stdout: "",
      });
      expect(await readFile(join(repo, "work.txt"), "utf8")).toBe("changed\n");
      expect(wakeComment(result, "mac", null)).toBe(
        "Unpushed work of mac is on the local branch aw/AW-5-mac-1000 of mac: the push failed (the pre-push hook refused the push: exit code 1). The changes of tracked files stay in the worktree on mac: the pre-commit or commit-msg hook refused the commit (exit code 1).",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a local branch when the push fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-wake-"));
    try {
      const repo = join(root, "repo");
      await execa("git", ["init", "-q", "-b", "main", repo]);
      await git(repo, ["commit", "-q", "--allow-empty", "-m", "one"]);
      await git(repo, ["checkout", "-q", "-b", "aw/AW-8"]);
      await git(repo, ["commit", "-q", "--allow-empty", "-m", "agent work"]);
      const result = await pushUnpushedWork({
        cwd: repo,
        key: "AW-8",
        branch: "aw/AW-8",
        device: "mac",
        now: T0,
      });
      expect(result).toMatchObject({ kind: "local", branch: wakeBranchName("AW-8", "mac", T0) });
      // The local time of the device: UTC+7 gives 17:00 for 10:00 UTC (verify-journeys finding 20).
      expect(wakeBranchName("AW-8", "mac", T0, 420)).toBe("aw/AW-8-mac-1700");
      expect(wakeBranchName("AW-8", "mac", T0, -330)).toBe("aw/AW-8-mac-0430");
      expect(wakeComment(result, "mac", null)).toMatch(
        /local branch aw\/AW-8-mac-1000 of mac: the push failed \(no remote origin\)/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("self-update", () => {
  async function release(root: string, version: string) {
    const src = join(root, `src-${version}`);
    await mkdir(join(src, "bin"), { recursive: true });
    await writeFile(join(src, "bin", "awd"), `#!/bin/sh\necho "awd ${version} $*"\n`);
    await chmod(join(src, "bin", "awd"), 0o755);
    const tarball = join(root, `aw-${version}.tar.gz`);
    await execa("tar", ["-czf", tarball, "-C", src, "."]);
    return tarball;
  }

  it("checks the Ed25519 signature, unpacks, switches current and keeps the previous version", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-update-"));
    try {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url").toString(
        "base64",
      );
      const signFile = async (tarball: string) => {
        const sig = sign(
          null,
          createHash("sha256")
            .update(await readFile(tarball))
            .digest(),
          privateKey,
        );
        await writeFile(`${tarball}.sig`, sig.toString("base64"));
        return `${tarball}.sig`;
      };
      const home = join(root, "home");
      const t1 = await release(root, "1.0.0");
      await installRelease({
        home,
        version: "1.0.0",
        tarball: t1,
        signatureFile: await signFile(t1),
        publicKey: raw,
      });
      const t2 = await release(root, "1.1.0");
      const state = await installRelease({
        home,
        version: "1.1.0",
        tarball: t2,
        signatureFile: await signFile(t2),
        publicKey: raw,
      });
      expect(state).toEqual({ current: "1.1.0", previous: "1.0.0", failed_starts: 0 });
      const paths = versionPaths(home);
      // A second install of the running version changes nothing, also with another tarball
      // (review continuity low 6): the folder of the running awd stays.
      const marker = join(paths.root, "1.1.0", "bin", "running.txt");
      await writeFile(marker, "in use");
      expect(
        await installRelease({
          home,
          version: "1.1.0",
          tarball: t2,
          signatureFile: `${t2}.sig`,
          publicKey: raw,
        }),
      ).toEqual(state);
      expect(await readFile(marker, "utf8")).toBe("in use");
      expect(await readlink(paths.current)).toBe("1.1.0");
      expect((await stat(join(paths.root, "1.1.0", "bin", "awd"))).isFile()).toBe(true);
      // A tarball that does not match its signature changes nothing.
      const t3 = await release(root, "1.2.0");
      await writeFile(`${t3}.sig`, await readFile(`${t2}.sig`, "utf8"));
      await expect(
        installRelease({
          home,
          version: "1.2.0",
          tarball: t3,
          signatureFile: `${t3}.sig`,
          publicKey: raw,
        }),
      ).rejects.toThrow(/signature/);
      expect(await readlink(paths.current)).toBe("1.1.0");
      await expect(stat(join(paths.root, "1.2.0"))).rejects.toThrow();
      expect(verifyRelease(Buffer.from("x"), "bad", raw)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("the launcher goes back to the previous version after 3 failed starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-launcher-"));
    try {
      const versions = join(root, "versions");
      for (const v of ["1.0.0", "1.1.0"]) {
        await mkdir(join(versions, v, "bin"), { recursive: true });
        await writeFile(join(versions, v, "bin", "awd"), `#!/bin/sh\necho "awd ${v}"\n`);
        await chmod(join(versions, v, "bin", "awd"), 0o755);
      }
      await symlink("1.1.0", join(versions, "current"));
      await symlink("1.0.0", join(versions, "previous"));
      const script = join(root, "awd-launcher");
      await writeFile(script, launcherScript({ versions }), { mode: 0o755 });
      const run = async () => (await execa("sh", [script])).stdout;
      // 3 starts that never reach the healthy time (awd resets the count after 60 s).
      expect(await run()).toBe("awd 1.1.0");
      expect(await run()).toBe("awd 1.1.0");
      expect(await run()).toBe("awd 1.1.0");
      expect(await run()).toBe("awd 1.0.0");
      expect(await readlink(join(versions, "current"))).toBe("1.0.0");
      expect(await readlink(join(versions, "previous"))).toBe("1.1.0");
      expect((await readUpdateState(versionPaths(root))).failed_starts).toBe(1);
      // The same rule in TypeScript.
      expect(startDecision({ current: "b", previous: "a", failed_starts: 3 })).toEqual({
        state: { current: "a", previous: "b", failed_starts: 1 },
        rollback: true,
      });
      expect(startDecision({ current: "b", previous: null, failed_starts: 5 }).rollback).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
