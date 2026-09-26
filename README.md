# Bela Štih

A modern, fair, authentically-localized **Balkan Belot (Bela)** — 4-player partnership card game.
Online multiplayer first; on-device vs-AI play shares the exact same rules engine.

> **Status: playable on a real Android device, offline and online.** The mađarice deck, sound,
> haptics, levels, coins, daily bonus and quests are in; four clients play a real match through the
> authoritative server, whose hidden-hand guarantee is verified over websockets. What is left before
> beta is store paperwork, not code.

## Play it now

```bash
npm install
```

```bash
npm run play
```

You take the south seat against three bots — you call trump, your own zvanja and your own bela.
To watch four bots play instead:

```bash
npm run play -- --auto --seed 21
```

Useful flags: `--seed N` (reproducible deal), `--deals N` (stop after N hands), `--level easy`.

## Monorepo layout

```
packages/
  shared-types/   pure card/state/protocol TS types shared by client + server
  engine/         the crown jewels: pure, deterministic, configurable Belot rules + scoring
  bots/           one decision function over a redacted view; rule-based now, ISMCTS later
  table/          session layer: plays the bot seats, emits the events a UI animates from
  i18n/           the words AND the deck: madarice suits, ranks, hr / sr-Cyrl / en
  progression/    levels, coins, daily bonus, quests — pure, no storage, no clock
apps/
  cli/            playable terminal Bela — a real client for the engine, not a mock
  mobile/         Expo client (SDK 57, RN 0.86) — builds and runs on Android
  server/         authoritative Colyseus room; `npm run smoke` proves hidden hands
scripts/          make-icons.mjs and make-sfx.mjs — all art and audio is generated
```

## Commands that matter

```bash
npm run android
```

```bash
npm run server
```

```bash
npm run smoke
```

`smoke` connects four real clients to a running server, plays a deal, and asserts no client was
ever shown a card held by another seat. `npm run fill -- <roomId> 3` seats three headless players
at an existing table, which is how one phone gets tested against a full room. `npm run play` is the
terminal client; `npm run icons` and `npm run sfx` regenerate the artwork and the sound kit.

```bash
npm run arena -- --a medium --b easy --matches 200
```

`arena` sits two bot levels against each other over duplicate deals (every seed played from both
sides, so the cards cancel out) and prints A's win rate with a 95% interval, the paired points
margin, how often a deal was a muss, a pad or a valat, and decision times. Medium against medium
is the baseline (30% muss, 20% pad, exactly 50% by construction); a stronger bot has to beat
medium here before it sits at a table. `npm run transcript` records the wire between a client and
the server (see `docs/deploy.md`), `npm run golden:chromium` replays the golden corpus in a real
Chromium, `npm run typecheck:all` runs the three TypeScript projects.

### Playing online from a device over USB

```bash
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:2567 tcp:2567
```

The client reads `EXPO_PUBLIC_SERVER_URL` and defaults to `ws://localhost:2567`.

## How online is put together

One screen renders both modes. `TableScreen` is purely presentational and seat-agnostic — it takes
a `PublicView` and a list of legal actions and knows nothing about where they came from — so
`useGame` (a local `Table`) and `useNetGame` (a Colyseus room) render through exactly the same
component. Progression is driven off the `TableEvent` stream, which the server emits identically,
so XP and coins work online without a second implementation.

The room never syncs state. Each client is sent only its own `PublicView`, built by the same
`publicView()` the leak tests cover, and only the (public) event stream is broadcast. A dropped
player becomes a bot via `Table.setSeatHuman` and gets the seat back on reconnect.

### Two dependency traps worth knowing about

- **Colyseus versions must be pinned exactly.** `colyseus.js` has no 0.17 release, so the server is
  held at `@colyseus/core` **0.16.22** to match. A caret range drifts to 0.16.25, which publishes a
  broken `"workspace:^"` dependency npm cannot install at all.
- **`colyseus.js` needs `metro.config.js`.** Its package exports map a `browser` condition that
  still points at the Node build, which pulls in `ws` and needs `https`/`stream`. The real browser
  bundle is `dist/colyseus.js`, and Metro is pointed straight at it — scoped to that one package so
  nothing else's resolution changes.

### Running the app

