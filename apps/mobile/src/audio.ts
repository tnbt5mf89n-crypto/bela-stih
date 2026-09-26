import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import manifest from '../assets/sfx/manifest.json';
import { playOnce } from './sfxOnce';

/**
 * The sound bank.
 *
 * Every sound has a small pool of players (its `poly` in the manifest that
 * `scripts/make-sfx.mjs` writes next to the files): a play picks an idle one,
 * so two cards 140 ms apart both sound, and a coin cascade overlaps. Players
 * are created once and reused. Everything is fire-and-forget — a failed sound
 * must never interrupt a card being played.
 *
 * Except on Android for the `rare` ones (once a deal or less): there every
 * loaded player holds one of the app's 40 audio tracks, so a rare sound gets
 * a player of its own only while it sounds, released at the end - and a
 * voice message always finds a track.
 *
 * The manifest is the source of truth for what exists and how loud it plays;
 * the `require` table below has to list the same files by hand, because Metro
 * bundles an asset only for a literal path — a test keeps the two in step.
 */

export type Sfx = keyof typeof manifest;

// require() rather than import so Metro bundles the asset and hands back a module id.
const SOURCES: Record<Sfx, number> = {
  shuffle: require('../assets/sfx/shuffle.wav'),
  deal: require('../assets/sfx/deal.wav'),
  fan: require('../assets/sfx/fan.wav'),
  talon: require('../assets/sfx/talon.wav'),
  sort: require('../assets/sfx/sort.wav'),
  play: require('../assets/sfx/play.wav'),
  sweep: require('../assets/sfx/sweep.wav'),
  stack: require('../assets/sfx/stack.wav'),
  trick: require('../assets/sfx/trick.wav'),
  lastTrick: require('../assets/sfx/lastTrick.wav'),
  knock: require('../assets/sfx/knock.wav'),
  call: require('../assets/sfx/call.wav'),
  stamp: require('../assets/sfx/stamp.wav'),
  kontra: require('../assets/sfx/kontra.wav'),
  zvanje: require('../assets/sfx/zvanje.wav'),
  reveal: require('../assets/sfx/reveal.wav'),
  revealDown: require('../assets/sfx/revealDown.wav'),
  bela: require('../assets/sfx/bela.wav'),
  stiglja: require('../assets/sfx/stiglja.wav'),
  win: require('../assets/sfx/win.wav'),
  lose: require('../assets/sfx/lose.wav'),
  matchWon: require('../assets/sfx/matchWon.wav'),
  matchLost: require('../assets/sfx/matchLost.wav'),
  tick: require('../assets/sfx/tick.wav'),
  coin: require('../assets/sfx/coin.wav'),
  levelup: require('../assets/sfx/levelup.wav'),
  turn: require('../assets/sfx/turn.wav'),
  callPrompt: require('../assets/sfx/callPrompt.wav'),
  settle: require('../assets/sfx/settle.wav'),
  arm: require('../assets/sfx/arm.wav'),
  tap: require('../assets/sfx/tap.wav'),
  press: require('../assets/sfx/press.wav'),
  hold: require('../assets/sfx/hold.wav'),
  pop: require('../assets/sfx/pop.wav'),
  gift: require('../assets/sfx/gift.wav'),
  purchase: require('../assets/sfx/purchase.wav'),
  denied: require('../assets/sfx/denied.wav'),
  seatJoin: require('../assets/sfx/seatJoin.wav'),
  seatLeave: require('../assets/sfx/seatLeave.wav'),
  reconnected: require('../assets/sfx/reconnected.wav'),
};

export interface PlayOptions {
  /** Pitch and tempo multiplier on top of the effect's own variation; 1 plays it as made. */
  rate?: number;
  /** Extra gain on top of the effect's mix level, 0–1. */
  gain?: number;
}

const pools = new Map<Sfx, AudioPlayer[]>();
const next = new Map<Sfx, number>();
/** Android plays the rare sounds on one-shot players (see the top, and sfxOnce.ts). */
const ONE_SHOTS = Platform.OS === 'android';
let enabled = true;
let master = 0.8;
let configured = false;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

