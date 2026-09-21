#!/usr/bin/env node

import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, parse } from "node:path";
import createModule from "../dist/msdf-atlas.js";

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
// Operand counts only keep path discovery aligned; C++ still parses and validates every option.
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
const mirroredPosixRoots = new Set();

function officialOption(argument) {
  return argument.startsWith("--") ? argument.slice(1) : argument;
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

const cliArguments = process.argv.slice(2);

const Module = await createModule({
  print: (line) => process.stdout.write(`${line}\n`),
  printErr: (line) => process.stderr.write(`${line}\n`),
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

process.exitCode = Module.callMain(translateArguments(cliArguments));
