#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=versions.sh
source "$ROOT/scripts/versions.sh"
UPSTREAM="${MSDF_ATLAS_UPSTREAM_DIR:-$ROOT/msdf-atlas-gen}"
DEPS="${MSDF_ATLAS_DEPS_DIR:-$ROOT/.wasm-deps}"
ARTERY_FONT="${MSDF_ATLAS_ARTERY_FONT_DIR:-$DEPS/artery-font-format}"
STAGE="${MSDF_ATLAS_STAGE_DIR:-$ROOT/.build-src/msdf-atlas-gen}"
ARCHIVE="$ROOT/.build-src/upstream.tar"
MSDFGEN_ARCHIVE="$ROOT/.build-src/msdfgen.tar"
ARTERY_FONT_ARCHIVE="$ROOT/.build-src/artery-font-format.tar"

case "$STAGE" in
  ""|/|"$ROOT") printf '%s\n' "Refusing unsafe staging directory: $STAGE" >&2; exit 1 ;;
esac

git -C "$UPSTREAM" rev-parse --git-dir >/dev/null
git -C "$UPSTREAM/msdfgen" rev-parse --git-dir >/dev/null
git -C "$ARTERY_FONT" rev-parse --git-dir >/dev/null
test "$(git -C "$UPSTREAM" rev-parse HEAD)" = "$MSDF_ATLAS_COMMIT"
test "$(git -C "$UPSTREAM/msdfgen" rev-parse HEAD)" = "$MSDFGEN_COMMIT"
test "$(git -C "$ARTERY_FONT" rev-parse HEAD)" = "$ARTERY_FONT_COMMIT"
test "$(git -C "$UPSTREAM" rev-parse HEAD:msdfgen)" = "$MSDFGEN_COMMIT"
test "$(git -C "$UPSTREAM" rev-parse HEAD:artery-font-format)" = "$ARTERY_FONT_COMMIT"
mkdir -p "$ROOT/.build-src"
rm -rf "$STAGE"
mkdir -p "$STAGE/msdfgen" "$STAGE/artery-font-format"

git -C "$UPSTREAM" archive --format=tar --output="$ARCHIVE" HEAD
tar -xf "$ARCHIVE" -C "$STAGE"
git -C "$UPSTREAM/msdfgen" archive --format=tar --output="$MSDFGEN_ARCHIVE" HEAD
tar -xf "$MSDFGEN_ARCHIVE" -C "$STAGE/msdfgen"
git -C "$ARTERY_FONT" archive --format=tar --output="$ARTERY_FONT_ARCHIVE" HEAD
tar -xf "$ARTERY_FONT_ARCHIVE" -C "$STAGE/artery-font-format"
mkdir -p "$STAGE/wasm"
cp "$ROOT/wasm/"*.cpp "$ROOT/wasm/"*.h "$STAGE/wasm/"
perl -pi -e 's/\r$//' "$STAGE/CMakeLists.txt"
patch -s -d "$STAGE" -p1 < "$ROOT/wasm/upstream.patch"

printf '%s\n' "$STAGE"
