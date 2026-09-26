/**
 * @belot/shared-types
 *
 * Pure data types shared by the engine, the bots, the Colyseus server, and the
 * Expo client. No logic lives here — only the vocabulary. Keeping these types in
 * one place is what lets the *same* protocol cross the wire (client <-> server)
 * and the *same* engine run on device and on the server.
 */

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

/**
 * Ranks listed in **natural** ascending order (7 < 8 < 9 < 10 < J < Q < K < A).
 * This ordering is used ONLY for declaration sequence-detection (terca/kvarta/
 * kvinta). Trick-winning order is completely different and lives in the engine's
 * power tables — never conflate the two (a classic Belot engine bug).
 */
export type Rank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export const RANKS: readonly Rank[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** A card carries only suit + rank. Its power and point value are *derived* from
 *  the play CONTEXT (which contract, which trump) — never stored on the card. */
export interface Card {
  suit: Suit;
  rank: Rank;
}

// ---------------------------------------------------------------------------
// Contract / play context
// ---------------------------------------------------------------------------

/**
 * The contract type drives every card derivation.
 * - SUIT:        one trump suit (the only contract shipped in v1).
 * - ALL_TRUMPS:  every suit is trump (Bulgarian; Phase 4).
 * - NO_TRUMPS:   no suit is trump (Bulgarian; Phase 4).
 */
export type ContractType = 'SUIT' | 'ALL_TRUMPS' | 'NO_TRUMPS';

export interface PlayContext {
  contractType: ContractType;
  /** The trump suit for SUIT contracts; null for ALL_TRUMPS / NO_TRUMPS / unbid. */
  trumpSuit: Suit | null;
}

// ---------------------------------------------------------------------------
// Seats and teams
// ---------------------------------------------------------------------------

/**
 * Seat order 0,1,2,3 IS the direction of play. Bela runs COUNTER-CLOCKWISE, so
 * seat+1 sits to that seat's RIGHT, the dealer's right-hand neighbour bids first
 * and leads, and the dealer is last — which is exactly why "mus" falls on them.
 * Partners sit across: team 0 = {0,2}, team 1 = {1,3}.
 */
export type Seat = 0 | 1 | 2 | 3;
export type TeamId = 0 | 1;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];

// ---------------------------------------------------------------------------
// Declarations (zvanja)
// ---------------------------------------------------------------------------

export type DeclarationKind = 'sequence' | 'carre';

export interface Declaration {
  kind: DeclarationKind;
  /** The cards that make up the declaration (for UI display / verification). */
  cards: Card[];
  /** Point value: terca 20 / kvarta 50 / kvinta(5+) 100; carré J=200, 9=150, A/10/K/Q=100. */
  value: number;
  /** Sequence length (carré is always 4). Used to break ranking ties. */
  length: number;
  /** Top card's natural rank (used to break equal-length ranking ties). */
  topRank: Rank;
  seat: Seat;
}

/**
 * What the TABLE knows about an announced declaration: its shape and worth, but
 * NOT the cards. At a real table you call "terca" and only the winning team shows
 * cards after trick 1 — so the cards must never cross the wire, or announcing
 * would hand opponents your hand. The server has already verified the holding.
 */
export interface DeclarationSummary {
  kind: DeclarationKind;
  value: number;
  length: number;
  topRank: Rank;
  seat: Seat;
}

/**
 * Whether declarations must be announced to count.
 * - 'announce' (default): authentic announce-or-forfeit. A seat holding zvanja
 *   must call them during trick 1, before playing its card, or score nothing for
 *   them. Staying silent to conceal your hand is a real strategic option.
 * - 'auto': every declaration counts automatically (a gentler casual/beginner mode).
 * - 'blind': hard mode — the engine never tells you what you hold. You may claim
 *   ("zovem zvanje") before your first card and whatever you actually hold is
 *   announced; play your first card without claiming and it is silently forfeited,
 *   exactly like overlooking a terca at a real table.
 */
export type DeclarationMode = 'auto' | 'announce' | 'blind';

