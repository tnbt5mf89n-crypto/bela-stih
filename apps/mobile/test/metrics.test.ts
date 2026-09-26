import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  computeTableMetrics,
  FAN_REST_SHORT,
  FELT_FLOOR,
  FELT_FLOOR_MIN,
  FELT_FLOOR_SHORT,
  FELT_FLOOR_SOFT,
  FELT_HAND_GAP,
  FELT_MARGIN,
  giftBadgeBox,
  giftPickerLayout,
  GIFT_PICKER,
  GIFT_PICKER_CHROME,
  playerViewHeight,
  playerViewMax,
  BIDDING_ACTIONS,
  EMOTE_TOGGLE,
  LAND_GAP,
  LAND_PHRASE_H,
  LAND_TRAY_H,
  LAND_TRAY_W,
  PORTRAIT_CHROME,
  PUCK_NAME_ROOM,
  PROMPT_SHED,
  SELF_NESTLE,
  SELF_PUCK_GAP,
  SHORT_CHROME,
} from '../src/table/metrics';
import { FAN_PAD, fanArc, fanHeight, fitHand, fitTrickCross, slotOffsets } from '../src/table/geometry';

/**
 * The table's dimensions as a function of the usable box. Phones first: the
 * boxes below are real handsets with their insets already taken off.
 */
const LANDSCAPE = [
  [640, 360], // a 16:9 budget phone
  [800, 360],
  [915, 412], // Pixel-class
  [1024, 768], // tablet
  [960, 505], // the web column at its widest
] as const;
const PORTRAIT = [
  [320, 568],
  [360, 740],
  [412, 915],
  [480, 1000],
] as const;

describe('computeTableMetrics', () => {
  it('never lets a landscape felt claim the height the hand needs', () => {
    // With the whole height on offer the felt was the fan's only competitor
    // for it — and the fan is drawn from the same budget.
    for (const [w, h] of LANDSCAPE) {
      const m = computeTableMetrics(w, h);
      expect(m.orientation).toBe('landscape');
      expect(m.feltMaxHeight + m.handMinHeight + FELT_HAND_GAP).toBeLessThanOrEqual(h);
      expect(m.feltMaxHeight).toBeGreaterThan(h * 0.4); // and still a table, not a strip
    }
  });

  it('reserves the whole fan for the hand, lift and arc included', () => {
    for (const [w, h] of [...LANDSCAPE, ...PORTRAIT]) {
      const m = computeTableMetrics(w, h);
      const fit = fitHand(m.handWidth, 8, m.handCardMax);
      expect(m.handMinHeight).toBeGreaterThanOrEqual(fanHeight(fit.cardW, 8));
    }
  });

  it("keeps portrait's table between its floor and half the height", () => {
    for (const [w, h] of PORTRAIT) {
      const m = computeTableMetrics(w, h);
      expect(m.orientation).toBe('portrait');
      // A short column's felt takes every spare dp: no baize to spare there.
      expect(m.feltMaxHeight).toBe(m.shortColumn ? h : Math.round(h * 0.48));
      // A short column's floor is its own (see 'the short column').
      expect(m.feltMinHeight).toBeGreaterThanOrEqual(m.shortColumn ? FELT_FLOOR_SOFT : FELT_FLOOR_MIN);
      expect(m.feltMinHeight).toBeLessThanOrEqual(m.shortColumn ? FELT_FLOOR_SHORT : FELT_FLOOR);
      expect(m.railW).toBe(0);
    }
    // A tall phone keeps the whole floor.
    expect(computeTableMetrics(412, 915).feltMinHeight).toBe(FELT_FLOOR);
  });

  it('keeps a landscape hand to about a third of the height', () => {
    for (const [w, h] of LANDSCAPE) {
      const m = computeTableMetrics(w, h);
      expect(m.handMinHeight).toBeLessThanOrEqual(Math.ceil(h * 0.34) + 1);
    }
  });
});

/**
 * Portrait's rows, as measured on the Samsung with Rubik — owned by this test,
 * so an understated budget in metrics.ts cannot pass by agreeing with itself.
 */
const ROW = { pad: 24, top: 35, status: 16, header: 34, calls: 24, prompt: 58, emotes: 34, line: 40, gap: 8 };
/** The two busiest moments of a deal, online: every row they render but the felt, the hand and my puck. */
const DECLARING =
  ROW.pad + ROW.top + ROW.status + ROW.header + ROW.calls + ROW.prompt + ROW.emotes + ROW.line + 9 * ROW.gap;
