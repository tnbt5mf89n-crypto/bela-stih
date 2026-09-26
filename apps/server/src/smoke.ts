import './ws-polyfill';
import { Client, type Room } from 'colyseus.js';
import { cardId, RANKS, SUITS, type Card, type PublicView, type Seat } from '@belot/engine';
import type { TableEvent } from '@belot/table';
import { MSG, ROOM_NAME, type RoomMessage } from './protocol';

/**
 * End-to-end check against a running server.
 *
 * Four real clients join over websockets and play a whole deal. The point is not
 * that the rules work — the engine has 300+ tests for that — but that the
 * *transport* keeps its promise: no client may ever receive a card it is not
 * entitled to see.
 *
 *   npm run start --workspace @belot/server     # in one terminal
 *   npm run smoke --workspace @belot/server     # in another
 *
 * WHY THIS FILE IS SHAPED THE WAY IT IS.
 *
 * The original version accumulated every card each client had seen and compared
 * it, at the end, against the other seats' FINAL hands — which are empty once
 * the deal is over. The comparison set was always [], so it printed PASS for
 * months while asserting nothing at all.
 *
 * The first rewrite fixed that but was still too trusting: it built each
 * message's "entitled" whitelist FROM THAT SAME MESSAGE. Anything the server
 * wrote into `currentTrick`, `revealedDeclarations` or `legalActions` therefore
 * excused itself, and was then folded into the public set where it excused
 * itself for every later message too. An adversarial pass planted six leaks and
 * five sailed through: an opponent's whole hand delivered as a fake trick, as a
 * fabricated revealed zvanje, as the talon inside `legalActions`, as an
 * oversized hand, and as bare card-id strings.
 *
 * So the rules here are:
 *
 *  1. A card is public ONLY if it was announced on the BROADCAST event stream
 *     (cardPlayed / declarationsRevealed), which every client receives alike.
 *     Nothing a per-seat view says about itself can make a card public.
 *  2. A view may carry a card only if that card is in its own hand or already
 *     public. Each card-bearing field is additionally held to what it is FOR:
 *     legalActions and myDeclarations must come out of the hand; currentTrick
 *     and revealedDeclarations must already be public.
 *  3. Cards are counted as ids as well as objects, so a leak in string form is
 *     not invisible.
 *  4. Verdicts use hands as they stood WHEN EACH MESSAGE ARRIVED, never
 *     end-of-deal state. Messages are recorded with a snapshot and judged after
 *     the run, once the broadcast stream has established what was public.
 *  5. selfTest() plants known breaches and requires every one to be caught,
 *     and requires a clean message NOT to be flagged. It runs first, so an edit
 *     that makes the assertions toothless fails loudly instead of going green.
 *
 * Later rounds closed three more: a fabricated `cardPlayed` used to declare its
 * own leak public (announcements are now paid for — a card really played leaves
 * the hand that played it), a shared public set let a leak aimed at one seat
 * launder itself through the other three (each client keeps its own now), and a
 * whole hand concatenated into one string slipped past whole-string matching.
 *
 * KNOWN GAP, stated rather than papered over: this exercises four clients that
 * each sit once. It does not walk a client around the free seats before the
 * table locks, so the pre-start redaction in BelaRoom (`this.started ? view :
 * {...view, hand: []}`) is NOT covered here. Breaking that would let one client
 * read three quarters of the deck and this check would still pass.
 */

const ENDPOINT = process.env.SERVER_URL ?? 'ws://localhost:2567';

/** Every legal card id, so a leak in string form can be recognised. */
const ALL_CARD_IDS = new Set(
  SUITS.flatMap((s) => RANKS.map((r) => cardId({ suit: s, rank: r } as Card))),
);

interface Seated {
  room: Room;
  seat: Seat;
  view: PublicView | null;
  /**
   * What THIS client has been told is public.
   *
   * Per client, deliberately. A single shared set let a leak aimed at one seat
   * launder itself through everybody else's verdict: the server could send one
   * client a fabricated announcement and the card became "public" for all four.
   */
  publicCards: Set<string>;
}

/** A claim that a card was played, to be checked against the hands later. */
interface Announcement {
  seat: Seat;
  card: string;
  at: number;
}

/** One received message, with the world as it stood when it landed. */
interface Received {
  seat: Seat;
  kind: 'view' | 'room' | 'other';
  payload: unknown;
  view: PublicView | null;
  /** Other seats' hands at the moment this arrived, from their own views. */
  handsThen: Map<Seat, Set<string>>;
  /** Cards the broadcast stream had already made public when this arrived. */
  publicThen: Set<string>;
  /** For a room message: the cards its own events announce. */
  delta: Set<string>;
}

