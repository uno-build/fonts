export type AtlasType = "hardmask" | "softmask" | "sdf" | "psdf" | "msdf" | "mtsdf";

export interface GenerateAtlasOptions {
  charset?: string;
  type?: AtlasType;
  size?: number;
  pxRange?: number;
  width?: number;
  height?: number;
  angleThreshold?: number;
  coloringStrategy?: "simple" | "inktrap" | "distance";
  yOrigin?: "top" | "bottom";
}

export interface AtlasBounds {
  left: number;
  right: number;
  top?: number;
  bottom?: number;
}

export interface AtlasGlyph {
  unicode: number;
  advance: number;
  planeBounds?: AtlasBounds;
  atlasBounds?: AtlasBounds;
}

export interface AtlasMetadata {
  atlas: {
    type: AtlasType;
    distanceRange?: number;
    distanceRangeMiddle?: number;
    size: number;
    width: number;
    height: number;
    yOrigin: "top" | "bottom";
  };
  metrics: {
    emSize: number;
    lineHeight: number;
    ascender: number;
    descender: number;
    underlineY: number;
    underlineThickness: number;
  };
  glyphs: AtlasGlyph[];
  kerning: Array<{ unicode1: number; unicode2: number; advance: number }>;
}

export interface AtlasResult {
  png: Uint8Array;
  metadata: AtlasMetadata;
  width: number;
  height: number;
}

export interface MsdfAtlasGenerator {
  getCharset(font: Uint8Array): Promise<string>;
  generate(font: Uint8Array, options?: GenerateAtlasOptions): Promise<AtlasResult>;
  destroy(): void;
}

export interface CreateGeneratorOptions {
  workerUrl?: string | URL;
}

export function createMsdfAtlasGenerator(config: CreateGeneratorOptions = {}): Promise<MsdfAtlasGenerator> {
  const workerUrl = config.workerUrl ?? new URL("./msdf-atlas.worker.js", import.meta.url);
  const worker = new Worker(workerUrl, { type: "module", name: "msdf-atlas-generator" });
  let nextId = 1;
  let destroyed = false;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();

  worker.onmessage = (event: MessageEvent) => {
    const message = event.data;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else if (typeof message.charset === "string") request.resolve(message.charset);
    else {
      const png = new Uint8Array(message.png);
      request.resolve({ png, metadata: message.metadata, width: message.width, height: message.height });
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "MSDF atlas Worker failed");
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  return Promise.resolve({
    getCharset(font: Uint8Array): Promise<string> {
      if (destroyed) return Promise.reject(new Error("MSDF atlas generator has been destroyed"));
      if (!(font instanceof Uint8Array)) return Promise.reject(new TypeError("font must be a Uint8Array"));
      const id = nextId++;
      const owned = font.byteOffset === 0 && font.byteLength === font.buffer.byteLength
        ? font
        : font.slice();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, operation: "getCharset", font: owned.buffer }, [owned.buffer]);
      });
    },
    generate(font: Uint8Array, options: GenerateAtlasOptions = {}): Promise<AtlasResult> {
      if (destroyed) return Promise.reject(new Error("MSDF atlas generator has been destroyed"));
      if (!(font instanceof Uint8Array)) return Promise.reject(new TypeError("font must be a Uint8Array"));
      const id = nextId++;
      // Slice exactly the view. Its ArrayBuffer is transferred and becomes detached.
      const owned = font.byteOffset === 0 && font.byteLength === font.buffer.byteLength
        ? font
        : font.slice();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, operation: "generate", font: owned.buffer, options }, [owned.buffer]);
      });
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      worker.terminate();
      const error = new Error("MSDF atlas generator was destroyed");
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    },
  });
}
