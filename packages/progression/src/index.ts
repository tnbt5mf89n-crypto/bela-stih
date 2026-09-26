/**
 * @belot/progression — levels, coins and the daily loop.
 *
 * Pure functions over a plain profile object, exactly like the rules engine: no
 * storage, no clock, no randomness that is not passed in. That keeps it unit
 * testable, and means the server can re-run the identical logic to validate a
 * client's claims once accounts exist.
 *
 * COMPLIANCE, deliberately: coins are **earned rewards, never a wager**. Nothing
 * here charges an entry fee or stakes a pot, because a stake-and-pot mechanic is
 * what drags the IARC questionnaire toward a "Simulated Gambling" descriptor and
 * an automatic PEGI 18. Coins are non-redeemable and buy cosmetics and table
 * gifts only. A gift gives its receiver NOTHING — no coins, no XP, no item — so
 * coins never move from one player to another.
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * The stored profile's format. 1 was everything up to 1.5.x (no version field
 * at all); 2 (1.6.0) adds this field. migrateProfile() brings any older record
 * up; a record from a NEWER app is kept as it is, never cut down.
 */
export const PROFILE_VERSION = 2;

export interface PlayerProfile {
  /** PROFILE_VERSION when written; an old record has none. */
  version: number;
  xp: number;
  coins: number;

  matchesPlayed: number;
  matchesWon: number;
  dealsPlayed: number;
  dealsWon: number;
  zvanjaCalled: number;
  belaCalled: number;
  valats: number;
  bestDealScore: number;

  /** ISO `YYYY-MM-DD` of the last claimed daily bonus. */
  lastBonusDay: string | null;
  /** Consecutive days claimed, 1-based. */
  streakDays: number;

  /** ISO day the current quest set was generated for. */
  questDay: string | null;
  quests: Quest[];

  ownedCardBacks: string[];
  ownedFelts: string[];
  ownedAvatars: string[];

  selectedCardBack: string;
  selectedFelt: string;
  selectedAvatar: string;

  /** Recipients of every table gift this player has paid for (a table gift to three counts three). */
  giftsSent: number;
}

export const STARTING_COINS = 1000;

export function emptyProfile(): PlayerProfile {
  return {
    version: PROFILE_VERSION,
    xp: 0,
    coins: STARTING_COINS,
    matchesPlayed: 0,
    matchesWon: 0,
    dealsPlayed: 0,
    dealsWon: 0,
    zvanjaCalled: 0,
    belaCalled: 0,
    valats: 0,
    bestDealScore: 0,
    lastBonusDay: null,
    streakDays: 0,
    questDay: null,
    quests: [],
    ownedCardBacks: ['classic'],
    ownedFelts: ['green'],
    ownedAvatars: ['djed', 'baka'],
    selectedCardBack: 'classic',
    selectedFelt: 'green',
    selectedAvatar: 'djed',
    giftsSent: 0,
  };
}

/**
 * A stored profile of any age, as this app understands it: the fields it
 * knows merged over an empty profile (so a record written by an older app
 * gains every newer field with its default instead of arriving undefined),
 * the version stamped. Anything that is not an object is a fresh profile.
 * Migrations that change a field's meaning go here, keyed on `version`.
 */
export function migrateProfile(raw: unknown): PlayerProfile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyProfile();
  const stored = raw as Partial<PlayerProfile> & { version?: unknown };
  const version = typeof stored.version === 'number' ? stored.version : 1;
  const merged: PlayerProfile = { ...emptyProfile(), ...stored, version: Math.max(version, PROFILE_VERSION) };
  // 1 -> 2: nothing changed its meaning; the field itself is the migration.
  return merged;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export const MAX_LEVEL = 50;

/** Total XP needed to reach level `n`. Level 1 starts at zero. */
export function xpToReachLevel(n: number): number {
  if (n <= 1) return 0;
  return Math.round(50 * Math.pow(n - 1, 1.6));
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpToReachLevel(level + 1)) level++;
  return level;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP at the start of this level, and at the start of the next. */
  levelStart: number;
  levelEnd: number;
  /** 0..1 through the current level; 1 when maxed. */
  fraction: number;
  isMax: boolean;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  const isMax = level >= MAX_LEVEL;
  const levelStart = xpToReachLevel(level);
  const levelEnd = isMax ? levelStart : xpToReachLevel(level + 1);
  const span = levelEnd - levelStart;
  return {
    level,
    xp,
    levelStart,
    levelEnd,
    fraction: isMax || span <= 0 ? 1 : (xp - levelStart) / span,
    isMax,
  };
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export const XP = {
  dealPlayed: 10,
  dealWon: 25,
  perZvanje: 5,
  bela: 10,
  valat: 50,
  matchWon: 100,
  matchLost: 25,
} as const;

