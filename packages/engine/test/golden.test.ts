import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canon, EVENT_KINDS, hash64, runGolden, SCENARIOS, type GoldenReport } from './golden/run';

/**
 * The rules produce today what they produced when expected.json was written.
 * A hash that moves is a rules change - wanted or not - and the first deal
 * that moved is named. Refresh the fixture only for a change made on purpose:
 *
 *   GOLDEN_UPDATE=1 npx vitest run packages/engine/test/golden.test.ts
 *
 * and say why in the same commit.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'golden', 'expected.json');

describe('the golden corpus', () => {
  const report = runGolden();

  it('is the same as when it was written, deal for deal', () => {
    if (process.env.GOLDEN_UPDATE) {
      writeFileSync(FIXTURE, JSON.stringify(report, null, 1) + '\n');
    }
    expect(existsSync(FIXTURE), 'no fixture: run once with GOLDEN_UPDATE=1').toBe(true);
    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8')) as GoldenReport;
    expect(report.version).toBe(expected.version);
    expect(report.scenarios.map((s) => s.name)).toEqual(expected.scenarios.map((s) => s.name));
    for (const [i, s] of report.scenarios.entries()) {
      const was = expected.scenarios[i]!;
      // The rules first: the actions, the events and the result of every deal.
      const firstPlay = s.playHashes.findIndex((h, d) => h !== was.playHashes[d]);
      expect(
        firstPlay,
        `${s.name} (seed ${s.seed}): deal ${firstPlay + 1} of ${s.playHashes.length} PLAYS differently (${s.playHashes[firstPlay]} vs ${was.playHashes[firstPlay]}) - the rules changed`,
      ).toBe(-1);
      // Then the views: a field added to PublicView moves these and only these.
      const firstDiff = s.dealHashes.findIndex((h, d) => h !== was.dealHashes[d]);
      expect(
        firstDiff,
        `${s.name} (seed ${s.seed}): deal ${firstDiff + 1} of ${s.dealHashes.length} no longer hashes the same (${s.dealHashes[firstDiff]} vs ${was.dealHashes[firstDiff]}) - the views or events changed (the plays did not)`,
      ).toBe(-1);
      expect(s.dealHashes.length, `${s.name}: the match now has a different number of deals`).toBe(was.dealHashes.length);
      expect(s.hash).toBe(was.hash);
    }
    expect(report.hash).toBe(expected.hash);
    expect(report.playHash).toBe(expected.playHash);
  });

  it('reaches every event kind and every rare path', () => {
    const kinds = new Set(report.scenarios.flatMap((s) => Object.keys(s.events)));
    for (const k of EVENT_KINDS) expect(kinds.has(k), `no scenario emits ${k}`).toBe(true);
    const total = report.scenarios.reduce(
      (acc, s) => {
        for (const [k, v] of Object.entries(s.coverage)) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      },
      {} as Record<string, number>,
    );
    for (const k of ['pad', 'valat', 'muss', 'bela', 'contest', 'cancelled', 'renons', 'kontra']) {
      expect(total[k] ?? 0, `the corpus never reaches ${k}`).toBeGreaterThan(0);
    }
    // Renons only where it was asked for, and there in every match.
    for (const s of report.scenarios) {
      const wanted = SCENARIOS.find((x) => x.name === s.name)!.policy === 'renons';
      expect(s.coverage.renons > 0, `${s.name}: renons ${wanted ? 'expected' : 'not expected'}`).toBe(wanted);
    }
    // Every scenario - the blind modes included - announces zvanja and reveals them (or cancels
    // the contest, where that is the point), so the marking check, the blind reveal and their
    // scoring are in every mode's hashes. Automatic zvanja announce nothing: there, zvanja paid.
    for (const s of report.scenarios) {
      if (s.config.declarationMode === 'auto') {
        expect(s.coverage.zvanjaPaid, `${s.name}: automatic zvanja never paid out`).toBeGreaterThan(0);
        continue;
      }
      expect(s.coverage.announced, `${s.name}: no deal announced a zvanje`).toBeGreaterThan(0);
      expect((s.events['declarationsRevealed'] ?? 0) + s.coverage.cancelled, `${s.name}: zvanja neither revealed nor cancelled`).toBeGreaterThan(0);
    }
    // And a renons paid out announced zvanja at least once, so that credit is hashed too.
    expect(report.scenarios.reduce((n, s) => n + s.coverage.renonsZvanja, 0), 'no renons deal ever credited announced zvanja').toBeGreaterThan(0);
    // The searched seed still does what it was chosen for.
    const tie = report.scenarios.find((s) => s.name === 'knobs-tiecancel-cancelled-501')!;
    expect(tie.coverage.cancelled, 'seed 4017 no longer produces a cancelled contest').toBeGreaterThan(0);
  });

  it('hashes canonically: key order and undefined never matter, and a changed value does', () => {
    expect(canon({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
    expect(hash64(canon({ x: 1, y: 2 }))).toBe(hash64(canon({ y: 2, x: 1 })));
    expect(hash64(canon({ x: 1 }))).not.toBe(hash64(canon({ x: 2 })));
    expect(hash64('')).toHaveLength(16);
  });

  it('is deterministic run to run', () => {
    const again = runGolden([SCENARIOS[0]!.name]);
    expect(again.scenarios[0]!.hash).toBe(report.scenarios[0]!.hash);
  });
});
