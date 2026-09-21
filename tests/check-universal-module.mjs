import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import createModule from "../dist/msdf-atlas.js";

const stdout = [];
const stderr = [];
const Module = await createModule({
  locateFile: (path) => new URL(`../dist/${path}`, import.meta.url).href,
  print: (line) => stdout.push(line),
  printErr: (line) => stderr.push(line),
});

assert.deepEqual(stdout, [], "the official main must not run during module initialization");
assert.deepEqual(stderr, [], "module initialization must be silent");
assert.equal(typeof Module._main, "function", "_main export");
assert.equal(typeof Module.callMain, "function", "callMain runtime method");
assert.equal(typeof Module.FS?.writeFile, "function", "FS runtime method");
assert.equal(typeof Module.NODEFS?.mount, "function", "NODEFS runtime method");
assert.equal(typeof Module._msdf_generate_atlas, "function", "existing web ABI");

Module.FS.writeFile("/phase-1-smoke.txt", "filesystem enabled");
assert.equal(Module.FS.readFile("/phase-1-smoke.txt", { encoding: "utf8" }), "filesystem enabled");
Module.FS.unlink("/phase-1-smoke.txt");

const result = Module.callMain(["-version"]);
assert.equal(result, 0, "official main exit code");
assert.match(stdout.join("\n"), /MSDF-Atlas-Gen v1\.4/);
assert.match(stdout.join("\n"), /MSDFgen v1\.13/);

Module.FS.mkdir("/fixtures");
Module.FS.writeFile("/fixtures/Roboto-Variable.ttf", await readFile(new URL("./reference/fixtures/Roboto-Variable.ttf", import.meta.url)));
stdout.length = 0;
stderr.length = 0;
assert.equal(Module.callMain(["-varfont", "/fixtures/Roboto-Variable.ttf", "-printvaraxes", "-threads", "8"]), 0);
assert.match(stdout.join("\n"), /\[wght\].*Weight/);
assert.match(stdout.join("\n"), /\[wdth\].*Width/);

Module.FS.writeFile("/fixtures/Lato-Regular.ttf", await readFile(new URL("./reference/fixtures/Lato-Regular.ttf", import.meta.url)));

const imageFormats = [
  ["png", "png"],
  ["bmp", "bmp"],
  ["tiff", "tiff"],
  ["rgba", "rgba"],
  ["fl32", "fl32"],
  ["text", "txt"],
  ["textfloat", "txt"],
  ["bin", "bin"],
  ["binfloat", "bin"],
  ["binfloatbe", "bin"],
];
for (const [format, extension] of imageFormats) {
  const output = `/atlas-${format}.${extension}`;
  stdout.length = 0;
  stderr.length = 0;
  const exitCode = Module.callMain(["-font", "/fixtures/Lato-Regular.ttf", "-chars", "65", "-type", "sdf", "-size", "24", "-format", format, "-imageout", output, "-threads", "8"]);
  assert.equal(exitCode, 0, `${format} exporter exit code: ${stderr.join("\n")}`);
  assert.ok(Module.FS.readFile(output).byteLength > 0, `${format} exporter output`);
  Module.FS.unlink(output);
}

stdout.length = 0;
stderr.length = 0;
assert.equal(Module.callMain(["-font", "/fixtures/Lato-Regular.ttf", "-chars", "65,86", "-size", "24", "-imageout", "/atlas.png", "-json", "/atlas.json", "-csv", "/atlas.csv", "-shadronpreview", "/atlas.shadron", "AV", "-threads", "8"]), 0, "metadata exporters exit code");
for (const output of ["/atlas.png", "/atlas.json", "/atlas.csv", "/atlas.shadron"]) {
  assert.ok(Module.FS.readFile(output).byteLength > 0, `${output} exporter output`);
}

stdout.length = 0;
stderr.length = 0;
assert.equal(Module.callMain(["-font", "/fixtures/Lato-Regular.ttf", "-chars", "65,86", "-size", "24", "-arfont", "/atlas.arfont", "-threads", "8"]), 0);
assert.ok(Module.FS.readFile("/atlas.arfont").byteLength > 100, "Artery Font exporter output");
assert.match(stderr.join("\n"), /Artery Font file generated/);

console.log(JSON.stringify({ main: true, callMain: true, filesystem: true, nodefs: true, autoMain: false, variableFonts: true, imageFormats: imageFormats.map(([format]) => format), metadataExporters: ["json", "csv", "shadron"], arteryFont: true, sequentialThreadsArgument: 8 }));
