import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  cardId,
  makeDeck,
  parseCard,
  pointValue,
  computeDealProgress,
  scoreDeal,
  teamOf,
  type DealProgress,
  type DealScoreResult,
  type DealTrick,
  type EngineConfig,
  type PlayContext,
  type Seat,
  type TeamId,
  type DeclarationResolution,
} from '@belot/engine';

const TRUMP: PlayContext = { contractType: 'SUIT', trumpSuit: 'spades' };
const c = parseCard;

function tricks(plan: Array<[Seat, string[]]>): DealTrick[] {
  const all = plan.flatMap(([, ids]) => ids);
  // Guard the fixture: a deal is exactly the 32-card deck, each card once.
  expect(all).toHaveLength(32);
  expect(new Set(all).size).toBe(32);
  return plan.map(([winnerSeat, ids]) => ({ winnerSeat, cards: ids.map(c) }));
}

function noDeclarations(): DeclarationResolution {
  return { winningTeam: null, perTeamValue: [0, 0], winningDeclarations: [] };
}

function declarationsWorth(team: TeamId, value: number): DeclarationResolution {
  const perTeamValue: [number, number] = [0, 0];
  perTeamValue[team] = value;
  return { winningTeam: team, perTeamValue, winningDeclarations: [] };
}

interface ScoreOpts {
  tricks: DealTrick[];
  callerTeam: TeamId;
  multiplier?: 1 | 2 | 4;
  declarations?: DeclarationResolution;
  belaTeam?: TeamId | null;
  config?: Partial<EngineConfig>;
}

function score(o: ScoreOpts): DealScoreResult {
  return scoreDeal({
    ctx: TRUMP,
    tricks: o.tricks,
    teamOf,
    callerTeam: o.callerTeam,
    multiplier: o.multiplier ?? 1,
    declarations: o.declarations ?? noDeclarations(),
    belaTeam: o.belaTeam ?? null,
    config: { ...DEFAULT_CONFIG, ...o.config },
  });
}

/**
 * A hand-verified deal that splits the table exactly 81-81:
 * team 0 takes 71 card points plus the last trick, team 1 takes 81 card points.
 */
const EVEN_SPLIT = tricks([
  [1, ['9S', 'QS', 'QH', 'JH']], // 14 + 3 + 3 + 2 = 22
  [1, ['10H', 'KD', 'QD', 'JD']], // 10 + 4 + 3 + 2 = 19
  [3, ['10D', 'AC', 'KC', 'QC']], // 10 + 11 + 4 + 3 = 28
  [1, ['JC', '10C', '8C', '7C']], // 2 + 10 + 0 + 0 = 12   -> team 1 total 81
  [0, ['JS', 'AS', '10S', 'KS']], // 20 + 11 + 10 + 4 = 45
  [0, ['AH', 'KH', 'AD', '8S']], // 11 + 4 + 11 + 0 = 26
  [2, ['7S', '9H', '8H', '7H']], // 0
  [0, ['9D', '8D', '7D', '9C']], // 0                      -> team 0 total 71 (+10 last trick)
]);

/** Every trick to seat 1, so team 1 sweeps: valat by the defending side. */
const SWEEP_BY_TEAM_1 = tricks(
  Array.from({ length: 8 }, (_, i) => {
    const chunk = makeDeck().slice(i * 4, i * 4 + 4).map(cardId);
    return [1 as Seat, chunk] as [Seat, string[]];
  }),
);

describe('the fixtures themselves', () => {
  it('splits the even-split deal 71/81 in raw card points', () => {
    const r = score({ tricks: EVEN_SPLIT, callerTeam: 0 });
    expect(r.cardPoints).toEqual([71, 81]);
    expect(r.cardPoints[0] + r.cardPoints[1]).toBe(152);
  });

  it('always totals 162 trick points across both teams', () => {
    for (const t of [EVEN_SPLIT, SWEEP_BY_TEAM_1]) {
      const r = score({ tricks: t, callerTeam: 0 });
      expect(r.trickPoints[0] + r.trickPoints[1]).toBe(162);
    }
  });

  it('agrees with a direct sum over the deck', () => {
    const direct = makeDeck().reduce((s, card) => s + pointValue(card, TRUMP), 0);
    expect(direct).toBe(152);
  });
});

