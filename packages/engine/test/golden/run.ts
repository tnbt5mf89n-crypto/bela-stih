import { HARD_CONFIG_OVERRIDES, type EngineConfig } from '@belot/shared-types';
import { cardId, detectDeclarations, type Action, type PublicView, type Seat } from '@belot/engine';
import { Table, type TableEvent } from '@belot/table';

/**
 * The golden corpus: seeded matches of uniformly random legal play, every
 * step recorded - the action, all four players' PublicViews, the TableEvents
 * it produced - and every scored deal's result, hashed deal by deal. The
 * committed hashes (expected.json) are what the rules produce today; a change
 * anywhere in the rules path (engine, table, redaction, event order) moves a
 * hash, and the first deal that moved says where.
 *
 * Pure on purpose: no Node, no file system, nothing but the packages. The
 * same function runs under vitest (Node), in Chromium (scripts/golden-
 * chromium.mjs) and, from the plan's R1, in Hermes on the phone - and must
 * give byte-identical results in all three. A JavaScript engine that sorted an
 * object's keys differently, or printed a number differently, would show up
 * here before it could show up at a table.
 *
 * Seeds are fixed and small: a corpus is worth nothing if it changes by itself.
 */

export const GOLDEN_VERSION = 3;

/** Every event kind the table can emit; the corpus must reach each one. */
export const EVENT_KINDS: TableEvent['kind'][] = [
  'dealStarted',
  'bidPassed',
  'bidCalled',
  'doubled',
  'doublePassed',
  'handsCompleted',
  'declared',
  'declarationSkipped',
  'declarationsRevealed',
  'belaCalled',
  'cardPlayed',
  'trickWon',
  'dealScored',
  'matchOver',
  'matchStarted',
];

export interface Scenario {
  name: string;
  seed: number;
  config: Partial<EngineConfig>;
  /** 'random': uniform over the legal actions. 'renons': also, once per deal, the first illegal card seen is played (renonsMode punish). */
  policy: 'random' | 'renons';
  /** A second match at the same table (matchStarted), also recorded. */
  rematch?: boolean;
}

const MODES: Record<string, Partial<EngineConfig>> = {
  learn: {},
  easy: { declarationMode: 'blind' },
  hard: HARD_CONFIG_OVERRIDES,
};

// Seeds were searched (search-seeds.ts) so that every match announces and reveals zvanja,
// learn-1001 forces a muss, and no two scenarios share a seed; they are not consecutive on purpose.
const MODE_SEEDS: Record<string, Record<number, number>> = {
  learn: { 501: 1000, 701: 1001, 1001: 1012 },
  easy: { 501: 1011, 701: 1013, 1001: 1014 },
  hard: { 501: 1021, 701: 1022, 1001: 1023 },
};

export const SCENARIOS: Scenario[] = [
  ...Object.entries(MODES).flatMap(([mode, config]) =>
    [501, 701, 1001].map((target) => ({
      name: `${mode}-${target}`,
      seed: MODE_SEEDS[mode]![target]!,
      config: { ...config, matchTarget: target },
      policy: 'random' as const,
      rematch: mode === 'learn' && target === 501,
    })),
  ),
  // The house-rule knobs, so a change in a dormant path is seen too.
  { name: 'knobs-kontra-tiecancel-1001', seed: 2001, config: { allowKontra: true, declarationTieCancels: true, matchTarget: 1001 }, policy: 'random' },
  { name: 'knobs-french-701', seed: 2002, config: { forcedOvertrumpOverPartner: false, contractTieSucceeds: true, keepBelaOnFailedContract: false, matchTarget: 701 }, policy: 'random' },
  // The remaining knobs: automatic zvanja and bela, kontra over everything and sweeping, a free dealer, other bonuses.
  { name: 'knobs-auto-scope-701', seed: 2003, config: { declarationMode: 'auto', belaMode: 'auto', allowKontra: true, kontraScope: 'all', kontraSuccessSweeps: true, dealerMustCall: false, lastTrickBonus: 0, valatBonus: 100, matchTarget: 701 }, policy: 'random' },
  // Seed 4017 was searched for: under the tie-cancel house rule, a deal where both
  // pairs announce equal best zvanja and nobody scores them. The test asserts it stays one.
  { name: 'knobs-tiecancel-cancelled-501', seed: 4017, config: { allowKontra: true, declarationTieCancels: true, matchTarget: 501 }, policy: 'random' },
  // Prava bela's renons: an illegal card ends the deal for the offender.
  { name: 'renons-hard-501-a', seed: 3002, config: { ...HARD_CONFIG_OVERRIDES, matchTarget: 501 }, policy: 'renons' },
  { name: 'renons-hard-501-b', seed: 3003, config: { ...HARD_CONFIG_OVERRIDES, matchTarget: 501 }, policy: 'renons' },
];

