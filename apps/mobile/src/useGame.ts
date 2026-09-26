import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Action, type PublicView, type Seat } from '@belot/engine';
import { MODE_CONFIG } from './playMode';
import { Table } from '@belot/table';
import type { BotLevel } from '@belot/bots';
import { Lang } from '@belot/i18n';
import { spendOnGift, type Award, type GiftId, type PlayerProfile, isoDay } from '@belot/progression';
import { AnchorMap } from './anim/AnchorRegistry';
import { FxBus } from './anim/FxBus';
import { useDirector } from './anim/useDirector';
import { makeFxSpawner, spawnEmote } from './table/fx';
import { timingsFor, type MotionPolicy } from './anim/director';
import { botThinkMs } from './anim/think';
import { EMPTY_LOG, logEvent } from './matchLog';
import { cueFor, type TableCue } from './table/cues';
import { useMotionPolicy } from './anim/useMotionPolicy';
import { BOT_EMOTES } from './emotes';
import { playSfx } from './audio';
import { emptyTally, landingSound, mergeAward, processEvents } from './feedback';
import { loadProfile, saveProfile, type Settings } from './storage';
import { BOT_GIFTS_START, botGiftStep, botThanks, type BotGiftState } from './botGifts';
import { GIFT_COOLDOWN_MS, recipientsOf } from './gifts';
import { GIFT_FLY_MS } from './anim/lifetimes';
import { useGifts, type GiftSeats } from './table/useGifts';

/** Offline, the person always sits south. */
export const HUMAN: Seat = 0;

/** What the table looks like before the first deal animation lands. */
function preDealView(v: PublicView): PublicView {
  return {
    ...v,
    hand: [],
    handCounts: [0, 0, 0, 0],
    currentTrick: [],
    announcedDeclarations: [],
    myDeclarations: [],
    belaAnnouncedBy: null,
    context: { contractType: 'SUIT', trumpSuit: null },
    callerSeat: null,
    multiplier: 1,
    toAct: null,
    legalActions: [],
    mustDeclare: false,
    canDeclare: false,
    canAnnounceBela: false,
    // The constructor has already run the bots to my first decision, which
    // may be the zvanja question: without this the prompt showed for the
    // 350 ms before the deal animation began.
    declareTurn: null,
  };
}

/**
 * One local game against the bots, presented through the animation director:
 * the screen renders the director's paced view, and every event drives sprites,
 * sound and progression exactly once — animated or flushed.
 *
 * A new match is a new mount (the screen keys on match id), so table, director
 * and effects always start together.
 */
