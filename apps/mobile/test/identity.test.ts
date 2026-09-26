import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blocksEither, cleanBlockList, cleanInstallId } from '../../server/src/identity';
import { BANNED_CODE, BLOCKED_CODE, BLOCK_LIST_MAX, INSTALL_ID_RE, MAINTENANCE_CODE } from '../../server/src/protocol';
import { BANNED_CODE as APP_BANNED, BLOCKED_CODE as APP_BLOCKED, MAINTENANCE_CODE as APP_MAINTENANCE } from '../src/net/proto';

/**
 * Install IDs and block lists: what the door accepts, and the one rule that
 * follows from them - two people who have blocked each other are never seated
 * together in quick play and never reach each other with a clip, an emote or
 * a gift.
 */

const here = dirname(fileURLToPath(import.meta.url));
const room = readFileSync(join(here, '../../server/src/BelaRoom.ts'), 'utf8');
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

describe('identity at the door', () => {
  it('takes only a well-formed install ID, and at most BLOCK_LIST_MAX well-formed blocks', () => {
    expect(cleanInstallId(A)).toBe(A);
    for (const bad of ['', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 12, null, { a: 1 }]) expect(cleanInstallId(bad)).toBe('');
    expect([...cleanBlockList([A, 'junk', B, A])]).toEqual([A, B]);
    expect(cleanBlockList('not a list').size).toBe(0);
    const many = Array.from({ length: BLOCK_LIST_MAX + 3 }, (_, i) => i.toString(16).padStart(32, '0'));
    expect(cleanBlockList(many).size).toBe(BLOCK_LIST_MAX);
    expect(INSTALL_ID_RE.test(A)).toBe(true);
  });

  it('blocks either way, and an app without an ID can block but cannot be blocked', () => {
    const me = { installId: A, blocked: new Set([B]) };
    const them = { installId: B, blocked: new Set<string>() };
    expect(blocksEither(me, them)).toBe(true);
    expect(blocksEither(them, me)).toBe(true);
    expect(blocksEither({ installId: A, blocked: new Set() }, { installId: B, blocked: new Set() })).toBe(false);
    // No ID: nobody's list can name it.
    expect(blocksEither({ installId: '', blocked: new Set() }, { installId: B, blocked: new Set([A]) })).toBe(false);
    // But it can keep others away.
    expect(blocksEither({ installId: '', blocked: new Set([B]) }, them)).toBe(true);
  });

  it('the app and the server agree on the codes', () => {
    expect(APP_BLOCKED).toBe(BLOCKED_CODE);
    expect(APP_BANNED).toBe(BANNED_CODE);
    expect(APP_MAINTENANCE).toBe(MAINTENANCE_CODE);
    expect(new Set([BLOCKED_CODE, BANNED_CODE, MAINTENANCE_CODE, 4300, 4301]).size).toBe(5);
  });

  it('the room seats nobody against a block at a public table, and relays nothing across one anywhere', () => {
    const auth = room.slice(room.indexOf('override onAuth('), room.indexOf('override onJoin('));
    expect(auth).toMatch(/this\.isPublic[\s\S]*blocksEither\(me, o\)[\s\S]*BLOCKED_CODE/);
    // Held seats count too: `sessionId !== null`, not `connected`.
    expect(auth).toMatch(/o\.sessionId !== null && blocksEither\(me, o\)/);
    // Every relay asks reaches(): clips, emotes, gifts.
    const voice = room.slice(room.indexOf("packet.type === 'voice'"), room.indexOf("packet.type === 'heard'"));
    expect(voice).toMatch(/!this\.reaches\(seat, s\)/);
    const emote = room.slice(room.indexOf("packet.type === 'emote'"), room.indexOf("packet.type === 'voice'"));
    expect(emote).toMatch(/this\.reaches\(seat, s\)/);
    expect(emote).not.toMatch(/this\.broadcast\(MSG\.emote/);
    const gift = room.slice(room.indexOf("packet.type === 'gift'"), room.indexOf("packet.type === 'gift'") + 2500);
    expect(gift).toMatch(/this\.seesGifts\(t\) && this\.reaches\(seat, t\)/);
    // The ID goes out with the seat (it is what a block or a report names); the list never, and neither is logged.
    const seatInfo = room.slice(room.indexOf('private seatInfo()'), room.indexOf('private publish()'));
    expect(seatInfo).toMatch(/installId: o\.installId/);
    expect(seatInfo).not.toMatch(/blocked/);
    expect(room).not.toMatch(/console\.(log|error)\([^)]*(installId|blocked)/);
  });

  it('stranger clips need a receive opt-in at a public table, and an older app counts as not opted in', () => {
    const hears = room.slice(room.indexOf('private hearsVoice('), room.indexOf('private hearsVoice(') + 400);
    expect(hears).toMatch(/!this\.isPublic \|\| \(o\.voiceIn && config\(\)\.strangerClips\)/);
    expect(room).toMatch(/voiceIn: false/); // vacant()
    const voiceIn = room.slice(room.indexOf("packet.type === 'voiceIn'"), room.indexOf("packet.type === 'voiceIn'") + 900);
    expect(voiceIn).toMatch(/if \(on && !o\.speaksVoice\) return;/);
    expect(voiceIn).toMatch(/o\.voiceIn = on;/);
  });
});
