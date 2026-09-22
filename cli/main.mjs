#!/usr/bin/env node

import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, parse, resolve } from "node:path";
import createModule from "../dist/msdf-atlas.js";
import { prepareMtsdfx, runMtsdfx } from "./mtsdfx.mjs";
import { convertJsonToUnicode, getJsonInputs } from "./unicode-json.mjs";

// Edit CLI defaults here. Explicit command-line options take precedence.
const DEFAULTS = {
  type: "mtsdfx",
  size: 64,
  pxRange: 16,
  chars: "[0x20, 0x7e]",
  imageExtension: ".png",
  jsonExtension: ".json",
  effectPxRange: (size, pxRange) => Math.max(size / 2, pxRange),
};

const HOST_MOUNT = "/__msdf_atlas_host__";
const PATH_ARGUMENTS = new Set([
  "-font",
  "-varfont",
  "-charset",
  "-glyphset",
  "-arfont",
  "-imageout",
  "-json",
  "-csv",
  "-shadronpreview",
]);
// Operand counts align path discovery and the extension; C++ parses official options.
const OPTION_ARITY = new Map();
for (const option of "-allglyphs -and -printvaraxes -pots -potr -square -square2 -square4 -uniformgrid -nokerning -kerning -nopreprocess -preprocess -nooverlap -overlap -noscanline -scanline -version -help".split(" ")) {
  OPTION_ARITY.set(option, 0);
}
for (const option of "-type -format -font -varfont -charset -glyphset -chars -glyphs -fontscale -fontname -arfont -imageout -json -csv -yorigin -size -minsize -emrange -pxrange -pxalign -empadding -pxpadding -outerempadding -outerpxpadding -angle -uniformcols -uniformcellconstraint -uniformorigin -errorcorrection -errordeviationratio -errorimproveratio -coloringstrategy -edgecoloring -miterlimit -seed -threads".split(" ")) {
  OPTION_ARITY.set(option, 1);
}
for (const option of "-shadronpreview -dimensions -aemrange -apxrange -uniformcell".split(" ")) {
  OPTION_ARITY.set(option, 2);
}
for (const option of "-aempadding -apxpadding -aouterempadding -aouterpxpadding".split(" ")) {
  OPTION_ARITY.set(option, 4);
}
OPTION_ARITY.set("-effectpxrange", 1);
const mirroredPosixRoots = new Set();

function officialOption(argument) {
  return argument.startsWith("--") ? argument.slice(1) : argument;
}

function applyDefaults(arguments_) {
  if (!arguments_.length) return arguments_;
  const options = new Map();
  let fontPath;
  for (let index = 0; index < arguments_.length; index++) {
    const option = officialOption(arguments_[index]);
    const value = arguments_[index + 1];
    if (["-help", "-version", "-printvaraxes"].includes(option)
      || (option === "-errorcorrection" && value === "help")) return arguments_;
    options.set(option, value);
    if (option === "-font" || option === "-varfont") {
      fontPath = value === undefined ? undefined : splitVariableFontSuffix(value, option)[0];
    }
    index += OPTION_ARITY.get(option) ?? 0;
  }

  const defaults = [];
  if (!options.has("-type")) defaults.push("-type", DEFAULTS.type);
  if (!options.has("-size") && !options.has("-minsize")) defaults.push("-size", String(DEFAULTS.size));
  if (!["-pxrange", "-emrange", "-aemrange", "-apxrange"].some((option) => options.has(option))) {
    defaults.push("-pxrange", String(DEFAULTS.pxRange));
  }
  if (!["-charset", "-chars", "-glyphset", "-glyphs", "-allglyphs"].some((option) => options.has(option))) {
    defaults.push("-chars", DEFAULTS.chars);
  }
  if (fontPath) {
    const extension = extname(fontPath);
    const base = extension ? fontPath.slice(0, -extension.length) : fontPath;
    if (!options.has("-imageout")) defaults.push("-imageout", `${base}${DEFAULTS.imageExtension}`);
    if (!options.has("-json")) defaults.push("-json", `${base}${DEFAULTS.jsonExtension}`);
  }
  // Prepend defaults so a missing trailing operand remains an error.
  return [...defaults, ...arguments_];
}

