import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { extname } from "node:path";
import { PNG } from "pngjs";

const UNSUPPORTED_OPTIONS = new Set(["-emrange", "-aemrange", "-apxrange", "-arfont", "-shadronpreview"]);
const REPLACED_OPTIONS = new Set(["-pxrange", "-effectpxrange", "-format", "-imageout", "-json"]);
const helpText = (defaults) => `
Extended MTSDF mode:
  -type mtsdfx
      Generates PNG with separate RGB and alpha distance ranges.
  -pxrange <range>
      RGB distance range in pixels (default: ${defaults.pxRange}).
  -effectpxrange <range>
      Alpha/effect distance range in pixels (default: ${defaults.effectPxRange(defaults.size, defaults.pxRange)} at the default size and RGB range).
      Computed using the configured effectPxRange function in cli/main.mjs.
      Uses -size, or -minsize when supplied without -size, otherwise ${defaults.size}.
      Both ranges must be positive. Only symmetric pixel ranges are supported.
      Outputs: PNG (-imageout), JSON (-json), CSV (-csv).
      JSON uses type "mtsdfx" and adds effectDistanceRange.
      Default size: ${defaults.size} pixels per em. Default characters: ${defaults.chars}.
      Missing PNG/JSON paths replace the font extension with ${defaults.imageExtension}/${defaults.jsonExtension}.
      Artery Font and Shadron exports are not supported in this mode.`;

export function prepareMtsdfx(arguments_, optionArity, defaults) {
  const entries = [];
  for (let index = 0; index < arguments_.length;) {
    const argument = arguments_[index];
    const option = argument.startsWith("--") ? argument.slice(1) : argument;
    const arity = optionArity.get(option) ?? 0;
    const complete = index + arity < arguments_.length;
    const args = arguments_.slice(index, index + (complete ? arity + 1 : 1));
    entries.push({ option, args, complete });
    index += args.length;
  }
  const options = new Map(entries.map(({ option, args }) => [option, args[1]]));

  const extended = options.get("-type") === "mtsdfx";
  // Translate mtsdfx even when a later -type selects an official mode.
  for (const entry of entries) {
    if (entry.option === "-type" && entry.args[1] === "mtsdfx") entry.args[1] = "mtsdf";
  }
  if (!extended) {
    if (options.has("-effectpxrange")) throw new Error("-effectpxrange requires -type mtsdfx.");
    return { arguments: entries.flatMap((entry) => entry.args), extended: false };
  }

  const information = entries.find(({ option, args }) => option === "-help" || option === "-version"
    || (option === "-errorcorrection" && args[1] === "help"));
  if (information) {
    return {
      arguments: entries.filter((entry) => entry.option !== "-effectpxrange").flatMap((entry) => entry.args),
      extended: true,
      informationOnly: true,
      help: information.option === "-help" ? helpText(defaults) : undefined,
    };
  }

  for (const { option, complete } of entries) {
    if (!complete) throw new Error(`Missing parameters for ${option}.`);
    if (UNSUPPORTED_OPTIONS.has(option)) throw new Error(`${option} is not supported with -type mtsdfx; use symmetric pixel ranges and PNG/JSON/CSV outputs.`);
  }
  for (const option of ["-imageout", "-json"]) {
    if (options.has(option) && !options.get(option)) throw new Error(`${option} requires a non-empty output path.`);
  }
  const pxRange = options.has("-pxrange") ? Number(options.get("-pxrange")) : defaults.pxRange;
  const size = Number(options.get("-size") ?? options.get("-minsize") ?? defaults.size);
  const effectPxRange = options.has("-effectpxrange")
    ? Number(options.get("-effectpxrange"))
    : defaults.effectPxRange(size, pxRange);
  if (!Number.isFinite(pxRange) || pxRange <= 0) throw new Error("-pxrange must be a positive finite number for mtsdfx.");
  if (!Number.isFinite(effectPxRange) || effectPxRange <= 0) throw new Error("-effectpxrange must be a positive finite number.");
  if (effectPxRange < pxRange) throw new Error("-effectpxrange must be greater than or equal to -pxrange.");
  const format = options.get("-format");
  const imagePath = options.get("-imageout");
  if (options.has("-format") && format !== "png") throw new Error("mtsdfx supports only -format png.");
  if (imagePath && !format && extname(imagePath).toLowerCase() !== ".png") {
    throw new Error("mtsdfx requires a .png output filename or explicit -format png.");
  }

  return {
    arguments: [
      ...entries.filter((entry) => !REPLACED_OPTIONS.has(entry.option)).flatMap((entry) => entry.args),
      "-pxrange", String(effectPxRange),
    ],
    extended: true,
    imagePath,
    jsonPath: options.get("-json"),
    pxRange,
    effectPxRange,
  };
}

