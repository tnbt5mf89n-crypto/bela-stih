import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { garb, PIP_COLOUR } from '../src/deck/palette';
import { contrast } from './contrast.test';

/**
 * Legibility (1.6.0): the suit inks read on the card stock, every card carries
 * a corner index that survives the fan, an illegal card is veiled and not
 * made see-through, every text style names its face, and the table's rows
 * with a fixed budget cap the system's font scaling where they would
 * otherwise overflow.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '../src');
const src = (p: string) => readFileSync(join(SRC, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('the suit inks on the card stock', () => {
  it('every ink reads at 3:1 or better on cream; the bells gold of 1.5.x did not', () => {
    for (const [role, c] of Object.entries(PIP_COLOUR)) {
      expect(contrast(c.fill, garb.cream, garb.cream), `${role} ${c.fill}`).toBeGreaterThanOrEqual(3);
      expect(contrast(c.dark, garb.cream, garb.cream), `${role} dark`).toBeGreaterThanOrEqual(3);
    }
    // What shipped until 1.5.1: #d9a41c on cream is 2.06:1.
    expect(contrast('#d9a41c', garb.cream, garb.cream)).toBeLessThan(3);
    // The courts' garb gold is not an ink and did not have to move.
    expect(garb.gold).toBe('#d9a41c');
  });
});

// A corner index (rank over a pip, top-left) would survive the fan where the
// printed pattern's centred numeral hides under the next card - but the player
// had corner letters taken OFF the mađarice deck in 1.2.2, so that is theirs
// to ask for, not a legibility fix to slip in. The French and simple decks
// keep the indices they always had.

describe('an illegal card', () => {
  it('is veiled, not made see-through: the card stays opaque under a grey-green wash', () => {
    const card = src('PlayingCard.tsx');
    expect(card).not.toMatch(/opacity: 0\.6/);
    expect(card).not.toMatch(/styles\.dimmed\]/);
    const tint = /dimmedTint: \{[^}]*backgroundColor: 'rgba\((\d+),(\d+),(\d+),([\d.]+)\)'/.exec(card);
    expect(tint, 'a dimmedTint style').not.toBeNull();
    expect(Number(tint![4])).toBeGreaterThanOrEqual(0.5);
  });
});

describe('type', () => {
  it('every text style names its face (Android would otherwise fall back to the system font)', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // A one-line StyleSheet entry with a size: `name: { color: ..., fontSize: 12 }`.
        if (/^\s*\w+: \{[^}]*fontSize:/.test(line) && !/fontFamily:/.test(line) && !/\.\.\.type\./.test(line)) {
          offenders.push(`${relative(SRC, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it("caps the system's font scaling on the table's fixed rows", () => {
    for (const f of ['TableScreen.tsx', 'table/SeatPuck.tsx', 'table/RevealRow.tsx', 'table/HoldPanel.tsx', 'table/EmoteStrip.tsx', 'table/MicButton.tsx', 'table/SpeakingLine.tsx']) {
      const s = src(f);
      const tags = [...s.matchAll(/<(?:Animated\.)?Text(?![A-Za-z])[^>]*?>/gs)];
      // 1.3 everywhere, except where a row already caps tighter on purpose (the emote rail's 1.2).
      const bare = tags.filter((m) => !/maxFontSizeMultiplier=\{/.test(m[0]));
      expect(bare.map((m) => m[0].slice(0, 60)), f).toEqual([]);
      expect(tags.length, `${f} has Text`).toBeGreaterThan(0);
    }
  });

  it("the partner mark is a shape, not a typed character", () => {
    const puck = src('table/SeatPuck.tsx');
    expect(puck).not.toContain('◆');
    expect(puck).toMatch(/<Diamond size=\{10\} colour=\{theme\.textDim\} \/>/);
  });
});
