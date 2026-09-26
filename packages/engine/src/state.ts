import type {
  Action,
  Card,
  Declaration,
  DealProgress,
  DeclarationSummary,
  EngineConfig,
  Phase,
  PlayContext,
  PublicView,
  Seat,
  Suit,
  TeamId,
  TrickPlay,
  BidRecord,
  TrickRecord
} from '@belot/shared-types';
import { DEFAULT_CONFIG, SEATS, SUITS } from '@belot/shared-types';
import {
  cardEquals,
  cardId,
  hasCard,
  makeDeck,
  makeRng,
  removeCard,
  shuffle,
  type Rng,
} from './cards';
import { CARD_POINTS_TOTAL } from './power';
import { legalPlays } from './legality';
import { detectDeclarations, resolveDeclarations } from './declarations';
import { computeDealProgress, scoreDeal, type DealScoreResult, type DealTrick } from './scoring';
import { trickWinnerIndex } from './compare';

/**
 * Who leads trick 1 of this deal: the dealer's right-hand neighbour (play runs
 * counter-clockwise). Used both for scoring's zvanja tie-break and for the live
 * progress readout — two copies of `(dealer + 1) % 4` would drift.
 */
function dealFirstLeader(s: GameState): Seat {
  return ((s.dealer + 1) % 4) as Seat;
}

/** Partners sit across: team 0 = seats {0,2}, team 1 = seats {1,3}. */
export function teamOf(seat: Seat): TeamId {
  return (seat % 2) as TeamId;
}

/**
 * The full authoritative game state. Held by the Colyseus room on the server and
 * by the offline app on device. `rng` is the only non-serializable field — the
 * server keeps it private and never ships it to clients (see `publicView`).
 */
export interface GameState {
  config: EngineConfig;
  rng: Rng;

  phase: Phase;
  dealer: Seat;
  dealNumber: number;
  matchScores: [number, number];

  /** Hidden information. Never send another seat's hand over the wire. */
  hands: Card[][];
  /** Undealt cards held between the 6-card deal and COMPLETE_DEAL. */
  stock: Card[];
  context: PlayContext;

  // bidding
  bidTurn: Seat;
  passCount: number;
  /** Every answer so far this deal, in order - public, for PublicView.history. */
  bidLog: BidRecord[];

  // doubling
  callerSeat: Seat | null;
  multiplier: 1 | 2 | 4;
  doubleStage: 'KONTRA' | 'REKONTRA' | null;
  doubleTurn: Seat | null;
  /** Seats still owed a kontra/rekontra opportunity at the current stage. */
  doubleQueue: Seat[];

  // play
  /** What each seat COULD announce. Hidden information — never send this to a client. */
  availableDeclarations: Declaration[][];
  /** What each seat actually announced. Only these enter the contest and score. */
  announcedDeclarations: Declaration[][];
  /** Per seat: has its trick-1 announce-or-skip decision been settled? */
  declared: boolean[];
  /**
   * Whose turn it is to answer "ima zvanja?". Non-null only during the zvanja
   * round, which sits between the talon and the opening lead.
   */
  declareTurn: Seat | null;
  /** The winning side's combinations, face up once the round closes. */
  revealedDeclarations: Declaration[];
  declarationWinner: TeamId | null;
  /** Who was DEALT the trump K+Q. Hidden information — never send this to a client. */
  belaHolderSeat: Seat | null;
  /** Who actually called bela. Only this scores; public once called. */
  belaAnnouncedSeat: Seat | null;
  trickLeader: Seat | null;
  turn: Seat | null;
  currentTrick: TrickPlay[];
  completedTricks: DealTrick[];

  lastDealResult: DealScoreResult | null;
}

export interface CreateMatchOptions {
  config?: Partial<EngineConfig>;
  /**
   * Seed the deterministic RNG. Reproducible, and therefore RECOVERABLE: the
   * generator's state is 32 bits, so a whole match's deal is a function of a
   * number an opponent who sees six cards can search for. Fine for the CLI,
   * offline play and tests, where the dealer and the player are the same
   * device. NOT fine for an authoritative server — pass `rng` there.
   */
  seed?: number;
  /**
   * The shuffle generator itself, superseding `seed`. A server passes one
   * backed by crypto so there is no seed to recover in the first place.
   */
  rng?: Rng;
  dealer?: Seat;
}

