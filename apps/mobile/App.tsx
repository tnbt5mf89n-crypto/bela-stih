import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Linking, LogBox, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeIn, ReduceMotion, ReducedMotionConfig } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Lang } from '@belot/i18n';
import type { PlayerProfile } from '@belot/progression';
import { HomeScreen, type Launch } from './src/HomeScreen';
import { DeckGallery } from './src/DeckGallery';
import { WebShell } from './src/WebShell';
import { OfflineGame } from './src/OfflineGame';
import { OnlineGame } from './src/net/OnlineGame';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { RulesScreen } from './src/screens/RulesScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ShopScreen } from './src/screens/ShopScreen';
import {
  loadHistory,
  loadProfile,
  loadSettings,
  saveProfile,
  saveSettings,
  type Settings,
} from './src/storage';
import { preloadSfx, setMasterVolume, setSoundEnabled } from './src/audio';
import { AudioUnlockChip } from './src/ui/AudioUnlockChip';
import { runBackGuard } from './src/ui/backGuard';
import { useWebBack } from './src/ui/webBack';
import { setAndroidHaptics, setHapticsEnabled } from './src/haptics';
import { useFonts } from 'expo-font';

/** Registered under the names theme.ts's `font` tokens use. */
const FONTS = {
  'Rubik-400': require('./assets/fonts/Rubik-400.ttf'),
  'Rubik-500': require('./assets/fonts/Rubik-500.ttf'),
  'Rubik-700': require('./assets/fonts/Rubik-700.ttf'),
  'Rubik-900': require('./assets/fonts/Rubik-900.ttf'),
};

// ReducedMotionConfig warns on every dev mount; the override is deliberate
// (see the render below). Dev only: the web LogBox is a stub.
LogBox.ignoreLogs(['Reduced motion setting is overwritten']);
import { setCardLocale, setCosmetics, setDeckStyle } from './src/cosmetics';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { ensureQuests, isoDay } from '@belot/progression';
import { APP_VERSION } from './src/screens/common';
import { useMotionPolicy } from './src/anim/useMotionPolicy';
import { MotionProvider } from './src/anim/MotionHere';

/** The menu stack, one level deep: home, or one of its satellite screens. */
type MenuScreen = 'home' | 'shop' | 'settings' | 'profile' | 'rules' | 'history';

/**
 * A handful of screens and no router: the menu (home plus shop / settings /
 * profile), a local game, or a networked one. A stack navigator would be more
 * machinery than these transitions justify.
 */
