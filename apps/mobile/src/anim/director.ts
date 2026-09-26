import type { PublicView, Seat } from '@belot/engine';
import type { TableEvent } from '@belot/table';
import { applyEventEnd, applyEventStart } from './patch';

/**
 * The animation director: owns the `PublicView` the screen renders, and paces
 * the event stream through it.
 *
 * Design rules (see the plan's architecture section):
 *  - Sequencing runs on plain JS timers. Reanimated sprites are fire-and-forget
 *    decoration; a dropped frame can never stall the game.
 *  - Two-phase commit per event: patch the source side when its animation
 *    starts, the destination side when it lands.
 *  - At the end of every batch the view is HARD-REPLACED by the batch's
 *    authoritative `finalView`, so drift is structurally impossible.
 *  - Batches arriving while one is playing compress: delays halve with one
 *    batch waiting, and anything older than the newest waiting batch is
 *    flushed instantly (progression still fires; sprites and sounds do not).
 *
 * Framework-free on purpose: the vitest harness drives it against a real
 * `Table` with zero timings, no device or React involved.
 */

export interface Batch {
  events: TableEvent[];
  finalView: PublicView;
}

export interface DirectorCallbacks {
  /** Every presentation-view change, including the terminal sync. */
  onView(view: PublicView): void;
  /**
   * Fired once per event when its animation begins. `flushed` is true when the
   * event is being skipped (fast-forward/compression): apply progression, but
   * spawn no sprite and play no sound. `speed` is the pace this beat will run
   * at (1, or 0.5 with a batch waiting) so sprites can shrink to fit it — a
   * flight timed for the full beat would otherwise still be in the air when
   * the card was already committed to its slot.
   */
  onEventStart(e: TableEvent, flushed: boolean, speed: number): void;
  /**
   * Fired once per ANIMATED event as its end-commit lands — the moment a
   * sprite has arrived, so a landing sound or a stamp belongs here rather
   * than on a free timer. Never fired for a flushed event, and never after
   * fastForward() has cleared the beat it belonged to. `speed` is the pace
   * the beat ran at, so a flourish in the gap that follows shrinks with it.
   */
  onEventEnd?(e: TableEvent, speed: number): void;
  onIdle(idle: boolean): void;
  /** Some events were flushed past without animating: how many. */
  onSkip?(count: number): void;
  /**
   * Fired as each non-empty batch begins animating — queued batches included,
   * which `onIdle(false)` never covers. The table re-measures its anchors on
   * it; the measurement lands a frame later, so it serves the batch's second
   * sprite onward.
   */
  onBatch?(): void;
  /**
   * How long the seat behind this event seems to think before it shows, in
   * ms at full pace - 0 for none (my own moves; people online, who took
   * their own time). The director holds before the event starts, so a bot's
   * card no longer lands on a metronome, and says whose think it is through
   * onThink so the table can light that puck meanwhile.
   */
  thinkMs?(e: TableEvent, view: PublicView): number;
  onThink?(e: TableEvent): void;
}

export interface EventTiming {
  /** start-commit → end-commit (the animation itself). */
  dur: number;
  /** pause after the end-commit before the next event. */
  gap: number;
}

export type Timings = Record<TableEvent['kind'], EventTiming>;

/**
 * How long the winning side's zvanja stay face up.
 *
 * They come DOWN again, and that is the point: remembering what was shown is
 * part of playing well. Leaving them on screen would turn the memory into a
 * reference sheet and quietly remove a skill from the game.
 */
export const REVEAL_MS = 5000;

/**
 * Each beat is as long as the thing that fills it — the sprites shrink to
 * fit the beat, never the other way round (see anim/lifetimes.ts and the
 * sprite-lifetimes test that bounds every one of them).
 */