export interface Coverage {
  pad: number;
  valat: number;
  muss: number;
  bela: number;
  contest: number;
  cancelled: number;
  renons: number;
  kontra: number;
  /** Deals in which somebody announced a zvanje (in blind mode: marked a real one). */
  announced: number;
  /** Renons deals in which the defenders were also credited announced zvanja. */
  renonsZvanja: number;
  /** Deals in which zvanja were paid - the only trace of them under declarationMode 'auto', which announces nothing. */
  zvanjaPaid: number;
}

export interface ScenarioReport {
  name: string;
  seed: number;
  config: Partial<EngineConfig>;
  deals: number;
  steps: number;
  events: Record<string, number>;
  coverage: Coverage;
  /** One per scored deal, in order: the hash of everything recorded for it. */
  dealHashes: string[];
  /**
   * One per scored deal: the hash of the actions, the events and the result
   * only - not the views. The RULES: a change here is a rules change. A view
   * that grows (a new field) moves dealHashes and leaves these alone.
   */
  playHashes: string[];
  hash: string;
  playHash: string;
}

export interface GoldenReport {
  version: number;
  scenarios: ScenarioReport[];
  hash: string;
  /** Over the play hashes only: the rules' own fingerprint. */
  playHash: string;
}

// --- determinism helpers ---------------------------------------------------

/** xorshift32: the same sequence on every engine, from a 32-bit seed. */
export function rngOf(seed: number): () => number {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x1_0000_0000;
  };
}

/** JSON with sorted keys and no undefined: the same bytes from the same value, whatever built it. */
export function canon(v: unknown): string {
  // JSON would turn NaN and Infinity into null and hide a broken number behind a stable hash.
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`non-finite number in the record: ${v}`);
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
}

/** Two FNV-1a 32-bit hashes over the UTF-16 units, as 16 hex digits. Plenty to notice a change; not a signature. */
export function hash64(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c >>> 8), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

// --- the run ---------------------------------------------------------------

const SEATS: Seat[] = [0, 1, 2, 3];

interface Step {
  a: Action;
  v: PublicView[];
  e: TableEvent[];
}

