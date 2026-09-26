import { describe, expect, it } from 'vitest';
import { cardId, SEATS, type PublicView, type Seat } from '@belot/engine';
import { Lang } from '@belot/i18n';
import { Table, type TableEvent } from '@belot/table';
import type { AnchorMap, AnchorRect } from '../src/anim/AnchorRegistry';
import { DEFAULT_TIMINGS, REDUCED_TIMINGS, timingsFor, type Tempo } from '../src/anim/director';
import { anchorId, FxBus, metaId, type Fx } from '../src/anim/FxBus';
import { fitHand } from '../src/table/geometry';
import {
  BUBBLE_MIN_MS,
  confettiX,
  DEAL_DONE_AT,
  DEALER_BADGE,
  FALLBACK_CARD_W,
  FLIGHT_MAX_MS,
  FLIGHT_MIN_MS,
  GIFT_FLIGHT_SIZE,
  GIFT_FLY_MS,
  PULSE_MS,
  lifetimeOf,
  motionOf,
} from '../src/anim/lifetimes';
import { makeFxSpawner } from '../src/table/fx';

/**
 * Golden timings: no sprite may still be moving when the director has moved on.
 *
 * The overlay animates from constants in `lifetimes.ts`; the director paces
 * from `DEFAULT_TIMINGS`; nothing else ties the two together. Before this
 * test they had drifted in both directions — the flight kept its full 260ms
 * while the director committed the card at 130ms with a batch waiting, and
 * the dealt backs were done 560ms before the deal beat ended.
 *
 * Runs under node: the spawner only needs an object that answers `rect` and
 * `centre`, so the registry's React half is never imported at runtime.
 */

const SLOT_W = 60;

function fakeAnchors(withSlots = true): AnchorMap {
  const rects = new Map<string, AnchorRect>();
  const metaNumbers = new Map<string, number>();
  for (const s of SEATS) {
    // Each seat a different distance from its slot, as on a real table.
    rects.set(`seat:${s}`, { x: 120 * s, y: 40 + 50 * s, w: 54, h: 54 });
    if (withSlots) rects.set(`slot:${s}`, { x: 120 * s, y: 220, w: SLOT_W, h: SLOT_W * 1.45 });
  }
  // My own puck stands apart from my seat anchor, which is the hand.
  rects.set('puck:0', { x: 30, y: 300, w: 44, h: 44 });
  rects.set('deck', { x: 180, y: 160, w: 10, h: 10 });
  rects.set('plaque', { x: 170, y: 90, w: 40, h: 40 });
  rects.set('running', { x: 160, y: 10, w: 60, h: 16 });
  const map = {
    rect: (k: string) => rects.get(k) ?? null,
    centre: (k: string) => {
      const r = rects.get(k);
      return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
    },
    set: (k: string, r: AnchorRect) => {
      rects.set(k, r);
    },
    delete: (k: string) => {
      rects.delete(k);
    },
    meta: (k: string) => metaNumbers.get(k) ?? null,
    setMeta: (k: string, v: number) => {
      metaNumbers.set(k, v);
    },
  };
  return map as unknown as AnchorMap;
}

/** Every sprite a whole all-bot deal produces, tagged with the event that spawned it. */
function spritesOfADeal(speed: number, anchors = fakeAnchors(), reduced = false, tempo: Tempo = 'normal') {
  const table = new Table({ seed: 7, humanSeats: [] });
  const events = table.drainEvents();
  if (events.length < 30) throw new Error('hollow deal');
  const bus = new FxBus();
  const out: { kind: string; fx: Fx }[] = [];
  let current = '';
  bus.subscribe((fx) => out.push({ kind: current, fx }));
  // The view as the director holds it when each event STARTS: only the trick
  // on the felt matters to the spawner, so that is all this follows.
  const base = table.view(0 as Seat);
  let trick: PublicView['currentTrick'] = [];
  const spawn = makeFxSpawner({
    anchors,
    bus,
    lang: new Lang('hr'),
    mySeat: () => 0,
    view: () => ({ ...base, currentTrick: trick }),
    reduced: () => reduced,
    tempo: () => tempo,
  }).start;
  for (const e of events) {
    current = e.kind;
    spawn(e, speed);
    if (e.kind === 'cardPlayed') trick = [...trick, { seat: e.seat, card: e.card }];
    if (e.kind === 'trickWon') trick = [];
  }
  return out;
}

