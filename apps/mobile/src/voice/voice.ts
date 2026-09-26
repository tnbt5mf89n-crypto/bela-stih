import type { AudioQuality, IOSOutputFormat, RecordingOptions } from 'expo-audio';
import type { Seat } from '@belot/engine';
import type { Lang } from '@belot/i18n';

/**
 * Push-to-talk voice messages: the part with no device in it, so it is
 * tested without a microphone. A clip is recorded while a button is held,
 * sent whole, relayed by the room to the others at the table and played there
 * by itself; nothing keeps it anywhere.
 */

/** The room's bounds (apps/server/src/protocol.ts; a test holds the two together). */
export const VOICE_MAX_MS = 15_000;
export const VOICE_MAX_BYTES = 64 * 1024;
/** A shorter press was not meant as speech: nothing is sent. */
export const VOICE_MIN_MS = 400;

export type VoiceMime = 'audio/mp4' | 'audio/webm';

/**
 * What a recording is, by its first bytes: AAC in MP4 (Android, Safari:
 * 'ftyp' at byte 4) or Opus in WebM (Chrome, Firefox: the EBML magic). The
 * room checks the same, so a take is named by what it is, not by what a
 * recorder reported.
 */
export function sniffMime(b: Uint8Array): VoiceMime | null {
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'audio/mp4';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  return null;
}

/**
 * A browser records Opus in WebM where it can (Chrome, Firefox): that recorder
 * keeps to the bit rate asked for. Chrome's MP4 recorder ignores it (96 kbps,
 * so 15 s came to ~165 KB, over the room's limit, and was dropped). MP4 only
 * where WebM cannot record at all (Safari before 18.4). Android plays both.
 */
export function webRecordingMime(isSupported: (type: string) => boolean): string | undefined {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    try {
      if (isSupported(t)) return t;
    } catch {
      // An engine that throws for a type it does not know simply lacks it.
    }
  }
  return undefined;
}

/** Speech, not music: mono, 16 kHz, 24 kbps - 15 s is about 45 KB, inside the room's limit. */
export const VOICE_BIT_RATE = 24_000;

export function recordingOptions(webMime: string | undefined): RecordingOptions {
  return {
    extension: '.m4a',
    sampleRate: 16_000,
    numberOfChannels: 1,
    bitRate: VOICE_BIT_RATE,
    // Levels while recording (the take's loudness header, gainForLoudness).
    isMeteringEnabled: true,
    // The phone's communication path: echo cancelled, noise suppressed, gain
    // controlled - a table's worth of clips, not a field recording (1.6.0).
    android: { extension: '.m4a', outputFormat: 'mpeg4', audioEncoder: 'aac', sampleRate: 16_000, audioSource: 'voice_communication' },
    // No iOS build ships; the type requires the fields (MPEG4AAC, AudioQuality.LOW),
    // written as values so this module loads no native code under test.
    ios: { extension: '.m4a', outputFormat: 'aac ' as IOSOutputFormat, audioQuality: 32 as AudioQuality },
    web: { ...(webMime ? { mimeType: webMime } : {}), bitsPerSecond: VOICE_BIT_RATE },
  };
}

/** A clip as it arrives, with the time it did: a queue must not play yesterday's news. */
export interface HeardClip {
  from: Seat;
  id: number;
  ms: number;
  mime: VoiceMime;
  data: Uint8Array;
  at: number;
  /** The sender's average level while recording, dBFS (1.6.0); absent from older apps and the web. */
  loudness?: number;
}

/** A loudness as it arrives on the wire: a finite dBFS between -60 and 0, or nothing. */
export function loudnessOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= -60 && v <= 0 ? v : undefined;
}

/**
 * A take's loudness header: the mean of the levels sampled while it recorded,
 * dBFS, or nothing when none was heard. -160 is expo-audio's "no signal" (an
 * amplitude of 0), and Android's recorder reports exactly that on the first
 * reading of every take: it is not a level. Averaged in, it dragged a 1 s take
 * (four readings) down by ~37 dB, and a clip of a second or two got the +9 dB
 * cap whatever its level.
 */
