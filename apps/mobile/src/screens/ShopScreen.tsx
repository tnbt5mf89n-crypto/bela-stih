import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PressScale } from '../ui/PressScale';
import { Check, Coin, Lock } from '../ui/icons';
import { garb } from '../deck/palette';
import type { Lang } from '@belot/i18n';
import {
  canBuy,
  buy,
  isOwned,
  levelFromXp,
  selectCosmetic,
  selectedId,
  COSMETICS,
  type Cosmetic,
  type PlayerProfile,
} from '@belot/progression';
import { Avatar } from '../avatars';
import { roomStyle } from '../cosmetics';
import { FeltArt } from '../table/FeltArt';
import { CardBackFace } from '../deck';
import { playSfx } from '../audio';
import { pattern } from '../haptics';
import { font, radius, space, stroke, surface, theme } from '../theme';
import { room } from '../cosmetics';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useBackCloses } from '../ui/backGuard';
import { Shake } from '../ui/Shake';
import { Panel, ScreenShell } from './common';

/** How long a "why not" stays under the wallet. */
const WHY_MS = 3500;
/** A refused tap's "no", a whisper of the server's refusal. */
const DENIED_SOFT = 0.45;

/**
 * The only coin sink: cosmetics. Deliberately no bundles, no timers, no
 * "offers" — a fixed catalogue with visible prices keeps the coins reading as
 * a reward, not a wallet.
 */