describe('sprites fit the beats they fill', () => {
  for (const speed of [1, 0.5]) {
    it(`at speed ${speed}: every sprite has landed before its beat plus gap is over`, () => {
      const sprites = spritesOfADeal(speed);
      expect(sprites.length).toBeGreaterThan(30);
      for (const { kind, fx } of sprites) {
        const beat = DEFAULT_TIMINGS[kind as keyof typeof DEFAULT_TIMINGS];
        expect(beat, `no timing for ${kind}`).toBeDefined();
        const budget = (beat.dur + beat.gap) * speed;
        expect(motionOf(fx), `${fx.kind} spawned by ${kind}`).toBeLessThanOrEqual(budget);
        // The fade tail may run into the gap, but never past the sprite's own motion.
        expect(lifetimeOf(fx)).toBeGreaterThanOrEqual(motionOf(fx));
        // A bubble's pop and fade are fixed choreography that only scales with
        // speed; motionOf must own up to them, or a short beat passes vacuously.
        if (fx.kind === 'bubble') {
          expect(motionOf(fx)).toBeGreaterThanOrEqual(BUBBLE_MIN_MS * speed);
        }
      }
    });
  }

  it('halving the speed halves the motion', () => {
    const full = spritesOfADeal(1);
    const half = spritesOfADeal(0.5);
    expect(half.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(motionOf(half[i]!.fx)).toBeCloseTo(motionOf(full[i]!.fx) / 2, 5);
    }
  });
});

describe('sprites are sized from the table, not from a constant', () => {
  it('a played card flies at the width of the slot it lands in', () => {
    const flights = spritesOfADeal(1).filter((s) => s.fx.kind === 'flight');
    expect(flights.length).toBe(32);
    for (const { fx } of flights) {
      if (fx.kind === 'flight') expect(fx.width).toBe(SLOT_W);
    }
  });

  it('falls back to a sane width before the first layout has measured a slot', () => {
    const flights = spritesOfADeal(1, fakeAnchors(false)).filter((s) => s.fx.kind === 'flight');
    // Without slot anchors the flight has nowhere to land, so nothing is spawned…
    expect(flights.length).toBe(0);
    // …but the dealt backs, which only need seats and the deck, still get a width.
    const deals = spritesOfADeal(1, fakeAnchors(false)).filter((s) => s.fx.kind === 'deal');
    expect(deals.length).toBeGreaterThan(0);
    for (const { fx } of deals) {
      if (fx.kind === 'deal') {
        expect(fx.width).toBeGreaterThan(0);
        expect(fx.width).toBeLessThanOrEqual(FALLBACK_CARD_W);
      }
    }
  });

  it('spawns nothing when an anchor is missing, and never throws', () => {
    const none = { rect: () => null, centre: () => null } as unknown as AnchorMap;
    expect(spritesOfADeal(1, none)).toEqual([]);
  });
});

describe('a bubble owns up to its fixed choreography', () => {
  const bubble = (duration: number, speed: number) =>
    ({ kind: 'bubble', at: { x: 0, y: 0 }, text: 'x', tone: 'plain', duration, speed }) as const;

  it('never reports less than the pop and the fade, scaled by speed', () => {
    // The overlay's pop-in and fade-out are fixed legs; a beat shorter than
    // both cannot cut them, only the hold. Reporting the bare duration here is
    // what let a 310ms budget pass a 430ms bubble.
    expect(motionOf(bubble(100, 1))).toBe(BUBBLE_MIN_MS);
    expect(motionOf(bubble(100, 0.5))).toBe(BUBBLE_MIN_MS * 0.5);
    expect(motionOf(bubble(900, 1))).toBe(900);
    expect(lifetimeOf(bubble(100, 1))).toBeGreaterThan(BUBBLE_MIN_MS);
  });
});

