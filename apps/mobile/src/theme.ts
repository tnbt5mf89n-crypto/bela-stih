import type { TextStyle } from 'react-native';
import { garb } from './deck/palette';

/**
 * A card-table palette, deliberately NOT casino chrome.
 *
 * This matters beyond taste: the IARC questionnaire assigns a "Simulated
 * Gambling" descriptor — and with it a PEGI 18 rating — to apps that look like a
 * casino. Felt and wood read as a kitchen table, which is what Bela is.
 *
 * The one gold is the deck's own (`garb.gold`), so the plaque, the coins and
 * the cards' trim are the same metal. Gold means "the thing to press" or
 * "money"; secondary emphasis is cream ink or a team colour, never more gold.
 */
export const theme = {
  felt: '#123a2b',
  feltDeep: '#0d2a1f',
  wood: '#3a2a1d',
  line: 'rgba(255,255,255,0.10)',
  text: '#f2efe6',
  textDim: 'rgba(242,239,230,0.62)',
  cardFace: garb.cream,
  accent: garb.gold,
  /** An outcome went badly / well: fills, borders and large type. For body text use `okInk` / `dangerInk`. */
  danger: '#c2452f',
  ok: '#4e9d5b',
  /** The same two outcomes as ink on the dark ground, lifted to read at body size. */
  dangerInk: '#f28b7d',
  okInk: '#7fcf8c',
} as const;

/**
 * Us and them. Green and red are what a bela player already reads as "our pile"
 * and "theirs" — but they are also the classic confusion pair, so colour is
 * NEVER the only carrier here: the Mi/Oni labels stay, the partner keeps a
 * shape marker, and the two hues differ in luminance as well as hue so they
 * survive greyscale and deuteranopia as light-vs-dark.
 *
 * Deliberately separate from `ok`/`danger`, which mean a good or bad OUTCOME
 * and will sometimes have to be drawn on an "Oni" surface.
 */
export const team = {
  us: '#3f9c58',
  usDim: 'rgba(63,156,88,0.22)',
  usEdge: 'rgba(63,156,88,0.75)',
  usInk: '#a8e2b8',
  them: '#c4453a',
  themDim: 'rgba(196,69,58,0.22)',
  themEdge: 'rgba(196,69,58,0.75)',
  themInk: '#f0a79f',
} as const;

/**
 * Signals that are not about outcome or side: cream, not more gold, so the
 * one thing gold still means on the table stays legible.
 */
export const signal = {
  /** "Your turn" — the beacon under the hand and the pulse that announces it. */
  turn: '#fff1c9',
  /** The turn clock, from plenty of time to none. */
  clockFull: garb.gold,
  clockMid: garb.flame,
  clockLow: '#e8513f',
} as const;

/**
 * Surfaces are alpha overlays on whatever room the table is in, so a walnut
 * or midnight cosmetic recolours every panel without a second palette.
 */
export const surface = {
  /** A panel on the page. */
  panel: 'rgba(0,0,0,0.22)',
  /** Something set INTO a surface: a track, a well, the plaque's plate. */
  sunk: 'rgba(0,0,0,0.28)',
  /** A shallower well: the place an absent card will go. */
  well: 'rgba(0,0,0,0.16)',
  /** A chip or a plain button. */
  chip: 'rgba(255,255,255,0.07)',
  /** A surface lifted a hair off its parent. */
  raised: 'rgba(255,255,255,0.05)',
  /** Over the table while a sheet or a reveal has the attention. */
  scrim: 'rgba(0,0,0,0.55)',
} as const;

/**
 * Depth without shadows: a lit hairline on top, a shaded one underneath.
 * Shadow props render inconsistently across Android, iOS and the web; two
 * hairlines look the same everywhere and cost nothing.
 */
export const stroke = {
  hair: 'rgba(255,255,255,0.14)',
  edge: 'rgba(255,255,255,0.24)',
  lit: 'rgba(255,255,255,0.38)',
  shade: 'rgba(0,0,0,0.45)',
} as const;

/** Text on the dark ground. `lo` only from 13 px up. */
export const ink = {
  hi: '#f2efe6',
  mid: 'rgba(242,239,230,0.72)',
  lo: 'rgba(242,239,230,0.52)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/**
 * The one display face: Rubik (SIL OFL 1.1), as four static weights in
 * assets/fonts, registered under these names by App's useFonts. Static
 * weights and never `fontWeight`: a synthetic bold on Android and a
 * double-emboldened face on the web were the alternative. On the web the
 * name carries a fallback stack, so text paints in the system's face before
 * the file arrives and never in the browser's serif default.
 */
const WEB = typeof document !== 'undefined';
const face = (name: string) => (WEB ? `${name}, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` : name);
export const font = {
  regular: face('Rubik-400'),
  medium: face('Rubik-500'),
  bold: face('Rubik-700'),
  black: face('Rubik-900'),
} as const;

/**
 * The type scale. Nothing below `caption`; the deck's own art is the only
 * place smaller text exists, and it is drawn, not set.
 */
export const type = {
  display: { fontSize: 34, lineHeight: 40, fontFamily: font.black },
  h1: { fontSize: 24, lineHeight: 30, fontFamily: font.bold },
  h2: { fontSize: 20, lineHeight: 26, fontFamily: font.bold },
  h3: { fontSize: 17, lineHeight: 22, fontFamily: font.bold },
  body: { fontSize: 15, lineHeight: 20, fontFamily: font.regular },
  sub: { fontSize: 13, lineHeight: 18, fontFamily: font.regular },
  caption: { fontSize: 11, lineHeight: 14, fontFamily: font.regular },
  /** The landscape rails: a step under `sub`, still readable at arm's length. */
  rail: { fontSize: 12, lineHeight: 16, fontFamily: font.regular },
} as const;

/** Every score, count and price: digits that do not jitter as they change. */
export const num: Pick<TextStyle, 'fontVariant'> = { fontVariant: ['tabular-nums'] };

export const radius = { xs: 4, sm: 8, md: 14, lg: 20, pill: 999, card: 8, panel: 14 } as const;

/** UI transitions — a press, a chip, a panel. NOT the director's beats (anim/director.ts). */
export const motion = { fast: 120, base: 220, slow: 360 } as const;

/**
 * The springs (1.6.0), mass 1: the whole app's motion vocabulary, so nothing
 * springs in a voice of its own. `lift` is the only one that overshoots (~10%):
 * a card picked up, a badge landing. feel.test.ts requires every withSpring to
 * use one of these.
 */
export const spring = {
  /** A card in flight, a deal. */
  flight: { stiffness: 380, damping: 31.2 },
  /** Lift and select: the one with overshoot. */
  lift: { stiffness: 800, damping: 33.9 },
  /** Sheets and panels sliding in. */
  sheet: { stiffness: 700, damping: 47.6 },
  /** Fades: as good as immediate, never bouncing. */
  opacity: { stiffness: 1600, damping: 80 },
} as const;

/**
 * Depth (1.6.0): React Native's boxShadow (0.76+, the new architecture), which
 * the old "no shadows" reason no longer stands against. One warm key light from
 * above centre: the shadow falls straight down, soft, never coloured.
 */
export const depth = {
  panel: '0 6px 18px rgba(0,0,0,0.32)',
  sheet: '0 10px 28px rgba(0,0,0,0.45)',
  chip: '0 2px 6px rgba(0,0,0,0.28)',
} as const;
