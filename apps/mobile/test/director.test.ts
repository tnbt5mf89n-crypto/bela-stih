import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardId, type PublicView, type Seat } from '@belot/engine';
import { Table, type TableEvent } from '@belot/table';
import {
  DEFAULT_TIMINGS,
  Director,
  REDUCED_TIMINGS,
  REVEAL_MS,
  ZERO_TIMINGS,
  type Batch,
} from '../src/anim/director';
import { applyEventEnd, applyEventStart } from '../src/anim/patch';

/**
 * The director owns the view the screen renders, so its patch logic gets the
 * same treatment as the engine: a harness that replays real games and asserts
 * the presentation can never drift from the authority.
 *
 * With ZERO_TIMINGS the director settles synchronously inside `enqueue`, which
 * makes whole-match replay trivial. Fast-forward and compression use fake
 * timers against the real timing table.
 */

const SEAT: Seat = 0;

interface Capture {
  views: PublicView[];
  started: TableEvent[];
  flushed: TableEvent[];
  idleFlips: boolean[];
  /** The pace each ANIMATED event was started at. */
  speeds: number[];
  /** How many batches began animating. */
  batches: number;
  /** Events whose end-commit landed. */
  ended: TableEvent[];
  endSpeeds: number[];
  /** Every onSkip count. */
  skips: number[];
}

function makeDirector(initial: PublicView, timings = ZERO_TIMINGS) {
  const cap: Capture = {
    views: [],
    started: [],
    flushed: [],
    idleFlips: [],
    speeds: [],
    batches: 0,
    ended: [],
    endSpeeds: [],
    skips: [],
  };
  const d = new Director(SEAT, initial, {
    onView: (v) => cap.views.push(v),
    onEventStart: (e, f, speed) => {
      if (f) cap.flushed.push(e);
      else {
        cap.started.push(e);
        cap.speeds.push(speed);
      }
    },
    onIdle: (i) => cap.idleFlips.push(i),
    onBatch: () => {
      cap.batches += 1;
    },
    onEventEnd: (e, speed) => {
      cap.ended.push(e);
      cap.endSpeeds.push(speed);
    },
    onSkip: (n) => cap.skips.push(n),
  }, timings);
  return { d, cap };
}

/** The fields the patcher is responsible for, in comparable form. */
function projection(v: PublicView) {
  return {
    phase: v.phase,
    dealer: v.dealer,
    hand: v.hand.map(cardId).sort(),
    handCounts: v.handCounts,
    trump: v.context.trumpSuit,
    callerSeat: v.callerSeat,
    multiplier: v.multiplier,
    trickLeader: v.trickLeader,
    trick: v.currentTrick.map((p) => `${p.seat}:${cardId(p.card)}`),
    matchScores: v.matchScores,
    // The live counter is patched per trick; if bumpProgress ever drifts from
    // the engine's own arithmetic, this catches it at every batch boundary.
    dealProgress: v.dealProgress && {
      tricksPlayed: v.dealProgress.tricksPlayed,
      cardPoints: v.dealProgress.cardPoints,
      tricksWon: v.dealProgress.tricksWon,
      running: v.dealProgress.running,
      callerNeeds: v.dealProgress.callerNeeds,
      lastTrickTeam: v.dealProgress.lastTrickTeam,
    },
    // Order differs legitimately (event order vs per-seat flatten); compare as a set.
    declarations: v.announcedDeclarations
      .map((x) => `${x.seat}:${x.kind}:${x.value}:${x.topRank}`)
      .sort(),
    bela: v.belaAnnouncedBy,
  };
}

