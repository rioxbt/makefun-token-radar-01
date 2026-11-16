// The token radar's value model (radar-2): the sealed snapshot in, a ranked board of launch
// candidates out.
//
// The question the board answers is: if a protocol's record stayed as it is, what would the token it
// may issue be worth, and which protocols are worth farming next. The model is calibrated from the
// snapshot's own figures, not from a hand-kept list of names: the multiple it applies to a protocol is
// the multiple the market already pays for the tokens of the same category, read off the snapshot's
// protocols that record both a market cap and a TVL.
//
//   comparable_multiple(category) = shrunk median of (mcap_usd / tvl_usd) over the snapshot's own
//                                   protocols that record a token in that category, winsorized to
//                                   [0.02, 4.0], shrunk towards the all-category median by shrink_weight
//                                   comparable protocols' worth of prior, then clamped to multiple_band
//   band(n)                       = the multiple divided and multiplied by 1 + 1.5 / sqrt(n + 1): the
//                                   implied value's low and high, which widen as a category's evidence
//                                   thins, so a category of one comparable states a wide band
//   momentum(change_7d)           = 1 + 0.35 x clamp(change_7d, -50, +100) / 100
//   patience(age_days)            = 0.85 + 0.30 x min(age_days, 1460) / 1460
//   implied_value_usd             = round(tvl_usd x comparable_multiple x momentum x patience)
//
// age_days is the whole days DefiLlama has tracked the protocol with no token recorded; an absent
// listed_at is read as 365 days. Every protocol goes through the same four figures, so no name is
// special-cased anywhere in this file.
//
// A protocol is a *launch candidate* when its record shows no token and it is not a wrapped, staked or
// bridged product of a token that already trades: the snapshot's own watchlist rule, widened to the
// whole universe and to every bridge-family or wrapper category. The snapshot's watchlist is a floor,
// never a ceiling, so every slug it names is a row whatever the subject rule says of it.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** The all-category shrinkage weight: this many comparable protocols' worth of prior. */
  shrink_weight: number;
  /** The multiple is winsorized to this band before the median, so one outlier cannot carry a row. */
  ratio_floor: number;
  ratio_cap: number;
  /** The multiple is clamped to this band after shrinkage: no claim beyond half a TVL or below a twentieth. */
  multiple_floor: number;
  multiple_cap: number;
  /** Growth: its band in per cent, and how much of it reaches the value. */
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  /** Patience: the multiplier at zero days, its range, and the days it saturates at. */
  patience_floor: number;
  patience_range: number;
  patience_days: number;
  /** An absent listed_at is this many days old. */
  unknown_age_days: number;
  /** The presumed horizon a farm position is held over, and the plan's review horizon. */
  hold_days: number;
  review_days: number;
}

export const MODEL: ModelConstants = {
  shrink_weight: 10,
  ratio_floor: 0.02,
  ratio_cap: 4,
  multiple_floor: 0.05,
  multiple_cap: 1.2,
  growth_floor: -50,
  growth_cap: 100,
  growth_weight: 0.35,
  patience_floor: 0.85,
  patience_range: 0.3,
  patience_days: 1460,
  unknown_age_days: 365,
  hold_days: 45,
  review_days: 90,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2 comparable-multiple';

/** A category whose protocols are a product of a token that already trades, never a launch subject. */
const PRODUCT_CATEGORIES = new Set<string>([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Stablecoin Wrapper',
]);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped, staked or staking product of another protocol. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchanges whose name in front of a protocol's marks its own product. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** How many traded protocols the dashboard's Traded view carries, by market cap. */
export const TRADED_ROWS = 30;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol's record shows no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a launch candidate: pre-token, and not a product of a token that trades. */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (VERSIONED.test(p.name)) return false;
  return !EXCHANGES.some((e) => p.name.startsWith(e));
}

/** One category's calibration: the multiple the market pays there, and how many protocols said so. */
export interface Calibration {
  category: string;
  /** Comparable protocols: this category's records that carry both a market cap and a TVL. */
  n: number;
  /** The winsorized median market cap over TVL of those comparables, before shrinkage. */
  median: number;
  /** The multiple the model applies after shrinkage and clamping: median x and low/high are its band. */
  multiple: number;
  low: number;
  high: number;
  shrunk: boolean;
  /** 1 + 1.5 / sqrt(n + 1): how far the band splits either side of the multiple, widest where n is small. */
  spread: number;
  /** Up to three of the comparables the median was read off, by TVL, so the page can show its sources. */
  examples: { slug: string; name: string; ratio: number }[];
}

/** The multiples the model applies, one per category the snapshot names, and the all-category fallback. */
export interface CalibrationTable {
  as_of: string;
  /** Comparable protocols in all: the snapshot's records carrying both a market cap and a TVL. */
  comparables: number;
  /** The all-category median multiple every thin category is pulled towards. */
  overall: number;
  /** The share of the snapshot's protocols whose record carries a token. */
  coverage: number;
  by_category: Calibration[];
  /** The table by category name, for the scorer's use. */
  index: Map<string, Calibration>;
}