const BIDDING =
  ROW.pad + ROW.top + ROW.status + ROW.header + ROW.emotes + (3 * ROW.line + 2 * ROW.gap + 2) + 7 * ROW.gap;
/** What a short column sheds while it asks: the emote strip and the bot line, with their gaps. */
const SHED = ROW.emotes + ROW.gap + ROW.status + ROW.gap;

describe('the portrait column', () => {
  const PHONES = [
    [320, 568],
    [360, 640],
    [375, 647],
    [360, 668],
    [360, 723], // the Samsung this was measured on
    [390, 763],
    [412, 850],
    [412, 915],
    [480, 1000],
  ] as const;

  it('counts at least the rows the busiest moments render', () => {
    expect(PORTRAIT_CHROME).toBeGreaterThanOrEqual(DECLARING);
    expect(BIDDING).toBeLessThanOrEqual(DECLARING);
    expect(BIDDING_ACTIONS).toBe(3 * ROW.line + 2 * ROW.gap + 2);
    expect(PROMPT_SHED).toBe(SHED);
  });

  for (const [name, rows] of [
    ['declaring (a chip and the zvanja question)', DECLARING],
    ['bidding (three lines of buttons)', BIDDING],
  ] as const) {
    it(`keeps the answering buttons on screen while ${name} wherever the full column fits`, () => {
      for (const [w, h] of PHONES) {
        const m = computeTableMetrics(w, h);
        // A short column is built tighter, with a budget of its own: 'the short column'.
        if (m.shortColumn) continue;
        const need = rows + m.handMinHeight + m.selfPuck + 10 + m.feltMinHeight;
        expect(need, `${w}x${h}`).toBeLessThanOrEqual(h);
      }
    });
  }

  it('keeps the prompt reserve only where the felt keeps its whole floor with it', () => {
    for (const [w, h] of PHONES) {
      const m = computeTableMetrics(w, h);
      if (m.promptReserve) expect(m.feltMinHeight, `${w}x${h}`).toBe(FELT_FLOOR);
    }
    expect(computeTableMetrics(412, 915).promptReserve).toBe(true);
    expect(computeTableMetrics(360, 723).promptReserve).toBe(false);
    expect(computeTableMetrics(375, 647).promptReserve).toBe(false);
    for (const [w, h] of LANDSCAPE) expect(computeTableMetrics(w, h).promptReserve).toBe(false);
  });

  it('lets the floor give on the Samsung, but no lower than it must', () => {
    const m = computeTableMetrics(360, 723);
    expect(m.feltMinHeight).toBeLessThan(FELT_FLOOR);
    expect(m.feltMinHeight).toBeGreaterThanOrEqual(FELT_FLOOR_MIN);
    expect(m.shortColumn).toBe(false);
  });

  it('sheds rows only where the lowest floor cannot pay, and never sideways', () => {
    expect(computeTableMetrics(412, 915).shortColumn).toBe(false);
    expect(computeTableMetrics(360, 640).shortColumn).toBe(true);
    for (const [w, h] of LANDSCAPE) expect(computeTableMetrics(w, h).shortColumn).toBe(false);
  });
});

/**
 * The short column's rows, with Android's lines pinned (a pinned line is the
 * same height on the web; measured there at 320 dp) — owned by this test, so
 * metrics' SHORT_CHROME cannot pass by agreeing with itself.
 */
