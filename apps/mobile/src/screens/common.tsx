import type { ReactNode } from 'react';
import { room } from '../cosmetics';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PressScale } from '../ui/PressScale';
import { Chevron } from '../ui/icons';
import { font, theme } from '../theme';

export { Panel } from '../ui/Panel';

/** The version shown in settings; keep in step with app.json. */
export const APP_VERSION = '1.6.0';

/**
 * The frame every secondary screen (shop, settings, profile) shares: a back
 * chevron, a title, and a scrolling body on the house background.
 */
export function ScreenShell({
  title,
  onBack,
  backLabel,
  children,
  overlay,
}: {
  title: string;
  onBack: () => void;
  /** The chevron is only a picture: a screen reader needs its word. */
  backLabel: string;
  children: ReactNode;
  /** Drawn over the whole screen, outside the scroll: a dialog. */
  overlay?: ReactNode;
}) {
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: room().page }]}>
      <View style={styles.header}>
        <PressScale onPress={onBack} hitSlop={12} accessibilityLabel={backLabel} style={styles.backButton}>
          <Chevron size={28} />
        </PressScale>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>{children}</ScrollView>
      {overlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.feltDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButton: { width: 44, alignItems: 'flex-start', justifyContent: 'center' },
  title: { flex: 1, color: theme.text, fontSize: 20, fontFamily: font.bold, textAlign: 'center' },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
});
