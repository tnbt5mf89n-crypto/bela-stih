import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../avatars';
import { AVATAR_IDS } from '../avatarIds';
import type { RoomStyle } from '../cosmetics';
import { garb } from '../deck/palette';
import { FeltArt } from '../table/FeltArt';
import { font, radius, stroke } from '../theme';
import { PressScale } from '../ui/PressScale';
import { guestsFor } from './guests';
import { HERO_ASPECT, heroLayout } from './heroLayout';

/**
 * The home screen's table: a real felt, two of the house's characters
 * already sitting at the far side (a different pair each day), your own
 * avatar in your chair, and the one word that starts a game on the baize.
 *
 * Its box is reserved by aspect ratio before the first paint, and the art is
 * drawn to the width that box measures — the column's content width, so a
 * browser's scrollbar is not counted in it. Measured from a parent instead,
 * the lobby mounted without the hero and dropped every panel 329 px when
 * the width arrived a frame later.
 *
 * Every position and the word's own size come from `heroLayout`, which the
 * test holds to one rule: the word never lands on a character.
 */
export const TableHero = memo(function TableHero({
  avatar,
  day,
  label,
  room,
  onPress,
  testID,
}: {
  /** The player's own avatar id. */
  avatar: string;
  /** Today's ISO day: picks which two characters sit across. */
  day: string;
  label: string;
  room: RoomStyle;
  onPress: () => void;
  testID?: string;
}) {
  const [width, setWidth] = useState(0);
  const guests = guestsFor(day, avatar, AVATAR_IDS);
  const l = width > 0 ? heroLayout(width, label) : null;
  return (
    <View
      style={styles.box}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
      }}
    >
      {l && (
        <PressScale onPress={onPress} scaleTo={0.985} style={StyleSheet.absoluteFill} testID={testID}>
          <FeltArt width={l.width} height={l.height} room={room} grain={false} />
          {/* the two across the table */}
          <View style={[styles.guest, { top: l.guestTop, left: l.guestInset }]}>
            <Avatar id={guests[0]!} size={l.seat} />
          </View>
          <View style={[styles.guest, { top: l.guestTop, right: l.guestInset }]}>
            <Avatar id={guests[1]!} size={l.seat} />
          </View>
          {/* you, in your chair */}
          <View style={[styles.you, { bottom: l.youBottom }]}>
            <Avatar id={avatar} size={l.youSize} />
          </View>
          {/* the word on the baize */}
          <View style={styles.centre} pointerEvents="none">
            <View style={[styles.pill, { paddingHorizontal: l.pill.padH, paddingVertical: l.pill.padV }]}>
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  { fontSize: l.pill.fontSize, lineHeight: l.pill.lineHeight, letterSpacing: l.pill.letterSpacing },
                ]}
              >
                {label}
              </Text>
            </View>
          </View>
        </PressScale>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  /** The table's box, reserved before the width is known so nothing jumps. */
  box: { alignSelf: 'stretch', aspectRatio: HERO_ASPECT },
  guest: { position: 'absolute' },
  you: { position: 'absolute', alignSelf: 'center' },
  centre: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    backgroundColor: garb.gold,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: stroke.lit,
  },
  label: { color: garb.ink, fontFamily: font.black },
});