/** The one volume knob, 0–1, from Settings. */
export function setMasterVolume(v: number): void {
  master = Math.max(0, Math.min(1, v));
}

/** The knob as set: a voice message plays at it too. */
export function masterVolume(): number {
  return master;
}

/** The game's sounds step back while a voice message plays (voice/useVoicePlayback.ts); 1 is not at all. */
// Two reasons the game's sounds dip: somebody's clip is playing (clipDuck), or
// this player's own microphone is open (micDuck). The lower one applies.
let clipDuck = 1;
let micDuck = 1;
export function setSfxDuck(level: number): void {
  clipDuck = Math.max(0, Math.min(1, level));
}
export function setMicDuck(recording: boolean): void {
  micDuck = recording ? 0.4 : 1;
}
/** Settings' "Glas": the clips' own level, over the master volume. */
let voiceLevel = 0.7;
export function setVoiceVolume(v: number): void {
  voiceLevel = Math.max(0, Math.min(1, v));
}
export function voiceVolume(): number {
  return voiceLevel;
}

/**
 * Let the game be heard even when the phone is on silent — it is a game, not a
 * notification — and over the player's own music, never instead of it: with
 * 'mixWithOthers' a sound effect takes no audio focus, so Spotify and the
 * like keep playing (every card used to pause them for a moment).
 */
async function configureOnce(): Promise<void> {
  if (configured) return;
  configured = true;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'mixWithOthers' });
  } catch {
    // Audio mode is a nicety; never let it stop playback from being attempted.
  }
}

/**
 * A rate change must change the PITCH — that is the whole point of the
 * 1.25 tick and the 0.85 opponent's trick. Native players default to pitch
 * correction (time-stretch, same note), which would make both cues
 * inaudible on the phone; the web player already leaves pitch alone.
 */
function makePlayer(name: Sfx): AudioPlayer {
  const player = createAudioPlayer(SOURCES[name]);
  player.shouldCorrectPitch = false;
  return player;
}

function poolOf(name: Sfx): AudioPlayer[] {
  let pool = pools.get(name);
  if (!pool) {
    pool = [];
    pools.set(name, pool);
  }
  const want = manifest[name].poly;
  while (pool.length < want) pool.push(makePlayer(name));
  return pool;
}

/**
 * Create every player up front. Loading is asynchronous, so a player created
 * at first use plays its FIRST shot silently — the session's opening deal
 * riffle was going missing. One eager pass at app start fixes that for good.
 */
export function preloadSfx(): void {
  void configureOnce();
  for (const name of Object.keys(SOURCES) as Sfx[]) {
    if (ONE_SHOTS && manifest[name].rare) continue;
    try {
      poolOf(name);
    } catch {
      // A player that fails to load simply stays silent; never block startup.
    }
  }
  installWebUnlock();
}

/** An idle player from the pool, or round-robin when all are busy. */
function pick(name: Sfx): AudioPlayer {
  const pool = poolOf(name);
  const idle = pool.find((p) => !p.playing);
  if (idle) return idle;
  const i = (next.get(name) ?? 0) % pool.length;
  next.set(name, i + 1);
  return pool[i]!;
}

export function playSfx(name: Sfx, opts: PlayOptions = {}): void {
  if (!enabled) return;
  void configureOnce();
  try {
    const { gain, varied, rare } = manifest[name];
    const volume = Math.max(0, Math.min(1, gain * master * Math.min(clipDuck, micDuck) * (opts.gain ?? 1)));
    const rate = (varied ? 0.92 + Math.random() * 0.16 : 1) * (opts.rate ?? 1);
    if (ONE_SHOTS && rare) {
      playOnce(() => makePlayer(name), volume, rate);
      return;
    }
    const player = pick(name);
    // Rewind first: the same effect often fires again before it has finished.
    void player.seekTo(0);
    player.volume = volume;
    player.setPlaybackRate(rate);
    player.play();
    watchForBlock(player);
  } catch {
    // A missing or busy player must never break the game loop.
  }
}

// --- the web: audio needs a gesture ------------------------------------------

