// A generator of random but schema-valid events for the property tests of the merge and the index.
// Not in the package index: product code does not use it.
import { newId } from "@aw/schema";
import type { FakeClock } from "../clock.ts";
import { createdData, event, FIXTURE_TASK, type TestEvent, type TestWorkspace } from "./testing.ts";

export const DEVICES = ["macbook-pro", "ubuntu-01", "pixel-9"] as const;
const KINDS = ["question", "confirm_approach", "approve_result"] as const;

/** Makes random but schema-valid events, with collisions of keys, claims, gates and answers. */
export class RandomEvents {
  readonly #random: () => number;
  readonly #clock: FakeClock;
  tasks: string[] = [FIXTURE_TASK];
  gates: string[] = [];
  answers: string[] = [];
  /** The ids of the written events, for duplicate ids in other files. */
  ids: string[] = [];

  constructor(random: () => number, clock: FakeClock) {
    this.#random = random;
    this.#clock = clock;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.#random() * items.length)]!;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.#random() * (max - min + 1));
  }

  /** An HLC up to 600 s before the local time; sometimes 2 days ahead (held back). */
  hlc(): string {
    const ahead = this.#random() < 0.04 ? 2 * 24 * 3600_000 : 0;
    const time = this.#clock.now() - this.int(0, 600_000) + ahead;
    return `${new Date(time).toISOString()}#${String(this.int(0, 3)).padStart(4, "0")}`;
  }

