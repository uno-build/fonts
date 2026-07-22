export function createMsdfAtlasGenerator(config = {}) {
  const worker = new Worker(config.workerUrl ?? new URL("./msdf-atlas.worker.js", import.meta.url), { type: "module", name: "msdf-atlas-generator" });
  let nextId = 1;
  let destroyed = false;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else if (typeof data.charset === "string") request.resolve(data.charset);
    else request.resolve({ png: new Uint8Array(data.png), metadata: data.metadata, width: data.width, height: data.height });
  };
  worker.onerror = ({ message }) => {
    for (const request of pending.values()) request.reject(new Error(message || "MSDF atlas Worker failed"));
    pending.clear();
  };
  return Promise.resolve({
    getCharset(font) {
      if (destroyed) return Promise.reject(new Error("MSDF atlas generator has been destroyed"));
      if (!(font instanceof Uint8Array)) return Promise.reject(new TypeError("font must be a Uint8Array"));
      const owned = font.byteOffset === 0 && font.byteLength === font.buffer.byteLength ? font : font.slice();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, operation: "getCharset", font: owned.buffer }, [owned.buffer]);
      });
    },
    generate(font, options = {}) {
      if (destroyed) return Promise.reject(new Error("MSDF atlas generator has been destroyed"));
      if (!(font instanceof Uint8Array)) return Promise.reject(new TypeError("font must be a Uint8Array"));
      const owned = font.byteOffset === 0 && font.byteLength === font.buffer.byteLength ? font : font.slice();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, operation: "generate", font: owned.buffer, options }, [owned.buffer]);
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      worker.terminate();
      for (const request of pending.values()) request.reject(new Error("MSDF atlas generator was destroyed"));
      pending.clear();
    },
  });
}
