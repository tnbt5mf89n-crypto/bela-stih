import { randomBytes } from 'node:crypto';
import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import type { Action, Seat } from '@belot/engine';
import { DEFAULT_CONFIG, HARD_CONFIG_OVERRIDES, RANKS, SEATS, SUITS, type EngineConfig } from '@belot/engine';
import type { Card, Rank, Rng, Suit } from '@belot/engine';
import { Table } from '@belot/table';
import { EMOTE_GAP_MS, EMOTE_IDS, GIFT_GAP_MS, GIFT_IDS, MATCH_TARGETS, MIN_PROTO, MSG, NEXT_DEAL_MS, PAUSE_MAX_MS, TURN_CHOICES, UPDATE_APP_CODE, WAIT_FOR_DROPPED_MS, type ClientMessage, type HoldInfo, type EmoteMessage, type GiftMessage, type JoinGifts, type JoinProto, type JoinVoice, type RoomMessage, type SeatInfo, type VoiceHeardMessage, type VoiceMessage, isPlayMode, modeFromLegacy, type PlayMode, BANNED_CODE, BLOCKED_CODE, MAINTENANCE_CODE, type JoinIdentity } from './protocol';
import { config } from './config';
import { blocksEither, cleanBlockList, cleanInstallId, type Identity } from './identity';
import { checkClip, VoiceLedger, VoiceLimiter } from './voice';
import { cleanName } from './names';
import { tableCode } from './codes';

/** The codes of the private tables open in this process, so a new one is never a duplicate. */
const liveCodes = new Set<string>();

/**
 * An authoritative Bela table.
 *
 * The room owns the only real `Table`; clients own nothing. Every inbound action
 * is checked against the seat the sender actually holds and then handed to the
 * shared engine, which rejects anything illegal — the server trusts nothing.
 *
 * Two deliberate choices:
 *  - **State is never synced.** Each client is sent only its own `PublicView`,
 *    so another player's cards have no route onto the wire at all.
 *  - **A dropped player becomes a bot.** `Table` treats a seat as human-or-bot,
 *    so play carries on and the seat is handed back on reconnect.
 */

/**
 * Randomness with no seed behind it.
 *
 * Seeding a 32-bit generator from crypto does not help: mulberry32's whole
 * state is 32 bits, so the deal it produces is still one of 2^32 — a table an
 * opponent can precompute once and then look up from their own six cards. The
 * only fix is for the server's shuffle not to come from a small seed at all.
 */
function cryptoRng(): Rng {
  let pool = randomBytes(4096);
  let at = 0;
  return () => {
    if (at + 4 > pool.length) {
      pool = randomBytes(4096);
      at = 0;
    }
    const v = pool.readUInt32BE(at);
    at += 4;
    return v / 4294967296;
  };
}

const isSuit = (v: unknown): v is Suit => typeof v === 'string' && SUITS.includes(v as Suit);
const isRank = (v: unknown): v is Rank => typeof v === 'string' && RANKS.includes(v as Rank);

/**
 * Rebuild an action from a client message using only values this server names
 * itself.
 *
 * Validating in place is not enough: the engine stores what it is given, and a
 * `structuredClone` or a msgpack encode of an attacker-shaped object throws far
 * away from any handler that could catch it. Everything below is a fresh
 * literal built from checked primitives, so the client's object is dropped on
 * the floor whatever it contained.
 */
function cleanAction(raw: unknown, seat: Seat): Action | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  // A client may only ever move its own seat.
  if (a.seat !== seat) return null;
  switch (a.type) {
    case 'BID_PASS':
    case 'DOUBLE_KONTRA':
    case 'DOUBLE_REKONTRA':
    case 'DOUBLE_PASS':
    case 'DECLARE_SKIP':
      return { type: a.type, seat };
    case 'DECLARE_ANNOUNCE': {
      // The marked cards must survive the rebuild, or the engine cannot check
      // the claim against the hand — and in blind mode a wrong marking would
      // then succeed online while failing offline. Rebuilt card by card like
      // any other, so nothing the client sent arrives by reference.
      if (a.cards === undefined) return { type: 'DECLARE_ANNOUNCE', seat };
      if (!Array.isArray(a.cards) || a.cards.length > 8) return null;
      const cards: Card[] = [];
      for (const raw of a.cards) {
        if (typeof raw !== 'object' || raw === null) return null;
        const { suit, rank } = raw as Record<string, unknown>;
        if (!isSuit(suit) || !isRank(rank)) return null;
        cards.push({ suit, rank });
      }
      return { type: 'DECLARE_ANNOUNCE', seat, cards };
    }
    case 'BID_CALL':
      return isSuit(a.suit) ? { type: 'BID_CALL', seat, suit: a.suit } : null;
    case 'PLAY_CARD': {
      const c = a.card;
      if (typeof c !== 'object' || c === null) return null;
      const { suit, rank } = c as Record<string, unknown>;
      if (!isSuit(suit) || !isRank(rank)) return null;
      const card: Card = { suit, rank };
      return a.announceBela === true
        ? { type: 'PLAY_CARD', seat, card, announceBela: true }
        : { type: 'PLAY_CARD', seat, card };
    }
    default:
      return null;
  }
}

/** Quick play's turn clock, and a private table's until its host picks another. */
const TURN_MS = TURN_CHOICES[0]! * 1000;
/** Shortest gap between two accepted seat changes from one connection. */
const SIT_GAP_MS = 250;
/**
 * How long a dropped player's seat is kept for them. In the lobby, briefly: a
 * held chair nobody is behind blocks the table from filling. Once the match
 * is under way nothing waits on a held seat (a bot or the private table's wait
 * covers it), so it is kept for as long as a phone call could plausibly last -
 * coming back to your own seat instead of the lobby.
 */
const LOBBY_RECONNECT_SECONDS = 60;
const TABLE_RECONNECT_SECONDS = 30 * 60;

interface Occupant {
  sessionId: string | null;
  name: string;
  avatar: string;
  connected: boolean;
  /**
   * Where this connection came from, for the one-seat-per-origin rule below.
   * Server-side only — it is never published, stored or logged.
   */
  origin: string;
  /** This player's app draws table gifts (it joined with `gifts: true`). */
  gifts: boolean;
  /**
   * This player's app plays and records voice clips now: it joined with
   * `voice: true`, or said so since ('hears'). Off while its player has
   * switched voice off in Settings.
   */
  voice: boolean;
  /** The app can do voice at all (it sent `voice`, true or false); an older one cannot. */
  speaksVoice: boolean;
  /** The app confirms the clips it plays, and reads confirmations of its own (`receipts: true`, 1.5.1). */
  receipts: boolean;
  /** The wire generation the app joined with (protocol.ts PROTO); 0 for an app from before the handshake. */
  proto: number;
  /** The app's install ID and block list (identity.ts): in memory, with the seat, and nowhere else. */
  installId: string;
  blocked: ReadonlySet<string>;
  /** At a public table: this player asked for strangers' clips here ('voiceIn'). */
  voiceIn: boolean;
}

