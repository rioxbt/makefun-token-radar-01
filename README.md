# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rioxbt/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rioxbt/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: a program that reads a sealed snapshot of the protocol universe and ranks every
protocol whose record shows no token by what the token it may issue would be worth, each row with the
steps to farm it, plus the dashboard a reader uses to work the board.

## The model

```
implied = tvl_usd x comparable_multiple(category) x momentum(change_7d) x patience(age_days)
```

The multiple is not assumed. It is read off the snapshot's own protocols that record both a market cap
and a TVL: their market cap over TVL, per category, winsorized to [0.02, 4], taken as a median and
shrunk towards the all-category median by ten comparables' worth of prior, then clamped. Momentum takes
the protocol's seven-day TVL change at 0.35 of it. Patience runs from 0.85x at day zero to 1.15x over
1460 days tracked with no token. Each row states a band as well as a figure, the multiple divided and
multiplied by `1 + 1.5 / sqrt(n + 1)`, so a category read off one comparable says so in its own row.

The board carries the snapshot's whole watchlist (the floor, never the ceiling) and every other launch
candidate the snapshot holds: protocols whose record shows no token and which are not a wrapped, staked
or bridged product of one that trades. The protocols whose token already trades are kept apart, in the
page's Traded tokens view, because their value is the market's own and not the model's.

## Layout

| Path | What it is |
| --- | --- |
| `main.ts` | the entrypoint: reads the snapshot, writes `/output`, checks what it wrote, writes the dossier |
| `lib/model.ts` | the value model: the calibration, the four factors, the ranking, the board's own checks |
| `lib/plan.ts` | the farm plans: category- and chain-aware steps, each with what it costs and how long it takes |
| `dashboard/` | the page the judge reads: `index.html`, `app.css`, `app.js`, no framework and no network |
| `screenshots/` | the three views: the board, a protocol's detail view, the board filtered to the watchlist |
| `vendor/makefun-board.ts` | make.fun's own dossier library, byte for byte the scorer's copy |
| `tools/render-screenshots.sh` | renders the three screenshots from the page's own files in a headless browser |

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program runs on Node 22.18 or later with the standard library alone, writes `out/board.json`,
`out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`, and exits 1 rather than
hand in a board or a screenshot set the gate would refuse. Two runs over the same snapshot write the
same bytes.

To look at the page, open `out/dashboard/index.html` in a browser: it renders with no network, from the
`data.js` beside it. The URL carries the state, so `?slug=steakhouse-financial` opens a protocol's
detail view and `?tier=watchlist&sort=tvl` the filtered board.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
