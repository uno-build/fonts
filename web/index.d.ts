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
export interface AtlasBounds { left: number; right: number; top?: number; bottom?: number }
export interface AtlasGlyph { unicode: number; advance: number; planeBounds?: AtlasBounds; atlasBounds?: AtlasBounds }
export interface AtlasMetadata {
  atlas: { type: AtlasType; distanceRange?: number; distanceRangeMiddle?: number; size: number; width: number; height: number; yOrigin: "top" | "bottom" };
  metrics: { emSize: number; lineHeight: number; ascender: number; descender: number; underlineY: number; underlineThickness: number };
  glyphs: AtlasGlyph[];
  kerning: Array<{ unicode1: number; unicode2: number; advance: number }>;
}
export interface AtlasResult { png: Uint8Array; metadata: AtlasMetadata; width: number; height: number }
export interface MsdfAtlasGenerator { getCharset(font: Uint8Array): Promise<string>; generate(font: Uint8Array, options?: GenerateAtlasOptions): Promise<AtlasResult>; destroy(): void }
export interface CreateGeneratorOptions { workerUrl?: string | URL }
export declare function createMsdfAtlasGenerator(config?: CreateGeneratorOptions): Promise<MsdfAtlasGenerator>;
