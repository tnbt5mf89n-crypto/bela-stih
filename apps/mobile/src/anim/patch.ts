import type { DealProgress, PublicView, Seat, TeamId } from '@belot/engine';
import { cardId, teamOf } from '@belot/engine';
import type { TableEvent } from '@belot/table';

/**
 * Pure per-event patches over a presentation `PublicView`.
 *
 * The animation director renders a view that lags the authoritative one, and
 * these functions advance it one event at a time. They are not a parallel game
 * model: everything they compute is either carried by the event itself
 * (dealer, trump, declarations, scores, played cards) or adopted verbatim from
 * the batch's authoritative `finalView` (my own hand at reveal moments, the
 * scored deal's history). At the end of every batch the director
 * hard-replaces the whole view with `finalView`, so any error here degrades
 * to a one-frame pop, never to a gameplay bug.
 *
 * Intermediate views always carry `toAct: null` and `legalActions: []` — while
 * a drain is playing out, no prompt and no playable card can appear, by
 * construction.
 *
 * Two-phase commit: `applyEventStart` runs when an event's animation begins
 * (a played card leaves its hand), `applyEventEnd` when it lands (the card
 * joins the trick). Between the two, the card exists only as an overlay sprite.
 */

/** Fields that stay suppressed on every intermediate view. */
export function suppress(view: PublicView): PublicView {
  return {
    ...view,
    toAct: null,
    legalActions: [],
    // The asking is an input like any other: leaving declareTurn set mid-drain
    // kept "Prijavi"/"Nemam" armed and the hand in marking mode while the table
    // was still animating somebody else's answer.
    declareTurn: null,
    mustDeclare: false,
    canDeclare: false,
    canAnnounceBela: false,
  };
}

/** The part of the live counter that only tricks can move. */
interface TrickPart {
  tricksPlayed: number;
  cardPoints: [number, number];
  tricksWon: [number, number];
  lastTrickTeam: TeamId | null;
  valatPossible: [boolean, boolean];
}

const NO_TRICKS: TrickPart = {
  tricksPlayed: 0,
  cardPoints: [0, 0],
  tricksWon: [0, 0],
  lastTrickTeam: null,
  valatPossible: [true, true],
};

function trickPartOf(p: DealProgress): TrickPart {
  return {
    tricksPlayed: p.tricksPlayed,
    cardPoints: [...p.cardPoints],
    tricksWon: [...p.tricksWon],
    lastTrickTeam: p.lastTrickTeam,
    valatPossible: [...p.valatPossible],
  };
}

/**
 * Rebuild the counter from tricks-so-far plus the deal's static parts (pot,
 * target, zvanja, bela — all carried on the payload). Exact without the engine
 * config, which is precisely why `DealProgress` ships `target` and
 * `lastTrickBonus`: the arithmetic below mirrors `computeDealProgress`.
 */
function recount(part: TrickPart, statics: DealProgress): DealProgress {
  const running: [number, number] = [0, 1].map((t) =>
    part.cardPoints[t]! +
    (part.lastTrickTeam === t ? statics.lastTrickBonus : 0) +
    statics.declarationPoints[t]! +
    statics.bela[t]!,
  ) as [number, number];

  const remaining =
    152 -
    part.cardPoints[0] -
    part.cardPoints[1] +
    (part.lastTrickTeam === null ? statics.lastTrickBonus : 0);

  return {
    ...statics,
    ...part,
    running,
    callerNeeds: Math.max(0, statics.target - running[statics.callerTeam]),
    callerSafe: running[statics.callerTeam] >= statics.target,
    callerDoomed: running[statics.callerTeam] + remaining < statics.target,
  };
}

/**
 * Adopt the deal's static parts from the authoritative view while keeping the
 * tricks this drain has actually shown — the same trick `hand` and
 * `myDeclarations` already use. Zvanja and bela can only be settled by the
 * engine (the contest gives the loser nothing), so they are taken, never
 * derived; the trick tally stays local so the counter cannot run ahead of the
 * cards the player is still watching fly.
 */
function syncProgress(view: PublicView, finalView: PublicView): DealProgress | null {
  const statics = finalView.dealProgress;
  if (!statics) return null;
  return recount(view.dealProgress ? trickPartOf(view.dealProgress) : NO_TRICKS, statics);
}

/** Advance the counter by one trick, using the points the event already carries. */
function bumpProgress(p: DealProgress, team: TeamId, points: number, isLast: boolean): DealProgress {
  const part = trickPartOf(p);
  part.tricksPlayed += 1;
  part.cardPoints[team] += points;
  part.tricksWon[team] += 1;
  if (isLast) part.lastTrickTeam = team;
  part.valatPossible[(1 - team) as TeamId] = false;
  if (isLast) part.valatPossible[team] = false;
  return recount(part, p);
}

