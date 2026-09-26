import { isPlayMode, type PlayMode } from './playMode';
import { Platform } from 'react-native';
import { emptyProfile, ensureQuests, isoDay, migrateProfile, type PlayerProfile } from '@belot/progression'
import { ensureInstallId, hexOf, readBlocked, readConduct, writeBlocked, writeConduct, type BlockedPlayer } from './identity';
import type { Tempo } from './anim/director';
import type { HapticStrength } from './haptics';;
import { localeFor } from './locale';
import type { MatchRecord } from './net/history';

/**
 * Local persistence.
 *
 * Deliberately the ONLY place that knows where progress lives, so moving it
 * server-side later touches this file and nothing else. Beta keeps everything on
 * the device with no account, which also keeps the Play data-safety declaration
 * honest and close to "no data collected".
 */

// react-native-mmkv v4 exposes a factory; `MMKV` is only a type now. On web the
// same two calls back onto localStorage — the try/catch keeps private-mode
// browsers (where localStorage throws) playable with in-memory defaults.
interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

const store: KV =
  Platform.OS === 'web'
    ? {
        getString: (key) => {
          try {
            return window.localStorage.getItem(`bela-stih.${key}`) ?? undefined;
          } catch {
            return undefined;
          }
        },
        set: (key, value) => {
          try {
            window.localStorage.setItem(`bela-stih.${key}`, value);
          } catch {
            /* private mode: play on, forget on reload */
          }
        },
      }
    : // eslint-disable-next-line @typescript-eslint/no-require-imports -- native-only module
      (require('react-native-mmkv') as typeof import('react-native-mmkv')).createMMKV({
        id: 'bela-stih',
      });

const KEY = {
  profile: 'profile.v1',
  settings: 'settings.v1',
  series: 'series.v1',
  history: 'history.v1',
} as const;

export type ConfirmPlay = 'off' | 'ambiguous' | 'always';
/** Animation: follow the system's reduce-motion switch, or force either way. */
/** The three volumes Settings offers; the default must be one of them, or no chip is lit. */
export const VOLUME_OPTIONS = [0.35, 0.7, 1] as const;

export type MotionSetting = 'system' | 'full' | 'reduced';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  locale: 'hr' | 'sr-Cyrl' | 'en';
  /**
   * What other players see online. Purely local — there is no account, no
   * sign-in and no server-side identity, which is what keeps the Play
   * data-safety declaration honest at "no data collected".
   */
  nickname: string;
  /**
   * The version played (playMode.ts): Učenje, Lagana or Prava bela. Offline
   * games, and the private tables this player hosts, start in it.
   */
  difficulty: PlayMode;
  /** Card face style: mađarice (default), vintage photos, French suits, or big-and-simple. */
  deckStyle: 'madarice' | 'starinske' | 'francuske' | 'simple';
  /** How the hand is laid out. 'manual' keeps whatever the player arranged. */
  handSort: 'auto' | 'suits' | 'manual';
  /** How many matches have shown the arranging tip; 2 once it is learned or said twice. */
  arrangeTips: number;
  /**
   * Misclick guard. 'ambiguous' (default) arms a card on the first tap only
   * when there is a genuine choice — a forced card still plays on one tap.
   */
  confirmPlay: ConfirmPlay;
  motion: MotionSetting;
  /** Master volume, 0–1: one of VOLUME_OPTIONS. */
  volume: number;
  /**
   * Voice messages online: the mic button, and others' clips playing by
   * themselves. Off, there is neither (a table's own switch is its host's).
   */
  voice: boolean;
  /**
   * How the mic works: held while speaking (let go sends, slide off takes it
   * back), or tapped to start and tapped again to send.
   */
  voiceMode: VoiceMode;
  /** The director's pace (anim/director.ts): the beats stretch or tighten together. */
  tempo: Tempo;
  /** "Jačina vibracije": every impact one notch lighter (notifications and selection ticks as designed), or all as designed. */
  hapticStrength: HapticStrength;
  /** "Velike karte": a bigger fan and the plain deck, for eyes that want it. */
  bigCards: boolean;
  /** "Glas": the clips' own level, 0-1, one of VOLUME_OPTIONS. */
  voiceVolume: number;
}

export type VoiceMode = 'hold' | 'tap';

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  haptics: true,
  locale: 'hr',
  nickname: '',
  difficulty: 'easy',
  deckStyle: 'madarice',
  handSort: 'auto',
  arrangeTips: 0,
  confirmPlay: 'ambiguous',
  motion: 'system',
  volume: 0.7,
  voice: true,
  voiceMode: 'hold',
  tempo: 'normal',
  hapticStrength: 'full',
  bigCards: false,
  voiceVolume: 0.7,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = store.getString(key);
    if (!raw) return fallback;
    // Merge over the default so a profile saved by an older build gains any new
    // fields instead of arriving with them undefined.
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    store.set(key, JSON.stringify(value));
  } catch {
    // A failed save must never take the game down; progress is not that precious.
  }
}

/** The stored profile, whatever app wrote it (migrateProfile), with today's quests already rolled in. */
export function loadProfile(today = isoDay(new Date())): PlayerProfile {
  let raw: unknown = null;
  try {
    const json = store.getString(KEY.profile);
    raw = json ? JSON.parse(json) : null;
  } catch {
    raw = null;
  }
  return ensureQuests(migrateProfile(raw), today);
}

export function saveProfile(profile: PlayerProfile): void {
  write(KEY.profile, profile);
}