export const COINS = {
  dealWon: 5,
  valat: 50,
  matchWon: 100,
  /** Losing still pays: this is a reward currency, not a stake. */
  matchLost: 20,
} as const;

/** What happened to the player's team in one deal. */
export interface DealOutcome {
  won: boolean;
  /** The player's team score for this deal, for the personal best. */
  points: number;
  zvanjaCalled: number;
  belaCalled: boolean;
  valat: boolean;
  /**
   * Učenje: the app found and announced the zvanja for the player, so they
   * still count in the statistics but earn no XP (1.6.0). Lagana and Prava
   * bela, where the player has to spot them, pay as before.
   */
  autoZvanja?: boolean;
}

/** A shorter match pays less: 501 is about half the deals of 1001. */
export const MATCH_LENGTH_FACTOR: Readonly<Record<number, number>> = { 501: 0.6, 701: 0.8, 1001: 1 };

export interface MatchOptions {
  /** The match target (501, 701, 1001); anything else pays as 1001. */
  target?: number;
  /** Today (isoDay): the quests roll over first, so a match past midnight counts for the new day. */
  today?: string;
}

export interface Award {
  xp: number;
  coins: number;
  /** Set when this award pushed the player over a level boundary. */
  levelUp: number | null;
  reasons: string[];
}

function award(
  profile: PlayerProfile,
  xp: number,
  coins: number,
  reasons: string[],
): { profile: PlayerProfile; award: Award } {
  const before = levelFromXp(profile.xp);
  const next: PlayerProfile = { ...profile, xp: profile.xp + xp, coins: profile.coins + coins };
  const after = levelFromXp(next.xp);
  return {
    profile: next,
    award: { xp, coins, levelUp: after > before ? after : null, reasons },
  };
}

export function applyDealOutcome(
  profile: PlayerProfile,
  outcome: DealOutcome,
  today?: string,
): { profile: PlayerProfile; award: Award } {
  if (today) profile = ensureQuests(profile, today);
  let xp = XP.dealPlayed;
  let coins = 0;
  const reasons: string[] = ['dealPlayed'];

  if (outcome.won) {
    xp += XP.dealWon;
    coins += COINS.dealWon;
    reasons.push('dealWon');
  }
  if (outcome.zvanjaCalled > 0 && !outcome.autoZvanja) {
    xp += XP.perZvanje * outcome.zvanjaCalled;
    reasons.push('zvanja');
  }
  if (outcome.belaCalled) {
    xp += XP.bela;
    reasons.push('bela');
  }
  if (outcome.valat) {
    xp += XP.valat;
    coins += COINS.valat;
    reasons.push('valat');
  }

  const stats: PlayerProfile = {
    ...profile,
    dealsPlayed: profile.dealsPlayed + 1,
    dealsWon: profile.dealsWon + (outcome.won ? 1 : 0),
    zvanjaCalled: profile.zvanjaCalled + outcome.zvanjaCalled,
    belaCalled: profile.belaCalled + (outcome.belaCalled ? 1 : 0),
    valats: profile.valats + (outcome.valat ? 1 : 0),
    bestDealScore: Math.max(profile.bestDealScore, outcome.points),
  };

  const result = award(stats, xp, coins, reasons);
  return { profile: bumpQuests(result.profile, outcome), award: result.award };
}

export function applyMatchOutcome(
  profile: PlayerProfile,
  won: boolean,
  opts: MatchOptions = {},
): { profile: PlayerProfile; award: Award } {
  if (opts.today) profile = ensureQuests(profile, opts.today);
  const stats: PlayerProfile = {
    ...profile,
    matchesPlayed: profile.matchesPlayed + 1,
    matchesWon: profile.matchesWon + (won ? 1 : 0),
  };
  const factor = MATCH_LENGTH_FACTOR[opts.target ?? 1001] ?? 1;
  const result = award(
    stats,
    Math.round((won ? XP.matchWon : XP.matchLost) * factor),
    Math.round((won ? COINS.matchWon : COINS.matchLost) * factor),
    [won ? 'matchWon' : 'matchLost'],
  );
  return {
    profile: bumpQuests(result.profile, null, won),
    award: result.award,
  };
}