export function ShopScreen({
  lang,
  profile,
  onProfileChange,
  onBack,
}: {
  lang: Lang;
  profile: PlayerProfile;
  onProfileChange: (p: PlayerProfile) => void;
  onBack: () => void;
}) {
  const ui = lang.s.ui;
  const level = levelFromXp(profile.xp);
  // A purchase asks first: coins are earned slowly, and a tile is easy to brush.
  const [confirming, setConfirming] = useState<Cosmetic | null>(null);
  // Back answers the question safely rather than leaving the shop under it.
  useBackCloses(confirming !== null, () => setConfirming(null));
  // Why a tile cannot be had, when it is tapped anyway.
  const [why, setWhy] = useState<string | null>(null);
  const whyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The tile a refused tap shook, and a count so the same one can shake again.
  const [shake, setShake] = useState<{ id: string | null; n: number }>({ id: null, n: 0 });
  useEffect(() => () => {
    if (whyTimer.current) clearTimeout(whyTimer.current);
  }, []);
  const sayWhy = (text: string) => {
    playSfx('denied', { gain: DENIED_SOFT });
    pattern('error');
    setWhy(text);
    if (whyTimer.current) clearTimeout(whyTimer.current);
    whyTimer.current = setTimeout(() => setWhy(null), WHY_MS);
  };

  const act = (c: Cosmetic) => {
    if (isOwned(profile, c)) {
      if (selectedId(profile, c.kind) !== c.id) {
        playSfx('tap');
        onProfileChange(selectCosmetic(profile, c));
      }
    } else if (level < c.requiredLevel) {
      setShake((s) => ({ id: c.id, n: s.n + 1 }));
      sayWhy(ui.shopWhyLocked(c.requiredLevel, level));
    } else if (!canBuy(profile, c)) {
      setShake((s) => ({ id: c.id, n: s.n + 1 }));
      sayWhy(ui.shopWhyCoins(c.price - profile.coins));
    } else {
      playSfx('tap');
      setConfirming(c);
    }
  };
  const confirmBuy = () => {
    const c = confirming;
    setConfirming(null);
    if (!c || !canBuy(profile, c)) return;
    playSfx('purchase');
    pattern('purchase');
    onProfileChange(buy(profile, c));
  };

  const section = (kind: Cosmetic['kind'], label: string) => {
    const items = COSMETICS.filter((c) => c.kind === kind);
    return (
      <Panel label={label}>
        <View style={styles.grid}>
          {items.map((c) => {
            const owned = isOwned(profile, c);
            const selected = owned && selectedId(profile, c.kind) === c.id;
            const affordable = canBuy(profile, c);
            const locked = !owned && level < c.requiredLevel;
            return (
              <Shake key={c.id} n={shake.id === c.id ? shake.n : 0} style={styles.slot}>
              <PressScale
                onPress={() => act(c)}
                // Locked and unaffordable tiles still answer, to say why.
                disabled={selected}
                style={[styles.item, selected && styles.itemSelected]}
                sound={null}
                scaleTo={0.98}
              >
                <View style={styles.preview}>
                  {kind === 'cardBack' ? (
                    <CardBackFace width={38} variant={c.id} />
                  ) : kind === 'felt' ? (
                    <View style={styles.feltSwatch}>
                      <FeltArt width={46} height={46} room={roomStyle(c.id)} grain={false} rim={4} />
                    </View>
                  ) : (
                    <Avatar id={c.id} size={46} />
                  )}
                </View>
                <Text style={styles.itemName} numberOfLines={1}>
                  {ui.cosmeticName(c.id)}
                </Text>
                {selected ? (
                  <Text style={styles.selected}>{ui.selected}</Text>
                ) : owned ? (
                  <Text style={styles.select}>{ui.select}</Text>
                ) : locked ? (
                  // The price too, so a player can save up while levelling.
                  <View style={styles.priceRow}>
                    <Text style={styles.locked} numberOfLines={1}>
                      {ui.needsLevel(c.requiredLevel)} · {c.price}
                    </Text>
                    <Coin size={11} />
                  </View>
                ) : (
                  <View style={styles.priceRow}>
                    <Text style={[styles.price, !affordable && styles.locked]}>{c.price}</Text>
                    <Coin size={11} />
                  </View>
                )}
                {/* the chosen one wears a tick; a locked one a lock over its preview */}
                {selected && (
                  <View style={styles.badge}>
                    <Check size={14} colour={garb.ink} />
                  </View>
                )}
                {locked && (
                  <View style={styles.lockOverlay} pointerEvents="none">
                    <Lock size={18} />
                  </View>
                )}
              </PressScale>
              </Shake>
            );
          })}
        </View>
      </Panel>
    );
  };

  return (
    <ScreenShell
      title={ui.shop}
      onBack={onBack}
      backLabel={ui.back}
      overlay={
        confirming ? (
          <ConfirmDialog
            title={ui.shopBuyTitle(ui.cosmeticName(confirming.id), confirming.price)}
            confirmLabel={ui.shopBuy}
            cancelLabel={ui.shopCancel}
            onConfirm={confirmBuy}
            onCancel={() => setConfirming(null)}
            ground={room().page}
          />
        ) : why ? (
          // Over the screen, at its foot: in view whichever tile was tapped,
          // and the grid never moves under the next tap.
          <View style={styles.whyToast} pointerEvents="none">
            <Text style={styles.why} role="alert">
              {why}
            </Text>
          </View>
        ) : null
      }
    >
      <View style={styles.walletRow}>
        <View style={styles.walletCoins}>
          <Text style={styles.levelChip}>
            {ui.level} {level}
          </Text>
          <Text style={styles.wallet}>{profile.coins}</Text>
          <Coin size={20} />
        </View>
        <Text style={styles.walletHint}>{ui.coinsDisclaimer}</Text>
      </View>
      {section('avatar', ui.sectionAvatars)}
      {section('cardBack', ui.sectionCardBacks)}
      {section('felt', ui.sectionFelts)}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  walletRow: { alignItems: 'center', gap: 4 },
  walletCoins: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wallet: { color: theme.accent, fontSize: 24, fontFamily: font.bold },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap', justifyContent: 'center' },
  walletHint: { color: theme.textDim, fontSize: 11, fontFamily: font.regular, textAlign: 'center' },
  levelChip: { color: theme.text, fontSize: 14, fontFamily: font.bold, marginRight: space.sm },
  whyToast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.xl,
    backgroundColor: surface.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.accent,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  why: { color: theme.accent, fontSize: 13, fontFamily: font.medium, textAlign: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // The tile's place in the grid; the tile fills it, and a refusal shakes it.
  slot: { width: '30.5%', height: 122 },
  item: {
    width: '100%',
    // A fixed height: a row of tiles is a row, whatever each one has to say.
    height: 122,
    backgroundColor: surface.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: stroke.hair,
    paddingVertical: space.sm + 2,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    gap: 6,
  },
  itemSelected: { borderColor: theme.accent },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 66,
    backgroundColor: surface.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: { height: 56, justifyContent: 'center' },
  feltSwatch: { width: 46, height: 46 },
  itemName: { color: theme.text, fontSize: 12, fontFamily: font.medium },
  price: { color: theme.accent, fontSize: 12, fontFamily: font.bold },
  select: { color: theme.text, fontSize: 12, fontFamily: font.bold },
  selected: { color: theme.accent, fontSize: 12, fontFamily: font.bold },
  locked: { color: theme.textDim, fontSize: 12, fontFamily: font.regular },
});
