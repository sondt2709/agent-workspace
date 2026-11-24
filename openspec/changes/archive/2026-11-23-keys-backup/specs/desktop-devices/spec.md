## MODIFIED Requirements

### Requirement: Recovery phrase
On a device with the master key, the app SHALL show the recovery phrase screen by itself only one time for each user: the 24 words, then a check of 3 words at random positions. The app SHALL record the first show in `<userData>/aw-desktop.json` (`phrase_shown`). After a correct check the app SHALL record the confirmation (`phrase_confirmed`). "Later" SHALL close the screen with no confirmation. While the phrase is shown but not confirmed, Settings and the Inbox SHALL show a reminder line with "Show recovery phrase", which opens the screen again. The reminder line SHALL not show while a phrase screen is open. On a device with the master key, Settings SHALL also show a "Recovery phrase" card with "Show recovery phrase" after the confirmation; the screen then SHALL show "Close" in place of "Later" and no check step.

#### Scenario: Confirm the phrase
- **WHEN** the person types the 3 asked words correctly
- **THEN** the app records the user id as confirmed, and neither the screen nor the reminder shows at the next start

#### Scenario: Later
- **WHEN** the person selects "Later" on the first screen and starts the app again
- **THEN** the screen does not show by itself, and Settings and the Inbox show "Your recovery phrase is not confirmed" with "Show recovery phrase"

#### Scenario: Show the phrase after the confirmation
- **WHEN** the phrase is confirmed and the person selects "Show recovery phrase" in the Settings card
- **THEN** the screen shows the 24 words with "Copy", "Save to a file…" and "Close"

#### Scenario: No reminder under the screen
- **WHEN** the phrase screen shows on the first run
- **THEN** the Inbox shows no reminder line until the screen closes

## ADDED Requirements

### Requirement: Copy and save the recovery phrase
The phrase screen SHALL show "Copy" and "Save to a file…" with the 24 words, and a warning line. The main process SHALL read the phrase from awd for each action; the renderer SHALL not send the phrase. "Copy" SHALL write the 24 words, separated by single spaces, to the clipboard. 60 s after the last copy, and when the app quits, the main process SHALL clear the clipboard if it still holds the copied text. "Save to a file…" SHALL open the native save dialog with the default name `agent-workspace-recovery-phrase.txt` and SHALL write a file with mode 0600 that holds the user id, the device name and slug, the date (UTC) and the 24 numbered words. A replaced file SHALL get mode 0600. Cancel SHALL write nothing.

#### Scenario: Copy
- **WHEN** the person selects "Copy"
- **THEN** the clipboard holds the 24 words, the screen shows "Copied. AW clears the clipboard in 60 seconds.", and 60 s later the clipboard is empty

#### Scenario: Other text copied in the 60 s
- **WHEN** the person copies other text 10 s after "Copy"
- **THEN** the app does not clear the clipboard at 60 s

#### Scenario: Save
- **WHEN** the person selects "Save to a file…" and saves to `~/Documents/agent-workspace-recovery-phrase.txt`
- **THEN** the file has mode 0600, the user id, the device, the date and the 24 numbered words, and the screen shows "Saved to" with the path

#### Scenario: Cancel the save
- **WHEN** the person cancels the save dialog
- **THEN** no file is written and the screen shows no result line

#### Scenario: Device with no master key
- **WHEN** awd refuses the phrase (403)
- **THEN** the app writes nothing to the clipboard or a file and shows the error
