import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { gainForLoudness, meanDb, RECEIPT_WAIT_MS, recordingOptions, STALE_MS, VOICE_MAX_MS } from '../src/voice/voice';

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
    // Sampled while recording, averaged into the take - by voice.ts's meanDb (below), not a copy of its own.
    expect(r).toMatch(/meters\.current\.push\(/);
    expect(r).toMatch(/loudness: meanDb\(meters\.current\)/);
    expect(r).not.toMatch(/function meanDb/);
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

  it('is not dragged down by the -160 a recorder reports for no signal (Android: every first reading)', () => {
    // A 1 s take spoken at -12 dBFS: Android's first getMaxAmplitude() is 0, which expo-audio reports as -160.
    expect(meanDb([-160, -12, -12, -12])).toBeCloseTo(-12, 5);
    expect(gainForLoudness(meanDb([-160, -12, -12, -12]))).toBeCloseTo(Math.pow(10, -8 / 20), 5);
    // Nothing heard, or nothing sampled: no header, so no change.
    expect(meanDb([-160, -160])).toBeUndefined();
    expect(meanDb([])).toBeUndefined();
    // A real level, however quiet, still counts.
    expect(meanDb([-80, -40])).toBeCloseTo(-60, 5);
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
    // The screen closing mid-take (leave, back): the duck is module state and would outlive it.
    expect(o).toMatch(/useEffect\(\(\) => \(\) => setMicDuck\(false\), \[\]\)/);
    const a = src('audio.ts');
    expect(a).toMatch(/Math\.min\(clipDuck, micDuck\)/);
  });

  it('the levels stop being sampled when the screen closes mid-take', () => {
    // In the recorder's unmount cleanup, before its phase check: nothing else stops it for a take the
    // screen closes on (a tapped take gets no finish(); a held one's finish(true) from MicButton comes
    // after this cleanup, finds the phase idle, and returns before its own stopMetering()).
    expect(src('voice/useVoiceRecorder.ts')).toMatch(
      /\(\) => \(\) => \{\s*if \(limit\.current\) clearTimeout\(limit\.current\);(?:\s*\/\/.*)*\s*stopMetering\(\);\s*holding\.current = false;\s*if \(phaseRef\.current !== 'recording'\) return;/,
    );
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
    expect(p).toMatch(/playClip\(src\.uri, [^,]+, \(heard\) => \{\s*if \(heard\) onPlayedRef\.current\?\.\(clip\.id\);\s*stop\(\);\s*\}\)/);
    expect(p).not.toMatch(/\(\) => onPlayedRef\.current\?\.\(clip\.id\)\)/);
    expect(RECEIPT_WAIT_MS).toBeGreaterThanOrEqual(STALE_MS + VOICE_MAX_MS);
  });

  it('never for a clip a browser could not play: undecodable, broken or refused, it ends at once, unheard', async () => {
    let behave: 'ok' | 'refused' | 'undecodable' | 'broken' = 'ok';
    // An <audio> element as the HTML spec (and Chromium) has it. Refused (a page nobody has touched):
    // play() rejects, NotAllowedError. Undecodable: 'error' fires, THEN the pending play() rejects,
    // NotSupportedError. Broken mid-clip: play() had resolved, and 'error' fires. None of them 'ended'.
    class FakeAudio extends EventTarget {
      paused = true;
      muted = false;
      volume = 1;
      preload = '';
      src = '';
      removeAttribute() {
        this.src = '';
      }
      pause() {}
      load() {}
      play() {
        if (behave === 'refused') return Promise.reject(new DOMException('', 'NotAllowedError'));
        if (behave === 'undecodable') {
          return new Promise<void>((_, reject) =>
            setTimeout(() => {
              this.dispatchEvent(new Event('error'));
              reject(new DOMException('', 'NotSupportedError'));
            }),
          );
        }
        setTimeout(() => this.dispatchEvent(new Event(behave === 'broken' ? 'error' : 'ended')));
        return Promise.resolve();
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    try {
      const { playClip } = await import('../src/voice/clipPlayer.web');
      const run = async (b: typeof behave) => {
        behave = b;
        const heard: boolean[] = [];
        playClip('blob:clip', 1, (h) => heard.push(h));
        await new Promise((r) => setTimeout(r, 20));
        return heard;
      };
      expect(await run('ok')).toEqual([true]);
      expect(await run('refused')).toEqual([false]);
      expect(await run('undecodable')).toEqual([false]);
      expect(await run('broken')).toEqual([false]);
      expect(await run('ok')).toEqual([true]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('on a phone, for a clip played to its end', async () => {
    const listeners: ((s: { playing?: boolean; didJustFinish?: boolean }) => void)[] = [];
    const player = {
      volume: 1,
      play() {},
      pause() {},
      release() {},
      addListener(_e: string, l: (s: { playing?: boolean; didJustFinish?: boolean }) => void) {
        listeners.push(l);
        return { remove() {} };
      },
    };
    vi.doMock('expo-audio', () => ({ createAudioPlayer: () => player }));
    try {
      const { playClip } = await import('../src/voice/clipPlayer');
      const heard: boolean[] = [];
      playClip('file:///cache/voice-5-2.m4a', 1, (h) => heard.push(h));
      listeners[0]!({ playing: true });
      expect(heard).toEqual([]);
      listeners[0]!({ didJustFinish: true });
      expect(heard).toEqual([true]);
    } finally {
      vi.doUnmock('expo-audio');
    }
  });

  it('the words fit: the microphone is used only while a message is recorded, and Safari records WebM from 18.4', () => {
    const app = JSON.parse(readFileSync(join(here, '../app.json'), 'utf8')) as { expo: { plugins: unknown[] } };
    const text = JSON.stringify(app.expo.plugins);
    expect(text).toMatch(/only while you record a voice message/);
    expect(text).not.toMatch(/hold the voice message button/);
    expect(src('voice/voice.ts')).toMatch(/Safari before 18\.4/);
  });
});
