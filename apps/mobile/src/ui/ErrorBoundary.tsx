import { Component, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { font, radius, theme } from '../theme';

/**
 * The screen a render error lands on.
 *
 * Without this a thrown render anywhere in the tree left the app on a blank
 * page with no branding and no way back — in production, silently. This is a
 * class component on purpose: error boundaries are the one thing hooks cannot
 * express.
 *
 * Deliberately self-contained (no shared Button, no i18n import): the whole
 * point is to still render when something below it could not. The words come
 * in as props from the app, which still has them.
 *
 * "Kopiraj izvještaj o grešci" puts the error, the app's version and the
 * phone's model on the clipboard for the player to send: the app reports
 * nothing by itself (no crash SDK - the privacy page says so), so this is the
 * only way a crash on a stranger's phone ever reaches the developer.
 */
export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    title: string;
    body: string;
    action: string;
    /** The copy button, and what it says once the report is on the clipboard. */
    copyLabel: string;
    copiedLabel: string;
    /** The app's version, for the report. */
    version: string;
    /** Called after the boundary resets; the app returns to the home screen. */
    onReset: () => void;
    /**
     * Which screen is behind the boundary. When it changes — the hardware
     * back button leaving a game, say — the panel gives way to the new
     * screen instead of sitting over it.
     */
    resetKey: string;
  },
  { error: Error | null; copied: boolean }
> {
  state = { error: null as Error | null, copied: false };

  static getDerivedStateFromError(error: Error) {
    return { error, copied: false };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, copied: false });
  }

  componentDidCatch(error: Error) {
    if (__DEV__) console.error('[bela] render error', error);
  }

  /** The report: what broke, in which build, on what. Nothing about the player. */
  report(): string {
    const e = this.state.error;
    const c = (Platform.constants ?? {}) as { Brand?: string; Model?: string; Release?: string };
    const device =
      Platform.OS === 'android'
        ? `Android ${c.Release ?? Platform.Version} · ${[c.Brand, c.Model].filter(Boolean).join(' ')}`
        : Platform.OS === 'web'
          ? // react-native-web's Platform.Version is a constant '0.0.0'; the user agent names the browser and OS.
            `web · ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`
          : `${Platform.OS} ${String(Platform.Version)}`;
    return [
      `Bela Štih ${this.props.version} · ${device}`,
      e ? `${e.name}: ${e.message}` : 'no error',
      e?.stack ?? '',
    ].join('\n');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.mark}>
          Bela <Text style={styles.markAccent}>Štih</Text>
        </Text>
        <Text style={styles.title}>{this.props.title}</Text>
        <Text style={styles.body}>{this.props.body}</Text>
        <Pressable
          onPress={() => {
            this.setState({ error: null, copied: false });
            this.props.onReset();
          }}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>{this.props.action}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void Clipboard.setStringAsync(this.report()).then(
              () => this.setState({ copied: true }),
              () => {},
            );
          }}
          style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={this.props.copyLabel}
        >
          <Text style={styles.btnText}>{this.state.copied ? this.props.copiedLabel : this.props.copyLabel}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.feltDeep,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 10,
  },
  mark: { color: theme.text, fontSize: 30, fontFamily: font.bold, marginBottom: 14 },
  markAccent: { color: theme.accent },
  title: { color: theme.text, fontSize: 18, fontFamily: font.bold, textAlign: 'center' },
  body: { color: theme.textDim, fontSize: 14, fontFamily: font.regular, textAlign: 'center', maxWidth: 320 },
  btn: {
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: radius.pill,
    backgroundColor: theme.wood,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  btnPlain: { marginTop: 4, backgroundColor: 'transparent', borderColor: theme.line },
  pressed: { opacity: 0.7, transform: [{ translateY: 2 }] },
  btnText: { color: theme.text, fontSize: 15, fontFamily: font.bold },
});