export function createMatch(opts: CreateMatchOptions = {}): GameState {
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const seed = opts.seed ?? 0x1234abcd;
  return {
    config,
    rng: opts.rng ?? makeRng(seed),
    phase: 'IDLE',
    dealer: opts.dealer ?? 0,
    dealNumber: 0,
    matchScores: [0, 0],
    hands: [[], [], [], []],
    stock: [],
    context: { contractType: 'SUIT', trumpSuit: null },
    bidTurn: 0,
    passCount: 0,
    bidLog: [],
    callerSeat: null,
    multiplier: 1,
    doubleStage: null,
    doubleTurn: null,
    doubleQueue: [],
    availableDeclarations: [[], [], [], []],
    announcedDeclarations: [[], [], [], []],
    declared: [false, false, false, false],
    declareTurn: null,
    revealedDeclarations: [],
    declarationWinner: null,
    belaHolderSeat: null,
    belaAnnouncedSeat: null,
    trickLeader: null,
    turn: null,
    currentTrick: [],
    completedTricks: [],
    lastDealResult: null,
  };
}

// Clone everything except the (stateful, non-cloneable) rng and the (immutable) config.
function cloneState(s: GameState): GameState {
  const { rng, config, ...rest } = s;
  const copy = structuredClone(rest) as Omit<GameState, 'rng' | 'config'>;
  return { ...copy, rng, config };
}

function expectPhase(s: GameState, p: Phase): void {
  if (s.phase !== p) throw new Error(`expected phase ${p}, got ${s.phase}`);
}

function expectSeat(actual: Seat, expected: Seat | null): void {
  if (expected === null || actual !== expected) {
    throw new Error(`seat ${actual} acted out of turn (expected ${String(expected)})`);
  }
}

/** Deal 6 cards each and open the bidding. Call from IDLE or DEAL_OVER. */
export function startDeal(prev: GameState): GameState {
  if (prev.phase !== 'IDLE' && prev.phase !== 'DEAL_OVER') {
    throw new Error(`cannot startDeal from phase ${prev.phase}`);
  }
  const s = cloneState(prev);
  const deck = shuffle(makeDeck(), s.rng);

  s.hands = [[], [], [], []];
  let idx = 0;
  for (let r = 0; r < 6; r++) {
    for (let off = 0; off < 4; off++) {
      const seat = ((s.dealer + 1 + off) % 4) as Seat;
      s.hands[seat]!.push(deck[idx++]!);
    }
  }
  s.stock = deck.slice(idx); // 8 cards for COMPLETE_DEAL

  s.context = { contractType: 'SUIT', trumpSuit: null };
  s.callerSeat = null;
  s.multiplier = 1;
  s.doubleStage = null;
  s.doubleTurn = null;
  s.doubleQueue = [];
  s.availableDeclarations = [[], [], [], []];
  s.announcedDeclarations = [[], [], [], []];
  s.declared = [false, false, false, false];
  s.declareTurn = null;
  s.revealedDeclarations = [];
  s.declarationWinner = null;
  s.belaHolderSeat = null;
  s.belaAnnouncedSeat = null;
  s.trickLeader = null;
  s.turn = null;
  s.currentTrick = [];
  s.completedTricks = [];
  s.bidLog = [];
  s.lastDealResult = null;

  s.phase = 'BID';
  s.bidTurn = ((s.dealer + 1) % 4) as Seat;
  s.passCount = 0;
  return s;
}

export function currentActor(s: GameState): Seat | null {
  switch (s.phase) {
    case 'BID':
      return s.bidTurn;
    case 'DOUBLE':
      return s.doubleTurn;
    case 'PLAY':
      // The zvanja round runs inside PLAY rather than as a phase of its own: a
      // new phase falls through every `default` in this file, which would leave
      // the table with nobody on turn and the server's clock stopped.
      return s.declareTurn ?? s.turn;
    default:
      return null;
  }
}