/** An exact 81-81 tie is a FAILED contract (pad) — the caller must be strictly ahead. */
describe('the contract threshold is a comparison, not a fixed 82', () => {
  it('fails the caller on an exact 81-81 tie', () => {
    const r = score({ tricks: EVEN_SPLIT, callerTeam: 0 });
    expect(r.rawTotal).toEqual([81, 81]);
    expect(r.callerMade).toBe(false);
    // Pad: the defenders take the whole table.
    expect(r.finalScore).toEqual([0, 162]);
  });

  it('fails the other side too on the same tie — the tie itself is what loses', () => {
    const r = score({ tricks: EVEN_SPLIT, callerTeam: 1 });
    expect(r.callerMade).toBe(false);
    expect(r.finalScore).toEqual([162, 0]);
  });

  it('lets the caller through on a single point of daylight', () => {
    // A 20-point terca tips team 0 to 101 against 81.
    const r = score({
      tricks: EVEN_SPLIT,
      callerTeam: 0,
      declarations: declarationsWorth(0, 20),
    });
    expect(r.rawTotal).toEqual([101, 81]);
    expect(r.callerMade).toBe(true);
    expect(r.finalScore).toEqual([101, 81]);
    expect(r.finalScore[0] + r.finalScore[1]).toBe(182); // 162 + 20
  });

  it('hands the defenders the callers declarations on a pad', () => {
    // Team 0 calls and holds a 50-point kvarta but still cannot get ahead.
    const r = score({
      tricks: SWEEP_BY_TEAM_1,
      callerTeam: 0,
      declarations: declarationsWorth(0, 50),
    });
    expect(r.callerMade).toBe(false);
    // Defenders take 162 + 90 valat + the callers' 50.
    expect(r.finalScore).toEqual([0, 302]);
  });
});

describe('valat', () => {
  it('pays 90 on top of the last trick, for 252 in all', () => {
    const r = score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 1 });
    expect(r.valatTeam).toBe(1);
    expect(r.trickPoints).toEqual([0, 162]);
    expect(r.valatBonus).toEqual([0, 90]);
    expect(r.callerMade).toBe(true);
    expect(r.finalScore).toEqual([0, 252]);
  });

  /** The house-rule knob: every other valat here pays the default, and the golden scenario that sets it never sweeps. */
  it('pays the bonus the table set, not a fixed 90', () => {
    const r = score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 1, config: { valatBonus: 100 } });
    expect(r.valatBonus).toEqual([0, 100]);
    expect(r.finalScore).toEqual([0, 262]);
  });

  /** The sweep can belong to the DEFENDING team when a contract collapses. */
  it('pays out to the defenders when they are the ones who swept', () => {
    const r = score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 0 });
    expect(r.valatTeam).toBe(1);
    expect(r.callerMade).toBe(false);
    expect(r.finalScore).toEqual([0, 252]);
  });

  it('pays nothing when the tricks are shared', () => {
    const r = score({ tricks: EVEN_SPLIT, callerTeam: 0 });
    expect(r.valatTeam).toBeNull();
    expect(r.valatBonus).toEqual([0, 0]);
  });
});

/**
 * Štiglja (valat): all eight tricks to one pair.
 *
 * The swept pair took no trick, so it cannot bank what it announced — and those
 * points do not simply leave the table. They cross to the pair that swept, the
 * same way a pad hands the defenders everything.
 */