/**
 * What counts as public FOR ONE MESSAGE.
 *
 * It has to be time-local. Evaluating against everything public by the end of
 * the deal excuses every leak there is, because by then all 32 cards have been
 * played -- which is exactly how a first attempt at this let three planted
 * leaks through.
 *
 * The server sends each client its view and THEN broadcasts the events, so a
 * card played this instant is legitimately in the view before the announcement
 * arrives. Rather than guess a time window, allow precisely the cards the same
 * client's very next broadcast announces: causal, and no clock involved.
 */
function publicFor(log: Received[], i: number): Set<string> {
  const r = log[i]!;
  const pub = new Set(r.publicThen);
  if (r.kind === 'other') return pub;
  if (r.kind === 'room') {
    for (const id of r.delta) pub.add(id);
    return pub;
  }
  for (let j = i + 1; j < log.length; j++) {
    const n = log[j]!;
    if (n.kind === 'room' && n.seat === r.seat) {
      for (const id of n.delta) pub.add(id);
      break;
    }
  }
  return pub;
}

// ---------------------------------------------------------------------------
// Reading cards out of a payload
// ---------------------------------------------------------------------------

function collectCards(value: unknown, out: Card[] = []): Card[] {
  if (Array.isArray(value)) {
    for (const v of value) collectCards(v, out);
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.suit === 'string' && typeof o.rank === 'string') out.push(o as unknown as Card);
    else for (const v of Object.values(o)) collectCards(v, out);
  }
  return out;
}

/**
 * Card ids expressed as a string rather than as objects.
 *
 * Whole-string equality is not enough: a hand concatenated into one field
 * ("8S10SAS8D...") is perfectly readable and would slip past. So a string that
 * can be tiled END TO END by two or more card ids counts as those cards.
 * Requiring a complete tiling is what keeps random room ids — which do
 * sometimes contain a pair of characters like "9D" — from being flagged.
 */
function tiledCardIds(text: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const three = text.slice(i, i + 3);
    const two = text.slice(i, i + 2);
    if (ALL_CARD_IDS.has(three)) { out.push(three); i += 3; }
    else if (ALL_CARD_IDS.has(two)) { out.push(two); i += 2; }
    else return null;
  }
  return out.length >= 2 ? out : null;
}

/** Card ids hiding in plain strings — a leak does not have to arrive as objects. */
function collectCardIds(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (ALL_CARD_IDS.has(value)) out.add(value);
    else for (const id of tiledCardIds(value) ?? []) out.add(id);
  } else if (Array.isArray(value)) {
    for (const v of value) collectCardIds(v, out);
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.suit === 'string' && typeof o.rank === 'string') return out; // a Card, counted elsewhere
    for (const v of Object.values(o)) collectCardIds(v, out);
  }
  return out;
}

/** Every card in a payload, however it was expressed. */
function allCardIds(payload: unknown): Set<string> {
  const ids = new Set(collectCards(payload).map(cardId));
  for (const id of collectCardIds(payload)) ids.add(id);
  return ids;
}

const idsOf = (cards: Card[]): string[] => cards.map(cardId);

// ---------------------------------------------------------------------------
// What the broadcast stream says is public
// ---------------------------------------------------------------------------

/**
 * Cards a broadcast event puts on the table for everybody.
 *
 * This is the ONLY way a card becomes public. Per-seat views are the thing
 * under test and are never allowed to vouch for themselves.
 */
function publicFromEvents(events: TableEvent[], into: Set<string>): Set<string> {
  for (const e of events) {
    if (e.kind === 'cardPlayed') into.add(cardId(e.card));
    else if (e.kind === 'declarationsRevealed') {
      for (const d of e.declarations) for (const c of d.cards) into.add(cardId(c));
    }
  }
  return into;
}

// ---------------------------------------------------------------------------
// The assertions
// ---------------------------------------------------------------------------

const MAX_HAND = 8;

function heldElsewhere(seat: Seat, ids: Set<string>, r: Received, pub: Set<string>): string[] {
  const bad: string[] = [];
  for (const id of ids) {
    if (pub.has(id)) continue;
    for (const [other, held] of r.handsThen) {
      if (other !== seat && held.has(id)) bad.push(`${id} was in seat ${other}'s hand`);
    }
  }
  return bad;
}

