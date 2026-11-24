## Why
The person keeps the key material of AW (owner request, review finding F-3). The recovery phrase screen shows the 24 words with no Copy and no Save, and after the confirmation the app has no way to show the words again. A person who uses a password manager or an offline file cannot keep the phrase there without typing 24 words by hand.

## What Changes
- The recovery phrase screen gets "Copy" and "Save to a file…", with a warning line and a result line.
- Copy: the main process writes the words to the clipboard and clears the clipboard after 60 s when it still holds the words. It also clears them when the app quits.
- Save: the native save dialog, default name `agent-workspace-recovery-phrase.txt`, file mode 0600, with the user id, the device and the date in the file.
- The main process reads the phrase from awd for both actions. The renderer never sends the phrase.
- Settings gets a "Recovery phrase" card on the device with the master key, also after the confirmation, with "Show recovery phrase". The screen then shows "Close" in place of "Later".
- The reminder line does not show while a phrase screen is open (F-37: the line under the dialog repeated its text).
- `SECURITY.md` records the clipboard and the file as copies of the phrase, with their remaining risk.
- Not in this change: a backup of the workspace credential key (owner question Q20). The phone: no change, because the phone has no master key in phase 1.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `desktop-devices`: the "Recovery phrase" requirement gets the Settings card and the hidden reminder; a new requirement "Copy and save the recovery phrase".

## Impact
- `desktop/src/main/phrase-backup.ts` (new), `calls.ts`, `index.ts`; `desktop/src/shared/channels.ts`, `contract.ts` (2 new bridge calls with no arguments: `copyPhrase`, `savePhrase`).
- `desktop/src/renderer/src/components/Pairing.tsx`, `Settings.tsx`.
- `SECURITY.md`, `docs/phase-1.md` (item 13).
- No awd API change, no new dependency, no file format change of a workspace file.
