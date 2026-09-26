import type {
  Action,
  DeclarationSummary,
  Rank,
  Seat,
  Suit,
  TeamId,
} from '@belot/shared-types';

/**
 * @belot/i18n — the words, and the deck.
 *
 * Bela is played with **mađarice** (Hungarian-suited cards), not the French deck:
 * žir (acorns), list (leaves), srce (hearts) and bundeva (bells), with ranks
 * VII–X plus dečko, baba, kralj and as. The engine's internal `Suit` names stay
 * French because they are just identifiers; everything a player ever SEES is
 * mapped here.
 *
 * Every surface says the same things from this file, so the phone, the terminal
 * and later the server cannot drift apart.
 */

export type LocaleId = 'hr' | 'sr-Cyrl' | 'en';

/**
 * Engine suit -> the mađarice suit it stands for.
 * acorns↔clubs, leaves↔spades, hearts↔hearts, bells↔diamonds.
 */
export type MadaricaSuit = 'acorns' | 'leaves' | 'hearts' | 'bells';

export const MADARICA_SUIT: Record<Suit, MadaricaSuit> = {
  clubs: 'acorns',
  spades: 'leaves',
  hearts: 'hearts',
  diamonds: 'bells',
};

/**
 * Mađarice are a FOUR-colour deck, unlike the French red/black pair. Surfaces map
 * these roles to their own palette; sharing the roles keeps them consistent.
 */
export type SuitColourRole = 'brown' | 'green' | 'red' | 'gold';

export const SUIT_COLOUR: Record<Suit, SuitColourRole> = {
  clubs: 'brown', // žir
  spades: 'green', // list
  hearts: 'red', // srce
  diamonds: 'gold', // bundeva
};

/** Kept for terminal output, where drawing a real pip is not an option. */
export const SUIT_PIP: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

/** True for the suits a French-deck player expects in red. Terminal use only. */
export function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

/**
 * App-shell vocabulary: home screen, shop, settings, profile. Same contract as
 * the table strings — every surface pulls from here, nothing is hardcoded.
 */
export interface UiStrings {
  play: string;
  playBots: string;
  privateTable: string;
  /** Under the two mode tiles on the home screen. */
  modeBotsSub: string;
  modePrivateSub: string;
  /** The one panel that holds the daily bonus and the quests. */
  daily: string;
  joinByCode: string;
  tableCode: string;
  enter: string;
  nicknameLabel: string;
  nicknamePlaceholder: string;
  dailyBonus: (coins: number) => string;
  streakDays: (days: number) => string;
  startStreak: string;
  claim: string;
  /** The claimed state's title. The streak is the line under it; repeated here it cut the title short on a phone. */
  bonusClaimed: string;
  dailyQuests: string;
  questLabel: (kind: 'playDeals' | 'winDeals' | 'callZvanja' | 'callBela' | 'winMatch') => string;
  level: string;
  coins: string;
  wins: string;
  shop: string;
  settings: string;
  profile: string;
  sectionCardBacks: string;
  sectionFelts: string;
  sectionAvatars: string;
  /** Display name for a cosmetic id; an unknown id falls back to the id itself. */
  cosmeticName: (id: string) => string;
  buy: (price: number) => string;
  needsLevel: (level: number) => string;
  /** The profile: how far to the next level, what it opens, the first-time line, the friends line. */
  xpToNext: (into: number, span: number, next: number) => string;
  xpMax: string;
  nextUnlock: (level: number, name: string) => string;
  profileEmpty: string;
  friendsLine: (played: number, rate: number) => string;
  /** The shop: the question before a purchase, and why a tile cannot be had. */
  shopBuyTitle: (name: string, price: number) => string;
  shopBuy: string;
  shopCancel: string;
  shopWhyLocked: (need: number, now: number) => string;
  shopWhyCoins: (missing: number) => string;
  select: string;
  selected: string;
  sound: string;
  haptics: string;
  language: string;
  resetProgress: string;
  /** The question before the progress is erased, what goes and what stays, the answer. */
  resetTitle: string;
  resetBody: string;
  resetYes: string;
  /** The settings' sections. */
  setGeneral: string;
  setGame: string;
  setLook: string;
  setData: string;
  version: string;
  statMatches: string;
  statWinRate: string;
  statDeals: string;
  statZvanja: string;
  statBela: string;
  statValat: string;
  statBestDeal: string;
  coinsDisclaimer: string;
  back: string;
  /** The branded screen a render error lands on, instead of a blank one. */
  crashTitle: string;
  crashBody: string;
  /** The crash screen's second button: the error, the version and the phone, to the clipboard. */
  crashCopy: string;
  crashCopied: string;

  privacyPolicy: string;

  /** Localized text for the phrase emotes (bravo/brze/ajme/hvala). */
  emotePhrase: (id: string) => string;
  /** A screen reader's name for an emote: a face by what it shows, a phrase by its words. */
  emoteName: (id: string) => string;
  /** The emote bar's toggle (faces <-> phrases), for a screen reader. */
  emoteToggle: string;
  /** The home screen's coin chip, which opens the shop, for a screen reader. */
  walletLabel: (coins: number) => string;

  /* Online table flow. */
  connecting: string;
  cannotConnect: (server: string) => string;
  connectionLost: string;
  /** A failed attempt to reach a table, and why (net/trouble.ts). */
  joinFailed: string;
  troubleNoSuchTable: string;
  troubleTableClosed: string;
  troubleOffline: string;
  /** The server refused this app as too old for its wire (net/proto.ts UPDATE_APP_CODE). */
  troubleAppTooOld: string;
  troubleBlocked: string;
  troubleBanned: string;
  troubleMaintenance: string;
  /** The button beside troubleAppTooOld: to the store. */
  updateApp: string;
  troubleServer: string;
  /** The lobby's connection dropped, and the seat was not got back. */
  troubleDropped: string;
  /** A public table refuses a second player from the same network (code 4300). */
  troubleSameNetwork: string;
  disconnectedWithCode: (code: number) => string;
  waitingForPlayers: (seated: number) => string;
  /** Quick play's lobby: strangers are being looked for. */
  searchingPlayers: (seated: number) => string;
  /** ...and after a while with nobody new: no need to wait. */
  nobodyYet: string;
  /** Under the home screen's big IGRAJ: what it is. */
  playOnlineSub: string;
  shareCode: string;
  leaveTable: string;
  /** Asked before a match in progress is abandoned: the leave button, the result sheet's, Android's back. */
  leaveConfirm: string;
  leaveConfirmYes: string;
  leaveConfirmNo: string;
  botPlaysFor: (names: string) => string;
  /** The server refused a move (usually a stale tap): said plainly, never in the server's own words. */
  moveRefused: string;
  /** A seat nobody named, counted from 1 as the server counts it ("Igrač 3"). */
  playerN: (n: number) => string;
  /** The gift picker's pill that opens the player view (hide / report). */
  reportOpen: string;
  reportOpenLabel: string;
  /** The player view's title. */
  playerTitle: (name: string) => string;
  hidePlayer: string;
  showPlayer: string;
  hidePlayerNote: string;
  /** The player view: block for good on this device (identity.ts), and the list of the blocked in Settings. */
  blockPlayer: string;
  blockPlayerNote: string;
  blockedPlayers: string;
  blockedNone: string;
  unblock: string;
  /** A public table asks before strangers' clips are heard (once per table). */
  voiceOptInTitle: string;
  voiceOptInBody: string;
  voiceOptInYes: string;
  voiceOptInNo: string;
  /** The rules of conduct, once, before the first voice message ever sent. */
  conductTitle: string;
  conductBody: string;
  conductAccept: string;
  reportPlayer: string;
  reportPlayerNote: string;
  /** Push-to-talk (apps/mobile/src/voice): the button, and what a press may end in. */
  micLabel: string;
  micHint: string;
  micTooShort: string;
  micDenied: string;
  micFailed: string;
  /** Tap-to-talk (a Settings choice): the button's hint, a take too short to send, and the cross that throws one away. */
  micHintTap: string;
  micTooShortTap: string;
  micCancel: string;
  /** Settings: how the mic works - held while speaking, or tapped to start and tapped again to send. */
  voiceModeLabel: string;
  voiceModeHold: string;
  voiceModeTap: string;
  /**
   * What became of my own message, beside the mic. Present tense or no verb
   * at all: a past tense would give the listener a gender.
   */
  voiceSending: string;
  voiceSent: string;
  voiceHeardBy: (names: readonly string[]) => string;
  voiceNobody: string;
  voiceUnheard: string;
  voiceNotSent: string;
  /** The results sheet's voice bar: who is speaking now, and what the mic there does. */
  voiceSpeaking: (name: string) => string;
  voiceBarHintHold: string;
  voiceBarHintTap: string;
  /** Voice at a table: the host's rule in the lobby, and each player's own switch in Settings. */
  voiceRule: string;
  voiceOn: string;
  voiceOff: string;
  voiceSetting: string;
  voiceSettingHint: string;
  /** The player view: one player's voice, off on this device. */
  muteVoice: string;
  unmuteVoice: string;
  muteVoiceNote: string;
  /** Shown under the report button: the address, in case no mail app opens. */
  reportFallback: (email: string) => string;
  reportSubject: string;
  reportBody: (p: { name: string; code: string; at: string; version: string; id?: string }) => string;
  /** A screen reader's hint on another player's puck, online. */
  playerHint: string;
  /** The sheet for a deal whose score this client never saw (after a reconnect). */
  resultMissed: string;
  /** The end of a match, said from our side (plural, so no gender). */
  matchWon: string;
  matchLost: string;
  /** Private tables: the button that stops the table for everyone, and its spoken name. */
  pause: string;
  pauseLabel: string;
  pausedTitle: string;
  /** Who paused it. */
  pausedBy: (name: string) => string;
  resume: string;
  /** A friend's connection dropped and the table waits for them. */
  waitingFor: (names: string) => string;
  waitingLine: (n: number) => string;
  /** Stop waiting: a bot holds their cards until they are back. */
  playOn: (n: number) => string;
  /** "još 7:42" - how long the wait or the pause has left. */
  holdLeft: (clock: string) => string;
  /** This device lost the connection and is getting back into its seat. */
  reconnectingTitle: string;
  reconnectingLine: string;
  /** The result sheet, online: pressed, and waiting for the rest. */
  nextReady: string;
  nextWaitingFor: (names: string) => string;
  /** The private-table lobby: the host's choice of turn clock. */
  turnClock: string;
  seconds: (n: number) => string;
  /** ...and of how long the match runs (501 / 701 / 1001). */
  matchLength: string;
  /** Under the nickname field: who sees it, and the rules its owner accepts. */
  nicknameRules: string;
  /** That line is a link: a screen reader says this instead of the whole sentence. */
  nicknameRulesLabel: string;
  /** The anchor on the rules page this language reads ('pravila' or 'conduct'). */
  rulesAnchor: string;
  startWithBots: string;
  sitHere: string;
  /** Under a lobby chair: the partner's side, and the other one (no gendered noun). */
  withYou: string;
  againstYou: string;
  /** The lobby's error state: try the connection again. */
  retry: string;
  /** Rematch flow after a finished match. */
  playAgain: string;
  /** ...when it is the same four people: the return match. */
  revans: string;
  waitingForRematch: (n: number) => string;
  rematchAsked: string;
  startAnyway: string;
  seriesScore: string;
  /** Hand arranging + sorting. */
  arrangeHint: string;
  arrangeDone: string;
  /** The once-a-match tip over the hand: the long-press that starts arranging. */
  arrangeTip: string;
  sortHand: string;
  sortAuto: string;
  sortSuits: string;
  sortManual: string;
  confirmPlayLabel: string;
  confirmOff: string;
  confirmAmbiguous: string;
  confirmAlways: string;
  motionLabel: string;
  motionSystem: string;
  motionFull: string;
  motionReduced: string;
  volumeLabel: string;
  volumeQuiet: string;
  volumeMedium: string;
  volumeLoud: string;
  soundBlocked: string;
  invite: string;
  /**
   * The deal's verdict in the callers' numbers, said from our side (plural
   * verbs, no gender): made, or pad and why - the callers need more than the
   * defenders, a tie included.
   */
  madeLine: (ours: boolean, callers: number, defenders: number) => string;
  padLine: (ours: boolean, callers: number, defenders: number) => string;
  /** The match-end sheet: deals each side took, and our best one. */
  dealsWon: string;
  bestDeal: (points: number, deal: number) => string;
  /** A dimmed card, tapped: why it may not go (the led suit's pip goes with the first). */
  mustFollow: string;
  mustTrump: string;
  mustBeat: string;
  /**
   * Učenje's coach (apps/mobile/src/table/coach.ts): a title, what to call
   * and why, what to play and why, and štiglja as it stands. Cards and suits
   * come in as their names ("A srce"), never declined.
   */
  coachTitle: string;
  coachCall: (suit: string, count: number, jack: boolean, nine: boolean, forced: boolean) => string;
  coachPass: string;
  coachPlay: (
    why:
      | 'leadTrump'
      | 'leadAce'
      | 'leadLow'
      | 'lead'
      | 'win'
      | 'givePoints'
      | 'duck'
      | 'mustTrump'
      | 'discard'
      | 'only'
      | 'play',
    card: string,
    bela: boolean,
  ) => string;
  coachStiglja: (ours: boolean) => string;
  /** Between my turns, when nothing else is worth saying: the trumps to watch. */
  coachWatch: (trump: string) => string;
  /** Prava bela, after a wrong card: which went, the rule it broke, what could have gone. */
  wrongCardWas: (card: string) => string;
  wrongCardShould: (cards: readonly string[]) => string;
  /** The table: a look at the last trick, on my turn. */
  lastTrick: string;
  peekLastTrick: string;
  /** The lobby's QR button, the code's screen-reader name, and what to do with it. */
  showQr: string;
  qrLabel: (code: string) => string;
  qrHint: string;
  /**
   * "Povijest i statistika": the matches played with friends at private
   * tables, on this device. Numbers stand after a word ("Niz pobjeda: 3"), so
   * no count has to agree with a noun's plural.
   */
  historyTitle: string;
  historyOpen: string;
  historyEmpty: string;
  historyLocal: string;
  historyTotals: string;
  histPlayed: string;
  histWon: string;
  histLost: string;
  histRate: string;
  streakWon: (n: number) => string;
  streakLost: (n: number) => string;
  bestStreak: (n: number) => string;
  peopleTitle: string;
  withLine: (played: number, won: number) => string;
  againstLine: (played: number, won: number) => string;
  matchesTitle: string;
  resultWon: string;
  resultLost: string;
  botWord: string;
  /** A person at a friends' table who never set a name. */
  unnamedPlayer: string;
  recordPeople: (partner: string, opponents: string[]) => string;
  /** A match in the history: its length, the version played (its name), deals, best deal. */
  recordMeta: (target: number, mode: string, deals: [number, number] | null, best: number | null) => string;
  /** The shared invitation: the code as well as the link, for anyone who has to type it. */
  inviteText: (code: string, url: string) => string;
  /** The lobby's copy chip beside the code, its screen-reader name, and what it says once done. */
  copy: string;
  copyCodeLabel: (code: string) => string;
  codeCopied: string;
  /** A browser with no share sheet: the invitation went to the clipboard instead. */
  inviteCopied: string;