describe('zvanja when one pair is štiglja-ed', () => {
  it('gives the sweeping pair the zvanja the swept pair could not bank', () => {
    // The caller sweeps; the defenders announced 40 and took nothing at all.
    const r = score({
      tricks: SWEEP_BY_TEAM_1,
      callerTeam: 1,
      declarations: declarationsWorth(0, 40),
    });
    expect(r.valatTeam).toBe(1);
    expect(r.tricksWon).toEqual([0, 8]);
    expect(r.callerMade).toBe(true);
    // Still ANNOUNCED by team 0 — the result sheet shows what was called.
    expect(r.declarationPoints).toEqual([40, 0]);
    // 162 + 90 valat + the defenders' 40, rather than 252 with 40 evaporating.
    expect(r.finalScore).toEqual([0, 292]);
  });

  it('leaves nothing on the table', () => {
    for (const value of [20, 50, 100, 150, 200]) {
      const r = score({
        tricks: SWEEP_BY_TEAM_1,
        callerTeam: 1,
        declarations: declarationsWorth(0, value),
      });
      expect(r.finalScore[0] + r.finalScore[1]).toBe(162 + 90 + value);
    }
  });

  it('leaves the sweeping pair its own zvanja alone', () => {
    const r = score({
      tricks: SWEEP_BY_TEAM_1,
      callerTeam: 1,
      declarations: declarationsWorth(1, 50),
    });
    expect(r.finalScore).toEqual([0, 302]);
  });

  it('does not move zvanja when both pairs took a trick', () => {
    const r = score({ tricks: EVEN_SPLIT, callerTeam: 0, declarations: declarationsWorth(0, 20) });
    expect(r.tricksWon.every((t) => t > 0)).toBe(true);
    expect(r.callerMade).toBe(true);
    expect(r.finalScore).toEqual([101, 81]);
  });

  it('is unchanged when the sweeper also broke the contract', () => {
    // The pad branch already handed the defenders both sides' zvanja.
    const r = score({
      tricks: SWEEP_BY_TEAM_1,
      callerTeam: 0,
      declarations: declarationsWorth(0, 50),
    });
    expect(r.callerMade).toBe(false);
    expect(r.finalScore).toEqual([0, 302]);
  });
});

/** Bela (trump K+Q) always belongs to its holder, whatever else happens. */
describe('bela', () => {
  it('still scores for the calling team on a failed contract', () => {
    const r = score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 0, belaTeam: 0 });
    expect(r.bela).toEqual([20, 0]);
    expect(r.callerMade).toBe(false);
    // Callers are wiped out except their bela; defenders take 162 + 90.
    expect(r.finalScore).toEqual([20, 252]);
  });

  it('can be switched off for tables that zero a failed team completely', () => {
    const r = score({
      tricks: SWEEP_BY_TEAM_1,
      callerTeam: 0,
      belaTeam: 0,
      config: { keepBelaOnFailedContract: false },
    });
    expect(r.finalScore).toEqual([0, 252]);
  });

  it('counts toward the contract check', () => {
    // 81-81 on the cards; the callers' bela breaks the tie in their favour.
    const r = score({ tricks: EVEN_SPLIT, callerTeam: 0, belaTeam: 0 });
    expect(r.rawTotal).toEqual([101, 81]);
    expect(r.callerMade).toBe(true);
    expect(r.finalScore).toEqual([101, 81]);
  });

  it('stays with a defender who holds it on a pad', () => {
    const r = score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 0, belaTeam: 1 });
    expect(r.finalScore).toEqual([0, 272]); // 162 + 90 + 20
  });

  it('defaults to being kept', () => {
    expect(DEFAULT_CONFIG.keepBelaOnFailedContract).toBe(true);
  });
});

describe('kontra and rekontra', () => {
  it('doubles and quadruples the trick points', () => {
    const base = score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 1 });
    expect(base.finalScore).toEqual([0, 252]);

    const kontra = score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 1, multiplier: 2 });
    expect(kontra.finalScore).toEqual([0, 504]);

    const rekontra = score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 1, multiplier: 4 });
    expect(rekontra.finalScore).toEqual([0, 1008]);
  });

  it('leaves declarations and bela at face value by default', () => {
    const r = score({
      tricks: SWEEP_BY_TEAM_1,
      callerTeam: 1,
      multiplier: 2,
      declarations: declarationsWorth(1, 50),
      belaTeam: 1,
    });
    // (162 + 90) * 2 doubled, then 50 + 20 added flat.
    expect(r.finalScore).toEqual([0, 574]);
  });

  it('scales everything when the table plays kontraScope: all', () => {
    const r = score({
      tricks: SWEEP_BY_TEAM_1,
      callerTeam: 1,
      multiplier: 2,
      declarations: declarationsWorth(1, 50),
      belaTeam: 1,
      config: { kontraScope: 'all' },
    });
    expect(r.finalScore).toEqual([0, 644]); // (252 + 70) * 2
  });

  it('never changes who made the contract', () => {
    for (const multiplier of [1, 2, 4] as const) {
      expect(score({ tricks: EVEN_SPLIT, callerTeam: 0, multiplier }).callerMade).toBe(false);
    }
  });

  it('multiplies a pad against the failing caller', () => {
    const r = score({ tricks: EVEN_SPLIT, callerTeam: 0, multiplier: 2 });
    expect(r.finalScore).toEqual([0, 324]); // 162 * 2
  });

  it('defaults to scaling only the trick points', () => {
    expect(DEFAULT_CONFIG.kontraScope).toBe('trickPoints');
  });
});