describe('director replay over real matches', () => {
  it('never drifts from the authoritative view, before or after the sync', () => {
    for (const seed of [3, 21, 77]) {
      const table = new Table({ seed, humanSeats: [SEAT] });
      const { d, cap } = makeDirector(table.view(SEAT));
      let batches = 0;

      const drainInto = () => {
        const events = table.drainEvents();
        const finalView = table.view(SEAT);
        const before = cap.views.length;
        d.enqueue({ events, finalView });
        batches++;

        // Terminal view is authoritative, verbatim.
        expect(d.getView()).toEqual(finalView);
        expect(d.idle).toBe(true);

        // The last PATCHED view (just before the sync) must already agree on
        // everything the patcher maintains — the sync may not be doing the work.
        if (events.length > 0) {
          const seq = cap.views.slice(before);
          const lastPatched = seq[seq.length - 2]!;
          expect(projection(lastPatched)).toEqual(projection(finalView));
          // Intermediate views never offer prompts or actions.
          for (const v of seq.slice(0, -1)) {
            expect(v.legalActions).toEqual([]);
            expect(v.toAct).toBeNull();
            expect(v.mustDeclare).toBe(false);
            expect(v.canAnnounceBela).toBe(false);
          }
        }
      };

      drainInto(); // whatever the constructor's bot run produced

      let guard = 0;
      while (table.phase !== 'MATCH_OVER') {
        if (guard++ > 20_000) throw new Error('match did not finish');
        if (table.phase === 'DEAL_OVER') {
          table.startNextDeal();
          drainInto();
          continue;
        }
        table.submit(table.legal()[0]!);
        drainInto();
      }

      expect(batches).toBeGreaterThan(50);
      // Every event fired exactly once, none double-fired via flush.
      expect(cap.flushed).toHaveLength(0);
      d.dispose();
    }
  });

  it('fires onEventStart exactly once per event', () => {
    const table = new Table({ seed: 9, humanSeats: [SEAT] });
    const { d, cap } = makeDirector(table.view(SEAT));
    let total = 0;
    let guard = 0;
    const feed = () => {
      const events = table.drainEvents();
      total += events.length;
      d.enqueue({ events, finalView: table.view(SEAT) });
    };
    feed();
    while (table.phase !== 'MATCH_OVER' && guard++ < 20_000) {
      if (table.phase === 'DEAL_OVER') table.startNextDeal();
      else table.submit(table.legal()[0]!);
      feed();
    }
    expect(cap.started.length + cap.flushed.length).toBe(total);
    expect(cap.flushed).toHaveLength(0);
  });
});

describe('"Pregled ruke" on the scored frame', () => {
  it('never shows a settled view short of the deal the authority scored', () => {
    // The result sheet and its review come up on dealScored's frame. On a
    // match's last deal the matchOver beat still runs before the terminal
    // sync, so a history carried from the batch's start, without the last
    // trick, stood in the review for ~900 ms.
    let settled = 0;
    for (const seed of [3, 21, 77]) {
      const table = new Table({ seed, humanSeats: [SEAT] });
      const { d, cap } = makeDirector(table.view(SEAT));
      const feed = () => {
        const events = table.drainEvents();
        const finalView = table.view(SEAT);
        const before = cap.views.length;
        d.enqueue({ events, finalView });
        for (const v of cap.views.slice(before)) {
          if (v.phase !== 'DEAL_OVER' && v.phase !== 'MATCH_OVER') continue;
          settled++;
          expect(v.history, `seed ${seed}, ${v.phase}`).toEqual(finalView.history);
        }
      };
      feed();
      let guard = 0;
      while (table.phase !== 'MATCH_OVER') {
        if (guard++ > 20_000) throw new Error('match did not finish');
        if (table.phase === 'DEAL_OVER') table.startNextDeal();
        else table.submit(table.legal()[0]!);
        feed();
      }
      d.dispose();
    }
    expect(settled).toBeGreaterThan(20);
  });

  it('keeps the history it had if a batch ever ran on into the next deal', () => {
    // Then the finalView's history is the new deal's, not the scored one's.
    const table = new Table({ seed: 5, humanSeats: [SEAT] });
    table.drainEvents();
    let scored: TableEvent | undefined;
    let guard = 0;
    while (table.phase !== 'DEAL_OVER') {
      if (guard++ > 2000) throw new Error('deal did not finish');
      table.submit(table.legal()[0]!);
      scored = table.drainEvents().find((e) => e.kind === 'dealScored') ?? scored;
    }
    const over = table.view(SEAT);
    table.startNextDeal();
    table.drainEvents();
    const next = table.view(SEAT);
    expect(next.phase).not.toBe('DEAL_OVER');
    expect(applyEventEnd(over, scored!, next, SEAT).history).toBe(over.history);
  });
});