/** The system's locale tag through Intl: Hermes has it on Android, and every browser. */
function deviceTag(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

export function loadSettings(): Settings {
  // First launch - nothing stored at all - speaks the phone's language. Saved
  // at once: were it left to the default, the first saved profile would make
  // the next launch look like an old install and flip the app to Croatian.
  // An existing install keeps what it had.
  if (store.getString(KEY.settings) === undefined && store.getString(KEY.profile) === undefined) {
    const first = { ...DEFAULT_SETTINGS, locale: localeFor(deviceTag()) };
    write(KEY.settings, first);
    return first;
  }
  let s = read(KEY.settings, DEFAULT_SETTINGS);
  // Each migration asks what the app that SAVED these settings knew - so all
  // of them read the stored text before any of them writes: a write merges
  // the defaults in, and the next one would think a newer app had saved.
  const raw = store.getString(KEY.settings) ?? '';
  let changed = false;
  // Before the three versions there was a switch: Prava bela kept, anything
  // else is Lagana (the player's choice when the three came in, 2026-09-23).
  if (!raw.includes('"difficulty"')) {
    s = { ...s, difficulty: raw.includes('"hardMode":true') ? 'hard' : 'easy' };
    changed = true;
  }
  if (!isPlayMode(s.difficulty)) s = { ...s, difficulty: 'easy' };
  // Before 1.4.0 one swap of two cards switched "Slaganje karata" to Ručno
  // for good, and trump-first sorting never came back. Settings saved by
  // such an app (no arrangeTips yet) go back to the default once; anyone who
  // wants Ručno sets it again, and it stays.
  if (s.handSort === 'manual' && !raw.includes('"arrangeTips"')) {
    s = { ...s, handSort: 'auto' };
    changed = true;
  }
  if (changed) write(KEY.settings, s);
  if (s.voiceMode !== 'hold' && s.voiceMode !== 'tap') s = { ...s, voiceMode: 'hold' };
  if (s.tempo !== 'slow' && s.tempo !== 'normal' && s.tempo !== 'fast') s = { ...s, tempo: 'normal' };
  if (s.hapticStrength !== 'soft' && s.hapticStrength !== 'full') s = { ...s, hapticStrength: 'full' };
  if (typeof s.bigCards !== 'boolean') s = { ...s, bigCards: false };
  // A volume saved by a build with other steps snaps to the nearest chip, or
  // Settings would light none.
  const volume = (VOLUME_OPTIONS as readonly number[]).reduce((best, v) =>
    Math.abs(v - s.volume) < Math.abs(best - s.volume) ? v : best,
  );
  const voiceVolume = (VOLUME_OPTIONS as readonly number[]).reduce((best, v) =>
    Math.abs(v - s.voiceVolume) < Math.abs(best - s.voiceVolume) ? v : best,
  );
  s = voiceVolume === s.voiceVolume ? s : { ...s, voiceVolume };
  return volume === s.volume ? s : { ...s, volume };
}

export function saveSettings(settings: Settings): void {
  write(KEY.settings, settings);
}

/**
 * The series between the same four people, across evenings - on this device
 * only, like everything else. Keyed by who played with whom (groupKey), from
 * this player's side; `seen` names the matches already counted, so a
 * reconnect or a relaunch never counts one twice.
 */
export interface SeriesEntry {
  us: number;
  them: number;
  seen: string[];
}
export type SeriesBook = Record<string, SeriesEntry>;

export function loadSeries(): SeriesBook {
  return read<SeriesBook>(KEY.series, {});
}

export function saveSeries(book: SeriesBook): void {
  write(KEY.series, book);
}

/**
 * The matches played with friends, newest first (net/history.ts), on this
 * device only. A list, so it is not merged over a default like the others:
 * anything that is not a list reads as none.
 */
export function loadHistory(): MatchRecord[] {
  try {
    const raw = store.getString(KEY.history);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as MatchRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(list: readonly MatchRecord[]): void {
  write(KEY.history, list);
}

/** Wipes local progress. Exposed in settings so testers can start clean. */
export function resetProfile(): PlayerProfile {
  const fresh = ensureQuests(emptyProfile(), isoDay(new Date()));
  saveProfile(fresh);
  return fresh;
}

// --- identity (identity.ts): this installation, whom it blocks, the conduct sheet ---

/** Raw access for the few modules with their own small records (remoteConfig.ts). */
export function kvGet(key: string): string | undefined {
  try {
    return store.getString(key);
  } catch {
    return undefined;
  }
}

export function kvSet(key: string, value: string): void {
  try {
    store.set(key, value);
  } catch {
    // forgotten on the next launch, nothing worse
  }
}

/** 16 random bytes from the platform (expo-crypto: SecureRandom on Android, crypto.getRandomValues on the web). */
function randomHex16(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native on the phone, loaded when first needed
  const Crypto = require('expo-crypto') as typeof import('expo-crypto');
  return hexOf(Crypto.getRandomBytes(16));
}

/** This installation's ID: made on the first call that needs it, then kept. */
export function installId(): string {
  return ensureInstallId(store, randomHex16);
}

export function loadBlocked(): BlockedPlayer[] {
  return readBlocked(store);
}

export function saveBlocked(list: readonly BlockedPlayer[]): void {
  writeBlocked(store, list);
}

// Accepted in this session, whatever the store did with it. A browser with DOM
// storage off keeps no write at all, so "Razumijem" was forgotten at once: the
// sheet came back at every press of the mic, and nothing was ever recorded.
let conductThisSession = false;

export function conductAccepted(): boolean {
  return conductThisSession || readConduct(store);
}

export function acceptConduct(): void {
  conductThisSession = true;
  writeConduct(store);
}
