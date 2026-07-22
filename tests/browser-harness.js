import { createMsdfAtlasGenerator } from "../dist/index.js";

const output = document.getElementById("result");
const assertions = [];
function ok(value, message) {
  if (!value) throw new Error(message);
  assertions.push(message);
}
async function font(name) { return new Uint8Array(await (await fetch(`./assets/${name}`)).arrayBuffer()); }

async function run() {
  const generator = await createMsdfAtlasGenerator();
  try {
    const ttf = await font("kerning.ttf");
    const charset = await generator.getCharset(ttf.slice());
    const codepoints = Array.from(charset, (character) => character.codePointAt(0));
    ok(charset.includes("A") && charset.includes("é") && charset.includes("Ω"), "font Unicode charset contents");
    ok(codepoints.length > 100 && codepoints.every((value, index) => !index || codepoints[index-1] < value), "font Unicode charset is sorted and unique");
    const basic = await generator.generate(ttf.slice(), { charset: "AVToWaéΩ", size: 32, pxRange: 4, yOrigin: "top" });
    ok(basic.png[0] === 0x89 && basic.png[1] === 0x50 && basic.png[2] === 0x4e && basic.png[3] === 0x47, "PNG signature");
    ok(basic.metadata.atlas.type === "msdf", "three-channel MSDF metadata");
    ok(basic.metadata.atlas.width === basic.width && basic.metadata.atlas.height === basic.height, "consistent dimensions");
    ok(basic.metadata.glyphs.some((g) => g.unicode === 233), "non-ASCII Unicode glyph");
    ok(basic.metadata.kerning.some((k) => k.unicode1 === 65 && k.unicode2 === 86 && k.advance < 0), "kerning pair AV");
    const image = await createImageBitmap(new Blob([basic.png], { type: "image/png" }), { colorSpaceConversion: "none" });
    ok(image.width === basic.width && image.height === basic.height, "PNG decodes with createImageBitmap");
    image.close();

    const atlasTypes = ["hardmask", "softmask", "sdf", "psdf", "msdf", "mtsdf"];
    const expectedPngColorTypes = { hardmask: 0, softmask: 0, sdf: 0, psdf: 0, msdf: 2, mtsdf: 6 };
    for (const type of atlasTypes) {
      const typed = await generator.generate(ttf.slice(), { type, charset: "Ag", size: 24, pxRange: 3 });
      ok(typed.metadata.atlas.type === type, `${type} metadata type`);
      ok(typed.png[25] === expectedPngColorTypes[type], `${type} PNG channel layout`);
      ok(("distanceRange" in typed.metadata.atlas) === !type.endsWith("mask"), `${type} distance range metadata`);
      const typedImage = await createImageBitmap(new Blob([typed.png], { type: "image/png" }), { colorSpaceConversion: "none" });
      ok(typedImage.width === typed.width && typedImage.height === typed.height, `${type} PNG decodes`);
      if (type === "hardmask" || type === "softmask") {
        const canvas = new OffscreenCanvas(typedImage.width, typedImage.height);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(typedImage, 0, 0);
        const reds = context.getImageData(0, 0, canvas.width, canvas.height).data.filter((_, index) => index%4 === 0);
        if (type === "hardmask")
          ok(reds.every((value) => value === 0 || value === 255), "hardmask contains only binary coverage");
        else
          ok(reds.some((value) => value > 0 && value < 255), "softmask contains anti-aliased coverage");
      }
      typedImage.close();
    }

    let invalidType = false;
    try { await generator.generate(ttf.slice(), { type: "invalid", charset: "A" }); }
    catch (error) { invalidType = /type.*hardmask.*mtsdf/i.test(error.message); }
    ok(invalidType, "invalid atlas type error");

    const bottom = await generator.generate(ttf.slice(), { charset: "Ag", size: 24, pxRange: 3, yOrigin: "bottom" });
    ok(bottom.metadata.atlas.yOrigin === "bottom", "bottom yOrigin");

    const otf = await generator.generate(await font("normal.otf"), { charset: "ABCxyz", size: 24 });
    ok(otf.metadata.glyphs.length === 6, "OTF input");

    const complex = await generator.generate(await font("complex.ttf"), { charset: "Afj", size: 36, coloringStrategy: "distance" });
    ok(complex.png.length > 100, "complex overlapping contours through Skia");

    let corrupt = false;
    try { await generator.generate(new Uint8Array([1, 2, 3, 4]), { charset: "A" }); }
    catch (error) { corrupt = /font|FreeType|FT_Face/i.test(error.message); }
    ok(corrupt, "corrupt font error");

    let corruptCharset = false;
    try { await generator.getCharset(new Uint8Array([1, 2, 3, 4])); }
    catch (error) { corruptCharset = /font|FreeType|FT_Face/i.test(error.message); }
    ok(corruptCharset, "corrupt font charset error");

    let tooSmall = false;
    try { await generator.generate(ttf.slice(), { charset: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", size: 32, width: 8, height: 8 }); }
    catch (error) { tooSmall = /insufficient|pack/i.test(error.message); }
    ok(tooSmall, "insufficient dimensions error");

    const memory = await new Promise((resolve, reject) => {
      const worker = new Worker("./memory.worker.js", { type: "module" });
      worker.onmessage = ({ data }) => { worker.terminate(); resolve(data.memories); };
      worker.onerror = reject;
      worker.postMessage({ font: ttf.buffer }, [ttf.buffer]);
    });
    ok(memory.slice(-8).every((value) => value === memory.at(-1)), "repeated generation reaches stable WASM memory capacity");
    generator.destroy();
    return { assertions, memory, ttf: { width: basic.width, height: basic.height, pngBytes: basic.png.length }, otf: { width: otf.width, height: otf.height } };
  } finally { generator.destroy(); }
}

try {
  const summary = await run();
  output.textContent = `PASS (${summary.assertions.length})\n${JSON.stringify(summary, null, 2)}`;
  document.title = "PASS · MSDF atlas browser integration tests";
  window.__testSummary = summary;
} catch (error) {
  output.textContent = `FAIL\n${error.stack || error}`;
  document.title = "FAIL · MSDF atlas browser integration tests";
  window.__testError = String(error.stack || error);
}