export const DEFAULT_TIMINGS: Timings = {
  dealStarted: { dur: 1400, gap: 200 },
  bidPassed: { dur: 500, gap: 120 },
  // The bubble (dur), then the pip stamps onto the plaque in the gap.
  bidCalled: { dur: 700, gap: 350 },
  // The same: the ×2 stamps onto the plaque in the gap.
  doubled: { dur: 900, gap: 350 },
  doublePassed: { dur: 250, gap: 80 },
  // The talon lands, then the fan re-sorts in the gap.
  handsCompleted: { dur: 800, gap: 250 },
  declared: { dur: 1100, gap: 150 },
  declarationSkipped: { dur: 150, gap: 60 },
  // The one beat in the deal where everyone is looking at somebody else's hand.
  // The table holds here for exactly as long as the cards are up, so nobody
  // leads while you are still reading them.
  declarationsRevealed: { dur: REVEAL_MS, gap: 300 },
  belaCalled: { dur: 900, gap: 150 },
  cardPlayed: { dur: 260, gap: 140 },
  // The four cards hold, then sweep to the winner (dur); the pile settles (gap).
  trickWon: { dur: 760, gap: 240 },
  // The sheet slides up and the deal's stinger lands at the end; the gap
  // keeps a match's fanfare (the next event) from starting in the same tick.
  dealScored: { dur: 700, gap: 300 },
  matchOver: { dur: 600, gap: 0 },
  matchStarted: { dur: 600, gap: 200 },
};

/** All-zero timings: the director settles synchronously. Used by tests. */
export const ZERO_TIMINGS: Timings = Object.fromEntries(
  Object.keys(DEFAULT_TIMINGS).map((k) => [k, { dur: 0, gap: 0 }]),
) as Timings;

export type MotionPolicy = 'full' | 'reduced';

/**
 * Reduce-motion pacing: every beat short enough that a fade is all the
 * sprite can do — except the reveal, which is information, not decoration.
 * Remembering what was shown is a skill of the game; it stays up for
 * REVEAL_MS under every policy.
 */
export const REDUCED_TIMINGS: Timings = Object.fromEntries(
  Object.entries(DEFAULT_TIMINGS).map(([k, t]) => [
    k,
    k === 'declarationsRevealed' ? t : { dur: Math.min(250, t.dur), gap: Math.min(80, t.gap) },
  ]),
) as Timings;

/** Settings' "Tempo igre" (1.6.0): the beats stretch or tighten together; the reveal (information) never. */
export type Tempo = 'slow' | 'normal' | 'fast';
export const TEMPO_FACTOR: Readonly<Record<Tempo, number>> = { slow: 1.3, normal: 1, fast: 0.75 };

export function timingsFor(policy: MotionPolicy, tempo: Tempo = 'normal'): Timings {
  const base = policy === 'reduced' ? REDUCED_TIMINGS : DEFAULT_TIMINGS;
  const f = TEMPO_FACTOR[tempo] ?? 1;
  if (f === 1) return base;
  return Object.fromEntries(
    Object.entries(base).map(([k, t]) => [k, k === 'declarationsRevealed' ? t : { dur: Math.round(t.dur * f), gap: Math.round(t.gap * f) }]),
  ) as Timings;
}

interface Current {
  batch: Batch;
  /** Index of the next event to START. */
  nextIndex: number;
  /** The event whose think has been held already (it starts next, with none). */
  thought: number;
}

export class Director {
  private view: PublicView;
  private queue: Batch[] = [];
  /**
   * The authoritative view of a batch that compress() flushed without rendering
   * WHILE another batch was already animating.
   *
   * Its events are in the view already; only its final state was being dropped,
   * so the animating batch's older finalView then clobbered it and the batch
   * after that patched from a stale table. Cleared the moment a newer batch is
   * dequeued, which supersedes it.
   */
  private pendingFinal: PublicView | null = null;
  private current: Current | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  idle = true;

  constructor(
    private readonly mySeat: Seat,
    initialView: PublicView,
    private readonly cb: DirectorCallbacks,
    private timings: Timings = DEFAULT_TIMINGS,
  ) {
    this.view = initialView;
  }

  /**
   * Re-pace from the next beat on. The motion policy can change under a
   * mounted table — the system switch resolves a tick after the first
   * render, and the phone's setting can flip mid-match — and the sprites
   * already follow it live; the beats must, or fades sit in full-length beats.
   */
  setTimings(t: Timings): void {
    this.timings = t;
  }

  getView(): PublicView {
    return this.view;
  }