export function legalActions(s: GameState): Action[] {
  switch (s.phase) {
    case 'BID': {
      const seat = s.bidTurn;
      const acts: Action[] = [];
      const dealerForced = s.config.dealerMustCall && seat === s.dealer && s.passCount === 3;
      if (!dealerForced) acts.push({ type: 'BID_PASS', seat });
      for (const suit of SUITS) acts.push({ type: 'BID_CALL', seat, suit });
      return acts;
    }
    case 'DOUBLE': {
      const seat = s.doubleTurn!;
      if (s.doubleStage === 'KONTRA') {
        return [
          { type: 'DOUBLE_KONTRA', seat },
          { type: 'DOUBLE_PASS', seat },
        ];
      }
      if (s.doubleStage === 'REKONTRA') {
        return [
          { type: 'DOUBLE_REKONTRA', seat },
          { type: 'DOUBLE_PASS', seat },
        ];
      }
      return [];
    }
    case 'PLAY': {
      // Nobody plays a card until the asking is done.
      if (s.declareTurn !== null) {
        const asked = s.declareTurn;
        if (s.config.declarationMode === 'blind') {
          // Blind mode: the offer is unconditional and UNSPECIFIED. Enumerating
          // the markings would hand the seat the very thing the mode withholds,
          // so this is a template — send any marking and the engine judges it.
          return [
            { type: 'DECLARE_ANNOUNCE', seat: asked },
            { type: 'DECLARE_SKIP', seat: asked },
          ];
        }
        // Otherwise every marking the seat could legitimately make is spelled
        // out, so the legal set is fully specified like any other. No leak: the
        // seat's own zvanja are already in its view.
        return [
          ...s.availableDeclarations[asked]!.map(
            (d): Action => ({ type: 'DECLARE_ANNOUNCE', seat: asked, cards: d.cards.slice() }),
          ),
          { type: 'DECLARE_SKIP', seat: asked },
        ];
      }
      const seat = s.turn!;
      const blind = s.config.declarationMode === 'blind';
      const acts: Action[] = legalPlays({
        hand: s.hands[seat]!,
        trick: s.currentTrick,
        mySeat: seat,
        ctx: s.context,
        forcedOvertrumpOverPartner: s.config.forcedOvertrumpOverPartner,
      }).flatMap((card): Action[] => {
        const play: Action = { type: 'PLAY_CARD', seat, card };
        // Where bela is available, playing the card silently and calling it are
        // two genuinely different moves, so both are offered. In blind mode the
        // option appears on ANY trump K/Q — offering it only with the pair in
        // hand would leak exactly the information hard mode hides.
        const offerBela = blind ? couldTryBelaWith(s, card) : canAnnounceBelaWith(s, seat, card);
        return offerBela ? [play, { type: 'PLAY_CARD', seat, card, announceBela: true }] : [play];
      });
      return acts;
    }
    default:
      return [];
  }
}

export function applyAction(prev: GameState, action: Action): GameState {
  const s = cloneState(prev);
  switch (action.type) {
    case 'BID_PASS':
      return applyBidPass(s, action.seat);
    case 'BID_CALL':
      return applyBidCall(s, action.seat, action.suit);
    case 'DOUBLE_KONTRA':
    case 'DOUBLE_REKONTRA':
    case 'DOUBLE_PASS':
      return applyDouble(s, action.type, action.seat);
    case 'DECLARE_ANNOUNCE':
      return applyDeclare(s, action.type, action.seat, action.cards);
    case 'DECLARE_SKIP':
      return applyDeclare(s, action.type, action.seat);
    case 'PLAY_CARD':
      return applyPlay(s, action.seat, action.card, action.announceBela === true);
    default:
      // The union makes this unreachable to a caller that typechecks, but the
      // server takes actions off a socket. Without this the switch falls off the
      // end and returns undefined — and the caller commits that as the new
      // state, which is a far worse failure than a rejected message.
      throw new Error(`unknown action type ${String((action as { type: unknown }).type)}`);
  }
}

function applyBidPass(s: GameState, seat: Seat): GameState {
  expectPhase(s, 'BID');
  expectSeat(seat, s.bidTurn);
  const dealerForced = s.config.dealerMustCall && seat === s.dealer && s.passCount === 3;
  if (dealerForced) throw new Error('dealer is forced to call (muss)');
  s.passCount += 1;
  s.bidLog.push({ seat, suit: null });
  s.bidTurn = ((seat + 1) % 4) as Seat;
  if (s.passCount === 4) {
    // Only reachable when dealerMustCall is off. Nobody wants it: the deal is
    // void and passes on, so the dealer rotates just as at a real table.
    s.phase = 'DEAL_OVER';
    s.dealer = ((s.dealer + 1) % 4) as Seat;
    return startDeal(s);
  }
  return s;
}