export function useGame(
  settings: Settings,
  level: BotLevel = 'medium',
  /** Kept by the screen above the match, so the table's gifts survive a rematch. */
  giftStore?: { current: GiftSeats },
  /** Kept there too: the bots' gift manners (never two deals running) span a rematch. */
  botGiftStore?: { current: BotGiftState },
) {
  const tableRef = useRef<Table | null>(null);
  if (tableRef.current === null) {
    tableRef.current = new Table({
      humanSeats: [HUMAN],
      botLevel: level,
      config: MODE_CONFIG[settings.difficulty],
    });
  }
  const table = tableRef.current;

  const profileRef = useRef<PlayerProfile>(loadProfile());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tally = useRef(emptyTally());
  const [banner, setBanner] = useState<Award | null>(null);
  // Whose move is being animated: the seat of every event as it starts,
  // cleared when the director goes idle. Presentation only — `toAct` on the
  // intermediate views stays null, and the turn cues never see this.
  const [spotlight, setSpotlight] = useState<Seat | null>(null);
  // What the table itself does about an event: a nod, a shake, a glow.
  const [cue, setCue] = useState<TableCue | null>(null);
  const cueN = useRef(0);
  // The dealer's button is in the air: the puck hides its own "D" meanwhile.
  const [dealerHop, setDealerHop] = useState(false);

  const anchors = useMemo(() => new AnchorMap(), []);
  const fxBus = useMemo(() => new FxBus(), []);
  const lang = useMemo(() => new Lang(settings.locale), [settings.locale]);
  // Every delayed beat this match schedules — a bot's gloat, its thanks, its
  // gift — dies with it: leaving mid-way once played a pop on the home screen.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = timers.current;
    return () => {
      live.forEach(clearTimeout);
      live.clear();
    };
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    const h = setTimeout(() => {
      timers.current.delete(h);
      fn();
    }, ms);
    timers.current.add(h);
  }, []);
  // The spawner is built before the director exists; it reads the view
  // through a ref the director fills in just below.
  const getViewRef = useRef<() => PublicView | null>(() => null);
  const motionRef = useRef<MotionPolicy>('full');
  const fx = useMemo(
    () =>
      makeFxSpawner({
        anchors,
        bus: fxBus,
        lang,
        mySeat: () => HUMAN,
        view: () => getViewRef.current(),
        reduced: () => motionRef.current === 'reduced',
      }),
    [anchors, fxBus, lang],
  );

  // Pacing follows the motion policy, live: the director re-paces from the
  // next beat when it changes (the system switch resolves a tick in).
  const motion = useMotionPolicy(settings.motion);
  motionRef.current = motion;

  const gifts = useGifts({
    anchors,
    fxBus,
    reduced: () => motionRef.current === 'reduced',
    mySeat: () => HUMAN,
    store: giftStore,
  });
  const ownBotGifts = useRef(BOT_GIFTS_START);
  const botGifts = botGiftStore ?? ownBotGifts;
  // The deals of the match in play, for the match-end summary (matchLog.ts).
  const matchLogRef = useRef(EMPTY_LOG);
  const [matchLog, setMatchLog] = useState(EMPTY_LOG);
  const { view, idle, enqueue, getView } = useDirector(
    HUMAN,
    useMemo(() => preDealView(table.view(HUMAN)), [table]),
    (e, flushed, speed) => {
      const logged = logEvent(matchLogRef.current, e);
      if (logged !== matchLogRef.current) {
        matchLogRef.current = logged;
        setMatchLog(logged);
      }
      const r = processEvents({
        events: [e],
        profile: profileRef.current,
        tally: tally.current,
        mySeat: HUMAN,
        silent: flushed,
        reduced: motionRef.current === 'reduced',
        // Offline: Učenje spots the zvanja for the player; every match plays to 1001.
        autoZvanja: settingsRef.current.difficulty === 'learn',
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
      if (!flushed) {
        fx.start(e, speed);
        // A seatless beat (the reveal, the deal, scoring) is nobody's move.
        setSpotlight('seat' in e ? e.seat : null);
        const c = cueFor(e, HUMAN, getViewRef.current(), ++cueN.current);
        // A cue is played once, by its `n`; a new deal wipes the last one so
        // nothing stale can replay when the table is rebuilt (a rotation).
        if (c) setCue(c);
        else if (e.kind === 'dealStarted') setCue(null);
        if (e.kind === 'dealScored' && motionRef.current !== 'reduced') setDealerHop(true);
      }
      // A bot that takes a trick occasionally gloats — the table talks back.
      if (!flushed && e.kind === 'trickWon' && e.seat !== HUMAN && Math.random() < 0.22) {
        const id = BOT_EMOTES[Math.floor(Math.random() * BOT_EMOTES.length)]!;
        const seat = e.seat;
        later(800, () => {
          spawnEmote({ anchors, bus: fxBus, lang, reduced: () => motionRef.current === 'reduced' }, seat, id);
          playSfx('pop');
        });
      }
      // …and now and then buys a coffee, or sends tissues (see botGifts.ts).
      // Only for beats that actually play: a flushed batch is history.
      if (!flushed) {
        const step = botGiftStep(e, botGifts.current, HUMAN, Math.random);
        botGifts.current = step.state;
        const g = step.gift;
        if (g) later(g.delayMs, () => gifts.fly(g.from, [HUMAN], g.id));
      }
    },
    // Anchors re-measure as each batch starts (the measurement lands a frame
    // in; the table bumps them on every reflow as well).
    () => anchors.bump(),
    {
      timings: timingsFor(motion),
      onEventEnd: (e, speed) => {
        landingSound(e, HUMAN, motionRef.current === 'reduced');
        fx.end(e, speed);
        if (e.kind === 'dealScored') setDealerHop(false);
      },
      // A skip of any size is one short settle of air, not a hail of sounds.
      onSkip: (n) => {
        if (n >= 2) playSfx('settle');
      },
      // Every seat but mine is a bot here: each takes a moment of its own
      // before its move shows, lit meanwhile. Pace only, never under reduce-motion.
      thinkMs: (e, v) =>
        motionRef.current !== 'reduced' && 'seat' in e && e.seat !== HUMAN ? botThinkMs(e, v, Math.random()) : 0,
      onThink: (e) => setSpotlight('seat' in e ? e.seat : null),
    },
  );

  getViewRef.current = getView;
  useEffect(() => {
    if (idle) {
      setSpotlight(null);
      setDealerHop(false);
    }
  }, [idle]);

  // The constructor already ran the bots to the first human decision; feed that
  // opening batch (deal animation included) into the director exactly once.
  const primed = useRef(false);
  if (!primed.current) {
    primed.current = true;
    // Deferred a tick so the first layout pass registers the anchors first
    // (and cancelled with the match, like every other delayed beat here).
    later(350, () => enqueue({ events: table.drainEvents(), finalView: table.view(HUMAN) }));
  }

  const drain = useCallback(
    () => enqueue({ events: table.drainEvents(), finalView: table.view(HUMAN) }),
    [enqueue, table],
  );

  const submit = useCallback(
    (a: Action) => {
      // Buttons are disabled while the director drains, but a stale tap can
      // still slip through a re-render; the engine remains the authority.
      if (!idle || !table.isHumanTurn()) return;
      setBanner(null);
      try {
        table.submit(a);
      } catch {
        return;
      }
      drain();
    },
    [idle, table, drain],
  );

  const nextDeal = useCallback(() => {
    if (!idle || table.phase !== 'DEAL_OVER') return;
    setBanner(null);
    table.startNextDeal();
    drain();
  }, [idle, table, drain]);

  /**
   * A table gift from me: paid here and now (offline there is no echo to wait
   * for), through the same profile the deal's awards are saved through, so
   * the next deal's save can never undo it. A bot it reaches may thank me.
   */
  const gift = useCallback(
    (id: GiftId, to: Seat | 'table') => {
      if (Date.now() < gifts.giftReadyAt) return false;
      const targets = recipientsOf(to, HUMAN);
      const next = spendOnGift(profileRef.current, id, targets.length);
      if (targets.length === 0 || next === profileRef.current) {
        playSfx('denied');
        return false;
      }
      profileRef.current = next;
      saveProfile(next);
      gifts.arm(GIFT_COOLDOWN_MS);
      gifts.fly(HUMAN, targets, id);
      for (const t of botThanks(targets, HUMAN, Math.random)) {
        later(GIFT_FLY_MS + t.delayMs, () => {
          spawnEmote({ anchors, bus: fxBus, lang, reduced: () => motionRef.current === 'reduced' }, t.seat, t.id);
          playSfx('pop');
        });
      }
      return true;
    },
    [gifts, anchors, fxBus, lang, later],
  );

  // Offline there is no server round-trip: the bubble is the whole emote.
  const emote = useCallback(
    (id: string) => {
      spawnEmote({ anchors, bus: fxBus, lang, reduced: () => motionRef.current === 'reduced' }, HUMAN, id);
      playSfx('pop');
    },
    [anchors, fxBus, lang],
  );

  return {
    table,
    view,
    idle,
    profile: profileRef.current,
    banner,
    anchors,
    fxBus,
    lang,
    myTurn: idle && view.toAct === HUMAN,
    spotlight,
    matchLog,
    cue,
    dealerHop,
    motion,
    submit,
    nextDeal,
    emote,
    gifts: gifts.gifts,
    giftLanded: gifts.giftLanded,
    giftFrom: gifts.giftFrom,
    giftReadyAt: gifts.giftReadyAt,
    gift,
  };
}
