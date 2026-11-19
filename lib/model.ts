// Launch Atlas 4 — the model. Node 22 stdlib only, erasable TypeScript.
// Three parts computed at runtime from the snapshot: (1) value-if-launched ridge,
// (2) launch odds, (3) bootstrap analytics; plus the universe rule, costed farm
// plans with per-row deposit sizing, the R4 verdict rule, board assembly and a
// self-check that asserts the ship gates. The dashboard mirrors these functions.

// ---------------------------------------------------------------- small utilities

/** Deterministic PRNG (mulberry32). Returns a function yielding floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Linear-interpolated quantile of an already-sorted array (type 7). */
export function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

/** Symmetric multiplicative miss: max(actual/pred, pred/actual) = 10^|log10(pred/actual)|. */
export const miss = (actual: number, pred: number): number => Math.max(actual / pred, pred / actual);

/** Gaussian elimination with partial pivoting. Solves A x = b (A n x n). */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) throw new Error('solve: singular matrix');
    if (piv !== c) { const t = M[piv]; M[piv] = M[c]; M[c] = t; }
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Spearman rank correlation (average ranks for ties). */
export function spearman(a: number[], b: number[]): number {
  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
    const r = new Array<number>(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b), ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

// ---------------------------------------------------------------- snapshot parsing

export interface Protocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  // derived
  age: number;
  growth: number;
  tok: boolean;
  group: string;
}

export interface Snapshot {
  asOf: string;
  source: string;
  floorUsd: number;
  protocols: Protocol[];
  watchlist: string[];
}

const DAY_MS = 86400000;

/** Category groups used by the odds model. */
export const GROUPS: Record<string, string[]> = {
  trading: ['Dexs', 'Derivatives', 'Options Vault', 'Prediction Market'],
  credit: ['Lending', 'CDP', 'Collateral Markets'],
  yield: ['Risk Curators', 'Onchain Capital Allocator', 'Yield', 'Yield Aggregator'],
  rwa: ['RWA'],
  infra: ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'CEX', 'Liquid Staking', 'Liquid Restaking'],
};
export const GROUP_NAMES = Object.keys(GROUPS).concat('other').sort();
export function groupOf(category: string): string {
  for (const g in GROUPS) if (GROUPS[g].includes(category)) return g;
  return 'other';
}

export function parseSnapshot(raw: {
  as_of: string; source: string; floor_usd?: number;
  protocols: Array<Omit<Protocol, 'age' | 'growth' | 'tok' | 'group'>>;
  watchlist: string[];
}): Snapshot {
  const asOfMs = Date.parse(raw.as_of + 'T00:00:00Z');
  const protocols: Protocol[] = raw.protocols.map((p) => {
    const age = p.listed_at == null ? 365 : Math.round((asOfMs - Date.parse(p.listed_at + 'T00:00:00Z')) / DAY_MS);
    const growth = p.change_7d == null ? 0 : Math.max(-90, Math.min(200, p.change_7d));
    const tok = p.gecko_id != null || p.symbol != null;
    return { ...p, age, growth, tok, group: groupOf(p.category) };
  });
  return { asOf: raw.as_of, source: raw.source, floorUsd: raw.floor_usd ?? 0, protocols, watchlist: raw.watchlist };
}

/** Peers: priced, non-exchange protocols with both a market cap and TVL. */
export const peersOf = (protocols: Protocol[]): Protocol[] =>
  protocols.filter((p) => p.mcap_usd != null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');

// ---------------------------------------------------------------- Part 1: the ridge

export interface RidgeModel {
  mean: number[];
  sd: number[];
  cats: string[];
  catD: string[];
  chainD: string[];
  pen: number[];
  beta: number[];
  reduced: boolean;
}

const rawFeats = (p: Protocol): number[] => [Math.log10(p.tvl_usd), p.growth, Math.log10(p.age)];

function sdOf(a: number[], m: number): number {
  const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length; // population sd
  return Math.sqrt(v) || 1;
}

/** Build the design (columns, penalties, standardization) from a train fold. */
function design(train: Protocol[], reduced: boolean) {
  const rf = train.map(rawFeats);
  const m = [0, 1, 2].map((j) => mean(rf.map((r) => r[j])));
  const s = [0, 1, 2].map((j) => sdOf(rf.map((r) => r[j]), m[j]));
  const cats = [...new Set(train.map((p) => p.category))].sort();
  const chainCount: Record<string, number> = {};
  for (const p of train) { const c = p.chains[0]; chainCount[c] = (chainCount[c] ?? 0) + 1; }
  const chains = Object.keys(chainCount).filter((c) => chainCount[c] >= 5).sort();
  const catD = cats.slice(1);
  const chainD = chains.slice(1);
  const cols: string[] = ['1', 'zTVL'];
  if (!reduced) cols.push('zGrowth', 'zAge');
  for (const c of catD) cols.push('cat:' + c);
  for (const c of chainD) cols.push('chain:' + c);
  if (!reduced) for (const c of cats) cols.push('ix:' + c);
  const pen = cols.map((c) => (c === '1' ? 0 : c.startsWith('z') ? 0.3 : c.startsWith('ix:') ? 100 : 3));
  const row = (p: Protocol): number[] => {
    const f = rawFeats(p);
    const z = [0, 1, 2].map((j) => (f[j] - m[j]) / s[j]);
    const x = [1, z[0]];
    if (!reduced) x.push(z[1], z[2]);
    for (const c of catD) x.push(p.category === c ? 1 : 0);
    for (const c of chainD) x.push(p.chains[0] === c ? 1 : 0);
    if (!reduced) for (const c of cats) x.push(p.category === c ? z[0] : 0);
    return x;
  };
  return { m, s, cats, catD, chainD, pen, row, p: cols.length };
}

/** Fit the joint ridge on log10(mcap/TVL) by normal equations + Gaussian elimination. */
export function fitRidge(train: Protocol[], reduced = false): RidgeModel {
  const d = design(train, reduced);
  const X = train.map(d.row);
  const y = train.map((p) => Math.log10((p.mcap_usd as number) / p.tvl_usd));
  const n = d.p;
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < n; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = j; k < n; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < j; k++) A[j][k] = A[k][j];
    A[j][j] += d.pen[j];
  }
  const beta = solve(A, b);
  return { mean: d.m, sd: d.s, cats: d.cats, catD: d.catD, chainD: d.chainD, pen: d.pen, beta, reduced };
}