describe('the sprites that replace real cards', () => {
  it('a won trick sweeps the four real cards, in play order, from their own slots', () => {
    const sweeps = spritesOfADeal(1).filter((s) => s.fx.kind === 'trickSweep');
    expect(sweeps.length).toBe(8);
    for (const { fx } of sweeps) {
      if (fx.kind !== 'trickSweep') continue;
      expect(fx.cards.length).toBe(4);
      expect(new Set(fx.cards.map((c) => c.seat)).size).toBe(4);
      for (const c of fx.cards) {
        // From the centre of that seat's slot — where the real card was.
        expect(c.from).toEqual({ x: 120 * c.seat + SLOT_W / 2, y: 220 + (SLOT_W * 1.45) / 2 });
      }
      expect(fx.width).toBe(SLOT_W);
      expect(fx.cards.some((c) => c.seat === fx.winner)).toBe(true);
    }
  });

  it('a played card flies for a distance-scaled time that still lands inside its beat', () => {
    // The card is committed to its slot at the end of the beat, not the gap:
    // a sprite still in the air then is a second copy over the real card.
    expect(FLIGHT_MAX_MS).toBeLessThanOrEqual(DEFAULT_TIMINGS.cardPlayed.dur);
    for (const speed of [1, 0.5]) {
      const flights = spritesOfADeal(speed).filter((s) => s.fx.kind === 'flight');
      const durations = new Set<number>();
      for (const { fx } of flights) {
        if (fx.kind !== 'flight') continue;
        expect(fx.duration).toBeGreaterThanOrEqual(FLIGHT_MIN_MS * speed);
        expect(fx.duration).toBeLessThanOrEqual(DEFAULT_TIMINGS.cardPlayed.dur * speed);
        durations.add(fx.duration);
      }
      // Four seats at four distances from their slots: not one fixed number.
      expect(durations.size).toBeGreaterThan(1);
    }
  });

  it('the deal fills its beat instead of finishing halfway through it', () => {
    for (const speed of [1, 0.5]) {
      const deals = spritesOfADeal(speed).filter((s) => s.fx.kind === 'deal');
      expect(deals.length).toBe(2); // the deal and the talon
      for (const { kind, fx } of deals) {
        const beat = DEFAULT_TIMINGS[kind as keyof typeof DEFAULT_TIMINGS];
        // The last back has landed well into the beat but not at its end,
        // and every back then HOLDS until the real cards mount at the
        // end-commit — the fade runs across it, into the gap. No empty hand.
        expect(motionOf(fx)).toBeGreaterThanOrEqual(beat.dur * speed * 0.7);
        expect(motionOf(fx)).toBeLessThanOrEqual(beat.dur * speed * DEAL_DONE_AT + 1);
        expect(lifetimeOf(fx)).toBeGreaterThanOrEqual(beat.dur * speed);
        expect(lifetimeOf(fx)).toBeLessThanOrEqual((beat.dur + beat.gap) * speed);
        if (fx.kind === 'deal') expect(fx.beat).toBe(beat.dur);
      }
    }
  });
});

describe('a landed flight gives way to the sweep', () => {
  it('is gone before a trick at half pace can start moving its card', () => {
    // At speed 0.5 the trick sweep may begin as little as the cardPlayed gap
    // after the card lands; the flight copy must not still be drawn then.
    const gap = DEFAULT_TIMINGS.cardPlayed.gap;
    for (const speed of [1, 0.5]) {
      const flights = spritesOfADeal(speed).filter((s) => s.fx.kind === 'flight');
      for (const { fx } of flights) {
        if (fx.kind !== 'flight') continue;
        expect(lifetimeOf(fx)).toBeLessThanOrEqual(fx.duration + gap * speed);
      }
    }
  });
});

