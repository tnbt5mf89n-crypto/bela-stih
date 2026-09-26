import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Rank, Suit } from '@belot/engine';
import { SUITS } from '@belot/engine';
import { cardLang, cosmetics, room } from './cosmetics';
import { CardBackFace, CardFace } from './deck';
import { Button } from './ui/Button';
import { font, theme } from './theme';

/**
 * The whole deck on one screen — the review harness for card art.
 *
 * Not linked from normal navigation; reached by long-pressing the title on the
 * home screen. Kept in the shipping build on purpose: it is also the honest
 * answer to "show me the cards" for curious players, and it costs nothing.
 */

const lang = () => cardLang();

/** Strength order within a suit, strongest first — how a player would fan them. */
const ORDER: Rank[] = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'];

export function DeckGallery({ onExit }: { onExit: () => void }) {
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: room().page }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Karte</Text>

        {SUITS.map((suit: Suit) => (
          <View key={suit}>
            <Text style={styles.suitLabel}>
              {lang().suitName(suit)} · {lang().seasonName(suit)}
            </Text>
            <View style={styles.row}>
              {ORDER.map((rank) => (
                <View key={rank} style={styles.card}>
                  <CardFace card={{ suit, rank }} width={82} style={cosmetics().deckStyle} locale={cardLang().id} />
                </View>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.suitLabel}>poleđina</Text>
        <View style={styles.row}>
          <CardBackFace width={82} variant={cosmetics().cardBack} />
        </View>

        <View style={styles.footer}>
          <Button label="Natrag" tone="strong" onPress={onExit} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.feltDeep },
  scroll: { padding: 14, gap: 10, paddingBottom: 40 },
  title: { color: theme.text, fontSize: 24, fontFamily: font.bold, textAlign: 'center' },
  suitLabel: { color: theme.textDim, fontSize: 14, fontFamily: font.regular, marginTop: 8, marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  card: { marginBottom: 4 },
  footer: { alignItems: 'center', marginTop: 12 },
});