export function applyEventStart(view: PublicView, e: TableEvent, mySeat: Seat): PublicView {
  switch (e.kind) {
    case 'declarationsRevealed':
      // At the START of the beat, so the cards are up for the whole hold rather
      // than appearing as it ends — the table was freezing blank for five
      // seconds and then playing on underneath them.
      return suppress({ ...view, revealedDeclarations: e.declarations });

    case 'dealStarted':
      // The moment the deal begins, the table is swept clean: last deal's
      // trump, calls and trick vanish while the new backs fly. The cards
      // themselves arrive in `applyEventEnd`.
      return suppress({
        ...view,
        revealedDeclarations: [],
        phase: 'BID',
        dealer: e.dealer,
        seat: mySeat,
        hand: [],
        handCounts: [0, 0, 0, 0],
        context: { contractType: 'SUIT', trumpSuit: null },
        callerSeat: null,
        multiplier: 1,
        trickLeader: null,
        currentTrick: [],
        announcedDeclarations: [],
        myDeclarations: [],
        belaAnnouncedBy: null,
        dealProgress: null,
      });

    case 'matchStarted':
      // Scores back to nil; the dealStarted that follows sweeps the table.
      return suppress({ ...view, phase: 'IDLE', matchScores: [0, 0], dealProgress: null });

    case 'cardPlayed': {
      const handCounts = [...view.handCounts] as PublicView['handCounts'];
      handCounts[e.seat] = Math.max(0, handCounts[e.seat] - 1);
      return suppress({
        ...view,
        handCounts,
        hand:
          e.seat === mySeat
            ? view.hand.filter((c) => cardId(c) !== cardId(e.card))
            : view.hand,
      });
    }
    case 'trickWon':
      // The four cards leave the slots the moment the sweep starts: from here
      // the sprite carries them to the winner. Clearing at the END left the
      // real faces standing still under the flying backs, then snapping away.
      return suppress({ ...view, currentTrick: [] });
    default:
      return suppress(view);
  }
}

export function applyEventEnd(
  view: PublicView,
  e: TableEvent,
  finalView: PublicView,
  mySeat: Seat,
): PublicView {
  switch (e.kind) {
    case 'dealStarted':
      // The table was swept in `applyEventStart`; now the cards land. Six
      // each: the engine deals six and later APPENDS the talon pair, and
      // `publicView` never re-sorts — so the first six of the authoritative
      // hand are exactly the bid-time cards. The remaining two arrive with
      // `handsCompleted`, like the real second wave.
      return suppress({
        ...view,
        hand: finalView.hand.slice(0, 6),
        handCounts: [6, 6, 6, 6],
      });

    case 'bidCalled':
      return suppress({
        ...view,
        // The engine moves BID -> DOUBLE on a call. Nothing branches on it
        // today because kontra is off by default, but leaving the mirror in
        // 'BID' would misrender every doubling frame the day it is enabled.
        phase: 'DOUBLE',
        context: { contractType: 'SUIT', trumpSuit: e.suit },
        callerSeat: e.seat,
      });

    case 'doubled':
      return suppress({ ...view, multiplier: e.multiplier });

    case 'handsCompleted':
      return suppress({
        ...view,
        phase: 'PLAY',
        context: { contractType: 'SUIT', trumpSuit: e.trumpSuit },
        callerSeat: e.callerSeat,
        multiplier: e.multiplier,
        handCounts: [8, 8, 8, 8],
        hand: finalView.hand.length >= view.hand.length ? finalView.hand : view.hand,
        myDeclarations: finalView.myDeclarations,
        trickLeader: ((view.dealer + 1) % 4) as Seat,
        dealProgress: syncProgress(view, finalView),
      });

    case 'declared':
      return suppress({
        ...view,
        announcedDeclarations: [...view.announcedDeclarations, ...e.declarations],
        dealProgress: syncProgress(view, finalView),
      });

    case 'belaCalled':
      return suppress({
        ...view,
        belaAnnouncedBy: e.seat,
        dealProgress: syncProgress(view, finalView),
      });

    case 'cardPlayed':
      return suppress({
        ...view,
        currentTrick: [...view.currentTrick, { seat: e.seat, card: e.card }],
      });

    case 'trickWon':
      // The slots were cleared at the start; the sweep has landed by now.
      return suppress({
        ...view,
        trickLeader: e.seat,
        // Always count the trick. The tally is local and purely additive, and
        // syncProgress() deliberately KEEPS it while adopting only the statics
        // — so a bump skipped here is never recovered, and the counter sits a
        // whole trick light for the rest of the deal. Whether the zvanja have
        // settled affects the target, not how many points the trick was worth.
        dealProgress: view.dealProgress
          ? bumpProgress(view.dealProgress, teamOf(e.seat), e.points, e.isLastTrick)
          : view.dealProgress,
      });

    case 'dealScored':
      return suppress({
        ...view,
        phase: 'DEAL_OVER',
        matchScores: e.matchScores,
        dealProgress: null,
        // The engine rotates the dealer as part of scoring the deal.
        dealer: ((view.dealer + 1) % 4) as Seat,
        // The sheet, and "Pregled ruke" on it, come up on this frame: the
        // scored deal's tricks, verbatim from the authoritative view. The
        // history carried from the batch's start lacks the trick this batch
        // finished, and on a match's last deal the matchOver beat (~900 ms)
        // still runs before the terminal sync brings it. Only a settled
        // finalView holds this deal's; a batch that ran on into the next deal
        // keeps the history it has.
        ...(finalView.phase === 'DEAL_OVER' || finalView.phase === 'MATCH_OVER' ? { history: finalView.history } : {}),
      });

    case 'matchOver':
      return suppress({
        ...view,
        phase: 'MATCH_OVER',
        matchScores: e.matchScores,
      });

    // bidPassed, doublePassed, declarationSkipped: bubbles only, no state.
    default:
      return suppress(view);
  }
}