describe('the turn pulse', () => {
  it('is one short beat that scales with the pace', () => {
    const pulse = (speed: number) => ({ kind: 'pulse', at: { x: 0, y: 0 }, speed }) as const;
    expect(motionOf(pulse(1))).toBe(PULSE_MS);
    expect(motionOf(pulse(0.5))).toBe(PULSE_MS / 2);
    expect(lifetimeOf(pulse(1))).toBeGreaterThanOrEqual(PULSE_MS);
  });
});

describe('a played card sets off from the right place, the right way up', () => {
  it('flies from the tapped card, at the fan size, and forgets the rect', () => {
    const anchors = fakeAnchors();
    const table = new Table({ seed: 7, humanSeats: [] });
    const mine = table
      .drainEvents()
      .find((e): e is Extract<TableEvent, { kind: 'cardPlayed' }> => e.kind === 'cardPlayed' && e.seat === 0);
    expect(mine).toBeDefined();
    const key = `card:${cardId(mine!.card)}`;
    anchors.set(key, { x: 300, y: 500, w: 62, h: 90 });
    const bus = new FxBus();
    const out: Fx[] = [];
    bus.subscribe((fx) => out.push(fx));
    const spawn = makeFxSpawner({
      anchors,
      bus,
      lang: new Lang('hr'),
      mySeat: () => 0,
      view: () => table.view(0 as Seat),
    }).start;
    spawn(mine!, 1);
    const flight = out.find((f) => f.kind === 'flight');
    expect(flight?.kind).toBe('flight');
    if (flight?.kind !== 'flight') return;
    expect(flight.from).toEqual({ x: 331, y: 545 });
    expect(flight.fromWidth).toBe(62);
    expect(flight.faceUp).toBe(true);
    // Read once: the next flight for the same card must not find it.
    expect(anchors.rect(key)).toBeNull();
  });

  it("an opponent's card leaves face down from their puck; my own face up", () => {
    const flights = spritesOfADeal(1).filter((s) => s.fx.kind === 'flight');
    let up = 0;
    let down = 0;
    for (const { fx } of flights) {
      if (fx.kind !== 'flight') continue;
      if (fx.faceUp) up += 1;
      else down += 1;
      expect(fx.fromWidth).toBeUndefined(); // nothing was tapped in a bot deal
    }
    // Seat 0 is "me" to the spawner: its eight cards fly face up, the other
    // twenty-four face down.
    expect(up).toBe(8);
    expect(down).toBe(24);
  });
});

describe('the deal', () => {
  it('lands my backs on the fan the hand actually lays out, when the table has said how', () => {
    // The table publishes the fan's width and card cap; the backs then sit on
    // exactly the centres fitHand gives for those numbers, centred in the block.
    const anchors = fakeAnchors();
    anchors.setMeta(metaId.handWidth, 300);
    anchors.setMeta(metaId.handCardMax, 60);
    const deals = spritesOfADeal(1, anchors).filter((s) => s.fx.kind === 'deal');
    const first = deals[0]!.fx;
    if (first.kind !== 'deal') throw new Error('no deal');
    const puckXs = new Set(SEATS.map((s) => 120 * s + 27));
    const mine = first.backs.filter((b) => !puckXs.has(b.x)).map((b) => b.x);
    const fit = fitHand(300, 6, 60);
    const hand = anchors.rect(anchorId.seat(0))!;
    const span = fit.cardW + 5 * fit.advance;
    const expected = Array.from({ length: 6 }, (_, k) => hand.x + (hand.w - span) / 2 + k * fit.advance + fit.cardW / 2);
    expect(mine.map((x) => Math.round(x))).toEqual(expected.map((x) => Math.round(x)));
  });

  it('spreads my backs across the hand and sends one a round to each opponent', () => {
    const deals = spritesOfADeal(1).filter((s) => s.fx.kind === 'deal');
    const [first, talon] = deals.map((d) => d.fx);
    if (first?.kind !== 'deal' || talon?.kind !== 'deal') throw new Error('no deal');
    // Two rounds: three opponents once each plus three for me, twice.
    expect(first.backs.length).toBe(12);
    // The talon: one each for the opponents, two for me.
    expect(talon.backs.length).toBe(5);
    // My backs land at six distinct points across the hand, not on one spot;
    // an opponent's land on its puck centre (x = 120·seat + 27 in the fake).
    const puckXs = new Set(SEATS.map((s) => 120 * s + 27));
    const mine = first.backs.filter((b) => !puckXs.has(b.x));
    expect(mine.length).toBe(6);
    expect(new Set(mine.map((b) => b.x)).size).toBe(6);
    // The talon's two land on the right of the fan, where the new cards go.
    const talonMine = talon.backs.filter((b) => !puckXs.has(b.x));
    expect(talonMine.length).toBe(2);
    expect(Math.min(...talonMine.map((b) => b.x))).toBeGreaterThan(Math.max(...mine.map((b) => b.x)) - 1);
  });
});

