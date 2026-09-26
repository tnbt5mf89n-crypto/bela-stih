import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cardId,
  detectDeclarations,
  isTrump,
  pointValue,
  teamOf,
  trickWinnerIndex,
  type Action,
  type Card,
  type PublicView,
  type Seat,
} from '@belot/engine';
import { Table } from '@belot/table';
import { Lang, LOCALE_IDS } from '@belot/i18n';
import { coachTip, stigljaWatch } from '../src/table/coach';
import { pickAnnouncement } from '../src/table/zvanja';
import { wrongCardLines, wrongCardOf } from '../src/table/wrongCard';
import {
  blindZvanja,
  coaches,
  explainsRefusals,
  freePlay,
  isPlayMode,
  MODE_CONFIG,
  modeFromLegacy,
  modeName,
  PLAY_MODES,
} from '../src/playMode';
import {
  isPlayMode as serverIsPlayMode,
  modeFromLegacy as serverFromLegacy,
  PLAY_MODES as SERVER_MODES,
} from '../../server/src/protocol';

/**
 * The three versions the player asked for, and what each one does:
 *  - Učenje: the app guides - zvanja found for you, a coach on every move,
 *    štiglja watched;
 *  - Lagana: zvanja are yours to find and call, a wrong card is refused;
 *  - Prava bela: the same, and a wrong card goes - and costs the deal, after
 *    which the sheet says which card it was and which could have gone.
 * Quick play is Lagana; a private table's host picks. "Auzmeš" is gone.
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const server = (p: string) => readFileSync(join(__dirname, '../../server/src', p), 'utf8');

const plays = (legal: readonly Action[]): Card[] =>
  legal.flatMap((a) => (a.type === 'PLAY_CARD' && a.announceBela !== true ? [a.card] : []));

describe('the three versions', () => {
  it('are the same three, in the same order, on the app and the server', () => {
    expect([...PLAY_MODES]).toEqual(['learn', 'easy', 'hard']);
    expect([...SERVER_MODES]).toEqual([...PLAY_MODES]);
    for (const m of ['learn', 'easy', 'hard', 'nonsense', undefined, 1]) {
      expect(serverIsPlayMode(m)).toBe(isPlayMode(m));
    }
  });

  it('are the same engine switches on both sides', () => {
    // The server keeps its own copy (it does not import the app): the three
    // entries must read the same, word for word.
    const entries = (s: string) => {
      const body = s.slice(s.indexOf('MODE_CONFIG: Record<PlayMode, Partial<EngineConfig>> = {'));
      return body.slice(0, body.indexOf('};')).replace(/\s+/g, ' ');
    };
    const app = entries(src('src/playMode.ts'));
    const srv = entries(server('BelaRoom.ts'));
    for (const line of ["learn: {}", "easy: { declarationMode: 'blind' }", 'hard: HARD_CONFIG_OVERRIDES']) {
      expect(app).toContain(line);
      expect(srv).toContain(line);
    }
    expect(MODE_CONFIG.learn).toEqual({});
    expect(MODE_CONFIG.easy).toEqual({ declarationMode: 'blind' });
    expect(MODE_CONFIG.hard.declarationMode).toBe('blind');
    expect(MODE_CONFIG.hard.renonsMode).toBe('punish');
  });

  it('switch the table the way each one promises', () => {
    expect(PLAY_MODES.map(blindZvanja)).toEqual([false, true, true]);
    expect(PLAY_MODES.map(freePlay)).toEqual([false, false, true]);
    expect(PLAY_MODES.map(coaches)).toEqual([true, false, false]);
    // "Moraš odgovoriti na boju" over the hand: Učenje only (the player asked for none in Lagana).
    expect(PLAY_MODES.map(explainsRefusals)).toEqual([true, false, false]);
  });

  it('read an older app\'s switch as it always meant', () => {
    expect(modeFromLegacy(true)).toBe('hard');
    expect(modeFromLegacy(false)).toBe('learn');
    expect(modeFromLegacy(undefined)).toBe('learn');
    expect(serverFromLegacy(true)).toBe('hard');
    expect(serverFromLegacy(false)).toBe('learn');
    expect(serverFromLegacy(undefined)).toBeNull();
  });

  it('are named in every language, three different names', () => {
    const hr = new Lang('hr');
    expect(PLAY_MODES.map((m) => modeName(hr, m))).toEqual(['Učenje', 'Lagana', 'Prava bela']);
    for (const id of LOCALE_IDS) {
      const l = new Lang(id);
      expect(new Set(PLAY_MODES.map((m) => modeName(l, m))).size, id).toBe(3);
    }
  });

  it('on the engine: Lagana asks you to find the zvanja and refuses a wrong card', () => {
    let refused = 0;
    let claims = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const t = new Table({ seed, humanSeats: [0, 1, 2, 3], config: MODE_CONFIG.easy });
      let guard = 0;
      while (t.phase !== 'DEAL_OVER' && t.phase !== 'MATCH_OVER' && guard++ < 400) {
        const seat = t.actor()!;
        const v = t.view(seat);
        // Blind: the claim is offered whatever the hand holds, and nothing is spotted for you.
        if (v.canDeclare) claims++;
        expect(v.myDeclarations).toEqual([]);
        const legal = t.legal();
        const ok = plays(legal);
        const wrong = v.hand.find((c) => ok.length > 0 && !ok.some((o) => cardId(o) === cardId(c)));
        if (wrong) {
          expect(() => t.submit({ type: 'PLAY_CARD', seat, card: wrong })).toThrow();
          refused++;
        }
        t.submit(
          legal.find((a) => a.type === 'BID_CALL') ??
            legal.find((a) => a.type === 'DECLARE_SKIP') ??
            legal.find((a) => a.type === 'DOUBLE_PASS') ??
            legal[0]!,
        );
      }
    }
    expect(refused).toBeGreaterThan(0);
    expect(claims).toBeGreaterThan(0);
  });

  it('on the engine: Učenje finds the zvanja for their holder', () => {
    let found = 0;
    for (let seed = 1; seed <= 30 && found === 0; seed++) {
      const t = new Table({ seed, humanSeats: [0, 1, 2, 3], config: MODE_CONFIG.learn });
      let guard = 0;
      while (t.phase !== 'DEAL_OVER' && t.phase !== 'MATCH_OVER' && guard++ < 400) {
        const seat = t.actor()!;
        const v = t.view(seat);
        if (v.mustDeclare && v.myDeclarations.length > 0) found++;
        expect(v.canDeclare).toBe(false);
        const legal = t.legal();
        t.submit(legal.find((a) => a.type === 'BID_CALL') ?? legal.find((a) => a.type === 'DOUBLE_PASS') ?? legal[0]!);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("Učenje's coach, through real deals", () => {
  it('only ever advises what the rules allow, and says why truthfully', () => {
    const seen = new Set<string>();
    let bids = 0;
    let moves = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const t = new Table({ seed, humanSeats: [0, 1, 2, 3], config: MODE_CONFIG.learn });
      let guard = 0;
      while (t.phase !== 'DEAL_OVER' && t.phase !== 'MATCH_OVER' && guard++ < 400) {
        const seat = t.actor()!;
        const v = t.view(seat);
        const legal = t.legal();
        const tip = coachTip(v, seat, legal);
        const head = legal[0]!.type;
        if (head === 'BID_CALL' || head === 'BID_PASS') {
          expect(tip, `seed ${seed}: a bid without advice`).not.toBeNull();
          bids++;
          if (tip!.kind === 'call') {
            expect(legal.some((a) => a.type === 'BID_CALL' && a.suit === tip!.suit)).toBe(true);
            const mine = v.hand.filter((c) => c.suit === tip!.suit);
            expect(tip!.count).toBe(mine.length);
            expect(tip!.jack).toBe(mine.some((c) => c.rank === 'J'));
            expect(tip!.nine).toBe(mine.some((c) => c.rank === '9'));
            expect(tip!.forced).toBe(!legal.some((a) => a.type === 'BID_PASS'));
          } else {
            expect(tip!.kind).toBe('pass');
            expect(legal.some((a) => a.type === 'BID_PASS')).toBe(true);
          }
          seen.add(tip!.kind);
        } else if (legal.some((a) => a.type === 'PLAY_CARD')) {
          expect(tip, `seed ${seed}: a play without advice`).not.toBeNull();
          expect(tip!.kind).toBe('play');
          if (tip === null || tip.kind !== 'play') throw new Error('unreachable');
          moves++;
          const ok = plays(legal);
          // Never a card the rules refuse.
          expect(ok.some((c) => cardId(c) === cardId(tip.card)), `seed ${seed}: ${cardId(tip.card)}`).toBe(true);
          const ctx = v.context;
          const trick = v.currentTrick;
          const pts = pointValue(tip.card, ctx);
          seen.add(tip.why);
          const oneCard = new Set(ok.map(cardId)).size === 1;
          // One card allowed says so, the last lead included, and nothing else does.
          expect(tip.why === 'only', `seed ${seed}: ${tip.why} with ${ok.length} allowed`).toBe(oneCard);
          switch (tip.why) {
            case 'leadTrump':
              expect(trick).toHaveLength(0);
              expect(isTrump(tip.card, ctx)).toBe(true);
              break;
            case 'leadAce':
              expect(trick).toHaveLength(0);
              expect(tip.card.rank === 'A' && !isTrump(tip.card, ctx)).toBe(true);
              break;
            case 'leadLow':
              expect(trick).toHaveLength(0);
              expect(pts === 0 && !isTrump(tip.card, ctx)).toBe(true);
              break;
            case 'lead':
              expect(trick).toHaveLength(0);
              break;
            case 'only':
              break;
            case 'win':
              expect(trickWinnerIndex([...trick.map((p) => p.card), tip.card], ctx)).toBe(trick.length);
              break;
            case 'givePoints': {
              expect(pts).toBeGreaterThan(0);
              const winner = trickWinnerIndex([...trick.map((p) => p.card), tip.card], ctx);
              const who = winner === trick.length ? seat : trick[winner]!.seat;
              expect(teamOf(who)).toBe(teamOf(seat));
              break;
            }
            case 'duck': {
              // "Don't waste a strong card" is said only of a card worth nothing.
              expect(pts).toBe(0);
              const holder = trick[trickWinnerIndex(trick.map((p) => p.card), ctx)]!.seat;
              expect(teamOf(holder)).toBe(teamOf(seat));
              break;
            }
            case 'mustTrump':
              expect(isTrump(tip.card, ctx)).toBe(true);
              expect(v.hand.some((c) => c.suit === trick[0]!.card.suit)).toBe(false);
              break;
            case 'discard':
              expect(pts).toBeLessThan(10);
              expect(trickWinnerIndex([...trick.map((p) => p.card), tip.card], ctx)).not.toBe(trick.length);
              break;
            case 'play':
              break;
          }
          // The bela is advised only with a card that can carry it.
          if (tip.bela) expect(legal.some((a) => a.type === 'PLAY_CARD' && a.announceBela === true && cardId(a.card) === cardId(tip.card))).toBe(true);
        } else {
          // The zvanja question and doubling have their own prompts.
          expect(tip).toBeNull();
        }
        // The table goes on as the coach says, where it says anything.
        const next =
          tip?.kind === 'play'
            ? legal.find((a) => a.type === 'PLAY_CARD' && cardId(a.card) === cardId(tip.card) && (a.announceBela === true) === tip.bela)
            : tip?.kind === 'call'
              ? legal.find((a) => a.type === 'BID_CALL' && a.suit === tip.suit)
              : tip?.kind === 'pass'
                ? legal.find((a) => a.type === 'BID_PASS')
                : undefined;
        t.submit(next ?? legal.find((a) => a.type === 'DOUBLE_PASS') ?? legal[0]!);
      }
    }
    expect(bids).toBeGreaterThan(50);
    expect(moves).toBeGreaterThan(500);
    // The walk really met every kind of advice it claims to check.
    for (const k of ['call', 'pass', 'leadTrump', 'leadAce', 'leadLow', 'win', 'givePoints', 'duck', 'only', 'discard']) {
      expect(seen.has(k), k).toBe(true);
    }
  });

  it('says every tip in every language, naming the card or the suit, in two lines of a 360 dp phone', () => {
    // "Savjet: " and the tip in 12 sp on a 360 dp phone's prompt row: two lines hold about 100.
    const BUDGET = 100;
    for (const id of LOCALE_IDS) {
      const l = new Lang(id);
      const ui = l.s.ui;
      const label = `${ui.coachTitle}: `;
      const whys = ['leadTrump', 'leadAce', 'leadLow', 'lead', 'win', 'givePoints', 'duck', 'mustTrump', 'discard', 'only', 'play'] as const;
      // The longest card name this language has.
      const cards: Card[] = [];
      for (const suit of ['clubs', 'spades', 'hearts', 'diamonds'] as const) {
        for (const rank of ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const) cards.push({ suit, rank });
      }
      const longestOf = (from: Card[]) => from.map((c) => l.cardName(c)).reduce((a, b) => (b.length > a.length ? b : a));
      const longest = longestOf(cards);
      // Bela rides on the trump king or queen, so only with a reason such a card can have.
      const kingOrQueen = longestOf(cards.filter((c) => c.rank === 'K' || c.rank === 'Q'));
      const withBela = new Set(['leadTrump', 'win', 'duck', 'mustTrump', 'discard', 'only', 'play']);
      for (const why of whys) {
        const s = ui.coachPlay(why, longest, false);
        expect(s, `${id} ${why}`).toContain(longest);
        expect((label + s).length, `${id} ${why}: ${s}`).toBeLessThanOrEqual(BUDGET);
        if (!withBela.has(why)) continue;
        const b = ui.coachPlay(why, kingOrQueen, true);
        expect((label + b).length, `${id} ${why} +bela: ${b}`).toBeLessThanOrEqual(BUDGET);
      }
      for (const ours of [true, false]) expect((label + ui.coachStiglja(ours)).length, id).toBeLessThanOrEqual(BUDGET);
      const trumps = ['clubs', 'spades', 'hearts', 'diamonds'] as const;
      for (const s of trumps) {
        const w = ui.coachWatch(l.suitName(s));
        expect(w).toContain(l.suitName(s));
        expect((label + w).length, `${id}: ${w}`).toBeLessThanOrEqual(BUDGET);
      }
      // The bid's advice floats over the felt and may run longer; it names the suit.
      expect(ui.coachCall(l.suitName('hearts'), 4, true, true, false)).toContain(l.suitName('hearts'));
      expect(ui.coachCall(l.suitName('hearts'), 2, false, false, true)).toContain(l.suitName('hearts'));
      expect(ui.coachPass.length).toBeGreaterThan(20);
    }
  });

  it('names cards the way each language says them', () => {
    const jack: Card = { suit: 'hearts', rank: 'J' };
    expect(new Lang('hr').cardName(jack)).toBe('dečko srce');
    expect(new Lang('sr-Cyrl').cardName(jack)).toBe('дечко срце');
    expect(new Lang('en').cardName(jack)).toBe('jack of hearts');
  });
});

describe('štiglja, watched', () => {
  const at = (tricksPlayed: number, tricksWon: [number, number]) =>
    ({
      dealProgress: {
        tricksPlayed,
        tricksWon,
        cardPoints: [0, 0],
        lastTrickTeam: null,
        lastTrickBonus: 10,
      },
    }) as unknown as PublicView;

  it('from the fourth trick, while one pair holds them all, and never before or after', () => {
    expect(stigljaWatch(at(3, [3, 0]), 0)).toBeNull();
    expect(stigljaWatch(at(4, [4, 0]), 0)).toBe('us');
    expect(stigljaWatch(at(4, [4, 0]), 1)).toBe('them');
    expect(stigljaWatch(at(6, [0, 6]), 2)).toBe('them');
    expect(stigljaWatch(at(6, [0, 6]), 3)).toBe('us');
    expect(stigljaWatch(at(5, [4, 1]), 0)).toBeNull();
    expect(stigljaWatch(at(8, [8, 0]), 0)).toBeNull();
    expect(stigljaWatch({ dealProgress: null } as unknown as PublicView, 0)).toBeNull();
  });
});

describe("Prava bela's wrong card, explained", () => {
  it('on the engine: the card goes, the deal is lost, and the sheet says which, why and what could have gone', () => {
    let explained = 0;
    for (let seed = 1; seed <= 30 && explained < 5; seed++) {
      const t = new Table({ seed, humanSeats: [0, 1, 2, 3], config: MODE_CONFIG.hard });
      let guard = 0;
      while (t.phase !== 'DEAL_OVER' && t.phase !== 'MATCH_OVER' && guard++ < 400) {
        const seat = t.actor()!;
        const v = t.view(seat);
        const legal = t.legal();
        const ok = plays(legal);
        const wrong = v.hand.find((c) => ok.length > 0 && !ok.some((o) => cardId(o) === cardId(c)));
        if (seat === 0 && wrong) {
          // What the table remembers as the card goes: TableScreen's `play` asks this.
          const note = wrongCardOf({ type: 'PLAY_CARD', seat, card: wrong }, legal, v.currentTrick, v.context.trumpSuit);
          expect(note).not.toBeNull();
          if (note === null) throw new Error('unreachable');
          // A card the rules allow is never taken for a wrong one, nor its bela call.
          for (const a of legal) expect(wrongCardOf(a, legal, v.currentTrick, v.context.trumpSuit)).toBeNull();
          t.submit({ type: 'PLAY_CARD', seat, card: wrong });
          expect(t.state.lastDealResult?.renonsSeat).toBe(0);
          for (const id of LOCALE_IDS) {
            const l = new Lang(id);
            const lines = wrongCardLines(l, note);
            expect(lines[0], id).toContain(l.cardName(wrong));
            // Every card that could have gone is named.
            for (const c of ok) expect(lines[lines.length - 1], id).toContain(l.cardName(c));
            // And the duty, where one can be named, in the dimmed card's words.
            if (lines.length === 3) {
              const ui = l.s.ui;
              expect([ui.mustFollow, ui.mustTrump, ui.mustBeat].some((d) => lines[1]!.startsWith(d)), `${id}: ${lines[1]}`).toBe(true);
            }
          }
          explained++;
          break;
        }
        t.submit(legal.find((a) => a.type === 'BID_CALL') ?? legal.find((a) => a.type === 'DECLARE_SKIP') ?? legal.find((a) => a.type === 'DOUBLE_PASS') ?? legal[0]!);
      }
    }
    expect(explained).toBe(5);
  });

  it('reads in whole sentences', () => {
    const hr = new Lang('hr');
    const lines = wrongCardLines(hr, {
      card: { suit: 'spades', rank: '7' },
      legal: [
        { suit: 'hearts', rank: 'A' },
        { suit: 'hearts', rank: '10' },
      ],
      trick: [{ seat: 1 as Seat, card: { suit: 'hearts', rank: 'K' } }],
      trump: 'clubs',
    });
    expect(lines).toEqual([
      'Odigrana karta: sedmica list.',
      'Moraš odgovoriti na boju: srce.',
      'Trebalo je igrati: as srce ili desetka srce.',
    ]);
  });

  it('is remembered as the card goes, only mine, and forgotten with the next deal', () => {
    const t = src('src/TableScreen.tsx');
    expect(t).toMatch(/if \(!send\(a\)\) return false;\s*if \(cardsFree\) \{\s*const \{ options: now, trick, trump \} = playView\.current;\s*const wrong = wrongCardOf\(a, now, trick, trump\);\s*if \(wrong\) wrongCard\.current = wrong;/);
    expect(t).toMatch(/if \(view\.phase === 'BID'\) wrongCard\.current = null;/);
    expect(t).toMatch(/lastDealResult\?\.renonsSeat === mySeat && wrongCard\.current\s*\?\s*wrongCardLines\(lang, wrongCard\.current\)/);
    // Another player's: who, and whose the deal is now - no card is guessed for them.
    expect(t).toMatch(/lang\.s\.renonsBy\(\s*meta\(lastDealResult\.renonsSeat\)\.name,\s*teamOf\(lastDealResult\.renonsSeat\) === teamOf\(mySeat\),\s*\)/);
  });

  it('says whose the deal is now, without a gendered verb', () => {
    const hr = new Lang('hr').s;
    expect(hr.renonsBy('Ivana', true)).toContain('protivnicima');
    expect(hr.renonsBy('Ivana', false)).toContain('tvom paru');
    for (const id of LOCALE_IDS) {
      const s = new Lang(id).s;
      expect(s.renonsBy('X', true)).not.toBe(s.renonsBy('X', false));
    }
    expect(`${hr.renonsBy('Ivana', true)} ${hr.renonsByYou}`).not.toMatch(/pogriješio|pogriješila|je bacio|je bacila/);
  });
});

describe("Lagana's zvanja: the player finds them, and a marking that is not one is said so", () => {
  const hand: Card[] = [
    { suit: 'hearts', rank: '7' },
    { suit: 'hearts', rank: '8' },
    { suit: 'hearts', rank: '9' },
    { suit: 'clubs', rank: 'A' },
    { suit: 'spades', rank: 'K' },
    { suit: 'diamonds', rank: '10' },
    { suit: 'clubs', rank: '8' },
    { suit: 'spades', rank: '7' },
  ];

  it('checks a marking against the hand in Lagana, against the engine in Učenje, against nothing in Prava bela', () => {
    const t = src('src/TableScreen.tsx');
    expect(t).toMatch(/\(\) => \(playMode === 'hard' \? null : blind \? detectDeclarations\(view\.hand, mySeat\) : view\.myDeclarations\)/);
    expect(t).toMatch(/const markingIsZvanje = checkedAgainst === null \|\| announcement !== null;/);
    // Prava bela says what to do, never "that is a zvanje".
    expect(t).toMatch(/: checkedAgainst === null\s*\?\s*(\/\/[^\n]*\n\s*)*lang\.s\.markingUnchecked/);
    // Nothing is marked for the player, and nobody answers for them, in Lagana.
    expect(t).toMatch(/if \(!declaring \|\| blind\) return;/);
    expect(t).toMatch(/const autoSkipping = declaring && !blind && view\.myDeclarations\.length === 0;/);
  });

  it('on a real hand: one card is no zvanje, the terca is', () => {
    const held = detectDeclarations(hand, 0);
    expect(held.length).toBeGreaterThan(0);
    expect(pickAnnouncement([hand[0]!], held, 0)).toBeNull();
    expect(pickAnnouncement([hand[0]!, hand[3]!, hand[4]!], held, 0)).toBeNull();
    expect(pickAnnouncement(hand.slice(0, 3), held, 0)?.map(cardId).sort()).toEqual(hand.slice(0, 3).map(cardId).sort());
    // Prava bela checks nothing: the marking goes as it is, for the engine to judge.
    expect(pickAnnouncement([hand[0]!], null, 0)).toEqual([hand[0]]);
  });

  it("Prava bela's hint claims nothing about the marking, in every language", () => {
    for (const id of LOCALE_IDS) {
      const s = new Lang(id).s;
      expect(s.markingUnchecked, id).not.toBe(s.markingOk);
      expect(s.markingUnchecked.length, id).toBeGreaterThan(10);
    }
    expect(new Lang('hr').s.markingUnchecked).not.toMatch(/^To je/);
  });
});

describe('a card the rules forbid, tapped', () => {
  it('shakes and sounds in Lagana, and only Učenje says why in a bubble', () => {
    const t = src('src/TableScreen.tsx');
    const explain = t.slice(t.indexOf('const explainIllegal = useCallback('), t.indexOf('[anchors, fxBus, lang, mySeat],'));
    // The sound and the buzz come first, for every version that forbids a card...
    expect(explain.indexOf("playSfx('denied'")).toBeLessThan(explain.indexOf('if (!explainsRef.current) return;'));
    // ...and the bubble only after the version's say-so.
    expect(explain.indexOf('if (!explainsRef.current) return;')).toBeGreaterThan(0);
    expect(explain.indexOf('if (!explainsRef.current) return;')).toBeLessThan(explain.indexOf("kind: 'bubble'"));
    expect(t).toMatch(/explainsRef\.current = explainsRefusals\(playMode\);/);
    // Lagana's description no longer promises a why.
    expect(new Lang('hr').s.difficultyEasyHint).not.toMatch(/zašto/);
    expect(new Lang('sr-Cyrl').s.difficultyEasyHint).not.toMatch(/зашто/);
    expect(new Lang('en').s.difficultyEasyHint).not.toMatch(/why/);
  });
});

describe('the word nobody says', () => {
  it('"auzmeš" is gone from everything the player reads', () => {
    const i18n = readFileSync(join(__dirname, '../../../packages/i18n/src/index.ts'), 'utf8');
    expect(i18n).not.toMatch(/auzme|аузме/i);
    const hr = new Lang('hr').s;
    expect(hr.renonsTitle).toBe('Kriva karta!');
  });
});

describe("the coach's place on the table", () => {
  const t = src('src/TableScreen.tsx');

  it('speaks only in Učenje, on my turn, and holds its row for the whole play', () => {
    expect(t).toMatch(/const coach = coaches\(playMode\);/);
    expect(t).toMatch(/\(\) => \(coach && myTurn && !settled \? coachTip\(view, mySeat, options\) : null\)/);
    expect(t).toMatch(/const coachPlaying = coach && !settled && view\.phase === 'PLAY';/);
    // One height whatever it says: two lines, always.
    expect(t).toMatch(/coachRow: \{ minHeight: 2 \* 16 \+ 2 \* 8 \+ 2 \+ 2,/);
    expect(t).toMatch(/<Text style=\{\[promptHint, styles\.coachText\]\} numberOfLines=\{2\}(?: maxFontSizeMultiplier=\{1\.3\})?>/);
    expect(t).toMatch(/coachText: \{ lineHeight: 16 \}/);
  });

  it('never takes a row while a bid is asked: its advice floats over the empty felt', () => {
    // Bidding's band is budgeted with no prompt row (metrics' BIDDING_ACTIONS):
    // a row there pushed the answers under Android's buttons.
    expect(t).toMatch(/const coachRowUp = coachLine !== null && !askingBesidesArranging;/);
    expect(t).toMatch(/const coachShown = coachRowUp && !arranging;/);
    expect(t).toMatch(/const asking = askingBesidesArranging \|\| arranging;/);
    expect(t).toMatch(/const askingBesidesArranging =\s*bidding \|\|/);
    expect(t).toMatch(/\{floatTip !== null && revealRow === null && !land && \(\s*<View style=\{\[styles\.coachFloat, \{ maxWidth: bidFloatW \}\]\} pointerEvents="none"/);
    // Between the side players' discs, clear of their badges.
    expect(t).toMatch(/feltBox\.w \+ 2 \* \(RIM_W \+ FELT_PAD\) \+ 2 \* 4 \+ PUCK_NAME_ROOM - 2 \* 10/);
    // Sideways: one low, wide line under the side players' cards.
    expect(t).toMatch(/\{floatTip !== null && revealRow === null && land && \(\s*<View style=\{styles\.coachFloatLandBox\} pointerEvents="none">/);
    expect(t).toMatch(/coachFloatLandBox: \{ position: 'absolute', left: 0, right: 0, bottom: 2, alignItems: 'center' \}/);
    // Only a bid's advice floats in portrait; sideways, a play's too - never between my turns.
    expect(t).toMatch(/: tip\.kind !== 'play'\s*\? tipText\(tip\)\s*: land\s*\?/);
    expect(t).toMatch(/const coachLine = !coachPlaying \|\| land\s*\? null/);
    // The float lives in the table's float layer, which takes no layout.
    const float = t.slice(t.indexOf('const tableFloat = ('), t.indexOf('const felt = land ? ('));
    expect(float).toMatch(/styles\.coachFloat/);
  });

  it('fits the budget the zvanja question already has', async () => {
    // The row is no taller than the zvanja prompt the portrait budget counts (58).
    const { PORTRAIT_CHROME } = await import('../src/table/metrics');
    expect(PORTRAIT_CHROME).toBe(24 + 35 + 16 + 34 + 24 + 58 + 34 + 40 + 9 * 8);
    expect(2 * 16 + 2 * 8 + 2 + 2).toBeLessThanOrEqual(58);
    // A short column sheds its strips for it, as for any prompt.
    expect(t).toMatch(/const shed = m\.shortColumn && \(asking \|\| belaOffered \|\| coachShown\);/);
  });
});