export function meanDb(xs: readonly number[]): number | undefined {
  const heard = xs.filter((x) => x > -160);
  if (heard.length === 0) return undefined;
  return heard.reduce((a, b) => a + b, 0) / heard.length;
}

/**
 * The gain that brings a clip to the table's level: -20 dBFS is the target,
 * and the correction is clamped to ±9 dB so a whisper is lifted and a shout
 * held, but nothing is turned into noise. No header, no change.
 */
export function gainForLoudness(loudness: number | undefined): number {
  if (loudness === undefined || !Number.isFinite(loudness)) return 1;
  const db = Math.max(-9, Math.min(9, -20 - loudness));
  return Math.pow(10, db / 20);
}

/** At most this many wait their turn; a flood beyond it is not heard. */
export const QUEUE_MAX = 3;
/** A clip that has waited this long is dropped: the moment it was about has gone. */
export const STALE_MS = 20_000;

/** A clip joins the queue unless its speaker is muted or the queue is full. */
export function enqueue(queue: readonly HeardClip[], clip: HeardClip, blocked: (s: Seat) => boolean): HeardClip[] {
  if (blocked(clip.from) || queue.length >= QUEUE_MAX) return [...queue];
  return [...queue, clip];
}

/**
 * The next clip to play, in the order they came, skipping any whose speaker
 * has been muted meanwhile and any grown stale.
 */
export function nextClip(
  queue: readonly HeardClip[],
  now: number,
  blocked: (s: Seat) => boolean,
): { clip: HeardClip | null; rest: HeardClip[] } {
  const rest = queue.filter((c) => !blocked(c.from) && now - c.at <= STALE_MS);
  const [clip, ...more] = rest;
  return { clip: clip ?? null, rest: more };
}

/** "0:04 / 0:15": how long a take has run, against the limit. */
export function takeClock(ms: number): string {
  const s = Math.min(Math.floor(ms / 1000), VOICE_MAX_MS / 1000);
  return `0:${String(s).padStart(2, '0')} / 0:${VOICE_MAX_MS / 1000}`;
}

/** A finger lifted this close to the button still sends; further off, the take is taken back. */
export const RELEASE_SLOP = 24;

/** Where a press ended, against the button's box on the screen: on it (or near), or slid off. */
export function releasedOn(
  box: { x: number; y: number; w: number; h: number } | null,
  at: { pageX: number; pageY: number; type?: string },
): boolean {
  // The browser took the touch away (a scroll, a system gesture): nothing was meant.
  if (at.type === 'touchcancel' || at.type === 'pointercancel') return false;
  if (!box) return true;
  return (
    at.pageX >= box.x - RELEASE_SLOP &&
    at.pageX <= box.x + box.w + RELEASE_SLOP &&
    at.pageY >= box.y - RELEASE_SLOP &&
    at.pageY <= box.y + box.h + RELEASE_SLOP
  );
}

// --- what became of my own message -------------------------------------------

/** The room answers a clip at once (its echo); longer than this and it never got there. */
export const ECHO_WAIT_MS = 8000;
/**
 * A listener's app plays a clip within STALE_MS of its arrival or never
 * (nextClip), so no receipt this long after the echo means nobody heard it.
 */
// A receipt means heard to the END (1.6.0): a full clip queued behind another can take this long.
export const RECEIPT_WAIT_MS = STALE_MS + VOICE_MAX_MS + 5000;
/** A settled word stays this long beside the mic. */
export const STATUS_SHOW_MS = 4000;

/** The room's echo of my clip: whom it went to (null: a room too old to say), and which of them cannot confirm. */
export interface VoiceEcho {
  id: number;
  ms: number;
  to: readonly Seat[] | null;
  noReceipt: readonly Seat[];
}

/** A word that only waits to go away. */
type Word = 'nobody' | 'unheard' | 'notSent' | 'tooShort' | 'micDenied' | 'recordFailed';

