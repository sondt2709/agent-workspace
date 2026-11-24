## ADDED Requirements

### Requirement: Community switch at run time
The transport SHALL change "Use community discovery and relay servers" on a running engine: `setCommunity(on)` SHALL send `PATCH /rest/config/options` with `globalAnnounceEnabled`, `relaysEnabled` and `announceLANAddresses` equal to `on`, and local discovery SHALL stay on. With no running engine the value SHALL apply at the next engine start.

#### Scenario: Off on a running engine
- **WHEN** awd calls `setCommunity(false)` on a running engine
- **THEN** the engine options have `globalAnnounceEnabled`, `relaysEnabled` and `announceLANAddresses` false and `localAnnounceEnabled` true