  // --- table gifts ---
  /** A gift's name, by its catalogue id (kava, caj, …). */
  giftName: (id: string) => string;
  /** The picker's title and its send button before a gift is chosen. */
  giftSend: string;
  /** Opened from your own puck: a gift for everyone else. */
  giftTreatTable: string;
  giftToEveryone: (n: number) => string;
  /** The send button once a gift is chosen: its total price. */
  giftSendFor: (price: number) => string;
  giftWait: string;
  giftNoCoins: string;
  /** Under the grid: a gift is decoration, never value. */
  giftForFun: string;
  /** A screen reader's hint on a tappable puck. */
  giftHint: string;
  /** Closing a sheet (the gift picker). */
  close: string;
  /** Online, the chosen player's app is too old to draw gifts. */
  giftNotSeen: string;
  /** Online, nobody else at the table has an app that draws gifts. */
  giftNobodySees: string;
  /**
   * A puck as a screen reader hears it: everything the puck shows, since the
   * gift button over it hides its parts. "Name: value" pairs, so no count or
   * name is ever inflected.
   */
  giftPuckLabel: (p: { name: string; dealer: boolean; cards: number; tricks: number; gift: string | null }) => string;
  giftCellLabel: (gift: string, price: number) => string;
  /** Announced when a gift lands on you. */
  giftReceived: (gift: string, from: string) => string;
}

interface Strings {
  suit: Record<Suit, string>;
  /** Season shown on each ace, per the Tell pattern (srce=spring ... zir=winter). */
  season: Record<Suit, string>;
  /** Short face label as printed on the card: VII, VIII, IX, X, D, B, K, A. */
  rankShort: Record<Rank, string>;
  /** Spoken name, for declarations: "terca do dečka". */
  rankName: Record<Rank, string>;
  /** The card's rank said on its own, for the coach: "dečko", "as". */
  rankWord: Record<Rank, string>;
  /** A card by name, from its rank word and suit: "dečko srce", "jack of hearts". */
  cardOf: (rank: string, suit: string) => string;
  /** "a, b ili c": the last two joined by the language's "or". */
  orList: (items: readonly string[]) => string;

  /**
   * Relative seat names, indexed by offset in PLAY order from the viewer:
   * [me, next-to-act, partner, previous]. Bela runs counter-clockwise, so the
   * seat that acts after me is on my RIGHT — index 1 is "Desni", not "Lijevi".
   */
  seat: [string, string, string, string];
  seatAbsolute: (seat: Seat) => string;
  us: string;
  them: string;
  teamA: string;
  teamB: string;

  trump: string;
  trumpUndecided: string;
  /** The plaque while the trump is being called: a question, two words at most. */
  trumpQuestion: string;
  calledBy: (who: string) => string;
  /** The same, when the caller is the viewer: "zvao si ti", not "zvao Ti". */
  calledByYou: string;
  score: string;
  trick: string;
  emptyTrick: string;
  yourCards: string;
  declarations: string;
  bela: string;

  pass: string;
  /** Imperative, for buttons the player presses: "zovi". */
  callVerb: string;
  /** Third person, for narrating what somebody else did: "zove". */
  callsVerb: string;
  call: (suit: string) => string;
  kontra: string;
  rekontra: string;
  noKontra: string;
  announce: string;
  /** Third person narration of the same act. */
  announces: string;
  staySilent: string;
  withBela: string;
  declareHint: string;
  belaHint: string;

  /**
   * The value word a player would say out loud — sequences are announced by
   * VALUE, never by name: "dvadeset do kralja", not "terca". Per the UHDDR
   * "koliko i dokle" convention.
   */
  declValue: (value: number) => string;
  /** The "do" in "dvadeset do kralja". */
  declTo: string;
  carre: (rank: string) => string;
  /** A wrong card (renons) in Prava bela: the misplay that ends the deal. */
  renonsTitle: string;
  /**
   * Who played it, and so who gets the deal: my partner's wrong card gives it
   * to the opponents, an opponent's to my pair. No gendered verb or noun.
   */
  renonsBy: (who: string, withYou: boolean) => string;
  /** The same, when the offender is the viewer, without a gendered verb. */
  renonsByYou: string;
  /** Hard-mode blind claim button + empty-claim toast. */
  claimZvanja: string;
  claimZvanjaHint: string;
  noZvanja: string;
  /** The asking, spoken by the seat that leads: "do you have zvanja?" */
  askZvanja: string;
  /** Why a pair's announced zvanja are not in the recorded score. */
  zvanjaNoTrickToOpponents: string;
  /** What the winning side does when the asking is over. */
  showsZvanja: string;
  /** Answering with nothing. */
  noneToDeclare: string;
  /** Mark the cards, then confirm. */
  markZvanjaHint: string;
  /** Normal play, nothing to declare: the app answers for the player, and says so. */
  noZvanjaHere: string;
  markingOk: string;
  /** More than one zvanje marked at once - also fine, the engine takes them all. */
  markingOkMany: string;
  markingNotZvanje: string;
  /** Prava bela checks no marking: what to do, and nothing about whether it is one. */
  markingUnchecked: string;
  declareMarked: string;
  /** Difficulty setting. */
  difficulty: string;
  /** The three versions (apps/mobile/src/playMode.ts): Učenje, Lagana, Prava bela. */
  difficultyLearn: string;
  difficultyEasy: string;
  difficultyHard: string;
  difficultyHardHint: string;
  difficultyEasyHint: string;
  difficultyLearnHint: string;
  /** Card-face style chooser. */
  deckStyleLabel: string;
  deckMadarice: string;
  deckStarinske: string;
  deckFrancuske: string;
  deckSimple: string;

  dealHeading: (n: number, dealer: string) => string;
  dealResult: string;
  cardsAndLastTrick: string;
  /**
   * Shown as "Štiglja" — the name the table actually uses. The engine calls the
   * same thing `valatTeam` / `valatBonus`, which is the international term.
   */
  valat: string;
  total: string;
  recorded: string;
  matchScore: string;
  callerMade: string;
  callerFailed: string;
  /** The verdict as one word on the sheet's header band: the call was made / fell. */
  madeShort: string;
  failedShort: string;
  winner: (team: string) => string;
  nextDeal: string;
  newMatch: string;
  gameToTarget: (target: number) => string;
  /** Live deal counter: how many points the caller still needs. */
  /** What the CALLING side still needs - said as ours or theirs, never "treba još 82" to nobody. */
  needsMore: (points: number, ours: boolean) => string;
  /** The caller is already past the line. */
  contractSafe: string;

  /** "Kako se igra": the rules as this app plays them, a card table, and a glossary. */
  rules: RulesText;

  ui: UiStrings;
}

/**
 * The rules screen's words. Every number in them is the engine's own
 * (power.ts, declarations.ts, scoring.ts, legality.ts); a test holds them to it.
 */
export interface RulesText {
  title: string;
  /** Text sections in order; the card table goes after the second. */
  sections: { title: string; lines: string[] }[];
  cardsTitle: string;
  trumpRow: string;
  plainRow: string;
  cardsNote: string;
  glossaryTitle: string;
  glossary: [string, string][];
}

type QuestKind = 'playDeals' | 'winDeals' | 'callZvanja' | 'callBela' | 'winMatch';

/** 1 dan, 21 dan, 101 dan — everything else dana. Serbian follows the same rule. */
function hrDan(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'dan' : 'dana';
}

function srDan(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'дан' : 'дана';
}

const ROMAN: Pick<Record<Rank, string>, '7' | '8' | '9' | '10'> = {
  '7': 'VII',
  '8': 'VIII',
  '9': 'IX',
  '10': 'X',
};

const HR_EMOTE_NAMES: Record<string, string> = {
  smile: 'Osmijeh',
  laugh: 'Smijeh',
  wow: 'Iznenađenje',
  cry: 'Tuga',
  clap: 'Pljesak',
  think: 'Razmišljam',
};

const HR_EMOTES: Record<string, string> = {
  bravo: 'Bravo!',
  brze: 'Brže!',
  ajme: 'Ajme!',
  hvala: 'Hvala!',
  // No wider than en "Thanks!" in Rubik-700 (51 dp): the landscape rail's
  // chips are sized to it. "Dobar potez!" measured 82.
  dobro: 'Dobro!',
  ups: 'Ups!',
  idemo: 'Idemo!',
};

const HR_GIFTS: Record<string, string> = {
  kava: 'Kava',
  caj: 'Čaj',
  limunada: 'Limunada',
  rakija: 'Rakija',
  pivo: 'Pivo',
  gemist: 'Gemišt',
  burek: 'Burek',
  kolac: 'Kolač',
  sladoled: 'Sladoled',
  maramice: 'Maramice',
  ruza: 'Ruža',
  djetelina: 'Djetelina',
  potkova: 'Potkova',
  pehar: 'Pehar',
  kruna: 'Kruna',
};

const HR_COSMETICS: Record<string, string> = {
  classic: 'Klasična',
  lattice: 'Rešetka',
  oak: 'Hrast',
  green: 'Zeleni',
  walnut: 'Orah',
  midnight: 'Ponoć',
  djed: 'Djed',
  baka: 'Baka',
  brko: 'Brko',
  snasa: 'Snaša',
  student: 'Student',
  teta: 'Teta',
  sofer: 'Šofer',
  majstor: 'Majstor',
  gazda: 'Gazda',
  profesorica: 'Profesorica',
  ribar: 'Ribar',
  kapetan: 'Kapetan',
};

const HR_QUESTS: Record<QuestKind, string> = {
  playDeals: 'Odigraj dijeljenja',
  winDeals: 'Osvoji dijeljenja',
  callZvanja: 'Zovi zvanja',
  callBela: 'Zovi belu',
  winMatch: 'Pobijedi u partiji',
};

