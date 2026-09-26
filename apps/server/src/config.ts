import { readFile } from 'node:fs/promises';
import { INSTALL_ID_RE } from './protocol';

/**
 * The kill switch: a small JSON the server re-reads every minute, so a
 * feature that misbehaves in the wild can be turned off in seconds and
 * without a deploy - Play has no rollback, and a native swap that goes wrong
 * on some phone otherwise stays wrong until the next release reaches it.
 *
 * On the box it is deploy/private/config.json, mounted into the game
 * container alone and named by CONFIG_FILE: it lists banned installations,
 * so it is never served (the app reads the switches from /health, which
 * counts the bans and names none). CONFIG_URL reads the same JSON over HTTP
 * instead; CONFIG_JSON (inline) wins over both, for tests and for a box that
 * must run with a fixed config; with none set, the defaults apply and nothing
 * is read. A file that fails to read or parse changes nothing: the last good
 * config stays, and /health says when it was read.
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
  /** Published IDs (the digest a report names) refused at the door (BANNED_CODE). Evaded by reinstalling; accepted until accounts exist. */
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
 * An error as /health may show it. Never the body: a JSON error quotes the
 * text around the fault, which could be the ban list, and lastError goes to
 * /health. Dropping only the quoted strings is not enough - the quote can
 * begin inside one, and then half a digest stands outside every pair.
 */
function shown(e: unknown): string {
  if (e instanceof SyntaxError) return 'not valid JSON';
  return (e instanceof Error ? e.message : String(e)).replace(/"(?:[^"\\]|\\.)*"/g, '"…"').slice(0, 160);
}

/**
 * Start reading the config: CONFIG_JSON inline once, or CONFIG_FILE (else
 * CONFIG_URL) every `everyMs`. Never throws; a bad read is remembered for
 * /health and retried. Returns what stops the polling, for tests.
 */
export function startConfigPolling(env: { CONFIG_JSON?: string; CONFIG_FILE?: string; CONFIG_URL?: string }, everyMs = 60_000): () => void {
  if (env.CONFIG_JSON) {
    try {
      setConfig(parseConfig(JSON.parse(env.CONFIG_JSON)), 'CONFIG_JSON');
      fetchedAt = Date.now();
    } catch (e) {
      lastError = `CONFIG_JSON: ${shown(e)}`;
      console.error(`[bela] ${lastError}`);
    }
    return () => {};
  }
  // The file wins over the URL: it is how the box keeps the ban list off the web.
  const file = env.CONFIG_FILE;
  const from = file || env.CONFIG_URL;
  if (!from) return () => {};
  const load = async (): Promise<unknown> => {
    // trimStart() drops a BOM too (an editor on Windows), as fetch's res.json() does.
    if (file) return JSON.parse((await readFile(file, 'utf8')).trimStart());
    const res = await fetch(from, { signal: AbortSignal.timeout(5000), headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const read = async (): Promise<void> => {
    try {
      setConfig(parseConfig(await load()), from);
      fetchedAt = Date.now();
      lastError = '';
    } catch (e) {
      const msg = shown(e);
      if (msg !== lastError) console.error(`[bela] config ${from}: ${msg} (keeping the last one)`);
      lastError = msg;
    }
  };
  void read();
  const timer = setInterval(() => void read(), everyMs);
  // Never the reason the process stays up.
  timer.unref();
  return () => clearInterval(timer);
}
