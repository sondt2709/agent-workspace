## ADDED Requirements

### Requirement: Workspace credential key
Each workspace SHALL have one credential key (an age X25519 identity). A copy sealed to the device X25519 key of each computer SHALL be in `secure/keys/<device>.age`. A phone SHALL never get the key or a `secure` file.

#### Scenario: Remote computer opens the key
- **WHEN** a paired remote computer reads `secure/keys/<its slug>.age`
- **THEN** it opens the credential key with its device key, and no other device key opens that file

### Requirement: Credential files and commands
`aw credential add <name>` SHALL read the value from stdin or from `--file <path|->` (never from an argument), remove one trailing newline, encrypt it to the credential key in `secure/credentials/<name>.age` and write `credential.added {name}`. `aw credential list` SHALL print the names with the device that added or imported each one, and never a value. `aw credential remove <name>` SHALL remove the file and write `credential.removed`. `aw credential get <name>` SHALL print the value. The local API SHALL have the same operations under `/v1/workspaces/{ws}/credentials`. A mobile device and a device without the credential key SHALL be refused.

#### Scenario: Value never in the clear
- **WHEN** a test adds a credential with a known value, writes a task event that contains the value, and reads each file of the workspace folder, the logs and the index
- **THEN** only the keystore holds a key, the value is nowhere in clear text, and the event has `[redacted:<name>]`

### Requirement: Phone outbox import
A computer with the credential key SHALL import each `devices/<phone>/sealed/<id>.age` of a device whose valid record has the role `mobile`: open it with its device key, check the content `{"kind":"sealed-credential","v":1,"name","value"}`, write `secure/credentials/<name>.age` and `credential.imported {name, from, sealed}`. It SHALL skip a file whose sealed id has a merged `credential.imported`, and a file of a device that is not a valid mobile device. It SHALL check the outbox after each merge change and every 10 s.

#### Scenario: Simulated phone file
- **WHEN** a test writes a sealed file as `pixel-9` (a valid mobile record) to the recipients of both computers
- **THEN** one import writes the credential and `credential.imported` with the sealed id, and a second check imports nothing

### Requirement: Secrets for the redaction
At the open of a workspace and after each credential change, awd SHALL give each credential value to the redaction of the files layer and to the knowledge store (`setSecrets`).

#### Scenario: Knowledge write with a value
- **WHEN** a credential exists and `aw kb write` writes a text with its value
- **THEN** the knowledge file has `[redacted:<name>]` and no value
