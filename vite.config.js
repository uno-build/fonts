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
    open: "/playground/",
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    open: "/playground/",
  },
  build: {
    outDir: "vite-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./playground/index.html", import.meta.url)),
    },
  },
});
