import createMsdfAtlasModule from "./msdf-atlas.js";

let modulePromise;
function getModule() {
  return modulePromise ??= createMsdfAtlasModule({
    locateFile(path) { return new URL(path, import.meta.url).href; },
  });
}

self.onmessage = async (event) => {
  const { id, operation = "generate", font, options = {} } = event.data;
  let fontPtr = 0;
  let optionsPtr = 0;
  let resultPtr = 0;
  try {
    const Module = await getModule();
    const bytes = new Uint8Array(font);
    fontPtr = Module._malloc(bytes.byteLength);
    if (!fontPtr && bytes.byteLength) throw new Error("WASM could not allocate the font buffer");
    Module.HEAPU8.set(bytes, fontPtr);

    if (operation === "getCharset") {
      resultPtr = Module._msdf_get_font_charset(fontPtr, bytes.byteLength);
      if (!resultPtr) throw new Error("WASM could not allocate the font charset result handle");
      const errorPtr = Module._msdf_font_charset_error(resultPtr);
      if (errorPtr) throw new Error(Module.UTF8ToString(errorPtr));
      const dataPtr = Module._msdf_font_charset_data(resultPtr);
      const length = Module._msdf_font_charset_size(resultPtr);
      if (!dataPtr || !length) throw new Error("native font charset reader returned an empty result");
      const codepoints = Module.HEAPU32.slice(dataPtr>>>2, (dataPtr>>>2)+length);
      let charset = "";
      for (let i = 0; i < codepoints.length; i += 4096)
        charset += String.fromCodePoint(...codepoints.subarray(i, i+4096));
      self.postMessage({ id, charset });
    } else if (operation === "generate") {
      const optionsBytes = new TextEncoder().encode(JSON.stringify(options)+"\0");
      optionsPtr = Module._malloc(optionsBytes.byteLength);
      if (!optionsPtr) throw new Error("WASM could not allocate the options buffer");
      Module.HEAPU8.set(optionsBytes, optionsPtr);

      resultPtr = Module._msdf_generate_atlas(fontPtr, bytes.byteLength, optionsPtr);
      if (!resultPtr) throw new Error("WASM could not allocate the result handle");
      const errorPtr = Module._msdf_result_error(resultPtr);
      if (errorPtr) throw new Error(Module.UTF8ToString(errorPtr));

      const pngPtr = Module._msdf_result_png_data(resultPtr);
      const pngSize = Module._msdf_result_png_size(resultPtr);
      const metadataPtr = Module._msdf_result_metadata_json(resultPtr);
      if (!pngPtr || !pngSize || !metadataPtr) throw new Error("native generator returned an incomplete result");
      // Copy before freeing the native handle; never expose a WASM heap view.
      const png = Module.HEAPU8.slice(pngPtr, pngPtr+pngSize);
      const metadata = JSON.parse(Module.UTF8ToString(metadataPtr));
      const width = Module._msdf_result_width(resultPtr);
      const height = Module._msdf_result_height(resultPtr);
      self.postMessage({ id, png: png.buffer, metadata, width, height }, [png.buffer]);
    } else {
      throw new Error(`unknown Worker operation: ${operation}`);
    }
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (resultPtr) {
      const Module = await getModule();
      if (operation === "getCharset") Module._msdf_destroy_font_charset_result(resultPtr);
      else Module._msdf_destroy_result(resultPtr);
    }
    if (fontPtr || optionsPtr) {
      const Module = await getModule();
      if (fontPtr) Module._free(fontPtr);
      if (optionsPtr) Module._free(optionsPtr);
    }
  }
};
