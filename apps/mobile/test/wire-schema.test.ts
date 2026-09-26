import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The wire, as the types spell it: every message an app may send or receive,
 * every field of a seat's view and of a table event, written out by the
 * TypeScript checker and compared with the snapshot committed beside this
 * file. A field may be added (an older app ignores what it does not know);
 * nothing may be removed or change its type while apps that read it are in
 * the wild. Refresh the snapshot for an addition made on purpose:
 *
 *   SCHEMA_UPDATE=1 npx vitest run apps/mobile/test/wire-schema.test.ts
 */

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const SNAPSHOT = join(here, 'wire-schema.snapshot.json');

const WANTED: Record<string, string[]> = {
  'apps/server/src/protocol.ts': ['ClientMessage', 'RoomMessage', 'SeatInfo', 'VoiceMessage', 'VoiceHeardMessage', 'EmoteMessage', 'GiftMessage', 'JoinGifts', 'JoinVoice', 'JoinProto', 'JoinIdentity', 'HoldInfo', 'PlayMode'],
  'packages/table/src/index.ts': ['TableEvent'],
  // Everything a view or an action is made of, spelled out - a named type printed by its name
  // (`Phase`, `Card[]`) would let its members change unseen.
  'packages/shared-types/src/index.ts': ['PublicView', 'Action', 'Card', 'Suit', 'Rank', 'ContractType', 'PlayContext', 'Seat', 'TeamId', 'Phase', 'TrickPlay', 'TrickRecord', 'BidRecord', 'DealHistory', 'DealProgress', 'Declaration', 'DeclarationSummary', 'DeclarationKind', 'DeclarationMode', 'RenonsMode', 'BelaMode', 'EngineConfig'],
  'packages/engine/src/index.ts': ['DealScoreResult'],
};

type Shape = { kind: 'object'; props: Record<string, string> } | { kind: 'union'; members: Shape[] } | { kind: 'other'; text: string };

function describeTypes(): Record<string, Shape> {
  const cfg = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  const files = Object.keys(WANTED).map((f) => join(ROOT, f));
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const out: Record<string, Shape> = {};
  // Plain names (`Seat`, not an import("...") path): the snapshot must read the same on every machine.
  // InTypeAlias: a type looked up by its own name is written as its members ('IDLE' | 'BID' | ...), not as itself.
  const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;

  const shapeOf = (t: ts.Type): Shape => {
    if (t.isUnion() && !(t.flags & ts.TypeFlags.Boolean)) {
      // Literal unions ('a' | 'b') stay a string; object unions are spelled out.
      const objects = t.types.filter((m) => m.flags & ts.TypeFlags.Object);
      if (objects.length === t.types.length) return { kind: 'union', members: t.types.map(shapeOf) };
      return { kind: 'other', text: checker.typeToString(t, undefined, flags) };
    }
    // Only a real object type is walked property by property; a literal, an array or an alias is written out.
    if (!(t.flags & ts.TypeFlags.Object)) return { kind: 'other', text: checker.typeToString(t, undefined, flags) };
    const props = t.getProperties();
    if (props.length === 0) return { kind: 'other', text: checker.typeToString(t, undefined, flags) };
    const rec: Record<string, string> = {};
    for (const p of props) {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      // A mapped type's properties (Record<Seat, number>) have no declaration; getDeclaredTypeOfSymbol
      // gives a property symbol the error type, which printed every one of them as `any`.
      const pt = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getTypeOfSymbol(p);
      const optional = (p.flags & ts.SymbolFlags.Optional) !== 0;
      rec[p.name + (optional ? '?' : '')] = checker.typeToString(pt, undefined, flags);
    }
    return { kind: 'object', props: rec };
  };

  for (const [file, names] of Object.entries(WANTED)) {
    const source = program.getSourceFile(join(ROOT, file));
    expect(source, file).toBeDefined();
    const moduleSymbol = checker.getSymbolAtLocation(source!);
    const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    for (const name of names) {
      const sym = exports.find((e) => e.name === name);
      expect(sym, `${file} exports ${name}`).toBeDefined();
      // A re-export (`export { type X } from './y'`) is an alias: asking the ExportSpecifier for its
      // type gives the error type, which prints as `any` and would pin nothing.
      const target = sym!.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym!) : sym!;
      const decl = target.declarations?.[0];
      const type = decl ? checker.getTypeAtLocation(decl) : checker.getDeclaredTypeOfSymbol(target);
      out[`${file}:${name}`] = shapeOf(type);
    }
  }
  return out;
}

/** Every property (and union member) of `was` is still in `now`, with the same type. */
function onlyAdditions(now: Shape, was: Shape, path: string, problems: string[]): void {
  if (was.kind === 'object') {
    if (now.kind !== 'object') return void problems.push(`${path}: was an object, now ${now.kind}`);
    for (const [k, v] of Object.entries(was.props)) {
      if (!(k in now.props)) problems.push(`${path}.${k} was removed (or became ${k.endsWith('?') ? 'required' : 'optional'})`);
      else if (now.props[k] !== v) problems.push(`${path}.${k}: was ${v}, now ${now.props[k]}`);
    }
  } else if (was.kind === 'union') {
    if (now.kind !== 'union') return void problems.push(`${path}: was a union, now ${now.kind}`);
    for (const [i, m] of was.members.entries()) {
      // A member is matched by its `type` literal when it has one, else by index.
      const tag = m.kind === 'object' ? m.props['type'] ?? m.props['kind'] : undefined;
      const match = tag ? now.members.find((n) => n.kind === 'object' && (n.props['type'] ?? n.props['kind']) === tag) : now.members[i];
      if (!match) problems.push(`${path}: union member ${tag ?? i} was removed`);
      else onlyAdditions(match, m, `${path}[${tag ?? i}]`, problems);
    }
  } else if (now.kind !== 'other' || now.text !== was.text) {
    problems.push(`${path}: was ${was.text}, now ${now.kind === 'other' ? now.text : now.kind}`);
  }
}

