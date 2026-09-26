/**
 * The wire generation this app speaks (the server's protocol.ts PROTO; a test
 * holds the two together). Sent with every join as `proto`, with the app's
 * version beside it, so a server that can no longer serve this generation can
 * refuse at the door with UPDATE_APP_CODE instead of failing mid-match - and
 * so a table can tell which of its seats understand a newer message.
 */
export const PROTO = 1;

/** The server's refusal: this app is too old for that wire. */
export const UPDATE_APP_CODE = 4301;
/** A public table where somebody blocked you, or you them: try another table. */
export const BLOCKED_CODE = 4302;
/** This installation is banned. */
export const BANNED_CODE = 4303;
/** The server is closed for a moment. */
export const MAINTENANCE_CODE = 4304;
