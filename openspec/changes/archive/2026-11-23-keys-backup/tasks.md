## 1. Main process

- [x] 1.1 Add `desktop/src/main/phrase-backup.ts`: `PhraseBackup` (copy, clear after 60 s with the sha256 check, clear at quit, save with the native dialog), `phraseFileText`, `writePrivateFile` (0600, temporary file and rename)
- [x] 1.2 Add `phrase-backup.test.ts` with a fake clipboard, `FakeClock` and a temp folder; break each test once
- [x] 1.3 Add the bridge calls `copyPhrase` and `savePhrase` (no arguments) to `channels.ts`, `contract.ts` and `calls.ts`, with tests
- [x] 1.4 Wire `PhraseBackup` in `index.ts` with Electron `clipboard`, `dialog` and `systemClock`; clear at `before-quit`

## 2. Renderer

- [x] 2.1 `RecoveryPhraseDialog`: "Copy", "Save to a file…", the warning line, the result lines, the `confirmed` mode with "Close"
- [x] 2.2 Settings "Recovery phrase" card on the device with the master key; the reminder hidden while a phrase screen is open
- [x] 2.3 Renderer tests: buttons and result lines, no phrase in a call argument, the Settings card, the hidden reminder; break each test once

## 3. Docs and checks

- [x] 3.1 `SECURITY.md`: the asset row of the recovery phrase and the threat rows of the clipboard and the file
- [x] 3.2 `docs/phase-1.md` item 13: Copy and Save of the phrase screen and the Settings card
- [x] 3.3 `cd desktop && task check`, then the root `task check`
- [x] 3.4 Journey on a throwaway identity with the fake clipboard and save dialog: screens in dark, light and 400 px