export function checkView(r: Received, pub: Set<string>, everHeld: Map<Seat, Set<string>>): string[] {
  const bad: string[] = [];
  const view = r.view!;
  const hand = new Set(idsOf(view.hand));

  // 1. Nothing may appear that is neither yours nor already on the table.
  for (const id of allCardIds(r.payload)) {
    if (!hand.has(id) && !pub.has(id)) bad.push(`${id} is neither in this hand nor public`);
  }
  // 2. Each field held to its purpose, so no field can be used as a smuggling route.
  for (const id of idsOf(collectCards(view.legalActions))) {
    if (!hand.has(id)) bad.push(`legalActions offers ${id}, which is not in this hand`);
  }
  // Your own zvanja stay on the record after you have played the cards, so the
  // test is "did this seat ever hold it", not "is it still there".
  const held = everHeld.get(view.seat) ?? hand;
  for (const id of idsOf(collectCards(view.myDeclarations))) {
    if (!held.has(id)) bad.push(`myDeclarations claims ${id}, never in this hand`);
  }
  for (const p of view.currentTrick) {
    if (!pub.has(cardId(p.card))) bad.push(`currentTrick shows ${cardId(p.card)}, never played`);
  }
  for (const d of view.revealedDeclarations) {
    for (const c of d.cards) {
      if (!pub.has(cardId(c))) bad.push(`revealedDeclarations shows ${cardId(c)}, never revealed`);
    }
  }
  // The deal's history (1.6.0): finished tricks, so only cards the table saw played.
  for (const t of view.history?.tricks ?? []) {
    for (const p of t.plays) {
      if (!pub.has(cardId(p.card))) bad.push(`history shows ${cardId(p.card)}, never played`);
    }
  }
  // 3. Summaries promise to carry no cards — the whole reason the type exists.
  if (allCardIds(view.announcedDeclarations).size > 0) {
    bad.push('announcedDeclarations carried cards; it is supposed to be summaries only');
  }
  // 4. Sizes. A bela hand is eight cards; anything larger is the deck leaking in
  //    under the name of "your own", which every check above would wave through.
  if (view.hand.length > MAX_HAND) bad.push(`hand holds ${view.hand.length} cards, more than a deal`);
  for (const [s, n] of view.handCounts.entries()) {
    if (n < 0 || n > MAX_HAND) bad.push(`handCounts says seat ${s} holds ${n}`);
  }
  const total = view.handCounts.reduce((a, b) => a + b, 0);
  if (total > SUITS.length * RANKS.length) bad.push(`handCounts total ${total} exceeds the deck`);
  // A hand that IS shown must match the count the table publishes. Only when
  // shown: the waiting room deliberately sends an empty hand while handCounts
  // already reports the dealt cards, so nobody can walk the free seats and read
  // the deck. Being sent fewer cards than you own is over-redaction, not a leak.
  const expected = view.handCounts[view.seat];
  if (view.hand.length > 0 && view.hand.length !== expected) {
    bad.push(`hand holds ${view.hand.length} cards but handCounts says ${expected}`);
  }
  // 5. The promise itself.
  bad.push(...heldElsewhere(r.seat, allCardIds(r.payload), r, pub));
  return bad;
}

/**
 * Anything arriving on a channel this test does not know about.
 *
 * Registering handlers for three message types and judging only those meant a
 * fourth channel was a free hole: `client.send('peek', {hand})` delivered a
 * whole hand and the run still printed PASS. MSG.emote is a real channel the
 * test never subscribed to.
 */
export function checkOther(r: Received, pub: Set<string>): string[] {
  const bad: string[] = [];
  for (const id of allCardIds(r.payload)) {
    if (!pub.has(id)) bad.push(`${id} arrived on an unwatched channel`);
  }
  bad.push(...heldElsewhere(r.seat, allCardIds(r.payload), r, pub));
  return bad;
}

export function checkRoom(r: Received, pub: Set<string>): string[] {
  const bad: string[] = [];
  const msg = r.payload as RoomMessage;
  for (const id of allCardIds(msg)) {
    if (!pub.has(id)) bad.push(`${id} rode in on the event stream without being played`);
  }
  for (const e of msg.events ?? []) {
    if (e.kind === 'declared' && allCardIds(e.declarations).size > 0) {
      bad.push(`the 'declared' event carried cards; only the number is public`);
    }
  }
  bad.push(...heldElsewhere(r.seat, allCardIds(msg), r, pub));
  return bad;
}

// ---------------------------------------------------------------------------
// Proof that the assertions can fail
// ---------------------------------------------------------------------------

