# FamilyGram Web

Self-hosted [Telegram Web A](https://github.com/Ajaxy/telegram-tt) fork for [Testgram](https://github.com/CyberoniOntoni/testgram) servers.

The web client is served from the **same host** as the MTProto web gateway — no server prompt. nginx (or NPM) proxies `/apiws` and `/apiw1` to the Testgram gateway on port `30444`.

## Quick start (development)

```sh
cp .env.example .env
# Set TELEGRAM_API_ID, TELEGRAM_API_HASH, FAMILYGRAM_SELF_HOSTED=1
# FAMILYGRAM_GATEWAY_URL=http://YOUR_TESTGRAM_LAN_IP:30444
npm install
npm run dev
```

## Production build

```sh
# BASE_URL=https://web.example.com/
# PRODUCTION_HOSTNAME=web.example.com
npm run build:production
```

Deploy `dist/` behind nginx — see `deploy/nginx-familygram.conf.example`.

## Requirements

- Testgram gateway with ports `30443`/`30444` enabled (default in docker-compose)
- Same `api_id` / `api_hash` as your other FamilyGram clients
- HTTPS in production (NPM or nginx + Let's Encrypt)
- WebRTC: Coturn configured on the Testgram server (for voice/video calls)