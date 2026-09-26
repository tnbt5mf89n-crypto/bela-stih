/**
 * Reporting a player: an e-mail the reporter sends from their own mail app,
 * with the reported nickname, the table code, the time and the app version
 * filled in. Nothing about the reporter goes in, and nothing goes to the game
 * server, which keeps no data about anyone (docs/compliance-checklist.md).
 *
 * No React Native here, so the tests load it under node.
 */

/**
 * Where reports go: Porkbun's free forwarding for belastih.com (MX
 * fwd1/fwd2.porkbun.com) delivers them to the owner's inbox, set up on
 * 2026-09-23. Were this ever the placeholder again, scripts/build-android.sh
 * and scripts/build-web.sh would refuse to build a release.
 */
export const REPORT_EMAIL = 'prijave@belastih.com';

export interface ReportFacts {
  name: string;
  code: string;
  at: string;
  version: string;
  /** The reported seat's install ID (identity.ts), when its app gave one: the handle a ban can use. */
  id?: string;
}

export function reportMailto(
  ui: { reportSubject: string; reportBody: (p: ReportFacts) => string },
  f: ReportFacts,
): string {
  // Mail clients want CRLF line breaks in a mailto body.
  const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, '\r\n'));
  return `mailto:${REPORT_EMAIL}?subject=${enc(ui.reportSubject)}&body=${enc(ui.reportBody(f))}`;
}

/** "2026-09-19 14:38 UTC": when, without the reporter's time zone. */
export function reportStamp(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
