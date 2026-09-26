import type { Action, PublicView, Seat } from '@belot/engine';
import type { TableEvent } from '@belot/table';

/**
 * The wire protocol, in one file so the client and the room cannot drift.
 *
 * The shape enforces the security property: a client is only ever sent its OWN
 * `PublicView`, produced by the same `publicView()` the leak tests cover. Room
 * state is never broadcast, so opponents' cards have no path onto the wire.
 * Events ARE broadcast, and are safe by construction: a played card is public,
 * and a declaration carries value/length/top rank but never its cards.
 */

export const ROOM_NAME = 'bela';
/**
 * The room apps that know the three versions ask for (1.4.3 on). Quick play
 * matches by room name, so an older app - which knows only `hard`, and would
 * read a Lagana table's `hard: true` as Prava bela, free taps and all - never
 * sits down at a newer app's quick-play table, and keeps the quick play it
 * always had: zvanja announced (`learn`). A code reaches a table under
 * either name.
 */
export const ROOM_NAME_MODES = 'bela-modes';

/** Client -> server. */
export type ClientMessage =
  | { type: 'action'; action: Action }
  /** Host only (seat 0): start now, empty seats play as bots. */
  | { type: 'start' }
  /** Pre-start only: move to a free seat (how friends pick teams). */
  | { type: 'sit'; seat: Seat }
  /**
   * Ready for the next deal. It starts when every connected player is ready,
   * or by itself when NEXT_DEAL_MS has run out - never on one player's press.
   */
  | { type: 'next' }
  /** A quick emote; relayed, rate-limited, never stored. */
  | { type: 'emote'; id: string }
  /**
   * A table gift from the fixed catalogue, to one other seat or to everyone
   * else at the table. Relayed and rate-limited; the room remembers each
   * seat's latest gift so a reconnect sees it. Coins never reach the server:
   * the sender's device pays, and the receiver gains nothing.
   */
  | { type: 'gift'; id: string; to: Seat | 'table' }
  /**
   * Push-to-talk: a recorded clip (VOICE_MIMES, at most VOICE_MAX_MS and
   * VOICE_MAX_BYTES), relayed to the others at the table and never stored.
   */
  | { type: 'voice'; ms: number; mime: string; data: Uint8Array; loudness?: number }
  /**
   * The player switched voice messages off (or on again) in the app's
   * Settings while at the table: clips stop coming to this app, and its own
   * are not taken, until it says otherwise. At a join it is `voice` itself.
   */
  | { type: 'hears'; on: boolean }
  /**
   * At a PUBLIC table: this player wants strangers' clips at this table (1.6.0).
   * Without it nothing is relayed to the seat - an older app, which cannot say
   * it, is sent nothing at a public table. Private tables ignore it.
   */
  | { type: 'voiceIn'; on: boolean }
  /**
   * A clip this app was sent has started playing here (VoiceMessage `id`):
   * the room tells its speaker who heard it. Sent once per clip, by an app
   * that joined with `receipts: true`, never for a muted or hidden speaker.
   */
  | { type: 'heard'; id: number }
  /** After MATCH_OVER: this seat wants another match with the same people. */
  | { type: 'rematch' }
  /** Withdraw that ask. */
  | { type: 'rematchCancel' }
  /** Host only, after MATCH_OVER: start now, bots filling anyone who left. */
  | { type: 'rematchStart' }
  /** Private tables, during a match: stop the table for everyone (a call, a break). */
  | { type: 'pause' }
  /** Anyone at the table: carry on after a pause. */
  | { type: 'resume' }
  /** Stop waiting for a dropped player: a bot holds their cards until they are back. */
  | { type: 'playOn' }
  /** Host, private table, before the start: the turn clock in seconds (one of TURN_CHOICES). */
  | { type: 'clock'; seconds: number }
  /**
   * Host, private table, before the start: how long the match runs (one of
   * MATCH_TARGETS) and whether it is Prava bela. Either may be left out.
   */
  | { type: 'rules'; target?: number; mode?: PlayMode; hard?: boolean; voice?: boolean }
  /**
   * Private tables: this player's app went to the background - a phone call
   * that did not drop the connection. The table waits for them exactly as for
   * a dropped one, instead of letting the turn clock play their cards.
   */
  | { type: 'away' }
  /** ...and is back. */
  | { type: 'back' };

