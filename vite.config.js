import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [{
    name: "copy-msdf-wasm-dist",
    writeBundle(options) {
      const outputDirectory = options.dir ?? "vite-dist";
      mkdirSync(new URL("./dist/", new URL(`${outputDirectory}/`, import.meta.url)), { recursive: true });
      cpSync(
        new URL("./dist/", import.meta.url),
        new URL("./dist/", new URL(`${outputDirectory}/`, import.meta.url)),
        { recursive: true },
      );
    },
  }],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    open: "/demo/",
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    open: "/demo/",
  },
  build: {
    outDir: "vite-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./demo/index.html", import.meta.url)),
    },
  },
});
