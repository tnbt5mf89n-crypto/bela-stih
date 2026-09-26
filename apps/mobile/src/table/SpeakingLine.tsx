import { StyleSheet, Text, View } from 'react-native';
import Animated, { type CSSAnimationProperties } from 'react-native-reanimated';
import { font, theme } from '../theme';

/**
 * Who is speaking, where the table's pucks are hidden (the results sheet):
 * the name, and the pucks' waves rolling out of a dot beside it - the same
 * green, the same beat. Reduced motion: one ring, held.
 */
export function SpeakingLine({ words, reduced }: { words: string; reduced: boolean }) {
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <View style={styles.dotBox} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {(reduced ? [0] : [0, WAVE_GAP_MS]).map((delay) => (
          <Animated.View
            key={delay}
            pointerEvents="none"
            style={[styles.wave, reduced ? styles.waveStill : { ...wave, animationDelay: delay }]}
          />
        ))}
        <View style={styles.dot} />
      </View>
      <Text style={styles.words} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {words}
      </Text>
    </View>
  );
}

/** SeatPuck's voice waves, smaller. */
const WAVE_MS = 900;
const WAVE_GAP_MS = WAVE_MS / 2;
const wave: CSSAnimationProperties = {
  animationName: {
    from: { opacity: 1, transform: [{ scale: 1 }] },
    to: { opacity: 0, transform: [{ scale: 2.2 }] },
  },
  animationDuration: WAVE_MS,
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-out',
};

const DOT = 10;
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  dotBox: { width: DOT * 2, height: DOT * 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.okInk },
  wave: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: theme.okInk,
  },
  waveStill: { opacity: 0.9, transform: [{ scale: 1.8 }] },
  words: { color: theme.text, fontFamily: font.bold, fontSize: 14, flexShrink: 1 },
});