export function predictLog(model: RidgeModel, p: Protocol): number {
  const f = rawFeats(p);
  const z = [0, 1, 2].map((j) => (f[j] - model.mean[j]) / model.sd[j]);
  const x = [1, z[0]];
  if (!model.reduced) x.push(z[1], z[2]);
  for (const c of model.catD) x.push(p.category === c ? 1 : 0);
  for (const c of model.chainD) x.push(p.chains[0] === c ? 1 : 0);
  if (!model.reduced) for (const c of model.cats) x.push(p.category === c ? z[0] : 0);
  let s = 0;
  for (let j = 0; j < model.beta.length; j++) s += x[j] * model.beta[j];
  return s;
}

/** valueIfLaunched(p) = TVL x 10^(predicted log-ratio), whole dollars, min 1. */
export function valueIfLaunched(model: RidgeModel, p: Protocol): number {
  return Math.max(1, Math.round(p.tvl_usd * Math.pow(10, predictLog(model, p))));
}

/** R1 power curve: OLS of log10(mcap) on log10(TVL). */
export function fitPowerCurve(train: Protocol[]): { a: number; b: number } {
  const xs = train.map((q) => Math.log10(q.tvl_usd));
  const ys = train.map((q) => Math.log10(q.mcap_usd as number));
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

/** R1 form: power curve refit per fold + category median residual with four 0s appended,
 *  times a growth factor and a track-record factor. */
export const R1_CONVENTION = 'R1 form: power curve refit per fold + category median residual with four 0s appended, x growth clamp(1+0.75*7d%/100, 0.6, 1.6) x track (0.55+0.45*min(age,730)/730).';
export function r1Value(train: Protocol[], p: Protocol): number {
  const { a, b } = fitPowerCurve(train);
  const resid: Record<string, number[]> = {};
  for (const q of train) {
    const r = Math.log10(q.mcap_usd as number) - (a + b * Math.log10(q.tvl_usd));
    (resid[q.category] ??= []).push(r);
  }
  const r = resid[p.category] ?? [];
  const eff = median([...r, 0, 0, 0, 0]); // shrink with 4 pseudo-comps at 0 (append, then median)
  const growth = p.change_7d == null ? 1 : Math.max(0.6, Math.min(1.6, 1 + 0.75 * p.change_7d / 100));
  const track = 0.55 + 0.45 * Math.min(p.age, 730) / 730;
  return Math.max(1, Math.round(Math.pow(10, a + b * Math.log10(p.tvl_usd) + eff) * growth * track));
}

export const flatMedianMultiple = (train: Protocol[]): number =>
  median(train.map((q) => (q.mcap_usd as number) / q.tvl_usd));

// ---------------------------------------------------------------- validation

export interface Validation {
  peers: number;
  powerCurve: { a: number; b: number };
  loo: {
    ridge: number; r1: number; flatMedian: number; flat025: number;
    ciLo: number; ciHi: number; within2x: number; within3xShare: number;
    spearman: number; rangeHoldsShare: number;
  };
  walkForward: { ridge: number; flat: number; covered: number };
  odds: { hit: number; base: number; gatePass: boolean; nTrain: number; nTest: number; hitCount: number };
  tilts: { moved: number; total: number };
}

/** Strict LOO ladder + walk-forward + range holds. */
export function validateValue(peers: Protocol[]): Pick<Validation, 'peers' | 'powerCurve' | 'loo' | 'walkForward'> {
  const n = peers.length;
  const ridgeMiss: number[] = [], r1Miss: number[] = [], fmMiss: number[] = [], f25Miss: number[] = [];
  const ridgePred: number[] = [], actual: number[] = [], ratios: number[] = [];
  for (let i = 0; i < n; i++) {
    const train = peers.filter((_, j) => j !== i);
    const p = peers[i];
    const act = p.mcap_usd as number;
    const rv = valueIfLaunched(fitRidge(train), p);
    ridgeMiss.push(miss(act, rv)); ridgePred.push(rv); actual.push(act); ratios.push(act / rv);
    r1Miss.push(miss(act, r1Value(train, p)));
    fmMiss.push(miss(act, p.tvl_usd * flatMedianMultiple(train))); // unrounded flat baseline
    f25Miss.push(miss(act, p.tvl_usd * 0.25));
  }
  // 90% CI for the ridge LOO median: percentile bootstrap, 1000 resamples, seed 0x4c413032.
  const rng = mulberry32(0x4c413032);
  const meds: number[] = [];
  for (let r = 0; r < 1000; r++) {
    const sample: number[] = [];
    for (let i = 0; i < n; i++) sample.push(ridgeMiss[Math.floor(rng() * n)]);
    meds.push(median(sample));
  }
  meds.sort((a, b) => a - b);
  const rs = [...ratios].sort((a, b) => a - b);
  const q25 = quantileSorted(rs, 0.25), q75 = quantileSorted(rs, 0.75);
  const inside = ridgePred.filter((v, i) => actual[i] >= v * q25 && actual[i] <= v * q75).length;
  // expanding walk-forward: oldest first, price each peer with >=25 strictly-older peers.
  const sorted = [...peers].sort((a, b) => b.age - a.age);
  const wfRidge: number[] = [], wfFlat: number[] = [];
  for (const p of sorted) {
    const train = peers.filter((q) => q.age > p.age);
    if (train.length < 25) continue;
    wfRidge.push(miss(p.mcap_usd as number, valueIfLaunched(fitRidge(train), p)));
    wfFlat.push(miss(p.mcap_usd as number, p.tvl_usd * flatMedianMultiple(train)));
  }
  return {
    peers: n,
    powerCurve: fitPowerCurve(peers),
    loo: {
      ridge: median(ridgeMiss), r1: median(r1Miss), flatMedian: median(fmMiss), flat025: median(f25Miss),
      ciLo: quantileSorted(meds, 0.05), ciHi: quantileSorted(meds, 0.95),
      within2x: ridgeMiss.filter((m) => m <= 2).length,
      within3xShare: ridgeMiss.filter((m) => m <= 3).length / n,
      spearman: spearman(ridgePred, actual),
      rangeHoldsShare: inside / n,
    },
    walkForward: { ridge: median(wfRidge), flat: median(wfFlat), covered: wfRidge.length },
  };
}

// ---------------------------------------------------------------- Part 2: launch odds

export interface LogisticModel {
  beta: number[];
  groups: string[];
  withGroups: boolean;
}

function logisticFeat(p: Protocol, groups: string[], withGroups: boolean): number[] {
  const x = [1, Math.log10(Math.max(1, p.age))];
  if (withGroups) for (const g of groups) x.push(p.group === g ? 1 : 0);
  return x;
}

/** Group-model dummies: every group except 'trading' (the reference group), in this order. */
export const ODDS_GROUPS = ['credit', 'yield', 'rwa', 'infra', 'other'];

/** Newton-fit logistic regression of records-token on [1, log10 age] (+ group dummies).
 *  Base model penalties [0, 0.1]; group model penalties 0 on intercept, 1.0 on every
 *  other coefficient (age slope included). Hessian weights p(1-p)+1e-6 jitter. */
export function fitLogistic(rows: Protocol[], withGroups: boolean): LogisticModel {
  const groups = withGroups ? ODDS_GROUPS : [];
  const pen = withGroups ? [0, 1.0, ...groups.map(() => 1.0)] : [0, 0.1];
  const X = rows.map((p) => logisticFeat(p, groups, withGroups));
  const y = rows.map((p) => (p.tok ? 1 : 0));
  const k = X[0].length;
  let beta = new Array<number>(k).fill(0);
  for (let it = 0; it < 200; it++) {
    const pr = X.map((x) => 1 / (1 + Math.exp(-x.reduce((s, v, j) => s + v * beta[j], 0))));
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const g = new Array<number>(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      const w = pr[i] * (1 - pr[i]) + 1e-6;
      for (let j = 0; j < k; j++) {
        g[j] += X[i][j] * (y[i] - pr[i]);
        for (let kk = j; kk < k; kk++) H[j][kk] += X[i][j] * X[i][kk] * w;
      }
    }
    for (let j = 0; j < k; j++) {
      for (let kk = 0; kk < j; kk++) H[j][kk] = H[kk][j];
      H[j][j] += pen[j];
      g[j] -= pen[j] * beta[j];
    }
    const d = solve(H, g);
    beta = beta.map((v, j) => v + d[j]);
    if (Math.max(...d.map(Math.abs)) < 1e-10) break;
  }
  return { beta, groups, withGroups };
}

export function logisticF(model: LogisticModel, p: Protocol, age: number): number {
  const x = logisticFeat({ ...p, age }, model.groups, model.withGroups);
  return 1 / (1 + Math.exp(-x.reduce((s, v, j) => s + v * model.beta[j], 0)));
}

/** odds(p) = [F_g(a+730) - F_g(a)] / [1 - F_g(a)], clamped to [0.03, 0.85]. */
export function launchOdds(model: LogisticModel, p: Protocol): number {
  const fa = logisticF(model, p, p.age);
  const fb = logisticF(model, p, p.age + 730);
  const o = (fb - fa) / (1 - fa);
  return Math.max(0.03, Math.min(0.85, o));
}

/** Seeded holdout: shuffle 758, fit group model on first 70%, classify last 30% at 0.5. */
export function oddsHoldout(protocols: Protocol[]): Validation['odds'] {
  const rng = mulberry32(0x4c413033);
  const idx = protocols.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const nTrain = Math.floor(protocols.length * 0.7);
  const train = idx.slice(0, nTrain).map((i) => protocols[i]);
  const test = idx.slice(nTrain).map((i) => protocols[i]);
  const model = fitLogistic(train, true);
  let hitCount = 0;
  for (const p of test) {
    const pred = logisticF(model, p, p.age) >= 0.5 ? 1 : 0;
    if (pred === (p.tok ? 1 : 0)) hitCount++;
  }
  const nTok = test.filter((p) => p.tok).length;
  const base = Math.max(nTok, test.length - nTok) / test.length;
  const hit = hitCount / test.length;
  return { hit, base, gatePass: hit >= base + 0.05, nTrain, nTest: test.length, hitCount };
}

/** implied_value_usd = round(valueIfLaunched x odds) when the gate passes. */
export const impliedValue = (value: number, odds: number): number => Math.round(value * odds);

// ---------------------------------------------------------------- universe / set-aside

const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** VERSIONED: a name ending with a SPACE then V/v<digits> (optionally .<digits>), or <digits>.<digits>.
 *  "CommunityV3" (no space), "Tessera V" (no digits), "Project 0" (bare integer), "Project X" are NOT versioned. */
export function isVersioned(name: string): boolean {
  return /\s(?:v\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*)$/i.test(name);
}

/** NAME WORD: the whole word "wrapped", "staked" or "staking" (case-insensitive, word boundaries). */
export function isNameWord(name: string): boolean {
  return /\b(?:wrapped|staked|staking)\b/i.test(name);
}

/** EXCHANGE NAME: a name beginning with a listed exchange brand. */
export function isExchangeName(name: string): boolean {
  return /^(?:binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i.test(name);
}

export interface SetAsideRow {
  slug: string; name: string; category: string; chain: string; tvl_usd: number;
  reason: string; reasonGroup: string;
}
export interface Universe {
  ranked: Protocol[];
  setAside: SetAsideRow[];
  accounting: { ranked: number; token: number; setAside: number; total: number; reasonGroups: Record<string, number> };
}

/** Reason precedence: category, then versioned, then name word, then exchange name. */
function reasonFor(p: Protocol): { reason: string; reasonGroup: string } {
  if (p.category === 'CEX') return { reason: "exchange's own product (CEX category)", reasonGroup: 'exchange' };
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge')
    return { reason: `bridge family (${p.category})`, reasonGroup: 'bridge' };
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC')
    return { reason: `staking family (${p.category})`, reasonGroup: 'staking' };
  if (isVersioned(p.name)) return { reason: 'versioned name', reasonGroup: 'versioned' };
  if (isNameWord(p.name)) return { reason: 'product of a traded token (wrapped/staked/staking in name)', reasonGroup: 'nameword' };
  return { reason: "exchange's own product (exchange name)", reasonGroup: 'exchange' };
}

export function universe(protocols: Protocol[], watchlist: string[]): Universe {
  const wl = new Set(watchlist);
  const noTok = protocols.filter((p) => !p.tok);
  const ranked: Protocol[] = [];
  const setAside: SetAsideRow[] = [];
  for (const p of noTok) {
    if (wl.has(p.slug)) { ranked.push(p); continue; } // watchlist overrides every exclusion
    if (EXCLUDED_CATEGORIES.has(p.category) || isVersioned(p.name) || isNameWord(p.name) || isExchangeName(p.name)) {
      const { reason, reasonGroup } = reasonFor(p);
      setAside.push({ slug: p.slug, name: p.name, category: p.category, chain: p.chains[0], tvl_usd: p.tvl_usd, reason, reasonGroup });
    } else {
      ranked.push(p);
    }
  }
  const reasonGroups: Record<string, number> = {};
  for (const s of setAside) reasonGroups[s.reasonGroup] = (reasonGroups[s.reasonGroup] ?? 0) + 1;
  const token = protocols.filter((p) => p.tok).length;
  return {
    ranked, setAside,
    accounting: { ranked: ranked.length, token, setAside: setAside.length, total: protocols.length, reasonGroups },
  };
}

// ---------------------------------------------------------------- farm plans + economics

export const DEPOSITS = [250, 500, 1000, 2500, 5000, 10000];
export const DEPOSITOR_SHARE = 0.10;
export const TBILL = 0.04;

/** Six network actions at the primary chain's band. Named totals win; then the L2 list pays $24; all else $48. */
const L2_SET = new Set(['Arbitrum', 'Optimism', 'Base', 'Polygon', 'Starknet', 'xDai', 'Scroll', 'Linea', 'zkSync Era', 'Blast', 'Manta', 'Mode', 'Ink', 'Monad', 'Berachain', 'Merlin', 'Hyperliquid L1', 'Plasma', 'Arc', 'Pharos', 'Robinhood Chain', 'BSquared', 'Etherlink', 'Cronos', 'Sei', 'GravityBridge']);
export const FEE_TABLE: Record<string, number> = { Ethereum: 288, Base: 18, Arbitrum: 24, Optimism: 24, Solana: 3, Binance: 12, 'BNB Chain': 12, Polygon: 6, Tron: 24 };

export function chainFee(chain: string): { band: number; perAction: number; klass: string } {
  let band: number, klass: string;
  if (FEE_TABLE[chain] != null) { band = FEE_TABLE[chain]; klass = chain; }
  else if (L2_SET.has(chain)) { band = 24; klass = 'other L2'; }
  else { band = 48; klass = 'other'; }
  return { band, perAction: band / 6, klass };
}

const CORE_ACTION: Record<string, string> = {
  'Dexs': 'Provide concentrated liquidity on',
  'Derivatives': 'Open a delta-neutral perp position on',
  'Options Vault': 'Sell covered options through the vault on',
  'Options': 'Write options on',
  'Prediction Market': 'Provide outcome liquidity on',
  'Lending': 'Supply collateral and borrow on',
  'Uncollateralized Lending': 'Extend credit on',
  'CDP': 'Mint a stablecoin against collateral on',
  'CDP Manager': 'Manage a collateralized debt position on',
  'Collateral Markets': 'Post collateral into the market on',
  'Collateral Management': 'Optimize collateral on',
  'Risk Curators': 'Delegate to a curated risk vault on',
  'Onchain Capital Allocator': 'Commit capital to an allocator strategy on',
  'Yield': 'Deposit into the flagship yield vault on',
  'Yield Aggregator': 'Allocate to the top auto-compounding vault on',
  'Liquidity Manager': 'Allocate to a managed liquidity position on',
  'RWA': 'Subscribe to a tokenized real-world asset pool on',
  'Basis Trading': 'Run a cash-and-carry basis trade on',
  'Staking Pool': 'Stake into the pool on',
  'Restaking': 'Restake assets on',
  'Farm': 'Stake LP tokens in the farm on',
  'Leveraged Farming': 'Open a leveraged farming position on',
  'Synthetics': 'Mint a synthetic asset on',
  'Insurance': 'Underwrite coverage on',
  'Chain': 'Delegate to a validator on',
  'CeDeFi': 'Allocate to the CeDeFi yield product on',
  'Payments': 'Route payment volume through',
  'Governance Incentives': 'Lock tokens for governance incentives on',
  'Stablecoin Wrapper': 'Wrap stablecoins into the yield-bearing wrapper on',
  'Indexes': 'Buy the index token on',
  'Decentralized BTC': 'Deposit BTC into',
  'Anchor BTC': 'Anchor BTC on',
  'Decentralized AI': 'Stake to an AI subnet on',
  'AI Agents': 'Fund an agent strategy on',
  'Privacy': 'Shield assets through',
  'Token Locker': 'Lock tokens on',
  'Algo-Stables': 'Mint the algo-stable on',
  'Dual-Token Stablecoin': 'Mint the dual-token stable on',
  'Reserve Currency': 'Mint the reserve currency on',
  'NFT Marketplace': 'Provide NFT liquidity on',
  'OTC Marketplace': 'Provide OTC liquidity on',
  'Crypto Card Issuer': 'Stake for card issuance on',
  'Interest Rate Derivatives': 'Trade interest-rate swaps on',
};
const coreAction = (cat: string): string => CORE_ACTION[cat] ?? 'Take the core position on';

const money = (x: number): string => (Number.isInteger(x) ? `$${x}` : `$${x.toFixed(2)}`);
const tierBonusOf = (tvl: number): number => (tvl >= 1e9 ? 30 : tvl >= 1e8 ? 20 : tvl >= 1e7 ? 10 : 0);
const tierLabel = (tvl: number): string => (tvl >= 1e9 ? '$1B+' : tvl >= 1e8 ? '$100M–$1B' : tvl >= 1e7 ? '$10M–$100M' : 'sub-$10M');
const ageLabel = (age: number): string => (age < 180 ? 'young protocol' : age < 365 ? 'establishing protocol' : 'mature protocol');
export const holdDaysOf = (age: number): number => (age < 180 ? 60 : age < 365 ? 45 : 30);

export interface FarmPlan {
  steps: string[];
  fees_usd: number;
  hours: number;
  hold_days: number;
  chain: string;
  chain_class: string;
  deposit_usd: number;
}

/** 8 costed steps; deposit sized per row to maximize net $/hour at implied value. */
export function farmPlan(p: Protocol, implied: number): FarmPlan {
  const chain = p.chains[0];
  const { band, perAction, klass } = chainFee(chain);
  const tierBonus = tierBonusOf(p.tvl_usd);
  const hold = holdDaysOf(p.age);
  const weeks = Math.ceil(hold / 7);
  const minutes = [20, 15, 10, 10, 5 * weeks, 15, 15, 65 + tierBonus - 5 * weeks];
  const hours = minutes.reduce((s, v) => s + v, 0) / 60; // = (150 + tierBonus) / 60
  const core = coreAction(p.category);
  const actions = [
    `Set up a funded wallet on ${chain} and stage the gas float for six network actions`,
    `${core} ${p.name} at the ${tierLabel(p.tvl_usd)} TVL tier`,
    `Enroll ${p.name} (${p.category}) in the points and eligibility program and link the wallet`,
    `Run the weekly qualifying cadence on ${p.name}: rebalance, compound and log activity`,
    `Monitor the position weekly across the ${hold}-day hold window (${ageLabel(p.age)}) without withdrawing`,
    `Check accrued points and rewards on ${p.name}; confirm the eligibility snapshot dates`,
    `Pre-claim verification on ${p.name}: confirm token generation terms, vesting and the claim contract`,
    `Exit discipline on ${p.name}: unwind the position, realize rewards and rotate capital on schedule`,
  ];
  const costs = [perAction, perAction * 2, perAction, perAction, 0, 0, 0, perAction];
  const times = [
    `${minutes[0]} min`,
    `${minutes[1]} min`,
    `${minutes[2]} min`,
    `${minutes[3]} min a week`,
    `${minutes[4]} min across ${weeks} weeks`,
    `${minutes[5]} min`,
    `${minutes[6]} min`,
    `${minutes[7]} min`,
  ];
  const steps = actions.map((a, i) => `${a}. Cost: ${money(costs[i])}. Time: ${times[i]}.`);
  // deposit sizing
  const opp = (d: number) => d * TBILL * hold / 365;
  const net = (d: number) => implied * (d / p.tvl_usd) * DEPOSITOR_SHARE - band - opp(d);
  let deposit = 1000, best = -Infinity;
  for (const d of DEPOSITS) { const v = net(d); if (v > best) { best = v; deposit = d; } }
  if (best <= 0) deposit = 1000;
  return { steps, fees_usd: band, hours, hold_days: hold, chain, chain_class: klass, deposit_usd: deposit };
}

export interface Economics {
  slice_usd: number;
  opportunity_usd: number;
  net_total_implied: number;
  net_per_hour_implied: number;
  net_total_band_low: number;
  net_per_hour_band_low: number;
}

export function economics(implied: number, bandLowImplied: number, tvl: number, deposit: number, fees: number, hold: number, hours: number): Economics {
  const opp = deposit * TBILL * hold / 365;
  const slice = (v: number) => v * (deposit / tvl) * DEPOSITOR_SHARE;
  const ni = slice(implied) - fees - opp;
  const nl = slice(bandLowImplied) - fees - opp;
  return {
    slice_usd: slice(implied), opportunity_usd: opp,
    net_total_implied: ni, net_per_hour_implied: ni / hours,
    net_total_band_low: nl, net_per_hour_band_low: nl / hours,
  };
}

// ---------------------------------------------------------------- Part 3: bootstrap analytics

export interface RowAnalytics {
  band_lo: number; band_hi: number;
  implied_band_lo: number; implied_band_hi: number;
  rank_lo: number; rank_hi: number;
  break_even_odds_pct: number;
  ev_per_gas: number;
  mean_refit_net: number;
  grade: string;
}

/** 200 seeded refits of the ridge, single pass: per-row value bands, rank ranges,
 *  break-even odds, EV/gas and mean refit net at the row's sized deposit. */
export function bootstrapAnalytics(
  peers: Protocol[], ranked: Protocol[], oddsBySlug: Map<string, number>,
  plans: Map<string, FarmPlan>, nResamples = 200,
): Map<string, RowAnalytics> {
  const rng = mulberry32(0x4c413032);
  const n = peers.length;
  const R = ranked.length;
  const values: number[][] = ranked.map(() => []);
  const ranks: number[][] = ranked.map(() => []);
  const nets: number[][] = ranked.map(() => []);
  const slices: number[][] = ranked.map(() => []);
  const oppBySlug = new Map<string, number>();
  for (const p of ranked) {
    const plan = plans.get(p.slug) as FarmPlan;
    oppBySlug.set(p.slug, plan.deposit_usd * TBILL * plan.hold_days / 365);
  }
  for (let r = 0; r < nResamples; r++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < n; i++) sample.push(peers[Math.floor(rng() * n)]);
    const model = fitRidge(sample);
    const refitImplied: number[] = ranked.map((p, idx) => {
      const v = valueIfLaunched(model, p);
      values[idx].push(v);
      const imp = impliedValue(v, oddsBySlug.get(p.slug) as number);
      const plan = plans.get(p.slug) as FarmPlan;
      const slice = imp * (plan.deposit_usd / p.tvl_usd) * DEPOSITOR_SHARE;
      slices[idx].push(slice);
      nets[idx].push(slice - plan.fees_usd - (oppBySlug.get(p.slug) as number));
      return imp;
    });
    // rank within this refit: implied desc, TVL desc, slug asc
    const order = ranked.map((_, idx) => idx).sort((a, b) =>
      refitImplied[b] - refitImplied[a] || ranked[b].tvl_usd - ranked[a].tvl_usd || (ranked[a].slug < ranked[b].slug ? -1 : 1));
    order.forEach((idx, place) => ranks[idx].push(place + 1));
  }
  const out = new Map<string, RowAnalytics>();
  ranked.forEach((p, idx) => {
    const odds = oddsBySlug.get(p.slug) as number;
    const plan = plans.get(p.slug) as FarmPlan;
    const vs = [...values[idx]].sort((a, b) => a - b);
    const bandLo = Math.round(quantileSorted(vs, 0.10));
    const bandHi = Math.round(quantileSorted(vs, 0.90));
    const rs = [...ranks[idx]].sort((a, b) => a - b);
    const rankLo = Math.max(1, Math.min(R, Math.round(quantileSorted(rs, 0.10))));
    const rankHi = Math.max(1, Math.min(R, Math.round(quantileSorted(rs, 0.90))));
    const be = nets[idx].filter((v) => v > 0).length / nResamples;
    out.set(p.slug, {
      band_lo: bandLo, band_hi: bandHi,
      implied_band_lo: Math.round(bandLo * odds), implied_band_hi: Math.round(bandHi * odds),
      rank_lo: rankLo, rank_hi: rankHi,
      break_even_odds_pct: Math.round(be * 1000) / 10,
      ev_per_gas: Math.round((mean(slices[idx]) / plan.fees_usd) * 10) / 10,
      mean_refit_net: mean(nets[idx]),
      grade: bandHi / bandLo <= 4 ? 'A' : bandHi / bandLo <= 9 ? 'B' : 'C',
    });
  });
  return out;
}

/** Tilts: fit without growth, age and interaction terms; count rows moving >=5 rank places. */
export function tilts(peers: Protocol[], ranked: Protocol[], oddsBySlug: Map<string, number>, fullRanks: Map<string, number>): { moved: number; total: number } {
  const model = fitRidge(peers, true);
  const imp = ranked.map((p) => impliedValue(valueIfLaunched(model, p), oddsBySlug.get(p.slug) as number));
  const order = ranked.map((_, i) => i).sort((a, b) => imp[b] - imp[a] || ranked[b].tvl_usd - ranked[a].tvl_usd || (ranked[a].slug < ranked[b].slug ? -1 : 1));
  const tiltRank = new Map<string, number>();
  order.forEach((idx, place) => tiltRank.set(ranked[idx].slug, place + 1));
  let moved = 0;
  for (const p of ranked) if (Math.abs((tiltRank.get(p.slug) as number) - (fullRanks.get(p.slug) as number)) >= 5) moved++;
  return { moved, total: ranked.length };
}

// ---------------------------------------------------------------- verdict + board

export const VERDICT_RULE = 'FARM if break-even odds are at least 50% and net at implied value is positive and net at the low end of the band is positive; otherwise THIN if mean refit net is positive; otherwise SKIP.';

export function verdictOf(a: RowAnalytics, e: Economics): string {
  if (a.break_even_odds_pct >= 50 && e.net_per_hour_implied > 0 && e.net_per_hour_band_low > 0) return 'FARM';
  if (a.mean_refit_net > 0) return 'THIN';
  return 'SKIP';
}

export interface BoardRow {
  slug: string; name: string; rank: number;
  category: string; chain: string; chains: string[]; watchlist: boolean;
  tvl_usd: number; change_7d_pct: number; age_days: number;
  value_if_launched_usd: number; launch_odds_pct: number; implied_value_usd: number;
  band_lo: number; band_hi: number; implied_band_lo: number; implied_band_hi: number;
  rank_lo: number; rank_hi: number; break_even_odds_pct: number; ev_per_gas: number;
  deposit_usd: number; fees_usd: number; hours: number; hold_days: number;
  slice_usd: number; opportunity_usd: number;
  net_per_hour_implied: number; net_per_hour_band_low: number;
  net_total_implied: number; net_total_band_low: number; mean_refit_net: number;
  verdict: string; grade: string; farm_steps: string[];
}

export interface Board {
  meta: { name: string; asOf: string; source: string; fetchedLine: string; protocols: number; watchlist: number };
  rows: BoardRow[];
  setAside: SetAsideRow[];
  accounting: Universe['accounting'];
  validation: Validation;
  economicsAssumptions: { depositor_share: number; tbill: number; fee_table: Record<string, number>; other_l2: number; other: number; deposits: number[]; sizing: string };
  verdictRule: string;
  kpi: { totalImplied: number; rank1: { name: string; value: number }; verdicts: { FARM: number; THIN: number; SKIP: number }; bestNet: { name: string; net: number; breakEven: number; ev: number } };
}

/** Assemble the whole board from the snapshot. */
export function buildRadar(snapshot: Snapshot): Board {
  const protocols = snapshot.protocols;
  const peers = peersOf(protocols);
  const uni = universe(protocols, snapshot.watchlist);
  const wl = new Set(snapshot.watchlist);

  const valueValidation = validateValue(peers);
  const odds = oddsHoldout(protocols);
  const groupModel = fitLogistic(protocols, true);
  const fullRidge = fitRidge(peers);

  // odds + implied for ranked rows
  const oddsBySlug = new Map<string, number>();
  const valueBySlug = new Map<string, number>();
  for (const p of uni.ranked) {
    const o = launchOdds(groupModel, p);
    oddsBySlug.set(p.slug, o);
    valueBySlug.set(p.slug, valueIfLaunched(fullRidge, p));
  }
  const gatePass = odds.gatePass;
  const impliedOf = (p: Protocol): number => gatePass
    ? impliedValue(valueBySlug.get(p.slug) as number, oddsBySlug.get(p.slug) as number)
    : (valueBySlug.get(p.slug) as number);

  // rank: implied desc, TVL desc, slug asc
  const rankedSorted = [...uni.ranked].sort((a, b) =>
    impliedOf(b) - impliedOf(a) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const fullRanks = new Map<string, number>();
  rankedSorted.forEach((p, i) => fullRanks.set(p.slug, i + 1));

  // farm plans (sized at implied) + analytics
  const plans = new Map<string, FarmPlan>();
  for (const p of rankedSorted) plans.set(p.slug, farmPlan(p, impliedOf(p)));
  const analytics = bootstrapAnalytics(peers, rankedSorted, oddsBySlug, plans);
  const tiltStat = tilts(peers, rankedSorted, oddsBySlug, fullRanks);

  const rows: BoardRow[] = rankedSorted.map((p, i) => {
    const a = analytics.get(p.slug) as RowAnalytics;
    const plan = plans.get(p.slug) as FarmPlan;
    const implied = impliedOf(p);
    const e = economics(implied, a.implied_band_lo, p.tvl_usd, plan.deposit_usd, plan.fees_usd, plan.hold_days, plan.hours);
    const o = oddsBySlug.get(p.slug) as number;
    return {
      slug: p.slug, name: p.name, rank: i + 1,
      category: p.category, chain: p.chains[0], chains: p.chains, watchlist: wl.has(p.slug),
      tvl_usd: p.tvl_usd, change_7d_pct: p.change_7d ?? 0, age_days: p.age,
      value_if_launched_usd: valueBySlug.get(p.slug) as number,
      launch_odds_pct: Math.round(o * 1000) / 10, implied_value_usd: implied,
      band_lo: a.band_lo, band_hi: a.band_hi, implied_band_lo: a.implied_band_lo, implied_band_hi: a.implied_band_hi,
      rank_lo: a.rank_lo, rank_hi: a.rank_hi, break_even_odds_pct: a.break_even_odds_pct, ev_per_gas: a.ev_per_gas,
      deposit_usd: plan.deposit_usd, fees_usd: plan.fees_usd, hours: plan.hours, hold_days: plan.hold_days,
      slice_usd: e.slice_usd, opportunity_usd: e.opportunity_usd,
      net_per_hour_implied: e.net_per_hour_implied, net_per_hour_band_low: e.net_per_hour_band_low,
      net_total_implied: e.net_total_implied, net_total_band_low: e.net_total_band_low, mean_refit_net: a.mean_refit_net,
      verdict: verdictOf(a, e), grade: a.grade, farm_steps: plan.steps,
    };
  });

  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) verdicts[r.verdict as 'FARM' | 'THIN' | 'SKIP']++;
  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const best = [...rows].sort((a, b) => b.net_per_hour_implied - a.net_per_hour_implied)[0];
  const fetchedLine = snapshot.source.replace(/^DefiLlama\s+/, '').replace('https://api.llama.fi/protocols, ', '');

  const validation: Validation = { ...valueValidation, odds, tilts: tiltStat };
  const board: Board = {
    meta: { name: 'Launch Atlas 4', asOf: snapshot.asOf, source: snapshot.source, fetchedLine, protocols: protocols.length, watchlist: snapshot.watchlist.length },
    rows, setAside: uni.setAside, accounting: uni.accounting, validation,
    economicsAssumptions: {
      depositor_share: DEPOSITOR_SHARE, tbill: TBILL, fee_table: FEE_TABLE, other_l2: 24, other: 48, deposits: DEPOSITS,
      sizing: 'deposit from {250,500,1000,2500,5000,10000} maximizing net $/hour at implied value; if all net <= 0, size = 1000',
    },
    verdictRule: VERDICT_RULE,
    kpi: {
      totalImplied, rank1: { name: rows[0].name, value: rows[0].implied_value_usd }, verdicts,
      bestNet: { name: best.name, net: best.net_per_hour_implied, breakEven: best.break_even_odds_pct, ev: best.ev_per_gas },
    },
  };
  selfCheck(board);
  return board;
}

// ---------------------------------------------------------------- self-check (ship gates)

export function selfCheck(board: Board): void {
  const assert = (cond: boolean, msg: string): void => { if (!cond) throw new Error('selfCheck: ' + msg); };
  const rows = board.rows;
  assert(rows.length === 198, `expected 198 ranked rows, got ${rows.length}`);
  assert(board.accounting.ranked + board.accounting.token + board.accounting.setAside === board.accounting.total, 'accounting does not sum to 758');
  assert(board.accounting.setAside === 144, `expected 144 set aside, got ${board.accounting.setAside}`);
  const watchlistSlugs = rows.filter((r) => r.watchlist).length;
  assert(watchlistSlugs === 40, `expected 40 watchlist rows, got ${watchlistSlugs}`);
  rows.forEach((r, i) => assert(r.rank === i + 1, `rank ${r.rank} at position ${i}`));
  for (let i = 1; i < rows.length; i++) assert(rows[i].implied_value_usd <= rows[i - 1].implied_value_usd, 'implied not non-increasing');
  const distinct = new Set(rows.map((r) => r.implied_value_usd));
  assert(distinct.size === rows.length, 'implied values not all distinct');
  for (const r of rows) {
    assert(r.farm_steps.length === 8, `${r.slug}: expected 8 farm steps, got ${r.farm_steps.length}`);
    for (const s of r.farm_steps) assert(s.length >= 20 && s.length <= 600, `${r.slug}: step length ${s.length} out of 20-600`);
  }
  assert(board.validation.peers === 119, `expected 119 peers, got ${board.validation.peers}`);
  assert(board.validation.loo.ridge <= 2.95, `ridge LOO ${board.validation.loo.ridge} over the x2.95 gate`);
  assert(board.validation.odds.gatePass, 'odds ship gate not passed');
}