/** Turn clocks a private table's host may choose, in seconds. Quick play keeps the first. */
export const TURN_CHOICES: readonly number[] = [30, 60, 90];

/**
 * Match lengths a private table's host may choose. Quick play keeps the last:
 * 1001, the full game, the same for every stranger.
 */
export const MATCH_TARGETS: readonly number[] = [501, 701, 1001];

/**
 * The three versions of the game (the app's playMode.ts keeps the same list,
 * cross-checked by a test). Each is a set of the engine's own switches:
 *  - learn (Učenje): zvanja announced to their holder, a wrong card refused;
 *  - easy (Lagana): zvanja blind - the player finds them - a wrong card refused;
 *  - hard (Prava bela): zvanja blind, and a wrong card is a renons.
 * Quick play is always `easy`; a private table's host picks.
 */
export type PlayMode = 'learn' | 'easy' | 'hard';
export const PLAY_MODES: readonly PlayMode[] = ['learn', 'easy', 'hard'];

export function isPlayMode(x: unknown): x is PlayMode {
  return x === 'learn' || x === 'easy' || x === 'hard';
}

/**
 * An app from before the three versions sends and reads only `hard`. Its
 * not-hard tables were the rules `learn` keeps (zvanja announced), so that is
 * what `hard: false` means from it.
 */
export function modeFromLegacy(hard: unknown): PlayMode | null {
  return hard === true ? 'hard' : hard === false ? 'learn' : null;
}

/**
 * How long a scored deal's sheet stays up before the next deal starts by
 * itself: ten seconds to read it, plus the three the app spends showing the
 * last trick land before the sheet appears (the clock starts when the deal is
 * scored, and players were getting about seven).
 */
export const NEXT_DEAL_MS = 13_000;

/**
 * How long a private table stands still for a player whose connection dropped
 * - a phone call, a tunnel - before a bot takes their cards. Anyone at the
 * table can stop waiting sooner (playOn).
 */
export const WAIT_FOR_DROPPED_MS = 10 * 60_000;

/** The longest a pause lasts before the table carries on by itself. */
export const PAUSE_MAX_MS = 30 * 60_000;

/** A private table standing still, and why. */
export interface HoldInfo {
  /** A player paused it; it carries on by itself when msLeft runs out. */
  paused?: { by: Seat; msLeft: number };
  /** Players whose connection dropped, each with how long they are still waited for. */
  waiting: { seat: Seat; msLeft: number }[];
}

/**
 * The fixed emote vocabulary. Anything else is dropped server-side, so free
 * text can never transit the room (no UGC obligations). Keep in step with
 * `apps/mobile/src/emotes.ts`, which owns how each id is rendered.
 */
export const EMOTE_IDS: readonly string[] = [
  'smile', 'laugh', 'wow', 'cry', 'clap', 'think',
  'bravo', 'brze', 'ajme', 'hvala',
  // An older app draws nothing for an id it does not know (emoteText is '').
  'dobro', 'ups', 'idemo',
];

/** Minimum gap between one seat's emotes. */
export const EMOTE_GAP_MS = 2500;

/**
 * The fixed gift vocabulary. Keep in step with `GIFT_IDS` in
 * `@belot/progression`, which owns prices and levels (a mobile test fails if
 * the two drift). The server needs only the ids: it never sees a wallet.
 */
export const GIFT_IDS: readonly string[] = [
  'kava', 'caj', 'limunada', 'rakija', 'pivo', 'gemist', 'burek', 'kolac',
  'sladoled', 'maramice', 'ruza', 'djetelina', 'potkova', 'pehar', 'kruna',
];

/**
 * Minimum gap between one connection's gifts. The client waits a second
 * longer, so network jitter never drops a gift somebody has already paid for.
 */
