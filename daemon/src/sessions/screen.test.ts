// The dialog check on the screens of Claude Code 2.1.330 (captures a4-tui-while-hook-pending,
// a1-trust-dialog and a5a4-pane of the verification of 2026-11-22; paths removed).
import { describe, expect, it } from "vitest";
import { dialogOnScreen, trustCursor, trustOnScreen } from "./screen.ts";

const PERMISSION = [
  "● Write(perm-test.txt)",
  "",
  "────────────────────────────────────────────────────────────────────────────────────────│",
  " Create file                                                                            │",
  " perm-test.txt                                                                          │",
  "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│",
  "  1 x                                                                                   │",
  "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│",
  " Do you want to create perm-test.txt?                                                   │",
  " ❯ 1. Yes                                                                               │",
  "   2. Yes, and switch to accept edits (auto-approve file edits and common file          │",
  "      commands) for this session (shift+tab)                                            │",
  "   3. No                                                                                │",
  "                                                                                        │",
  " Esc to cancel · Tab to amend                                                           │",
  "───────────────────────────────────────────────────────────────────────────────── AW-1 ─│",
  "",
  "",
].join("\n");

const TRUST = [
  "────────────────────────────────────────────────────────────",
  " Accessing workspace:",
  "",
  " <worktree>",
  "",
  " Quick safety check: Is this a project you created or one you trust?",
  "",
  " Claude Code'll be able to read, edit, and execute files here.",
  "",
  " Security guide",
  "",
  " ❯ No, exit",
  "   Yes, I trust this folder",
  "",
  " Enter to confirm · Esc to cancel",
  ...Array.from({ length: 20 }, () => ""),
].join("\n");

/** The agent ended its turn with a question; the old dialog text is in the agent text only. */
const IDLE_WITH_QUESTION = [
  "● Write(perm-test.txt)",
  "  ⎿  Wrote 1 line to perm-test.txt",
  "",
  "● I can store the sessions in two ways.",
  "  ❯ 1. Yes, a table",
  "  Do you want to use Postgres or SQLite? Esc to cancel the plan if you want.",
  "",
  "✻ Cooked for 7s · done 5:42 PM",
  "",
  "──────────────────────────────────────────────────────────────────────── AW-1 ─",
  "❯ ",
  "────────────────────────────────────────────────────────────────────────────────",
  "",
  "  ⏸ manual mode on",
].join("\n");

describe("dialog on the screen", () => {
  it("finds the permission dialog and the trust screen of Claude Code", () => {
    expect(dialogOnScreen(PERMISSION)).toBe(true);
    expect(trustOnScreen(PERMISSION)).toBe(false);
    expect(dialogOnScreen(TRUST)).toBe(true);
    expect(trustOnScreen(TRUST)).toBe(true);
  });

  it("does not take the agent text of the last turn for a dialog", () => {
    expect(dialogOnScreen(IDLE_WITH_QUESTION)).toBe(false);
    expect(dialogOnScreen("● Do you want to use Postgres?\n\n❯ ")).toBe(false);
    expect(trustOnScreen("● Click Yes, I trust this folder.\n Esc to cancel\n❯ ")).toBe(false);
    expect(dialogOnScreen("")).toBe(false);
  });

  it("reads the cursor of the trust screen before AW presses Enter", () => {
    expect(trustCursor(TRUST)).toBe("other");
    const yesFirst = TRUST.replace(" ❯ No, exit", " ❯ Yes, I trust this folder").replace(
      "   Yes, I trust this folder",
      "   No, exit",
    );
    expect(trustCursor(yesFirst)).toBe("yes");
    const onYes = TRUST.replace(" ❯ No, exit", "   No, exit").replace(
      "   Yes, I trust this folder",
      " ❯ Yes, I trust this folder",
    );
    expect(trustCursor(onYes)).toBe("yes");
    expect(trustCursor(PERMISSION)).toBeNull();
    expect(trustCursor(IDLE_WITH_QUESTION)).toBeNull();
  });
});
