import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { room } from '../cosmetics';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import type { Seat } from '@belot/engine';
import { teamOf } from '@belot/engine';
import { anchorId } from '../anim/FxBus';
import { COIN_CASCADE_DELAY_MS, coinCascadeCount, coinDingTimers, coinsLandedMs, MATCH_CASCADE_HOLD_MS } from '../anim/lifetimes';
import { isMatchAward } from '../feedback';
import { playSfx, setMicDuck } from '../audio';
import { pattern } from '../haptics';
import { TableScreen, type SeatMeta } from '../TableScreen';
import { Button } from '../ui/Button';
import { font, ink, radius, space, surface, theme, type } from '../theme';
import { Panel } from '../ui/Panel';
import { SEAT_MAP_ASPECT, SeatMap } from './SeatMap';
import { SERVER_FALLBACK, seatName } from './seatName';
import { botIdentity } from '../table/bots';
import { stillReading } from './hold';
import { PressScale } from '../ui/PressScale';
import { MATCH_TARGETS_P, TURN_CHOICES_S } from './clock';
import { QrCode } from './QrCode';
import { copyText } from './clipboard';
import { Copy } from '../ui/icons';
import { useBackCloses } from '../ui/backGuard';
import { reportMailto, reportStamp } from '../report';
import { APP_VERSION } from '../screens/common';
import { loadHistory, loadSeries, saveHistory, saveSeries, type SeriesEntry, type Settings } from '../storage';
import { groupKey, recordMatch } from './series';
import { addRecord, UNNAMED } from './history';
import { isPlayMode, modeName, PLAY_MODES } from '../playMode';
import { summarize } from '../matchLog';
import { isoDay } from '@belot/progression';
import { useNetGame, type NetGame } from './useNetGame';
import { useVoicePlayback } from '../voice/useVoicePlayback';
import { useVoiceRecorder, type Take, type VoiceMic } from '../voice/useVoiceRecorder';
import { useVoiceSendStatus } from '../voice/useVoiceSendStatus';
import { sendStatusText } from '../voice/voice';
import { retryHelps } from './trouble';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { acceptConduct, conductAccepted } from '../storage';
import { useRemoteConfig } from '../remoteConfig';

/** Where an app too old for the server goes to update: the Play listing (the web is always current). */
const STORE_URL = Platform.OS === 'android' ? 'market://details?id=com.slfresh.belastih' : 'https://play.google.com/store/apps/details?id=com.slfresh.belastih';

/**
 * An online game. Everything about the rules comes from the server; this only
 * decides what to show while the table fills, and hands `TableScreen` the same
 * props the offline mode does — the screen cannot tell the difference.
 */
