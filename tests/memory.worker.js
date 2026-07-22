import createModule from "../dist/msdf-atlas.js";

self.onmessage = async ({ data }) => {
  const Module = await createModule({ locateFile: (path) => new URL(`../dist/${path}`, import.meta.url).href });
  const font = new Uint8Array(data.font);
  const memories = [];
  for (let i = 0; i < 16; ++i) {
    const fontPtr = Module._malloc(font.length);
    Module.HEAPU8.set(font, fontPtr);
    const encoded = new TextEncoder().encode(JSON.stringify({ charset: "AVATAR café Ω", size: 32, pxRange: 4, yOrigin: "top" })+"\0");
    const optionsPtr = Module._malloc(encoded.length);
    Module.HEAPU8.set(encoded, optionsPtr);
    const result = Module._msdf_generate_atlas(fontPtr, font.length, optionsPtr);
    const error = Module._msdf_result_error(result);
    if (error) throw new Error(Module.UTF8ToString(error));
    Module._msdf_destroy_result(result);
    Module._free(fontPtr);
    Module._free(optionsPtr);
    memories.push(Module.HEAPU8.buffer.byteLength);
  }
  self.postMessage({ memories });
};
