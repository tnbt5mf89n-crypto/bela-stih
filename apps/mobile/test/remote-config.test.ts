import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BANNED_MAX, config, DEFAULT_CONFIG, parseConfig, setConfig, startConfigPolling } from '../../server/src/config';

/**
 * The kill switch (config.json): read tolerantly, applied by the door and the
 * relays, never the reason a server fails to start.
 */

const here = dirname(fileURLToPath(import.meta.url));
const server = (p: string) => readFileSync(join(here, '../../server/src', p), 'utf8');
const ID = 'a'.repeat(32);

describe('the remote config', () => {
  it('reads each switch on its own and falls back per field, never as a whole', () => {
    const c = parseConfig({ v: 3, minProto: 1, maintenance: true, voice: 'no', gifts: false, banned: [ID, 'junk', 12], extra: 1 });
    expect(c.v).toBe(3);
    expect(c.minProto).toBe(1);
    expect(c.maintenance).toBe(true);
    expect(c.voice).toBe(true); // 'no' is not a boolean: the default
    expect(c.gifts).toBe(false);
    expect(c.emotes).toBe(true);
    expect([...c.banned]).toEqual([ID]);
  });

  it('is the defaults for anything that is not an object, and never negative or fractional', () => {
    for (const raw of [null, undefined, 3, 'x', [], { minProto: -1 }, { minProto: 1.5 }, { v: '2' }]) {
      const c = parseConfig(raw);
      expect(c.minProto).toBe(0);
      expect(c.v).toBe(0);
      expect(c.maintenance).toBe(false);
      expect(c.banned.size).toBe(0);
    }
    expect(DEFAULT_CONFIG.voice && DEFAULT_CONFIG.strangerClips && DEFAULT_CONFIG.gifts && DEFAULT_CONFIG.emotes).toBe(true);
  });

  it('caps the ban list', () => {
    const many = Array.from({ length: BANNED_MAX + 5 }, (_, i) => i.toString(16).padStart(32, '0'));
    expect(parseConfig({ banned: many }).banned.size).toBe(BANNED_MAX);
  });

  it('CONFIG_JSON applies at once, and a broken one changes nothing', () => {
    setConfig(DEFAULT_CONFIG, 'test');
    startConfigPolling({ CONFIG_JSON: JSON.stringify({ maintenance: true, banned: [ID] }) });
    expect(config().maintenance).toBe(true);
    expect(config().banned.has(ID)).toBe(true);
    setConfig(DEFAULT_CONFIG, 'test');
    startConfigPolling({ CONFIG_JSON: '{not json' });
    expect(config()).toBe(DEFAULT_CONFIG);
    // Nothing set: nothing read, nothing thrown.
    startConfigPolling({});
    expect(config()).toBe(DEFAULT_CONFIG);
  });

  it('is wired: the server polls it, the door and every relay consult it, and the box serves it', () => {
    const index = server('index.ts');
    expect(index).toMatch(/startConfigPolling\(process\.env\)/);
    expect(index).toMatch(/config: configStatus\(\)/);
    const room = server('BelaRoom.ts');
    // The door, in this order: closed, too old, banned, same network, blocked.
    const auth = room.slice(room.indexOf('override onAuth('), room.indexOf('override onJoin('));
    const order = ['MAINTENANCE_CODE', 'UPDATE_APP_CODE', 'BANNED_CODE', 'SAME_ORIGIN_CODE', 'BLOCKED_CODE'].map((c) => auth.indexOf(c));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(auth).toMatch(/Math\.max\(MIN_PROTO, cfg\.minProto\)/);
    for (const sw of ['config\\(\\)\\.voice', 'config\\(\\)\\.gifts', 'config\\(\\)\\.emotes', 'config\\(\\)\\.strangerClips']) {
      expect(room, sw).toMatch(new RegExp(sw));
    }
    const compose = readFileSync(join(here, '../../../deploy/docker-compose.yml'), 'utf8');
    expect(compose).toMatch(/CONFIG_URL: https:\/\/\$\{DOMAIN\}\/config\.json/);
    const served = JSON.parse(readFileSync(join(here, '../../../deploy/site/config.json'), 'utf8'));
    expect(parseConfig(served)).toEqual({ ...DEFAULT_CONFIG, v: served.v });
  });
});