describe('fast-forward and compression', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function oneDealBatch(seed: number): { batch: Batch; initial: PublicView } {
    // An all-bot table plays its ENTIRE first deal inside the constructor, so
    // the first drain already holds a full deal's events. (An earlier version
    // discarded that drain "as a marker" and every batch here was empty — two
    // of these tests passed vacuously.)
    const table = new Table({ seed, humanSeats: [] });
    const batch = { events: table.drainEvents(), finalView: table.view(SEAT) };
    if (batch.events.length < 30) throw new Error('helper produced a hollow batch');
    return { batch, initial: batch.finalView };
  }

  it('fastForward lands on the final view with every remaining event flushed', () => {
    const t = new Table({ seed: 5, humanSeats: [] });
    const initial = t.view(SEAT);
    t.runBots();
    const events = t.drainEvents();
    const finalView = t.view(SEAT);

    const { d, cap } = makeDirector(initial, DEFAULT_TIMINGS);
    d.enqueue({ events, finalView });
    expect(d.idle).toBe(false);

    // Let a few events play, then interrupt.
    vi.advanceTimersByTime(2500);
    const startedBefore = cap.started.length;
    expect(startedBefore).toBeGreaterThan(0);
    expect(startedBefore).toBeLessThan(events.length);

    d.fastForward();
    expect(d.idle).toBe(true);
    expect(d.getView()).toEqual(finalView);
    // Everything fired exactly once, split between animated and flushed.
    expect(cap.started.length + cap.flushed.length).toBe(events.length);
    expect(cap.flushed.length).toBe(events.length - startedBefore);

    // No stray timers keep running afterwards.
    const views = cap.views.length;
    vi.advanceTimersByTime(60_000);
    expect(cap.views.length).toBe(views);
  });

  it('flushes older batches when more than one is waiting', () => {
    const a = oneDealBatch(11);
    const b = oneDealBatch(12).batch;
    const c = oneDealBatch(13).batch;

    const { d, cap } = makeDirector(a.initial, DEFAULT_TIMINGS);
    d.enqueue(a.batch); // starts animating
    d.enqueue(b); // waits
    d.enqueue(c); // b must be flushed instantly
    expect(cap.flushed.length).toBe(b.events.length);

    // Drain everything; the final view is the newest batch's.
    d.fastForward();
    expect(d.getView()).toEqual(c.finalView);
    expect(cap.started.length + cap.flushed.length).toBe(
      a.batch.events.length + b.events.length + c.events.length,
    );
  });

  it('halves delays while a batch is waiting', () => {
    const a = oneDealBatch(31);
    const b = oneDealBatch(32).batch;
    const { d, cap } = makeDirector(a.initial, DEFAULT_TIMINGS);
    d.enqueue(a.batch);
    const solo = cap.started.length;
    vi.advanceTimersByTime(4000);
    const soloAfter = cap.started.length - solo;

    // Fresh director, same batch, but with a second batch waiting throughout.
    const { d: d2, cap: cap2 } = makeDirector(a.initial, DEFAULT_TIMINGS);
    d2.enqueue(a.batch);
    d2.enqueue(b);
    const duo = cap2.started.length;
    vi.advanceTimersByTime(4000);
    const duoAfter = cap2.started.length - duo;

    expect(duoAfter).toBeGreaterThan(soloAfter);
    // And it SAYS so: every beat started while a batch waited was announced at
    // half pace, so the sprites can shrink with it, while the solo run was
    // announced at full pace throughout.
    expect(cap.speeds.every((s) => s === 1)).toBe(true);
    expect(cap2.speeds.slice(duo).every((s) => s === 0.5)).toBe(true);
    d.dispose();
    d2.dispose();
  });

  it('announces every batch as it starts animating, queued ones included', () => {
    // onIdle(false) fires once per idle→busy transition; a batch dequeued
    // while the director is still busy gets no such flip, and the table's
    // anchors used to go un-measured for the whole of it.
    const a = oneDealBatch(41);
    const b = oneDealBatch(42).batch;
    const { d, cap } = makeDirector(a.initial, DEFAULT_TIMINGS);
    d.enqueue(a.batch);
    expect(cap.batches).toBe(1);
    d.enqueue(b); // waits behind a
    expect(cap.batches).toBe(1);
    vi.advanceTimersByTime(120_000); // a finishes; b is dequeued directly
    expect(cap.batches).toBe(2);
    expect(cap.idleFlips.filter((i) => !i)).toHaveLength(1);
    // An empty batch has nothing to animate and announces nothing.
    d.enqueue({ events: [], finalView: b.finalView });
    expect(cap.batches).toBe(2);
    d.dispose();
  });
});