describe('the bidding beats', () => {
  it('a call bubble carries its suit, and the pip stamps onto the plaque at the end', () => {
    const anchors = fakeAnchors();
    const table = new Table({ seed: 7, humanSeats: [] });
    const called = table.drainEvents().find((e) => e.kind === 'bidCalled');
    expect(called).toBeDefined();
    const bus = new FxBus();
    const out: Fx[] = [];
    bus.subscribe((fx) => out.push(fx));
    const fx = makeFxSpawner({
      anchors,
      bus,
      lang: new Lang('hr'),
      mySeat: () => 0,
      view: () => table.view(0 as Seat),
    });
    fx.start(called!, 1);
    const bubble = out.find((f) => f.kind === 'bubble');
    expect(bubble?.kind === 'bubble' && bubble.pip).toBe(called!.kind === 'bidCalled' ? called!.suit : null);
    fx.end(called!, 1);
    const stamp = out.find((f) => f.kind === 'stamp');
    expect(stamp?.kind === 'stamp' && stamp.pip).toBe(called!.kind === 'bidCalled' ? called!.suit : null);
    expect(stamp?.kind === 'stamp' && stamp.at).toEqual({ x: 190, y: 110 });
    // The stamp fits the call's gap, where it lands.
    expect(motionOf(stamp!)).toBeLessThanOrEqual(DEFAULT_TIMINGS.bidCalled.gap);
  });

  it('the end-of-beat stamps fit their gaps at half pace too, and are off under reduce-motion', () => {
    const doubled: TableEvent = { kind: 'doubled', seat: 1, multiplier: 2 };
    const called: TableEvent = { kind: 'bidCalled', seat: 1, suit: 'HEARTS' as never };
    for (const speed of [1, 0.5]) {
      const bus = new FxBus();
      const out: Fx[] = [];
      bus.subscribe((fx) => out.push(fx));
      const fx = makeFxSpawner({ anchors: fakeAnchors(), bus, lang: new Lang('hr'), mySeat: () => 0, view: () => null });
      fx.end(called, speed);
      fx.end(doubled, speed);
      expect(out.map((f) => f.kind)).toEqual(['stamp', 'stamp']);
      expect(motionOf(out[0]!)).toBeLessThanOrEqual(DEFAULT_TIMINGS.bidCalled.gap * speed);
      expect(motionOf(out[1]!)).toBeLessThanOrEqual(DEFAULT_TIMINGS.doubled.gap * speed);
    }
    const bus = new FxBus();
    const out: Fx[] = [];
    bus.subscribe((fx) => out.push(fx));
    const fx = makeFxSpawner({
      anchors: fakeAnchors(),
      bus,
      lang: new Lang('hr'),
      mySeat: () => 0,
      view: () => null,
      reduced: () => true,
    });
    fx.end(called, 1);
    fx.end(doubled, 1);
    expect(out).toEqual([]);
  });

  it('a zvanje bubble is weighted by its value', () => {
    const declared = spritesOfADeal(1).filter((s) => s.kind === 'declared');
    for (const { fx } of declared) {
      if (fx.kind !== 'bubble') continue;
      expect([1, 2, 3, 4]).toContain(fx.weight);
    }
  });
});

