import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkClip,
  VOICE_BUDGET_MS,
  VOICE_BYTES_PER_MS,
  VOICE_GAP_MS,
  VOICE_HEADER_BYTES,
  VOICE_LEDGER_MAX,
  VOICE_RECEIPT_MS,
  VoiceLedger,
  VoiceLimiter,
} from '../../server/src/voice';
import { MAX_FRAME_BYTES, VOICE_MAX_BYTES, VOICE_MAX_MS, VOICE_MIMES, VOICE_MIN_BYTES } from '../../server/src/protocol';

/**
 * The room's side of push-to-talk: what clip it relays, how often, and to
 * whom. A clip is relayed and dropped - nothing stores, decodes or logs it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const server = (p: string) => readFileSync(join(here, '../../server/src', p), 'utf8');

/** An MP4's first box ('ftyp' at byte 4), padded to `size`. */
const mp4 = (size = 4000) => {
  const b = new Uint8Array(size);
  b.set([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
  return b;
};
/** A WebM's EBML magic, padded. */
const webm = (size = 4000) => {
  const b = new Uint8Array(size);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
};

describe('a clip the room relays', () => {
  it('is AAC-in-MP4 or a WebM, as its first bytes say, of a sane size and length', () => {
    expect(checkClip('audio/mp4', mp4(), 3000)).toEqual({ mime: 'audio/mp4', data: mp4(), ms: 3000 });
    expect(checkClip('audio/webm', webm(), 3000)?.mime).toBe('audio/webm');
    // A name that lies about the bytes.
    expect(checkClip('audio/mp4', webm(), 3000)).toBeNull();
    expect(checkClip('audio/webm', mp4(), 3000)).toBeNull();
    // Anything else it is not.
    expect(checkClip('text/plain', mp4(), 3000)).toBeNull();
    expect(checkClip('audio/mp4', 'AAAA', 3000)).toBeNull();
    expect(checkClip('audio/mp4', [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70], 3000)).toBeNull();
    expect(checkClip('audio/mp4', mp4(VOICE_MIN_BYTES - 1), 3000)).toBeNull();
    expect(checkClip('audio/mp4', mp4(VOICE_MAX_BYTES + 1), 3000)).toBeNull();
    expect(checkClip('audio/mp4', mp4(VOICE_MAX_BYTES), 4000)).not.toBeNull();
    expect(checkClip('audio/mp4', mp4(), VOICE_MAX_MS + 501)).toBeNull();
    expect(checkClip('audio/mp4', mp4(), VOICE_MAX_MS + 400)?.ms).toBe(VOICE_MAX_MS + 400);
    expect(checkClip('audio/mp4', mp4(), 100)).toBeNull();
    expect(checkClip('audio/mp4', mp4(), Number.NaN)).toBeNull();
    expect(checkClip('audio/mp4', mp4(), '3000')).toBeNull();
    expect([...VOICE_MIMES]).toEqual(['audio/mp4', 'audio/webm']);
  });

  it('carries no more bytes than the length it claims allows, so the allowance cannot be cheated', () => {
    // 30 KB is seconds of speech: as "0.4 s" it would slip past the limiter ten times over.
    expect(checkClip('audio/mp4', mp4(30_000), 400)).toBeNull();
    const at = (ms: number) => VOICE_HEADER_BYTES + ms * VOICE_BYTES_PER_MS;
    expect(checkClip('audio/mp4', mp4(at(1000)), 1000)).not.toBeNull();
    expect(checkClip('audio/mp4', mp4(at(1000) + 1), 1000)).toBeNull();
    // What the recorders here really make passes with room: 24 kbps asked for
    // (3 bytes a ms), and a browser's MP4 recorder at 96 kbps (12) that ignores it.
    expect(checkClip('audio/mp4', mp4(1200 + 400 * 12), 400)).not.toBeNull();
    expect(checkClip('audio/webm', webm(1200 + 15_000 * 3), 15_000)).not.toBeNull();
    // The real phone take from the device checks: 10421 bytes for 3 s.
    expect(checkClip('audio/mp4', mp4(10_421), 3000)).not.toBeNull();
  });

  it('fits a frame the transport takes, with room for its envelope', () => {
    expect(MAX_FRAME_BYTES).toBeGreaterThanOrEqual(VOICE_MAX_BYTES + 16 * 1024);
    // ...and the server is really built with it: the default 4 KB closed the socket.
    expect(server('index.ts')).toMatch(/new WebSocketTransport\(\{ server: httpServer, maxPayload: MAX_FRAME_BYTES \}\)/);
  });
});

describe("one connection's allowance", () => {
  it('takes clips a second apart, and no more than a minute of audio a minute', () => {
    const l = new VoiceLimiter();
    expect(l.take(0, 5000)).toBe(true);
    expect(l.take(VOICE_GAP_MS - 1, 5000)).toBe(false);
    expect(l.take(VOICE_GAP_MS, 5000)).toBe(true);
    // Fill the minute: 10 s used, then three 15 s clips at 2, 17 and 32 s: 55 s.
    for (const t of [2000, 17_000, 32_000]) expect(l.take(t, 15_000)).toBe(true);
    // At 47 s a 15 s clip would go over the minute; a 5 s one fits exactly.
    expect(l.take(47_000, 15_000)).toBe(false);
    expect(l.take(47_000, 5000)).toBe(true);
    // At 61 s the two 5 s clips have left the window (a minute old), the one
    // sent at 2 s has not: 50 s used, no room for 15.
    expect(l.take(61_000, 15_000)).toBe(false);
    // At 62 s it has gone too: 35 s used, room again.
    expect(l.take(62_000, 15_000)).toBe(true);
    expect(VOICE_BUDGET_MS).toBe(60_000);
  });

  it('a refused clip costs nothing', () => {
    const l = new VoiceLimiter();
    expect(l.take(0, 15_000)).toBe(true);
    expect(l.take(10, 15_000)).toBe(false);
    expect(l.take(1000, 15_000)).toBe(true);
  });
});

describe('receipts', () => {
  it('are believed only from a seat the clip went to, once, and told to its speaker', () => {
    const l = new VoiceLedger();
    l.sent(1, 'speaker', ['a', 'b'], 0);
    expect(l.heard(1, 'a', 100)).toBe('speaker');
    expect(l.heard(1, 'a', 200)).toBeNull();
    expect(l.heard(1, 'c', 200)).toBeNull();
    expect(l.heard(1, 'speaker', 200)).toBeNull();
    expect(l.heard(2, 'a', 200)).toBeNull();
    expect(l.heard('1', 'b', 200)).toBeNull();
    expect(l.heard(1, 'b', 300)).toBe('speaker');
  });

  it('are forgotten after a minute, and never pile up', () => {
    const l = new VoiceLedger();
    l.sent(1, 's', ['a'], 0);
    expect(l.heard(1, 'a', VOICE_RECEIPT_MS)).toBeNull();
    l.sent(2, 's', ['a'], 0);
    expect(l.heard(2, 'a', VOICE_RECEIPT_MS - 1)).toBe('s');
    const m = new VoiceLedger();
    for (let i = 0; i <= VOICE_LEDGER_MAX; i++) m.sent(i, 's', ['a'], 5);
    expect(m.heard(0, 'a', 6)).toBeNull();
    expect(m.heard(1, 'a', 6)).toBe('s');
    expect(m.heard(VOICE_LEDGER_MAX, 'a', 6)).toBe('s');
  });

  it("reach the speaker only if the speaker's app reads them, and never call a player back", () => {
    const room = server('BelaRoom.ts');
    const heard = room.slice(room.indexOf("if (packet.type === 'heard') {"), room.indexOf("if (packet.type === 'hears') {"));
    expect(heard).toMatch(/const speakerId = this\.voiceLedger\.heard\(/);
    expect(heard).toMatch(/if \(speakerSeat === null \|\| !speaker \|\| !this\.occupants\[speakerSeat\]!\.receipts\) return;/);
    expect(heard).toMatch(/speaker\.send\(MSG\.voiceHeard, heard\);/);
    expect(heard).not.toMatch(/broadcast|console\./);
    expect(room).toMatch(/receipts: options\.receipts === true,/);
    expect(room).toMatch(/this\.voiceLedger\.sent\(id, client\.sessionId, sessions, Date\.now\(\)\);/);
    expect(room).toMatch(/if \(!this\.occupants\[s\]!\.receipts\) noReceipt\.push\(s\);/);
  });
});

describe('the room', () => {
  const room = server('BelaRoom.ts');
  const relay = room.slice(room.indexOf("if (packet.type === 'voice') {"), room.indexOf("if (packet.type === 'gift') {"));

  it('relays only where voice is on, from an app that records, what checkClip takes, within the allowance', () => {
    expect(relay).toMatch(/if \(!this\.voiceOn \|\| !config\(\)\.voice \|\| !this\.occupants\[seat\]!\.voice\) return;/);
    expect(relay).toMatch(/const clip = checkClip\(m\?\.mime, m\?\.data, m\?\.ms\);\s*if \(clip === null\) return;/);
    expect(relay).toMatch(/if \(!limiter\.take\(Date\.now\(\), clip\.ms\)\) return;/);
  });

  it('sends the clip to the others whose apps play it, and the speaker only an echo without it', () => {
    expect(relay).toMatch(/if \(s === null \|\| s === seat \|\| !this\.hearsVoice\(s\) \|\| !this\.reaches\(seat, s\)\) continue;\s*other\.send\(MSG\.voice, out\);/);
    expect(relay).toMatch(
      /const echo: VoiceMessage = \{ from: seat, id, ms: clip\.ms, mime: clip\.mime, to, \.\.\.\(noReceipt\.length > 0 \? \{ noReceipt \} : \{\}\) \};\s*client\.send\(MSG\.voice, echo\);/,
    );
    expect(relay).not.toMatch(/broadcast/);
    // Nothing keeps it, nothing prints it.
    expect(relay).not.toMatch(/console\./);
    expect(room).toMatch(/return o\.sessionId !== null && o\.connected && o\.voice && \(!this\.isPublic \|\| \(o\.voiceIn && config\(\)\.strangerClips\)\);/);
  });

  it("hears a player's Settings switch, from an app that can do voice, without calling them back", () => {
    const hears = room.slice(room.indexOf("if (packet.type === 'hears') {"), room.indexOf("if (packet.type === 'gift') {"));
    expect(hears).toMatch(/if \(typeof on !== 'boolean'\) return;\s*if \(on && !o\.speaksVoice\) return;\s*o\.voice = on;\s*return;/);
    // Nothing published: a toggling client costs the table nothing.
    expect(hears).not.toMatch(/this\.(publish|broadcast)\(/);
    expect(room).toMatch(/speaksVoice: typeof options\.voice === 'boolean',/);
    expect(room).toMatch(/gifts: false, voice: false, speaksVoice: false, receipts: false, proto: 0, installId: '', blocked: new Set\(\), voiceIn: false \}\);/);
  });

  it('lets a private table\'s host switch voice off before the start, and quick play keep it', () => {
    expect(room).toMatch(/private voiceOn = true;/);
    const rules = room.slice(room.indexOf("if (packet.type === 'rules') {"), room.indexOf("if (packet.type === 'pause') {"));
    expect(rules).toMatch(/if \(this\.started \|\| this\.isPublic \|\| seat !== this\.actingHostSeat\(\)\) return;\s*\/\/[^\n]*\n\s*const voiceChanged = typeof m\?\.voice === 'boolean'/);
    expect(room).toMatch(/\.\.\.\(this\.voiceLive\(\) \? \{ voice: true as const \} : \{\}\),/);
    expect(room).toMatch(/return this\.voiceOn && config\(\)\.voice && \(!this\.isPublic \|\| config\(\)\.strangerClips\);/);
  });

  it('forgets a connection that has gone for good, voice allowance and all', () => {
    expect(room).toMatch(/private release\(seat: Seat\): void \{\s*const wasHost = [^\n]*\n\s*this\.forget\(this\.occupants\[seat\]!\.sessionId\);/);
    const forget = room.slice(room.indexOf('private forget('), room.indexOf('private forget(') + 500);
    for (const map of ['lastEmoteAt', 'lastSitAt', 'lastVoteAt', 'lastGiftAt', 'voiceLimits']) expect(forget).toContain(`this.${map}.delete(sessionId)`);
  });
});
