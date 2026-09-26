import type { Card, Seat, Suit } from '@belot/engine';

/**
 * A tiny imperative channel from game logic to the effects overlay.
 *
 * The director decides WHEN something happens; the screen decides WHAT sprite
 * that means; the overlay owns HOW it is drawn. This bus is the thin pipe
 * between the last two — a plain observable, no React, so spawning an effect
 * can never trigger a render cascade by itself.
 */

export interface XY {
  x: number;
  y: number;
}

/**
 * `speed` is the director's current pace (1, or 0.5 with a batch waiting) so a
 * sprite shrinks with the beat it fills; `width` is the measured card width at
 * the destination, so a flight lands the size of the card it becomes instead
 * of popping from a fixed 46px.
 */
export type Fx =
  | {
      kind: 'flight';
      card: Card;
      from: XY;
      to: XY;
      /** Already scaled by the pace. */
      duration: number;
      speed: number;
      /** Face up throughout (my own card), or face down until `flipAt`. */
      faceUp: boolean;
      /** Card width at the destination slot. */
      width: number;
      /** Width where it sets off — the fan's card, for my own — if different. */
      fromWidth?: number;
      /** Reduce-motion: appear at the destination instead of flying. */
      fade?: boolean;
      /** Degrees the card was turned where it set off (its tilt in the fan); it straightens in flight. */
      tilt?: number;
    }
  | {
      kind: 'deal';
      from: XY;
      /** Where each back lands, in the order it is dealt. */
      backs: XY[];
      /** Gap between one back and the next at speed 1, derived from the beat. */
      stagger: number;
      /** The beat this deal fills at speed 1: the backs hold until its end, where the real cards mount. */
      beat: number;
      speed: number;
      width: number;
      /** Reduce-motion: the backs appear where they land and fade, all at once. */
      fade?: boolean;
    }
  /** The real cards of a won trick, from their slots to the winner's puck. */
  | {
      kind: 'trickSweep';
      cards: { seat: Seat; card: Card; from: XY }[];
      to: XY;
      winner: Seat;
      speed: number;
      width: number;
      /** Reduce-motion: the cards fade where they lie instead of flying. */
      fade?: boolean;
    }
  | {
      kind: 'bubble';
      at: XY;
      text: string;
      tone: 'plain' | 'gold';
      /** Total time on screen at this speed; the hold is what gives. */
      duration: number;
      /** The director's pace, so the pop and fade shrink with the beat. */
      speed: number;
      big?: boolean;
      /** A drawn emote instead of the text: the id of one of the six faces. */
      art?: string;
      /** A suit pip before the text: the trump being called. */
      pip?: Suit;
      /** A zvanje's weight, 1–4: bigger and gold-edged as it grows. */
      weight?: 1 | 2 | 3 | 4;
      /** Reduce-motion: a plain fade in and out, no pop, inside a short beat. */
      fade?: boolean;
    }
  /** The pip (or the ×2) landing on the plaque as a call's beat ends. */
  | {
      kind: 'stamp';
      at: XY;
      pip?: Suit;
      text?: string;
      tone: 'gold' | 'danger' | 'ok';
      speed: number;
      /** Reduce-motion: a plain fade in and out, no drop and no ring. */
      fade?: boolean;
    }
  /**
   * A ring of light bursting from a point — the "your turn" cue's visible
   * twin; `warn` draws it in the clock's low red, for the time running out.
   */
  | { kind: 'pulse'; at: XY; speed: number; tone?: 'warn' }
  /** A small chip flying from one place to another: the dealer's button, the last trick's +10. */
  | { kind: 'badge'; from: XY; to: XY; duration: number; text?: string; tone?: 'dealer' | 'points' }
  /** A radial burst of confetti from a point, then the pieces fall. */
  | { kind: 'burst'; at: XY; count: number }
  /**
   * A table gift in flight, from the giver's puck to the badge spot on the
   * receiver's: it lands exactly there at `landSize`, as the badge appears.
   * `gift`, never `id`: every sprite's `id` is the bus's own number.
   */
  | { kind: 'gift'; gift: string; from: XY; to: XY; duration: number; size: number; landSize: number }
  | { kind: 'coins'; from: XY; to: XY; count: number }
  | { kind: 'confetti' };

export type FxWithId = Fx & { id: number };

type Listener = (fx: FxWithId) => void;

export class FxBus {
  private nextId = 1;
  private listeners = new Set<Listener>();

  emit(fx: Fx): void {
    const withId = { ...fx, id: this.nextId++ } as FxWithId;
    for (const l of this.listeners) l(withId);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

/** Convenience: seat-keyed anchor ids used across the table scene. */
export const anchorId = {
  seat: (s: Seat) => `seat:${s}`,
  /** My own puck: `seat(mySeat)` stays the hand, where my cards fly from and to. */
  puck: (s: Seat) => `puck:${s}`,
  slot: (s: Seat) => `slot:${s}`,
  deck: 'deck',
  plaque: 'plaque',
  wallet: 'wallet',
  /** The running count in the header: where the last trick's +10 flies. */
  running: 'running',
  /** The "Upisano" total on the result sheet: where the coins set off from. */
  sheetTotal: 'sheetTotal',

  /**
   * The one card just tapped in the fan — set by the card at press time and
   * deleted by the spawner on its one read. The single exception to "no
   * per-card anchors": a fan of eight measured anchors would cost a layout
   * pass per tick, and only the tapped card's rect is ever wanted.
   */
  card: (id: string) => `card:${id}`,
} as const;

/** Numbers the table publishes for the sprites (AnchorMap.setMeta). */
export const metaId = {
  /** The width the hand lays its fan out in, and the card-width cap it uses. */
  handWidth: 'handWidth',
  handCardMax: 'handCardMax',
  handReveal: 'handReveal',
} as const;
