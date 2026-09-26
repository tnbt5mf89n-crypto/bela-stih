import { describe, expect, it } from 'vitest';
import {
  applyAction,
  cardId,
  createMatch,
  currentActor,
  detectDeclarations,
  legalActions,
  makeRng,
  publicView,
  startDeal,
  teamOf,
  type Action,
  type Card,
  type DealScoreResult,
  type GameState,
  type Seat,
} from '@belot/engine';
import { HARD_CONFIG_OVERRIDES, type EngineConfig } from '@belot/shared-types';

/**
 * The self-play harness. Thousands of deals of uniformly random *legal* play,
 * asserting the engine's invariants after every one. Random play is deliberate:
 * it wanders into positions a heuristic bot would never reach (forced
 * undertrumps, valats, mutual declaration cancellations, exact ties).
 *
 * Everything is seeded, so any failure reports the seed that reproduces it.
 */

const DEALS = Number(process.env.SELFPLAY_DEALS ?? 10_000);

interface Invariants {
  deals: number;
  pads: number;
  valats: number;
  belas: number;
  declarationContests: number;
  cancelledContests: number;
  kontras: number;
  matches: number;
  maxDealScore: number;
}

function checkDeal(s: GameState, r: DealScoreResult, inv: Invariants): void {
  // Every card played exactly once, in exactly eight tricks.
  expect(s.completedTricks).toHaveLength(8);
  const played = s.completedTricks.flatMap((t) => t.cards).map(cardId);
  expect(played).toHaveLength(32);
  expect(new Set(played).size).toBe(32);
  expect(s.hands.every((h) => h.length === 0)).toBe(true);

  // Point conservation: the table is always worth 152 in cards, 162 with the last trick.
  expect(r.cardPoints[0] + r.cardPoints[1]).toBe(152);
  expect(r.trickPoints[0] + r.trickPoints[1]).toBe(162);

  // Valat is all-or-nothing and belongs to whoever actually swept.
  const tricksWon: [number, number] = [0, 0];
  for (const t of s.completedTricks) tricksWon[teamOf(t.winnerSeat)] += 1;
  expect(tricksWon[0] + tricksWon[1]).toBe(8);
  if (tricksWon[0] === 8) expect(r.valatTeam).toBe(0);
  else if (tricksWon[1] === 8) expect(r.valatTeam).toBe(1);
  else expect(r.valatTeam).toBeNull();
  if (r.valatTeam !== null) {
    expect(r.valatBonus[r.valatTeam]).toBe(90);
    inv.valats += 1;
  }

  // Bela is worth 20 to exactly one side, or nobody.
  expect(r.bela[0] + r.bela[1]).toBeLessThanOrEqual(20);
  expect([0, 20]).toContain(r.bela[0]);
  expect([0, 20]).toContain(r.bela[1]);
  if (r.bela[0] + r.bela[1] > 0) inv.belas += 1;

  // Only one team ever scores declarations.
  expect(Math.min(r.declarationPoints[0], r.declarationPoints[1])).toBe(0);
  const anyDeclared = s.announcedDeclarations.some((d) => d.length > 0);
  if (anyDeclared) {
    inv.declarationContests += 1;
    if (r.declarationPoints[0] + r.declarationPoints[1] === 0) inv.cancelledContests += 1;
  }

  // rawTotal is exactly its declared parts.
  for (const t of [0, 1] as const) {
    expect(r.rawTotal[t]).toBe(
      r.trickPoints[t] + r.valatBonus[t] + r.declarationPoints[t] + r.bela[t],
    );
  }

  // The contract check is a strict comparison, so an exact tie must fail.
  // callerSeat and multiplier survive scoring; only startDeal clears them.
  const callerTeam = teamOf(s.callerSeat!);
  const other = (1 - callerTeam) as 0 | 1;
  expect(r.callerMade).toBe(r.rawTotal[callerTeam] > r.rawTotal[other]);
  if (!r.callerMade) {
    inv.pads += 1;
    // A failed caller keeps nothing but its bela.
    expect(r.finalScore[callerTeam]).toBe(r.bela[callerTeam]);
  }

  // Conservation across the whole deal, multiplier included.
  //
  // Over FACE VALUE now, because nothing leaves the deal any more. A pair that
  // took no trick still cannot bank its own zvanja, but taking no trick is a
  // štiglja against you, and those points cross to the pair that swept instead
  // of evaporating. So every announced point is paid to somebody.
  const valatTotal = r.valatBonus[0] + r.valatBonus[1];
  const declPayable = r.declarationPoints[0] + r.declarationPoints[1];
  const flatTotal = declPayable + r.bela[0] + r.bela[1];
  const expectedTotal = (162 + valatTotal) * s.multiplier + flatTotal;
  expect(r.finalScore[0] + r.finalScore[1]).toBe(expectedTotal);

  // And the rule itself, stated directly: nought tricks, nothing banked.
  for (const t of [0, 1] as const) {
    if (tricksWon[t] === 0 && r.callerMade) {
      expect(r.finalScore[t]).toBe(
        r.bela[t] * (s.config.kontraScope === 'all' ? s.multiplier : 1),
      );
    }
  }

  expect(r.finalScore[0]).toBeGreaterThanOrEqual(0);
  expect(r.finalScore[1]).toBeGreaterThanOrEqual(0);
  inv.maxDealScore = Math.max(inv.maxDealScore, r.finalScore[0], r.finalScore[1]);
}

