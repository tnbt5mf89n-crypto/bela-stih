import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import { dropTake, readTake } from './clipFiles';
import {
  recordingOptions,
  sniffMime,
  VOICE_MAX_BYTES,
  VOICE_MAX_MS,
  VOICE_MIN_MS,
  webRecordingMime,
  type VoiceMime,
} from './voice';

/** A take ready to send: what it is, how long, the bytes. */
export interface Take {
  mime: VoiceMime;
  ms: number;
  data: Uint8Array;
  /** The average level while recording, dBFS; undefined where the recorder gives none (the web). */
  loudness?: number;
}

/** The mean of the levels sampled, or nothing when there were none. */
function meanDb(xs: readonly number[]): number | undefined {
  if (xs.length === 0) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** How a press ended: sent, too short to mean anything, slid off, the mic refused, or the phone failed us. */
export type TakeEnd = 'sent' | 'short' | 'cancelled' | 'denied' | 'failed';

export type MicPhase = 'idle' | 'starting' | 'recording';

/** The push-to-talk handle the table's mic button drives; it lives with the online screen, not the button. */
export interface VoiceMic {
  phase: MicPhase;
  /** When the take now recording began. */
  startedAt: number;
  start: () => Promise<void>;
  /** The finger lifted on the button (true) or slid off (false); a take in the making then goes or is dropped. */
  finish: (send: boolean) => Promise<void>;
  /** The last press that sent nothing the player should hear about; `n` makes the same reason twice news. */
  note: { why: 'short' | 'denied' | 'failed'; n: number } | null;
}

const WEB_MIME =
  Platform.OS === 'web' && typeof MediaRecorder !== 'undefined'
    ? webRecordingMime((t) => MediaRecorder.isTypeSupported(t))
    : undefined;
const OPTIONS = recordingOptions(WEB_MIME);

/**
 * Hold to talk. `start` on the press, `finish(true)` when the finger lifts on
 * the button, `finish(false)` when it slid off. A take ends by itself at
 * VOICE_MAX_MS and is sent; one that is too short, cancelled, or cut by the
 * app going to the background is deleted unread. The first press on a phone
 * asks for the microphone and records nothing: the prompt took the press.
 *
 * Held by the online screen for as long as it is open, so the table's rows
 * can come and go under the button without losing a take; when the screen
 * itself closes mid-take, the microphone is let go and the file deleted.
 */
export function useVoiceRecorder(onTake: (take: Take) => void): VoiceMic {
  const recorder = useAudioRecorder(OPTIONS);
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [startedAt, setStartedAt] = useState(0);
  const [note, setNote] = useState<VoiceMic['note']>(null);
  const phaseRef = useRef<MicPhase>('idle');
  /** The finger is still on the button. */
  const holding = useRef(false);
  const startedRef = useRef(0);
  /** The file the take now recording goes to (a phone knows it from the start; a browser only at the end). */
  const takeUri = useRef<string | null>(null);
  // Levels sampled four times a second while recording (recordingOptions meters).
  const meters = useRef<number[]>([]);
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMetering = () => {
    if (meter.current) clearInterval(meter.current);
    meter.current = null;
  };
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTakeRef = useRef(onTake);
  onTakeRef.current = onTake;

  const to = (p: MicPhase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const end = (why: TakeEnd) => {
    if (why === 'short' || why === 'denied' || why === 'failed') setNote((n) => ({ why, n: (n?.n ?? 0) + 1 }));
  };

  const finish = useCallback(
    async (send: boolean) => {
      holding.current = false;
      // Still opening the microphone: `start` sees the finger gone and stops.
      if (phaseRef.current !== 'recording') return;
      to('idle');
      if (limit.current) clearTimeout(limit.current);
      limit.current = null;
      const ms = Math.min(Date.now() - startedRef.current, VOICE_MAX_MS);
      const known = takeUri.current;
      takeUri.current = null;
      try {
        stopMetering();
        await recorder.stop();
      } catch {
        dropTake(known);
        end('failed');
        return;
      }
      const uri = recorder.uri ?? known;
      if (!send || ms < VOICE_MIN_MS || !uri) {
        dropTake(uri);
        end(!send ? 'cancelled' : ms < VOICE_MIN_MS ? 'short' : 'failed');
        return;
      }
      try {
        const data = await readTake(uri);
        const mime = sniffMime(data);
        if (mime === null || data.length > VOICE_MAX_BYTES) {
          end('failed');
          return;
        }
        onTakeRef.current({ mime, ms, data, loudness: meanDb(meters.current) });
        end('sent');
      } catch {
        end('failed');
      }
    },
    [recorder],
  );

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    holding.current = true;
    to('starting');
    let prepared = false;
    try {
      let perm = await getRecordingPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) perm = await requestRecordingPermissionsAsync();
        // Asked just now (the prompt took the press) or refused: nothing is recorded.
        to('idle');
        holding.current = false;
        if (!perm.granted) end('denied');
        return;
      }
      await recorder.prepareToRecordAsync();
      prepared = true;
      // A phone has named the file already; a browser's is the one before (or none).
      takeUri.current = Platform.OS === 'web' ? null : recorder.uri;
      recorder.record();
      meters.current = [];
      stopMetering();
      meter.current = setInterval(() => {
        try {
          const level = recorder.getStatus().metering;
          if (typeof level === 'number' && Number.isFinite(level)) meters.current.push(level);
        } catch {
          // a recorder already let go
        }
      }, 250);
      startedRef.current = Date.now();
      setStartedAt(startedRef.current);
      to('recording');
      limit.current = setTimeout(() => void finish(true), VOICE_MAX_MS);
      // Let go while the microphone was opening: nothing meant, nothing sent.
      if (!holding.current) void finish(false);
    } catch {
      to('idle');
      holding.current = false;
      // Opened but would not record: close it again, so no microphone stays live.
      if (prepared) {
        try {
          stopMetering();
        await recorder.stop();
        } catch {
          // Never started: nothing to stop.
        }
        dropTake(takeUri.current);
        takeUri.current = null;
      }
      end('failed');
    }
  }, [recorder, finish]);

  // A call or the home button mid-take: the take is dropped, the mic let go.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void finish(false);
    });
    return () => sub.remove();
  }, [finish]);
  // The screen closing mid-take. The recorder may be released before this
  // runs (its own hook cleans up first), so nothing here waits on it: stop if
  // it still answers, and delete the file by the name kept at the start.
  useEffect(
    () => () => {
      if (limit.current) clearTimeout(limit.current);
      holding.current = false;
      if (phaseRef.current !== 'recording') return;
      phaseRef.current = 'idle';
      try {
        void recorder.stop().catch(() => {});
      } catch {
        // Released already, microphone and all.
      }
      dropTake(takeUri.current);
      takeUri.current = null;
    },
    [recorder],
  );

  return useMemo(() => ({ phase, startedAt, start, finish, note }), [phase, startedAt, start, finish, note]);
}