/**
 * Browsers refuse to play audio before the page has been touched, and iOS
 * Safari unlocks each media element separately. On the first gesture that
 * counts as activation every idle pooled player is played and paused at
 * volume 0, inside the gesture, which unlocks them all — and a probe player
 * proves it: only when it has actually advanced is the page unlocked, or the
 * listeners stay for the next gesture. A refused play() surfaces as a
 * NotAllowedError rejection that expo-audio drops on the floor; the window
 * catches it and tells the app, which shows a "tap to enable sound" chip.
 */
type BlockedListener = (blocked: boolean) => void;
const blockedListeners = new Set<BlockedListener>();
let unlocked = Platform.OS !== 'web';
let blocked = false;
let unlockInstalled = false;
/** Which gestures a browser counts as activation: pointerdown only for a mouse; touch activates on the way up. */
const ACTIVATION_EVENTS = ['pointerup', 'touchend', 'mousedown', 'keydown'];

export function onAudioBlocked(l: BlockedListener): () => void {
  blockedListeners.add(l);
  l(blocked);
  return () => {
    blockedListeners.delete(l);
  };
}

function setBlocked(b: boolean): void {
  if (blocked === b) return;
  blocked = b;
  for (const l of blockedListeners) l(b);
}

/**
 * Runs every idle pooled player silently, inside a user gesture, then checks
 * with a probe whether the browser really let audio through. Safe to call
 * again: it does nothing once unlocked, and never touches a player that is
 * sounding at that moment.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  for (const pool of pools.values()) {
    for (const p of pool) {
      try {
        // By the element, not expo-audio's flag (true from play() on, whatever the browser did).
        if (!p.paused) continue;
        const v = p.volume;
        p.volume = 0;
        p.play();
        p.pause();
        void p.seekTo(0);
        p.volume = v;
      } catch {
        // one element refusing must not stop the rest
      }
    }
  }
  // The probe: a short sound at volume 0. If it advances, the page is live.
  try {
    const probe = pick('press');
    const v = probe.volume;
    probe.volume = 0;
    probe.play();
    setTimeout(() => {
      try {
        const advanced = probe.currentTime > 0 || !probe.paused;
        probe.volume = v;
        if (advanced) markUnlocked();
      } catch {
        /* ignore */
      }
    }, 250);
  } catch {
    /* ignore */
  }
}

function markUnlocked(): void {
  if (unlocked) return;
  unlocked = true;
  setBlocked(false);
  uninstallWebUnlock?.();
}

let uninstallWebUnlock: (() => void) | null = null;

function installWebUnlock(): void {
  if (Platform.OS !== 'web' || unlockInstalled) return;
  unlockInstalled = true;
  const win = (globalThis as {
    window?: { addEventListener?: Function; removeEventListener?: Function };
  }).window;
  if (!win?.addEventListener) return;
  const onGesture = () => unlockAudio();
  for (const ev of ACTIVATION_EVENTS) win.addEventListener(ev, onGesture, { passive: true });
  // The policy's own verdict: a refused play() rejects with NotAllowedError,
  // which expo-audio never handles — and an AbortError is the play/pause
  // pair of the unlock itself. Neither belongs in the console.
  const onRejection = (e: { reason?: { name?: string }; preventDefault?: () => void }) => {
    const name = e.reason?.name;
    if (name === 'NotAllowedError') {
      if (!unlocked) setBlocked(true);
      e.preventDefault?.();
    } else if (name === 'AbortError') {
      e.preventDefault?.();
    }
  };
  win.addEventListener('unhandledrejection', onRejection);
  uninstallWebUnlock = () => {
    for (const ev of ACTIVATION_EVENTS) win.removeEventListener?.(ev, onGesture);
    // The rejection filter stays: a later AbortError is still noise.
  };
}

/**
 * Was that sound refused? Judged from the media element, not from expo-audio's
 * `playing`, which it sets true the moment play() is called whatever the
 * browser then decides — and clears when a short sound merely ends.
 */
function watchForBlock(player: AudioPlayer): void {
  if (Platform.OS !== 'web' || unlocked) return;
  setTimeout(() => {
    try {
      if (unlocked) return;
      if (player.paused && player.currentTime === 0) setBlocked(true);
      else markUnlocked();
    } catch {
      /* ignore */
    }
  }, 300);
}