export default function App() {
  // The display face. Native waits the few milliseconds the local files
  // take (a system-font first frame that swaps to Rubik would flicker); the
  // web paints at once in the fallback stack and swaps when the files arrive.
  const [fontsLoaded, fontsError] = useFonts(FONTS);
  const [settings, setSettings] = useState(loadSettings);
  const [profile, setProfile] = useState<PlayerProfile>(loadProfile);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [menu, setMenu] = useState<MenuScreen>('home');
  const lang = useMemo(() => new Lang(settings.locale), [settings.locale]);
  const motion = useMotionPolicy(settings.motion);

  // Warm the sound bank once, so even the session's first effect is audible.
  useEffect(() => preloadSfx(), []);

  // Invite links (https://belastih.com/join/CODE or belastih://join/CODE)
  // drop the player straight into the friend's table. A link never interrupts
  // a game in progress — mid-match it is simply ignored.
  const launchRef = useRef(launch);
  launchRef.current = launch;
  useEffect(() => {
    const joinFrom = (url: string | null) => {
      // Native deep link .../join/CODE, or the web app's /igra/?code=CODE.
      const code =
        url?.match(/(?:^|\/)join\/([A-Za-z0-9_-]{1,24})\/?$/)?.[1] ??
        url?.match(/[?&]code=([A-Za-z0-9_-]{1,24})/)?.[1];
      if (code && launchRef.current === null) {
        setMenu('home');
        setLaunch({ mode: 'join', code });
      }
    };
    void Linking.getInitialURL().then(joinFrom).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => joinFrom(e.url));
    return () => sub.remove();
  }, []);

  // The cosmetics are read during the children's render, so they are set
  // during ours; sound and haptics are only ever read on a press or a beat,
  // which is never the first render, so those move to an effect.
  setCosmetics(profile);
  setDeckStyle(settings.deckStyle);
  setCardLocale(lang);
  useEffect(() => {
    setSoundEnabled(settings.sound);
    setHapticsEnabled(settings.haptics);
    setAndroidHaptics(Platform.OS === 'android');
    setMasterVolume(settings.volume);
  }, [settings.sound, settings.haptics, settings.volume]);

  const updateProfile = useCallback((p: PlayerProfile) => {
    saveProfile(p);
    setProfile(p);
  }, []);

  // Midnight at the menus: the quests roll over without a relaunch. In a game
  // the outcome carries the day (feedback.ts), so only the menus need a clock.
  useEffect(() => {
    if (launch !== null) return;
    const tick = () => {
      const today = isoDay(new Date());
      if (profile.questDay !== today) updateProfile(ensureQuests(profile, today));
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [launch, profile, updateProfile]);

  const updateSettings = useCallback((s: Settings) => {
    saveSettings(s);
    setSettings(s);
  }, []);

  // Games keep their own profile copy while playing, so re-read it on the way
  // out to pick up whatever XP and coins were earned.
  const exitToHome = useCallback(() => {
    setLaunch(null);
    setProfile(loadProfile());
  }, []);

  // Back out of a game (or a menu screen) rather than out of the app. Without
  // this, Android's back button drops straight to whatever was behind and
  // takes the deal in progress with it — and people press back constantly.
  useEffect(() => {
    if (Platform.OS === 'web') return; // no hardware back; the API only logs an error there
    if (launch === null && menu === 'home') return; // at the root, let back close the app
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // A match in progress asks before it is abandoned (see ui/backGuard).
      if (runBackGuard()) return true;
      if (launch !== null) exitToHome();
      else setMenu('home');
      return true; // handled
    });
    return () => sub.remove();
  }, [launch, menu, exitToHome]);
  // The browser's Back does the same on the web, instead of leaving the page.
  useWebBack(launch === null && menu === 'home', () => {
    if (runBackGuard()) return;
    if (launchRef.current !== null) exitToHome();
    else setMenu('home');
  });

  const toHome = useCallback(() => setMenu('home'), []);
  // Read afresh each time the history opens: a match may have ended since.
  const history = useMemo(() => (menu === 'history' ? loadHistory() : []), [menu]);

  const content =
    launch === null ? (
        menu === 'shop' ? (
          <ShopScreen
            lang={lang}
            profile={profile}
            onProfileChange={updateProfile}
            onBack={toHome}
          />
        ) : menu === 'settings' ? (
          <SettingsScreen
            lang={lang}
            settings={settings}
            onSettingsChange={updateSettings}
            onProfileChange={updateProfile}
            onBack={toHome}
            onOpenRules={() => setMenu('rules')}
          />
        ) : menu === 'rules' ? (
          <RulesScreen lang={lang} settings={settings} onBack={toHome} />
        ) : menu === 'history' ? (
          <HistoryScreen
            lang={lang}
            history={history}
            onBack={toHome}
            onCreateTable={() => {
              setMenu('home');
              setLaunch({ mode: 'create' });
            }}
          />
        ) : menu === 'profile' ? (
          <ProfileScreen
            lang={lang}
            profile={profile}
            settings={settings}
            onSettingsChange={updateSettings}
            onProfileChange={updateProfile}
            onOpenShop={() => setMenu('shop')}
            onOpenHistory={() => setMenu('history')}
            onBack={toHome}
          />
        ) : (
          <HomeScreen
            lang={lang}
            profile={profile}
            settings={settings}
            onProfileChange={updateProfile}
            onSettingsChange={updateSettings}
            onLaunch={setLaunch}
            onOpenShop={() => setMenu('shop')}
            onOpenSettings={() => setMenu('settings')}
            onOpenProfile={() => setMenu('profile')}
            onOpenRules={() => setMenu('rules')}
            onOpenHistory={() => setMenu('history')}
          />
        )
    ) : launch.mode === 'gallery' ? (
      <DeckGallery onExit={exitToHome} />
    ) : launch.mode === 'offline' ? (
      <OfflineGame settings={settings} onSettingsChange={updateSettings} onExit={exitToHome} />
    ) : (
      <OnlineGame
        settings={settings}
        onSettingsChange={updateSettings}
        mode={launch.mode}
        joinCode={launch.mode === 'join' ? launch.code : undefined}
        onExit={exitToHome}
      />
    );

  // Screens fade in rather than cutting — entering only: there is no router
  // to hold the old screen for an exit, and a rematch remount would otherwise
  // show two tables. The key remounts the wrapper on every screen change.
  const screenKey = launch ? `game:${launch.mode}` : `menu:${menu}`;

  // A render error anywhere below lands on a branded panel whose one button
  // leads home — not a blank page. The boundary sits inside the shell so the
  // panel keeps the web column and the safe-area insets.
  const guarded = (
    <ErrorBoundary
      title={lang.s.ui.crashTitle}
      body={lang.s.ui.crashBody}
      action={lang.s.ui.back}
      copyLabel={lang.s.ui.crashCopy}
      copiedLabel={lang.s.ui.crashCopied}
      version={APP_VERSION}
      resetKey={screenKey}
      onReset={() => {
        setMenu('home');
        exitToHome();
      }}
    >
      <Animated.View
        key={screenKey}
        entering={motion === 'reduced' ? undefined : FadeIn.duration(180)}
        style={{ flex: 1 }}
      >
        {content}
      </Animated.View>
    </ErrorBoundary>
  );

  // Native: the first frame waits for the local font files (milliseconds);
  // the web never gates first paint on them (see theme.ts's fallback stack).
  if (Platform.OS !== 'web' && !fontsLoaded && !fontsError) return null;

  // Reanimated would also obey the phone's reduce-motion switch, read once at
  // start-up, and jump every animation to its end - and a bubble's end is
  // invisible: bids, emotes and the stiglja word never showed with Android's
  // "Remove animations" on (or the web's prefers-reduced-motion). The app's
  // own policy (Animacije, useMotionPolicy) already decides what moves. First
  // child, so its effect runs before any screen's; outside `guarded`, so an
  // error reset never unmounts it and hands the switch back.
  return (
    <SafeAreaProvider>
      <ReducedMotionConfig mode={ReduceMotion.Never} />
      <StatusBar style="light" />
      {/* Now that reanimated obeys nobody else, the policy has to reach the
          shared pieces that take no props: every press in the app. */}
      <MotionProvider value={motion}>
        {/* On the web the app lives in a centred column; phones get the viewport. */}
        {Platform.OS === 'web' ? (
          <WebShell>
            {guarded}
            {/* Browsers refuse audio before a gesture; this says so, once, if it happens. */}
            <AudioUnlockChip label={lang.s.ui.soundBlocked} />
          </WebShell>
        ) : (
          guarded
        )}
      </MotionProvider>
    </SafeAreaProvider>
  );
}
