import { teamOf, type Seat } from '@belot/engine';
import type { TableEvent } from '@belot/table';
import {
  applyDealOutcome,
  applyMatchOutcome,
  type Award,
  type PlayerProfile,
} from '@belot/progression';
import { playSfx, type PlayOptions, type Sfx } from './audio';
import { pattern, type Pattern } from './haptics';

/**
 * Turns the table's event stream into sound, haptics and rewards.
 *
 * Shared by offline and online on purpose: the server emits exactly the same
 * `TableEvent`s the local table does, so a player earns XP and coins the same
 * way in both modes without a second implementation to keep in step.
 */

/**
 * The events that make no sound of their own. Listed so a test can insist
 * that every other kind does — a new event kind that nobody scored is
 * otherwise a silence nobody notices.
 */
export const SILENT_EVENTS: readonly TableEvent['kind'][] = ['declarationSkipped'];

/** What the player did this deal, accumulated from events as they arrive. */
export interface DealTally {
  zvanja: number;
  bela: boolean;
}

export const emptyTally = (): DealTally => ({ zvanja: 0, bela: false });

/** Merge a deal award and a match award into one banner. */
/** True for a banner that carries a match's outcome (merged onto the last deal's). */
export function isMatchAward(a: Award): boolean {
  return a.reasons.some((r) => r === 'matchWon' || r === 'matchLost');
}

export function mergeAward(a: Award | null, b: Award): Award {
  if (!a) return b;
  return {
    xp: a.xp + b.xp,
    coins: a.coins + b.coins,
    levelUp: b.levelUp ?? a.levelUp,
    reasons: [...a.reasons, ...b.reasons],
  };
}

/**
 * The sound of an event's end-of-beat, if it has one — played by the games
 * from the director's onEventEnd, which never fires for a flushed event.
 */
export function landingSound(e: TableEvent, mySeat: Seat, reduced = false): void {
  switch (e.kind) {
    case 'dealStarted':
      // The real cards fan open as the backs fade.
      playSfx('fan');
      break;
    case 'handsCompleted':
      // The talon slides into its sorted place.
      playSfx('sort');
      break;
    case 'cardPlayed':
      if (e.seat !== mySeat) {
        playSfx('play', { rate: 0.95 });
        // No haptic for another seat's card (1.6.0): the sound says it landed.
      }
      break;
    case 'bidCalled':
    case 'doubled':
      // The pip (or the ×2) lands on the plaque as the beat ends.
      playSfx('stamp');
      break;
    case 'trickWon':
      // The pile landing at the winner's puck.
      playSfx('stack', { gain: teamOf(e.seat) === teamOf(mySeat) ? 1 : 0.7 });
      break;
    case 'dealScored': {
      // The verdict, as the sheet slides up: the stinger and the phone's own
      // made / failed pattern land together.
      const mine = teamOf(mySeat);
      const won = e.result.finalScore[mine] > e.result.finalScore[mine === 0 ? 1 : 0];
      // Under reduce-motion the beats are a third as long: the stinger keeps
      // up, or it would still be sounding under a match's fanfare.
      playSfx(won ? 'win' : 'lose', { rate: reduced ? 1.4 : 1 });
      pattern(won ? 'dealMade' : 'dealFailed');
      break;
    }
    case 'matchOver': {
      // The fanfare, as the sheet turns into the match's: a beat after the
      // last deal's own stinger, never in the same breath as it.
      const won = e.winner === teamOf(mySeat);
      playSfx(won ? 'matchWon' : 'matchLost');
      pattern(won ? 'matchWon' : 'matchLost');
      break;
    }
    default:
      break;
  }
}

export interface ProcessOptions {
  events: TableEvent[];
  profile: PlayerProfile;
  /** Mutated in place as declarations and bela calls come in. */
  tally: DealTally;
  mySeat: Seat;
  /**
   * True when events are being flushed past (fast-forward, compression):
   * progression still applies — XP and coins must never be lost — but sounds
   * and haptics stay quiet.
   */
  silent?: boolean;
  /** Učenje announces zvanja for the player: they count, but earn no XP (progression). */
  autoZvanja?: boolean;
  /** The match target (501/701/1001): a shorter match pays less. */
  target?: number;
  /** Today (isoDay); the quests roll over before an outcome is counted. */
  today?: string;
  /** Reduce-motion: the beats are short, so the long sounds play quick. */
  reduced?: boolean;
}