/** The winsorized market cap over TVL of one traded protocol, or null when it records no token. */
function comparableRatio(p: SnapshotProtocol, model: ModelConstants): number | null {
  if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) return null;
  return Math.min(model.ratio_cap, Math.max(model.ratio_floor, p.mcap_usd / p.tvl_usd));
}

/** The median of a non-empty sorted-or-not list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * How wide the implied value's band is: 1 + 1.5 / sqrt(n + 1), so a category read off one comparable
 * states a band 2.06x either side of its multiple and one read off fifteen states about 1.37x. The band
 * is the multiple divided and multiplied by this, never a fetched figure: it is this model's own
 * statement of how little a thin category says.
 */
export function spreadFor(n: number): number {
  return 1 + 1.5 / Math.sqrt(n + 1);
}

/** The value at quantile q of a list, by linear interpolation between its order statistics. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * The calibration table: for every category the snapshot names, the median market cap over TVL of
 * its comparable protocols, winsorized, shrunk towards the all-category median by `weight` comparable
 * protocols' worth of prior, then clamped. A category with no comparable keeps the all-category value
 * (`shrunk` says which happened), and `low`/`high` are the same shrinking applied to its quartiles.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): CalibrationTable {
  const ratios: number[] = [];
  const byCategory = new Map<string, number[]>();
  const examplesBy = new Map<string, { slug: string; name: string; ratio: number; tvl: number }[]>();
  for (const p of snapshot.protocols) {
    const ratio = comparableRatio(p, model);
    if (ratio === null) continue;
    ratios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
    const examples = examplesBy.get(key);
    const entry = { slug: p.slug, name: p.name, ratio: round(ratio, 4), tvl: p.tvl_usd };
    if (examples === undefined) examplesBy.set(key, [entry]);
    else examples.push(entry);
  }
  const overall = ratios.length === 0 ? 0.2 : median(ratios);
  const weight = model.shrink_weight;
  const shrink = (raw: number, n: number): number =>
    Math.min(model.multiple_cap, Math.max(model.multiple_floor, (n * raw + weight * overall) / (n + weight)));

  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? 'Uncategorised');
  const scale = (v: number): number => Math.min(model.ratio_cap, Math.max(model.ratio_floor, v));
  const by_category: Calibration[] = [...categories]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((category) => {
      const list = (byCategory.get(category) ?? []).map(scale);
      const n = list.length;
      const examples = (examplesBy.get(category) ?? [])
        .sort((a, b) => b.tvl - a.tvl || (a.slug < b.slug ? -1 : 1))
        .slice(0, 3)
        .map((e) => ({ slug: e.slug, name: e.name, ratio: e.ratio }));
      const spread = spreadFor(n);
      if (n === 0) {
        const only = round(shrink(overall, 0), 4);
        return {
          category,
          n: 0,
          median: 0,
          multiple: only,
          low: round(Math.max(model.multiple_floor, only / spread), 4),
          high: round(Math.min(model.multiple_cap, only * spread), 4),
          shrunk: true,
          spread: round(spread, 4),
          examples,
        };
      }
      const raw = median(list);
      const multiple = shrink(raw, n);
      return {
        category,
        n,
        median: round(raw, 4),
        multiple: round(multiple, 4),
        low: round(Math.max(model.multiple_floor, multiple / spread), 4),
        high: round(Math.min(model.multiple_cap, multiple * spread), 4),
        shrunk: n < model.shrink_weight,
        spread: round(spread, 4),
        examples,
      };
    });
  const index = new Map(by_category.map((c) => [c.category, c]));
  const traded = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  return {
    as_of: snapshot.as_of,
    comparables: ratios.length,
    overall: round(overall, 4),
    coverage: snapshot.protocols.length === 0 ? 0 : round(traded / snapshot.protocols.length, 4),
    by_category,
    index,
  };
}

/** The growth's multiplier: the seven-day change reaches the value at `growth_weight` of its band. */
export function momentumMultiplier(change7d: number | null, model: ModelConstants = MODEL): number {
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(change7d, 0)));
  return 1 + (growth / 100) * model.growth_weight;
}

/** The patience multiplier: a protocol tracked longer with no token carries a longer record. */
export function patienceMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const days = age ?? model.unknown_age_days;
  return model.patience_floor + (Math.min(Math.max(days, 0), model.patience_days) / model.patience_days) * model.patience_range;
}

/** One protocol's implied value, with every figure the breakdown shows. */
export interface Valuation {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  category_comparables: number;
  category_median: number;
  momentum: number;
  patience: number;
  growth_pct: number;
  age: number | null;
}

/** The tier a row belongs to: the snapshot's watchlist, or the early radar below it. */
export function tierOf(p: SnapshotProtocol, snapshot: Snapshot): 'watchlist' | 'early' {
  return snapshot.watchlist.includes(p.slug) ? 'watchlist' : 'early';
}

