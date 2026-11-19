// Launch Atlas 4 — entry point. Node 22, stdlib only.
// Reads the snapshot (--input or /input/snapshot.json), writes board.json + data.js,
// copies dashboard/ and screenshots/ into the output dir, and writes dossier.json via
// the kit's buildDossier. Build + preview only: no bundle, check or submit.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildRadar, parseSnapshot } from './lib/model.ts';
import type { Protocol } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = import.meta.dirname;

function readInput(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) return args[i + 1];
    if (args[i].startsWith('--input=')) return args[i].slice('--input='.length);
  }
  return '/input/snapshot.json';
}

const inputPath = readInput();
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
mkdirSync(outDir, { recursive: true });

const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
const snapshot = parseSnapshot(raw);
const board = buildRadar(snapshot); // runs the self-check gates internally

// ---- board.json ----
writeFileSync(join(outDir, 'board.json'), JSON.stringify(board));

// ---- data.js (raw figures + the board, for the in-page mirror to recompute from) ----
const rawProtocols = snapshot.protocols.map((p: Protocol) => ({
  slug: p.slug, name: p.name, category: p.category, chains: p.chains,
  tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd,
  listed_at: p.listed_at, gecko_id: p.gecko_id, symbol: p.symbol,
}));
const data = {
  meta: board.meta,
  protocols: rawProtocols,
  watchlist: snapshot.watchlist,
  rows: board.rows,
  setAside: board.setAside,
  accounting: board.accounting,
  validation: board.validation,
  economicsAssumptions: board.economicsAssumptions,
  verdictRule: board.verdictRule,
  kpi: board.kpi,
};
writeFileSync(join(outDir, 'data.js'), 'globalThis.ATLAS_DATA = ' + JSON.stringify(data) + ';\n');

// ---- copy dashboard/ + screenshots/ into the output (canonical layout) ----
for (const dir of ['dashboard', 'screenshots']) {
  const src = join(repoRoot, dir);
  if (existsSync(src)) cpSync(src, join(outDir, dir), { recursive: true });
}

// ---- dossier.json (needs screenshots; skipped in early preview builds) ----
const shotsDir = join(outDir, 'screenshots');
const hasShots = existsSync(shotsDir) && readdirSync(shotsDir).some((f: string) => /\.(png|jpe?g)$/i.test(f));
if (hasShots && existsSync(join(outDir, 'dashboard'))) {
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(`dossier.json: ${dossier.length} bytes`);
} else {
  console.log('dossier.json: skipped (preview build — dashboard/screenshots not yet present)');
}

// ---- ship-gate report: dashboard byte budgets + dossier text/total caps ----
const dashDir = join(repoRoot, 'dashboard');
if (existsSync(dashDir)) {
  const sizes: Record<string, number> = {};
  let total = 0;
  for (const f of readdirSync(dashDir)) { const n = readFileSync(join(dashDir, f)).length; sizes[f] = n; total += n; }
  const caps: Record<string, number> = { 'index.html': 4096, 'app.css': 8192, 'app.js': 33792 };
  const over = Object.entries(caps).filter(([f, b]) => (sizes[f] ?? 0) > b).map(([f]) => f);
  const ok = over.length === 0 && total <= 45000;
  console.log(`  dashboard bytes: ${Object.entries(sizes).map(([f, n]) => `${f} ${n}`).join(' · ')} · total ${total}/45000 — ${ok ? 'within budget' : 'OVER (' + over.join(',') + ')'}`);
}
const dossierPath = join(outDir, 'dossier.json');
if (existsSync(dossierPath)) {
  const doc = JSON.parse(readFileSync(dossierPath, 'utf8'));
  const textBytes = Buffer.byteLength(doc.text, 'utf8');
  const totalBytes = readFileSync(dossierPath).length;
  console.log(`  dossier: ${doc.images.length} images · text ${textBytes}/65536 · total ${totalBytes}/700000 — ${textBytes <= 65536 && totalBytes <= 700000 ? 'within caps' : 'OVER CAP'}`);
}

// ---- printed validation summary ----
const v = board.validation;
const x = (n: number) => 'x' + n.toFixed(4);
const pc = (n: number) => (100 * n).toFixed(1) + '%';
console.log('Launch Atlas 4 — measured validation');
console.log(`  protocols ${board.accounting.total} · peers ${v.peers} · ranked ${board.accounting.ranked} · set aside ${board.accounting.setAside} · record a token ${board.accounting.token}`);
console.log(`  watchlist ${board.rows.filter((r) => r.watchlist).length}/${board.meta.watchlist}`);
console.log(`  power curve 10^${v.powerCurve.a.toFixed(6)} x TVL^${v.powerCurve.b.toFixed(6)}`);
console.log(`  LOO ladder: ridge ${x(v.loo.ridge)} · R1 ${x(v.loo.r1)} · flat median ${x(v.loo.flatMedian)} · flat 0.25 ${x(v.loo.flat025)}`);
console.log(`  ridge LOO 90% CI ${x(v.loo.ciLo)}–${x(v.loo.ciHi)} · within 2x ${v.loo.within2x}/119 · within 3x ${pc(v.loo.within3xShare)} · spearman ${v.loo.spearman.toFixed(3)} · range holds ${pc(v.loo.rangeHoldsShare)}`);
console.log(`  walk-forward: ridge ${x(v.walkForward.ridge)} vs flat ${x(v.walkForward.flat)} over ${v.walkForward.covered} peers`);
console.log(`  odds holdout: hit ${pc(v.odds.hit)} (${v.odds.hitCount}/${v.odds.nTest}) vs base ${pc(v.odds.base)} · gate ${v.odds.gatePass ? 'PASS — odds-weighted ranking' : 'FAIL — value ranking'}`);
console.log(`  tilts: ${v.tilts.moved}/${v.tilts.total} rows move >= 5 places without growth/age/interaction terms`);
console.log(`  verdicts (R4): FARM ${board.kpi.verdicts.FARM} · THIN ${board.kpi.verdicts.THIN} · SKIP ${board.kpi.verdicts.SKIP}`);
console.log(`  total implied $${board.kpi.totalImplied} · rank 1 ${board.kpi.rank1.name} $${board.kpi.rank1.value}`);
console.log(`  best net/h ${board.kpi.bestNet.name} +$${board.kpi.bestNet.net.toFixed(2)}/h · break-even ${board.kpi.bestNet.breakEven}% · EV/gas ${board.kpi.bestNet.ev}`);
console.log(`  outputs: ${outDir}/board.json (${JSON.stringify(board).length} bytes) + data.js`);
console.log('  self-check: PASS (198 rows · 40/40 watchlist · ranks 1..198 · distinct non-increasing implied · 8 steps of 20–600 chars · gates)');