// ---------------------------------------------------------------------------
// Daily bonus
// ---------------------------------------------------------------------------

/** Escalating over a week, then it repeats. */
export const DAILY_BONUS = [100, 150, 200, 250, 300, 400, 500] as const;

export function dailyBonusFor(streakDay: number): number {
  const i = Math.max(0, streakDay - 1) % DAILY_BONUS.length;
  return DAILY_BONUS[i]!;
}

/** ISO `YYYY-MM-DD` in local time — the day boundary a player actually feels. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function previousDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  date.setDate(date.getDate() - 1);
  return isoDay(date);
}

export function canClaimDaily(profile: PlayerProfile, today: string): boolean {
  return profile.lastBonusDay !== today;
}

export interface DailyClaim {
  profile: PlayerProfile;
  coins: number;
  streakDays: number;
  /** True when a day was missed: the streak did not grow, and pays its last day again. */
  streakPaused: boolean;
}

/**
 * What claiming today WOULD pay — the only number the lobby may advertise.
 * A missed day PAUSES the streak (1.6.0): it neither grows nor falls back to
 * day 1, and today pays the same day again. Nobody loses a week's climb to
 * one evening away, and the banner never promises the grown amount.
 */
export function previewDaily(
  profile: PlayerProfile,
  today: string,
): { coins: number; streakDays: number } {
  const continued = profile.lastBonusDay === previousDay(today);
  const streakDays = continued ? profile.streakDays + 1 : profile.lastBonusDay === null ? 1 : Math.max(1, profile.streakDays);
  return { coins: dailyBonusFor(streakDays), streakDays };
}

export function claimDaily(profile: PlayerProfile, today: string): DailyClaim {
  if (!canClaimDaily(profile, today)) {
    return { profile, coins: 0, streakDays: profile.streakDays, streakPaused: false };
  }
  const { coins, streakDays } = previewDaily(profile, today);
  return {
    profile: { ...profile, coins: profile.coins + coins, lastBonusDay: today, streakDays },
    coins,
    streakDays,
    streakPaused: profile.lastBonusDay !== null && profile.lastBonusDay !== previousDay(today),
  };
}

// ---------------------------------------------------------------------------
// Daily quests
// ---------------------------------------------------------------------------

export type QuestKind = 'playDeals' | 'winDeals' | 'callZvanja' | 'callBela' | 'winMatch';

export interface Quest {
  kind: QuestKind;
  target: number;
  progress: number;
  reward: number;
  claimed: boolean;
}

const QUEST_POOL: ReadonlyArray<{ kind: QuestKind; target: number; reward: number }> = [
  { kind: 'playDeals', target: 5, reward: 100 },
  { kind: 'winDeals', target: 3, reward: 150 },
  { kind: 'callZvanja', target: 2, reward: 150 },
  { kind: 'callBela', target: 1, reward: 200 },
  { kind: 'winMatch', target: 1, reward: 250 },
];

/**
 * Deterministic per-day selection: the same day always yields the same three
 * quests, so nothing has to be persisted beyond the day stamp and progress.
 */
export function questsForDay(day: string): Quest[] {
  let seed = 0;
  for (const ch of day) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = [...QUEST_POOL];
  const picked: Quest[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    // Math.imul, not `*`: the product passes 2^53 and the low bits round away,
    // which collapsed the rotation onto the same board on almost every day.
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const [spec] = pool.splice(seed % pool.length, 1);
    picked.push({ ...spec!, progress: 0, claimed: false });
  }
  return picked;
}

export function ensureQuests(profile: PlayerProfile, today: string): PlayerProfile {
  if (profile.questDay === today) return profile;
  return { ...profile, questDay: today, quests: questsForDay(today) };
}