const S = {
  pad: 8, top: 30, status: 16, status2: 32, header: 24,
  /** Three calls whose spoken values wrap in their tallies; four, or a carré, take a third line. */
  calls: 46, callsWorst: 60,
  zvanja: 42, bela: 26, faces: 34, slot: 34, line: 42, lines2: 90, gap: 4,
  /** The arrange hint above the fan, its compact Done beside it: 33.7 dp and the row's 10. */
  arrange: 44,
};
/** Every moment a short column must hold: its rows other than the felt, the fan and my puck, gaps included. */
const SHORT_STATES = {
  'the zvanja question with three calls': S.pad + S.top + S.header + S.calls + S.zvanja + S.line + 7 * S.gap,
  'my bid, five buttons on two lines': S.pad + S.top + S.header + S.lines2 + 5 * S.gap,
  'my bid while arranging': S.pad + S.top + S.header + S.arrange + S.lines2 + 6 * S.gap,
  'the bela pair while arranging, three calls': S.pad + S.top + S.header + S.calls + S.arrange + S.line + 7 * S.gap,
  'play while arranging, three calls': S.pad + S.top + S.header + S.calls + S.slot + S.line + 7 * S.gap,
  'the hard-mode bela pair with three calls': S.pad + S.top + S.header + S.calls + S.line + 6 * S.gap,
  'the bela pair with three calls': S.pad + S.top + S.header + S.calls + S.bela + S.line + 7 * S.gap,
  'the zvanja question with four calls or a carré': S.pad + S.top + S.header + S.callsWorst + S.zvanja + S.line + 7 * S.gap,
  'online play, the bot line on two lines, three calls': S.pad + S.top + S.status2 + S.header + S.calls + S.faces + S.line + 8 * S.gap,
} as const;
type ShortState = keyof typeof SHORT_STATES;
/** The moments with an answer on screen, which may never be pushed off it. */
const ANSWERING: ShortState[] = [
  'the zvanja question with three calls',
  'my bid, five buttons on two lines',
  'my bid while arranging',
  'the bela pair with three calls',
  'the bela pair while arranging, three calls',
  'the hard-mode bela pair with three calls',
];