const card = (suit: string, rank: string): Card => ({ suit, rank }) as unknown as Card;

function sampleView(hand: Card[], handCounts: [number, number, number, number]): PublicView {
  return {
    phase: 'PLAY',
    dealer: 3,
    seat: 0,
    hand,
    handCounts,
    context: { contractType: 'SUIT', trumpSuit: 'hearts' },
    callerSeat: 0,
    multiplier: 1,
    trickLeader: 0,
    currentTrick: [],
    toAct: 0,
    declareTurn: null,
    revealedDeclarations: [],
    matchScores: [0, 0],
    announcedDeclarations: [],
    myDeclarations: [],
    mustDeclare: false,
    canDeclare: false,
    canAnnounceBela: false,
    belaAnnouncedBy: null,
    dealProgress: null,
    legalActions: [],
  } as unknown as PublicView;
}

function selfTest(): boolean {
  const mine = [card('hearts', 'A'), card('hearts', 'K')];
  const theirs = [card('spades', 'A'), card('spades', 'K')];
  const stock = [card('clubs', '7'), card('clubs', '8')];

  const everHeld = new Map<Seat, Set<string>>([[0 as Seat, new Set(idsOf(mine))]]);
  const received = (view: PublicView): Received => ({
    seat: 0,
    kind: 'view',
    payload: { seat: 0, view },
    view,
    handsThen: new Map([
      [0 as Seat, new Set(idsOf(mine))],
      [1 as Seat, new Set(idsOf(theirs))],
    ]),
    publicThen: new Set(),
    delta: new Set(),
  });
  const nothingPublic = () => new Set<string>();

  const checkViewT = (r: Received, pub: Set<string>) => checkView(r, pub, everHeld);
  const cases: Array<[string, () => string[]]> = [
    [
      "an opponent's card appended to the hand",
      () => checkViewT(received(sampleView([...mine, theirs[0]!], [3, 2, 8, 8])), nothingPublic()),
    ],
    [
      'the whole deck handed over as "your own hand"',
      () => {
        const deck = SUITS.flatMap((s) => RANKS.map((r) => card(s, r)));
        return checkViewT(received(sampleView(deck, [8, 8, 8, 8])), nothingPublic());
      },
    ],
    [
      'an oversized hand with handCounts patched to agree',
      () => checkViewT(received(sampleView([...mine, ...stock, ...theirs], [6, 6, 6, 6])), nothingPublic()),
    ],
    [
      'a card parked in a field that should never hold one',
      () => {
        const view = sampleView(mine, [2, 2, 8, 8]);
        (view as unknown as Record<string, unknown>).spare = theirs[1];
        return checkViewT(received(view), nothingPublic());
      },
    ],
    [
      "an opponent's hand dressed up as the current trick",
      () => {
        const view = sampleView(mine, [2, 2, 8, 8]);
        (view.currentTrick as unknown as unknown[]).push({ seat: 1, card: theirs[0] });
        return checkViewT(received(view), nothingPublic());
      },
    ],
    [
      "an opponent's hand dressed up as a finished trick in the history",
      () => {
        const view = sampleView(mine, [2, 2, 8, 8]);
        (view as unknown as { history: unknown }).history = { bids: [], tricks: [{ leader: 1, winner: 1, plays: [{ seat: 1, card: theirs[0] }] }] };
        return checkViewT(received(view), nothingPublic());
      },
    ],
    [
      "an opponent's hand dressed up as a revealed zvanje",
      () => {
        const view = sampleView(mine, [2, 2, 8, 8]);
        (view.revealedDeclarations as unknown as unknown[]).push({
          kind: 'TERCA', value: 20, length: 3, topRank: 'A', seat: 1, cards: theirs,
        });
        return checkViewT(received(view), nothingPublic());
      },
    ],
    [
      'the talon smuggled in through legalActions',
      () => {
        const view = sampleView(mine, [2, 2, 8, 8]);
        (view.legalActions as unknown as unknown[]).push({ type: 'PLAY_CARD', seat: 0, card: stock[0] });
        return checkViewT(received(view), nothingPublic());
      },
    ],
    [
      'summaries carrying the cards they exist to hide',
      () => {
        const view = sampleView(mine, [2, 2, 8, 8]);
        (view.announcedDeclarations as unknown as unknown[]).push({
          kind: 'TERCA', value: 20, length: 3, topRank: 'K', seat: 1, cards: theirs,
        });
        return checkViewT(received(view), nothingPublic());
      },
    ],
    [
      "an opponent's hand as bare card-id strings",
      () => {
        const view = sampleView(mine, [2, 2, 8, 8]);
        (view as unknown as Record<string, unknown>).spy = idsOf(theirs);
        return checkViewT(received(view), nothingPublic());
      },
    ],
    [
      'an unplayed card riding the broadcast event stream',
      () =>
        checkRoom(
          {
            seat: 0,
            kind: 'room',
            payload: {
              seats: [], status: 'playing', series: [0, 0], matchNumber: 0,
              events: [{ kind: 'cardPlayed', seat: 1, card: theirs[0]! } as TableEvent],
              rematchVotes: [theirs[1] as unknown as Seat],
            } as unknown as RoomMessage,
            view: null,
            handsThen: new Map([[1 as Seat, new Set(idsOf(theirs))]]),
            publicThen: new Set(),
            delta: new Set(),
          },
          nothingPublic(),
        ),
    ],
  ];

  let ok = true;
  for (const [name, run] of cases) {
    if (run().length === 0) {
      console.error(`[smoke] SELF-TEST FAILED — planted breach went undetected: ${name}`);
      ok = false;
    }
  }

  // The converse. A check that flags everything proves nothing either.
  const pub = new Set(idsOf(theirs));
  const legit = sampleView(mine, [2, 2, 8, 8]);
  (legit.currentTrick as unknown as unknown[]).push({ seat: 1, card: theirs[0] });
  (legit.legalActions as unknown as unknown[]).push({ type: 'PLAY_CARD', seat: 0, card: mine[0] });
  const clean = checkViewT(received(legit), pub);
  if (clean.length > 0) {
    console.error(`[smoke] SELF-TEST FAILED — a legitimate view was flagged: ${clean.join('; ')}`);
    ok = false;
  }

  console.log(
    ok
      ? `[smoke] self-test: ${cases.length} planted breaches all caught, legitimate view passed`
      : '[smoke] self-test: the assertions are not working',
  );
  return ok;
}