function applyBidCall(s: GameState, seat: Seat, suit: Suit): GameState {
  expectPhase(s, 'BID');
  expectSeat(seat, s.bidTurn);
  // The TYPE being known says nothing about the VALUE. This goes straight into
  // authoritative state and then onto every wire, so an unchecked `suit` let a
  // single socket frame name a trump that does not exist — 32 card points
  // vanish from the deal — or park an arbitrary object in the state that
  // nothing downstream can clone or serialise.
  if (!SUITS.includes(suit)) throw new Error(`unknown suit ${String(suit)}`);
  s.bidLog.push({ seat, suit });
  s.context = { contractType: 'SUIT', trumpSuit: suit };
  s.callerSeat = seat;
  s.multiplier = 1;

  // Tables that do not play kontra go straight from the call to the cards.
  if (!s.config.allowKontra) {
    s.doubleStage = null;
    s.doubleTurn = null;
    s.doubleQueue = [];
    return completeDeal(s);
  }

  s.phase = 'DOUBLE';
  // Both defenders get a chance to kontra, in seat order after the caller.
  s.doubleStage = 'KONTRA';
  s.doubleQueue = [((seat + 1) % 4) as Seat, ((seat + 3) % 4) as Seat];
  return advanceDoubleQueue(s);
}

/** Pop the next seat owed a doubling decision; if none remain, deal the last 2 cards. */
function advanceDoubleQueue(s: GameState): GameState {
  const next = s.doubleQueue.shift();
  if (next === undefined) {
    s.doubleTurn = null;
    s.doubleStage = null;
    return completeDeal(s);
  }
  s.doubleTurn = next;
  return s;
}

function applyDouble(
  s: GameState,
  type: 'DOUBLE_KONTRA' | 'DOUBLE_REKONTRA' | 'DOUBLE_PASS',
  seat: Seat,
): GameState {
  expectPhase(s, 'DOUBLE');
  expectSeat(seat, s.doubleTurn);

  if (type === 'DOUBLE_PASS') return advanceDoubleQueue(s);

  if (type === 'DOUBLE_KONTRA') {
    if (s.doubleStage !== 'KONTRA') throw new Error('kontra not available');
    s.multiplier = 2;
    // The calling team may now answer with rekontra.
    s.doubleStage = 'REKONTRA';
    const caller = s.callerSeat!;
    s.doubleQueue = [caller, ((caller + 2) % 4) as Seat];
    return advanceDoubleQueue(s);
  }

  // DOUBLE_REKONTRA
  if (s.doubleStage !== 'REKONTRA') throw new Error('rekontra not available');
  s.multiplier = 4;
  s.doubleQueue = [];
  return advanceDoubleQueue(s);
}

function completeDeal(s: GameState): GameState {
  let idx = 0;
  for (let r = 0; r < 2; r++) {
    for (let off = 0; off < 4; off++) {
      const seat = ((s.dealer + 1 + off) % 4) as Seat;
      s.hands[seat]!.push(s.stock[idx++]!);
    }
  }
  s.stock = [];

  // What each seat holds is fixed by the completed 8-card hands; what each seat
  // SCORES depends on whether it speaks up when asked, before the opening lead.
  s.availableDeclarations = SEATS.map((seat) => detectDeclarations(s.hands[seat]!, seat));
  if (s.config.declarationMode === 'auto') {
    s.announcedDeclarations = s.availableDeclarations.map((d) => d.slice());
    s.declared = [true, true, true, true];
  } else {
    s.announcedDeclarations = [[], [], [], []];
    // EVERY seat answers, holdings or not. Skipping the empty-handed would be
    // quicker, but being asked at all would then mean "this seat holds zvanja",
    // which is precisely what the round is supposed to keep private until spoken.
    s.declared = [false, false, false, false];
  }

  s.belaHolderSeat = detectBelaSeat(s.hands, s.context);
  // Under 'auto' the pair pays out on sight; under 'announce' it pays only if called.
  s.belaAnnouncedSeat = s.config.belaMode === 'auto' ? s.belaHolderSeat : null;
  s.phase = 'PLAY';
  s.trickLeader = ((s.dealer + 1) % 4) as Seat;
  s.turn = s.trickLeader;
  s.currentTrick = [];
  s.completedTricks = [];
  // The asking starts with the seat that bid first and will lead — the same seat
  // the tie-break favours, so the round runs in the order the rule assumes.
  s.declareTurn = s.config.declarationMode === 'auto' ? null : s.trickLeader;
  if (s.declareTurn === null) closeDeclarationRound(s);
  return s;
}

/**
 * The round is over: resolve the contest and lay the winning side's cards out.
 *
 * The losing side's combinations stay in hand. They said their number out loud
 * and that much is public, but their CARDS are not — showing them would give the
 * table a quarter of the remaining hand to play against.
 */