/** A chair nobody sits in. */
const vacant = (): Occupant => ({ sessionId: null, name: '', avatar: '', connected: false, origin: '', gifts: false, voice: false, speaksVoice: false, receipts: false, proto: 0, installId: '', blocked: new Set(), voiceIn: false });

/** Refused because a seat at THIS table is already held from the same place. */
export const SAME_ORIGIN_CODE = 4300;

/** The address a connection appears to come from, behind the proxy or not. */
function originOf(context: AuthContext): string {
  const ip = context.ip;
  const first = Array.isArray(ip) ? ip[0] : ip;
  // x-forwarded-for is a list when there is more than one proxy; the client is
  // the first entry.
  return String(first ?? '').split(',')[0]!.trim();
}

/** The wire generation an app joined with: what it said, or 0 for an app from before the handshake. */
function protoOf(options: unknown): number {
  const p = (options as JoinProto | null)?.proto;
  return typeof p === 'number' && Number.isInteger(p) && p >= 0 ? p : 0;
}

/** Each version as the engine's own switches (the rules themselves are untouched). */
const MODE_CONFIG: Record<PlayMode, Partial<EngineConfig>> = {
  learn: {},
  easy: { declarationMode: 'blind' },
  hard: HARD_CONFIG_OVERRIDES,
};

export class BelaRoom extends Room {
  override maxClients = 4;

  private table!: Table;
  /** The version played: quick play is Lagana; a private table's host picks. */
  private mode: PlayMode = 'easy';
  /** Points the match is played to: quick play's 1001, or what a private table's host chose. */
  private target = DEFAULT_CONFIG.matchTarget;
  /** Public tables are the ones strangers are matched into. */
  private isPublic = true;
  /** The table's creator (first joiner); start-with-bots rights follow them. */
  private hostId: string | null = null;
  /** Matches won per team since these people sat down. */
  private series: [number, number] = [0, 0];
  private matchNumber = 0;
  /** Idempotence guard: afterMove() runs on every publish, the score once. */
  private lastRecordedMatch = -1;
  /** Seats that have asked for another match; cleared on each restart. */
  private readonly rematchVotes = new Set<Seat>();
  private occupants: Occupant[] = [];
  /** This table's turn clock: quick play's, or what a private table's host chose. */
  private turnMs = TURN_MS;
  /**
   * A private table standing still. Two reasons, which can overlap: a player
   * paused it, or a player's connection dropped and the table waits for them.
   * Nothing moves while either holds - no turn clock, no bots, no next deal -
   * because the Table only ever moves inside submit(), setSeatHuman(false),
   * startNextDeal() and the timers, and a hold refuses or stops all four.
   */
  private paused: { by: Seat; until: number } | null = null;
  /** Dropped players still waited for, each until its own give-up time. */
  private readonly waiting = new Map<Seat, number>();
  /**
   * Seats whose wait ended without them (it ran out, or someone chose to play
   * on) while the table still could not move. A bot takes them the moment it
   * can: handing a seat to a bot runs the bots at once, which must never
   * happen while anybody is still waited for or the table is paused.
   */
  private readonly gaveUp = new Set<Seat>();
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** The scored deal's countdown, and who has said they are ready. */
  private readonly nextVotes = new Set<Seat>();
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private nextEndsAt = 0;
  /** Which scored deal the countdown belongs to (afterMove runs on every publish). */
  private nextFor = -1;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnEndsAt = 0;
  /** The seat the running timer was armed for, so a stale fire is detectable. */
  private turnSeat: Seat | null = null;
  /** Which DECISION that timer belongs to; see Table.moveCount. */
  private turnDecision: string | null = null;
  private started = false;
  /**
   * Rate limits, keyed by CONNECTION rather than by seat: pre-start a client can
   * change seats freely, so a per-seat gap is one a seat-hopper multiplies.
   */
  private lastEmoteAt = new Map<string, number>();
  private lastSitAt = new Map<string, number>();
  private lastVoteAt = new Map<string, number>();
  /** The last 'voiceIn' from each connection: republishes, so it gets the vote's gap. */
  private lastVoiceInAt = new Map<string, number>();
  private lastGiftAt = new Map<string, number>();
  private voiceLimits = new Map<string, VoiceLimiter>();
  /** Numbers each relayed clip, so a client can tell its echo from another clip. */
  private voiceSeq = 0;
  /** Who was sent which clip lately, for the receipts ('heard'). */
  private voiceLedger = new VoiceLedger();
  /** Voice messages at this table: always in quick play; a private table's host may switch them off. */
  private voiceOn = true;
  /**
   * Each seat's latest gift, by seat rather than by occupant: a seat played by
   * a bot from the start can be given one too. Cleared when the person in the
   * seat changes (a join, a release); kept while a dropped player is held, and
   * across a rematch, because it is still the same person at the table.
   */
  private gifts: (string | null)[] = [null, null, null, null];

  override onCreate(
    options: { private?: boolean; mode?: unknown; hard?: boolean; target?: number; modes?: boolean } = {},
  ): void {
    this.occupants = SEATS.map(vacant);
    // The version and a shorter match are the host's choice, and only on
    // private tables - quick play must stay predictable for strangers. The
    // host may change both in the lobby, until the start. A table asked for
    // under ROOM_NAME_MODES (`modes`) is Lagana unless its host says
    // otherwise; one asked for by an app from before the three versions plays
    // what that app always played - zvanja announced - unless its `hard` says
    // Prava bela.
    const standard: PlayMode = options.modes === true ? 'easy' : 'learn';
    this.mode =
      options.private === true
        ? isPlayMode(options.mode)
          ? options.mode
          : (modeFromLegacy(options.hard) ?? standard)
        : standard;
    if (options.private === true && typeof options.target === 'number' && MATCH_TARGETS.includes(options.target)) {
      this.target = options.target;
    }
    this.buildTable();

    // A code friends can read out and type (codes.ts), at every table: a
    // quick-play table shows its code and an invite too, and showed
    // "IUxDQ8dvS" there. Colyseus registers the room under its id only after
    // onCreate, so this is the id.
    this.roomId = tableCode((c) => liveCodes.has(c));
    liveCodes.add(this.roomId);
    if (options.private) {
      this.isPublic = false;
      this.setPrivate(true);
    }

    // Colyseus looks the message type up on a plain object literal, so a client
    // sending `__proto__` / `constructor` / `toString` resolves up the prototype
    // chain to something truthy whose `.callback` is not a function, and the
    // throw escapes the room and takes the process with it.
    // The handler map is private to Room; reaching it is the only way to close
    // the lookup, since registering a named `__proto__` handler would set the
    // prototype instead of an own key.
    Object.setPrototypeOf((this as unknown as { onMessageHandlers: object }).onMessageHandlers, null);

    this.onMessage('*', (client: Client, type: string | number, message: unknown) => {
      try {
        this.handle(client, { type, message } as never);
      } catch (err) {
        // One malformed frame must cost the sender an error and nothing else.
        // Every room on this host shares a process; an escape here ends them all.
        console.error(`[bela] message ${String(type)} failed:`, err);
        client.send(MSG.error, { reason: 'bad message' });
      }
    });
  }

