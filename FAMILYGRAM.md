# FamilyGram layer228 alignment

This fork tracks **FamilyGram** / **FamilyGram-Server** (`layer228` branch).

## Wire layer policy (important)

| Constant | Value | Meaning |
|----------|------:|---------|
| Wire / `invokeWithLayer` | **224** | Required while production uses closed-source `mytelegram/mytelegram-session-server` |
| Product target | **228** | Schema/handlers on FamilyGram-Server; cannot use 228 constructor IDs on the wire until session-server is rebuilt against FamilyGram Schema |

Raising clients to true layer **228** wire IDs breaks messaging: session-server rejects constructors such as `messages.sendMessage#fef48f62` and `user#b1b8cc83`.

## Stack ownership

| Component | Repo / image |
|-----------|----------------|
| Server (OSS) | https://github.com/CyberoniOntoni/FamilyGram-Server |
| Unified deploy + Web | https://github.com/CyberoniOntoni/familygram |
| Web (telegram-tt) | https://github.com/CyberoniOntoni/familygram-web |
| Desktop | https://github.com/CyberoniOntoni/familygram-desktop |
| **session-server** | **Not open source** — Docker only: `mytelegram/mytelegram-session-server` |
| **file-server** | **Not open source** — Docker only: `mytelegram/mytelegram-file-server` |

`opengram-server/opengram` includes a rewritten `MyTelegram.SessionServer` that is **not** a drop-in replacement for the production binary.

## This branch

- Branch name: `layer228` — aligned with FamilyGram-Server / familygram `layer228`.
- Wire layer kept at **224** (or raised to 224 if upstream was older) so clients work with the current session-server.
- Do **not** ship pure layer-228 constructor IDs until FamilyGram owns a session-server built with FamilyGram Schema.

See also: FamilyGram-Server `docs/LAYER_228_UPGRADE.md`.
