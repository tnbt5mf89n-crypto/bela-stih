import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { cardId, type Card } from '@belot/engine';
import type { Declaration } from '@belot/shared-types';
import { REVEAL_MS } from '../anim/director';
import type { DeckStyle } from '../cosmetics';
import { PlayingCard } from '../PlayingCard';
import { garb } from '../deck/palette';
import { font, radius, theme } from '../theme';
import type { Position } from './geometry';
import { REVEAL_BAR_FADE_MS, REVEAL_OUT_MS, revealExitDelay, type RevealPhase } from './revealTiming';

/**
 * The winning side's zvanja, laid out for everyone to read.
 *
 * The cards come in from the announcer's side of the table, one after
 * another, over a thin gold bar that drains for exactly as long as they stay
 * up; they leave the same way, back towards the announcer, so the row is
 * empty when it unmounts. The bar is information — it survives reduce-motion
 * — the flying does not.
 */
export function RevealRow({
  declarations,
  cardW,
  deckStyle,
  label,
  sideOf,
  phase,
  reduced,
  onTap,
}: {
  declarations: Declaration[];
  cardW: number;
  deckStyle: DeckStyle;
  label: (d: Declaration) => string;
  /** Which side of the table the announcer sits on, from my chair. */
  sideOf: (d: Declaration) => Position;
  phase: RevealPhase;
  reduced: boolean;
  onTap: () => void;
}) {
  const drain = useSharedValue(1);
  useEffect(() => {
    drain.value = 1;
    drain.value = withTiming(0, {
      duration: REVEAL_MS,
      easing: Easing.linear,
      reduceMotion: ReduceMotion.Never,
    });
  }, [drain]);
  const bar = useAnimatedStyle(() => ({ width: `${drain.value * 100}%` }));
  const count = declarations.reduce((n, d) => n + d.cards.length, 0);
  // The bar leaves with the cards: it fades instead of dropping out of the
  // layout, which popped it and jumped the bottom-anchored row. Mounted mid
  // exit (a rotation remounts the felt), it starts hidden and never animates
  // to where it already is.
  const bornLeaving = useRef(phase !== 'showing').current;
  const fade = useSharedValue(bornLeaving ? 0 : 1);
  useEffect(() => {
    if (phase !== 'leaving' || bornLeaving) return;
    fade.value = reduced ? 0 : withTiming(0, { duration: REVEAL_BAR_FADE_MS, easing: Easing.out(Easing.quad) });
  }, [fade, phase, reduced, bornLeaving]);
  const trackFade = useAnimatedStyle(() => ({ opacity: fade.value }));

  let index = 0;
  return (
    <Pressable style={styles.row} onPress={onTap}>
      {declarations.map((d, i) => (
        <View key={i} style={styles.group}>
          <Text style={styles.label} maxFontSizeMultiplier={1.3}>{label(d)}</Text>
          <View style={styles.cards}>
            {d.cards.map((c) => (
              <RevealCard
                key={cardId(c)}
                card={c}
                width={cardW}
                deckStyle={deckStyle}
                from={sideOf(d)}
                index={index++}
                count={count}
                phase={phase}
                reduced={reduced}
              />
            ))}
          </View>
        </View>
      ))}
      <Animated.View style={[styles.track, trackFade]}>
        <Animated.View style={[styles.fill, bar]} />
      </Animated.View>
    </Pressable>
  );
}

/** Where a card sets off from, relative to its place in the row, by the announcer's side. */
const FROM: Record<Position, { x: number; y: number }> = {
  left: { x: -90, y: -50 },
  right: { x: 90, y: -50 },
  top: { x: 0, y: -90 },
  bottom: { x: 0, y: 40 },
};

const IN_MS = 260;
const STAGGER_MS = 40;

function RevealCard({
  card,
  width,
  deckStyle,
  from,
  index,
  count,
  phase,
  reduced,
}: {
  card: Card;
  width: number;
  deckStyle: DeckStyle;
  from: Position;
  index: number;
  /** How many cards the row shows: the exit stagger is sized to it. */
  count: number;
  phase: RevealPhase;
  reduced: boolean;
}) {
  // 0 = at the announcer, 1 = in the row. In, hold, and back out the same way.
  const p = useSharedValue(reduced ? 1 : 0);
  // Mounted mid-exit, a card stays where it starts (hidden): animating it to
  // the 0 it already has would write to a torn-down view.
  const bornLeaving = useRef(phase !== 'showing').current;
  useEffect(() => {
    if (reduced) {
      p.value = phase === 'leaving' ? 0.999 : 1; // the fade below still reads it
      return;
    }
    if (phase === 'showing') {
      p.value = withDelay(
        index * STAGGER_MS,
        withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.cubic) }),
      );
    } else if (phase === 'leaving' && !bornLeaving) {
      p.value = withDelay(
        revealExitDelay(index, count),
        withTiming(0, { duration: REVEAL_OUT_MS, easing: Easing.in(Easing.cubic) }),
      );
    }
  }, [p, phase, index, count, reduced, bornLeaving]);

  const style = useAnimatedStyle(() => ({
    opacity: reduced ? (phase === 'leaving' ? 0 : 1) : Math.min(1, p.value * 1.6),
    transform: [
      { translateX: FROM[from].x * (1 - p.value) },
      { translateY: FROM[from].y * (1 - p.value) },
      { scale: 0.6 + 0.4 * p.value },
    ],
  }));

  return (
    <Animated.View style={style}>
      <PlayingCard card={card} width={width} deckStyle={deckStyle} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  group: { alignItems: 'center', gap: 2 },
  label: { color: theme.accent, fontSize: 11, fontFamily: font.bold },
  cards: { flexDirection: 'row', gap: 2 },
  // The whole width of the row: time, made visible.
  track: {
    width: '100%',
    height: 2,
    marginTop: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    overflow: 'hidden',
  },
  fill: { height: 2, backgroundColor: garb.gold },
});