function closeDeclarationRound(s: GameState): void {
  s.declareTurn = null;
  const resolved = resolveDeclarations(
    s.announcedDeclarations,
    teamOf,
    s.config,
    dealFirstLeader(s),
  );
  s.declarationWinner = resolved.winningTeam;
  s.revealedDeclarations = resolved.winningDeclarations.slice();
  s.turn = s.trickLeader;
}

function detectBelaSeat(hands: Card[][], ctx: PlayContext): Seat | null {
  if (ctx.contractType !== 'SUIT' || ctx.trumpSuit === null) return null;
  for (const seat of SEATS) {
    const h = hands[seat]!;
    const hasK = h.some((c) => c.suit === ctx.trumpSuit && c.rank === 'K');
    const hasQ = h.some((c) => c.suit === ctx.trumpSuit && c.rank === 'Q');
    if (hasK && hasQ) return seat;
  }
  return null;
}

/**
 * Does this seat still owe an announce-or-skip call? Only during trick 1, only
 * under 'announce' mode, and only for a seat that actually holds something.
 */
/**
 * Does the marked selection actually form one of this seat's zvanja?
 *
 * The player points at cards; the engine is the judge. A selection that is not a
 * real combination can never be talked up into one, which is what makes marking
 * safe to accept from a client at all.
 */
function matchesHeldDeclaration(s: GameState, seat: Seat, picked: Card[]): boolean {
  const want = picked.map(cardId).sort().join('|');
  return s.availableDeclarations[seat]!.some(
    (d) => d.cards.map(cardId).sort().join('|') === want,
  );
}

function applyDeclare(
  s: GameState,
  type: 'DECLARE_ANNOUNCE' | 'DECLARE_SKIP',
  seat: Seat,
  picked?: Card[],
): GameState {
  expectPhase(s, 'PLAY');
  if (s.declareTurn === null) throw new Error('the zvanja round is over');
  expectSeat(seat, s.declareTurn);

  s.declared[seat] = true;
  if (type === 'DECLARE_ANNOUNCE') {
    // Marking cards is how a player claims, so the marking is what gets checked.
    // A pick that is not a real combination announces nothing — in blind mode
    // that is a legal, slightly embarrassing miss, exactly as at a real table;
    // in announce mode the client had the list and has no excuse.
    // Blind mode is the mode where the app refuses to spot zvanja for you, so
    // the marking IS the claim: no marking means nothing was spotted. Treating a
    // missing one as valid made the check opt-in and handed a perfect claim to
    // anyone who simply omitted it — including the turn-timeout bot, which made
    // saying nothing strictly better than answering.
    const blind = s.config.declarationMode === 'blind';
    const valid = picked === undefined ? !blind : matchesHeldDeclaration(s, seat, picked);
    if (!valid && !blind) {
      throw new Error('those cards are not a zvanje');
    }
    if (valid) {
      // What is announced is the whole holding, not just the marked combination:
      // the side that wins the contest scores every zvanje both partners hold.
      // The engine never lets a claim overstate the hand.
      s.announcedDeclarations[seat] = s.availableDeclarations[seat]!.slice();
    }
  }

  // Round the table, in the order the tie-break assumes.
  const next = ((seat + 1) % 4) as Seat;
  s.declareTurn = next === s.trickLeader ? null : next;
  if (s.declareTurn === null) closeDeclarationRound(s);
  return s;
}

/**
 * May this seat call bela while playing this card? Requires the trump K or Q, and
 * that BOTH are still in hand — which is exactly what makes this the first of the
 * pair. After the first one leaves, this can never be true again.
 */
function canAnnounceBelaWith(s: GameState, seat: Seat, card: Card): boolean {
  if (s.config.belaMode !== 'announce') return false;
  if (s.belaAnnouncedSeat !== null) return false;
  const trump = s.context.trumpSuit;
  if (s.context.contractType !== 'SUIT' || trump === null) return false;
  if (card.suit !== trump || (card.rank !== 'K' && card.rank !== 'Q')) return false;
  const hand = s.hands[seat]!;
  return (
    hand.some((c) => c.suit === trump && c.rank === 'K') &&
    hand.some((c) => c.suit === trump && c.rank === 'Q')
  );
}

