import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import WsWebSocket from 'ws';
import type { Room } from 'colyseus.js';
import { BANNED_CODE, BLOCKED_CODE, MSG, ROOM_NAME_MODES, type EmoteMessage, type GiftMessage, type RoomMessage, type VoiceMessage } from './protocol';
import { publishedId } from './identity';

/**
 * Install IDs, blocks, bans and the stranger-clip opt-in, against a live server:
 *
 *   npx tsx src/identity-smoke.ts                               # spawns its own server with a ban list
 *   SERVER_URL=wss://belastih.com npx tsx src/identity-smoke.ts  # production
 *
 * - a table shows a digest of each app's install ID, never the ID, and an
 *   app that presents a digest it saw sits down under a different one;
 * - a public table where somebody has blocked you (or you them) refuses the
 *   seat with BLOCKED_CODE, held seats included; a stranger with no ID is fine;
 * - a banned install ID is refused at the door with BANNED_CODE, and a ban
 *   from a report about an impostor never refuses the player it copied (own
 *   server only);
 * - at a public table a clip reaches only the seats that said `voiceIn` -
 *   an app that joined with voice on but never opted in hears nothing;
 * - at a private table a block still stops clips, emotes and gifts both ways
 *   (a gift to a third player is not delivered across it either), and a gift
 *   with nobody left to reach is dropped without an echo.
 *
 * Several seats at one PUBLIC table from one machine meet the room's own
 * one-seat-per-network rule (4300) before anything else. Against its own
 * server this smoke therefore gives every client its own X-Real-IP on the
 * socket's upgrade - there is no caddy in between to overwrite it. Against
 * production the same spoof must be IGNORED (caddy sets the real address), so
 * there the public-table part is exactly one check: a second seat from here
 * is refused with 4300, whatever the header says.
 */

const OWN_PORT = 25999;
/** BelaRoom's refusal of a second seat from one network at a public table. */
const SAME_ORIGIN_CODE = 4300;
const newId = () => randomBytes(16).toString('hex');

// The address each client claims to come from. Colyseus reads the address off
// both the matchmake HTTP call and the socket upgrade (X-Real-IP first), so the
// header goes on both: colyseus.js posts through the global fetch and opens its
// socket through globalThis.WebSocket - both bound when the SDK loads, which
// is why the swap comes before the import.
let claimedIp = '10.1.0.1';
class SpoofingWebSocket extends WsWebSocket {
  constructor(url: string | URL, protocols?: string | string[] | WsWebSocket.ClientOptions) {
    // ws takes an object second argument as its options: merge the header into whatever the SDK passed.
    const isProto = typeof protocols === 'string' || Array.isArray(protocols);
    const opts = (!isProto && protocols && typeof protocols === 'object' ? protocols : {}) as WsWebSocket.ClientOptions;
    super(url, isProto ? (protocols as string | string[]) : undefined, { ...opts, headers: { ...(opts.headers ?? {}), 'x-real-ip': claimedIp } });
  }
}
(globalThis as { WebSocket: unknown }).WebSocket = SpoofingWebSocket;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const headers = new Headers(init?.headers ?? {});
  headers.set('x-real-ip', claimedIp);
  return realFetch(input, { ...init, headers });
}) as typeof fetch;
const { Client } = await import('colyseus.js');

interface Side {
  room: Room;
  last: RoomMessage | null;
  clips: VoiceMessage[];
  emotes: EmoteMessage[];
  gifts: GiftMessage[];
}

function side(room: Room): Side {
  const s: Side = { room, last: null, clips: [], emotes: [], gifts: [] };
  room.onMessage(MSG.room, (m: RoomMessage) => (s.last = m));
  room.onMessage(MSG.voice, (m: VoiceMessage) => s.clips.push(m));
  room.onMessage(MSG.emote, (m: EmoteMessage) => s.emotes.push(m));
  room.onMessage(MSG.gift, (m: GiftMessage) => s.gifts.push(m));
  room.onMessage('*', () => {});
  room.onError(() => {});
  return s;
}

function mp4(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
  for (let i = 12; i < size; i++) b[i] = 7;
  return b;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`[identity-smoke] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

/** The refusal code of a join, or null when it was let in (and left again). */
async function refusedWith(p: Promise<Room>): Promise<number | null> {
  try {
    const room = await p;
    await room.leave(true);
    return null;
  } catch (e) {
    return (e as { code?: number }).code ?? -1;
  }
}

async function ownServer(banned: string[]): Promise<ChildProcess> {
  const root = process.cwd().replace(/[\\/]apps[\\/]server$/, '');
  const child = spawn(process.execPath, [`${root}/node_modules/tsx/dist/cli.mjs`, `${root}/apps/server/src/index.ts`], {
    cwd: root,
    env: { ...process.env, PORT: String(OWN_PORT), CONFIG_JSON: JSON.stringify({ banned }) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', (d) => process.stderr.write(`[own server] ${d}`));
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${OWN_PORT}/health`);
      if (res.ok) return child;
    } catch {
      // not yet
    }
    await wait(200);
  }
  child.kill();
  throw new Error('the own server never answered /health');
}