export const GIFT_GAP_MS = 7000;

/**
 * Client -> server join options, beyond name and avatar: an app that draws
 * table gifts says so. Older apps send nothing, and are never sent a gift.
 */
export interface JoinGifts {
  gifts?: boolean;
}

/**
 * Push-to-talk voice messages. A clip is recorded on the phone while a button
 * is held, sent whole, relayed by the room to the others at the table and
 * dropped: nothing stores, decodes or logs it. On at every table; a private
 * table's host may switch it off before the start.
 */
export const VOICE_MAX_MS = 15_000;
/** The app records ~24 kbps (15 s is ~45 KB); the rest is room for a browser's recorder. */
export const VOICE_MAX_BYTES = 64 * 1024;
/** Less than this is no recording at all (an MP4 header alone is a few hundred bytes). */
export const VOICE_MIN_BYTES = 256;
/** What the recorders write: AAC in MP4 (Android, most browsers) and Opus in WebM (Firefox). */
export const VOICE_MIMES: readonly string[] = ['audio/mp4', 'audio/webm'];
/**
 * The transport's frame limit. Everything else a client sends is a few hundred
 * bytes; the default (4 KB) closed the socket of anyone sending a clip.
 */
export const MAX_FRAME_BYTES = 96 * 1024;

/**
 * The wire's generation. An app says `proto` (and its `appVersion`) when it
 * joins; the room refuses anything under MIN_PROTO with UPDATE_APP_CODE. An
 * app from before this handshake (1.5.1 and older) sends nothing and counts
 * as generation 0, so MIN_PROTO stays 0 until a server can no longer serve
 * those apps (the plan's R6a) and they are under 1% of installs.
 */
export const PROTO = 1;
export const MIN_PROTO = 0;
/** Refused at the door: the app is too old for this server. */
export const UPDATE_APP_CODE = 4301;
/** A public table where somebody has blocked you, or you them (1.6.0): the app tries another table. */
export const BLOCKED_CODE = 4302;
/** This installation is on the config's ban list (config.ts). */
export const BANNED_CODE = 4303;
/** The server is closed for a moment (config.ts maintenance); tables already playing go on. */
export const MAINTENANCE_CODE = 4304;
/**
 * An install ID: 32 hex digits the app made at random, once
 * (apps/mobile/src/identity.ts). The digest a seat shows for it (identity.ts
 * publishedId), and so every block and ban entry, has the same shape.
 */
export const INSTALL_ID_RE = /^[0-9a-f]{32}$/;
/** A block list longer than this is truncated at the door. */
export const BLOCK_LIST_MAX = 200;
/**
 * What an app says about itself at the door (1.6.0), beside its name: a random
 * install ID, and the IDs the tables showed for the players it has blocked.
 * Processed in memory only - a public table never seats two people who have
 * blocked each other, and no clip, emote or gift crosses a block anywhere.
 * Never stored, never published: a seat shows only a one-way digest of the
 * install ID (SeatInfo.installId).
 */
export interface JoinIdentity {
  installId?: string;
  blocked?: string[];
}
export interface JoinProto {
  proto?: number;
  appVersion?: string;
}

/**
 * Client -> server join option: this app can play and record voice clips
 * (present at all), and its player has them on (true). Older apps send
 * nothing and are never sent a clip.
 */
export interface JoinVoice {
  voice?: boolean;
  /**
   * The app confirms the clips it plays ('heard') and reads the room's
   * confirmations of its own (MSG.voiceHeard). Apps before 1.5.1 do neither:
   * a speaker is told which of the recipients cannot confirm.
   */
  receipts?: boolean;
}

/**
 * Server -> the others at the table: a clip, with the seat that spoke. The
 * sender gets the same message without `data`, when the room has taken it.
 */
export interface VoiceMessage {
  from: Seat;
  id: number;
  ms: number;
  mime: string;
  data?: Uint8Array;
  /** The sender's average level while recording, dBFS, -60..0 (1.6.0): the listener's app levels the clip by it. */
  loudness?: number;
  /** The speaker's echo only: every seat the clip went to (empty: nobody at the table can hear it). */
  to?: Seat[];
  /** The speaker's echo only: those of `to` whose apps cannot confirm (omitted when none). */
  noReceipt?: Seat[];
}

