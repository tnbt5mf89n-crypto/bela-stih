import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gainForLoudness, RECEIPT_WAIT_MS, recordingOptions, STALE_MS, VOICE_MAX_MS } from '../src/voice/voice';

/**
 * Voice clips, the 1.6.0 pass: the microphone in its communication mode, a
 * loudness header so a whisper and a shout arrive alike, the incoming queue
 * held while I speak, a separate voice volume, and a receipt that means
 * "heard to the end".
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const server = (p: string) => readFileSync(join(here, '../../server/src', p), 'utf8');

describe('the recorder', () => {
  it('opens the microphone in communication mode (echo cancelled, noise suppressed, gain controlled) and meters', () => {
    const o = recordingOptions(undefined);
    expect(o.android?.audioSource).toBe('voice_communication');
    expect(o.isMeteringEnabled).toBe(true);
    const r = src('voice/useVoiceRecorder.ts');
    // Sampled while recording, averaged into the take.
    expect(r).toMatch(/meters\.current\.push\(/);
    expect(r).toMatch(/loudness: meanDb\(meters\.current\)/);
  });
});

describe('the loudness header', () => {
  it('lifts a quiet clip and holds a loud one, within ±9 dB, and leaves a clip without one alone', () => {
    expect(gainForLoudness(undefined)).toBe(1);
    expect(gainForLoudness(-20)).toBeCloseTo(1, 5); // the target
    expect(gainForLoudness(-32)).toBeCloseTo(Math.pow(10, 9 / 20), 5); // +12 wanted, +9 given
    expect(gainForLoudness(-26)).toBeCloseTo(Math.pow(10, 6 / 20), 5);
    expect(gainForLoudness(-8)).toBeCloseTo(Math.pow(10, -9 / 20), 5); // -12 wanted, -9 given
    expect(gainForLoudness(Number.NaN)).toBe(1);
    expect(gainForLoudness(5)).toBeCloseTo(Math.pow(10, -9 / 20), 5);
  });

  it('travels with the clip and is relayed as a number in range, never anything else', () => {
    expect(src('net/useNetGame.ts')).toMatch(/loudness: take\.loudness/);
    expect(server('protocol.ts')).toMatch(/\| \{ type: 'voice'; ms: number; mime: string; data: Uint8Array; loudness\?: number \}/);
    const room = server('BelaRoom.ts');
    expect(room).toMatch(/const loudness = loudnessOf\(m\?\.loudness\);/);
    expect(room).toMatch(/\.\.\.\(loudness === undefined \? \{\} : \{ loudness \}\)/);
    const v = server('voice.ts');
    expect(v).toMatch(/export function loudnessOf\(v: unknown\): number \| undefined/);
    expect(src('voice/useVoicePlayback.ts')).toMatch(/gainForLoudness\(clip\.loudness\)/);
  });
});

describe('while I speak', () => {
  it('the queue is held and the game sounds dip, and both let go when the take ends', () => {
    const p = src('voice/useVoicePlayback.ts');
    expect(p).toMatch(/if \(current\.current \|\| held\.current\) return;/);
    expect(p).toMatch(/const hold = useCallback\(/);
    const o = src('net/OnlineGame.tsx');
    expect(o).toMatch(/playback\.hold\(mic\.phase === 'recording'\)/);
    expect(o).toMatch(/setMicDuck\(mic\.phase === 'recording'\)/);
    const a = src('audio.ts');
    expect(a).toMatch(/Math\.min\(clipDuck, micDuck\)/);
  });
});

describe('the voice volume', () => {
  it('is its own setting, applied to every clip', () => {
    expect(src('storage.ts')).toMatch(/voiceVolume: number;/);
    expect(readFileSync(join(here, '../App.tsx'), 'utf8')).toMatch(/setVoiceVolume\(settings\.voiceVolume\)/);
    expect(src('voice/useVoicePlayback.ts')).toMatch(/masterVolume\(\) \* voiceVolume\(\) \* gainForLoudness\(clip\.loudness\)/);
    expect(src('screens/SettingsScreen.tsx')).toMatch(/ui\.voiceVolumeLabel/);
  });
});

describe('a receipt', () => {
  it('means heard to the end, and the sender waits long enough for a queued clip to end', () => {
    const p = src('voice/useVoicePlayback.ts');
    expect(p).toMatch(/playClip\(src\.uri, [^,]+, \(\) => \{\s*onPlayedRef\.current\?\.\(clip\.id\);\s*stop\(\);\s*\}\)/);
    expect(p).not.toMatch(/\(\) => onPlayedRef\.current\?\.\(clip\.id\)\)/);
    expect(RECEIPT_WAIT_MS).toBeGreaterThanOrEqual(STALE_MS + VOICE_MAX_MS);
  });

  it('the words fit: the microphone is used only while a message is recorded, and Safari records WebM from 18.4', () => {
    const app = JSON.parse(readFileSync(join(here, '../app.json'), 'utf8')) as { expo: { plugins: unknown[] } };
    const text = JSON.stringify(app.expo.plugins);
    expect(text).toMatch(/only while you record a voice message/);
    expect(text).not.toMatch(/hold the voice message button/);
    expect(src('voice/voice.ts')).toMatch(/Safari before 18\.4/);
  });
});
