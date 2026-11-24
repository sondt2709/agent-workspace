## MODIFIED Requirements

### Requirement: Phone joins with a code
The phone SHALL join a workspace with a pairing code from a QR scan or a paste, through the engine: it SHALL refuse an expired code, a code of another user when the phone has an identity, and a workspace that the phone has. A phone that has an identity and a stored slug SHALL join with that slug and SHALL ignore a typed name, so the phone has one slug in each workspace. It SHALL write `request.json` (role `mobile`, its slug and name, both public keys, its sync device id, its addresses, `sig` and `mac`) into `<files>/pairing/<nonce>/`, add the showing device as a pairing device with no workspace folder and share the folder `aw-pair-<nonce>` with that device only, and show the 6-digit check code at once. The engine SHALL start for the pairing when the phone has no workspace.

#### Scenario: Join
- **WHEN** the person pastes a valid code and selects "Join"
- **THEN** the pairing folder has a request that the TypeScript `checkRequest()` accepts, the engine has the pairing device and folder, and the screen shows the check code `123 456` format

#### Scenario: Expired code
- **WHEN** the code expired
- **THEN** the phone refuses it with "The pairing code expired" and writes nothing

#### Scenario: Second workspace keeps the slug
- **WHEN** a phone paired as `pixel-9` joins another workspace and the name field holds another name
- **THEN** the request has the slug `pixel-9`, and `<files>/device-slug` stays `pixel-9`

### Requirement: Pairing screen
The app SHALL have the screen "Pair with a computer" (from Devices and from Home when the phone has no workspace): a "Scan QR code" button (the ML Kit code scanner, when Google Play services has it), a paste field, the device name (prefilled with the phone model, the slug shown) or, on a phone that has paired before, the text "This phone joins as <slug>", "Join", the check code with the text "Check that the computer shows the same code, then approve it there", the state, and "Cancel". On Android 17 and later the screen SHALL explain and ask for `ACCESS_LOCAL_NETWORK` before the join; a refusal SHALL NOT block the join.

#### Scenario: No scanner
- **WHEN** the phone has no Google Play services code scanner
- **THEN** the screen shows the paste field only and the join works with a pasted code

#### Scenario: Join another workspace
- **WHEN** a phone paired as `pixel-9` opens "Join another workspace"
- **THEN** the screen shows "This phone joins as pixel-9" and no name field
