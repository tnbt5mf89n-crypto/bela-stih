# Putting the server on the internet

The whole stack is two containers on one small VPS: the Bela game server
(private) behind Caddy (public, automatic HTTPS). One script provisions the
box, one script deploys. Nothing else to install or configure by hand.

## What you need

1. **A Hetzner Cloud VPS** — smallest shared instance (CX22 / CAX11, ~€4/mo),
   image **Ubuntu 24.04**, with your SSH key added. Note its IP.
2. **A domain** (~€10/yr, any registrar). Create one DNS record:
   `A  bela.yourdomain.com  →  YOUR.SERVER.IP`. Wait until
   `ping bela.yourdomain.com` answers from that IP (usually minutes).

## First time: provision the box

```bash
bash scripts/setup-server.sh root@YOUR.SERVER.IP
```

Installs Docker and locks the firewall down to SSH + 80/443.

## Every deploy (first one included)

```bash
bash scripts/deploy-server.sh root@YOUR.SERVER.IP bela.yourdomain.com
```

Packs the server + shared packages, uploads, builds on the box, restarts, and
waits for `https://bela.yourdomain.com/health` to answer with the commit it
was built from. Caddy fetches the Let's Encrypt certificate automatically on
first start — that needs the DNS record to already resolve. Deploys drop
running matches; ship between games (`/health` says how many are on).

Every image is tagged with its commit (`bela-server:<sha>`, `-dirty` when the
tree had local or untracked changes; the tag is `BELA_TAG` in
`/opt/bela/deploy/.env`, and the build that ran before it is `BELA_PREV`).
The box keeps exactly those two, whatever their age, so the build to go back
to is always there - even after a rollback followed by a fix.

## Health, and going back

`https://bela.yourdomain.com/health` answers
`{ ok, room, sha, proto, minProto, rooms, players, uptimeSeconds }`: the commit
running, the wire generation served and the oldest app still admitted, and
whether anyone is at a table. Compose polls it every 30 s and `docker compose
ps` shows the container unhealthy when it stops answering.

If a deploy goes wrong:

```bash
bash scripts/rollback-server.sh root@YOUR.SERVER.IP          # the previous tag
bash scripts/rollback-server.sh root@YOUR.SERVER.IP <sha>    # a named one
```

swaps the tags (`BELA_TAG` becomes the previous build, `BELA_PREV` the one just
left, so a second rollback returns), restarts from the image already on the box
(no build), and ends only when `/health` reports that sha - as the deploy does
for the build it just made. Then fix forward.

## The kill switch: config.json

`https://bela.yourdomain.com/config.json` is a static file caddy serves from
`/opt/bela/deploy/site/config.json`; the game server re-reads it every minute
(`CONFIG_URL`, apps/server/src/config.ts) and `/health` shows what it read:

```json
{ "v": 1, "minProto": 0, "maintenance": false, "voice": true,
  "strangerClips": true, "gifts": true, "emotes": true, "banned": [] }
```

- `maintenance: true` refuses every new seat (the app says the server is
  closed for a moment); tables already playing go on. Flip it back when done.
- `voice`, `gifts`, `emotes` switch a feature off everywhere; `strangerClips`
  only at public tables (private tables keep voice).
- `minProto` raises the oldest app admitted without a deploy (protocol.ts).
- `banned` lists install IDs (32 hex digits, from a report) refused at the door.

Edit it on the box (`nano /opt/bela/deploy/site/config.json`); within a minute
`/health` reflects it. A deploy leaves the box's copy alone (the repo's file
only seeds a new box), so a ban survives releases - and is lost with the box.
Every field is optional; a typo in one field falls back to that field's
default, and a file that fails to parse changes nothing.

## Wire transcripts

```bash
npm run transcript apps/server/transcripts/<version>
```

