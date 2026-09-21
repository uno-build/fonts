#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=versions.sh
source "$ROOT/scripts/versions.sh"
DEPS="${MSDF_ATLAS_DEPS_DIR:-$ROOT/.wasm-deps}"
SRC="$DEPS/src"
SKIA="$DEPS/skia"
ARTERY_FONT="$DEPS/artery-font-format"

case "$DEPS" in
  ""|/) printf '%s\n' "Refusing unsafe dependency directory: $DEPS" >&2; exit 1 ;;
esac

sha256() {
  shasum -a 256 "$1" | awk '{ print $1 }'
}

download() {
  local url="$1" file="$2" expected="$3"
  if [[ ! -f "$file" || "$(sha256 "$file")" != "$expected" ]]; then
    mkdir -p "$(dirname "$file")"
    curl -L --fail --retry 3 --output "$file.tmp" "$url"
    if [[ "$(sha256 "$file.tmp")" != "$expected" ]]; then
      printf '%s\n' "Checksum mismatch for $url" >&2
      return 1
    fi
    mv "$file.tmp" "$file"
  fi
}

extract() {
  local archive="$1" directory="$2" expected="$3" required_file="$4"
  local marker="$directory/.msdf-source-sha256"
  if [[ ! -f "$marker" || "$(<"$marker")" != "$expected" || ! -f "$directory/$required_file" ]]; then
    rm -rf "$directory"
    tar -xzf "$archive" -C "$(dirname "$directory")"
    printf '%s\n' "$expected" > "$marker"
  fi
}

checkout() {
  local url="$1" directory="$2" commit="$3"
  if [[ ! -d "$directory/.git" ]]; then
    git clone --filter=blob:none --no-checkout "$url" "$directory"
  fi
  if ! git -C "$directory" cat-file -e "$commit^{commit}" 2>/dev/null; then
    git -C "$directory" fetch --no-tags origin "$commit"
  fi
  git -C "$directory" checkout --detach "$commit"
  test "$(git -C "$directory" rev-parse HEAD)" = "$commit"
}

mkdir -p "$SRC"
download "$FREETYPE_ARCHIVE_URL" "$SRC/freetype-${FREETYPE_VERSION}.tar.gz" "$FREETYPE_ARCHIVE_SHA256"
download "$LIBPNG_ARCHIVE_URL" "$SRC/libpng-${LIBPNG_VERSION}.tar.gz" "$LIBPNG_ARCHIVE_SHA256"
download "$ZLIB_ARCHIVE_URL" "$SRC/zlib-${ZLIB_VERSION}.tar.gz" "$ZLIB_ARCHIVE_SHA256"

extract "$SRC/freetype-${FREETYPE_VERSION}.tar.gz" "$SRC/$FREETYPE_SOURCE_DIRNAME" "$FREETYPE_ARCHIVE_SHA256" CMakeLists.txt
extract "$SRC/libpng-${LIBPNG_VERSION}.tar.gz" "$SRC/libpng-${LIBPNG_VERSION}" "$LIBPNG_ARCHIVE_SHA256" png.h
extract "$SRC/zlib-${ZLIB_VERSION}.tar.gz" "$SRC/zlib-${ZLIB_VERSION}" "$ZLIB_ARCHIVE_SHA256" zconf.h

checkout https://skia.googlesource.com/skia.git "$SKIA" "$SKIA_COMMIT"
checkout https://github.com/Chlumsky/artery-font-format.git "$ARTERY_FONT" "$ARTERY_FONT_COMMIT"

printf '%s\n' \
  "FreeType $FREETYPE_VERSION: $SRC/$FREETYPE_SOURCE_DIRNAME" \
  "libpng $LIBPNG_VERSION: $SRC/libpng-$LIBPNG_VERSION" \
  "zlib $ZLIB_VERSION: $SRC/zlib-$ZLIB_VERSION" \
  "Skia $SKIA_COMMIT: $SKIA" \
  "Artery Font $ARTERY_FONT_COMMIT: $ARTERY_FONT"
