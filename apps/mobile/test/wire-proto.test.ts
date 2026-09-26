import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Lang, LOCALE_IDS } from '@belot/i18n';
import { PROTO, UPDATE_APP_CODE } from '../src/net/proto';
import { MIN_PROTO, PROTO as SERVER_PROTO, UPDATE_APP_CODE as SERVER_UPDATE_APP_CODE } from '../../server/src/protocol';
import { troubleOf, retryHelps } from '../src/net/trouble';

/**
 * The wire generation handshake, app and server held together: the app says
 * its generation with every join, the server refuses one it can no longer
 * serve, and the app tells the player to update rather than "couldn't join".
 * The reconnect loop's two exits are pinned here too.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');

describe('the wire generation', () => {
  it('is one number on both sides, and MIN_PROTO still lets every shipped app in', () => {
    expect(PROTO).toBe(SERVER_PROTO);
    expect(UPDATE_APP_CODE).toBe(SERVER_UPDATE_APP_CODE);
    // An app from before the handshake sends nothing and counts as 0.
    expect(MIN_PROTO).toBe(0);
    expect(PROTO).toBeGreaterThanOrEqual(MIN_PROTO);
    // Outside Colyseus's own codes (42xx) and the seat-clash code (4300).
    expect(UPDATE_APP_CODE).toBe(4301);
  });

  it('goes with every join, the app version beside it', () => {
    const n = src('net/useNetGame.ts');
    const joins = n.match(/c\.(joinOrCreate|create|joinById)\(.*\{[^}]*\}\)/g) ?? [];
    expect(joins.length).toBe(4);
    for (const j of joins) expect(j, j).toMatch(/proto: PROTO,\s*appVersion: APP_VERSION/);
  });

  it('is refused at the door, and the app says to update', () => {
    const room = readFileSync(join(here, '../../server/src/BelaRoom.ts'), 'utf8');
    expect(room).toMatch(/override onAuth\(_client: Client, options: unknown, context: AuthContext\)[\s\S]{0,700}if \(protoOf\(options\) < Math\.max\(MIN_PROTO, cfg\.minProto\)\) throw new ServerError\(UPDATE_APP_CODE, 'update the app'\);/);
    expect(room).toMatch(/proto: protoOf\(options\),/);
    expect(troubleOf({ code: 4301, message: 'update the app' })).toBe('appTooOld');
    expect(retryHelps('appTooOld')).toBe(false);
    expect(src('net/OnlineGame.tsx')).toMatch(/net\.trouble === 'appTooOld'\s*\? ui\.troubleAppTooOld/);
    for (const id of LOCALE_IDS) {
      const ui = new Lang(id).s.ui;
      expect(ui.troubleAppTooOld.length, id).toBeGreaterThan(10);
      expect(ui.crashCopy.length, id).toBeGreaterThan(3);
      expect(ui.crashCopied, id).toContain('prijave@belastih.com');
    }
  });

  it('the door has one code per refusal, on both sides', () => {
    const p = readFileSync(join(here, '../../server/src/protocol.ts'), 'utf8');
    const a = src('net/proto.ts');
    for (const [name, code] of [['UPDATE_APP_CODE', 4301], ['BLOCKED_CODE', 4302], ['BANNED_CODE', 4303], ['MAINTENANCE_CODE', 4304]] as const) {
      expect(p).toMatch(new RegExp(`export const ${name} = ${code};`));
      expect(a).toMatch(new RegExp(`export const ${name} = ${code};`));
    }
  });

  it('stops reconnecting when the table is gone, and never in lockstep', () => {
    const n = src('net/useNetGame.ts');
    expect(n).toMatch(/const ROOM_GONE_CODE = 4212;/);
    expect(n).toMatch(/const TOKEN_EXPIRED_CODE = 4214;/);
    expect(n).toMatch(/if \(code === ROOM_GONE_CODE\) break;/);
    // 4214 is what Colyseus says before the server has noticed the drop: never a reason to give up at once.
    expect(n).toMatch(/if \(code === TOKEN_EXPIRED_CODE && Date\.now\(\) - startedAt > TOKEN_GRACE_MS\) break;/);
    expect(n).toMatch(/const TOKEN_GRACE_MS = 15_000;/);
    expect(n).not.toMatch(/code === TOKEN_EXPIRED_CODE\) break;/);
    expect(n).toMatch(/setTimeout\(r, wait \* \(0\.5 \+ Math\.random\(\)\)\)/);
  });

  it('/health says which build and which generations', () => {
    const index = readFileSync(join(here, '../../server/src/index.ts'), 'utf8');
    expect(index).toMatch(/sha: SHA,\s*proto: PROTO,\s*minProto: MIN_PROTO,\s*rooms: matchMaker\.stats\.local\.roomCount,\s*players: matchMaker\.stats\.local\.ccu,\s*uptimeSeconds/);
    expect(readFileSync(join(here, '../../server/Dockerfile'), 'utf8')).toMatch(/ARG GIT_SHA=dev\s*ENV GIT_SHA=\$GIT_SHA/);
    const caddy = readFileSync(join(here, '../../../deploy/Caddyfile'), 'utf8');
    expect((caddy.match(/header_up X-Real-IP \{remote_host\}/g) ?? []).length).toBe(2);
  });
});
