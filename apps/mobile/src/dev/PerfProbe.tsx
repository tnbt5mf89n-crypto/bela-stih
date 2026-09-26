import { font } from '../theme';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { counters, lastTickCost } from './counters';

/**
 * Dev-only overlay: the frames that missed on the UI thread, the stalls on the
 * JS thread, and what the last director tick cost in card-face renders,
 * anchor measurements and sprite mounts. Long-press the profile bar on the
 * table to show it.
 *
 * Adaptive: the phone's own frame period is the yardstick. The test phone runs
 * at 120 Hz, so a fixed ">16 ms" would count nothing there while every other
 * frame dropped; instead the UI thread keeps a histogram of frame gaps, the
 * probe reads the median once a second, and a "drop" is a gap over 1.5x that
 * median. Named by thread: UI drops are gaps between rendered frames (the
 * frame callback runs on the UI thread); JS stalls are a JS-thread timer
 * arriving late, which is where a heavy tick or a synchronous bot shows up.
 *
 * Nothing crosses to JS more than once a second, so the probe cannot cost the
 * frames it is counting. On web the same numbers are `window.__belaPerf`.
 */
const BUCKET_MS = 1; // histogram resolution
const BUCKETS = 64; // 0..63 ms, the last bucket catches everything longer
const JS_TICK_MS = 50;
const JS_STALL_MS = 100;

export function PerfProbe() {
  const [line, setLine] = useState('…');
  const frames = useSharedValue(0);
  const drops = useSharedValue(0);
  const long = useSharedValue(0);
  const thresh = useSharedValue(25);
  const hist = useSharedValue<number[]>(new Array<number>(BUCKETS).fill(0));

  const onFrame = useCallback(
    (info: { timeSincePreviousFrame: number | null }) => {
      'worklet';
      const dt = info.timeSincePreviousFrame ?? 0;
      frames.value += 1;
      if (dt > thresh.value) drops.value += 1;
      if (dt > 100) long.value += 1;
      const b = Math.min(BUCKETS - 1, Math.floor(dt / BUCKET_MS));
      hist.modify((h) => {
        'worklet';
        h[b] = (h[b] ?? 0) + 1;
        return h;
      });
    },
    [frames, drops, long, thresh, hist],
  );
  useFrameCallback(onFrame);

  // JS thread: a timer that arrives late by more than JS_STALL_MS was blocked.
  const stalls = useRef(0);
  const worst = useRef(0);
  useEffect(() => {
    let due = Date.now() + JS_TICK_MS;
    const id = setInterval(() => {
      const late = Date.now() - due;
      if (late > JS_STALL_MS) stalls.current += 1;
      if (late > worst.current) worst.current = late;
      due = Date.now() + JS_TICK_MS;
    }, JS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const f = frames.value;
      const d = drops.value;
      const l = long.value;
      const h = hist.value.slice();
      frames.value = 0;
      drops.value = 0;
      long.value = 0;
      hist.value = new Array<number>(BUCKETS).fill(0);
      // The median frame gap: the phone's real period, whatever its refresh rate.
      let seen = 0;
      let median = 0;
      for (let i = 0; i < BUCKETS; i++) {
        seen += h[i] ?? 0;
        if (seen * 2 >= f) {
          median = (i + 0.5) * BUCKET_MS;
          break;
        }
      }
      if (f > 0) thresh.value = Math.max(4, median * 1.5);
      const js = stalls.current;
      const w = worst.current;
      stalls.current = 0;
      worst.current = 0;
      const t = lastTickCost();
      const live = counters.spriteMount - counters.spriteUnmount;
      setLine(
        `${f}fps · ${median.toFixed(1)}ms   UI drops ${d} (>${thresh.value.toFixed(0)}ms) long ${l}   JS stalls ${js} worst ${w}ms   tick: faces ${t.cardFace} · measure ${t.measure} · sprites ${t.sprites}   live ${live}`,
      );
      if (Platform.OS === 'web') {
        (globalThis as { __belaPerf?: unknown }).__belaPerf = {
          frames: f,
          medianMs: median,
          thresholdMs: thresh.value,
          uiDrops: d,
          uiLong: l,
          jsStalls: js,
          jsWorstMs: w,
          tick: t,
          counters: { ...counters },
        };
      }
    }, 1000);
    return () => clearInterval(id);
  }, [frames, drops, long, thresh, hist]);

  return (
    <View pointerEvents="none" style={styles.box}>
      <Text style={styles.text}>{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: { color: '#ffe082', fontSize: 11, fontFamily: font.regular, fontVariant: ['tabular-nums'] },
});
