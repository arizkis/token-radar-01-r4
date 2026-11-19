# Launch Atlas 4

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arizkis/token-radar-01-r4/rank.svg)](https://make.fun/competitions/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arizkis/token-radar-01-r4/reward.svg)](https://make.fun/competitions/token-radar-01)

A token-launch radar for the [make.fun](https://make.fun) competition
[token-radar-01](https://make.fun/competitions/token-radar-01), round 4. It reads a sealed
snapshot of 758 DeFi protocols and ranks the **198 that record no token** by *implied value* —
what a protocol's token could be worth if it launches, times the odds that it launches within two
years — then writes a costed, deposit-sized farm plan and a verdict for every row. The whole thing
is a dark trading-terminal dashboard that recomputes every printed number in the page from the raw
figures, so the screenshots and the source always agree.

Everything is computed at runtime from the snapshot's own figures. No network at runtime, no
hand-picked names, no hard-coded board. Node 22 standard library only.

## How the model works

Three parts, all recomputed from the snapshot (see `lib/model.ts`, mirrored in `dashboard/app.js`):

1. **Value if launched.** A joint ridge on `log10(mcap/TVL)` fit on the 119 priced peers
   (mcap > 0, TVL > 0, not a CEX). Features: standardized `log10 TVL`, 7-day change, `log10 age`,
   category and primary-chain dummies, and category × size interactions, with penalties
   0 / 0.3 / 3 / 100. Solved by Gaussian elimination with partial pivoting.
   `valueIfLaunched = TVL × 10^predicted`, whole dollars. Validated by strict leave-one-out
   (median miss **x2.8900**, 90% CI x2.5944–x4.6918), an expanding walk-forward (**x3.3427** vs a
   flat peer-median **x5.2693** over 94 peers), and an ablation ladder against flat and R1 baselines.
2. **Launch odds.** A logistic regression of *records-a-token* on `log10 age` plus category-group
   dummies (trading is the reference group), fit by penalized Newton iterations.
   `odds = [F(a+730) − F(a)] / [1 − F(a)]`, clamped to [0.03, 0.85]. A seeded 70/30 holdout calls
   **65.4%** right vs a **59.6%** base rate — clearing the ship gate (hit ≥ base + 5 pts), so the
   ranking is odds-weighted: `implied = round(valueIfLaunched × odds)`.
3. **Bootstrap analytics.** 200 seeded refits of the ridge give each row a value band (P10–P90),
   a rank range, break-even odds, EV per dollar of gas, and net $/hour at implied value and at the
   band low. A confidence grade (A/B/C) comes from the band width.

**Universe.** Ranked = records no token, category not in {CEX, Bridge, Canonical Bridge, Liquid
Staking, Liquid Restaking, Restaked BTC}, name not version-suffixed, no whole word
wrapped/staked/staking, not an exchange name — plus every watchlist slug unconditionally
(40 of 40). That yields 198 ranked / 144 set aside / 416 record a token = 758, each set-aside with
one printed reason.

**Farm plans & verdict.** Eight costed steps per row (chain gas float, core position, enrollment,
weekly cadence, hold window, rewards check, pre-claim verification, exit), with the deposit sized
from {250…10000} to maximize net $/hour. Economics: 10% depositor share, 4% T-bill opportunity cost,
a per-chain fee table. The R4 verdict rule:

> FARM if break-even odds are at least 50% and net at implied value is positive and net at the low
> end of the band is positive; otherwise THIN if mean refit net is positive; otherwise SKIP.

Round 4 adds the low-end costing to the FARM gate, so a row must clear zero on both costings.

These are scenario economics from the snapshot's own figures, not a prediction that a token is
issued. "Records no token" is a data state, never a claim that a protocol "has no token". The median
out-of-sample price is still wrong by x2.89; the bands are wide because the relationship is noisy.
Nothing here is investment advice.

## Run it

Node 22 (standard library only — no install, no build):

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

`--input` defaults to `/input/snapshot.json`; the output dir comes from `--out`/`--output` or
`MAKEFUN_OUTPUT_DIR` (default `/output`). The program writes:

- `board.json` — the 198 ranked rows (values, odds, bands, ranks, economics, verdicts, farm steps)
  plus the set-aside rows, accounting and measured validation.
- `data.js` — the raw figures + the board, loaded by the page so it can recompute every row.
- `dashboard/` and `screenshots/` — copied into the output (the page loads `../data.js`).
- `dossier.json` — built by the kit's `vendor/makefun-board.ts` (`buildDossier`, text cap 65536).

Open `output/dashboard/index.html` in a browser. The page re-runs the model from `data.js` and
prints a live self-verification line (`198/198` on every compared field). To regenerate the three
1440×900 screenshots: `node scripts/capture.mjs <outputDir> <shotsDir>` (headless Chrome via
puppeteer-core).

## Layout

```
main.ts              entry point: snapshot in -> board.json + data.js + dashboard + dossier
lib/model.ts         the model, farm plans, universe, validation, self-check gates
dashboard/           index.html + app.css + app.js (the in-page mirror, dark terminal)
screenshots/         1-board.png · 2-detail.png · 3-setaside.png (1440x900)
scripts/capture.mjs  headless-Chrome screenshot capture
vendor/              make.fun's makefun-board.ts (byte-for-byte, unmodified)
```

## License

MIT — see [LICENSE](LICENSE).
