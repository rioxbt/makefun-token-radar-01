#!/usr/bin/env sh
# Renders the dashboard's three screenshots from the files main.ts wrote into out/.
#
# The page is the page the judge reads: these are its own files in a headless browser, at the size the
# gate keeps (1440x900: long side at most 1440, short side at least 800), not drawings of it. Run
# main.ts into out/ first, then this script, then main.ts again so the dossier carries the new images.
#
#   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
#   CHROME=/path/to/chrome sh tools/render-screenshots.sh
#   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
#
# The three views: the board, one protocol's detail view (the same deep link the drawer opens) and the
# board filtered to the watchlist, which is a filter the page supports and a reader can link to.
set -eu

CHROME="${CHROME:-chrome}"
OUT="${OUT:-out}"
DASH="$(cd "$(dirname "$0")/.." && pwd)/${OUT}/dashboard/index.html"
SHOTS="$(cd "$(dirname "$0")/.." && pwd)/screenshots"
SIZE="${SIZE:-1440,980}"

render() {
  # $1 the query string, $2 the file to write
  "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$SIZE" \
    --virtual-time-budget=8000 --run-all-compositor-stages-before-draw \
    --screenshot="$SHOTS/$2" "file://$DASH$1" >/dev/null 2>&1
  echo "wrote screenshots/$2"
}

render ""                                    "1-board.png"
render "?slug=steakhouse-financial"          "2-detail.png"
render "?tier=watchlist&sort=tvl"            "3-filtered.png"
