## MODIFIED Requirements

### Requirement: Keystore
awd SHALL keep the device key and the recovery phrase in the keystore that `AW_KEYSTORE` selects: `os` (the OS keystore through `@napi-rs/keyring`) or `file` (`<AW_HOME>/keys/<name>`, mode 0600, folder 0700). The default SHALL be `os` on macOS with the default state folder when `<AW_HOME>/keys/device` does not exist, and `file` on other platforms, with `AW_HOME`, or when `<AW_HOME>/keys/device` exists (after `aw service move-keys`). A key SHALL never be in a log line, an event, a synced file or `config.yaml`.

#### Scenario: File keystore modes
- **WHEN** awd starts with `AW_KEYSTORE=file` and no key
- **THEN** `<AW_HOME>/keys/device` exists with mode 0600 in a folder with mode 0700, and a second start uses the same key

#### Scenario: Bad setting
- **WHEN** `AW_KEYSTORE` is `vault`
- **THEN** the settings module throws an error that names the allowed values

#### Scenario: Moved key
- **WHEN** awd starts on macOS with the default state folder, no `AW_KEYSTORE`, and `~/.aw/keys/device` exists
- **THEN** the keystore is `file`
