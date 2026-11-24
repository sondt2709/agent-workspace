# Decision: connection model and relay transport

| Item | Value |
|---|---|
| Date | 2026-11-22 |
| Status | Accepted by the product owner |
| Replaces | The WebSocket relay on Cloudflare Durable Objects (architecture v0.3/v0.4 relay sections, ADR-02 transport part) |
| Principles | 1, 5, 6 in `../principles.md` |

## Decision
1. **Identity is independent of the route.** Each device has a key. A route is only a way to reach that key.
2. **Transport: iroh.** Devices dial each other by key. iroh uses a direct path when it can (same LAN, Tailscale, NAT hole punching) and the relay only as a fallback over HTTPS port 443.
3. **Relay: each person's own `iroh-relay`** (official image, in Docker on a small VPS, or on a remote device when it has a public address). The relay is optional. With no relay, AW connects directly on the LAN or on Tailscale.
4. **Relay access: `access.http`**, which accepts only the endpoint keys that the person paired. A shared token is not enough, because anyone can extract it from the app.
5. **App-layer encryption stays on** inside the iroh stream (AEAD per stream, keys from the pairing secret), so the data stays safe if a lower layer fails.
6. **Sharing with People uses peer links.** People connect first: the invite holds the iroh ticket, the relay URL and a one-time secret. Each link has scoped access. The receiving side owns the expiry. Work that a link starts stays fenced to that link.
7. **Push is separate from the relay.** The device that owns a gate sends a standard Web Push itself (UnifiedPush through Google's push service, or the person's own ntfy server). No AW push service is necessary.
8. **Option for a person without a VPS:** a Cloudflare Tunnel on the person's own Cloudflare account, as one more route. App-layer encryption stays on.

## Reasons
| Reference | What it shows |
|---|---|
| Relay POC (iroh, KMP) | iroh works with the Node and Kotlin bindings. A packet capture on the relay showed no payload. The relay is a stock Docker image. |
| t3code | A server with a stable identity and an ordered list of routes (LAN, Tailscale, SSH, broker) works in a shipping product. The broker is not in the hot path. Peer links connect environments with scoped access. |
| Orca | A central splice relay needs a director, cells, Postgres and many deploy workflows. It is central and relays each byte. This does not agree with principle 5. |

## Rejected options
| Option | Reason |
|---|---|
| WebSocket relay on Cloudflare Durable Objects | Every byte goes through the relay. AW would build its own encryption sessions and relay-to-relay links. Proprietary API. Its main advantages (no server, store for offline devices) do not matter when each person owns a stateless relay. |
| Central splice relay (Orca model) | Central and heavy to operate. |
| Tailscale as the only network | Every device and every connected person must join the same network. It stays one optional route. |
| libp2p, WebRTC | More parts (signaling, TURN) or weak Kotlin support, for the same result. |

## Consequences
1. A production relay needs a public DNS name and open ports 80/tcp, 443/tcp and 7842/udp.
2. On Android, iroh 1.2 resolved names through Quad9 DNS over HTTPS. A relay name that exists only in a private DNS (for example a Tailscale name) does not resolve. Use a public DNS name or an IP address.
3. The iroh Node binding is a native module. Sign it inside the Electron app.
4. Keep the relay and the client on matching iroh versions. Pin both and test them in CI.
5. Spike before implementation:
   1. The Node binding in awd and in Electron (macOS, Linux).
   2. The Kotlin binding on Android against awd.
   3. The share of direct connections from a phone on mobile data.
   4. The self-hosted relay with `access.http`.
   5. The relay traffic of one person in one day.
