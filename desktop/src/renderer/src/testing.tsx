// Test helpers of the renderer: a fake `window.aw`, a new QueryClient per test, the theme, a memory
// router, a fixed clock, and builders of awd views (docs/tech-stack.md 2.5 Testing Library row).
import { createAppTheme } from "@aw/ui";
import { ThemeProvider } from "@mui/material";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import type {
  AwBridge,
  CallMethod,
  EventRow,
  Gate,
  Project,
  StatusReply,
  Task,
} from "../../shared/channels.ts";
import { ClockContext, type RendererClock } from "./clock.ts";
import { createQueryClient } from "./queries.ts";

export type Handlers = Partial<Record<CallMethod, (args: never) => unknown>>;

/** Throw it in a handler: the fake bridge answers with this awd error. */
export class FakeCallError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly details: unknown;

  constructor(code: string, message = code, status: number | null = 409, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const STATUS: StatusReply = {
  version: "0.0.0",
  device: { slug: "macbook-pro", name: "MacBook Pro", role: "local" },
  pid: 1,
  started_at: "2026-11-23T10:00:00.000Z",
  uptime_s: 1,
  socket: "/tmp/awd.sock",
  ready: true,
  workspaces: [],
};

export const PROJECT: Project = {
  slug: "billing-api",
  name: "Billing API",
  devices: ["macbook-pro", "ubuntu-01"],
  default_agent: "claude",
  test_servers: ["k3d"],
  links: [],
  tasks: [],
};

/** Installs a fake `window.aw`. Each call goes to its handler; a call with no handler fails. */
export function installBridge(handlers: Handlers = {}) {
  const call = vi.fn((method: CallMethod, args: unknown) => {
    const all: Handlers = {
      status: () => STATUS,
      projects: () => [PROJECT],
      tasks: () => [],
      thread: () => ({
        task: { id: "t", key: null, title: null },
        events: [],
        next: null,
        ancestors: [],
      }),
      connection: () => ({ state: "online", version: "0.0.0", device: "macbook-pro" }),
      ...handlers,
    };
    const handler = all[method] as ((a: unknown) => unknown) | undefined;
    if (!handler) {
      return Promise.resolve({
        ok: false,
        error: { code: "not_found", message: `no fake for ${method}`, status: 404 },
      });
    }
    try {
      return Promise.resolve({ ok: true, value: handler(args) });
    } catch (error) {
      if (!(error instanceof FakeCallError)) throw error;
      return Promise.resolve({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          status: error.status,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }
  });
  const none = () => () => undefined;
  const bridge: AwBridge = {
    call: call as unknown as AwBridge["call"],
    onEvent: none,
    onConnection: none,
    onResync: none,
    onCommand: none,
  };
  window.aw = bridge;
  return call;
}

export function fixedClock(now: number): RendererClock {
  return { now: () => now, every: () => () => undefined };
}

/**
 * Renders `ui` with the providers of the app, in a memory router at `/w/ws-1/...`. `route` and
 * `url` set the route pattern and the start URL, for a screen that reads the route params.
 */
export function renderApp(
  ui: ReactElement,
  options: { clock?: RendererClock; route?: string; url?: string } = {},
) {
  const client = createQueryClient();
  const router = createMemoryRouter([{ path: options.route ?? "*", element: ui }], {
    initialEntries: [options.url ?? "/w/ws-1/p/billing-api/board"],
  });
  const result = render(
    <ThemeProvider theme={createAppTheme()}>
      <ClockContext.Provider
        value={options.clock ?? fixedClock(Date.parse("2026-11-23T10:00:00Z"))}
      >
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ClockContext.Provider>
    </ThemeProvider>,
  );
  return { ...result, client, router };
}

export function makeGate(overrides: Partial<Gate> = {}): Gate {
  return {
    gate: "0193a000-0000-7000-8000-000000000001",
    kind: "question",
    version: 1,
    title: "Which limit per client?",
    options: ["100/min", "1000/min"],
    file: null,
    state: "open",
    answer: null,
    answer_event: null,
    resolved_by: null,
    answers: [],
    opened: { event: "e1", dev: "ubuntu-01", hlc: "2026-11-23T10:00:00.000Z#0000" },
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "0193a000-0000-7000-8000-0000000000aa",
    key: "AW-3",
    key_state: "ok",
    project: "billing-api",
    title: "Rate limit",
    first_message: "/my-team:implement Add a rate limit",
    priority: null,
    stage: "discuss",
    needs_you: [],
    needs_you_reasons: [],
    needs_you_lane: false,
    assignee: "claude@ubuntu-01",
    owner: "ubuntu-01",
    parent: null,
    subtasks: [],
    depends_on: [],
    archived: false,
    gates: [],
    last_hlc: null,
    ...overrides,
  };
}

export function gateOpenedRow(gate: Gate, data: Record<string, unknown> = {}): EventRow {
  const hlc = (gate.opened as { hlc: string }).hlc;
  return {
    id: `row-${gate.gate}`,
    task: "t",
    hlc,
    dev: "ubuntu-01",
    type: "gate.opened",
    path: "tasks/t/log/ubuntu-01.jsonl",
    line: 1,
    applied: true,
    reason: null,
    event: {
      v: 1,
      id: `row-${gate.gate}`,
      hlc,
      dev: "ubuntu-01",
      type: "gate.opened",
      data: { gate: gate.gate, kind: gate.kind, version: gate.version, title: gate.title, ...data },
    },
  };
}

/** An event row of a task, for the work events and the thread (gate-full-context). */
export function eventRow(
  type: string,
  data: Record<string, unknown>,
  n: number,
  dev = "ubuntu-01",
): EventRow {
  const hlc = `2026-11-23T10:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z#${String(n).padStart(4, "0")}`;
  const id = `row-${String(n).padStart(5, "0")}`;
  return {
    id,
    task: "t",
    hlc,
    dev,
    type,
    path: `tasks/t/log/${dev}.jsonl`,
    line: n,
    applied: true,
    reason: null,
    event: { v: 1, id, hlc, dev, type, data },
  };
}

/**
 * A window of `width` px for the MUI media queries (jsdom has no `matchMedia`). It returns the
 * function that restores the window.
 */
export function stubWindowWidth(width: number) {
  const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
  const matches = (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
  };
  const value = (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(window, "matchMedia", original);
    else Reflect.deleteProperty(window, "matchMedia");
  };
}
