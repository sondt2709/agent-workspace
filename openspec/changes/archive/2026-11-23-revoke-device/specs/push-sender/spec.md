## MODIFIED Requirements

### Requirement: Send to the phone subscriptions
For a push, the owner device SHALL read `tasks/devices/*/push.yaml` (schema `push.v1`), take each subscription with `computer` = its own slug and `vapid_public_key` = its current key, and POST the encrypted JSON `{event, task, key, gate_kind, text}` (at most 3 KB) with `TTL: 86400`, `Urgency: high` and `Content-Encoding: aes128gcm`. It SHALL send only to a device that has a kept record in the workspace that is not revoked, and whose device key and sync device id have no revoked record in any open workspace. A failed send SHALL be logged and SHALL not stop the loop.

#### Scenario: Old key
- **WHEN** the subscription of a phone has another `vapid_public_key`
- **THEN** the computer sends nothing to it

#### Scenario: Revoked phone
- **WHEN** the record of `pixel-9` is revoked in this workspace or in another open workspace
- **THEN** the computer sends no push to the subscriptions of `pixel-9`

#### Scenario: No record
- **WHEN** `tasks/devices/pixel-8/push.yaml` exists and the workspace has no record of `pixel-8`
- **THEN** the computer sends nothing to it