describe('the scoring beats', () => {
  it('the last trick sends its +10 to the running count, inside the trick beat', () => {
    const chips = spritesOfADeal(1).filter((s) => s.fx.kind === 'badge' && s.fx.text === '+10');
    expect(chips.length).toBe(1);
    const fx = chips[0]!.fx;
    if (fx.kind !== 'badge') return;
    expect(fx.to).toEqual({ x: 190, y: 18 });
    expect(chips[0]!.kind).toBe('trickWon');
  });

  it('a štiglja stamps the word on the felt in the sweeping side\'s colour', () => {
    const anchors = fakeAnchors();
    const table = new Table({ seed: 7, humanSeats: [] });
    const scored = table.drainEvents().find((e): e is Extract<TableEvent, { kind: 'dealScored' }> => e.kind === 'dealScored');
    expect(scored).toBeDefined();
    const bus = new FxBus();
    const out: Fx[] = [];
    bus.subscribe((fx) => out.push(fx));
    const fx = makeFxSpawner({
      anchors,
      bus,
      lang: new Lang('hr'),
      mySeat: () => 0,
      view: () => table.view(0 as Seat),
    });
    fx.start({ ...scored!, result: { ...scored!.result, valatTeam: 1 } }, 1);
    const stamp = out.find((f) => f.kind === 'stamp');
    expect(stamp?.kind === 'stamp' && stamp.text).toBe('Štiglja');
    expect(stamp?.kind === 'stamp' && stamp.tone).toBe('danger');
    expect(motionOf(stamp!)).toBeLessThanOrEqual(DEFAULT_TIMINGS.dealScored.dur);
  });

  it('under reduce-motion a štiglja fades its word inside the short beat, at either pace', () => {
    const table = new Table({ seed: 7, humanSeats: [] });
    const scored = table.drainEvents().find((e): e is Extract<TableEvent, { kind: 'dealScored' }> => e.kind === 'dealScored');
    for (const speed of [1, 0.5]) {
      const bus = new FxBus();
      const out: Fx[] = [];
      bus.subscribe((fx) => out.push(fx));
      const fx = makeFxSpawner({
        anchors: fakeAnchors(),
        bus,
        lang: new Lang('hr'),
        mySeat: () => 0,
        view: () => table.view(0 as Seat),
        reduced: () => true,
      });
      fx.start({ ...scored!, result: { ...scored!.result, valatTeam: 1 } }, speed);
      const stamp = out.find((f) => f.kind === 'stamp');
      expect(stamp?.kind === 'stamp' && stamp.fade).toBe(true);
      expect(out.some((f) => f.kind === 'badge')).toBe(false);
      const beat = REDUCED_TIMINGS.dealScored;
      expect(motionOf(stamp!)).toBeLessThanOrEqual((beat.dur + beat.gap) * speed);
    }
  });
});

describe('reduce-motion sprites', () => {
  it('fit the reduced beats at speed 1 and 0.5, and nothing flies', () => {
    for (const speed of [1, 0.5]) {
      const sprites = spritesOfADeal(speed, fakeAnchors(), true);
      expect(sprites.length).toBeGreaterThan(30);
      for (const { kind, fx } of sprites) {
        const beat = REDUCED_TIMINGS[kind as keyof typeof REDUCED_TIMINGS];
        expect(beat, `no timing for ${kind}`).toBeDefined();
        expect(motionOf(fx), `${fx.kind} spawned by ${kind}`).toBeLessThanOrEqual((beat.dur + beat.gap) * speed);
        if (fx.kind === 'flight' || fx.kind === 'deal' || fx.kind === 'trickSweep') expect(fx.fade).toBe(true);
        expect(fx.kind).not.toBe('badge'); // the hops are off
        // Nothing outlives the short beat plus its gap, fade tail included.
        expect(lifetimeOf(fx), `${fx.kind} spawned by ${kind}`).toBeLessThanOrEqual((beat.dur + beat.gap) * speed + 40);
      }
    }
  });
});

