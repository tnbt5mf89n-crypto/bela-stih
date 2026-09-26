import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
  type CSSAnimationProperties,
} from 'react-native-reanimated';
import { useCountUp } from './anim/useCountUp';
import type { TableCue } from './table/cues';
import { illegalReason } from './table/illegal';
import { coachTip, stigljaWatch, type CoachTip } from './table/coach';
import { wrongCardLines, wrongCardOf, type WrongCard } from './table/wrongCard';
import { summarize, type MatchLog, type MatchSummary } from './matchLog';
import type {
  Action,
  Card,
  DealProgress,
  DealScoreResult,
  PublicView,
  Seat,
  Suit,
  TeamId,
  TrickPlay,
} from '@belot/engine';
import { cardId, detectDeclarations, teamOf } from '@belot/engine';
import type { Lang } from '@belot/i18n';
import { levelProgress, type Award, type GiftId, type PlayerProfile } from '@belot/progression';
import { Anchor, AnchorHost, useAnchors, type AnchorMap } from './anim/AnchorRegistry';
import { EffectsOverlay } from './anim/EffectsOverlay';
import { REVEAL_MS } from './anim/director';
import { RevealRow } from './table/RevealRow';
import { xpFillSteps, type XpFillStep, type XpShown } from './table/xpFill';
import { REVEAL_EXIT_MS, type RevealPhase } from './table/revealTiming';
import { COIN_CASCADE_DELAY_MS, coinCascadeCount, coinsLandedMs, MATCH_CASCADE_HOLD_MS } from './anim/lifetimes';
import { isMatchAward } from './feedback';
import { useLaggedNumber } from './ui/useLaggedNumber';
import { anchorId, metaId, type FxBus } from './anim/FxBus';
import { SeatPuck } from './table/SeatPuck';
import {
  CARD_ASPECT,
  FAN_PAD,
  fanArc,
  fitHand,
  fitTrickCross,
  seatAt,
  seatPosition,
  slotOffsets,
  type Position,
} from './table/geometry';
import { useTableMetrics } from './table/useTableMetrics';
import { EMOTE_TOGGLE, FAN_REST_SHORT, LAND_GAP, LAND_TRAY_H, PUCK_NAME_ROOM, SELF_NESTLE, SELF_PUCK_GAP } from './table/metrics';
import { useHandOrder, type HandSort } from './table/useHandOrder';
import { callsOnTable } from './table/calls';
import { pickAnnouncement } from './table/zvanja';
import { BOT_AVATARS } from './table/bots';
import type { ConfirmPlay } from './storage';
import { cardLang, cosmetics, room, roomStyle, type DeckStyle } from './cosmetics';
import { PerfProbe } from './dev/PerfProbe';
import { EmoteStrip } from './table/EmoteStrip';
import { GiftPicker } from './table/GiftPicker';
import { MicButton, TakeClock } from './table/MicButton';
import { HandReview } from './table/HandReview';
import { SpeakingLine } from './table/SpeakingLine';
import type { VoiceMic } from './voice/useVoiceRecorder';
import { useTurnCues } from './table/useTurnCues';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { HoldPanel, useNow } from './table/HoldPanel';
import type { TableHold } from './net/hold';
import { setBackGuard } from './ui/backGuard';
import { useLeaveWarning } from './ui/webBack';
import { blindZvanja, coaches, explainsRefusals, freePlay, modeName, type PlayMode } from './playMode';
import { FeltArt, RIM_W } from './table/FeltArt';
import { garb } from './deck/palette';

/** The coach's floating advice is never wider than this. */
const COACH_FLOAT_MAX = 220;
/** `styles.felt` padding: the cloth's margin inside the rim. Pinned with the border and margin. */
const FELT_PAD = 5;
/** A refused tap's "no" (a forbidden card, an emote too soon): a whisper of the server's. */
const DENIED_SOFT = 0.45;
/** How long a sent play may go unanswered before the hand takes taps again. */
const SENT_MAX_MS = 6000;
import { PlayingCard } from './PlayingCard';
import { CardBackFace, SuitPip } from './deck';
import { playSfx } from './audio';
import { pattern } from './haptics';
import { Button } from './ui/Button';
import { Check, Close, Coin, Crown, Eye, Pause, Star } from './ui/icons';
import { EmoteFace } from './emoteArt';
import { PressScale } from './ui/PressScale';
import { font, ink, num, radius, space, stroke, surface, team, theme, type, spring } from './theme';
import { isPartner, seatTone } from './table/teamColour';

/**
 * The table, drawn from one seat's point of view — the social-poker layout:
 * opponents as avatar pucks with countdown rings, the felt in the middle with a
 * trick slot per seat, your hand fanned at the bottom, and a transparent
 * effects overlay on top for everything that flies.
 *
 * Purely presentational and seat-agnostic: it renders a `PublicView` (which,
 * during animations, is the director's paced view) and a set of legal actions,
 * and knows nothing about where they came from. Offline and online render
 * through exactly this component.
 */

export interface SeatMeta {
  name: string;
  /** Preset avatar id; missing or unknown falls back to the initial letter. */
  avatar?: string | null;
  bot: boolean;
  connected: boolean;
  /**
   * A bot and nobody else: no person ever sat here. There is nobody to hide
   * or report. (A dropped player a bot stands in for is not one of these.)
   */
  pureBot?: boolean;
  /**
   * A person whose app sent an install ID (1.6.0), so a block of them can be
   * kept. An older app's seat has none: a block would only hide them at this
   * table, while the button promises it for good, so it is not offered.
   */
  blockable?: boolean;
}

export interface TableScreenProps {
  mySeat: Seat;
  lang: Lang;
  view: PublicView;
  options: Action[];
  myTurn: boolean;
  settled: boolean;
  matchOver: boolean;
  lastDealResult: DealScoreResult | null;
  matchScores: readonly [number, number];
  winnerTeam: TeamId | null;
  profile: PlayerProfile;
  banner: Award | null;
  /** Per-seat presence; falls back to relative labels for missing entries. */
  seatMeta?: (SeatMeta | null)[];
  status?: string | null;
  /** The status line is an error (a refused move): danger ink, read out at once. */
  statusIsError?: boolean;
  /** The seat whose move is being animated right now — presentation only, never `toAct`. */
  spotlightSeat?: Seat | null;
  /** The motion policy: no loops, no springs, fades only. */
  reducedMotion?: boolean;
  /** What the table does in reaction to the current beat: a nod, a shake, a glow. */
  cue?: TableCue | null;
  /** The dealer's button is flying to the next puck: no puck shows its own "D" meanwhile. */
  dealerHop?: boolean;
  anchors: AnchorMap;
  fxBus: FxBus;
  /** Absolute epoch deadline for the active seat's ring; null = soft ring. */
  turnDeadline?: number | null;
  turnTotalMs?: number;
  onAction: (a: Action) => void;
  onNext: () => void;
  onFinish: () => void;
  finishLabel: string;
  /** When set, the emote tray is available and sends through here. */
  onEmote?: (id: string) => void;
  /** Rematch flow (online): the series score and the accept controls. */
  /** How the player wants the hand laid out; persisted in Settings. */
  handSort?: HandSort;
  /**
   * Show the arranging tip at the first quiet moment of this match. The
   * callback hears when it was shown (false) or the long-press was found (true).
   */
  arrangeTip?: boolean;
  onArrangeTip?: (learned: boolean) => void;
  /** Misclick guard; 'ambiguous' (default) only asks when the card is a choice. */
  confirmPlay?: ConfirmPlay;
  /**
   * Online: a play is answered by the server's echo, a round trip later. The
   * tapped card acknowledges the tap at once and holds until the echo (or a
   * refusal, counted in `refusedN`), so a second tap sends nothing.
   */
  awaitEcho?: boolean;
  refusedN?: number;
  series?: readonly [number, number] | null;
  askedRematch?: boolean;
  waitingFor?: number;
  onRematch?: () => void;
  /** The rematch button's words: "Igraj opet" unless given (offline says "Nova partija"). */
  rematchLabel?: string;
  onForceRematch?: () => void;
  /**
   * Online, at a scored deal: when the next deal starts by itself, whether I
   * have said I am ready, and who is still reading. Absent offline, where the
   * one player at the table deals when they like.
   */
  nextDeal?: NextDealInfo;
  /**
   * A private table standing still (online): paused, or waiting for a friend
   * whose connection dropped. With the handlers only where they are allowed.
   */
  hold?: TableHold | null;
  onPause?: () => void;
  onResume?: () => void;
  onPlayOn?: () => void;
  /** Online: this device is off the line and getting back into its seat. */
  reconnecting?: boolean;
  /**
   * The version played (playMode.ts). Učenje: the app finds the zvanja and
   * coaches. Lagana: zvanja and bela are the player's to find, a wrong card is
   * refused. Prava bela: the same, and every card is tappable - a wrong one is
   * a renons the engine punishes.
   */
  playMode?: PlayMode;
  /** Points the match is played to: 1001, or what a private table's host chose. */
  matchTarget?: number;
  /** The deals of the match so far, for the match-end summary (matchLog.ts). */
  matchLog?: MatchLog;
  /** Each seat's latest table gift (useGifts). */
  gifts?: readonly (GiftId | null)[];
  /** Gifts that have landed on each seat, so each landing bounces once. */
  giftLanded?: readonly number[];
  /** Who gave each seat its gift, for the announcement when one lands on me. */
  giftFrom?: readonly (Seat | null)[];
  /** My gift cooldown: no gift before this instant. */
  giftReadyAt?: number;
  /** When set, the pucks open the gift picker, and a gift is sent through here. */
  onGift?: (id: GiftId, to: Seat | 'table') => unknown;
  /** Online: who can be given a gift, seat by seat (an older app cannot). Offline: everyone. */
  giftReach?: readonly boolean[];
  /** Online: players hidden on this device (their seat, never their name). */
  hidden?: readonly Seat[];
  /** Online: hide or show a player again (local only). */
  onHide?: (s: Seat, hide: boolean) => void;
  /** Online: report a player (the player's own e-mail). */
  onReport?: (s: Seat) => void;
  /** Online: block a player for good on this device (identity.ts); hides them here too. */
  onBlock?: (s: Seat) => void;
  /**
   * Online, where voice is on (the table's switch and the player's own): the
   * mic is offered, driving the online screen's recorder.
   */
  mic?: VoiceMic;
  /** What became of my last voice message (sending, sent, who has heard it), said beside the mic. */
  micStatus?: string | null;
  /** How the mic works (Settings): held while speaking, or tapped to start and tapped to send. */
  voiceMode?: 'hold' | 'tap';
  /** Seats whose voice message is playing now: their pucks send out waves. */
  speaking?: readonly Seat[];
  /** Online: players whose voice is muted on this device, and the switch for it. */
  muted?: readonly Seat[];
  onMute?: (s: Seat, mute: boolean) => void;
}

/** A landscape rail holds the mic beside the faces' 40 dp toggle only at this size (railW is 79 at its narrowest). */
const RAIL_MIC = 34;
/** The gaps between the toggle and the mic: the portrait row's and the rail's. */
const ROW_GAP = 8;
const RAIL_GAP = 4;
/** The results sheet's voice bar: a 40 dp mic and two short lines beside it. */
const VOICE_BAR_H = 60;

/** How long touches are swallowed after the table shuts the gift picker by itself. */
export const GIFT_SHIELD_MS = 400;
/** How long the last trick stays up after "Zadnji štih" is tapped. */
export const PEEK_MS = 4000;
/** The narrowest peek chip that still carries its name; below it, an eye. */
export const PEEK_TEXT_W = 44;

