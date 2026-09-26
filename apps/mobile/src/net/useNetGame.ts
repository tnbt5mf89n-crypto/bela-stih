import './polyfills';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Client, type Room } from 'colyseus.js';
import type { Action, DealScoreResult, PublicView, Seat, TeamId } from '@belot/engine';
import { teamOf } from '@belot/engine';
import type { TableEvent } from '@belot/table';
import { Lang } from '@belot/i18n';
import { canAffordGift, isoDay, spendOnGift, type Award, type GiftId, type PlayerProfile } from '@belot/progression';
import { AnchorMap } from '../anim/AnchorRegistry';
import { Director, timingsFor, type MotionPolicy } from '../anim/director';
import { botThinkMs } from '../anim/think';
import { EMPTY_LOG, logEvent } from '../matchLog';
import { troubleOf, type Trouble } from './trouble';
import { isPlayMode, modeFromLegacy, type PlayMode } from '../playMode';
import { sniffMime, type VoiceMime, type VoiceEcho } from '../voice/voice';
import type { Take } from '../voice/useVoiceRecorder';
import { FxBus } from '../anim/FxBus';
import { makeFxSpawner, spawnEmote } from '../table/fx';
import { useMotionPolicy } from '../anim/useMotionPolicy';
import { pattern } from '../haptics';
import { cueFor, type TableCue } from '../table/cues';
import { playSfx } from '../audio';
import { emptyTally, landingSound, mergeAward, processEvents } from '../feedback';
import { installId as myInstallId, loadBlocked, loadProfile, saveBlocked, saveProfile, type Settings } from '../storage';
import { blockedIds, withBlock } from '../identity';
import { applyGiftEcho, GIFT_COOLDOWN_MS, GIFT_ECHO_WAIT_MS, isGiftMessage, reachOf, recipientsOf } from '../gifts';
import { useGifts } from '../table/useGifts';
import { notePeople, standInsOf } from './standIns';
import { localHold, type TableHold, type WireHold } from './hold';
import { normalizeCode } from './code';
import { BLOCKED_CODE, PROTO } from './proto';
import { APP_VERSION } from '../screens/common';

/**
 * A table driven by the server, presented through the same animation director
 * as the offline game.
 *
 * The server sends this seat its own `PublicView` FIRST, then broadcasts the
 * event batch — so by the time events arrive, the batch's authoritative final
 * view is already stashed. The director paces the events and hard-syncs to
 * that view, exactly as offline; `TableScreen` cannot tell the modes apart.
 *
 * Nothing about the rules lives here: the client renders what the server says
 * is legal and sends back a chosen action. Anything stale is refused
 * server-side and surfaced, never thrown.
 */

/**
 * Where the game server lives.
 *
 * A build-time env var wins — EAS sets it for the store builds. Failing that,
 * a WEB build derives it from the page it was served from: Caddy fronts both
 * the static site and the websocket on a single origin, so the page's own host
 * is always the right answer, and it cannot drift the way a fixed default did.
 *
 * It drifted badly. `expo export --platform web` without the env var set kept
 * the development default, so the deployed bundle asked the browser to open
 * `ws://localhost:2567`; every online mode on belastih.com/igra failed the
 * instant it was touched, and the invite page linked straight into it. Two
 * consecutive web builds shipped that way, because nothing about it is visible
 * until a real browser tries to connect.
 *
 * Then it drifted again, on Android. `eas.json` sets the env var, but the
 * store builds are made locally with `gradlew bundleRelease` — which does not
 * read eas.json — so versionCode 15 and 16 shipped to the internal track
 * asking a player's phone to open `ws://localhost:2567`. Nothing surfaced it
 * until an online mode was touched on a real device. A packaged build now
 * falls back to the real server, and only a development build falls back to
 * a developer's own machine; `scripts/build-android.sh` refuses to hand over
 * a bundle that still names localhost.
 */
export const PRODUCTION_SERVER_URL = 'wss://belastih.com';