export function runScenario(sc: Scenario): ScenarioReport {
  const rng = rngOf(sc.seed);
  const table = new Table({ seed: sc.seed, humanSeats: SEATS, config: sc.config });
  const events: Record<string, number> = {};
  const coverage: Coverage = { pad: 0, valat: 0, muss: 0, bela: 0, contest: 0, cancelled: 0, renons: 0, kontra: 0, announced: 0, renonsZvanja: 0, zvanjaPaid: 0 };
  const dealHashes: string[] = [];
  const playHashes: string[] = [];
  let steps = 0;

  const count = (es: TableEvent[]) => {
    for (const e of es) events[e.kind] = (events[e.kind] ?? 0) + 1;
  };

  let matches = 0;
  for (;;) {
    // One deal: its opening events, every step, its result.
    let dealEvents: TableEvent[] = table.drainEvents();
    count(dealEvents);
    const deal: { start: TableEvent[]; steps: Step[]; result: unknown } = { start: dealEvents, steps: [], result: null };
    let renonsDone = false;
    let passes = 0;
    let mussSeen = false;
    const declaredTeams = new Set<number>();
    let revealed = false;
    let doubled = false;

    while (table.phase !== 'DEAL_OVER' && table.phase !== 'MATCH_OVER') {
      const legal = table.legal();
      if (legal.length === 0) throw new Error(`${sc.name}: no legal action in phase ${table.phase}`);
      let action = legal[Math.floor(rng() * legal.length)] as Action;
      // Blind zvanja (easy, hard): the offer is a card-less template and the
      // marking IS the claim, so uniform play over the template alone would never
      // announce anything and two of the three shipped modes would go unhashed.
      // Two markings in three are real (a zvanje the hand holds), one in three is
      // wrong (the first three cards): the hit, the miss and the skip all recorded.
      if (action.type === 'DECLARE_ANNOUNCE' && !action.cards) {
        const seat = action.seat;
        const hand = table.view(seat).hand;
        const held = detectDeclarations(hand, seat);
        const wrong = held.length === 0 || rng() < 1 / 3;
        action = { type: 'DECLARE_ANNOUNCE', seat, cards: wrong ? hand.slice(0, 3) : held[Math.floor(rng() * held.length)]!.cards };
      }
      // Only once a card may actually be played: PLAY is also the phase in
      // which the zvanja round asks each seat in turn (legal is DECLARE_* then).
      if (sc.policy === 'renons' && !renonsDone && table.phase === 'PLAY' && legal.some((x) => x.type === 'PLAY_CARD')) {
        const seat = table.actor() as Seat;
        const view = table.view(seat);
        const legalIds = new Set(legal.filter((x) => x.type === 'PLAY_CARD').map((x) => cardId((x as { card: PublicView['hand'][number] }).card)));
        const illegal = view.hand.find((c) => !legalIds.has(cardId(c)));
        if (illegal) {
          action = { type: 'PLAY_CARD', seat, card: illegal };
          renonsDone = true;
        }
      }
      table.submit(action);
      steps++;
      const e = table.drainEvents();
      count(e);
      for (const ev of e) {
        if (ev.kind === 'bidPassed') passes++;
        if (ev.kind === 'bidCalled' && passes === 3) mussSeen = true;
        if (ev.kind === 'declared' && ev.declarations.length > 0) declaredTeams.add(ev.seat % 2);
        if (ev.kind === 'declarationsRevealed') revealed = true;
        if (ev.kind === 'doubled') doubled = true;
      }
      deal.steps.push({ a: action, v: SEATS.map((s) => table.view(s)), e });
    }

    // The scored deal: its result (carried by the dealScored event) and a hash of all of it.
    const scored = deal.steps.flatMap((st) => st.e).find((ev) => ev.kind === 'dealScored');
    const result = scored && scored.kind === 'dealScored' ? scored.result : null;
    deal.result = result;
    if (result) {
      if (!result.callerMade && result.renonsSeat == null) coverage.pad++;
      if (result.valatTeam !== null) coverage.valat++;
      if (result.bela[0] + result.bela[1] > 0) coverage.bela++;
      if (result.renonsSeat != null) coverage.renons++;
      if (result.renonsSeat != null && result.declarationPoints[0] + result.declarationPoints[1] > 0) coverage.renonsZvanja++;
      if (result.declarationPoints[0] + result.declarationPoints[1] > 0) coverage.zvanjaPaid++;
    }
    if (declaredTeams.size > 0) coverage.announced++;
    if (mussSeen) coverage.muss++;
    if (declaredTeams.size === 2) {
      coverage.contest++;
      if (!revealed) coverage.cancelled++;
    }
    if (doubled) coverage.kontra++;
    dealHashes.push(hash64(canon(deal)));
    playHashes.push(hash64(canon({ start: deal.start, steps: deal.steps.map((st) => ({ a: st.a, e: st.e })), result: deal.result })));

    if (table.phase === 'MATCH_OVER') {
      const tail = table.drainEvents();
      count(tail);
      if (tail.length) {
        dealHashes.push(hash64(canon({ tail })));
        playHashes.push(hash64(canon({ tail })));
      }
      if (sc.rematch && matches === 0) {
        matches++;
        table.newMatch({ seed: sc.seed + 1 });
        continue;
      }
      break;
    }
    table.startNextDeal();
  }

  return {
    name: sc.name,
    seed: sc.seed,
    config: sc.config,
    deals: dealHashes.length,
    steps,
    events,
    coverage,
    dealHashes,
    playHashes,
    hash: hash64(dealHashes.join('|')),
    playHash: hash64(playHashes.join('|')),
  };
}

export function runGolden(only?: string[]): GoldenReport {
  const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.name)).map(runScenario);
  return {
    version: GOLDEN_VERSION,
    scenarios,
    hash: hash64(scenarios.map((s) => s.hash).join('|')),
    playHash: hash64(scenarios.map((s) => s.playHash).join('|')),
  };
}
