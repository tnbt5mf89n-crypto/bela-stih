import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Card } from '@belot/engine';
import type { DeckStyle } from './cosmetics';
import { CardBackFace, CardFace } from './deck';
import { garb } from './deck/palette';
import { font, radius, theme } from './theme';

/**
 * A card in the layout. The artwork itself lives in `./deck`; this only handles
 * sizing and the two states the table needs — playable, or not playable now.
 *
 * Memoised on its props, and the deck style is one of them: the parent reads
 * `cosmetics()` at its own render and passes it down, so a change in Settings
 * reaches a memoised card as a changed prop rather than being swallowed.
 */

const WIDTHS = { sm: 30, md: 46, lg: 58 } as const;
export type CardSize = keyof typeof WIDTHS;

export const PlayingCard = memo(
  function PlayingCard({
    card,
    size = 'md',
    width,
    deckStyle,
    locale,
    dimmed = false,
    highlight = false,
    selected = false,
    armed = false,
    caption,
  }: {
    card: Card;
    size?: CardSize;
    /** Exact width, for the hand — it sizes itself to the screen. Wins over `size`. */
    width?: number;
    deckStyle: DeckStyle;
    /** Re-renders the memoised face when the language changes. */
    locale?: string;
    dimmed?: boolean;
    highlight?: boolean;
    /** Picked for a zvanja or an arrange swap: the green ring. */
    selected?: boolean;
    /**
     * Armed to play by a first tap, waiting for the confirming second one.
     * Unmistakable at arm's length: a touch bigger, a gold ring with a dark
     * outline, and a caption saying what the next tap does.
     */
    armed?: boolean;
    caption?: string;
  }) {
    return (
      <View style={[armed && styles.armedOutline]}>
        <View style={[highlight && styles.highlight, selected && styles.selected, armed && styles.armed]}>
          <CardFace card={card} width={width ?? WIDTHS[size]} style={deckStyle} locale={locale} />
          {/* Illegal right now: readable, but clearly sunk into the felt. */}
          {dimmed && <View pointerEvents="none" style={styles.dimmedTint} />}
        </View>
        {armed && caption ? (
          <View pointerEvents="none" style={styles.captionChip}>
            <Text style={styles.captionText}>{caption}</Text>
          </View>
        ) : null}
      </View>
    );
  },
  (a, b) =>
    a.card.suit === b.card.suit &&
    a.card.rank === b.card.rank &&
    a.size === b.size &&
    a.width === b.width &&
    a.deckStyle === b.deckStyle && a.locale === b.locale &&
    a.dimmed === b.dimmed &&
    a.highlight === b.highlight &&
    a.selected === b.selected &&
    a.armed === b.armed &&
    a.caption === b.caption,
);

const styles = StyleSheet.create({
  highlight: {
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: theme.accent,
    margin: -2,
  },
  selected: {
    borderRadius: radius.card,
    borderWidth: 3,
    borderColor: theme.ok,
    margin: -3,
  },
  armed: {
    borderRadius: radius.card,
    borderWidth: 3,
    borderColor: theme.accent,
    margin: -3,
    transform: [{ scale: 1.06 }],
  },
  armedOutline: {
    borderRadius: radius.card + 1,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.6)',
    margin: -1,
  },
  captionChip: {
    position: 'absolute',
    top: -12,
    alignSelf: 'center',
    backgroundColor: theme.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  captionText: { color: garb.ink, fontSize: 11, fontFamily: font.bold, letterSpacing: 0.5 },
  dimmedTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.card,
    // 1.6.0: the card itself stays opaque; a grey-green wash says "not now" without
    // letting the felt through (a see-through card lost contrast on everything it showed).
    backgroundColor: 'rgba(26,40,34,0.55)',
  },
});
