import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { depth, ink, radius, space, stroke, surface, theme, type } from '../theme';

/**
 * The app's one panel: a plate with a hairline edge and a soft shadow, optionally a small
 * label above its content. The home, the shop, the settings and the lobby all
 * sit on it, so a panel reads the same everywhere.
 */
export function Panel({
  label,
  tone = 'plain',
  style,
  children,
}: {
  label?: string;
  /** `accent`: the one panel on a screen that wants the finger — a bonus to claim. */
  tone?: 'plain' | 'accent';
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <View style={[styles.panel, tone === 'accent' && styles.accent, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: surface.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: stroke.hair,
    padding: space.lg - 2,
    gap: space.sm + 2,
    // Lit from above: the plate stands off the page (theme.depth).
    boxShadow: depth.panel,
  },
  accent: { borderColor: theme.accent },
  label: { color: ink.mid, ...type.sub },
});
