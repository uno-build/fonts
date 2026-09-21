#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=versions.sh
source "$ROOT/scripts/versions.sh"
DEPS="${MSDF_ATLAS_DEPS_DIR:-$ROOT/.wasm-deps}"
SRC="$DEPS/src"
EMSDK="$DEPS/emsdk"
SKIA="$DEPS/skia"
PREFIX="$DEPS/wasm-prefix"
BUILD="$DEPS/wasm-build"
SKIA_PREFIX="$DEPS/skia-wasm"

"$ROOT/scripts/fetch-pinned-deps.sh"

if [[ ! -d "$EMSDK/.git" ]]; then
  git clone https://github.com/emscripten-core/emsdk.git "$EMSDK"
fi
if ! git -C "$EMSDK" cat-file -e "$EMSDK_COMMIT^{commit}" 2>/dev/null; then
  git -C "$EMSDK" fetch --tags --prune
fi
git -C "$EMSDK" checkout --detach "$EMSDK_COMMIT"
test "$(git -C "$EMSDK" rev-parse HEAD)" = "$EMSDK_COMMIT"
"$EMSDK/emsdk" install "$EMSDK_VERSION"
"$EMSDK/emsdk" activate "$EMSDK_VERSION"
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh"

mkdir -p "$BUILD" "$PREFIX"

ZLIB_BUILD_SOURCE="$BUILD/zlib-source"
rm -rf "$ZLIB_BUILD_SOURCE"
mkdir -p "$ZLIB_BUILD_SOURCE"
tar -xzf "$SRC/zlib-${ZLIB_VERSION}.tar.gz" -C "$ZLIB_BUILD_SOURCE" --strip-components=1
(
  cd "$ZLIB_BUILD_SOURCE"
  emconfigure ./configure --static --prefix="$PREFIX"
  emmake make -j4 libz.a AR=emar ARFLAGS=rc RANLIB=emranlib
  emmake make install AR=emar ARFLAGS=rc RANLIB=emranlib
)

emcmake cmake -S "$SRC/libpng-$LIBPNG_VERSION" -B "$BUILD/libpng" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DPNG_SHARED=OFF \
  -DPNG_STATIC=ON \
  -DPNG_TESTS=OFF \
  -DPNG_TOOLS=OFF \
  -DZLIB_LIBRARY="$PREFIX/lib/libz.a" \
  -DZLIB_INCLUDE_DIR="$PREFIX/include"
cmake --build "$BUILD/libpng" --target install

emcmake cmake -S "$SRC/$FREETYPE_SOURCE_DIRNAME" -B "$BUILD/freetype" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_SHARED_LIBS=OFF \
  -DFT_DISABLE_ZLIB=ON \
  -DFT_DISABLE_BZIP2=ON \
  -DFT_DISABLE_PNG=ON \
  -DFT_DISABLE_HARFBUZZ=ON \
  -DFT_DISABLE_BROTLI=ON
cmake --build "$BUILD/freetype" --target install

# Run only Skia's dependency checkout and GN bootstrap when the pinned checkout
# has not already been materialized. Its final setup hook activates a second
# vendored emsdk, while this build intentionally uses the separately pinned SDK
# above. Avoiding unconditional bootstrapping also keeps repeat builds offline.
if [[ ! -d "$SKIA/buildtools/.git" ]]; then
  python3 -c 'import runpy,sys; root=sys.argv[1]; m=runpy.run_path(root+"/tools/git-sync-deps"); m["git_sync_deps"](root+"/DEPS", [], True)' "$SKIA"
fi
if [[ ! -x "$SKIA/bin/gn" ]]; then
  python3 "$SKIA/bin/fetch-gn"
fi

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
  "FreeType $FREETYPE_VERSION, libpng $LIBPNG_VERSION, zlib $ZLIB_VERSION: $PREFIX" \
  "Skia $SKIA_COMMIT: $SKIA_PREFIX" \
  "Artery Font $ARTERY_FONT_COMMIT: $DEPS/artery-font-format"
