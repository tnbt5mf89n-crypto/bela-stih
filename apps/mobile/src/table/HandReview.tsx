import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import type { DealHistory, Seat } from '@belot/shared-types';
import type { Lang } from '@belot/i18n';
import type { DeckStyle } from '../cosmetics';
import { PlayingCard } from '../PlayingCard';
import { Button } from '../ui/Button';
import { depth, font, ink, radius, space, surface, type } from '../theme';

/**
 * "Pregled ruke" (1.6.0): the deal just played, trick by trick, from the
 * table's public history (PublicView.history) - who led, what each seat
 * played, who took it. Nothing here that the table did not see face up. Opened
 * from the result sheet; a tap beside it, or its button, closes it.
 */
export function HandReview({
  lang,
  history,
  mySeat,
  nameOf,
  deckStyle,
  ground,
  reduced,
  onClose,
}: {
  lang: Lang;
  history: DealHistory;
  mySeat: Seat;
  nameOf: (s: Seat) => string;
  deckStyle: DeckStyle;
  /** The room's page colour, so the panel reads as part of the table. */
  ground: string;
  reduced: boolean;
  onClose: () => void;
}) {
  const ui = lang.s.ui;
  return (
    <Animated.View entering={reduced ? undefined : FadeIn.duration(140)} style={styles.backdrop} accessibilityViewIsModal>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={ui.close} />
      <Animated.View entering={reduced ? undefined : ZoomIn.duration(160)} style={[styles.panel, { backgroundColor: ground }]}>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          {ui.reviewHand}
        </Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {history.tricks.map((t, i) => (
            <View key={i} style={styles.trick} accessible accessibilityLabel={`${ui.reviewTrick(i + 1)}: ${t.plays.map((p) => `${nameOf(p.seat)} ${lang.cardName(p.card)}`).join(', ')}. ${ui.reviewTook(nameOf(t.winner))}`}>
              <Text style={styles.trickLabel} maxFontSizeMultiplier={1.3}>
                {ui.reviewTrick(i + 1)}
              </Text>
              <View style={styles.plays}>
                {t.plays.map((p) => (
                  <View key={`${p.seat}`} style={styles.play}>
                    <PlayingCard card={p.card} size="sm" deckStyle={deckStyle} locale={lang.id} highlight={p.seat === t.winner} />
                    <Text
                      style={[styles.seatName, p.seat === mySeat && styles.mine, p.seat === t.winner && styles.winnerName]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.3}
                    >
                      {nameOf(p.seat)}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.took} maxFontSizeMultiplier={1.3}>
                {ui.reviewTook(nameOf(t.winner))}
              </Text>
            </View>
          ))}
        </ScrollView>
        <Button label={ui.close} tone="strong" onPress={onClose} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: surface.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '92%',
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    boxShadow: depth.sheet,
  },
  title: { color: ink.hi, ...type.h3 },
  list: { flexShrink: 1 },
  listContent: { gap: space.md, paddingBottom: space.xs },
  trick: { gap: space.xs },
  trickLabel: { color: ink.mid, ...type.caption },
  plays: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  play: { alignItems: 'center', gap: 2, width: 60 },
  seatName: { color: ink.lo, fontSize: 11, lineHeight: 14, fontFamily: font.regular, textAlign: 'center' },
  mine: { color: ink.mid },
  winnerName: { color: ink.hi, fontFamily: font.bold },
  took: { color: ink.mid, fontSize: 12, lineHeight: 16, fontFamily: font.regular },
});
