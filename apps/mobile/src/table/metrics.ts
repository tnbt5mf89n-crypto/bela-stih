import { cardWidthForHeight, fanHeight, fitHand, DEFAULT_REVEAL } from './geometry';

/**
 * Every dimension the table draws, derived from the window it actually has.
 *
 * Until now each one was an absolute literal tuned for a 390x844 phone, which
 * is why the hand spilled off a 320dp screen and why landscape was locked out
 * entirely. One memoised object keyed on the window keeps the layout honest at
 * both extremes without scattering `useWindowDimensions` through the tree.
 *
 * This file is the pure half: a function of the usable box alone, so the
 * invariants can be tested without a window. `useTableMetrics` supplies the box.
 */

export interface TableMetrics {
  orientation: 'portrait' | 'landscape';
  /** Usable box, insets already subtracted. */
  width: number;
  height: number;
  /** 1 at the 390x844 reference; the scarce axis decides it. */
  scale: number;
  /** Space the hand fan may occupy. */
  handWidth: number;
  /** Landscape side-rail width; 0 in portrait. */
  railW: number;
  /** Room the fan needs, arc and lift included. */
  handMinHeight: number;
  /** Widest card the hand may use; landscape trades size for a visible felt. */
  handCardMax: number;
  /** How far each card of the fan advances past the last, as a fraction of a width (geometry.fitHand). */
  handReveal: number;
  /** Floor for the table area, so the felt never collapses to nothing. */
  feltMinHeight: number;
  /**
   * Ceiling for it too. The felt is the only row that flexes, so without this it
   * swallows every spare pixel — which on a big screen is most of them.
   */
  feltMaxHeight: number;
  slotW: number;
  slotH: number;
  puck: number;
  /** My own puck, a shade smaller than the others'. */
  selfPuck: number;
  /** Short screens hide what they must rather than squashing everything. */
  compact: boolean;
  /**
   * Portrait keeps a row's height free under the felt so a prompt coming or
   * going never moves the hand — but only where the column can pay for it:
   * with the reserve the felt must still get its full floor. The reserve's
   * 62 dp once pushed the action buttons off every 647–676 dp phone.
   */
  promptReserve: boolean;
  /**
   * Portrait where even the lowest floor cannot pay for the busiest moment (a
   * calls chip and a prompt at once). There the two rows that are no use
   * while the table asks a question — the emote strip and the online bot
   * line — give way while a prompt is up, so the buttons that answer it stay
   * on the screen; and the whole column is built tighter (SHORT_CHROME), so
   * every moment of a deal fits a 320x568 phone.
   */
  shortColumn: boolean;
}

const REF_W = 390;
const REF_H = 844;

/**
 * What the centre column keeps between the felt and the hand: its own gap on
 * either side of the row in between. Mirrors `styles.centre` in TableScreen.
 */
export const FELT_HAND_GAP = 12;

/** Between the fan and my puck beside it, in landscape's hand row. */
export const SELF_PUCK_GAP = 8;
/** Room a puck gives its name beside the disc: a puck's box is its disc plus this. SeatPuck reads it. */
export const PUCK_NAME_ROOM = 32;

/**
 * Where a puck wears its latest table gift, relative to the puck's ring box
 * (a square of side size + 10, centred in a box size + PUCK_NAME_ROOM wide):
 * a disc centred on the ring's LEFT edge, 3 dp below its middle.
 *
 * One rule for every puck — side, top and my own, portrait and landscape —
 * because it never leaves the puck's own layout box: its reach past the ring
 * is d/2 ≤ 11 dp, exactly the margin PUCK_NAME_ROOM leaves on each side. So it
 * cannot touch the felt, a trick slot, a rail, the plaque or the fan. The four
 * corners are already taken (dealer D top-left, partner diamond bottom-left, count
 * bottom-right, tricks pile top-right) and emote bubbles hang above the
 * centre; metrics.test.ts checks the clearances for every puck size.
 */
export function giftBadgeBox(size: number): { d: number; left: number; top: number } {
  const ring = size + 10;
  const d = Math.max(14, Math.min(22, Math.round(size * 0.42)));
  return { d, left: -d / 2, top: ring / 2 + 3 - d / 2 };
}

/** The gift picker's fixed rows, in dp. */
export const GIFT_PICKER = {
  PAD: 12,
  GAP: 6,
  HEADER: 36,
  CHIPS: 36,
  SEND: 44,
  NOTE: 28,
  /** A cell's price line under its art. */
  CAPTION: 14,
  MAX_CELL: 56,
} as const;