  enqueue(batch: Batch): void {
    if (this.disposed) return;
    this.queue.push(batch);
    this.compress();
    if (this.idle) {
      this.idle = false;
      this.cb.onIdle(false);
      this.next();
    }
  }

  /** Skip everything pending and land on the newest authoritative view. */
  fastForward(): void {
    if (this.disposed) return;
    this.clearTimer();

    let lastFinal: PublicView | null = null;
    if (this.current) {
      this.flushEvents(this.current.batch.events, this.current.nextIndex);
      lastFinal = this.current.batch.finalView;
      this.current = null;
    }
    for (const b of this.queue) {
      this.flushEvents(b.events, 0);
      lastFinal = b.finalView;
    }
    this.queue = [];

    if (lastFinal) {
      this.view = lastFinal;
      this.cb.onView(this.view);
    }
    if (!this.idle) {
      this.idle = true;
      this.cb.onIdle(true);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  // -------------------------------------------------------------------------

  /** With >1 batch waiting, flush all but the newest; with 1 waiting, halve delays. */
  private compress(): void {
    while (this.queue.length > 1) {
      const b = this.queue.shift()!;
      this.flushEvents(b.events, 0);
      // Superseded for rendering, but still the truth the next batch builds on
      // — the same thread fastForward() keeps.
      this.pendingFinal = b.finalView;
    }
  }

  private speed(): number {
    return this.queue.length > 0 ? 0.5 : 1;
  }

  private flushEvents(events: TableEvent[], from: number): void {
    for (let i = from; i < events.length; i++) this.cb.onEventStart(events[i]!, true, 1);
    if (events.length > from) this.cb.onSkip?.(events.length - from);
  }

  private schedule(ms: number, fn: () => void): void {
    if (ms <= 0) {
      // Synchronous when zero: lets the test harness settle without timers.
      fn();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private next(): void {
    if (this.disposed) return;

    if (!this.current) {
      const batch = this.queue.shift();
      if (!batch) {
        this.idle = true;
        this.cb.onIdle(true);
        return;
      }
      this.current = { batch, nextIndex: 0, thought: -1 };
      // This batch came off the queue AFTER anything compress() flushed, so it
      // is the newer truth and its own finalView is the right terminal sync.
      this.pendingFinal = null;
      if (batch.events.length === 0) {
        this.finishBatch();
        return;
      }
      this.cb.onBatch?.();
    }

    const { batch, nextIndex } = this.current;
    const e = batch.events[nextIndex]!;
    // A think, once per event, BEFORE it counts as started: fastForward() in
    // the middle of one flushes this event with the rest.
    if (this.current.thought !== nextIndex) {
      this.current.thought = nextIndex;
      const think = (this.cb.thinkMs?.(e, this.view) ?? 0) * this.speed();
      if (think > 0) {
        this.cb.onThink?.(e);
        this.schedule(think, () => this.next());
        return;
      }
    }
    this.current.nextIndex = nextIndex + 1;

    const t = this.timings[e.kind] ?? { dur: 300, gap: 100 };
    // With a batch waiting the beats halve — except the reveal, which is
    // information: the row stays up for REVEAL_MS whatever the pace, and the
    // director holds with it so nobody leads under cards still showing.
    const s = e.kind === 'declarationsRevealed' ? 1 : this.speed();

    this.cb.onEventStart(e, false, s);
    this.view = applyEventStart(this.view, e, this.mySeat);
    this.cb.onView(this.view);

    this.schedule(t.dur * s, () => {
      if (!this.current) return; // fast-forwarded meanwhile
      this.view = applyEventEnd(this.view, e, batch.finalView, this.mySeat);
      this.cb.onView(this.view);
      this.cb.onEventEnd?.(e, s);

      if (this.current.nextIndex >= batch.events.length) {
        this.finishBatch();
        return;
      }
      this.schedule(t.gap * s, () => this.next());
    });
  }

  private finishBatch(): void {
    const batch = this.current!.batch;
    this.current = null;
    // Terminal sync: authoritative truth, verbatim — prompts and legal actions
    // come back exactly as the engine/server stated them.
    this.view = this.pendingFinal ?? batch.finalView;
    this.pendingFinal = null;
    this.cb.onView(this.view);
    this.next();
  }
}
