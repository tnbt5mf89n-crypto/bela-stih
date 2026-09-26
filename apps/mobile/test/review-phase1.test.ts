import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Lang, LOCALE_IDS } from '@belot/i18n';
import { CODE_ALPHABET as CLIENT_ALPHABET, normalizeCode } from '../src/net/code';
import { CODE_ALPHABET, CODE_LENGTH, tableCode } from '../../server/src/codes';
import { BOT_AVATARS, botIdentity } from '../src/table/bots';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(join(here, '..', f), 'utf8');
const server = (f: string) => readFileSync(join(here, '../../server/src', f), 'utf8');

describe('table codes friends can read out', () => {
  it('have no letters that read as others, in one case only', () => {
    for (const bad of ['I', 'L', 'O', '0', '1']) expect(CODE_ALPHABET).not.toContain(bad);
    expect(CODE_ALPHABET).toBe(CODE_ALPHABET.toUpperCase());
    expect(CLIENT_ALPHABET).toBe(CODE_ALPHABET);
  });

  it('are five of them, and never one already open', () => {
    const code = tableCode(() => false);
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`));
    // A deterministic stream that repeats a code: the second draw must be new.
    let n = 0;
    const bytes = (k: number) => new Uint8Array(k).fill(n++ < 1 ? 0 : 1);
    const taken = new Set(['AAAAA']);
    expect(tableCode((c) => taken.has(c), bytes)).toBe('BBBBB');
  });

  it('are found however they are typed', () => {
    expect(normalizeCode('k7m2q')).toBe('K7M2Q');
    expect(normalizeCode(' K7M-2Q ')).toBe('K7M2Q');
    expect(normalizeCode('k7m 2q')).toBe('K7M2Q');
    // An older server's id is case-sensitive: passed on exactly.
    expect(normalizeCode('IlCWn95i2')).toBe('IlCWn95i2');
    const hook = src('src/net/useNetGame.ts');
    expect(hook).toMatch(/c\.joinById\(normalizeCode\(id\)/);
  });

  it('are what a private table is called on the server', () => {
    const room = server('BelaRoom.ts');
    expect(room).toMatch(/this\.roomId = tableCode\(\(c\) => liveCodes\.has\(c\)\);/);
    expect(room).toMatch(/liveCodes\.delete\(this\.roomId\);/);
  });
});

describe('bots online look like bots offline', () => {
  it('wear a character and its name, in the player-s language', () => {
    expect(botIdentity(new Lang('hr'), 3)).toEqual({ name: 'Kapetan', avatar: 'kapetan' });
    expect(botIdentity(new Lang('sr-Cyrl'), 1).name).toBe('Брка');
    expect(botIdentity(new Lang('en'), 2).name).toBe('Auntie');
    expect(BOT_AVATARS).toHaveLength(4);
  });

  it('only on chairs nobody sat in; a dropped friend keeps their own name', () => {
    const o = src('src/net/OnlineGame.tsx');
    expect(o).toMatch(/const pureBot = s\.seat !== net\.seat && s\.bot && s\.name === SERVER_FALLBACK\(s\.seat\);/);
    expect(o).toMatch(/const who = pureBot \? botIdentity\(net\.lang, s\.seat\) : null;/);
    // And a bot is not somebody to hide or report.
    expect(src('src/TableScreen.tsx')).toMatch(/giftTarget !== 'table' && !seatMeta\?\.\[giftTarget\]\?\.pureBot/);
  });
});

describe('the table says who', () => {
  it('whose side still needs the points', () => {
    const hr = new Lang('hr').s;
    expect(hr.needsMore(82, true)).toBe('treba nam još 82');
    expect(hr.needsMore(82, false)).toBe('treba im još 82');
    for (const id of LOCALE_IDS) {
      const s = new Lang(id).s;
      expect(s.needsMore(5, true)).not.toBe(s.needsMore(5, false));
    }
    expect(src('src/TableScreen.tsx')).toMatch(/lang\.s\.needsMore\(progress\.callerNeeds, progress\.callerTeam === us\)/);
  });

  it('whose move it is, even while moves are being replayed', () => {
    const t = src('src/TableScreen.tsx');
    // The in-between views carry no actor by design; the seat whose move is
    // shown is the one on turn for the eye. Measured before: no seat lit for
    // 88% of a deal.
    expect(t).toMatch(/active=\{view\.toAct === s \|\| \(view\.toAct === null && spotlightSeat === s\)\}/);
    // Not my own: lit there means "you must act now" (source-guards).
    expect(t).toMatch(/active=\{view\.toAct === mySeat\}/);
    // The clock stays the real actor's.
    expect(t).toMatch(/deadline=\{view\.toAct === s \? turnDeadline : null\}/);
  });
});

describe('the end of a match, from our side', () => {
  it('a loss is not dressed as a win', () => {
    const t = src('src/TableScreen.tsx');
    expect(t).toMatch(/weWon=\{matchOver && winnerTeam !== null \? winnerTeam === teamOf\(mySeat\) : null\}/);
    // Both sheets: the crown only when it is ours, the band in the winners' colour.
    expect((t.match(/matchOver && weWon !== false && <Crown size=\{26\} \/>/g) ?? []).length).toBe(2);
    expect((t.match(/weWon === false \? styles\.sheetBandLost : styles\.sheetBandMatch/g) ?? []).length).toBe(2);
    for (const id of LOCALE_IDS) {
      const ui = new Lang(id).s.ui;
      expect(ui.matchWon).not.toBe(ui.matchLost);
    }
  });

  it('the sheet-s tallies settle one after another', () => {
    const t = src('src/TableScreen.tsx');
    expect(t).toMatch(/hero: true, countAfter: 0 \}/);
    expect(t).toMatch(/countAfter: 600,/);
    expect(src('src/anim/useCountUp.ts')).toMatch(/delayMs\?: number;/);
  });
});

describe('zvanja in normal play', () => {
  it('none: the app answers "Nemam" itself, with no buttons to tap twice', () => {
    const t = src('src/TableScreen.tsx');
    // Only where the app finds the zvanja (Učenje): blind versions leave "Nemam" to the player.
    expect(t).toMatch(/const autoSkipping = declaring && !blind && view\.myDeclarations\.length === 0;/);
    expect(t).toMatch(/const blind = blindZvanja\(playMode\);/);
    expect(t).toMatch(/onActionRef\.current\(\{ type: 'DECLARE_SKIP', seat: mySeat \}\)/);
    expect(t).toMatch(/const declareButtons = declaring && !autoSkipping \? \(/);
    // ...nor the plain action list, which offered the same skip as "šuti (ne
    // zovi)" in both orientations while the app was answering.
    // (A settled deal keeps a row only for a take outlasting it: no questions there either.)
    expect((t.match(/\{settled \|\| autoSkipping \? null : declareButtons \?\? \(/g) ?? []).length).toBe(2);
    expect(t).not.toMatch(/\{declareButtons \?\? \(/);
    // Lagana and Prava bela ask as Prava bela always did: nothing comes marked.
    expect(t).toMatch(/if \(!declaring \|\| blind\) return;/);
  });

  it('some: they come marked, one tap on Prijavi', () => {
    expect(src('src/TableScreen.tsx')).toMatch(/setMarked\(\[\.\.\.new Set\(view\.myDeclarations\.flatMap\(\(d\) => d\.cards\.map\(cardId\)\)\)\]\);/);
  });
});

describe('joining by code and being away', () => {
  it('the code box sits under the two ways in, capitals by default', () => {
    const h = src('src/HomeScreen.tsx');
    const tiles = h.indexOf('<View style={styles.modeRow}>');
    const join = h.indexOf('<Panel label={ui.joinByCode}>');
    const daily = h.indexOf('<Panel label={ui.daily}>');
    expect(tiles).toBeGreaterThan(-1);
    expect(join).toBeGreaterThan(tiles);
    expect(join).toBeLessThan(daily);
    expect(h).toMatch(/autoCapitalize="characters"/);
  });

  it('an app in the background is away; back when it returns', () => {
    const hook = src('src/net/useNetGame.ts');
    expect(hook).toMatch(/roomRef\.current\?\.send\('away', \{\}\);\s*return;/);
    expect(hook).toMatch(/roomRef\.current\?\.send\('back', \{\}\);/);
    const room = server('BelaRoom.ts');
    expect(room).toMatch(/if \(packet\.type === 'away'\) \{/);
    // Any word from a waited-for player means back, in case "back" was lost -
    // except the app's own Settings switch, which is not the player at the table.
    expect(room).toMatch(
      /if \(packet\.type !== 'away' && packet\.type !== 'hears' && packet\.type !== 'voiceIn' && packet\.type !== 'heard' && this\.waiting\.has\(seat\) && this\.occupants\[seat\]!\.connected\)/,
    );
  });
});