/**
 * The gift picker drawn to the box it opens in: five columns upright, eight
 * on a phone held sideways (with its chips beside the title and its note
 * beside the button, so the whole picker fits a 336 dp rail height), cells
 * never above 56 dp. `scroll` is only ever true below any real phone.
 */
export function giftPickerLayout(w: number, h: number, land: boolean, count = 15) {
  const P = GIFT_PICKER;
  const cols = land ? 8 : 5;
  const rows = Math.ceil(count / cols);
  const panelW = Math.min(land ? 560 : 360, w - 24);
  const cell = Math.min(P.MAX_CELL, Math.floor((panelW - 2 * P.PAD - (cols - 1) * P.GAP) / cols));
  const gridH = rows * (cell + P.CAPTION) + (rows - 1) * P.GAP;
  const panelH = land
    ? 2 * P.PAD + P.HEADER + P.GAP + gridH + P.GAP + P.SEND
    : 2 * P.PAD + P.HEADER + P.GAP + P.CHIPS + P.GAP + gridH + P.GAP + P.NOTE + P.GAP + P.SEND;
  const room = h - 24;
  const scroll = panelH > room;
  // Scrolling, the grid gets what the window leaves it (a row at the least),
  // so the panel — header, close and send — fits.
  const gridMax = scroll ? Math.max(cell + P.CAPTION, gridH - (panelH - room)) : gridH;
  return { cols, rows, cell, panelW, panelH, gridH, gridMax, scroll };
}

/** The picker's panel around its body: padding, border, the header and the gap under it. */
export const GIFT_PICKER_CHROME = 2 * GIFT_PICKER.PAD + 2 + GIFT_PICKER.HEADER + GIFT_PICKER.GAP;

/**
 * The player view's rows at their least: a button and its note for each
 * action (hide, block, mute, report), then the report's fallback address.
 */
export function playerViewHeight(actions: number): number {
  const P = GIFT_PICKER;
  return actions * (P.SEND + P.GAP + P.NOTE + P.GAP) + P.NOTE;
}

/**
 * The most the player view may take in a backdrop `h` tall (the safe box,
 * insets already off), 12 dp kept above and below the panel. All four
 * actions make a 432 dp panel, and a phone held sideways has 336: the rows
 * scroll under the header rather than push the title and the close button
 * off the top of the screen and the fallback address off the bottom.
 */
export function playerViewMax(h: number): number {
  return Math.max(GIFT_PICKER.SEND, h - 24 - GIFT_PICKER_CHROME);
}
/** Landscape's gap between each rail and the centre column (styles.rootLand). */
export const LAND_GAP = 6;

/**
 * Landscape's emote box, in the right rail's free gap under the leave button:
 * the six 34 dp faces two abreast in three rows or, while the tray is open,
 * the four phrases one under another in the same height, so the swap moves
 * nothing. Inside the rail it can never reach a puck: the right-hand player's
 * box ends LAND_GAP short of the rail. TableScreen measures the gap, and the
 * box gives way where a question's buttons leave it less than this.
 */
export const LAND_TRAY_W = 2 * 34 + 6;
export const LAND_TRAY_H = 3 * 34 + 2 * 6;
/** A phrase in that box: four of them and their three gaps fill it. */
export const LAND_PHRASE_H = (LAND_TRAY_H - 3 * 6) / 4;
/** The emote toggle, a 40 dp square — which is also how the device harness finds it (120 px). */
export const EMOTE_TOGGLE = 40;

/**
 * Portrait's rows that do not flex, in dp, as measured on a 360 dp Samsung
 * with Rubik at the busiest moment of a deal — declaring, online: the root's
 * padding (24), the profile strip with the leave button (35), the "— igra
 * bot" line (16), the score strip (34), a calls chip (24), the zvanja prompt
 * (58), the emote strip (34), the actions row (40), and the nine gaps
 * between ten rows (72). The hand and my puck are added from their own
 * sizes; the felt takes what is left.
 *
 * The prompt is counted whether or not its row is reserved: an unreserved
 * prompt still appears, and the felt must be able to give it the room. The
 * first version counted it only when reserved, and on the Samsung the zvanja
 * question pushed "Prijavi" and "Nemam" under the navigation bar.
 */
export const PORTRAIT_CHROME = 24 + 35 + 16 + 34 + 24 + 58 + 34 + 40 + 9 * 8;
/**
 * Bidding's own band: the emote toggle, "dalje" and four trump buttons wrap
 * the actions row onto three lines on a phone (3 x 40 + 2 gaps of 8 + 2 of
 * padding), with no chip and no prompt beside them — so it must never need
 * more than declaring's chip, prompt and one line of buttons.
 */
