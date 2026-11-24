## Context
awd keeps the recovery phrase in the keystore of the device with the master key and serves it only on the person route `GET /v1/identity/phrase` (403 for a session caller and on a device with no master key). The desktop renderer reads it through the bridge call `phrase` and shows the 24 words in `RecoveryPhraseDialog`. The phone has no master key in phase 1, so it never shows the phrase.

## Goals / Non-Goals
**Goals:**
- Copy and save of the phrase from the phrase screen, on the first run and from Settings.
- Short life of the clipboard copy; a file that only the user account can read.
- No phrase in an IPC message from the renderer to main.

**Non-Goals:**
- A backup of the workspace credential key (Q20).
- Print, QR export, an encrypted export.
- A phone screen.

## Decisions
1. **Main does the copy and the save.** The calls `copyPhrase` and `savePhrase` have no arguments. Main reads the phrase from awd, so a compromised renderer cannot make main write other text to the clipboard or a file, and the file path comes only from the native dialog. Alternative: `navigator.clipboard` in the renderer. Refused: the renderer cannot clear the clipboard after the window loses focus, and the file write needs main anyway.
2. **The clear check uses a sha256.** Main keeps the sha256 of the copied text, not the text. After 60 s (the clock module, `sleep`), main reads the clipboard and clears it only when the sha256 matches, so a newer copy of the person stays. Each copy gets a number; only the last copy's timer acts. `before-quit` runs the same check and the quit waits for it. When main cannot read the clipboard, it clears it (fail-closed).
3. **Atomic 0600 write.** Main writes `<name>.<random>.tmp` in the target folder with flag `wx` and mode 0600, then renames it over the target. A replaced file gets mode 0600, not its old mode. On an error main removes the temporary file.
4. **The file.** Plain text: a title, the warning, `User`, `Device` (name and slug), `Date` (UTC, `YYYY-MM-DD HH:MM UTC`), the 24 words, one numbered word on each line. Plain text works with paper, a password manager and a USB drive.
5. **Default folder Documents**, with a dialog message that says to keep the file out of synced folders.
6. **Settings card.** After the confirmation, the person can show, copy or save the words again. The screen then has "Close" and no check step.
7. **Reminder hidden while a screen is open.** A small store in `Pairing.tsx` counts the open phrase screens; `PhraseReminder` reads it.

## Risks / Trade-offs
- [A clipboard history app or Universal Clipboard keeps a copy before the clear] → The warning line says so; the clear limits the time. The copy does not set the macOS "concealed" pasteboard type yet: Electron 45 `clipboard.write` can write several formats at one time, but the raw format needs a test on a real clipboard (open item).
- [The file goes into a synced folder or a backup] → The dialog message and the file text say to keep it offline; mode 0600 limits other local users only.
- [The person copies other text in the 60 s] → The sha256 check keeps that text.
