/**
 * The deck's shared palette.
 *
 * Real Tell-pattern courts are MULTICOLOURED — blue coats, red sleeves, gold
 * trim, mixed per character — with the suit carried by the pip alone. Tinting
 * whole figures by suit (what our first deck did) is precisely what made it
 * read as an app instead of a pack of cards, so scenes and courts draw from
 * this fixed garb palette and never from the suit colour.
 */
export const garb = {
  blue: '#2e5d8c',
  blueDark: '#1d3f63',
  red: '#c0202e',
  redDark: '#8a121d',
  green: '#2f7d3a',
  greenLight: '#7cae3e',
  greenDark: '#1d5325',
  gold: '#d9a41c',
  goldDark: '#a3760a',
  brown: '#7a4a21',
  brownDark: '#4d2c10',
  skin: '#f0d8b6',
  skinLine: '#b98f5f',
  steel: '#9aa5ad',
  steelDark: '#5f6b73',
  cream: '#f7f4ec',
  ink: '#2b2620',
  snow: '#e9eef2',
  flame: '#e2711d',
  flameBright: '#f2a71b',
  grape: '#5c4a77',
} as const;

/**
 * Traditional mađarice colours, by the shared role names. `fill` is the pip
 * and the suit's ink; `dark` its deeper tone.
 */
export const PIP_COLOUR = {
  // 1.6.0: every ink reads at 3:1 or better on the cream stock (legibility.test.ts).
  // The bells' gold was 2.06:1 - the worst of the four, and the one a player with
  // deuteranopia could barely tell from the leaves. The courts' garb keeps its gold.
  brown: { fill: '#3b2410', dark: '#2a1a0c' }, // žir
  green: { fill: '#1f8a5a', dark: '#1d5325' }, // list
  red: { fill: '#c0202e', dark: '#8a121d' }, // srce
  gold: { fill: '#a87a00', dark: '#8f6608' }, // bundeva
} as const;