export function OnlineGame({
  settings,
  onSettingsChange,
  mode,
  joinCode,
  onExit,
}: {
  settings: Settings;
  onSettingsChange?: (s: Settings) => void;
  mode: 'quick' | 'create' | 'join';
  joinCode?: string;
  onExit: () => void;
}) {
  // Not on the web: the Wake Lock API needs a gesture and a secure context,
  // and deactivating a lock that never activated rejects with
  // ERR_KEEP_AWAKE_TAG_INVALID on every exit. The platform never changes at
  // runtime, so the hook order is stable.
  if (Platform.OS !== 'web') useKeepAwake(); // eslint-disable-line react-hooks/rules-of-hooks
  const net = useNetGame(settings);
  const { status, quickPlay, createPrivate, joinById } = net;

  // Voice messages, where the table has them on and so does this player:
  // others' clips play by themselves (never a hidden or muted player's), and
  // my own echo rings my puck for as long as the table hears it. Here rather
  // than at the table, so a clip that lands in the lobby is heard too.
  // The server's switches (remoteConfig.ts): a feature turned off is not offered.
  const cfg = useRemoteConfig();
  const ui = net.lang.s.ui;
  const voiceHere = settings.voice && net.voiceOn && cfg.voice;
  // A clip that really starts playing here is confirmed to its speaker.
  const playback = useVoicePlayback(
    voiceHere,
    (s) => net.hidden.includes(s) || net.muted.includes(s),
    `${net.hidden.join(',')}|${net.muted.join(',')}`,
    net.confirmHeard,
  );
  // What became of my own last message: said beside the mic.
  const sent = useVoiceSendStatus();
  const { echoed: sentEchoed, heard: sentHeard, noted: sentNoted, started: sentStarted } = sent;
  const [echoing, setEchoing] = useState(false);
  const echoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { onVoice } = net;
  useEffect(() => {
    onVoice(
      playback.hear,
      (e) => {
        if (echoTimer.current) clearTimeout(echoTimer.current);
        setEchoing(true);
        echoTimer.current = setTimeout(() => setEchoing(false), e.ms);
        sentEchoed(e);
      },
      sentHeard,
    );
    return () => {
      onVoice(null, null, null);
      if (echoTimer.current) clearTimeout(echoTimer.current);
    };
  }, [onVoice, playback.hear, sentEchoed, sentHeard]);
  const speaking = useMemo(
    () => [
      ...(playback.speaking !== null ? [playback.speaking] : []),
      ...(echoing && net.seat !== null ? [net.seat] : []),
    ],
    [playback.speaking, echoing, net.seat],
  );
  // Push-to-talk. The recorder lives here, not in the button: the table's
  // rows come and go under it (a question, the deal's end, the phone turned),
  // and a take must not go with them. Voice switched off mid-take drops it.
  const voiceHereRef = useRef(voiceHere);
  voiceHereRef.current = voiceHere;
  const { sendVoice } = net;
  const mic = useVoiceRecorder(
    useCallback(
      (take: Take) => {
        if (!voiceHereRef.current) return;
        sendVoice(take);
        sentStarted();
      },
      [sendVoice, sentStarted],
    ),
  );
  const { finish: finishTake, note: micNote } = mic;
  // While I speak, nobody else's clip starts and the game's sounds dip (audio.ts).
  useEffect(() => {
    playback.hold(mic.phase === 'recording');
    setMicDuck(mic.phase === 'recording');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hold is stable (useCallback on pump)
  }, [mic.phase]);
  // The screen closing mid-take (leave, back): audio.ts's duck is module state
  // and outlives the screen, and would hold every game sound at 40% until the
  // next online table.
  useEffect(() => () => setMicDuck(false), []);
  // Play's terms-before-UGC rule: the rules of conduct are shown, once, before
  // the first voice message ever leaves this device. The press that meets the
  // sheet records nothing; the next one does.
  const [conductAsk, setConductAsk] = useState(false);
  const gatedMic = useMemo<VoiceMic>(
    () => ({
      ...mic,
      start: async () => {
        if (!conductAccepted()) {
          setConductAsk(true);
          return;
        }
        await mic.start();
      },
    }),
    [mic],
  );
  // A public table with voice on asks, once per table, before strangers are heard.
  const [optInAskedFor, setOptInAskedFor] = useState<string | null>(null);
  const askOptIn = net.voiceOptIn && settings.voice && cfg.voice && !net.optedIn && optInAskedFor !== net.roomId && net.roomId !== null;
  useEffect(() => {
    if (!voiceHere) void finishTake(false);
  }, [voiceHere, finishTake]);
  // A press that sent nothing says why in the same place.
  useEffect(() => {
    if (micNote) sentNoted(micNote.why);
  }, [micNote, sentNoted]);
  const micStatus =
    sent.status === null
      ? null
      : sendStatusText(net.lang.s.ui, sent.status, settings.voiceMode, (s) => {
          const info = net.seats.find((x) => x.seat === s);
          return info ? seatName(net.lang, info) : net.lang.seat(s, net.seat ?? 0);
        });
  // Read out as it changes, except the moment of sending.
  const saidStatus = useRef<string | null>(null);
  useEffect(() => {
    if (micStatus !== null && micStatus !== saidStatus.current && sent.status?.kind !== 'sending') {
      AccessibilityInfo.announceForAccessibility(micStatus);
    }
    saidStatus.current = micStatus;
  }, [micStatus, sent.status?.kind]);

  // Connect once, on the way in.
  useEffect(() => {
    if (mode === 'quick') void quickPlay();
    else if (mode === 'create') void createPrivate();
    else if (joinCode) void joinById(joinCode);
    // Intentionally runs once: reconnecting is an explicit user action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same celebration wiring as offline: coins to the wallet, confetti on a win.
  // One cascade per banner. A match's award is MERGED onto the last deal's
  // banner a second later, so that banner's pending timers are replaced by
  // the merged banner's own — nothing is lost, nothing plays twice, and a
  // match's coins wait for the fanfare. The timers die with the screen.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const lastBanner = useRef<typeof net.banner>(null);
  useEffect(() => {
    const banner = net.banner;
    if (!banner || banner === lastBanner.current) return;
    lastBanner.current = banner;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const hold = isMatchAward(banner) ? MATCH_CASCADE_HOLD_MS : 0;
    const delay = COIN_CASCADE_DELAY_MS + hold;
    // More coins fly for more: the wallet's lag counts the same number.
    const count = coinCascadeCount(banner.coins);
    if (banner.coins > 0) {
      // From the sheet's "Upisano" total once the sheet has slid up and
      // settled; from the felt if there is no sheet.
      timers.current.push(
        setTimeout(() => {
          // Measured again first: the sheet's total was measured as the sheet
          // slid up, a viewport low on the web. No arc under reduce-motion —
          // the wallet still counts, and the coins still ding.
          if (net.motion === 'reduced') return;
          void net.anchors.refresh().then(() => {
            const from = net.anchors.centre(anchorId.sheetTotal) ?? net.anchors.centre(anchorId.deck);
            const to = net.anchors.centre(anchorId.wallet);
            if (from && to) net.fxBus.emit({ kind: 'coins', from, to, count });
          });
        }, delay),
        // One ding per coin as it lands.
        ...coinDingTimers(count, delay),
      );
    }
    // The level-up: its own moment, when the badge swells — the profile bar
    // lags the level by the coins' full flight whether or not coins flew, so
    // a level crossed on a lost deal counts too, and lands with its sound.
    if (banner.levelUp !== null) {
      timers.current.push(
        setTimeout(
          () => {
            playSfx('levelup');
            pattern('levelUp');
            // Seen as well as heard: a burst where the level badge swells.
            if (net.motion !== 'reduced') {
              const at = net.anchors.centre(anchorId.wallet);
              if (at) net.fxBus.emit({ kind: 'burst', at, count: 24 });
            }
          },
          delay + coinsLandedMs(count),
        ),
      );
    }
  }, [net.banner, net.anchors, net.fxBus, net.motion]);

  // Everyone still connected has to accept; bots and empty seats never count.
  const seatedHumans = net.seats.filter((s) => s.connected && !s.bot).length;
  const waitingForRematch = Math.max(0, seatedHumans - net.rematchVotes.length);

  // The same four people, in the same teams, from one evening to the next:
  // their series lives on this device (storage.ts) and carries on from where
  // it stood last time. Only a table of four people counts - a bot is not
  // somebody to have a series with - and each match counts once, however
  // often this device reconnects or relaunches. A friend whose phone dropped
  // is still one of the four: their seat keeps their name while a bot holds
  // it, and only a seat nobody ever sat in carries the room's fallback name.
  const fourPeople = net.seats.length === 4 && net.seats.every((s) => s.name !== SERVER_FALLBACK(s.seat));
  const mine = net.seat;
  const group =
    fourPeople && mine !== null
      ? groupKey(
          [mine, ((mine + 2) % 4) as Seat].map((s) => net.realName(s)),
          [((mine + 1) % 4) as Seat, ((mine + 3) % 4) as Seat].map((s) => net.realName(s)),
        )
      : null;
  const [seriesEntry, setSeriesEntry] = useState<SeriesEntry | null>(null);
  useEffect(() => {
    setSeriesEntry(group !== null ? (loadSeries()[group] ?? null) : null);
  }, [group]);
  useEffect(() => {
    if (group === null || mine === null || !net.matchOver || net.winnerTeam === null || !net.roomId) return;
    const id = `${isoDay(new Date())}:${net.roomId}:${net.matchNumber}`;
    const book = recordMatch(loadSeries(), group, id, net.winnerTeam === teamOf(mine));
    saveSeries(book);
    setSeriesEntry(book[group] ?? null);
  }, [group, mine, net.matchOver, net.winnerTeam, net.roomId, net.matchNumber]);

  // The history of matches with friends (net/history.ts): every finished match
  // at a private table where at least one other chair had a person in it. A
  // seat that a bot held from the start is written as nobody; a friend whose
  // phone dropped keeps their name. Counted once, by the series' own id.
  useEffect(() => {
    if (mine === null || !net.isPrivate || !net.matchOver || net.winnerTeam === null || !net.roomId) return;
    // A bot from the start is nobody (bot, and still the server's fallback
    // name - as pureBot below); a person who never set a name is still a
    // person, kept as UNNAMED so they are never taken for somebody else.
    const person = (s: Seat) => {
      const info = net.seats.find((x) => x.seat === s);
      if (!info) return '';
      const fallback = info.name === SERVER_FALLBACK(s);
      if (info.bot && fallback) return '';
      return fallback ? UNNAMED : net.realName(s);
    };
    const partner = person(((mine + 2) % 4) as Seat);
    const opponents: [string, string] = [person(((mine + 1) % 4) as Seat), person(((mine + 3) % 4) as Seat)];
    if (!partner && !opponents[0] && !opponents[1]) return;
    const us = teamOf(mine);
    const them = (1 - us) as 0 | 1;
    const scores = net.view?.matchScores ?? [0, 0];
    const sum = summarize(net.matchLog, scores, us);
    saveHistory(
      addRecord(loadHistory(), {
        id: `${isoDay(new Date())}:${net.roomId}:${net.matchNumber}`,
        at: new Date().toISOString(),
        code: net.roomId,
        partner,
        opponents,
        target: net.target,
        hard: net.mode === 'hard',
        mode: net.mode,
        won: net.winnerTeam === us,
        score: [scores[us], scores[them]],
        deals: sum ? [sum.won[us], sum.won[them]] : null,
        best: sum?.best?.points ?? null,
      }),
    );
    // Recorded as the match ends: its id is final then, and a rematch's is new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, net.isPrivate, net.matchOver, net.winnerTeam, net.roomId, net.matchNumber]);
  // The series as the table shows it, by team id: the long one when there is
  // one, tonight's otherwise (a table with a bot, or before four sat down).
  const shownSeries: [number, number] =
    seriesEntry && mine !== null
      ? teamOf(mine) === 0
        ? [seriesEntry.us, seriesEntry.them]
        : [seriesEntry.them, seriesEntry.us]
      : net.series;

  // Every match of a series deserves its own confetti, so the latch is keyed
  // on the match rather than on the mount.
  const cheeredMatch = useRef(-1);
  useEffect(() => {
    if (
      net.matchOver &&
      cheeredMatch.current !== net.matchNumber &&
      net.seat !== null &&
      net.winnerTeam === teamOf(net.seat)
    ) {
      cheeredMatch.current = net.matchNumber;
      if (net.motion !== 'reduced') {
        net.fxBus.emit({ kind: 'confetti' });
        const at = net.anchors.centre(anchorId.deck);
        if (at) net.fxBus.emit({ kind: 'burst', at, count: 40 });
      }
    }
  }, [net.matchOver, net.matchNumber, net.winnerTeam, net.seat, net.fxBus]);

  const leaveAndExit = () => {
    net.leave();
    onExit();
  };

  // 'finished' keeps the table mounted: the result sheet, winner banner and
  // confetti all live inside TableScreen. So does a dropped connection once the
  // match is under way: the table stays, with "getting you back" over it, while
  // the hook reconnects to the seat - it used to swap to the lobby, which is
  // where a phone call left the player.
  const atTable = status === 'playing' || status === 'finished' || net.reconnecting;
  if (net.seat === null || net.view === null || !atTable) {
    return <Waiting net={net} onExit={leaveAndExit} />;
  }

  const settled = net.view.phase === 'DEAL_OVER' || net.view.phase === 'MATCH_OVER';
  const seatMeta: (SeatMeta | null)[] = [null, null, null, null];
  for (const s of net.seats) {
    // A chair nobody ever sat in: the server calls it "Igrač N" and gives it no
    // face. It gets the bot's character instead, as offline. A dropped player
    // keeps their own name and face under the bot mark.
    const pureBot = s.seat !== net.seat && s.bot && s.name === SERVER_FALLBACK(s.seat);
    const who = pureBot ? botIdentity(net.lang, s.seat) : null;
    seatMeta[s.seat] = {
      name: s.seat === net.seat ? net.lang.s.seat[0] : (who?.name ?? seatName(net.lang, s)),
      avatar: who?.avatar ?? (s.avatar || null),
      bot: s.bot,
      connected: s.connected,
      pureBot,
      // Block is offered only where it can be kept: a seat whose app sent an
      // install ID. An older app's seat would only be hidden at this table.
      blockable: s.seat !== net.seat && !!s.installId,
    };
  }

  // Only people a bot stands in for: a table started with bots names nobody.
  const away = net.standIns;

  return (
    <>
    <TableScreen
      mySeat={net.seat}
      lang={net.lang}
      view={net.view}
      spotlightSeat={net.spotlight}
      matchLog={net.matchLog}
      cue={net.cue}
      dealerHop={net.dealerHop}
      reducedMotion={net.motion === 'reduced'}
      playMode={net.mode}
      matchTarget={net.target}
      handSort={settings.handSort}
      arrangeTip={settings.arrangeTips < 2}
      onArrangeTip={(learned) =>
        onSettingsChange?.({ ...settings, arrangeTips: learned ? 2 : settings.arrangeTips + 1 })
      }
      confirmPlay={settings.confirmPlay}
      // A play waits for the server's echo: the card says it went, and a
      // second tap in the gap sends nothing.
      awaitEcho
      refusedN={net.refusals}
      series={shownSeries}
      askedRematch={net.rematchVotes.includes(net.seat)}
      // The same four again: a return match, not just another one.
      rematchLabel={fourPeople ? net.lang.s.ui.revans : undefined}
      waitingFor={waitingForRematch}
      onRematch={net.rematch}
      onForceRematch={net.seat === net.hostSeat ? net.rematchStart : undefined}
      // A private table can stand still; quick play never does.
      hold={net.hold}
      onPause={net.isPrivate ? net.pause : undefined}
      onResume={net.isPrivate ? net.resume : undefined}
      onPlayOn={net.isPrivate ? net.playOn : undefined}
      reconnecting={net.reconnecting}
      nextDeal={
        net.view.phase === 'DEAL_OVER'
          ? {
              deadline: net.nextDeadline,
              ready: net.nextVotes.includes(net.seat),
              waitingFor: stillReading(net.seats, net.nextVotes, net.seat).map((s) =>
                seatName(net.lang, net.seats.find((x) => x.seat === s)!),
              ),
            }
          : undefined
      }
      // Nothing can be played while the table stands still or this device is
      // off the line: the server would only refuse it.
      options={settled || !net.idle || net.hold !== null || net.reconnecting ? [] : net.view.legalActions}
      myTurn={net.idle && net.view.toAct === net.seat}
      settled={settled}
      matchOver={net.matchOver}
      lastDealResult={net.lastDealResult}
      matchScores={net.view.matchScores}
      winnerTeam={net.winnerTeam}
      profile={net.profile}
      banner={net.banner}
      seatMeta={seatMeta}
      // A refused move outranks the bot line: it is about the tap just made,
      // and the table's next move clears it.
      // While this device gets back into its seat the panel over the table
      // says so; the raw "veza prekinuta (1005)" above the score would only
      // say it again, with a socket code nobody needs.
      status={
        (net.reconnecting ? null : net.error) ??
        (away.length > 0 ? net.lang.s.ui.botPlaysFor(away.map((s) => seatName(net.lang, s)).join(', ')) : null)
      }
      statusIsError={!net.reconnecting && net.error !== null}
      anchors={net.anchors}
      fxBus={net.fxBus}
      turnDeadline={net.turnDeadline}
      turnTotalMs={net.turnTotalMs}
      onAction={net.submit}
      onNext={net.next}
      onFinish={leaveAndExit}
      finishLabel={net.lang.s.ui.leaveTable}
      onEmote={cfg.emotes ? net.sendEmote : undefined}
      mic={voiceHere ? gatedMic : undefined}
      micStatus={voiceHere ? micStatus : null}
      voiceMode={settings.voiceMode}
      speaking={speaking}
      muted={net.muted}
      onMute={net.mute}
      gifts={net.gifts}
      giftLanded={net.giftLanded}
      giftFrom={net.giftFrom}
      giftReadyAt={net.giftReadyAt}
      giftReach={net.giftReach}
      onGift={cfg.gifts ? net.sendGift : undefined}
      hidden={net.hidden}
      onHide={net.hide}
      onBlock={net.block}
      onReport={(s) => {
        // The player's own mail app: the nickname as the room has it, the
        // table, the time and the version; nothing about the reporter.
        const url = reportMailto(net.lang.s.ui, {
          name: net.realName(s),
          code: net.roomId ?? '',
          at: reportStamp(new Date()),
          version: APP_VERSION,
          // Whom it is about, by installation (identity.ts) - the one durable handle there is.
          id: net.installIdOf(s),
        });
        void Linking.openURL(url).catch(() => {});
      }}
    />
      {askOptIn && (
        <ConfirmDialog
          title={ui.voiceOptInTitle}
          body={ui.voiceOptInBody}
          confirmLabel={ui.voiceOptInYes}
          cancelLabel={ui.voiceOptInNo}
          ground={room().page}
          onConfirm={() => {
            setOptInAskedFor(net.roomId);
            net.voiceIn(true);
          }}
          onCancel={() => setOptInAskedFor(net.roomId)}
        />
      )}
      {conductAsk && (
        <ConfirmDialog
          title={ui.conductTitle}
          body={ui.conductBody}
          confirmLabel={ui.conductAccept}
          cancelLabel={ui.close}
          ground={room().page}
          onConfirm={() => {
            acceptConduct();
            setConductAsk(false);
          }}
          onCancel={() => setConductAsk(false)}
        />
      )}
    </>
  );
}

/** Everything that happens before four people are sitting down. */
function Waiting({ net, onExit }: { net: NetGame; onExit: () => void }) {
  // Laid out to the screen's measured box: the table above the invitation on
  // a phone held upright, beside it on a phone on its side, where stacked they
  // pushed both buttons under the fold.
  const [box, setBox] = useState({ w: 0, h: 0 });
  // What was just put on the clipboard: the code alone, or the whole invitation.
  const [copied, setCopied] = useState<'code' | 'invite' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The invite as a QR code, for friends at the same table: one scan instead
  // of reading a code out. Over everything, so the lobby does not reflow.
  const [qrOpen, setQrOpen] = useState(false);
  // Back - Android's, or the browser's - closes the code's picture, not the lobby.
  useBackCloses(qrOpen, () => setQrOpen(false));
  // The clipboard answers asynchronously; the game may have started by then.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const seated = net.seats.filter((s) => s.connected).length;
  const ui = net.lang.s.ui;
  // Quick play looks for strangers, and an empty server could keep a player
  // waiting forever: after a while with nobody new, starting with bots is
  // offered right under the status instead of among the invitation's buttons.
  const quick = !net.isPrivate;
  const [longWait, setLongWait] = useState(false);
  useEffect(() => {
    setLongWait(false);
    if (!quick || net.status !== 'waiting') return;
    const t = setTimeout(() => setLongWait(true), QUICK_BOTS_OFFER_MS);
    return () => clearTimeout(t);
  }, [quick, net.status, seated]);

  // A failure says what happened in the player's terms - a code nobody has
  // open, a table already playing, no connection - never the server's address
  // and the library's words, which is what it used to show.
  const message =
    net.status === 'connecting'
      ? ui.connecting
      : net.status === 'error'
        ? ui.joinFailed
        : net.status === 'disconnected'
          ? ui.connectionLost
          : quick
            ? ui.searchingPlayers(seated)
            : ui.waitingForPlayers(seated);
  const why =
    net.status === 'error'
      ? net.trouble === 'noSuchTable'
        ? ui.troubleNoSuchTable
        : net.trouble === 'tableClosed'
          ? ui.troubleTableClosed
          : net.trouble === 'sameNetwork'
            ? ui.troubleSameNetwork
            : net.trouble === 'appTooOld'
            ? ui.troubleAppTooOld
            : net.trouble === 'blocked'
              ? ui.troubleBlocked
              : net.trouble === 'banned'
                ? ui.troubleBanned
                : net.trouble === 'maintenance'
                  ? ui.troubleMaintenance
            : net.trouble === 'offline'
            ? ui.troubleOffline
            : ui.troubleServer
      : net.status === 'disconnected'
        ? ui.troubleDropped
        : null;
  const canRetry = (net.status === 'error' && retryHelps(net.trouble)) || net.status === 'disconnected';

  // Side by side whenever the screen is wider than tall and short enough that
  // the stacked lobby (about 610 dp with the bots button) would scroll.
  const land = box.w > box.h && box.h > 0 && box.h < LAND_MAX_H;
  // Short portrait phones (320x568 and the like) close the gaps up rather than scroll.
  const tight = !land && box.h > 0 && box.h < 640;
  const pad = land || tight ? space.md : space.xxl;
  const mapW = land
    ? Math.min(MAP_MAX_W, Math.round((box.w - 2 * pad - space.lg) * 0.5), Math.floor((box.h - 2 * pad) / SEAT_MAP_ASPECT))
    : Math.min(MAP_MAX_W, box.w - 2 * pad);
  const columnW = land ? Math.min(MAP_MAX_W, box.w - 2 * pad - space.lg - mapW) : mapW;

  const canStart =
    net.seat !== null && net.seat === net.hostSeat && net.status === 'waiting' && seated >= 1 && seated < 4;
  const offerBots = quick && longWait && canStart;

  // The link opens the app straight into this table; for anyone without the
  // app it lands on a page showing the code, with the browser game and the
  // store a tap away. The QR code carries the same link.
  const link = `https://belastih.com/join/${net.roomId}`;
  const flashCopied = (what: 'code' | 'invite') => {
    if (!mounted.current) return;
    setCopied(what);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };
  // The code alone, to paste into a chat that is already open.
  const copyCode = () => {
    const code = net.roomId;
    if (!code) return;
    void copyText(code).then((ok) => {
      if (ok) flashCopied('code');
    });
  };
  // The phone's share sheet: WhatsApp, Viber, Messenger - whatever is on it.
  // The invitation carries the code as well as the link, so a friend without
  // the app, or on the web, can still type it in.
  const invite = () => {
    const text = ui.inviteText(net.roomId ?? '', link);
    Share.share({ message: text }).catch((err: unknown) => {
      // A browser with no share sheet (most desktops) refuses at once, and the
      // button used to do nothing at all there: the invitation goes to the
      // clipboard instead, and the panel says so. A share the player
      // cancelled is not a failure, and a phone always has its share sheet.
      if (Platform.OS !== 'web' || (err as { name?: string } | null)?.name === 'AbortError') return;
      void copyText(text).then((ok) => {
        if (ok) flashCopied('invite');
      });
    });
  };

  const status = (
    <View style={styles.status}>
      {net.status === 'connecting' ? <ActivityIndicator color={theme.accent} size="large" /> : null}
      <Text style={styles.title}>{message}</Text>
      {why && <Text style={styles.why}>{why}</Text>}
      {canRetry && <Button label={ui.retry} tone="strong" onPress={net.retry} />}
      {net.status === 'error' && net.trouble === 'appTooOld' && <Button label={ui.updateApp} tone="strong" onPress={() => void Linking.openURL(STORE_URL).catch(() => {})} />}
      {offerBots && (
        <>
          <Text style={styles.hint}>{ui.nobodyYet}</Text>
          <Button label={ui.startWithBots} tone="strong" onPress={net.startWithBots} />
        </>
      )}
    </View>
  );

  const map =
    net.seats.length > 0 && mapW > 0 ? (
      <SeatMap
        width={mapW}
        seats={net.seats}
        mySeat={net.seat}
        hostSeat={net.hostSeat}
        canSit={net.status === 'waiting'}
        lang={net.lang}
        room={room()}
        anchors={net.anchors}
        onSit={net.sit}
      />
    ) : null;

  // The code sits with the words that say what to do with it and the button
  // that sends it — not under the pucks in the middle of the felt, where a
  // phone narrower than the table's plate hid it behind two of them.
  // Only while the table is there to be joined: a failed or dropped one's code
  // and invitation lead nowhere.
  const invitation =
    net.roomId && columnW > 0 && (net.status === 'waiting' || net.status === 'connecting') ? (
      <Panel style={[styles.invite, { width: columnW }]}>
        <View style={styles.codeBlock}>
          <Text style={styles.codeLabel}>{ui.tableCode}</Text>
          {/* The code copies itself: tap it, or the chip beside it. */}
          <PressScale
            onPress={copyCode}
            accessibilityRole="button"
            accessibilityLabel={ui.copyCodeLabel(net.roomId)}
            style={styles.codeRow}
          >
            <Text style={styles.code} numberOfLines={1} adjustsFontSizeToFit>
              {net.roomId}
            </Text>
            <View style={styles.copyChip}>
              <Copy size={15} colour={ink.mid} />
              <Text style={styles.copyText}>{ui.copy}</Text>
            </View>
          </PressScale>
          <Text style={styles.hint}>{ui.shareCode}</Text>
        </View>
        <View style={styles.inviteRow}>
          <View style={styles.inviteMain}>
            <Button label={ui.invite} tone="strong" onPress={invite} />
          </View>
          <Button label={ui.showQr} tone="plain" onPress={() => setQrOpen(true)} />
        </View>
        {/* An alert, so a screen reader says it the moment it appears. */}
        {copied !== null && (
          <Text style={styles.copied} role="alert">
            {copied === 'code' ? ui.codeCopied : ui.inviteCopied}
          </Text>
        )}
        {canStart && !offerBots && <Button label={ui.startWithBots} onPress={net.startWithBots} />}
      </Panel>
    ) : null;

  // A private table's rules in one place: how long the match runs, the
  // version (Učenje, Lagana or Prava bela) and the turn clock. The host picks,
  // everyone sees them before sitting down to play - friends were punished for
  // a wrong card nobody had said would cost the deal. Quick play keeps 1001,
  // Lagana and 30 s for strangers, and shows nothing here.
  const isHost = net.seat !== null && net.seat === net.hostSeat;
  const rules =
    net.isPrivate && net.status === 'waiting' && columnW > 0 ? (
      <View style={[styles.rules, { width: columnW }]}>
        <Choice
          label={ui.matchLength}
          host={isHost}
          options={MATCH_TARGETS_P.map((t) => ({ key: String(t), text: String(t), on: net.target === t }))}
          onPick={(k) => net.setRules({ target: Number(k) })}
        />
        <Choice
          label={net.lang.s.difficulty}
          host={isHost}
          options={PLAY_MODES.map((m) => ({ key: m, text: modeName(net.lang, m), on: net.mode === m }))}
          onPick={(k) => {
            if (isPlayMode(k)) net.setRules({ mode: k });
          }}
        />
        <Choice
          label={ui.turnClock}
          host={isHost}
          options={TURN_CHOICES_S.map((sec) => ({ key: String(sec), text: ui.seconds(sec), on: net.turnSeconds === sec }))}
          onPick={(k) => net.setClock(Number(k))}
        />
        <Choice
          label={ui.voiceRule}
          host={isHost}
          options={[
            { key: 'on', text: ui.voiceOn, on: net.voiceOn },
            { key: 'off', text: ui.voiceOff, on: !net.voiceOn },
          ]}
          onPick={(k) => net.setRules({ voice: k === 'on' })}
        />
      </View>
    ) : null;

  const back = <Button label={ui.back} tone="plain" onPress={onExit} />;

  const qrSize = Math.max(160, Math.min(320, Math.round(Math.min(box.w, box.h) * 0.72)));
  const qr = net.roomId ? (
    <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
      <Pressable style={styles.qrBackdrop} onPress={() => setQrOpen(false)} accessibilityLabel={ui.close}>
        <View style={styles.qrCard}>
          <QrCode text={link} size={qrSize} label={ui.qrLabel(net.roomId)} />
          <Text style={styles.qrCode} selectable>
            {net.roomId}
          </Text>
          <Text style={styles.qrHint}>{ui.qrHint}</Text>
          <Button label={ui.close} tone="plain" onPress={() => setQrOpen(false)} />
        </View>
      </Pressable>
    </Modal>
  ) : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: room().page }]}>
      <ScrollView
        contentContainerStyle={[styles.centre, { padding: pad, gap: tight ? space.md : space.lg + 2 }, land && styles.row]}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {qr}
        {land ? (
          <>
            {map}
            <View style={[styles.column, { width: columnW }]}>
              {status}
              {invitation}
              {rules}
              {back}
            </View>
          </>
        ) : (
          <>
            {status}
            {map}
            {invitation}
            {rules}
            {back}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One of the table's rules: its name, and the choices as a row of chips. Only
 * the host can change it; everyone else sees the chosen one lit.
 */
function Choice({
  label,
  host,
  options,
  onPick,
}: {
  label: string;
  host: boolean;
  options: { key: string; text: string; on: boolean }[];
  onPick: (key: string) => void;
}) {
  return (
    <View style={styles.choice}>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View style={styles.choiceRow} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => (
          <PressScale
            key={o.key}
            disabled={!host}
            onPress={() => {
              if (!o.on) onPick(o.key);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: o.on, disabled: !host }}
            style={[styles.choiceChip, o.on && styles.choiceChipOn, !host && !o.on && styles.choiceChipIdle]}
          >
            <Text style={[styles.choiceText, o.on && styles.choiceTextOn]} numberOfLines={1}>
              {o.text}
            </Text>
          </PressScale>
        ))}
      </View>
    </View>
  );
}

/** How long "copied" stays under the invite button. */
const COPIED_MS = 4000;
/** Quick play: how long with nobody new before starting with bots is offered. */
export const QUICK_BOTS_OFFER_MS = 15_000;
/** Neither the seat map nor the invitation beside it grows past this. */
const MAP_MAX_W = 420;
/** Taller than this and a screen on its side has room to stack (a big tablet). */
const LAND_MAX_H = 700;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.feltDeep },
  centre: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.lg },
  column: { alignItems: 'center', gap: space.md },
  status: { alignItems: 'center', gap: space.sm + 2 },
  title: { color: theme.text, fontSize: 20, fontFamily: font.bold, textAlign: 'center' },
  why: { color: ink.mid, ...type.sub, textAlign: 'center', maxWidth: 320 },
  invite: { gap: space.sm + 2 },
  inviteRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  inviteMain: { flex: 1 },
  qrBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: surface.scrim, padding: space.lg },
  qrCard: {
    alignItems: 'center',
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: theme.feltDeep,
    borderWidth: 1,
    borderColor: theme.line,
  },
  qrCode: { color: theme.accent, ...type.h1, letterSpacing: 2 },
  qrHint: { color: ink.mid, ...type.sub, textAlign: 'center', maxWidth: 280 },
  codeBlock: { alignItems: 'center', gap: 2 },
  codeLabel: { color: ink.mid, ...type.caption },
  code: { color: theme.accent, ...type.h1, letterSpacing: 2, textAlign: 'center' },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  copyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: surface.chip,
  },
  copyText: { color: ink.mid, ...type.caption, fontFamily: font.medium },
  hint: { color: ink.mid, ...type.sub, textAlign: 'center', marginTop: space.xs },
  copied: { color: theme.okInk, ...type.sub, textAlign: 'center' },
  rules: { gap: space.sm },
  // Label left, chips right: three rules in the height the clock alone took.
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  choiceLabel: { color: ink.mid, ...type.caption, width: 96 },
  // The chips take their names' width and share what is left; three versions
  // do not fit beside the label on a phone, so a chip that would be cut short
  // ("Prava b…") goes to a second line instead, and fills it.
  choiceRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 },
  choiceChip: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    paddingHorizontal: space.sm + 2,
    alignItems: 'center',
    paddingVertical: space.sm - 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: surface.chip,
  },
  choiceChipOn: { borderColor: theme.accent },
  choiceChipIdle: { opacity: 0.55 },
  choiceText: { color: ink.mid, fontFamily: font.medium, fontSize: 14 },
  choiceTextOn: { color: theme.accent },
});
