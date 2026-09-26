import { createHash } from 'node:crypto';
import { BLOCK_LIST_MAX, INSTALL_ID_RE } from './protocol';

/**
 * What an app says about itself at the door, and what it wants kept away.
 *
 * There are no accounts. An install ID is a random token the app made once
 * and keeps (apps/mobile/src/identity.ts); it names an installation, never a
 * person, and it goes no further than the door: there it becomes its digest
 * (publishedId), and only the digest is held with the seat while the seat is
 * held and shown to the others at the table. Neither is ever stored or
 * logged, and the ID itself is never published to another app. Its two uses,
 * both by the digest: a player's block list (the digests of the seats it
 * blocked, also sent at join, also in memory) keeps two people who have
 * blocked each other from being seated together in quick play and from
 * reaching each other with clips, emotes and gifts; and the config's ban list
 * refuses an installation at the door.
 */
export interface Identity {
  /** The published digest (publishedId); '' when the app sent no ID (an older app, or the web before it made one). */
  installId: string;
  /** The digests of the seats this app has blocked, as the tables showed them. */
  blocked: ReadonlySet<string>;
}

export function cleanInstallId(v: unknown): string {
  return typeof v === 'string' && INSTALL_ID_RE.test(v) ? v : '';
}

/**
 * What the room knows an installation by from the door on: a one-way digest
 * of the install ID its app sent, shaped like one (INSTALL_ID_RE). The other
 * apps at a table see it, so it is what a block keeps, a report names and a
 * ban lists. The door hashes whatever it is sent, so a value copied from a
 * table is useless as an ID: the app that presents it sits down under the
 * digest of it, never as the seat it was copied from. No secret is needed -
 * the ID is 16 random bytes, so its digest can be neither reversed nor
 * guessed. Blocks kept on phones and bans in config.json hold these values,
 * so the function can never change. '' (no ID) stays ''.
 */
export function publishedId(installId: string): string {
  return installId === '' ? '' : createHash('sha256').update(installId).digest('hex').slice(0, 32);
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