```bash
cd apps/mobile && npx expo run:android
```

Verified end to end on a physical device (Xiaomi, Android 15, arm64): Gradle build, install,
Metro bundle, and real taps driving the shared engine. `npx expo-doctor` passes 21/21.

The **same engine** runs on-device and on the authoritative server. The **same bot** is the offline
opponent and the online disconnect-fill. The **same `Table`** backs the terminal client, the Expo
app, and the server's seat-filling. Nothing in `packages/` imports a UI or does any IO.

## Commands

```bash
npm test
```

```bash
npm run typecheck
```

The self-play harness defaults to 10,000 deals (~30s). Shorten it while iterating:

```bash
SELFPLAY_DEALS=300 npx vitest run
```

`.github/workflows/ci.yml` runs all of it on every push: the dependency patchers' `--check`,
the control-byte scan, the three typechecks, vitest, and the golden corpus replayed in Chromium.
Nightly it runs the self-play harness over 100,000 deals.

## What the test suite guarantees

`npm test` — **1013 tests, all passing:**

- **Two value systems, context-derived.** A card stores only `suit + rank`; power and points are
  derived from `{ contractType, trumpSuit }`. The same Jack is 20 in trump and 2 outside it.
- **Three orderings that never cross.** Trick power (trump `J 9 A 10 K Q 8 7`, plain
  `A 10 K Q J 9 8 7`) is kept strictly apart from the natural order used for sequence detection.
  Tests assert that `9-10-J` of trump is a terca even though its trump powers are `7 5 8`.
- **The legality chain**, including the branch most engines get wrong: void in the led suit with
  your *partner* already winning. Tested both ways against the config flag.
- **Declarations** — terca 20 / kvarta 50 / kvinta 100; carré J 200, 9 150, A/10/K/Q 100; four 8s
  and 7s score nothing. Winner takes all of its team's declarations; exact ties cancel.
- **Announce or forfeit.** Zvanja must be called in trick 1 *before* the card, or score nothing, so
  staying silent to conceal your hand is a real option and a weaker announced holding beats a
  stronger silent one. Seats holding nothing are never prompted. An announcement publishes its
  **value, length and top rank but never its cards** — at a real table you call "terca" and only the
  winner shows cards, and the server has already verified the holding.
- **Bela is announce-or-forfeit too**, called *as you play the first of the trump K/Q pair*. "First
  of the pair" needs no bookkeeping: it is exactly the moment both are still in your hand, so a late
  call is impossible by construction. A called bela always scores, including on a failed contract.
- **The contract threshold is a comparison, not a hardcoded 82.** An exact 81-81 board is a *pad*.
- **Valat** pays 90 on top of the last trick for 252 — awarded to whoever actually swept, which may
  be the defenders.
- **Self-play harness:** 10,000 deals across 2,737 matches of random legal play, asserting after
  every deal that all 32 cards were played exactly once, card points total 152, trick points total
  162, `rawTotal` equals its declared parts, and the deal conserves
  `(162 + valat) x multiplier + declarations + bela`. It also spot-checks that `applyAction` never
  mutates its input, and that a seat's view never contains a card currently in somebody else's hand.
  Random play reaches the hard cases: **5,218 pads, 144 valats, 1,149 belas, 3,951 declaration
  contests (64 cancelled), 13,189 doublings.** The harness deliberately runs with `allowKontra: true`
  so the doubling path stays under test even though the shipped game does not use it.
- **Self-play on what ships.** The same invariants over the three overlays a player can actually
  choose (learn, easy, hard: 2,000 deals each per push, 20,000 nightly), not only the harness's
  house rules.
- **The golden corpus** (`packages/engine/test/golden/`): 15 seeded matches, 95 deals, every step's
  action, all four seats' views and the events it produced, hashed deal by deal and committed. A
  hash that moves is a rules change, named by scenario and deal; two planted defects (a blind marking
  that always counts, a renons that pays no zvanja) were shown to turn it red. `npm run golden:chromium`
  proves a real browser hashes the corpus byte for byte as Node does.
- **The wire only grows.** Every message, view field and event type is written out by the
  TypeScript checker into `apps/mobile/test/wire-schema.snapshot.json`; a field removed or changed
  while apps that read it are in the wild fails the build. A wire generation number (`proto`) is
  sent at every join, and a server may refuse an app too old to talk to it (code 4301).
