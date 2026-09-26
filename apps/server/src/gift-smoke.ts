import './ws-polyfill';
import { Client, type Room } from 'colyseus.js';
import {
  GIFT_GAP_MS,
  MSG,
  ROOM_NAME,
  type GiftMessage,
  type RoomMessage,
  type SeatInfo,
} from './protocol';

/**
 * End-to-end check of the gift relay against a running server.
 *
 * Two clients sit at a private table, with a third playing an older app (it
 * joins without `gifts: true`). Before the start a gift is refused (the lobby
 * has no pucks). After it: a burst lets exactly one through per window,
 * garbage and self-gifts are dropped, the older app's seat is never sent a
 * gift (a gift for it alone is dropped without using the window), a table
 * gift is ONE message naming the other seats that can see it, both
 * directions relay, the seat keeps its gift through a dropped connection and
 * a reconnect, and loses it when its player leaves.
 *
 *   npm run start --workspace @belot/server        # in one terminal
 *   npx tsx apps/server/src/gift-smoke.ts          # in another
 */

const ENDPOINT = process.env.SERVER_URL ?? 'ws://localhost:2567';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`[gift-smoke] connecting three clients to ${ENDPOINT}`);
  const client = new Client(ENDPOINT);
  const a = await client.create(ROOM_NAME, { name: 'Darežljivi', private: true, gifts: true });
  let b: Room = await client.joinById(a.roomId, { name: 'Primatelj', gifts: true });
  // An older app: no `gifts` in its join options.
  const c: Room = await client.joinById(a.roomId, { name: 'Stari' });
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`[gift-smoke] ${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failures.push(what);
  };

  const seenByA: GiftMessage[] = [];
  const seenByB: GiftMessage[] = [];
  let roomA: RoomMessage | null = null;
  let roomB: RoomMessage | null = null;
  const seenByC: GiftMessage[] = [];
  let seatA = -1;
  let seatB = -1;
  let seatC = -1;
  const wire = (r: Room, seen: GiftMessage[], who: 'a' | 'b' | 'c') => {
    r.onMessage(MSG.gift, (m: GiftMessage) => seen.push(m));
    r.onMessage(MSG.room, (m: RoomMessage) => {
      if (who === 'a') roomA = m;
      else if (who === 'b') roomB = m;
    });
    r.onMessage(MSG.view, (m: { seat: number }) => {
      if (who === 'a') seatA = m.seat;
      else if (who === 'b') seatB = m.seat;
      else seatC = m.seat;
    });
    r.onMessage(MSG.error, () => {});
    r.onMessage(MSG.emote, () => {});
  };
  wire(a, seenByA, 'a');
  wire(b, seenByB, 'b');
  wire(c, seenByC, 'c');
  await wait(400);

  // The lobby: nothing to land on, so nothing is relayed. (The first views can
  // arrive before the handlers above exist; partner-first seating puts the
  // second joiner in seat 2.)
  a.send('gift', { id: 'kava', to: seatB >= 0 ? seatB : 2 });
  await wait(400);
  check(seenByB.length === 0, 'a gift before the start is dropped');

  // The start publishes fresh views, so both seats are known from here.
  a.send('start', {});
  await wait(600);
  check(seatA >= 0 && seatB >= 0 && seatC >= 0 && new Set([seatA, seatB, seatC]).size === 3, `seated: A=${seatA} B=${seatB} C=${seatC}`);
  const botSeat = [0, 1, 2, 3].find((x) => x !== seatA && x !== seatB && x !== seatC)!;
  const sees = (x: number) => roomA?.seats.find((i) => i.seat === x)?.seesGifts === true;
  check(
    sees(seatA) && sees(seatB) && sees(botSeat) && !sees(seatC),
    `SeatInfo says who can see a gift: A ${sees(seatA)}, B ${sees(seatB)}, bot ${sees(botSeat)}, older app ${sees(seatC)}`,
  );

  // A burst of five: exactly one gets through. Garbage never counts.
  for (let i = 0; i < 5; i++) {
    a.send('gift', { id: 'kava', to: seatB });
    await wait(50);
  }
  await wait(400);
  check(seenByB.length === 1 && seenByA.length === 1, `burst of 5 relayed once (B saw ${seenByB.length}, A saw ${seenByA.length})`);
  const first = seenByB[0];
  check(!!first && first.from === seatA && first.to.length === 1 && first.to[0] === seatB && first.id === 'kava', 'the relayed gift says from, to and id');

  await wait(GIFT_GAP_MS);
  for (const bad of [
    { id: 'zlato', to: seatB },
    { id: 42, to: seatB },
    { id: 'kava', to: seatA },
    { id: 'kava', to: 7 },
    { id: 'kava', to: '1' },
    { id: 'kava', to: 'everyone' },
    { id: 'kava' },
  ]) {
    a.send('gift', bad);
  }
  await wait(400);
  check(seenByB.length === 1, 'unknown ids, self, out-of-range and malformed targets are dropped');

  // The older app's seat is never sent a gift: one for it alone is dropped.
  a.send('gift', { id: 'kava', to: seatC });
  await wait(400);
  // (C is still sent every gift, as nobody here blocks anyone — an older app
  // would just ignore them — so the check is that nothing new went out and
  // nothing ever named C's seat.)
  check(seenByB.length === 1 && !seenByC.some((m) => m.to.includes(seatC as never)), 'a gift for an older app alone is dropped');

  // None of those used up the window: a table gift goes straight through, as
  // one message, to the other seats that can see it.
  a.send('gift', { id: 'kruna', to: 'table' });
  await wait(400);
  const table = seenByB[1];
  const want = [seatB, botSeat].sort().join(',');
  check(
    !!table && table.id === 'kruna' && table.from === seatA && [...table.to].sort().join(',') === want,
    `a table gift is one message to the others who can see it (${table ? table.to.join(',') : 'none'}, want ${want})`,
  );

  // And the other way.
  b.send('gift', { id: 'ruza', to: seatA });
  await wait(400);
  check(seenByA.some((m) => m.from === seatB && m.id === 'ruza'), 'B can gift A back');

  // The room remembers: B's seat shows A's kruna on the next publish.
  const seatOf = (m: RoomMessage | null, s: number): SeatInfo | undefined => m?.seats.find((x) => x.seat === s);
  // A drop (not a consented leave): the seat is held, and keeps its gift.
  const token = b.reconnectionToken;
  roomA = null;
  await b.leave(false).catch(() => {});
  await wait(800);
  const held = seatOf(roomA, seatB);
  check(!!held && held.connected === false && held.gift === 'kruna', `a dropped seat keeps its gift (${JSON.stringify(held)})`);
  // That publish carries every seat: the older app's got nothing, not even the kava meant for it.
  const older = seatOf(roomA, seatC);
  check(!!older && older.gift === undefined, `the older app's seat wears no gift (${JSON.stringify(older)})`);

  // Back in on the token: B sees its own gift.
  b = await client.reconnect(token);
  roomB = null;
  seenByB.length = 0;
  wire(b, seenByB, 'b');
  await wait(800);
  check(seatOf(roomB, seatB)?.gift === 'kruna', 'a reconnect sees the seat\'s gift');

  // A consented leave frees the seat and the gift with it.
  roomA = null;
  await b.leave(true).catch(() => {});
  await wait(800);
  const gone = seatOf(roomA, seatB);
  check(!!gone && gone.gift === undefined, `a seat whose player left has no gift (${JSON.stringify(gone)})`);

  console.log(failures.length === 0 ? '[gift-smoke] PASS' : `[gift-smoke] FAIL (${failures.length})`);
  void c.leave(true).catch(() => {});
  void a.leave(true).catch(() => {});
  await wait(200);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[gift-smoke] error', err);
  process.exit(1);
});