  // --- seating -------------------------------------------------------------

  private seatOf(sessionId: string): Seat | null {
    const i = this.occupants.findIndex((o) => o.sessionId === sessionId);
    return i < 0 ? null : (i as Seat);
  }

  private freeSeat(): Seat | null {
    // Partner-first order: the second joiner sits ACROSS from the host (0 and
    // 2 are a team), so two friends and two bots is partners by default.
    for (const s of [0, 2, 1, 3] as Seat[]) {
      if (this.occupants[s]!.sessionId === null) return s;
    }
    return null;
  }

  /**
   * One seat per origin at a public table.
   *
   * There are no accounts, so the server cannot tell four players from one
   * person in four tabs — and three tabs at one table is enough to read the
   * fourth player's whole hand by elimination, since a bela deck is 32 cards
   * and three hands are 24 of them. No rule is broken doing it; the seats are
   * simply all theirs.
   *
   * Refusing rather than blocking: the client answers this by CREATING a fresh
   * public table instead, so the second connection still gets a game — it just
   * cannot sit down next to the first one. Nobody is ever turned away, which
   * matters because whole mobile networks share one address, and two strangers
   * behind the same carrier must not be mistaken for a cheat.
   *
   * Private tables are exempt: you get in by knowing the code, and sharing it
   * with somebody is the entire point.
   */
  override onAuth(_client: Client, options: unknown, context: AuthContext): { origin: string } & Identity {
    const cfg = config();
    // The door, in order. Closed for a moment (config.json): nobody new sits down.
    if (cfg.maintenance) throw new ServerError(MAINTENANCE_CODE, 'closed for a moment');
    // An app too old for this wire is refused before it takes a seat
    // (protocol.ts: the generation; the config can raise the floor without a deploy).
    if (protoOf(options) < Math.max(MIN_PROTO, cfg.minProto)) throw new ServerError(UPDATE_APP_CODE, 'update the app');
    const id = options as JoinIdentity | undefined;
    const installId = cleanInstallId(id?.installId);
    if (installId !== '' && cfg.banned.has(installId)) throw new ServerError(BANNED_CODE, 'banned');
    const blocked = cleanBlockList(id?.blocked);
    const origin = originOf(context);
    const clash =
      this.isPublic &&
      !this.started &&
      origin !== '' &&
      this.occupants.some((o) => o.sessionId !== null && o.connected && o.origin === origin);
    if (clash) throw new ServerError(SAME_ORIGIN_CODE, 'seat already held from here');
    // A public table never seats two people who have blocked each other, either
    // way: quick play must not re-match them. A held seat is still that person.
    if (this.isPublic) {
      const me: Identity = { installId, blocked };
      if (this.occupants.some((o) => o.sessionId !== null && blocksEither(me, o))) throw new ServerError(BLOCKED_CODE, 'blocked');
    }
    return { origin, installId, blocked };
  }

  override onJoin(client: Client, options: { name?: string; avatar?: string } & JoinGifts & JoinVoice = {}): void {
    const seat = this.freeSeat();
    if (seat === null) {
      client.leave(4000, 'table full');
      return;
    }
    const auth = client.auth as ({ origin?: string } & Partial<Identity>) | undefined;
    this.occupants[seat] = {
      origin: auth?.origin ?? '',
      installId: auth?.installId ?? '',
      blocked: auth?.blocked ?? new Set(),
      voiceIn: false,
      sessionId: client.sessionId,
      // Just what they gave: seatInfo names an empty one by the chair it is in
      // at the time, so a move in the lobby cannot carry the old chair's number.
      name: cleanName(options.name),
      // Echoed verbatim to other clients, so keep it to a short safe token.
      avatar: typeof options.avatar === 'string' ? options.avatar.replace(/[^a-z]/g, '').slice(0, 20) : '',
      connected: true,
      gifts: options.gifts === true,
      voice: options.voice === true,
      speaksVoice: typeof options.voice === 'boolean',
      receipts: options.receipts === true,
      proto: protoOf(options),
    };
    this.table.setSeatHuman(seat, true);
    this.gifts[seat] = null;
    if (this.hostId === null) this.hostId = client.sessionId;

    // The series belongs to the people who sat down together, so a NEW face
    // resets it. A reconnect never lands here (it goes through
    // allowReconnection), so a dropped player keeps the tally.
    if (this.started) {
      this.series = [0, 0];
      this.matchNumber = 0;
      this.lastRecordedMatch = -1;
    }

    if (!this.started && this.occupants.every((o) => o.sessionId !== null)) {
      this.lockTable();
      // The opening bidder is on the clock from the very first move — without
      // this, an AFK first player would hang the table forever.
      this.armTimer();
    }
    this.publish();
  }

  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const seat = this.seatOf(client.sessionId);
    if (seat === null) return;

    this.occupants[seat]!.connected = false;
    if (this.started && consented !== true && this.waitsFor(seat)) {
      // A private table stands still for a friend whose phone rang: nobody
      // plays their cards for them, and the others see who they are waiting
      // for and can choose to play on.
      this.waiting.set(seat, Date.now() + WAIT_FOR_DROPPED_MS);
      this.holdChanged();
    } else if (this.started) {
      // The seat keeps playing as a bot while we wait for them back. The bot
      // may move immediately, so re-arm the clock for whoever is on turn now.
      this.handToBot(seat);
      this.afterMove();
    } else {
      // Pre-start, nothing may move: handing a lobby seat to its bot used to
      // start the deal playing itself while `status` still read 'waiting'.
      this.publish();
    }

