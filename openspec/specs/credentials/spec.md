# credentials Specification

## Purpose
The workspace credential key sealed to each computer, the encrypted credential files in `secure/`, the `aw credential` commands, the import of the phone outbox and the credential values for the redaction (`shared/identity`, `daemon/src/service/credentials.ts`).
## Requirements
### Requirement: Workspace credential key
Each workspace SHALL have one credential key (an age X25519 identity). A copy sealed to the device X25519 key of each computer SHALL be in `secure/keys/<device>.age`. A phone SHALL never get the key or a `secure` file. awd SHALL open the key again when the bytes of its `secure/keys/<device>.age` change (a rotation after a revoke arrives through sync), with no restart.

#### Scenario: Remote computer opens the key
- **WHEN** a paired remote computer reads `secure/keys/<its slug>.age`
- **THEN** it opens the credential key with its device key, and no other device key opens that file

#### Scenario: Rotation on a remaining computer
- **WHEN** the local device revokes a third computer, and the rotated files arrive on the remote `ubuntu-01`
- **THEN** `ubuntu-01` opens each credential with the new key, keeps the values for the redaction, and seals a new value to the new key that the revoked computer cannot open

### Requirement: Credential files and commands
`aw credential add <name>` SHALL read the value from stdin or from `--file <path|->` (never from an argument), remove one trailing newline, encrypt it to the credential key in `secure/credentials/<name>.age` and write `credential.added {name}`. `aw credential list` SHALL print the names with the device that added or imported each one, and never a value. `aw credential remove <name>` SHALL remove the file and write `credential.removed`. `aw credential get <name>` SHALL print the value. The local API SHALL have the same operations under `/v1/workspaces/{ws}/credentials`. A mobile device and a device without the credential key SHALL be refused.

#### Scenario: Value never in the clear
- **WHEN** a test adds a credential with a known value, writes a task event that contains the value, and reads each file of the workspace folder, the logs and the index
- **THEN** only the keystore holds a key, the value is nowhere in clear text, and the event has `[redacted:<name>]`

### Requirement: Phone outbox import
A computer with the credential key SHALL import each `devices/<phone>/sealed/<id>.age` of a device whose valid record has the role `mobile`: open it with its device key, check the content `{"kind":"sealed-credential","v":1,"name","value"}`, write `secure/credentials/<name>.age` and `credential.imported {name, from, sealed}`. It SHALL skip a file whose sealed id has a merged `credential.imported`, a file of a device that is not a valid mobile device, and a file whose id or credential name is not a valid name (it logs it). One file that fails SHALL never stop the import of the other files. A computer without the master key SHALL import a file only when it is 2 min old, so the device with the master key imports it first. It SHALL check the outbox after each merge change and every 10 s.

#### Scenario: Phone file with a bad name
- **WHEN** the outbox of `pixel-9` has a file `Bad_Name.age`, a file with a credential name of 70 characters and a good file
- **THEN** one import writes only the good credential, and a second check imports nothing

#### Scenario: Simulated phone file
- **WHEN** a test writes a sealed file as `pixel-9` (a valid mobile record) to the recipients of both computers
- **THEN** one import writes the credential and `credential.imported` with the sealed id, and a second check imports nothing

### Requirement: Secrets for the redaction
At the open of a workspace, after each credential change and every 10 s, awd SHALL give each credential value to the redaction of the files layer and to the knowledge store (`setSecrets`). The redaction of the files layer SHALL cover the events and the text files of a task (the terminal snapshot, the proposal versions and the text artifacts). A credential file that does not open for a time (a half-synced rotation) SHALL keep its last value. A value that a session got SHALL stay in the redaction while awd runs, also after a rotation or a remove. The token of each running session SHALL be in the redaction with the name `mcp-token`, from the time awd mints or loads it until awd revokes it, for the events and for the text files of a task. `aw credential get` of a file that does not open SHALL be 503 `not_ready`.

#### Scenario: Knowledge write with a value
- **WHEN** a credential exists and `aw kb write` writes a text with its value
- **THEN** the knowledge file has `[redacted:<name>]` and no value

#### Scenario: Agent message with the session token
- **WHEN** the agent of a session writes a message that contains its session token
- **THEN** the event has `[redacted:mcp-token]` and no token

#### Scenario: Long message with the session token and a value
- **WHEN** the agent writes a message of more than 32 KiB that contains its session token and a credential value
- **THEN** the file `artifacts/<device>/text-<id>.md` has `[redacted:mcp-token]` and `[redacted:<name>]`, and no token and no value