// ---------------------------------------------------------------------------

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!selfTest()) {
    console.error('[smoke] FAIL — refusing to vouch for the server with assertions that do not bite');
    process.exit(1);
  }

  const client = new Client(ENDPOINT);
  const players: Seated[] = [];
  const log: Received[] = [];
  const announcements: Announcement[] = [];
  /** Live ground truth: each seat's hand, per that seat's own view. */
  const hands = new Map<Seat, Set<string>>();
  /** Everything a seat has held at any point — zvanja outlive the cards. */
  const everHeld = new Map<Seat, Set<string>>();

  console.log(`[smoke] connecting four clients to ${ENDPOINT}`);
  // Create one PRIVATE room explicitly and join the rest BY ID. `joinOrCreate`
  // can hand clients to different rooms (a stray seat reservation is enough to
  // do it), and comparing hands across two rooms compares two different decks.
  // Private also exempts these four same-machine clients from the public
  // one-seat-per-origin rule, exactly as four friends round one table would be.
  let roomId: string | null = null;
  for (let i = 0; i < 4; i++) {
    const room: Room =
      roomId === null
        ? await client.create(ROOM_NAME, { name: `Test ${i + 1}`, private: true })
        : await client.joinById(roomId, { name: `Test ${i + 1}` });
    roomId ??= room.roomId;
    const seated: Seated = { room, seat: 0 as Seat, view: null, publicCards: new Set() };

    room.onMessage(MSG.view, (msg: { seat: Seat; view: PublicView }) => {
      seated.seat = msg.seat;
      seated.view = msg.view;
      // Snapshot the OTHER seats as they stand right now; the verdict is taken
      // later, but always against this moment.
      log.push({
        seat: msg.seat,
        kind: 'view',
        payload: msg,
        view: msg.view,
        handsThen: new Map([...hands].map(([s, h]) => [s, new Set(h)])),
        publicThen: new Set(seated.publicCards),
        delta: new Set(),
      });
      hands.set(msg.seat, new Set(idsOf(msg.view.hand)));
      const ever = everHeld.get(msg.seat) ?? new Set<string>();
      for (const id of idsOf(msg.view.hand)) ever.add(id);
      everHeld.set(msg.seat, ever);
    });
    room.onMessage(MSG.room, (msg: RoomMessage) => {
      log.push({
        seat: seated.seat,
        kind: 'room',
        payload: msg,
        view: null,
        handsThen: new Map([...hands].map(([s, h]) => [s, new Set(h)])),
        publicThen: new Set(seated.publicCards),
        delta: publicFromEvents(msg.events ?? [], new Set()),
      });
      // The broadcast stream is the only thing that makes a card public — for
      // THIS client. An announcement is a claim, recorded here and checked
      // against the hands after the run.
      for (const e of msg.events ?? []) {
        if (e.kind === 'cardPlayed') {
          announcements.push({ seat: e.seat, card: cardId(e.card), at: log.length - 1 });
        }
      }
      publicFromEvents(msg.events ?? [], seated.publicCards);
    });
    room.onMessage(MSG.error, (msg: { reason: string }) => {
      console.log(`[smoke] seat ${seated.seat} rejected: ${msg.reason}`);
    });
    // Everything else. A channel nobody subscribed to is a channel nobody audits.
    room.onMessage('*', (type: string | number, msg: unknown) => {
      console.log(`[smoke] seat ${seated.seat} received an unwatched '${String(type)}' message`);
      log.push({
        seat: seated.seat,
        kind: 'other',
        payload: msg,
        view: null,
        handsThen: new Map([...hands].map(([s, h]) => [s, new Set(h)])),
        publicThen: new Set(seated.publicCards),
        delta: new Set(),
      });
    });

    players.push(seated);
  }

  await wait(900);
  const seats = players.map((p) => p.seat);
  console.log('[smoke] room', roomId, 'seats:', seats.join(', '));
  if (new Set(seats).size !== 4) {
    console.error('[smoke] FAIL — clients did not take four distinct seats in one room');
    process.exit(1);
  }

  let moves = 0;
  for (let step = 0; step < 200; step++) {
    const actor = players.find((p) => p.view && p.view.toAct === p.seat && p.view.legalActions.length);
    if (!actor?.view) {
      await wait(120);
      continue;
    }
    actor.room.send('action', { action: actor.view.legalActions[0] });
    moves++;
    await wait(90);
    if (players.some((p) => p.view?.phase === 'DEAL_OVER' || p.view?.phase === 'MATCH_OVER')) break;
  }

  // A deal that never got going would pass every assertion by never testing one.
  const finished = players.some((p) => p.view?.phase === 'DEAL_OVER' || p.view?.phase === 'MATCH_OVER');
  const announced = new Set(announcements.map((a) => a.card));
  console.log(
    `[smoke] ${moves} moves, ${log.length} messages, ${announced.size} card(s) announced as played`,
  );
  if (!finished) {
    console.error('[smoke] FAIL — the deal never reached a conclusion, so nothing was really checked');
    for (const p of players) await p.room.leave();
    process.exit(1);
  }

  // Judge every message that was received, each against the hands as they stood
  // when it arrived, and against the cards the broadcast stream made public.
  const violations: string[] = [];
  for (let i = 0; i < log.length; i++) {
    const r = log[i]!;
    const pub = publicFor(log, i);
    const found =
      r.kind === 'view' ? checkView(r, pub, everHeld) : r.kind === 'room' ? checkRoom(r, pub) : checkOther(r, pub);
    for (const v of found) violations.push(`seat ${r.seat} (${r.kind}): ${v}`);
  }

  /*
   * An announcement is a claim, and until now the test simply believed it. That
   * was the deepest hole left: "public" was read straight off the very stream
   * being audited, so a server that broadcast a fabricated cardPlayed for a card
   * it had just leaked thereby declared that card public and excused itself.
   *
   * A card that was really played leaves the hand that played it. So every
   * announcement has to be paid for: after it, that seat must not still be
   * holding the card.
   */
  for (const a of announcements) {
    for (let i = a.at + 1; i < log.length; i++) {
      const later = log[i]!;
      if (later.kind !== 'view' || later.seat !== a.seat || !later.view) continue;
      if (later.view.hand.some((c) => cardId(c) === a.card)) {
        violations.push(
          `seat ${a.seat}: ${a.card} was announced as played but is still in that hand afterwards`,
        );
      }
      break; // the seat's next view settles it
    }
  }
  for (const v of violations.slice(0, 20)) console.error(`[smoke] LEAK — ${v}`);
  if (violations.length > 20) console.error(`[smoke] ... and ${violations.length - 20} more`);

  console.log(
    violations.length === 0
      ? `[smoke] PASS — ${moves} moves, no client received a card it was not entitled to`
      : `[smoke] FAIL — ${violations.length} violation(s)`,
  );

  for (const p of players) await p.room.leave();
  process.exit(violations.length === 0 && moves > 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('[smoke] failed', err);
  process.exit(1);
});