export function processEvents({
  events,
  profile,
  tally,
  mySeat,
  silent = false,
  reduced = false,
  autoZvanja = false,
  target,
  today,
}: ProcessOptions): { profile: PlayerProfile; award: Award | null } {
  const sfx = (name: Sfx, opts?: PlayOptions) => {
    if (silent) return;
    if (opts) playSfx(name, opts);
    else playSfx(name);
  };
  // The haptics module carries the Settings gate; `silent` is this batch's.
  const buzz = (name: Pattern) => {
    if (!silent) pattern(name);
  };

  let next = profile;
  let earned: Award | null = null;

  for (const e of events) {
    switch (e.kind) {
      case 'dealStarted':
        tally.zvanja = 0;
        tally.bela = false;
        // The riffle: twelve slides matched to the backs flying — twice as
        // quick under reduce-motion, where the deal is a 250 ms beat.
        sfx('deal', { rate: reduced ? 2 : 1 });
        break;

      case 'matchStarted':
        sfx('shuffle', { gain: 0.6 });
        break;

      case 'cardPlayed':
        // My own card sounds as it leaves my hand; an opponent's sounds as it
        // LANDS, which the game plays from the director's end-of-beat
        // (see `landingSound`) — a face-down card in flight makes no noise.
        if (e.seat === mySeat) {
          sfx('play');
          buzz('play');
        }
        break;

      case 'trickWon': {
        const mine = teamOf(e.seat) === teamOf(mySeat);
        // The last trick closes the deal and carries its own ten points: its
        // own sound. An ordinary trick sweeps a shade lower when it is theirs.
        // Under either, the whoosh of the four cards leaving: its 250 ms rise
        // meets the sweep's hold, so its peak is the moment they move.
        sfx('sweep', { gain: 0.8 });
        if (e.isLastTrick) sfx('lastTrick');
        else sfx('trick', { rate: mine ? 1 : 0.85 });
        if (mine) buzz(e.isLastTrick ? 'lastTrickMine' : 'trickMine');
        break;
      }

      // Bidding: a pass knocks on the table, a call is its own marimba pair
      // (the zvanja call used to stand in for it), kontra is a challenge.
      case 'bidPassed':
        sfx('knock');
        break;

      case 'doublePassed':
        sfx('knock', { gain: 0.6 });
        break;

      case 'bidCalled':
        sfx('call');
        if (e.seat === mySeat) buzz('trumpMine');
        break;

      case 'doubled':
        sfx('kontra', { rate: e.multiplier === 4 ? 1.12 : 1 });
        buzz(teamOf(e.seat) === teamOf(mySeat) ? 'kontraUs' : 'kontraThem');
        break;

      case 'handsCompleted':
        // The talon: two slides.
        sfx('talon');
        break;

      case 'declared': {
        // The bigger the zvanje, the higher the call: 20 / 50 / 100 / 150+.
        const sum = e.declarations.reduce((a, d) => a + d.value, 0);
        const weight = sum >= 150 ? 4 : sum >= 100 ? 3 : sum >= 50 ? 2 : 1;
        sfx('zvanje', { rate: 1 + (weight - 1) * 0.06 });
        if (e.seat === mySeat) tally.zvanja += e.declarations.length;
        break;
      }

      case 'declarationsRevealed':
        // The cards going up; the row plays its own coming-down.
        sfx('reveal');
        break;

      case 'belaCalled':
        sfx('bela');
        if (e.seat === mySeat) {
          tally.bela = true;
          buzz('belaMine');
        }
        break;

      case 'dealScored': {
        const mine = teamOf(mySeat);
        const theirs = mine === 0 ? 1 : 0;
        const won = e.result.finalScore[mine] > e.result.finalScore[theirs];
        // The win / lose stinger plays at the END of the beat, with the sheet
        // (see `landingSound`); a štiglja announces itself as the beat starts.
        if (e.result.valatTeam !== null) {
          sfx('stiglja');
          buzz(e.result.valatTeam === mine ? 'stigljaUs' : 'stigljaThem');
        }
        const r = applyDealOutcome(
          next,
          {
            won,
            points: e.result.finalScore[mine],
            zvanjaCalled: tally.zvanja,
            belaCalled: tally.bela,
            valat: e.result.valatTeam === mine,
            autoZvanja,
          },
          today,
        );
        next = r.profile;
        earned = mergeAward(earned, r.award);
        break;
      }

      case 'matchOver': {
        // The fanfare is at the END of the beat (see `landingSound`); here
        // only the outcome is applied.
        const won = e.winner === teamOf(mySeat);
        const r = applyMatchOutcome(next, won, { target, today });
        next = r.profile;
        earned = mergeAward(earned, r.award);
        break;
      }

      default:
        break;
    }
  }

  // The coins sound one by one as they fly to the wallet, and a level-up
  // plays with the badge — both from the screens, off the award, once the
  // sheet is up. Nothing dings here, under the stinger or the fanfare.
  return { profile: next, award: earned };
}
