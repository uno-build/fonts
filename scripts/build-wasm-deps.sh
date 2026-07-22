#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPS="${MSDF_ATLAS_DEPS_DIR:-$ROOT/.wasm-deps}"
EMSDK_VERSION="${EMSDK_VERSION:-3.1.51}"
SKIA_COMMIT="${SKIA_COMMIT:-a004a27085d7dcc4efc3766c9abe92df03654c7c}"
EMSDK="$DEPS/emsdk"
SKIA="$DEPS/skia"
SKIA_PREFIX="$DEPS/skia-wasm"

mkdir -p "$DEPS"
if [[ ! -d "$EMSDK/.git" ]]; then
  git clone https://github.com/emscripten-core/emsdk.git "$EMSDK"
fi
git -C "$EMSDK" fetch --tags --prune
"$EMSDK/emsdk" install "$EMSDK_VERSION"
"$EMSDK/emsdk" activate "$EMSDK_VERSION"
source "$EMSDK/emsdk_env.sh"

# Materialize the official Emscripten ports into this SDK's cache first.
embuilder build zlib libpng freetype

if [[ ! -d "$SKIA/.git" ]]; then
  git clone https://skia.googlesource.com/skia.git "$SKIA"
fi
git -C "$SKIA" fetch origin "$SKIA_COMMIT"
git -C "$SKIA" checkout --detach "$SKIA_COMMIT"
# Run the dependency checkout and GN bootstrap portions directly. The script's
# final hook activates a second vendored emsdk; this build intentionally uses
# the separately pinned SDK above.
python3 -c 'import runpy,subprocess,sys; root=sys.argv[1]; m=runpy.run_path(root+"/tools/git-sync-deps"); m["git_sync_deps"](root+"/DEPS", [], True); subprocess.check_call([sys.executable, root+"/bin/fetch-gn"])' "$SKIA"

GN_ARGS="target_os=\"wasm\" target_cpu=\"wasm\" skia_emsdk_dir=\"$EMSDK\" is_official_build=true skia_enable_tools=false skia_enable_ganesh=false skia_enable_graphite=false skia_enable_skottie=false skia_enable_pdf=false skia_use_dng_sdk=false skia_use_expat=false skia_use_fontconfig=false skia_use_freetype=false skia_use_harfbuzz=false skia_use_icu=false skia_use_libavif=false skia_use_libheif=false skia_use_libjpeg_turbo_decode=false skia_use_libjpeg_turbo_encode=false skia_use_libpng_decode=false skia_use_libpng_encode=false skia_use_libwebp_decode=false skia_use_libwebp_encode=false skia_use_piex=false skia_use_wuffs=false skia_use_zlib=false"
(
  cd "$SKIA"
  bin/gn gen out/wasm-msdf --args="$GN_ARGS"
  ninja -C out/wasm-msdf skia
)

mkdir -p "$SKIA_PREFIX/lib" "$SKIA_PREFIX/include/skia" "$SKIA_PREFIX/include/include"
cp "$SKIA/out/wasm-msdf/libskia.a" "$SKIA_PREFIX/lib/libskia.a"
cp -R "$SKIA/include/"* "$SKIA_PREFIX/include/skia/"
cp -R "$SKIA/include/"* "$SKIA_PREFIX/include/include/"

printf '%s\n' \
  "Emscripten $EMSDK_VERSION: $EMSDK" \
  "Skia $SKIA_COMMIT: $SKIA_PREFIX"