describe('the short column', () => {
  const SHORT_PHONES = [
    [320, 568],
    [320, 548], // an iPhone SE under its status bar
    [320, 533], // a 320 dp Android
    [360, 640],
    [375, 647],
    [360, 668],
    [412, 683],
    [360, 704],
  ] as const;
  const need = (m: ReturnType<typeof computeTableMetrics>, rows: number) =>
    rows + m.handMinHeight + m.selfPuck + 10 - SELF_NESTLE + m.feltMinHeight;

  it('counts its tallest moment', () => {
    for (const [name, rows] of Object.entries(SHORT_STATES)) expect(SHORT_CHROME, name).toBeGreaterThanOrEqual(rows);
    expect(SHORT_CHROME).toBe(Math.max(...Object.values(SHORT_STATES)));
  });

  it('holds every moment of a deal on a 320x568 phone and up', () => {
    for (const [w, h] of SHORT_PHONES) {
      if (h < 568) continue;
      const m = computeTableMetrics(w, h);
      expect(m.shortColumn, `${w}x${h}`).toBe(true);
      for (const [name, rows] of Object.entries(SHORT_STATES)) {
        expect(need(m, rows), `${w}x${h}: ${name}`).toBeLessThanOrEqual(h);
      }
    }
  });

  it('keeps every answer on screen below that, the felt giving first', () => {
    for (const [w, h] of SHORT_PHONES) {
      if (h >= 568) continue;
      const m = computeTableMetrics(w, h);
      // The buttons end above the root's bottom padding (4) and the actions row's own (2).
      for (const name of ANSWERING) expect(need(m, SHORT_STATES[name]) - 4 - 2, `${w}x${h}: ${name}`).toBeLessThanOrEqual(h);
      // A fourth call, or a carré's third line, still fits an iPhone SE.
      if (h >= 548) {
        const worst = need(m, SHORT_STATES['the zvanja question with four calls or a carré']) - 4 - 2;
        expect(worst, `${w}x${h}: four calls`).toBeLessThanOrEqual(h);
      }
    }
  });

  it('keeps the old baize where the phone can pay for it, and gives no further than the soft floor', () => {
    expect(FELT_FLOOR_SHORT).toBe(FELT_FLOOR_MIN - 2 * FELT_MARGIN);
    expect(computeTableMetrics(360, 640).feltMinHeight).toBe(FELT_FLOOR_SHORT);
    expect(computeTableMetrics(320, 568).feltMinHeight).toBe(158);
    expect(computeTableMetrics(320, 548).feltMinHeight).toBe(FELT_FLOOR_SOFT);
    expect(computeTableMetrics(320, 533).feltMinHeight).toBe(FELT_FLOOR_SOFT);
  });

  it('keeps the trick cross inside the rim at the short floor, and within the gap below at the soft one', () => {
    // The partner's row above the felt at 320 dp as Android draws it, and the
    // felt's frame (styles.felt / feltInner): rim 6, padding 5, border 1, both sides.
    const PARTNER_ROW = 71;
    const FRAME = 2 * (6 + 5 + 1);
    const pastTheRim = (floor: number) => {
      const box = floor - PARTNER_ROW - FRAME; // the slots' box: no margin in a short column
      const slot = fitTrickCross(200, box, 67);
      const bottom = 0.55 * box + slotOffsets(slot.slotW, slot.slotH).bottom.marginTop + slot.slotH;
      return bottom - box - FRAME / 2;
    };
    expect(pastTheRim(FELT_FLOOR_SHORT)).toBeLessThanOrEqual(0);
    expect(pastTheRim(FELT_FLOOR_SOFT)).toBeLessThanOrEqual(S.gap);
    // The soft floor is where that stops being true: two dp lower is too low.
    expect(pastTheRim(FELT_FLOOR_SOFT - 2)).toBeGreaterThan(S.gap);
  });

  it('starting to arrange moves nothing under the finger', () => {
    // In play the arrange hint takes the faces' own slot: the same height.
    expect(S.slot).toBe(S.faces);
    // During a bid the faces are already shed, so it asks above the fan, and
    // the felt, which has no ceiling in a short column, pays for all of it.
    for (const [w, h] of SHORT_PHONES) {
      if (h < 548) continue; // the soft floor binds at 533: the fan gives 1 dp there
      const m = computeTableMetrics(w, h);
      expect(m.feltMaxHeight, `${w}x${h}`).toBe(h);
      const feltInTheBid = h - (need(m, SHORT_STATES['my bid, five buttons on two lines']) - m.feltMinHeight);
      expect(feltInTheBid - (S.arrange + S.gap), `${w}x${h}`).toBeGreaterThanOrEqual(m.feltMinHeight);
    }
  });

  it("rests a small hand clear of my tucked puck, inside the fan's own room", () => {
    // How far my puck's row reaches up into the hand's box — the nestle less the
    // root's gap — plus the trick pile's overhang above the ring (SeatPuck: top -4).
    const reach = SELF_NESTLE - S.gap + 4;
    for (const [w, h] of SHORT_PHONES) {
      const m = computeTableMetrics(w, h);
      for (let n = 1; n <= 8; n++) {
        const fit = fitHand(m.handWidth, n, m.handCardMax);
        const floor = Math.max(fanArc(n) * fit.scale, FAN_REST_SHORT);
        // The fan still fits the room the hand keeps for eight cards: nothing outside it moves.
        expect(FAN_PAD + fit.cardH + floor, `${w}x${h}, ${n} cards`).toBeLessThanOrEqual(m.handMinHeight);
        // Every card over the puck rests above its pile and badge.
        for (let i = 0; i < n; i++) {
          const off = i - (n - 1) / 2;
          if (Math.abs(off) > 1.5) continue;
          const bottom = floor - Math.pow(Math.abs(off), 1.6) * 3.2 * fit.scale;
          expect(bottom, `${w}x${h}, ${n} cards, card ${i}`).toBeGreaterThanOrEqual(reach);
        }
      }
    }
  });

  it('changes nothing from the Samsung up, or sideways', () => {
    for (let w = 360; w <= 480; w += 12) {
      for (let h = 723; h <= 1100; h += 17) {
        const m = computeTableMetrics(w, h);
        const fixed = PORTRAIT_CHROME + m.handMinHeight + m.selfPuck + 10;
        expect(m.shortColumn, `${w}x${h}`).toBe(false);
        expect(m.feltMinHeight, `${w}x${h}`).toBe(Math.max(FELT_FLOOR_MIN, Math.min(FELT_FLOOR, h - fixed)));
      }
    }
    for (const [w, h] of LANDSCAPE) expect(computeTableMetrics(w, h).shortColumn, `${w}x${h}`).toBe(false);
  });

  it('"Velike karte" grows the fan only as far as the column pays for it', () => {
    // Grown unchecked, the fan turned the Samsung (360x723) into a short column
    // and pushed a 320x568 phone's tallest moment under the navigation bar.
    const boxes: (readonly [number, number])[] = [...SHORT_PHONES, [360, 568], [360, 723], [360, 740], [360, 800], [412, 915]];
    // ...and the portrait boxes between, in steps.
    for (let w = 300; w <= 520; w += 8) for (let h = 500; h <= 1100; h += 10) if (w < h) boxes.push([w, h]);
    for (const [w, h] of boxes) {
      const plain = computeTableMetrics(w, h);
      const big = computeTableMetrics(w, h, { bigCards: true });
      // The phone keeps the column its default fan gets...
      expect(big.shortColumn, `${w}x${h}`).toBe(plain.shortColumn);
      if (big.shortColumn) {
        // ...a short one holds every moment the default fan held, and one it could not hold no worse...
        for (const [name, rows] of Object.entries(SHORT_STATES)) {
          expect(need(big, rows), `${w}x${h}: ${name}`).toBeLessThanOrEqual(Math.max(h, need(plain, rows)));
        }
      } else {
        // ...a full one still answers the busiest moments above the bottom edge...
        for (const rows of [DECLARING, BIDDING]) {
          expect(rows + big.handMinHeight + big.selfPuck + 10 + big.feltMinHeight, `${w}x${h}`).toBeLessThanOrEqual(h);
        }
      }
      // ...and no hand, of any size, comes out smaller than the default's.
      for (let n = 1; n <= 8; n++) {
        const was = fitHand(plain.handWidth, n, plain.handCardMax, plain.handReveal).cardW;
        expect(fitHand(big.handWidth, n, big.handCardMax, big.handReveal).cardW, `${w}x${h}, ${n} cards`).toBeGreaterThanOrEqual(was);
      }
    }
    // Where the column has room the cards still grow: the Samsung's, and a short column with baize to spare.
    const eight = (w: number, h: number, bigCards: boolean) => {
      const m = computeTableMetrics(w, h, { bigCards });
      return fitHand(m.handWidth, 8, m.handCardMax, m.handReveal).cardW;
    };
    for (const [w, h] of [[360, 723], [360, 640], [360, 800]] as const) {
      expect(eight(w, h, true) / eight(w, h, false), `${w}x${h}`).toBeGreaterThan(1.1);
    }
    // Where it has none, the default fan stays.
    expect(eight(320, 568, true)).toBe(eight(320, 568, false));
  });
});

