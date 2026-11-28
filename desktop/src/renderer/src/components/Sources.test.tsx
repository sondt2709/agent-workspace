// The Sources page (openspec inbox-mattermost, spec inbox-sources "Sources page"): a change of a
// read level writes the whole configuration with that conversation; the search, the channel mode,
// the projects of a conversation, any interval, and one box of each kind after a save.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { installBridge, PROJECT, renderApp } from "../testing.tsx";
import { everyText, parseEvery, SourcesPage } from "./Sources.tsx";

afterEach(cleanup);

const ref = { event: "e1", dev: "macbook-pro", hlc: "2026-11-23T09:00:00.000Z#0000" };
const WEB = { ...PROJECT, slug: "web", name: "Web" };
const CONVERSATIONS = [
  { id: "ch-billing", name: "~billing", kind: "channel", last_message_at: null },
  { id: "ch-api", name: "~api-team", kind: "channel", last_message_at: null },
  { id: "dm-carson", name: "@carson.ng", kind: "direct", last_message_at: null },
];
const SOURCE = {
  source: "mattermost",
  kind: "mattermost",
  name: "Mattermost",
  server_url: "https://chat.example.com",
  credential: "mattermost-alex",
  collector: "ubuntu-01",
  username: "alex",
  read_every_s: 60,
  channels: "selected",
  conversations: [],
  triage: {
    model: "haiku",
    every_min: 15,
    days: [1, 2, 3, 4, 5],
    from: "08:00",
    to: "20:00",
    instruction: "",
    paused: false,
  },
  removed: false,
  configured: ref,
  run_requested: null,
};