describe('Tempo igre', () => {
  // The director runs timingsFor(policy, tempo) and hands the spawner only its
  // own pace (1, or 0.5 with a batch waiting): the spawner folds the tempo in,
  // once. Without it, a slow deal's backs faded 340 ms before its cards
  // mounted (an empty hand) and a fast one's still flew over them.
  for (const tempo of ['slow', 'fast'] as const) {
    for (const reduced of [false, true]) {
      it(`${tempo}${reduced ? ', under reduce-motion' : ''}: every sprite fits the beat the director really runs`, () => {
        const T = timingsFor(reduced ? 'reduced' : 'full', tempo);
        for (const speed of [1, 0.5]) {
          const sprites = spritesOfADeal(speed, fakeAnchors(), reduced, tempo);
          expect(sprites.length).toBeGreaterThan(30);
          for (const { kind, fx } of sprites) {
            const beat = T[kind as keyof typeof T];
            const at = `${fx.kind} spawned by ${kind} at speed ${speed}`;
            expect(motionOf(fx), at).toBeLessThanOrEqual((beat.dur + beat.gap) * speed);
            if (reduced) expect(lifetimeOf(fx), at).toBeLessThanOrEqual((beat.dur + beat.gap) * speed + 40);
            // Committed to its slot at the beat's end: no second copy in the air then.
            if (fx.kind === 'flight') expect(fx.duration, at).toBeLessThanOrEqual(T.cardPlayed.dur * speed);
            // The dealer's D lands as the puck's own D appears, not before or after it.
            if (fx.kind === 'badge' && fx.tone === undefined) expect(fx.duration, at).toBeCloseTo(beat.dur * speed, 0);
            if (fx.kind !== 'deal') continue;
            // Timed on the beat the director runs (up to its rounding): the
            // tempo stretched once, not twice and not never.
            expect(Math.abs(fx.beat * fx.speed - beat.dur * speed), at).toBeLessThanOrEqual(0.5);
            if (reduced) continue;
            // Every back has landed and holds when the cards mount at the
            // beat's end, and is gone within the gap. No empty hand.
            expect(motionOf(fx), at).toBeLessThanOrEqual(beat.dur * speed * DEAL_DONE_AT + 1);
            expect(lifetimeOf(fx), at).toBeGreaterThanOrEqual(beat.dur * speed);
            expect(lifetimeOf(fx), at).toBeLessThanOrEqual((beat.dur + beat.gap) * speed);
          }
        }
      });
    }
  }

  it('the end-of-beat stamps fit the gaps the tempo leaves them', () => {
    const doubled: TableEvent = { kind: 'doubled', seat: 1, multiplier: 2 };
    const called: TableEvent = { kind: 'bidCalled', seat: 1, suit: 'HEARTS' as never };
    for (const tempo of ['slow', 'fast'] as const) {
      const T = timingsFor('full', tempo);
      for (const speed of [1, 0.5]) {
        const bus = new FxBus();
        const out: Fx[] = [];
        bus.subscribe((fx) => out.push(fx));
        const fx = makeFxSpawner({ anchors: fakeAnchors(), bus, lang: new Lang('hr'), mySeat: () => 0, view: () => null, tempo: () => tempo });
        fx.end(called, speed);
        fx.end(doubled, speed);
        expect(out.map((f) => f.kind)).toEqual(['stamp', 'stamp']);
        expect(motionOf(out[0]!), `${tempo} at speed ${speed}`).toBeLessThanOrEqual(T.bidCalled.gap * speed);
        expect(motionOf(out[1]!), `${tempo} at speed ${speed}`).toBeLessThanOrEqual(T.doubled.gap * speed);
      }
    }
  });
});