describe('my puck', () => {
  it("gives the fan portrait's whole width: it stands under the cards, not beside them", () => {
    for (const [w, h] of PORTRAIT) {
      const m = computeTableMetrics(w, h);
      expect(m.handWidth).toBe(Math.max(240, w - 24));
      expect(m.selfPuck).toBeGreaterThan(0);
      expect(m.selfPuck).toBeLessThan(m.puck);
    }
  });

  it('stands beside the fan in landscape: the fan fits the cell it is really given, at no cost to the cards', () => {
    for (const [w, h] of LANDSCAPE) {
      const m = computeTableMetrics(w, h);
      // The centre column, and the cell the hand gets in it beside my puck's box.
      const centre = w - 24 - m.railW * 2 - LAND_GAP * 2;
      const cell = centre - (m.selfPuck + PUCK_NAME_ROOM) - SELF_PUCK_GAP;
      expect(m.handWidth, `${w}x${h}`).toBeLessThanOrEqual(Math.max(240, cell));
      // Capped cards: the puck costs the fan nothing.
      const inCell = fitHand(m.handWidth, 8, m.handCardMax).cardW;
      const alone = fitHand(centre, 8, m.handCardMax).cardW;
      expect(inCell, `${w}x${h}`).toBeCloseTo(alone, 5);
    }
  });
});

