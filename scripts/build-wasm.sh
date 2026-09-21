#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="${MSDF_ATLAS_DEPS_DIR:-$ROOT/.wasm-deps}"
BUILD="${MSDF_ATLAS_WASM_BUILD_DIR:-$ROOT/build-wasm-root}"
DIST="$ROOT/dist"
source "$DEPS/emsdk/emsdk_env.sh"
SOURCE="$($ROOT/scripts/prepare-upstream.sh)"

emcmake cmake -S "$SOURCE" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMSDF_ATLAS_BUILD_STANDALONE=OFF \
  -DMSDF_ATLAS_BUILD_WASM=ON \
  -DMSDF_ATLAS_USE_SKIA=ON \
  -DMSDFGEN_USE_SKIA=ON \
  -DMSDF_ATLAS_NO_ARTERY_FONT=OFF \
  -DMSDF_ATLAS_USE_VCPKG=OFF \
  -DMSDFGEN_DISABLE_PNG=OFF \
  -DMSDFGEN_DISABLE_VARIABLE_FONTS=OFF \
  -DMSDFGEN_DISABLE_SVG=ON \
  -DBUILD_SHARED_LIBS=OFF \
  -DMSDF_ATLAS_ENABLE_THREADS=OFF \
  -DMSDF_ATLAS_SKIA_ROOT="$DEPS/skia-wasm" \
  -DMSDF_ATLAS_WASM_DEPS_ROOT="$DEPS/wasm-prefix"
cmake --build "$BUILD" --target msdf-atlas-wasm

mkdir -p "$DIST"
cp "$BUILD/dist/msdf-atlas.js" "$BUILD/dist/msdf-atlas.wasm" "$DIST/"
npm --prefix "$ROOT" run build:api
wc -c "$DIST/msdf-atlas.wasm"