describe("Sources page", () => {
  it("shows the connection and writes a read level of a conversation", async () => {
    const call = installBridge({
      sources: () => [SOURCE],
      sourceStatus: () => ({
        source: "mattermost",
        collector: "ubuntu-01",
        health: {
          last_read_at: null,
          last_batch_at: null,
          waiting: 2,
          triage: "running",
          error: null,
        },
        user: { id: "u1", username: "alex" },
      }),
      sourceConversations: () => [
        { id: "ch-billing", name: "~billing", kind: "channel", last_message_at: null },
      ],
      credentials: () => [{ name: "mattermost-alex", added: null, imported_on: [] }],
      devices: () => [],
      projects: () => [PROJECT],
      setSource: () => SOURCE,
    });
    renderApp(<SourcesPage />, { route: "/w/:ws/sources", url: "/w/ws-1/sources" });
    expect(await screen.findByText("Connected as @alex")).toBeTruthy();
    expect(screen.getByText(/2 messages wait/)).toBeTruthy();
    // The channel mode "selected": a channel with no level of its own is not read.
    const group = await screen.findByRole("group", { name: "Read level of ~billing" });
    expect(within(group).getByRole("button", { name: "Off" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await userEvent.click(within(group).getByRole("button", { name: "All" }));
    await waitFor(() => expect(call.mock.calls.some(([m]) => m === "setSource")).toBe(true));
    const args = call.mock.calls.find(([m]) => m === "setSource")![1] as {
      source: string;
      body: { collector: string | null; conversations: unknown[] };
    };
    expect(args.source).toBe("mattermost");
    expect(args.body.collector).toBe("ubuntu-01");
    expect(args.body.conversations).toEqual([
      { id: "ch-billing", name: "~billing", kind: "channel", read: "all", projects: [] },
    ]);
  });

  it("keeps both changes when the person changes 2 conversations quickly", async () => {
    let stored = { ...SOURCE, conversations: [] as unknown[] };
    const bodies: { conversations: { id: string; read: string; projects: string[] }[] }[] = [];
    installBridge({
      sources: () => [stored],
      sourceStatus: () => ({
        source: "mattermost",
        collector: "ubuntu-01",
        health: null,
        user: null,
      }),
      sourceConversations: () => [
        { id: "ch-billing", name: "~billing", kind: "channel", last_message_at: null },
        { id: "ch-api", name: "~api-team", kind: "channel", last_message_at: null },
      ],
      credentials: () => [],
      devices: () => [],
      projects: () => [PROJECT],
      setSource: async (args: { body: (typeof bodies)[number] }) => {
        // A slow save: the second change comes before the first one is back.
        await new Promise((r) => setTimeout(r, 50));
        bodies.push(args.body);
        stored = { ...stored, conversations: args.body.conversations };
        return stored;
      },
    });
    renderApp(<SourcesPage />, { route: "/w/:ws/sources", url: "/w/ws-1/sources" });
    const billing = await screen.findByRole("group", { name: "Read level of ~billing" });
    const api = screen.getByRole("group", { name: "Read level of ~api-team" });
    await userEvent.click(within(billing).getByRole("button", { name: "All" }));
    await userEvent.click(within(api).getByRole("button", { name: "Tagged" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    const last = bodies[1]!.conversations;
    expect(last.find((c) => c.id === "ch-billing")?.read).toBe("all");
    expect(last.find((c) => c.id === "ch-api")?.read).toBe("tagged");
  });

  it("connects with this computer as the collecting device when the devices load late", async () => {
    const call = installBridge({
      sources: () => [],
      credentials: () => [{ name: "mattermost-alex", added: null, imported_on: [] }],
      // The device list comes later than the first show of the form.
      devices: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return [
          {
            slug: "macbook-pro",
            name: "MacBook Pro",
            role: "local",
            state: "valid",
            this_device: true,
          },
        ];
      },
      projects: () => [PROJECT],
      setSource: () => SOURCE,
    });
    renderApp(<SourcesPage />, { route: "/w/:ws/sources", url: "/w/ws-1/sources" });
    await screen.findByRole("button", { name: "Connect" });
    await userEvent.type(screen.getByRole("textbox", { name: /Server/ }), "chat.example.com");
    await userEvent.click(screen.getByRole("combobox", { name: /Token/ }));
    await userEvent.click(await screen.findByRole("option", { name: "mattermost-alex" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /Collects on/ }).textContent).toContain(
        "MacBook Pro",
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(call.mock.calls.some(([m]) => m === "setSource")).toBe(true));
    const args = call.mock.calls.find(([m]) => m === "setSource")![1] as {
      body: { collector: string | null };
    };
    expect(args.body.collector).toBe("macbook-pro");
  });

  /** A bridge with a stored source that each save changes, and the bodies of the saves. */
  function stored(conversations = CONVERSATIONS) {
    let value = { ...SOURCE, conversations: [] as unknown[] };
    let n = 1;
    const bodies: Record<string, unknown>[] = [];
    installBridge({
      sources: () => [value],
      sourceStatus: () => ({
        source: "mattermost",
        collector: "ubuntu-01",
        health: null,
        user: null,
      }),
      sourceConversations: () => conversations,
      credentials: () => [{ name: "mattermost-alex", added: null, imported_on: [] }],
      devices: () => [],
      projects: () => [PROJECT, WEB],
      setSource: (args: { body: Record<string, unknown> }) => {
        bodies.push(args.body);
        n += 1;
        value = { ...value, ...args.body, configured: { ...ref, event: `e${n}` } };
        return value;
      },
    });
    return bodies;
  }

  it("shows one Mattermost box and one triage box after a save of the server", async () => {
    const bodies = stored();
    renderApp(<SourcesPage />, { route: "/w/:ws/sources", url: "/w/ws-1/sources" });
    const server = await screen.findByRole("textbox", { name: /Server/ });
    await userEvent.clear(server);
    await userEvent.type(server, "https://chat2.example.com");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => expect(bodies).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>("textbox", { name: /Server/ }).value).toBe(
        "https://chat2.example.com",
      ),
    );
    expect(screen.getAllByRole("textbox", { name: /Server/ })).toHaveLength(1);
    expect(screen.getAllByText("Triage agent")).toHaveLength(1);
  });

  it("finds a conversation by its name", async () => {
    stored();
    renderApp(<SourcesPage />, { route: "/w/:ws/sources", url: "/w/ws-1/sources" });
    await screen.findByText("~api-team");
    await userEvent.type(screen.getByRole("textbox", { name: "Search the conversations" }), "BILL");
    await waitFor(() => expect(screen.queryByText("~api-team")).toBeNull());
    expect(screen.getByText("~billing")).toBeTruthy();
  });

  it("reads each direct message, and each channel only in the mode All channels", async () => {
    const bodies = stored();
    renderApp(<SourcesPage />, { route: "/w/:ws/sources", url: "/w/ws-1/sources" });
    const pressed = (name: string) =>
      within(screen.getByRole("group", { name: `Read level of ${name}` }))
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-pressed") === "true")?.textContent;
    await screen.findByText("@carson.ng");
    expect(pressed("@carson.ng")).toBe("Tagged");
    expect(pressed("~api-team")).toBe("Off");
    await userEvent.click(screen.getByRole("button", { name: "All channels" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.channels).toBe("all");
    await waitFor(() => expect(pressed("~api-team")).toBe("Tagged"));
  });

  it("gives a conversation more projects", async () => {
    const bodies = stored();
    renderApp(<SourcesPage />, { route: "/w/:ws/sources", url: "/w/ws-1/sources" });
    await userEvent.click(await screen.findByRole("combobox", { name: "Projects of ~billing" }));
    await userEvent.click(await screen.findByRole("option", { name: "Billing API" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    await userEvent.click(screen.getByRole("option", { name: "Web" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    const rows = bodies[1]!.conversations as { id: string; projects: string[] }[];
    expect(rows.find((c) => c.id === "ch-billing")?.projects).toEqual(["billing-api", "web"]);
  });

  it("saves any interval of the triage as minutes", async () => {
    const bodies = stored();
    renderApp(<SourcesPage />, { route: "/w/:ws/sources", url: "/w/ws-1/sources" });
    const every = await screen.findByRole("textbox", { name: "Every" });
    expect((every as HTMLInputElement).value).toBe("15m");
    await userEvent.clear(every);
    await userEvent.type(every, "1h30m");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0]!.triage as { every_min: number }).every_min).toBe(90);
  });
});

describe("parseEvery", () => {
  it.each([
    ["15", 15],
    ["15m", 15],
    ["15 min", 15],
    ["2h", 120],
    ["1h30m", 90],
    ["24h", 1440],
    ["0m", null],
    ["25h", null],
    ["soon", null],
    ["", null],
  ])("%s is %s", (text, minutes) => {
    expect(parseEvery(text)).toBe(minutes);
  });

  it("writes the text back", () => {
    expect([15, 60, 90].map(everyText)).toEqual(["15m", "1h", "1h30m"]);
  });
});