describe('the landscape rails', () => {
  // Measured on the web export at 640x360 with Rubik and compact buttons.
  const PROFILE = 78;
  const HEADER = 102;
  const PLATE = 38;
  /** The caller line, over two lines as the rail now allows. */
  const CALLER = 36;
  const CHIP = 50; // one zvanje chip, the calls column's minimum worth having
  // Measured on the player's Samsung held sideways (usable 723x336: a 24 dp
  // status bar, a 29.5 dp camera cut-out on the left, the 48 dp navigation
  // bar on the right): a compact button and the leave button are 33.7 dp
  // there, not the web's 31, so the right rail's sums use 34.
  const LEAVE = 34;
  const BUTTON = 34;
  /**
   * A compact button whose label wraps: one more 13 dp line of 11 px Rubik.
   * In the rail that is the online "Napusti stol" / "Напусти сто" on a rail
   * under 83 dp, and every Croatian bela label ("K srce + BELA").
   */
  const BUTTON2 = 47;
  const TOGGLE = 40;
  const FACE = 34;
  const GAP = 6;
  const ROOT_PAD = 12;
  /**
   * The right rail's free gap, where the emote box lives: the leave button on
   * top, the question's buttons (their heights) and the toggle at the foot,
   * and the rail's 6 dp gap on both sides of the free one.
   */
  const railGap = (h: number, buttons: readonly number[], leave = LEAVE) =>
    h - ROOT_PAD - leave - 2 * GAP - buttons.reduce((s, b) => s + b + GAP, 0) - TOGGLE;
  const ones = (n: number) => Array<number>(n).fill(BUTTON);
  /** Every phone and larger held sideways; the Samsung as measured (723x336) and as first assumed (752x331). */
  const RAIL_BOXES = [
    [568, 320], [640, 336], [667, 375], [723, 336], [752, 331], [780, 360], [800, 390], [915, 412], [1000, 480],
    [1024, 600], [1280, 800], [1366, 1024], ...LANDSCAPE,
  ] as const;
  /** Shorter than any phone held sideways: a phone's browser under its toolbar, split screen, the 240 floor. */
  const SHORT_BOXES = [[426, 240], [532, 280], [485, 296]] as const;
  /** A rail phrase chip around en "Thanks!" (51.2 dp of Rubik-700 at 13 px): 2 x 6 padding, 2 x 1 border. */
  const phraseChip = (fontScale: number) => 51.2 * fontScale + 2 * 6 + 2;

  it('holds the score, the plate with who called, and a chip on the left of every screen', () => {
    for (const [w, h] of LANDSCAPE) {
      const left = PROFILE + HEADER + PLATE + CALLER + CHIP + 4 * GAP;
      expect(left, `${w}x${h} left rail`).toBeLessThanOrEqual(h - ROOT_PAD);
    }
  });

  it('holds the leave button, five bid buttons and the toggle on the right of every screen', () => {
    for (const [w, h] of RAIL_BOXES) {
      expect(railGap(h, ones(5)), `${w}x${h} right rail`).toBeGreaterThanOrEqual(0);
    }
    // Online in Croatian, a two-line leave label and a two-line suit, on the
    // Samsung and up. (On 568x320 that worst case runs about 4 dp into the
    // root's 6 dp padding: older than the emote box, and out of sight.)
    for (const [w, h] of RAIL_BOXES.filter(([, rh]) => rh >= 331)) {
      expect(railGap(h, [BUTTON2, ...ones(4)], BUTTON2), `${w}x${h} worst labels`).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the emote box under the leave button whenever the table is not asking me to bid', () => {
    for (const [w, h] of RAIL_BOXES) {
      // Nobody asking me anything, and the zvanja question's two buttons —
      // under the online leave label on two lines, too.
      expect(railGap(h, [], BUTTON2), `${w}x${h} idle`).toBeGreaterThanOrEqual(LAND_TRAY_H);
      expect(railGap(h, ones(2), BUTTON2), `${w}x${h} declaring`).toBeGreaterThanOrEqual(LAND_TRAY_H);
    }
  });

  it('gives the box way to two two-line bela buttons only on the shortest rails', () => {
    // Online, trump K and Q in hand: both bela labels wrap, and so does the leave label.
    for (const [w, h] of RAIL_BOXES) {
      const room = railGap(h, [BUTTON2, BUTTON2], BUTTON2);
      if (h >= 331) expect(room, `${w}x${h}`).toBeGreaterThanOrEqual(LAND_TRAY_H);
      else expect(room, `${w}x${h}`).toBeLessThan(LAND_TRAY_H);
    }
  });

  it('is wide enough for two faces abreast and the widest phrase, however short the window', () => {
    for (const [w, h] of [...RAIL_BOXES, ...SHORT_BOXES]) {
      const m = computeTableMetrics(w, h);
      expect(m.railW, `${w}x${h}`).toBeGreaterThanOrEqual(LAND_TRAY_W);
      expect(m.railW, `${w}x${h} "Thanks!"`).toBeGreaterThanOrEqual(phraseChip(1));
    }
    // On a phone, even at the 1.2 cap on the rail phrases' font scale.
    for (const [w, h] of RAIL_BOXES) {
      expect(computeTableMetrics(w, h).railW, `${w}x${h} "Thanks!" at 1.2`).toBeGreaterThanOrEqual(phraseChip(1.2));
    }
  });

  it('fills the emote box exactly both ways, so the swap moves nothing', () => {
    expect(3 * FACE + 2 * GAP).toBe(LAND_TRAY_H);
    expect(4 * LAND_PHRASE_H + 3 * GAP).toBe(LAND_TRAY_H);
    expect(2 * FACE + GAP).toBe(LAND_TRAY_W);
    // A phrase's pinned 17 dp line, its border top and bottom, and some air.
    expect(LAND_PHRASE_H).toBeGreaterThanOrEqual(17 + 2 + 4);
  });

  it('gives the box way to a five-button bid only where the rail cannot hold both', () => {
    for (const [w, h] of [[568, 320], [640, 336], [667, 375], [723, 336], [752, 331], [780, 360], [800, 390]] as const) {
      expect(railGap(h, ones(5)), `${w}x${h}`).toBeLessThan(LAND_TRAY_H);
    }
    for (const [w, h] of [[1000, 480], [1024, 600], [1280, 800], [1366, 1024]] as const) {
      expect(railGap(h, ones(5)), `${w}x${h}`).toBeGreaterThanOrEqual(LAND_TRAY_H);
    }
  });

  it("keeps the toggle the harness's square, and no face can pass for it", () => {
    // The device harness takes the bottom-right clickable square of 105..135 px (3 px per dp).
    expect(EMOTE_TOGGLE).toBe(TOGGLE);
    expect(3 * EMOTE_TOGGLE).toBeGreaterThanOrEqual(105);
    expect(3 * EMOTE_TOGGLE).toBeLessThanOrEqual(135);
    expect(3 * FACE).toBeLessThan(105);
  });

  it('has no tight-rail mode left: nothing floats beside the rail', () => {
    expect(computeTableMetrics(800, 360)).not.toHaveProperty('tightRail');
    expect(computeTableMetrics(1024, 768)).not.toHaveProperty('tightRail');
  });
});

describe('the gift badge', () => {
  /** Every puck size the layout can produce, from the 240-tall floor to a tablet, either way up. */
  const sizes = (() => {
    const others = new Set<number>();
    const mine = new Set<number>();
    for (let w = 240; w <= 1400; w += 20) {
      for (let h = 240; h <= 1400; h += 20) {
        const m = computeTableMetrics(w, h);
        others.add(m.puck);
        mine.add(m.selfPuck);
      }
    }
    return { others: [...others].sort((a, b) => a - b), mine: [...mine].sort((a, b) => a - b) };
  })();
  const all = [...new Set([...sizes.others, ...sizes.mine])];
  // SeatPuck's own furniture, in its ring box's coordinates.
  const D = { cx: -2 + 9, cy: -2 + 9, r: 9 }; // the dealer's 18 dp disc at (-2, -2)
  const DIAMOND_H = 11; // the partner's glyph at bottom -2, left -2

  it('never reaches past the margin the puck box keeps beside its ring', () => {
    for (const size of all) {
      const b = giftBadgeBox(size);
      expect(b.d / 2, `puck ${size}`).toBeLessThanOrEqual(PUCK_NAME_ROOM / 2 - 5);
      expect(b.left, `puck ${size}`).toBe(-b.d / 2);
    }
  });

  it("clears the dealer's D on every puck, mine included", () => {
    for (const size of all) {
      const b = giftBadgeBox(size);
      const cx = b.left + b.d / 2;
      const cy = b.top + b.d / 2;
      expect(Math.hypot(cx - D.cx, cy - D.cy), `puck ${size}`).toBeGreaterThanOrEqual(D.r + b.d / 2);
    }
  });

  it("clears the partner's ◆ on every puck that can carry one (not mine)", () => {
    for (const size of sizes.others) {
      const b = giftBadgeBox(size);
      const ring = size + 10;
      expect(b.top + b.d, `puck ${size}`).toBeLessThanOrEqual(ring - DIAMOND_H);
    }
  });

  it('stays above the name and clear of an emote bubble\'s tail', () => {
    for (const size of all) {
      const b = giftBadgeBox(size);
      const ring = size + 10;
      expect(b.top + b.d, `puck ${size}`).toBeLessThanOrEqual(ring);
      // The bubble's tail points down at the puck's centre, 7 dp either side.
      expect(b.left + b.d - ring / 2, `puck ${size}`).toBeLessThan(-7);
    }
  });

  it('can fail: a badge in the top-left corner would sit on the D', () => {
    const size = 54;
    const d = giftBadgeBox(size).d;
    expect(Math.hypot(d / 2 - D.cx, d / 2 - D.cy)).toBeLessThan(D.r + d / 2);
  });
});

describe('the gift picker', () => {
  const PHONES_UP = [[320, 568], [320, 533], [360, 640], [360, 723], [360, 800], [390, 844], [412, 915], [480, 1000], [768, 1024]] as const;
  const PHONES_SIDE = [[568, 320], [640, 336], [667, 375], [723, 336], [752, 331], [780, 360], [800, 390], [915, 412], [1024, 600], [1024, 768], [1280, 800]] as const;

  it('fits every phone, either way up, with cells a finger can hit and no scrolling', () => {
    for (const [w, h] of PHONES_UP) {
      const L = giftPickerLayout(w, h, false);
      expect(L.panelW, `${w}x${h}`).toBeLessThanOrEqual(w - 24);
      expect(L.panelH, `${w}x${h}`).toBeLessThanOrEqual(h - 24);
      expect(L.cell, `${w}x${h}`).toBeGreaterThanOrEqual(48);
      expect(L.scroll, `${w}x${h}`).toBe(false);
      expect(L.cols * L.rows).toBeGreaterThanOrEqual(15);
    }
    for (const [w, h] of PHONES_SIDE) {
      const L = giftPickerLayout(w, h, true);
      expect(L.panelW, `${w}x${h}`).toBeLessThanOrEqual(w - 24);
      expect(L.panelH, `${w}x${h}`).toBeLessThanOrEqual(h - 24);
      expect(L.cell, `${w}x${h}`).toBeGreaterThanOrEqual(48);
      expect(L.scroll, `${w}x${h}`).toBe(false);
    }
  });

  it('scrolls only below any real phone', () => {
    expect(giftPickerLayout(426, 240, true).scroll).toBe(true);
  });

  it('when it scrolls, the grid gives up what the window lacks, so close and send stay on screen', () => {
    for (const [w, h, land] of [[426, 240, true], [360, 390, false], [320, 380, false], [568, 250, true]] as const) {
      const L = giftPickerLayout(w, h, land);
      expect(L.scroll, `${w}x${h}`).toBe(true);
      expect(L.gridMax, `${w}x${h}`).toBeLessThan(L.gridH);
      // The panel as drawn: its full height less what the scroll view hides.
      expect(L.panelH - (L.gridH - L.gridMax), `${w}x${h}`).toBeLessThanOrEqual(h - 24);
      // Never less than a row, even where that cannot fit.
      expect(L.gridMax).toBeGreaterThanOrEqual(L.cell + GIFT_PICKER.CAPTION);
    }
    const still = giftPickerLayout(360, 800, false);
    expect(still.gridMax).toBe(still.gridH);
  });

  it("keeps the player view's header on screen: its rows scroll where the safe box cannot hold them", () => {
    // Hide, block, mute and report make a 432 dp panel; the Samsung held sideways has 336.
    expect(GIFT_PICKER_CHROME + playerViewHeight(4)).toBe(432);
    expect(playerViewHeight(4)).toBeGreaterThan(playerViewMax(336));
    for (const [w, h] of [...PHONES_UP, ...PHONES_SIDE]) {
      for (const actions of [2, 3, 4]) {
        // The rows at their least, and with every note a line longer (larger text).
        for (const rows of [playerViewHeight(actions), playerViewHeight(actions) + (actions + 1) * 14]) {
          // The panel as drawn: its chrome, and as much of the rows as the scroll view shows.
          expect(GIFT_PICKER_CHROME + Math.min(rows, playerViewMax(h)), `${w}x${h}, ${actions} actions`).toBeLessThanOrEqual(h - 24);
        }
      }
    }
    // Upright, every phone shows all four at their least without scrolling.
    for (const [w, h] of PHONES_UP) expect(playerViewHeight(4), `${w}x${h}`).toBeLessThanOrEqual(playerViewMax(h));
    // ...and the picker draws it so: the player view is that scroll view, capped by the safe box.
    const picker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/table/GiftPicker.tsx'), 'utf8');
    expect(picker).toMatch(/const playerMax = playerViewMax\(height - insets\.top - insets\.bottom\);/);
    expect(picker).toMatch(/\{moderating && moderate \? \(\s*<ScrollView style=\{\[styles\.playerScroll, \{ maxHeight: playerMax \}\]\}/);
  });
});
