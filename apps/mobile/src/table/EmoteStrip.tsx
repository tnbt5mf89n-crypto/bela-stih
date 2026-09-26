import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PressScale } from '../ui/PressScale';
import { Shake } from '../ui/Shake';
import type { Lang } from '@belot/i18n';
import { EMOTES, emoteText } from '../emotes';
import { EmoteFace, hasEmoteFace } from '../emoteArt';
import { font, radius, theme } from '../theme';
import { LAND_PHRASE_H, LAND_TRAY_H, LAND_TRAY_W } from './metrics';

/**
 * The emote bar.
 *
 * The old tray sat in the flex column, so opening it shrank the felt by ~120px,
 * moved every sprite anchor and forced a re-measure mid-animation. This one
 * keeps one fixed box whether it is open or shut: the six glyphs are up (one
 * tap, no chrome) until the toggle swaps them for the phrases, in the same
 * box. Portrait's box is a 34px row under my puck; landscape's is 74x114 in
 * the right rail, the faces two abreast in three rows. Nothing floats: the
 * phrases once floated above the faces, which covered my own puck in portrait
 * and the right-hand player in landscape. There are more phrases than the box
 * shows at once, so they scroll inside it (sideways in portrait, down the
 * rail in landscape) rather than grow it.
 */

const GLYPHS = EMOTES.filter((e) => e.glyph);
const PHRASES = EMOTES.filter((e) => !e.glyph);

export function EmoteStrip({
  lang,
  open,
  dimmed,
  vertical = false,
  onSend,
  shakeN = 0,
}: {
  lang: Lang;
  /** Phrases showing? They take the glyphs' place, in either orientation. */
  open: boolean;
  /** Fade back while the player is deciding a card. */
  dimmed: boolean;
  /** Landscape: the box in the right rail, under the leave button. */
  vertical?: boolean;
  onSend: (id: string) => void;
  /** A tap inside the cooldown, counted: the strip shakes, nothing is sent. */
  shakeN?: number;
}) {
  return (
    <Shake n={shakeN} style={[styles.wrap, vertical && styles.wrapRail]} pointerEvents="box-none">
      {open && (
        <View style={vertical ? styles.phraseBox : styles.phraseRow}>
          <ScrollView
            horizontal={!vertical}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={vertical ? styles.phraseStack : styles.phraseLine}
          >
          {PHRASES.map((e) => (
            <PressScale
              key={e.id}
              onPress={() => onSend(e.id)}
              style={[styles.phraseChip, vertical && styles.phraseChipRail]}
              hitSlop={vertical ? 3 : undefined}
              sound={null}
            >
              <Text
                style={[styles.phrase, vertical && styles.phraseRail]}
                numberOfLines={vertical ? 1 : undefined}
                maxFontSizeMultiplier={vertical ? 1.2 : undefined}
              >
                {emoteText(lang, e.id)}
              </Text>
            </PressScale>
          ))}
          </ScrollView>
        </View>
      )}
      {/* The bubble's pop is the sound of an emote; no click on top of it. */}
      {!open && (
        <View style={[styles.row, vertical && styles.faceGrid, dimmed && styles.faded]}>
          {GLYPHS.map((e) => (
            <PressScale
              key={e.id}
              onPress={() => onSend(e.id)}
              style={styles.chip}
              hitSlop={4}
              sound={null}
              accessibilityLabel={lang.s.ui.emoteName(e.id)}
            >
              {hasEmoteFace(e.id) ? <EmoteFace id={e.id} size={26} /> : <Text style={styles.glyph} maxFontSizeMultiplier={1.3}>{emoteText(lang, e.id)}</Text>}
            </PressScale>
          ))}
        </View>
      )}
    </Shake>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'flex-end', minHeight: 34 },
  // Landscape: the rail's box, one height open or shut, so the swap moves nothing.
  wrapRail: { height: LAND_TRAY_H, minHeight: 0, alignSelf: 'stretch', justifyContent: 'flex-start' },
  // The glyphs' own 34px, exactly: a larger system font may crowd the chips,
  // but it can never make the row taller and move the fan above it.
  phraseRow: { height: 34, alignSelf: 'stretch' },
  // Centred while the phrases fit; past the edge, the row scrolls.
  phraseLine: { flexGrow: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  // Landscape: the phrases one under another in the faces' box, four at a time.
  phraseBox: { flex: 1, alignSelf: 'stretch' },
  phraseStack: { gap: 6, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 6, justifyContent: 'center', flexWrap: 'wrap' },
  // Two faces abreast, then the next two: 34 + 6 + 34.
  faceGrid: { width: LAND_TRAY_W },
  faded: { opacity: 0.55 },
  chip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Android clips tall emoji without an explicit line height.
  glyph: { fontSize: 20, lineHeight: 24, fontFamily: font.regular },
  phraseChip: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  // A rail phrase: four of them and three gaps fill the faces' 114, so 24
  // each; 6 a side, so "Thanks!" at the 1.2 font cap (75 dp) fits the
  // narrowest phone's 79 dp rail, and a longer phrase ellipsizes.
  phraseChipRail: { height: LAND_PHRASE_H, paddingVertical: 0, paddingHorizontal: 6, justifyContent: 'center', maxWidth: '100%' },
  phrase: { color: theme.text, fontSize: 13, fontFamily: font.bold },
  // Android pads a 13px line to its font's whole box, about 21dp; pinned at
  // 17 it sits inside the 24dp chip with room to spare.
  phraseRail: { lineHeight: 17, ...Platform.select({ android: { includeFontPadding: false }, default: {} }) },
});
