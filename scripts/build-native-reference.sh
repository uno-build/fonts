#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=versions.sh
source "$ROOT/scripts/versions.sh"
DEPS="${MSDF_ATLAS_DEPS_DIR:-$ROOT/.wasm-deps}"
SRC="$DEPS/src"
SKIA="$DEPS/skia"
PREFIX="$DEPS/native-reference-prefix"
BUILD="$DEPS/native-reference-build"
SKIA_PREFIX="$DEPS/skia-native-reference"
REFERENCE="$DEPS/native-reference"

"$ROOT/scripts/fetch-pinned-deps.sh"

mkdir -p "$BUILD" "$PREFIX" "$REFERENCE/bin"

ZLIB_NATIVE_SOURCE="$BUILD/zlib-source"
rm -rf "$ZLIB_NATIVE_SOURCE"
mkdir -p "$ZLIB_NATIVE_SOURCE"
tar -xzf "$SRC/zlib-${ZLIB_VERSION}.tar.gz" -C "$ZLIB_NATIVE_SOURCE" --strip-components=1
cmake -S "$ZLIB_NATIVE_SOURCE" -B "$BUILD/zlib-cmake" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_C_FLAGS=-UTARGET_OS_MAC \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_SHARED_LIBS=OFF \
  -DZLIB_BUILD_EXAMPLES=OFF
cmake --build "$BUILD/zlib-cmake" --target install

cmake -S "$SRC/libpng-$LIBPNG_VERSION" -B "$BUILD/libpng" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_C_FLAGS=-UTARGET_OS_MAC \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DPNG_SHARED=OFF \
  -DPNG_STATIC=ON \
  -DPNG_TESTS=OFF \
  -DPNG_TOOLS=OFF \
  -DZLIB_LIBRARY="$PREFIX/lib/libz.a" \
  -DZLIB_INCLUDE_DIR="$PREFIX/include"
cmake --build "$BUILD/libpng" --target install

cmake -S "$SRC/$FREETYPE_SOURCE_DIRNAME" -B "$BUILD/freetype" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_SHARED_LIBS=OFF \
  -DFT_DISABLE_ZLIB=ON \
  -DFT_DISABLE_BZIP2=ON \
  -DFT_DISABLE_PNG=ON \
  -DFT_DISABLE_HARFBUZZ=ON \
  -DFT_DISABLE_BROTLI=ON
cmake --build "$BUILD/freetype" --target install

if [[ ! -d "$SKIA/buildtools/.git" ]]; then
  python3 -c 'import runpy,sys; root=sys.argv[1]; m=runpy.run_path(root+"/tools/git-sync-deps"); m["git_sync_deps"](root+"/DEPS", [], True)' "$SKIA"
fi
if [[ ! -x "$SKIA/bin/gn" ]]; then
  python3 "$SKIA/bin/fetch-gn"
fi

case "$(uname -s)" in
  Darwin) target_os=mac ;;
  Linux) target_os=linux ;;
  *) printf 'Unsupported native reference host: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) target_cpu=arm64 ;;
  x86_64|amd64) target_cpu=x64 ;;
  *) printf 'Unsupported native reference architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

GN_ARGS="target_os=\"$target_os\" target_cpu=\"$target_cpu\" is_official_build=true skia_enable_tools=false skia_enable_ganesh=false skia_enable_graphite=false skia_enable_skottie=false skia_enable_pdf=false skia_use_dng_sdk=false skia_use_expat=false skia_use_fontconfig=false skia_use_freetype=false skia_use_harfbuzz=false skia_use_icu=false skia_use_libavif=false skia_use_libheif=false skia_use_libjpeg_turbo_decode=false skia_use_libjpeg_turbo_encode=false skia_use_libpng_decode=false skia_use_libpng_encode=false skia_use_libwebp_decode=false skia_use_libwebp_encode=false skia_use_piex=false skia_use_wuffs=false skia_use_zlib=false"
(
  cd "$SKIA"
  bin/gn gen out/native-msdf-reference --args="$GN_ARGS"
  ninja -C out/native-msdf-reference skia
)

mkdir -p "$SKIA_PREFIX/lib" "$SKIA_PREFIX/include/skia" "$SKIA_PREFIX/include/include"
cp "$SKIA/out/native-msdf-reference/libskia.a" "$SKIA_PREFIX/lib/libskia.a"
cp -R "$SKIA/include/"* "$SKIA_PREFIX/include/skia/"
cp -R "$SKIA/include/"* "$SKIA_PREFIX/include/include/"

SOURCE="$($ROOT/scripts/prepare-upstream.sh)"
cmake -S "$SOURCE" -B "$BUILD/msdf-atlas-gen" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_RUNTIME_OUTPUT_DIRECTORY="$REFERENCE/bin" \
  -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DMSDF_ATLAS_BUILD_STANDALONE=ON \
  -DMSDF_ATLAS_BUILD_WASM=OFF \
  -DMSDF_ATLAS_USE_SKIA=ON \
  -DMSDFGEN_USE_SKIA=ON \
  -DMSDF_ATLAS_NO_ARTERY_FONT=OFF \
  -DMSDF_ATLAS_USE_VCPKG=OFF \
  -DMSDFGEN_DISABLE_PNG=OFF \
  -DMSDFGEN_DISABLE_SVG=ON \
  -DBUILD_SHARED_LIBS=OFF \
  -DMSDF_ATLAS_ENABLE_THREADS=ON \
  -DMSDF_ATLAS_SKIA_ROOT="$SKIA_PREFIX" \
  -DFREETYPE_INCLUDE_DIR_freetype2="$PREFIX/include/freetype2" \
  -DFREETYPE_INCLUDE_DIR_ft2build="$PREFIX/include/freetype2" \
  -DFREETYPE_LIBRARY_RELEASE="$PREFIX/lib/libfreetype.a" \
  -DPNG_PNG_INCLUDE_DIR="$PREFIX/include" \
  -DPNG_LIBRARY_RELEASE="$PREFIX/lib/libpng16.a" \
  -DZLIB_INCLUDE_DIR="$PREFIX/include" \
  -DZLIB_LIBRARY_RELEASE="$PREFIX/lib/libz.a"
cmake --build "$BUILD/msdf-atlas-gen" --target msdf-atlas-gen-standalone

cp "$BUILD/msdf-atlas-gen/bin/msdf-atlas-gen" "$REFERENCE/bin/msdf-atlas-gen"
"$REFERENCE/bin/msdf-atlas-gen" -version
printf '%s\n' "$REFERENCE/bin/msdf-atlas-gen"