export function TableScreen(props: TableScreenProps) {
  const {
    mySeat, lang, view, options, myTurn, settled, matchOver, lastDealResult,
    matchScores, winnerTeam, profile, banner, seatMeta, status, statusIsError = false, anchors, fxBus, spotlightSeat = null,
    reducedMotion = false,
    cue = null,
    dealerHop = false,
    turnDeadline = null, turnTotalMs, onAction, onNext, onFinish, finishLabel, onEmote,
    playMode = 'easy', matchTarget = 1001, matchLog, series, askedRematch, waitingFor, onRematch, onForceRematch, rematchLabel,
    nextDeal, hold: tableHold = null, onPause, onResume, onPlayOn, reconnecting = false,
    handSort = 'auto', arrangeTip = false, onArrangeTip, confirmPlay = 'ambiguous', awaitEcho = false, refusedN = 0,
    gifts, giftLanded, giftFrom, giftReadyAt = 0, onGift, giftReach, hidden, onHide, onReport, onBlock,
    mic, micStatus = null, voiceMode = 'hold', speaking, muted, onMute,
  } = props;

  // Every dimension the table draws is derived from the real window, so eight
  // cards fit one row on a 320dp phone, grow on a tablet, and rearrange into
  // three columns when the phone is turned on its side.
  const m = useTableMetrics();
  const land = m.orientation === 'landscape';
  const reduced = reducedMotion;
  // A match's award waits for the fanfare (see the screens' cascade timers).
  const awardHold = banner && isMatchAward(banner) ? MATCH_CASCADE_HOLD_MS : 0;
  // As many coins as the game sends flying for this award: the wallet waits for the last.
  const awardCoins = coinCascadeCount(banner?.coins ?? 0);
  // The fan swells a hair over a long press, so the hold reads as "something
  // is about to happen" rather than as a dead tap.
  const hold = useSharedValue(1);
  const holdStyle = useAnimatedStyle(() => ({ transform: [{ scale: hold.value }] }));
  // Kontra rattles the table: three quick cycles, ±3 (±5 for rekontra),
  // scaled with the layout. Off under reduce-motion.
  const feltShake = useSharedValue(0);
  const feltShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: feltShake.value }] }));
  // Played once per cue, by its `n` alone: keyed on the layout scale as well,
  // a rotation with the štiglja cue still current replayed the burst and the
  // shake over the result sheet. Everything else is read through refs.
  const cueRef = useRef(cue);
  cueRef.current = cue;
  const scaleRef = useRef(m.scale);
  scaleRef.current = m.scale;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  // ...and only a cue newer than this mount: a reconnect remounts the table
  // with the last cue still current.
  const seenCue = useRef(cue?.n ?? 0);
  useEffect(() => {
    const c = cueRef.current;
    if (!c || c.n === seenCue.current) return;
    seenCue.current = c.n;
    if (reducedRef.current) return;
    if (c.kind === 'stiglja') {
      const at = anchors.centre(anchorId.deck);
      if (at) fxBus.emit({ kind: 'burst', at, count: 40 });
    }
    if (c.kind !== 'shake' && c.kind !== 'stiglja') return;
    const a = (c.kind === 'stiglja' ? 6 : c.amp) * scaleRef.current;
    feltShake.value = withSequence(
      withTiming(a, { duration: 40 }),
      withTiming(-a, { duration: 80 }),
      withTiming(a, { duration: 80 }),
      withTiming(-a * 0.6, { duration: 80 }),
      withTiming(0, { duration: 60 }),
    );
  }, [cue?.n, feltShake, anchors, fxBus]);

  // The fan's layout numbers, for the dealt backs to land on the real cards.
  useEffect(() => {
    anchors.setMeta(metaId.handWidth, m.handWidth);
    anchors.setMeta(metaId.handCardMax, m.handCardMax);
    anchors.setMeta(metaId.handReveal, m.handReveal);
  }, [anchors, m.handWidth, m.handCardMax]);

  // The trick cross is sized against the felt it is drawn in, not the window:
  // a landscape felt is a short wide ellipse and window-sized cards hang out
  // through its rim. Measured, because the felt is what flex left over.
  const [feltBox, setFeltBox] = useState({ w: 0, h: 0 });
  const slot = useMemo(
    () => fitTrickCross(feltBox.w, feltBox.h, m.slotH),
    [feltBox.w, feltBox.h, m.slotH],
  );
  const slots = useMemo(() => slotOffsets(slot.slotW, slot.slotH), [slot.slotW, slot.slotH]);

  // "Zadnji štih": the last full trick, remembered from the views already
  // shown - the view itself carries only the trick in play. Each full trick
  // replaces the one before; the count it was taken at says whether it is
  // still the last one (a new deal, or a flushed batch, and it is not).
  const lastTrick = useRef<{ plays: readonly TrickPlay[]; after: number } | null>(null);
  if (view.currentTrick.length === 4 && view.dealProgress) {
    lastTrick.current = { plays: view.currentTrick, after: view.dealProgress.tricksPlayed + 1 };
  }
  // Offered on my turn only: that is when it helps, and the table waits.
  const peekable =
    view.phase === 'PLAY' &&
    myTurn &&
    !settled &&
    lastTrick.current !== null &&
    lastTrick.current.after === view.dealProgress?.tricksPlayed;
  const [peeking, setPeeking] = useState(false);
  useEffect(() => {
    if (!peekable) setPeeking(false);
  }, [peekable]);
  useEffect(() => {
    if (!peeking) return;
    const t = setTimeout(() => setPeeking(false), PEEK_MS);
    return () => clearTimeout(t);
  }, [peeking]);
  // The chip sits in the free middle of the trick's cross (slotOffsets: the
  // side cards start gapX from the centre), clear of their rings - which
  // stand 3 outside a card - by 4 more on each side.
  const peekW = Math.min(56, 2 * Math.round(slot.slotW * (31 / 46)) - 14);
  // While looked at, the last trick stands in the slots, and the card that
  // took it is ringed: whoever took it leads the trick now in play.
  const shownTrick = peeking && peekable ? lastTrick.current!.plays : view.currentTrick;

  const [arrangingOn, setArranging] = useState(false);
  // The zvanja round: you mark the cards that make up your combination, then
  // confirm. The engine is the judge — a marking that is not a real zvanje
  // announces nothing, so this can never claim more than the hand holds.
  const [marked, setMarked] = useState<string[]>([]);
  // The version's switches: who finds the zvanja and bela, whether any card
  // may be sent (a wrong one then costs the deal), and whether the coach speaks.
  const blind = blindZvanja(playMode);
  const cardsFree = freePlay(playMode);
  const coach = coaches(playMode);
  const explainsRef = useRef(explainsRefusals(playMode));
  explainsRef.current = explainsRefusals(playMode);
  const declaring = !settled && view.declareTurn === mySeat;
  // The zvanja question takes the taps (they mark), so arranging is off while
  // it is asked - from its very first frame - and closed by it (see below).
  const arranging = arrangingOn && !declaring;
  // Is the marking made of zvanja this hand holds - one, or all of them at
  // once? In normal play the app already knows them, so it arms the button
  // only on real combinations rather than letting the engine bounce a mistake
  // back as an error, and sends ONE of them: the engine announces the whole
  // holding from any one (table/zvanja.ts). In blind mode it stays armed
  // regardless - the app refuses to spot them for you there, so an honest miss
  // is the whole point.
  //
  // What a marking is checked against. Učenje: the zvanja the engine spotted
  // for this hand. Lagana: the hand's own, worked out here - the player finds
  // and marks them, and is told when a marking is not one, so an honest slip
  // does not throw them away. Prava bela: nothing, and a wrong claim forfeits.
  const checkedAgainst = useMemo(
    () => (playMode === 'hard' ? null : blind ? detectDeclarations(view.hand, mySeat) : view.myDeclarations),
    [playMode, blind, view.hand, view.myDeclarations, mySeat],
  );
  const announcement = pickAnnouncement(
    view.hand.filter((c) => marked.includes(cardId(c))),
    checkedAgainst,
    mySeat,
  );
  const markingIsZvanje = checkedAgainst === null || announcement !== null;
  // Two marked at once read as two: the hint says so rather than "that is a zvanje".
  const markedWhole =
    checkedAgainst === null
      ? 0
      : checkedAgainst.filter((d) => d.cards.every((c) => marked.includes(cardId(c)))).length;
  const toggleMark = useCallback(
    (id: string) =>
      setMarked((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id])),
    [],
  );
  // A fresh question gets a clean slate.
  useEffect(() => {
    if (!declaring) setMarked([]);
  }, [declaring, view.dealer, view.declareTurn]);
  const hand = useHandOrder(view.hand, view.context.trumpSuit, handSort, view.dealer);
  // A rotation remounts the fan (the two orientations place it in different
  // rows); the hold's swell lives here and must not outlast the pressed view,
  // whose press-out never comes once it is gone.
  useEffect(() => {
    hold.value = 1;
  }, [land, hold]);

  // Is the table asking me something right now? The prompt rows' own
  // conditions — and a bid, whose buttons wrap to three lines on a phone.
  const bidding = options.some((a) => a.type === 'BID_CALL' || a.type === 'BID_PASS');
  // The bela buttons are an answer in every mode; only their hint is hard mode's to skip.
  const belaOffered = !settled && view.canAnnounceBela;
  const askingBesidesArranging =
    bidding ||
    declaring ||
    (!settled && !declaring && view.mustDeclare && view.myDeclarations.length > 0) ||
    (!settled && view.canDeclare === true) ||
    (belaOffered && !blind);
  const asking = askingBesidesArranging || arranging;

  // Učenje's coach. On my turn: what to do and why - the bots' own choice for
  // this hand (table/coach.ts). A bid's advice floats over the empty felt,
  // since the bid's buttons already take the room a row would need. In play
  // it is a row of its own from the first card to the last, so the felt does
  // not move under it every turn: my move and why, or between my turns what
  // to watch - štiglja as it stands, or the trumps. Sideways there is no
  // height for a row (the felt gave it, and the partner on the far rim sat on
  // the trick): there the advice floats in play too, on my turn only, over my
  // own slot, which is empty then.
  const tip = useMemo(
    () => (coach && myTurn && !settled ? coachTip(view, mySeat, options) : null),
    [coach, myTurn, settled, view, mySeat, options],
  );
  const tipText = (t: CoachTip): string =>
    t.kind === 'call'
      ? lang.s.ui.coachCall(lang.suitName(t.suit), t.count, t.jack, t.nine, t.forced)
      : t.kind === 'pass'
        ? lang.s.ui.coachPass
        : lang.s.ui.coachPlay(t.why, lang.cardName(t.card), t.bela);
  const coachPlaying = coach && !settled && view.phase === 'PLAY';
  const watch = coachPlaying ? stigljaWatch(view, mySeat) : null;
  const floatTip =
    tip === null
      ? null
      : tip.kind !== 'play'
        ? tipText(tip)
        : land
          ? watch !== null
            ? `${tipText(tip)} ${lang.s.ui.coachStiglja(watch === 'us')}`
            : tipText(tip)
          : null;
  const coachLine = !coachPlaying || land
    ? null
    : tip !== null && tip.kind === 'play'
      ? tipText(tip)
      : watch !== null
        ? lang.s.ui.coachStiglja(watch === 'us')
        : view.context.trumpSuit !== null
          ? lang.s.ui.coachWatch(lang.suitName(view.context.trumpSuit))
          : null;
  // Second to every question: the row steps aside while one is asked, and
  // while the hand is arranged (whose hint then takes the row's place).
  const coachRowUp = coachLine !== null && !askingBesidesArranging;
  const coachShown = coachRowUp && !arranging;

  // A short phone sheds the rows that are no use while it asks — or while the
  // bela buttons are up, hard mode included, or the coach's row — so the
  // buttons that answer stay on the screen (see metrics' shortColumn).
  const shed = m.shortColumn && (asking || belaOffered || coachShown);
  // And portrait's short column is built tighter throughout (metrics'
  // SHORT_CHROME counts every style this switches on).
  const short = !land && m.shortColumn;
  // A short column arranges in the faces' own slot when the faces were on
  // screen: they give way to it, so nothing moves. When a question had already
  // shed them, a new row under the fan would lift the fan under the finger, so
  // the hint asks above the fan instead, where the felt pays for it.
  // Nor when the coach's row had shed them: its hint takes that row's place.
  const arrangeInSlot =
    short && arranging && !askingBesidesArranging && !belaOffered && !settled && !!onEmote && !coachRowUp;

  // The tray closes on send; the cooldown mirrors the server's rate limit so
  // a spammed tap dies here instead of being silently dropped over the wire.
  const [trayOpen, setTrayOpen] = useState(false);
  // Landscape keeps the faces in a fixed box in the right rail's free gap,
  // measured below. A question whose buttons leave that gap too short for it
  // (a four- or five-button bid on a phone held sideways; two two-line bela
  // buttons on the shortest rails) takes the room: the box gives way, as
  // portrait's short column sheds its strip, the tray shuts with it, and the
  // toggle rests until the question is answered. Portrait's toggle rests the
  // same way while a short column has shed the faces: there is no strip for
  // the phrases to open into.
  const [trayFits, setTrayFits] = useState(false);
  const trayShown = land ? trayFits : !shed;
  // What is drawn: never an open tray behind a resting toggle, even when a
  // press that began before the box gave way ends after it.
  const trayOpenShown = trayOpen && trayShown;
  useEffect(() => {
    if (!trayShown) setTrayOpen(false);
  }, [trayShown]);
  // Every entry into landscape measures afresh: a fit left over from before a
  // turn to portrait would draw the box, for a frame, over a bid's buttons.
  useEffect(() => {
    if (!land) setTrayFits(false);
  }, [land]);
  // The box and a question's buttons trade places under a finger, both ways:
  // for a moment after the box gives way a tap aimed at a face must not land
  // as a bid, and for a moment after it comes back a second tap on the bid
  // must not land as a face.
  const railQuietUntil = useRef(0);
  const faceQuietUntil = useRef(0);
  const boxWasUp = useRef(false);
  const boxUp = land && trayFits;
  useLayoutEffect(() => {
    if (land && boxWasUp.current && !boxUp && !settled) railQuietUntil.current = Date.now() + 300;
    if (land && !boxWasUp.current && boxUp && !settled) faceQuietUntil.current = Date.now() + 300;
    boxWasUp.current = boxUp;
  }, [land, boxUp, settled]);
  // Online, one answer per question. A play or a bid is answered by the
  // server's echo a round trip later, and a second tap in that gap sent a
  // second answer the server refused - the "denied" sound and a red line for
  // a tap that had worked. The echo (the options moving on) or a refusal
  // opens the question again.
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const optionsKey = JSON.stringify(options);
  // When the answer on its way went (0: none). It says whether a tap was
  // sent, so the hand fades a card only for a play that really went, and it
  // lets go after the same silence the hand does (SENT_MAX_MS).
  const answeredAt = useRef(0);
  useEffect(() => {
    answeredAt.current = 0;
  }, [optionsKey, refusedN]);
  const send = useCallback(
    (a: Action): boolean => {
      if (awaitEcho) {
        if (answeredAt.current !== 0 && Date.now() - answeredAt.current < SENT_MAX_MS) return false;
        answeredAt.current = Date.now();
      }
      onActionRef.current(a);
      return true;
    },
    [awaitEcho],
  );
  const answer = useCallback(
    (a: Action) => {
      if (Date.now() >= railQuietUntil.current) send(a);
    },
    [send],
  );

  // Prava bela sends a card the rules do not allow, and the deal is lost for
  // it. What it was, and what could have gone, is remembered as it goes: the
  // sheet then says so. Only my own - another hand is never seen - and gone
  // with the next deal.
  const wrongCard = useRef<WrongCard | null>(null);
  const playView = useRef({ options, trick: view.currentTrick, trump: view.context.trumpSuit });
  playView.current = { options, trick: view.currentTrick, trump: view.context.trumpSuit };
  const play = useCallback(
    (a: Action): boolean => {
      if (!send(a)) return false;
      if (cardsFree) {
        const { options: now, trick, trump } = playView.current;
        const wrong = wrongCardOf(a, now, trick, trump);
        if (wrong) wrongCard.current = wrong;
      }
      return true;
    },
    [send, cardsFree],
  );
  useEffect(() => {
    if (view.phase === 'BID') wrongCard.current = null;
  }, [view.phase]);

  // Normal play asks no question with only one answer. The app knows the
  // hand's zvanja: with none it says "Nemam" itself, a beat later so the table
  // reads as having asked; with some it marks them ready - one tap on
  // "Prijavi", or unmark to keep them quiet, which is still the player's call.
  // Prava bela asks exactly as before: spotting them yourself is the point.
  // Nine deals of nine asked "Imaš li zvanja?" of a hand with nothing in it.
  const autoSkipping = declaring && !blind && view.myDeclarations.length === 0;
  const askedFor = useRef<string | null>(null);
  const autoSkip = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!declaring || blind) return;
    const key = `${view.dealer}:${view.hand.map(cardId).join(',')}`;
    if (askedFor.current === key) return;
    askedFor.current = key;
    if (view.myDeclarations.length === 0) {
      // Not tied to this effect's cleanup: the view changes identity on every
      // update, and a timer cancelled by a re-run would never fire again.
      autoSkip.current = setTimeout(() => {
        autoSkip.current = null;
        onActionRef.current({ type: 'DECLARE_SKIP', seat: mySeat });
      }, 650);
      return;
    }
    setMarked([...new Set(view.myDeclarations.flatMap((d) => d.cards.map(cardId)))]);
  }, [declaring, blind, view.dealer, view.hand, view.myDeclarations, mySeat]);
  // The question went away by itself: no late answer.
  useEffect(() => {
    if (declaring || autoSkip.current === null) return;
    clearTimeout(autoSkip.current);
    autoSkip.current = null;
  }, [declaring]);
  useEffect(
    () => () => {
      if (autoSkip.current !== null) clearTimeout(autoSkip.current);
    },
    [],
  );

  // Leaving a match in progress asks first — from the leave button in the top
  // corner, from the result sheet between deals, and from Android's back. A
  // finished match leaves at once: there is nothing left to lose.
  const [leaving, setLeaving] = useState(false);
  const requestLeave = useCallback(() => {
    if (matchOver) onFinish();
    else setLeaving(true);
  }, [matchOver, onFinish]);
  // A match that ends under an open question closes it: offline the same
  // button then means "a new match", and "Napusti" must not start one.
  useEffect(() => {
    if (matchOver) setLeaving(false);
  }, [matchOver]);
  const leavingRef = useRef(leaving);
  leavingRef.current = leaving;

  // The gift picker: opened from a puck (mine is "treat the table"). It shuts
  // when my turn comes, when the sheet goes up, on back, and once sent — a
  // gift is never in the way of a decision.
  const [giftTarget, setGiftTarget] = useState<Seat | 'table' | null>(null);
  const giftTargetRef = useRef(giftTarget);
  giftTargetRef.current = giftTarget;
  // Online, a room that marks nobody as able to see gifts — not even me,
  // who joined saying I can — is an older server: no gifts at all there.
  const giftable = !!onGift && (giftReach?.[mySeat] ?? true) && !settled && !arranging && !leaving;
  // Hiding and reporting are not gifts and do not wait for a gift's moment:
  // the sheet at the end of a deal or a match is exactly when a player wants
  // them, so another player's puck opens the player view even then. (The
  // rules page and the compliance checklist both promise it without a
  // condition.) My own puck stays a gift-only puck.
  const moderatable = !!onHide && !!onReport && !leaving;
  // Whatever shuts the picker — the table (my turn, the sheet) or a tap on
  // send, close or beside it — shuts it under a finger that may be coming
  // down again, and under the picker lie the fan and the question's
  // buttons. For a moment after, a touch lands on nothing (the shield below),
  // so a tap meant for a gift never plays a card or answers for me. Only
  // Android back, which is no touch, closes it without.
  const [giftShield, setGiftShield] = useState(false);
  // Which of the two the open panel is showing. The table owns it, not the
  // picker: it has to know whether the panel is a gift grid (whose moment can
  // pass) or a player view someone is in the middle of.
  const [moderating, setModerating] = useState(false);
  const moderatingRef = useRef(moderating);
  moderatingRef.current = moderating;
  const shutGifts = useCallback(() => {
    if (giftTargetRef.current === null) return;
    setGiftTarget(null);
    setModerating(false);
    setGiftShield(true);
  }, []);
  useEffect(() => {
    if (!giftShield) return;
    const t = setTimeout(() => setGiftShield(false), GIFT_SHIELD_MS);
    return () => clearTimeout(t);
  }, [giftShield]);
  // A gift grid whose moment has passed goes - it would otherwise sit over the
  // result sheet with a live "Pošalji" and spend coins the table no longer
  // allows. A player view stays: nobody should lose a report half-made.
  useEffect(() => {
    if (!giftable && !(moderatable && moderatingRef.current)) shutGifts();
  }, [giftable, moderatable, shutGifts]);
  const myTurnWas = useRef(myTurn);
  useEffect(() => {
    if (myTurn && !myTurnWas.current && !moderatingRef.current) shutGifts();
    myTurnWas.current = myTurn;
  }, [myTurn, shutGifts]);
  const openGifts = useCallback(
    (target: Seat | 'table') => {
      if (target === 'table' ? !giftable : !giftable && !moderatable) return;
      setTrayOpen(false);
      // No gift to be sent at this moment: the panel IS the player view.
      setModerating(!giftable && target !== 'table');
      setGiftTarget(target);
    },
    [giftable, moderatable],
  );
  const matchOverRef = useRef(matchOver);
  matchOverRef.current = matchOver;
  // On the web, closing the tab or reloading mid-match asks first.
  useLeaveWarning(!matchOver);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  useEffect(() => {
    setBackGuard(() => {
      if (giftTargetRef.current !== null) {
        setGiftTarget(null); // back closes the picker; nothing was spent
        return true;
      }
      if (leavingRef.current) {
        setLeaving(false); // back answers the question safely
        return true;
      }
      // A finished match: back leaves exactly as the sheet's "Natrag" does —
      // online through leave(), which settles a gift still waiting for its
      // echo before the home screen reads the profile back.
      if (matchOverRef.current) {
        onFinishRef.current();
        return true;
      }
      setLeaving(true);
      return true;
    });
    return () => setBackGuard(null);
  }, []);
  const emoteReadyAt = useRef(0);
  // A tap inside the cooldown, counted, so the strip can shake for it.
  const [emoteShake, setEmoteShake] = useState(0);
  const sendEmote = (id: string) => {
    // The second tap of a bid, landing on the face that just came back.
    if (Date.now() < faceQuietUntil.current) return;
    if (!onEmote) return;
    // Too soon after the last one: it used to shut the tray and send nothing,
    // which read as sent. Now the strip shakes, the phone buzzes, and the
    // tray stays open for the retry.
    if (Date.now() < emoteReadyAt.current) {
      playSfx('denied', { gain: DENIED_SOFT });
      pattern('error');
      setEmoteShake((n) => n + 1);
      return;
    }
    setTrayOpen(false);
    emoteReadyAt.current = Date.now() + 2500;
    // No sound here: the pop belongs to the bubble, which follows the echo.
    onEmote(id);
  };

  // A gift landing on me is said aloud; the badge itself is decoration.
  const myLandings = giftLanded?.[mySeat] ?? 0;
  const seenMyLandings = useRef(myLandings);
  useEffect(() => {
    if (myLandings === seenMyLandings.current) return;
    seenMyLandings.current = myLandings;
    const id = gifts?.[mySeat];
    const from = giftFrom?.[mySeat];
    if (!id || from == null) return;
    AccessibilityInfo.announceForAccessibility(lang.s.ui.giftReceived(lang.s.ui.giftName(id), meta(from).name));
    // meta is re-derived each render; the landing count alone decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myLandings]);

  // Bela runs counter-clockwise, so the seat that acts AFTER me sits on my
  // RIGHT. Pucks and trick slots read the same map, so they can never drift
  // apart and fly a card to the wrong side of the table.
  const at = (pos: Position) => seatAt(pos, mySeat);

  const meta = (s: Seat): SeatMeta =>
    seatMeta?.[s] ?? {
      name: lang.seat(s, mySeat),
      avatar: s === mySeat ? null : BOT_AVATARS[s],
      bot: s !== mySeat,
      connected: true,
    };

  /**
   * A puck that opens the gift picker (for its seat, or the table for mine).
   * With gifts switched off (the server's switch), another person's puck still
   * opens the player view: hiding, blocking, muting and reporting are not
   * gifts. Decided from the props, not `moderatable`, so that leaving never
   * swaps a puck between wrapped and bare, which would remount it.
   */
  const giftPress = (s: Seat, child: ReactElement) => {
    if (!onGift && (s === mySeat || !onHide || !onReport || seatMeta?.[s]?.pureBot)) return child;
    const id = gifts?.[s] ?? null;
    return (
      <PressScale
        disabled={s === mySeat ? !giftable : !giftable && !moderatable}
        onPress={() => openGifts(s === mySeat ? 'table' : s)}
        accessibilityRole="button"
        // The button hides the puck's own parts from a screen reader, so it
        // says them all: who deals, the cards, the tricks, the gift.
        accessibilityLabel={lang.s.ui.giftPuckLabel({
          name: meta(s).name,
          dealer: view.dealer === s && !dealerHop,
          cards: view.handCounts[s] ?? 0,
          tricks: view.dealProgress?.tricksWon[teamOf(s)] ?? 0,
          gift: id ? lang.s.ui.giftName(id) : null,
        })}
        accessibilityHint={
          s === mySeat
            ? giftable
              ? lang.s.ui.giftTreatTable
              : undefined
            : giftable
              ? onReport
                ? lang.s.ui.playerHint
                : lang.s.ui.giftHint
              : moderatable
                ? lang.s.ui.playerHint
                : undefined
        }
        scaleTo={0.95}
      >
        {child}
      </PressScale>
    );
  };

  const puck = (s: Seat) => (
    <Animated.View
      entering={reduced ? undefined : ZoomIn.delay(((s - mySeat + 4) % 4) * 60).duration(220)}
    >
    {giftPress(s, <SeatPuck
      seat={s}
      name={meta(s).name}
      avatar={meta(s).avatar}
      cards={view.handCounts[s]}
      isDealer={view.dealer === s && !dealerHop}
      isBot={meta(s).bot}
      connected={meta(s).connected}
      // Who is on turn - and while moves are being replayed (the in-between
      // views carry no actor, by design, so nothing can be played mid-drain),
      // whoever's move is being shown. Without that, no seat was marked for
      // most of a deal while the bots played.
      active={view.toAct === s || (view.toAct === null && spotlightSeat === s)}
      tone={seatTone(s, mySeat)}
      partner={isPartner(s, mySeat)}
      size={m.puck}
      // The clock is the real actor's only - never on a move being replayed.
      deadline={view.toAct === s ? turnDeadline : null}
      totalMs={turnTotalMs}
      thinking={spotlightSeat === s}
      reduced={reduced}
      gesture={cue && (cue.kind === 'nod' || cue.kind === 'pulse') && cue.seat === s ? cue : null}
      tricks={view.dealProgress?.tricksWon[teamOf(s)] ?? 0}
      gift={gifts?.[s] ?? null}
      giftN={giftLanded?.[s] ?? 0}
      speaking={speakingSeats.has(s)}
    />)}
    </Animated.View>
  );

  // Who speaks: the clip playing now (online), and me while I record.
  const recording = mic?.phase === 'recording';
  const speakingSeats = useMemo(() => {
    const set = new Set<Seat>(speaking ?? []);
    if (recording) set.add(mySeat);
    return set;
  }, [speaking, recording, mySeat]);
  // A dimmed card, tapped: say which duty rules it out, over my hand, the way
  // a partner across the table would. The follow-suit case carries the led
  // suit's pip, so no suit name has to be declined.
  const trickRef = useRef(view.currentTrick);
  trickRef.current = view.currentTrick;
  const trumpRef = useRef(view.context.trumpSuit);
  trumpRef.current = view.context.trumpSuit;
  const explainIllegal = useCallback(
    (card: Card, legal: Card[]) => {
      const why = illegalReason(card, legal, trickRef.current, trumpRef.current);
      if (why === null) return;
      playSfx('denied', { gain: DENIED_SOFT });
      pattern('error');
      const ui = lang.s.ui;
      const text =
        why.kind === 'follow'
          ? `${ui.mustFollow}: ${lang.suitName(why.suit)}`
          : why.kind === 'trump'
            ? ui.mustTrump
            : why.kind === 'beat'
              ? ui.mustBeat
              : ui.moveRefused;
      // Said aloud too: the bubble is a picture to a screen reader. There the
      // suit is named, since its pip cannot be seen.
      AccessibilityInfo.announceForAccessibility(text);
      // Lagana leaves it at the card's shake and the soft sound: the player
      // asked for no bubble there. Učenje says why - it is there to teach.
      if (!explainsRef.current) return;
      const at = anchors.centre(anchorId.seat(mySeat));
      if (!at) return;
      fxBus.emit({
        kind: 'bubble',
        at,
        text: why.kind === 'follow' ? ui.mustFollow : text,
        tone: 'plain',
        duration: 2200,
        speed: 1,
        ...(why.kind === 'follow' ? { pip: why.suit } : {}),
        fade: reducedRef.current,
      });
    },
    [anchors, fxBus, lang, mySeat],
  );

  // The long-press that arranges the hand is found by accident or never: say
  // it once a match, over the hand, at the first moment nothing is asked of
  // me and the cards are all in. Offered in two matches at most, and not at
  // all once the player has done it (App keeps the count in Settings).
  const arrangeTipRef = useRef(arrangeTip);
  arrangeTipRef.current = arrangeTip;
  const onArrangeTipRef = useRef(onArrangeTip);
  onArrangeTipRef.current = onArrangeTip;
  const tipSaid = useRef(false);
  // The hold that starts (or ends) arranging, on the fan or on a card of it.
  // Not while the zvanja are asked: there a tap marks, and the two prompts
  // would each say something different about the same tap.
  const declaringRef = useRef(declaring);
  declaringRef.current = declaring;
  const toggleArranging = useCallback(() => {
    if (declaringRef.current) return;
    playSfx('hold');
    pattern('longPress');
    setArranging((a) => !a);
    // Found: the tip has nothing left to teach.
    if (arrangeTipRef.current) onArrangeTipRef.current?.(true);
  }, []);
  // A question arriving mid-arrangement closes it: a hold that began just
  // before the zvanja were asked used to leave both open.
  useEffect(() => {
    if (declaring) setArranging(false);
  }, [declaring]);
  const tipMoment =
    arrangeTip && !tipSaid.current && !settled && !asking && !myTurn && hand.cards.length >= 6 && giftTarget === null && !leaving;
  useEffect(() => {
    if (!tipMoment) return;
    // Held a moment, so a deal still landing or a turn about to come skips it.
    const t = setTimeout(() => {
      const at = anchors.centre(anchorId.seat(mySeat));
      if (!at || tipSaid.current) return;
      tipSaid.current = true;
      fxBus.emit({
        kind: 'bubble',
        at,
        text: lang.s.ui.arrangeTip,
        tone: 'plain',
        duration: 4200,
        speed: 1,
        fade: reducedRef.current,
      });
      onArrangeTipRef.current?.(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [tipMoment, anchors, fxBus, lang, mySeat]);

  // A ring of light bursts from the hand as a cue lands — the sound's
  // visible twin, fired from the very same edge so it can never be held on.
  const pulseHand = useCallback(() => {
    if (reducedRef.current) return;
    const at = anchors.centre(anchorId.seat(mySeat));
    if (at) fxBus.emit({ kind: 'pulse', at, speed: 1 });
  }, [anchors, fxBus, mySeat]);
  // The clock's two ticks, 5 s and 2 s before it plays for me: the same ring
  // in the countdown's red, twice at the last warning.
  const warnHand = useCallback(
    (urgent: boolean) => {
      if (reducedRef.current) return;
      const at = anchors.centre(anchorId.seat(mySeat));
      if (!at) return;
      fxBus.emit({ kind: 'pulse', at, speed: 1, tone: 'warn' });
      if (urgent) setTimeout(() => fxBus.emit({ kind: 'pulse', at, speed: 1, tone: 'warn' }), 260);
    },
    [anchors, fxBus, mySeat],
  );

  // Your turn, your call, your clock running out.
  useTurnCues({
    myTurn,
    mustDeclare: view.mustDeclare,
    canDeclare: view.canDeclare === true,
    deadline: turnDeadline,
    settled,
    onTurnEdge: pulseHand,
    onDeclareEdge: pulseHand,
    onClockWarn: warnHand,
  });

  const trump = view.context.trumpSuit;
  const baize = roomStyle(profile.selectedFelt);
  // Read once per render and passed down: the memoised cards must see a deck
  // change as a changed prop, not peek at module state and miss it.
  const deck = cosmetics().deckStyle;
  // Dev-only frame/render probe, toggled by long-pressing the profile bar.
  const [probe, setProbe] = useState(false);
  const toggleProbe = useCallback(() => setProbe((p) => !p), []);

  // ---------------------------------------------------------------------
  // The pieces, built once and placed by whichever layout is in force. Both
  // orientations render the SAME nodes, so every anchor stays single-sourced
  // and a rotation cannot leave sprites flying to a slot that moved.
  // ---------------------------------------------------------------------

  // The cards come DOWN again after a few seconds. Remembering what was shown is
  // part of playing the game well — leaving them up would turn that memory into
  // a reference sheet. A tap puts them away early for anyone who reads faster.
  const revealKey = view.revealedDeclarations
    .flatMap((d) => d.cards.map((c) => cardId(c)))
    .join('|');
  // showing → leaving (the cards fly back) → gone (unmounted): the exit starts
  // REVEAL_EXIT_MS before REVEAL_MS so the row is empty when it comes down; a
  // tap starts the same exit early. All UI timers, cancelled on unmount.
  const [revealPhase, setRevealPhase] = useState<RevealPhase>('gone');
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearRevealTimers = () => {
    for (const t of revealTimers.current) clearTimeout(t);
    revealTimers.current = [];
  };
  const leaveReveal = useCallback(
    (inMs: number) => {
      clearRevealTimers();
      revealTimers.current = [
        setTimeout(() => {
          setRevealPhase('leaving');
          playSfx('revealDown');
          // Counted from the exit that started, not the one that was due: a
          // late timer on a busy JS thread must not shorten the window.
          revealTimers.current.push(setTimeout(() => setRevealPhase('gone'), REVEAL_EXIT_MS));
        }, inMs),
      ];
    },
    [],
  );
  useEffect(() => {
    if (revealKey === '') return;
    setRevealPhase('showing');
    leaveReveal(REVEAL_MS - REVEAL_EXIT_MS);
    return clearRevealTimers;
  }, [revealKey, leaveReveal]);

  // The winning side's combinations, laid out for everyone. Only ever the
  // winner's: the losing side said its number and keeps its cards. A group
  // never wraps, so its cards shrink until the longest one fits the table.
  const revealLongest = Math.max(1, ...view.revealedDeclarations.map((d) => d.cards.length));
  const revealCardW = Math.min(
    Math.round(m.slotW * 1.1),
    Math.floor((m.width - 24 - 16 - 2 * (revealLongest - 1)) / revealLongest),
  );
  const revealRow =
    view.revealedDeclarations.length > 0 && revealPhase !== 'gone' ? (
      <RevealRow
        declarations={view.revealedDeclarations}
        cardW={revealCardW}
        deckStyle={deck}
        label={(d) => `${meta(d.seat).name}: ${lang.declaration(d)}`}
        sideOf={(d) => seatPosition(d.seat, mySeat)}
        phase={revealPhase}
        reduced={reduced}
        onTap={() => {
          if (revealPhase === 'showing') leaveReveal(0);
        }}
      />
    ) : null;

  // Trump, multiplier and who called it: a plate on the baize in portrait,
  // a row in the left rail in landscape (the trick cross fills a sideways
  // felt from rim to rim, and a plate anywhere on it covered a slot).
  // A wooden plate in the rim's own wood, lit on top and shaded underneath.
  // Bidding: three tiny backs and the question. Called: the pip on a cream
  // disc, and the ×2 / ×4 as a badge beside it.
  // The sprite anchor is the disc (or the mini fan before a call), not the
  // plate: a stamp centred on the plate landed under the disc, on the caller
  // line.
  const plaque = (
    <View
      style={[
        styles.plaque,
        land ? styles.plaqueRail : styles.plaquePortrait,
        { backgroundColor: baize.rim, borderTopColor: baize.rimLight, borderBottomColor: baize.rimDark },
      ]}
      accessibilityLabel={trump ? undefined : lang.s.trumpUndecided}
    >
      <View style={styles.plaqueRow}>
        {trump ? (
          <>
            <Anchor id={anchorId.plaque} style={styles.plaqueDisc}>
              <SuitPip suit={trump} size={24} />
            </Anchor>
            {view.multiplier > 1 && (
              <View style={styles.multBadge}>
                <Text style={styles.plaqueMult} maxFontSizeMultiplier={1.3}>×{view.multiplier}</Text>
              </View>
            )}
          </>
        ) : (
          <>
            <Anchor id={anchorId.plaque} style={styles.miniFan}>
              {[-16, 0, 16].map((deg, i) => (
                <View key={deg} style={[styles.miniBack, i > 0 && styles.miniBackNext, { transform: [{ rotate: `${deg}deg` }] }]}>
                  <CardBackFace width={13} variant={cosmetics().cardBack} />
                </View>
              ))}
            </Anchor>
            <Text style={styles.plaqueUndecided} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {lang.s.trumpQuestion}
            </Text>
          </>
        )}
      </View>
      {/* Who called trump, always — in the rail over two lines if it must. A
          short phone once dropped the line for room, and then nobody could
          read who had called. */}
      {view.callerSeat !== null && (
        <Text style={styles.plaqueCaller} numberOfLines={land ? 2 : 1} maxFontSizeMultiplier={1.3}>
          {view.callerSeat === mySeat ? lang.s.calledByYou : lang.s.calledBy(meta(view.callerSeat).name)}
        </Text>
      )}
    </View>
  );

  const feltBody = (
    <Animated.View
      entering={reduced ? undefined : Platform.OS === 'web' ? FadeIn.duration(240) : feltEntering}
      style={[
        styles.felt,
        feltShakeStyle,
        // Landscape hangs the partner over the far rim, so the felt starts
        // just below their disc rather than below their whole puck.
        land && { marginTop: Math.round(m.puck * 0.5) },
        // A short column drops the margin; its floor is lower by as much.
        short && styles.feltFlush,
      ]}
    >
      {/* the table itself, drawn under everything: rim, baize, bevel */}
      <FeltArt
        width={feltBox.w + 2 * (RIM_W + FELT_PAD)}
        height={feltBox.h + 2 * (RIM_W + FELT_PAD)}
        room={baize}
        lit={myTurn && !settled}
        inset={RIM_W}
      />
      <View
        style={styles.feltInner}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setFeltBox((b) =>
            Math.abs(b.w - width) < 1 && Math.abs(b.h - height) < 1 ? b : { w: width, h: height },
          );
          // The felt is the only row that flexes: when a prompt or the result
          // sheet resizes it, every slot and puck inside has moved without its
          // own layout changing. Tell the anchors.
          anchors.bump();
        }}
      >
        {/* the deck: cards are dealt from the felt's centre, whichever way up
            the table is — the plaque moves to the left lobe in landscape. */}
        <Anchor id={anchorId.deck} style={styles.deckAnchor} />


        {/* one trick slot per seat, positioned by table side */}
        {([0, 1, 2, 3] as Seat[]).map((s) => {
          const pos = seatPosition(s, mySeat);
          const played = shownTrick.find((p) => p.seat === s);
          // The card that took the last trick, while it is looked at.
          const took = peeking && peekable && s === view.trickLeader;
          return (
            <Anchor
              key={s}
              id={anchorId.slot(s)}
              style={[
                styles.slot,
                { width: slot.slotW, height: slot.slotH },
                slots[pos],
                // NB: nothing else goes in this array. `slots[pos]` places the
                // card with marginLeft / marginTop, and react-native-web emits
                // a `margin` shorthand as real CSS, which resets both of them:
                // a `margin: -2` composed here once put all four played cards
                // on the same pixel in the browser. Decoration is a child.
              ]}
            >
              {played ? (
                <>
                  <PlayingCard card={played.card} width={slot.slotW} deckStyle={deck} locale={lang.id} />
                  {/* Whose card this is, at a glance. Drawn OUTSIDE the card: a
                      border on the slot itself sat under the card's own edge
                      and was never actually seen. */}
                  <View
                    pointerEvents="none"
                    style={[styles.slotRing, { borderColor: seatTone(s, mySeat).edge }, took && styles.slotRingTook]}
                  />
                </>
              ) : (
                <SlotGhost
                  colour={seatTone(s, mySeat).edge}
                  side={pos}
                  breathing={spotlightSeat === s}
                  reduced={reduced}
                />
              )}
            </Anchor>
          );
        })}
        {peekable && (
          <PressScale
            onPress={() => setPeeking((p) => !p)}
            hitSlop={8}
            accessibilityLabel={lang.s.ui.peekLastTrick}
            accessibilityState={{ expanded: peeking }}
            style={[
              styles.peek,
              // Centred on the cross: two lines of words stand 38 tall, the eye 26.
              { width: peekW, marginLeft: -peekW / 2, marginTop: peekW >= PEEK_TEXT_W ? -19 : -13 },
              peeking && styles.peekOn,
            ]}
          >
            {/* Its name where it fits ("zadnji" alone is about 33 wide at the
                caption size), an eye where it does not: small phones and
                the landscape felt leave 26-28 between the side cards. */}
            {peekW >= PEEK_TEXT_W ? (
              <Text style={[styles.peekText, peeking && styles.peekTextOn]} maxFontSizeMultiplier={1.3}>{lang.s.ui.lastTrick}</Text>
            ) : (
              <Eye size={16} colour={peeking ? theme.accent : ink.mid} />
            )}
          </PressScale>
        )}
      </View>
    </Animated.View>
  );

  // A bid's advice stays between the side players' discs, clear of their
  // badges (the dealer's D matters while bidding): the felt, the row's two
  // gaps and the room each puck keeps beside its disc, less 10 a side. On a
  // 360 dp Samsung that is about 190; 220 at most anywhere.
  const bidFloatW =
    feltBox.w > 0 ? Math.min(COACH_FLOAT_MAX, Math.round(feltBox.w + 2 * (RIM_W + FELT_PAD) + 2 * 4 + PUCK_NAME_ROOM - 2 * 10)) : COACH_FLOAT_MAX;

  // Rows that appear for a moment — the zvanja reveal, the award — float
  // over the lower table instead of pushing the hand down. Over the whole
  // table area, not the felt: the felt's inner width on a phone is 140-184px
  // and a four-card sequence needs 190.
  const tableFloat = (
    <>
      {/* While the zvanja are up the table dims a little, so the cards read. */}
      {revealRow !== null && <View style={styles.revealScrim} pointerEvents="none" />}
      <View style={styles.tableFloat} pointerEvents="box-none">
        {revealRow}
        {floatTip !== null && revealRow === null && !land && (
          <View style={[styles.coachFloat, { maxWidth: bidFloatW }]} pointerEvents="none" accessibilityLiveRegion="polite">
            <Text style={styles.coachFloatTitle} maxFontSizeMultiplier={1.3}>{lang.s.ui.coachTitle}</Text>
            <Text style={styles.coachFloatText} maxFontSizeMultiplier={1.3}>{floatTip}</Text>
          </View>
        )}
      </View>
      {/* Sideways the felt is short and wide: the advice is one low, wide line
          (two at most), under the side players' cards, over my empty slot. */}
      {floatTip !== null && revealRow === null && land && (
        <View style={styles.coachFloatLandBox} pointerEvents="none">
          <View style={[styles.coachFloat, styles.coachFloatLand]} accessibilityLiveRegion="polite">
            <Text style={styles.coachFloatLandText} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              <Text style={styles.coachLabel} maxFontSizeMultiplier={1.3}>{lang.s.ui.coachTitle}: </Text>
              {floatTip}
            </Text>
          </View>
        </View>
      )}
    </>
  );

  const felt = land ? (
    // Sideways there is no room for a row above the table AND a row below it,
    // so the partner sits on the far rim the way they would at a real table.
    <View
      style={[styles.tableArea, { maxHeight: m.feltMaxHeight }]}
      onLayout={() => anchors.bump()}
    >
      <View style={styles.midRow}>
        <View style={styles.sideSeat}>{puck(at('left'))}</View>
        {feltBody}
        <View style={styles.sideSeat}>{puck(at('right'))}</View>
      </View>
      <View style={styles.landTopSeat} pointerEvents="box-none">
        {puck(at('top'))}
      </View>
      {tableFloat}
    </View>
  ) : (
    <View
      style={[styles.tableArea, { minHeight: m.feltMinHeight, maxHeight: m.feltMaxHeight }]}
      // A row above the felt moves the whole area without resizing the felt
      // inside it; this frame changes even when feltInner's does not.
      onLayout={() => anchors.bump()}
    >
      {/* The plaque sits beside the partner's puck: the felt's upper lobe is
          15–35px tall on a phone and a plate there covered the top slot. */}
      <View style={styles.topSeat}>
        {puck(at('top'))}
        {plaque}
      </View>
      <View style={styles.midRow}>
        <View style={styles.sideSeat}>{puck(at('left'))}</View>
        {feltBody}
        <View style={styles.sideSeat}>{puck(at('right'))}</View>
      </View>
      {tableFloat}
    </View>
  );

  // The zvanja as chips, only while the table is still being asked: said
  // once, at the start of the deal, then the players' to remember. The round's
  // close hands over to the reveal row, and bela never has a chip (see
  // table/calls.ts). Gone with the deal too: they once hung over the result sheet.
  const spokenCalls = callsOnTable(view);
  // A short column writes each call as a tally, the caller over the call,
  // side by side: three calls take one row where they took three lines. The
  // call itself is never cut — the rank at its end is the tie-break.
  const callChip = (key: number, name: string, call: string) =>
    short ? (
      <View
        key={key}
        style={[styles.callChip, short && styles.callChipShort]}
        accessible
        accessibilityLabel={`${name}: ${call}`}
      >
        <Text style={styles.callChipName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {name}
        </Text>
        <Text style={styles.callChipCall} maxFontSizeMultiplier={1.3}>{call}</Text>
      </View>
    ) : (
      <View key={key} style={[styles.callChip, land && styles.callChipLand]}>
        <Text style={[styles.callChipText, land && styles.callChipTextLand]} maxFontSizeMultiplier={1.3}>
          {name}: {call}
        </Text>
      </View>
    );
  const calls =
    !settled && spokenCalls.length > 0 ? (
      <View style={[styles.callsRow, land && styles.callsCol, short && styles.callsRowShort]}>
        {spokenCalls.map((d, i) => callChip(i, meta(d.seat).name, lang.declaration(d)))}
      </View>
    ) : null;

  // Prompts that need words, not just buttons. A short column's are tighter,
  // and it asks one thing at a time, the first of these. Its arrange hint takes
  // the faces' slot under my puck when the faces were showing (arrangeInSlot),
  // and otherwise asks here, second only to the zvanja question.
  const promptRow = [styles.promptRow, short && styles.promptRowShort];
  const promptText = [styles.promptText, short && styles.promptLineShort];
  const promptHint = [styles.promptHint, short && styles.promptLineShort];
  const promptList = [
    declaring && (
      <View key="zvanja" style={promptRow}>
        <Text style={promptText} maxFontSizeMultiplier={1.3}>{lang.s.askZvanja}</Text>
        <Text style={promptHint} maxFontSizeMultiplier={1.3}>
          {autoSkipping
            ? lang.s.noZvanjaHere
            : marked.length === 0
            ? lang.s.markZvanjaHint
            : checkedAgainst === null
            ? // Prava bela checks nothing, so it says nothing about the marking.
              lang.s.markingUnchecked
            : markingIsZvanje
              ? markedWhole > 1
                ? lang.s.markingOkMany
                : lang.s.markingOk
              : lang.s.markingNotZvanje}
        </Text>
      </View>
    ),
    short && arranging && !arrangeInSlot && (
      <View key="arrange" style={[promptRow, short && styles.promptInline, coachRowUp && styles.coachRowShort]}>
        <Text style={[promptText, short && styles.promptInlineText]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
          {lang.s.ui.arrangeHint}
        </Text>
        <Button label={lang.s.ui.arrangeDone} tone="strong" compact onPress={() => setArranging(false)} />
      </View>
    ),
    !settled && !declaring && view.mustDeclare && view.myDeclarations.length > 0 && (
      <View key="declarations" style={promptRow}>
        <Text style={promptText} maxFontSizeMultiplier={1.3}>
          {lang.s.declarations}:{' '}
          {view.myDeclarations.map((d) => lang.declaration({ ...d, seat: mySeat })).join(', ')}
        </Text>
        {!m.compact && <Text style={promptHint} maxFontSizeMultiplier={1.3}>{lang.s.declareHint}</Text>}
      </View>
    ),
    // Asked already by the zvanja question above: the same question twice
    // took a whole row and pushed Prijavi and Nemam under Android's buttons.
    !settled && !declaring && view.canDeclare === true && (
      <View key="claim" style={promptRow}>
        <Text style={promptHint} maxFontSizeMultiplier={1.3}>{lang.s.claimZvanjaHint}</Text>
      </View>
    ),
    arranging && !short && (
      <View key="arrange" style={promptRow}>
        <Text style={promptText} maxFontSizeMultiplier={1.3}>{lang.s.ui.arrangeHint}</Text>
        <Button label={lang.s.ui.arrangeDone} tone="strong" onPress={() => setArranging(false)} />
      </View>
    ),
    !settled && view.canAnnounceBela && !blind && (
      <View key="bela" style={[promptRow, coach && !land && (short ? styles.coachRowShort : styles.coachRow)]}>
        <Text style={promptText} maxFontSizeMultiplier={1.3}>{lang.s.belaHint}</Text>
      </View>
    ),
    // Two lines, always: the row keeps one height whatever it says.
    coachShown && (
      <View key="coach" style={[promptRow, short ? styles.coachRowShort : styles.coachRow]}>
        <Text style={[promptHint, styles.coachText]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
          <Text style={styles.coachLabel} maxFontSizeMultiplier={1.3}>{lang.s.ui.coachTitle}: </Text>
          {coachLine}
        </Text>
      </View>
    ),
  ].filter((p): p is ReactElement => Boolean(p));
  const promptRows = <>{short ? promptList.slice(0, 1) : promptList}</>;
  // Portrait reserves the row's height where the column can afford it, so a
  // prompt coming or going never moves the hand under your thumb; a shorter
  // phone cannot spare it, and landscape flexes the felt instead.
  const prompts = m.promptReserve ? <View style={styles.promptsReserve}>{promptRows}</View> : promptRows;

  // My hand, fanned; the seat anchor for sprites sits underneath it.
  const handBlock = (
    <Anchor id={anchorId.seat(mySeat)} style={[styles.handArea, { minHeight: m.handMinHeight }, short && styles.handNestle]}>
      <Pressable
        // The hand, named: a screen reader says what the block is, and the
        // device harness finds the fan by it wherever the layout moves it.
        accessibilityLabel={lang.s.yourCards}
        onLongPress={toggleArranging}
        delayLongPress={500}
        onPressIn={() => {
          hold.value = withTiming(reduced ? 1 : 1.02, { duration: 500 });
        }}
        onPressOut={() => {
          hold.value = withTiming(1, { duration: 150 });
        }}
      >
        <Animated.View style={holdStyle}>
        <Hand
          cards={hand.cards}
          options={options}
          enabled={myTurn}
          onPlay={play}
          freePlay={cardsFree}
          width={m.handWidth}
          maxCardW={m.handCardMax}
          reveal={m.handReveal}
          arranging={arranging}
          onSwap={hand.swap}
          // On my turn the cards take the touch, so the hold has to be theirs
          // too: it used to end as a tap, and a tap plays.
          onHold={toggleArranging}
          marking={declaring}
          marked={marked}
          onToggleMark={toggleMark}
          confirmPlay={confirmPlay}
          awaitEcho={awaitEcho}
          refusedN={refusedN}
          deckStyle={deck}
          locale={lang.id}
          reduced={reduced}
          armCaption={lang.s.ui.play}
          glow={cue?.kind === 'glow' ? cue : null}
          restFloor={short ? FAN_REST_SHORT : 0}
          onIllegal={explainIllegal}
        />
        </Animated.View>
      </Pressable>
    </Anchor>
  );

  // My own puck: the same disc as everyone else's, a shade smaller, with my
  // clock on it — centred under my fan in portrait, beside it in landscape.
  // Its anchor is NOT the seat's: the hand is where my cards fly from and to.
  const selfPuck = giftPress(
    mySeat,
    <SeatPuck
      seat={mySeat}
      name={meta(mySeat).name}
      avatar={meta(mySeat).avatar ?? cosmetics().avatar}
      cards={view.handCounts[mySeat]}
      isDealer={view.dealer === mySeat && !dealerHop}
      isBot={false}
      connected={meta(mySeat).connected}
      active={view.toAct === mySeat}
      tone={seatTone(mySeat, mySeat)}
      size={m.selfPuck}
      deadline={myTurn ? turnDeadline : null}
      totalMs={turnTotalMs}
      // The "thinking" pulse is for the others' moves. Mine is the turn itself,
      // from the RENDERED turn prop, so it is never held on across a drain.
      thinking={false}
      yourTurn={myTurn && !settled}
      // Under the fan the disc is plainly mine and the row's height is the
      // scarce thing; beside the fan in landscape there is room for the name.
      showName={land}
      reduced={reduced}
      gesture={cue && (cue.kind === 'nod' || cue.kind === 'pulse') && cue.seat === mySeat ? cue : null}
      tricks={view.dealProgress?.tricksWon[teamOf(mySeat)] ?? 0}
      anchored={false}
      gift={gifts?.[mySeat] ?? null}
      giftN={giftLanded?.[mySeat] ?? 0}
      speaking={speakingSeats.has(mySeat)}
    />,
  );

  // A fixed box — portrait's 34px row, landscape's 74x114 in the rail — so
  // opening or shutting it never reflows the felt.
  const emotes =
    !settled && onEmote ? (
      <EmoteStrip lang={lang} open={trayOpenShown} dimmed={myTurn} vertical={land} onSend={sendEmote} shakeN={emoteShake} />
    ) : null;

  // "Prijavi" / "Nemam" — the two answers, and nothing else while the table is
  // waiting on you.
  const declareButtons = declaring && !autoSkipping ? (
    <>
      <Button
        label={lang.s.declareMarked}
        testID="declare-announce"
        tone={marked.length >= 3 && markingIsZvanje ? 'strong' : 'plain'}
        compact={land}
        onPress={() => {
          if (marked.length < 3 || !markingIsZvanje || announcement === null) return;
          answer({ type: 'DECLARE_ANNOUNCE', seat: mySeat, cards: announcement });
        }}
      />
      <Button
        label={lang.s.noneToDeclare}
        testID="declare-skip"
        tone="plain"
        compact={land}
        onPress={() => answer({ type: 'DECLARE_SKIP', seat: mySeat })}
      />
    </>
  ) : null;

  // Push-to-talk, beside the faces' toggle, in the row's spare room: offered
  // only while the table asks nothing (a bid's or bela's buttons need the
  // row) and a short column has not shed its strip - so no layout budget
  // changes. Its hook stays while hidden: a take cut off by a question goes.
  // Sideways it sits beside the toggle in the rail, where the rail is wide
  // enough (not on the shortest screens held sideways).
  const micFits = !land || m.railW >= RAIL_MIC + 4 + EMOTE_TOGGLE;
  const micShown = !asking && !belaOffered && !shed && micFits;
  // The end of a deal or a match is when people talk: the results sheet has
  // a mic of its own (its voice bar). A take in the making when the deal
  // ends keeps going - the row stays, under the sheet, with its mic under the
  // finger, until the finger lifts (a held take) or the sheet's mic sends it
  // (a tapped one); the sheet's mic shows it recording meanwhile.
  const heldOver = settled && mic !== undefined && mic.phase !== 'idle';
  const micInRow = mic !== undefined && ((micShown && !settled) || heldOver);
  const micOnSheet = mic !== undefined && settled;
  // No mic anywhere (a question took the row): a take in the making goes -
  // what was said, was said. The recorder is OnlineGame's and outlives both.
  const finishTake = mic?.finish;
  useEffect(() => {
    if (!micInRow && !micOnSheet) void finishTake?.(true);
  }, [micInRow, micOnSheet, finishTake]);
  // A question hides the mic, and the words over it: what becomes of my
  // message meanwhile ("Čuje te Marko") is said over my hand instead, each
  // new word once - a word already shown beside the mic is not said again.
  const micHidden = mic !== undefined && !micInRow && !micOnSheet;
  const statusSeen = useRef<string | null>(null);
  useEffect(() => {
    const was = statusSeen.current;
    statusSeen.current = micStatus;
    if (!micHidden || micStatus === null || micStatus === was || micStatus === lang.s.ui.voiceSending) return;
    const at = anchors.centre(anchorId.seat(mySeat));
    if (at) fxBus.emit({ kind: 'bubble', at, text: micStatus, tone: 'plain', duration: 2200, speed: 1, fade: reducedRef.current });
    // Only a new word, or the mic going, says anything; the rest is read as it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micHidden, micStatus]);
  // Tapped to start: a cross throws the take away, in the faces' toggle's
  // place (the faces wait while I speak), so nothing in the row moves.
  const tapTake = voiceMode === 'tap' && mic?.phase === 'recording';
  const micCancel = (size: number, hitSlop: number | { top: number; bottom: number; left: number; right: number }) => (
    <PressScale
      onPress={() => void mic?.finish(false)}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={lang.s.ui.micCancel}
      style={[styles.micCancel, { width: size, height: size }]}
    >
      <Close size={Math.round(size * 0.4)} />
    </PressScale>
  );
  // Where the toggle was before there was a mic, it stays: in portrait the
  // mic is left of it and a spacer as wide balances the centred row; sideways
  // it is right of the toggle, which keeps the rail's left edge. Each touch
  // area reaches the gap's middle and no further.
  const micButton = micInRow ? (
    <MicButton
      lang={lang}
      size={land ? RAIL_MIC : EMOTE_TOGGLE}
      phase={mic.phase}
      startedAt={mic.startedAt}
      mode={voiceMode}
      status={micStatus}
      captionAlign={land ? 'end' : 'center'}
      hitSlop={land ? { top: 8, bottom: 8, left: RAIL_GAP / 2, right: 8 } : { top: 8, bottom: 8, left: 8, right: ROW_GAP / 2 }}
      onStart={() => void mic.start()}
      onFinish={(send) => void mic.finish(send)}
    />
  ) : null;
  // The results sheet's voice bar: its mic, and beside it who is speaking
  // (their pucks are under the sheet), then the take's clock, what became of
  // my message, or what the mic does.
  const otherSpeaker = (speaking ?? []).find((s) => s !== mySeat) ?? null;
  const voiceBar = micOnSheet ? (
    <View style={styles.voiceBar}>
      <MicButton
        lang={lang}
        size={EMOTE_TOGGLE}
        phase={mic.phase}
        startedAt={mic.startedAt}
        mode={voiceMode}
        caption="none"
        hitSlop={8}
        onStart={() => void mic.start()}
        onFinish={(send) => void mic.finish(send)}
      />
      {tapTake && micCancel(EMOTE_TOGGLE, 8)}
      <View style={styles.voiceBarWords}>
        {otherSpeaker !== null && <SpeakingLine words={lang.s.ui.voiceSpeaking(meta(otherSpeaker).name)} reduced={reduced} />}
        {mic.phase === 'recording' ? (
          <TakeClock startedAt={mic.startedAt} style={styles.voiceBarText} />
        ) : micStatus ? (
          <Text style={styles.voiceBarText} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {micStatus}
          </Text>
        ) : otherSpeaker === null ? (
          <Text style={styles.voiceBarHint} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {voiceMode === 'tap' ? lang.s.ui.voiceBarHintTap : lang.s.ui.voiceBarHintHold}
          </Text>
        ) : null}
      </View>
    </View>
  ) : null;

  const emoteToggle = onEmote ? (
    <PressScale
      onPress={() => {
        if (trayShown) setTrayOpen((o) => !o);
      }}
      hitSlop={
        !micButton ? 8 : land ? { top: 8, bottom: 8, left: 8, right: RAIL_GAP / 2 } : { top: 8, bottom: 8, left: ROW_GAP / 2, right: 8 }
      }
      // Resting while a question has the box's room: no click, no tray.
      disabled={!trayShown}
      accessibilityLabel={lang.s.ui.emoteToggle}
      accessibilityState={{ expanded: trayOpenShown }}
      style={[styles.emoteToggle, trayOpenShown && styles.emoteToggleOn]}
    >
      {trayShown ? (
        <EmoteFace id="smile" size={24} />
      ) : (
        // Greyed on a child: PressScale's animated opacity overrides its own.
        <View style={styles.emoteToggleIdle} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <EmoteFace id="smile" size={24} />
        </View>
      )}
    </PressScale>
  ) : null;

  // Leaving: a top corner, away from every button a thumb reaches for
  // mid-deal, and a question before it acts. A finished match's own sheet
  // says what comes next, so the corner is empty then.
  const leaveButton = !matchOver ? (
    <Button label={finishLabel} testID="leave" tone="plain" compact style={short ? styles.leaveSlim : undefined} onPress={requestLeave} />
  ) : null;
  // Private tables only, and only while there is a match to stop: a phone
  // rings, one tap, and the table waits for everyone.
  const pauseButton =
    onPause && !matchOver && tableHold === null && !reconnecting ? (
      <PressScale
        onPress={onPause}
        accessibilityRole="button"
        accessibilityLabel={lang.s.ui.pauseLabel}
        hitSlop={6}
        style={[styles.pauseButton, short && styles.pauseButtonSlim]}
      >
        <Pause size={short ? 14 : 16} />
      </PressScale>
    ) : null;

  // Every row that comes and goes around the felt — status line, zvanja
  // chips, a prompt — moves the pucks, slots and hand
  // without any of them changing their own layout (and on the web onLayout
  // is a ResizeObserver: a pure move fires nothing). Re-measure after each
  // such commit, so the next sprite flies to where things are now.
  const reflowKey = [
    // The text itself, not just its presence: a second line moves things too.
    status ?? '',
    spokenCalls.length,
    declaring ? 1 : 0,
    !settled && !declaring && view.mustDeclare && view.myDeclarations.length > 0 ? 1 : 0,
    arranging ? 1 : 0,
    !settled && view.canAnnounceBela && !blind ? 1 : 0,
    // Hard mode's bela buttons shed rows too, with no hint row of their own.
    shed ? 1 : 0,
  ].join('|');
  useEffect(() => {
    anchors.bump();
  }, [anchors, reflowKey]);

  // "Pregled ruke": the deal's tricks from the public history, over the result sheet.
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    if (!settled) setReviewing(false);
  }, [settled]);
  const reviewable = settled && !!view.history && view.history.tricks.length > 0;
  const lostMatch = matchOver && winnerTeam !== null && winnerTeam !== teamOf(mySeat);
  const resultSheet = settled ? (
    <Animated.View
      style={[styles.resultBackdrop, lostMatch && styles.resultBackdropLost]}
      pointerEvents="box-none"
      // Under "Pregled ruke" the sheet steps out for a screen reader, as the
      // table does (the layer below): the review's accessibilityViewIsModal is
      // iOS-only, and TalkBack and the web reach whatever is not hidden outright.
      aria-hidden={reviewing}
      entering={reduced ? undefined : FadeIn.duration(220)}
    >
      <DealResult
        lang={lang}
        mySeat={mySeat}
        reduced={reduced}
        maxHeight={Math.round(m.height * 0.92)}
        result={lastDealResult}
        matchScores={matchScores}
        matchOver={matchOver}
        award={banner}
        onReview={reviewable ? () => setReviewing(true) : undefined}
        winnerLabel={winnerTeam !== null ? lang.team(winnerTeam, mySeat) : ''}
        weWon={matchOver && winnerTeam !== null ? winnerTeam === teamOf(mySeat) : null}
        renonsText={
          lastDealResult?.renonsSeat != null
            ? lastDealResult.renonsSeat === mySeat
              ? lang.s.renonsByYou
              : lang.s.renonsBy(
                  meta(lastDealResult.renonsSeat).name,
                  teamOf(lastDealResult.renonsSeat) === teamOf(mySeat),
                )
            : null
        }
        wrongCard={
          lastDealResult?.renonsSeat === mySeat && wrongCard.current
            ? wrongCardLines(lang, wrongCard.current)
            : null
        }
        series={series}
        call={
          view.callerSeat !== null
            ? {
                name: view.callerSeat === mySeat ? null : meta(view.callerSeat).name,
                team: teamOf(view.callerSeat),
                trump: view.context.trumpSuit,
                multiplier: view.multiplier,
              }
            : null
        }
        summary={matchOver && matchLog ? summarize(matchLog, matchScores, teamOf(mySeat)) : null}
        askedRematch={askedRematch}
        waitingFor={waitingFor}
        onRematch={onRematch}
        rematchLabel={rematchLabel}
        onForceRematch={onForceRematch}
        nextDeal={nextDeal}
        onNext={onNext}
        onFinish={requestLeave}
        finishLabel={finishLabel}
        voiceBar={voiceBar}
        wide={land}
      />
    </Animated.View>
  ) : null;

  return (
    <AnchorHost map={anchors}>
      <SafeAreaView style={[styles.safe, { backgroundColor: baize.page }]} edges={['top', 'bottom', 'left', 'right']}>
        {/* A rotation or a window resize moves everything at once. */}
        <View style={[styles.root, land && styles.rootLand, short && styles.rootShort]} onLayout={() => anchors.bump()}>
          {/* The table, in one layer under the overlays after it, so that "Pregled
              ruke" can hide all of it from a screen reader at once. Never
              flattened: flipping aria-hidden on a view Fabric had flattened
              would create it, and move the whole table under a new parent. */}
          <View collapsable={false} style={[styles.layer, land && styles.layerLand, short && styles.layerShort]} aria-hidden={reviewing}>
          {land ? (
            // Turned sideways there is no vertical room to stack chrome above
            // and below the felt, so everything that is not the table itself
            // moves into the two rails and the middle keeps its full height.
            <>
              <View style={[styles.rail, { width: m.railW }]}>
                <ProfileBar profile={profile} vertical holdMs={awardHold} coinCount={awardCoins} reduced={reduced} onLongPress={toggleProbe} />
                <TableHeader
                  lang={lang}
                  mySeat={mySeat}
                  matchScores={matchScores}
                  progress={view.dealProgress}
                  vertical
                  reduced={reduced}
                  winner={matchOver ? winnerTeam : null}
                  series={series}
                  target={matchTarget}
                  mode={playMode}
                />
                {plaque}
                {calls}
              </View>

              <View style={styles.centre}>
                {status ? <Text style={[styles.status, statusIsError && styles.statusError]} role={statusIsError ? 'alert' : undefined} accessibilityLiveRegion={statusIsError ? 'assertive' : 'none'} maxFontSizeMultiplier={1.3}>{status}</Text> : null}
                {felt}
                {prompts}
                {/* My puck beside my fan, on the faces' side: between my cards
                    and the emotes, at the bottom, as portrait has it under the
                    fan. The rails have no height to spare for it. */}
                <View style={styles.landHandRow}>
                  <View style={styles.handGrow}>{handBlock}</View>
                  {selfPuck}
                </View>
              </View>

              <View style={[styles.rail, styles.railRight, { width: m.railW }]}>
                {pauseButton}
                {leaveButton}
                {/* The emote box, in the rail's free gap under the leave
                    button: never over the table. (A float here once put the
                    faces on the right-hand player's disc.) It gives way when
                    a question's buttons leave the gap shorter than the box;
                    the gap clips the one frame before it hears. */}
                <View
                  style={styles.railGap}
                  onLayout={(e) => setTrayFits(e.nativeEvent.layout.height >= LAND_TRAY_H)}
                >
                  {trayFits && emotes ? (
                    <View style={styles.traySlot} pointerEvents="box-none">
                      {emotes}
                    </View>
                  ) : null}
                </View>
                {(!settled || heldOver) && (
                  <View style={styles.actionsCol}>
                    {/* While the app answers "Nemam" itself, nothing to press:
                        the plain action list would offer the same skip again. */}
                    {settled || autoSkipping ? null : declareButtons ?? (
                      <NonCardActions options={options} lang={lang} onChoose={answer} compact />
                    )}
                    {/* The toggle keeps the rail's left edge; the mic right of it. */}
                    <View style={styles.railToggles}>
                      {tapTake && micButton ? micCancel(EMOTE_TOGGLE, { top: 8, bottom: 8, left: 8, right: RAIL_GAP / 2 }) : emoteToggle}
                      {micButton}
                    </View>
                  </View>
                )}
              </View>
            </>
          ) : (
            <>
              {/* wallet / level strip, and leaving in the top corner */}
              <View style={styles.topRow}>
                <View style={styles.topRowGrow}>
                  <ProfileBar profile={profile} slim={short} holdMs={awardHold} coinCount={awardCoins} reduced={reduced} onLongPress={toggleProbe} />
                </View>
                {pauseButton}
                {leaveButton}
              </View>
              {status && !shed ? <Text style={[styles.status, statusIsError && styles.statusError]} role={statusIsError ? 'alert' : undefined} accessibilityLiveRegion={statusIsError ? 'assertive' : 'none'} maxFontSizeMultiplier={1.3}>{status}</Text> : null}

              {/* score strip: match score, plus this deal's running count */}
              <TableHeader
                lang={lang}
                mySeat={mySeat}
                matchScores={matchScores}
                progress={view.dealProgress}
                slim={short}
                reduced={reduced}
                winner={matchOver ? winnerTeam : null}
                series={series}
                target={matchTarget}
                mode={playMode}
              />

              {felt}
              {calls}
              {prompts}
              {handBlock}
              {/* My own disc, centred under my cards and above the faces. Its
                  row lets touches through: a short column tucks it into the
                  fan's arc, under the outer cards' corners. */}
              <View style={styles.selfRow} pointerEvents="box-none">{selfPuck}</View>
              {!shed && emotes}
              {/* A short column's arrange hint takes the faces' own slot when
                  the faces were showing, so the long-press that starts
                  arranging moves nothing under the finger. */}
              {arrangeInSlot && (
                <View style={styles.arrangeSlot}>
                  <Text style={styles.arrangeSlotText} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                    {lang.s.ui.arrangeHint}
                  </Text>
                  <Button label={lang.s.ui.arrangeDone} tone="strong" compact onPress={() => setArranging(false)} />
                </View>
              )}

              {/* actions: bidding, declaring, bela — leaving is the top corner.
                  Kept (under the results sheet) while a take outlasts the deal. */}
              {(!settled || heldOver) && (
                <View style={styles.actionsRow}>
                  {micButton}
                  {tapTake && micButton ? micCancel(EMOTE_TOGGLE, { top: 8, bottom: 8, left: ROW_GAP / 2, right: 8 }) : emoteToggle}
                  {micButton && <View style={styles.micBalance} />}
                  {settled || autoSkipping ? null : declareButtons ?? (
                    <NonCardActions options={options} lang={lang} onChoose={send} short={short} />
                  )}
                </View>
              )}
            </>
          )}
          </View>

          {resultSheet}
          {reviewing && view.history && (
            <HandReview
              lang={lang}
              history={view.history}
              mySeat={mySeat}
              nameOf={(x) => meta(x).name}
              deckStyle={deck}
              ground={baize.page}
              reduced={reduced}
              onClose={() => setReviewing(false)}
            />
          )}

          {/* sprites, always last */}
          <EffectsOverlay bus={fxBus} />
          {__DEV__ && probe && <PerfProbe />}

          {/* The gift picker: an overlay, so opening it moves no row of the table.
              Without gifts it is only ever the player view, and one someone is
              in the middle of stays when the switch flips. */}
          {giftTarget !== null && (onGift || moderating) && (
            <GiftPicker
              lang={lang}
              target={giftTarget}
              mySeat={mySeat}
              reach={giftReach}
              moderating={moderating}
              onModerate={() => setModerating(true)}
              // Online, another player's puck also hides or reports them.
              moderate={
                onHide && onReport && giftTarget !== 'table' && !seatMeta?.[giftTarget]?.pureBot
                  ? {
                      hidden: hidden?.includes(giftTarget) ?? false,
                      onHide: () => {
                        const who = giftTarget;
                        const was = hidden?.includes(who) ?? false;
                        shutGifts();
                        onHide(who, !was);
                      },
                      onReport: () => onReport(giftTarget),
                      ...(onBlock && seatMeta?.[giftTarget]?.blockable
                        ? {
                            onBlock: () => {
                              const who = giftTarget;
                              shutGifts();
                              onBlock(who);
                            },
                          }
                        : {}),
                      ...(onMute && mic
                        ? {
                            muted: muted?.includes(giftTarget) ?? false,
                            onMute: () => {
                              const who = giftTarget;
                              onMute(who, !(muted?.includes(who) ?? false));
                            },
                          }
                        : {}),
                    }
                  : undefined
              }
              nameOf={(s) => meta(s).name}
              profile={profile}
              readyAt={giftReadyAt}
              land={land}
              reduced={reduced}
              ground={baize.page}
              onClose={shutGifts}
              onSend={(id, to) => {
                shutGifts();
                // Belt and braces: the grid is gone by now whenever a gift
                // cannot be sent, and a send that slipped through anyway must
                // not spend coins the table would refuse.
                if (giftable) onGift?.(id, to);
              }}
            />
          )}
          {giftShield && (
            // See giftShield: the touches of the moment after the picker shut.
            <View
              style={StyleSheet.absoluteFill}
              onStartShouldSetResponder={() => true}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            />
          )}

          {/* Not once the match is over: offline the same button then means a
              new match, and "Napusti" must never start one. */}
          {/* The table standing still: above the sheet and the pickers, because
              nothing under it can be played until it ends. */}
          {(reconnecting || tableHold !== null) && (
            <HoldPanel
              lang={lang}
              hold={tableHold}
              reconnecting={reconnecting}
              nameOf={(s) => meta(s).name}
              onResume={onResume}
              onPlayOn={onPlayOn}
              onLeave={onFinish}
              leaveLabel={finishLabel}
              ground={baize.page}
              reduced={reduced}
            />
          )}
          {leaving && !matchOver && (
            <ConfirmDialog
              title={lang.s.ui.leaveConfirm}
              confirmLabel={lang.s.ui.leaveConfirmYes}
              cancelLabel={lang.s.ui.leaveConfirmNo}
              ground={baize.page}
              reduced={reduced}
              onCancel={() => setLeaving(false)}
              onConfirm={() => {
                setLeaving(false);
                if (!matchOverRef.current) onFinish();
              }}
            />
          )}
        </View>
      </SafeAreaView>
    </AnchorHost>
  );
}

/**
 * The match score, and — while a deal is being played — the running count for
 * it, ending in the number a real table keeps in its head: how many points the
 * caller still needs.
 *
 * "Mi" is always the left pill. `matchScores` is indexed by absolute team id,
 * but which team is "us" depends on where you sit, so everything here is
 * ordered by `teamOf(mySeat)` and never by index 0/1.
 */
const TableHeader = memo(function TableHeader({
  lang,
  mySeat,
  matchScores,
  progress,
  vertical = false,
  slim = false,
  reduced = false,
  winner = null,
  series = null,
  target = 1001,
  mode = 'easy',
}: {
  lang: Lang;
  mySeat: Seat;
  matchScores: readonly [number, number];
  progress: DealProgress | null;
  /** Points the match is played to, shown between deals. */
  target?: number;
  /** The version, said beside the target: nobody is caught out by what it asks. */
  mode?: PlayMode;
  /**
   * Matches won per side since these four sat down (online; absolute team
   * ids like matchScores). Between the pills once a match has been won, so the
   * first match looks exactly as it always did.
   */
  series?: readonly [number, number] | null;
  /** Landscape puts the whole strip in the left rail, stacked. */
  vertical?: boolean;
  /** Portrait's short column: the strip on pinned lines, without its breathing room. */
  slim?: boolean;
  reduced?: boolean;
  /** The match is over and this side took it: its pill swells for a moment. */
  winner?: TeamId | null;
}) {
  const us = teamOf(mySeat);
  const them = (1 - us) as TeamId;
  // Scores count to their new value instead of jumping.
  const usScore = useCountUp(matchScores[us], 500, { reduced });
  const themScore = useCountUp(matchScores[them], 500, { reduced });
  const usRun = useCountUp(progress?.running[us] ?? 0, 350, { reduced });
  const seriesShown = series !== null && series[0] + series[1] > 0;
  const themRun = useCountUp(progress?.running[them] ?? 0, 350, { reduced });
  const swell = useSharedValue(1);
  // Only a win that arrives AFTER this header mounted swells: a rotation
  // rebuilds the header (the rail and the portrait strip are different
  // trees) with the winner already current, and must not replay it.
  const seenWinner = useRef(winner);
  useEffect(() => {
    if (winner === seenWinner.current) return;
    seenWinner.current = winner;
    if (winner === null || reduced) return;
    swell.value = withSequence(
      withTiming(1.18, { duration: 220, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 360, easing: Easing.inOut(Easing.quad) }),
    );
  }, [winner, swell, reduced]);
  const swellUs = useAnimatedStyle(() => ({ transform: [{ scale: winner === us ? swell.value : 1 }] }));
  const swellThem = useAnimatedStyle(() => ({ transform: [{ scale: winner === them ? swell.value : 1 }] }));

  // While trick 1 is open a later zvanje can still move the target, so the
  // count is shown dimmed rather than hidden — it is honest, just not final.
  // Dim while anything can still move the bar: unsettled zvanja, or a bela
  // nobody has called yet. Presenting "prošlo" at full confidence and then
  // scoring the deal as a pad is the one thing this counter must never do.
  const settling = progress !== null && (progress.provisional || progress.belaPending);
  const live = progress ? (settling ? styles.dealCountDim : styles.dealCount) : null;

  return (
    <View style={[styles.scoreRow, vertical && styles.scoreCol]}>
      <View style={[styles.pillRow, vertical && styles.pillCol]}>
        <Animated.View
          style={[styles.teamPill, slim && styles.teamPillSlim, { backgroundColor: team.usDim, borderColor: team.usEdge }, swellUs]}
        >
          <Text style={styles.pillLabel} maxFontSizeMultiplier={1.3}>{lang.team(us, mySeat)}</Text>
          <Text style={[styles.pillValue, slim && styles.pillValueSlim, { color: team.usInk }]} maxFontSizeMultiplier={1.3}>{usScore}</Text>
        </Animated.View>
        {seriesShown && (
          // Ours first, like the pills either side of it.
          <View
            style={styles.seriesChip}
            accessible
            accessibilityLabel={`${lang.s.ui.seriesScore} ${series![us]} : ${series![them]}`}
          >
            <Crown size={11} />
            <Text style={styles.seriesChipText} maxFontSizeMultiplier={1.3}>
              {series![us]}:{series![them]}
            </Text>
          </View>
        )}
        <Animated.View
          style={[styles.teamPill, slim && styles.teamPillSlim, { backgroundColor: team.themDim, borderColor: team.themEdge }, swellThem]}
        >
          {/* Side by side the two pills mirror each other around the centre;
              stacked in a rail there is no centre, so both read label, value. */}
          {vertical && <Text style={styles.pillLabel} maxFontSizeMultiplier={1.3}>{lang.team(them, mySeat)}</Text>}
          <Text style={[styles.pillValue, slim && styles.pillValueSlim, { color: team.themInk }]} maxFontSizeMultiplier={1.3}>{themScore}</Text>
          {!vertical && <Text style={styles.pillLabel} maxFontSizeMultiplier={1.3}>{lang.team(them, mySeat)}</Text>}
        </Animated.View>
      </View>

      {progress ? (
        // The last trick's +10 flies here.
        <Anchor id={anchorId.running}>
          <Text style={[live!, vertical && styles.centreText, slim && styles.liveSlim]} maxFontSizeMultiplier={1.3}>
            {usRun} : {themRun}
            <Text style={styles.subDim} maxFontSizeMultiplier={1.3}>
              {vertical ? '\n' : '   '}
              {progress.callerNeeds === 0
                ? lang.s.contractSafe
                : lang.s.needsMore(progress.callerNeeds, progress.callerTeam === us)}
            </Text>
          </Text>
        </Anchor>
      ) : (
        <Text style={styles.subDim} maxFontSizeMultiplier={1.3}>
          {lang.s.gameToTarget(target)} · {modeName(lang, mode)}
        </Text>
      )}
    </View>
  );
},
// The view hands over fresh arrays and progress objects every tick; compare
// what the header actually prints, or memo would never hit.
(a, b) =>
  a.lang === b.lang &&
  a.mySeat === b.mySeat &&
  a.vertical === b.vertical &&
  a.slim === b.slim &&
  a.reduced === b.reduced &&
  a.winner === b.winner &&
  a.target === b.target &&
  a.mode === b.mode &&
  (a.series?.[0] ?? -1) === (b.series?.[0] ?? -1) &&
  (a.series?.[1] ?? -1) === (b.series?.[1] ?? -1) &&
  a.matchScores[0] === b.matchScores[0] &&
  a.matchScores[1] === b.matchScores[1] &&
  (a.progress === null) === (b.progress === null) &&
  (a.progress === null ||
    (a.progress.running[0] === b.progress!.running[0] &&
      a.progress.running[1] === b.progress!.running[1] &&
      a.progress.callerNeeds === b.progress!.callerNeeds &&
      a.progress.callerTeam === b.progress!.callerTeam &&
      a.progress.provisional === b.progress!.provisional &&
      a.progress.belaPending === b.progress!.belaPending)));

/** Level, XP progress and the coin balance; the coins are the wallet anchor. */
const ProfileBar = memo(
  function ProfileBar({
    profile,
    vertical = false,
    slim = false,
    holdMs = 0,
    coinCount = coinCascadeCount(0),
    reduced = false,
    onLongPress,
  }: {
    profile: PlayerProfile;
    vertical?: boolean;
    /** Portrait's short column: the strip without its breathing room. */
    slim?: boolean;
    /** Extra wait before the wallet and the level move: a match's fanfare plays first. */
    holdMs?: number;
    /** How many coins are flying in: the wallet moves as the last one lands. */
    coinCount?: number;
    /** The motion policy: the bar snaps and the badge stays still instead. */
    reduced?: boolean;
    /** Dev builds: toggles the frame/render probe. */
    onLongPress?: () => void;
  }) {
    // The level (its badge swell, its bar) lands with the level-up sound —
    // after the coins, not at the moment the deal was scored.
    const lag = COIN_CASCADE_DELAY_MS + coinsLandedMs(coinCount) + holdMs;
    const xp = useLaggedNumber(profile.xp, lag, 1);
    const p = levelProgress(xp);
    // The total changes when the last coin lands on it, not when the deal is
    // scored with the coins still in the air — and the coins set off from the
    // sheet's total, a moment after the sheet has slid up.
    // A gift paid for leaves the wallet at once; an award waits for its coins.
    const coins = useLaggedNumber(profile.coins, lag, 300, 0);
    // The XP bar fills rather than jumps; a new level swells the badge. Only on
    // a change: a rotation remounts the strip already full to where it is, and
    // an animation to that same value kept writing to the torn-down one. A
    // level crossed fills to the end and on from empty (xpFillSteps): going
    // straight to the new level's share ran the bar backwards.
    const fill = useSharedValue(p.fraction);
    const filledTo = useRef<XpShown>({ level: p.level, fraction: p.fraction });
    useEffect(() => {
      const steps = xpFillSteps(filledTo.current, { level: p.level, fraction: p.fraction, isMax: p.isMax }, reduced);
      if (steps.length === 0) return;
      filledTo.current = { level: p.level, fraction: p.fraction };
      const timed = (st: XpFillStep) =>
        withTiming(st.to, { duration: st.ms, easing: st.ease === 'in' ? Easing.in(Easing.quad) : Easing.out(Easing.cubic) });
      const only = steps[0]!;
      fill.value = steps.length > 1 ? withSequence(...steps.map(timed)) : only.ms === 0 ? only.to : timed(only);
    }, [fill, p.level, p.fraction, p.isMax, reduced]);
    const fillStyle = useAnimatedStyle(() => ({ width: `${Math.round(fill.value * 100)}%` }));
    const badge = useSharedValue(1);
    const level = useRef(p.level);
    useEffect(() => {
      if (level.current === p.level) return;
      level.current = p.level;
      if (reduced) return;
      badge.value = withSequence(
        withTiming(1.35, { duration: 220, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 320, easing: Easing.inOut(Easing.quad) }),
      );
    }, [badge, p.level, reduced]);
    const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));
    return (
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={600}
        style={[styles.profileBar, vertical && styles.profileBarCol, slim && styles.profileBarSlim]}
      >
        <Animated.View style={[styles.levelBadge, badgeStyle]}>
          <Text style={styles.levelText} maxFontSizeMultiplier={1.3}>{p.level}</Text>
        </Animated.View>
        <View style={[styles.xpWrap, vertical && styles.xpWrapCol]}>
          <View style={styles.xpTrack}>
            <Animated.View style={[styles.xpFill, fillStyle]} />
          </View>
        </View>
        <Anchor id={anchorId.wallet}>
          <View style={styles.coinsRow}>
            <Text style={styles.coins} maxFontSizeMultiplier={1.3}>{coins}</Text>
            <Coin size={12} />
          </View>
        </Anchor>
      </Pressable>
    );
  },
  (a, b) =>
    a.profile.xp === b.profile.xp &&
    a.profile.coins === b.profile.coins &&
    a.vertical === b.vertical &&
    a.slim === b.slim &&
    a.reduced === b.reduced &&
    a.onLongPress === b.onLongPress,
);

/** The hand as a fan. A card is tappable only when the engine says it is legal. */
function Hand({
  cards,
  options,
  enabled,
  onPlay,
  freePlay = false,
  width,
  maxCardW,
  reveal,
  arranging = false,
  marking = false,
  marked = [],
  onToggleMark,
  onSwap,
  onHold,
  confirmPlay = 'ambiguous',
  awaitEcho = false,
  refusedN = 0,
  deckStyle,
  locale,
  reduced = false,
  armCaption,
  glow = null,
  restFloor = 0,
  onIllegal,
}: {
  cards: Card[];
  options: Action[];
  enabled: boolean;
  /** False when the table did not send it (an answer already on its way). */
  onPlay: (a: Action) => boolean | void;
  /**
   * A tap on a card the engine does not allow now (never in hard mode, where
   * every card goes): the card shakes, and this says why.
   */
  onIllegal?: (card: Card, legal: Card[]) => void;
  /** Hard mode: any card is tappable and nothing is dimmed or lifted as a hint. */
  freePlay?: boolean;
  /** Space the fan may use; the cards size themselves to fit it in ONE row. */
  width: number;
  /** Height budget, expressed as a card width; landscape sets it low. */
  maxCardW?: number;
  /** The fan's overlap (metrics.handReveal); "Velike karte" tightens it. */
  reveal?: number;
  /** Arrange mode: taps swap cards and can never play one. */
  arranging?: boolean;
  onSwap?: (idA: string, idB: string) => void;
  /** A card held down: arranging starts or ends, and the card is not tapped. */
  onHold?: () => void;
  /** Zvanja round: taps mark cards for a declaration and can never play one. */
  marking?: boolean;
  marked?: string[];
  onToggleMark?: (id: string) => void;
  confirmPlay?: ConfirmPlay;
  /** Online: plays wait for the server's echo (see TableScreenProps). */
  awaitEcho?: boolean;
  refusedN?: number;
  deckStyle: DeckStyle;
  locale?: string;
  /** Reduce-motion: the cards step up instead of springing. */
  reduced?: boolean;
  /** What the second tap on an armed card does, on the card. */
  armCaption?: string;
  /**
   * Where a resting card may come down to, above the fan's floor. A short
   * column tucks my puck up into the fan, and a small hand's flattened arc
   * would otherwise bring the middle cards down onto it.
   */
  restFloor?: number;
  /** Cards to glow gold for a moment: my bela's king and queen. */
  glow?: { cardIds: string[]; n: number } | null;
}) {
  const plays = options.filter(
    (a): a is Extract<Action, { type: 'PLAY_CARD' }> => a.type === 'PLAY_CARD',
  );
  const byCard = new Map<string, Extract<Action, { type: 'PLAY_CARD' }>>();
  for (const p of plays) {
    // Keep the plain play; the bela call has its own explicit button.
    const key = cardId(p.card);
    if (!byCard.has(key) || p.announceBela !== true) byCard.set(key, p);
  }

  // One tap arms a card, the second plays it — but never when the card is
  // forced, which in bela is most tricks. That keeps the guard exactly where a
  // mistake is possible without taxing the taps that cannot go wrong.
  //
  // "Forced" must count what the player can TAP, not what the engine calls
  // legal. In hard mode every card in hand is submittable, so deriving it from
  // the legal list relaxed the guard precisely when one legal card sat among
  // seven renons-scoring ones — the most dangerous tap surface in the game.
  const [armed, setArmed] = useState<string | null>(null);
  // The card a refused tap shook, and a count so the same card can shake again.
  const [shake, setShake] = useState<{ id: string | null; n: number }>({ id: null, n: 0 });
  // Arrange mode picks a card to SWAP, which is a different meaning; sharing
  // one slot left a swap selection armed to fire the moment arranging ended.
  const [arrangePick, setArrangePick] = useState<string | null>(null);
  const tappable = freePlay && plays.length > 0 ? cards.length : byCard.size;
  const forced = tappable === 1;
  const needsConfirm =
    confirmPlay === 'always' ? true : confirmPlay === 'ambiguous' ? !forced : false;

  // Disarm whenever the decision in front of the player changes — a new turn, a
  // new trick, entering or leaving arrange mode. Nothing here changes while they
  // are deliberating, so this never cancels a legitimate arm.
  // The card just tapped measured itself into a transient rect (see
  // FanCard). Only the LAST tap's rect may be live: a rect left from an
  // earlier tap would send a server-driven play of that card (the clock
  // running out online) off from where the card was several tricks ago.
  const anchors = useAnchors();
  const lastTap = useRef<string | null>(null);
  const decision = `${arranging}|${enabled}|${plays.map((p) => cardId(p.card)).join(',')}`;
  useEffect(() => {
    setArmed(null);
    setArrangePick(null);
  }, [decision]);
  // When the cards themselves change (a new deal, the talon, my own card
  // leaving) the last tapped rect describes a fan that no longer exists. Not
  // on the decision above: online, my play's echo arrives after it.
  const cardsKey = cards.map(cardId).join(',');
  useEffect(() => {
    if (lastTap.current !== null) {
      anchors.delete(anchorId.card(lastTap.current));
      lastTap.current = null;
    }
  }, [cardsKey, anchors]);
  // A play sent and not yet answered. Online the card waits a round trip for
  // the server's echo, and a second tap in that gap sent a second play the
  // server refused, with the "denied" sound. One play at a time: the answer
  // (the card leaving, the turn moving on) or a refusal frees the hand, and
  // so does silence, after SENT_MAX_MS.
  const [sent, setSent] = useState<string | null>(null);
  const sentRef = useRef<string | null>(null);
  useEffect(() => {
    sentRef.current = null;
    setSent(null);
  }, [decision, cardsKey, refusedN]);
  useEffect(() => {
    if (sent === null) return;
    const t = setTimeout(() => {
      sentRef.current = null;
      setSent(null);
    }, SENT_MAX_MS);
    return () => clearTimeout(t);
  }, [sent]);
  // ...and when the fan itself goes: a rotation remounts it, and a rect
  // measured in the other orientation would send that card's server-driven
  // play off from where it no longer is.
  useEffect(
    () => () => {
      if (lastTap.current !== null) anchors.delete(anchorId.card(lastTap.current));
    },
    [anchors],
  );

  const fit = fitHand(width, cards.length, maxCardW, reveal);
  const mid = (cards.length - 1) / 2;
  const lift = 14 * fit.scale;
  // The arc pushes the outer cards DOWN, and `alignItems: flex-end` had already
  // put them on the floor of the row — so they hung out of the bottom of the
  // hand and under the emote strip, covering the faces you are choosing between.
  const drop = fanArc(cards.length) * fit.scale;

  /** What a tap on this card means right now. Reads the latest render's state. */
  const chosenFor = (card: Card) => {
    const id = cardId(card);
    const inPlayMoment = plays.length > 0;
    // Hard mode: every card is submittable — the engine, not the UI, is
    // the judge, and a wrong card is a renons.
    return (
      byCard.get(id) ??
      (freePlay && inPlayMoment
        ? ({ type: 'PLAY_CARD', seat: plays[0]!.seat, card } as Action)
        : undefined)
    );
  };

  const press = (id: string) => {
    if (lastTap.current !== null && lastTap.current !== id) anchors.delete(anchorId.card(lastTap.current));
    lastTap.current = id;
    // A marking or arranging tap never becomes a flight; its rect goes at once.
    if (marking || arranging) {
      anchors.delete(anchorId.card(id));
      lastTap.current = null;
    }
    if (marking) {
      onToggleMark?.(id);
      return;
    }
    if (arranging) {
      if (arrangePick === null) setArrangePick(id);
      else {
        if (arrangePick !== id) onSwap?.(arrangePick, id);
        setArrangePick(null);
      }
      return;
    }
    // A play is on its way: nothing else goes until it is answered.
    if (sentRef.current !== null) return;
    const card = cards.find((c) => cardId(c) === id);
    const chosen = card ? chosenFor(card) : undefined;
    if (!chosen) {
      // Dimmed, and now saying why instead of doing nothing at all.
      anchors.delete(anchorId.card(id));
      lastTap.current = null;
      if (card && plays.length > 0 && !freePlay) {
        setShake((s) => ({ id, n: s.n + 1 }));
        onIllegal?.(card, plays.map((p) => p.card));
      }
      return;
    }
    if (needsConfirm && armed !== id) {
      // Arming is a decision too; it used to happen in silence.
      playSfx('arm');
      pattern('arm');
      setArmed(id);
      return;
    }
    setArmed(null);
    // An answer already on its way (a bela button just pressed): this tap
    // sent nothing, and the card must not look as if it went.
    if (onPlay(chosen) === false) return;
    sentRef.current = id;
    setSent(id);
    // Online the card's own sound comes with the echo; the finger hears now.
    if (awaitEcho) pattern('press');
  };
  // One identity for the life of the hand, so a memoised card is not
  // re-rendered just because its handler closed over a new render.
  const pressRef = useRef(press);
  pressRef.current = press;
  const onPressCard = useCallback((id: string) => pressRef.current(id), []);
  const holdRef = useRef(onHold);
  holdRef.current = onHold;
  const onHoldCard = useCallback(() => holdRef.current?.(), []);

  return (
    <View style={[styles.fan, { paddingBottom: Math.max(drop, restFloor) }]}>
      {cards.map((card, i) => {
        const id = cardId(card);
        const inPlayMoment = plays.length > 0;
        const playable = !arranging && !marking && enabled && chosenFor(card) !== undefined;
        const illegalNow = !freePlay && !arranging && enabled && inPlayMoment && !playable;
        const isArmed = marking ? marked.includes(id) : arranging ? arrangePick === id : armed === id;
        const off = i - mid;
        const picking = arranging || marking;
        return (
          <FanCard
            key={id}
            id={id}
            card={card}
            width={fit.cardW}
            deckStyle={deckStyle}
            locale={locale}
            marginLeft={i === 0 ? 0 : fit.overlap}
            baseY={Math.pow(Math.abs(off), 1.6) * 3.2 * fit.scale}
            lift={playable || (picking && isArmed) ? -lift : 0}
            // The lift ripples out from the middle of the fan, 30 ms a card.
            rippleDelay={Math.abs(off) * 30}
            reduced={reduced}
            rotate={off * 4.5}
            zIndex={i}
            dimmed={illegalNow}
            highlight={playable && !freePlay && !isArmed}
            selected={picking && isArmed}
            armed={!picking && isArmed}
            caption={armCaption}
            // An illegal card takes the tap, to say why it is dimmed.
            disabled={!playable && !arranging && !marking && !illegalNow}
            shakeN={shake.id === id ? shake.n : 0}
            glowN={glow && glow.cardIds.includes(id) ? glow.n : 0}
            onPress={onPressCard}
            // Marking zvanja, a slow tap still marks: no hold to swallow it.
            onLongPress={marking ? undefined : onHoldCard}
            sent={sent === id}
          />
        );
      })}
    </View>
  );
}

/**
 * One card in the fan. Memoised so that a director tick — which re-renders the
 * whole table — only re-renders the cards whose position, legality or state
 * actually changed. Every prop is a primitive or a stable callback except the
 * card itself, which is compared by identity of suit and rank.
 */
const FanCard = memo(
  function FanCard({
    id,
    card,
    width,
    deckStyle,
    locale,
    marginLeft,
    baseY,
    lift,
    rippleDelay,
    reduced,
    rotate,
    zIndex,
    dimmed,
    highlight,
    selected,
    armed,
    caption,
    disabled,
    glowN,
    shakeN = 0,
    onPress,
    onLongPress,
    sent = false,
  }: {
    id: string;
    card: Card;
    width: number;
    deckStyle: DeckStyle;
    locale?: string;
    marginLeft: number;
    /** The fan's arc: where this card sits when it is not lifted. */
    baseY: number;
    /** Lifted (negative) or resting; animated, never jumped. */
    lift: number;
    /** How long after the middle card this one moves — the ripple. */
    rippleDelay: number;
    reduced: boolean;
    rotate: number;
    zIndex: number;
    dimmed: boolean;
    highlight: boolean;
    selected: boolean;
    armed: boolean;
    caption?: string;
    disabled: boolean;
    /** Non-zero, and new: glow gold for a moment (my bela's king and queen). */
    glowN: number;
    /** Non-zero, and new: a short shake - this card was tapped and may not go. */
    shakeN?: number;
    onPress: (id: string) => void;
    /** Held: never a tap once it fires, so a held card is not played. None while marking. */
    onLongPress?: () => void;
    /** Played, and waiting for the server's echo: it stays put, and fades. */
    sent?: boolean;
  }) {
    // A card has no entrance of its own: the dealt back flies to the very spot
    // it takes (table/fx.ts), and the face is simply there when it lands. Its
    // turning over was reanimated's `entering`, on the view that also carried
    // `layout`; a rotation remounts the fan, every card turned over again, and
    // the rotation's second pass (the safe-area insets) started the transition
    // over the flip and left the whole fan at ~3% opacity for the deal. Kept as
    // a shared value instead, its first frame was the view's resting style
    // whenever reanimated lost the finished values (react-native-reanimated
    // #9574, the app paused just after the talon: two slivers), and the view
    // that could drop it made a rotation's teardown heavier.
    const glowV = useSharedValue(0);
    // Only a glow that arrived AFTER this card mounted plays: a card dealt
    // while an old bela cue is still current must not light up on arrival.
    const seenGlow = useRef(glowN);
    useEffect(() => {
      if (!glowN || glowN === seenGlow.current) return;
      seenGlow.current = glowN;
      glowV.value = withSequence(
        withTiming(1, { duration: 150 }),
        withDelay(400, withTiming(0, { duration: 150 })),
      );
    }, [glowN, glowV]);
    const glowStyle = useAnimatedStyle(() => ({ opacity: glowV.value }));
    // The lift used to be a 14 px jump on the frame the turn arrived. Now the
    // playable cards spring up from the middle outward; a card that stops
    // being playable settles back the same way.
    // Only on a change: a card mounts where it rests, and a spring to where it
    // already is kept writing to a view a quick second rotation had already
    // torn down (reanimated then re-applies the dead view's props on every
    // native event until its registry lets it go).
    const liftV = useSharedValue(lift);
    const liftedTo = useRef(lift);
    useEffect(() => {
      if (liftedTo.current === lift) return;
      liftedTo.current = lift;
      liftV.value = reduced
        ? withTiming(lift, { duration: 120 })
        : withDelay(rippleDelay, withSpring(lift, spring.lift));
    }, [liftV, lift, rippleDelay, reduced]);
    // The card's arc, tilt and lift on one view, as 1.2.5 had it. Splitting the
    // tilt out into a plain view of its own (so that a lost animated value
    // could not leave a card at another place's angle) cost more than it
    // saved: over quick rotations the table began to lag a whole orientation
    // behind, on the Samsung in 10 of 60 flips, and never with the one view.
    // A refused tap shakes the card, once per tap. Only a shake that arrived
    // after this card mounted plays (a rotation remounts the fan), and never
    // under reduce-motion, where the words say it alone.
    const shakeX = useSharedValue(0);
    const seenShake = useRef(shakeN);
    useEffect(() => {
      if (seenShake.current === shakeN) return;
      seenShake.current = shakeN;
      if (shakeN === 0 || reduced) return;
      shakeX.value = withSequence(
        withTiming(-6, { duration: 45 }),
        withTiming(6, { duration: 90 }),
        withTiming(-3, { duration: 70 }),
        withTiming(0, { duration: 55 }),
      );
    }, [shakeX, shakeN, reduced]);
    const motion = useAnimatedStyle(() => ({
      transform: [{ translateX: shakeX.value }, { translateY: baseY + liftV.value }, { rotateZ: `${rotate}deg` }],
    }));
    // Where this card is on screen at the moment of the tap: the flight sets
    // off from here, at this size. One transient rect, read once by the
    // spawner — never a per-card anchor that re-measures every tick.
    const anchors = useAnchors();
    const ref = useRef<View>(null);
    const press = () => {
      const node = ref.current;
      if (!node) {
        onPress(id);
        return;
      }
      node.measureInWindow((x, y, w, h) => {
        // The measurement is the bounding box of the TILTED card, wider than
        // the card by up to a third at the fan's edge; its centre is right.
        // The rect is the card's own size about that centre, so the flight
        // sets off at the fan's size rather than popping from the box's.
        if (Number.isFinite(x) && w > 0) {
          const cardH = width * CARD_ASPECT;
          anchors.set(anchorId.card(id), { x: x + w / 2 - width / 2, y: y + h / 2 - cardH / 2, w: width, h: cardH, tilt: rotate });
        }
        onPress(id);
      });
    };
    return (
      // The card's place in the row is flex's, as it always was, and it moves
      // at once: no layout transition. Reanimated 4.5.1's could drop its last
      // frames under a rotation's re-render and leave a card standing behind
      // its neighbour, a gap where it belonged.
      <View style={[styles.fanCard, { marginLeft, zIndex }, sent && styles.fanCardSent]}>
       <Animated.View style={motion}>
        <Pressable
          ref={ref}
          // Touch: only a card that takes no tap is disabled; an illegal card on
          // my turn still takes one (it shakes and says why). `undefined`, not
          // `false`: RN 0.86's Pressable writes any non-null `disabled` over the
          // accessibilityState below, and every card on my turn read as playable.
          disabled={disabled || undefined}
          onPress={press}
          onLongPress={onLongPress}
          delayLongPress={500}
          // Vertical only: horizontal slop would overlap the neighbouring
          // card in touch space and make mis-taps MORE likely, not less.
          hitSlop={{ top: 12, bottom: 8 }}
          // TalkBack (1.6.0): each card is a button that says its name ("dečko
          // srce": the rank word, not the genitive a zvanje is said in) and
          // whether it may be played now - an illegal card on my turn may not.
          // (Android disables the native view for that too, and touch then
          // reaches this Pressable only through the card face drawn inside it.)
          accessibilityRole="button"
          accessibilityLabel={cardLang().cardName(card)}
          accessibilityState={{ disabled: disabled || dimmed }}
          testID={`card-${id}`}
        >
          <PlayingCard
            card={card}
            width={width}
            deckStyle={deckStyle}
            locale={locale}
            dimmed={dimmed}
            highlight={highlight}
            selected={selected}
            armed={armed}
            caption={caption}
          />
          <Animated.View pointerEvents="none" style={[styles.cardGlow, glowStyle]} />
        </Pressable>
       </Animated.View>
      </View>
    );
  },
  (a, b) =>
    a.id === b.id &&
    a.card.suit === b.card.suit &&
    a.card.rank === b.card.rank &&
    a.width === b.width &&
    a.deckStyle === b.deckStyle &&
    a.locale === b.locale &&
    a.marginLeft === b.marginLeft &&
    a.baseY === b.baseY &&
    a.lift === b.lift &&
    a.rippleDelay === b.rippleDelay &&
    a.reduced === b.reduced &&
    a.rotate === b.rotate &&
    a.zIndex === b.zIndex &&
    a.dimmed === b.dimmed &&
    a.highlight === b.highlight &&
    a.selected === b.selected &&
    a.armed === b.armed &&
    a.caption === b.caption &&
    a.disabled === b.disabled &&
    a.glowN === b.glowN &&
    a.shakeN === b.shakeN &&
    // `enter` is read once, at mount: its later flips need no render.
    a.onPress === b.onPress &&
    a.onLongPress === b.onLongPress &&
    a.sent === b.sent,
);

/**
 * The table zooms in from a hair under full size as it mounts: an entrance,
 * not a cut. A worklet, as reanimated requires of a custom entering animation.
 */
const feltEntering = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.96 }] },
    animations: {
      opacity: withTiming(1, { duration: 240 }),
      transform: [{ scale: withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }) }],
    },
  };
};

