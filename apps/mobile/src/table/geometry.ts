import type { Seat } from '@belot/engine';

/**
 * Where each seat sits on screen, and how the hand is sized.
 *
 * DIRECTION OF PLAY — the one rule this file exists to encode. Croatian bela
 * runs COUNTER-CLOCKWISE: the dealer's RIGHT-hand neighbour bids first and
 * leads, play passes to the player on your RIGHT, and the dealer is last
 * (which is exactly why "mus" falls on them). Sources: hr.wikipedia "Belot",
 * belaklub.com, tako.hr, playtoy.tportal.hr. Only Međimurje is documented as
 * playing the other way round.
 *
 * The engine already encodes this correctly — `turn = (seat + 1) % 4` — so a
 * seat's index offset from mine IS its play order after me. All this module
 * does is stop drawing offset 1 on the left.
 */

export type Position = 'bottom' | 'left' | 'top' | 'right';

/**
 * Indexed by the offset from my seat in PLAY order; the value is where that
 * seat is drawn. Offset 1 (next to act) is on the right.
 */
export const POSITIONS: readonly Position[] = ['bottom', 'right', 'top', 'left'];

/** Where `seat` is drawn, from `mySeat`'s point of view. */
export function seatPosition(seat: Seat, mySeat: Seat): Position {
  return POSITIONS[(seat - mySeat + 4) % 4]!;
}

/** The seat drawn at `pos`, from `mySeat`'s point of view. Inverse of the above. */
export function seatAt(pos: Position, mySeat: Seat): Seat {
  return ((mySeat + POSITIONS.indexOf(pos)) % 4) as Seat;
}

// ---------------------------------------------------------------------------
// The hand
// ---------------------------------------------------------------------------

/** Card art is drawn on a 100x145 canvas, so every card keeps this ratio. */
export const CARD_ASPECT = 1.45;

/** Below this a mađarica's pips stop reading; above it the fan looks silly. */
const MIN_CARD_W = 40;
/**
 * A ceiling, not a target — the caller's own budget is what normally decides.
 * It used to sit at 76, which is right for a phone and became a straitjacket on
 * anything bigger: the felt grew to fill the window while the cards stayed the
 * size they are on a handset, so a desktop browser showed an enormous empty
 * table ringed by postage stamps.
 */
export const MAX_CARD_W = 120;
/** How much of each overlapped card must stay visible to be identifiable. */
const MIN_REVEAL = 0.42;
const MAX_REVEAL = 0.72;

export interface HandFit {
  cardW: number;
  cardH: number;
  /** Distance between neighbouring card origins. */
  advance: number;
  /** The negative margin that produces that advance. */
  overlap: number;
  /** How much the fan is scaled relative to the reference 58px card. */
  scale: number;
}

/**
 * Size the hand to the space it actually has, so eight cards are always ONE
 * row — on a 320dp phone they used to spill off both edges, and a wrapped
 * second row is the layout players complain about most in rival apps.
 *
 * `maxCardW` lets a short screen (landscape) hold the fan down to a height it
 * can actually spare; the width rules are unchanged.
 */
/** The fan's default overlap: each card advances 62% of a width past the last; "Velike karte" uses less. */
export const DEFAULT_REVEAL = 0.62;

export function fitHand(available: number, count: number, maxCardW = MAX_CARD_W, reveal = DEFAULT_REVEAL): HandFit {
  // Turned sideways there is width to spare and no height at all, so the cap
  // that matters is the caller's, not the fan's own.
  const cap = clamp(maxCardW, MIN_CARD_W, MAX_CARD_W);
  // The rotated outer cards need room too, or they hang off the screen edges.
  const spread = 1 + (count - 1) * reveal + tiltAllowance(count);
  const cardW =
    count <= 1 ? Math.min(cap, available) : clamp(available / spread, MIN_CARD_W, cap);
  const advance =
    count <= 1
      ? 0
      : clamp(
          (available - cardW * (1 + tiltAllowance(count))) / (count - 1),
          cardW * MIN_REVEAL,
          cardW * MAX_REVEAL,
        );

  return {
    cardW,
    cardH: cardW * CARD_ASPECT,
    advance,
    overlap: count <= 1 ? 0 : -(cardW - advance),
    scale: cardW / 58,
  };
}

/** Breathing room above the fan, so a lifted card is not clipped. */
export const FAN_PAD = 16;

