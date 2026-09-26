import { useRef, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { PressScale } from '../ui/PressScale';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useBackCloses } from '../ui/backGuard';
import type { Lang } from '@belot/i18n';
import type { PlayerProfile } from '@belot/progression';
import { loadBlocked, resetProfile, saveBlocked, type Settings, VOLUME_OPTIONS } from '../storage';
import { withoutBlock } from '../identity';
import { room, setDeckStyle } from '../cosmetics';
import { PlayingCard } from '../PlayingCard';
import { playSfx, setMasterVolume, setSoundEnabled } from '../audio';
import { font, ink, radius, space, surface, theme, type } from '../theme';
import { APP_VERSION, Panel, ScreenShell } from './common';
import { modeName, PLAY_MODES } from '../playMode';
import { runGolden } from '../../../../packages/engine/test/golden/run';

const LOCALES: ReadonlyArray<{ id: Settings['locale']; label: string }> = [
  { id: 'hr', label: 'Hrvatski' },
  { id: 'sr-Cyrl', label: 'Српски' },
  { id: 'en', label: 'English' },
];

/**
 * Every preference, in four sections a player can scan: who you are and
 * which language, how the game is played, how it looks and sounds, and the
 * data. Erasing the progress asks first and says what goes and what stays.
 */
export function SettingsScreen({
  lang,
  settings,
  onSettingsChange,
  onProfileChange,
  onBack,
  onOpenRules,
}: {
  lang: Lang;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  onProfileChange: (p: PlayerProfile) => void;
  onBack: () => void;
  /** "Kako se igra". */
  onOpenRules: () => void;
}) {
  const ui = lang.s.ui;
  const [asking, setAsking] = useState(false);
  // Players blocked on this device (identity.ts), with a way back.
  const [blocked, setBlocked] = useState(loadBlocked);
  // Dijagnostika (1.6.0): five taps on the version line. Its one tool replays the
  // golden corpus (packages/engine/test/golden) on THIS phone's JavaScript engine
  // and compares the play hash with the fixture the server's own tests use - the
  // proof that Hermes plays the rules byte for byte as Node and Chromium do.
  const taps = useRef<number[]>([]);
  const [diag, setDiag] = useState(false);
  const [golden, setGolden] = useState<{ ok: boolean; text: string } | null>(null);
  // A replay under way: its button stands dimmed, and another press starts nothing.
  const [replaying, setReplaying] = useState(false);
  const tapVersion = () => {
    const now = Date.now();
    // Six seconds for five taps: a harness's taps (Maestro) come slower than a thumb's.
    taps.current = [...taps.current.filter((t) => now - t < 6000), now];
    if (taps.current.length >= 5) setDiag(true);
  };
  const replayGolden = () => {
    if (replaying) return;
    setReplaying(true);
    setGolden(null);
    // The corpus holds the JavaScript thread for seconds on Hermes, and nothing
    // set in this press could show before it let go: the dimmed button (and the
    // last verdict gone) paint first, and the replay runs after.
    setTimeout(() => {
      const t0 = Date.now();
      try {
        const report = runGolden();
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- the fixture, as the tests read it
        const expected = require('../../../../packages/engine/test/golden/expected.json') as { hash: string; playHash: string };
        const ms = Date.now() - t0;
        const same = report.playHash === expected.playHash && report.hash === expected.hash;
        setGolden({ ok: same, text: same ? ui.diagOk(ms) : ui.diagDiff(report.playHash.slice(0, 8)) });
      } catch (e) {
        // A corpus that cannot even run on this engine is a difference too: say so, never crash the settings.
        setGolden({ ok: false, text: ui.diagDiff(String((e as Error)?.message ?? e).slice(0, 40)) });
      } finally {
        setReplaying(false);
      }
    }, 50);
  };
  // Back answers the question safely rather than leaving the settings under it.
  useBackCloses(asking, () => setAsking(false));

  const section = (title: string) => (
    <Text style={styles.section} accessibilityRole="header">
      {title}
    </Text>
  );

  const toggleRow = (label: string, value: boolean, set: (v: boolean) => void) => (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={(v) => {
          // The sound gate is applied by App's effect a commit later; set it
          // now too, or turning sound ON is silent and OFF clicks.
          if (label === ui.sound) setSoundEnabled(v);
          playSfx('tap');
          set(v);
        }}
        trackColor={{ false: 'rgba(255,255,255,0.15)', true: theme.accent }}
        thumbColor={theme.cardFace}
      />
    </View>
  );

  return (
    <ScreenShell
      title={ui.settings}
      onBack={onBack}
      backLabel={ui.back}
      overlay={
        asking && (
          <ConfirmDialog
            title={ui.resetTitle}
            body={ui.resetBody}
            confirmLabel={ui.resetYes}
            cancelLabel={ui.shopCancel}
            onConfirm={() => {
              setAsking(false);
              onProfileChange(resetProfile());
            }}
            onCancel={() => setAsking(false)}
            ground={room().page}
          />
        )
      }
    >
      {section(ui.setGeneral)}
      <Panel label={ui.nicknameLabel}>
        <TextInput
          value={settings.nickname}
          onChangeText={(nickname) => onSettingsChange({ ...settings, nickname })}
          placeholder={ui.nicknamePlaceholder}
          placeholderTextColor={ink.lo}
          maxLength={20}
          autoCorrect={false}
          accessibilityLabel={ui.nicknameLabel}
          style={styles.input}
        />
        {/* Play's user-content policy: the rules, accepted where the name is made. */}
        <PressScale
          onPress={() => {
            // The page says the rules in both languages; each anchor opens the
            // half this player reads (sr reads the hr half).
            void Linking.openURL(`https://belastih.com/#${ui.rulesAnchor}`).catch(() => {});
          }}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel={ui.nicknameRulesLabel}
        >
          <Text style={styles.hint}>{ui.nicknameRules} ↗</Text>
        </PressScale>
      </Panel>

      <Panel label={ui.language}>
        <View style={styles.localeRow}>
          {LOCALES.map((l) => (
            <PressScale
              key={l.id}
              onPress={() => {
                onSettingsChange({ ...settings, locale: l.id });
              }}
              accessibilityState={{ selected: settings.locale === l.id }}
              style={[styles.localeChip, settings.locale === l.id && styles.localeChipOn]}
            >
              <Text
                style={[styles.localeText, settings.locale === l.id && styles.localeTextOn]}
              >
                {l.label}
              </Text>
            </PressScale>
          ))}
        </View>
      </Panel>

      {section(ui.setGame)}
      <Button label={lang.s.rules.title} tone="plain" onPress={onOpenRules} />
      <Panel label={lang.s.difficulty}>
        <View style={styles.localeRow}>
          {PLAY_MODES.map((d) => (
            <PressScale
              key={d}
              testID={`mode-${d}`}
              onPress={() => {
                onSettingsChange({ ...settings, difficulty: d });
              }}
              accessibilityState={{ selected: settings.difficulty === d }}
              style={[styles.localeChip, settings.difficulty === d && styles.localeChipOn]}
            >
              <Text
                style={[styles.localeText, settings.difficulty === d && styles.localeTextOn]}
              >
                {modeName(lang, d)}
              </Text>
            </PressScale>
          ))}
        </View>
        {/* What the chosen one changes, whichever it is. */}
        <Text style={styles.hint}>
          {settings.difficulty === 'learn'
            ? lang.s.difficultyLearnHint
            : settings.difficulty === 'hard'
              ? lang.s.difficultyHardHint
              : lang.s.difficultyEasyHint}
        </Text>
      </Panel>

      <Panel label={ui.confirmPlayLabel}>
        <View style={styles.localeRow}>
          {(
            [
              { id: 'off', label: ui.confirmOff },
              { id: 'ambiguous', label: ui.confirmAmbiguous },
              { id: 'always', label: ui.confirmAlways },
            ] as const
          ).map((o) => (
            <PressScale
              key={o.id}
              onPress={() => {
                onSettingsChange({ ...settings, confirmPlay: o.id });
              }}
              accessibilityState={{ selected: settings.confirmPlay === o.id }}
              style={[styles.localeChip, settings.confirmPlay === o.id && styles.localeChipOn]}
            >
              <Text style={[styles.localeText, settings.confirmPlay === o.id && styles.localeTextOn]}>
                {o.label}
              </Text>
            </PressScale>
          ))}
        </View>
      </Panel>

      <Panel label={ui.sortHand}>
        <View style={styles.localeRow}>
          {(
            [
              { id: 'auto', label: ui.sortAuto },
              { id: 'suits', label: ui.sortSuits },
              { id: 'manual', label: ui.sortManual },
            ] as const
          ).map((o) => (
            <PressScale
              key={o.id}
              onPress={() => {
                onSettingsChange({ ...settings, handSort: o.id });
              }}
              accessibilityState={{ selected: settings.handSort === o.id }}
              style={[styles.localeChip, settings.handSort === o.id && styles.localeChipOn]}
            >
              <Text style={[styles.localeText, settings.handSort === o.id && styles.localeTextOn]}>
                {o.label}
              </Text>
            </PressScale>
          ))}
        </View>
        <Text style={styles.hint}>{ui.arrangeHint}</Text>
      </Panel>

      {section(ui.setLook)}
      <Panel>
        {toggleRow(ui.sound, settings.sound, (sound) => onSettingsChange({ ...settings, sound }))}
        {toggleRow(ui.haptics, settings.haptics, (haptics) =>
          onSettingsChange({ ...settings, haptics }),
        )}
        {/* How hard: meaningless while haptics are off, shown but asleep. */}
        <Text style={[styles.rowLabel, !settings.haptics && styles.asleep]}>{ui.hapticStrengthLabel}</Text>
        <View style={[styles.localeRow, !settings.haptics && styles.asleep]}>
          {(
            [
              { id: 'soft', label: ui.hapticStrengthSoft },
              { id: 'full', label: ui.hapticStrengthFull },
            ] as const
          ).map((o) => (
            <PressScale
              key={o.id}
              disabled={!settings.haptics}
              onPress={() => onSettingsChange({ ...settings, hapticStrength: o.id })}
              accessibilityState={{ selected: settings.hapticStrength === o.id }}
              style={[styles.localeChip, settings.hapticStrength === o.id && styles.localeChipOn]}
            >
              <Text style={[styles.localeText, settings.hapticStrength === o.id && styles.localeTextOn]}>{o.label}</Text>
            </PressScale>
          ))}
        </View>
        {toggleRow(ui.voiceSetting, settings.voice, (voice) => onSettingsChange({ ...settings, voice }))}
        {/* How the mic works: meaningless while voice is off, shown but asleep. */}
        <Text style={[styles.rowLabel, !settings.voice && styles.asleep]}>{ui.voiceModeLabel}</Text>
        <View style={[styles.localeRow, !settings.voice && styles.asleep]}>
          {(
            [
              { id: 'hold', label: ui.voiceModeHold },
              { id: 'tap', label: ui.voiceModeTap },
            ] as const
          ).map((o) => (
            <PressScale
              key={o.id}
              onPress={() => {
                onSettingsChange({ ...settings, voiceMode: o.id });
              }}
              accessibilityState={{ selected: settings.voiceMode === o.id }}
              style={[styles.localeChip, settings.voiceMode === o.id && styles.localeChipOn]}
            >
              <Text style={[styles.localeText, settings.voiceMode === o.id && styles.localeTextOn]}>
                {o.label}
              </Text>
            </PressScale>
          ))}
        </View>
        <Text style={styles.hint}>{ui.voiceSettingHint}</Text>
        {/* Loudness means nothing while the sound is off: shown, but asleep. */}
        <Text style={[styles.rowLabel, !settings.sound && styles.asleep]}>{ui.volumeLabel}</Text>
        <View style={[styles.localeRow, !settings.sound && styles.asleep]}>
          {(
            [
              { v: VOLUME_OPTIONS[0], label: ui.volumeQuiet },
              { v: VOLUME_OPTIONS[1], label: ui.volumeMedium },
              { v: VOLUME_OPTIONS[2], label: ui.volumeLoud },
            ] as const
          ).map((o) => (
            <PressScale
              key={o.v}
              disabled={!settings.sound}
              // Its own click already plays at the new level.
              onPressIn={() => setMasterVolume(o.v)}
              onPress={() => onSettingsChange({ ...settings, volume: o.v })}
              accessibilityState={{ selected: settings.volume === o.v }}
              style={[styles.localeChip, settings.volume === o.v && styles.localeChipOn]}
            >
              <Text style={[styles.localeText, settings.volume === o.v && styles.localeTextOn]}>
                {o.label}
              </Text>
            </PressScale>
          ))}
        </View>
        {/* The clips' own level, over the master: meaningless while voice is off. */}
        <Text style={[styles.rowLabel, !settings.voice && styles.asleep]}>{ui.voiceVolumeLabel}</Text>
        <View style={[styles.localeRow, !settings.voice && styles.asleep]}>
          {(
            [
              { v: VOLUME_OPTIONS[0], label: ui.volumeQuiet },
              { v: VOLUME_OPTIONS[1], label: ui.volumeMedium },
              { v: VOLUME_OPTIONS[2], label: ui.volumeLoud },
            ] as const
          ).map((o) => (
            <PressScale
              key={o.v}
              disabled={!settings.voice}
              onPress={() => onSettingsChange({ ...settings, voiceVolume: o.v })}
              accessibilityState={{ selected: settings.voiceVolume === o.v }}
              style={[styles.localeChip, settings.voiceVolume === o.v && styles.localeChipOn]}
            >
              <Text style={[styles.localeText, settings.voiceVolume === o.v && styles.localeTextOn]}>
                {o.label}
              </Text>
            </PressScale>
          ))}
        </View>
      </Panel>

      {section(ui.blockedPlayers)}
      <Panel>
        {blocked.length === 0 ? (
          <Text style={styles.hint}>{ui.blockedNone}</Text>
        ) : (
          blocked.map((b) => (
            <View key={b.id} style={styles.row}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {b.name || b.id.slice(0, 8)} · {b.at}
              </Text>
              <Button
                label={ui.unblock}
                tone="plain"
                onPress={() => {
                  const next = withoutBlock(blocked, b.id);
                  saveBlocked(next);
                  setBlocked(next);
                }}
              />
            </View>
          ))
        )}
      </Panel>

      <Panel label={lang.s.deckStyleLabel}>
        <View style={styles.localeRow}>
          {(
            [
              { id: 'madarice', label: lang.s.deckMadarice },
              { id: 'starinske', label: lang.s.deckStarinske },
              { id: 'francuske', label: lang.s.deckFrancuske },
              { id: 'simple', label: lang.s.deckSimple },
            ] as const
          ).map((d) => (
            <PressScale
              key={d.id}
              onPress={() => {
                setDeckStyle(d.id);
                onSettingsChange({ ...settings, deckStyle: d.id });
              }}
              accessibilityState={{ selected: settings.deckStyle === d.id }}
              style={[styles.localeChip, settings.deckStyle === d.id && styles.localeChipOn]}
            >
              <Text
                style={[styles.localeText, settings.deckStyle === d.id && styles.localeTextOn]}
              >
                {d.label}
              </Text>
            </PressScale>
          ))}
        </View>
        {/* live preview in the selected style */}
        <View style={styles.previewRow}>
          <PlayingCard card={{ suit: 'hearts', rank: 'A' }} size="lg" deckStyle={settings.deckStyle} locale={lang.id} />
          <PlayingCard card={{ suit: 'spades', rank: 'K' }} size="lg" deckStyle={settings.deckStyle} locale={lang.id} />
          <PlayingCard card={{ suit: 'clubs', rank: '10' }} size="lg" deckStyle={settings.deckStyle} locale={lang.id} />
        </View>
      </Panel>

      <Panel label={ui.motionLabel}>
        <View style={styles.localeRow}>
          {(
            [
              { id: 'system', label: ui.motionSystem },
              { id: 'full', label: ui.motionFull },
              { id: 'reduced', label: ui.motionReduced },
            ] as const
          ).map((o) => (
            <PressScale
              key={o.id}
              onPress={() => {
                onSettingsChange({ ...settings, motion: o.id });
              }}
              accessibilityState={{ selected: settings.motion === o.id }}
              style={[styles.localeChip, settings.motion === o.id && styles.localeChipOn]}
            >
              <Text style={[styles.localeText, settings.motion === o.id && styles.localeTextOn]}>
                {o.label}
              </Text>
            </PressScale>
          ))}
        </View>
        {/* The director's pace: how long each beat of a deal takes. */}
        <Text style={styles.rowLabel}>{ui.tempoLabel}</Text>
        <View style={styles.localeRow}>
          {(
            [
              { id: 'slow', label: ui.tempoSlow },
              { id: 'normal', label: ui.tempoNormal },
              { id: 'fast', label: ui.tempoFast },
            ] as const
          ).map((o) => (
            <PressScale
              key={o.id}
              onPress={() => onSettingsChange({ ...settings, tempo: o.id })}
              accessibilityState={{ selected: settings.tempo === o.id }}
              style={[styles.localeChip, settings.tempo === o.id && styles.localeChipOn]}
            >
              <Text style={[styles.localeText, settings.tempo === o.id && styles.localeTextOn]}>{o.label}</Text>
            </PressScale>
          ))}
        </View>
        {toggleRow(ui.bigCards, settings.bigCards, (bigCards) => onSettingsChange({ ...settings, bigCards }))}
        <Text style={styles.hint}>{ui.bigCardsHint}</Text>
      </Panel>

      {section(ui.setData)}
      <Panel>
        <PressScale onPress={() => setAsking(true)} style={styles.resetButton}>
          <Text style={styles.resetText}>{ui.resetProgress}</Text>
        </PressScale>
      </Panel>

      {/* Google Play's User Data policy requires the policy reachable in-app. */}
      <Panel>
        <PressScale
          onPress={() => {
            void Linking.openURL('https://belastih.com').catch(() => {});
          }}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel={ui.privacyPolicy}
        >
          <Text style={styles.link}>{ui.privacyPolicy} ↗</Text>
        </PressScale>
      </Panel>

      <Text style={styles.version} testID="version" onPress={tapVersion}>
        {ui.version} {APP_VERSION}
      </Text>
      {diag && (
        <Panel label={ui.diagTitle}>
          <Button label={ui.diagGolden} tone="plain" testID="diag-golden" disabled={replaying} onPress={replayGolden} />
          {/* One Text: a nested one is a span on Android and its testID reaches no harness. */}
          {golden && (
            <Text style={styles.hint} testID={golden.ok ? 'golden-ok' : 'golden-diff'}>
              {golden.text}
            </Text>
          )}
        </Panel>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  // A section's name: above its panels, a step louder than a panel's label.
  section: { color: theme.accent, ...type.h3, marginTop: space.sm },
  input: {
    color: ink.hi,
    backgroundColor: surface.chip,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg - 2,
    paddingVertical: space.sm + 2,
    ...type.body,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: theme.text, fontSize: 15, fontFamily: font.regular },
  asleep: { opacity: 0.4 },

  // The chips share the row equally, but never below the width their own
  // words need: four of them in a 320 dp column gave each 72 dp, which turned
  // "Mađarice" into a circle and broke "Jednostavne" across two lines. Below
  // the minimum the row wraps instead, and each chip grows to fill its line.
  localeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  localeChip: {
    flex: 1,
    minWidth: 88,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.line,
    paddingVertical: 9,
    alignItems: 'center',
  },
  localeChipOn: { borderColor: theme.accent, backgroundColor: 'rgba(216,165,49,0.14)' },
  localeText: { color: theme.textDim, fontSize: 13, fontFamily: font.medium },
  localeTextOn: { color: theme.accent },

  resetButton: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.danger,
    paddingVertical: 10,
    alignItems: 'center',
  },
  resetText: { color: theme.text, fontSize: 14, fontFamily: font.bold },

  hint: { color: theme.textDim, fontSize: 12, lineHeight: 17, fontFamily: font.regular, marginTop: 10 },
  previewRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 12 },
  link: { color: theme.accent, fontSize: 15, fontFamily: font.medium, textAlign: 'center' },
  version: { color: theme.textDim, fontSize: 12, fontFamily: font.regular, textAlign: 'center' },
});