describe('a won trick', () => {
  it('leaves the slots the moment its sweep starts, not when it ends', () => {
    // The sweep sprite carries the real four cards from here on; the faces
    // used to stand still in their slots under it, then snap away at the end.
    const table = new Table({ seed: 9, humanSeats: [] });
    const events = table.drainEvents();
    const wonAt = events.findIndex((e) => e.kind === 'trickWon');
    const plays = events
      .slice(0, wonAt)
      .filter((e): e is Extract<TableEvent, { kind: 'cardPlayed' }> => e.kind === 'cardPlayed');
    const before = {
      ...table.view(SEAT),
      currentTrick: plays.map((e) => ({ seat: e.seat, card: e.card })),
    };
    expect(before.currentTrick).toHaveLength(4);

    const started = applyEventStart(before, events[wonAt]!, SEAT);
    expect(started.currentTrick).toEqual([]);
    expect(started.toAct).toBeNull();
    const ended = applyEventEnd(started, events[wonAt]!, table.view(SEAT), SEAT);
    expect(ended.currentTrick).toEqual([]);
  });
});

describe('the end of a beat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function deal(seed: number): { batch: Batch; initial: PublicView } {
    const table = new Table({ seed, humanSeats: [] });
    const batch = { events: table.drainEvents(), finalView: table.view(SEAT) };
    return { batch, initial: batch.finalView };
  }

  it('is announced once per animated event, in order, and never for a flushed one', () => {
    const a = deal(51);
    const { d, cap } = makeDirector(a.initial, DEFAULT_TIMINGS);
    d.enqueue(a.batch);
    vi.advanceTimersByTime(120_000);
    expect(cap.ended.map((e) => e.kind)).toEqual(cap.started.map((e) => e.kind));
    expect(cap.flushed).toHaveLength(0);
    expect(cap.skips).toEqual([]);
    d.dispose();
  });

  it('is never announced for a beat that fastForward cleared', () => {
    const a = deal(52);
    const { d, cap } = makeDirector(a.initial, DEFAULT_TIMINGS);
    d.enqueue(a.batch);
    vi.advanceTimersByTime(3000);
    const endedBefore = cap.ended.length;
    const startedBefore = cap.started.length;
    expect(startedBefore).toBeGreaterThan(endedBefore); // one beat is mid-flight
    d.fastForward();
    vi.advanceTimersByTime(120_000);
    expect(cap.ended).toHaveLength(endedBefore);
    // Everything that had not started was flushed, and said so in one count.
    expect(cap.skips).toEqual([a.batch.events.length - startedBefore]);
    d.dispose();
  });

  it('counts what compress() flushes', () => {
    const a = deal(53);
    const b = deal(54).batch;
    const c = deal(55).batch;
    const { d, cap } = makeDirector(a.initial, DEFAULT_TIMINGS);
    d.enqueue(a.batch);
    d.enqueue(b);
    d.enqueue(c); // b is flushed instantly
    expect(cap.skips).toEqual([b.events.length]);
    d.dispose();
  });
});