const hr: Strings = {
  suit: { clubs: 'žir', spades: 'list', hearts: 'srce', diamonds: 'bundeva' },
  season: { hearts: 'Proljeće', diamonds: 'Ljeto', spades: 'Jesen', clubs: 'Zima' },
  rankShort: { ...ROMAN, J: 'D', Q: 'B', K: 'K', A: 'A' },
  rankName: {
    '7': 'sedmice',
    '8': 'osmice',
    '9': 'devetke',
    '10': 'desetke',
    J: 'dečka',
    Q: 'babe',
    K: 'kralja',
    A: 'asa',
  },
  rankWord: {
    '7': 'sedmica',
    '8': 'osmica',
    '9': 'devetka',
    '10': 'desetka',
    J: 'dečko',
    Q: 'baba',
    K: 'kralj',
    A: 'as',
  },
  cardOf: (rank, suit) => `${rank} ${suit}`,
  orList: (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ili ${items[items.length - 1]}`),

  seat: ['Ti', 'Desni', 'Partner', 'Lijevi'],
  seatAbsolute: (seat) => `Igrač ${seat}`,
  us: 'Mi',
  them: 'Oni',
  teamA: 'Tim A',
  teamB: 'Tim B',

  trump: 'adut',
  trumpUndecided: 'adut još nije određen',
  trumpQuestion: 'adut?',
  calledBy: (who) => `zvao ${who}`,
  calledByYou: 'zvao si ti',
  score: 'Rezultat',
  trick: 'Štih',
  emptyTrick: '(prazan)',
  yourCards: 'Tvoje karte',
  declarations: 'Zvanja',
  bela: 'Bela',

  pass: 'dalje',
  callVerb: 'zovi',
  callsVerb: 'zove',
  call: (suit) => `zovi ${suit}`,
  kontra: 'KONTRA',
  rekontra: 'REKONTRA',
  noKontra: 'bez kontre',
  announce: 'zovi zvanja',
  announces: 'zove zvanja',
  staySilent: 'šuti (ne zovi)',
  withBela: '+ BELA',
  declareHint: 'Ako ne zoveš sada, propada — ali protivnici ništa ne saznaju.',
  belaHint: 'Belu zoveš uz kralja ili babu aduta.',

  declValue: (value) =>
    ({ 20: 'dvadeset', 50: 'pedeset', 100: 'sto', 150: 'sto pedeset', 200: 'dvjesto' })[value] ??
    String(value),
  declTo: 'do',
  carre: (rank) => `četiri ${rank}`,
  renonsTitle: 'Kriva karta!',
  renonsBy: (who, withYou) =>
    `${who} igra kartu koja nije dopuštena — cijelo dijeljenje ide ${withYou ? 'protivnicima' : 'tvom paru'}.`,
  renonsByYou: 'Tvoja karta nije dopuštena — cijelo dijeljenje ide protivnicima.',
  claimZvanja: 'Zovem zvanje',
  claimZvanjaHint: 'Imaš li zvanje? Pazi — tko ne zove, propada mu.',
  noZvanja: 'Nemaš ništa za zvati',
  askZvanja: 'Imaš li zvanja?',
  zvanjaNoTrickToOpponents: 'Bez štiha — zvanje ide protivniku',
  showsZvanja: 'pokazuje zvanja',
  noneToDeclare: 'Nemam',
  markZvanjaHint: 'Označi karte koje čine zvanje',
  noZvanjaHere: 'Nemaš zvanja.',
  markingOk: 'To je zvanje — pritisni Prijavi',
  markingOkMany: 'To su tvoja zvanja — pritisni Prijavi',
  markingNotZvanje: 'Označene karte nisu zvanje',
  markingUnchecked: 'Kad označiš cijelo zvanje, pritisni Prijavi',
  declareMarked: 'Prijavi',
  difficulty: 'Verzija igre',
  difficultyLearn: 'Učenje',
  difficultyEasy: 'Lagana',
  difficultyHard: 'Prava bela',
  difficultyHardHint:
    'Prava bela: bez ikakve pomoći. Zvanja i belu nalaziš kao za pravim stolom, a kriva karta košta cijelo dijeljenje: protivnici pišu sve. Poslije ti aplikacija pokaže koja je karta trebala ići.',
  difficultyEasyHint:
    'Lagana: zvanja i belu nalaziš i prijavljuješ ti, kao za pravim stolom; aplikacija samo kaže jesu li označene karte zvanje. Kriva karta se ne može odigrati.',
  difficultyLearnHint:
    'Učenje: aplikacija te vodi. Pronalazi tvoja zvanja, ne pušta krivu kartu i savjetuje kad zvati, što igrati i kako do štiglje.',
  deckStyleLabel: 'Karte',
  deckMadarice: 'Mađarice',
  deckStarinske: 'Starinske',
  deckFrancuske: 'Francuske',
  deckSimple: 'Jednostavne',

  dealHeading: (n, dealer) => `Dijeljenje ${n} — dijeli ${dealer}`,
  dealResult: 'Obračun dijeljenja',
  cardsAndLastTrick: 'Karte + zadnji štih',
  valat: 'Štiglja',
  total: 'Ukupno',
  recorded: 'Upisano',
  matchScore: 'Rezultat meča',
  callerMade: 'Zvač je prošao.',
  callerFailed: 'PAD — zvač nije prošao, sve ide protivnicima.',
  madeShort: 'Prošli',
  failedShort: 'Pad',
  winner: (team) => `Pobjeđuje ${team}`,
  nextDeal: 'Sljedeće dijeljenje',
  newMatch: 'Nova partija',
  gameToTarget: (target) => `igra do ${target}`,
  needsMore: (points, ours) => (ours ? `treba nam još ${points}` : `treba im još ${points}`),
  contractSafe: 'prošlo',

  rules: {
    title: 'Kako se igra',
    sections: [
      {
        title: 'Ukratko',
        lines: [
          'Igra se u četvero, u dva para: partner ti sjedi nasuprot.',
          'Špil ima 32 karte: žir, list, srce i bundeva, od sedmice do asa.',
          'Igra ide nadesno. Svako dijeljenje piše bodove objema stranama, a partiju dobiva par koji prvi dođe do 1001 boda (za privatnim stolom može i do 501 ili 701).',
        ],
      },
      {
        title: 'Adut',
        lines: [
          'Svatko dobije šest karata. Počevši desno od djelitelja, svatko zove adut ili kaže „dalje”.',
          'Ako svi kažu dalje, djelitelj mora zvati: to je muss.',
          'Zatim svatko dobije još dvije karte, pa ih ima osam.',
        ],
      },
      {
        title: 'Igra',
        lines: [
          'Prvu kartu baca igrač desno od djelitelja; tko uzme štih, baca prvi u sljedećem.',
          'Moraš odgovoriti na boju, i to jačom kartom ako je imaš (iber). Kad je štih već presječen adutom, dovoljna je bilo koja karta te boje.',
          'Nemaš li tu boju, moraš rezati adutom, i onda kad štih drži partner. Ako je adut već na stolu, moraš ga prebiti ako možeš.',
          'Tek kad nemaš ni tu boju ni aduta, bacaš što hoćeš.',
        ],
      },
      {
        title: 'Zvanja',
        lines: [
          'Prije prve karte svatko prijavi zvanja iz svoje ruke:',
          'terca, tri zaredom u istoj boji: 20 · kvarta, četiri zaredom: 50 · kvinta, pet ili više zaredom: 100',
          'četiri dečka: 200 · četiri devetke: 150 · četiri asa, desetke, kralja ili babe: 100 (sedmice i osmice ne vrijede)',
          'Piše samo par s najjačim zvanjem, ali onda sva svoja: četiri iste jače su od niza, duži niz od kraćeg, a kod jednake duljine viša karta. Kod posve jednakih zvanja prednost ima tko je ranije na redu.',
          'Par koji ne uzme nijedan štih ne piše svoja zvanja: idu paru koji je uzeo sve.',
          'Bela: kralj i baba aduta u istoj ruci vrijede 20. Zove se u trenutku kad baciš prvu od njih.',
        ],
      },
      {
        title: 'Tko prolazi',
        lines: [
          'Par koji je zvao adut mora skupiti više bodova od protivnika, zvanja i belu uključujući. Neriješeno je pad.',
          'Pad: protivnici pišu sve, karte, zadnji štih i sva zvanja. Zvači zadrže samo svoju belu.',
          'Štiglja: tko uzme svih osam štihova, dobije još 90.',
        ],
      },
      {
        title: 'Tri verzije',
        lines: [
          'Učenje: aplikacija pronalazi tvoja zvanja, ne pušta krivu kartu i savjetuje što igrati.',
          'Lagana: zvanja i belu nalaziš i prijavljuješ ti (aplikacija samo kaže jesu li označene karte zvanje); kriva karta se ne može odigrati.',
          'Prava bela: bez pomoći, a kriva karta košta cijelo dijeljenje: protivnici pišu sve.',
          'Verziju biraš u postavkama (Verzija igre), a za privatnim stolom bira je onaj tko ga je napravio. Brza igra s nepoznatima uvijek je Lagana.',
        ],
      },
    ],
    cardsTitle: 'Karte i bodovi',
    trumpRow: 'Adut',
    plainRow: 'Ostale boje',
    cardsNote: 'Karte nose 152 boda, a zadnji štih još 10: ukupno 162.',
    glossaryTitle: 'Pojmovi',
    glossary: [
      ['adut', 'boja koja reže sve ostale'],
      ['zvati', 'odabrati adut; tko ga je odabrao, zvač je'],
      ['dalje', 'ne zvati'],
      ['muss', 'djelitelj mora zvati kad su svi rekli dalje'],
      ['štih', 'četiri karte, po jedna od svakoga; uzima ga najjača'],
      ['zadnji štih', 'donosi još 10 bodova'],
      ['rezati', 'baciti adut na tuđu boju'],
      ['iber', 'obaveza da prebiješ štih ako možeš'],
      ['zvanja', 'nizovi i četiri iste, prijavljeni prije prve karte'],
      ['bela', 'kralj i baba aduta, 20 bodova'],
      ['pad', 'par koji je zvao nije skupio dovoljno; sve ide protivnicima'],
      ['štiglja', 'svih osam štihova; još 90 bodova'],
      ['kriva karta', 'karta koju pravila ne dopuštaju; u pravoj beli dijeljenje ide protivnicima'],
    ],
  },

  ui: {
    play: 'IGRAJ',
    playBots: 'Igraj protiv botova',
    privateTable: 'Napravi privatni stol',
    modeBotsSub: 'Odmah, i bez interneta',
    modePrivateSub: 'Pozovi prijatelje šifrom',
    daily: 'Dnevno',
    joinByCode: 'Pridruži se šifrom',
    tableCode: 'šifra stola',
    enter: 'Uđi',
    nicknameLabel: 'Tvoje ime za online igru',
    nicknamePlaceholder: 'bez prijave — samo ime',
    dailyBonus: (coins) => `Dnevni bonus: +${coins}`,
    streakDays: (days) => `Niz: ${days} ${hrDan(days)}`,
    startStreak: 'Počni niz danas',
    claim: 'Pokupi',
    bonusClaimed: 'Dnevni bonus pokupljen',
    dailyQuests: 'Dnevni zadaci',
    questLabel: (kind) => HR_QUESTS[kind],
    level: 'Nivo',
    coins: 'Novčići',
    wins: 'Pobjede',
    shop: 'Trgovina',
    settings: 'Postavke',
    profile: 'Profil',
    sectionCardBacks: 'Poleđine karata',
    sectionFelts: 'Stolovi',
    sectionAvatars: 'Avatari',
    cosmeticName: (id) => HR_COSMETICS[id] ?? id,
    buy: (price) => `Kupi · ${price}`,
    needsLevel: (level) => `Nivo ${level}`,
    xpToNext: (into, span, next) => `${into} / ${span} XP do nivoa ${next}`,
    xpMax: 'Najviši nivo!',
    nextUnlock: (level, name) => `Nivo ${level} otključava: ${name}`,
    profileEmpty: 'Odigraj prvu partiju: ovdje će se skupljati tvoja statistika.',
    friendsLine: (played, rate) => `S prijateljima: odigrano ${played}, uspjeh ${rate}%`,
    shopBuyTitle: (name, price) => `Kupi „${name}” za ${price} novčića?`,
    shopBuy: 'Kupi',
    shopCancel: 'Odustani',
    shopWhyLocked: (need, now) => `Otključava se na nivou ${need}. Sad si na nivou ${now}.`,
    shopWhyCoins: (missing) => `Nedostaje ti još novčića: ${missing}. Skupljaj ih partijama i dnevnim bonusom.`,
    select: 'Odaberi',
    selected: 'Odabrano',
    sound: 'Zvuk',
    haptics: 'Vibracija',
    language: 'Jezik',
    resetProgress: 'Izbriši napredak',
    resetTitle: 'Izbrisati napredak?',
    resetBody: 'Nivo, novčići, kupljeni izgledi i statistika kreću ispočetka. Povijest partija s prijateljima ostaje.',
    resetYes: 'Izbriši',
    setGeneral: 'Općenito',
    setGame: 'Igra',
    setLook: 'Izgled i zvuk',
    setData: 'Podaci',
    version: 'Verzija',
    statMatches: 'Partije',
    statWinRate: 'Postotak pobjeda',
    statDeals: 'Dijeljenja',
    statZvanja: 'Zvanja',
    statBela: 'Bele',
    statValat: 'Štiglje',
    statBestDeal: 'Najbolje dijeljenje',
    coinsDisclaimer: 'Novčići služe samo za igru. Nema uplata ni isplata pravog novca.',
    back: 'Natrag',
    crashTitle: 'Nešto je pošlo po zlu',
    crashBody: 'Aplikacija je naletjela na grešku. Vrati se na početni ekran i pokušaj ponovno.',
    crashCopy: 'Kopiraj izvještaj o grešci',
    crashCopied: 'Kopirano – pošalji na prijave@belastih.com',
    privacyPolicy: 'Pravila privatnosti',

    emotePhrase: (id) => HR_EMOTES[id] ?? id,
    emoteName: (id) => HR_EMOTE_NAMES[id] ?? HR_EMOTES[id] ?? id,
    emoteToggle: 'Poruke',
    walletLabel: (coins) => `Trgovina, novčići: ${coins}`,

    connecting: 'Spajanje…',
    cannotConnect: (server) => `Ne mogu se spojiti na ${server}`,
    connectionLost: 'Veza je prekinuta.',
    joinFailed: 'Spajanje nije uspjelo',
    troubleNoSuchTable: 'Nema otvorenog stola s tom šifrom. Provjeri šifru, ili zamoli prijatelja da je pošalje ponovno.',
    troubleTableClosed: 'Za tim stolom se već igra, ili je pun.',
    troubleOffline: 'Nema veze. Provjeri internet pa pokušaj ponovno.',
    troubleAppTooOld: 'Ova verzija aplikacije više ne može igrati online. Ažuriraj je u Trgovini Google Play.',
    troubleBlocked: 'Za ovim stolom je netko s tvog popisa blokiranih, ili netko tko ima tebe na svojem.',
    troubleBanned: 'Ova instalacija igre više ne može igrati online.',
    troubleMaintenance: 'Poslužitelj je nakratko zatvoren zbog održavanja. Pokušaj za nekoliko minuta.',
    updateApp: 'Ažuriraj',
    troubleServer: 'Poslužitelj se trenutno ne javlja kako treba. Pokušaj ponovno za koji trenutak.',
    troubleDropped: 'Stol više ne čeka. Pokušaj ponovno ili se vrati na početak.',
    troubleSameNetwork:
      'Za ovim javnim stolom već sjedi netko s iste mreže kao ti, a javni stol ne prima dvoje s iste mreže. Za igru zajedno napravi privatni stol.',
    disconnectedWithCode: (code) => `veza prekinuta (${code})`,
    waitingForPlayers: (seated) => `Čekamo igrače… ${seated}/4`,
    searchingPlayers: (seated) => `Tražimo igrače… ${seated}/4`,
    nobodyYet: 'Još nitko nije došao — ne moraš čekati.',
    playOnlineSub: 'Brza igra online, s pravim igračima',
    shareCode: 'Kopiraj je, ili je pošalji preko WhatsAppa, Vibera ili Messengera.',
    leaveTable: 'Napusti stol',
    leaveConfirm: 'Želiš li stvarno napustiti stol?',
    leaveConfirmYes: 'Napusti',
    leaveConfirmNo: 'Ostani',
    botPlaysFor: (names) => `${names} — igra bot`,
    moveRefused: 'Taj potez nije dopušten.',
    playerN: (n) => `Igrač ${n}`,
    reportOpen: 'Prijavi',
    reportOpenLabel: 'Sakrij ili prijavi igrača',
    playerTitle: (name) => `Igrač: ${name}`,
    hidePlayer: 'Sakrij ovog igrača',
    showPlayer: 'Ponovno prikaži igrača',
    hidePlayerNote: 'Do kraja ovog stola ovaj igrač ti je skriven: ime, emotikoni, darovi i glasovne poruke.',
    blockPlayer: 'Blokiraj igrača',
    blockPlayerNote: 'Trajno, na ovom uređaju: u brzoj igri više ne sjedate za isti stol, a poruke, emotikoni i darovi ovog igrača ne dolaze do tebe. Popis je u postavkama.',
    blockedPlayers: 'Blokirani igrači',
    blockedNone: 'Nitko nije blokiran.',
    unblock: 'Odblokiraj',
    voiceOptInTitle: 'Glasovne poruke za ovim stolom?',
    voiceOptInBody: 'Ovdje igraš s nepoznatima. Ako ih uključiš, njihove glasovne poruke sviraju same; svakog igrača možeš utišati, sakriti, blokirati ili prijaviti.',
    voiceOptInYes: 'Uključi',
    voiceOptInNo: 'Ne ovdje',
    conductTitle: 'Prije prve glasovne poruke',
    conductBody: 'Glasovne poruke čuju svi za stolom. Bez uvreda, mržnje, prijetnji i tuđih osobnih podataka. Prijavljeni igrači gube pristup.',
    conductAccept: 'Razumijem',
    reportPlayer: 'Prijavi igrača',
    reportPlayerNote:
      'Otvara e-poruku razvijatelju s nadimkom i kodom stola. Šalješ je ti; poslužitelj ništa ne sprema, ni glasovne poruke, pa opiši što se dogodilo.',
    micLabel: 'Glasovna poruka',
    micHint: 'Drži i govori, pusti za slanje',
    micTooShort: 'Drži tipku dok govoriš',
    micDenied: 'Dopusti mikrofon u postavkama telefona',
    micFailed: 'Snimanje nije uspjelo',
    micHintTap: 'Dodirni i govori, dodirni opet za slanje',
    micTooShortTap: 'Poruka je prekratka',
    micCancel: 'Odbaci poruku',
    voiceModeLabel: 'Mikrofon',
    voiceModeHold: 'Drži dok govoriš',
    voiceModeTap: 'Dodir za početak i kraj',
    voiceSending: 'Šaljem…',
    voiceSent: 'Poslano',
    voiceHeardBy: (names) =>
      `${names.length === 1 ? 'Čuje' : 'Čuju'} te ${names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} i ${names[names.length - 1]}`} ✓`,
    voiceNobody: 'Nitko te sada ne može čuti',
    voiceUnheard: 'Nitko te nije čuo',
    voiceNotSent: 'Nije poslano',
    voiceSpeaking: (name) => `${name} govori`,
    voiceBarHintHold: 'Drži mikrofon i govori',
    voiceBarHintTap: 'Dodirni mikrofon i govori',
    voiceRule: 'Glasovne poruke',
    voiceOn: 'Uključene',
    voiceOff: 'Isključene',
    voiceSetting: 'Glasovne poruke',
    voiceSettingHint: 'Za stolom drži ili dodirni mikrofon i govori; poruke drugih čuju se same. Ništa se ne sprema.',
    muteVoice: 'Utišaj glas',
    unmuteVoice: 'Uključi glas',
    muteVoiceNote: 'Samo kod tebe: glasovne poruke ovog igrača više ne čuješ.',
    reportFallback: (email) => `Ako se pošta ne otvori, piši na ${email}`,
    reportSubject: 'Bela Štih: prijava igrača',
    reportBody: (p) =>
      `Prijavljujem igrača s nadimkom: „${p.name}”\nKod stola: ${p.code}\nVrijeme: ${p.at}\nVerzija igre: ${p.version}${p.id ? `\nOznaka instalacije: ${p.id}` : ''}\n\nŠto je bilo neprimjereno (nije obavezno):\n`,
    playerHint: 'Dodirni za dar ili prijavu',
    resultMissed: 'Veza se prekinula, pa brojke ovog dijeljenja nisu stigle.',
    matchWon: 'Pobijedili smo!',
    matchLost: 'Izgubili smo',
    pause: 'Pauza',
    pauseLabel: 'Pauziraj stol',
    pausedTitle: 'Stol je na pauzi',
    pausedBy: (name) => `Pauza: ${name}`,
    resume: 'Nastavi',
    waitingFor: (names) => `Čekamo: ${names}`,
    waitingLine: (n) => (n > 1 ? 'Nisu tu — stol stoji dok se ne vrate.' : 'Nije tu — stol stoji dok se ne vrati.'),
    playOn: (n) => (n > 1 ? 'Nastavi s botovima' : 'Nastavi s botom'),
    holdLeft: (clock) => `još ${clock}`,
    reconnectingTitle: 'Veza je prekinuta',
    reconnectingLine: 'Vraćamo te na tvoje mjesto…',
    nextReady: 'Čekamo ostale',
    nextWaitingFor: (names) => `Čeka se: ${names}`,
    turnClock: 'Vrijeme za potez',
    matchLength: 'Igra do',
    seconds: (n) => `${n} s`,
    nicknameRules: 'Ime vide drugi igrači. Upisom prihvaćaš pravila ponašanja: bez uvreda, mržnje i tuđih osobnih podataka.',
    nicknameRulesLabel: 'Pravila ponašanja, otvara web stranicu',
    rulesAnchor: 'pravila',
    startWithBots: 'Počni s botovima',
    sitHere: 'sjedni ovdje',
    withYou: 's tobom',
    againstYou: 'protiv tebe',
    retry: 'Pokušaj ponovno',
    playAgain: 'Igraj opet',
    revans: 'Revanš!',
    waitingForRematch: (n) => `Čekamo još ${n} igrača…`,
    rematchAsked: 'Nova partija je zatražena',
    startAnyway: 'Počni svejedno',
    seriesScore: 'Partije',
    arrangeHint: 'Dodirni dvije karte da ih zamijeniš.',
    arrangeDone: 'Gotovo',
    arrangeTip: 'Pritisni i drži karte da ih složiš',
    sortHand: 'Slaganje karata',
    sortAuto: 'Adut prvi',
    sortSuits: 'Po bojama',
    sortManual: 'Ručno',
    confirmPlayLabel: 'Potvrda bacanja',
    confirmOff: 'Bez potvrde',
    confirmAmbiguous: 'Kad ima izbora',
    confirmAlways: 'Uvijek',
    motionLabel: 'Animacije',
    motionSystem: 'Kao sustav',
    motionFull: 'Pune',
    motionReduced: 'Smanjene',
    volumeLabel: 'Glasnoća',
    volumeQuiet: 'Tiho',
    volumeMedium: 'Srednje',
    volumeLoud: 'Glasno',
    soundBlocked: 'Zvuk je isključen — dodirni za uključivanje',
    invite: 'Pozovi prijatelje',
    madeLine: (ours, c, d) => `${ours ? 'Prošli smo' : 'Prošli su'}, ${c} prema ${d}.`,
    padLine: (ours, c, d) => `Pad: ${c} prema ${d}, a zvač mora imati više. Sve ide ${ours ? 'njima' : 'nama'}.`,
    dealsWon: 'Dobivena dijeljenja',
    bestDeal: (points, deal) => `Naše najbolje dijeljenje: ${points} (${deal}.)`,
    mustFollow: 'Moraš odgovoriti na boju',
    mustTrump: 'Nemaš boju — moraš rezati',
    mustBeat: 'Moraš prebiti — imaš jaču',
    coachTitle: 'Savjet',
    coachCall: (suit, count, jack, nine, forced) =>
      forced
        ? `Moraš zvati (muss). Najbolji adut: ${suit}.`
        : `Zovi ${suit}. Karata te boje: ${count}${jack && nine ? ', uz dečka i devetku' : jack ? ', uz dečka' : nine ? ', uz devetku' : ''}.${jack || nine ? ' Dečko i devetka najjači su aduti.' : ''}`,
    coachPass: 'Reci dalje: nijedna boja nije jaka za adut. Za adut treba dečko ili devetka i još koja karta te boje.',
    coachPlay: (why, card, bela) =>
      ({
        leadTrump: `Kreni adutom: ${card}. Tako izvlačiš adute protivnicima.`,
        leadAce: `Kreni: ${card}. As je najjača karta u boji i vjerojatno nosi štih.`,
        leadLow: `Kreni: ${card}. Slaba karta čuva jake za kasnije.`,
        lead: `Kreni: ${card}.`,
        win: `Uzmi štih: ${card}.`,
        givePoints: `Štih ide tvom paru — daj bodove: ${card}.`,
        duck: `Partner nosi štih — ne troši jaku kartu: ${card}.`,
        mustTrump: `Nemaš tu boju, pa moraš rezati adutom: ${card}.`,
        discard: `Ovaj štih ne možeš uzeti — baci slabu kartu: ${card}.`,
        only: `Smiješ igrati samo jednu kartu: ${card}.`,
        play: `Igraj: ${card}.`,
      })[why] + (bela ? ' Reci i BELA: +20.' : ''),
    coachStiglja: (ours) =>
      ours
        ? 'Tvoj par ima sve štihove: uzme li i ostale, to je štiglja, +90.'
        : 'Protivnici imaju sve štihove: jedan štih za tvoj par i nema štiglje.',
    coachWatch: (trump) => `Adut: ${trump}. Prati koji su aduti izašli: tko ih nema, ne može rezati.`,
    wrongCardWas: (card) => `Odigrana karta: ${card}.`,
    wrongCardShould: (cards) => `Trebalo je igrati: ${hr.orList(cards)}.`,
    lastTrick: 'zadnji štih',
    peekLastTrick: 'Pogledaj zadnji štih',
    showQr: 'QR kod',
    qrLabel: (code) => `QR kod stola ${code}`,
    qrHint: 'Neka ga prijatelj skenira kamerom mobitela.',
    inviteText: (code, url) => `Zaigraj belu sa mnom! Šifra stola: ${code}\n${url}`,
    historyTitle: 'Povijest i statistika',
    historyOpen: 'Povijest partija',
    historyEmpty:
      'Još nema partija s prijateljima. Napravi privatni stol i pozovi ih: ovdje će se skupljati sve partije s njima, tko je s kim u paru i tko vodi.',
    historyLocal: 'Povijest se čuva samo na ovom uređaju.',
    historyTotals: 'S prijateljima',
    histPlayed: 'Odigrano',
    histWon: 'Pobjede',
    histLost: 'Porazi',
    histRate: 'Uspjeh',
    streakWon: (n) => `Niz pobjeda: ${n}`,
    streakLost: (n) => `Niz poraza: ${n}`,
    bestStreak: (n) => `najduži niz pobjeda: ${n}`,
    peopleTitle: 'S kim igraš',
    withLine: (p, w) => `zajedno: ${p} · pobjede: ${w}`,
    againstLine: (p, w) => `protiv: ${p} · pobjede: ${w}`,
    matchesTitle: 'Partije',
    resultWon: 'Pobjeda',
    resultLost: 'Poraz',
    botWord: 'bot',
    unnamedPlayer: 'igrač bez imena',
    recordPeople: (partner, opponents) => `partner: ${partner} · protiv: ${opponents.join(', ')}`,
    recordMeta: (target, mode, deals, best) =>
      [
        `igra do ${target}`,
        mode,
        deals ? `dijeljenja ${deals[0]}:${deals[1]}` : null,
        best !== null ? `najbolje ${best}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    copy: 'Kopiraj',
    copyCodeLabel: (code) => `Kopiraj šifru ${code}`,
    codeCopied: 'Šifra je kopirana — zalijepi je prijateljima.',
    inviteCopied: 'Pozivnica je kopirana — zalijepi je prijateljima.',
    giftName: (id) => HR_GIFTS[id] ?? id,
    giftSend: 'Pošalji dar',
    giftTreatTable: 'Počasti cijeli stol',
    giftToEveryone: (n) => `Svima za stolom (${n})`,
    giftSendFor: (price) => `Pošalji · ${price}`,
    giftWait: 'Malo pričekaj pa pošalji novi dar.',
    giftNoCoins: 'Nemaš dovoljno novčića.',
    giftForFun: 'Dar je samo za veselje: primatelj ne dobiva novčiće.',
    giftHint: 'Dodirni za dar',
    close: 'Zatvori',
    giftNotSeen: 'Ovaj igrač ima stariju verziju igre i ne vidi darove.',
    giftNobodySees: 'Nitko drugi za stolom još ne vidi darove: imaju stariju verziju igre.',
    giftPuckLabel: (p) =>
      [p.name, p.dealer && 'dijeli', `karte: ${p.cards}`, p.tricks > 0 && `štihovi: ${p.tricks}`, p.gift && `dar: ${p.gift}`]
        .filter(Boolean)
        .join(', '),
    giftCellLabel: (gift, price) => `${gift}, ${price} novčića`,
    giftReceived: (gift, from) => `Novi dar: ${gift} (${from})`,
  },
};

const SR_EMOTE_NAMES: Record<string, string> = {
  smile: 'Осмех',
  laugh: 'Смех',
  wow: 'Изненађење',
  cry: 'Туга',
  clap: 'Аплауз',
  think: 'Размишљам',
};

const SR_EMOTES: Record<string, string> = {
  bravo: 'Браво!',
  brze: 'Брже!',
  ajme: 'Ајме!',
  hvala: 'Хвала!',
  dobro: 'Добро!',
  ups: 'Упс!',
  idemo: 'Идемо!',
};

const SR_GIFTS: Record<string, string> = {
  kava: 'Кафа',
  caj: 'Чај',
  limunada: 'Лимунада',
  rakija: 'Ракија',
  pivo: 'Пиво',
  gemist: 'Шприцер',
  burek: 'Бурек',
  kolac: 'Колач',
  sladoled: 'Сладолед',
  maramice: 'Марамице',
  ruza: 'Ружа',
  djetelina: 'Детелина',
  potkova: 'Потковица',
  pehar: 'Пехар',
  kruna: 'Круна',
};

const SR_COSMETICS: Record<string, string> = {
  classic: 'Класична',
  lattice: 'Решетка',
  oak: 'Храст',
  green: 'Зелени',
  walnut: 'Орах',
  midnight: 'Поноћ',
  djed: 'Деда',
  baka: 'Бака',
  brko: 'Брка',
  snasa: 'Снаја',
  student: 'Студент',
  teta: 'Тета',
  sofer: 'Шофер',
  majstor: 'Мајстор',
  gazda: 'Газда',
  profesorica: 'Професорка',
  ribar: 'Рибар',
  kapetan: 'Капетан',
};

const SR_QUESTS: Record<QuestKind, string> = {
  playDeals: 'Одиграј дељења',
  winDeals: 'Освоји дељења',
  callZvanja: 'Зови звања',
  callBela: 'Зови белу',
  winMatch: 'Победи у партији',
};

/** Same vocabulary, Cyrillic script — the toggle Serbian players expect. */
const srCyrl: Strings = {
  ...hr,
  suit: { clubs: 'жир', spades: 'лист', hearts: 'срце', diamonds: 'бундева' },
  season: { hearts: 'Пролеће', diamonds: 'Лето', spades: 'Јесен', clubs: 'Зима' },
  rankShort: { ...ROMAN, J: 'Д', Q: 'Б', K: 'К', A: 'А' },
  rankWord: {
    '7': 'седмица',
    '8': 'осмица',
    '9': 'деветка',
    '10': 'десетка',
    J: 'дечко',
    Q: 'баба',
    K: 'краљ',
    A: 'ас',
  },
  cardOf: (rank, suit) => `${rank} ${suit}`,
  orList: (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} или ${items[items.length - 1]}`),
  rankName: {
    '7': 'седмице',
    '8': 'осмице',
    '9': 'деветке',
    '10': 'десетке',
    J: 'дечка',
    Q: 'бабе',
    K: 'краља',
    A: 'аса',
  },

  seat: ['Ти', 'Десни', 'Партнер', 'Леви'],
  seatAbsolute: (seat) => `Играч ${seat}`,
  us: 'Ми',
  them: 'Они',
  teamA: 'Тим А',
  teamB: 'Тим Б',

  trump: 'адут',
  trumpUndecided: 'адут још није одређен',
  trumpQuestion: 'адут?',
  calledBy: (who) => `звао ${who}`,
  calledByYou: 'звао си ти',
  score: 'Резултат',
  trick: 'Штих',
  emptyTrick: '(празан)',
  yourCards: 'Твоје карте',
  declarations: 'Звања',
  bela: 'Бела',

  pass: 'даље',
  callVerb: 'зови',
  callsVerb: 'зове',
  call: (suit) => `зови ${suit}`,
  kontra: 'КОНТРА',
  rekontra: 'РЕКОНТРА',
  noKontra: 'без контре',
  announce: 'зови звања',
  announces: 'зове звања',
  staySilent: 'ћути (не зови)',
  withBela: '+ БЕЛА',
  declareHint: 'Ако не зовеш сада, пропада — али противници ништа не сазнају.',
  belaHint: 'Белу зовеш уз краља или бабу адута.',

  declValue: (value) =>
    ({ 20: 'двадесет', 50: 'педесет', 100: 'сто', 150: 'сто педесет', 200: 'двеста' })[value] ??
    String(value),
  declTo: 'до',
  carre: (rank) => `четири ${rank}`,
  renonsTitle: 'Погрешна карта!',
  renonsBy: (who, withYou) =>
    `${who} игра карту која није дозвољена — цело дељење иде ${withYou ? 'противницима' : 'твом пару'}.`,
  renonsByYou: 'Твоја карта није дозвољена — цело дељење иде противницима.',
  claimZvanja: 'Зовем звање',
  claimZvanjaHint: 'Имаш ли звање? Пази — ко не зове, пропада му.',
  noZvanja: 'Немаш ништа за звати',
  askZvanja: 'Имаш ли звања?',
  zvanjaNoTrickToOpponents: 'Без штиха — звање иде противнику',
  showsZvanja: 'показује звања',
  noneToDeclare: 'Немам',
  markZvanjaHint: 'Означи карте које чине звање',
  noZvanjaHere: 'Немаш звања.',
  markingOk: 'То је звање — притисни Пријави',
  markingOkMany: 'То су твоја звања — притисни Пријави',
  markingNotZvanje: 'Означене карте нису звање',
  markingUnchecked: 'Кад означиш цело звање, притисни Пријави',
  declareMarked: 'Пријави',
  difficulty: 'Верзија игре',
  difficultyLearn: 'Учење',
  difficultyEasy: 'Лагана',
  difficultyHard: 'Права бела',
  difficultyHardHint:
    'Права бела: без икакве помоћи. Звања и белу налазиш као за правим столом, а погрешна карта кошта цело дељење: противници пишу све. После ти апликација покаже која је карта требало да иде.',
  difficultyEasyHint:
    'Лагана: звања и белу налазиш и пријављујеш ти, као за правим столом; апликација само каже да ли су означене карте звање. Погрешна карта не може да се одигра.',
  difficultyLearnHint:
    'Учење: апликација те води. Проналази твоја звања, не пушта погрешну карту и саветује кад да зовеш, шта да играш и како до штигље.',
  deckStyleLabel: 'Карте',
  deckMadarice: 'Мађарице',
  deckStarinske: 'Старинске',
  deckFrancuske: 'Француске',
  deckSimple: 'Једноставне',

  dealHeading: (n, dealer) => `Дељење ${n} — дели ${dealer}`,
  dealResult: 'Обрачун дељења',
  cardsAndLastTrick: 'Карте + последњи штих',
  valat: 'Штигља',
  total: 'Укупно',
  recorded: 'Уписано',
  matchScore: 'Резултат меча',
  callerMade: 'Звач је прошао.',
  callerFailed: 'ПАД — звач није прошао, све иде противницима.',
  madeShort: 'Прошли',
  failedShort: 'Пад',
  winner: (team) => `Побеђује ${team}`,
  nextDeal: 'Следеће дељење',
  newMatch: 'Нова партија',
  gameToTarget: (target) => `игра до ${target}`,
  needsMore: (points, ours) => (ours ? `треба нам још ${points}` : `треба им још ${points}`),
  contractSafe: 'прошло',

  rules: {
    title: 'Како се игра',
    sections: [
      {
        title: 'Укратко',
        lines: [
          'Игра се у четворо, у два пара: партнер ти седи преко пута.',
          'Шпил има 32 карте: жир, лист, срце и бундева, од седмице до аса.',
          'Игра иде надесно. Свако дељење пише бодове обема странама, а партију добија пар који први дође до 1001 бода (за приватним столом може и до 501 или 701).',
        ],
      },
      {
        title: 'Адут',
        lines: [
          'Свако добије шест карата. Почевши десно од делитеља, свако зове адут или каже „даље”.',
          'Ако сви кажу даље, делитељ мора да зове: то је мус.',
          'Затим свако добије још две карте, па их има осам.',
        ],
      },
      {
        title: 'Игра',
        lines: [
          'Прву карту баца играч десно од делитеља; ко узме штих, баца први у следећем.',
          'Мораш да одговориш на боју, и то јачом картом ако је имаш (ибер). Кад је штих већ пресечен адутом, довољна је било која карта те боје.',
          'Ако немаш ту боју, мораш да сечеш адутом, и онда кад штих држи партнер. Ако је адут већ на столу, мораш да га пребијеш ако можеш.',
          'Тек кад немаш ни ту боју ни адута, бацаш шта хоћеш.',
        ],
      },
      {
        title: 'Звања',
        lines: [
          'Пре прве карте свако пријави звања из своје руке:',
          'терца, три заредом у истој боји: 20 · кварта, четири заредом: 50 · квинта, пет или више заредом: 100',
          'четири дечка: 200 · четири деветке: 150 · четири аса, десетке, краља или бабе: 100 (седмице и осмице не важе)',
          'Пише само пар са најјачим звањем, али онда сва своја: четири иста су јача од низа, дужи низ од краћег, а при једнакој дужини виша карта. Код потпуно једнаких звања предност има ко је раније на реду.',
          'Пар који не узме ниједан штих не пише своја звања: иду пару који је узео све.',
          'Бела: краљ и баба адута у истој руци вреде 20. Зове се у тренутку кад бациш прву од њих.',
        ],
      },
      {
        title: 'Ко пролази',
        lines: [
          'Пар који је звао адут мора да скупи више бодова од противника, звања и белу укључујући. Нерешено је пад.',
          'Пад: противници пишу све, карте, последњи штих и сва звања. Звачи задрже само своју белу.',
          'Штигља: ко узме свих осам штихова, добије још 90.',
        ],
      },
      {
        title: 'Три верзије',
        lines: [
          'Учење: апликација проналази твоја звања, не пушта погрешну карту и саветује шта да играш.',
          'Лагана: звања и белу налазиш и пријављујеш ти (апликација само каже да ли су означене карте звање); погрешна карта не може да се одигра.',
          'Права бела: без помоћи, а погрешна карта кошта цело дељење: противници пишу све.',
          'Верзију бираш у подешавањима (Верзија игре), а за приватним столом бира је онај ко га је направио. Брза игра са непознатима је увек Лагана.',
        ],
      },
    ],
    cardsTitle: 'Карте и бодови',
    trumpRow: 'Адут',
    plainRow: 'Остале боје',
    cardsNote: 'Карте носе 152 бода, а последњи штих још 10: укупно 162.',
    glossaryTitle: 'Појмови',
    glossary: [
      ['адут', 'боја која сече све остале'],
      ['звати', 'изабрати адут; ко га је изабрао, звач је'],
      ['даље', 'не звати'],
      ['мус', 'делитељ мора да зове кад су сви рекли даље'],
      ['штих', 'четири карте, по једна од свакога; узима га најјача'],
      ['последњи штих', 'доноси још 10 бодова'],
      ['сећи', 'бацити адут на туђу боју'],
      ['ибер', 'обавеза да пребијеш штих ако можеш'],
      ['звања', 'низови и четири иста, пријављени пре прве карте'],
      ['бела', 'краљ и баба адута, 20 бодова'],
      ['пад', 'пар који је звао није скупио довољно; све иде противницима'],
      ['штигља', 'свих осам штихова; још 90 бодова'],
      ['погрешна карта', 'карта коју правила не дозвољавају; у правој бели дељење иде противницима'],
    ],
  },

  ui: {
    play: 'ИГРАЈ',
    playBots: 'Играј против ботова',
    privateTable: 'Направи приватни сто',
    modeBotsSub: 'Одмах, и без интернета',
    modePrivateSub: 'Позови пријатеље шифром',
    daily: 'Дневно',
    joinByCode: 'Придружи се шифром',
    tableCode: 'шифра стола',
    enter: 'Уђи',
    nicknameLabel: 'Твоје име за онлајн игру',
    nicknamePlaceholder: 'без пријаве — само име',
    dailyBonus: (coins) => `Дневни бонус: +${coins}`,
    streakDays: (days) => `Низ: ${days} ${srDan(days)}`,
    startStreak: 'Почни низ данас',
    claim: 'Покупи',
    bonusClaimed: 'Дневни бонус покупљен',
    dailyQuests: 'Дневни задаци',
    questLabel: (kind) => SR_QUESTS[kind],
    level: 'Ниво',
    coins: 'Новчићи',
    wins: 'Победе',
    shop: 'Продавница',
    settings: 'Подешавања',
    profile: 'Профил',
    sectionCardBacks: 'Полеђине карата',
    sectionFelts: 'Столови',
    sectionAvatars: 'Аватари',
    cosmeticName: (id) => SR_COSMETICS[id] ?? id,
    buy: (price) => `Купи · ${price}`,
    needsLevel: (level) => `Ниво ${level}`,
    xpToNext: (into, span, next) => `${into} / ${span} XP до нивоа ${next}`,
    xpMax: 'Највиши ниво!',
    nextUnlock: (level, name) => `Ниво ${level} откључава: ${name}`,
    profileEmpty: 'Одиграј прву партију: овде ће се скупљати твоја статистика.',
    friendsLine: (played, rate) => `Са пријатељима: одиграно ${played}, успех ${rate}%`,
    shopBuyTitle: (name, price) => `Купи „${name}” за ${price} новчића?`,
    shopBuy: 'Купи',
    shopCancel: 'Одустани',
    shopWhyLocked: (need, now) => `Откључава се на нивоу ${need}. Сад си на нивоу ${now}.`,
    shopWhyCoins: (missing) => `Недостаје ти још новчића: ${missing}. Скупљај их партијама и дневним бонусом.`,
    select: 'Изабери',
    selected: 'Изабрано',
    sound: 'Звук',
    haptics: 'Вибрација',
    language: 'Језик',
    resetProgress: 'Избриши напредак',
    resetTitle: 'Избрисати напредак?',
    resetBody: 'Ниво, новчићи, купљени изгледи и статистика крећу испочетка. Историја партија са пријатељима остаје.',
    resetYes: 'Избриши',
    setGeneral: 'Опште',
    setGame: 'Игра',
    setLook: 'Изглед и звук',
    setData: 'Подаци',
    version: 'Верзија',
    statMatches: 'Партије',
    statWinRate: 'Проценат победа',
    statDeals: 'Дељења',
    statZvanja: 'Звања',
    statBela: 'Беле',
    statValat: 'Штигље',
    statBestDeal: 'Најбоље дељење',
    coinsDisclaimer: 'Новчићи служе само за игру. Нема уплата ни исплата правог новца.',
    back: 'Назад',
    crashTitle: 'Нешто је пошло по злу',
    crashBody: 'Апликација је наишла на грешку. Врати се на почетни екран и покушај поново.',
    crashCopy: 'Копирај извештај о грешци',
    crashCopied: 'Копирано – пошаљи на prijave@belastih.com',
    privacyPolicy: 'Правила приватности',

    emotePhrase: (id) => SR_EMOTES[id] ?? id,
    emoteName: (id) => SR_EMOTE_NAMES[id] ?? SR_EMOTES[id] ?? id,
    emoteToggle: 'Поруке',
    walletLabel: (coins) => `Продавница, новчићи: ${coins}`,

    connecting: 'Повезивање…',
    cannotConnect: (server) => `Не могу да се повежем на ${server}`,
    connectionLost: 'Веза је прекинута.',
    joinFailed: 'Повезивање није успело',
    troubleNoSuchTable: 'Нема отвореног стола са том шифром. Провери шифру, или замоли пријатеља да је пошаље поново.',
    troubleTableClosed: 'За тим столом се већ игра, или је пун.',
    troubleOffline: 'Нема везе. Провери интернет па покушај поново.',
    troubleAppTooOld: 'Ова верзија апликације више не може да игра онлајн. Ажурирај је у Google Play продавници.',
    troubleBlocked: 'За овим столом је неко са твог списка блокираних, или неко ко има тебе на своме.',
    troubleBanned: 'Ова инсталација игре више не може да игра онлајн.',
    troubleMaintenance: 'Сервер је накратко затворен због одржавања. Покушај за неколико минута.',
    updateApp: 'Ажурирај',
    troubleServer: 'Сервер се тренутно не јавља како треба. Покушај поново за који тренутак.',
    troubleDropped: 'Сто више не чека. Покушај поново или се врати на почетак.',
    troubleSameNetwork:
      'За овим јавним столом већ седи неко са исте мреже као ти, а јавни сто не прима двоје са исте мреже. За игру заједно направи приватни сто.',
    disconnectedWithCode: (code) => `веза прекинута (${code})`,
    waitingForPlayers: (seated) => `Чекамо играче… ${seated}/4`,
    searchingPlayers: (seated) => `Тражимо играче… ${seated}/4`,
    nobodyYet: 'Још нико није дошао — не мораш да чекаш.',
    playOnlineSub: 'Брза игра онлајн, са правим играчима',
    shareCode: 'Копирај је, или је пошаљи преко Вотсапа, Вајбера или Месинџера.',
    leaveTable: 'Напусти сто',
    leaveConfirm: 'Желиш ли стварно да напустиш сто?',
    leaveConfirmYes: 'Напусти',
    leaveConfirmNo: 'Остани',
    botPlaysFor: (names) => `${names} — игра бот`,
    moveRefused: 'Тај потез није дозвољен.',
    playerN: (n) => `Играч ${n}`,
    reportOpen: 'Пријави',
    reportOpenLabel: 'Сакриј или пријави играча',
    playerTitle: (name) => `Играч: ${name}`,
    hidePlayer: 'Сакриј овог играча',
    showPlayer: 'Поново прикажи играча',
    hidePlayerNote: 'До краја овог стола овај играч ти је скривен: име, емотикони, поклони и гласовне поруке.',
    blockPlayer: 'Блокирај играча',
    blockPlayerNote: 'Трајно, на овом уређају: у брзој игри више не седате за исти сто, а поруке, емотикони и поклони овог играча не стижу до тебе. Списак је у подешавањима.',
    blockedPlayers: 'Блокирани играчи',
    blockedNone: 'Нико није блокиран.',
    unblock: 'Одблокирај',
    voiceOptInTitle: 'Гласовне поруке за овим столом?',
    voiceOptInBody: 'Овде играш са непознатима. Ако их укључиш, њихове гласовне поруке свирају саме; сваког играча можеш да утишаш, сакријеш, блокираш или пријавиш.',
    voiceOptInYes: 'Укључи',
    voiceOptInNo: 'Не овде',
    conductTitle: 'Пре прве гласовне поруке',
    conductBody: 'Гласовне поруке чују сви за столом. Без увреда, мржње, претњи и туђих личних података. Пријављени играчи губе приступ.',
    conductAccept: 'Разумем',
    reportPlayer: 'Пријави играча',
    reportPlayerNote:
      'Отвара имејл програмеру са надимком и кодом стола. Шаљеш га ти; сервер ништа не чува, ни гласовне поруке, па опиши шта се десило.',
    micLabel: 'Гласовна порука',
    micHint: 'Држи и говори, пусти за слање',
    micTooShort: 'Држи тастер док говориш',
    micDenied: 'Дозволи микрофон у подешавањима телефона',
    micFailed: 'Снимање није успело',
    micHintTap: 'Додирни и говори, додирни поново за слање',
    micTooShortTap: 'Порука је прекратка',
    micCancel: 'Одбаци поруку',
    voiceModeLabel: 'Микрофон',
    voiceModeHold: 'Држи док говориш',
    voiceModeTap: 'Додир за почетак и крај',
    voiceSending: 'Шаљем…',
    voiceSent: 'Послато',
    voiceHeardBy: (names) =>
      `${names.length === 1 ? 'Чује' : 'Чују'} те ${names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`} ✓`,
    voiceNobody: 'Нико те сада не може чути',
    voiceUnheard: 'Нико те није чуо',
    voiceNotSent: 'Није послато',
    voiceSpeaking: (name) => `${name} говори`,
    voiceBarHintHold: 'Држи микрофон и говори',
    voiceBarHintTap: 'Додирни микрофон и говори',
    voiceRule: 'Гласовне поруке',
    voiceOn: 'Укључене',
    voiceOff: 'Искључене',
    voiceSetting: 'Гласовне поруке',
    voiceSettingHint: 'За столом држи или додирни микрофон и говори; поруке других се чују саме. Ништа се не чува.',
    muteVoice: 'Утишај глас',
    unmuteVoice: 'Укључи глас',
    muteVoiceNote: 'Само код тебе: гласовне поруке овог играча више не чујеш.',
    reportFallback: (email) => `Ако се пошта не отвори, пиши на ${email}`,
    reportSubject: 'Бела Штих: пријава играча',
    reportBody: (p) =>
      `Пријављујем играча са надимком: „${p.name}”\nКод стола: ${p.code}\nВреме: ${p.at}\nВерзија игре: ${p.version}${p.id ? `\nОзнака инсталације: ${p.id}` : ''}\n\nШта је било неприкладно (није обавезно):\n`,
    playerHint: 'Додирни за поклон или пријаву',
    resultMissed: 'Веза се прекинула, па бројке овог дељења нису стигле.',
    matchWon: 'Победили смо!',
    matchLost: 'Изгубили смо',
    pause: 'Пауза',
    pauseLabel: 'Паузирај сто',
    pausedTitle: 'Сто је на паузи',
    pausedBy: (name) => `Пауза: ${name}`,
    resume: 'Настави',
    waitingFor: (names) => `Чекамо: ${names}`,
    waitingLine: (n) => (n > 1 ? 'Нису ту — сто стоји док се не врате.' : 'Није ту — сто стоји док се не врати.'),
    playOn: (n) => (n > 1 ? 'Настави са ботовима' : 'Настави са ботом'),
    holdLeft: (clock) => `још ${clock}`,
    reconnectingTitle: 'Веза је прекинута',
    reconnectingLine: 'Враћамо те на твоје место…',
    nextReady: 'Чекамо остале',
    nextWaitingFor: (names) => `Чека се: ${names}`,
    turnClock: 'Време за потез',
    matchLength: 'Игра до',
    seconds: (n) => `${n} с`,
    nicknameRules: 'Име виде други играчи. Уписом прихваташ правила понашања: без увреда, мржње и туђих личних података.',
    nicknameRulesLabel: 'Правила понашања, отвара веб страницу',
    rulesAnchor: 'pravila',
    startWithBots: 'Почни са ботовима',
    sitHere: 'седни овде',
    withYou: 'с тобом',
    againstYou: 'против тебе',
    retry: 'Покушај поново',
    playAgain: 'Играј опет',
    revans: 'Реванш!',
    waitingForRematch: (n) => `Чекамо још ${n} играча…`,
    rematchAsked: 'Нова партија је затражена',
    startAnyway: 'Почни свеједно',
    seriesScore: 'Партије',
    arrangeHint: 'Додирни две карте да их замениш.',
    arrangeDone: 'Готово',
    arrangeTip: 'Притисни и држи карте да их сложиш',
    sortHand: 'Слагање карата',
    sortAuto: 'Адут први',
    sortSuits: 'По бојама',
    sortManual: 'Ручно',
    confirmPlayLabel: 'Потврда бацања',
    confirmOff: 'Без потврде',
    confirmAmbiguous: 'Кад има избора',
    confirmAlways: 'Увек',
    motionLabel: 'Анимације',
    motionSystem: 'Као систем',
    motionFull: 'Пуне',
    motionReduced: 'Смањене',
    volumeLabel: 'Јачина звука',
    volumeQuiet: 'Тихо',
    volumeMedium: 'Средње',
    volumeLoud: 'Гласно',
    soundBlocked: 'Звук је искључен — додирни за укључивање',
    invite: 'Позови пријатеље',
    madeLine: (ours, c, d) => `${ours ? 'Прошли смо' : 'Прошли су'}, ${c} према ${d}.`,
    padLine: (ours, c, d) => `Пад: ${c} према ${d}, а звач мора да има више. Све иде ${ours ? 'њима' : 'нама'}.`,
    dealsWon: 'Добијена дељења',
    bestDeal: (points, deal) => `Наше најбоље дељење: ${points} (${deal}.)`,
    mustFollow: 'Мораш да одговориш на боју',
    mustTrump: 'Немаш боју — мораш да сечеш',
    mustBeat: 'Мораш да пребијеш — имаш јачу',
    coachTitle: 'Савет',
    coachCall: (suit, count, jack, nine, forced) =>
      forced
        ? `Мораш да зовеш (мус). Најбољи адут: ${suit}.`
        : `Зови ${suit}. Карата те боје: ${count}${jack && nine ? ', уз дечка и деветку' : jack ? ', уз дечка' : nine ? ', уз деветку' : ''}.${jack || nine ? ' Дечко и деветка су најјачи адути.' : ''}`,
    coachPass: 'Реци даље: ниједна боја није јака за адут. За адут треба дечко или деветка и још која карта те боје.',
    coachPlay: (why, card, bela) =>
      ({
        leadTrump: `Крени адутом: ${card}. Тако извлачиш адуте противницима.`,
        leadAce: `Крени: ${card}. Ас је најјача карта у боји и вероватно носи штих.`,
        leadLow: `Крени: ${card}. Слаба карта чува јаке за касније.`,
        lead: `Крени: ${card}.`,
        win: `Узми штих: ${card}.`,
        givePoints: `Штих иде твом пару — дај бодове: ${card}.`,
        duck: `Партнер носи штих — не троши јаку карту: ${card}.`,
        mustTrump: `Немаш ту боју, па мораш да сечеш адутом: ${card}.`,
        discard: `Овај штих не можеш да узмеш — баци слабу карту: ${card}.`,
        only: `Смеш да играш само једну карту: ${card}.`,
        play: `Играј: ${card}.`,
      })[why] + (bela ? ' Реци и БЕЛА: +20.' : ''),
    coachStiglja: (ours) =>
      ours
        ? 'Твој пар има све штихове: узме ли и остале, то је штигља, +90.'
        : 'Противници имају све штихове: један штих за твој пар и нема штигље.',
    coachWatch: (trump) => `Адут: ${trump}. Прати који су адути изашли: ко их нема, не може да сече.`,
    wrongCardWas: (card) => `Одиграна карта: ${card}.`,
    wrongCardShould: (cards) => `Требало је играти: ${srCyrl.orList(cards)}.`,
    lastTrick: 'задњи штих',
    peekLastTrick: 'Погледај задњи штих',
    showQr: 'QR код',
    qrLabel: (code) => `QR код стола ${code}`,
    qrHint: 'Нека га пријатељ скенира камером телефона.',
    inviteText: (code, url) => `Заиграј белу са мном! Шифра стола: ${code}\n${url}`,
    historyTitle: 'Историја и статистика',
    historyOpen: 'Историја партија',
    historyEmpty:
      'Још нема партија са пријатељима. Направи приватни сто и позови их: овде ће се скупљати све партије с њима, ко је с ким у пару и ко води.',
    historyLocal: 'Историја се чува само на овом уређају.',
    historyTotals: 'Са пријатељима',
    histPlayed: 'Одиграно',
    histWon: 'Победе',
    histLost: 'Порази',
    histRate: 'Успех',
    streakWon: (n) => `Низ победа: ${n}`,
    streakLost: (n) => `Низ пораза: ${n}`,
    bestStreak: (n) => `најдужи низ победа: ${n}`,
    peopleTitle: 'С ким играш',
    withLine: (p, w) => `заједно: ${p} · победе: ${w}`,
    againstLine: (p, w) => `против: ${p} · победе: ${w}`,
    matchesTitle: 'Партије',
    resultWon: 'Победа',
    resultLost: 'Пораз',
    botWord: 'бот',
    unnamedPlayer: 'играч без имена',
    recordPeople: (partner, opponents) => `партнер: ${partner} · против: ${opponents.join(', ')}`,
    recordMeta: (target, mode, deals, best) =>
      [
        `игра до ${target}`,
        mode,
        deals ? `дељења ${deals[0]}:${deals[1]}` : null,
        best !== null ? `најбоље ${best}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    copy: 'Копирај',
    copyCodeLabel: (code) => `Копирај шифру ${code}`,
    codeCopied: 'Шифра је копирана — налепи је пријатељима.',
    inviteCopied: 'Позивница је копирана — налепи је пријатељима.',
    giftName: (id) => SR_GIFTS[id] ?? id,
    giftSend: 'Пошаљи поклон',
    giftTreatTable: 'Почасти цео сто',
    giftToEveryone: (n) => `Свима за столом (${n})`,
    giftSendFor: (price) => `Пошаљи · ${price}`,
    giftWait: 'Сачекај мало па пошаљи нови поклон.',
    giftNoCoins: 'Немаш довољно новчића.',
    giftForFun: 'Поклон је само за забаву: прималац не добија новчиће.',
    giftHint: 'Додирни за поклон',
    close: 'Затвори',
    giftNotSeen: 'Овај играч има старију верзију игре и не види поклоне.',
    giftNobodySees: 'Нико други за столом још не види поклоне: имају старију верзију игре.',
    giftPuckLabel: (p) =>
      [p.name, p.dealer && 'дели', `карте: ${p.cards}`, p.tricks > 0 && `штихови: ${p.tricks}`, p.gift && `поклон: ${p.gift}`]
        .filter(Boolean)
        .join(', '),
    giftCellLabel: (gift, price) => `${gift}, ${price} новчића`,
    giftReceived: (gift, from) => `Нови поклон: ${gift} (${from})`,
  },
};

