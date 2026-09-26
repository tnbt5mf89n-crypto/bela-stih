import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Seat } from '@belot/engine';
import {
  enqueue,
  nextClip,
  QUEUE_MAX,
  recordingOptions,
  sniffMime,
  STALE_MS,
  takeClock,
  VOICE_BIT_RATE,
  VOICE_MAX_BYTES,
  VOICE_MAX_MS,
  webRecordingMime,
  ECHO_WAIT_MS,
  RECEIPT_WAIT_MS,
  STATUS_SHOW_MS,
  sendEchoed,
  sendHeard,
  sendNoted,
  sendSettle,
  sendStarted,
  sendStatusText,
  type HeardClip,
  type SendStatus,
} from '../src/voice/voice';
import * as room from '../../server/src/protocol';
import { computeTableMetrics, EMOTE_TOGGLE, LAND_TRAY_W } from '../src/table/metrics';
import { Lang, LOCALE_IDS } from '@belot/i18n';

/**
 * The app's side of push-to-talk, without a microphone: what a recording is,
 * how it is recorded, and the order clips are heard in.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');

const clip = (from: Seat, id: number, at: number): HeardClip => ({
  from,
  id,
  ms: 2000,
  mime: 'audio/mp4',
  data: new Uint8Array(8),
  at,
});
const none = () => false;

describe('what the app records', () => {
  it('names a take by its bytes, as the room checks it', () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d]);
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f]);
    expect(sniffMime(mp4)).toBe('audio/mp4');
    expect(sniffMime(webm)).toBe('audio/webm');
    expect(sniffMime(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });

  it('keeps inside the room: the same length, size and formats', () => {
    expect(VOICE_MAX_MS).toBe(room.VOICE_MAX_MS);
    expect(VOICE_MAX_BYTES).toBe(room.VOICE_MAX_BYTES);
    expect([...room.VOICE_MIMES].sort()).toEqual(['audio/mp4', 'audio/webm']);
    // 15 s at the bit rate, with a quarter for the container, still fits.
    expect(((VOICE_MAX_MS / 1000) * VOICE_BIT_RATE) / 8 * 1.25).toBeLessThan(VOICE_MAX_BYTES);
  });

  it('records speech on a phone as AAC in MP4, mono, 16 kHz', () => {
    const o = recordingOptions(undefined);
    expect(o.android).toMatchObject({ outputFormat: 'mpeg4', audioEncoder: 'aac' });
    expect(o.numberOfChannels).toBe(1);
    expect(o.sampleRate).toBe(16_000);
    expect(o.bitRate).toBe(VOICE_BIT_RATE);
  });

  it('in a browser, Opus in WebM (it keeps the bit rate), MP4 only where WebM cannot record', () => {
    expect(webRecordingMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(webRecordingMime((t) => t === 'audio/webm')).toBe('audio/webm');
    expect(webRecordingMime((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(webRecordingMime(() => false)).toBeUndefined();
    expect(webRecordingMime(() => {
      throw new Error('no');
    })).toBeUndefined();
    expect(recordingOptions('audio/mp4').web).toEqual({ mimeType: 'audio/mp4', bitsPerSecond: VOICE_BIT_RATE });
    expect(recordingOptions(undefined).web).toEqual({ bitsPerSecond: VOICE_BIT_RATE });
  });

  it('shows how long a take has run against the limit', () => {
    expect(takeClock(0)).toBe('0:00 / 0:15');
    expect(takeClock(4200)).toBe('0:04 / 0:15');
    expect(takeClock(99_000)).toBe('0:15 / 0:15');
  });
});

describe('the order clips are heard in', () => {
  it('as they came, one after another', () => {
    let q = enqueue([], clip(1, 1, 0), none);
    q = enqueue(q, clip(2, 2, 10), none);
    const a = nextClip(q, 100, none);
    expect(a.clip?.id).toBe(1);
    expect(nextClip(a.rest, 100, none).clip?.id).toBe(2);
  });

  it('never a muted or hidden speaker, even one muted while waiting', () => {
    const muted = (s: Seat) => s === 2;
    expect(enqueue([], clip(2, 1, 0), muted)).toEqual([]);
    const q = enqueue(enqueue([], clip(2, 1, 0), none), clip(3, 2, 0), none);
    expect(nextClip(q, 10, muted).clip?.id).toBe(2);
  });

  it('no more than QUEUE_MAX waiting, and nothing stale', () => {
    let q: HeardClip[] = [];
    for (let i = 0; i < QUEUE_MAX + 2; i++) q = enqueue(q, clip(1, i, 0), none);
    expect(q).toHaveLength(QUEUE_MAX);
    expect(nextClip(q, STALE_MS + 1, none).clip).toBeNull();
    expect(nextClip(q, STALE_MS, none).clip?.id).toBe(0);
  });
});

describe('the app around it', () => {
  it("every join tells the room this app speaks voice, and whether its player has it on", () => {
    const n = src('net/useNetGame.ts');
    const joins = n.match(/c\.(joinOrCreate|create|joinById)\(.*\{[^}]*\}\)/g) ?? [];
    expect(joins.length).toBe(4);
    for (const j of joins) expect(j, j).toMatch(/gifts: true,\s*voice: voiceRef\.current\b/);
    expect(n).toMatch(/const voiceRef = useRef\(settings\.voice\);\s*voiceRef\.current = settings\.voice;/);
    // Switched in Settings at the table: the room hears of it at once.
    expect(n).toMatch(/useEffect\(\(\) => \{\s*roomRef\.current\?\.send\('hears', \{ on: settings\.voice \}\);\s*\}, \[settings\.voice\]\);/);
    // The server's side of both, typed.
    const hears: room.ClientMessage = { type: 'hears', on: false };
    expect(hears.type).toBe('hears');
  });

  it("drops a clip from a hidden or muted player before it is heard, and never plays my own", () => {
    const n = src('net/useNetGame.ts');
    expect(n).toMatch(/if \(seat === mySeatRef\.current \|\| hiddenRef\.current\.includes\(seat\) \|\| mutedRef\.current\.includes\(seat\)\) return;/);
    expect(n).toMatch(/const mime = data \? sniffMime\(data\) : null;\s*if \(!data \|\| !mime\) return;/);
  });

  it('asks for the microphone and keeps the media sessions away', () => {
    const app = JSON.parse(readFileSync(join(here, '../app.json'), 'utf8'));
    expect(app.expo.android.blockedPermissions).not.toContain('android.permission.RECORD_AUDIO');
    expect(app.expo.android.blockedPermissions).toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'));
    // Exact: the version every shipped build already carried natively.
    expect(pkg.dependencies['expo-file-system']).toBe('57.0.5');
  });

  it("plays each clip at the game's volume, lets it go when it ends, the game sounds dipped meanwhile", () => {
    const p = src('voice/useVoicePlayback.ts');
    // 1.6.0: at the voice volume, levelled by the sender's header; the receipt goes when the clip has ENDED.
    expect(p).toMatch(/playback = playClip\(src\.uri, masterVolume\(\) \* voiceVolume\(\) \* gainForLoudness\(clip\.loudness\), \(\) => \{\s*onPlayedRef\.current\?\.\(clip\.id\);\s*stop\(\);\s*\}\);/);
    expect(p).toMatch(/playback\?\.stop\(\);\s*src\?\.release\(\);/);
    // What a killed app left in the cache goes as the screen opens, before any clip can come.
    expect(p).toMatch(/useEffect\(\(\) => sweepVoiceFiles\(\), \[\]\);/);
    expect(p).toMatch(/setSfxDuck\(SFX_UNDER_VOICE\);/);
    expect(p).toMatch(/setSfxDuck\(1\);/);
    // A clip that never says it is done still lets the next one go.
    expect(p).toMatch(/timer = setTimeout\(stop, clip\.ms \+ FINISH_SLACK_MS\);/);
    // 1.6.0: the lower of two dips - a clip playing, or this player's own microphone open.
    expect(src('audio.ts')).toMatch(/gain \* master \* Math\.min\(clipDuck, micDuck\) \* \(opts\.gain \?\? 1\)/);
  });

  it("keeps the recorder with the online screen, so the table's rows cannot take a take with them", () => {
    const o = src('net/OnlineGame.tsx');
    expect(o).toMatch(/const mic = useVoiceRecorder\(/);
    expect(o).toMatch(/mic=\{voiceHere \? gatedMic : undefined\}/);
    // Voice switched off mid-take: dropped, and never sent.
    expect(o).toMatch(/if \(!voiceHereRef\.current\) return;\s*sendVoice\(take\);\s*sentStarted\(\);/);
    expect(o).toMatch(/if \(!voiceHere\) void finishTake\(false\);/);
    const t = src('TableScreen.tsx');
    expect(t).not.toMatch(/useVoiceRecorder\(/);
    expect(src('table/MicButton.tsx')).not.toMatch(/useVoiceRecorder\(/);
    // No mic left anywhere (a question took the row): what was said goes.
    expect(t).toMatch(/const micInRow = mic !== undefined && \(\(micShown && !settled\) \|\| heldOver\);/);
    expect(t).toMatch(/const micOnSheet = mic !== undefined && settled;/);
    expect(t).toMatch(/if \(!micInRow && !micOnSheet\) void finishTake\?\.\(true\);/);
  });

  it('never leaves a microphone open or a take on the phone', () => {
    const r = src('voice/useVoiceRecorder.ts');
    // Opened but would not record: closed again.
    expect(r).toMatch(/if \(prepared\) \{\s*try \{\s*(?:stopMetering\(\);\s*)?await recorder\.stop\(\);/);
    // The screen closing mid-take: the file by the name kept at the start, whatever the recorder says.
    expect(r).toMatch(/takeUri\.current = Platform\.OS === 'web' \? null : recorder\.uri;/);
    expect(r).toMatch(/void recorder\.stop\(\)\.catch\(\(\) => \{\}\);[\s\S]{0,120}dropTake\(takeUri\.current\);/);
    const f = src('voice/clipFiles.ts');
    expect(f).toMatch(/sweep\(new Directory\(Paths\.cache, 'Audio'\), TAKE_FILE\);/);
    expect(f).toMatch(/sweep\(Paths\.cache, HEARD_FILE\);/);
  });

  it('drops a take that is cut short, slid off, or interrupted, unread', () => {
    const r = src('voice/useVoiceRecorder.ts');
    expect(r).toMatch(/if \(!send \|\| ms < VOICE_MIN_MS \|\| !uri\) \{\s*dropTake\(uri\);/);
    expect(r).toMatch(/if \(s !== 'active'\) void finish\(false\);/);
    expect(r).toMatch(/limit\.current = setTimeout\(\(\) => void finish\(true\), VOICE_MAX_MS\);/);
  });
});

describe('what became of my message', () => {
  const t0 = 1_000_000;
  const echo = (to: Seat[], noReceipt: Seat[] = []) => ({ id: 7, ms: 3000, to, noReceipt });
  const settle = (s: SendStatus | null, at: number) => sendSettle(s, at).status;

  it('says sending until the room answers, and "not sent" if it never does', () => {
    const s = sendStarted(t0);
    expect(settle(s, t0 + ECHO_WAIT_MS - 1)?.kind).toBe('sending');
    expect(settle(s, t0 + ECHO_WAIT_MS)?.kind).toBe('notSent');
    // ...said for a while, then nothing.
    expect(settle(s, t0 + ECHO_WAIT_MS + STATUS_SHOW_MS - 1)?.kind).toBe('notSent');
    expect(settle(s, t0 + ECHO_WAIT_MS + STATUS_SHOW_MS)).toBeNull();
    expect(sendSettle(s, t0).nextIn).toBe(ECHO_WAIT_MS);
  });

  it('says at once when nobody at the table can hear it', () => {
    expect(sendEchoed(sendStarted(t0), echo([]), t0 + 100)?.kind).toBe('nobody');
  });

  it('names whoever has heard it, once each, and only from seats it went to', () => {
    let s = sendEchoed(sendStarted(t0), echo([1, 2]), t0 + 100);
    expect(s?.kind).toBe('sent');
    s = sendHeard(s, 7, 2, t0 + 900);
    s = sendHeard(s, 7, 2, t0 + 950);
    s = sendHeard(s, 7, 3, t0 + 990); // never sent to seat 3
    s = sendHeard(s, 8, 1, t0 + 995); // another clip's receipt
    expect(s?.kind === 'sent' && s.heard).toEqual([2]);
    s = sendHeard(s, 7, 1, t0 + 1200);
    expect(s?.kind === 'sent' && s.heard).toEqual([2, 1]);
    // Said for a while after the last one came.
    expect(settle(s, t0 + 1200 + STATUS_SHOW_MS - 1)?.kind).toBe('sent');
    expect(settle(s, t0 + 1200 + STATUS_SHOW_MS)).toBeNull();
  });

  it('waits as long as a listener could still play it, then says nobody heard it', () => {
    const s = sendEchoed(sendStarted(t0), echo([1]), t0 + 100);
    expect(settle(s, t0 + 100 + RECEIPT_WAIT_MS - 1)?.kind).toBe('sent');
    expect(settle(s, t0 + 100 + RECEIPT_WAIT_MS)?.kind).toBe('unheard');
    // A listener plays a clip within STALE_MS of its arrival or never.
    expect(RECEIPT_WAIT_MS).toBeGreaterThan(STALE_MS);
  });

  it('never says nobody heard it when some listener cannot say (an older app), or the room could not say whom', () => {
    const unsure = sendEchoed(sendStarted(t0), echo([1, 2], [2]), t0 + 100);
    expect(settle(unsure, t0 + 100 + STATUS_SHOW_MS - 1)?.kind).toBe('sent');
    expect(settle(unsure, t0 + 100 + STATUS_SHOW_MS)).toBeNull();
    const oldRoom = sendEchoed(sendStarted(t0), { id: 7, ms: 3000, to: null, noReceipt: [] }, t0 + 100);
    expect(oldRoom?.kind).toBe('sent');
    expect(settle(oldRoom, t0 + 100 + RECEIPT_WAIT_MS + 1)).toBeNull();
  });

  it('ignores an echo when nothing is being sent, and a press that sent nothing says why', () => {
    expect(sendEchoed(null, echo([1]), t0)).toBeNull();
    expect(sendNoted('short', t0).kind).toBe('tooShort');
    expect(sendNoted('denied', t0).kind).toBe('micDenied');
    expect(sendNoted('failed', t0).kind).toBe('recordFailed');
  });

  it('says it in words, in every language, without giving a listener a gender', () => {
    const names = ['Ivana', 'Marko', 'Ana'];
    const heard = (n: number): SendStatus => ({ kind: 'sent', since: 0, changed: 0, id: 1, to: [0, 1, 2], heard: [0, 1, 2].slice(0, n) as Seat[], unsure: false });
    for (const id of LOCALE_IDS) {
      const ui = new Lang(id).s.ui;
      const say = (s: SendStatus, mode: 'hold' | 'tap' = 'hold') => sendStatusText(ui, s, mode, (seat) => names[seat]!);
      const kinds = ['sending', 'nobody', 'unheard', 'notSent', 'micDenied', 'recordFailed'] as const;
      const words = kinds.map((k) => say({ kind: k, since: 0 }));
      expect(new Set(words).size, id).toBe(kinds.length);
      expect(say(heard(0))).toBe(ui.voiceSent);
      expect(say(heard(1))).toContain('Ivana');
      expect(say(heard(3))).toMatch(/Ivana.*Marko.*Ana/);
      expect(say({ kind: 'tooShort', since: 0 }, 'tap')).not.toBe(say({ kind: 'tooShort', since: 0 }, 'hold'));
      for (const k of ['micHintTap', 'micTooShortTap', 'micCancel', 'voiceModeLabel', 'voiceModeHold', 'voiceModeTap', 'voiceBarHintHold', 'voiceBarHintTap'] as const) {
        expect(ui[k].length, `${id} ${k}`).toBeGreaterThan(1);
      }
      expect(ui.voiceSpeaking('Ivana')).toContain('Ivana');
    }
    const hr = new Lang('hr').s.ui;
    expect(hr.voiceHeardBy(['Ivana'])).toBe('Čuje te Ivana ✓');
    expect(hr.voiceHeardBy(['Ivana', 'Marko', 'Ana'])).toBe('Čuju te Ivana, Marko i Ana ✓');
    // Present tense: "čula"/"čuo" would say whether the listener is a woman or a man.
    for (const id of LOCALE_IDS) {
      const ui = new Lang(id).s.ui;
      expect(`${ui.voiceHeardBy(['Ivana'])} ${ui.voiceSpeaking('Ivana')}`).not.toMatch(/čul[ao]|čuo|чул[ао]|чуо/);
    }
  });
});

describe('receipts, the app around them', () => {
  it('confirms a clip only once it really plays, and asks the room to tell its speaker', () => {
    const n = src('net/useNetGame.ts');
    expect(n).toMatch(/const confirmHeard = useCallback\(\(id: number\) => \{\s*roomRef\.current\?\.send\('heard', \{ id \}\);/);
    expect(n).toMatch(/room\.onMessage\('voiceHeard', /);
    expect(n).toMatch(/voiceHeardRef\.current\?\.\(msg\.id, by as Seat\);/);
    // Every join says this app confirms (and reads confirmations).
    const joins = n.match(/c\.(joinOrCreate|create|joinById)\(.*\{[^}]*\}\)/g) ?? [];
    expect(joins.length).toBe(4);
    for (const j of joins) expect(j, j).toMatch(/receipts: true/);
    // An echo from a room without receipts is "cannot say", never "nobody".
    expect(n).toMatch(/to: Array\.isArray\(msg!\.to\) \? seats\(msg!\.to\) : null,/);
    const o = src('net/OnlineGame.tsx');
    expect(o).toMatch(/`\$\{net\.hidden\.join\(','\)\}\|\$\{net\.muted\.join\(','\)\}`,\s*net\.confirmHeard,/);
    expect(o).toMatch(/sentEchoed\(e\);/);
    expect(o).toMatch(/if \(micNote\) sentNoted\(micNote\.why\);/);
    expect(o).toMatch(/micStatus=\{voiceHere \? micStatus : null\}/);
    expect(o).toMatch(/voiceMode=\{settings\.voiceMode\}/);
  });
});

describe('the end of a deal, with voice', () => {
  const t = src('TableScreen.tsx').split('\r\n').join('\n');

  it('gives the results sheet a mic of its own, pinned under the part that scrolls', () => {
    expect(t).toMatch(/const voiceBar = micOnSheet \? \(/);
    expect(t).toMatch(/finishLabel=\{finishLabel\}\s*voiceBar=\{voiceBar\}/);
    // Both sheets (a deal seen, a deal missed) pin it, and the scrolling part gives it room.
    expect(t).toMatch(/const bar = voiceBar \? \(\s*<View style=\{\[styles\.voiceBarPanel, \{ backgroundColor: room\(\)\.page \}\]\}>/);
    expect((t.match(/<\/ScrollView>\s*\{bar\}/g) ?? []).length).toBe(2);
    // Sideways a deal's buttons ride in the bar (a short screen would push them off); a match's end keeps its foot.
    expect(t).toMatch(/const pinFoot = wide && voiceBar !== null && !matchOver;/);
    expect((t.match(/\{pinFoot \? null : foot\}/g) ?? []).length).toBe(2);
    expect(t).toMatch(/voiceBar=\{voiceBar\}\s*wide=\{land\}/);
    expect(t).toMatch(/const scrollMax = voiceBar \? maxHeight - VOICE_BAR_H : maxHeight;/);
    expect((t.match(/style=\{\[styles\.resultPanel, \{ maxHeight: scrollMax, backgroundColor: room\(\)\.page \}\]\}/g) ?? []).length).toBe(2);
    // Its words sit beside it, not over the sheet.
    expect(t).toMatch(/mode=\{voiceMode\}\s*caption="none"/);
  });

  it('keeps a take going when the deal ends under it, until the finger lifts', () => {
    expect(t).toMatch(/const heldOver = settled && mic !== undefined && mic\.phase !== 'idle';/);
    // The row, with the mic under the finger, stays (under the sheet) in both orientations...
    expect((t.match(/\(!settled \|\| heldOver\) && \(/g) ?? []).length).toBe(2);
    // ...offering nothing else while it does.
    expect((t.match(/\{settled \|\| autoSkipping \? null : declareButtons \?\? \(/g) ?? []).length).toBe(2);
  });

  it('says who is speaking on the sheet, where the pucks are hidden, and what became of my message', () => {
    expect(t).toMatch(/const otherSpeaker = \(speaking \?\? \[\]\)\.find\(\(s\) => s !== mySeat\) \?\? null;/);
    expect(t).toMatch(/<SpeakingLine words=\{lang\.s\.ui\.voiceSpeaking\(meta\(otherSpeaker\)\.name\)\} reduced=\{reduced\} \/>/);
    expect(t).toMatch(/status=\{micStatus\}\s*captionAlign=\{land \? 'end' : 'center'\}/);
    // A question hides the mic: its new words are said over my hand instead, once each.
    expect(t).toMatch(/const micHidden = mic !== undefined && !micInRow && !micOnSheet;/);
    expect(t).toMatch(
      /if \(!micHidden \|\| micStatus === null \|\| micStatus === was \|\| micStatus === lang\.s\.ui\.voiceSending\) return;\s*const at = anchors\.centre\(anchorId\.seat\(mySeat\)\);\s*if \(at\) fxBus\.emit\(\{ kind: 'bubble', at, text: micStatus,/,
    );
  });

  it('tapped to start, offers a cross to throw the take away, wherever the mic is', () => {
    expect(t).toMatch(/const tapTake = voiceMode === 'tap' && mic\?\.phase === 'recording';/);
    expect(t).toMatch(/onPress=\{\(\) => void mic\?\.finish\(false\)\}/);
    expect(t).toMatch(/accessibilityLabel=\{lang\.s\.ui\.micCancel\}/);
    expect(t).toMatch(/\{tapTake && micCancel\(EMOTE_TOGGLE, 8\)\}/);
    const settings = src('screens/SettingsScreen.tsx');
    expect(settings).toMatch(/onSettingsChange\(\{ \.\.\.settings, voiceMode: o\.id \}\);/);
  });
});

describe('the table, with voice', () => {
  const t = src('TableScreen.tsx');

  it('offers the mic only while nothing is asked, so no row grows', () => {
    expect(t).toMatch(/const micShown = !asking && !belaOffered && !shed && micFits;/);
    expect(t).toMatch(/const micButton = micInRow \? \(/);
  });

  it("leaves the faces' toggle where it was before there was a mic", () => {
    // Portrait: the mic left of it, a spacer as wide right of it, the row centred.
    expect(t).toMatch(
      /<View style=\{styles\.actionsRow\}>\s*\{micButton\}\s*\{tapTake && micButton \? micCancel\(EMOTE_TOGGLE, [^\n]*\) : emoteToggle\}\s*\{micButton && <View style=\{styles\.micBalance\} \/>\}/,
    );
    expect(t).toMatch(/micBalance: \{ width: EMOTE_TOGGLE, height: EMOTE_TOGGLE \}/);
    // Sideways: the toggle keeps the rail's left edge.
    expect(t).toMatch(/<View style=\{styles\.railToggles\}>\s*\{tapTake && micButton \? micCancel\(EMOTE_TOGGLE, [^\n]*\) : emoteToggle\}\s*\{micButton\}\s*<\/View>/);
    // Neither touch area reaches past the gap's middle.
    expect(t).toMatch(/hitSlop=\{land \? \{ top: 8, bottom: 8, left: RAIL_GAP \/ 2, right: 8 \} : \{ top: 8, bottom: 8, left: 8, right: ROW_GAP \/ 2 \}\}/);
    expect(t).toMatch(/!micButton \? 8 : land \? \{ top: 8, bottom: 8, left: 8, right: RAIL_GAP \/ 2 \} : \{ top: 8, bottom: 8, left: ROW_GAP \/ 2, right: 8 \}/);
    expect(t).toMatch(/gap: ROW_GAP,\s*justifyContent: 'center'/);
    expect(t).toMatch(/railToggles: \{ flexDirection: 'row', gap: RAIL_GAP,/);
  });

  it('fits a landscape rail beside the toggle at the narrowest rail there is', () => {
    expect(t).toMatch(/const RAIL_MIC = 34;/);
    for (const [w, h] of [[568, 320], [640, 320], [723, 336], [915, 412]]) {
      const m = computeTableMetrics(w, h);
      expect(34 + 4 + EMOTE_TOGGLE, `${w}x${h}`).toBeLessThanOrEqual(m.railW);
    }
    // Where a rail is narrower (a very short screen on its side), the mic stands down.
    expect(computeTableMetrics(500, 270).railW).toBeLessThan(34 + 4 + EMOTE_TOGGLE);
    expect(t).toMatch(/const micFits = !land \|\| m\.railW >= RAIL_MIC \+ 4 \+ EMOTE_TOGGLE;/);
    expect(LAND_TRAY_W).toBeGreaterThan(0);
  });

  it('sends waves from whoever speaks, me while I record', () => {
    expect(t).toMatch(/if \(recording\) set\.add\(mySeat\);/);
    expect(t).toMatch(/giftN=\{giftLanded\?\.\[s\] \?\? 0\}\s*speaking=\{speakingSeats\.has\(s\)\}/);
    expect(t).toMatch(/giftN=\{giftLanded\?\.\[mySeat\] \?\? 0\}\s*speaking=\{speakingSeats\.has\(mySeat\)\}/);
    const puck = src('table/SeatPuck.tsx');
    expect(puck).toMatch(/\(reduced \? \[0\] : \[0, VOICE_WAVE_GAP_MS\]\)/);
    expect(puck).toMatch(/reduced \? styles\.waveStill : \{ \.\.\.voiceWave, animationDelay: delay \}/);
  });

  it('lets one player be muted in the player view, unless already hidden', () => {
    const g = src('table/GiftPicker.tsx');
    expect(g).toMatch(/\{moderate\.onMute && !moderate\.hidden && \(/);
    expect(t).toMatch(/\.\.\.\(onMute && mic\s*\?/);
  });

  it('hears nothing where voice is off, at the table or in Settings', () => {
    const o = src('net/OnlineGame.tsx');
    expect(o).toMatch(/const voiceHere = settings\.voice && net\.voiceOn && cfg\.voice;/);
    expect(o).toMatch(/mic=\{voiceHere \? gatedMic : undefined\}/);
    expect(o).toMatch(/\(s\) => net\.hidden\.includes\(s\) \|\| net\.muted\.includes\(s\),/);
    // The host's switch in the lobby, as the other rules.
    expect(o).toMatch(/label=\{ui\.voiceRule\}\s*host=\{isHost\}/);
    expect(o).toMatch(/onPick=\{\(k\) => net\.setRules\(\{ voice: k === 'on' \}\)\}/);
    expect(src('screens/SettingsScreen.tsx')).toMatch(/toggleRow\(ui\.voiceSetting, settings\.voice,/);
  });

  it('says it all in every language, without a gendered word about the player', () => {
    for (const id of LOCALE_IDS) {
      const ui = new Lang(id).s.ui;
      for (const k of ['micLabel', 'micHint', 'micTooShort', 'micDenied', 'micFailed', 'voiceRule', 'voiceOn', 'voiceOff', 'voiceSetting', 'voiceSettingHint', 'muteVoice', 'unmuteVoice', 'muteVoiceNote'] as const) {
        expect(ui[k].length, `${id} ${k}`).toBeGreaterThan(1);
      }
      expect(ui.voiceOn).not.toBe(ui.voiceOff);
      expect(ui.muteVoice).not.toBe(ui.unmuteVoice);
    }
    const hr = new Lang('hr').s.ui;
    expect(`${hr.hidePlayerNote} ${hr.muteVoiceNote}`).not.toMatch(/\b(njegov\w*|njezin\w*|mu|joj)\b/);
    expect(hr.hidePlayerNote).toMatch(/glasovne poruke/);
  });
});
