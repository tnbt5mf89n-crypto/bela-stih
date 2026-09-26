import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The promises that keep this a card game and not a casino, and keep "no
 * data collected" true, pinned where a dependency or a doc edit would break
 * them (docs/compliance-checklist.md, standing invariants).
 */

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every dependency of every workspace, dev ones included: a billing or analytics SDK anywhere is one too many. */
function allDependencies(): string[] {
  const manifests = ['package.json', ...['apps', 'packages'].flatMap((d) => readdirSync(join(ROOT, d)).map((w) => `${d}/${w}/package.json`))].filter((f) => existsSync(join(ROOT, f)));
  return manifests.flatMap((f) => {
    const pkg = JSON.parse(read(f));
    return Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  });
}

describe('the guardrails', () => {
  it('coins can never be bought: no purchase, billing or ads dependency anywhere', () => {
    for (const d of allDependencies()) expect(d, d).not.toMatch(/iap|in-app-purchase|purchases|billing|admob|google-mobile-ads|adsdk|revenuecat|stripe|paddle|adjust|appsflyer|ironsource|unity-ads/i);
    // And the published promise stays published.
    expect(read('docs/play-store.md')).toMatch(/never be bought or cashed out/);
    expect(read('docs/compliance-checklist.md')).toMatch(/Coins can never be bought — no in-app purchase of any kind, ever/);
  });

  it('reports nothing by itself: no crash or analytics SDK, the crash screen offers the clipboard instead', () => {
    for (const d of allDependencies()) expect(d, d).not.toMatch(/sentry|crashlytics|firebase|bugsnag|amplitude|mixpanel|segment|datadog|posthog|newrelic|instabug/i);
    const boundary = read('apps/mobile/src/ui/ErrorBoundary.tsx');
    expect(boundary).toMatch(/Clipboard\.setStringAsync\(this\.report\(\)\)/);
    // The report names the build and the phone, never the player.
    expect(boundary).toMatch(/`Bela Štih \$\{this\.props\.version\} · \$\{device\}`/);
    expect(boundary).not.toMatch(/nickname|profile|storage/i);
    expect(read('apps/mobile/App.tsx')).toMatch(/copyLabel=\{lang\.s\.ui\.crashCopy\}\s*copiedLabel=\{lang\.s\.ui\.crashCopied\}\s*version=\{APP_VERSION\}/);
  });

  it('ships arm only, checks its permissions and keeps the source map of every release', () => {
    const build = read('scripts/build-android.sh');
    expect(build).toMatch(/reactNativeArchitectures=armeabi-v7a,arm64-v8a/);
    expect(build).toMatch(/python scripts\/verify-artifact\.py "\$AAB" "\$APK"/);
    expect(build).toMatch(/apps\/mobile\/sourcemaps\/\$VERSION_CODE/);
    expect(read('.gitignore')).toMatch(/^apps\/mobile\/sourcemaps\/$/m);
    const verify = read('scripts/verify-artifact.py');
    // 1.5.1 shipped asking for SYSTEM_ALERT_WINDOW and the storage pair (Expo's template, expo-file-system)
    // without using either; from 1.5.2 app.json removes them from the merged manifest and the artifact check refuses them.
    const app = JSON.parse(read('apps/mobile/app.json'));
    for (const p of ['SYSTEM_ALERT_WINDOW', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) expect(app.expo.android.blockedPermissions, p).toContain(`android.permission.${p}`);
    // The names must be in the BLOCKED set itself, not merely somewhere in the file (a comment would do that).
    const blocked = /BLOCKED = \{([\s\S]*?)\n\}/.exec(verify)?.[1] ?? '';
    for (const p of ['SYSTEM_ALERT_WINDOW', 'CAMERA', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'AD_ID', 'ACCESS_FINE_LOCATION', 'READ_EXTERNAL_STORAGE']) expect(blocked, p).toContain(`.${p}'`);
    for (const p of ['SYSTEM_ALERT_WINDOW', 'CAMERA', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'AD_ID', 'ACCESS_FINE_LOCATION']) expect(verify).toContain(p);
    expect(verify).toMatch(/PAGE_16K = 16 \* 1024/);
  });

  it('is installable on the web, from the same files the app serves', () => {
    const manifest = JSON.parse(read('apps/mobile/public/manifest.webmanifest'));
    expect(manifest.start_url).toBe('/igra/');
    expect(manifest.scope).toBe('/igra/');
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of manifest.icons) expect(() => readFileSync(join(ROOT, 'apps/mobile/public', i.src))).not.toThrow();
    expect(read('apps/mobile/public/index.html')).toMatch(/<link rel="manifest" href="manifest\.webmanifest" \/>/);
  });
});

describe('the Play release notes', () => {
  const md = read('docs/play-store.md').replace(/\r\n/g, '\n');
  const notes = [...md.matchAll(/^- (hr|sr|en)\b[^:\n]*: \*([\s\S]*?)\*$/gm)]
    .map((m) => ({ lang: m[1], text: m[2].split('\n').map((s) => s.trim()).join(' ') }));
  it("fit Play's 500 characters per language", () => {
    expect(notes.length).toBeGreaterThanOrEqual(24);
    for (const n of notes) expect([...n.text].length, `${n.lang}: ${n.text.slice(0, 40)}`).toBeLessThanOrEqual(500);
  });
  it('call XP "XP": bodovi / поени are the score on the sheet', () => {
    expect(md).not.toMatch(/nose bodove|носе поене|носе бодове/);
  });
});
