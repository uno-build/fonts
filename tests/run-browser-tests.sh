#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/tests/assets"
mkdir -p "$ASSETS"
: "${MSDF_TEST_TTF:=/System/Library/Fonts/Supplemental/Times New Roman.ttf}"
: "${MSDF_TEST_OTF:=/System/Library/Fonts/Supplemental/STIXGeneral.otf}"
: "${MSDF_TEST_COMPLEX_TTF:=/System/Library/Fonts/Supplemental/Zapfino.ttf}"
cp "$MSDF_TEST_TTF" "$ASSETS/kerning.ttf"
cp "$MSDF_TEST_OTF" "$ASSETS/normal.otf"
cp "$MSDF_TEST_COMPLEX_TTF" "$ASSETS/complex.ttf"
printf '%s\n' "Browser fixtures prepared in $ASSETS"