const EN_EMOTE_NAMES: Record<string, string> = {
  smile: 'Smile',
  laugh: 'Laughing',
  wow: 'Surprised',
  cry: 'Sad',
  clap: 'Applause',
  think: 'Thinking',
};

const EN_EMOTES: Record<string, string> = {
  bravo: 'Nice!',
  brze: 'Faster!',
  ajme: 'Oops!',
  hvala: 'Thanks!',
  dobro: 'Great!',
  ups: 'My bad!',
  // Without the "!": "Let's go!" is 54 dp, past the rail's chip.
  idemo: "Let's go",
};

const EN_GIFTS: Record<string, string> = {
  kava: 'Coffee',
  caj: 'Tea',
  limunada: 'Lemonade',
  rakija: 'Rakija',
  pivo: 'Beer',
  gemist: 'Spritzer',
  burek: 'Burek',
  kolac: 'Cake',
  sladoled: 'Ice cream',
  maramice: 'Tissues',
  ruza: 'Rose',
  djetelina: 'Four-leaf clover',
  potkova: 'Horseshoe',
  pehar: 'Trophy',
  kruna: 'Crown',
};

const EN_COSMETICS: Record<string, string> = {
  classic: 'Classic',
  lattice: 'Lattice',
  oak: 'Oak',
  green: 'Green',
  walnut: 'Walnut',
  midnight: 'Midnight',
  djed: 'Grandpa',
  baka: 'Grandma',
  brko: 'Moustache',
  snasa: 'Village belle',
  student: 'Student',
  teta: 'Auntie',
  sofer: 'Chauffeur',
  majstor: 'Handyman',
  gazda: 'Boss',
  profesorica: 'Professor',
  ribar: 'Fisherman',
  kapetan: 'Captain',
};