export const BIDDING_ACTIONS = 3 * 40 + 2 * 8 + 2;
/** What a short column sheds while a prompt is up: the emote strip (34) and the bot line (16), with their gaps. */
export const PROMPT_SHED = 34 + 8 + 16 + 8;
/** The felt's floor where the phone can pay for it, and how far it may give. */
export const FELT_FLOOR = 260;
export const FELT_FLOOR_MIN = 180;

/*
 * The short column — a portrait phone that cannot pay the busiest moment with
 * the felt at FELT_FLOOR_MIN (shortColumn) — is built tighter: 4 dp of padding
 * and gaps, slim strips, each call a two-line tally beside the others, one
 * prompt at a time, suit-only bids, my puck tucked into the fan's arc. These
 * are its numbers; Android's lines are pinned there, so the web draws the same.
 */
/** styles.felt's vertical margin, which the short column drops. */
export const FELT_MARGIN = 4;
/** So this floor leaves exactly the baize the old 180 left. */
export const FELT_FLOOR_SHORT = FELT_FLOOR_MIN - 2 * FELT_MARGIN;
/**
 * How far the short column's floor may give, and no further: at 152 the trick
 * cross's bottom mat ends 3.3 dp past the rim, inside the 4 dp gap below it.
 */
export const FELT_FLOOR_SOFT = 152;
/** My puck tucks this far up into the empty middle of the fan's arc. */
export const SELF_NESTLE = 10;
/**
 * A short column's resting fan stops this far above its floor, not lower, so a
 * small hand's flattened arc never brings the middle cards down onto my tucked
 * puck's trick pile and dealer badge (the nestle less the root's gap, plus the
 * pile's 4 dp overhang, and air). It stays inside the room the hand keeps for
 * eight cards, so nothing outside the fan moves.
 */
export const FAN_REST_SHORT = SELF_NESTLE + 8;
/**
 * The short column's tallest moment, less the felt, the fan and my puck:
 * online play with a bot line on two lines, three calls whose spoken values
 * wrap, the faces and a line of buttons — padding 8, top strip 30, bot line
 * 32, score strip 24, calls 46, faces 34, buttons 42, and eight gaps of 4.
 */
export const SHORT_CHROME = 8 + 30 + 32 + 24 + 46 + 34 + 42 + 8 * 4;

/**
 * "Velike karte" (1.6.0): the hand's cards about 15% wider than the phone's
 * default, where the width allows it. Module state like the deck style: read
 * during render by whoever computes the metrics; App sets it from Settings.
 */
let bigCards = false;
export function setBigCards(on: boolean): void {
  bigCards = on;
}
export const BIG_CARDS_FACTOR = 1.15;
/** With big cards the fan overlaps more: a phone's fan is bound by its width, not by the cap. */
export const BIG_CARDS_REVEAL = 0.52;

