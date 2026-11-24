// The dialog check on the visible screen of a pane (docs/phase-1.md 9.4, design decision 8). It
// looks at the layout of a Claude Code dialog, not at free text: the agent text of the last turn
// stays on the screen, and it can hold the same words ("Do you want to ...?").
//
// A dialog of Claude Code 2.1 (captures a1-trust-dialog and a4-tui-while-hook-pending of the
// verification of 2026-11-22) replaces the prompt box at the bottom of the screen:
//
//    Do you want to create perm-test.txt?
//    ❯ 1. Yes
//      2. Yes, and switch to accept edits ...
//      3. No
//
//    Esc to cancel · Tab to amend
//
// The prompt box of an idle or busy session is a line `❯ ` with the typed text, with no number.

/** The lines at the bottom of the screen that a dialog footer must be in. */
const FOOTER_LINES = 8;
/** The lines above the footer that the selection cursor must be in. */
const OPTION_LINES = 16;

const FOOTER = /(Esc to cancel|Enter to confirm)/;
/** The selection cursor on an option: `❯ 1. Yes`, `❯ No, exit`. */
const CURSOR = /^\s*❯ (\d+\.\s+\S|\S)/;
/** The prompt line of the input box. */
const PROMPT = /^\s*[❯>](\s|$)/;
const TRUST = /Yes, I trust this folder/;

function lines(screen: string): string[] {
  return screen
    .split("\n")
    .map((line) => line.replace(/[\s│]+$/u, ""))
    .filter((line) => line.trim().length > 0);
}

/** The index of the dialog footer in the last lines, or -1. */
function footerAt(list: string[]): number {
  for (let i = list.length - 1; i >= Math.max(0, list.length - FOOTER_LINES); i--) {
    if (FOOTER.test(list[i]!)) return i;
  }
  return -1;
}

/**
 * True when a dialog is open at the bottom of the screen: a footer ("Esc to cancel"), a selection
 * cursor on an option above it, and no prompt line below it.
 */
export function dialogOnScreen(screen: string): boolean {
  const list = lines(screen);
  const footer = footerAt(list);
  if (footer < 0) return false;
  const options = list.slice(Math.max(0, footer - OPTION_LINES), footer);
  if (!options.some((line) => CURSOR.test(line))) return false;
  return !list.slice(footer + 1).some((line) => PROMPT.test(line));
}

/** True when the "trust this folder" dialog is open. */
export function trustOnScreen(screen: string): boolean {
  if (!dialogOnScreen(screen)) return false;
  const list = lines(screen);
  const footer = footerAt(list);
  return list.slice(Math.max(0, footer - OPTION_LINES), footer).some((line) => TRUST.test(line));
}

/**
 * Where the selection cursor of the trust dialog is: `yes` on "Yes, I trust this folder", `other`
 * on another option, null when no trust dialog is open. The option order of a Claude Code version
 * that the tests do not cover is not known, so AW reads the cursor before it presses Enter.
 */
export function trustCursor(screen: string): "yes" | "other" | null {
  if (!trustOnScreen(screen)) return null;
  const list = lines(screen);
  const footer = footerAt(list);
  const cursor = list
    .slice(Math.max(0, footer - OPTION_LINES), footer)
    .find((line) => CURSOR.test(line));
  return cursor !== undefined && TRUST.test(cursor) ? "yes" : "other";
}