    // A deliberate leave frees the seat at once (release() re-checks the vote);
    // a dropped connection is worth holding open for.
    if (consented === true) {
      this.release(seat);
      return;
    }

    // Their dropping out may have been the last vote anybody was waiting on —
    // everyHumanVoted() counts only CONNECTED humans, and this one no longer is.
    // Deliberately NOT an early return: leaving here would skip the hold below,
    // so the seat would stay occupied by a session that has gone, with no
    // reconnect window and, if they were the host, no way to pass the crown.
    this.maybeRematch();

    try {
      await this.allowReconnection(client, this.started ? TABLE_RECONNECT_SECONDS : LOBBY_RECONNECT_SECONDS);
      this.occupants[seat]!.connected = true;
      this.occupants[seat]!.sessionId = client.sessionId;
      this.table.setSeatHuman(seat, true);
      // Back before anyone gave up on them: nothing was played for them, and
      // the table carries on if they were the last thing it waited for.
      const wasWaited = this.waiting.delete(seat);
      const hadGivenUp = this.gaveUp.delete(seat);
      if (wasWaited || hadGivenUp) {
        this.holdChanged();
        return;
      }
      // Coming back changes the connected-human set exactly as leaving did, so
      // a vote that was waiting on somebody else can now be complete. And the
      // clocks re-arm: a table that sat at a scored deal with nobody on the line
      // armed no countdown, and would otherwise wait for a press for ever.
      if (!this.maybeRematch()) this.afterMove();
    } catch {
      this.release(seat);
    }
  }

  private release(seat: Seat): void {
    const wasHost = this.occupants[seat]!.sessionId === this.hostId;
    this.forget(this.occupants[seat]!.sessionId);
    this.occupants[seat] = vacant();
    // The person has gone for good; their gift goes with them.
    this.gifts[seat] = null;
    // A seat nobody is sitting in cannot be waited on for a rematch vote.
    this.rematchVotes.delete(seat);
    this.nextVotes.delete(seat);
    // Whoever left is no longer waited for - but while the table stands still
    // their bot must not move yet either: it takes the seat when the hold ends.
    this.waiting.delete(seat);
    this.gaveUp.delete(seat);
    if (this.started) this.handToBot(seat);
    // The crown passes to whoever is still seated.
    if (wasHost) this.hostId = this.occupants.find((o) => o.sessionId !== null)?.sessionId ?? null;
    if (this.maybeRematch()) return;
    // holdChanged, not afterMove: it is the one place that reschedules the
    // hold and hands over any seat that was waiting for the table to move.
    if (this.started) this.holdChanged();
    else this.publish();
  }

  /**
   * Start the next match if the departure just now completed the vote.
   *
   * everyHumanVoted() is otherwise only ever evaluated inside the `rematch`
   * handler, so three players who accepted and then lost the fourth waited for a
   * message that could never arrive — and the client hides "start anyway" once
   * the outstanding count reaches zero.
   */
  private maybeRematch(): boolean {
    if (this.table.phase !== 'MATCH_OVER' || !this.everyHumanVoted()) return false;
    this.beginRematch();
    return true;
  }

  /**
   * A fresh table under this room's rules. Four humans: nothing moves until a
   * real player acts, or a timer fires. Only ever before the start, when the
   * lobby has shown nobody a card (publish withholds the hands until then),
   * so the host changing the rules just deals a new, unseen deck.
   */
  private buildTable(): void {
    this.table = new Table({
      humanSeats: [...SEATS],
      config: { ...MODE_CONFIG[this.mode], matchTarget: this.target },
      // No seed at all. Table's default is `Date.now()`, which is fine for the
      // CLI and offline play (dealer and player are the same device) and
      // catastrophic here — but so is any 32-bit seed, crypto or not, because
      // the generator behind it only has 32 bits of state to hide in.
      rng: cryptoRng(),
    });
    this.table.drainEvents();
  }

  /**
   * Close the table and fix who is a human from here.
   *
   * A seat only plays as a human if somebody is actually SITTING in it and
   * connected. Checking `sessionId === null` alone let a player who dropped in
   * the lobby — whose seat is still occupied while we hold it for them — lock in
   * as a human nobody was behind, so every one of that seat's turns burned the
   * full 30 seconds for everyone else until the hold lapsed.
   */
  private lockTable(): void {
    for (const s of SEATS) {
      const o = this.occupants[s]!;
      this.table.setSeatHuman(s, o.sessionId !== null && o.connected);
    }
    this.started = true;
    this.lock();
  }

  /** Every connected human still at the table has asked for another match. */
  private everyHumanVoted(): boolean {
    const humans = SEATS.filter(
      (s) => this.occupants[s]!.sessionId !== null && this.occupants[s]!.connected,
    );
    return humans.length > 0 && humans.every((s) => this.rematchVotes.has(s));
  }

  private beginRematch(): void {
    // A seat that is still occupied and connected stays HUMAN whatever it
    // voted — the vote gates the START, it never takes somebody's cards away.
    // Empty and dropped seats become bots, exactly as at table creation.
    for (const s of SEATS) {
      const o = this.occupants[s]!;
      this.table.setSeatHuman(s, o.sessionId !== null && o.connected);
    }
    this.rematchVotes.clear();
    this.matchNumber += 1;
    // The Table keeps the injected generator, so the new deck is drawn the
    // same way the first one was.
    this.table.newMatch();
    this.afterMove();
  }

  // --- play ----------------------------------------------------------------

  private handle(client: Client, packet: { type: string; message: ClientMessage }): void {
    const seat = this.seatOf(client.sessionId);
    if (seat === null) return;

    // A player the table waits for who says anything at all is back: their
    // "back" may have been the message a flaky connection lost, and a table
    // left waiting on someone who is playing would refuse their every move.
    // (Not a Settings switch flipped on the way, nor a clip's receipt: that is
    // the app, not the player at the table.)
    if (packet.type !== 'away' && packet.type !== 'hears' && packet.type !== 'voiceIn' && packet.type !== 'heard' && this.waiting.has(seat) && this.occupants[seat]!.connected) {
      this.waiting.delete(seat);
      this.holdChanged();
      if (packet.type === 'back') return;
    }

    if (packet.type === 'action') {
      // Every other branch is gated on `started` or on a phase. Without this a
      // third joiner can bid before the fourth player exists, and the fourth
      // arrives bound to a contract they never saw.
      if (!this.started) return;
      // A table standing still takes no moves: the player who paused it is on
      // the phone, or a friend is being waited for.
      if (this.isHeld()) {
        client.send(MSG.error, { reason: 'paused' });
        return;
      }
      const raw = (packet.message as { action?: unknown } | undefined)?.action;
      // Rebuilt field by field from primitives, so no object a client sent can
      // reach the engine or the authoritative state by reference. A well-typed
      // action carrying a hostile VALUE was enough to poison a room and, at the
      // next publish, take the whole process down.
      const action = cleanAction(raw, seat);
      if (!action) {
        client.send(MSG.error, { reason: 'malformed action' });
        return;
      }
      try {
        this.table.submit(action);
      } catch (err) {
        // The engine rejects anything illegal; tell the client and carry on.
        client.send(MSG.error, { reason: (err as Error).message });
        return;
      }
      this.afterMove();
      return;
    }

    if (packet.type === 'sit') {
      // Before the game starts, anyone may move to a free seat — that is how
      // friends pick teams. No state has advanced yet, so it is a pure swap.
      const target = (packet.message as { seat?: Seat } | undefined)?.seat;
      if (this.started) return;
      // Number.isInteger also rejects NaN and any non-number, so a fractional
      // seat can no longer index past the end of `occupants` and throw.
      if (!Number.isInteger(target) || target! < 0 || target! > 3 || target === seat) return;
      // Each accepted change republishes to every client, so it needs the same
      // kind of gap the emotes have.
      const now = Date.now();
      if (now - (this.lastSitAt.get(client.sessionId) ?? 0) < SIT_GAP_MS) return;
      if (this.occupants[target!]!.sessionId !== null) return;
      this.lastSitAt.set(client.sessionId, now);
      this.occupants[target!] = this.occupants[seat]!;
      this.occupants[seat] = vacant();
      // Gifts only exist once the table has started, but should that ever
      // change, a gift follows the person, not the chair.
      this.gifts[target!] = this.gifts[seat]!;
      this.gifts[seat] = null;
      this.publish();
      return;
    }

    if (packet.type === 'clock') {
      // Only before the start, only at a private table, only the host, and
      // only one of the offered lengths: quick play stays the same for everyone.
      const seconds = (packet.message as { seconds?: unknown } | undefined)?.seconds;
      if (this.started || this.isPublic || seat !== this.actingHostSeat()) return;
      if (typeof seconds !== 'number' || !TURN_CHOICES.includes(seconds)) return;
      this.turnMs = seconds * 1000;
      this.publish();
      return;
    }

    if (packet.type === 'rules') {
      // The same four conditions as the clock: before the start, a private
      // table, its host, and only what is offered.
      const m = packet.message as { target?: unknown; mode?: unknown; hard?: unknown; voice?: unknown } | undefined;
      if (this.started || this.isPublic || seat !== this.actingHostSeat()) return;
      // Voice on or off changes nothing on the table itself: no rebuild.
      const voiceChanged = typeof m?.voice === 'boolean' && m.voice !== this.voiceOn;
      if (voiceChanged) this.voiceOn = m!.voice as boolean;
      let changed = false;
      if (typeof m?.target === 'number' && MATCH_TARGETS.includes(m.target) && m.target !== this.target) {
        this.target = m.target;
        changed = true;
      }
      // The version by name, or an older app's `hard` switch.
      const mode = isPlayMode(m?.mode) ? m.mode : modeFromLegacy(m?.hard);
      if (mode !== null && mode !== this.mode) {
        this.mode = mode;
        changed = true;
      }
      if (changed) this.buildTable();
      if (changed || voiceChanged) this.publish();
      return;
    }

    if (packet.type === 'pause') {
      if (!this.canHold() || this.paused !== null) return;
      this.paused = { by: seat, until: Date.now() + PAUSE_MAX_MS };
      this.holdChanged();
      return;
    }

    if (packet.type === 'resume') {
      if (this.paused === null) return;
      this.paused = null;
      this.holdChanged();
      return;
    }

    if (packet.type === 'away') {
      // A call that did not drop the connection: wait for them as if it had.
      if (!this.waitsFor(seat) || this.waiting.has(seat)) return;
      this.waiting.set(seat, Date.now() + WAIT_FOR_DROPPED_MS);
      this.holdChanged();
      return;
    }

    if (packet.type === 'back') {
      if (!this.waiting.delete(seat)) return;
      this.holdChanged();
      return;
    }

    if (packet.type === 'playOn') {
      // Stop waiting for everyone who dropped: their bots take the cards
      // (the moment the table may move) until they are back.
      if (this.waiting.size === 0) return;
      for (const s of this.waiting.keys()) this.gaveUp.add(s);
      this.waiting.clear();
      this.holdChanged();
      return;
    }

    if (packet.type === 'start') {
      // The host (the table's creator) may start early; every empty seat
      // plays as a bot from here on. The table locks exactly as it does when
      // a fourth human sits down. While the host's phone is off the line,
      // whoever sits next in order may do it: a held lobby seat must not lock
      // everyone else out of starting.
      if (seat !== this.actingHostSeat() || this.started) return;
      this.lockTable();
      this.afterMove();
      return;
    }

    if (packet.type === 'rematch' || packet.type === 'rematchCancel') {
      if (this.table.phase !== 'MATCH_OVER') return;
      // Each one republishes to every client, so it needs the same gap `sit` has.
      const votedAt = Date.now();
      if (votedAt - (this.lastVoteAt.get(client.sessionId) ?? 0) < SIT_GAP_MS) return;
      this.lastVoteAt.set(client.sessionId, votedAt);
      if (packet.type === 'rematch') this.rematchVotes.add(seat);
      else this.rematchVotes.delete(seat);
      if (packet.type === 'rematch' && this.everyHumanVoted()) this.beginRematch();
      else this.publish();
      return;
    }

    if (packet.type === 'rematchStart') {
      // The host can start without a full house; anyone who left is botted.
      if (seat !== this.actingHostSeat() || this.table.phase !== 'MATCH_OVER') return;
      this.beginRematch();
      return;
    }

    if (packet.type === 'next') {
      // A vote, not a start: the first player to press used to deal again for
      // all four, yanking the result sheet away from three people reading it.
      if (this.table.phase !== 'DEAL_OVER') return;
      this.nextVotes.add(seat);
      if (!this.isHeld() && this.everyoneReady()) this.startNextDeal();
      else this.publish();
      return;
    }

    if (packet.type === 'emote') {
      // Fixed vocabulary + a per-seat gap; anything else is silently dropped.
      const id = (packet.message as { id?: string } | undefined)?.id;
      if (typeof id !== 'string' || !EMOTE_IDS.includes(id)) return;
      const now = Date.now();
      if (now - (this.lastEmoteAt.get(client.sessionId) ?? 0) < EMOTE_GAP_MS) return;
      this.lastEmoteAt.set(client.sessionId, now);
      if (!config().emotes) return;
      const msg: EmoteMessage = { seat, id };
      // To everyone the sender can reach (identity.ts), and to the sender.
      for (const other of this.clients) {
        const s = this.seatOf(other.sessionId);
        if (s !== null && s !== seat && !this.reaches(seat, s)) continue;
        other.send(MSG.emote, msg);
      }
      return;
    }

    if (packet.type === 'voice') {
      // Push-to-talk. Relayed to the others at the table whose apps play
      // clips, and dropped: never stored, never logged. Only where voice is
      // on, from an app that records it, and only what checkClip accepts -
      // anything else is dropped without a word, and costs nothing.
      if (!this.voiceOn || !config().voice || !this.occupants[seat]!.voice) return;
      const m = packet.message as { mime?: unknown; data?: unknown; ms?: unknown } | undefined;
      const clip = checkClip(m?.mime, m?.data, m?.ms);
      if (clip === null) return;
      let limiter = this.voiceLimits.get(client.sessionId);
      if (!limiter) this.voiceLimits.set(client.sessionId, (limiter = new VoiceLimiter()));
      if (!limiter.take(Date.now(), clip.ms)) return;
      const id = ++this.voiceSeq;
      const out: VoiceMessage = { from: seat, id, ms: clip.ms, mime: clip.mime, data: clip.data };
      const to: Seat[] = [];
      const noReceipt: Seat[] = [];
      const sessions: string[] = [];
      for (const other of this.clients) {
        const s = this.seatOf(other.sessionId);
        if (s === null || s === seat || !this.hearsVoice(s) || !this.reaches(seat, s)) continue;
        other.send(MSG.voice, out);
        to.push(s);
        sessions.push(other.sessionId);
        if (!this.occupants[s]!.receipts) noReceipt.push(s);
      }
      this.voiceLedger.sent(id, client.sessionId, sessions, Date.now());
      // The speaker hears nothing back, only that the room took it (for the
      // rings on their own puck) and whom it went to: nobody at all is said
      // at once, and which of them cannot confirm, so no app waits on them.
      const echo: VoiceMessage = { from: seat, id, ms: clip.ms, mime: clip.mime, to, ...(noReceipt.length > 0 ? { noReceipt } : {}) };
      client.send(MSG.voice, echo);
      return;
    }

    if (packet.type === 'heard') {
      // A clip has started playing at this seat. Believed only from a seat it
      // was sent to, once, and passed only to a speaker whose app reads it.
      const speakerId = this.voiceLedger.heard((packet.message as { id?: unknown } | undefined)?.id, client.sessionId, Date.now());
      if (speakerId === null) return;
      const speakerSeat = this.seatOf(speakerId);
      const speaker = this.clients.find((c) => c.sessionId === speakerId);
      if (speakerSeat === null || !speaker || !this.occupants[speakerSeat]!.receipts) return;
      const heard: VoiceHeardMessage = { id: (packet.message as { id: number }).id, by: seat };
      speaker.send(MSG.voiceHeard, heard);
      return;
    }

    if (packet.type === 'voiceIn') {
      // At a public table strangers' clips reach only the seats that asked for
      // them here. Republished (the speaker's app shows who hears), so it gets
      // the same gap a vote has.
      const o = this.occupants[seat]!;
      const on = (packet.message as { on?: unknown } | undefined)?.on;
      if (typeof on !== 'boolean') return;
      if (on && !o.speaksVoice) return;
      const at = Date.now();
      if (at - (this.lastVoiceInAt.get(client.sessionId) ?? 0) < SIT_GAP_MS) return;
      this.lastVoiceInAt.set(client.sessionId, at);
      if (o.voiceIn === on) return;
      o.voiceIn = on;
      this.publish();
      return;
    }

    if (packet.type === 'hears') {
      // Only an app that joined speaking voice may say it hears again: an old
      // one could not play what it would be sent. Nothing is published - no
      // one else's view depends on it, and a toggling client costs nothing.
      const o = this.occupants[seat]!;
      const on = (packet.message as { on?: unknown } | undefined)?.on;
      if (typeof on !== 'boolean') return;
      if (on && !o.speaksVoice) return;
      o.voice = on;
      return;
    }

    if (packet.type === 'gift') {
      // Only at a table that is playing: the lobby draws no pucks to land on,
      // and its seats still change hands.
      if (!this.started || !config().gifts) return;
      const m = packet.message as { id?: unknown; to?: unknown } | undefined;
      const id = m?.id;
      if (typeof id !== 'string' || !GIFT_IDS.includes(id)) return;
      // One other seat, or everyone else. Anything else — the sender's own
      // seat, 7, '1', 'everyone' — is dropped and does not count as a send.
      let to: Seat[];
      if (m?.to === 'table') {
        to = SEATS.filter((s) => s !== seat);
      } else if (Number.isInteger(m?.to) && (m!.to as number) >= 0 && (m!.to as number) <= 3 && m!.to !== seat) {
        to = [m!.to as Seat];
      } else {
        return;
      }
      // Nobody is sent a gift their app cannot draw (an older app): the
      // sender's device pays for exactly the seats in the echo. With nobody
      // left it is dropped, and does not count as a send.
      to = to.filter((t) => this.seesGifts(t) && this.reaches(seat, t));
      if (to.length === 0) return;
      const now = Date.now();
      if (now - (this.lastGiftAt.get(client.sessionId) ?? 0) < GIFT_GAP_MS) return;
      this.lastGiftAt.set(client.sessionId, now);
      // No coins are checked here, and none can be: there are no accounts, and
      // the sender's device pays on seeing this echo. A forged free gift gains
      // its forger nothing and costs nobody anything — the receiver is given
      // nothing but a picture beside their name.
      for (const t of to) this.gifts[t] = id;
      const msg: GiftMessage = { from: seat, to, id };
      // Broadcast only: no publish(), so a gift never re-sends views or wakes a
      // director. The badge rides along in SeatInfo on the next publish, which
      // is what a reconnecting player reads.
      this.broadcast(MSG.gift, msg);
    }
  }

  private afterMove(): void {
    // Score the series exactly once per match, however many publishes follow.
    if (this.table.phase === 'MATCH_OVER' && this.lastRecordedMatch !== this.matchNumber) {
      this.lastRecordedMatch = this.matchNumber;
      this.series[this.table.winner()!] += 1;
    }
    if (this.isHeld() || this.table.phase === 'MATCH_OVER') this.stopTimer();
    else this.armTimer();
    if (this.table.phase === 'DEAL_OVER' && !this.isHeld()) {
      // Everyone said they were ready while the table stood still: go now.
      if (this.everyoneReady()) {
        this.startNextDeal();
        return;
      }
      this.armNext();
    } else {
      this.stopNext();
    }
    this.publish();
  }

  // --- the next deal ---------------------------------------------------------

  /** Every player at the table who is on the line has said they are ready. */
  private everyoneReady(): boolean {
    const humans = SEATS.filter(
      (s) => this.occupants[s]!.sessionId !== null && this.occupants[s]!.connected && this.table.humanSeats.has(s),
    );
    return humans.length > 0 && humans.every((s) => this.nextVotes.has(s));
  }

  /** The scored deal's countdown: armed once per deal, however many publishes follow. */
  private armNext(): void {
    const deal = this.table.state.dealNumber;
    if (this.nextTimer !== null && this.nextFor === deal) return;
    // Nobody on the line: nothing to count down for, and no reason for bots
    // to play whole deals to an empty room.
    const anyone = SEATS.some((s) => this.occupants[s]!.sessionId !== null && this.occupants[s]!.connected);
    if (!anyone) {
      this.stopNext();
      return;
    }
    if (this.nextTimer !== null) clearTimeout(this.nextTimer);
    this.nextFor = deal;
    this.nextEndsAt = Date.now() + NEXT_DEAL_MS;
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      try {
        if (this.table.phase === 'DEAL_OVER' && !this.isHeld()) this.startNextDeal();
      } catch (err) {
        console.error('[bela] next-deal timer failed:', err);
      }
    }, NEXT_DEAL_MS);
  }

  private stopNext(): void {
    if (this.nextTimer !== null) clearTimeout(this.nextTimer);
    this.nextTimer = null;
    this.nextEndsAt = 0;
    this.nextFor = -1;
    if (this.table.phase !== 'DEAL_OVER') this.nextVotes.clear();
  }

  private startNextDeal(): void {
    this.stopNext();
    this.nextVotes.clear();
    this.table.startNextDeal();
    this.afterMove();
  }

  // --- pausing and waiting -----------------------------------------------------

  /** Pausing and waiting are for friends: a private table, mid-match. */
  private canHold(): boolean {
    return !this.isPublic && this.started && this.table.phase !== 'MATCH_OVER';
  }

  /** Does the table stand still for this seat's dropped connection? */
  private waitsFor(seat: Seat): boolean {
    return this.canHold() && this.table.humanSeats.has(seat);
  }

  private isHeld(): boolean {
    return this.paused !== null || this.waiting.size > 0;
  }

  /**
   * Hand a seat to its bot - now, or the moment the table may move again.
   * setSeatHuman(false) runs the bots at once, so doing it during a hold would
   * play cards while everyone was told the table was standing still.
   */
  private handToBot(seat: Seat): void {
    if (this.isHeld()) this.gaveUp.add(seat);
    else this.table.setSeatHuman(seat, false);
  }

  /** Something about the hold changed: reschedule it, and let the table move if it may. */
  private holdChanged(): void {
    this.scheduleHold();
    if (!this.isHeld() && this.gaveUp.size > 0) {
      const seats = [...this.gaveUp];
      this.gaveUp.clear();
      for (const s of seats) this.table.setSeatHuman(s, false);
    }
    this.afterMove();
  }

  /**
   * One timer for whatever ends first: the pause running out, or a wait. Waits
   * do not run out during a pause - they are checked again when it ends.
   */
  private scheduleHold(): void {
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    const ends = this.paused !== null ? [this.paused.until] : [...this.waiting.values()];
    if (ends.length === 0) return;
    const at = Math.min(...ends);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      try {
        const now = Date.now();
        if (this.paused !== null && this.paused.until <= now) this.paused = null;
        if (this.paused === null) {
          for (const [s, until] of [...this.waiting]) {
            if (until <= now) {
              this.waiting.delete(s);
              this.gaveUp.add(s);
            }
          }
        }
        this.holdChanged();
      } catch (err) {
        console.error('[bela] hold timer failed:', err);
      }
    }, Math.max(0, at - Date.now()));
  }

  private holdInfo(): HoldInfo | undefined {
    if (!this.isHeld()) return undefined;
    const now = Date.now();
    return {
      ...(this.paused !== null ? { paused: { by: this.paused.by, msLeft: Math.max(0, this.paused.until - now) } } : {}),
      waiting: [...this.waiting].map(([seat, until]) => ({ seat, msLeft: Math.max(0, until - now) })),
    };
  }

  /**
   * Who may do the host's things right now: the host, or - while the host's
   * connection is down - whoever is connected, in seat order. Their seat is
   * held for them now for a long time, and nobody else must be locked out of
   * starting, rematching or picking the clock meanwhile.
   */
  private actingHostSeat(): Seat | null {
    const host = this.hostId === null ? null : this.seatOf(this.hostId);
    if (host !== null && this.occupants[host]!.connected) return host;
    const next = SEATS.find((s) => this.occupants[s]!.sessionId !== null && this.occupants[s]!.connected);
    return next ?? host;
  }

  /** Nobody waits forever: a seat that stalls is played by its bot. */
  private armTimer(): void {
    // Nothing is on the clock until the table is actually playing.
    if (!this.started) {
      this.stopTimer();
      return;
    }
    const actor = this.table.actor();
    if (actor === null || !this.table.humanSeats.has(actor)) {
      this.stopTimer();
      return;
    }
    // The SAME DECISION is still pending: leave that clock alone. afterMove()
    // runs on every publish, including an unrelated seat's disconnect, and
    // restarting here handed the actor a fresh 30 seconds each time.
    //
    // Keyed on the decision and not the seat, because a player often gets two
    // in a row — announce and then lead, or win a trick and lead the next. On a
    // seat key those two share one 30 seconds, and after a timeout (which
    // leaves the same seat on turn) nothing arms at all and the table stops
    // dead for everybody.
    const decision = `${actor}:${this.table.moveCount}`;
    if (this.turnTimer !== null && this.turnDecision === decision) return;
    this.stopTimer();

    this.turnEndsAt = Date.now() + this.turnMs;
    this.turnSeat = actor;
    this.turnDecision = decision;
    this.turnTimer = setTimeout(() => {
      // Spend the handle FIRST: everything below re-enters armTimer, and a
      // stale non-null handle there reads as "a clock is already running".
      this.turnTimer = null;
      try {
        const seat = this.table.actor();
        // Play one move only if the turn is still where it was when we armed —
        // a disconnect may have let a bot move on, and that seat gets its own
        // clock rather than having its card played early.
        if (seat !== null && seat === this.turnSeat && this.table.humanSeats.has(seat)) {
          this.table.botMoveFor(seat);
        }
      } catch (err) {
        // A throw here would otherwise escape to the process and leave the room
        // with no clock and a human on turn — the same freeze, by another road.
        console.error('[bela] turn timer failed:', err);
      }
      // Unconditionally: a room must never be left with a human on turn and
      // nothing armed.
      this.afterMove();
    }, this.turnMs);
  }

  private stopTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnEndsAt = 0;
    this.turnSeat = null;
    this.turnDecision = null;
  }

  // --- publishing ----------------------------------------------------------

  /**
   * A seat a clip goes to: a person on the line whose app plays voice clips -
   * and, at a public table, who asked for strangers' clips here ('voiceIn'),
   * while the config allows them at all.
   */
  private hearsVoice(seat: Seat): boolean {
    const o = this.occupants[seat]!;
    return o.sessionId !== null && o.connected && o.voice && (!this.isPublic || (o.voiceIn && config().strangerClips));
  }

  /** Nothing a player sends reaches a seat across a block, in either direction (identity.ts). */
  private reaches(from: Seat, to: Seat): boolean {
    return !blocksEither(this.occupants[from]!, this.occupants[to]!);
  }

  /** Voice at this table right now: the host's switch, the config's, and (public) the stranger switch. */
  private voiceLive(): boolean {
    return this.voiceOn && config().voice && (!this.isPublic || config().strangerClips);
  }

  /** A connection gone for good: its rate limits go with it (they were never pruned). */
  private forget(sessionId: string | null): void {
    if (sessionId === null) return;
    this.lastEmoteAt.delete(sessionId);
    this.lastSitAt.delete(sessionId);
    this.lastVoteAt.delete(sessionId);
    this.lastGiftAt.delete(sessionId);
    this.voiceLimits.delete(sessionId);
    this.lastVoiceInAt.delete(sessionId);
  }

  /** A seat a gift can reach: a person whose app draws gifts, or no person at all. */
  private seesGifts(seat: Seat): boolean {
    const o = this.occupants[seat]!;
    return o.sessionId === null || o.gifts;
  }

  private seatInfo(): SeatInfo[] {
    return this.occupants.map((o, i) => ({
      seat: i as Seat,
      name: o.name || `Igrač ${i + 1}`,
      avatar: o.avatar,
      connected: o.connected,
      bot: !this.table.humanSeats.has(i as Seat),
      ...(this.gifts[i] ? { gift: this.gifts[i]! } : {}),
      ...(this.seesGifts(i as Seat) ? { seesGifts: true as const } : {}),
      // The one thing about a seat an app can block or report by (identity.ts).
      ...(o.sessionId !== null && o.installId !== '' ? { installId: o.installId } : {}),
      // Whom a clip reaches: at a public table only a seat that opted in, while strangers' clips are allowed at all.
      ...(o.sessionId !== null && o.voice && (!this.isPublic || (o.voiceIn && config().strangerClips)) ? { hearsVoice: true as const } : {}),
    }));
  }

  /**
   * Send each client its own view, and broadcast the (public) event stream.
   * Events are drained ONCE and shared; views are per seat.
   */
  private publish(): void {
    const votes = [...this.rematchVotes].filter(
      (s) => this.occupants[s]!.sessionId !== null && this.occupants[s]!.connected,
    );
    // `declarationSkipped` is only ever emitted for a seat that HAD something to
    // declare — completeDeal settles the empty-handed ones silently — so
    // broadcasting it tells the table exactly what staying quiet is meant to
    // hide. Nothing renders it (the CLI returns null for it by design), so it
    // simply does not go on the wire.
    const events = this.table.drainEvents().filter((e) => e.kind !== 'declarationSkipped');
    const room: RoomMessage = {
      seats: this.seatInfo(),
      status:
        this.table.phase === 'MATCH_OVER'
          ? 'finished'
          : this.started
            ? 'playing'
            : 'waiting',
      events,
      ...(this.turnEndsAt > 0
        ? { turnMsLeft: Math.max(0, this.turnEndsAt - Date.now()), turnTotalMs: this.turnMs }
        : {}),
      turnSeconds: this.turnMs / 1000,
      target: this.target,
      ...(this.isPublic ? {} : { private: true as const }),
      ...(this.voiceLive() ? { voice: true as const } : {}),
      ...(this.voiceLive() && this.isPublic ? { voiceOptIn: true as const } : {}),
      ...(this.isHeld() ? { hold: this.holdInfo()! } : {}),
      ...(this.nextEndsAt > 0 ? { nextMsLeft: Math.max(0, this.nextEndsAt - Date.now()) } : {}),
      ...(this.table.phase === 'DEAL_OVER' && this.nextVotes.size > 0 ? { nextVotes: [...this.nextVotes] } : {}),
      mode: this.mode,
      // Older apps read only this: blind zvanja for them too.
      ...(this.mode !== 'learn' ? { hard: true } : {}),
      series: [this.series[0], this.series[1]],
      matchNumber: this.matchNumber,
      // Only votes from people still on the line: a dropped player's vote left
      // the client's outstanding count pinned at 0, so it hid both "Play again"
      // and "Start anyway" while a real non-voter was still sitting there.
      ...(votes.length > 0 ? { rematchVotes: votes } : {}),
      // Whoever may do the host's things right now, so the right person sees
      // "start" and "start anyway" while the host is off the line.
      ...(this.actingHostSeat() !== null ? { hostSeat: this.actingHostSeat()! } : {}),
    };
    // Views first: a client must know its own seat before the event stream
    // arrives, or the first batch cannot be attributed to anyone.
    for (const client of this.clients) {
      const seat = this.seatOf(client.sessionId);
      if (seat === null) continue;
      const view = this.table.view(seat);
      // The deck is dealt when the room is created, but seats are still being
      // chosen — so a client could walk the free seats and read three quarters
      // of the deck before anybody else arrived. The waiting room draws no
      // cards, so withholding them until the table locks costs nothing.
      client.send(MSG.view, {
        seat,
        view: this.started ? view : { ...view, hand: [], myDeclarations: [], legalActions: [] },
      });
    }
    this.broadcast(MSG.room, room);
  }

  override onDispose(): void {
    liveCodes.delete(this.roomId);
    this.stopTimer();
    this.stopNext();
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }
}