describe('the pace of a beat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function deal(seed: number): { batch: Batch; initial: PublicView } {
    const table = new Table({ seed, humanSeats: [] });
    const batch = { events: table.drainEvents(), finalView: table.view(SEAT) };
    return { batch, initial: batch.finalView };
  }

  it('halves with a batch waiting — except the reveal, which is information', () => {
    // Two whole deals with a reveal in the first: the second is enqueued at
    // once, so every beat of the first runs at half pace, bar the reveal.
    const first = (() => {
      for (let seed = 1; seed < 200; seed++) {
        const t = new Table({ seed, humanSeats: [] });
        const events = t.drainEvents();
        if (events.some((e) => e.kind === 'declarationsRevealed')) return { seed, events, initial: t.view(SEAT) };
      }
      throw new Error('no reveal in 200 seeds');
    })();
    const { d, cap } = makeDirector(first.initial, DEFAULT_TIMINGS);
    d.enqueue({ events: first.events, finalView: first.initial });
    d.enqueue({ events: [], finalView: first.initial });
    vi.advanceTimersByTime(200_000);
    // The first beat started at the first enqueue, before anything waited.
    for (let i = 1; i < cap.started.length; i++) {
      const e = cap.started[i]!;
      expect(cap.speeds[i], e.kind).toBe(e.kind === 'declarationsRevealed' ? 1 : 0.5);
    }
    // ...and the end of every beat says which pace it ran at.
    expect(cap.endSpeeds).toEqual(cap.speeds);
    d.dispose();
  });

  it('re-paces from the next beat when the timings change', () => {
    const a = deal(61);
    const { d, cap } = makeDirector(a.initial, DEFAULT_TIMINGS);
    d.enqueue(a.batch);
    expect(cap.started).toHaveLength(1); // the deal, 1400 ms at full pace
    d.setTimings(REDUCED_TIMINGS);
    vi.advanceTimersByTime(1400 + 200 + 5);
    const afterFirst = cap.started.length;
    expect(afterFirst).toBeGreaterThanOrEqual(2);
    // From here every beat is at most 250 + 80: a second of the clock runs
    // at least three of them, where the full pacing's bids would run one.
    vi.advanceTimersByTime(1000);
    expect(cap.started.length - afterFirst).toBeGreaterThanOrEqual(3);
    d.dispose();
  });

  it('gives the deal stinger a gap before the match fanfare', () => {
    expect(DEFAULT_TIMINGS.dealScored.gap).toBeGreaterThanOrEqual(250);
  });
});

describe('reduced-motion pacing', () => {
  it('shortens every beat except the reveal, which is information', () => {
    for (const [kind, t] of Object.entries(REDUCED_TIMINGS)) {
      if (kind === 'declarationsRevealed') {
        expect(t).toEqual({ dur: REVEAL_MS, gap: 300 });
      } else {
        expect(t.dur).toBeLessThanOrEqual(250);
        expect(t.gap).toBeLessThanOrEqual(80);
      }
    }
  });

  it('replays a match to the same views as the full pacing', () => {
    // Pacing changes when things happen, never what is shown.
    for (const seed of [5, 8]) {
      const full = new Table({ seed, humanSeats: [SEAT] });
      const fast = new Table({ seed, humanSeats: [SEAT] });
      const a = makeDirector(full.view(SEAT), ZERO_TIMINGS);
      const b = makeDirector(fast.view(SEAT), ZERO_TIMINGS);
      // ZERO settles synchronously; the reduced table is checked structurally
      // above. Here: both directors, fed the same events, patch identically.
      let guard = 0;
      while (full.phase !== 'MATCH_OVER' && guard++ < 5000) {
        if (full.phase === 'DEAL_OVER') {
          full.startNextDeal();
          fast.startNextDeal();
        } else {
          const act = full.legal()[0]!;
          full.submit(act);
          fast.submit(act);
        }
        a.d.enqueue({ events: full.drainEvents(), finalView: full.view(SEAT) });
        b.d.enqueue({ events: fast.drainEvents(), finalView: fast.view(SEAT) });
        expect(projection(b.d.getView())).toEqual(projection(a.d.getView()));
      }
      expect(a.cap.views.length).toBe(b.cap.views.length);
      a.d.dispose();
      b.d.dispose();
    }
  });
});
