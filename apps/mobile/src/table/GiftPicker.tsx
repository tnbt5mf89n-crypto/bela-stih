import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Seat } from '@belot/engine';
import type { Lang } from '@belot/i18n';
import { GIFTS, giftBlock, giftCost, type GiftId, type PlayerProfile } from '@belot/progression';
import { GiftArt } from '../giftArt';
import { depth, font, ink, num, radius, stroke, surface, theme, type } from '../theme';
import { Button } from '../ui/Button';
import { Close, Coin, Flag, Lock } from '../ui/icons';
import { REPORT_EMAIL } from '../report';
import { PressScale } from '../ui/PressScale';
import { GIFT_PICKER, giftPickerLayout, playerViewMax } from './metrics';

/**
 * The gift picker: opened from a puck, it offers the whole catalogue with
 * prices, for that player or — one chip over — everyone else at the table;
 * opened from my own puck it is a treat for the table. Choosing is two steps
 * (pick, then "Pošalji · N"), because every gift is coins spent.
 *
 * An overlay over the table, like the leave question: no row of the table
 * moves when it opens. Drawn to the box by `giftPickerLayout`, and the
 * player view by `playerViewMax`.
 */
export function GiftPicker({
  lang,
  target,
  mySeat,
  reach,
  nameOf,
  profile,
  readyAt,
  land,
  reduced,
  ground,
  onSend,
  onClose,
  moderate,
  moderating,
  onModerate,
}: {
  lang: Lang;
  /** A seat, or 'table' when opened from my own puck. */
  target: Seat | 'table';
  mySeat: Seat;
  /** Who can be given a gift (online, an older app cannot); everyone when absent. */
  reach?: readonly boolean[];
  nameOf: (s: Seat) => string;
  profile: PlayerProfile;
  /** My cooldown: no gift before this instant. */
  readyAt: number;
  land: boolean;
  reduced: boolean;
  /** The room's page colour, so it reads as part of the table. */
  ground: string;
  onSend: (id: GiftId, to: Seat | 'table') => void;
  onClose: () => void;
  /** Online, another player's puck: hide them on this device, or report them. */
  moderate?: { hidden: boolean; onHide: () => void; onReport: () => void; muted?: boolean; onMute?: () => void; onBlock?: () => void };
  /**
   * Showing the player view (hide / report) rather than the gifts. The table
   * owns this, not the picker: it opens straight into the player view when no
   * gift can be sent, and it must know which of the two is on screen before it
   * takes the panel away - a grid whose moment has passed goes, a report
   * someone is in the middle of stays.
   */
  moderating: boolean;
  /** The pill in the header: from here on this panel is the player view. */
  onModerate: () => void;
}) {
  const ui = lang.s.ui;
  const { width, height } = useWindowDimensions();
  const L = giftPickerLayout(width, height, land, GIFTS.length);
  // The player view gets what the safe box leaves under the header, and
  // scrolls beyond it: sideways its four actions are taller than a phone.
  const insets = useSafeAreaInsets();
  const playerMax = playerViewMax(height - insets.top - insets.bottom);
  const [everyone, setEveryone] = useState(target === 'table');
  const [chosen, setChosen] = useState<GiftId | null>(null);
  const to: Seat | 'table' = everyone || target === 'table' ? 'table' : target;
  const can = (s: Seat) => reach?.[s] ?? true;
  const others = ([0, 1, 2, 3] as Seat[]).filter((s) => s !== mySeat && can(s)).length;
  const recipients = to === 'table' ? others : can(to) ? 1 : 0;
  // Nobody it could reach: an older app, or a table of them. Prices still
  // show, for one.
  const nobody = recipients === 0;
  const priced = Math.max(1, recipients);

  // The cooldown ends by itself: one re-render at its end.
  const [now, setNow] = useState(() => Date.now());
  const cooling = now < readyAt;
  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => setNow(Date.now()), readyAt - now + 20);
    return () => clearTimeout(t);
  }, [cooling, readyAt, now]);

  const chosenBlock = chosen ? giftBlock(profile, chosen, priced) : null;
  const chosenGift = chosen ? GIFTS.find((g) => g.id === chosen) : undefined;
  const total = chosenGift ? giftCost(chosenGift, priced) : 0;
  const canSend = !!chosen && chosenBlock === null && !cooling && !nobody;
  const note = nobody
    ? to === 'table'
      ? ui.giftNobodySees
      : ui.giftNotSeen
    : cooling
      ? ui.giftWait
      : chosen && chosenBlock === 'coins'
        ? ui.giftNoCoins
        : ui.giftForFun;

  // Who it is for is the first chip; the title says what the sheet does.
  const title =
    moderating && target !== 'table' ? ui.playerTitle(nameOf(target)) : target === 'table' ? ui.giftTreatTable : ui.giftSend;

  const chips =
    target === 'table' ? null : (
      <View style={styles.chips}>
        {(others > 0 ? [false, true] : [false]).map((all) => {
          const on = everyone === all;
          return (
            <PressScale
              key={String(all)}
              onPress={() => setEveryone(all)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              hitSlop={{ top: 7, bottom: 7 }}
              // A long name gives way (ellipsized), never the other chip.
              style={[styles.chip, !all && styles.chipName, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                {all ? ui.giftToEveryone(others) : nameOf(target)}
              </Text>
            </PressScale>
          );
        })}
      </View>
    );

  const grid = (
    <View style={[styles.grid, { width: L.cols * L.cell + (L.cols - 1) * GIFT_PICKER.GAP }]}>
      {GIFTS.map((g) => {
        const block = giftBlock(profile, g.id, priced);
        const locked = block === 'level';
        const disabled = locked || cooling || nobody;
        const selected = chosen === g.id;
        const name = ui.giftName(g.id);
        const price = giftCost(g, priced);
        const label = locked
          ? `${name}, ${ui.needsLevel(g.requiredLevel)}`
          : block === 'coins'
            ? `${ui.giftCellLabel(name, price)}, ${ui.giftNoCoins}`
            : ui.giftCellLabel(name, price);
        return (
          <PressScale
            key={g.id}
            disabled={disabled}
            onPress={() => setChosen(g.id)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled, selected }}
            scaleTo={0.94}
            style={[styles.cell, { width: L.cell, height: L.cell + GIFT_PICKER.CAPTION }, selected && styles.cellOn]}
          >
            <View style={(disabled || block === 'coins') && styles.dim}>
              <GiftArt id={g.id} size={L.cell - 12} disc />
            </View>
            <View style={styles.caption}>
              {locked ? (
                // The lock and the level's number: "Nivo 10" wrapped in a
                // 49 dp cell, and "Level 10" never fitted at all. The label
                // above says the whole thing.
                <>
                  <Lock size={10} colour={ink.mid} />
                  <Text style={[styles.captionText, num]} numberOfLines={1}>
                    {g.requiredLevel}
                  </Text>
                </>
              ) : (
                <>
                  <Coin size={10} />
                  <Text style={[styles.captionText, num, block === 'coins' && styles.captionShort]}>{price}</Text>
                </>
              )}
            </View>
          </PressScale>
        );
      })}
    </View>
  );

  const send = (
    <Button
      label={chosen ? ui.giftSendFor(total) : ui.giftSend}
      tone="strong"
      disabled={!canSend}
      onPress={() => {
        if (chosen && canSend) onSend(chosen, to);
      }}
      style={land ? styles.sendLand : styles.send}
    />
  );

  return (
    <Animated.View entering={reduced ? undefined : FadeIn.duration(140)} style={styles.backdrop} accessibilityViewIsModal>
      {/* A tap beside the panel closes it; nothing has been spent yet. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={ui.close} />
      <View style={[styles.panel, { width: L.panelW, backgroundColor: ground }]}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {land && !moderating && chips}
          {moderate && !moderating && (
            <PressScale
              onPress={onModerate}
              accessibilityRole="button"
              accessibilityLabel={ui.reportOpenLabel}
              hitSlop={{ top: 7, bottom: 7 }}
              style={[styles.chip, styles.reportPill]}
            >
              <Flag size={12} colour={ink.mid} />
              <Text style={styles.chipText} numberOfLines={1}>
                {ui.reportOpen}
              </Text>
            </PressScale>
          )}
          <View style={styles.wallet}>
            <Coin size={12} />
            <Text style={[styles.walletText, num]}>{profile.coins}</Text>
          </View>
          <PressScale onPress={onClose} accessibilityRole="button" accessibilityLabel={ui.close} hitSlop={8} style={styles.close}>
            <Close size={16} />
          </PressScale>
        </View>
        {moderating && moderate ? (
          <ScrollView style={[styles.playerScroll, { maxHeight: playerMax }]} contentContainerStyle={styles.player} persistentScrollbar>
            <Button label={moderate.hidden ? ui.showPlayer : ui.hidePlayer} tone="strong" onPress={moderate.onHide} style={styles.send} />
            <Text style={styles.note}>{ui.hidePlayerNote}</Text>
            {/* For good, and everywhere: quick play keeps them away, nothing of theirs arrives. */}
            {moderate.onBlock && (
              <>
                <Button label={ui.blockPlayer} tone="plain" onPress={moderate.onBlock} style={styles.send} />
                <Text style={styles.note}>{ui.blockPlayerNote}</Text>
              </>
            )}
            {/* A player fine to see but not to hear; hiding already silences. */}
            {moderate.onMute && !moderate.hidden && (
              <>
                <Button label={moderate.muted ? ui.unmuteVoice : ui.muteVoice} tone="plain" onPress={moderate.onMute} style={styles.send} />
                <Text style={styles.note}>{ui.muteVoiceNote}</Text>
              </>
            )}
            <Button label={ui.reportPlayer} tone="plain" onPress={moderate.onReport} style={styles.send} />
            <Text style={styles.note}>{ui.reportPlayerNote}</Text>
            <Text style={styles.note} selectable>
              {ui.reportFallback(REPORT_EMAIL)}
            </Text>
          </ScrollView>
        ) : (
          <>
            {!land && chips}
            {L.scroll ? <ScrollView style={{ maxHeight: L.gridMax }}>{grid}</ScrollView> : grid}
            {land ? (
              <View style={styles.footRow}>
                <Text style={[styles.note, styles.noteLand]} numberOfLines={2}>
                  {note}
                </Text>
                {send}
              </View>
            ) : (
              <>
                <Text style={styles.note} numberOfLines={2}>
                  {note}
                </Text>
                {send}
              </>
            )}
          </>
        )}
      </View>
    </Animated.View>
  );
}

