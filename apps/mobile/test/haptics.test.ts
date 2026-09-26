import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  impactAsync: vi.fn(() => Promise.resolve()),
  notificationAsync: vi.fn(() => Promise.resolve()),
  selectionAsync: vi.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: vi.fn(() => Promise.resolve()),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Haptics from 'expo-haptics';
import { PATTERNS, pattern, setAndroidHaptics, setHapticsEnabled } from '../src/haptics';

/** The vocabulary: short, few steps, and behind one gate. */
describe('the haptic patterns', () => {
  beforeEach(() => vi.clearAllMocks());

  it('are all at most 300 ms and a handful of steps, starting now', () => {
    for (const [name, steps] of Object.entries(PATTERNS)) {
      expect(steps.length, name).toBeGreaterThan(0);
      expect(steps.length, name).toBeLessThanOrEqual(4);
      expect(steps[0]!.at, name).toBe(0);
      for (const s of steps) expect(s.at, name).toBeLessThanOrEqual(300);
    }
  });

  it('escalate from the five-second clock to the two-second one', () => {
    expect(PATTERNS.clock2.length).toBeGreaterThan(PATTERNS.clock5.length);
  });

  it('name Android constants exactly as the installed expo-haptics spells them', () => {
    // 'long_press' where the enum says 'long-press' is rejected by the native
    // enum converter, swallowed, and silent — on every Android phone.
    const dts = readFileSync(join(__dirname, '../../../node_modules/expo-haptics/build/Haptics.types.d.ts'), 'utf8');
    const enumBody = dts.slice(dts.indexOf('enum AndroidHaptics'));
    const values = new Set([...enumBody.matchAll(/=\s*"([a-z-]+)"/g)].map((m) => m[1]!));
    expect(values.size).toBeGreaterThan(10);
    for (const [name, steps] of Object.entries(PATTERNS)) {
      for (const step of steps) {
        if (step.android) expect(values.has(step.android), `${name}: ${step.android}`).toBe(true);
      }
    }
  });

  it('fall back to the oldest constant when the Android constant is rejected (API < 30), never to a waveform', async () => {
    setHapticsEnabled(true);
    setAndroidHaptics(true);
    vi.mocked(Haptics.performAndroidHapticsAsync).mockImplementationOnce(() => Promise.reject(new Error('unsupported')));
    pattern('dealFailed');
    await Promise.resolve();
    await Promise.resolve();
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenLastCalledWith('virtual-key');
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    setAndroidHaptics(false);
  });

  it('stop a pattern already under way when haptics are switched off', () => {
    vi.useFakeTimers();
    setHapticsEnabled(true);
    pattern('matchWon');
    setHapticsEnabled(false);
    vi.advanceTimersByTime(400);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    vi.useRealTimers();
    setHapticsEnabled(true);
  });

  it('use the named Android constant where one fits, and the iOS pattern elsewhere', () => {
    setHapticsEnabled(true);
    setAndroidHaptics(true);
    pattern('dealMade');
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith('confirm');
    pattern('trumpMine'); // a rigid tap is the keyboard's tap on Android (1.6.0: never a waveform)
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith('keyboard-tap');
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    setAndroidHaptics(false);
    vi.mocked(Haptics.performAndroidHapticsAsync).mockClear();
    pattern('dealMade');
    expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('are silent when Settings says so', () => {
    setHapticsEnabled(false);
    pattern('matchWon');
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    setHapticsEnabled(true);
    pattern('dealMade');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });
});