/** The three multipliers and the implied value one protocol gets under `model` and `table`. */
export function impliedValue(p: SnapshotProtocol, asOf: string, table: CalibrationTable, model: ModelConstants = MODEL): Valuation {
  const age = ageDays(asOf, p.listed_at);
  const category = table.index.get(p.category ?? 'Uncategorised');
  const multiple = category === undefined ? table.overall : category.multiple;
  const low = category === undefined ? table.overall : category.low;
  const high = category === undefined ? table.overall : category.high;
  const momentum = momentumMultiplier(p.change_7d, model);
  const patience = patienceMultiplier(age, model);
  const value = (m: number): number => Math.max(1, Math.round(p.tvl_usd * m * momentum * patience));
  return {
    implied: value(multiple),
    low: Math.min(value(low), value(multiple)),
    high: Math.max(value(high), value(multiple)),
    multiple: round(multiple, 4),
    category_comparables: category === undefined ? 0 : category.n,
    category_median: category === undefined ? table.overall : category.median,
    momentum: round(momentum, 4),
    patience: round(patience, 4),
    growth_pct: Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0))),
    age,
  };
}

/** One row of board.json: the ranked board's row, with the figures the dashboard reads. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  tier: 'watchlist' | 'early';
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  comparable_multiple: number;
  comparable_protocols: number;
  momentum: number;
  patience: number;
  farm_steps: string[];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, table: CalibrationTable, plan: (p: SnapshotProtocol, v: Valuation, rank: number, total: number) => string[], model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is a row, whatever the subject rule says of it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every launch candidate the snapshot carries, the whole universe and not the floor.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, table, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.v.age,
    listed_at: s.p.listed_at,
    tier: tierOf(s.p, snapshot),
    implied_value_usd: s.v.implied,
    implied_low_usd: s.v.low,
    implied_high_usd: s.v.high,
    comparable_multiple: s.v.multiple,
    comparable_protocols: s.v.category_comparables,
    momentum: s.v.momentum,
    patience: s.v.patience,
    farm_steps: plan(s.p, s.v, i + 1, scored.length),
  }));
}

/** A protocol whose token already trades: the board shows the market's own value, never the model's. */
export interface TradedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  change_7d: number | null;
}

/** The traded protocols, by market cap: the comparables the calibration is read off. */
export function tradedRows(snapshot: Snapshot, model: ModelConstants = MODEL): TradedRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, TRADED_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      ratio: round((p.mcap_usd as number) / p.tvl_usd, 4),
      change_7d: p.change_7d,
    }));
}

/** What the dashboard renders: the board, the calibration behind it, the traded set and the counts. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  method: {
    formula: string;
    shrink_weight: number;
    ratio_band: [number, number];
    multiple_band: [number, number];
    growth_band: [number, number];
    growth_weight: number;
    patience_floor: number;
    patience_days: number;
    patience_range: number;
    unknown_age_days: number;
    hold_days: number;
    review_days: number;
  };
  calibration: {
    comparables: number;
    overall: number;
    coverage: number;
    by_category: Calibration[];
  };
  counts: {
    protocols: number;
    pre_token: number;
    traded: number;
    candidates: number;
    watchlist: number;
    rows: number;
    watchlist_rows: number;
    early_rows: number;
    above_floor: number;
    below_floor: number;
    categories: number;
  };
  rows: BoardRow[];
  traded: TradedRow[];
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, table: CalibrationTable, plan: (p: SnapshotProtocol, v: Valuation, rank: number, total: number) => string[], model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, table, plan, model);
  const traded = tradedRows(snapshot, model);
  const pre = snapshot.protocols.filter(isPreToken).length;
  const candidates = snapshot.protocols.filter(isLaunchCandidate).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    method: {
      formula: 'implied = tvl_usd x comparable_multiple(category) x momentum(change_7d) x patience(age_days)',
      shrink_weight: model.shrink_weight,
      ratio_band: [model.ratio_floor, model.ratio_cap],
      multiple_band: [model.multiple_floor, model.multiple_cap],
      growth_band: [model.growth_floor, model.growth_cap],
      growth_weight: model.growth_weight,
      patience_floor: model.patience_floor,
      patience_days: model.patience_days,
      patience_range: model.patience_range,
      unknown_age_days: model.unknown_age_days,
      hold_days: model.hold_days,
      review_days: model.review_days,
    },
    calibration: {
      comparables: table.comparables,
      overall: table.overall,
      coverage: table.coverage,
      by_category: table.by_category.filter((c) => c.n > 0),
    },
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: pre,
      traded: snapshot.protocols.length - pre,
      candidates,
      watchlist: snapshot.watchlist.length,
      rows: board.length,
      watchlist_rows: board.filter((r) => r.tier === 'watchlist').length,
      early_rows: board.filter((r) => r.tier === 'early').length,
      above_floor: board.filter((r) => r.tvl_usd >= snapshot.floor_usd).length,
      below_floor: board.filter((r) => r.tvl_usd < snapshot.floor_usd).length,
      categories: new Set(board.map((r) => r.category ?? 'Uncategorised')).size,
    },
    rows: board,
    traded,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd as number, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug)) return `${r.slug} is not a usable slug`;
    if (r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
