# msdf-atlas-gen WebAssembly (MVP)

This project consumes the official `./msdf-atlas-gen` checkout without
modifying it. It stages the pinned upstream revisions under `.build-src`,
applies `patches/upstream-wasm.patch` only to that disposable copy, and builds
an in-memory C ABI plus a Worker-first ES-module API. It does not invoke the
CLI, mount MEMFS, or perform file I/O from WebAssembly.

## Revisions and dependencies

- msdf-atlas-gen `6148900d59423059bafde2f51a0cb303184404bd` (`v1.4-2`)
- msdfgen `84f183a6c8137c42abc5728b29ed274bab3edeb0` (`v1.13+new-skia-api-2`)
- Skia `a004a27085d7dcc4efc3766c9abe92df03654c7c` (CanvasKit 0.39.1)
- Emscripten 3.1.51
- Emscripten ports: FreeType 2.6.0, libpng 1.6.39 and zlib 1.2.13

All four native dependencies are compiled for `wasm32`; no host library is
linked into the module. Artery Font, SVG, the standalone executable and
variable-font APIs are disabled in this MVP. Variable fonts are disabled
because the FreeType port pinned by Emscripten 3.1.51 predates the APIs used by
msdfgen 1.13.

## Build

Requirements: CMake, Ninja, Git, Python 3, and approximately 3 GB of free disk
space. The scripts install their pinned toolchains under `.wasm-deps`.

```sh
git -C msdf-atlas-gen submodule update --init msdfgen
./scripts/build-wasm-deps.sh
./scripts/build-wasm.sh
```

The second command builds a CPU-only Skia with PathOps for `wasm32`. The final
command creates a clean staged copy of the official repository and never edits
the checkout in `./msdf-atlas-gen`. Skia's
image codecs are disabled because the public PNG result is encoded by the
separately linked libpng port. The output directory contains:

```text
dist/msdf-atlas.js
dist/msdf-atlas.wasm
dist/msdf-atlas.worker.js
dist/index.js
dist/index.ts
dist/index.d.ts
```

The verified release build is 1,060,061 bytes before HTTP compression.

## Usage

```ts
import { createMsdfAtlasGenerator } from "./dist/index.js";

const generator = await createMsdfAtlasGenerator();
const font = new Uint8Array(await file.arrayBuffer());
const charset = await generator.getCharset(font.slice());
const result = await generator.generate(font, {
  charset: "AVATAR café Ω",
  type: "msdf", // hardmask | softmask | sdf | psdf | msdf | mtsdf
  size: 42,
  pxRange: 4,
  coloringStrategy: "inktrap",
  yOrigin: "bottom",
});

const bitmap = await createImageBitmap(
  new Blob([result.png], { type: "image/png" }),
  { colorSpaceConversion: "none", premultiplyAlpha: "none" },
);
generator.destroy();
```

`getCharset` reads the font's Unicode character map and returns every mapped
Unicode scalar as a codepoint-sorted string. The demo calls it when a TTF/OTF
file is selected and places the returned string in the Charset textarea.

`getCharset` and `generate` transfer a full-span input `Uint8Array` to the
Worker. The caller's buffer is therefore detached. Pass `font.slice()` when the
caller must retain a copy. A subarray is copied first so unrelated bytes are
never transferred.

The Worker copies the font into WASM, calls the C API, then copies the PNG and
JSON out before destroying the native handle. It never returns a view into
growing or freed WASM memory.

## Native ABI and lifetimes

The stable ABI is declared in `wasm/msdf-atlas-wasm.h`. The result owns a copy
of the supplied font bytes. `FT_New_Memory_Face` receives that copy, and it
remains valid until `destroyFont` has completed. Generation is synchronous on
the native side; only then are the PNG and metadata exposed. C++ exceptions are
caught at the ABI boundary and converted to `msdf_result_error` strings.

## Threading guarantee