- **The phone plays the same rules.** Settings hides a diagnostics panel (five taps on the version
  line) that replays the golden corpus on the phone's own JavaScript engine and compares the play
  hash with the fixture; `bash scripts/device-flows.sh` drives it, and a deal, through Maestro
  (`apps/mobile/maestro/`), with the release APK on the test phone.

### Rule constants, externally cross-checked

Card values, the 162 total, the dix-de-der 10, sequence and carré values, the four-8s/7s exclusion,
belote 20 scoring separately, and capot totalling 252 were verified against
[pagat.com](https://www.pagat.com/jass/belote.html) and Balkan sources
([belaklub.com](https://belaklub.com/zvanja.html),
[legalbet](https://legalbet.rs/kazino-skola/kako-se-igra-belot-bela-kompletna-pravila-za-pocetnike/)),
which also confirm the base rule: on success each team keeps its own points, on a pad the defenders
take everything.

Two genuine splits surfaced, and neither is hardcoded:

1. **The contract tie.** pagat gives the French rule as the taker succeeding on "at least as many
   points" — a tie *succeeds* — while noting variants where the taker must win outright. Balkan Bela
   uses the latter (81-81 = *pad*), which is the default.
2. **A made kontra.** A *failed* kontra always hands the defenders the whole table doubled; sources
   do not settle the mirror case. Moot for now — kontra is switched off (see below).

## Nobody signs in

There are no accounts anywhere. Progress lives on the device under an anonymous MMKV store, and
online play needs nothing but a websocket. A player types a **nickname** on the home screen — local
only, sent to the room on join so opponents are not all "Igrač 2" — and that is the entire identity
model.

That is a deliberate beta choice, not a shortcut: with no accounts the Play **data-safety** form is
close to "no data collected" and there are no GDPR account obligations to service. Accounts become
worth their cost when progress needs to survive a lost phone or be server-authoritative, which is
also when coins should move server-side.

## The deck

Bela is played with **mađarice** — Hungarian-suited cards, not the French deck:

| Engine id | Mađarica | Croatian | Colour |
|---|---|---|---|
| `clubs` | acorns | žir | brown |
| `spades` | leaves | list | green |
| `hearts` | hearts | srce | red |
| `diamonds` | bells | bundeva | gold |

Ranks read **VII, VIII, IX, X** then **D** (dečko), **B** (baba), **K** (kralj), **A** (as). Unlike the
French deck this is a **four-colour** deck, which is a real legibility win and a visual signature.
The engine keeps French suit identifiers internally — they are just names — and `@belot/i18n` maps
everything a player ever sees.

Every one of the 32 faces is drawn as SVG in `apps/mobile/src/deck`, so there is no licensed card
art anywhere and it stays sharp at any size. Three details do the work of making it read as a real
pack rather than an app:

- **Number cards repeat the pip.** VII really shows seven acorns, laid out in columns with the lower
  half inverted, exactly as a printed card is.
- **Courts are double-headed** — a half figure mirrored about a central rule, so the card reads from
  either end of a fan. Dečko, baba and kralj are told apart by headwear: a feathered cap, a coronet,
  a five-point crown.
- **The ace carries a wreath** around a single large pip.

## Regional variation is configuration, not forks

`EngineConfig` (see `packages/shared-types/src/index.ts`) — v1 defaults are the ex-Yu conventions:

| Knob | Default | What it changes |
|---|---|---|
| `matchTarget` | `1001` | Balkan Bela target |
| `forcedOvertrumpOverPartner` | `false` | Free discard over a winning partner ("ne piši po partneru") |
| `contractTieSucceeds` | `false` | An exact tie is a *pad*; `true` gives the French rule |
| `keepBelaOnFailedContract` | `true` | A failed team still keeps its bela 20 |
| `allowKontra` | `false` | **Kontra is off**: calling trump goes straight to play |
| `kontraScope` | `'trickPoints'` | Dormant unless kontra is switched on |
| `kontraSuccessSweeps` | `false` | Dormant unless kontra is switched on |
| `declarationTieCancels` | `true` | Exactly-equal best declarations cancel for both teams |
| `declarationMode` | `'announce'` | Announce-or-forfeit zvanja; `'auto'` counts them all |
| `belaMode` | `'announce'` | Bela called on the first of the trump K/Q; `'auto'` awards it on sight |
| `dealerMustCall` | `true` | Dealer is forced to call after three passes (*muss*) |
| `lastTrickBonus` / `valatBonus` | `10` / `90` | 162 per deal, 252 on a sweep |

`ContractType` is already `SUIT | ALL_TRUMPS | NO_TRUMPS` and all derivations route through it, so
the Bulgarian contracts slot in later without reshaping the engine. v1 plays **suit contracts only**.

## Progression, and why coins are not a wager

`packages/progression` is pure and unit-tested like the engine: XP per deal and match, a 50-level
curve, a seven-day daily bonus with streaks, three deterministic daily quests, and cosmetics as the
only coin sink.

Coins are **earned rewards, never staked**. Nothing charges an entry fee or splits a pot. That is a
compliance decision rather than a design accident: a stake-and-pot mechanic is what pushes the IARC
questionnaire toward a *Simulated Gambling* descriptor and an automatic PEGI 18. A test asserts the
balance can never fall below its starting value through play alone — only a cosmetic purchase ever
subtracts coins.

Progress is stored locally with MMKV under an anonymous device id. No accounts in beta, which keeps
the Play data-safety declaration close to "no data collected".

## Assets are generated, not sourced

There is **no free mađarice deck** — Wikimedia's William Tell files are mostly photographs of modern
Piatnik decks, whose redrawings are still in copyright, and the CC0 packs are all French-suited. So
all 32 faces are drawn as SVG in `apps/mobile/src/deck`, and the sound kit is synthesised from
oscillators and filtered noise by `scripts/make-sfx.mjs` (141KB for ten effects). Nothing here needs
a licence or an attribution, and both are one command away from being retuned.

## Driving the device

`scripts/ui.sh` reads the live view hierarchy so a check can tap **by label**
rather than by pixel, which is the only way a UI test survives a panel changing
the layout:

```bash
source scripts/ui.sh && ui_tap "Igraj online"
```

Two traps it works around, both of which produced silent wrong answers before
they were fixed: Git Bash needs `MSYS_NO_PATHCONV` for the `/sdcard` argument to
adb, but that same setting stops it translating paths for Windows Python — so
the dump goes in on stdin and the label goes in base64. Without the base64 step
every label with a diacritic ("Vaše karte", "zovi žir") failed to match and the
caller just saw "not found".

It also refuses to dump unless our app is in the foreground. This runs on a real
phone, a notification can pull another app in front at any moment, and a UI dump
would otherwise scrape someone's private messages into the log.

`scripts/play-deal.sh` plays a deal through to its scoring panel on the device.

## Kontra is switched off

This game does not play kontra/rekontra: `allowKontra: false` skips the doubling round entirely, so
calling trump goes straight to the cards and the multiplier is always 1.

The machinery is kept, tested and reachable behind the flag, because it is standard Bela elsewhere
and the engine is meant to model the game faithfully. Switching it back on re-opens one genuinely
unsettled rule — what a *made* kontra pays — which is why `kontraSuccessSweeps` exists with both
readings implemented. A failed kontra clearly hands the defenders the whole table doubled; no source
found settles the mirror case. **Settle it with real players before ever enabling kontra.**

## What the client has to render

Beyond "tap a card", three moments need UI, all already in `PublicView`:

- `mustDeclare` — this seat owes an announce-or-skip call before it may play in trick 1.
  `myDeclarations` says what is on offer; `announcedDeclarations` is what the table has heard.
- `canAnnounceBela` — the same card appears twice in `legalActions`, once silent and once with
  `announceBela: true`; the UI shows a "Bela!" toggle. `belaAnnouncedBy` is set once anyone calls.
- `TableEvent[]` from `Table.drainEvents()` is the animation script: dealt, bid, doubled, declared,
  bela called, card played, trick won, deal scored, match over.

## Next

`apps/mobile` — the Expo client (New Architecture, Reanimated 4, Gesture Handler, Skia, MMKV)
against this same `Table`. Then Phase 2 wraps the identical engine in a Colyseus room.
