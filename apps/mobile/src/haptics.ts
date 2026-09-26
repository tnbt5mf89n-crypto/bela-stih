import * as Haptics from 'expo-haptics';

/**
 * Haptics, as a vocabulary.
 *
 * One table of named patterns instead of impacts sprinkled through the code:
 * a pass is not the same touch as a trick, a deal made is the phone's own
 * "success", a clock at two seconds escalates from the one at five. Every
 * pattern is at most 300 ms and a handful of steps, and every one goes
 * through the single `enabled` gate that Settings sets — the games no longer
 * carry a `haptics` flag of their own.
 *
 * Never throws and never awaits: a missing haptic engine must not break play.
 */

let enabled = true;
// Android has named haptic constants of its own (a confirm, a reject, a
// clock tick) that read better than an impact pattern where one fits. The
// app says which platform it is on; this module stays free of react-native
// so the tests can load it in node.
let android = false;
/**
 * Settings' "Jačina vibracije": `soft` plays every impact one notch lighter
 * (Soft is the floor). Notifications and selection ticks play as designed:
 * iOS's generators for them take no intensity, and the web's patterns are
 * fixed. On Android a notification's constant (CONFIRM, REJECT, CLOCK_TICK)
 * has no lighter one that says the same thing, and the tick's lighter
 * SEGMENT_FREQUENT_TICK may not vibrate at all on a phone that cannot go
 * that soft.
 */
export type HapticStrength = 'soft' | 'full';
let strength: HapticStrength = 'full';

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function setAndroidHaptics(on: boolean): void {
  android = on;
}

export function setHapticsStrength(s: HapticStrength): void {
  strength = s;
}

/**
 * The Android constant's wire value, exactly as expo-haptics' `AndroidHaptics`
 * enum spells it (hyphens). Typed as a string so the table loads without the
 * native module; haptics.test.ts checks every value against the installed
 * enum. `confirm` / `reject` exist from API 30, so a rejected call falls back
 * to the pattern's own impact or notification.
 */
type AndroidName = 'confirm' | 'reject' | 'long-press' | 'clock-tick';

type Step =
  | { at: number; kind: 'impact'; style: Haptics.ImpactFeedbackStyle; android?: AndroidName }
  | { at: number; kind: 'notify'; type: Haptics.NotificationFeedbackType; android?: AndroidName }
  | { at: number; kind: 'select'; android?: AndroidName };

const I = Haptics.ImpactFeedbackStyle;
const N = Haptics.NotificationFeedbackType;
const impact = (at: number, style: Haptics.ImpactFeedbackStyle, android?: AndroidName): Step => ({
  at,
  kind: 'impact',
  style,
  android,
});
const notify = (at: number, type: Haptics.NotificationFeedbackType, android?: AndroidName): Step => ({
  at,
  kind: 'notify',
  type,
  android,
});
const select = (at: number): Step => ({ at, kind: 'select' });

export const PATTERNS = {
  // the interface
  tap: [select(0)],
  toggle: [impact(0, I.Light)],
  press: [select(0)],
  longPress: [impact(0, I.Medium, 'long-press')],
  swap: [impact(0, I.Light)],
  purchase: [notify(0, N.Success, 'confirm')],
  claim: [impact(0, I.Light), impact(120, I.Light)],
  error: [notify(0, N.Error, 'reject')],
  // the cards: mine only. An opponent's card used to buzz as it landed, some
  // 24 times a deal - more touch than information (1.6.0).
  arm: [impact(0, I.Soft)],
  play: [impact(0, I.Light)],
  // the cues
  turn: [select(0), impact(90, I.Light)],
  call: [impact(0, I.Medium), impact(90, I.Medium)],
  clock5: [notify(0, N.Warning, 'clock-tick')],
  clock2: [impact(0, I.Heavy), impact(120, I.Heavy)],
  // the bidding
  trumpMine: [impact(0, I.Rigid)],
  kontraUs: [impact(0, I.Heavy)],
  kontraThem: [notify(0, N.Warning)],
  belaMine: [impact(0, I.Light), impact(80, I.Light), impact(160, I.Medium)],
  // the tricks
  trickMine: [impact(0, I.Medium)],
  lastTrickMine: [impact(0, I.Medium), impact(150, I.Light)],
  // the reckoning
  dealMade: [notify(0, N.Success, 'confirm')],
  dealFailed: [notify(0, N.Error, 'reject')],
  stigljaUs: [notify(0, N.Success), impact(150, I.Heavy)],
  stigljaThem: [notify(0, N.Warning)],
  matchWon: [notify(0, N.Success), impact(150, I.Heavy), impact(300, I.Heavy)],
  matchLost: [notify(0, N.Error)],
  levelUp: [impact(0, I.Light), impact(100, I.Medium), impact(200, I.Heavy)],
  coinLand: [impact(0, I.Soft)],
  // a table gift landing on your puck: a light touch and a softer echo
  giftLand: [impact(0, I.Light), impact(110, I.Soft)],
  // the room
  seatJoin: [impact(0, I.Light)],
  disconnect: [notify(0, N.Warning)],
} as const satisfies Record<string, readonly Step[]>;