/** The engine must be pure: applying an action never mutates the state passed in. */
function assertPure(before: GameState, action: Action): void {
  const snapshot = JSON.stringify({ ...before, rng: undefined, config: undefined });
  applyAction(before, action);
  expect(JSON.stringify({ ...before, rng: undefined, config: undefined })).toBe(snapshot);
}

/**
 * The security property, stated exactly: a seat's view may never contain a card
 * that is right now in SOMEBODY ELSE's UNREVEALED hand. Cards already played are
 * public, a seat's own cards are its own business, and the winning side's zvanja
 * are laid face up by the rules — everyone at a real table sees them, and they
 * stay in the owner's hand until played.
 *
 * That exemption is only as safe as the reveal itself, so the reveal is checked
 * first and harder: nothing may be in it that was not announced, and nothing may
 * be in it from the side that LOST the contest. A losing player's cards staying
 * secret is the whole reason the reveal is scoped to the winner.
 */
function assertNoLeak(s: GameState): void {
  // The history names only cards already played, and all of them.
  const h = publicView(s, 0).history!;
  expect(h.tricks).toHaveLength(s.completedTricks.length);
  const held = new Set(s.hands.flat().map(cardId));
  for (const t of h.tricks) for (const p of t.plays) expect(held.has(cardId(p.card))).toBe(false);
  for (const d of s.revealedDeclarations) {
    // Announced by that seat — matched on the CARD SET, not on kind/value/top.
    // Matching on the description only bounded what the reveal claimed to be,
    // not what it actually carried, so a reveal that exposed more of the
    // declarer's hand than the combination contains passed silently.
    const key = (cs: Card[]) => cs.map(cardId).sort().join('|');
    expect(s.announcedDeclarations[d.seat]!.some((a) => key(a.cards) === key(d.cards))).toBe(true);
    // ...and it is the size the combination says it is.
    expect(d.cards).toHaveLength(d.kind === 'carre' ? 4 : d.length);
    // ...and that seat is on the side that won.
    expect(s.declarationWinner).not.toBeNull();
    expect(teamOf(d.seat)).toBe(s.declarationWinner);
    // ...and every card of it is genuinely that seat's, held or already played.
    const mine = new Set([
      ...s.hands[d.seat]!.map(cardId),
      ...s.completedTricks.flatMap((t) => t.cards).map(cardId),
      ...s.currentTrick.map((p) => cardId(p.card)),
    ]);
    for (const c of d.cards) expect(mine.has(cardId(c))).toBe(true);
  }

  const revealed = new Set(s.revealedDeclarations.flatMap((d) => d.cards.map(cardId)));
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    const others = new Set(
      ([0, 1, 2, 3] as Seat[])
        .filter((x) => x !== seat)
        .flatMap((x) => s.hands[x]!.map(cardId)),
    );
    const leaked = collectCards(publicView(s, seat))
      .map(cardId)
      .filter((id) => others.has(id) && !revealed.has(id));
    expect(leaked).toEqual([]);
  }
}

function collectCards(value: unknown, out: Card[] = []): Card[] {
  if (Array.isArray(value)) {
    for (const v of value) collectCards(v, out);
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.suit === 'string' && typeof o.rank === 'string') out.push(o as unknown as Card);
    else for (const v of Object.values(o)) collectCards(v, out);
  }
  return out;
}

function freshInvariants(): Invariants {
  return {
    deals: 0,
    pads: 0,
    valats: 0,
    belas: 0,
    declarationContests: 0,
    cancelledContests: 0,
    kontras: 0,
    matches: 0,
    maxDealScore: 0,
  };
}

