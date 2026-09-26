import { INSTALL_ID_RE } from './protocol';

/**
 * The kill switch: a small JSON the server re-reads every minute, so a
 * feature that misbehaves in the wild can be turned off in seconds and
 * without a deploy - Play has no rollback, and a native swap that goes wrong
 * on some phone otherwise stays wrong until the next release reaches it.
 *
 * Served as a static file beside the privacy page (deploy/site/config.json,
 * https://<domain>/config.json - the app reads the same file) and pointed at
 * by CONFIG_URL. CONFIG_JSON (inline) wins over the URL, for tests and for a
 * box that must run with a fixed config; with neither set, the defaults
 * apply and nothing is fetched. A file that fails to fetch or parse changes
 * nothing: the last good config stays, and /health says when it was read.
 *
 * Every field is optional and every unknown one is ignored, so an old server
 * survives a new file and a typo turns one switch back to its default rather
 * than the whole file into nothing.
 */
export interface RemoteConfig {
  /** The file's own version, for the reader's information only. */
  v: number;
  /** The oldest wire generation admitted (protocol.ts PROTO); the larger of this and MIN_PROTO wins. */
  minProto: number;
  /** Closed for a moment: every join is refused with MAINTENANCE_CODE. Tables already playing go on. */
  maintenance: boolean;
  /** Voice clips at all. Off: nothing is relayed anywhere. */
  voice: boolean;
  /** Voice clips at PUBLIC tables (between strangers). Off: quick-play tables relay nothing; private tables keep voice. */
  strangerClips: boolean;
  gifts: boolean;
  emotes: boolean;
  /** Install IDs refused at the door (BANNED_CODE). Evaded by reinstalling; that is accepted until accounts exist. */
  banned: ReadonlySet<string>;
}

export const DEFAULT_CONFIG: RemoteConfig = {
  v: 0,
  minProto: 0,
  maintenance: false,
  voice: true,
  strangerClips: true,
  gifts: true,
  emotes: true,
  banned: new Set(),
};

/** More than this many bans and the list is a mistake, not a policy. */
export const BANNED_MAX = 10_000;

/** A tolerant read: each field its own type or its default, unknown fields ignored, bans cleaned. */
export function parseConfig(raw: unknown): RemoteConfig {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof RemoteConfig): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (DEFAULT_CONFIG[k] as boolean));
  const int = (k: 'v' | 'minProto'): number =>
    typeof o[k] === 'number' && Number.isInteger(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : DEFAULT_CONFIG[k];
  const banned = new Set<string>();
  if (Array.isArray(o.banned)) {
    for (const id of o.banned) {
      if (typeof id === 'string' && INSTALL_ID_RE.test(id)) banned.add(id);
      if (banned.size >= BANNED_MAX) break;
    }
  }
  return {
    v: int('v'),
    minProto: int('minProto'),
    maintenance: bool('maintenance'),
    voice: bool('voice'),
    strangerClips: bool('strangerClips'),
    gifts: bool('gifts'),
    emotes: bool('emotes'),
    banned,
  };
}

let current: RemoteConfig = DEFAULT_CONFIG;
let fetchedAt = 0;
let lastError = '';
let source = 'defaults';

/** What the room and the door go by right now. */
export function config(): RemoteConfig {
  return current;
}

/** For tests, and for the poller. */
export function setConfig(next: RemoteConfig, from = 'set'): void {
  const before = summary(current);
  current = next;
  source = from;
  const after = summary(current);
  if (JSON.stringify(before) !== JSON.stringify(after)) console.log(`[bela] config (${from}): ${JSON.stringify(after)}`);
}

function summary(c: RemoteConfig): Record<string, unknown> {
  return {
    v: c.v,
    minProto: c.minProto,
    maintenance: c.maintenance,
    voice: c.voice,
    strangerClips: c.strangerClips,
    gifts: c.gifts,
    emotes: c.emotes,
    banned: c.banned.size,
  };
}

/** For /health: the switches in force, where they came from, and when they were last read. */
export function configStatus(): Record<string, unknown> {
  return { ...summary(current), source, fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null, ...(lastError ? { lastError } : {}) };
}

/**
 * Start reading the config: CONFIG_JSON inline once, or CONFIG_URL every
 * `everyMs`. Never throws; a bad fetch is remembered for /health and retried.
 */
export function startConfigPolling(env: { CONFIG_JSON?: string; CONFIG_URL?: string }, everyMs = 60_000): void {
  if (env.CONFIG_JSON) {
    try {
      setConfig(parseConfig(JSON.parse(env.CONFIG_JSON)), 'CONFIG_JSON');
      fetchedAt = Date.now();
    } catch (e) {
      lastError = `CONFIG_JSON: ${(e as Error).message}`;
      console.error(`[bela] ${lastError}`);
    }
    return;
  }
  const url = env.CONFIG_URL;
  if (!url) return;
  const read = async (): Promise<void> => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'cache-control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfig(parseConfig(await res.json()), url);
      fetchedAt = Date.now();
      lastError = '';
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== lastError) console.error(`[bela] config ${url}: ${msg} (keeping the last one)`);
      lastError = msg;
    }
  };
  void read();
  const timer = setInterval(() => void read(), everyMs);
  // Never the reason the process stays up.
  timer.unref();
}