function bumpQuests(
  profile: PlayerProfile,
  deal: DealOutcome | null,
  matchWon?: boolean,
): PlayerProfile {
  if (profile.quests.length === 0) return profile;
  const quests = profile.quests.map((q) => {
    let add = 0;
    if (deal) {
      if (q.kind === 'playDeals') add = 1;
      else if (q.kind === 'winDeals' && deal.won) add = 1;
      else if (q.kind === 'callZvanja') add = deal.zvanjaCalled;
      else if (q.kind === 'callBela' && deal.belaCalled) add = 1;
    } else if (q.kind === 'winMatch' && matchWon) add = 1;
    return add === 0 ? q : { ...q, progress: Math.min(q.target, q.progress + add) };
  });
  return { ...profile, quests };
}

export function isQuestComplete(q: Quest): boolean {
  return q.progress >= q.target;
}

export function claimQuest(
  profile: PlayerProfile,
  index: number,
): { profile: PlayerProfile; coins: number } {
  const q = profile.quests[index];
  if (!q || q.claimed || !isQuestComplete(q)) return { profile, coins: 0 };
  const quests = profile.quests.map((x, i) => (i === index ? { ...x, claimed: true } : x));
  return { profile: { ...profile, quests, coins: profile.coins + q.reward }, coins: q.reward };
}

// ---------------------------------------------------------------------------
// Cosmetics — one of the two coin sinks (gifts, below, are the other); levels gate both
// ---------------------------------------------------------------------------

export interface Cosmetic {
  id: string;
  kind: 'cardBack' | 'felt' | 'avatar';
  price: number;
  requiredLevel: number;
}

export const COSMETICS: readonly Cosmetic[] = [
  { id: 'classic', kind: 'cardBack', price: 0, requiredLevel: 1 },
  { id: 'lattice', kind: 'cardBack', price: 500, requiredLevel: 3 },
  { id: 'oak', kind: 'cardBack', price: 1200, requiredLevel: 8 },
  { id: 'green', kind: 'felt', price: 0, requiredLevel: 1 },
  { id: 'walnut', kind: 'felt', price: 800, requiredLevel: 5 },
  { id: 'midnight', kind: 'felt', price: 1500, requiredLevel: 12 },
  { id: 'djed', kind: 'avatar', price: 0, requiredLevel: 1 },
  { id: 'baka', kind: 'avatar', price: 0, requiredLevel: 1 },
  { id: 'brko', kind: 'avatar', price: 400, requiredLevel: 2 },
  { id: 'snasa', kind: 'avatar', price: 400, requiredLevel: 2 },
  { id: 'student', kind: 'avatar', price: 600, requiredLevel: 4 },
  { id: 'teta', kind: 'avatar', price: 600, requiredLevel: 4 },
  { id: 'sofer', kind: 'avatar', price: 800, requiredLevel: 6 },
  { id: 'majstor', kind: 'avatar', price: 800, requiredLevel: 6 },
  { id: 'gazda', kind: 'avatar', price: 1000, requiredLevel: 9 },
  { id: 'profesorica', kind: 'avatar', price: 1000, requiredLevel: 9 },
  { id: 'ribar', kind: 'avatar', price: 1400, requiredLevel: 12 },
  { id: 'kapetan', kind: 'avatar', price: 2000, requiredLevel: 15 },
];

/** The profile fields backing each cosmetic kind — the single lookup the shop uses. */
const COSMETIC_KEYS = {
  cardBack: { owned: 'ownedCardBacks', selected: 'selectedCardBack' },
  felt: { owned: 'ownedFelts', selected: 'selectedFelt' },
  avatar: { owned: 'ownedAvatars', selected: 'selectedAvatar' },
} as const;

export function isOwned(profile: PlayerProfile, c: Cosmetic): boolean {
  return profile[COSMETIC_KEYS[c.kind].owned].includes(c.id);
}

/** The id currently equipped for a kind. */
export function selectedId(profile: PlayerProfile, kind: Cosmetic['kind']): string {
  return profile[COSMETIC_KEYS[kind].selected];
}

export function canBuy(profile: PlayerProfile, c: Cosmetic): boolean {
  return (
    !isOwned(profile, c) &&
    profile.coins >= c.price &&
    levelFromXp(profile.xp) >= c.requiredLevel
  );
}

/** Buying equips: the freshly bought cosmetic becomes the selected one. */
export function buy(profile: PlayerProfile, c: Cosmetic): PlayerProfile {
  if (!canBuy(profile, c)) return profile;
  const keys = COSMETIC_KEYS[c.kind];
  return {
    ...profile,
    coins: profile.coins - c.price,
    [keys.owned]: [...profile[keys.owned], c.id],
    [keys.selected]: c.id,
  };
}

