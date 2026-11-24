## MODIFIED Requirements

### Requirement: Device and workspace configuration
awd SHALL keep `config.yaml` in the state folder with the device (`slug`, `name`, `role`) and the registered workspace folders. When the file is missing, awd SHALL create it with a slug from the host name and the role `local`; this is a proposal until the device has a signed record. Pairing SHALL set the slug and the role from the signed record. At start and after each change of the records, a valid own record (same slug and device key) with another name or role SHALL correct `config.yaml`; the slug changes only by pairing. `<AW_HOME>/identity.yaml` (mode 0600) SHALL hold the user id and the master public key; the keys SHALL be only in the keystore.

#### Scenario: First start
- **WHEN** awd starts and `config.yaml` is missing
- **THEN** awd writes `config.yaml` with a valid device slug, the role `local` and no workspace, and the keystore has a device key

#### Scenario: Pairing sets the role
- **WHEN** a new computer finishes a pairing as `ubuntu-01`
- **THEN** `config.yaml` has the slug `ubuntu-01` and the role `remote`, and `identity.yaml` has the user id of the showing device
