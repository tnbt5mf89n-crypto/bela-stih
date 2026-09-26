import type { PublicView, Seat, Suit } from '@belot/engine';
import { cardId, SEATS, teamOf } from '@belot/engine';
import type { TableEvent } from '@belot/table';
import type { Lang } from '@belot/i18n';
import type { AnchorMap } from '../anim/AnchorRegistry';
import type { XY } from '../anim/FxBus';
import { TEMPO_FACTOR, timingsFor, type Tempo } from '../anim/director';
import { anchorId, metaId, type FxBus } from '../anim/FxBus';
import {
  BACK_SCALE,
  DEALER_BADGE,
  dealStagger,
  FADE_BUBBLE_MS,
  FADE_FLIGHT_MS,
  FALLBACK_CARD_W,
  flightDuration,
  GIFT_FLIGHT_SIZE,
  GIFT_FLY_MS,
  LAST_TRICK_CHIP_MS,
} from '../anim/lifetimes';
import { hasEmoteFace } from '../emoteIds';
import { emoteText, isGlyphEmote } from '../emotes';
import { declarationWeight } from './cues';
import { cardWidthForHeight, fitHand, MAX_CARD_W } from './geometry';
import { giftBadgeBox } from './metrics';

/**
 * Maps table events to sprites. Shared by the offline and online screens, so a
 * played card looks identical whether the engine ran on-device or on the
 * server.
 *
 * Any missing anchor simply skips the sprite — the director has already
 * committed the state change; decoration must never gate correctness.
 *
 * Every sprite carries the director's current `speed` and the measured card
 * width at its destination. The speed keeps a sprite inside the beat it fills
 * when the director runs at half pace with a batch waiting, or at the player's
 * "Tempo igre"; the width keeps a flight the size of the card it becomes, so
 * nothing pops on landing.
 */

export interface FxSpawnerOptions {
  anchors: AnchorMap;
  bus: FxBus;
  lang: Lang;
  /** The viewer's seat: their own card flies face up from the tap. */
  mySeat: () => Seat | null;
  /** Reduce-motion: fades in place of flights, and no burst or shake. */
  reduced?: () => boolean;
  /**
   * Settings' "Tempo igre", read at every spawn. The director stretches or
   * tightens its beats by it (timingsFor), so every sprite must too, or the
   * deal's backs fade before a slow deal's cards mount and still fly over a
   * fast one's. Without it, the normal tempo.
   */
  tempo?: () => Tempo;
  /**
   * The presentation view as it stands when an event STARTS — before the
   * director's start patch. The trick sweep reads the four cards on the felt
   * from it, since the `trickWon` event itself names only the winner.
   */
  view: () => PublicView | null;
}

/** An emote thrown across the table: a bubble over the sender's seat. */
export function spawnEmote(
  opts: { anchors: AnchorMap; bus: FxBus; lang: Lang; reduced?: () => boolean },
  seat: Seat,
  id: string,
): void {
  const text = emoteText(opts.lang, id);
  const at = opts.anchors.centre(anchorId.seat(seat));
  if (!text || !at) return;
  opts.bus.emit({
    kind: 'bubble',
    at,
    text,
    tone: 'plain',
    duration: 1800,
    speed: 1,
    big: isGlyphEmote(id),
    // The six faces are drawn; a phrase is its text.
    art: hasEmoteFace(id) ? id : undefined,
    // Reduce-motion: no pop, just there and then not.
    fade: opts.reduced?.() ?? false,
  });
}

/**
 * A seat's puck, measured. My own puck is `puck(mySeat)` (my seat anchor is
 * the hand, the fallback before my puck has reported); every other puck
 * registers as `seat(s)`. Never `puck ?? seat` for the others: anchors are not
 * forgotten on unmount, and online the lobby's seat map registered `puck(s)`
 * for every seat — a lookup that tried it first found where the lobby drew
 * that player, not where the table does.
 */
export function puckRect(anchors: AnchorMap, seat: Seat, mySeat: Seat | null) {
  if (seat === mySeat) return anchors.rect(anchorId.puck(seat)) ?? anchors.rect(anchorId.seat(seat));
  return anchors.rect(anchorId.seat(seat));
}

/** Where a seat's puck wears its gift, in window space, and the badge's size. */
export function giftBadgeAt(
  anchors: AnchorMap,
  seat: Seat,
  mySeat: Seat | null,
): { x: number; y: number; d: number } | null {
  // My hand is no place for a badge: only my measured puck will do.
  const r = seat === mySeat ? anchors.rect(anchorId.puck(seat)) : puckRect(anchors, seat, mySeat);
  if (!r) return null;
  const b = giftBadgeBox(r.w - 10);
  return { x: r.x + b.left + b.d / 2, y: r.y + b.top + b.d / 2, d: b.d };
}