export type SendStatus =
  /** Let go; the room has not answered yet. */
  | { kind: 'sending'; since: number }
  /** The room relayed it to `to`; `heard` have started playing it. `unsure`: some cannot say. */
  | { kind: 'sent'; since: number; changed: number; id: number; to: readonly Seat[]; heard: readonly Seat[]; unsure: boolean }
  /** Nobody could hear it, nobody did, it never got there, or a press that sent nothing. */
  | { kind: Word; since: number };

export function sendStarted(now: number): SendStatus {
  return { kind: 'sending', since: now };
}

/** The room's echo. One that comes when nothing is being sent changes nothing. */
export function sendEchoed(s: SendStatus | null, e: VoiceEcho, now: number): SendStatus | null {
  if (s?.kind !== 'sending') return s;
  if (e.to === null) return { kind: 'sent', since: now, changed: now, id: e.id, to: [], heard: [], unsure: true };
  if (e.to.length === 0) return { kind: 'nobody', since: now };
  return { kind: 'sent', since: now, changed: now, id: e.id, to: [...e.to], heard: [], unsure: e.noReceipt.length > 0 };
}

/** A receipt: counted once, and only from a seat this very clip went to. */
export function sendHeard(s: SendStatus | null, id: number, by: Seat, now: number): SendStatus | null {
  if (s?.kind !== 'sent' || s.id !== id || !s.to.includes(by) || s.heard.includes(by)) return s;
  return { ...s, heard: [...s.heard, by], changed: now };
}

/** A press that sent nothing, and why. */
export function sendNoted(why: 'short' | 'denied' | 'failed', now: number): SendStatus {
  return { kind: why === 'short' ? 'tooShort' : why === 'denied' ? 'micDenied' : 'recordFailed', since: now };
}

/**
 * What the status has become by `now` (null: nothing left to say) and how
 * long until it changes by itself. No echo in time: it never got there. No
 * receipt in time from anyone who could give one: nobody heard it. Anything
 * else is said for STATUS_SHOW_MS after its last change.
 */
export function sendSettle(s: SendStatus | null, now: number): { status: SendStatus | null; nextIn: number | null } {
  const hold = (st: SendStatus, until: number) =>
    now >= until ? { status: null, nextIn: null } : { status: st, nextIn: until - now };
  if (s === null) return { status: null, nextIn: null };
  if (s.kind === 'sending') {
    const until = s.since + ECHO_WAIT_MS;
    return now >= until ? sendSettle({ kind: 'notSent', since: until }, now) : { status: s, nextIn: until - now };
  }
  if (s.kind === 'sent') {
    // Somebody has it, or some cannot say: nothing more is coming worth waiting for.
    if (s.heard.length > 0 || s.unsure) return hold(s, s.changed + STATUS_SHOW_MS);
    const until = s.since + RECEIPT_WAIT_MS;
    return now >= until ? sendSettle({ kind: 'unheard', since: until }, now) : { status: s, nextIn: until - now };
  }
  return hold(s, s.since + STATUS_SHOW_MS);
}

/** The words for it: `mode` picks the too-short line, `name` a seat's name. */
export function sendStatusText(
  ui: Lang['s']['ui'],
  s: SendStatus,
  mode: 'hold' | 'tap',
  name: (seat: Seat) => string,
): string {
  switch (s.kind) {
    case 'sending':
      return ui.voiceSending;
    case 'sent':
      return s.heard.length > 0 ? ui.voiceHeardBy(s.heard.map(name)) : ui.voiceSent;
    case 'nobody':
      return ui.voiceNobody;
    case 'unheard':
      return ui.voiceUnheard;
    case 'notSent':
      return ui.voiceNotSent;
    case 'tooShort':
      return mode === 'tap' ? ui.micTooShortTap : ui.micTooShort;
    case 'micDenied':
      return ui.micDenied;
    case 'recordFailed':
      return ui.micFailed;
  }
}