/**
 * Blind-mode counterpart of `canAnnounceBelaWith`: may the player TRY to call
 * bela on this card? True for any trump K/Q while bela is still uncalled —
 * deliberately ignoring whether the pair is actually in hand, so the option's
 * presence never leaks what hard mode is hiding.
 */
function couldTryBelaWith(s: GameState, card: Card): boolean {
  if (s.config.belaMode !== 'announce') return false;
  if (s.belaAnnouncedSeat !== null) return false;
  const trump = s.context.trumpSuit;
  if (s.context.contractType !== 'SUIT' || trump === null) return false;
  return card.suit === trump && (card.rank === 'K' || card.rank === 'Q');
}

function applyPlay(s: GameState, seat: Seat, card: Card, announceBela: boolean): GameState {
  expectPhase(s, 'PLAY');
  expectSeat(seat, s.turn);
  if (s.declareTurn !== null) {
    throw new Error('the table is still being asked about zvanja');
  }
  // The cards were laid out and are now picked up again: once the first card of
  // the deal is led, they stop crossing the wire. Remembering them is the
  // player's job, and leaving them in the view let a reconnect — or a deliberate
  // drop — put them back on screen mid-deal. Scoring reads announcedDeclarations,
  // so nothing downstream needs them after this point.
  if (s.completedTricks.length === 0 && s.currentTrick.length === 0) {
    s.revealedDeclarations = [];
  }
  const blind = s.config.declarationMode === 'blind';
  // Blind mode: playing your first card without claiming forfeits your zvanja.
  if (blind && s.completedTricks.length === 0) s.declared[seat] = true;

  const hand = s.hands[seat]!;
  if (!hasCard(hand, card)) throw new Error(`card ${cardId(card)} not in hand`);
  const legal = legalPlays({
    hand,
    trick: s.currentTrick,
    mySeat: seat,
    ctx: s.context,
    forcedOvertrumpOverPartner: s.config.forcedOvertrumpOverPartner,
  });
  if (!legal.some((c) => cardEquals(c, card))) {
    if (s.config.renonsMode === 'punish') {
      // Renons ("auzmeš"): the wrong card hits the felt and the deal is over —
      // the opponents write the whole table. hr.wikipedia: "protivnicima pišu
      // se 162 boda + sva zvanja koja su bila zvana u tom dijeljenju."
      s.hands[seat] = removeCard(hand, card);
      s.currentTrick.push({ seat, card });
      return applyRenons(s, seat);
    }
    throw new Error(`illegal play ${cardId(card)}`);
  }

  if (announceBela) {
    if (!canAnnounceBelaWith(s, seat, card)) {
      // In blind mode a false bela call is simply ignored — the table checks
      // your hand and nothing scores. Elsewhere it is a client bug: fail loud.
      if (!blind) throw new Error(`cannot call bela on ${cardId(card)}`);
    } else {
      s.belaAnnouncedSeat = seat;
    }
  }

  s.hands[seat] = removeCard(hand, card);
  s.currentTrick.push({ seat, card });

  if (s.currentTrick.length < 4) {
    s.turn = ((seat + 1) % 4) as Seat;
    return s;
  }

  const localWin = trickWinnerIndex(
    s.currentTrick.map((p) => p.card),
    s.context,
  );
  const winnerSeat = s.currentTrick[localWin]!.seat;
  s.completedTricks.push({ winnerSeat, cards: s.currentTrick.map((p) => p.card) });
  s.currentTrick = [];
  s.trickLeader = winnerSeat;
  s.turn = winnerSeat;

  if (s.completedTricks.length === 8) return scoreCurrentDeal(s);
  return s;
}

function scoreCurrentDeal(s: GameState): GameState {
  // Only what was actually announced enters the contest; silence forfeits.
  // Ties resolve to whoever is first in play order from the deal's first leader
  // (UHDDR rule 7, "prvi na štihu"), unless the cancel house rule is on.
  const resolution = resolveDeclarations(
    s.announcedDeclarations,
    teamOf,
    s.config,
    dealFirstLeader(s),
  );
  // Only a called bela scores; an uncalled pair is forfeited exactly like zvanja.
  const belaTeam = s.belaAnnouncedSeat === null ? null : teamOf(s.belaAnnouncedSeat);
  const result = scoreDeal({
    ctx: s.context,
    tricks: s.completedTricks,
    teamOf,
    callerTeam: teamOf(s.callerSeat!),
    multiplier: s.multiplier,
    declarations: resolution,
    belaTeam,
    config: s.config,
  });
  return finishDeal(s, result);
}

