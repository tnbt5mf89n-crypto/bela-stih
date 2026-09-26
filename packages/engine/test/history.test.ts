import { describe, expect, it } from 'vitest';
import {
  applyAction,
  cardId,
  createMatch,
  currentActor,
  legalActions,
  makeRng,
  publicView,
  startDeal,
  type GameState,
  type Seat,
} from '@belot/engine';
import { HARD_CONFIG_OVERRIDES } from '@belot/shared-types';

/**
 * PublicView.history: the bidding and every finished trick of the deal, with
 * seats - what the whole table saw, kept for the seat that looks back. Public
 * by construction, and derived, so this checks the derivation against the
 * engine's own turn order rather than against itself.
 */

function randomDeal(seed: number, config = {}): { states: GameState[]; leaders: Seat[]; turns: Seat[]; bids: { seat: Seat; suit: string | null }[] } {
  const rng = makeRng(seed);
  let s = startDeal(createMatch({ seed, dealer: (seed % 4) as Seat, config }));
  const states: GameState[] = [s];
  const leaders: Seat[] = [];
  const turns: Seat[] = [];
  const bids: { seat: Seat; suit: string | null }[] = [];
  while (s.phase !== 'DEAL_OVER' && s.phase !== 'MATCH_OVER') {
    const legal = legalActions(s);
    const a = legal[Math.floor(rng() * legal.length)]!;
    if (a.type === 'PLAY_CARD') {
      leaders.push(s.trickLeader!);
      turns.push(s.turn!);
    }
    if (a.type === 'BID_PASS') bids.push({ seat: a.seat, suit: null });
    if (a.type === 'BID_CALL') bids.push({ seat: a.seat, suit: a.suit });
    s = applyAction(s, a);
    states.push(s);
  }
  return { states, leaders, turns, bids };
}

describe('PublicView.history', () => {
  it('names the seat behind every play exactly as the engine ordered them, and the winner of every trick', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { states, leaders, turns } = randomDeal(seed, seed % 2 ? {} : HARD_CONFIG_OVERRIDES);
      const last = states[states.length - 1]!;
      const h = publicView(last, 0).history!;
      expect(h.tricks).toHaveLength(last.completedTricks.length);
      let k = 0;
      for (const [i, t] of h.tricks.entries()) {
        expect(t.winner).toBe(last.completedTricks[i]!.winnerSeat);
        expect(t.leader).toBe(leaders[k]);
        for (const [j, p] of t.plays.entries()) {
          expect(p.seat, `seed ${seed} trick ${i} play ${j}`).toBe(turns[k]);
          expect(cardId(p.card)).toBe(cardId(last.completedTricks[i]!.cards[j]!));
          k++;
        }
      }
      // Every play of every finished trick is accounted for, in order.
      expect(k).toBe(last.completedTricks.reduce((n, t) => n + t.cards.length, 0));
    }
  });

  it('keeps the bidding as it was answered, and clears with the next deal', () => {
    const { states, bids } = randomDeal(7);
    const last = states[states.length - 1]!;
    const h = publicView(last, 2).history!;
    expect(h.bids).toEqual(bids);
    expect(h.bids.length).toBeGreaterThan(0);
    const next = startDeal(last);
    expect(publicView(next, 0).history).toEqual({ bids: [], tricks: [] });
  });

  it('is the same for all four seats, and grows only with what was played face up', () => {
    const { states } = randomDeal(11);
    for (const s of states) {
      const views = ([0, 1, 2, 3] as Seat[]).map((seat) => publicView(s, seat).history);
      for (const v of views) expect(v).toEqual(views[0]);
      const h = views[0]!;
      expect(h.tricks).toHaveLength(s.completedTricks.length);
      // Nothing in the history is still in anybody's hand.
      const held = new Set(s.hands.flat().map(cardId));
      for (const t of h.tricks) for (const p of t.plays) expect(held.has(cardId(p.card))).toBe(false);
      // And the seat on turn is consistent with the last record.
      if (s.phase === 'PLAY' && s.currentTrick.length === 0 && h.tricks.length > 0) {
        expect(currentActor(s)).toBe(h.tricks[h.tricks.length - 1]!.winner);
      }
    }
  });
});
