import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSummary } from "../../../shared/channels.ts";
import { FakeCallError, installBridge, renderApp } from "../testing.tsx";
import {
  CredentialsPage,
  loginText,
  notificationText,
  PhraseReminder,
  RecoveryPhraseCard,
  RecoveryPhraseGate,
  SettingsPage,
} from "./Settings.tsx";

afterEach(cleanup);

function argsOf(call: ReturnType<typeof installBridge>, method: string) {
  return call.mock.calls.filter(([m]) => m === method).map(([, args]) => args);
}

describe("CredentialsPage", () => {
  it("adds a credential from a password field and never shows the value", async () => {
    const names = [
      { name: "github-token", added_by: "human@macbook-pro", imported_on: [], file: true },
    ];
    const call = installBridge({
      credentials: () => names,
      addCredential: (args: { name: string }) => {
        names.push({ name: args.name, added_by: "human@macbook-pro", imported_on: [], file: true });
        return names.at(-1);
      },
    });
    renderApp(<CredentialsPage />, { route: "/w/:ws/credentials", url: "/w/ws-1/credentials" });
    expect(await screen.findByText("github-token")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.type(screen.getByLabelText("Name"), "stripe-test");
    const value = screen.getByLabelText<HTMLInputElement>("Value");
    expect(value.type).toBe("password");
    await userEvent.type(value, "sk_test_secret_value");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("stripe-test")).toBeTruthy();
    expect(argsOf(call, "addCredential")).toEqual([
      { ws: "ws-1", name: "stripe-test", value: "sk_test_secret_value" },
    ]);
    expect(document.body.textContent).not.toContain("sk_test_secret_value");
    expect(screen.queryByDisplayValue("sk_test_secret_value")).toBeNull();
  });

  it("removes a credential after a confirmation", async () => {
    const call = installBridge({
      credentials: () => [{ name: "github-token", added_by: null, imported_on: [], file: true }],
      removeCredential: () => ({ name: "github-token" }),
    });
    renderApp(<CredentialsPage />, { route: "/w/:ws/credentials", url: "/w/ws-1/credentials" });
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(argsOf(call, "removeCredential")).toEqual([]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Remove")!,
    );
    await waitFor(() =>
      expect(argsOf(call, "removeCredential")).toEqual([{ ws: "ws-1", name: "github-token" }]),
    );
  });
});