async function main(): Promise<void> {
  const banned = newId();
  // A player whose published ID an impostor copies from a table and sends as its own.
  const victim = newId();
  let own: ChildProcess | null = null;
  let endpoint = process.env.SERVER_URL ?? '';
  if (!endpoint) {
    // A ban lists what a report names, a digest: the banned app's, and the one a
    // table shows for the impostor (what a report about the impostor names).
    own = await ownServer([publishedId(banned), publishedId(publishedId(victim))]);
    endpoint = `ws://127.0.0.1:${OWN_PORT}`;
  }
  const client = new Client(endpoint);
  const a = newId();
  const b = newId();
  const base = { gifts: true, voice: true, receipts: true, proto: 1, appVersion: 'smoke' };
  let n = 1;
  const fromNewAddress = () => {
    claimedIp = `10.1.0.${++n}`;
  };

  try {
    if (own) {
      // --- a public table, and the block both ways ---
      // A keeps B as an app does: by the digest an earlier table showed for B.
      fromNewAddress();
      const host = side(await client.create(ROOM_NAME_MODES, { ...base, name: 'A', installId: a, blocked: [publishedId(b)] }));
      await wait(300);
      check(host.last?.private === undefined, 'the table is public');
      check(host.last?.voiceOptIn === true, 'and says stranger clips need an opt-in');
      const code = host.room.roomId;
      fromNewAddress();
      check((await refusedWith(client.joinById(code, { ...base, name: 'B', installId: b }))) === BLOCKED_CODE, `B, whom A blocked, is refused (${BLOCKED_CODE})`);
      const shownA = host.last?.seats.find((s) => s.name === 'A')?.installId ?? '';
      fromNewAddress();
      check((await refusedWith(client.joinById(code, { ...base, name: 'D', installId: newId(), blocked: [shownA] }))) === BLOCKED_CODE, 'D, who blocked A by what the table shows for A, is refused too');
      fromNewAddress();
      const c = side(await client.joinById(code, { ...base, name: 'C', installId: newId() }));
      await wait(300);
      check(c.last !== null, 'C, a stranger with an ID nobody blocked, sits down');
      fromNewAddress();
      const noId = side(await client.joinById(code, { ...base, name: 'N' }));
      await wait(300);
      check(noId.last !== null, 'and so does an app with no ID');

      // --- the stranger-clip opt-in ---
      const cSeat = c.last!.seats.findIndex((s) => s.name === 'C');
      check(!c.last!.seats[cSeat]!.hearsVoice, 'C joined with voice on but has not opted in: the table says C does not hear');
      host.room.send('voice', { ms: 500, mime: 'audio/mp4', data: mp4(1200) });
      await wait(500);
      check(c.clips.length === 0, 'so a clip from A does not reach C');
      check(noId.clips.length === 0, 'nor the app without an ID');
      check(host.clips.length === 1 && JSON.stringify(host.clips[0]?.to) === '[]', "and A's echo says it went to nobody");
      c.room.send('voiceIn', { on: true });
      // The sender may speak again once the previous clip's length plus a second has passed (voice.ts).
      await wait(1800);
      check(c.last!.seats[cSeat]!.hearsVoice === true, 'C opts in, and the table says so');
      host.room.send('voice', { ms: 3000, mime: 'audio/mp4', data: mp4(3000) });
      await wait(500);
      check(c.clips.length === 1, 'now the clip reaches C');
      check(noId.clips.length === 0, 'and still not the one who never opted in');
      await Promise.all([host.room.leave(true), c.room.leave(true), noId.room.leave(true)]);
      await wait(300);

      // --- a ban at the door (own server only: the config is ours to write) ---
      fromNewAddress();
      check((await refusedWith(client.create(ROOM_NAME_MODES, { ...base, name: 'X', installId: banned }))) === BANNED_CODE, `a banned install is refused (${BANNED_CODE})`);
      fromNewAddress();
      check((await refusedWith(client.create(ROOM_NAME_MODES, { ...base, name: 'Y', installId: newId() }))) === null, 'an ID not on the list creates a table');
      // An impostor sent the victim's published ID as its own and was reported: the report
      // named the digest the table showed for the impostor, so the ban refuses the impostor...
      fromNewAddress();
      check((await refusedWith(client.create(ROOM_NAME_MODES, { ...base, name: 'I', installId: publishedId(victim) }))) === BANNED_CODE, "an impostor that sent another player's published ID is refused by the ban its report asked for");
      // ...and never the player it copied.
      fromNewAddress();
      check((await refusedWith(client.create(ROOM_NAME_MODES, { ...base, name: 'V', installId: victim }))) === null, 'and the player it copied still creates a table');
    } else {
      // --- production: the spoofed address must count for nothing ---
      fromNewAddress();
      const host = side(await client.create(ROOM_NAME_MODES, { ...base, name: 'A', installId: a }));
      await wait(300);
      check(host.last?.voiceOptIn === true, 'a public table says stranger clips need an opt-in');
      fromNewAddress();
      const second = await refusedWith(client.joinById(host.room.roomId, { ...base, name: 'B', installId: b }));
      check(second === SAME_ORIGIN_CODE, `a second seat from this machine is refused (${SAME_ORIGIN_CODE}) whatever X-Real-IP it claims: caddy sets the real address`);
      await host.room.leave(true);
      console.log('[identity-smoke] skip the block at a public table and the ban (one machine, not our config)');
    }

    // --- a private table: blocked, still seated (the host invited them), but out of reach ---
    const h = newId();
    const g = newId();
    fromNewAddress();
    const priv = side(await client.create(ROOM_NAME_MODES, { ...base, name: 'H', private: true, installId: h }));
    await wait(300);
    // What the table shows for H, and so what G's app keeps when G blocks H.
    const shownH = priv.last?.seats.find((s) => s.name === 'H')?.installId ?? '';
    check(shownH !== h && shownH === publishedId(h), "the table shows a digest of H's install ID, never the ID H's app sent");
    fromNewAddress();
    const guest = side(await client.joinById(priv.room.roomId, { ...base, name: 'G', installId: g, blocked: [shownH] }));
    fromNewAddress();
    const third = side(await client.joinById(priv.room.roomId, { ...base, name: 'T', installId: newId() }));
    // An app that sends the digest it saw for H as its own ID sits down, but as somebody else.
    fromNewAddress();
    const impostor = side(await client.joinById(priv.room.roomId, { ...base, name: 'I', installId: shownH }));
    await wait(300);
    const shownI = impostor.last?.seats.find((s) => s.name === 'I')?.installId ?? '';
    check(shownI !== shownH && shownI === publishedId(shownH), "an app that sends H's published ID is seated under a different one: it cannot wear it");
    check(guest.last !== null, 'a guest who blocked the host still sits at the private table');
    priv.room.send('emote', { id: 'bravo' });
    await wait(400);
    check(guest.emotes.length === 0 && third.emotes.length === 1, "the host's emote reaches the third player, not the guest who blocked them");
    priv.room.send('voice', { ms: 3000, mime: 'audio/mp4', data: mp4(3000) });
    await wait(500);
    check(guest.clips.length === 0 && third.clips.length === 1, "nor the host's clip");
    guest.room.send('voice', { ms: 3000, mime: 'audio/mp4', data: mp4(3000) });
    await wait(500);
    check(priv.clips.filter((m) => m.data !== undefined).length === 0 && third.clips.length === 2, "and the guest's clip does not reach the host, only the third");
    priv.room.send('start', {});
    await wait(600);
    const gSeat = priv.last!.seats.findIndex((s) => s.name === 'G');
    const echoes = priv.gifts.length;
    priv.room.send('gift', { id: 'kava', to: gSeat });
    await wait(500);
    check(guest.gifts.length === 0 && priv.gifts.length === echoes, 'a gift to the guest who blocked the host is dropped, without an echo');
    // A gift between two others is delivered like an emote: to the seats its sender
    // reaches, and back to the sender, who pays on that echo. (The dropped one above
    // did not use the host's send window.)
    const hSeat = priv.last!.seats.findIndex((s) => s.name === 'H');
    const tSeat = priv.last!.seats.findIndex((s) => s.name === 'T');
    priv.room.send('gift', { id: 'pivo', to: tSeat });
    await wait(500);
    check(third.gifts.some((m) => m.from === hSeat) && priv.gifts.some((m) => m.from === hSeat) && !guest.gifts.some((m) => m.from === hSeat), "the host's gift to the third player reaches them, and is not delivered to the guest who blocked the host");
    guest.room.send('gift', { id: 'ruza', to: tSeat });
    await wait(500);
    check(third.gifts.some((m) => m.from === gSeat) && guest.gifts.some((m) => m.from === gSeat) && !priv.gifts.some((m) => m.from === gSeat), "and the guest's gift to the third player never reaches the host");
    await Promise.all([priv.room.leave(true), guest.room.leave(true), third.room.leave(true), impostor.room.leave(true)]);
  } finally {
    own?.kill();
  }

  console.log(failures === 0 ? '[identity-smoke] PASS' : `[identity-smoke] FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[identity-smoke] error', e);
  process.exit(1);
});