/** Whether an exact tie makes the contract is a real regional split. */
describe('the contract-tie convention is configurable', () => {
  it('fails the caller on a tie by default (Balkan pad)', () => {
    expect(DEFAULT_CONFIG.contractTieSucceeds).toBe(false);
    expect(score({ tricks: EVEN_SPLIT, callerTeam: 0 }).callerMade).toBe(false);
  });

  it('lets the tie stand under the French "at least as many" rule', () => {
    const r = score({
      tricks: EVEN_SPLIT,
      callerTeam: 0,
      config: { contractTieSucceeds: true },
    });
    expect(r.rawTotal).toEqual([81, 81]);
    expect(r.callerMade).toBe(true);
    expect(r.finalScore).toEqual([81, 81]);
  });

  it('changes nothing when the caller is genuinely ahead or behind', () => {
    for (const contractTieSucceeds of [false, true]) {
      expect(
        score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 1, config: { contractTieSucceeds } }).callerMade,
      ).toBe(true);
      expect(
        score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 0, config: { contractTieSucceeds } }).callerMade,
      ).toBe(false);
    }
  });
});

/** A made kontra is an open rules question, so both readings are pinned. */
describe('what a made kontra pays', () => {
  it('doubles each side separately by default', () => {
    expect(DEFAULT_CONFIG.kontraSuccessSweeps).toBe(false);
    const r = score({
      tricks: EVEN_SPLIT,
      callerTeam: 0,
      multiplier: 2,
      declarations: declarationsWorth(0, 20),
    });
    expect(r.callerMade).toBe(true);
    // 81 and 81 doubled, plus the callers' 20 at face value.
    expect(r.finalScore).toEqual([182, 162]);
  });

  it('lets the caller sweep the table when configured as a symmetric bet', () => {
    const r = score({
      tricks: EVEN_SPLIT,
      callerTeam: 0,
      multiplier: 2,
      declarations: declarationsWorth(0, 20),
      config: { kontraSuccessSweeps: true },
    });
    expect(r.callerMade).toBe(true);
    expect(r.finalScore).toEqual([344, 0]); // (81 + 81) * 2 + 20
  });

  it('leaves an undoubled deal alone whichever way it is set', () => {
    for (const kontraSuccessSweeps of [false, true]) {
      const r = score({ tricks: EVEN_SPLIT, callerTeam: 0, belaTeam: 0, config: { kontraSuccessSweeps } });
      expect(r.finalScore).toEqual([101, 81]);
    }
  });

  it('is a true mirror of the pad it doubles', () => {
    const made = score({
      tricks: SWEEP_BY_TEAM_1,
      callerTeam: 1,
      multiplier: 2,
      config: { kontraSuccessSweeps: true },
    });
    const failed = score({ tricks: SWEEP_BY_TEAM_1, callerTeam: 0, multiplier: 2 });
    // Same table, same stake: whoever wins the bet takes the same total.
    expect(made.finalScore[1]).toBe(failed.finalScore[1]);
  });
});

describe('input validation', () => {
  it('rejects a deal that is not exactly eight tricks', () => {
    expect(() => score({ tricks: EVEN_SPLIT.slice(0, 7), callerTeam: 0 })).toThrow(/8 tricks/);
  });
});

// ---------------------------------------------------------------------------
// Live deal progress
// ---------------------------------------------------------------------------

interface ProgressOpts extends ScoreOpts {
  provisional?: boolean;
  belaPending?: boolean;
}

function progress(o: ProgressOpts): DealProgress {
  return computeDealProgress({
    ctx: TRUMP,
    tricks: o.tricks,
    teamOf,
    callerTeam: o.callerTeam,
    multiplier: o.multiplier ?? 1,
    declarations: o.declarations ?? noDeclarations(),
    belaTeam: o.belaTeam ?? null,
    config: { ...DEFAULT_CONFIG, ...o.config },
    provisional: o.provisional ?? false,
    belaPending: o.belaPending ?? false,
  });
}