function resolveServerUrl(): string {
  const configured = process.env.EXPO_PUBLIC_SERVER_URL;
  if (configured) return configured;
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  if (loc?.host && !/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(loc.host)) {
    return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}`;
  }
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  return dev ? 'ws://localhost:2567' : PRODUCTION_SERVER_URL;
}

export const SERVER_URL = resolveServerUrl();
/**
 * The room this app asks for: the tables of apps that know the three versions
 * (the server's ROOM_NAME_MODES), so an older app is never matched into one.
 * A server from before them knows only the old name and says so with
 * MATCHMAKE_NO_HANDLER: then that one.
 */
const ROOM_NAME = 'bela-modes';
const ROOM_NAME_OLD = 'bela';
const NO_HANDLER_CODE = 4210;
async function eitherRoom(ask: (name: string) => Promise<Room>): Promise<Room> {
  try {
    return await ask(ROOM_NAME);
  } catch (err) {
    if ((err as { code?: number } | null)?.code !== NO_HANDLER_CODE) throw err;
    return ask(ROOM_NAME_OLD);
  }
}
/**
 * How long the server holds a dropped seat once a match is under way
 * (BelaRoom's TABLE_RECONNECT_SECONDS). The retry loop has to cover the whole
 * window: the room locks when the match starts, so the reconnection token is
 * the only way back in. It was a minute, and a phone call longer than that
 * sent the player back to the lobby for good.
 */
const RECONNECT_HOLD_MS = 30 * 60_000;
/** The server's refusal when a seat here is already held from this connection. */
const SAME_ORIGIN_CODE = 4300;
/** Colyseus: the room id is unknown or the room has been disposed (MATCHMAKE_INVALID_ROOM_ID). */
const ROOM_GONE_CODE = 4212;
/** Colyseus: the reconnection token has lapsed (MATCHMAKE_EXPIRED). */
const TOKEN_EXPIRED_CODE = 4214;
/** How long a 4214 still means "the server has not noticed the drop yet" (its ws pings: 3 s x 3). */
const TOKEN_GRACE_MS = 15_000;

export type NetStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'playing'
  | 'finished'
  | 'disconnected'
  | 'error';

export interface SeatInfo {
  /** The install ID this seat's app gave at its join (1.6.0): what a block or a report names. Absent for bots and older apps. */
  installId?: string;
  seat: Seat;
  name: string;
  avatar: string;
  connected: boolean;
  bot: boolean;
  /** The seat's latest table gift, as the room remembers it. */
  gift?: string;
  /** This seat can be given a gift (absent: an older app, which never sees one). */
  seesGifts?: true;
  /** This seat's app plays voice clips (absent: an older app, which is never sent one). */
  hearsVoice?: true;
}

/** A voice clip from the table (the room's VoiceMessage); the speaker's own echo has no data. */
export interface VoiceIn {
  from: Seat;
  id: number;
  ms: number;
  mime: VoiceMime;
  data: Uint8Array;
}

interface RoomMessage {
  seats: SeatInfo[];
  status: 'waiting' | 'playing' | 'finished';
  events: TableEvent[];
  turnMsLeft?: number;
  turnTotalMs?: number;
  /** The version played (a server from before the three sends only `hard`). */
  mode?: unknown;
  hard?: boolean;
  hostSeat?: Seat;
  series: [number, number];
  matchNumber: number;
  rematchVotes?: Seat[];
  /** The table's turn clock in seconds (a private table's host picks it). */
  turnSeconds?: number;
  /** Points the match is played to (a private table's host picks it; absent from an older server: 1001). */
  target?: number;
  /** Friends' table, by code: only there does it pause and wait. */
  private?: true;
  /** Voice messages are on at this table (absent from an older server: there are none). */
  voice?: true;
  /** A public table with voice on: strangers' clips reach only the seats that said `voiceIn` (1.6.0). */
  voiceOptIn?: true;
  /** Present while a private table stands still. */
  hold?: WireHold;
  /** At DEAL_OVER: time until the next deal starts by itself. */
  nextMsLeft?: number;
  /** At DEAL_OVER: who is ready for it. */
  nextVotes?: Seat[];
}

export function useNetGame(settings: Settings) {
  const roomRef = useRef<Room | null>(null);
  /**
   * The ticket back into a room we dropped out of.
   *
   * The server holds a dropped seat for a minute (`allowReconnection`), but the
   * room is locked the moment it starts, so `joinById` is refused with 4212 and
   * the only way back in is this token. Without it every backgrounded app, tunnel
   * and Wi-Fi handover permanently turned a player into a bot.
   */
  const reconnectTokenRef = useRef<string | null>(null);
  // Which connection attempt is current: leaving moves it on (see connect).
  const connGenRef = useRef(0);
  const reconnectRef = useRef<() => void>(() => {});
  const reconnectingRef = useRef(false);
  const directorRef = useRef<Director | null>(null);
  const authViewRef = useRef<PublicView | null>(null);
  const mySeatRef = useRef<Seat | null>(null);
  const profileRef = useRef<PlayerProfile>(loadProfile());
  const tally = useRef(emptyTally());

  const [status, setStatus] = useState<NetStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  // Every refused move, counted: the hand frees a play it was holding for.
  const [refusals, setRefusals] = useState(0);
  // Why the last attempt to reach a table failed, in the player's terms.
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [view, setView] = useState<PublicView | null>(null);
  const [idle, setIdle] = useState(true);
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const seatsRef = useRef<SeatInfo[]>([]);
  // The seats a person has played since the start: a bot in one of those is
  // standing in for someone (see standIns.ts).
  const hadPersonRef = useRef<ReadonlySet<Seat>>(new Set());
  // Players hidden on this device, for this table (the room): their name,
  // emotes and gifts stay off my screen. Nothing about it is sent anywhere.
  const [hidden, setHidden] = useState<readonly Seat[]>([]);
  const hiddenRef = useRef<readonly Seat[]>([]);
  const hiddenRoomRef = useRef<string | null>(null);
  // Players whose voice I have muted, at this table, on this device. Hiding a
  // player mutes them too; this is for one who is fine to see but not to hear.
  const [muted, setMuted] = useState<readonly Seat[]>([]);
  const mutedRef = useRef<readonly Seat[]>([]);
  const [voiceOn, setVoiceOn] = useState(false);
  // A public table asks its player before strangers are heard; the answer holds for this table.
  const [voiceOptIn, setVoiceOptIn] = useState(false);
  const [optedIn, setOptedIn] = useState(false);
  // This installation, and whom it keeps away (identity.ts): read once, sent at every join.
  const installIdRef = useRef<string>(myInstallId());
  const blockedRef = useRef<string[]>(blockedIds(loadBlocked()));
  // Where clips go: the table's playback (OnlineGame) and my own echo's rings.
  const voiceInRef = useRef<((clip: VoiceIn) => void) | null>(null);
  const voiceEchoRef = useRef<((echo: VoiceEcho) => void) | null>(null);
  const voiceHeardRef = useRef<((id: number, by: Seat) => void) | null>(null);
  const [mode, setMode] = useState<PlayMode>('easy');
  const modeRef = useRef<PlayMode>('easy');
  const tempoRef = useRef(settings.tempo);
  tempoRef.current = settings.tempo;
  modeRef.current = mode;
  const [hostSeat, setHostSeat] = useState<Seat | null>(null);
  const [series, setSeries] = useState<[number, number]>([0, 0]);
  const [matchNumber, setMatchNumber] = useState(0);
  const [rematchVotes, setRematchVotes] = useState<Seat[]>([]);
  const [banner, setBanner] = useState<Award | null>(null);
  // Whose move is being animated; cleared when the director goes idle.
  const [spotlight, setSpotlight] = useState<Seat | null>(null);
  const [cue, setCue] = useState<TableCue | null>(null);
  const [dealerHop, setDealerHop] = useState(false);
  const cueN = useRef(0);
  useEffect(() => {
    if (idle) {
      setSpotlight(null);
      setDealerHop(false);
    }
  }, [idle]);
  const [lastDealResult, setLastDealResult] = useState<DealScoreResult | null>(null);
  const [winnerTeam, setWinnerTeam] = useState<TeamId | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const [turnTotalMs, setTurnTotalMs] = useState(30_000);
  // A private table standing still, on this device's clock.
  const [hold, setHold] = useState<TableHold | null>(null);
  // The scored deal's countdown, and who is ready for the next one.
  const [nextDeadline, setNextDeadline] = useState<number | null>(null);
  const [nextVotes, setNextVotes] = useState<Seat[]>([]);
  const [turnSeconds, setTurnSeconds] = useState(30);
  const [target, setTarget] = useState(1001);
  const targetRef = useRef(1001);
  targetRef.current = target;
  const [isPrivate, setIsPrivate] = useState(false);
  // Once this room has been a table, a dropped connection keeps the table on
  // screen while the hook gets back into the seat - not the lobby, which is
  // where a phone call used to leave the player.
  const [atTable, setAtTable] = useState(false);

  const anchors = useMemo(() => new AnchorMap(), []);
  const fxBus = useMemo(() => new FxBus(), []);
  const lang = useMemo(() => new Lang(settings.locale), [settings.locale]);
  const motionRef = useRef<MotionPolicy>('full');
  const fx = useMemo(
    () =>
      makeFxSpawner({
        anchors,
        bus: fxBus,
        lang,
        mySeat: () => mySeatRef.current,
        view: () => directorRef.current?.getView() ?? null,
        reduced: () => motionRef.current === 'reduced',
      }),
    [anchors, fxBus, lang],
  );

  // The director is built inside attach() once; it reaches the spawner by ref.
  const fxRef = useRef(fx);
  fxRef.current = fx;
  // Pacing follows the motion policy, live: the director re-paces from the
  // next beat when it changes.
  const motion = useMotionPolicy(settings.motion);
  motionRef.current = motion;
  useEffect(() => {
    directorRef.current?.setTimings(timingsFor(motion, settings.tempo));
  }, [motion, settings.tempo]);

  // The table's gifts. The socket handlers are registered once, in attach(),
  // so they reach the hook through a ref, as they reach the spawner.
  const gifts = useGifts({
    anchors,
    fxBus,
    reduced: () => motionRef.current === 'reduced',
    mySeat: () => mySeatRef.current,
  });
  const giftsRef = useRef(gifts);
  giftsRef.current = gifts;
  // Who can be given a gift, from the room's seats.
  const giftReach = useMemo(() => reachOf(seats), [seats]);
  // What the screens show: a hidden player by their seat, never their name.
  const shownSeats = useMemo(
    () => (hidden.length === 0 ? seats : seats.map((x) => (hidden.includes(x.seat) ? { ...x, name: lang.seat(x.seat, seat) } : x))),
    [seats, hidden, lang, seat],
  );
  // A spend is read from the profile ref; this makes the wallet redraw for it.
  const [, setSpent] = useState(0);
  // The gift sent and not yet echoed, with the room whose socket carried it
  // and the seat count it was priced for — at most one: no second goes out
  // while it is waited for (GIFT_ECHO_WAIT_MS), so two can never ride on one
  // wallet. Only its own echo, on that room, pays for it.
  const unpaidRef = useRef<{ id: GiftId; n: number; at: number; room: Room } | null>(null);
  // The socket callbacks are created once; a ref keeps their locale current.
  const langRef = useRef(lang);
  langRef.current = lang;

  // The deals of the match in play, for the match-end summary. Every event,
  // flushed ones too; one missed while away leaves it short, and then the
  // sheet shows no summary rather than a wrong one (matchLog.ts).
  const matchLogRef = useRef(EMPTY_LOG);
  const [matchLog, setMatchLog] = useState(EMPTY_LOG);

  const onEvent = useCallback(
    (e: TableEvent, flushed: boolean, speed: number) => {
      const logged = logEvent(matchLogRef.current, e);
      if (logged !== matchLogRef.current) {
        matchLogRef.current = logged;
        setMatchLog(logged);
      }
      const mine = mySeatRef.current;
      if (mine === null) return;
      const r = processEvents({
        events: [e],
        profile: profileRef.current,
        tally: tally.current,
        mySeat: mine,
        silent: flushed,
        reduced: motionRef.current === 'reduced',
        autoZvanja: modeRef.current === 'learn',
        target: targetRef.current,
        today: isoDay(new Date()),
      });
      if (r.profile !== profileRef.current) {
        profileRef.current = r.profile;
        saveProfile(r.profile);
      }
      // The match's award joins the last deal's on the one banner: two
      // banners a second apart lost the deal's coins and its level-up star.
      if (r.award) {
        const a = r.award;
        setBanner((prev) => (e.kind === 'matchOver' ? mergeAward(prev, a) : a));
      }
      // The last deal's award leaves as the next deal begins, in the order the
      // table plays (a flushed batch included). The result itself stays: the
      // next dealScored replaces it before the sheet can come up again.
      if (e.kind === 'dealStarted') setBanner(null);
      if (!flushed) {
        fx.start(e, speed);
        // A seatless beat (the reveal, the deal, scoring) is nobody's move.
        setSpotlight('seat' in e ? e.seat : null);
        const c = cueFor(e, mine, directorRef.current?.getView() ?? null, ++cueN.current);
        if (c) setCue(c);
        else if (e.kind === 'dealStarted') setCue(null);
        if (e.kind === 'dealScored' && motionRef.current !== 'reduced') setDealerHop(true);
      }
    },
    [fx],
  );
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  /** Leave and forget the room, without treating it as an error. */
  const leave = useCallback(() => {
    // A gift still waiting for its echo on THIS room's socket went out: the
    // server reads it before this leave, on the same socket, and its echo
    // would come back to nobody. Paid here, before the home screen reads the
    // profile back. (One sent on a socket that has since dropped is not: that
    // send may never have arrived, and a lost send costs nothing.)
    const unpaid = unpaidRef.current;
    unpaidRef.current = null;
    if (unpaid && unpaid.room === roomRef.current && mySeatRef.current !== null && Date.now() - unpaid.at < GIFT_ECHO_WAIT_MS) {
      const next = spendOnGift(profileRef.current, unpaid.id, unpaid.n);
      if (next !== profileRef.current) {
        profileRef.current = next;
        saveProfile(next);
      }
    }
    const room = roomRef.current;
    roomRef.current = null;
    // Dropping the token both stops any reconnect in flight and marks this as
    // a departure rather than a drop; the count does the same for a join
    // still on its way (see connect).
    reconnectTokenRef.current = null;
    connGenRef.current += 1;
    if (room) void room.leave(true).catch(() => {});
    directorRef.current?.dispose();
    directorRef.current = null;
    authViewRef.current = null;
    mySeatRef.current = null;
    setStatus('idle');
    setError(null);
    setRoomId(null);
    setSeat(null);
    setView(null);
    setIdle(true);
    setSeats([]);
    hadPersonRef.current = new Set();
    hiddenRef.current = [];
    hiddenRoomRef.current = null;
    setHidden([]);
    mutedRef.current = [];
    setMuted([]);
    setVoiceOn(false);
    setSeries([0, 0]);
    setMatchNumber(0);
    setRematchVotes([]);
    setBanner(null);
    setCue(null);
    setSpotlight(null);
    setDealerHop(false);
    setLastDealResult(null);
    setWinnerTeam(null);
    setTurnDeadline(null);
    setHold(null);
    setNextDeadline(null);
    setNextVotes([]);
    setTurnSeconds(30);
    setIsPrivate(false);
    setAtTable(false);
    giftsRef.current.reset();
  }, []);

  // Sockets and directors never outlive the screen; background fast-forwards.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') {
        directorRef.current?.fastForward();
        // A call that does NOT drop the connection left the server thinking
        // the player was there, and the turn clock played their cards. A
        // private table now waits for them as for a drop; everywhere else the
        // server ignores this.
        roomRef.current?.send('away', {});
        return;
      }
      roomRef.current?.send('back', {});
      // Back from a phone call: if the connection died meanwhile, try the
      // seat again now rather than after whatever the retry loop is sleeping.
      if (roomRef.current === null && reconnectTokenRef.current !== null) reconnectRef.current();
    });
    return () => {
      sub.remove();
      // A departure, not a drop: colyseus fires onLeave for a consented leave
      // too, so the refs are cleared FIRST or the handler would buzz a
      // "disconnected" and start a minute of reconnect attempts on the home
      // screen (the Android back button exits without leave()).
      const room = roomRef.current;
      roomRef.current = null;
      reconnectTokenRef.current = null;
      connGenRef.current += 1; // and a join still in flight lands on nobody
      void room?.leave(true).catch(() => {});
      directorRef.current?.dispose();
    };
  }, []);

  const attach = useCallback((room: Room) => {
    roomRef.current = room;
    reconnectTokenRef.current = room.reconnectionToken;
    setRoomId(room.roomId);
    // What the last deal scored, and who won the match, are this client's own
    // record of events it watched. A reconnect rebuilds the view from the
    // room and may land straight in DEAL_OVER or MATCH_OVER, having missed
    // both - so the record goes, and the sheet shows the match score alone
    // rather than another deal's numbers.
    setLastDealResult(null);
    setWinnerTeam(null);
    // A reconnect to the same table keeps the players I hid; a new table
    // starts with nobody hidden.
    if (hiddenRoomRef.current !== room.roomId) {
      hiddenRoomRef.current = room.roomId;
      hiddenRef.current = [];
      setHidden([]);
      setOptedIn(false);
      mutedRef.current = [];
      setMuted([]);
    }

    room.onMessage('view', (msg: { seat: Seat; view: PublicView }) => {
      mySeatRef.current = msg.seat;
      authViewRef.current = msg.view;
      setSeat(msg.seat);
      if (!directorRef.current) {
        // A rebuilt table (a reconnect) starts with no cue to replay.
        setCue(null);
        setSpotlight(null);
        setDealerHop(false);
        directorRef.current = new Director(
          msg.seat,
          msg.view,
          {
            onView: setView,
            onEventStart: (e, f, s) => onEventRef.current(e, f, s),
            onEventEnd: (e, speed) => {
              const mine = mySeatRef.current;
              if (mine !== null) landingSound(e, mine, motionRef.current === 'reduced');
              fxRef.current.end(e, speed);
              if (e.kind === 'dealScored') setDealerHop(false);
            },
            onSkip: (n) => {
              if (n >= 2) playSfx('settle');
            },
            onIdle: setIdle,
            // Anchors re-measure as each batch starts; the table bumps them too
            // whenever a row around the felt comes or goes.
            onBatch: () => anchors.bump(),
            // The server's bots move the instant they may; they take a moment
            // here, as offline. A person's move shows as it came: they took
            // their own time.
            thinkMs: (e, v) =>
              motionRef.current !== 'reduced' &&
              'seat' in e &&
              e.seat !== mySeatRef.current &&
              seatsRef.current[e.seat]?.bot === true
                ? botThinkMs(e, v, Math.random())
                : 0,
            onThink: (e) => setSpotlight('seat' in e ? e.seat : null),
          },
          timingsFor(motionRef.current, tempoRef.current),
        );
        setView(msg.view);
      }
    });

    room.onMessage('room', (msg: RoomMessage) => {
      // Someone sat down, or left: a note each way (bots and the first
      // message excepted).
      const before = seatsRef.current;
      if (before.length === msg.seats.length) {
        for (let i = 0; i < msg.seats.length; i++) {
          const was = before[i]!;
          const now = msg.seats[i]!;
          if (i === mySeatRef.current) continue;
          // A person leaving; starting with bots turns empty seats into bots
          // too, and nobody left there.
          if (!was.bot && now.bot && was.connected) playSfx('seatLeave');
          else if (was.bot && !now.bot) {
            playSfx('seatJoin');
            pattern('seatJoin');
          }
        }
      }
      hadPersonRef.current = notePeople(hadPersonRef.current, msg.status, msg.seats);
      seatsRef.current = msg.seats;
      setSeats(msg.seats);
      giftsRef.current.resync(msg.seats.map((x) => x.gift ?? null));
      setMode(isPlayMode(msg.mode) ? msg.mode : modeFromLegacy(msg.hard));
      setHostSeat(msg.hostSeat ?? null);
      setSeries(msg.series ?? [0, 0]);
      setMatchNumber(msg.matchNumber ?? 0);
      setRematchVotes(msg.rematchVotes ?? []);
      setStatus(msg.status);
      if (msg.status !== 'waiting') setAtTable(true);
      const now = Date.now();
      setHold(localHold(msg.hold, now));
      setNextDeadline(msg.nextMsLeft != null ? now + msg.nextMsLeft : null);
      setNextVotes(msg.nextVotes ?? []);
      setTurnSeconds(msg.turnSeconds ?? 30);
      setTarget(msg.target ?? 1001);
      setIsPrivate(msg.private === true);
      setVoiceOn(msg.voice === true);
      setVoiceOptIn(msg.voiceOptIn === true);
      // A stale-tap refusal is stale itself the moment the game moves on.
      if (msg.events.length > 0) setError(null);
      if (msg.turnTotalMs) setTurnTotalMs(msg.turnTotalMs);
      setTurnDeadline(msg.turnMsLeft != null ? Date.now() + msg.turnMsLeft : null);

      // The result panel needs the scored deal, which only the events carry.
      for (const e of msg.events) {
        if (e.kind === 'dealScored') setLastDealResult(e.result);
        if (e.kind === 'matchOver') setWinnerTeam(e.winner);
        // A new match wipes the last one's verdict off the screen.
        if (e.kind === 'matchStarted') {
          setWinnerTeam(null);
          setLastDealResult(null);
          setBanner(null);
        }
      }

      const d = directorRef.current;
      const finalView = authViewRef.current;
      if (d && finalView) d.enqueue({ events: msg.events, finalView });
    });

    room.onMessage('error', () => {
      // The server refused a move — usually a stale tap. Not fatal, and its
      // wording is the server's own English: the player is told in theirs.
      playSfx('denied');
      pattern('error');
      setError(langRef.current.s.ui.moveRefused);
      setRefusals((n) => n + 1);
    });

    room.onMessage('gift', (msg: unknown) => {
      // A gift this client does not know (a newer app's) is ignored, not charged.
      if (!isGiftMessage(msg)) return;
      // A room I have left draws nothing and bills nothing: leave() settled
      // what was owed, and a view still queued on the old socket may have set
      // my seat again, so nothing past this line may trust it.
      if (roomRef.current !== room) return;
      // The sender pays now, on the server's echo of their own pending send —
      // never on the send, so a gift the server dropped (its rate limit, an
      // old server, no network) costs nothing, and never for more seats than
      // they were shown. Anyone else's profile is left exactly as it was.
      const unpaid = unpaidRef.current;
      if (unpaid && unpaid.room === room && unpaid.id === msg.id && msg.from === mySeatRef.current) {
        unpaidRef.current = null;
        const next = applyGiftEcho(profileRef.current, msg, mySeatRef.current, unpaid.n);
        if (next !== profileRef.current) {
          profileRef.current = next;
          saveProfile(next);
          setSpent((n) => n + 1);
        }
        // The wait runs again from the echo: the server times its gap from
        // each gift's arrival, so a first send that arrived late can never
        // make the next one early and have it dropped.
        giftsRef.current.arm(GIFT_COOLDOWN_MS);
      }
      giftsRef.current.fly(msg.from, msg.to, msg.id);
    });

    room.onMessage('emote', (msg: { seat: Seat; id: string }) => {
      if (hiddenRef.current.includes(msg.seat)) return; // a player I hid
      spawnEmote(
        { anchors, bus: fxBus, lang: langRef.current, reduced: () => motionRef.current === 'reduced' },
        msg.seat,
        msg.id,
      );
      playSfx('pop');
    });

    // A clip from the table goes to the playback; nothing is kept. My own
    // comes back without the audio: the room took it, and the others hear it
    // now - my puck rings for as long, and the mic says whom it went to.
    room.onMessage(
      'voice',
      (msg: { from?: unknown; id?: unknown; ms?: unknown; data?: unknown; to?: unknown; noReceipt?: unknown } | null) => {
      const from = msg?.from;
      const ms = msg?.ms;
      if (typeof from !== 'number' || from < 0 || from > 3 || typeof ms !== 'number') return;
      if (msg!.data === undefined) {
        if (from === mySeatRef.current) {
          const seats = (v: unknown): Seat[] =>
            Array.isArray(v) ? (v.filter((x) => typeof x === 'number' && x >= 0 && x <= 3) as Seat[]) : [];
          voiceEchoRef.current?.({
            id: typeof msg!.id === 'number' ? msg!.id : -1,
            ms,
            // A room from before receipts says nothing of either: null, "cannot say".
            to: Array.isArray(msg!.to) ? seats(msg!.to) : null,
            noReceipt: seats(msg!.noReceipt),
          });
        }
        return;
      }
      const seat = from as Seat;
      if (seat === mySeatRef.current || hiddenRef.current.includes(seat) || mutedRef.current.includes(seat)) return;
      const raw = msg!.data;
      const data = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
      const mime = data ? sniffMime(data) : null;
      if (!data || !mime) return;
      voiceInRef.current?.({ from: seat, id: typeof msg!.id === 'number' ? msg!.id : 0, ms, mime, data });
      },
    );
    // Somebody's app has started playing my clip.
    room.onMessage('voiceHeard', (msg: { id?: unknown; by?: unknown } | null) => {
      const by = msg?.by;
      if (typeof msg?.id !== 'number' || typeof by !== 'number' || by < 0 || by > 3) return;
      voiceHeardRef.current?.(msg.id, by as Seat);
    });

    room.onLeave((code) => {
      if (roomRef.current !== room) return; // we left on purpose
      roomRef.current = null;
      // A gift sent on this socket can never be echoed now: a send lost with
      // its connection costs nothing, and does not hold up the next one.
      if (unpaidRef.current?.room === room) unpaidRef.current = null;
      directorRef.current?.fastForward();
      setStatus('disconnected');
      pattern('disconnect');
      setError(langRef.current.s.ui.disconnectedWithCode(code));
      // Our seat is being played by a bot from here; the server will hold it
      // for a minute, so spend that minute trying to get back into it.
      reconnectRef.current();
    });
  }, []);

  // What the last connection did, so an error state can try it again.
  const lastMakeRef = useRef<((client: Client) => Promise<Room>) | null>(null);
  const connect = useCallback(
    async (make: (client: Client) => Promise<Room>) => {
      lastMakeRef.current = make;
      leave();
      // This attempt's number: leaving (or a newer attempt) moves it on.
      const gen = connGenRef.current;
      setStatus('connecting');
      setError(null);
      setTrouble(null);
      try {
        const client = new Client(SERVER_URL);
        const room = await make(client);
        // The player left while this join was in flight - Natrag, Android's
        // back, the browser's Back on "Spajanje…". Seated now, the room would
        // hold a live person nobody is behind: the server never bots such a
        // seat, and every one of its turns costs the other three the full clock.
        if (gen !== connGenRef.current) {
          void room.leave(true).catch(() => {});
          return;
        }
        attach(room);
        setStatus('waiting');
      } catch (err) {
        if (gen !== connGenRef.current) return;
        setStatus('error');
        // The library's words ("room \"X\" is locked") are for the log.
        setError((err as Error).message || langRef.current.s.ui.cannotConnect(SERVER_URL));
        setTrouble(troubleOf(err));
      }
    },
    [attach, leave],
  );

  /**
   * Walk back in on the reconnection token, with backoff, inside the server's
   * hold window. `joinById` stays the fallback for after the window lapses —
   * it only works on a table that has not started, but that is exactly the
   * case the token cannot cover.
   */
  const reconnect = useCallback(async () => {
    const token = reconnectTokenRef.current;
    if (!token || reconnectingRef.current) return;
    reconnectingRef.current = true;
    // Reconnecting, from the first attempt: while this loop runs the lobby
    // offers no Retry, which would leave the table (a host's Retry opens a
    // new one) and strand the friends at the old code. "disconnected" comes
    // back only when the loop gives up.
    setStatus('connecting');
    // Keep trying for as long as the server actually holds the seat. Giving up
    // early and dropping the token stranded anyone whose link came back inside
    // the window: the room locks on start, so this token is the only way in.
    const startedAt = Date.now();
    const deadline = startedAt + RECONNECT_HOLD_MS;
    try {
      for (let wait = 0; Date.now() < deadline; wait = Math.min(5000, wait + 1000)) {
        // Jittered: a whole cafe's phones coming back on one router would
        // otherwise knock on the server in lockstep.
        if (wait > 0) await new Promise((r) => setTimeout(r, wait * (0.5 + Math.random())));
        // The player gave up and walked away while we were waiting.
        if (reconnectTokenRef.current !== token) return;
        try {
          const room = await new Client(SERVER_URL).reconnect(token);
          // They may have left while this attempt was in flight. Joining now
          // would seat a room nothing will ever leave: the server sees a live
          // human on the seat, never bots it, and every one of that seat's
          // turns costs the other three the full clock.
          if (reconnectTokenRef.current !== token) {
            void room.leave(true).catch(() => {});
            return;
          }
          // Rebuild the animation from the authoritative view rather than
          // resuming a director that missed however many events we were away
          // for; the server publishes the current view on join.
          directorRef.current?.dispose();
          directorRef.current = null;
          attach(room);
          playSfx('reconnected');
          setError(null);
          return;
        } catch (err) {
          // The table is gone (disposed): no number of retries brings it back.
          // "Token expired" (4214) is also what Colyseus answers BEFORE the
          // server has noticed our old socket died - it only starts holding the
          // seat once its own pings give up on it, up to ~9 s after we saw the
          // drop - so for the first while that code means "not yet", and only
          // later "never". Anything else is the line.
          const code = (err as { code?: number } | null)?.code;
          if (code === ROOM_GONE_CODE) break;
          if (code === TOKEN_EXPIRED_CODE && Date.now() - startedAt > TOKEN_GRACE_MS) break;
          setStatus('connecting');
        }
      }
      // The hold really has lapsed: the seat is a bot and the room is locked.
      reconnectTokenRef.current = null;
      setAtTable(false);
      setStatus('disconnected');
    } finally {
      reconnectingRef.current = false;
    }
  }, [attach]);

  useEffect(() => {
    reconnectRef.current = () => void reconnect();
  }, [reconnect]);

  // The only things we ever tell the server about the player (and, with
  // `gifts: true`, that this app draws table gifts; with `voice`, that it
  // plays and records voice messages - unless the player switched them off).
  const name = settings.nickname.trim().slice(0, 20);
  const avatar = profileRef.current.selectedAvatar;
  const voiceRef = useRef(settings.voice);
  voiceRef.current = settings.voice;

  /** What every join says about this installation (identity.ts): its ID and its block list. */
  const identity = useCallback(() => ({ installId: installIdRef.current, blocked: blockedRef.current }), []);

  const quickPlay = useCallback(
    () =>
      connect(async (c) => {
        try {
          return await eitherRoom((room) => c.joinOrCreate(room, { name, avatar, gifts: true, voice: voiceRef.current, receipts: true, proto: PROTO, appVersion: APP_VERSION, ...identity() }));
        } catch (err) {
          // The open table already has somebody playing from this connection.
          // With no accounts the server cannot tell a second player here from
          // a second tab, and three tabs at one table can read the fourth
          // player's hand by elimination — so it seats us apart rather than
          // turning us away. A fresh public table, and strangers join us there.
          // Likewise a table where somebody has blocked us, or we them (4302):
          // the matchmaker would offer the same table again, so a fresh one.
          const code = (err as { code?: number } | null)?.code;
          if (code !== SAME_ORIGIN_CODE && code !== BLOCKED_CODE) throw err;
          return await eitherRoom((room) => c.create(room, { name, avatar, gifts: true, voice: voiceRef.current, receipts: true, proto: PROTO, appVersion: APP_VERSION, ...identity() }));
        }
      }),
    [connect, name, avatar, identity],
  );
  const createPrivate = useCallback(
    () =>
      connect((c) =>
        // The host's version travels with the table it creates; `hard` is for a
        // server from before the three versions.
        eitherRoom((room) =>
          c.create(room, {
          name,
          avatar,
          gifts: true,
          voice: voiceRef.current,
          receipts: true,
          proto: PROTO,
          appVersion: APP_VERSION,
          ...identity(),
          private: true,
          mode: settings.difficulty,
          hard: settings.difficulty === 'hard',
          }),
        ),
      ),
    [connect, name, avatar, settings.difficulty, identity],
  );
  const joinById = useCallback(
    (id: string) => connect((c) => c.joinById(normalizeCode(id), { name, avatar, gifts: true, voice: voiceRef.current, receipts: true, proto: PROTO, appVersion: APP_VERSION, ...identity() })),
    [connect, name, avatar, identity],
  );

  const submit = useCallback((a: Action) => {
    const room = roomRef.current;
    if (!room) return;
    setBanner(null);
    room.send('action', { action: a });
  }, []);

  // Only asks: the sheet stays up, result and all, until the next deal
  // actually starts. Clearing it here blanked the sheet for a round trip.
  /** Ready for the next deal: it starts when everyone is, or when the countdown ends. */
  const next = useCallback(() => {
    roomRef.current?.send('next', {});
  }, []);
  /** Private tables: stop the table for everyone, and carry on. */
  const pause = useCallback(() => roomRef.current?.send('pause', {}), []);
  const resume = useCallback(() => roomRef.current?.send('resume', {}), []);
  /** Stop waiting for a dropped player: a bot holds their cards until they are back. */
  const playOn = useCallback(() => roomRef.current?.send('playOn', {}), []);
  /** Host, before the start: the turn clock. */
  const setClock = useCallback((seconds: number) => roomRef.current?.send('clock', { seconds }), []);
  /** Host, before the start: the match length and Prava bela (either may be left out). */
  const setRules = useCallback(
    (rules: { target?: number; mode?: PlayMode; voice?: boolean }) =>
      roomRef.current?.send('rules', {
        ...rules,
        // A server from before the three versions reads only the old switch.
        ...(rules.mode ? { hard: rules.mode === 'hard' } : {}),
      }),
    [],
  );

  // The server validates, rate-limits and echoes it back; the bubble spawns
  // from the broadcast, so what I see is exactly what the table saw.
  const sendEmote = useCallback((id: string) => {
    roomRef.current?.send('emote', { id });
  }, []);

  // Voice switched off or on in Settings while at a table: the room stops or
  // starts sending this app clips (at a join it is in the options).
  useEffect(() => {
    roomRef.current?.send('hears', { on: settings.voice });
  }, [settings.voice]);

  /** A take, sent whole; the room relays it to the others and echoes it without the audio. */
  const sendVoice = useCallback((take: Take) => {
    roomRef.current?.send('voice', { mime: take.mime, ms: take.ms, data: take.data });
  }, []);
  /** A clip from the table has started playing here: its speaker is told. */
  const confirmHeard = useCallback((id: number) => {
    roomRef.current?.send('heard', { id });
  }, []);
  /** Where clips from the table go, my own echo, and the receipts for it (OnlineGame's playback, rings and mic). */
  const onVoice = useCallback(
    (
      hear: ((clip: VoiceIn) => void) | null,
      echo: ((e: VoiceEcho) => void) | null,
      heard: ((id: number, by: Seat) => void) | null,
    ) => {
      voiceInRef.current = hear;
      voiceEchoRef.current = echo;
      voiceHeardRef.current = heard;
    },
    [],
  );
  /** Mute one player's voice at this table, on this device, or hear them again. */
  const mute = useCallback((s: Seat, on: boolean) => {
    if (s === mySeatRef.current) return;
    const cur = mutedRef.current;
    const next = on ? (cur.includes(s) ? cur : [...cur, s]) : cur.filter((x) => x !== s);
    mutedRef.current = next;
    setMuted(next);
  }, []);

  /**
   * A table gift: only asked for here. The server relays it to everybody,
   * sender included, and the sender pays on that echo (see the 'gift'
   * handler) — nothing here touches the profile.
   */
  const sendGift = useCallback((id: GiftId, to: Seat | 'table') => {
    const room = roomRef.current;
    const me = mySeatRef.current;
    const g = giftsRef.current;
    const now = Date.now();
    if (!room || me === null || now < g.giftReadyAt) return false;
    const unpaid = unpaidRef.current;
    // Paid for only as many as can see it — the same count the server's echo
    // will carry, since it drops the seats of older apps too.
    const n = recipientsOf(to, me, reachOf(seatsRef.current)).length;
    if ((unpaid && now - unpaid.at < GIFT_ECHO_WAIT_MS) || n === 0 || !canAffordGift(profileRef.current, id, n)) {
      playSfx('denied');
      return false;
    }
    // The picker waits as long as the send is waited for; the echo shortens
    // that to GIFT_COOLDOWN_MS from its own arrival.
    g.arm(GIFT_ECHO_WAIT_MS);
    unpaidRef.current = { id, n, at: now, room };
    room.send('gift', { id, to });
    return true;
  }, []);

  /**
   * Hide a player at this table on this device, or show them again: their
   * name gives way to the seat's ("Desni"), their emotes and gifts stop, and
   * the badges they gave come off. Local only; gifts I pay for are untouched.
   */
  const hide = useCallback((s: Seat, on: boolean) => {
    if (s === mySeatRef.current) return;
    const cur = hiddenRef.current;
    const next = on ? (cur.includes(s) ? cur : [...cur, s]) : cur.filter((x) => x !== s);
    hiddenRef.current = next;
    setHidden(next);
    giftsRef.current.mute(s, on);
  }, []);
  /** At a public table: hear strangers' clips here (or stop). The server relays nothing to a seat that did not ask. */
  const voiceIn = useCallback((on: boolean) => {
    roomRef.current?.send('voiceIn', { on });
    setOptedIn(on);
  }, []);
  /**
   * Block a player for good, on this device (identity.ts): quick play never
   * seats us together again, and nothing of theirs reaches us at any table.
   * Hides them for this table too. An older app's seat has no ID to block, so
   * it is only hidden; the answer says which.
   */
  const block = useCallback(
    (s: Seat): boolean => {
      const info = seatsRef.current.find((x) => x.seat === s);
      const id = info?.installId;
      if (id) {
        const list = withBlock(loadBlocked(), id, info?.name ?? '', isoDay(new Date()));
        saveBlocked(list);
        blockedRef.current = blockedIds(list);
      }
      hide(s, true);
      return !!id;
    },
    [hide],
  );
  /** The install ID behind a seat, for a report to name; undefined for a bot or an older app. */
  const installIdOf = useCallback((s: Seat) => seatsRef.current.find((x) => x.seat === s)?.installId, []);
  /** A player's name as the room has it: a report names the real nickname. */
  const realName = useCallback((s: Seat) => seatsRef.current.find((x) => x.seat === s)?.name ?? '', []);

  /** Host only: start the game now, bots filling the empty seats. */
  const startWithBots = useCallback(() => {
    roomRef.current?.send('start', {});
  }, []);

  /** Pre-start: move to a free seat — how friends pick teams. */
  const sit = useCallback((target: Seat) => {
    roomRef.current?.send('sit', { seat: target });
  }, []);

  /** The lobby's "try again": the same connection, once more. */
  const retry = useCallback(() => {
    const make = lastMakeRef.current;
    if (make) void connect(make);
  }, [connect]);

  /** After a match: ask for another with the same people (all must agree). */
  const rematch = useCallback(() => roomRef.current?.send('rematch', {}), []);
  const rematchCancel = useCallback(() => roomRef.current?.send('rematchCancel', {}), []);
  /** Host only: start the next match now, bots filling anyone who left. */
  const rematchStart = useCallback(() => roomRef.current?.send('rematchStart', {}), []);

  return {
    status,
    refusals,
    error,
    trouble,
    roomId,
    seat,
    view,
    idle,
    // A hidden player shows by their seat's name everywhere these are read.
    seats: shownSeats,
    mode,
    hostSeat,
    series,
    matchNumber,
    rematchVotes,
    profile: profileRef.current,
    banner,
    lastDealResult,
    spotlight,
    matchLog,
    cue,
    dealerHop,
    motion,
    matchOver: view?.phase === 'MATCH_OVER',
    retry,
    hold,
    nextDeadline,
    nextVotes,
    turnSeconds,
    target,
    isPrivate,
    // Getting back into a seat after a drop: the table stays up meanwhile.
    reconnecting: atTable && (status === 'disconnected' || status === 'connecting'),
    pause,
    resume,
    playOn,
    setClock,
    setRules,
    // The matchOver event says who won, but a client that reconnected into a
    // finished match never heard it. The view still knows: at MATCH_OVER the
    // higher score has won - the engine's own rule (matchWinner,
    // packages/engine/src/state.ts), so the two can never disagree.
    winnerTeam:
      winnerTeam ??
      (view?.phase === 'MATCH_OVER' ? ((view.matchScores[0] > view.matchScores[1] ? 0 : 1) as TeamId) : null),
    turnDeadline,
    turnTotalMs,
    anchors,
    fxBus,
    lang,
    quickPlay,
    createPrivate,
    joinById,
    reconnect,
    startWithBots,
    sit,
    rematch,
    rematchCancel,
    rematchStart,
    submit,
    next,
    sendEmote,
    sendGift,
    giftReach,
    voiceOn,
    sendVoice,
    onVoice,
    confirmHeard,
    muted,
    mute,
    voiceOptIn,
    optedIn,
    voiceIn,
    block,
    installIdOf,
    // The seats a bot stands in for: a person's once, never a bot's from the start.
    standIns: standInsOf(shownSeats, hadPersonRef.current, seat),
    hidden,
    hide,
    realName,
    gifts: gifts.gifts,
    giftLanded: gifts.giftLanded,
    giftFrom: gifts.giftFrom,
    giftReadyAt: gifts.giftReadyAt,
    leave,
  };
}

export type NetGame = ReturnType<typeof useNetGame>;

export { teamOf };