/**
 * Renons ("auzmeš"): an illegal play accepted under renonsMode 'punish'. The
 * deal ends on the spot; the offender's opponents score all 162 card points
 * plus EVERY zvanje announced this deal, no matter who announced it, plus an
 * announced bela. No multipliers — the rulebooks state the flat table.
 */
/**
 * Could a bela still be called, and so still move the target?
 *
 * Public information by construction: a bela needs the trump king AND queen in
 * one hand, so once both have been played nobody can call one. Counting the
 * played cards says so without looking at anybody's hand.
 */
function belaStillOpen(s: GameState): boolean {
  if (s.config.belaMode !== 'announce' || s.belaAnnouncedSeat !== null) return false;
  const trump = s.context.trumpSuit;
  if (trump === null) return false;
  // ONE is enough to end it: announcing requires holding the king AND the queen
  // (canAnnounceBelaWith), so the moment either is on the table nobody can.
  for (const t of s.completedTricks) {
    for (const c of t.cards) {
      if (c.suit === trump && (c.rank === 'K' || c.rank === 'Q')) return false;
    }
  }
  for (const p of s.currentTrick) {
    if (p.card.suit === trump && (p.card.rank === 'K' || p.card.rank === 'Q')) return false;
  }
  return true;
}

function applyRenons(s: GameState, offender: Seat): GameState {
  const offTeam = teamOf(offender);
  const defTeam = (1 - offTeam) as TeamId;
  const zvanjaTotal = s.announcedDeclarations.flat().reduce((t, d) => t + d.value, 0);
  const belaTotal = s.belaAnnouncedSeat !== null ? 20 : 0;

  const cardPoints: [number, number] = [0, 0];
  const trickPoints: [number, number] = [0, 0];
  const declarationPoints: [number, number] = [0, 0];
  const bela: [number, number] = [0, 0];
  const finalScore: [number, number] = [0, 0];
  // The card points are genuinely constant, but the TABLE is 152 + the
  // configured last-trick bonus. Hardcoding 162 pays the wrong total the moment
  // that bonus becomes a house rule, and breaks the trickPoints invariant every
  // other scoring path maintains.
  const table = CARD_POINTS_TOTAL + s.config.lastTrickBonus;
  cardPoints[defTeam] = CARD_POINTS_TOTAL;
  trickPoints[defTeam] = table;
  declarationPoints[defTeam] = zvanjaTotal;
  bela[defTeam] = belaTotal;
  finalScore[defTeam] = table + zvanjaTotal + belaTotal;

  const result: DealScoreResult = {
    cardPoints,
    trickPoints,
    // A renons ends the deal early; the defenders are credited the whole table,
    // so they are the side that "took" it for the purpose of the sheet.
    tricksWon: defTeam === 0 ? [8, 0] : [0, 8],
    valatTeam: null,
    valatBonus: [0, 0],
    declarationPoints,
    bela,
    rawTotal: [finalScore[0], finalScore[1]],
    callerMade: teamOf(s.callerSeat!) === defTeam,
    finalScore,
    renonsSeat: offender,
  };
  return finishDeal(s, result);
}

function finishDeal(s: GameState, result: DealScoreResult): GameState {
  s.matchScores = [
    s.matchScores[0] + result.finalScore[0],
    s.matchScores[1] + result.finalScore[1],
  ];
  s.lastDealResult = result;
  s.dealNumber += 1;
  s.turn = null;
  s.currentTrick = [];
  s.dealer = ((s.dealer + 1) % 4) as Seat;

  // First team past the target wins. If both cross on the same deal the higher
  // total takes it; an exact tie is unresolved, so the match plays on.
  const target = s.config.matchTarget;
  const reached = s.matchScores[0] >= target || s.matchScores[1] >= target;
  const tied = s.matchScores[0] === s.matchScores[1];
  s.phase = reached && !tied ? 'MATCH_OVER' : 'DEAL_OVER';
  return s;
}

export function matchWinner(s: GameState): TeamId | null {
  if (s.phase !== 'MATCH_OVER') return null;
  return s.matchScores[0] > s.matchScores[1] ? 0 : 1;
}