export function computeTableMetrics(usableW: number, usableH: number, opts: { bigCards?: boolean } = {}): TableMetrics {
  const big = opts.bigCards ?? bigCards;
  const landscape = usableW >= usableH;
  // Portrait is width-bound and landscape is height-bound: scale by whichever
  // axis is actually scarce, or a tall thin phone gets giant cards.
  const scale = landscape
    ? clamp(usableH / REF_W, 0.72, 1.3)
    : clamp(Math.min(usableW / REF_W, usableH / REF_H), 0.78, 1.3);

  // In landscape the rails take the sides, so the hand gets the middle —
  // never narrower than the emote box's two faces abreast, which 96 x scale
  // would clip on a window under about 299 dp tall.
  const railW = landscape ? Math.max(LAND_TRAY_W, Math.round(96 * scale)) : 0;
  const puck = Math.round((landscape ? 44 : 54) * scale);
  // My own puck: centred under the fan in portrait, so the fan has the whole
  // width; beside the fan in landscape, where height is the scarce thing, so
  // the fan gives up that much width there (it is capped well short of it).
  const selfPuck = Math.round(puck * 0.85);
  // Landscape's centre column is the width less the root's padding, both
  // rails and the two gaps beside them; my puck's box (its disc plus the
  // room for its name) and the row's gap come off that.
  const handWidth = Math.max(
    240,
    landscape
      ? usableW - 24 - railW * 2 - LAND_GAP * 2 - (selfPuck + PUCK_NAME_ROOM) - SELF_PUCK_GAP
      : usableW - 24,
  );

  // Landscape has width to burn and no height, so the hand takes a fixed
  // slice of the screen instead of the biggest card that fits across it.
  const grow = big ? BIG_CARDS_FACTOR : 1;
  let handCardMax = landscape
    ? clamp(Math.floor(cardWidthForHeight(usableH * 0.34, 8) * grow), 40, Math.round(76 * grow))
    : // Portrait: grow with the screen rather than staying at phone size. 76
      // is the handset figure and `scale` is already 1 there, so phones are
      // unchanged; a roomier window simply gets roomier cards.
      Math.round(76 * scale * grow);
  let handReveal = big ? BIG_CARDS_REVEAL : DEFAULT_REVEAL;
  // Portrait's budget: the fixed rows, a fan this tall, and my puck's row (the
  // ring around the disc; no name is drawn there) - in the full column, and in
  // the short one, which is built tighter (SHORT_CHROME) and tucks my puck
  // into the fan's arc.
  const portraitFixedFor = (fanH: number) => PORTRAIT_CHROME + fanH + selfPuck + 10;
  const shortFixedFor = (fanH: number) => SHORT_CHROME + fanH + selfPuck + 10 - SELF_NESTLE;
  if (big && !landscape) {
    // "Velike karte" grows the fan only as far as the column pays for it.
    // Grown unchecked it turned the 360x723 Samsung into a short column, and
    // pushed a 320 dp phone's bottom row off the screen. So the phone keeps
    // the column its default fan gets, a short column keeps the old baize
    // (FELT_FLOOR_SHORT), and where not even the default cap fits the default
    // fan stays: a lower cap would shrink a hand of a few cards.
    const plainCap = Math.round(76 * scale);
    const plainH = Math.ceil(fanHeight(fitHand(handWidth, 8, plainCap).cardW, 8));
    const left = usableH - portraitFixedFor(plainH);
    const spare =
      left >= FELT_FLOOR_MIN
        ? left - FELT_FLOOR_MIN
        : Math.max(0, usableH - shortFixedFor(plainH) - FELT_FLOOR_SHORT);
    const roomW = Math.floor(cardWidthForHeight(plainH + spare, 8));
    if (roomW < plainCap) {
      handCardMax = plainCap;
      handReveal = DEFAULT_REVEAL;
    } else handCardMax = Math.min(handCardMax, roomW);
  }
  const fit = fitHand(handWidth, 8, handCardMax, handReveal);
  const handMinHeight = Math.ceil(fanHeight(fit.cardW, 8));

  // The reserve is kept only if the felt keeps its whole floor with it;
  // without it, the floor gives before the actions row is pushed off the
  // bottom of a short phone.
  const portraitFixed = portraitFixedFor(handMinHeight);
  const promptReserve = !landscape && usableH - portraitFixed >= FELT_FLOOR;
  const shortColumn = !landscape && usableH - portraitFixed < FELT_FLOOR_MIN;
  // The short column's floor leaves the old baize where the phone can pay for
  // it, and gives, down to the soft floor, rather than push an answer off a
  // 320x548 screen.
  const shortFixed = shortFixedFor(handMinHeight);
  const feltMinHeight = landscape
    ? 0
    : shortColumn
      ? clamp(usableH - shortFixed, FELT_FLOOR_SOFT, FELT_FLOOR_SHORT)
      : clamp(usableH - portraitFixed, FELT_FLOOR_MIN, FELT_FLOOR);

  return {
    orientation: landscape ? 'landscape' : 'portrait',
    width: usableW,
    height: usableH,
    scale,
    handWidth,
    railW,
    handCardMax,
    handReveal,
    handMinHeight,
    // Portrait: a generous floor where the column can pay for it, less where
    // it cannot. Sideways it must be zero: the felt is the only flexible row,
    // so any floor it cannot meet is paid for by pushing the hand off.
    feltMinHeight,
    // Portrait: the table may take about half the height and no more. Beyond
    // that it is just empty baize, and the cards are what people read.
    // Landscape: whatever the hand leaves, and never what the hand needs —
    // the felt was offered the whole height, which is exactly the budget the
    // fan is also drawn from.
    feltMaxHeight: landscape
      ? Math.max(0, usableH - handMinHeight - FELT_HAND_GAP)
      : shortColumn
        ? // A short column has no baize to spare: the felt takes every dp, so a
          // row that comes or goes above the fan is always the felt's to pay.
          usableH
        : Math.round(usableH * 0.48),
    slotW: Math.round(46 * scale),
    slotH: Math.round(67 * scale),
    puck,
    selfPuck,
    compact: usableH < 620,
    promptReserve,
    shortColumn,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