describe('the wire schema', () => {
  const now = describeTypes();

  it('only ever grows: no message, field or event an app in the wild reads may go or change', () => {
    // A type the checker could not resolve prints as any/error and pins nothing: not as a whole type,
    // not as a union member, not in any field (`ghost?: any`, `any[]`, `{ deep: any; }`). Checked
    // before either write below, so such a type never reaches the snapshot. String literals are
    // blanked first (a literal "any" is a value, not a type), and a word followed by `:` is a field's name.
    const texts = (s: Shape): string[] => (s.kind === 'object' ? Object.values(s.props) : s.kind === 'union' ? s.members.flatMap(texts) : [s.text]);
    const unresolved = Object.entries(now).flatMap(([name, s]) =>
      texts(s)
        .filter((t) => /\b(any|error|unknown)\b(?!\??:)/.test(t.replace(/"(?:[^"\\]|\\.)*"/g, '""')))
        .map((t) => `${name}: ${t}`),
    );
    expect(unresolved, unresolved.join('\n')).toEqual([]);
    // The snapshot is compared BEFORE it is refreshed: SCHEMA_UPDATE accepts additions, never a removal.
    if (!existsSync(SNAPSHOT) && process.env.SCHEMA_UPDATE) writeFileSync(SNAPSHOT, JSON.stringify(now, null, 1) + '\n');
    expect(existsSync(SNAPSHOT), 'no snapshot: run once with SCHEMA_UPDATE=1').toBe(true);
    const was = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record<string, Shape>;
    const problems: string[] = [];
    for (const [name, shape] of Object.entries(was)) {
      if (!(name in now)) problems.push(`${name} is no longer exported`);
      else onlyAdditions(now[name]!, shape, name, problems);
    }
    // What the APP sends: a new REQUIRED field there is a field an older app never sends, so the
    // server must treat it as optional. Only optional additions are additive in that direction.
    // That is ClientMessage, and the join options (the Join* types) every app sends at the door.
    const newRequired = (m: Shape, before: Shape, path: string): void => {
      if (m.kind !== 'object' || before.kind !== 'object') return;
      for (const k of Object.keys(m.props)) {
        if (!(k in before.props) && !k.endsWith('?')) problems.push(`${path}.${k} is a new REQUIRED field: an app in the wild never sends it`);
      }
    };
    for (const name of WANTED['apps/server/src/protocol.ts']!.filter((n) => n === 'ClientMessage' || n.startsWith('Join'))) {
      const n = now[`apps/server/src/protocol.ts:${name}`];
      // A join option type new to the snapshot is new all through: no app in the wild sends any of it yet.
      const w: Shape = was[`apps/server/src/protocol.ts:${name}`] ?? { kind: 'object', props: {} };
      if (n?.kind === 'union' && w.kind === 'union') {
        for (const m of n.members) {
          if (m.kind !== 'object') continue;
          const tag = m.props['type'];
          const before = w.members.find((x) => x.kind === 'object' && x.props['type'] === tag);
          if (before) newRequired(m, before, `${name}[${tag}]`);
        }
      } else if (n) newRequired(n, w, name);
    }
    expect(problems, problems.join('\n')).toEqual([]);
    if (process.env.SCHEMA_UPDATE) writeFileSync(SNAPSHOT, JSON.stringify(now, null, 1) + '\n');
    // Additions are fine, but the snapshot must say so: an unsnapshotted addition is a forgotten one.
    if (!process.env.SCHEMA_UPDATE) {
      expect(JSON.stringify(now), 'the wire grew: refresh the snapshot with SCHEMA_UPDATE=1 and say what was added').toBe(JSON.stringify(was));
    }
  });

  it('spells out what matters', () => {
    const client = now['apps/server/src/protocol.ts:ClientMessage']!;
    expect(client.kind).toBe('union');
    const tags = (client as { members: Shape[] }).members.map((m) => (m.kind === 'object' ? m.props['type'] : '?'));
    for (const t of ['"action"', '"voice"', '"heard"', '"hears"', '"gift"', '"emote"', '"rules"', '"start"']) expect(tags, t).toContain(t);
    const view = now['packages/shared-types/src/index.ts:PublicView']!;
    expect(view.kind).toBe('object');
    expect((view as { props: Record<string, string> }).props['hand']).toBeDefined();
    const events = now['packages/table/src/index.ts:TableEvent']!;
    expect(events.kind).toBe('union');
    expect((events as { members: Shape[] }).members.length).toBe(15);
    // The named types are written as their members, and the re-exported result as its fields.
    expect((now['packages/shared-types/src/index.ts:Phase'] as { text: string }).text).toContain('"BID"');
    expect((now['packages/shared-types/src/index.ts:Suit'] as { text: string }).text).toContain('"hearts"');
    // Every app since 1.4.3 may ask for 'learn' in 'rules' and reads it back in the room's `mode`.
    expect((now['apps/server/src/protocol.ts:PlayMode'] as { text: string }).text).toContain('"learn"');
    const result = now['packages/engine/src/index.ts:DealScoreResult']!;
    expect(result.kind).toBe('object');
    for (const k of ['finalScore', 'callerMade', 'renonsSeat?', 'declarationPoints']) expect((result as { props: Record<string, string> }).props, k).toHaveProperty(k);
  });
});
