import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { Seat } from '@belot/engine';
import type { Lang } from '@belot/i18n';
import { Button } from '../ui/Button';
import { Pause } from '../ui/icons';
import { clockText, type TableHold } from '../net/hold';
import { font, ink, radius, space, stroke, surface, theme, type } from '../theme';

/** Re-render once a second while mounted: the panel's clocks tick down. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * The table standing still, and what may be done about it.
 *
 * Three reasons, most personal first: this device lost its connection and is
 * getting back into its seat; a player paused the table; or a friend's
 * connection dropped - a phone call, usually - and the table waits for them
 * instead of letting a bot play their cards. Anyone may carry on after a pause,
 * and anyone may stop waiting and let a bot hold the cards meanwhile.
 *
 * Drawn over the table with a light scrim rather than a dark one: the cards
 * stay readable underneath while nothing can be played.
 */
export function HoldPanel({
  lang,
  hold,
  reconnecting,
  nameOf,
  onResume,
  onPlayOn,
  onLeave,
  leaveLabel,
  ground,
  reduced = false,
}: {
  lang: Lang;
  hold: TableHold | null;
  /** This device is the one off the line, trying to get back in. */
  reconnecting: boolean;
  nameOf: (s: Seat) => string;
  onResume?: () => void;
  onPlayOn?: () => void;
  /** While reconnecting, the way out is still there. */
  onLeave: () => void;
  leaveLabel: string;
  ground: string;
  reduced?: boolean;
}) {
  const ui = lang.s.ui;
  const now = useNow();

  let icon: 'wait' | 'pause' = 'pause';
  let title: string;
  let line: string;
  let left: number | null = null;
  let action: { label: string; tone: 'strong' | 'plain'; onPress: () => void } | null = null;

  if (reconnecting) {
    icon = 'wait';
    title = ui.reconnectingTitle;
    line = ui.reconnectingLine;
    action = { label: leaveLabel, tone: 'plain', onPress: onLeave };
  } else if (hold?.paused) {
    title = ui.pausedTitle;
    line = ui.pausedBy(nameOf(hold.paused.by));
    left = hold.paused.until - now;
    if (onResume) action = { label: ui.resume, tone: 'strong', onPress: onResume };
  } else if (hold && hold.waiting.length > 0) {
    const names = hold.waiting.map((w) => nameOf(w.seat)).join(', ');
    title = ui.waitingFor(names);
    line = ui.waitingLine(hold.waiting.length);
    // The first to run out is the one the table gives up on first.
    left = Math.min(...hold.waiting.map((w) => w.until)) - now;
    // Not the strong answer: handing a friend's cards to a bot is a choice,
    // not a reflex.
    if (onPlayOn) action = { label: ui.playOn(hold.waiting.length), tone: 'plain', onPress: onPlayOn };
  } else {
    return null;
  }

  return (
    <Animated.View entering={reduced ? undefined : FadeIn.duration(160)} style={styles.backdrop} accessibilityViewIsModal>
      <View style={[styles.panel, { backgroundColor: ground }]} accessibilityRole="alert">
        <View style={styles.head}>
          {icon === 'wait' ? <ActivityIndicator color={theme.accent} /> : <Pause size={22} colour={theme.accent} />}
          <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {title}
          </Text>
        </View>
        <Text style={styles.line} maxFontSizeMultiplier={1.3}>{line}</Text>
        {left !== null && <Text style={styles.left} maxFontSizeMultiplier={1.3}>{ui.holdLeft(clockText(left))}</Text>}
        {action && <Button label={action.label} tone={action.tone} onPress={action.onPress} />}
      </View>
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
    backgroundColor: surface.panel,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  panel: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: stroke.edge,
    padding: space.xl,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1, color: ink.hi, ...type.h3 },
  line: { color: ink.mid, fontSize: 14, fontFamily: font.regular },
  left: { color: theme.accent, fontSize: 14, fontFamily: font.regular, fontVariant: ['tabular-nums'] },
});