/**
 * What happens when a player submits a card that breaks the rules of play.
 * - 'block' (default): the move is rejected — the app is the tolerant friend
 *   who says "ne možeš to".
 * - 'punish': the move is ACCEPTED and the deal ends immediately as a renons
 *   ("auzmeš"): the opponents score all 162 card points plus every zvanje
 *   announced in the deal, per hr.wikipedia/UHDDR rule 14. Hard mode.
 * Bots always pick from legal plays, so only humans can renons.
 */
export type RenonsMode = 'block' | 'punish';

/**
 * Whether bela (trump K+Q, worth 20) must be called to count.
 * - 'announce' (default): authentic. You call "bela" AS you play the first of the
 *   pair, or forfeit the 20. Calling reveals that you hold both — which is exactly
 *   what saying it out loud does at a real table.
 * - 'auto': awarded to whoever was dealt the pair (a gentler casual/beginner mode).
 *
 * Kept separate from `declarationMode` because they are different mechanics: zvanja
 * are a trick-1 decision, bela is tied to a specific card leaving your hand.
 */
export type BelaMode = 'auto' | 'announce';

// ---------------------------------------------------------------------------
// Engine configuration — the regional-variation knobs
// ---------------------------------------------------------------------------

export interface EngineConfig {
  /** Match target. Balkan Bela = 1001. */
  matchTarget: number;
  /**
   * When you cannot follow suit and your PARTNER is already winning the trick:
   * must you still trump/over-trump?
   * - true (default — the native Croatian rule, "mora se rezati" without
   *   exception; verified against hr.wikipedia, belaklub and the UHDDR
   *   tournament rulebook): you must trump even over your partner, and iber
   *   applies even when your partner leads the trick.
   * - false: the French-lineage "partner drži štih" exemption, kept as a
   *   house-rule knob only.
   */
  forcedOvertrumpOverPartner: boolean;
  /** Illegal-play handling; 'punish' = renons ends the deal for the offender. */
  renonsMode: RenonsMode;
  /** On a failed (pad) contract, does the failing team keep its bela 20? Default true. */
  keepBelaOnFailedContract: boolean;
  /**
   * What an exact points tie means for the contract.
   * - false (default, Balkan Bela): a tie is a FAIL (pad) -- the caller must be
   *   strictly ahead. An 81-81 board hands the whole table to the defenders.
   * - true (French Belote, per pagat): the taker succeeds on "at least as many
   *   points as the other team", so a tie stands.
   */
  contractTieSucceeds: boolean;
  /**
   * Is kontra/rekontra played at all? When false the doubling round is skipped
   * entirely: calling trump goes straight to play and the multiplier stays 1.
   * Every kontra knob below is then dormant.
   */
  allowKontra: boolean;
  /**
   * What the kontra/rekontra multiplier scales.
   * - 'trickPoints' (default): only card points + last trick + valat are doubled;
   *   declarations and bela are added at face value.
   * - 'all': everything is doubled.
   */
  kontraScope: 'trickPoints' | 'all';
  /**
   * What a MADE kontra pays. A failed kontra always hands the defenders the whole
   * table, doubled; sources disagree on the mirror case.
   * - false (default): the deal is scored as usual and simply doubled, so each
   *   side keeps its own points at x2.
   * - true: the calling team sweeps the table the way defenders do on a pad,
   *   making kontra a symmetric all-or-nothing bet.
   * OPEN RULES QUESTION - settle this with real players before launch.
   */
  kontraSuccessSweeps: boolean;
  /** If everyone passes the bid round, is the dealer forced to call ("muss")? Default true. */
  dealerMustCall: boolean;
  /** Last-trick (štih) bonus. Default 10. */
  lastTrickBonus: number;
  /** Valat (all 8 tricks) bonus on top of the last-trick bonus. Balkan = 90 (=> 252 total). */
  valatBonus: number;
  /**
   * When two teams' best declarations are exactly equal, do all declarations
   * cancel? Default FALSE per UHDDR tournament rule 7: "prednost ima onaj koji
   * je prvi na štihu" — the tie goes to whoever is earlier in play order from
   * the deal's first leader. True is kept as a house-rule knob.
   */
  declarationTieCancels: boolean;
  /** Must zvanja be announced during trick 1 to score? Default 'announce'. */
  declarationMode: DeclarationMode;
  /** Must bela be called when playing the first of the trump K/Q? Default 'announce'. */
  belaMode: BelaMode;
}

