## ADDED Requirements

### Requirement: VAPID key per computer
Each computer SHALL make one P-256 key pair at its first awd start, keep it in `~/.aw/keys/vapid.json` (mode 0600), and write the public key (uncompressed point, base64url with no padding) as `vapid_public_key` to its own `bindings.yaml` in each open workspace. The `Authorization` header SHALL be `vapid t=<ES256 JWT>, k=<public key>` with `aud` = the origin of the endpoint and `exp` at most 24 h ahead (RFC 8292).

#### Scenario: Key in the bindings
- **WHEN** awd opens a workspace on a computer
- **THEN** its `bindings.yaml` has the `vapid_public_key` of `~/.aw/keys/vapid.json`

### Requirement: RFC 8291 encryption
The sender SHALL encrypt each push with `aes128gcm` (RFC 8291 and RFC 8188, one record) to the `p256dh` and `auth` of the subscription. With the keys and the salt of RFC 8291 appendix A, it SHALL give the body of that appendix.

#### Scenario: Test vector
- **WHEN** the test encrypts "When I grow up, I want to be a watermelon" with the appendix A values
- **THEN** the body is equal to the appendix A body

### Requirement: Send to the phone subscriptions
For a push, the owner device SHALL read `tasks/devices/*/push.yaml` (schema `push.v1`), take each subscription with `computer` = its own slug and `vapid_public_key` = its current key, and POST the encrypted JSON `{event, task, key, gate_kind, text}` (at most 3 KB) with `TTL: 86400`, `Urgency: high` and `Content-Encoding: aes128gcm`. A failed send SHALL be logged and SHALL not stop the loop.

#### Scenario: Old key
- **WHEN** the subscription of a phone has another `vapid_public_key`
- **THEN** the computer sends nothing to it