function splitVariableFontSuffix(argument, option) {
  if (option !== "-varfont") return [argument, ""];
  const suffixStart = argument.indexOf("?");
  if (suffixStart < 0) return [argument, ""];
  return [argument.slice(0, suffixStart), argument.slice(suffixStart)];
}

function posixMountRoot(hostPath) {
  const parent = dirname(hostPath);
  if (parent === "/") return null;
  return `/${parent.slice(1).split("/")[0]}`;
}

function windowsMountPoint(hostPath) {
  const root = parse(hostPath).root;
  const key = root.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "root";
  return `${HOST_MOUNT}/${key}`;
}

function virtualAbsolutePath(hostPath) {
  if (process.platform === "win32") {
    const root = parse(hostPath).root;
    const relativePath = hostPath.slice(root.length).replaceAll("\\", "/");
    return `${windowsMountPoint(hostPath)}/${relativePath}`;
  }
  return `${HOST_MOUNT}${hostPath}`;
}

function translatePath(argument, option) {
  const [filename, suffix] = splitVariableFontSuffix(argument, option);
  if (!isAbsolute(filename)) return argument;
  if (process.platform !== "win32" && mirroredPosixRoots.has(posixMountRoot(filename))) return argument;
  return `${virtualAbsolutePath(filename)}${suffix}`;
}

function visitPathArguments(arguments_, visitor) {
  for (let index = 0; index < arguments_.length; index++) {
    const option = officialOption(arguments_[index]);
    const arity = OPTION_ARITY.get(option);
    if (arity === undefined || index + arity >= arguments_.length) continue;
    if (PATH_ARGUMENTS.has(option)) {
      visitor(arguments_[index + 1], option, index + 1);
    }
    index += arity;
  }
}

function translateArguments(arguments_) {
  const translated = [...arguments_];
  visitPathArguments(translated, (argument, option, index) => {
    translated[index] = translatePath(argument, option);
  });
  return translated;
}

function absolutePathArguments(arguments_) {
  const paths = [];
  visitPathArguments(arguments_, (argument, option) => {
    const [filename] = splitVariableFontSuffix(argument, option);
    if (isAbsolute(filename)) paths.push(filename);
  });
  return paths;
}

function ensureDirectory(FS, path) {
  if (!FS.analyzePath(path).exists) FS.mkdir(path);
}

function printGenerationParameters(arguments_, options) {
  const suppliedOptions = new Set();
  for (let index = 0; index < arguments_.length; index++) {
    const option = officialOption(arguments_[index]);
    if (["-help", "-version", "-printvaraxes"].includes(option)
      || (option === "-errorcorrection" && arguments_[index + 1] === "help")) return;
    suppliedOptions.add(option);
    index += OPTION_ARITY.get(option) ?? 0;
  }
  if (!suppliedOptions.has("-font") && !suppliedOptions.has("-varfont")) return;

  // Describe the public CLI parameters before internal MTSDF/WASM translation.
  const parameters = [...arguments_];
  if (options.extended) {
    if (!suppliedOptions.has("-effectpxrange")) parameters.push("-effectpxrange", String(options.effectPxRange));
    if (!suppliedOptions.has("-format")) parameters.push("-format", "png");
  }
  visitPathArguments(parameters, (argument, option, index) => {
    const [filename, suffix] = splitVariableFontSuffix(argument, option);
    parameters[index] = `${resolve(filename)}${suffix}`;
  });
  const formatArgument = (argument) => /^[a-zA-Z0-9_./:=+-]+$/.test(argument) ? argument : JSON.stringify(argument);
  let rows = [];
  for (let index = 0; index < parameters.length; index++) {
    const option = officialOption(parameters[index]);
    const arity = OPTION_ARITY.get(option) ?? 0;
    rows.push({
      option,
      label: formatArgument(parameters[index]),
      value: parameters.slice(index + 1, index + arity + 1).map(formatArgument).join(" "),
    });
    index += arity;
  }
  if (rows.some(({ option }) => option === "-pxrange")) {
    const effectRows = rows.filter(({ option }) => option === "-effectpxrange");
    rows = rows.filter(({ option }) => option !== "-effectpxrange");
    const rangeIndex = rows.findLastIndex(({ option }) => option === "-pxrange");
    rows.splice(rangeIndex + 1, 0, ...effectRows);
  }
  const useColor = process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== "0"
    && (process.env.FORCE_COLOR !== undefined || (process.stderr.isTTY && process.env.TERM !== "dumb"));
  const color = (text, code) => useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
  const labelWidth = Math.max(...rows.map(({ label }) => label.length));
  const lines = rows.map(({ label, value }) => {
    const formattedLabel = color(label.padEnd(labelWidth), "36");
    return value ? `  ${formattedLabel}  ${value}` : `  ${color(label, "36")}`;
  });
  process.stderr.write(`${color("Atlas parameters:", "1;36")}\n${lines.join("\n")}\n\n`);
}

