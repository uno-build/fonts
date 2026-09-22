import { readFileSync } from "node:fs";

export function getJsonInputs(arguments_, optionArity) {
  const fonts = [];
  let fontPath;
  let jsonPath;
  for (let index = 0; index < arguments_.length; index++) {
    const option = arguments_[index].replace(/^--/, "-");
    const arity = optionArity.get(option) ?? 0;
    if (index + arity >= arguments_.length) continue;
    const value = arguments_[index + 1];
    if (option === "-font") fontPath = value;
    else if (option === "-varfont") fontPath = value.split("?")[0];
    else if (option === "-and") fonts.push(fontPath);
    else if (option === "-json") jsonPath = value;
    index += arity;
  }
  fonts.push(fontPath);
  // The official CLI inherits missing font inputs from the next -and group.
  for (let index = fonts.length - 2; index >= 0; index--) {
    fonts[index] ??= fonts[index + 1];
  }
  return { fonts, jsonPath };
}

function readCodepointsByIndex(Module, fontPath) {
  const bytes = readFileSync(fontPath);
  const fontPtr = Module._malloc(bytes.byteLength);
  if (!fontPtr) throw new Error("WASM could not allocate font data for Unicode JSON.");
  let resultPtr = 0;
  try {
    Module.HEAPU8.set(bytes, fontPtr);
    resultPtr = Module._msdf_get_font_charset(fontPtr, bytes.byteLength);
    if (!resultPtr) throw new Error("WASM could not allocate the font character map result.");
    const errorPtr = Module._msdf_font_charset_error(resultPtr);
    if (errorPtr) throw new Error(Module.UTF8ToString(errorPtr));
    const codepointsPtr = Module._msdf_font_charset_data(resultPtr) >>> 2;
    const indicesPtr = Module._msdf_font_charset_glyph_indices(resultPtr) >>> 2;
    const length = Module._msdf_font_charset_size(resultPtr);
    const codepointsByIndex = new Map();
    for (let position = 0; position < length; position++) {
      const index = Module.HEAPU32[indicesPtr + position];
      const unicode = Module.HEAPU32[codepointsPtr + position];
      let codepoints = codepointsByIndex.get(index);
      if (!codepoints) codepointsByIndex.set(index, codepoints = []);
      codepoints.push(unicode);
    }
    return codepointsByIndex;
  } finally {
    if (resultPtr) Module._msdf_destroy_font_charset_result(resultPtr);
    Module._free(fontPtr);
  }
}

export function convertJsonToUnicode(Module, metadata, fontPaths) {
  const variants = metadata.variants ?? [metadata];
  const fontMaps = new Map();
  let changed = false;
  for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
    const variant = variants[variantIndex];
    if (!variant.glyphs.some((glyph) => glyph.index !== undefined)) continue;
    const fontPath = fontPaths[variantIndex];
    let codepointsByIndex = fontMaps.get(fontPath);
    if (!codepointsByIndex) {
      codepointsByIndex = readCodepointsByIndex(Module, fontPath);
      fontMaps.set(fontPath, codepointsByIndex);
    }
    const selectedIndices = new Set(variant.glyphs.map((glyph) => glyph.index));
    variant.glyphs = variant.glyphs.flatMap(({ index, ...glyph }) =>
      index === undefined ? [glyph] : (codepointsByIndex.get(index) ?? []).map((unicode) => ({ unicode, ...glyph })),
    ).sort((left, right) => left.unicode - right.unicode);
    if (variant.kerning) {
      variant.kerning = variant.kerning.flatMap(({ index1, index2, ...pair }) => {
        if (index1 === undefined) return [pair];
        if (!selectedIndices.has(index1) || !selectedIndices.has(index2)) return [];
        return (codepointsByIndex.get(index1) ?? []).flatMap((unicode1) =>
          (codepointsByIndex.get(index2) ?? []).map((unicode2) => ({ unicode1, unicode2, ...pair })),
        );
      }).sort((left, right) => left.unicode1 - right.unicode1 || left.unicode2 - right.unicode2);
    }
    changed = true;
  }
  return changed;
}
