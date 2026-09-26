import type { Seat } from '@belot/engine';
import type { Lang } from '@belot/i18n';

/**
 * The bots' faces, by seat: offline they fill three chairs, online whichever
 * chairs nobody sat in. The same four characters everywhere, so a bot reads as
 * someone at the table rather than as a missing player.
 */
// Never the captain: a level-15, 2000-coin face on a bot made the purchase feel cheap.
export const BOT_AVATARS: readonly string[] = ['djed', 'brko', 'teta', 'baka'];

/**
 * A bot's face and name. Online, a chair nobody ever sat in used to show a
 * bare "I" - the first letter of the server's "Igrač 4" - and be called that
 * too ("zvao Igrač 4"). It now wears its character, named in the player's
 * language (Kapetan, Капетан, Captain).
 */
export function botIdentity(lang: Lang, seat: Seat): { name: string; avatar: string } {
  const avatar = BOT_AVATARS[seat]!;
  return { name: lang.s.ui.cosmeticName(avatar), avatar };
}