describe("CredentialsPage empty state", () => {
  it("shows No credentials yet with Add a credential, which opens the dialog", async () => {
    installBridge({ credentials: () => [] });
    renderApp(<CredentialsPage />, { route: "/w/:ws/credentials", url: "/w/ws-1/credentials" });
    expect(await screen.findByText("No credentials yet")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add a credential" }));
    expect(await screen.findByRole("dialog", { name: "Add a credential" })).toBeTruthy();
  });
});

describe("SettingsPage", () => {
  it("says when the login item needs approval, and turns it on", async () => {
    const call = installBridge({
      appSettings: () => ({
        appearance: "system",
        proposal_text_px: 16,
        login: { supported: true, open: false, status: "requires-approval" },
        notifications: false,
        notification_error: null,
      }),
      setOpenAtLogin: () => ({
        appearance: "system",
        proposal_text_px: 16,
        login: { supported: true, open: true, status: "enabled" },
        notifications: false,
        notification_error: null,
      }),
    });
    renderApp(<SettingsPage />);
    expect(await screen.findByText("Needs approval in System Settings.")).toBeTruthy();
    expect(screen.getByText(/cannot show notifications/)).toBeTruthy();
    await userEvent.click(screen.getByRole("switch", { name: "Open at login" }));
    await waitFor(() => expect(argsOf(call, "setOpenAtLogin")).toEqual([{ open: true }]));
    expect(await screen.findByText(/opens at login/)).toBeTruthy();
  });

  it("puts Open at login under Startup and sends the Appearance choice (screens-align)", async () => {
    let appearance = "system";
    const call = installBridge({
      appSettings: () => ({
        appearance,
        proposal_text_px: 16,
        login: { supported: true, open: false, status: null },
        notifications: true,
        notification_error: null,
      }),
      setAppearance: (args: { appearance: string }) => {
        appearance = args.appearance;
        return {
          appearance,
          proposal_text_px: 16,
          login: { supported: true, open: false, status: null },
          notifications: true,
          notification_error: null,
        };
      },
      syncSettings: () => ({ community: true, source: "default", text: "Community text." }),
    });
    renderApp(<SettingsPage />);
    const startup = await screen.findByRole("region", { name: "Startup" });
    expect(within(startup).getByRole("switch", { name: "Open at login" })).toBeTruthy();
    for (const title of ["Appearance", "Notifications", "Sync across networks", "Setup check"]) {
      expect(screen.getByRole("region", { name: title })).toBeTruthy();
    }
    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    expect(within(group).getByRole<HTMLInputElement>("radio", { name: "System" }).checked).toBe(
      true,
    );
    await userEvent.click(within(group).getByRole("radio", { name: "Light" }));
    await waitFor(() => expect(argsOf(call, "setAppearance")).toEqual([{ appearance: "light" }]));
    await waitFor(() =>
      expect(within(group).getByRole<HTMLInputElement>("radio", { name: "Light" }).checked).toBe(
        true,
      ),
    );
  });

  it("lists the workspaces of this computer with their folders (workspace-folder)", async () => {
    const ws = {
      ready: true,
      error: null,
      tasks: 0,
      open_gates: 0,
      issues: 0,
      notices: [],
      last_hlc: null,
    };
    installBridge({
      workspaces: () => [
        { ...ws, id: "ws-1", name: "Personal", path: "/Users/example/AW/Personal" },
        { ...ws, id: "ws-2", name: "demo", path: "/Users/example/Work/demo-aw1" },
      ],
    });
    renderApp(<SettingsPage />);
    const section = await screen.findByRole("region", { name: "Workspaces on this computer" });
    expect((await within(section).findByRole("group", { name: "demo" })).textContent).toBe(
      "demo/Users/example/Work/demo-aw1",
    );
    expect(within(section).getByRole("group", { name: "Personal" }).textContent).toBe(
      "Personal/Users/example/AW/Personal",
    );
  });

  it("says that macOS refused a notification (verify-journeys finding 16)", () => {
    const login = { supported: true, open: false, status: null };
    const appearance = "system" as const;
    expect(
      notificationText({
        appearance,
        proposal_text_px: 16,
        login,
        notifications: true,
        notification_error: null,
      }),
    ).toMatch(/show as notifications/);
    expect(
      notificationText({
        appearance,
        proposal_text_px: 16,
        login,
        notifications: true,
        notification_error: "UNErrorDomain error 1",
      }),
    ).toBe(
      "macOS did not show the last notification (UNErrorDomain error 1). Turn on the notifications of Agent Workspace in System Settings > Notifications. An unsigned build cannot show them. The Inbox and the menu bar show the gates.",
    );
    expect(
      notificationText({
        appearance,
        proposal_text_px: 16,
        login,
        notifications: false,
        notification_error: null,
      }),
    ).toMatch(/cannot show notifications/);
  });

  it("explains an unsupported login item", () => {
    expect(
      loginText({
        appearance: "system",
        proposal_text_px: 16,
        login: { supported: false, open: false, status: null },
        notifications: true,
        notification_error: null,
      }),
    ).toBe("This system has no login item for the app.");
  });
});

describe("RecoveryPhraseGate", () => {
  const WORDS = Array.from({ length: 24 }, (_v, i) => `word${i + 1}`);

  function setup(confirmed: boolean, hasMaster = true, shown = false) {
    const state = { confirmed, shown };
    return installBridge({
      identity: () => ({ user: "u1", has_master_key: hasMaster }),
      phraseConfirmed: () => ({ ...state }),
      phraseShown: () => {
        state.shown = true;
        return { shown: true };
      },
      phrase: () => ({ phrase: WORDS.join(" ") }),
      confirmPhrase: () => {
        state.confirmed = true;
        return { confirmed: true };
      },
    });
  }

  it("shows the words by itself only the first time (fix list 0-34)", async () => {
    const call = setup(false);
    renderApp(<RecoveryPhraseGate />);
    expect(await screen.findByText("word24")).toBeTruthy();
    await waitFor(() => expect(argsOf(call, "phraseShown")).toEqual([{ user: "u1" }]));
    // The record of the first show does not close the screen.
    expect(screen.getByText("word24")).toBeTruthy();
    expect(screen.getByText(/AW shows this screen by itself only one time/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    cleanup();
    const next = setup(false, true, true);
    renderApp(<RecoveryPhraseGate />);
    await waitFor(() => expect(argsOf(next, "phraseConfirmed")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(argsOf(next, "phrase")).toEqual([]);
  });

  it("reminds the person after Later and shows the words on request", async () => {
    const call = setup(false, true, true);
    renderApp(<PhraseReminder />);
    expect(await screen.findByText(/Your recovery phrase is not confirmed/)).toBeTruthy();
    expect(argsOf(call, "phrase")).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Show recovery phrase" }));
    expect(await screen.findByText("word24")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByText("word24")).toBeNull());
    expect(screen.getByRole("button", { name: "Show recovery phrase" })).toBeTruthy();
  });

  it("shows no reminder before the first show, after a confirm, or with no master key", async () => {
    for (const [confirmed, hasMaster, shown] of [
      [false, true, false],
      [true, true, true],
      [false, false, true],
    ] as const) {
      const call = setup(confirmed, hasMaster, shown);
      renderApp(<PhraseReminder />);
      await waitFor(() => expect(argsOf(call, "identity")).toHaveLength(1));
      if (hasMaster) await waitFor(() => expect(argsOf(call, "phraseConfirmed")).toHaveLength(1));
      expect(screen.queryByText(/Your recovery phrase is not confirmed/)).toBeNull();
      cleanup();
    }
  });

  it("shows the words, then confirms 3 of them", async () => {
    const call = setup(false);
    renderApp(<RecoveryPhraseGate />);
    expect(await screen.findByText("word24")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "I wrote it down" }));
    const fields = screen.getAllByLabelText<HTMLInputElement>(/^Word \d+$/);
    expect(fields).toHaveLength(3);
    expect(screen.queryByText("word24")).toBeNull();
    await userEvent.type(fields[0]!, "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/A word does not match/)).toBeTruthy();
    expect(argsOf(call, "confirmPhrase")).toEqual([]);
    for (const field of fields) {
      const n = Number(/Word (\d+)/.exec(field.labels?.[0]?.textContent ?? "")?.[1]);
      await userEvent.clear(field);
      await userEvent.type(field, `word${n}`);
    }
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(argsOf(call, "confirmPhrase")).toEqual([{ user: "u1" }]));
  });

  it("shows nothing when the phrase is confirmed or the device has no master key", async () => {
    const call = setup(true);
    renderApp(<RecoveryPhraseGate />);
    await waitFor(() => expect(argsOf(call, "phraseConfirmed")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    const other = setup(false, false);
    renderApp(<RecoveryPhraseGate />);
    await waitFor(() => expect(argsOf(other, "identity")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(argsOf(other, "phrase")).toEqual([]);
  });
});

describe("Copy and save of the recovery phrase (keys-backup)", () => {
  const WORDS = Array.from({ length: 24 }, (_v, i) => `word${i + 1}`);
  const PATH = "/Users/example/agent-workspace-recovery-phrase.txt";

  function setup(
    opts: { confirmed?: boolean; shown?: boolean; save?: () => unknown; copy?: () => unknown } = {},
  ) {
    const state = { confirmed: opts.confirmed ?? false, shown: opts.shown ?? false };
    return installBridge({
      identity: () => ({ user: "u1", has_master_key: true }),
      phraseConfirmed: () => ({ ...state }),
      phraseShown: () => {
        state.shown = true;
        return { shown: true };
      },
      phrase: () => ({ phrase: WORDS.join(" ") }),
      copyPhrase: opts.copy ?? (() => ({ copied: true, clear_after_ms: 60_000 })),
      savePhrase: opts.save ?? (() => ({ saved: true, path: PATH })),
    });
  }

  /** The arguments of each call except the read of the phrase: none may carry a word. */
  function sentWords(call: ReturnType<typeof installBridge>) {
    return call.mock.calls
      .filter(([m]) => m !== "phrase")
      .map(([, args]) => JSON.stringify(args))
      .filter((text) => /word\d/.test(text));
  }

  it("copies and saves the words through main, with a warning and a result line", async () => {
    const call = setup();
    renderApp(<RecoveryPhraseGate />);
    expect(await screen.findByText("word24")).toBeTruthy();
    expect(screen.getByText(/AW clears the clipboard after 60\s+seconds/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Copied. AW clears the clipboard in 60 seconds.")).toBeTruthy();
    expect(argsOf(call, "copyPhrase")).toEqual([{}]);
    await userEvent.click(screen.getByRole("button", { name: "Save to a file…" }));
    expect(await screen.findByText(new RegExp(`Saved to ${PATH}\\.`))).toBeTruthy();
    expect(screen.queryByText(/Copied\./)).toBeNull();
    expect(argsOf(call, "savePhrase")).toEqual([{}]);
    expect(sentWords(call)).toEqual([]);
  });

  it("shows no result line on cancel, and the error of main", async () => {
    setup({
      save: () => ({ saved: false, path: null }),
      copy: () => {
        throw new FakeCallError("refused", "This device has no master key, so it has no phrase");
      },
    });
    renderApp(<RecoveryPhraseGate />);
    await userEvent.click(await screen.findByRole("button", { name: "Save to a file…" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save to a file…" })).toBeTruthy(),
    );
    expect(screen.queryByText(/Saved to/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/no master key/)).toBeTruthy();
    expect(screen.queryByText(/Copied\./)).toBeNull();
  });

  it("shows the words again from Settings after the confirmation, with Close", async () => {
    const call = setup({ confirmed: true, shown: true });
    renderApp(<SettingsPage />);
    expect(await screen.findByText(/You confirmed your 24 words/)).toBeTruthy();
    expect(screen.queryByText(/Your recovery phrase is not confirmed/)).toBeNull();
    expect(argsOf(call, "phrase")).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Show recovery phrase" }));
    expect(await screen.findByText("word24")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I wrote it down" })).toBeNull();
    expect(screen.queryByText(/AW shows this screen by itself/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("word24")).toBeNull());
  });

  it("shows the reminder in the Settings card before the confirmation", async () => {
    setup({ shown: true });
    renderApp(<RecoveryPhraseCard />);
    expect(await screen.findByText(/Your recovery phrase is not confirmed/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show recovery phrase" }));
    expect(await screen.findByText("word24")).toBeTruthy();
    expect(screen.queryByText(/Your recovery phrase is not confirmed/)).toBeNull();
    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy();
  });

  it("hides the reminder line while the first screen is open (F-37)", async () => {
    const call = setup();
    renderApp(
      <>
        <RecoveryPhraseGate />
        <PhraseReminder />
      </>,
    );
    expect(await screen.findByText("word24")).toBeTruthy();
    await waitFor(() => expect(argsOf(call, "phraseShown")).toHaveLength(1));
    await waitFor(() => expect(argsOf(call, "phraseConfirmed").length).toBeGreaterThan(1));
    expect(screen.queryByText(/Your recovery phrase is not confirmed/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(await screen.findByText(/Your recovery phrase is not confirmed/)).toBeTruthy();
  });

  it("records the first show when the words open from the Settings card", async () => {
    const call = setup();
    renderApp(<RecoveryPhraseCard />);
    await userEvent.click(await screen.findByRole("button", { name: "Show recovery phrase" }));
    expect(await screen.findByText("word24")).toBeTruthy();
    await waitFor(() => expect(argsOf(call, "phraseShown")).toEqual([{ user: "u1" }]));
  });

  it("shows no card on a device with no master key", async () => {
    const call = installBridge({ identity: () => ({ user: "u1", has_master_key: false }) });
    renderApp(<RecoveryPhraseCard />);
    await waitFor(() => expect(argsOf(call, "identity")).toHaveLength(1));
    expect(screen.queryByText("Recovery phrase")).toBeNull();
    expect(argsOf(call, "phraseConfirmed")).toEqual([]);
  });

  it("starts Settings with Appearance and no divider on a device with no master key (sa-4)", async () => {
    installBridge({
      identity: () => ({ user: "u1", has_master_key: false }),
      appSettings: () => ({
        appearance: "system",
        proposal_text_px: 16,
        login: { supported: true, open: false, status: null },
        notifications: true,
        notification_error: null,
      }),
      syncSettings: () => ({ community: true, source: "default", text: "Community text." }),
    });
    renderApp(<SettingsPage />);
    const appearance = await screen.findByRole("region", { name: "Appearance" });
    expect(appearance.previousElementSibling).toBeNull();
    expect(screen.queryByRole("region", { name: "Recovery phrase" })).toBeNull();
  });
});

describe("New projects (permissions-default)", () => {
  function summary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
    return {
      id: "ws-1",
      name: "Personal",
      path: "/Users/example/AW/Personal",
      ready: true,
      error: null,
      tasks: 0,
      open_gates: 0,
      issues: 0,
      notices: [],
      last_hlc: null,
      new_project_permission_mode: "default",
      ...overrides,
    };
  }

  it("saves Skip permissions for the workspace and shows the warning", async () => {
    let ws = summary();
    const call = installBridge({
      workspaces: () => [ws],
      editWorkspace: (args: { body: { new_project_permission_mode: "skip" } }) => {
        ws = { ...ws, ...args.body };
        return ws;
      },
    });
    renderApp(<SettingsPage />, { route: "/settings", url: "/settings" });
    expect(await screen.findByText("New projects")).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Default permissions for new projects"));
    await userEvent.click(await screen.findByRole("option", { name: "Skip permissions" }));
    await waitFor(() =>
      expect(argsOf(call, "editWorkspace")).toEqual([
        { ws: "ws-1", body: { new_project_permission_mode: "skip" } },
      ]),
    );
    expect(await screen.findByText(/A hidden command can still act as you in AW/)).toBeTruthy();
  });

  it("names each workspace when there are more than one", async () => {
    installBridge({
      workspaces: () => [
        summary(),
        summary({ id: "ws-2", name: "Acme", new_project_permission_mode: "accept_edits" }),
      ],
    });
    renderApp(<SettingsPage />, { route: "/settings", url: "/settings" });
    expect(
      await screen.findByLabelText("Default permissions for new projects · Personal"),
    ).toBeTruthy();
    const acme = screen.getByLabelText("Default permissions for new projects · Acme");
    expect(acme.textContent).toBe("Accept edits");
  });

  it("shows no section with no workspace", async () => {
    installBridge({ workspaces: () => [] });
    renderApp(<SettingsPage />, { route: "/settings", url: "/settings" });
    expect(await screen.findByText("Setup check")).toBeTruthy();
    expect(screen.queryByText("New projects")).toBeNull();
  });
});