/**
 * A gift flying from one puck to another's badge spot. False when either
 * puck is not measured: the caller then just shows the badge — decoration
 * never gates the state.
 */
export function spawnGift(
  opts: { anchors: AnchorMap; bus: FxBus },
  from: Seat,
  to: Seat,
  id: string,
  mySeat: Seat | null,
): boolean {
  const a = puckRect(opts.anchors, from, mySeat);
  const b = giftBadgeAt(opts.anchors, to, mySeat);
  if (!a || !b) return false;
  opts.bus.emit({
    kind: 'gift',
    gift: id,
    from: { x: a.x + a.w / 2, y: a.y + a.h / 2 },
    to: { x: b.x, y: b.y },
    duration: GIFT_FLY_MS,
    size: GIFT_FLIGHT_SIZE,
    landSize: b.d,
  });
  return true;
}

export function makeFxSpawner(opts: FxSpawnerOptions) {
  const { anchors, bus, lang, view } = opts;
  const mySeatOf = opts.mySeat;
  const isReduced = opts.reduced ?? (() => false);
  /** The beats as the policy in force paces them: a sprite fills the beat it will actually get. */
  const beats = () => timingsFor(isReduced() ? 'reduced' : 'full');
  /**
   * The pace a sprite runs at: the director's own (1, or 0.5 with a batch
   * waiting) times the tempo's factor. Applied once, where the director's
   * pace comes in (the return below), and `beats()` above stays at the
   * normal tempo: a beat times its speed is then the beat the director really
   * runs, never stretched twice.
   */
  const paced = (pace: number): number => pace * (TEMPO_FACTOR[opts.tempo?.() ?? 'normal'] ?? 1);

  /** The width of a card sitting in this seat's slot, or the fallback before the first layout. */
  const slotW = (seat: Seat): number => anchors.rect(anchorId.slot(seat))?.w ?? FALLBACK_CARD_W;
  /**
   * Where a seat's puck draws its dealer badge: 2 px outside its ring's
   * top-left corner. My own seat anchor is the hand, so my puck is asked for
   * by its own id — the hop once set off from the fan's corner — and the
   * others by theirs (see puckRect: online, `puck(s)` is the lobby's).
   */
  const dealerBadgeAt = (seat: Seat): XY | null => {
    const r = puckRect(anchors, seat, mySeatOf());
    if (!r) return null;
    return { x: r.x - 2 + DEALER_BADGE / 2, y: r.y - 2 + DEALER_BADGE / 2 };
  };
  /** Any measured slot will do for a sprite that is not bound to one seat. */
  const anySlotW = (): number => {
    for (const s of SEATS) {
      const r = anchors.rect(anchorId.slot(s));
      if (r) return r.w;
    }
    return FALLBACK_CARD_W;
  };

  const bubble = (
    seat: Seat,
    text: string,
    tone: 'plain' | 'gold',
    duration: number,
    speed: number,
    extra: { pip?: Suit; weight?: 1 | 2 | 3 | 4 } = {},
  ) => {
    const at = anchors.centre(anchorId.seat(seat));
    if (!at) return;
    const reduced = isReduced();
    bus.emit({
      kind: 'bubble',
      at,
      text,
      tone,
      duration: (reduced ? Math.min(duration, FADE_BUBBLE_MS) : duration) * speed,
      speed,
      fade: reduced,
      ...extra,
    });
  };

  /**
   * Backs from the deck round the table, paced to fill the beat they decorate.
   * Each opponent gets one back a round; MY seat gets one per card, on the
   * very spots the real cards will take — the same `fitHand` the hand lays
   * itself out with, from the hand block's measured rect: the first six
   * across a six-card fan, the talon's two at positions 6–7 of the eight-card
   * fan, where the re-sort will put them.
   */
  const deal = (mySeat: Seat | null, rounds: number, perRound: number, beatMs: number, speed: number) => {
    const from = anchors.centre(anchorId.deck);
    const seats = SEATS.map((s) => anchors.centre(anchorId.seat(s)));
    if (!from || seats.some((p) => p === null)) return;
    const hand = mySeat !== null ? anchors.rect(anchorId.seat(mySeat)) : null;
    const n = rounds * perRound;
    const total = perRound === 2 ? 8 : n;
    // The very numbers the hand lays itself out with (published by the
    // table); the measured block is only a fallback before the first layout.
    const fit = hand
      ? fitHand(
          anchors.meta(metaId.handWidth) ?? hand.w,
          total,
          anchors.meta(metaId.handCardMax) ?? Math.min(MAX_CARD_W, cardWidthForHeight(hand.h, total)),
          anchors.meta(metaId.handReveal) ?? undefined,
        )
      : null;
    const mine = (k: number): XY => {
      if (!hand || !fit) return seats[mySeat!]!;
      const pos = perRound === 2 ? k + 6 : k;
      const span = fit.cardW + (total - 1) * fit.advance;
      // The fan's arc: the outer cards sit lower (Hand's baseY), so the backs do too.
      const off = pos - (total - 1) / 2;
      return {
        x: hand.x + (hand.w - span) / 2 + pos * fit.advance + fit.cardW / 2,
        y: hand.y + hand.h * 0.6 + Math.pow(Math.abs(off), 1.6) * 3.2 * fit.scale,
      };
    };
    const backs: XY[] = [];
    let k = 0;
    for (let r = 0; r < rounds; r++) {
      for (const s of SEATS) {
        if (s === mySeat) for (let c = 0; c < perRound; c++) backs.push(mine(k++));
        else backs.push(seats[s]!);
      }
    }
    bus.emit({
      kind: 'deal',
      from,
      backs,
      stagger: dealStagger(backs.length, beatMs),
      beat: beatMs,
      speed,
      width: anySlotW() * BACK_SCALE,
      fade: isReduced(),
    });
  };

  /** Sprites for an event's START: the beat itself. */
  const start = (e: TableEvent, speed = 1): void => {
    const mySeat = mySeatOf();
    const reduced = isReduced();
    switch (e.kind) {
      case 'dealStarted':
        // Two rounds of three.
        deal(mySeat, 2, 3, beats().dealStarted.dur, speed);
        break;

      case 'handsCompleted':
        // The talon: after the contract, everyone receives two more cards.
        deal(mySeat, 1, 2, beats().handsCompleted.dur, speed);
        break;

      case 'cardPlayed': {
        const mine = e.seat === mySeat;
        // My own card sets off from where I tapped it, at the fan's size; the
        // rect was measured at press time and is read exactly once.
        const tapped = mine ? anchors.rect(anchorId.card(cardId(e.card))) : null;
        if (tapped) anchors.delete(anchorId.card(cardId(e.card)));
        const from = tapped
          ? { x: tapped.x + tapped.w / 2, y: tapped.y + tapped.h / 2 }
          : anchors.centre(anchorId.seat(e.seat));
        const to = anchors.centre(anchorId.slot(e.seat));
        if (from && to) {
          bus.emit({
            kind: 'flight',
            card: e.card,
            from,
            to,
            duration: (reduced ? FADE_FLIGHT_MS : flightDuration(Math.hypot(to.x - from.x, to.y - from.y))) * speed,
            speed,
            // An opponent's card leaves their hand face down and turns over
            // in flight, the way a card is actually thrown on the table.
            faceUp: mine || reduced,
            width: slotW(e.seat),
            fromWidth: tapped && !reduced ? tapped.w : undefined,
            fade: reduced,
            // The edge of the fan leans ±15°; leaving at that angle instead of a
            // fixed −8° is what keeps the card from snapping as it lifts off.
            tilt: tapped?.tilt,
          });
        }
        break;
      }

      case 'trickWon': {
        // The real four cards, in the order they were played, from the slots
        // they sit in — the director clears those slots as this beat starts,
        // so from here on the sprite is the trick.
        const trick = view()?.currentTrick ?? [];
        const cards = trick.flatMap((p) => {
          const from = anchors.centre(anchorId.slot(p.seat));
          return from ? [{ seat: p.seat, card: p.card, from }] : [];
        });
        const to = anchors.centre(anchorId.seat(e.seat));
        if (cards.length > 0 && to) {
          bus.emit({ kind: 'trickSweep', cards, to, winner: e.seat, speed, width: anySlotW(), fade: reduced });
        }
        // The last trick's ten points, from the felt to the running count.
        if (e.isLastTrick && !reduced) {
          const chipFrom = anchors.centre(anchorId.deck);
          const chipTo = anchors.centre(anchorId.running);
          if (chipFrom && chipTo) {
            bus.emit({
              kind: 'badge',
              from: chipFrom,
              to: chipTo,
              duration: LAST_TRICK_CHIP_MS * speed,
              text: '+10',
              tone: 'points',
            });
          }
        }
        break;
      }

      case 'bidPassed':
        bubble(e.seat, lang.s.pass, 'plain', 500, speed);
        break;

      case 'bidCalled':
        bubble(e.seat, `${lang.s.callsVerb} ${lang.suitName(e.suit)}`, 'plain', 900, speed, {
          pip: e.suit,
        });
        break;

      case 'doubled':
        bubble(e.seat, e.multiplier === 2 ? lang.s.kontra : lang.s.rekontra, 'gold', 900, speed);
        break;

      case 'declared':
        // In blind mode a seat may claim with nothing, and the engine answers
        // with an empty list by design. Say so — an empty string painted a
        // blank gold pill with a chime behind it, several times a deal.
        bubble(
          e.seat,
          e.declarations.length > 0
            ? e.declarations.map((d) => lang.declaration(d)).join(' · ')
            : lang.s.noZvanja,
          'gold',
          1100,
          speed,
          { weight: declarationWeight(e.declarations.map((d) => d.value)) },
        );
        break;

      case 'belaCalled': {
        bubble(e.seat, `${lang.s.bela.toUpperCase()}! (20)`, 'gold', 1000, speed);
        // Bela always counts (even when the contract fails), and the running
        // count takes it at once: its twenty fly there, as the last trick's
        // ten do. Not for zvanja, which a better one can still cancel.
        const r = puckRect(anchors, e.seat, mySeatOf());
        const chipTo = anchors.centre(anchorId.running);
        if (r && chipTo && !reduced) {
          bus.emit({
            kind: 'badge',
            from: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
            to: chipTo,
            duration: LAST_TRICK_CHIP_MS * speed,
            text: '+20',
            tone: 'points',
          });
        }
        break;
      }

      case 'dealScored': {
        // The dealer's button passes to the right as the deal is scored: the
        // engine rotates it at this beat's end, and the badge flies there over
        // the beat so the switch lands as the sprite does.
        const dealer = view()?.dealer;
        if (dealer === undefined) break;
        // From corner to corner: the puck draws its D at its ring's top-left,
        // so the hop lands exactly where the next puck's own D will appear.
        const from = dealerBadgeAt(dealer);
        const to = dealerBadgeAt(((dealer + 1) % 4) as Seat);
        if (from && to && !reduced) {
          bus.emit({ kind: 'badge', from, to, duration: beats().dealScored.dur * speed });
        }
        // Štiglja: the word itself, stamped on the felt in the sweeping side's
        // colour — a plain fade under reduce-motion, inside the short beat.
        if (e.result.valatTeam !== null) {
          const at = anchors.centre(anchorId.deck);
          const ours = mySeat !== null && teamOf(mySeat) === e.result.valatTeam;
          if (at) {
            bus.emit({ kind: 'stamp', at, text: lang.s.valat, tone: ours ? 'ok' : 'danger', speed, fade: reduced });
          }
        }
        break;
      }

      // The rest of dealScored / matchOver feedback is the result panel,
      // coins and confetti — driven by the screens off banner/winner state.
      default:
        break;
    }
  };

  /**
   * Sprites for an event's END: what lands as the beat closes, in the gap
   * that follows. Fired from the director's onEventEnd, which never fires for
   * a flushed event, at the pace the beat ran so the flourish fits the gap.
   * Nothing under reduce-motion: the plaque already shows the pip.
   */
  const end = (e: TableEvent, speed = 1): void => {
    if (isReduced()) return;
    switch (e.kind) {
      case 'trickWon': {
        // The pile has landed: the winner's puck flares, so whose trick it
        // was reads even when the sweep went by unwatched.
        const r = puckRect(anchors, e.seat, mySeatOf());
        if (r) bus.emit({ kind: 'pulse', at: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, speed });
        break;
      }
      case 'bidCalled': {
        const at = anchors.centre(anchorId.plaque);
        if (at) bus.emit({ kind: 'stamp', at, pip: e.suit, tone: 'gold', speed });
        break;
      }
      case 'doubled': {
        const at = anchors.centre(anchorId.plaque);
        if (at) bus.emit({ kind: 'stamp', at, text: `×${e.multiplier}`, tone: 'danger', speed });
        break;
      }
      default:
        break;
    }
  };

  // The director hands over its own pace; every sprite above runs at that
  // pace with the tempo folded in (see `paced`).
  return {
    start: (e: TableEvent, pace = 1): void => start(e, paced(pace)),
    end: (e: TableEvent, pace = 1): void => end(e, paced(pace)),
  };
}