/** An empty slot; the one whose seat is acting breathes a little. */
const SlotGhost = memo(function SlotGhost({
  colour,
  side,
  breathing,
  reduced,
}: {
  /** The seat's team colour: a small tab on the seat's side of the mat says whose place this is. */
  colour: string;
  side: Position;
  breathing: boolean;
  reduced: boolean;
}) {
  // The breath is a CSS animation: the compositor's on the web, the UI
  // thread's natively, and nothing per frame in JS.
  return (
    <Animated.View style={[styles.slotGhost, breathing && !reduced ? ghostBreath : styles.slotGhostStill]}>
      <View style={[styles.slotTab, SLOT_TAB[side], { backgroundColor: colour }]} />
    </Animated.View>
  );
});

const ghostBreath: CSSAnimationProperties = {
  animationName: { from: { opacity: 0.55 }, to: { opacity: 0.95 } },
  animationDuration: 700,
  animationIterationCount: 'infinite',
  animationDirection: 'alternate',
  animationTimingFunction: 'ease-in-out',
};

/** Where the mat's tab sits: on the edge nearest the seat. */
const SLOT_TAB: Record<Position, ViewStyle> = {
  bottom: { bottom: -1, left: '50%', marginLeft: -7, width: 14, height: 3 },
  top: { top: -1, left: '50%', marginLeft: -7, width: 14, height: 3 },
  left: { left: -1, top: '50%', marginTop: -7, width: 3, height: 14 },
  right: { right: -1, top: '50%', marginTop: -7, width: 3, height: 14 },
};

