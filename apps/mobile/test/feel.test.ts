import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
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
import { FLIGHT_MAX_MS, FLIGHT_MIN_MS } from '../src/anim/lifetimes';
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
// The app's own resolution of its dependencies, wherever the install hoisted them.
const require = createRequire(join(here, '../package.json'));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('motion tokens', () => {
  it('are the four springs of the plan, each with its mass written out', () => {
    expect(spring.flight).toEqual({ stiffness: 380, damping: 31.2, mass: 1 });
    expect(spring.lift).toEqual({ stiffness: 800, damping: 33.9, mass: 1 });
    expect(spring.sheet).toEqual({ stiffness: 700, damping: 47.6, mass: 1 });
    expect(spring.opacity).toEqual({ stiffness: 1600, damping: 80, mass: 1 });
  });

  it('damp as designed at the mass withSpring really runs them at, and lift alone overshoots', () => {
    // A token without a mass is not run at 1: withSpring spreads a default
    // config under the caller's (GentleSpringConfig, mass 4, in Reanimated
    // 4.5.1). Read that mass from the installed library, not from memory.
    const dir = join(dirname(require.resolve('react-native-reanimated/package.json')), 'src/animation/spring');
    const base = /const defaultConfig[^=]*=\s*\{\s*\.\.\.(\w+),/.exec(readFileSync(join(dir, 'spring.ts'), 'utf8'))?.[1];
    const configs = readFileSync(join(dir, 'springConfigs.ts'), 'utf8');
    const libMass = Number(new RegExp(`const ${base} = \\{[^}]*mass:\\s*([\\d.]+)`).exec(configs)?.[1]);
    expect(libMass, `withSpring's default mass (from ${base})`).toBeGreaterThan(0);
    // Damping ratio = damping / (2 sqrt(k m)): under 1 overshoots.
    const zeta = (s: { stiffness: number; damping: number; mass?: number }) =>
      s.damping / (2 * Math.sqrt(s.stiffness * (s.mass ?? libMass)));
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

  it('leave every notification and selection tick as designed under soft: they have no lighter notch', () => {
    // "Blaža" softens impacts only (see HapticStrength): every other step
    // plays the very call it plays at full strength, on Android and elsewhere.
    const names = Object.keys(PATTERNS) as (keyof typeof PATTERNS)[];
    const play = (s: 'soft' | 'full') => {
      setHapticsStrength(s);
      vi.useFakeTimers();
      const out = names.map((name) => {
        vi.clearAllMocks();
        setAndroidHaptics(true);
        pattern(name);
        vi.advanceTimersByTime(400);
        const android = vi.mocked(Haptics.performAndroidHapticsAsync).mock.calls.map((c) => c[0]);
        setAndroidHaptics(false);
        pattern(name);
        vi.advanceTimersByTime(400);
        const own = [vi.mocked(Haptics.notificationAsync).mock.calls, vi.mocked(Haptics.selectionAsync).mock.calls.length];
        return { android, own };
      });
      vi.useRealTimers();
      return out;
    };
    const full = play('full');
    const soft = play('soft');
    let asDesigned = 0;
    names.forEach((name, n) => {
      PATTERNS[name].forEach((step, i) => {
        if (step.kind === 'impact') return;
        asDesigned++;
        expect(soft[n]!.android[i], `${name}, step ${i}`).toBe(full[n]!.android[i]);
      });
      expect(soft[n]!.own, name).toEqual(full[n]!.own);
    });
    expect(asDesigned).toBeGreaterThan(10);
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

describe('a card in flight', () => {
  it('keeps the tilt it left the fan with, arcs a little, and settles as it lands', () => {
    const t = readFileSync(join(SRC, 'TableScreen.tsx'), 'utf8');
    // The tapped card's rect carries its angle in the fan...
    expect(t).toMatch(/anchors\.set\(anchorId\.card\(id\), \{[^}]*tilt: rotate \}\)/);
    // ...the spawner hands it to the flight...
    expect(readFileSync(join(SRC, 'table/fx.ts'), 'utf8')).toMatch(/tilt: tapped\?\.tilt/);
    expect(readFileSync(join(SRC, 'anim/FxBus.ts'), 'utf8')).toMatch(/tilt\?: number;/);
    // ...which straightens from that angle instead of a fixed -8, arcs by sin, and settles over the last 60 ms.
    const o = readFileSync(join(SRC, 'anim/EffectsOverlay.tsx'), 'utf8');
    expect(o).toMatch(/const tilt = fx\.tilt \?\? -8;/);
    expect(o).toMatch(/rotateZ: `\$\{\(1 - p\.value\) \* tilt\}deg`/);
    expect(o).toMatch(/Math\.sin\(p\.value \* Math\.PI\) \* arc/);
    expect(o).toMatch(/const arc = Math\.min\(40, dist \* 0\.08\);/);
    expect(o).toMatch(/const settleFrom = Math\.max\(0\.5, 1 - 60 \/ Math\.max\(1, fx\.duration\)\);/);
    expect(o).toMatch(/1 \+ 0\.04 \*/);
    // Reduce-motion keeps its fade in place: no arc, no tilt.
    expect(o).toMatch(/fx\.fade\s*\?\s*\{\s*\/\/ Reduce-motion/);
  });

  it('lands in the last 60 ms of its time (half, if shorter), not of its eased progress', () => {
    const o = readFileSync(join(SRC, 'anim/EffectsOverlay.tsx'), 'utf8');
    const flight = o.slice(o.indexOf('function Flight('), o.indexOf('function Deal('));
    // p is eased: the flight's own settle expressions are driven through that
    // easing over wall time, as the UI thread runs them.
    expect(flight).toMatch(/p\.value = withTiming\(1, \{ duration: fx\.duration, easing: Easing\.out\(Easing\.cubic\) \}\);/);
    const ease = (t: number) => 1 - (1 - t) ** 3;
    const consts = [...flight.matchAll(/const (settle\w*) = (.*);/g)].map((m) => `const ${m[1]} = ${m[2]};`);
    const bump = /\(1 \+ 0\.04 \* \((p\.value < \w+ \? .*)\)\),/.exec(flight)?.[1];
    expect(consts.length).toBeGreaterThan(0);
    expect(bump).toBeDefined();
    const bumpAt = new Function('fx', 'p', `${consts.join('\n')}\nreturn ${bump};`) as (
      fx: { duration: number },
      p: { value: number },
    ) => number;
    // Every flight the spawner makes: the band, at half pace, at every tempo.
    for (const band of [FLIGHT_MIN_MS, (FLIGHT_MIN_MS + FLIGHT_MAX_MS) / 2, FLIGHT_MAX_MS]) {
      for (const d of [1, 0.5].flatMap((pace) => Object.values(TEMPO_FACTOR).map((f) => band * pace * f))) {
        let peak = -1;
        let peakAt = 0;
        for (let t = 0; t <= d; t += 0.25) {
          const b = bumpAt({ duration: d }, { value: ease(t / d) });
          if (b > peak) [peak, peakAt] = [b, t];
        }
        expect(peak, `${d} ms`).toBeGreaterThan(0.99);
        expect(d - peakAt, `${d} ms`).toBeCloseTo(Math.min(60, d / 2), 0);
      }
    }
  });
});

describe('Pregled ruke', () => {
  it('is offered on the result sheet whenever the public history has tricks, and lists every play with its seat', () => {
    const t = readFileSync(join(SRC, 'TableScreen.tsx'), 'utf8');
    expect(t).toMatch(/const reviewable = settled && !!view\.history && view\.history\.tricks\.length > 0;/);
    expect(t).toMatch(/onReview=\{reviewable \? \(\) => setReviewing\(true\) : undefined\}/);
    expect((t.match(/onReview && <Button label=\{lang\.s\.ui\.reviewHand\}/g) ?? []).length).toBe(2);
    expect(t).toMatch(/\{reviewing && view\.history && \(\s*<HandReview/);
    // It closes with the sheet.
    expect(t).toMatch(/if \(!settled\) setReviewing\(false\);/);
    const r = readFileSync(join(SRC, 'table/HandReview.tsx'), 'utf8');
    expect(r).toMatch(/history\.tricks\.map\(/);
    expect(r).toMatch(/t\.plays\.map\(/);
    expect(r).toMatch(/highlight=\{p\.seat === t\.winner\}/);
    expect(r).toMatch(/accessibilityViewIsModal/);
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

describe('the tempo reaches the sprites', () => {
  it('the tempo reaches both spawners: offline and online tell makeFxSpawner the setting', () => {
    // The director stretches its beats by the tempo; a spawner that is not told keeps the normal
    // pace and the deal's backs land before the fan is drawn (an empty hand at Polako).
    for (const p of ['src/useGame.ts', 'src/net/useNetGame.ts']) {
      const src = readFileSync(join(here, '..', p), 'utf8');
      const call = src.slice(src.indexOf('makeFxSpawner({'), src.indexOf('}),', src.indexOf('makeFxSpawner({')));
      expect(call, p).toMatch(/tempo: \(\) => /);
    }
  });
});
