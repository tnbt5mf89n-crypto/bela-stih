import { BLOCK_LIST_MAX, INSTALL_ID_RE } from './protocol';

/**
 * What an app says about itself at the door, and what it wants kept away.
 *
 * There are no accounts. An install ID is a random token the app made once
 * and keeps (apps/mobile/src/identity.ts); it names an installation, never a
 * person, and it is processed here in memory only - held with the seat while
 * the seat is held, never stored, never logged, never published to another
 * app. Its two uses: a player's block list (also sent at join, also in memory)
 * keeps two people who have blocked each other from being seated together in
 * quick play and from reaching each other with clips, emotes and gifts; and
 * the config's ban list refuses an installation at the door.
 */
export interface Identity {
  /** '' when the app sent none (an older app, or the web before it made one). */
  installId: string;
  blocked: ReadonlySet<string>;
}

export function cleanInstallId(v: unknown): string {
  return typeof v === 'string' && INSTALL_ID_RE.test(v) ? v : '';
}

/** Up to BLOCK_LIST_MAX well-formed IDs; anything else in the list is dropped, not refused. */
export function cleanBlockList(v: unknown): ReadonlySet<string> {
  const out = new Set<string>();
  if (!Array.isArray(v)) return out;
  for (const id of v) {
    if (typeof id === 'string' && INSTALL_ID_RE.test(id)) out.add(id);
    if (out.size >= BLOCK_LIST_MAX) break;
  }
  return out;
}

/** True when either has blocked the other. An app without an ID can block, but cannot be blocked. */
export function blocksEither(a: Identity, b: Identity): boolean {
  return (b.installId !== '' && a.blocked.has(b.installId)) || (a.installId !== '' && b.blocked.has(a.installId));
}