/** Bidding, declaring, and the explicit bela call. */
function NonCardActions({
  options,
  lang,
  onChoose,
  compact = false,
  short = false,
}: {
  options: Action[];
  lang: Lang;
  onChoose: (a: Action) => void;
  compact?: boolean;
  /**
   * Portrait's short column: a trump call is the suit alone and a bela button
   * drops its suit (the pip says both), so five bids take two lines at 320 dp
   * and the bela pair one. A screen reader still hears the whole call.
   */
  short?: boolean;
}) {
  const buttons = options.filter((a) => a.type !== 'PLAY_CARD' || a.announceBela === true);
  return (
    <>
      {buttons.map((a, i) => {
        const isBela = a.type === 'PLAY_CARD';
        const strong = a.type === 'DECLARE_ANNOUNCE' || a.type === 'BID_CALL';
        const label =
          // In the rail the pip says "zovi": the label is the suit alone.
          (compact || short) && a.type === 'BID_CALL'
            ? lang.suitName(a.suit)
            : short && a.type === 'PLAY_CARD'
              ? `${lang.rankShort(a.card.rank)} ${lang.s.withBela}`
              : lang.action(a);
        return (
          <Button
            key={i}
            testID={`action-${i}`}
            label={label}
            accessibilityLabel={lang.action(a)}
            tone={isBela ? 'bela' : strong ? 'strong' : 'plain'}
            compact={compact}
            style={short && (a.type === 'BID_CALL' || a.type === 'BID_PASS') ? styles.bidShort : undefined}
            // The suit itself on a trump-call button, not only its name; and on
            // a short column's bela button, whose label dropped it.
            icon={
              a.type === 'BID_CALL' ? (
                <SuitPip suit={a.suit} size={compact ? 14 : 16} />
              ) : short && a.type === 'PLAY_CARD' ? (
                <SuitPip suit={a.card.suit} size={16} />
              ) : undefined
            }
            onPress={() => onChoose(a)}
          />
        );
      })}
    </>
  );
}

