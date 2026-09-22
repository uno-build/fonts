# @uno/fonts

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

The options below have Node/WASM test coverage for the exercised fonts and
combinations. The documented image and layout outputs have content checks;
exporters checked only for file creation are omitted.

### Fonts and character selection

| Option                                          | Description                                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-font <file.ttf/otf>`                          | Input TrueType or OpenType font. A font input is required for generation.                                                                                         |
| `-varfont <file.ttf/otf?axis=value&axis=value>` | Input variable font with axis coordinates, for example `"font.ttf?wdth=75&wght=700"`. Quote the entire argument to protect `?` and `&` from the shell.            |
| `-printvaraxes`                                 | Lists the available variation axes. Can be used with a font input and no output files.                                                                            |
| `-charset <file>`                               | Reads a set of Unicode characters from a UTF-8 or ASCII text file.                                                                                                |
| `-chars <specification>`                        | Provides the character set inline, using the syntax below.                                                                                                        |
| `-glyphset <file>`                              | Reads font-specific glyph indices from a text file.                                                                                                               |
| `-glyphs <specification>`                       | Provides glyph indices inline.                                                                                                                                    |
| `-allglyphs`                                    | Packs every glyph index in the font, including glyphs with no Unicode mapping. See the JSON behavior below.                                                       |
| `-fontname <name>`                              | Sets a font name in output metadata.                                                                                                                              |
| `-and`                                          | Starts another input group in the same atlas. Character selection carries forward unless changed. Specify a font and name for each group as in the example below. |

Without a character or glyph selection, the default is printable ASCII
(`U+0020`–`U+007E`). A later selection option replaces the previous selection
within the current input group.

Use decimal or hexadecimal code points (`65`, `0x41`), inclusive numeric
ranges (`[0x20, 0x7e]`), or double-quoted strings (`"ABC café"`) to select
characters. Separate entries with commas or whitespace. The input order
does not determine atlas order. For example:

```sh
npx @uno/fonts \
  -font font.ttf \
  -chars '[0x20, 0x7e], "áéíóúñ"' -size 64 \
  -imageout latin.png -json latin.json
```

Glyph sets use numeric values and ranges, for example `0,1,2,3,40,330`.

To combine fonts:

```sh
npx @uno/fonts \
  -font regular.ttf -fontname regular \
  -chars '[0x20, 0x7e]' \
  -and -font bold.ttf -fontname bold \
  -size 64 -imageout family.png -json family.json
```

### Atlas types

Select a type with `-type <type>`. The default is `mtsdfx`.

| Type     | Distance channels | Description                                                                                                                  |
| -------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `sdf`    | 1                 | True signed distance to the contour; suitable for smooth distance-based effects.                                             |
| `msdf`   | RGB               | Multichannel signed distance field, preserving sharp corners when enlarged. Reconstruct the distance with the median of RGB. |
| `mtsdf`  | RGBA              | MSDF in RGB plus a true SDF in alpha. All channels share one distance range.                                                 |
| `mtsdfx` | RGBA              | Local CLI extension of MTSDF with separate RGB and alpha ranges. See [The `mtsdfx` type](#the-mtsdfx-type).                  |

Distance-field channels store data: sample them as linear values, with no
sRGB conversion. For MTSDF and MTSDFX, alpha is distance data rather than
opacity, so preserve RGB without premultiplying it by alpha.

### Image formats and outputs

`-format <format>` selects the image encoding. Use a `.png` output filename
for automatic PNG selection. For floating-point output, specify
`-format binfloat` explicitly.

| Format     | Description                                                                                         | Content checks                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `png`      | Compressed 8-bit PNG. The only image format supported by `mtsdfx`.                                  | Selected tests compare decoded pixels and dimensions.                                                                  |
| `binfloat` | Raw 32-bit floating-point values, little endian. Exercised with `mtsdf`; unavailable with `mtsdfx`. | The `mtsdfx` suite uses direct MTSDF float output as its reference and compares selected cases with the native engine. |

When `-imageout` or `-json` is omitted, its path is derived independently from
the font path by replacing the extension with `.png` or `.json`. This also
supports `-varfont` (without the axis suffix); for multiple fonts, the last
font path is used. Help, version, and variation-axis queries create no default
outputs.

| Option              | Description                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `-imageout <file>`  | Writes the atlas image. Layout information must be exported separately.                                       |
| `-json <file.json>` | Writes atlas settings, font metrics, glyph layout, and kerning. Multiple inputs are grouped under `variants`. |
| `-csv <file.csv>`   | Writes glyph identifiers, advances, plane bounds, and atlas bounds. Multiple inputs add a leading font index. |

JSON tests check selected metadata and Unicode mappings. CSV content is
compared with the direct MTSDF layout in the `mtsdfx` suite. These checks cover
the tested combinations rather than every type/output pairing.

In JSON, `atlas.size` is pixels per em; font metrics, glyph `advance`, kerning
adjustments, and `planeBounds` use em units. `atlasBounds` uses atlas pixels.
Glyphs without drawable geometry, such as spaces, can omit bounds.
`-yorigin` controls the vertical coordinate convention.

The Node CLI always exports Unicode identifiers in JSON, including when using
`-glyphs`, `-glyphset`, or `-allglyphs`: it converts glyph indices through the
font's character map, emits every Unicode alias with the same packed geometry,
omits unmapped glyphs from JSON, and sorts by code point. Kerning pairs are
converted too. This does not change which glyphs are packed into the image.
CSV and the direct WASM CLI retain the upstream glyph-index behavior.

### Glyph size, distance range, and coordinates

An em is the font's design-space unit. At `-size 64`, one em maps to 64 atlas
pixels. A symmetric range is its **total width**: `-pxrange 16` represents
distances from `-8` outside to `+8` inside the contour. Larger ranges allow
effects farther from the contour, but need more atlas space and reduce
distance precision in 8-bit output.

| Option                   | Description                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-size <size>`           | Fixes glyph size in pixels per em; positive real number. Default `64`, unless `-minsize` is supplied.                                                           |
| `-pxrange <width>`       | Symmetric distance range in atlas pixels. Default `16` (RGB range in `mtsdfx`), unless another range option is supplied.                                        |
| `-effectpxrange <width>` | Alpha/effect range in pixels, only with `mtsdfx`. Default `max(size / 2, pxrange)` (`32` with CLI defaults); must be positive, finite, and at least `-pxrange`. |
| `-yorigin <origin>`      | Sets `bottom` (default, Y increases upward) or `top` (Y increases downward) for output coordinates.                                                             |
| `-threads <N>`           | Accepts a thread count, but this WASM build always computes sequentially. Tests exercise values `1` and `8`.                                                    |

Atlas dimensions are chosen automatically for the selected glyphs, size, and
distance range. Both Y origins have output checks in the `mtsdfx` suite.

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
