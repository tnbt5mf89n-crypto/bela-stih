import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  impactAsync: vi.fn(() => Promise.resolve()),
  notificationAsync: vi.fn(() => Promise.resolve()),
  selectionAsync: vi.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: vi.fn(() => Promise.resolve()),
}));

import * as Haptics from 'expo-haptics';
import { androidConstantFor, PATTERNS, pattern, setAndroidHaptics, setHapticsEnabled, setHapticsStrength } from '../src/haptics';
import { DEFAULT_TIMINGS, REDUCED_TIMINGS, REVEAL_MS, TEMPO_FACTOR, timingsFor } from '../src/anim/director';
import { BIG_CARDS_FACTOR, computeTableMetrics } from '../src/table/metrics';
import { fitHand } from '../src/table/geometry';
import { depth, spring } from '../src/theme';

/**
 * The feel (1.6.0): every spring speaks one vocabulary, panels stand off the
 * page, the haptics on Android never build a waveform and can be softened, a
 * tempo stretches the director's beats together, and "Velike karte" grows the
 * fan where the width allows.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('motion tokens', () => {
  it('are the four springs of the plan, mass 1, and lift alone overshoots', () => {
    expect(spring.flight).toEqual({ stiffness: 380, damping: 31.2 });
    expect(spring.lift).toEqual({ stiffness: 800, damping: 33.9 });
    expect(spring.sheet).toEqual({ stiffness: 700, damping: 47.6 });
    expect(spring.opacity).toEqual({ stiffness: 1600, damping: 80 });
    // Damping ratio = damping / (2 sqrt(k m)): under 1 overshoots.
    const zeta = (s: { stiffness: number; damping: number }) => s.damping / (2 * Math.sqrt(s.stiffness));
    expect(zeta(spring.lift)).toBeLessThan(1);
    expect(zeta(spring.lift)).toBeGreaterThan(0.5);
    for (const k of ['flight', 'sheet', 'opacity'] as const) expect(zeta(spring[k]), k).toBeGreaterThanOrEqual(0.8);
  });

  it('every withSpring in the app uses one of them', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const s = readFileSync(file, 'utf8');
      for (const m of s.matchAll(/withSpring\([^,]+,\s*([^)]+)\)/g)) {
        if (!/^spring\.\w+$/.test(m[1]!.trim())) offenders.push(`${relative(SRC, file)}: ${m[0].slice(0, 70)}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('panels and sheets carry a shadow token', () => {
    expect(depth.panel).toMatch(/^0 \d+px \d+px rgba\(0,0,0,0\.\d+\)$/);
    expect(readFileSync(join(SRC, 'ui/Panel.tsx'), 'utf8')).toMatch(/boxShadow: depth\.panel/);
    expect(readFileSync(join(SRC, 'ui/ConfirmDialog.tsx'), 'utf8')).toMatch(/boxShadow: depth\.sheet/);
    expect(readFileSync(join(SRC, 'table/GiftPicker.tsx'), 'utf8')).toMatch(/boxShadow: depth\.sheet/);
  });
});

describe('haptics on Android', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHapticsEnabled(true);
    setHapticsStrength('full');
  });

  it('play every step of every pattern through a system constant, never a waveform', () => {
    setAndroidHaptics(true);
    vi.useFakeTimers();
    for (const name of Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]) {
      pattern(name);
      vi.advanceTimersByTime(400);
    }
    vi.useRealTimers();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    const total = Object.values(PATTERNS).reduce((n, steps) => n + steps.length, 0);
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledTimes(total);
    setAndroidHaptics(false);
  });

  it('name only constants the installed expo-haptics has', () => {
    const dts = readFileSync(join(here, '../../../node_modules/expo-haptics/build/Haptics.types.d.ts'), 'utf8');
    const body = dts.slice(dts.indexOf('enum AndroidHaptics'));
    const values = new Set([...body.matchAll(/=\s*"([a-z-]+)"/g)].map((m) => m[1]!));
    for (const [name, steps] of Object.entries(PATTERNS)) {
      for (const step of steps) expect(values.has(androidConstantFor(step)), `${name}: ${androidConstantFor(step)}`).toBe(true);
    }
    expect(values.has('virtual-key')).toBe(true);
  });

  it('fall back to the oldest constant when one is rejected, still never a waveform', async () => {
    setAndroidHaptics(true);
    vi.mocked(Haptics.performAndroidHapticsAsync).mockImplementationOnce(() => Promise.reject(new Error('unsupported')));
    pattern('trumpMine');
    await Promise.resolve();
    await Promise.resolve();
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenLastCalledWith('virtual-key');
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    setAndroidHaptics(false);
  });

  it('soften one notch when Settings says so, on both platforms', () => {
    setAndroidHaptics(false);
    setHapticsStrength('soft');
    pattern('trickMine'); // medium -> light
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    pattern('clock2'); // heavy -> medium
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
    setAndroidHaptics(true);
    vi.mocked(Haptics.performAndroidHapticsAsync).mockClear();
    pattern('trumpMine'); // rigid -> medium -> context-click
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith('context-click');
    setAndroidHaptics(false);
    setHapticsStrength('full');
  });

  it("an opponent's card no longer buzzes, and the deal stays under twenty touches", () => {
    const feedback = readFileSync(join(SRC, 'feedback.ts'), 'utf8');
    expect(feedback).not.toMatch(/pattern\('land'\)/);
    expect(PATTERNS).not.toHaveProperty('land');
    // A worst-case deal for MY seat: 8 cards played (8), up to 8 tricks won (8), a call, a bela,
    // the deal made, and a clock warning - each at most a few steps, and never the 24 landings.
    const deal = ['play', 'play', 'play', 'play', 'play', 'play', 'play', 'play', 'trickMine', 'trickMine', 'trickMine', 'lastTrickMine', 'trumpMine', 'belaMine', 'dealMade', 'clock5'] as const;
    const events = deal.reduce((n, p) => n + PATTERNS[p].length, 0);
    expect(events).toBeLessThanOrEqual(20);
  });
});

describe('the tempo', () => {
  it('stretches or tightens every beat together, and never the reveal', () => {
    expect(TEMPO_FACTOR).toEqual({ slow: 1.3, normal: 1, fast: 0.75 });
    expect(timingsFor('full')).toBe(DEFAULT_TIMINGS);
    expect(timingsFor('full', 'normal')).toBe(DEFAULT_TIMINGS);
    const slow = timingsFor('full', 'slow');
    const fast = timingsFor('full', 'fast');
    for (const k of Object.keys(DEFAULT_TIMINGS) as (keyof typeof DEFAULT_TIMINGS)[]) {
      if (k === 'declarationsRevealed') {
        expect(slow[k]).toEqual(DEFAULT_TIMINGS[k]);
        expect(fast[k].dur).toBe(REVEAL_MS);
        continue;
      }
      expect(slow[k].dur).toBe(Math.round(DEFAULT_TIMINGS[k].dur * 1.3));
      expect(fast[k].gap).toBe(Math.round(DEFAULT_TIMINGS[k].gap * 0.75));
    }
    expect(timingsFor('reduced', 'fast').cardPlayed.dur).toBe(Math.round(REDUCED_TIMINGS.cardPlayed.dur * 0.75));
  });
});

describe('Velike karte', () => {
  it('grows the hand about 15% where the width allows, and the phone still fits its column', () => {
    expect(BIG_CARDS_FACTOR).toBe(1.15);
    const normal = computeTableMetrics(360, 800);
    const big = computeTableMetrics(360, 800, { bigCards: true });
    expect(big.handCardMax).toBe(Math.round(normal.handCardMax * BIG_CARDS_FACTOR));
    const fitN = fitHand(normal.handWidth, 8, normal.handCardMax);
    const fitB = fitHand(big.handWidth, 8, big.handCardMax, big.handReveal);
    expect(big.handReveal).toBeLessThan(normal.handReveal);
    expect(fitB.cardW).toBeGreaterThan(fitN.cardW);
    expect(big.shortColumn).toBe(normal.shortColumn);
    // Landscape: the cap grows with the factor as well.
    const land = computeTableMetrics(800, 360, { bigCards: true });
    expect(land.handCardMax).toBeLessThanOrEqual(Math.round(76 * BIG_CARDS_FACTOR));
    expect(land.handCardMax).toBeGreaterThanOrEqual(computeTableMetrics(800, 360).handCardMax);
  });
});