const inputArguments = process.argv.slice(2);
// A leading font path is shorthand for -font; option operands stay untouched.
if (inputArguments.length && !inputArguments[0].startsWith("-")) inputArguments.unshift("-font");
const cliArguments = applyDefaults(inputArguments);
const jsonInputs = getJsonInputs(cliArguments, OPTION_ARITY);
let jsonWritten = false;
let options;
try {
  options = prepareMtsdfx(cliArguments, OPTION_ARITY, DEFAULTS);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

const Module = await createModule({
  print: (line) => process.stdout.write(`${line}\n`),
  printErr: (line) => {
    if (line === "Glyph layout and metadata written into JSON file.") jsonWritten = true;
    if (options.extended && !options.informationOnly && (options.imagePath || options.jsonPath)
      && (line === "Atlas image file saved." || line === "Glyph layout and metadata written into JSON file.")) return;
    process.stderr.write(`${line}\n`);
  },
});

ensureDirectory(Module.FS, HOST_MOUNT);

if (process.platform === "win32") {
  const hostPaths = [process.cwd(), ...absolutePathArguments(cliArguments)];
  const mountedRoots = new Set();
  for (const hostPath of hostPaths) {
    const root = parse(hostPath).root;
    if (mountedRoots.has(root)) continue;
    mountedRoots.add(root);
    const mountPoint = windowsMountPoint(hostPath);
    ensureDirectory(Module.FS, mountPoint);
    Module.FS.mount(Module.NODEFS, { root }, mountPoint);
  }
  Module.FS.chdir(virtualAbsolutePath(process.cwd()));
} else {
  Module.FS.mount(Module.NODEFS, { root: "/" }, HOST_MOUNT);
  const mountRoots = new Set([
    posixMountRoot(`${process.cwd()}/.`),
    ...absolutePathArguments(cliArguments).map(posixMountRoot),
  ]);
  mountRoots.delete(null);
  for (const mountRoot of mountRoots) {
    if (mountRoot === HOST_MOUNT) continue;
    let realMountRoot;
    try {
      realMountRoot = realpathSync(mountRoot);
      if (!statSync(realMountRoot).isDirectory()) continue;
    } catch {
      continue;
    }
    ensureDirectory(Module.FS, mountRoot);
    Module.FS.mount(Module.NODEFS, { root: realMountRoot }, mountRoot);
    mirroredPosixRoots.add(mountRoot);
  }
  Module.FS.chdir(mirroredPosixRoots.has(posixMountRoot(`${process.cwd()}/.`)) ? process.cwd() : virtualAbsolutePath(process.cwd()));
}

try {
  printGenerationParameters(cliArguments, options);
  const arguments_ = translateArguments(options.arguments);
  if (options.extended) {
    process.exitCode = runMtsdfx(Module, arguments_, options, (metadata) => convertJsonToUnicode(Module, metadata, jsonInputs.fonts));
  } else {
    process.exitCode = Module.callMain(arguments_);
    if (jsonWritten) {
      const metadata = JSON.parse(readFileSync(jsonInputs.jsonPath, "utf8"));
      if (convertJsonToUnicode(Module, metadata, jsonInputs.fonts)) {
        writeFileSync(jsonInputs.jsonPath, `${JSON.stringify(metadata)}\n`);
      }
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