export const DEFAULT_CONFIG: EngineConfig = {
  matchTarget: 1001,
  forcedOvertrumpOverPartner: true,
  renonsMode: 'block',
  keepBelaOnFailedContract: true,
  contractTieSucceeds: false,
  allowKontra: false,
  kontraScope: 'trickPoints',
  kontraSuccessSweeps: false,
  dealerMustCall: true,
  lastTrickBonus: 10,
  valatBonus: 90,
  declarationTieCancels: false,
  declarationMode: 'announce',
  belaMode: 'announce',
};

/** The hard-difficulty ("prava bela") overrides applied on top of the defaults. */
export const HARD_CONFIG_OVERRIDES: Partial<EngineConfig> = {
  renonsMode: 'punish',
  declarationMode: 'blind',
};

// ---------------------------------------------------------------------------
// Game phases
// ---------------------------------------------------------------------------

export type Phase =
  | 'IDLE' // created, no deal yet
  | 'BID' // choosing trump (call / pass)
  | 'DOUBLE' // kontra / rekontra opportunity
  | 'PLAY' // 8 tricks
  | 'DEAL_OVER' // a deal scored; call startDeal for the next
  | 'MATCH_OVER'; // a team reached the target

// ---------------------------------------------------------------------------
// Actions (the player-facing protocol — also what crosses the wire)
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'BID_PASS'; seat: Seat }
  | { type: 'BID_CALL'; seat: Seat; suit: Suit } // v1: names the trump suit (SUIT contract)
  | { type: 'DOUBLE_KONTRA'; seat: Seat }
  | { type: 'DOUBLE_REKONTRA'; seat: Seat }
  | { type: 'DOUBLE_PASS'; seat: Seat }
  /**
   * The zvanja round, which happens BEFORE the opening lead — its own beat after
   * the talon, going round from the dealer's right. Croatian bela settles zvanja
   * here; binding them to a seat's first card is the French rule, and it let the
   * fourth seat answer after watching three cards land.
   *
   * `cards` is the combination the player marked in their hand. The engine
   * checks it against what they actually hold: it can never overstate a zvanje,
   * and in blind mode a wrong pick is simply a claim that finds nothing. Omit it
   * (bots, and any client that would rather not ask) and the engine announces
   * whatever the hand really has.
   */
  | { type: 'DECLARE_ANNOUNCE'; seat: Seat; cards?: Card[] }
  | { type: 'DECLARE_SKIP'; seat: Seat }
  | {
      type: 'PLAY_CARD';
      seat: Seat;
      card: Card;
      /**
       * Call "bela" with this card. Legal only when the card is the trump K or Q
       * AND you still hold both — which is precisely what makes it the FIRST of
       * the pair, so a late call is impossible by construction.
       */
      announceBela?: boolean;
    };

export type ActionType = Action['type'];

// ---------------------------------------------------------------------------
// Public view — what a given seat is allowed to see (hidden-hand safe)
// ---------------------------------------------------------------------------

export interface TrickPlay {
  seat: Seat;
  card: Card;
}

/** One finished trick of the deal, as everyone saw it: who led, who took it, the four plays in order. */
export interface TrickRecord {
  leader: Seat;
  winner: Seat;
  plays: TrickPlay[];
}

/** One answer in the bidding: a pass (`suit` null) or a call. */
export interface BidRecord {
  seat: Seat;
  suit: Suit | null;
}

/**
 * What the whole table has seen this deal, kept for the seat that looks back
 * (1.6.0): the bidding and every finished trick, with seats. Public by
 * construction - nothing here that was not said out loud or played face up.
 */
export interface DealHistory {
  bids: BidRecord[];
  tricks: TrickRecord[];
}

/**
 * The redacted state a single seat may receive over the wire. Crucially it
 * contains only the receiver's own `hand`, plus public counts of other hands.
 * The server builds this with the engine; opponents' cards never leave the room.
 */
/**
 * The live running score of the deal in progress — what a player at a real
 * table keeps in their head, including the number no rival app shows:
 * how many points the caller still needs.
 *
 * Numbers only: every input (won tricks, heard announcements, a called bela)
 * is already public, so this can never leak a hand.
 */
