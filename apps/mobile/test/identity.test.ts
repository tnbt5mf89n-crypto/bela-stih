import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blocksEither, cleanBlockList, cleanInstallId, publishedId } from '../../server/src/identity';
import { BANNED_CODE, BLOCKED_CODE, BLOCK_LIST_MAX, INSTALL_ID_RE, MAINTENANCE_CODE } from '../../server/src/protocol';
import { BANNED_CODE as APP_BANNED, BLOCKED_CODE as APP_BLOCKED, MAINTENANCE_CODE as APP_MAINTENANCE } from '../src/net/proto';

/**
 * Install IDs and block lists: what the door accepts, what a table sees of an
 * ID (a one-way digest, never the ID), that the server logs neither, and the
 * one rule that follows from them - two people who have blocked each other
 * are never seated together in quick play and never reach each other with a
 * clip, an emote or a gift.
 */

const here = dirname(fileURLToPath(import.meta.url));
const server = (f: string) => readFileSync(join(here, '../../server/src', f), 'utf8');
const room = server('BelaRoom.ts');
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

  it('a table sees a one-way digest of the ID, shaped like one, and never the ID itself', () => {
    const p = publishedId(A);
    expect(p).toMatch(INSTALL_ID_RE);
    expect(p).not.toBe(A);
    // Blocks kept on phones and bans in config.json hold these values: the digest can never change.
    expect(p).toBe('3ba3f5f43b92602683c19aee62a20342');
    expect(publishedId(B)).not.toBe(p);
    // Sending a digest seen at a table gets the digest of it, never the seat it was copied from.
    expect(publishedId(p)).not.toBe(p);
    expect(publishedId('')).toBe('');
    // What an app keeps and sends back, a list of digests, passes the door as it is.
    expect([...cleanBlockList([p])]).toEqual([p]);
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
    // The ID the app sent stops at the door: the ban check, the blocks and the seat all hold its digest.
    expect(auth).toMatch(/const installId = publishedId\(cleanInstallId\(id\?\.installId\)\);/);
    expect(room.match(/cleanInstallId\(/g)).toHaveLength(1);
    expect(auth).toMatch(/cfg\.banned\.has\(installId\)/);
    expect(auth).toMatch(/return \{ origin, installId, blocked \};/);
    expect(auth).toMatch(/this\.isPublic[\s\S]*blocksEither\(me, o\)[\s\S]*BLOCKED_CODE/);
    // Held seats count too: `sessionId !== null`, not `connected`.
    expect(auth).toMatch(/o\.sessionId !== null && blocksEither\(me, o\)/);
    // Every relay asks reaches(): clips, emotes, gifts.
    const voice = room.slice(room.indexOf("packet.type === 'voice'"), room.indexOf("packet.type === 'heard'"));
    expect(voice).toMatch(/!this\.reaches\(seat, s\)/);
    const emote = room.slice(room.indexOf("packet.type === 'emote'"), room.indexOf("packet.type === 'voice'"));
    expect(emote).toMatch(/this\.reaches\(seat, s\)/);
    expect(emote).not.toMatch(/this\.broadcast\(MSG\.emote/);
    const gift = room.slice(room.indexOf("packet.type === 'gift'"), room.indexOf('private afterMove()'));
    expect(gift).toMatch(/this\.seesGifts\(t\) && this\.reaches\(seat, t\)/);
    // And it is delivered as an emote is, never to the whole room: a gift between two others
    // must not fly past someone who blocked either of them.
    expect(room).not.toMatch(/this\.broadcast\(MSG\.gift/);
    expect(gift).toMatch(/!this\.reaches\(seat, s\)\) continue;\s*other\.send\(MSG\.gift, msg\);/);
    // The digest goes out with the seat (it is what a block or a report names); the list never.
    const seatInfo = room.slice(room.indexOf('private seatInfo()'), room.indexOf('private publish()'));
    expect(seatInfo).toMatch(/installId: o\.installId/);
    expect(seatInfo).not.toMatch(/blocked/);
  });

  it('logs neither: every line the server process can print is pinned', () => {
    // The process is index.ts and what it imports, followed file by file; the smoke, fill and
    // transcript tools are its clients. A new print fails here, whatever it prints, until read.
    const runtime = new Set<string>();
    const visit = (f: string): void => {
      if (runtime.has(f)) return;
      runtime.add(f);
      for (const m of server(f).matchAll(/(?:from|import)\s*\(?\s*'\.\/([^']+)'/g)) visit(`${m[1]!.replace(/\.[jt]s$/, '')}.ts`);
    };
    visit('index.ts');
    for (const f of ['BelaRoom.ts', 'identity.ts', 'config.ts']) expect(runtime.has(f), f).toBe(true);
    const prints = [...runtime].sort().flatMap((f) =>
      server(f).split('\n').filter((l) => /\bconsole\b|process\.std(out|err)/.test(l)).map((l) => `${f}: ${l.trim()}`),
    );
    expect(prints).toEqual([
      "BelaRoom.ts: console.error(`[bela] message ${String(type)} failed:`, err);",
      "BelaRoom.ts: console.error('[bela] next-deal timer failed:', err);",
      "BelaRoom.ts: console.error('[bela] hold timer failed:', err);",
      "BelaRoom.ts: console.error('[bela] turn timer failed:', err);",
      "config.ts: if (JSON.stringify(before) !== JSON.stringify(after)) console.log(`[bela] config (${from}): ${JSON.stringify(after)}`);",
      "config.ts: console.error(`[bela] ${lastError}`);",
      "config.ts: if (msg !== lastError) console.error(`[bela] config ${from}: ${msg} (keeping the last one)`);",
      "index.ts: console.error('[bela] uncaught exception (server stays up):', err);",
      "index.ts: console.error('[bela] unhandled rejection (server stays up):', reason);",
      "index.ts: .then(() => console.log(`[bela] listening on :${PORT}`))",
      "index.ts: console.error('[bela] failed to start', err);",
    ]);
    // That config line, and /health, say how many bans there are, never which.
    const cfg = server('config.ts');
    const summary = cfg.slice(cfg.indexOf('function summary('), cfg.indexOf('export function configStatus('));
    expect(summary.match(/c\.banned(\.\w+)?/g)).toEqual(['c.banned.size']);
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
