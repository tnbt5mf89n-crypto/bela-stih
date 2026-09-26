import { useCallback, useEffect, useRef, useState } from 'react';
import type { Seat } from '@belot/engine';
import { masterVolume, setSfxDuck, voiceVolume } from '../audio';
import { clipSource, sweepVoiceFiles } from './clipFiles';
import { playClip, type ClipPlayback } from './clipPlayer';
import { enqueue, gainForLoudness, nextClip, type HeardClip } from './voice';

/** How far the game's own sounds dip while somebody speaks. */
const SFX_UNDER_VOICE = 0.4;
/** A clip that never says it has finished is let go this long after it should have. */
const FINISH_SLACK_MS = 2500;

/**
 * The clips others at the table send, played one at a time as they came
 * (voice.ts decides the order, the mutes and what is stale), at the game's
 * volume. clipPlayer lets each one go when it ends: on a phone the player is
 * released with its audio track, and expo-audio's players open no media
 * session in this app (scripts/patch-expo-audio.mjs).
 */
export function useVoicePlayback(
  enabled: boolean,
  blocked: (s: Seat) => boolean,
  blockedKey: string,
  /** A clip has been played here to its end: its speaker is told (the receipt). */
  onPlayed?: (id: number) => void,
) {
  const [speaking, setSpeaking] = useState<Seat | null>(null);
  const onPlayedRef = useRef(onPlayed);
  onPlayedRef.current = onPlayed;
  const queue = useRef<HeardClip[]>([]);
  // Held while this player records: nothing new starts under their own voice.
  const held = useRef(false);
  const current = useRef<{ from: Seat; stop: () => void } | null>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const pump = useCallback(() => {
    if (current.current || held.current) return;
    const { clip, rest } = nextClip(queue.current, Date.now(), blockedRef.current);
    queue.current = rest;
    if (!clip) return;
    let src: { uri: string; release: () => void } | null = null;
    let playback: ClipPlayback | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const stop = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      playback?.stop();
      src?.release();
      current.current = null;
      setSpeaking(null);
      setSfxDuck(1);
      pump();
    };
    current.current = { from: clip.from, stop };
    try {
      src = clipSource(clip.data, clip.mime, clip.id);
      // The receipt goes when the clip has been heard to the END (1.6.0), and
      // only then: a clip the browser could not play, or was not allowed to,
      // ends at once unheard. At the player's voice volume, corrected by the
      // sender's loudness header.
      playback = playClip(src.uri, masterVolume() * voiceVolume() * gainForLoudness(clip.loudness), (heard) => {
        if (heard) onPlayedRef.current?.(clip.id);
        stop();
      });
    } catch {
      stop();
      return;
    }
    if (done) return;
    setSpeaking(clip.from);
    setSfxDuck(SFX_UNDER_VOICE);
    timer = setTimeout(stop, clip.ms + FINISH_SLACK_MS);
  }, []);

  /** A clip from the table: queued, and played when its turn comes. */
  const hear = useCallback(
    (c: Omit<HeardClip, 'at'>) => {
      if (!enabledRef.current) return;
      queue.current = enqueue(queue.current, { ...c, at: Date.now() }, blockedRef.current);
      pump();
    },
    [pump],
  );

  // What a visit the app did not live through left in the cache. First, so
  // it runs before a clip can arrive.
  useEffect(() => sweepVoiceFiles(), []);
  // Voice switched off, or the speaker muted, mid-clip: silence at once.
  useEffect(() => {
    if (!enabled) {
      queue.current = [];
      current.current?.stop();
    } else if (current.current && blockedRef.current(current.current.from)) {
      current.current.stop();
    }
  }, [enabled, blockedKey]);
  useEffect(
    () => () => {
      queue.current = [];
      current.current?.stop();
    },
    [],
  );

  /** My own microphone is open: hold the queue; let it go (and pump) when it closes. */
  const hold = useCallback(
    (on: boolean) => {
      held.current = on;
      if (!on) pump();
    },
    [pump],
  );

  return { hear, speaking, hold };
}
