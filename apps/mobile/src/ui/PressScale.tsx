import { spring } from '../theme';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { playSfx, type Sfx } from '../audio';
import { pattern, type Pattern } from '../haptics';
import { useMotionHere } from '../anim/MotionHere';

/**
 * A pressable that feels pressed: it gives a little under the finger (scale
 * 0.97, opacity 0.88) and springs back on release, on the UI thread. Every
 * tappable thing in the app that is not a card sits on this, so a press
 * reads the same everywhere — and clicks and buzzes the same way, from one
 * place, instead of each call site remembering to.
 *
 * `sound` / `haptic` are null for a press whose own feedback follows at once
 * (claiming coins plays its own cascade).
 *
 * Under the app's reduced policy it still reads as pressed - it goes down and
 * comes back at once, with no spring and no overshoot. (Until 1.3.1 reanimated
 * flattened this by itself whenever the phone's switch was on; the app now
 * tells it not to, so the policy is read here.)
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressScale({
  children,
  style,
  sound = 'tap',
  haptic = 'tap',
  pressSound = null,
  scaleTo = 0.97,
  onPress,
  accessibilityState,
  accessibilityRole,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  sound?: Sfx | null;
  haptic?: Pattern | null;
  /** The down-click, for a button that should feel mechanical; the release still makes `sound`. */
  pressSound?: Sfx | null;
  /** How far it gives: 0.97 for a button, a touch less for a big tile. */
  scaleTo?: number;
}) {
  const s = useSharedValue(1);
  const o = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: o.value }));
  const still = useMotionHere() === 'reduced';
  // react-native-web drops accessibilityState but forwards aria-* verbatim,
  // so a chip that says "selected" on the phone said nothing in a browser.
  // A state needs something to be the state OF: a control that has one is a
  // button unless its caller says otherwise.
  const web = Platform.OS === 'web' && accessibilityState ? accessibilityState : null;
  const aria = web
    ? {
        ...(web.selected !== undefined ? { 'aria-pressed': web.selected } : null),
        // A radio (the lobby's clock) is checked, not pressed.
        ...(web.checked !== undefined ? { 'aria-checked': web.checked === true } : null),
        ...(web.expanded !== undefined ? { 'aria-expanded': web.expanded } : null),
        ...(web.disabled !== undefined ? { 'aria-disabled': web.disabled } : null),
      }
    : null;
  const role = accessibilityRole ?? (aria && Object.keys(aria).length > 0 ? ('button' as const) : undefined);

  return (
    <AnimatedPressable
      {...rest}
      {...aria}
      accessibilityState={accessibilityState}
      accessibilityRole={role}
      onPressIn={(e) => {
        if (still) {
          s.value = scaleTo;
          o.value = 0.88;
        } else {
          s.value = withTiming(scaleTo, { duration: 80 });
          o.value = withTiming(0.88, { duration: 80 });
        }
        if (pressSound) playSfx(pressSound);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (still) {
          s.value = 1;
          o.value = 1;
        } else {
          s.value = withSpring(1, spring.lift);
          o.value = withTiming(1, { duration: 120 });
        }
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        // A press that began before the control was disabled still ends here
        // (Pressability checks `disabled` only when the press starts): a
        // disabled control neither clicks nor acts.
        if (rest.disabled) return;
        if (sound) playSfx(sound);
        if (haptic) pattern(haptic);
        onPress?.(e);
      }}
      style={[style, anim]}
    >
      {children}
    </AnimatedPressable>
  );
}
