// The Sources page (openspec inbox-mattermost, spec inbox-sources "Sources page"): a change of a
// read level writes the whole configuration with that conversation.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { installBridge, PROJECT, renderApp } from "../testing.tsx";
import { SourcesPage } from "./Sources.tsx";

afterEach(cleanup);

const ref = { event: "e1", dev: "macbook-pro", hlc: "2026-11-23T09:00:00.000Z#0000" };
const SOURCE = {
  source: "mattermost",
  kind: "mattermost",
  name: "Mattermost",
  server_url: "https://chat.example.com",
  credential: "mattermost-alex",
  collector: "ubuntu-01",
  username: "alex",
  read_every_s: 60,
  default_read: "mentions",
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
    const group = await screen.findByRole("group", { name: "Read level of ~billing" });
    expect(within(group).getByRole("button", { name: "For me" }).getAttribute("aria-pressed")).toBe(
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
      { id: "ch-billing", name: "~billing", kind: "channel", read: "all", project: null },
    ]);
  });

  it("keeps both changes when the person changes 2 conversations quickly", async () => {
    let stored = { ...SOURCE, conversations: [] as unknown[] };
    const bodies: { conversations: { id: string; read: string; project: string | null }[] }[] = [];
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
    await userEvent.click(within(api).getByRole("button", { name: "Off" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    const last = bodies[1]!.conversations;
    expect(last.find((c) => c.id === "ch-billing")?.read).toBe("all");
    expect(last.find((c) => c.id === "ch-api")?.read).toBe("off");
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
});