/**
 * How tall a fan of `count` cards of this width actually is.
 *
 * Not just the card: the outermost cards are pushed down by the arc and the
 * playable ones lift up out of it. Reserving only the card height is what let
 * the bottom row get clipped off a landscape screen.
 */
export function fanHeight(cardW: number, count: number): number {
  const scale = cardW / 58;
  return cardW * CARD_ASPECT + fanArc(count) * scale + 14 * scale + FAN_PAD;
}

/** The outer card's drop, in reference (58px card) pixels. Mirrors `Hand`. */
export function fanArc(count: number): number {
  return Math.pow(Math.max(0, (count - 1) / 2), 1.6) * 3.2;
}

/** Degrees the outermost card is turned. Mirrors `Hand`'s `off * 4.5`. */
function fanTilt(count: number): number {
  return (Math.max(0, count - 1) / 2) * 4.5;
}

/**
 * How much WIDER the fan is than the sum of its cards, because the outer ones
 * are rotated.
 *
 * A turned card's bounding box grows by its own height as well as its width, so
 * budgeting only for the upright card ran the outermost ones off both edges of
 * the screen. Expressed as a multiple of the card width, since the height is a
 * fixed ratio of it.
 */
export function fanWidth(fit: HandFit, count: number): number {
  // What the fan ACTUALLY occupies: the upright span plus the extra the rotated
  // outer cards sweep out on each side.
  const span = count <= 1 ? fit.cardW : fit.cardW + fit.advance * (count - 1);
  return span + fit.cardW * tiltAllowance(count);
}

function tiltAllowance(count: number): number {
  const t = (fanTilt(count) * Math.PI) / 180;
  return Math.max(0, CARD_ASPECT * Math.sin(t) + Math.cos(t) - 1);
}

/**
 * The inverse: the widest card whose fan still fits in `budget` of height.
 * `fanHeight` is linear in the card width apart from the constant pad, so one
 * division inverts it exactly.
 */
export function cardWidthForHeight(budget: number, count: number): number {
  const perUnit = (fanHeight(58, count) - FAN_PAD) / 58;
  return Math.max(0, (budget - FAN_PAD) / perUnit);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// The trick cross
// ---------------------------------------------------------------------------

/**
 * Where each seat's trick slot sits inside the felt: a compact cross around the
 * centre, so a full trick reads as one pile.
 *
 * The gaps are proportional to the card, which means the cross grows and
 * shrinks with the table instead of leaving a hole on a tablet or overlapping
 * on a small phone. At the reference 46x67 slot it reproduces the old hand-tuned
 * constants exactly, so a scale of 1 is pixel-for-pixel what shipped before.
 */
export function slotOffsets(slotW: number, slotH: number): Record<Position, SlotOffset> {
  const gapX = Math.round(slotW * (31 / 46));
  const gapY = Math.round(slotH * (39 / 67));
  const halfW = Math.round(slotW / 2);
  const halfH = Math.floor(slotH / 2);
  return {
    bottom: { left: '50%', marginLeft: -halfW, top: '55%', marginTop: gapY },
    top: {
      left: '50%',
      marginLeft: -halfW,
      top: '55%',
      marginTop: -(gapY + slotH),
    },
    left: {
      left: '50%',
      marginLeft: -(gapX + slotW),
      top: '55%',
      marginTop: -halfH,
    },
    right: { left: '50%', marginLeft: gapX, top: '55%', marginTop: -halfH },
  };
}

/**
 * The biggest trick slot whose cross still fits inside the felt.
 *
 * The cross is 3.16 slots tall and 3.35 wide (see `slotOffsets`); landscape
 * turns the felt into a short wide ellipse, and sizing the slots off the window
 * there pushed the top and bottom cards straight out through the rim. The
 * divisors carry a little more than that so the cards keep clear of the border.
 */
export function fitTrickCross(
  feltW: number,
  feltH: number,
  maxSlotH: number,
): {
  slotW: number;
  slotH: number;
} {
  // Before the first layout pass there is nothing to measure; the window-derived
  // size is the right guess and is corrected on the very next frame.
  const byH = feltH > 0 ? feltH / 3.55 : maxSlotH;
  const byW = feltW > 0 ? (feltW / 3.7) * CARD_ASPECT : maxSlotH;
  const slotH = Math.round(clamp(Math.min(maxSlotH, byH, byW), 26, maxSlotH));
  return { slotH, slotW: Math.round(slotH / CARD_ASPECT) };
}

export interface SlotOffset {
  left: '50%';
  marginLeft: number;
  top: '55%';
  marginTop: number;
}
