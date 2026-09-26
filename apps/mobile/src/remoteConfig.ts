import { useEffect, useState } from 'react';
import { SERVER_URL } from './net/useNetGame';
import { kvGet, kvSet } from './storage';

/**
 * The server's switches, as the app reads them (1.6.0): the `config` block of
 * /health, which the server fills from its config.json (apps/server/src/
 * config.ts). The server enforces every switch itself; the app reads them so
 * a feature that was turned off is not offered - a mic that records into a
 * void, a gift nobody gets. (An app the server no longer admits learns it
 * from the door's refusal, with the way to the store beside it, and a server
 * closed for a moment says so the same way: net/trouble.ts.) A server from
 * before 1.6.0 answers /health without the block: it has no switches, so
 * nothing is off. Cached on the device, so the last answer applies from the
 * first frame; refreshed at launch and every five minutes.
 */
export interface AppConfig {
  voice: boolean;
  strangerClips: boolean;
  gifts: boolean;
  emotes: boolean;
  /** When this was read from the server; 0 for the defaults. */
  fetchedAt: number;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  voice: true,
  strangerClips: true,
  gifts: true,
  emotes: true,
  fetchedAt: 0,
};

const KEY = 'config.v1';
export const REFRESH_MS = 5 * 60_000;
/** /health beside the game socket: wss:// -> https://, ws:// -> http://. */
export const HEALTH_URL = `${SERVER_URL.replace(/^ws/, 'http')}/health`;

/** The `config` block of a /health answer, each field its own type or the default; null when there is none. */
export function parseAppConfig(health: unknown, now: number): AppConfig | null {
  const c = (health as { config?: unknown } | null)?.config;
  if (c === null || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const bool = (k: keyof AppConfig): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (DEFAULT_APP_CONFIG[k] as boolean));
  return {
    voice: bool('voice'),
    strangerClips: bool('strangerClips'),
    gifts: bool('gifts'),
    emotes: bool('emotes'),
    fetchedAt: now,
  };
}

/** A /health answer from a server from before 1.6.0: up (`ok`), and no `config` block at all. */
function switchless(health: unknown): boolean {
  return health !== null && typeof health === 'object' && (health as { ok?: unknown }).ok === true && !('config' in health);
}

function cached(): AppConfig {
  try {
    const raw = kvGet(KEY);
    if (!raw) return DEFAULT_APP_CONFIG;
    const c = parseAppConfig({ config: JSON.parse(raw) }, 0);
    if (!c) return DEFAULT_APP_CONFIG;
    const at = (JSON.parse(raw) as { fetchedAt?: unknown }).fetchedAt;
    return { ...c, fetchedAt: typeof at === 'number' ? at : 0 };
  } catch {
    return DEFAULT_APP_CONFIG;
  }
}

export async function fetchAppConfig(url = HEALTH_URL, now = Date.now()): Promise<AppConfig | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const health: unknown = await res.json();
    // A server from before 1.6.0 (one a rollback brings back) has no switches,
    // so nothing is off there: a kill cached from a newer server must not
    // outlive it and keep the mic and the gifts hidden. Anything else without
    // a readable block (an outage, a garbled answer) keeps the last one.
    const c = parseAppConfig(health, now) ?? (switchless(health) ? { ...DEFAULT_APP_CONFIG, fetchedAt: now } : null);
    if (c) kvSet(KEY, JSON.stringify(c));
    return c;
  } catch {
    return null;
  }
}

/** The switches as last read: the cache at once, the server as soon as it answers, again every five minutes. */
export function useRemoteConfig(): AppConfig {
  const [cfg, setCfg] = useState<AppConfig>(cached);
  useEffect(() => {
    let alive = true;
    const read = () => void fetchAppConfig().then((c) => alive && c && setCfg(c));
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return cfg;
}
