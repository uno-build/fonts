#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="${MSDF_ATLAS_UPSTREAM_DIR:-$ROOT/msdf-atlas-gen}"
STAGE="${MSDF_ATLAS_STAGE_DIR:-$ROOT/.build-src/msdf-atlas-gen}"
ARCHIVE="$ROOT/.build-src/upstream.tar"
MSDFGEN_ARCHIVE="$ROOT/.build-src/msdfgen.tar"

git -C "$UPSTREAM" rev-parse --git-dir >/dev/null
git -C "$UPSTREAM/msdfgen" rev-parse --git-dir >/dev/null
mkdir -p "$ROOT/.build-src"
rm -rf "$STAGE"
mkdir -p "$STAGE/msdfgen"

git -C "$UPSTREAM" archive --format=tar --output="$ARCHIVE" HEAD
tar -xf "$ARCHIVE" -C "$STAGE"
git -C "$UPSTREAM/msdfgen" archive --format=tar --output="$MSDFGEN_ARCHIVE" HEAD
tar -xf "$MSDFGEN_ARCHIVE" -C "$STAGE/msdfgen"
cp -R "$ROOT/wasm" "$STAGE/wasm"
perl -pi -e 's/\r$//' "$STAGE/CMakeLists.txt"
patch -s -d "$STAGE" -p1 < "$ROOT/patches/upstream-wasm.patch"

printf '%s\n' "$STAGE"
