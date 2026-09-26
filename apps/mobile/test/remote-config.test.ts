import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BANNED_MAX, config, configStatus, DEFAULT_CONFIG, parseConfig, setConfig, startConfigPolling } from '../../server/src/config';

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

  it('CONFIG_FILE is read from disk, before any URL; a broken edit keeps the last one, and /health quotes none of it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bela-config-'));
    const file = join(dir, 'config.json');
    const banned = 'abcdef0123456789'.repeat(2);
    // With a BOM, as an editor on Windows leaves one; the URL beside it is never asked.
    writeFileSync(file, String.fromCharCode(0xfeff) + JSON.stringify({ voice: false, banned: [banned] }));
    setConfig(DEFAULT_CONFIG, 'test');
    const stop = startConfigPolling({ CONFIG_FILE: file, CONFIG_URL: 'http://127.0.0.1:9/config.json' }, 50);
    try {
      await vi.waitFor(() => expect(config().banned.has(banned)).toBe(true));
      expect(config().voice).toBe(false);
      expect(configStatus()).toMatchObject({ banned: 1, source: file });
      expect(configStatus().lastError).toBeUndefined();
      // Broken inside the list, so the text a JSON error quotes around the fault is a ban.
      writeFileSync(file, '{ "banned": ["' + banned + '", ' + banned + '"] }');
      await vi.waitFor(() => expect(configStatus().lastError).toBe('not valid JSON'));
      expect(config().banned.has(banned)).toBe(true);
      const shown = JSON.stringify(configStatus());
      for (let i = 0; i + 6 <= banned.length; i++) expect(shown).not.toContain(banned.slice(i, i + 6));
    } finally {
      stop();
      rmSync(dir, { recursive: true, force: true });
      setConfig(DEFAULT_CONFIG, 'test');
    }
  });

  it('is wired: the server polls it, the door and every relay consult it, and only the game server can read it', () => {
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
    // It lists banned installations: read from disk by the game container alone (the directory,
    // read-only, so an edit that replaces the file is still seen), and nowhere caddy serves files.
    const repo = (f: string) => join(here, '../../..', f);
    const compose = readFileSync(repo('deploy/docker-compose.yml'), 'utf8');
    const bela = compose.slice(compose.indexOf('\n  bela:'), compose.indexOf('\n  caddy:'));
    expect(bela).toMatch(/^ +CONFIG_FILE: \/etc\/bela\/config\.json\r?$/m);
    expect(bela).toMatch(/^ +- \.\/private:\/etc\/bela:ro\r?$/m);
    expect(compose).not.toMatch(/CONFIG_URL:/);
    expect(compose.slice(compose.indexOf('\n  caddy:'))).not.toMatch(/private/);
    expect(existsSync(repo('deploy/site/config.json'))).toBe(false);
    // The repo's copy only seeds a new box: the defaults, and nobody banned.
    const seed = JSON.parse(readFileSync(repo('deploy/private/config.json'), 'utf8'));
    expect(parseConfig(seed)).toEqual({ ...DEFAULT_CONFIG, v: seed.v });
    // A deploy keeps the box's copy, and leaves none behind in deploy/site.
    const deploy = readFileSync(repo('scripts/deploy-server.sh'), 'utf8');
    expect(deploy).toMatch(/--exclude=deploy\/private\/config\.json/);
    expect(deploy).toMatch(/^rm -f deploy\/site\/config\.json\r?$/m);
  });
});

describe("the app's reading of it (remoteConfig.ts)", () => {
  const kv = new Map<string, string>();
  /** The module for real, over an in-memory store and whatever /health answers. */
  async function app() {
    vi.resetModules();
    vi.doMock('../src/net/useNetGame', () => ({ SERVER_URL: 'ws://127.0.0.1:1' }));
    vi.doMock('../src/storage', () => ({ kvGet: (k: string) => kv.get(k), kvSet: (k: string, v: string) => void kv.set(k, v) }));
    return import('../src/remoteConfig');
  }
  const health = (body: unknown, status = 200) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }));
  const kept = () => JSON.parse(kv.get('config.v1') ?? '{}') as Record<string, unknown>;
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../src/net/useNetGame');
    vi.doUnmock('../src/storage');
    vi.resetModules();
    setConfig(DEFAULT_CONFIG, 'test');
    kv.clear();
  });

  it('a server from before 1.6.0 has no switches: a kill cached from a newer one does not outlive a rollback', async () => {
    const { DEFAULT_APP_CONFIG, fetchAppConfig } = await app();
    kv.set('config.v1', JSON.stringify({ ...DEFAULT_APP_CONFIG, voice: false, gifts: false, fetchedAt: 1 }));
    // 1.5.x's /health, field for field: up, and no `config` block at all.
    health({ ok: true, room: 'bela', sha: 'abc1234', proto: 1, minProto: 0, rooms: 2, players: 5, uptimeSeconds: 60 });
    expect(await fetchAppConfig('http://x/health', 7)).toEqual({ ...DEFAULT_APP_CONFIG, fetchedAt: 7 });
    expect(kept()).toMatchObject({ voice: true, gifts: true, fetchedAt: 7 });
  });

  it("a 1.6.0 server's own block is read as before, and an outage or a garbled answer keeps the last word", async () => {
    const { fetchAppConfig } = await app();
    // What this server's /health really says with gifts switched off.
    setConfig(parseConfig({ gifts: false }), 'test');
    health({ ok: true, sha: 'def5678', config: configStatus() });
    expect(await fetchAppConfig('http://x/health', 8)).toMatchObject({ gifts: false, voice: true, emotes: true });
    expect(kept()).toMatchObject({ gifts: false, fetchedAt: 8 });
    health({ ok: false }, 503);
    expect(await fetchAppConfig('http://x/health', 9)).toBeNull();
    health({ ok: true, config: 'garbled' });
    expect(await fetchAppConfig('http://x/health', 10)).toBeNull();
    expect(kept()).toMatchObject({ gifts: false, fetchedAt: 8 });
  });
});
