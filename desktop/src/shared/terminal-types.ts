// The types of the terminal calls of the bridge (openspec task-terminal-view). Types only: the
// renderer and the preload import them with no runtime code.
export type TerminalAction = "attach" | "sign_in";

/** The result of `openTerminal`: a program that the app started, or a command for the person. */
export type OpenTerminalResult =
  | { opened: true; via: "terminal" | "orca"; device: string; command: string }
  | { opened: false; device: string | null; command: string | null; text: string };