/** Equip an owned cosmetic; anything unowned hands back the same profile untouched. */
export function selectCosmetic(profile: PlayerProfile, c: Cosmetic): PlayerProfile {
  if (!isOwned(profile, c)) return profile;
  return { ...profile, [COSMETIC_KEYS[c.kind].selected]: c.id };
}

// ---------------------------------------------------------------------------
// Table gifts — the everyday coin sink
// ---------------------------------------------------------------------------

/**
 * The fixed gift catalogue, in the order the picker shows it. A fixed list and
 * fixed prices: nothing is random, nothing is a box. The game server keeps its
 * own copy of these ids (apps/server/src/protocol.ts GIFT_IDS) — a mobile test
 * fails if the two drift.
 */
export const GIFT_IDS = [
  'kava',
  'caj',
  'limunada',
  'rakija',
  'pivo',
  'gemist',
  'burek',
  'kolac',
  'sladoled',
  'maramice',
  'ruza',
  'djetelina',
  'potkova',
  'pehar',
  'kruna',
] as const;
export type GiftId = (typeof GIFT_IDS)[number];

export interface Gift {
  id: GiftId;
  /** Coins per recipient. Always a multiple of 5, so "N novčića" never needs another plural. */
  price: number;
  requiredLevel: number;
  /**
   * The kafana drinks. The content-rating questionnaire declares them; if a
   * store ever objects, this is the one flag to filter on.
   */
  alcohol?: true;
}

export const GIFTS: readonly Gift[] = [
  { id: 'kava', price: 20, requiredLevel: 1 },
  { id: 'caj', price: 20, requiredLevel: 1 },
  { id: 'limunada', price: 25, requiredLevel: 1 },
  { id: 'rakija', price: 40, requiredLevel: 3, alcohol: true },
  { id: 'pivo', price: 30, requiredLevel: 2, alcohol: true },
  { id: 'gemist', price: 35, requiredLevel: 2, alcohol: true },
  { id: 'burek', price: 30, requiredLevel: 1 },
  { id: 'kolac', price: 35, requiredLevel: 1 },
  { id: 'sladoled', price: 30, requiredLevel: 1 },
  { id: 'maramice', price: 20, requiredLevel: 1 },
  { id: 'ruza', price: 50, requiredLevel: 2 },
  { id: 'djetelina', price: 60, requiredLevel: 4 },
  { id: 'potkova', price: 80, requiredLevel: 6 },
  { id: 'pehar', price: 120, requiredLevel: 8 },
  { id: 'kruna', price: 150, requiredLevel: 10 },
];

export function isGiftId(v: unknown): v is GiftId {
  return typeof v === 'string' && (GIFT_IDS as readonly string[]).includes(v);
}

export function giftById(id: string): Gift | undefined {
  return GIFTS.find((g) => g.id === id);
}

/** What sending `g` to `recipients` players costs the sender. */
export function giftCost(g: Gift, recipients: number): number {
  return g.price * Math.max(0, Math.floor(recipients));
}

/** Why a gift cannot be sent right now, or null when it can. */
export type GiftBlock = 'level' | 'coins' | null;

export function giftBlock(profile: PlayerProfile, id: GiftId, recipients: number): GiftBlock {
  const g = giftById(id);
  if (!g) return 'level';
  if (levelFromXp(profile.xp) < g.requiredLevel) return 'level';
  if (recipients < 1 || profile.coins < giftCost(g, recipients)) return 'coins';
  return null;
}

export function canAffordGift(profile: PlayerProfile, id: GiftId, recipients: number): boolean {
  return giftBlock(profile, id, recipients) === null;
}

/**
 * The sender pays; that is ALL a gift does to any profile. It hands back the
 * very same object when the gift is blocked, so a caller can tell. There is
 * deliberately no function that credits a receiver with anything.
 */
export function spendOnGift(profile: PlayerProfile, id: GiftId, recipients: number): PlayerProfile {
  if (!canAffordGift(profile, id, recipients)) return profile;
  const g = giftById(id)!;
  return {
    ...profile,
    coins: profile.coins - giftCost(g, recipients),
    giftsSent: (profile.giftsSent ?? 0) + recipients,
  };
}