`MSDF_ATLAS_ENABLE_THREADS=OFF` causes `Workload::finish` to call only
`finishSequential`; the parallel body is preprocessor-excluded and
`ImmediateAtlasGenerator::setThreadCount` normalizes every value to one.
Neither this project nor msdfgen finds or links `Threads::Threads` in this
configuration. The build contains none of `-pthread`, `USE_PTHREADS`,
`PTHREAD_POOL_SIZE`, or `PROXY_TO_PTHREAD`.

Verify the final binary directly:

```sh
node tests/check-wasm.mjs
# {"wasmBytes":1060061,"imports":50,"pthreadImports":0}
```

The module owns a non-shared `WebAssembly.Memory`; it has no imported memory and
no pthread/thread imports. A normal Worker is sufficient; SharedArrayBuffer,
COOP and COEP are not required.

## PNG and texture upload

`image-encode.cpp` uses `png_set_write_fn` to append compressed bytes directly
to a vector. The result is 8-bit grayscale for hard mask, soft mask, SDF and
PSDF, RGB for MSDF, and RGBA for MTSDF. Only structural PNG chunks are emitted;
no `sRGB`, `gAMA` or `iCCP` chunk is requested. Distance-field values must be
sampled as linear data. Use a linear (not sRGB) GPU texture and disable browser
color-space conversion when decoding if the API supports it.

## Demo

Install the Node.js dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

Vite opens `http://127.0.0.1:4173/demo/` automatically. To create and preview
a production bundle, run `npm run build:demo` followed by `npm run preview`.

The demo accepts a local TTF/OTF, shows the PNG and JSON, reports elapsed time,
dimensions and compressed size, and renders `AVATAR café Ω` from the atlas in
WebGL with sampling adapted to the selected atlas type.

## Tests

On macOS, the helper copies system fonts into the ignored `tests/assets`
directory. On other systems, point the three environment variables at suitable
fonts.

```sh
MSDF_TEST_TTF=/path/with-classic-kern-table.ttf \
MSDF_TEST_OTF=/path/font.otf \
MSDF_TEST_COMPLEX_TTF=/path/overlapping-contours.ttf \
./tests/run-browser-tests.sh
```

Then serve the repository and open `tests/browser-harness.html`. The harness
checks TTF, OTF, ASCII and Unicode, kerning, all six atlas types, their PNG
channel layouts, binary versus anti-aliased masks, complex Skia preprocessing,
PNG signature and `createImageBitmap`, dimensions, both Y origins, corrupt
input, insufficient fixed dimensions, and repeated generation. Sixteen repeated
generations remained at a stable 16 MiB WASM memory capacity.

## Native comparison and known differences

The WASM facade calls the same `FontGeometry`, `TightAtlasPacker`,
`GlyphGeometry::edgeColoring`, `ImmediateAtlasGenerator`, glyph generators, Skia
PathOps, and libpng code as the CLI at the pinned commits. A native ARM64 CLI
was built from the same source commit and Skia revision and run with
`AVToWaéΩ`, size 32, range 4, top origin and inktrap coloring. The comparison
produced the same 84×84 dimensions, the same ordered codepoints, zero delta for
all six font metrics, and zero changed components across 28,224 decoded RGBA
components. The native reference used FreeType 2.13.3 because FreeType 2.6.0
cannot be compiled by the current macOS 26 SDK; the identical result is useful
evidence that this fixture is unaffected by that dependency difference. PNG
deflate bytes are not required to match across zlib builds; decoded pixels are
the authoritative comparison.

Known behavioral differences from the CLI:

- the public surface supports hard mask, soft mask, SDF, PSDF, MSDF and MTSDF as PNG8, with tight packing;
- the default charset is printable ASCII, default size is 32 and default range
  is 4 pixels;
- missing codepoints are omitted; generation fails only if none load;
- variable-font axes and multi-font variants are not exposed;
- fixed dimensions must specify both width and height;
- metadata is returned in memory and intentionally omits CLI-only names/grid
  fields;
- all generation and distance coloring is sequential.