export interface DealProgress {
  /** Completed tricks so far, 0..8. */
  tricksPlayed: number;
  /** Card points taken so far, per team. Sums to <= 152. */
  cardPoints: [number, number];
  tricksWon: [number, number];
  /** Who took the 8th trick; null until it is taken. */
  lastTrickTeam: TeamId | null;
  /** Shipped so the client needs no engine config to do its own arithmetic. */
  lastTrickBonus: number;
  /** Zvanja as they would resolve if nothing more were announced (loser gets 0). */
  declarationPoints: [number, number];
  /** Team currently holding the zvanja contest; null = none, or cancelled. */
  declarationTeam: TeamId | null;
  bela: [number, number];
  /** cardPoints + last trick once awarded + declarations + bela. Excludes valat. */
  running: [number, number];
  callerTeam: TeamId;
  /** In force now; shown, never applied — doubling does not move the threshold. */
  multiplier: 1 | 2 | 4;
  /** 162 + resolved zvanja + bela. Excludes valat. */
  pot: number;
  /** Face-value total the CALLING team must reach; honours contractTieSucceeds. */
  target: number;
  /** max(0, target - running[callerTeam]) — "treba još N". */
  callerNeeds: number;
  callerSafe: boolean;
  /** Even taking everything left would not be enough. */
  callerDoomed: boolean;
  /** Per team: could still sweep all 8. While either is true, +90 is excluded. */
  valatPossible: [boolean, boolean];
  /** Trick 1 is still open — more zvanja may land and move `target`. */
  provisional: boolean;
  /**
   * A bela can still be called, which adds 20 to the pot and so raises
   * `target` — on ANY trick, by either side. Separate from `provisional`
   * because that one means "the local tally cannot be trusted yet"; this one
   * means "the number is right, but the bar may still rise".
   */
  belaPending: boolean;
}

export interface PublicView {
  phase: Phase;
  dealer: Seat;
  /** The receiving seat. */
  seat: Seat;
  /** Only this seat's cards. */
  hand: Card[];
  /** Number of cards remaining in each seat's hand (public info). */
  handCounts: [number, number, number, number];
  context: PlayContext;
  callerSeat: Seat | null;
  multiplier: 1 | 2 | 4;
  trickLeader: Seat | null;
  currentTrick: TrickPlay[];
  /** Whose turn it is to act, if any. */
  toAct: Seat | null;
  /**
   * Whose turn it is to answer "ima zvanja?", before anyone has led. Null once
   * the round is over (or immediately, when the table plays zvanja automatically).
   */
  declareTurn: Seat | null;
  /**
   * The winning side's zvanja, laid face up once the round closes — cards and
   * all, exactly as they go on the table.
   *
   * Only the side that WINS the contest shows; the losers say their number out
   * loud and keep their cards. Revealing theirs would hand the table their hand
   * for the rest of the deal. Both partners of the winning side show, and every
   * one of their combinations counts, including ones weaker than the opponents'
   * best — the strongest zvanje picks the SIDE, not the set.
   */
  revealedDeclarations: Declaration[];
  matchScores: [number, number];
  /**
   * Everything announced at this table so far, as public summaries WITHOUT cards.
   * This is exactly what a player at a real table has heard.
   */
  announcedDeclarations: DeclarationSummary[];
  /** The receiving seat's OWN zvanja — its cards are already in `hand`, so this leaks nothing. */
  myDeclarations: Declaration[];
  /** True when this seat owes an announce-or-skip decision before it may play. */
  mustDeclare: boolean;
  /**
   * Blind (hard) mode only: this seat MAY claim zvanja right now. Always offered
   * before the first card regardless of what the hand holds — the button's
   * presence must not leak whether there is anything to claim.
   */
  canDeclare: boolean;
  /** True when this seat could call bela right now (its legal plays include the option). */
  canAnnounceBela: boolean;
  /** Who has called bela this deal, once called. Public — everyone hears it. */
  belaAnnouncedBy: Seat | null;
  /** Live running score for the deal in progress; null outside PLAY. */
  dealProgress: DealProgress | null;
  /**
   * The deal so far, for "Pregled ruke" and the bots' memory (1.6.0). Optional
   * on the wire: a server from before it sends none, and an app copes without.
   */
  history?: DealHistory;
  /** Legal actions for `seat` right now (empty if it is not this seat's turn). */
  legalActions: Action[];
}