export type Pattern = keyof typeof PATTERNS;

/** One notch lighter, for the soft setting: impacts only (see HapticStrength). */
const SOFTER: Record<Haptics.ImpactFeedbackStyle, Haptics.ImpactFeedbackStyle> = {
  [I.Heavy]: I.Medium,
  [I.Rigid]: I.Medium,
  [I.Medium]: I.Light,
  [I.Light]: I.Soft,
  [I.Soft]: I.Soft,
};

function soften(step: Step): Step {
  if (strength === 'full' || step.kind !== 'impact') return step;
  return { ...step, style: SOFTER[step.style] ?? step.style, android: undefined };
}

/**
 * Android plays every step through the system's haptic feedback constants
 * (performHapticFeedback) and never through expo-haptics' impact and
 * notification calls: those build a VibrationEffect.createWaveform, which on
 * a motor without primitives (this app's test phone among them) is a flat buzz
 * that ignores the style. The constants are what the OS itself uses for a
 * key, a click, a confirmation - tuned per phone by its maker.
 */
const ANDROID_IMPACT: Record<Haptics.ImpactFeedbackStyle, AndroidName | 'virtual-key' | 'keyboard-tap' | 'context-click' | 'text-handle-move'> = {
  [I.Soft]: 'text-handle-move',
  [I.Light]: 'virtual-key',
  [I.Medium]: 'context-click',
  [I.Heavy]: 'long-press',
  [I.Rigid]: 'keyboard-tap',
};
const ANDROID_NOTIFY: Record<Haptics.NotificationFeedbackType, AndroidName> = {
  [N.Success]: 'confirm',
  [N.Warning]: 'clock-tick',
  [N.Error]: 'reject',
};

/** The Android constant for a step: its own, or the one its kind maps to. */
export function androidConstantFor(step: Step): string {
  if (step.android) return step.android;
  if (step.kind === 'impact') return ANDROID_IMPACT[step.style];
  if (step.kind === 'notify') return ANDROID_NOTIFY[step.type];
  return 'segment-tick';
}

/** The pattern's own step - iOS and the web. */
function fireOwn(step: Step): void {
  const p =
    step.kind === 'impact'
      ? Haptics.impactAsync(step.style)
      : step.kind === 'notify'
        ? Haptics.notificationAsync(step.type)
        : Haptics.selectionAsync();
  void p.catch(() => {});
}

function fire(raw: Step): void {
  // Read again here, not only when the pattern started: a later step of a
  // pattern must not land after the setting was switched off.
  if (!enabled) return;
  const step = soften(raw);
  if (android) {
    // A constant the device's API level lacks rejects: then the one every
    // Android since API 5 has. Never the waveform.
    const c = androidConstantFor(step) as Haptics.AndroidHaptics;
    Haptics.performAndroidHapticsAsync(c).catch(() => {
      if (c !== 'virtual-key') Haptics.performAndroidHapticsAsync('virtual-key' as Haptics.AndroidHaptics).catch(() => {});
    });
    return;
  }
  fireOwn(step);
}

/** Play a named pattern; later steps are scheduled on plain timers. */
export function pattern(name: Pattern): void {
  if (!enabled) return;
  for (const step of PATTERNS[name]) {
    if (step.at === 0) fire(step);
    else setTimeout(() => fire(step), step.at);
  }
}

// --- the old verbs, kept for the few call sites that read better with them ---

export type Buzz = 'light' | 'medium' | 'heavy' | 'select';

const STYLE: Record<Exclude<Buzz, 'select'>, Haptics.ImpactFeedbackStyle> = {
  light: I.Light,
  medium: I.Medium,
  heavy: I.Heavy,
};

export function buzz(kind: Buzz): void {
  if (!enabled) return;
  fire(kind === 'select' ? select(0) : impact(0, STYLE[kind]));
}
