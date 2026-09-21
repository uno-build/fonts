import { readFile } from "node:fs/promises";

const file = new URL("../dist/msdf-atlas.wasm", import.meta.url);
const bytes = await readFile(file);
const module = await WebAssembly.compile(bytes);
const imports = WebAssembly.Module.imports(module);
const exports = WebAssembly.Module.exports(module);
const pthread = imports.filter(({ module, name }) => /pthread|thread|wasi_thread|shared/i.test(`${module}.${name}`));
if (pthread.length) throw new Error(`pthread imports found: ${JSON.stringify(pthread)}`);
const memory = imports.find(({ kind }) => kind === "memory");
if (memory) throw new Error(`unexpected imported memory: ${memory.module}.${memory.name}`);
for (const name of ["__main_argc_argv", "malloc", "free", "msdf_generate_atlas", "msdf_get_font_charset"]) {
  if (!exports.some((entry) => entry.name === name && entry.kind === "function")) {
    throw new Error(`missing WebAssembly function export: ${name}`);
  }
}
console.log(JSON.stringify({ wasmBytes: bytes.byteLength, imports: imports.length, exports: exports.length, pthreadImports: 0 }));
