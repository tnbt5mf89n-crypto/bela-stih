import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type Insets,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import type { Lang } from '@belot/i18n';
import { pattern } from '../haptics';
import { Mic } from '../ui/icons';
import { PressScale } from '../ui/PressScale';
import type { MicPhase } from '../voice/useVoiceRecorder';
import { releasedOn, takeClock } from '../voice/voice';
import { font, ink, radius, surface, theme } from '../theme';

/** "0:04 / 0:15" for the take now recording, counting by itself. */
export function TakeClock({ startedAt, style }: { startedAt: number; style?: StyleProp<TextStyle> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return <Text style={style} maxFontSizeMultiplier={1.3}>{takeClock(Math.max(0, now - startedAt))}</Text>;
}

/** How wide the words over the button may run (they sit above it, taking no room in the row). */
const CAPTION_W = 200;

/**
 * Push-to-talk at the table. Held (the default): press, speak, let go to send;
 * slide off to take it back. Tapped (Settings): tap to start, tap again to
 * send; the table offers a cross to throw a take away. While it records the
 * button turns red and says how long the take has run; afterwards the same
 * place says what became of it (`status`: sending, sent, who has heard it).
 * Only the look lives here: the recorder is the online screen's
 * (useVoiceRecorder), so a take outlives this button when the table's rows
 * change under it - a question, the deal's end, the phone turned sideways.
 *
 * A held button that leaves the screen under a finger (the phone turned: the
 * mic moves to the other layout) may never hear the finger lift, so it ends
 * the take itself as it goes and sends what was said - or the take would run
 * on to the limit after the finger had long let go. (A browser cancels the
 * touch as the page turns, first: that take is dropped, as any cancelled
 * touch.)
 *
 * Held, whether a take goes is decided where the finger lifts, not by a
 * "press": a phone browser never clicks after a long touch, and a press that
 * became a long press never presses either. A long press is claimed (and does
 * nothing) so a phone browser neither opens its menu nor ends the touch.
 */
export function MicButton({
  lang,
  size,
  phase,
  startedAt,
  hitSlop,
  mode = 'hold',
  status = null,
  caption = 'above',
  captionAlign = 'center',
  onStart,
  onFinish,
}: {
  lang: Lang;
  /** 40 beside the faces' toggle in portrait and on the results sheet, 34 in a landscape rail. */
  size: number;
  phase: MicPhase;
  startedAt: number;
  /** Out to the gap's middle on the toggle's side, so the two never share a touch. */
  hitSlop: Insets | number;
  mode?: 'hold' | 'tap';
  /** What became of the last message, said where the clock was. */
  status?: string | null;
  /** Words above the button, or none (the results sheet's bar says them beside it). */
  caption?: 'above' | 'none';
  /** Centred over the button, or ending at its right edge (a rail at the screen's edge). */
  captionAlign?: 'center' | 'end';
  onStart: () => void;
  onFinish: (send: boolean) => void;
}) {
  const ui = lang.s.ui;
  const boxRef = useRef<View>(null);
  const box = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const recording = phase === 'recording';
  const tap = mode === 'tap';
  const pressing = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  useEffect(
    () => () => {
      if (pressing.current) onFinishRef.current(true);
    },
    [],
  );

  const words = caption === 'above' && (recording || status);
  return (
    <View ref={boxRef} collapsable={false}>
      {words ? (
        <View
          style={[styles.captionBox, captionAlign === 'end' ? styles.captionEnd : { left: (size - CAPTION_W) / 2 }]}
          pointerEvents="none"
        >
          {recording ? (
            <TakeClock startedAt={startedAt} style={styles.caption} />
          ) : (
            <Text style={[styles.caption, captionAlign === 'end' && styles.captionTextEnd]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              {status}
            </Text>
          )}
        </View>
      ) : null}
      <PressScale
        sound={null}
        haptic={null}
        hitSlop={hitSlop}
        accessibilityRole="button"
        accessibilityLabel={ui.micLabel}
        accessibilityHint={tap ? ui.micHintTap : ui.micHint}
        {...(tap
          ? {
              // Tap to start, tap again to send.
              accessibilityState: { selected: recording },
              onPress: () => {
                if (phase === 'idle') {
                  pattern('press');
                  onStart();
                } else if (phase === 'recording') {
                  pattern('press');
                  onFinish(true);
                }
              },
            }
          : {
              onPressIn: () => {
                pressing.current = true;
                box.current = null;
                boxRef.current?.measure((_x, _y, w, h, pageX, pageY) => {
                  box.current = { x: pageX, y: pageY, w, h };
                });
                pattern('press');
                onStart();
              },
              onLongPress: () => {},
              onPressOut: (e: GestureResponderEvent) => {
                pressing.current = false;
                const n = e.nativeEvent as { pageX: number; pageY: number; type?: string };
                onFinish(releasedOn(box.current, n));
              },
            })}
        style={[styles.button, { width: size, height: size }, recording && styles.live]}
      >
        <View pointerEvents="none">
          <Mic size={Math.round(size * 0.5)} colour={recording ? ink.hi : ink.mid} />
        </View>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: surface.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  live: { backgroundColor: theme.danger, borderColor: theme.dangerInk },
  // Above the button, never taking room in the row.
  captionBox: {
    position: 'absolute',
    bottom: '100%',
    width: CAPTION_W,
    alignItems: 'center',
    paddingBottom: 4,
  },
  captionEnd: { right: 0, alignItems: 'flex-end' },
  caption: {
    color: ink.hi,
    fontFamily: font.bold,
    fontSize: 12,
    textAlign: 'center',
    backgroundColor: surface.scrim,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  captionTextEnd: { textAlign: 'right' },
});