describe('the dealer badge hop', () => {
  function badgeOf(dealer: Seat, anchors = fakeAnchors()) {
    const table = new Table({ seed: 7, humanSeats: [] });
    const scored = table.drainEvents().find((e) => e.kind === 'dealScored');
    if (!scored) throw new Error('no dealScored');
    const bus = new FxBus();
    const out: Fx[] = [];
    bus.subscribe((fx) => out.push(fx));
    const view = { ...table.view(0 as Seat), dealer };
    makeFxSpawner({ anchors, bus, lang: new Lang('hr'), mySeat: () => 0, view: () => view }).start(scored, 1);
    const badge = out.find((fx) => fx.kind === 'badge');
    if (!badge || badge.kind !== 'badge') throw new Error('no badge');
    return badge;
  }
  const corner = (r: { x: number; y: number }) => ({ x: r.x - 2 + DEALER_BADGE / 2, y: r.y - 2 + DEALER_BADGE / 2 });

  it('lands on my puck, not on my hand — my seat anchor is the fan', () => {
    const b = badgeOf(3 as Seat);
    expect(b.from).toEqual(corner({ x: 360, y: 190 }));
    expect(b.to).toEqual(corner({ x: 30, y: 300 }));
  });

  it('falls back to the seat anchor where no puck is registered', () => {
    const anchors = fakeAnchors();
    anchors.delete('puck:0');
    expect(badgeOf(3 as Seat, anchors).to).toEqual(corner({ x: 0, y: 40 }));
  });

  it("never flies from where the lobby drew another player", () => {
    // Anchors outlive their views: online, the seat map left `puck:s` for
    // every seat in the same map the table uses.
    const anchors = fakeAnchors();
    anchors.set('puck:3', { x: 900, y: 900, w: 58, h: 58 });
    anchors.set('puck:1', { x: 800, y: 800, w: 58, h: 58 });
    const b = badgeOf(3 as Seat, anchors);
    expect(b.from).toEqual(corner({ x: 360, y: 190 }));
    const c = badgeOf(0 as Seat, anchors);
    expect(c.to).toEqual(corner({ x: 120, y: 90 }));
  });
});

describe('confetti', () => {
  it('rains across the whole width for every seed, never in a band', () => {
    // (seed·131 + i·197) mod 100 stepped −3 a piece: one band over half the width.
    for (const n of [18, 26]) {
      for (let seed = 1; seed <= 300; seed++) {
        const xs = Array.from({ length: n }, (_, i) => confettiX(seed, i, n)).sort((a, b) => a - b);
        expect(xs[0]).toBeGreaterThanOrEqual(0);
        expect(xs[0]).toBeLessThan(1 / n);
        expect(xs[n - 1]).toBeLessThan(1);
        expect(xs[n - 1]).toBeGreaterThanOrEqual((n - 1) / n);
        for (let i = 1; i < n; i++) expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(2 / n);
      }
    }
  });
});

describe('a table gift', () => {
  it('lands before a second is up, and overlaps the badge only briefly', () => {
    const fx: Fx = {
      kind: 'gift',
      gift: 'kava',
      from: { x: 0, y: 0 },
      to: { x: 200, y: 100 },
      duration: GIFT_FLY_MS,
      size: GIFT_FLIGHT_SIZE,
      landSize: 20,
    };
    expect(motionOf(fx)).toBe(GIFT_FLY_MS);
    expect(lifetimeOf(fx) - motionOf(fx)).toBeLessThanOrEqual(60);
    expect(lifetimeOf(fx)).toBeLessThanOrEqual(1000);
  });

  it("the bus's own id never replaces the gift it carries", () => {
    // Every sprite gets `id: number` from the bus; a gift carried as `id`
    // was overwritten by it and flew as nothing at all.
    const bus = new FxBus();
    const seen: Fx[] = [];
    bus.subscribe((f) => seen.push(f));
    bus.emit({ kind: 'gift', gift: 'kava', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, duration: GIFT_FLY_MS, size: GIFT_FLIGHT_SIZE, landSize: 20 });
    const g = seen[0]!;
    expect(g.kind === 'gift' && g.gift).toBe('kava');
  });
});
