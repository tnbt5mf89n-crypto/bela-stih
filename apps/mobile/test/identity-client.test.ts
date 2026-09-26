import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lang, LOCALE_IDS } from '@belot/i18n';
import {
  BLOCK_LIST_MAX,
  blockedIds,
  CONDUCT_KEY,
  ensureInstallId,
  hexOf,
  IDENTITY_KEY,
  INSTALL_ID_RE,
  readBlocked,
  readConduct,
  withBlock,
  withoutBlock,
  writeBlocked,
  writeConduct,
  type KVLike,
} from '../src/identity';
import { troubleOf, retryHelps } from '../src/net/trouble';
import { reportMailto } from '../src/report';

/**
 * The app's side of install IDs, blocks and the stranger-clip opt-in (1.6.0):
 * an identity made once and kept, a block list that goes to the server at
 * every join, a report that names whom it is about, the conduct sheet before
 * the first voice message, and the door's new refusals in the player's words.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');

function fakeKv(): KVLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getString: (k) => map.get(k), set: (k, v) => void map.set(k, v) };
}
const HEX = 'abcdef0123456789abcdef0123456789';

describe('the install ID', () => {
  it('is made once, from 16 random bytes, and then kept', () => {
    const kv = fakeKv();
    let calls = 0;
    const random = () => {
      calls++;
      return hexOf(Uint8Array.from({ length: 16 }, (_, i) => (i * 17 + calls) & 0xff));
    };
    const a = ensureInstallId(kv, random);
    expect(a).toMatch(INSTALL_ID_RE);
    expect(ensureInstallId(kv, random)).toBe(a);
    expect(calls).toBe(1);
    expect(JSON.parse(kv.map.get(IDENTITY_KEY)!)).toEqual({ installId: a });
  });

  it('replaces a stored ID it cannot trust, and refuses a random source that is not 32 hex digits', () => {
    const kv = fakeKv();
    kv.set(IDENTITY_KEY, JSON.stringify({ installId: 'short' }));
    expect(ensureInstallId(kv, () => HEX)).toBe(HEX);
    kv.set(IDENTITY_KEY, 'not json');
    expect(ensureInstallId(kv, () => HEX)).toBe(HEX);
    expect(() => ensureInstallId(fakeKv(), () => 'xyz')).toThrow(/32 hex/);
  });
});

describe('the block list', () => {
  const ids = Array.from({ length: BLOCK_LIST_MAX + 5 }, (_, i) => i.toString(16).padStart(32, '0'));

  it('blocks once per ID, refreshes the name, drops the oldest past the cap, and unblocks', () => {
    let list = withBlock([], ids[0]!, 'Marko', '2026-09-26');
    list = withBlock(list, ids[1]!, 'Ana', '2026-09-26');
    list = withBlock(list, ids[0]!, 'Marko II', '2026-09-27');
    expect(list.map((b) => b.id)).toEqual([ids[1], ids[0]]);
    expect(list[1]!.name).toBe('Marko II');
    for (const id of ids.slice(2)) list = withBlock(list, id, 'x', '2026-09-27');
    expect(list).toHaveLength(BLOCK_LIST_MAX);
    expect(list.some((b) => b.id === ids[1])).toBe(false); // the oldest went
    expect(list[list.length - 1]!.id).toBe(ids[ids.length - 1]);
    expect(withoutBlock(list, ids[10]!).some((b) => b.id === ids[10])).toBe(false);
    expect(withBlock([], 'junk', 'x', 'today')).toEqual([]);
    expect(blockedIds(list)).toEqual(list.map((b) => b.id));
  });

  it('survives the store: written, read back, junk entries dropped', () => {
    const kv = fakeKv();
    writeBlocked(kv, [{ id: HEX, name: 'Marko', at: '2026-09-26' }]);
    kv.set('blocked.v1', JSON.stringify([{ id: HEX, name: 'Marko', at: '2026-09-26' }, { id: 'junk' }, 7, null]));
    expect(readBlocked(kv)).toEqual([{ id: HEX, name: 'Marko', at: '2026-09-26' }]);
    kv.set('blocked.v1', '{bad');
    expect(readBlocked(kv)).toEqual([]);
  });

  it('the conduct sheet is remembered', () => {
    const kv = fakeKv();
    expect(readConduct(kv)).toBe(false);
    writeConduct(kv);
    expect(readConduct(kv)).toBe(true);
    expect(kv.map.get(CONDUCT_KEY)).toBe('1');
  });
});

describe("the door's new refusals", () => {
  it('are told apart, and none of them is helped by trying the same table again', () => {
    expect(troubleOf({ code: 4302, message: 'blocked' })).toBe('blocked');
    expect(troubleOf({ code: 4303, message: 'banned' })).toBe('banned');
    expect(troubleOf({ code: 4304, message: 'closed for a moment' })).toBe('maintenance');
    for (const t of ['blocked', 'banned', 'maintenance'] as const) expect(retryHelps(t)).toBe(false);
  });

  it('every locale has words for them, the block, the opt-in and the conduct sheet', () => {
    for (const id of LOCALE_IDS) {
      const ui = new Lang(id).s.ui;
      for (const k of ['troubleBlocked', 'troubleBanned', 'troubleMaintenance', 'updateApp', 'blockPlayer', 'blockPlayerNote', 'blockedPlayers', 'blockedNone', 'unblock', 'voiceOptInTitle', 'voiceOptInBody', 'voiceOptInYes', 'voiceOptInNo', 'conductTitle', 'conductBody', 'conductAccept'] as const) {
        expect((ui[k] as string).length, `${id}.${k}`).toBeGreaterThan(2);
      }
      // The report names the installation when it knows it, and stays whole when it does not.
      const withId = reportMailto(ui, { name: 'M', code: 'ABCDE', at: 'now', version: '1.6.0', id: HEX });
      expect(decodeURIComponent(withId)).toContain(HEX);
      expect(decodeURIComponent(reportMailto(ui, { name: 'M', code: 'ABCDE', at: 'now', version: '1.6.0' }))).not.toMatch(/undefined/);
    }
  });
});

describe('the app is wired to it', () => {
  it('sends the ID and the blocks at every join, and a blocked quick-play table is not the end of quick play', () => {
    const net = src('net/useNetGame.ts');
    expect((net.match(/\.\.\.identity\(\)/g) ?? []).length).toBe(4);
    expect(net).toMatch(/code !== SAME_ORIGIN_CODE && code !== BLOCKED_CODE/);
    expect(net).toMatch(/setVoiceOptIn\(msg\.voiceOptIn === true\)/);
    expect(net).toMatch(/roomRef\.current\?\.send\('voiceIn', \{ on \}\)/);
    // Blocking hides for this table as well, and remembers the ID for good.
    const block = net.slice(net.indexOf('const block = useCallback('), net.indexOf('const block = useCallback(') + 700);
    expect(block).toMatch(/withBlock\(/);
    expect(block).toMatch(/saveBlocked\(/);
    expect(block).toMatch(/hide\(s, true\)/);
  });

  it('the online screen asks once per table before strangers are heard, and once ever before the first send', () => {
    const online = src('net/OnlineGame.tsx');
    expect(online).toMatch(/askOptIn && \(\s*<ConfirmDialog/);
    expect(online).toMatch(/conductAsk && \(\s*<ConfirmDialog/);
    expect(online).toMatch(/if \(!conductAccepted\(\)\) \{\s*setConductAsk\(true\);\s*return;/);
    expect(online).toMatch(/onBlock=\{net\.block\}/);
    expect(online).toMatch(/id: net\.installIdOf\(s\)/);
    // The switches the server can flip are honoured before a player acts on them.
    expect(online).toMatch(/settings\.voice && net\.voiceOn && cfg\.voice/);
    expect(online).toMatch(/onEmote=\{cfg\.emotes \? net\.sendEmote : undefined\}/);
    expect(online).toMatch(/onGift=\{cfg\.gifts \? net\.sendGift : undefined\}/);
    // Too old: a way to the store, not only the words.
    expect(online).toMatch(/net\.trouble === 'appTooOld' && <Button label=\{ui\.updateApp\}/);
    expect(src('table/GiftPicker.tsx')).toMatch(/moderate\.onBlock && \(/);
    expect(src('screens/SettingsScreen.tsx')).toMatch(/ui\.blockedPlayers/);
  });

  it('the gifts switch takes only the gifts: another person\'s puck still opens hide, block, mute and report', () => {
    // No render harness here, so the table's own two expressions are run as
    // written: the one early return that leaves a puck bare, and the gate the
    // picker is drawn under.
    const t = src('TableScreen.tsx');
    const bare = /const giftPress = \(s: Seat, child: ReactElement\) => \{\s*if \((.+)\) return child;/.exec(t)?.[1];
    const gate = /\{giftTarget !== null && (.+) && \(\s*<GiftPicker/.exec(t)?.[1];
    expect(bare, 'giftPress').toBeDefined();
    expect(gate, 'the picker gate').toBeDefined();
    const isBare = new Function('s', 'mySeat', 'onGift', 'onHide', 'onReport', 'seatMeta', `return !!(${bare});`);
    const drawn = new Function('onGift', 'moderating', `return !!(${gate});`);
    const f = () => {};
    const seats = [{ pureBot: false }, { pureBot: false }, { pureBot: true }, { pureBot: false }];
    // Gifts off: a person's puck opens, and openGifts makes the panel the player view.
    expect(isBare(1, 0, undefined, f, f, seats)).toBe(false);
    expect(drawn(undefined, true)).toBe(true);
    expect(t).toMatch(/setModerating\(!giftable && target !== 'table'\);/);
    // Still bare: my own puck, a pure bot's, and a table with nobody to report (offline).
    expect(isBare(0, 0, undefined, f, f, seats)).toBe(true);
    expect(isBare(2, 0, undefined, f, f, seats)).toBe(true);
    expect(isBare(1, 0, undefined, undefined, undefined, seats)).toBe(true);
    // With gifts every puck opens the picker, as before, and a gift grid needs gifts.
    expect(isBare(0, 0, f, undefined, undefined, seats)).toBe(false);
    expect(drawn(f, false)).toBe(true);
    expect(drawn(undefined, false)).toBe(false);
  });

  it('offers Block only where it can be kept: a seat whose app sent an install ID', () => {
    // An older app's seat has none, so a block would only hide it at this
    // table while the button says "for good".
    const expr = /blockable: (.+),/.exec(src('net/OnlineGame.tsx'))?.[1];
    expect(expr).toBeDefined();
    const blockable = new Function('s', 'net', `return !!(${expr});`);
    expect(blockable({ seat: 1, installId: HEX }, { seat: 0 })).toBe(true);
    expect(blockable({ seat: 1 }, { seat: 0 })).toBe(false);
    expect(blockable({ seat: 0, installId: HEX }, { seat: 0 })).toBe(false);
    expect(src('TableScreen.tsx')).toMatch(/\.\.\.\(onBlock && seatMeta\?\.\[giftTarget\]\?\.blockable\s*\?/);
  });

  it('an opt-in said while the line was down is said again when the seat comes back', () => {
    // The room keeps a seat's answer across a reconnect, so one that never
    // arrived would leave the player opted in here and deaf there, never asked again.
    const net = src('net/useNetGame.ts');
    const attach = net.slice(net.indexOf('const attach = useCallback('), net.indexOf("room.onMessage('view'"));
    expect(attach).toMatch(/\} else if \(optedInRef\.current\) \{[^}]*room\.send\('voiceIn', \{ on: true \}\);\s*\}/);
    // ...and only at the same table: a new one forgets the answer.
    expect(attach).toMatch(/optedInRef\.current = false;\s*setOptedIn\(false\);/);
    expect(net).toMatch(/optedInRef\.current = on;\s*roomRef\.current\?\.send\('voiceIn', \{ on \}\);/);
  });
});

describe('a browser that keeps nothing', () => {
  // The web build's own modules, run for real over a window whose storage is
  // off (Firefox's dom.storage.enabled=false: null) or locked (site data
  // blocked: the getter throws).
  const off = [() => null, () => { throw new Error('SecurityError: access is denied for this document'); }];
  const g = globalThis as { window?: unknown; localStorage?: unknown };
  afterEach(() => {
    delete g.window;
    delete g.localStorage;
    vi.doUnmock('react-native');
    vi.doUnmock('react-native-mmkv');
    vi.resetModules();
  });

  it('remembers the conduct sheet for the session, so the mic can record at all', async () => {
    for (const storage of off) {
      vi.resetModules();
      vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
      g.window = { get localStorage() { return storage(); } };
      const { acceptConduct, conductAccepted } = await import('../src/storage');
      expect(conductAccepted()).toBe(false);
      acceptConduct();
      expect(conductAccepted()).toBe(true);
    }
  });

  it('starts where the storage getter throws: the socket polyfill does not trip on it', async () => {
    vi.resetModules();
    vi.doMock('react-native-mmkv', () => ({
      createMMKV: () => ({ getString: () => undefined, set: () => {}, remove: () => {}, clearAll: () => {} }),
    }));
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: off[1] });
    // It used to throw right here, as the bundle loaded: the page never left its placeholder.
    await import('../src/net/polyfills');
    delete g.localStorage;
    // Where there is none at all (React Native), the shim still goes in.
    vi.resetModules();
    await import('../src/net/polyfills');
    expect(typeof (g.localStorage as Storage | undefined)?.getItem).toBe('function');
  });
});