const EN_QUESTS: Record<QuestKind, string> = {
  playDeals: 'Play deals',
  winDeals: 'Win deals',
  callZvanja: 'Make declarations',
  callBela: 'Call bela',
  winMatch: 'Win a match',
};

const en: Strings = {
  ...hr,
  suit: { clubs: 'acorns', spades: 'leaves', hearts: 'hearts', diamonds: 'bells' },
  season: { hearts: 'Spring', diamonds: 'Summer', spades: 'Autumn', clubs: 'Winter' },
  rankShort: { ...ROMAN, J: 'J', Q: 'Q', K: 'K', A: 'A' },
  rankWord: {
    '7': 'seven',
    '8': 'eight',
    '9': 'nine',
    '10': 'ten',
    J: 'jack',
    Q: 'queen',
    K: 'king',
    A: 'ace',
  },
  cardOf: (rank, suit) => `${rank} of ${suit}`,
  orList: (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`),
  rankName: {
    '7': 'seven',
    '8': 'eight',
    '9': 'nine',
    '10': 'ten',
    J: 'jack',
    Q: 'queen',
    K: 'king',
    A: 'ace',
  },

  seat: ['You', 'Right', 'Partner', 'Left'],
  seatAbsolute: (seat) => `Player ${seat}`,
  us: 'Us',
  them: 'Them',
  teamA: 'Team A',
  teamB: 'Team B',

  trump: 'trump',
  trumpUndecided: 'trump not yet chosen',
  trumpQuestion: 'trump?',
  calledBy: (who) => `called by ${who}`,
  calledByYou: 'called by you',
  score: 'Score',
  trick: 'Trick',
  emptyTrick: '(empty)',
  yourCards: 'Your cards',
  declarations: 'Declarations',
  bela: 'Bela',

  pass: 'pass',
  callVerb: 'call',
  callsVerb: 'calls',
  call: (suit) => `call ${suit}`,
  noKontra: 'no kontra',
  announce: 'declare',
  announces: 'declares',
  staySilent: 'stay silent',
  declareHint: 'Stay silent and it is forfeited — but the opponents learn nothing.',
  belaHint: 'Call bela with the king or over of trumps.',

  declValue: (value) =>
    ({ 20: 'twenty', 50: 'fifty', 100: 'a hundred', 150: '150', 200: '200' })[value] ??
    String(value),
  declTo: 'to the',
  carre: (rank) => `four ${rank}s`,
  renonsTitle: 'Wrong card!',
  renonsBy: (who, withYou) =>
    `${who} played a card that was not allowed — the whole deal goes to ${withYou ? 'the opponents' : 'your pair'}.`,
  renonsByYou: 'Your card was not allowed — the whole deal goes to the opponents.',
  claimZvanja: 'Declare',
  claimZvanjaHint: 'Got a declaration? Spot it yourself — unclaimed is forfeited.',
  noZvanja: 'Nothing to declare',
  askZvanja: 'Any declarations?',
  zvanjaNoTrickToOpponents: 'No trick taken — declarations go to the opponents',
  showsZvanja: 'shows declarations',
  noneToDeclare: 'Nothing',
  markZvanjaHint: 'Mark the cards that make up your declaration',
  noZvanjaHere: 'Nothing to declare in this hand.',
  markingOk: 'That is a declaration — press Declare',
  markingOkMany: 'Those are your declarations — press Declare',
  markingNotZvanje: 'Those cards are not a declaration',
  markingUnchecked: 'Mark the whole declaration, then press Declare',
  declareMarked: 'Declare',
  difficulty: 'Game version',
  difficultyLearn: 'Learning',
  difficultyEasy: 'Casual',
  difficultyHard: 'True bela',
  difficultyHardHint:
    'True bela: no help at all. Your declarations and bela are yours to find, and a wrong card costs the whole deal: the opponents write everything. Afterwards the app shows which card should have gone.',
  difficultyEasyHint:
    'Casual: you find and call your own declarations and bela, as at a real table; the app only says whether the cards you marked are one. A wrong card cannot be played.',
  difficultyLearnHint:
    'Learning: the app guides you. It finds your declarations, never lets a wrong card go, and advises when to call, what to play and how to reach štiglja.',
  deckStyleLabel: 'Cards',
  deckMadarice: 'Hungarian',
  deckStarinske: 'Vintage',
  deckFrancuske: 'French',
  deckSimple: 'Simple',

  dealHeading: (n, dealer) => `Deal ${n} — dealt by ${dealer}`,
  dealResult: 'Deal result',
  cardsAndLastTrick: 'Cards + last trick',
  valat: 'Štiglja',
  total: 'Total',
  recorded: 'Recorded',
  matchScore: 'Match score',
  callerMade: 'The caller made it.',
  callerFailed: 'Down — the caller failed; everything goes to the opponents.',
  madeShort: 'Made',
  failedShort: 'Down',
  winner: (team) => `${team} wins`,
  nextDeal: 'Next deal',
  newMatch: 'New match',
  gameToTarget: (target) => `game to ${target}`,
  needsMore: (points, ours) => (ours ? `we need ${points} more` : `they need ${points} more`),
  contractSafe: 'safe',

  rules: {
    title: 'How to play',
    sections: [
      {
        title: 'In short',
        lines: [
          'Four players in two pairs: your partner sits across from you.',
          'The deck has 32 cards: acorns, leaves, hearts and bells, from seven to ace.',
          'Play goes to the right. Every deal scores points for both sides, and the first pair to reach 1001 wins the match (a private table can play to 501 or 701).',
        ],
      },
      {
        title: 'Trump',
        lines: [
          'Everyone gets six cards. Starting right of the dealer, each player calls a trump or says "pass".',
          'If everyone passes, the dealer must call: that is the muss.',
          'Then everyone gets two more cards, eight in all.',
        ],
      },
      {
        title: 'Play',
        lines: [
          'The player right of the dealer leads the first trick; whoever takes a trick leads the next.',
          'You must follow suit, with a higher card if you have one (iber). Once a trick has been trumped, any card of the suit will do.',
          'If you have none of the suit, you must trump, even when your partner is winning the trick. If a trump is already down, you must beat it if you can.',
          'Only with neither the suit nor a trump may you play anything.',
        ],
      },
      {
        title: 'Declarations',
        lines: [
          'Before the first card, everyone declares what their hand holds:',
          'terca, three in a row of one suit: 20 · kvarta, four in a row: 50 · kvinta, five or more: 100',
          'four jacks: 200 · four nines: 150 · four aces, tens, kings or queens: 100 (sevens and eights count for nothing)',
          'Only the pair with the strongest declaration scores, but then all of theirs: four of a kind beats a run, a longer run a shorter one, and at equal length the higher card. Exactly equal ones go to whoever comes first in play.',
          'A pair that takes no trick cannot keep its declarations: they go to the pair that took them all.',
          'Bela: the king and queen of trumps in one hand are worth 20. Call it as you play the first of them.',
        ],
      },
      {
        title: 'Who makes it',
        lines: [
          'The pair that called trump must end with more points than the other pair, declarations and bela included. A tie is down.',
          'Down (pad): the other pair takes everything, the cards, the last trick and every declaration. The callers keep only their bela.',
          'Štiglja: taking all eight tricks is worth 90 more.',
        ],
      },
      {
        title: 'Three versions',
        lines: [
          'Learning: the app finds your declarations, never lets a wrong card go, and advises what to play.',
          'Casual: you find and call your own declarations and bela (the app only says whether the cards you marked are one); a wrong card cannot be played.',
          'True bela: no help, and a wrong card costs the whole deal: the others write everything.',
          'You pick the version in Settings (Game version); at a private table, whoever made it picks. Quick play with strangers is always Casual.',
        ],
      },
    ],
    cardsTitle: 'Cards and points',
    trumpRow: 'Trump',
    plainRow: 'Other suits',
    cardsNote: 'The cards are worth 152 points, and the last trick 10 more: 162 in all.',
    glossaryTitle: 'Words',
    glossary: [
      ['trump (adut)', 'the suit that beats all the others'],
      ['call (zvati)', 'choose the trump; whoever did is the caller'],
      ['pass (dalje)', 'not calling'],
      ['muss', 'the dealer must call when everyone passed'],
      ['trick (štih)', 'four cards, one from each player; the strongest takes it'],
      ['last trick', 'worth 10 more points'],
      ['trump in (rezati)', 'play a trump on another suit'],
      ['iber', 'the duty to beat the trick if you can'],
      ['declarations (zvanja)', 'runs and four of a kind, declared before the first card'],
      ['bela', 'the king and queen of trumps, 20 points'],
      ['down (pad)', 'the callers fell short; everything goes to the others'],
      ['štiglja', 'all eight tricks; 90 more points'],
      ['wrong card (renons)', 'a card the rules do not allow; in True bela the deal goes to the others'],
    ],
  },

  ui: {
    play: 'PLAY',
    playBots: 'Play vs bots',
    privateTable: 'Create a private table',
    modeBotsSub: 'Right away, offline too',
    modePrivateSub: 'Invite friends with a code',
    daily: 'Daily',
    joinByCode: 'Join with a code',
    tableCode: 'table code',
    enter: 'Enter',
    nicknameLabel: 'Your name for online play',
    nicknamePlaceholder: 'no sign-up — just a name',
    dailyBonus: (coins) => `Daily bonus: +${coins}`,
    streakDays: (days) => `Streak: ${days} ${days === 1 ? 'day' : 'days'}`,
    startStreak: 'Start a streak today',
    claim: 'Claim',
    bonusClaimed: 'Daily bonus claimed',
    dailyQuests: 'Daily quests',
    questLabel: (kind) => EN_QUESTS[kind],
    level: 'Level',
    coins: 'Coins',
    wins: 'Wins',
    shop: 'Shop',
    settings: 'Settings',
    profile: 'Profile',
    sectionCardBacks: 'Card backs',
    sectionFelts: 'Tables',
    sectionAvatars: 'Avatars',
    cosmeticName: (id) => EN_COSMETICS[id] ?? id,
    buy: (price) => `Buy · ${price}`,
    needsLevel: (level) => `Level ${level}`,
    xpToNext: (into, span, next) => `${into} / ${span} XP to level ${next}`,
    xpMax: 'Top level!',
    nextUnlock: (level, name) => `Level ${level} unlocks: ${name}`,
    profileEmpty: 'Play your first match: your statistics will gather here.',
    friendsLine: (played, rate) => `With friends: ${played} played, ${rate}% won`,
    shopBuyTitle: (name, price) => `Buy "${name}" for ${price} coins?`,
    shopBuy: 'Buy',
    shopCancel: 'Cancel',
    shopWhyLocked: (need, now) => `Unlocks at level ${need}. You are level ${now}.`,
    shopWhyCoins: (missing) => `You need ${missing} more coins. Earn them with matches and the daily bonus.`,
    select: 'Select',
    selected: 'Selected',
    sound: 'Sound',
    haptics: 'Haptics',
    language: 'Language',
    resetProgress: 'Erase progress',
    resetTitle: 'Erase your progress?',
    resetBody: 'Level, coins, bought looks and statistics start over. The history of matches with friends stays.',
    resetYes: 'Erase',
    setGeneral: 'General',
    setGame: 'Game',
    setLook: 'Look and sound',
    setData: 'Data',
    version: 'Version',
    statMatches: 'Matches',
    statWinRate: 'Win rate',
    statDeals: 'Deals',
    statZvanja: 'Declarations',
    statBela: 'Belas',
    statValat: 'Štiglje',
    statBestDeal: 'Best deal',
    coinsDisclaimer: 'Coins are for play only. No real-money deposits or payouts.',
    back: 'Back',
    crashTitle: 'Something went wrong',
    crashBody: 'The app hit an error. Go back to the home screen and try again.',
    crashCopy: 'Copy the error report',
    crashCopied: 'Copied – send it to prijave@belastih.com',
    privacyPolicy: 'Privacy policy',

    emotePhrase: (id) => EN_EMOTES[id] ?? id,
    emoteName: (id) => EN_EMOTE_NAMES[id] ?? EN_EMOTES[id] ?? id,
    emoteToggle: 'Messages',
    walletLabel: (coins) => `Shop, coins: ${coins}`,

    connecting: 'Connecting…',
    cannotConnect: (server) => `Cannot reach ${server}`,
    connectionLost: 'Connection lost.',
    joinFailed: "Couldn't join",
    troubleNoSuchTable: 'No open table has that code. Check it, or ask your friend to send it again.',
    troubleTableClosed: 'That table is already playing, or full.',
    troubleOffline: 'No connection. Check your internet and try again.',
    troubleAppTooOld: 'This version of the app can no longer play online. Update it in Google Play.',
    troubleBlocked: 'Somebody at this table is on your blocked list, or has you on theirs.',
    troubleBanned: 'This installation of the game can no longer play online.',
    troubleMaintenance: 'The server is closed for a few minutes of maintenance. Try again shortly.',
    updateApp: 'Update',
    troubleServer: "The server isn't answering properly right now. Try again in a moment.",
    troubleDropped: 'The table is no longer waiting. Try again, or go back to the start.',
    troubleSameNetwork:
      'Someone on the same network as you already sits at this public table, and a public table takes one player per network. To play together, open a private table.',
    disconnectedWithCode: (code) => `connection lost (${code})`,
    waitingForPlayers: (seated) => `Waiting for players… ${seated}/4`,
    searchingPlayers: (seated) => `Looking for players… ${seated}/4`,
    nobodyYet: 'Nobody has joined yet — no need to wait.',
    playOnlineSub: 'Quick play online, with real people',
    shareCode: 'Copy it, or send it by WhatsApp, Viber or Messenger.',
    leaveTable: 'Leave table',
    leaveConfirm: 'Do you really want to leave the table?',
    leaveConfirmYes: 'Leave',
    leaveConfirmNo: 'Stay',
    botPlaysFor: (names) => `${names} — a bot plays for them`,
    moveRefused: "That move isn't allowed.",
    playerN: (n) => `Player ${n}`,
    reportOpen: 'Report',
    reportOpenLabel: 'Hide or report this player',
    playerTitle: (name) => `Player: ${name}`,
    hidePlayer: 'Hide this player',
    showPlayer: 'Show this player again',
    hidePlayerNote: 'For the rest of this table this player is hidden from you: name, emotes, gifts and voice messages.',
    blockPlayer: 'Block this player',
    blockPlayerNote: 'For good, on this device: quick play never seats you at the same table again, and their messages, emotes and gifts do not reach you. The list is in Settings.',
    blockedPlayers: 'Blocked players',
    blockedNone: 'Nobody is blocked.',
    unblock: 'Unblock',
    voiceOptInTitle: 'Voice messages at this table?',
    voiceOptInBody: 'You are playing with strangers here. If you turn them on, their voice messages play by themselves; any player can be muted, hidden, blocked or reported.',
    voiceOptInYes: 'Turn on',
    voiceOptInNo: 'Not here',
    conductTitle: 'Before your first voice message',
    conductBody: "Everyone at the table hears voice messages. No insults, hate, threats or other people's personal details. Reported players lose access.",
    conductAccept: 'Understood',
    reportPlayer: 'Report this player',
    reportPlayerNote:
      'Opens an email to the developer with the nickname and table code. You send it; the server keeps nothing, voice messages included, so describe what happened.',
    micLabel: 'Voice message',
    micHint: 'Hold and speak, let go to send',
    micTooShort: 'Hold the button while you speak',
    micDenied: 'Allow the microphone in your phone settings',
    micFailed: 'Recording failed',
    micHintTap: 'Tap and speak, tap again to send',
    micTooShortTap: 'Too short to send',
    micCancel: 'Discard the message',
    voiceModeLabel: 'Microphone',
    voiceModeHold: 'Hold while speaking',
    voiceModeTap: 'Tap to start and stop',
    voiceSending: 'Sending…',
    voiceSent: 'Sent',
    voiceHeardBy: (names) =>
      `${names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`} heard it ✓`,
    voiceNobody: 'Nobody here can hear you now',
    voiceUnheard: 'Nobody heard it',
    voiceNotSent: 'Not sent',
    voiceSpeaking: (name) => `${name} is speaking`,
    voiceBarHintHold: 'Hold the mic and speak',
    voiceBarHintTap: 'Tap the mic and speak',
    voiceRule: 'Voice messages',
    voiceOn: 'On',
    voiceOff: 'Off',
    voiceSetting: 'Voice messages',
    voiceSettingHint: "At the table, hold or tap the mic and speak; others' messages play by themselves. Nothing is stored.",
    muteVoice: 'Mute voice',
    unmuteVoice: 'Unmute voice',
    muteVoiceNote: "Only on your phone: you no longer hear this player's voice messages.",
    reportFallback: (email) => `If no mail app opens, write to ${email}`,
    reportSubject: 'Bela Štih: player report',
    reportBody: (p) =>
      `Reporting the player with the nickname: "${p.name}"\nTable code: ${p.code}\nTime: ${p.at}\nApp version: ${p.version}${p.id ? `\nInstallation ID: ${p.id}` : ''}\n\nWhat was wrong (optional):\n`,
    playerHint: 'Tap to send a gift or report',
    resultMissed: "The connection dropped, so this deal's numbers are missing.",
    matchWon: 'We won!',
    matchLost: 'We lost',
    pause: 'Pause',
    pauseLabel: 'Pause the table',
    pausedTitle: 'The table is paused',
    pausedBy: (name) => `Paused by ${name}`,
    resume: 'Resume',
    waitingFor: (names) => `Waiting for ${names}`,
    waitingLine: (n) => (n > 1 ? 'They are away — the table waits until they are back.' : 'Away — the table waits until they are back.'),
    playOn: (n) => (n > 1 ? 'Continue with bots' : 'Continue with a bot'),
    holdLeft: (clock) => `${clock} left`,
    reconnectingTitle: 'Connection lost',
    reconnectingLine: 'Getting you back to your seat…',
    nextReady: 'Waiting for the others',
    nextWaitingFor: (names) => `Waiting for: ${names}`,
    turnClock: 'Time per move',
    matchLength: 'Play to',
    seconds: (n) => `${n} s`,
    nicknameRules: "Other players see this name. By entering one you accept the rules of conduct: no insults, hate or other people's personal details.",
    nicknameRulesLabel: 'Rules of conduct, opens a web page',
    rulesAnchor: 'conduct',
    startWithBots: 'Start with bots',
    sitHere: 'sit here',
    withYou: 'with you',
    againstYou: 'against you',
    retry: 'Try again',
    playAgain: 'Play again',
    revans: 'Rematch!',
    waitingForRematch: (n) => `Waiting for ${n} more…`,
    rematchAsked: 'You asked for another match',
    startAnyway: 'Start anyway',
    seriesScore: 'Matches',
    arrangeHint: 'Tap two cards to swap them.',
    arrangeDone: 'Done',
    arrangeTip: 'Press and hold your cards to arrange them',
    sortHand: 'Card order',
    sortAuto: 'Trump first',
    sortSuits: 'By suit',
    sortManual: 'Manual',
    confirmPlayLabel: 'Confirm play',
    confirmOff: 'Never',
    confirmAmbiguous: 'When there is a choice',
    confirmAlways: 'Always',
    motionLabel: 'Animations',
    motionSystem: 'Follow system',
    motionFull: 'Full',
    motionReduced: 'Reduced',
    volumeLabel: 'Volume',
    volumeQuiet: 'Quiet',
    volumeMedium: 'Medium',
    volumeLoud: 'Loud',
    soundBlocked: 'Sound is off — tap to turn it on',
    invite: 'Invite friends',
    madeLine: (ours, c, d) => `${ours ? 'We made it' : 'They made it'}, ${c} to ${d}.`,
    padLine: (ours, c, d) => `Down: ${c} to ${d}, and the callers need more. It all goes to ${ours ? 'them' : 'us'}.`,
    dealsWon: 'Deals won',
    bestDeal: (points, deal) => `Our best deal: ${points} (deal ${deal})`,
    mustFollow: 'Follow suit',
    mustTrump: 'None of that suit — you must trump',
    mustBeat: 'Beat it — you hold a higher card',
    coachTitle: 'Tip',
    coachCall: (suit, count, jack, nine, forced) =>
      forced
        ? `You must call (muss). Best trump: ${suit}.`
        : `Call ${suit}. Cards of that suit: ${count}${jack && nine ? ', with the jack and the nine' : jack ? ', with the jack' : nine ? ', with the nine' : ''}.${jack || nine ? ' The jack and the nine are the strongest trumps.' : ''}`,
    coachPass: 'Pass: no suit is strong enough for trump. It wants the jack or the nine and another card of that suit.',
    coachPlay: (why, card, bela) =>
      ({
        leadTrump: `Lead a trump: ${card}. It draws the others' trumps out.`,
        leadAce: `Lead: ${card}. An ace is the strongest of its suit and likely takes the trick.`,
        leadLow: `Lead: ${card}. A low card keeps the strong ones for later.`,
        lead: `Lead: ${card}.`,
        win: `Take the trick: ${card}.`,
        givePoints: `The trick is your pair's — give it points: ${card}.`,
        duck: `Your partner holds the trick — save your strong cards: ${card}.`,
        mustTrump: `None of that suit, so you must trump: ${card}.`,
        discard: `You can't take this trick — throw a low card: ${card}.`,
        only: `Only one card may go: ${card}.`,
        play: `Play: ${card}.`,
      })[why] + (bela ? ' Call BELA too: +20.' : ''),
    coachStiglja: (ours) =>
      ours
        ? 'Your pair holds every trick: take the rest too and it is štiglja, +90.'
        : 'The others hold every trick: one trick for your pair and there is no štiglja.',
    coachWatch: (trump) => `Trump: ${trump}. Watch which trumps are out: whoever has none cannot trump.`,
    wrongCardWas: (card) => `The card played: ${card}.`,
    wrongCardShould: (cards) => `It should have been: ${en.orList(cards)}.`,
    lastTrick: 'last trick',
    peekLastTrick: 'Show the last trick',
    showQr: 'QR code',
    qrLabel: (code) => `QR code for table ${code}`,
    qrHint: 'Let a friend scan it with their phone camera.',
    inviteText: (code, url) => `Come play Bela with me! Table code: ${code}\n${url}`,
    historyTitle: 'History and statistics',
    historyOpen: 'Match history',
    historyEmpty:
      'No matches with friends yet. Create a private table and invite them: every match with them, who partners whom and who leads, will gather here.',
    historyLocal: 'The history is kept on this device only.',
    historyTotals: 'With friends',
    histPlayed: 'Played',
    histWon: 'Won',
    histLost: 'Lost',
    histRate: 'Win rate',
    streakWon: (n) => `Winning run: ${n}`,
    streakLost: (n) => `Losing run: ${n}`,
    bestStreak: (n) => `longest winning run: ${n}`,
    peopleTitle: 'Who you play with',
    withLine: (p, w) => `together: ${p} · won: ${w}`,
    againstLine: (p, w) => `against: ${p} · won: ${w}`,
    matchesTitle: 'Matches',
    resultWon: 'Won',
    resultLost: 'Lost',
    botWord: 'bot',
    unnamedPlayer: 'unnamed player',
    recordPeople: (partner, opponents) => `partner: ${partner} · against: ${opponents.join(', ')}`,
    recordMeta: (target, mode, deals, best) =>
      [
        `game to ${target}`,
        mode,
        deals ? `deals ${deals[0]}:${deals[1]}` : null,
        best !== null ? `best ${best}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    copy: 'Copy',
    copyCodeLabel: (code) => `Copy the code ${code}`,
    codeCopied: 'Code copied — paste it to your friends.',
    inviteCopied: 'Invite copied — paste it to your friends.',
    giftName: (id) => EN_GIFTS[id] ?? id,
    giftSend: 'Send a gift',
    giftTreatTable: 'Treat the table',
    giftToEveryone: (n) => `Everyone (${n})`,
    giftSendFor: (price) => `Send · ${price}`,
    giftWait: 'Wait a moment before the next gift.',
    giftNoCoins: 'Not enough coins.',
    giftForFun: 'Gifts are just for fun: the receiver gets no coins.',
    giftHint: 'Tap to send a gift',
    close: 'Close',
    giftNotSeen: "This player has an older version of the game and can't see gifts.",
    giftNobodySees: 'Nobody else here can see gifts yet: they have an older version of the game.',
    giftPuckLabel: (p) =>
      [p.name, p.dealer && 'deals', `cards: ${p.cards}`, p.tricks > 0 && `tricks: ${p.tricks}`, p.gift && `gift: ${p.gift}`]
        .filter(Boolean)
        .join(', '),
    giftCellLabel: (gift, price) => `${gift}, ${price} coins`,
    giftReceived: (gift, from) => `New gift: ${gift} (${from})`,
  },
};

const LOCALES: Record<LocaleId, Strings> = { hr, 'sr-Cyrl': srCyrl, en };

export class Lang {
  readonly id: LocaleId;
  private readonly t: Strings;

  constructor(id: LocaleId = 'hr') {
    this.id = id;
    // A locale id read back from storage is not necessarily one this build
    // knows — a rolled-back client, or settings written by a newer one. Falling
    // back beats throwing on every screen that touches `lang.s`.
    this.t = LOCALES[id] ?? LOCALES.hr;
  }

  get s(): Strings {
    return this.t;
  }

  /** The mađarice name: žir, list, srce, bundeva. */
  suitName(suit: Suit): string {
    return this.t.suit[suit];
  }

  /** The season on this suit's ace (Tell pattern: srce=spring ... žir=winter). */
  seasonName(suit: Suit): string {
    return this.t.season[suit];
  }

  /** Name plus a French pip, for terminals that cannot draw a real one. */
  suit(suit: Suit): string {
    return `${SUIT_PIP[suit]} ${this.t.suit[suit]}`;
  }

  /** What is printed on the card face. */
  rankShort(rank: Rank): string {
    return this.t.rankShort[rank];
  }

  rankName(rank: Rank): string {
    return this.t.rankName[rank];
  }

  /** A card said in words, as the language says it: "dečko srce", "jack of hearts". */
  cardName(card: { rank: Rank; suit: Suit }): string {
    return this.t.cardOf(this.t.rankWord[card.rank], this.t.suit[card.suit]);
  }

  /** Seats read relative to the person; absolute when nobody is seated. */
  seat(seat: Seat, humanSeat: Seat | null): string {
    if (humanSeat === null) return this.t.seatAbsolute(seat);
    return this.t.seat[((seat - humanSeat + 4) % 4) as 0 | 1 | 2 | 3];
  }

  team(team: TeamId, humanSeat: Seat | null): string {
    if (humanSeat === null) return team === 0 ? this.t.teamA : this.t.teamB;
    return team === ((humanSeat % 2) as TeamId) ? this.t.us : this.t.them;
  }

  declaration(d: DeclarationSummary): string {
    // Announced the way it is said at the table: by value, "dvadeset do kralja" —
    // never by name, and never revealing more than the top card.
    const top = this.rankName(d.topRank);
    if (d.kind === 'carre') return `${this.t.declValue(d.value)} (${this.t.carre(top)})`;
    return `${this.t.declValue(d.value)} ${this.t.declTo} ${top}`;
  }

  /** Short label for a legal action, for buttons and numbered lists. */
  action(a: Action): string {
    switch (a.type) {
      case 'BID_PASS':
        return this.t.pass;
      case 'BID_CALL':
        return this.t.call(this.suitName(a.suit));
      case 'DOUBLE_KONTRA':
        return this.t.kontra;
      case 'DOUBLE_REKONTRA':
        return this.t.rekontra;
      case 'DOUBLE_PASS':
        return this.t.noKontra;
      case 'DECLARE_ANNOUNCE':
        return this.t.announce;
      case 'DECLARE_SKIP':
        return this.t.staySilent;
      case 'PLAY_CARD':
        return (
          `${this.rankShort(a.card.rank)} ${this.suitName(a.card.suit)}` +
          (a.announceBela === true ? ` ${this.t.withBela}` : '')
        );
    }
  }
}

export const LOCALE_IDS: LocaleId[] = ['hr', 'sr-Cyrl', 'en'];
