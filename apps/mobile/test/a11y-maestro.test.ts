import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

/** Every JSX element of a source file, parsed. */
function jsx(file: string, text: string) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const open = (e: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(e) ? e.openingElement : e);
  /** An attribute's expression as written, `undefined` when absent (a bare attribute is 'true'). */
  const attr = (e: ts.JsxElement | ts.JsxSelfClosingElement, name: string): string | undefined => {
    const a = open(e).attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name);
    if (!a) return undefined;
    if (!a.initializer) return 'true';
    return ts.isJsxExpression(a.initializer) ? a.initializer.expression?.getText(sf) : a.initializer.getText(sf);
  };
  const tag = (e: ts.JsxElement | ts.JsxSelfClosingElement) => open(e).tagName.getText(sf);
  return { sf, elements: out, attr, tag };
}

describe('a screen reader at the fan', () => {
  const t = src('TableScreen.tsx');
  const fan = t.slice(t.indexOf('const FanCard = memo('), t.indexOf('const feltEntering'));

  it('finds every card as a button that says its name', () => {
    expect(fan).toMatch(/accessibilityRole="button"/);
    // The name as the language says it (Lang.cardName: "dečko srce"), not the
    // genitive a zvanje is announced in ("terca do dečka") nor the printed index.
    expect(fan).toMatch(/accessibilityLabel=\{cardLang\(\)\.cardName\(card\)\}/);
    expect(fan).not.toMatch(/rankName|rankShort/);
    expect(fan).toMatch(/testID=\{`card-\$\{id\}`\}/);
  });

  it('and whether it may be played now: on my turn an illegal card reads disabled, and still takes the tap', () => {
    const { sf, elements, attr, tag } = jsx('TableScreen.tsx', t);
    // The Hand's reading of a card, the two props it gives FanCard, and what
    // FanCard hands its Pressable - evaluated as written.
    const decl = (name: string) => {
      let init: string | undefined;
      const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name) init = n.initializer?.getText(sf);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return init;
    };
    const fanCard = elements.find((e) => tag(e) === 'FanCard')!;
    const pressable = elements.find((e) => tag(e) === 'Pressable' && attr(e, 'testID') === '`card-${id}`')!;
    const parts = [decl('playable'), decl('illegalNow'), attr(fanCard, 'dimmed'), attr(fanCard, 'disabled'), attr(pressable, 'disabled'), attr(pressable, 'accessibilityState')];
    expect(parts.every((p) => p !== undefined), parts.join(' | ')).toBe(true);
    const read = new Function(
      'arranging', 'marking', 'enabled', 'freePlay', 'inPlayMoment', 'legal',
      `const card = {};
       const chosenFor = () => (legal ? {} : undefined);
       const playable = ${parts[0]};
       const illegalNow = ${parts[1]};
       const dimmed = ${parts[2]};
       const disabled = ${parts[3]};
       return { press: ${parts[4]}, state: ${parts[5]} };`,
    ) as (...a: boolean[]) => { press: boolean | null | undefined; state: { disabled?: boolean } };
    // What reaches TalkBack: RN's Pressable writes its own `disabled` over the
    // accessibilityState whenever it is not null (read from the installed RN).
    const rn = dirname(createRequire(join(here, '../package.json')).resolve('react-native/package.json'));
    expect(readFileSync(join(rn, 'Libraries/Components/Pressable/Pressable.js'), 'utf8')).toMatch(
      /disabled != null \? \{\.\.\._accessibilityState, disabled\} : _accessibilityState/,
    );
    const card = (s: { arranging?: boolean; marking?: boolean; enabled: boolean; freePlay?: boolean; inPlayMoment: boolean; legal: boolean }) => {
      const r = read(!!s.arranging, !!s.marking, s.enabled, !!s.freePlay, s.inPlayMoment, s.legal);
      return { heardDisabled: (r.press != null ? r.press : r.state.disabled) === true, takesTap: r.press !== true };
    };
    // My turn: a legal card is playable, an illegal one is not - and still shakes and says why.
    expect(card({ enabled: true, inPlayMoment: true, legal: true })).toEqual({ heardDisabled: false, takesTap: true });
    expect(card({ enabled: true, inPlayMoment: true, legal: false })).toEqual({ heardDisabled: true, takesTap: true });
    // Prava bela: every card goes, and every card says so.
    expect(card({ enabled: true, inPlayMoment: true, legal: true, freePlay: true })).toEqual({ heardDisabled: false, takesTap: true });
    // Not my turn, or a bid to answer: no card may go.
    expect(card({ enabled: false, inPlayMoment: false, legal: false })).toEqual({ heardDisabled: true, takesTap: false });
    expect(card({ enabled: true, inPlayMoment: false, legal: false })).toEqual({ heardDisabled: true, takesTap: false });
    // Arranging or marking zvanja: every card takes the tap, and says it does.
    expect(card({ enabled: true, inPlayMoment: true, legal: true, arranging: true })).toEqual({ heardDisabled: false, takesTap: true });
    expect(card({ enabled: false, inPlayMoment: false, legal: false, marking: true })).toEqual({ heardDisabled: false, takesTap: true });
  });
});

