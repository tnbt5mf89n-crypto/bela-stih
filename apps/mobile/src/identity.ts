/**
 * Who this installation is, and whom it keeps away (1.6.0).
 *
 * There are no accounts. The install ID is 16 random bytes made once, on the
 * first launch that needs it, and kept on the device; it names this
 * installation and nothing else, and it is sent to the server only at a join,
 * where it lives with the seat for as long as the seat does (never stored,
 * never logged - apps/server/src/identity.ts). Its uses: the block list below,
 * a report that names whom it is about, and the config's ban list.
 *
 * The block list is device-local and permanent until the player removes an
 * entry in Settings. It goes to the server at every join, in memory only:
 * quick play never seats two people who have blocked each other, and no clip,
 * emote or gift crosses a block anywhere.
 *
 * Pure: no React Native here, so the tests load it under node; storage.ts
 * binds it to the device's store.
 */

export const INSTALL_ID_RE = /^[0-9a-f]{32}$/;
/** More than this and the oldest entries make room (the server reads at most this many too). */
export const BLOCK_LIST_MAX = 200;

export interface BlockedPlayer {
  id: string;
  /** The nickname as the table showed it when blocked - for the list in Settings, nothing else. */
  name: string;
  /** ISO day of the block. */
  at: string;
}

export interface KVLike {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export const IDENTITY_KEY = 'identity.v1';
export const BLOCKED_KEY = 'blocked.v1';
export const CONDUCT_KEY = 'conduct.v1';

/** The stored install ID, or a fresh one from `random` (32 hex digits) saved on the spot. */
export function ensureInstallId(kv: KVLike, random: () => string): string {
  try {
    const raw = kv.getString(IDENTITY_KEY);
    if (raw) {
      const id = (JSON.parse(raw) as { installId?: unknown }).installId;
      if (typeof id === 'string' && INSTALL_ID_RE.test(id)) return id;
    }
  } catch {
    // unreadable: a new identity, below
  }
  let id = random().toLowerCase();
  if (!INSTALL_ID_RE.test(id)) throw new Error('the random source did not give 32 hex digits');
  kv.set(IDENTITY_KEY, JSON.stringify({ installId: id }));
  return id;
}

export function readBlocked(kv: KVLike): BlockedPlayer[] {
  try {
    const raw = kv.getString(BLOCKED_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((b): b is BlockedPlayer => typeof b === 'object' && b !== null && typeof (b as BlockedPlayer).id === 'string' && INSTALL_ID_RE.test((b as BlockedPlayer).id))
      .map((b) => ({ id: b.id, name: typeof b.name === 'string' ? b.name : '', at: typeof b.at === 'string' ? b.at : '' }))
      .slice(-BLOCK_LIST_MAX);
  } catch {
    return [];
  }
}

export function writeBlocked(kv: KVLike, list: readonly BlockedPlayer[]): void {
  try {
    kv.set(BLOCKED_KEY, JSON.stringify(list.slice(-BLOCK_LIST_MAX)));
  } catch {
    // a failed save must never take the game down
  }
}

/** The list with `id` blocked (the name refreshed if it was already there), newest last, the oldest making room past the cap. */
export function withBlock(list: readonly BlockedPlayer[], id: string, name: string, at: string): BlockedPlayer[] {
  if (!INSTALL_ID_RE.test(id)) return list.slice();
  const rest = list.filter((b) => b.id !== id);
  const next = [...rest, { id, name: name.slice(0, 20), at }];
  return next.slice(-BLOCK_LIST_MAX);
}

export function withoutBlock(list: readonly BlockedPlayer[], id: string): BlockedPlayer[] {
  return list.filter((b) => b.id !== id);
}

/** What goes to the server at a join: the IDs only. */
export function blockedIds(list: readonly BlockedPlayer[]): string[] {
  return list.map((b) => b.id);
}

/** The rules of conduct were shown and accepted before the first voice message (Play's terms-before-UGC rule). */
export function readConduct(kv: KVLike): boolean {
  try {
    return kv.getString(CONDUCT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeConduct(kv: KVLike): void {
  try {
    kv.set(CONDUCT_KEY, '1');
  } catch {
    // shown again next time, which is the safe side
  }
}

/** 16 bytes as 32 hex digits. */
export function hexOf(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
