import { BANNED_CODE, BLOCKED_CODE, MAINTENANCE_CODE, UPDATE_APP_CODE } from './proto';

/**
 * Why getting to a table failed, in the player's terms rather than the
 * library's. Measured against Colyseus 0.16: a code nobody has open is 4212
 * `room "X" not found`; a table that has started, or is full (a full table
 * starts), is 4212 `room "X" is locked`; no server at all is an error with no
 * code ("connect ECONNREFUSED", "Failed to fetch", "Network request failed").
 * A public table that has not started refuses a second seat from a network
 * already sitting there (4300, BelaRoom.onAuth) - joined by its code, say,
 * from the same home Wi-Fi. Trying again meets the same rule.
 */
export type Trouble = 'noSuchTable' | 'tableClosed' | 'sameNetwork' | 'appTooOld' | 'blocked' | 'banned' | 'maintenance' | 'offline' | 'server';

/** The server's code for a second seat from one network at a public table. */
export const SAME_NETWORK_CODE = 4300;
/** The server's code for an app too old for its wire (proto.ts). */
export const APP_TOO_OLD_CODE = UPDATE_APP_CODE;

export function troubleOf(err: unknown): Trouble {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'number' ? e.code : null;
  const message = typeof e?.message === 'string' ? e.message : '';
  if (code === 4212 && /not found/i.test(message)) return 'noSuchTable';
  if (code === 4212) return 'tableClosed';
  if (code === SAME_NETWORK_CODE) return 'sameNetwork';
  if (code === APP_TOO_OLD_CODE) return 'appTooOld';
  // A public table where somebody blocked you or you them; this installation banned; the server closed for a moment (1.6.0).
  if (code === BLOCKED_CODE) return 'blocked';
  if (code === BANNED_CODE) return 'banned';
  if (code === MAINTENANCE_CODE) return 'maintenance';
  if (code === null) return 'offline';
  return 'server';
}

/** Trying again can help only when the fault was the line or the server. */
export function retryHelps(t: Trouble | null): boolean {
  return t === 'offline' || t === 'server';
}