const P = GIFT_PICKER;

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: surface.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: stroke.edge,
    padding: P.PAD,
    gap: P.GAP,
    alignItems: 'center',
    boxShadow: depth.sheet,
  },
  header: { alignSelf: 'stretch', height: P.HEADER, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flexShrink: 1, color: ink.hi, ...type.h3 },
  wallet: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 },
  walletText: { color: theme.accent, ...type.sub, fontFamily: font.bold },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  chips: {
    flexDirection: 'row',
    gap: P.GAP,
    height: P.CHIPS,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    flexShrink: 1,
    minWidth: 0,
  },
  chip: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: stroke.hair,
    backgroundColor: surface.chip,
    justifyContent: 'center',
    maxWidth: 170,
  },
  chipName: { flexShrink: 1, minWidth: 0 },
  reportPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  playerScroll: { alignSelf: 'stretch' },
  player: { alignSelf: 'stretch', gap: P.GAP },
  chipOn: { borderColor: theme.accent },
  chipText: { color: ink.mid, ...type.sub },
  chipTextOn: { color: ink.hi, fontFamily: font.medium },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: P.GAP },
  cell: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: stroke.hair,
    backgroundColor: surface.raised,
  },
  cellOn: { borderColor: theme.accent, backgroundColor: surface.chip },
  dim: { opacity: 0.45 },
  caption: { height: P.CAPTION, flexDirection: 'row', alignItems: 'center', gap: 2 },
  captionText: { color: ink.hi, ...type.caption },
  captionShort: { color: ink.mid },
  note: { alignSelf: 'stretch', minHeight: P.NOTE, color: ink.mid, ...type.caption, textAlign: 'center', textAlignVertical: 'center' },
  noteLand: { flex: 1, textAlign: 'left', minHeight: 0 },
  send: { alignSelf: 'stretch', height: P.SEND },
  sendLand: { height: P.SEND, minWidth: 160 },
  footRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, height: P.SEND },
});
