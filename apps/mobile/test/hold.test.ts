import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Lang, LOCALE_IDS } from '@belot/i18n';
import { clockText, localHold, stillReading } from '../src/net/hold';
import { TURN_CHOICES_S } from '../src/net/clock';
import {
  NEXT_DEAL_MS,
  PAUSE_MAX_MS,
  TURN_CHOICES,
  WAIT_FOR_DROPPED_MS,
} from '../../server/src/protocol';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(join(here, '..', f), 'utf8');
const server = (f: string) => readFileSync(join(here, '../../server/src', f), 'utf8');

describe('a table standing still, on this device', () => {
  it('turns time LEFT into moments on this clock (the two clocks never agree)', () => {
    const h = localHold({ paused: { by: 2, msLeft: 90_000 }, waiting: [{ seat: 1, msLeft: 5000 }] }, 1_000_000);
    expect(h).toEqual({ paused: { by: 2, until: 1_090_000 }, waiting: [{ seat: 1, until: 1_005_000 }] });
    expect(localHold(undefined, 5)).toBeNull();
  });

  it('shows what is left as m:ss, rounded up, never below 0:00', () => {
    expect(clockText(462_000)).toBe('7:42');
    expect(clockText(59_001)).toBe('1:00');
    expect(clockText(1)).toBe('0:01');
    expect(clockText(-5000)).toBe('0:00');
  });

  it('waits for the next deal only on people who are on the line, never on bots or me', () => {
    const seats = [
      { seat: 0 as const, connected: true, bot: false },
      { seat: 1 as const, connected: true, bot: true },
      { seat: 2 as const, connected: true, bot: false },
      { seat: 3 as const, connected: false, bot: false },
    ];
    expect(stillReading(seats, [], 0)).toEqual([2]);
    expect(stillReading(seats, [2], 0)).toEqual([]);
  });
});

describe('the app and the server agree', () => {
  it('on the clocks a host may pick', () => {
    expect([...TURN_CHOICES_S]).toEqual([...TURN_CHOICES]);
  });

  it('on the numbers friends were promised', () => {
    // Ten seconds of reading, plus the three the app spends landing the last
    // trick before the sheet appears (players were getting about seven).
    expect(NEXT_DEAL_MS).toBe(13_000);
    expect(WAIT_FOR_DROPPED_MS).toBe(10 * 60_000);
    expect(PAUSE_MAX_MS).toBeGreaterThanOrEqual(WAIT_FOR_DROPPED_MS);
  });

  it('on how long a dropped seat is kept once the match is under way', () => {
    // The app retries for exactly as long as the server holds the seat: less,
    // and a long call still ends in the lobby; the old pair was 60 s / 60 s.
    const room = server('BelaRoom.ts');
    const secs = Number(/const TABLE_RECONNECT_SECONDS = ([\d* ]+);/.exec(room)![1]!.split('*').reduce((a, x) => a * Number(x), 1));
    const hook = src('src/net/useNetGame.ts');
    const ms = /const RECONNECT_HOLD_MS = ([\d_* ]+);/.exec(hook)![1]!.replace(/_/g, '').split('*').reduce((a, x) => a * Number(x), 1);
    expect(secs * 1000).toBe(ms);
    expect(secs).toBeGreaterThanOrEqual(10 * 60);
    // ...but the LOBBY keeps its short hold, or a stranger who left would
    // stop a quick-play table from filling for half an hour.
    expect(room).toMatch(/this\.started \? TABLE_RECONNECT_SECONDS : LOBBY_RECONNECT_SECONDS/);
    expect(room).toMatch(/const LOBBY_RECONNECT_SECONDS = 60;/);
  });
});

describe('the table while it stands still', () => {
  it('stays on screen while this device reconnects, instead of the lobby', () => {
    const o = src('src/net/OnlineGame.tsx');
    expect(o).toMatch(/const atTable = status === 'playing' \|\| status === 'finished' \|\| net\.reconnecting;/);
    expect(o).toMatch(/if \(net\.seat === null \|\| net\.view === null \|\| !atTable\)/);
    const hook = src('src/net/useNetGame.ts');
    expect(hook).toMatch(/reconnecting: atTable && \(status === 'disconnected' \|\| status === 'connecting'\)/);
    // Back from the call: try at once rather than after the loop's sleep.
    expect(hook).toMatch(/if \(roomRef\.current === null && reconnectTokenRef\.current !== null\) reconnectRef\.current\(\);/);
  });

  it('offers pausing only at a private table, and plays nothing while held', () => {
    const o = src('src/net/OnlineGame.tsx');
    expect(o).toMatch(/onPause=\{net\.isPrivate \? net\.pause : undefined\}/);
    expect(o).toMatch(/onPlayOn=\{net\.isPrivate \? net\.playOn : undefined\}/);
    expect(o).toMatch(/options=\{settled \|\| !net\.idle \|\| net\.hold !== null \|\| net\.reconnecting \? \[\] : net\.view\.legalActions\}/);
  });

  it('draws the hold panel above the sheet and the pickers', () => {
    const t = src('src/TableScreen.tsx');
    const panel = t.indexOf('<HoldPanel');
    expect(panel).toBeGreaterThan(t.indexOf('<GiftPicker'));
    expect(panel).toBeGreaterThan(t.indexOf('{resultSheet}'));
  });

  it('counts the next deal down online, and leaves offline exactly as it was', () => {
    const t = src('src/TableScreen.tsx');
    expect(t).toMatch(/\{nextDeal \? \(\s*<NextDealButton lang=\{lang\} next=\{nextDeal\} onNext=\{onNext\} \/>\s*\) : \(\s*<Button label=\{lang\.s\.nextDeal\}(?: testID="next-deal")? tone="strong" onPress=\{onNext\} \/>/);
    // Offline passes no nextDeal at all.
    expect(src('src/OfflineGame.tsx')).not.toMatch(/nextDeal=/);
  });

  it('says it all in every language, without gendered verbs', () => {
    for (const id of LOCALE_IDS) {
      const ui = new Lang(id).s.ui;
      for (const v of [ui.pausedBy('X'), ui.waitingFor('X'), ui.waitingLine(1), ui.playOn(1), ui.nextWaitingFor('X')]) {
        expect(v.length, `${id}: ${v}`).toBeGreaterThan(3);
      }
    }
    const hr = new Lang('hr').s.ui;
    // "Igraj bez njega" would be wrong for Ivana: nothing here assumes a gender.
    expect(hr.playOn(1)).toBe('Nastavi s botom');
    expect(`${hr.pausedBy('Ivana')} ${hr.waitingFor('Ivana')}`).not.toMatch(/\b(njega|nje|je pauzira[ol])\b/);
  });
});
