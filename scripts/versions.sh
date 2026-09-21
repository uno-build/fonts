#!/usr/bin/env bash

# This file is sourced by every native and WebAssembly build entry point.
# Keep the compatibility baseline immutable: changing any value here requires
# regenerating the native reference corpus.
readonly MSDF_ATLAS_COMMIT="6148900d59423059bafde2f51a0cb303184404bd"
readonly MSDFGEN_COMMIT="84f183a6c8137c42abc5728b29ed274bab3edeb0"
readonly SKIA_COMMIT="a004a27085d7dcc4efc3766c9abe92df03654c7c"
readonly ARTERY_FONT_COMMIT="af79386abe0857fe1c30be97eec760dbd84022c5"

readonly EMSDK_VERSION="3.1.51"
readonly EMSDK_COMMIT="4e2496141eda15040c44e9bbf237a1326368e34c"
readonly FREETYPE_VERSION="2.13.3"
readonly FREETYPE_SOURCE_DIRNAME="freetype-VER-2-13-3"
readonly LIBPNG_VERSION="1.6.39"
readonly ZLIB_VERSION="1.2.13"

readonly FREETYPE_ARCHIVE_SHA256="bc5c898e4756d373e0d991bab053036c5eb2aa7c0d5c67e8662ddc6da40c4103"
readonly LIBPNG_ARCHIVE_SHA256="a00e9d2f2f664186e4202db9299397f851aea71b36a35e74910b8820e380d441"
readonly ZLIB_ARCHIVE_SHA256="1525952a0a567581792613a9723333d7f8cc20b87a81f920fb8bc7e3f2251428"

readonly FREETYPE_ARCHIVE_URL="https://github.com/freetype/freetype/archive/refs/tags/VER-2-13-3.tar.gz"
readonly LIBPNG_ARCHIVE_URL="https://github.com/glennrp/libpng/archive/refs/tags/v${LIBPNG_VERSION}.tar.gz"
readonly ZLIB_ARCHIVE_URL="https://github.com/madler/zlib/archive/refs/tags/v${ZLIB_VERSION}.tar.gz"