/** Random legal play over `deals` deals under `config`, every scored deal checked against the invariants. */
function runHarness(config: Partial<EngineConfig>, deals: number, rng: () => number, inv: Invariants): void {
  let matchSeed = 1;
  let s = startDeal(createMatch({ seed: matchSeed, dealer: 0, config: config }));
  let steps = 0;

  while (inv.deals < deals) {
    if (steps++ > deals * 200) throw new Error('harness failed to make progress');

    const actor = currentActor(s);
    expect(actor).not.toBeNull();

    const legal = legalActions(s);
    expect(legal.length).toBeGreaterThan(0);
    // Every offered action must name the seat actually on turn.
    for (const a of legal) expect(a.seat).toBe(actor);

    let choice = legal[Math.floor(rng() * legal.length)]!;
    // Blind zvanja offer a card-less template and the marking is the claim: mark a
    // real one two times in three, a wrong one otherwise, or nothing is ever announced.
    if (choice.type === 'DECLARE_ANNOUNCE' && !choice.cards) {
      const hand = s.hands[actor!]!;
      const held = detectDeclarations(hand, actor!);
      const wrong = held.length === 0 || rng() < 1 / 3;
      choice = { type: 'DECLARE_ANNOUNCE', seat: actor!, cards: wrong ? hand.slice(0, 3) : held[Math.floor(rng() * held.length)]!.cards };
    }

    // Spot-check purity and hidden hands without paying for it every step.
    if (steps % 997 === 0) {
      assertPure(s, choice);
      if (s.phase === 'PLAY') assertNoLeak(s);
    }

    const before = s;
    s = applyAction(s, choice);

    if (before.phase === 'DOUBLE' && s.multiplier !== before.multiplier) inv.kontras += 1;

    if (s.phase === 'DEAL_OVER' || s.phase === 'MATCH_OVER') {
      if (s.lastDealResult) {
        checkDeal(s, s.lastDealResult, inv);
        inv.deals += 1;
      }
      if (s.phase === 'MATCH_OVER') {
        inv.matches += 1;
        s = startDeal(createMatch({ seed: ++matchSeed, dealer: 0, config: config }));
      } else {
        s = startDeal(s);
      }
    }
  }
}

describe('self-play harness', () => {
  it(`survives ${DEALS.toLocaleString()} deals of random legal play`, () => {
    const rng = makeRng(0xbe10c);
    const inv = freshInvariants();

    // Keep the doubling path under test, and the tie-cancel HOUSE RULE on so the
    // cancelled-contest invariant still gets exercised (the shipped default now
    // resolves ties to the first player in rotation, per UHDDR rule 7).
    runHarness({ allowKontra: true, declarationTieCancels: true }, DEALS, rng, inv);

    // The harness is only meaningful if random play actually reaches the hard cases.
    expect(inv.deals).toBe(DEALS);
    expect(inv.matches).toBeGreaterThan(0);
    expect(inv.pads).toBeGreaterThan(0);
    expect(inv.belas).toBeGreaterThan(0);
    expect(inv.declarationContests).toBeGreaterThan(0);
    expect(inv.cancelledContests).toBeGreaterThan(0);
    expect(inv.kontras).toBeGreaterThan(0);
    expect(inv.valats).toBeGreaterThan(0);

    // Surface the coverage so a regression in reachability is visible in CI output.
    console.log(
      `[selfplay] ${inv.deals} deals over ${inv.matches} matches — ` +
        `${inv.pads} pads, ${inv.valats} valats, ${inv.belas} belas, ` +
        `${inv.declarationContests} declaration contests (${inv.cancelledContests} cancelled), ` +
        `${inv.kontras} doublings, biggest deal ${inv.maxDealScore}`,
    );
  });

  // The three overlays a player can actually choose, so the invariants are
  // proven on what ships and not only on the harness's own house rules. A
  // fifth of the deals each; the nightly run (SELFPLAY_DEALS=100000) makes that 20k.
  const OVERLAY_DEALS = Math.max(200, Math.floor(DEALS / 5));
  it.each([
    ['learn', {} as Partial<EngineConfig>],
    ['easy', { declarationMode: 'blind' } as Partial<EngineConfig>],
    ['hard', HARD_CONFIG_OVERRIDES as Partial<EngineConfig>],
  ])(`survives ${OVERLAY_DEALS.toLocaleString()} deals on the shipped %s overlay`, (name, config) => {
    const rng = makeRng(0x5e1f + ['learn', 'easy', 'hard'].indexOf(name) * 7919);
    const inv = freshInvariants();
    runHarness(config, OVERLAY_DEALS, rng, inv);
    expect(inv.deals).toBe(OVERLAY_DEALS);
    expect(inv.matches).toBeGreaterThan(0);
    expect(inv.pads).toBeGreaterThan(0);
    expect(inv.belas).toBeGreaterThan(0);
    // Blind modes announce too (the marking policy above), so their zvanja paths are exercised.
    expect(inv.declarationContests).toBeGreaterThan(0);
    console.log(
      `[selfplay:${name}] ${inv.deals} deals over ${inv.matches} matches — ` +
        `${inv.pads} pads, ${inv.valats} valats, ${inv.belas} belas, ` +
        `${inv.declarationContests} declaration contests, biggest deal ${inv.maxDealScore}`,
    );
  });
});