function DealResult({
  lang,
  mySeat,
  maxHeight,
  result,
  matchScores,
  matchOver,
  winnerLabel,
  weWon = null,
  renonsText,
  wrongCard = null,
  series,
  call = null,
  summary = null,
  award = null,
  askedRematch = false,
  waitingFor = 0,
  onRematch,
  rematchLabel,
  onForceRematch,
  nextDeal,
  onNext,
  onFinish,
  finishLabel,
  onReview,
  reduced = false,
  voiceBar = null,
  wide = false,
}: {
  lang: Lang;
  mySeat: Seat;
  reduced?: boolean;
  /** The sheet scrolls rather than run off a short (landscape) screen. */
  maxHeight: number;
  /** Online, with voice on: pinned under the scrolling part, never scrolled away. */
  voiceBar?: React.ReactNode;
  /**
   * Sideways: the bar is as wide as the screen, and a deal's two buttons ride
   * in it beside the mic - the bar's height would otherwise push them below
   * the fold of a short screen. (A match's end keeps its foot in the sheet.)
   */
  wide?: boolean;
  result: DealScoreResult | null;
  matchScores: readonly [number, number];
  matchOver: boolean;
  winnerLabel: string;
  /** At the end of a match: was it ours? null while it is not over (or not known). */
  weWon?: boolean | null;
  renonsText?: string | null;
  /** Prava bela, my own wrong card: which it was, the duty it broke, what could have gone. */
  wrongCard?: readonly string[] | null;
  /** Matches won per side since this roster sat down; online only. */
  series?: readonly [number, number] | null;
  /** Who called the deal (null name: me), on which trump, at what stake. */
  call?: { name: string | null; team: TeamId; trump: Suit | null; multiplier: 1 | 2 | 4 } | null;
  /** At the end of a match: deals taken and our best one (null: not the whole match seen). */
  summary?: MatchSummary | null;
  /** What this deal (or match) earned: shown at the foot of the sheet, where the coins set off from. */
  award?: Award | null;
  /** Has this seat already asked for another match? */
  askedRematch?: boolean;
  /** How many players have yet to accept. */
  waitingFor?: number;
  onRematch?: () => void;
  rematchLabel?: string;
  onForceRematch?: () => void;
  nextDeal?: NextDealInfo;
  onNext: () => void;
  onFinish: () => void;
  finishLabel: string;
  /** "Pregled ruke": opens the deal's tricks; absent when there is no history to show. */
  onReview?: () => void;
}) {
  const us = teamOf(mySeat);
  const them = (1 - us) as TeamId;
  // Rows arrive one after another; the totals count up to their values.
  let order = 0;
  const enter = () => (reduced ? undefined : FadeInDown.delay(order++ * 60).duration(220));
  const row = (
    label: string,
    v: readonly [number, number],
    opts: { from?: readonly [number, number]; anchor?: string; hero?: boolean; countAfter?: number } = {},
  ) => {
    // A tally counts once its row has arrived - plus `countAfter`, so the
    // match score moves only after this deal's total has settled. Counting
    // them all at once showed, for a moment, a total bigger than its own sum.
    const arrives = order * 60 + 220;
    return (
    <Animated.View style={[styles.resultRow, opts.hero && styles.resultHero]} key={label} entering={enter()}>
      <Text style={[styles.resultLabel, opts.hero && styles.resultLabelHero]} maxFontSizeMultiplier={1.3}>{label}</Text>
      <Pair
        us={v[us]}
        them={v[them]}
        from={opts.from ? [opts.from[us], opts.from[them]] : undefined}
        reduced={reduced}
        anchor={opts.anchor}
        hero={opts.hero}
        delay={opts.countAfter === undefined ? 0 : arrives + opts.countAfter}
      />
    </Animated.View>
    );
  };
  const rule = <View style={styles.rule} />;
  const pinFoot = wide && voiceBar !== null && !matchOver;
  const foot = (
    <ResultFoot
      lang={lang}
      matchOver={matchOver}
      // Ours first, as the header's chip has it: absolute order swapped the
      // two sides for whoever sat on the second team.
      series={series ? [series[us], series[them]] : null}
      askedRematch={askedRematch}
      waitingFor={waitingFor}
      onRematch={onRematch}
      rematchLabel={rematchLabel}
      onForceRematch={onForceRematch}
      nextDeal={nextDeal}
      onNext={onNext}
      onFinish={onFinish}
      finishLabel={finishLabel}
      onReview={onReview}
      pinned={pinFoot}
    />
  );
  const bar = voiceBar ? (
    <View style={[styles.voiceBarPanel, { backgroundColor: room().page }]}>
      {pinFoot ? (
        <View style={styles.voiceBarWide}>
          <View style={styles.voiceBarWideVoice}>{voiceBar}</View>
          {foot}
        </View>
      ) : (
        voiceBar
      )}
    </View>
  ) : null;

  // A deal scored while this client was away (it reconnected into DEAL_OVER):
  // its rows would be another deal's, so it shows the match score, says what
  // happened, and above all still answers - a sheet with no way on would
  // leave the table with nothing but Napusti.
  const scrollMax = voiceBar ? maxHeight - VOICE_BAR_H : maxHeight;
  if (!result) {
    return (
      <Animated.View entering={reduced ? undefined : SlideInDown.duration(280)}>
        <ScrollView
          style={[styles.resultPanel, { maxHeight: scrollMax, backgroundColor: room().page }]}
          contentContainerStyle={styles.resultContent}
        >
          <View style={[styles.sheetBand, matchOver ? (weWon === false ? styles.sheetBandLost : styles.sheetBandMatch) : styles.sheetBandPlain]}>
            {matchOver && weWon !== false && <Crown size={26} />}
            <View style={styles.sheetBandText}>
              <Text style={styles.sheetTitle} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                {/* The winner's name came with an event this client missed
                    too: then the score below is all there is to say. */}
                {matchOver
                  ? weWon !== null
                    ? weWon
                      ? lang.s.ui.matchWon
                      : lang.s.ui.matchLost
                    : winnerLabel
                      ? lang.s.winner(winnerLabel)
                      : lang.s.matchScore
                  : lang.s.dealResult}
              </Text>
              <Text style={styles.sheetVerdict} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                {lang.s.ui.resultMissed}
              </Text>
            </View>
          </View>
          <View style={styles.resultHeads}>
            <Text style={[styles.resultHead, styles.resultHeadUs]} maxFontSizeMultiplier={1.3}>{lang.team(us, mySeat)}</Text>
            <Text style={[styles.resultHead, styles.resultHeadThem]} maxFontSizeMultiplier={1.3}>{lang.team(them, mySeat)}</Text>
          </View>
          {row(lang.s.matchScore, matchScores, { hero: true })}
          {pinFoot ? null : foot}
        </ScrollView>
        {bar}
      </Animated.View>
    );
  }

  // Ours or theirs — the same rule the sounds use (feedback.ts).
  const won = result.finalScore[us] > result.finalScore[them];
  const made = renonsText ? false : result.callerMade;
  const stiglja = result.valatTeam !== null;
  // Why it went the way it did, in the callers' own numbers: the callers
  // must end with more than the defenders, or everything goes across.
  const verdict = renonsText
    ? `${lang.s.renonsTitle} ${renonsText}`
    : call
      ? (made ? lang.s.ui.madeLine : lang.s.ui.padLine)(
          call.team === us,
          result.rawTotal[call.team],
          result.rawTotal[(1 - call.team) as TeamId],
        )
      : made
        ? lang.s.callerMade
        : lang.s.callerFailed;

  return (
    <Animated.View entering={reduced ? undefined : SlideInDown.duration(280)}>
    <ScrollView
      style={[styles.resultPanel, { maxHeight: scrollMax, backgroundColor: room().page }]}
      contentContainerStyle={styles.resultContent}
    >
      {/* The header band says whose deal it was at a glance: tinted by our
          outcome, the caller's verdict as one word at its end. */}
      <View
        style={[
          styles.sheetBand,
          // The match's end in the winners' colours: gold with the crown when
          // it is ours, theirs when it is not - a loss used to wear the same
          // gold and crown as a win.
          matchOver ? (weWon === false ? styles.sheetBandLost : styles.sheetBandMatch) : won ? styles.sheetBandWon : styles.sheetBandLost,
        ]}
      >
        {matchOver && weWon !== false && <Crown size={26} />}
        <View style={styles.sheetBandText}>
          <Text style={[styles.sheetTitle, stiglja && !matchOver && styles.sheetTitleStiglja]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {matchOver
              ? weWon === null
                ? lang.s.winner(winnerLabel)
                : weWon
                  ? lang.s.ui.matchWon
                  : lang.s.ui.matchLost
              : stiglja
                ? `${lang.s.valat}!`
                : lang.s.dealResult}
          </Text>
          {call && (
            <View style={styles.sheetCall}>
              {call.trump && <SuitPip suit={call.trump} size={14} />}
              <Text style={styles.sheetCallText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {call.name === null ? lang.s.calledByYou : lang.s.calledBy(call.name)}
                {call.multiplier > 1 ? ` · ×${call.multiplier}` : ''}
              </Text>
            </View>
          )}
          <Text style={styles.sheetVerdict} numberOfLines={3} maxFontSizeMultiplier={1.3}>
            {verdict}
          </Text>
        </View>
        {!matchOver && (
          <Animated.Text
            style={[styles.sheetWord, made ? styles.sheetWordMade : styles.sheetWordFailed]}
            entering={reduced ? undefined : ZoomIn.springify().damping(14).delay(120)} maxFontSizeMultiplier={1.3}>
            {made ? lang.s.madeShort : lang.s.failedShort}
          </Animated.Text>
        )}
      </View>

      {wrongCard && wrongCard.length > 0 && (
        <View style={styles.wrongCardBox} accessible>
          {wrongCard.map((line) => (
            <Text key={line} style={styles.wrongCardText} maxFontSizeMultiplier={1.3}>
              {line}
            </Text>
          ))}
        </View>
      )}

      {/* the columns, ours first */}
      <View style={styles.resultHeads}>
        <Text style={[styles.resultHead, styles.resultHeadUs]} maxFontSizeMultiplier={1.3}>{lang.team(us, mySeat)}</Text>
        <Text style={[styles.resultHead, styles.resultHeadThem]} maxFontSizeMultiplier={1.3}>{lang.team(them, mySeat)}</Text>
      </View>
      {row(lang.s.cardsAndLastTrick, result.trickPoints)}
      {result.valatTeam !== null && row(lang.s.valat, result.valatBonus)}
      {result.declarationPoints[0] + result.declarationPoints[1] > 0 &&
        row(lang.s.declarations, result.declarationPoints)}
      {/* Announced above, credited to the OTHER side in "Upisano" below — say
          so, rather than letting the reader hunt for the missing points. */}
      {result.tricksWon.some((t, i) => t === 0 && result.declarationPoints[i]! > 0) && (
        <Text style={styles.voidNote} maxFontSizeMultiplier={1.3}>{lang.s.zvanjaNoTrickToOpponents}</Text>
      )}
      {result.bela[0] + result.bela[1] > 0 && row(lang.s.bela, result.bela)}
      {rule}
      {row(lang.s.total, result.rawTotal)}
      {rule}
      {/* The sheet mounts with the final numbers already in the view, so the
          two totals count from where they were: nought, and the match score
          before this deal was added to it. */}
      {row(lang.s.recorded, result.finalScore, { from: [0, 0], anchor: anchorId.sheetTotal, hero: true, countAfter: 0 })}
      {row(lang.s.matchScore, matchScores, {
        from: [
          Math.max(0, matchScores[0] - result.finalScore[0]),
          Math.max(0, matchScores[1] - result.finalScore[1]),
        ],
        countAfter: 600,
      })}

      {/* The whole match in two lines, when this device saw all of it. */}
      {matchOver && summary && (
        <>
          {rule}
          {row(lang.s.ui.dealsWon, summary.won)}
          {summary.best && (
            <Animated.Text style={styles.summaryNote} entering={enter()} maxFontSizeMultiplier={1.3}>
              {lang.s.ui.bestDeal(summary.best.points, summary.best.deal)}
            </Animated.Text>
          )}
        </>
      )}

      {award && (award.xp > 0 || award.coins > 0 || award.levelUp !== null) && (
        <Animated.View style={styles.sheetAward} entering={enter()}>
          {award.xp > 0 && <Text style={styles.sheetAwardText} maxFontSizeMultiplier={1.3}>+{award.xp} XP</Text>}
          {award.coins > 0 && (
            <View style={styles.sheetAwardCoins}>
              <Text style={styles.sheetAwardText} maxFontSizeMultiplier={1.3}>+{award.coins}</Text>
              <Coin size={13} />
            </View>
          )}
          {award.levelUp !== null && (
            <View style={styles.sheetLevel}>
              <Star size={14} />
              <Text style={styles.sheetLevelText} maxFontSizeMultiplier={1.3}>
                {lang.s.ui.level} {award.levelUp}
              </Text>
            </View>
          )}
        </Animated.View>
      )}

      {pinFoot ? null : foot}
    </ScrollView>
    {bar}
    </Animated.View>
  );
}

/** The sheet's answers: another match, the next deal, or the way out. */
function ResultFoot({
  lang,
  matchOver,
  series,
  askedRematch,
  waitingFor = 0,
  onRematch,
  rematchLabel,
  onForceRematch,
  nextDeal,
  onNext,
  onFinish,
  finishLabel,
  onReview,
  pinned = false,
}: {
  lang: Lang;
  matchOver: boolean;
  series?: readonly [number, number] | null;
  askedRematch?: boolean;
  waitingFor?: number;
  onRematch?: () => void;
  rematchLabel?: string;
  onForceRematch?: () => void;
  nextDeal?: NextDealInfo;
  onNext: () => void;
  onFinish: () => void;
  finishLabel: string;
  onReview?: () => void;
  /** In the pinned voice bar (sideways): no gap above, flush right. */
  pinned?: boolean;
}) {
  return (
    <>
      {matchOver ? (
        // Online stacks the series line over its buttons; offline has no
        // series, and its two answers sit side by side like a deal's.
        <View style={series ? styles.sheetFoot : styles.resultButtons}>
          {series && (
            <Text style={styles.seriesLine} maxFontSizeMultiplier={1.3}>
              {lang.s.ui.seriesScore}  {series[0]} : {series[1]}
            </Text>
          )}
          {onRematch && (
            <>
              {askedRematch ? (
                <Text style={styles.subDim} maxFontSizeMultiplier={1.3}>
                  {waitingFor > 0 ? lang.s.ui.waitingForRematch(waitingFor) : lang.s.ui.rematchAsked}
                </Text>
              ) : (
                <Button label={rematchLabel ?? lang.s.ui.playAgain} tone="strong" onPress={onRematch} />
              )}
              {/* The host never has to wait on somebody who has wandered off. */}
              {onForceRematch && askedRematch && waitingFor > 0 && (
                <Button label={lang.s.ui.startAnyway} tone="plain" onPress={onForceRematch} />
              )}
            </>
          )}
          {onReview && <Button label={lang.s.ui.reviewHand} testID="review" tone="plain" onPress={onReview} />}
          <Button label={finishLabel} tone="plain" onPress={onFinish} />
        </View>
      ) : (
        <View style={[styles.resultButtons, pinned && styles.resultButtonsPinned]}>
          {nextDeal ? (
            <NextDealButton lang={lang} next={nextDeal} onNext={onNext} />
          ) : (
            <Button label={lang.s.nextDeal} testID="next-deal" tone="strong" onPress={onNext} />
          )}
          {onReview && <Button label={lang.s.ui.reviewHand} testID="review" tone="plain" onPress={onReview} />}
          <Button label={finishLabel} tone="plain" onPress={onFinish} />
        </View>
      )}
    </>
  );
}

/** Online, at a scored deal: the countdown to the next one, and who is still reading. */
export interface NextDealInfo {
  /** When it starts by itself, on this device's clock; null while the table stands still. */
  deadline: number | null;
  /** I have said I am ready. */
  ready: boolean;
  /** The people still reading the sheet (names). */
  waitingFor: readonly string[];
}

/**
 * The next deal starts when everyone has pressed, or by itself when the
 * countdown runs out - never on one player's press, which used to take the
 * sheet away from three people still reading it.
 */
function NextDealButton({ lang, next, onNext }: { lang: Lang; next: NextDealInfo; onNext: () => void }) {
  const now = useNow(500);
  const left = next.deadline === null ? null : Math.max(0, Math.ceil((next.deadline - now) / 1000));
  const count = left === null ? '' : ` · ${left}`;
  if (next.ready) {
    return (
      <View style={styles.nextReady} accessibilityLiveRegion="polite">
        <View style={styles.nextReadyRow}>
          <Check size={14} />
          <Text style={styles.nextReadyText} maxFontSizeMultiplier={1.3}>
            {lang.s.ui.nextReady}
            {count}
          </Text>
        </View>
        {next.waitingFor.length > 0 && (
          <Text style={styles.subDim} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {lang.s.ui.nextWaitingFor(next.waitingFor.join(', '))}
          </Text>
        )}
      </View>
    );
  }
  return <Button label={`${lang.s.nextDeal}${count}`} tone="strong" onPress={onNext} />;
}

/**
 * Ours and theirs, side by side in the team inks — each counting up from
 * `from` when given; optionally the anchor the coins set off from.
 */
function Pair({
  us,
  them,
  from,
  reduced,
  anchor,
  hero = false,
  delay = 0,
}: {
  us: number;
  them: number;
  from?: readonly [number, number];
  reduced: boolean;
  anchor?: string;
  hero?: boolean;
  /** Wait this long before counting, so a sheet's tallies settle one after another. */
  delay?: number;
}) {
  const steps = useRef(0);
  const a = useCountUp(us, 600, {
    reduced,
    from: from?.[0] ?? us,
    delayMs: delay,
    // Every other step ticks, softly: a tally being written, not a rattle.
    onStep: () => {
      // Only the hero row ticks, or two tallies rattle under the stinger.
      if (hero && ++steps.current % 2 === 0) playSfx('tick', { gain: 0.6, rate: 1.4 });
    },
  });
  const b = useCountUp(them, 600, { reduced, from: from?.[1] ?? them, delayMs: delay });
  const pair = (
    <View style={styles.pair}>
      <Text style={[styles.pairValue, styles.pairUs, hero && styles.pairHero]} maxFontSizeMultiplier={1.3}>{a}</Text>
      <Text style={[styles.pairSep, hero && styles.pairHero]} maxFontSizeMultiplier={1.3}>:</Text>
      <Text style={[styles.pairValue, styles.pairThem, hero && styles.pairHero]} maxFontSizeMultiplier={1.3}>{b}</Text>
    </View>
  );
  return anchor ? <Anchor id={anchor}>{pair}</Anchor> : pair;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.feltDeep },
  // The table's box: its padding, and the overlays (the sheet, the review, the
  // sprites, the pickers) laid over all of it.
  root: { flex: 1, padding: 12 },
  rootLand: { paddingVertical: 6 },
  // The table itself, its rows and their gaps, in the one layer under them.
  layer: { flex: 1, gap: 8 },
  // Landscape: two narrow rails of chrome with the table between them.
  layerLand: { flexDirection: 'row', gap: LAND_GAP },
  rail: { gap: 6, alignItems: 'center' },
  railRight: { justifyContent: 'flex-end' },
  // The right rail's free gap, and the emote box's home: stretched, because the
  // rail centres its children, and clipping, for the frame before onLayout.
  railGap: { flex: 1, alignSelf: 'stretch', overflow: 'hidden' },
  traySlot: { position: 'absolute', top: 0, left: 0, right: 0, height: LAND_TRAY_H },
  centre: { flex: 1, gap: 6 },

  profileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  levelBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.wood,
    borderWidth: 1,
    borderColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelText: { color: theme.accent, fontFamily: font.bold, fontSize: 12 },
  profileBarCol: { flexDirection: 'column', gap: 6, paddingVertical: 8, alignSelf: 'stretch' },
  xpWrap: { flex: 1 },
  // A column has no width to give the bar, so pin it instead of flexing.
  xpWrapCol: { flex: 0, alignSelf: 'stretch' },
  xpTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  xpFill: { height: 5, backgroundColor: theme.accent },
  coinsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  coins: { color: theme.accent, fontFamily: font.bold, fontSize: 14 },

  status: { color: theme.accent, fontSize: 12, fontFamily: font.regular, textAlign: 'center' },
  statusError: { color: theme.dangerInk },

  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  scoreCol: { flexDirection: 'column', gap: 4, alignItems: 'center', alignSelf: 'stretch' },
  centreText: { textAlign: 'center' },
  scoreText: {},
  scoreLabel: { color: theme.textDim, fontSize: 13, fontFamily: font.regular },
  scoreValue: { color: theme.text, fontSize: 20, fontFamily: font.bold },
  subDim: { color: theme.textDim, fontSize: 12, fontFamily: font.regular },
  seriesLine: { color: theme.textDim, fontSize: 13, fontFamily: font.regular, textAlign: 'center' },
  pillRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  // The Pauza button: a compact square beside the leave button.
  pauseButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface.chip,
    borderWidth: 1,
    borderColor: theme.line,
    alignSelf: 'center',
  },
  pauseButtonSlim: { width: 30, height: 30 },
  // "Ready, waiting for the others", where the next-deal button was: its own
  // width, growing into what its line leaves. flex: 1's zero basis squeezed
  // "Čekamo ostale" into the ~80 dp the review and leave buttons left it.
  nextReady: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 2, minHeight: 44 },
  nextReadyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nextReadyText: { color: theme.accent, fontSize: 14, fontFamily: font.medium },
  // The series between the pills: small, so a 320 dp strip keeps its one line.
  seriesChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: surface.sunk,
    borderWidth: 1,
    borderColor: theme.line,
  },
  seriesChipText: { color: theme.accent, fontSize: 12, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  pillCol: { flexDirection: 'column', gap: 4, alignSelf: 'stretch' },
  teamPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillLabel: { color: theme.textDim, fontSize: 12, fontFamily: font.medium },
  pillValue: { fontSize: 17, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  dealCount: { color: theme.accent, fontSize: 13, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  dealCountDim: { color: theme.textDim, fontSize: 13, fontFamily: font.bold, fontVariant: ['tabular-nums'] },

  tableArea: { flex: 1 },
  topSeat: { alignItems: 'center' },
  landTopSeat: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  midRow: { flex: 1, flexDirection: 'row', alignItems: 'stretch', gap: 4 },
  sideSeat: { justifyContent: 'center' },

  // The felt's frame is layout only — FeltArt paints the rim and the baize
  // underneath it, sized from this very box. Border 6, padding 5, margin 4
  // are pinned: the trick cross is derived from the measured inner box.
  felt: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 999,
    borderWidth: 6,
    borderColor: 'transparent',
    padding: 5,
    marginVertical: 4,
  },
  feltInner: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sits in the felt's upper lobe, clear of the trick cross at the centre.
  // A plate, not a pip floating in space — and a small one: ~44px tall.
  plaque: {
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.sm,
    // The plate's depth: a lit hairline on top, a shaded one beneath (the
    // colours come from the room, inline).
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 132,
  },
  plaqueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plaqueDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.cardFace,
    borderWidth: 1,
    borderColor: stroke.shade,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multBadge: {
    backgroundColor: garb.redDark,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: stroke.edge,
  },
  miniFan: { flexDirection: 'row', alignItems: 'flex-end', height: 22, paddingHorizontal: 4 },
  miniBack: { width: 13, height: 19 },
  miniBackNext: { marginLeft: -5 },
  plaqueUndecided: { color: ink.mid, fontSize: 11, fontFamily: font.bold },
  // Portrait: at the left end of the partner's row, which is as tall as a puck.
  plaquePortrait: { position: 'absolute', left: 0, top: 0 },
  // In the rail it is a row in the flow, the width of the rail.
  plaqueRail: { alignSelf: 'stretch', paddingHorizontal: 6, paddingVertical: 3 },
  plaqueMult: { color: theme.cardFace, fontSize: 12, fontFamily: font.bold },
  plaqueCaller: { color: ink.mid, fontSize: 11, fontFamily: font.regular },

  slot: { position: 'absolute', width: 46, height: 67 },
  slotGhost: {
    // A place a card will go, marked the way a table mat is: a shallow well
    // with a hairline edge and a small tab in the seat's colour on the seat's
    // side. Four hard-edged boxes read as placeholders that failed to load;
    // four faint ones read as nothing. (Opacity is animated: the acting
    // seat's slot breathes.)
    flex: 1,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: stroke.hair,
    backgroundColor: surface.well,
    overflow: 'visible',
  },
  slotGhostStill: { opacity: 0.7 },
  slotTab: { position: 'absolute', borderRadius: 2 },
  // Sits 3px outside the played card, so the card's own edge cannot cover it.
  slotRing: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderWidth: 2,
    borderRadius: radius.card + 2,
  },
  slotRingTook: { borderColor: theme.accent, borderWidth: 3 },
  // "Zadnji štih", in the free middle of the trick's cross (about 1.35 slot
  // widths by 1.16 slot heights): two short lines. Its width is the table's.
  peek: {
    position: 'absolute',
    left: '50%',
    top: '55%',
    paddingVertical: 4,
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: surface.sunk,
  },
  peekOn: { borderColor: theme.accent },
  peekText: { color: ink.mid, ...type.caption, textAlign: 'center' },
  peekTextOn: { color: theme.accent },
  deckAnchor: { position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 },
  tableFloat: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '4%',
    alignItems: 'center',
    gap: 6,
  },


  callsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  revealScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 999,
  },
  // In the rail the chips are what gives when the height runs out: they
  // shrink and clip, and the leave button below them stays reachable.
  callsCol: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
    alignSelf: 'stretch',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  callChip: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  callChipText: { color: theme.text, ...type.rail },
  // The rail is 96dp wide: caption type and tighter padding. Never a line
  // cap — the rank at the end of a call is the tie-break.
  callChipTextLand: { ...type.caption },
  callChipLand: { paddingHorizontal: 8, alignSelf: 'stretch' },
  // Portrait's short column: metrics' SHORT_CHROME is these numbers.
  rootShort: { paddingVertical: 4 },
  layerShort: { gap: 4 },
  profileBarSlim: { paddingVertical: 2 },
  leaveSlim: { paddingVertical: 4 },
  teamPillSlim: { paddingVertical: 1 },
  pillValueSlim: { lineHeight: 20 },
  liveSlim: { lineHeight: 18 },
  feltFlush: { marginVertical: 0 },
  // A call as a tally, the caller over the call, beside the others; the row
  // never wraps, the tallies share its width, and a call wraps inside its own.
  callsRowShort: { flexWrap: 'nowrap', gap: 4 },
  callChipShort: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, flexShrink: 1, minWidth: 0 },
  callChipName: { color: ink.mid, ...type.caption },
  callChipCall: { color: theme.text, ...type.caption },
  promptRowShort: { paddingVertical: 4, paddingHorizontal: 10, gap: 0 },
  promptLineShort: { lineHeight: 16 },
  // The arrange hint as a short column's prompt: its Done beside it, one row.
  promptInline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  promptInlineText: { flexShrink: 1 },
  handNestle: { marginBottom: -SELF_NESTLE },
  // The arrange hint in the faces' own 34 dp, with its Done beside it.
  arrangeSlot: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  arrangeSlotText: { flex: 1, color: theme.accent, ...type.caption },
  bidShort: { paddingHorizontal: 10 },


  promptRow: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: theme.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  promptText: { color: theme.accent, fontFamily: font.bold, fontSize: 13 },
  // The zvanja prompt measures 58 on a phone; a shorter reserve still moved the hand.
  promptsReserve: { minHeight: 58, justifyContent: 'flex-end', gap: 8 },
  promptHint: { color: theme.textDim, fontSize: 12, fontFamily: font.regular },
  // The coach's row: two lines of 16, the row's padding and border, and 2
  // for the bold "Savjet:" sharing the first line (it stood a line 1 taller),
  // said or not, so it never changes height between turns.
  coachRow: { minHeight: 2 * 16 + 2 * 8 + 2 + 2, justifyContent: 'center' },
  coachRowShort: { minHeight: 2 * 16 + 2 * 4 + 2 + 2, justifyContent: 'center' },
  coachText: { lineHeight: 16 },
  coachLabel: { color: theme.accent, fontFamily: font.bold, lineHeight: 16 },
  // A bid's advice, over the felt the bid leaves empty.
  coachFloat: {
    // Over the felt; bidFloatW narrows it to the side pucks' discs.
    maxWidth: COACH_FLOAT_MAX,
    marginHorizontal: 16,
    backgroundColor: surface.scrim,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: theme.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  // Sideways the felt is wide and short: one wide line, low on the table.
  coachFloatLandBox: { position: 'absolute', left: 0, right: 0, bottom: 2, alignItems: 'center' },
  coachFloatLand: { maxWidth: 520, paddingVertical: 5 },
  coachFloatLandText: { color: theme.text, fontSize: 12, lineHeight: 16, fontFamily: font.regular },
  coachFloatTitle: { color: theme.accent, fontFamily: font.bold, fontSize: 13 },
  coachFloatText: { color: theme.text, fontSize: 13, lineHeight: 18, fontFamily: font.regular },
  // The wrong card, said on the sheet under the band.
  wrongCardBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: theme.danger,
    backgroundColor: surface.well,
    gap: 3,
  },
  wrongCardText: { color: theme.text, fontSize: 13, lineHeight: 18, fontFamily: font.regular },

  handArea: { justifyContent: 'flex-end' },
  // Landscape: the fan, and my puck beside it on the faces' side.
  landHandRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SELF_PUCK_GAP },
  handGrow: { flex: 1 },
  // Portrait: my puck centred under the fan.
  selfRow: { alignItems: 'center' },
  // The profile strip, and the leave button in the top corner beside it.
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  topRowGrow: { flex: 1, minWidth: 0 },
  fan: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    // Shared with fanHeight(), which reserves the row this padding sits in.
    paddingTop: FAN_PAD,
  },
  fanCard: {},
  // Sent, waiting for the server: where it was, a step back.
  fanCardSent: { opacity: 0.55 },
  // Bela: the king and queen of trumps light up gold for a moment.
  cardGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.card,
    backgroundColor: 'rgba(216,165,49,0.45)',
    borderWidth: 2,
    borderColor: theme.accent,
  },

  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ROW_GAP,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 2,
  },
  // As wide as the mic, right of the toggle: the centred row keeps the toggle where it was.
  micBalance: { width: EMOTE_TOGGLE, height: EMOTE_TOGGLE },
  // Tapped to start: throws the take away, in the faces' toggle's place.
  micCancel: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: surface.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Under the results sheet's scrolling part, in its colours: never scrolled away.
  voiceBarPanel: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: theme.line,
    minHeight: VOICE_BAR_H,
    justifyContent: 'center',
  },
  voiceBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 8 },
  voiceBarWords: { flex: 1, gap: 2, minWidth: 0 },
  // Sideways: the mic and its words, then a deal's buttons, on one line.
  voiceBarWide: { flexDirection: 'row', alignItems: 'center', paddingRight: space.lg, gap: space.md },
  voiceBarWideVoice: { flex: 1, minWidth: 0 },
  voiceBarText: { color: ink.hi, fontFamily: font.bold, fontSize: 14 },
  voiceBarHint: { color: theme.textDim, fontSize: 13, fontFamily: font.regular },
  actionsCol: { gap: 6, alignItems: 'stretch', alignSelf: 'stretch' },
  railToggles: { flexDirection: 'row', gap: RAIL_GAP, alignItems: 'center' },

  emoteToggle: {
    width: EMOTE_TOGGLE,
    height: EMOTE_TOGGLE,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoteToggleOn: { borderColor: theme.accent },
  emoteToggleIdle: { opacity: 0.4 },


  resultBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  // A lost match: the room dims a shade more, no vignette imagery.
  resultBackdropLost: { backgroundColor: 'rgba(0,0,0,0.55)' },
  resultPanel: {
    backgroundColor: theme.feltDeep, // overridden by the room's page inline
    borderTopLeftRadius: radius.panel + 6,
    borderTopRightRadius: radius.panel + 6,
    borderWidth: 1,
    borderColor: theme.line,
    flexGrow: 0,
  },
  resultContent: { padding: space.lg, gap: 2 },
  // The header band: our outcome as a tint, the caller's verdict as a word.
  sheetBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: space.sm,
  },
  sheetBandWon: { backgroundColor: team.usDim, borderColor: team.usEdge },
  // Neither side's colour: a deal whose score this client never saw.
  sheetBandPlain: { backgroundColor: surface.sunk, borderColor: theme.line },
  sheetBandLost: { backgroundColor: team.themDim, borderColor: team.themEdge },
  sheetBandMatch: { backgroundColor: surface.sunk, borderColor: theme.accent },
  sheetBandText: { flex: 1, gap: 2 },
  sheetTitle: { color: ink.hi, ...type.h3, fontFamily: font.bold },
  sheetTitleStiglja: { color: theme.accent },
  sheetVerdict: { color: ink.mid, ...type.caption },
  sheetCall: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  sheetCallText: { color: ink.hi, ...type.caption, fontFamily: font.medium },
  summaryNote: { color: ink.mid, ...type.caption, textAlign: 'right' },
  sheetWord: { ...type.h2, fontFamily: font.bold },
  sheetWordMade: { color: theme.okInk },
  sheetWordFailed: { color: theme.dangerInk },
  resultHeads: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.xs, paddingBottom: 2 },
  resultHead: { ...type.caption, fontFamily: font.bold, width: 44, textAlign: 'right' },
  resultHeadUs: { color: team.usInk, marginRight: 12 },
  resultHeadThem: { color: team.themInk },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  resultHero: { paddingVertical: space.xs },
  resultLabel: { color: ink.mid, ...type.body },
  resultLabelHero: { color: ink.hi, fontFamily: font.bold },
  rule: { height: 1, backgroundColor: stroke.hair, marginVertical: space.xs },
  voidNote: { color: theme.dangerInk, ...type.caption, fontStyle: 'italic' },
  pair: { flexDirection: 'row', alignItems: 'baseline' },
  pairValue: { ...type.body, ...num, width: 44, textAlign: 'right' },
  pairUs: { color: team.usInk },
  pairThem: { color: team.themInk },
  pairSep: { color: ink.lo, ...type.body, width: 12, textAlign: 'center' },
  pairHero: { ...type.h2, fontFamily: font.bold },
  sheetAward: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    marginTop: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    backgroundColor: surface.raised,
  },
  sheetAwardCoins: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sheetAwardText: { color: theme.okInk, ...type.body, fontFamily: font.bold },
  sheetLevel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: surface.chip,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  sheetLevelText: { color: theme.accent, ...type.sub, fontFamily: font.bold },
  sheetFoot: { gap: space.sm, alignItems: 'center', marginTop: space.sm },
  // A deal's three answers (next with its countdown, "Pregled ruke", leave)
  // are wider than a 360 dp sheet in Croatian and Serbian: they wrap to a
  // second line instead of running off both edges. (`gap` spaces the lines.)
  resultButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: space.sm },
  resultButtonsPinned: { marginTop: 0, alignItems: 'center' },
});