/** Redacted, hidden-hand-safe view for a single seat (what crosses the wire). */
export function publicView(s: GameState, seat: Seat): PublicView {
  const toAct = currentActor(s);
  return {
    phase: s.phase,
    dealer: s.dealer,
    seat,
    hand: s.hands[seat]!.slice(),
    handCounts: [
      s.hands[0]!.length,
      s.hands[1]!.length,
      s.hands[2]!.length,
      s.hands[3]!.length,
    ],
    context: s.context,
    callerSeat: s.callerSeat,
    multiplier: s.multiplier,
    trickLeader: s.trickLeader,
    currentTrick: s.currentTrick.slice(),
    toAct,
    matchScores: [s.matchScores[0], s.matchScores[1]],
    // Public summaries only: what the table has HEARD, never the cards behind it.
    announcedDeclarations: s.announcedDeclarations.flat().map(summarize),
    // The seat's own zvanja; their cards are already in `hand`, so this leaks
    // nothing — EXCEPT in blind (hard) mode, where spotting them is the game.
    myDeclarations:
      s.config.declarationMode === 'blind' ? [] : s.availableDeclarations[seat]!.slice(),
    declareTurn: s.declareTurn,
    // Only the winning side's cards, and only once the asking is over.
    revealedDeclarations: s.revealedDeclarations.slice(),
    // It is this seat's turn to answer "ima zvanja?", and it has something.
    mustDeclare:
      s.declareTurn === seat &&
      s.config.declarationMode !== 'blind' &&
      s.availableDeclarations[seat]!.length > 0,
    // Blind mode: your turn to answer, and the app will not tell you what you hold.
    canDeclare: s.config.declarationMode === 'blind' && s.declareTurn === seat,
    canAnnounceBela:
      toAct === seat &&
      s.phase === 'PLAY' &&
      s.declareTurn === null &&
      legalActions(s).some((a) => a.type === 'PLAY_CARD' && a.announceBela === true),
    belaAnnouncedBy: s.belaAnnouncedSeat,
    // Public by construction: won tricks, heard announcements and a called bela
    // are things everyone at the table already knows.
    dealProgress: s.phase === 'PLAY' && s.callerSeat !== null ? progressOf(s) : null,
    // The deal so far, with seats: the bids as answered, the finished tricks.
    history: { bids: s.bidLog.slice(), tricks: trickRecords(s) },
    legalActions: toAct === seat ? legalActions(s) : [],
  };
}

/**
 * The finished tricks with the seat behind every card. Nothing is stored for
 * it: the first leader of a deal is public (the seat after the dealer, who
 * also bid first), every later trick is led by the previous winner, and a
 * trick's cards are in play order from its leader.
 */
function trickRecords(s: GameState): TrickRecord[] {
  // The seat after the dealer opened the bidding and leads the first trick. Read
  // off the bid log rather than the dealer: the dealer has already moved on by
  // the time a scored deal is looked at.
  let leader: Seat = s.bidLog[0]?.seat ?? dealFirstLeader(s);
  return s.completedTricks.map((t) => {
    const plays = t.cards.map((card, i) => ({ seat: ((leader + i) % 4) as Seat, card }));
    const rec: TrickRecord = { leader, winner: t.winnerSeat, plays };
    leader = t.winnerSeat;
    return rec;
  });
}

/** The live running score, derived from what the whole table can already see. */
function progressOf(s: GameState): DealProgress {
  return computeDealProgress({
    ctx: s.context,
    tricks: s.completedTricks,
    teamOf,
    callerTeam: teamOf(s.callerSeat!),
    multiplier: s.multiplier,
    declarations: resolveDeclarations(
      s.announcedDeclarations,
      teamOf,
      s.config,
      dealFirstLeader(s),
    ),
    belaTeam: s.belaAnnouncedSeat === null ? null : teamOf(s.belaAnnouncedSeat),
    config: s.config,
    // Trick 1 is still open and somebody may yet announce, so the target can
    // move. Derived from PUBLIC state ONLY: the obvious test
    // — `s.declared.some((d) => !d)` — reads an array that completeDeal
    // pre-settles from each seat's HOLDINGS, so publishing it told the whole
    // table whether anybody held zvanja. This over-approximates instead: it
    // stays dimmed a little longer and leaks nothing.
    provisional:
      s.completedTricks.length === 0 &&
      s.config.declarationMode !== 'auto' &&
      s.currentTrick.length < 4,
    belaPending: belaStillOpen(s),
  });
}

/** Strip the cards off a declaration, leaving what the table is entitled to know. */
function summarize(d: Declaration): DeclarationSummary {
  return { kind: d.kind, value: d.value, length: d.length, topRank: d.topRank, seat: d.seat };
}