plays four scripted sessions against `SERVER_URL` (default the local server) —
a full match with everything a table can say, bots and a reconnect, quick play
and its refusals, garbage — and records every WebSocket frame and matchmake
request, raw and decoded, gzipped; each tape's `meta.server` is what `/health`
said about the server it was recorded against. `apps/server/transcripts/1.5.1/`
is what a 1.5.1 app says and hears (the sessions join without `proto`, as that
app does). Record a set before a protocol change and diff the decoded messages
after it; an app in the wild speaks the old set. One tape can be redone alone:
`npm run transcript apps/server/transcripts/1.5.1 full-match`.

## Verify like you mean it

```bash
# the four-client hidden-hand leak test, over real TLS:
SERVER_URL=wss://bela.yourdomain.com npm run smoke
# and the emote relay:
cd apps/server && SERVER_URL=wss://bela.yourdomain.com npx tsx src/emote-smoke.ts
# and the gift relay (rate limit, the table gift, a seat keeping its gift
# through a dropped connection and losing it when its player leaves):
SERVER_URL=wss://bela.yourdomain.com npx tsx src/gift-smoke.ts
# a private table's rules: the host's match length and Prava bela, and a 501
# match (and its rematch) actually ending at 501 - under a minute:
SERVER_URL=wss://bela.yourdomain.com npx tsx src/rules-smoke.ts
# pausing, waiting for a dropped friend, the next-deal countdown, short codes
# (about two minutes; it waits out the old 60 s seat hold on purpose):
SERVER_URL=wss://bela.yourdomain.com npx tsx src/hold-smoke.ts
# voice clips: relayed to the seats that can hear, the sender's echo, the
# limiter, junk dropped with the socket kept open, the host's switch:
SERVER_URL=wss://bela.yourdomain.com npx tsx src/voice-smoke.ts
```

The new quick phrases (`dobro`, `ups`, `idemo`) and the rules message need
the new server first too: an older server drops both, silently.

A server that knows gifts must be live BEFORE any app build that sends them:
an older server drops the message silently, and the sender, who pays only on
the server's echo, loses nothing — but sees nothing either.

Then install the app on a phone, turn **Wi-Fi off** (mobile data only), and
play an online match — that is the test that catches everything USB and LAN
were hiding.

## Point the app at production

`apps/mobile/eas.json` → replace both `wss://CHANGE-ME.example.com` values
with `wss://bela.yourdomain.com`. Release builds pick it up via
`EXPO_PUBLIC_SERVER_URL`; local development keeps using `ws://localhost:2567`
(the fallback in `useNetGame.ts`).

## Uptime monitoring

Free [UptimeRobot](https://uptimerobot.com) monitor, type HTTP(S), URL
`https://bela.yourdomain.com/health`, interval 5 min. It emails you when the
box or the container dies.

## The privacy page

`https://bela.yourdomain.com/` serves `deploy/site/index.html` — the bilingual
privacy policy. That URL is what goes into the Play Console listing.

## Invite links (deep linking)

`https://belastih.com/join/CODE` opens the app straight into that table; for
anyone without the app it renders `deploy/site/join.html` (shows the code +
Play Store button). For the links to open the app **directly** on Android 12+,
`deploy/site/.well-known/assetlinks.json` must carry the real signing
fingerprint: at release time, copy the **SHA-256 certificate fingerprint**
from Play Console → Setup → App integrity → App signing, paste it over the
placeholder, and redeploy. Until then the links still work through the landing
page's "Open in app" button (custom-scheme handoff, no verification needed).

## Useful on the box

```bash
ssh root@YOUR.SERVER.IP
cd /opt/bela/deploy
docker compose logs -f bela      # game server logs
docker compose logs -f caddy     # TLS / proxy logs
DOMAIN=... docker compose restart bela
```

## Rules that keep it working

- **Colyseus versions move together**: `@colyseus/core` (server) and
  `colyseus.js` (app + smoke tests) are pinned to **0.16.22 exactly**.
  Upgrade both in the same commit or not at all.
- The server holds no state worth backing up — a dead box is replaced by
  running the two scripts again on a fresh one.
