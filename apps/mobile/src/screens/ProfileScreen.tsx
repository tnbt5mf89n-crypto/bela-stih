import { useMemo } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Lang } from '@belot/i18n';
import {
  COSMETICS,
  isOwned,
  levelProgress,
  selectCosmetic,
  type PlayerProfile,
} from '@belot/progression';
import { Avatar } from '../avatars';
import { Button } from '../ui/Button';
import { PressScale } from '../ui/PressScale';
import { loadHistory, type Settings } from '../storage';
import { totals } from '../net/history';
import { font, ink, num, radius, space, stroke, surface, theme, type } from '../theme';
import { Panel, ScreenShell } from './common';

/**
 * Identity and the lifetime numbers - and now the identity is set right here:
 * the name friends see and the face, among the ones already owned. The XP
 * says how far to the next level and what it opens; the evenings with friends
 * are summed up above their full history.
 */
export function ProfileScreen({
  lang,
  profile,
  settings,
  onSettingsChange,
  onProfileChange,
  onOpenShop,
  onOpenHistory,
  onBack,
}: {
  lang: Lang;
  profile: PlayerProfile;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  onProfileChange: (p: PlayerProfile) => void;
  onOpenShop: () => void;
  /** The matches with friends and their statistics. */
  onOpenHistory: () => void;
  onBack: () => void;
}) {
  const ui = lang.s.ui;
  const p = levelProgress(profile.xp);
  const winRate =
    profile.matchesPlayed > 0
      ? `${Math.round((profile.matchesWon / profile.matchesPlayed) * 100)}%`
      : '—';

  const stats: Array<[string, string]> = [
    [ui.statMatches, `${profile.matchesWon}/${profile.matchesPlayed}`],
    [ui.statWinRate, winRate],
    [ui.statDeals, `${profile.dealsWon}/${profile.dealsPlayed}`],
    [ui.statZvanja, String(profile.zvanjaCalled)],
    [ui.statBela, String(profile.belaCalled)],
    [ui.statValat, String(profile.valats)],
    [ui.statBestDeal, String(profile.bestDealScore)],
    [ui.statGifts, String(profile.giftsSent)],
  ];

  // The faces this player owns, to wear one; more are in the shop.
  const owned = COSMETICS.filter((c) => c.kind === 'avatar' && isOwned(profile, c));
  // What the next level (or the one after, if nothing opens at the next) brings.
  const next = COSMETICS.filter((c) => c.requiredLevel > p.level).sort((a, b) => a.requiredLevel - b.requiredLevel)[0];
  // The evenings with friends, from the history on this device.
  const friends = useMemo(() => totals(loadHistory()), []);

  return (
    <ScreenShell title={ui.profile} onBack={onBack} backLabel={ui.back}>
      <View style={styles.identity}>
        <Avatar id={profile.selectedAvatar} size={88} />
        {/* The name other players see, set where it shows; the conduct rules
            are accepted where it is typed, as in Settings. */}
        <TextInput
          value={settings.nickname}
          onChangeText={(nickname) => onSettingsChange({ ...settings, nickname })}
          placeholder={ui.nicknamePlaceholder}
          placeholderTextColor={ink.lo}
          maxLength={20}
          autoCorrect={false}
          accessibilityLabel={ui.nicknameLabel}
          style={styles.nameInput}
        />
        <PressScale
          onPress={() => {
            void Linking.openURL(`https://belastih.com/#${ui.rulesAnchor}`).catch(() => {});
          }}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel={ui.nicknameRulesLabel}
        >
          <Text style={styles.hint}>{ui.nicknameRules} ↗</Text>
        </PressScale>

        {owned.length > 1 && (
          <View style={styles.faces} accessibilityRole="radiogroup" accessibilityLabel={ui.sectionAvatars}>
            {owned.map((c) => {
              const on = profile.selectedAvatar === c.id;
              return (
                <PressScale
                  key={c.id}
                  onPress={() => {
                    if (!on) onProfileChange(selectCosmetic(profile, c));
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={ui.cosmeticName(c.id)}
                  accessibilityState={{ checked: on }}
                  style={[styles.face, on && styles.faceOn]}
                >
                  <Avatar id={c.id} size={40} />
                </PressScale>
              );
            })}
          </View>
        )}

        <View style={styles.levelRow}>
          <Text style={styles.level}>
            {ui.level} {p.level}
          </Text>
          <View style={styles.xpTrack}>
            <View style={[styles.xpFill, { width: `${Math.round(p.fraction * 100)}%` }]} />
          </View>
          <Text style={[styles.xpNumbers, num]}>
            {p.isMax ? ui.xpMax : ui.xpToNext(p.xp - p.levelStart, p.levelEnd - p.levelStart, p.level + 1)}
          </Text>
          {next && <Text style={styles.next}>{ui.nextUnlock(next.requiredLevel, ui.cosmeticName(next.id))}</Text>}
        </View>
        <Button label={ui.shop} tone="plain" onPress={onOpenShop} />
      </View>

      {/* the two numbers that matter, as headlines */}
      <View style={styles.headlines}>
        <View style={styles.headline}>
          <Text style={styles.headlineValue}>{profile.matchesWon}</Text>
          <Text style={styles.headlineLabel} numberOfLines={1}>
            {ui.wins}
          </Text>
        </View>
        <View style={styles.headline}>
          <Text style={styles.headlineValue}>{winRate}</Text>
          <Text style={styles.headlineLabel} numberOfLines={1}>
            {ui.statWinRate}
          </Text>
        </View>
      </View>

      <Panel>
        {profile.matchesPlayed === 0 && <Text style={styles.empty}>{ui.profileEmpty}</Text>}
        {stats.map(([label, value]) => (
          <View key={label} style={styles.statRow}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{value}</Text>
          </View>
        ))}
      </Panel>
      {friends.played > 0 && <Text style={styles.friends}>{ui.friendsLine(friends.played, friends.rate)}</Text>}
      <Button label={ui.historyOpen} tone="plain" onPress={onOpenHistory} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: 10 },
  nameInput: {
    alignSelf: 'stretch',
    color: ink.hi,
    backgroundColor: surface.chip,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg - 2,
    paddingVertical: space.sm + 2,
    textAlign: 'center',
    ...type.h3,
  },
  hint: { color: theme.textDim, fontSize: 12, lineHeight: 17, fontFamily: font.regular, textAlign: 'center' },
  faces: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
  face: { padding: 2, borderRadius: 24, borderWidth: 2, borderColor: 'transparent' },
  faceOn: { borderColor: theme.accent },
  levelRow: { alignSelf: 'stretch', gap: 6, alignItems: 'center' },
  level: { color: theme.textDim, fontSize: 13, fontFamily: font.regular },
  xpTrack: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: surface.chip,
    overflow: 'hidden',
  },
  xpFill: { height: 8, borderRadius: radius.pill, backgroundColor: theme.accent },
  xpNumbers: { color: ink.mid, ...type.caption },
  next: { color: theme.accent, ...type.caption, fontFamily: font.medium, textAlign: 'center' },

  headlines: { flexDirection: 'row', gap: space.sm + 2 },
  headline: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: surface.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: stroke.hair,
    paddingVertical: space.md,
  },
  headlineValue: { color: theme.accent, ...type.display, fontFamily: font.black, ...num },
  headlineLabel: { color: ink.mid, ...type.caption },
  empty: { color: ink.mid, ...type.sub, marginBottom: space.sm },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel: { color: theme.textDim, fontSize: 14, fontFamily: font.regular },
  statValue: { color: theme.text, fontSize: 14, fontFamily: font.bold },
  friends: { color: ink.mid, ...type.sub, textAlign: 'center' },
});
