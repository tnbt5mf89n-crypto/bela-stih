import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Lang, LOCALE_IDS } from '@belot/i18n';

/**
 * The device gate's hooks (1.6.0): every fan card is a named, stateful button
 * for TalkBack and carries a testID for Maestro; the controls the flows tap
 * exist under the IDs the flows name; the hidden diagnostics replay the golden
 * corpus on the phone.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '../src');
const FLOWS = join(here, '../maestro');
const src = (p: string) => readFileSync(join(SRC, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('a screen reader at the fan', () => {
  it('finds every card as a button that says its name and whether it may be played', () => {
    const t = src('TableScreen.tsx');
    const card = t.slice(t.indexOf('const FanCard = memo('), t.indexOf('const FanCard = memo(') + 9000);
    expect(card).toMatch(/accessibilityRole="button"/);
    expect(card).toMatch(/accessibilityLabel=\{cardLang\(\)\.s\.cardOf\(cardLang\(\)\.s\.rankName\[card\.rank\], cardLang\(\)\.suitName\(card\.suit\)\)\}/);
    expect(card).toMatch(/accessibilityState=\{\{ disabled \}\}/);
    expect(card).toMatch(/testID=\{`card-\$\{id\}`\}/);
  });
});

describe('the Maestro flows', () => {
  const flows = readdirSync(FLOWS).filter((f) => f.endsWith('.yaml'));
  const all = walk(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');

  it('exist, four of them, each naming the app', () => {
    expect(flows.length).toBeGreaterThanOrEqual(4);
    for (const f of flows) expect(readFileSync(join(FLOWS, f), 'utf8'), f).toMatch(/^appId: com\.slfresh\.belastih/m);
  });

  it('tap only IDs the app really renders', () => {
    const ids = new Set<string>();
    for (const f of flows) {
      for (const m of readFileSync(join(FLOWS, f), 'utf8').matchAll(/id: "([^"]+)"/g)) ids.add(m[1]!);
    }
    for (const m of readFileSync(join(here, '../../../scripts/device-flows.sh'), 'utf8').matchAll(/id: "([^"]+)"/g)) ids.add(m[1]!);
    expect(ids.size).toBeGreaterThan(6);
    for (const id of ids) {
      if (id.includes('.*')) {
        // A pattern: some testID template must produce it.
        expect(all, id).toMatch(new RegExp(`testID=\\{\`${id.replace('.*', '')}`));
      } else if (/-\d+$/.test(id)) {
        // A numbered one (action-0): a template with that prefix.
        expect(all, id).toMatch(new RegExp(`testID=\\{\`${id.replace(/\d+$/, '')}`));
      } else {
        // A literal, or one of the two outcomes of a ternary (golden-ok / golden-diff).
        expect(all, id).toMatch(new RegExp(`testID=(?:"${id}"|\\{[^}]*'${id}')`));
      }
    }
  });

  it('the Button passes a testID down to what is pressed', () => {
    const b = src('ui/Button.tsx');
    expect(b).toMatch(/testID\?: string;/);
    expect(b).toMatch(/testID=\{testID\}/);
  });
});

describe('the hidden diagnostics', () => {
  it('open on five taps of the version line and replay the golden corpus against the fixture', () => {
    const s = src('screens/SettingsScreen.tsx');
    expect(s).toMatch(/runGolden\(\)/);
    expect(s).toMatch(/golden\/expected\.json/);
    expect(s).toMatch(/report\.playHash === expected\.playHash/);
    expect(s).toMatch(/testID=\{golden\.ok \? 'golden-ok' : 'golden-diff'\}/);
    expect(s).toMatch(/taps\.current\.filter\(\(t\) => now - t < 3000\)/);
    for (const id of LOCALE_IDS) {
      const ui = new Lang(id).s.ui;
      expect(ui.diagTitle.length).toBeGreaterThan(3);
      expect(ui.diagOk(12)).toContain('12');
      expect(ui.diagDiff('abcd')).toContain('abcd');
    }
  });
});