/** Server -> a speaker whose app joined with `receipts`: clip `id` has started playing at seat `by`. */
export interface VoiceHeardMessage {
  id: number;
  by: Seat;
}

/** Server -> everyone: a gift was given. A table gift is ONE message. */
export interface GiftMessage {
  from: Seat;
  to: Seat[];
  id: string;
}

/** Server -> everyone: someone emoted. */
export interface EmoteMessage {
  seat: Seat;
  id: string;
}

export interface SeatInfo {
  /**
   * A one-way digest of the install ID this seat's app gave at its join (1.6.0,
   * identity.ts publishedId): the handle a block, a report and a ban name.
   * Opaque, and no use as an ID of one's own - the door would hash it again;
   * absent for bots and older apps.
   */
  installId?: string;
  seat: Seat;
  name: string;
  /** Preset avatar id chosen client-side; empty string when none was sent. */
  avatar: string;
  connected: boolean;
  /** True while a bot is standing in for a dropped player. */
  bot: boolean;
  /** The latest gift given to this seat, while its player stays; absent when none. */
  gift?: string;
  /**
   * This seat can be given a gift: its player's app draws them (it joined
   * with `gifts: true`), or no person sits there. Absent for an older app,
   * which never sees one — the room drops such a seat from every gift, so
   * nobody pays for a present its receiver cannot see.
   */
  seesGifts?: true;
  /** This seat's player has an app that plays voice clips (it joined with `voice: true`). */
  hearsVoice?: true;
}

/** Server -> one client: everything that seat is entitled to see. */
export interface ViewMessage {
  seat: Seat;
  view: PublicView;
}

/** Server -> everyone: what just happened, and who is at the table. */
export interface RoomMessage {
  seats: SeatInfo[];
  /** 'waiting' until four seats are filled. */
  status: 'waiting' | 'playing' | 'finished';
  events: TableEvent[];
  /** Milliseconds left for the seat on turn, when a timer is running. */
  turnMsLeft?: number;
  /** Full length of a turn, so the client's ring scales correctly. */
  turnTotalMs?: number;
  /** The version played: Učenje, Lagana or Prava bela. */
  mode?: PlayMode;
  /**
   * For apps from before the three versions: true whenever zvanja are blind
   * (Lagana and Prava bela), so such an app asks its player to find them
   * instead of answering "Nemam" for them.
   */
  hard?: boolean;
  /** Seat of the table's creator — the one who may start with bots. */
  hostSeat?: Seat;
  /** Matches won per team since this roster sat down. */
  series: [number, number];
  /** Matches finished at this table (0 during the first). */
  matchNumber: number;
  /** Seats that have asked for another match. Only meaningful at MATCH_OVER. */
  rematchVotes?: Seat[];
  /** The table's turn clock in seconds; a private table's host may change it before the start. */
  turnSeconds?: number;
  /** Points the match is played to; a private table's host may change it before the start. */
  target?: number;
  /** A private table (friends, by code): only there does it pause and wait. */
  private?: true;
  /** Voice messages are on at this table (quick play always; a private table's host may switch them off). */
  voice?: true;
  /** Present while the table stands still: paused, or waiting for a dropped player. */
  hold?: HoldInfo;
  /** At DEAL_OVER: milliseconds until the next deal starts by itself. */
  nextMsLeft?: number;
  /** At DEAL_OVER: the seats that are ready for the next deal. */
  nextVotes?: Seat[];
  /**
   * A public table with voice on: clips reach only the seats that sent `voiceIn`
   * (1.6.0). The app asks its player once, at the table, before saying so.
   */
  voiceOptIn?: true;
}

export const MSG = {
  view: 'view',
  room: 'room',
  error: 'error',
  emote: 'emote',
  gift: 'gift',
  voice: 'voice',
  voiceHeard: 'voiceHeard',
} as const;