describe('the live deal counter', () => {
  it('opens at 82 of a 162 pot, with nobody safe and nobody doomed', () => {
    const p = progress({ tricks: [], callerTeam: 0 });
    expect(p.pot).toBe(162);
    expect(p.target).toBe(82);
    expect(p.callerNeeds).toBe(82);
    expect(p.tricksPlayed).toBe(0);
    expect(p.callerSafe).toBe(false);
    expect(p.callerDoomed).toBe(false);
  });

  it('drops the threshold by one when a tie is a make', () => {
    expect(progress({ tricks: [], callerTeam: 0, config: { contractTieSucceeds: true } }).target)
      .toBe(81);
  });

  it('grows the pot with zvanja, and credits them to the side that won them', () => {
    const mine = progress({ tricks: [], callerTeam: 0, declarations: declarationsWorth(0, 20) });
    expect(mine.pot).toBe(182);
    expect(mine.target).toBe(92);
    // 20 already banked, so 72 of card points still to find.
    expect(mine.callerNeeds).toBe(72);

    const theirs = progress({ tricks: [], callerTeam: 0, declarations: declarationsWorth(1, 20) });
    expect(theirs.target).toBe(92);
    expect(theirs.callerNeeds).toBe(92);
  });

  it('counts bela for its holder and in the pot', () => {
    const p = progress({ tricks: [], callerTeam: 0, belaTeam: 0 });
    expect(p.pot).toBe(182);
    expect(p.bela).toEqual([20, 0]);
    expect(p.running[0]).toBe(20);
  });

  it('never lets the kontra multiplier move the threshold', () => {
    // scoreDeal judges the contract at face value, so the counter must too.
    const targets = ([1, 2, 4] as const).map(
      (m) => progress({ tricks: [], callerTeam: 0, multiplier: m }).callerNeeds,
    );
    expect(new Set(targets).size).toBe(1);
  });

  it('agrees with scoreDeal once all eight tricks are in', () => {
    for (const fixture of [EVEN_SPLIT, SWEEP_BY_TEAM_1]) {
      for (const callerTeam of [0, 1] as TeamId[]) {
        for (const decls of [noDeclarations(), declarationsWorth(0, 50), declarationsWorth(1, 20)]) {
          const o = { tricks: fixture, callerTeam, declarations: decls, belaTeam: null };
          const live = progress(o);
          const final = score(o);
          expect(live.callerSafe).toBe(final.callerMade);
          // running excludes valat, which is exactly what rawTotal adds on top.
          expect(live.running[0]).toBe(final.rawTotal[0] - final.valatBonus[0]);
          expect(live.running[1]).toBe(final.rawTotal[1] - final.valatBonus[1]);
        }
      }
    }
  });

  it('tracks who could still sweep, and stops once the tricks are split', () => {
    const bothOpen = progress({ tricks: [], callerTeam: 0 });
    expect(bothOpen.valatPossible).toEqual([true, true]);

    const teamZeroOnly = progress({ tricks: EVEN_SPLIT.slice(0, 1), callerTeam: 0 });
    const winner = teamOf(EVEN_SPLIT[0]!.winnerSeat);
    expect(teamZeroOnly.valatPossible[winner]).toBe(true);
    expect(teamZeroOnly.valatPossible[(1 - winner) as TeamId]).toBe(false);

    // A finished deal can no longer "still" sweep, however it ended.
    expect(progress({ tricks: SWEEP_BY_TEAM_1, callerTeam: 0 }).valatPossible).toEqual([false, false]);
  });

  it('holds the last-trick bonus in the pot but credits it only at trick 8', () => {
    const midDeal = progress({ tricks: EVEN_SPLIT.slice(0, 4), callerTeam: 0 });
    expect(midDeal.pot).toBe(162);
    expect(midDeal.lastTrickTeam).toBeNull();
    expect(midDeal.running[0] + midDeal.running[1]).toBe(
      midDeal.cardPoints[0] + midDeal.cardPoints[1],
    );

    const done = progress({ tricks: EVEN_SPLIT, callerTeam: 0 });
    expect(done.lastTrickTeam).toBe(teamOf(EVEN_SPLIT[7]!.winnerSeat));
    expect(done.running[0] + done.running[1]).toBe(162);
  });

  it('calls a caller doomed once even everything left would not be enough', () => {
    // Team 1 sweeps: by the last trick the caller (team 0) cannot reach 82.
    const nearlyDone = progress({ tricks: SWEEP_BY_TEAM_1.slice(0, 7), callerTeam: 0 });
    expect(nearlyDone.callerDoomed).toBe(true);
    expect(progress({ tricks: [], callerTeam: 0 }).callerDoomed).toBe(false);
  });
});