  id(): string {
    return newId({ now: () => this.#clock.now() });
  }

  /** One random event and the file it goes to. */
  next(): { path: string; event: TestEvent | string } {
    const dev = this.pick(DEVICES);
    const by = this.#random() < 0.6 ? `human@${dev}` : `claude@${dev}`;
    const hlc = this.hlc();
    const task = this.pick(this.tasks);
    const taskPath = (t: string) => `tasks/${t}/log/${dev}.jsonl`;
    const withTask = (e: TestEvent, t = task) => ({ path: taskPath(t), event: { ...e, task: t } });
    const roll = this.int(0, 21);
    switch (roll) {
      case 0: {
        const id = this.id();
        this.tasks.push(id);
        const parent = this.#random() < 0.3 ? this.pick(this.tasks.slice(0, -1)) : null;
        const assignee = this.#random() < 0.5 ? `claude@${this.pick(DEVICES)}` : null;
        return withTask(
          event(
            dev,
            "task.created",
            hlc,
            createdData(`AW-${this.int(7, 12)}`, { parent, assignee }),
            { by },
          ),
          id,
        );
      }
      case 1:
        return withTask(
          event(dev, "task.claimed", hlc, {
            epoch: this.int(1, 4),
            device: this.#random() < 0.9 ? dev : "pixel-9",
            session: this.id(),
            based_on: null,
          }),
        );
      case 2:
        return withTask(
          event(dev, "task.stage_changed", hlc, {
            from: "backlog",
            to: this.pick(["discuss", "ready", "implement", "done"]),
          }),
        );
      case 3: {
        const gate =
          this.#random() < 0.5 || this.gates.length === 0 ? this.id() : this.pick(this.gates);
        this.gates.push(gate);
        return withTask(
          event(dev, "gate.opened", hlc, {
            gate,
            kind: this.pick(KINDS),
            version: this.int(1, 2),
            title: "Gate",
            text: "",
            options: [],
            request_id: null,
            file: this.#random() < 0.5 ? "approach/v1.md" : null,
          }),
        );
      }
      case 4:
      case 5: {
        const e = event(
          dev,
          "gate.answered",
          hlc,
          {
            gate: this.gates.length ? this.pick(this.gates) : this.id(),
            version: this.int(1, 2),
            answer: this.pick(["confirm", "Wait", "100/min"]),
            comment: null,
          },
          { by: `human@${dev}` },
        );
        this.answers.push(e.id);
        return withTask(e);
      }
      case 6:
        return withTask(
          event(dev, "gate.resolved", hlc, {
            gate: this.gates.length ? this.pick(this.gates) : this.id(),
            version: this.int(1, 2),
            answer_event: this.answers.length ? this.pick(this.answers) : null,
            answer: "confirm",
          }),
        );
      case 7:
        return withTask(
          event(dev, "comment.added", hlc, { text: `comment ${this.int(0, 99)}` }, { by }),
        );
      case 8:
        return withTask(
          event(
            dev,
            "task.edited",
            hlc,
            {
              field: this.pick(["title", "first_message", "priority"]),
              value: `v${this.int(0, 9)}`,
            },
            { by },
          ),
        );
      case 9:
        return withTask(
          event(dev, "task.assigned", hlc, { assignee: `claude@${this.pick(DEVICES)}` }, { by }),
        );
      case 10:
        return withTask(
          event(dev, "task.rekeyed", hlc, {
            from: `AW-${this.int(7, 12)}`,
            to: `AW-${this.int(13, 20)}`,
          }),
        );
      case 11:
        return withTask(
          event(dev, "task.paused", hlc, {
            cause: "usage_limit",
            resumes_at: null,
            next_step: "Wait for the reset",
            needs_human: this.#random() < 0.5,
          }),
        );
      case 12:
        return withTask(event(dev, "task.resumed", hlc, {}));
      case 13:
        return withTask(
          event(dev, "session.started", hlc, {
            session: this.id(),
            host: "tmux",
            cwd: "/w",
            plugin_dir: null,
            branch: `aw/b${this.int(0, 9)}`,
            credentials: [],
            pids: { pane: null, claude: null, pgid: null },
          }),
        );
      case 14:
        return withTask(event(dev, "task.future_thing", hlc, { x: 1 }));
      case 15:
        return {
          path: `tasks/log/${dev}.jsonl`,
          event: event(
            dev,
            "queue.reordered",
            hlc,
            { agent: "claude@ubuntu-01", tasks: [this.pick(this.tasks)] },
            { by },
          ),
        };
      case 16: {
        const type = this.pick(["slot.acquired", "slot.renewed", "slot.released", "slot.revoked"]);
        const base = { resource: "k3d", slot: this.int(0, 1), fencing_token: this.int(1, 5) };
        const data =
          type === "slot.acquired"
            ? { ...base, ttl_ms: 60_000, task, session: this.id() }
            : type === "slot.renewed"
              ? { ...base, ttl_ms: 60_000 }
              : type === "slot.revoked"
                ? { ...base, reason: "expired" }
                : base;
        return { path: `tasks/log/${dev}.jsonl`, event: event(dev, type, hlc, data) };
      }
      case 17:
        return {
          path: `tasks/log/${dev}.jsonl`,
          event: event(
            dev,
            this.pick(["credential.added", "credential.removed"]),
            hlc,
            { name: this.pick(["stripe-test", "github-bot"]) },
            { by },
          ),
        };
      case 18:
        return {
          path: `tasks/devices/${dev}/heartbeat/2026-11-22.jsonl`,
          event: event(dev, "device.heartbeat", hlc, { boot_time: "2026-11-22T08:00:00.000Z" }),
        };
      case 19:
        return { path: taskPath(task), event: "not json at all" };
      case 20:
        return withTask(
          event(
            dev,
            "message.agent",
            hlc,
            { text: "Done.", session: null },
            { by: `claude@${dev}` },
          ),
        );
      default:
        return withTask(event(dev, "task.done", hlc, {}));
    }
  }
}

/**
 * Appends one round of random events to random files: 1 to 12 lines, sometimes a line twice,
 * sometimes another event with the id of an earlier event (in another file, with another HLC),
 * sometimes half a line whose rest comes in the next round. Then it moves the clock: mostly up to
 * 1 min, sometimes days, so held events join the merge.
 */
export async function appendRandomRound(
  ws: TestWorkspace,
  gen: RandomEvents,
  random: () => number,
  pending: Map<string, string>,
  clock: FakeClock,
): Promise<void> {
  for (const [path, rest] of pending) await ws.appendText(path, rest);
  pending.clear();
  const count = gen.int(1, 12);
  for (let i = 0; i < count; i++) {
    const { path, event: e } = gen.next();
    if (typeof e !== "string") {
      // A broken device or a bad conflict merge: the same id on another event. The read order of
      // the 2 lines and their HLCs differ, so the winner (the smaller place) must not depend on it.
      if (gen.ids.length > 0 && random() < 0.08) e.id = gen.pick(gen.ids);
      else gen.ids.push(e.id);
    }
    const line = `${typeof e === "string" ? e : JSON.stringify(e)}\n`;
    // Sometimes the same event twice, as a conflict copy merge can make.
    await ws.appendText(path, random() < 0.05 ? `${line}${line}` : line);
  }
  if (random() < 0.25) {
    // A write that did not finish: half a line now, the rest in the next round.
    const { path, event: e } = gen.next();
    if (typeof e !== "string") {
      const text = `${JSON.stringify(e)}\n`;
      const cut = gen.int(1, text.length - 2);
      await ws.appendText(path, text.slice(0, cut));
      pending.set(path, text.slice(cut));
    }
  }
  if (random() < 0.2) clock.advance(gen.int(0, 3) * 24 * 3600_000);
  else clock.advance(gen.int(0, 60_000));
}
