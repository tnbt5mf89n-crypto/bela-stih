import { createServer } from 'node:http';
import express, { type Request, type Response } from 'express';
import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BelaRoom } from './BelaRoom';
import { configStatus, startConfigPolling } from './config';
import { MAX_FRAME_BYTES, MIN_PROTO, PROTO, ROOM_NAME, ROOM_NAME_MODES } from './protocol';

/**
 * The Bela game server.
 *
 * Deliberately tiny: all the rules live in `@belot/engine`, all the seat
 * handling in `@belot/table`, and this only wires them to a socket. The same
 * engine that runs on the phone decides every move here, which is what makes
 * "the server is authoritative" true rather than aspirational.
 *
 *   npm run start --workspace @belot/server
 *
 * The HTTP server must be an express app, not a bare request handler: Colyseus
 * mounts its `/matchmake/*` routes alongside it, and a catch-all handler
 * swallows them so every join fails with a 404.
 */

/**
 * Every room on this host shares one process, so an escaped throw from one
 * table's message handler ends every other table's match too. BelaRoom catches
 * per-message already; this is the backstop for anything that gets past it —
 * a timer callback, a promise nobody awaited. Log it and keep serving: one bad
 * room is a bug, a dead process is an outage.
 */
process.on('uncaughtException', (err) => {
  console.error('[bela] uncaught exception (server stays up):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[bela] unhandled rejection (server stays up):', reason);
});

const PORT = Number(process.env.PORT ?? 2567);

const app = express();

// A health endpoint, so a host or uptime check has something to hit - and
// says which build this is (the image's git SHA, set by the deploy), which
// wire generations it serves, and how busy it is. Counts only: nothing here
// names a table or a player.
const STARTED_AT = Date.now();
const SHA = process.env.GIT_SHA ?? 'dev';
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    room: ROOM_NAME,
    sha: SHA,
    proto: PROTO,
    minProto: MIN_PROTO,
    rooms: matchMaker.stats.local.roomCount,
    players: matchMaker.stats.local.ccu,
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    config: configStatus(),
  });
});

// The kill switch (config.ts): CONFIG_FILE (else CONFIG_URL) re-read every minute, or CONFIG_JSON once.
startConfigPolling(process.env);

const httpServer = createServer(app);
const gameServer = new Server({
  // Room for one voice clip in a frame (protocol.ts); the default 4 KB closed
  // the socket of anyone who sent one.
  transport: new WebSocketTransport({ server: httpServer, maxPayload: MAX_FRAME_BYTES }),
});

gameServer.define(ROOM_NAME, BelaRoom);
// Tables for apps that know the three versions (protocol.ts): they say so.
gameServer.define(ROOM_NAME_MODES, BelaRoom, { modes: true });

gameServer
  .listen(PORT)
  .then(() => console.log(`[bela] listening on :${PORT}`))
  .catch((err: unknown) => {
    console.error('[bela] failed to start', err);
    process.exitCode = 1;
  });
