<img src="./assets/banner.jpg" alt="uno/fonts" width="100%" />

A WebAssembly (WASM) version of
[msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen). It runs the original C++
generator compiled to WASM through a Node.js CLI.

- [Quick start](#quick-start)
- [CLI options](#cli-options)
- [The `mtsdfx` type](#the-mtsdfx-type)
- [Development](#development)

## Quick start

With Node.js and npm installed, generate an atlas and its layout from a local
font file:

```sh
npx @uno/fonts font.ttf
```

This is equivalent to specifying the defaults explicitly:

```sh
npx @uno/fonts \
  -font font.ttf \
  -imageout font.png \
  -json font.json \
  -type mtsdfx \
  -size 64 \
  -pxrange 16 \
  -effectpxrange 32 \
  -chars "[0x20, 0x7e]" \
  -format png
```

## CLI options

| Option           | Values                                                                  | Description                                                                                                               |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `-font`          | Path to a `.ttf` or `.otf` file                                         | Input font; also accepted as the first positional argument. Required unless using `-varfont`.                             |
| `-imageout`      | Output image path                                                       | Atlas image destination. Default: last input font path with its extension replaced by `.png`.                             |
| `-json`          | Output `.json` path                                                     | Exports metrics, Unicode glyph layout, and kerning. Default: last input font path with its extension replaced by `.json`. |
| `-chars`         | Code points, ranges, or quoted strings, e.g. `'[0x20, 0x7e], "áéíóúñ"'` | Characters to include. Default: printable ASCII (`U+0020`–`U+007E`).                                                      |
| `-charset`       | Text file path                                                          | Reads Unicode character selection from a UTF-8 or ASCII file instead of inline `-chars`.                                  |
| `-type`          | `mtsdfx`, `mtsdf`, `msdf`, `sdf`                                        | Atlas type. Default: `mtsdfx`, with separate RGB and alpha distance ranges.                                               |
| `-size`          | Positive number                                                         | Glyph size in pixels per em. Default: `64`, unless `-minsize` is supplied.                                                |
| `-pxrange`       | Positive number                                                         | Total symmetric distance range in pixels; RGB range for `mtsdfx`. Default: `16` (−8 to +8).                               |
| `-effectpxrange` | Positive number ≥ `-pxrange`                                            | Alpha/effect range in pixels, only for `mtsdfx`. Default: `max(size / 2, pxrange)` (`32` with CLI defaults).              |
| `-yorigin`       | `bottom`, `top`                                                         | Output Y-axis direction: upward (`bottom`, default) or downward (`top`).                                                  |
| `-format`        | `png`, `binfloat`                                                       | Image encoding: 8-bit PNG or raw little-endian 32-bit floats. A `.png` path selects PNG; `mtsdfx` only supports PNG.      |
| `-allglyphs`     | No value                                                                | Packs every glyph, including unmapped glyphs; JSON omits glyphs without Unicode mappings.                                 |
| `-varfont`       | `"font.ttf?wdth=75&wght=700"`                                           | Input variable font with axis values. Quote the entire argument.                                                          |
| `-minsize`       | Positive number                                                         | Minimum pixels per em; uses the largest size that fits the same atlas dimensions.                                         |
| `-glyphs`        | Glyph indices or ranges, e.g. `'0, 1, [10, 20]'`                        | Selects font-specific glyph indices instead of Unicode characters.                                                        |
| `-glyphset`      | Text file path                                                          | Reads glyph indices and ranges from a file instead of inline `-glyphs`.                                                   |
| `-csv`           | Output `.csv` path                                                      | Exports glyph identifiers, advances, and bounds as an additional layout file.                                             |
| `-fontname`      | Name                                                                    | Sets the font name in output metadata.                                                                                    |
| `-and`           | No value                                                                | Starts another font input group in the same atlas; character selection carries forward.                                   |
| `-printvaraxes`  | No value                                                                | Lists the input font's variation axes without creating default outputs.                                                   |
| `-threads`       | Integer ≥ `0`                                                           | Accepted for compatibility; this WASM build always runs sequentially.                                                     |

For more details, see the [official msdf-atlas-gen repository](https://github.com/Chlumsky/msdf-atlas-gen).

## The `mtsdfx` type

`mtsdfx` is a local Node CLI extension of MTSDF. It produces one RGBA PNG with
two distance ranges: a narrow RGB range for precise text edges and sharp
corners, and a wider true-distance range in alpha for effects such as glows,
rounded outlines, and soft shadows. It provides distance data; the renderer
still implements the desired effects.

| Channels | Content                                                          | CLI option       | Default total range                                                           |
| -------- | ---------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| RGB      | Multichannel signed distance; use the median for text rendering. | `-pxrange`       | `16` pixels (`-8` to `+8`).                                                   |
| Alpha    | True signed distance for effects farther from the contour.       | `-effectpxrange` | `max(size / 2, pxrange)`; `32` pixels (`-16` to `+16`) with the CLI defaults. |

When `-effectpxrange` is omitted, the effect range is computed as
`Math.max(size / 2, pxRange)`. The calculation uses `-size`, or `-minsize`
when supplied without `-size`, otherwise the default size of `64`.
An explicit `-effectpxrange` overrides this calculation.

Ordinary `mtsdf` uses the same range for all four channels. Increasing that
shared range trades text-edge precision for effect reach. `mtsdfx` stores RGB
with a smaller range while retaining the larger effect range in alpha.

For example, to override the defaults with a size of `48`, an RGB range of
`8`, and an alpha range of `32`:

```sh
npx @uno/fonts \
  -font font.ttf \
  -type mtsdfx -size 48 -pxrange 8 -effectpxrange 32 \
  -imageout atlas-mtsdfx.png -json atlas-mtsdfx.json
```

Internally, the CLI generates a floating-point MTSDF using the effect range,
including its glyph bounds and packing margin. Before writing the 8-bit PNG,
it remaps RGB around `0.5` by `effectRange / rgbRange`, clamps to `[0, 1]`,
and quantizes. Alpha keeps the original effect-range values. The conversion
happens before 8-bit quantization to preserve RGB precision. A wider effect
range increases the margin needed around glyphs and may increase atlas
dimensions, even if the RGB range stays unchanged.

The JSON sets `atlas.type` to **`"mtsdfx"`**. It sets
`atlas.distanceRange` to the RGB range and adds `atlas.effectDistanceRange`
for alpha. For the example above, these fields are:

```json
{
  "type": "mtsdfx",
  "distanceRange": 8,
  "distanceRangeMiddle": 0,
  "effectDistanceRange": 32,
  "size": 48
}
```

These are selected fields from `metadata.atlas`, not the complete JSON file.
Glyph bounds and optional CSV layout retain the larger effect-range geometry.
The Unicode conversion described above also applies to `mtsdfx` JSON.

A renderer can distinguish extended MTSDF by `atlas.type === "mtsdfx"`.
With normalized texture samples, decode distances in
atlas pixels as follows, then convert them to screen units for rendering:

```glsl
float median3(vec3 v) {
    return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

// distanceRange = metadata.atlas.distanceRange
// effectDistanceRange = metadata.atlas.effectDistanceRange
vec4 sampleValue = texture(atlasTexture, uv);
float textDistance = (median3(sampleValue.rgb) - 0.5) * distanceRange;
float effectDistance = (sampleValue.a - 0.5) * effectDistanceRange;
```

Zero is the contour; positive distances are inside the glyph. These formulas
use symmetric ranges. For ordinary MTSDF generated with `-pxrange`, use
`distanceRange` for both channels when `effectDistanceRange` is absent.
A renderer that only uses RGB can continue to use `distanceRange`.
A renderer that uses alpha must read the separate effect range.

The extension's limits are:

- Both ranges must be positive finite numbers, and `effectpxrange` must be
  greater than or equal to `pxrange`. Equal ranges need no RGB remapping.
- Only symmetric pixel ranges are supported.
- Outputs are PNG (`-imageout`), JSON (`-json`), and CSV (`-csv`). Use a
  `.png` image filename or explicit `-format png`.
- `-effectpxrange` is rejected outside `-type mtsdfx`.
- Font selection, variable fonts, multiple inputs, fixed size, and both Y
  origins are exercised by the extension's tests. `mtsdfx` does not imply
  all glyphs or a fixed font size.
- The extension is implemented by the Node CLI. Use `npx @uno/fonts` to
  generate `mtsdfx` atlases.

## Development

To build from source, clone the original
[msdf-atlas-gen repository](https://github.com/Chlumsky/msdf-atlas-gen) into
this project's root and check out the pinned revision:

```sh
git clone https://github.com/Chlumsky/msdf-atlas-gen.git msdf-atlas-gen
git -C msdf-atlas-gen checkout --detach 6148900d59423059bafde2f51a0cb303184404bd
git -C msdf-atlas-gen submodule update --init msdfgen
npm install
npm run build:wasm
```

The submodule command checks out the matching `msdfgen` revision. The build
scripts download the other pinned dependencies, including Artery Font and
Skia. The official checkout is ignored by Git in this project and remains
unchanged during builds: the scripts apply `wasm/upstream.patch` to a staged
copy instead. Build prerequisites include Node.js/npm, Git, a C/C++ toolchain,
CMake, Ninja, Python 3, Make, and the shell utilities used by the scripts.
The scripts install the pinned Emscripten SDK. Dependency versions and
revisions are defined in `scripts/versions.sh`.

| Command                    | Description                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:reference`  | Builds the official C++ CLI with pinned versions to use as the test reference.                                                                      |
| `npm run build:wasm`       | Builds the dependencies and generates the JavaScript loader and WASM module used by the CLI.                                                        |
| `npm run test:reference`   | Runs the reference CLI and compares its results with the saved corpus.                                                                              |
| `npm run test:wasm`        | Inspects the WASM exports and verifies that it has no pthread imports or imported memory.                                                           |
| `npm run test:node`        | Smoke-tests WASM initialization, filesystem access, variable axes, and exporter file creation. Does not validate the full contents of every format. |
| `npm run test:cli`         | Checks the Node CLI against the C++ reference, host filesystem access, Unicode JSON, and the `mtsdfx` conversion and validation.                    |
| `npm run reference:update` | Regenerates the expected corpus using the reference CLI. Modifies corpus files; run only when intentionally updating the reference results.         |

The test commands use existing build artifacts. To rebuild both engines and
run the existing reference, WASM, Node, and CLI checks (partial coverage):

```sh
npm run build:reference
npm run build:wasm
npm run test:reference
npm run test:wasm
npm run test:node
npm run test:cli
```

Build and test paths can be configured with environment variables. Defaults
below are relative to the project root unless shown as absolute paths.

| Variable                     | Default                                          | Purpose                                                                                                  |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `MSDF_ATLAS_UPSTREAM_DIR`    | `msdf-atlas-gen`                                 | Checkout of the pinned upstream source.                                                                  |
| `MSDF_ATLAS_DEPS_DIR`        | `.wasm-deps`                                     | Downloaded dependencies, SDK, and dependency build artifacts.                                            |
| `MSDF_ATLAS_ARTERY_FONT_DIR` | `$MSDF_ATLAS_DEPS_DIR/artery-font-format`        | Artery Font source used while staging upstream. Must match the pinned revision.                          |
| `MSDF_ATLAS_STAGE_DIR`       | `.build-src/msdf-atlas-gen`                      | Disposable patched source copy, recreated by the build scripts.                                          |
| `MSDF_ATLAS_WASM_BUILD_DIR`  | `build-wasm-root`                                | CMake build directory for the WASM module.                                                               |
| `MSDF_NATIVE_CLI`            | `.wasm-deps/native-reference/bin/msdf-atlas-gen` | Reference executable used by tests. Set this too if the native build uses a custom dependency directory. |

Use absolute paths for build-directory overrides.