describe('"Pregled ruke" for a screen reader', () => {
  it('says each card by name, not by its printed index', () => {
    const h = src('table/HandReview.tsx');
    expect(h).toMatch(/\$\{nameOf\(p\.seat\)\} \$\{lang\.cardName\(p\.card\)\}/);
    expect(h).not.toMatch(/rankShort|rankName/);
  });

  it('is modal on Android too: the table and its sheet step out while it is open', () => {
    // accessibilityViewIsModal (kept for iOS) does nothing on Android or the
    // web: TalkBack reaches whatever is not hidden outright.
    expect(src('table/HandReview.tsx')).toMatch(/accessibilityViewIsModal/);
    const t = src('TableScreen.tsx');
    const { sf, elements, attr, tag } = jsx('TableScreen.tsx', t);
    const hidden = (e: ts.JsxElement | ts.JsxSelfClosingElement) => attr(e, 'aria-hidden') === 'reviewing';
    const sheet = elements.find((e) => /styles\.resultBackdrop\b/.test(attr(e, 'style') ?? ''));
    expect(sheet && hidden(sheet), 'the result sheet').toBe(true);
    // The table's root holds one layer, hidden with the review and never
    // flattened (flipping it must not re-parent the table), then overlays only.
    const root = elements.find((e) => /^\[styles\.root\b/.test(attr(e, 'style') ?? ''));
    expect(root && ts.isJsxElement(root)).toBe(true);
    const kids = (root as ts.JsxElement).children.filter((c) => !ts.isJsxText(c) && !(ts.isJsxExpression(c) && !c.expression));
    const [layer, ...overlays] = kids;
    expect(layer && (ts.isJsxElement(layer) || ts.isJsxSelfClosingElement(layer)) && tag(layer) === 'View' && hidden(layer) && attr(layer, 'collapsable') === 'false').toBe(true);
    // The layer holds the table, whichever way up...
    const holdsTable = (layer as ts.JsxElement).children.some(
      (c) => ts.isJsxExpression(c) && !!c.expression && ts.isConditionalExpression(c.expression) && c.expression.condition.getText(sf) === 'land',
    );
    expect(holdsTable, 'the table in the layer').toBe(true);
    // ...and beside it are only the overlays, the review among them, out of the layer.
    for (const o of overlays) expect(o.getText(sf).slice(0, 80)).toMatch(/resultSheet|<HandReview|<EffectsOverlay|<PerfProbe|<GiftPicker|giftShield|<HoldPanel|<ConfirmDialog/);
    expect(overlays.some((o) => /<HandReview/.test(o.getText(sf)))).toBe(true);
  });
});

describe('the zvanja question', () => {
  it('can be answered by the device flows: "Prijavi" and "Nemam" carry their own IDs', () => {
    const t = src('TableScreen.tsx');
    const at = t.indexOf('const declareButtons =');
    const block = t.slice(at, t.indexOf(') : null;', at));
    expect(block).toMatch(/label=\{lang\.s\.declareMarked\}\s*testID="declare-announce"/);
    expect(block).toMatch(/label=\{lang\.s\.noneToDeclare\}\s*testID="declare-skip"/);
    expect(readFileSync(join(FLOWS, '02-offline-deal.yaml'), 'utf8')).toMatch(/id: "declare-skip"/);
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
        // A literal, one of the two outcomes of a ternary (golden-ok / golden-diff), or a
        // template that produces it from a prefix (mode-learn from `mode-${d}`).
        const prefix = id.replace(/[^-]*$/, '');
        expect(all, id).toMatch(new RegExp(`testID=(?:"${id}"|\\{[^}]*'${id}'|\\{\`${prefix}\\$\\{)`));
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
    // The corpus holds the JS thread for seconds: it runs after the press has painted, one run at a
    // time, and a throw is a verdict, not a crash.
    const body = s.slice(s.indexOf('const replayGolden'), s.indexOf('useBackCloses('));
    expect(body).toMatch(/if \(replaying\) return;\s*setReplaying\(true\);/);
    expect(body).toMatch(/setTimeout\(\(\) => \{[\s\S]*try \{[\s\S]*runGolden\(\)[\s\S]*\} catch[\s\S]*\} finally \{\s*setReplaying\(false\);/);
    expect(s).toMatch(/testID="diag-golden" disabled=\{replaying\}/);
    expect(s).toMatch(/taps\.current\.filter\(\(t\) => now - t < 6000\)/);
    for (const id of LOCALE_IDS) {
      const ui = new Lang(id).s.ui;
      expect(ui.diagTitle.length).toBeGreaterThan(3);
      expect(ui.diagOk(12)).toContain('12');
      expect(ui.diagDiff('abcd')).toContain('abcd');
    }
  });
});
