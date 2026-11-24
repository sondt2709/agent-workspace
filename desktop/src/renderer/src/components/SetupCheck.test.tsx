import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { DoctorReply } from "../../../shared/channels.ts";
import { installBridge, renderApp } from "../testing.tsx";
import { PLAN_LIMIT_TEXT, SetupCheckPage } from "./SetupCheck.tsx";

afterEach(cleanup);

const REPLY: DoctorReply = {
  device: "macbook-pro",
  ok: false,
  checks: [
    {
      id: "service",
      title: "Service",
      status: "ok",
      detail: "The launch-agent unit is loaded and starts awd at login.",
      fix: null,
    },
    {
      id: "sync_engine",
      title: "Sync engine",
      status: "fail",
      detail: "The sync engine is not installed, so sync is off.",
      fix: "Run aw engine install. awd starts the engine within 5 s.",
    },
    {
      id: "claude_login",
      title: "Claude sign-in",
      status: "fail",
      detail: "Claude Code is not signed in.",
      fix: "Run claude in a terminal on this device and sign in, or set an API key for heavy 24/7 work.",
    },
  ],
};

describe("SetupCheckPage", () => {
  it("shows each check with its status and fix, the sign-in step and the plan text", async () => {
    let calls = 0;
    installBridge({
      doctor: () => {
        calls += 1;
        return REPLY;
      },
    });
    renderApp(<SetupCheckPage />, { route: "/settings/setup", url: "/settings/setup" });
    expect(await screen.findByText("Sync engine")).toBeTruthy();
    expect(screen.getAllByText("Failed")).toHaveLength(2);
    expect(
      screen.getByText("Fix: Run aw engine install. awd starts the engine within 5 s."),
    ).toBeTruthy();
    expect(screen.getByText(/macbook-pro has 2 failed checks/)).toBeTruthy();
    expect(screen.getByText(/run claude, and sign in/)).toBeTruthy();
    expect(screen.getByText(PLAN_LIMIT_TEXT)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(calls).toBe(2);
  });
});
