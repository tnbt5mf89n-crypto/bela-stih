import type { ReactNode } from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import type { Sfx } from '../audio';
import { garb } from '../deck/palette';
import { font, radius, surface, theme } from '../theme';
import { PressScale } from './PressScale';

/**
 * The app's one button. Three tones — plain, strong (the call to action),
 * bela (the one gold button on the table) — a compact size for the landscape
 * rails, and the press feel, click and buzz of `PressScale` underneath —
 * plus a down-click on the way in, so a button feels mechanical.
 */
export function Button({
  label,
  onPress,
  tone = 'plain',
  compact = false,
  sound = 'tap',
  style,
  icon,
  accessibilityLabel,
  testID,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  /** What a screen reader says when the visible label is abbreviated (the rail's suit buttons). */
  accessibilityLabel?: string;
  /** For the device flows (apps/mobile/maestro). */
  testID?: string;
  tone?: 'plain' | 'strong' | 'bela';
  /** Landscape rail size: caption type, tighter padding, a label wraps at most once. */
  compact?: boolean;
  /**
   * The click. Every button makes it, and makes it itself, so no caller wraps
   * its handler in a second one. `null` for a press whose own sound follows
   * at once (claiming coins).
   */
  sound?: Sfx | null;
  style?: StyleProp<ViewStyle>;
  /** Drawn before the label: the suit pip on a trump-call button. */
  icon?: ReactNode;
  /** Shown but not pressable (dimmed): a send with nothing chosen yet. */
  disabled?: boolean;
}) {
  // Disabled, a button drops its tone and greys its label: the root cannot
  // be dimmed, as PressScale's animated opacity overrides its own.
  const toneStyle =
    disabled ? styles.plain : tone === 'strong' ? styles.strong : tone === 'bela' ? styles.bela : styles.plain;
  return (
    <PressScale
      onPress={onPress}
      sound={sound}
      pressSound={sound === null ? null : 'press'}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      style={[styles.btn, toneStyle, compact && styles.compact, icon !== undefined && styles.withIcon, style]}
    >
      {icon}
      <Text
        style={[styles.text, tone === 'bela' && !disabled && styles.textBela, compact && styles.textCompact, disabled && styles.disabled]}
        numberOfLines={compact ? 2 : undefined}
      >
        {label}
      </Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plain: { backgroundColor: surface.chip },
  strong: { backgroundColor: theme.wood, borderColor: theme.accent },
  bela: { backgroundColor: theme.accent, borderColor: theme.accent },
  compact: { paddingHorizontal: 8, paddingVertical: 7 },
  disabled: { opacity: 0.45 },
  withIcon: { flexDirection: 'row', gap: 6 },
  text: { color: theme.text, fontSize: 14, fontFamily: font.medium },
  // Cream on gold is 1.9:1; the deck's ink on gold is 6.7:1.
  textBela: { color: garb.ink },
  textCompact: { fontSize: 11, fontFamily: font.medium, textAlign: 'center' },
});
