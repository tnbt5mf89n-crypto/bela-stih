import { createAudioPlayer } from 'expo-audio';

/** A clip sounding now; `stop` silences it and lets everything go (safe twice). */
export interface ClipPlayback {
  stop: () => void;
}

/**
 * One clip on a phone: a player of its own, released - its audio track with
 * it - when the clip ends or is stopped. (A player that is only removed keeps
 * its track until the collector runs, and an app has 40.) The browser's twin
 * is clipPlayer.web.ts, with the same contract: `onEnd(true)` only for a clip
 * played to its end - the speaker is told so (a receipt) - and `onEnd(false)`
 * for one that could not be played. A phone's failed player never says it has
 * finished; the caller's own timer lets that clip go. `onStart` once the sound
 * is really coming out.
 */
export function playClip(uri: string, volume: number, onEnd: (heard: boolean) => void, onStart?: () => void): ClipPlayback {
  const player = createAudioPlayer(uri);
  let done = false;
  let started = false;
  const sub = player.addListener('playbackStatusUpdate', (s) => {
    if (s.playing && !started && !done) {
      started = true;
      onStart?.();
    }
    if (s.didJustFinish) {
      stop();
      onEnd(true);
    }
  });
  const stop = () => {
    if (done) return;
    done = true;
    sub.remove();
    try {
      player.pause();
      player.release();
    } catch {
      // Released already.
    }
  };
  try {
    player.volume = volume;
    player.play();
  } catch (e) {
    stop();
    throw e;
  }
  return { stop };
}