export function runMtsdfx(Module, arguments_, options, convertJson) {
  if (options.informationOnly || !(options.imagePath || options.jsonPath)) {
    const status = Module.callMain(arguments_);
    if (options.help && status === 0) process.stdout.write(`${options.help}\n`);
    return status;
  }

  // Keep the float atlas in MEMFS; only the finished PNG/JSON reach the host.
  const temporary = `/__mtsdfx_${randomUUID()}__`;
  const imagePath = `${temporary}/atlas.bin`;
  const jsonPath = `${temporary}/atlas.json`;
  Module.FS.mkdir(temporary);
  try {
    let status = Module.callMain([
      ...arguments_, "-format", "binfloat", "-json", jsonPath,
      ...(options.imagePath ? ["-imageout", imagePath] : []),
    ]);
    // A failed CSV export can coexist with a successfully generated atlas.
    if (status !== 0 && !Module.FS.analyzePath(jsonPath).exists) return status;

    const metadata = JSON.parse(Module.FS.readFile(jsonPath, { encoding: "utf8" }));
    const { width, height, yOrigin } = metadata.atlas;
    const outputs = [];
    if (options.imagePath) {
      const floats = Buffer.from(Module.FS.readFile(imagePath));
      if (floats.length !== width * height * 4 * Float32Array.BYTES_PER_ELEMENT) {
        throw new Error("Invalid MTSDF float atlas dimensions.");
      }
      const png = new PNG({ width, height });
      const rangeScale = options.effectPxRange / options.pxRange;
      for (let y = 0; y < height; y++) {
        const pngY = yOrigin === "bottom" ? height - y - 1 : y;
        for (let x = 0; x < width; x++) {
          const source = (y * width + x) * 4;
          const target = (pngY * width + x) * 4;
          for (let channel = 0; channel < 4; channel++) {
            const value = floats.readFloatLE((source + channel) * 4);
            const scaled = channel < 3 ? (value - 0.5) * rangeScale + 0.5 : value;
            png.data[target + channel] = Math.round(Math.min(Math.max(scaled, 0), 1) * 255);
          }
        }
      }
      outputs.push({ path: options.imagePath, data: PNG.sync.write(png), message: "Atlas image file saved." });
    }
    if (options.jsonPath) {
      convertJson(metadata);
      metadata.atlas.type = "mtsdfx";
      metadata.atlas.distanceRange = options.pxRange;
      metadata.atlas.effectDistanceRange = options.effectPxRange;
      outputs.push({ path: options.jsonPath, data: JSON.stringify(metadata), message: "Glyph layout and metadata written into JSON file." });
    }
    for (const { path, data, message } of outputs) {
      try {
        writeFileSync(path, data);
        process.stderr.write(`${message}\n`);
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        status = 1;
      }
    }
    return status;
  } finally {
    for (const name of Module.FS.readdir(temporary)) {
      if (name !== "." && name !== "..") Module.FS.unlink(`${temporary}/${name}`);
    }
    Module.FS.rmdir(temporary);
  }
}
