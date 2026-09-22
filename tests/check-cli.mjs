import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import createModule from "../dist/msdf-atlas.js";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testsDirectory, "..");
const cli = join(root, "cli/main.mjs");
const nativeCli = resolve(process.env.MSDF_NATIVE_CLI || join(root, ".wasm-deps/native-reference/bin/msdf-atlas-gen"));
const fixtures = join(testsDirectory, "reference/fixtures");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 128,
    stdout: result.stdout || Buffer.alloc(0),
    stderr: result.stderr || Buffer.alloc(0),
  };
}

async function removeOutputs(paths) {
  await Promise.all(paths.map((path) => rm(path, { force: true })));
}

function generationParameters(stderr) {
  const match = stderr.toString().match(/^Atlas parameters:\n((?:  [^\n]*\n)+)\n/);
  assert.ok(match, "formatted generation parameters are present");
  return match[1].trim().split("\n").map((line) => line.trim().replace(/^(\S+) {2,}/, "$1 ")).join(" ");
}

async function compareCase(name, args, cwd, { outputs = [], status, captureOutputs = false } = {}) {
  // Native comparisons select an official mode and explicit outputs. Defaults
  // specific to the Node CLI are checked separately below.
  if (args.length && !args.some((arg) => ["--help", "--version"].includes(arg))) {
    args = [
      "-type", "msdf", "-size", "64", "-pxrange", "16",
      "-imageout", join(cwd, "comparison.png"), "-json", join(cwd, "comparison.json"),
      ...args,
    ];
  }
  await removeOutputs(outputs);
  const reference = run(nativeCli, args, cwd);
  const referenceOutputs = captureOutputs ? new Map(await Promise.all(outputs.map(async (path) => [path, await readFile(path)]))) : new Map();
  await removeOutputs(outputs);
  const wasm = run(process.execPath, [cli, ...args], cwd);

  assert.equal(wasm.status, reference.status, `${name}: exit code`);
  assert.deepEqual(wasm.stdout, reference.stdout, `${name}: stdout bytes`);
  const stderr = wasm.stderr.toString();
  if (args.length && !args.some((arg) => ["--help", "--version"].includes(arg))) {
    assert.match(stderr, /^Atlas parameters:\n/, `${name}: parameters printed before generation`);
  } else {
    assert.doesNotMatch(stderr, /Atlas parameters:/, `${name}: informational command has no generation parameters`);
  }
  assert.deepEqual(Buffer.from(stderr.replace(/^Atlas parameters:\n(?:  [^\n]*\n)+\n/, "")), reference.stderr, `${name}: generator stderr bytes`);
  if (status !== undefined) assert.equal(wasm.status, status, `${name}: expected exit code`);
  if (wasm.stdout.length) assert.equal(wasm.stdout.at(-1), 0x0a, `${name}: stdout final newline`);
  if (wasm.stderr.length) assert.equal(wasm.stderr.at(-1), 0x0a, `${name}: stderr final newline`);
  return { ...wasm, referenceOutputs };
}

function roundedMetadata(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "number" ? Number(item.toPrecision(14)) : item));
}

function assertUnicodeGlyphs(font, name) {
  assert.ok(font.glyphs.every((glyph) => Number.isInteger(glyph.unicode) && !("index" in glyph)), `${name}: Unicode identifiers only`);
  const codepoints = font.glyphs.map((glyph) => glyph.unicode);
  assert.deepEqual(codepoints, [...new Set(codepoints)].sort((left, right) => left - right), `${name}: unique ascending Unicode codepoints`);
}

function assertMappedGlyphs(font, reference, mappings, name) {
  assertUnicodeGlyphs(font, name);
  for (const [unicode, index] of mappings) {
    const original = reference.glyphs.find((glyph) => glyph.index === index);
    assert.ok(original, `${name}: native glyph ${index} exists`);
    const { index: _index, ...geometry } = original;
    assert.deepEqual(
      roundedMetadata(font.glyphs.find((glyph) => glyph.unicode === unicode)),
      roundedMetadata({ ...geometry, unicode }),
      `${name}: U+${unicode.toString(16)} preserves glyph ${index} geometry`,
    );
  }
}

await stat(nativeCli).catch(() => {
  throw new Error(`Native reference CLI not found: ${nativeCli}\nRun npm run build:reference first.`);
});
assert.ok((await stat(cli)).mode & 0o100, "CLI must be executable");

const temporary = await realpath(await mkdtemp(join(tmpdir(), "msdf-atlas-cli-")));
try {
  const fontDirectory = join(temporary, "fuentes con espacio Ω");
  const outputDirectory = join(temporary, "salida con espacio 漢");
  await mkdir(fontDirectory);
  await mkdir(outputDirectory);

  const regular = join(fontDirectory, "Lato Regular Ω.ttf");
  const bold = join(fontDirectory, "Lato Bold 漢.ttf");
  const variable = join(fontDirectory, "Roboto Variable Ω.ttf");
  const charset = join(fontDirectory, "caracteres Ω.txt");
  const glyphset = join(fontDirectory, "glifos 漢.txt");
  await Promise.all([
    copyFile(join(fixtures, "Lato-Regular.ttf"), regular),
    copyFile(join(fixtures, "Lato-Bold.ttf"), bold),
    copyFile(join(fixtures, "Roboto-Variable.ttf"), variable),
    writeFile(charset, "[0x41, 0x43]\n"),
    copyFile(join(fixtures, "glyphset.txt"), glyphset),
  ]);

  const defaultPng = regular.replace(/\.ttf$/, ".png");
  const defaultJson = regular.replace(/\.ttf$/, ".json");
  const explicitPng = join(outputDirectory, "explicit.png");
  const explicitJson = join(outputDirectory, "explicit.json");
  const defaultResult = run(process.execPath, [cli, "-font", regular], temporary);
  assert.equal(defaultResult.status, 0, defaultResult.stderr.toString());
  const defaultParameters = generationParameters(defaultResult.stderr);
  for (const parameter of [
    "-type mtsdfx", "-size 32", "-pxrange 8", "-effectpxrange 16", "-format png",
    '-chars "[0x20, 0x7e]"', `-font ${JSON.stringify(regular)}`,
    `-imageout ${JSON.stringify(defaultPng)}`, `-json ${JSON.stringify(defaultJson)}`,
  ]) {
    assert.ok(defaultParameters.includes(parameter), `default parameter printed: ${parameter}`);
  }
  assert.doesNotMatch(defaultParameters, /__msdf_atlas_host__|__mtsdfx_/, "parameters use host paths");
  const defaultMetadata = JSON.parse(await readFile(defaultJson, "utf8"));
  assert.equal(defaultMetadata.atlas.type, "mtsdfx");
  assert.equal(defaultMetadata.atlas.size, 32);
  assert.equal(defaultMetadata.atlas.distanceRange, 8);
  assert.equal(defaultMetadata.atlas.effectDistanceRange, 16);
  const explicitResult = run(process.execPath, [
    cli, "-font", regular, "-type", "mtsdfx", "-size", "32", "-pxrange", "8",
    "-effectpxrange", "16",
    "-imageout", explicitPng, "-json", explicitJson,
  ], temporary);
  assert.equal(explicitResult.status, 0, explicitResult.stderr.toString());
  assert.deepEqual(await readFile(defaultPng), await readFile(explicitPng), "default PNG matches explicit configuration");
  assert.deepEqual(JSON.parse(await readFile(explicitJson, "utf8")), defaultMetadata, "default JSON matches explicit configuration");

  for (const fontPath of [regular, "fuentes con espacio Ω/Lato Regular Ω.ttf"]) {
    await removeOutputs([defaultPng, defaultJson]);
    const result = run(process.execPath, [cli, fontPath], temporary);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(generationParameters(result.stderr), defaultParameters, "positional and relative paths print the same resolved parameters");
    assert.deepEqual(await readFile(defaultPng), await readFile(explicitPng), "positional font PNG matches -font");
    assert.deepEqual(JSON.parse(await readFile(defaultJson, "utf8")), defaultMetadata, "positional font JSON matches -font");
  }

  for (const override of ["imageout", "json"]) {
    await removeOutputs([defaultPng, defaultJson, explicitPng, explicitJson]);
    const result = run(process.execPath, [
      cli, ...(override === "imageout" ? [] : ["--font"]), "fuentes con espacio Ω/Lato Regular Ω.ttf", "--chars", "65",
      "--type", "sdf", "--size", "24", "--pxrange", "4", "--fontname", "-json",
      `--${override}`, override === "imageout" ? explicitPng : explicitJson,
    ], temporary);
    assert.equal(result.status, 0, result.stderr.toString());
    const parameters = generationParameters(result.stderr);
    for (const parameter of [
      "--type sdf", "--size 24", "--pxrange 4", "--chars 65",
      `${override === "imageout" ? "--" : "-"}imageout ${JSON.stringify(override === "imageout" ? explicitPng : defaultPng)}`,
      `${override === "json" ? "--" : "-"}json ${JSON.stringify(override === "json" ? explicitJson : defaultJson)}`,
    ]) {
      assert.ok(parameters.includes(parameter), `explicit parameter printed: ${parameter}`);
    }
    assert.doesNotMatch(parameters, /-chars "\[0x20, 0x7e\]"|-effectpxrange|-type mtsdfx/, "overridden defaults are not printed");
    const metadata = JSON.parse(await readFile(override === "json" ? explicitJson : defaultJson, "utf8"));
    assert.equal(metadata.atlas.type, "sdf", "explicit type retained");
    assert.equal(metadata.atlas.size, 24, "explicit size retained");
    assert.equal(metadata.atlas.distanceRange, 4, "explicit range retained");
    assert.ok(PNG.sync.read(await readFile(override === "imageout" ? explicitPng : defaultPng)).width > 0);
    await assert.rejects(stat(override === "imageout" ? defaultPng : defaultJson), { code: "ENOENT" });
  }

  await compareCase("help alias", ["--help"], temporary, { status: 0 });
  await compareCase("version alias", ["--version"], temporary, { status: 0 });
  await compareCase("no arguments", [], temporary, { status: 0 });
  await compareCase("invalid arguments", ["--font", regular, "--type", "not-an-atlas-type"], temporary, { status: 1 });
  await compareCase("unsupported allchars option", ["-font", regular, "-allchars"], temporary);
  await compareCase("missing input", ["-font", "missing-font.ttf", "-size", "24", "-imageout", "missing.png"], temporary, { status: 1 });
  await compareCase(
    "write failure",
    ["-font", regular, "-chars", "65", "-size", "24", "-imageout", "missing-directory/atlas.png"],
    temporary,
    { status: 1 },
  );

  const relativeOutputs = [
    join(outputDirectory, "atlas Ω.png"),
    join(outputDirectory, "atlas Ω.json"),
    join(outputDirectory, "atlas Ω.csv"),
    join(outputDirectory, "atlas Ω.arfont"),
    join(outputDirectory, "atlas Ω.shadron"),
  ];
  await compareCase(
    "relative paths and official aliases",
    [
      "--font", "fuentes con espacio Ω/Lato Regular Ω.ttf",
      "--charset", "fuentes con espacio Ω/caracteres Ω.txt",
      "--type", "sdf",
      "--size", "24",
      "--imageout", "salida con espacio 漢/atlas Ω.png",
      "--json", "salida con espacio 漢/atlas Ω.json",
      "--csv", "salida con espacio 漢/atlas Ω.csv",
      "--arfont", "salida con espacio 漢/atlas Ω.arfont",
      "--shadronpreview", "salida con espacio 漢/atlas Ω.shadron", "ABC",
      "--threads", "8",
    ],
    temporary,
    { outputs: relativeOutputs, status: 0 },
  );

  const [png, json, csv, arfont, shadron] = await Promise.all(relativeOutputs.map((path) => readFile(path)));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "PNG signature");
  assert.doesNotThrow(() => JSON.parse(json.toString()), "JSON output");
  assert.ok(csv.length > 0, "CSV output");
  assert.ok(arfont.length > 100, "Artery Font output");
  assert.ok(shadron.length > 0, "Shadron output");

  const absolutePng = join(outputDirectory, "variable absolute.png");
  const absoluteJson = join(outputDirectory, "variable absolute.json");
  const variableResult = await compareCase(
    "absolute varfont and glyphset paths",
    [
      "--varfont", `${variable}?wdth=75&wght=700`,
      "--glyphset", glyphset,
      "--type", "sdf",
      "--size", "24",
      "--imageout", absolutePng,
      "--json", absoluteJson,
      "--threads", "1",
    ],
    temporary,
    { outputs: [absolutePng, absoluteJson], status: 0, captureOutputs: true },
  );
  const absoluteJsonBytes = await readFile(absoluteJson);
  const variableMetadata = JSON.parse(absoluteJsonBytes.toString());
  const variableMappings = [[0, 1], [2, 2], [13, 3], ...Array.from({ length: 9 }, (_unused, index) => [32 + index, 4 + index])];
  assertMappedGlyphs(variableMetadata, JSON.parse(variableResult.referenceOutputs.get(absoluteJson)), variableMappings, "variable glyphset");
  assert.deepEqual(variableMetadata.glyphs.map((glyph) => glyph.unicode), variableMappings.map(([unicode]) => unicode), "variable glyphset preserves selection");

  const optionBoundaryJson = join(outputDirectory, "option boundary.json");
  await compareCase(
    "option-like non-path value",
    [
      "-fontname", "-font",
      "-font", regular,
      "-chars", "65",
      "-size", "24",
      "-json", optionBoundaryJson,
      "-threads", "1",
    ],
    temporary,
    { outputs: [optionBoundaryJson], status: 0 },
  );

  const multipleJson = join(outputDirectory, "multiple absolute.json");
  await compareCase(
    "multiple absolute fonts and partial messages",
    [
      "-font", regular,
      "-fontname", "regular",
      "-chars", "65",
      "-and",
      "-font", bold,
      "-fontname", "bold",
      "-chars", "66",
      "-size", "24",
      "-json", multipleJson,
      "-threads", "1",
    ],
    temporary,
    { outputs: [multipleJson], status: 0 },
  );

  const allGlyphsJson = join(outputDirectory, "all glyph Unicode.json");
  const allGlyphsPng = join(outputDirectory, "all glyph Unicode.png");
  const allGlyphsResult = await compareCase(
    "allglyphs Unicode JSON with native packing",
    [
      "-font", join(fixtures, "ChangaOne.ttf"),
      "-allglyphs",
      "-type", "mtsdf",
      "-size", "16",
      "-json", allGlyphsJson,
      "-imageout", allGlyphsPng,
      "-threads", "1",
    ],
    temporary,
    { outputs: [allGlyphsJson, allGlyphsPng], status: 0, captureOutputs: true },
  );
  const allGlyphs = JSON.parse(await readFile(allGlyphsJson, "utf8"));
  const nativeAllGlyphs = JSON.parse(allGlyphsResult.referenceOutputs.get(allGlyphsJson));
  assert.equal(nativeAllGlyphs.glyphs.length, 245, "native allglyphs packs all 245 glyphs");
  assert.equal(allGlyphs.glyphs.length, 242, "allglyphs exports 242 mapped Unicode characters");
  assertMappedGlyphs(allGlyphs, nativeAllGlyphs, [[32, 3], [65, 36], [193, 128], [225, 160], [241, 176]], "Changa allglyphs");
  assert.equal(allGlyphs.glyphs.some((glyph) => glyph.unicode === 0), false, "unmapped glyphs do not invent U+0000");
  assert.deepEqual(allGlyphs.atlas, nativeAllGlyphs.atlas, "allglyphs atlas packing metadata is unchanged");
  const allGlyphsImage = PNG.sync.read(await readFile(allGlyphsPng));
  const nativeAllGlyphsImage = PNG.sync.read(allGlyphsResult.referenceOutputs.get(allGlyphsPng));
  assert.equal(allGlyphsImage.width, nativeAllGlyphsImage.width, "allglyphs PNG width is unchanged");
  assert.equal(allGlyphsImage.height, nativeAllGlyphsImage.height, "allglyphs PNG height is unchanged");
  assert.deepEqual(allGlyphsImage.data, nativeAllGlyphsImage.data, "allglyphs PNG pixels are unchanged");

  const aliasJson = join(outputDirectory, "glyph aliases.json");
  const aliasResult = await compareCase(
    "glyph selection with aliases and U+0000",
    ["-font", regular, "-glyphs", "0,1,2,3,40,330", "-size", "16", "-json", aliasJson, "-threads", "1"],
    temporary,
    { outputs: [aliasJson], status: 0, captureOutputs: true },
  );
  const aliasMetadata = JSON.parse(await readFile(aliasJson, "utf8"));
  const aliasMappings = [[0, 1], [32, 2], [45, 330], [65, 3], [86, 40], [160, 2], [173, 330], [8208, 330]];
  assertMappedGlyphs(aliasMetadata, JSON.parse(aliasResult.referenceOutputs.get(aliasJson)), aliasMappings, "Lato aliases");
  assert.deepEqual(aliasMetadata.glyphs.map((glyph) => glyph.unicode), aliasMappings.map(([unicode]) => unicode), "all real aliases are exported and unmapped index zero is omitted");

  const indexedMultipleJson = join(outputDirectory, "multiple cmap.json");
  const indexedMultipleResult = await compareCase(
    "indexed selection inherits across different fonts",
    [
      "-font", join(fixtures, "ChangaOne.ttf"), "-fontname", "changa", "-glyphs", "3,36",
      "-and", "-font", regular, "-fontname", "lato", "-size", "16", "-json", indexedMultipleJson, "-threads", "1",
    ],
    temporary,
    { outputs: [indexedMultipleJson], status: 0, captureOutputs: true },
  );
  const indexedMultiple = JSON.parse(await readFile(indexedMultipleJson, "utf8"));
  const nativeIndexedMultiple = JSON.parse(indexedMultipleResult.referenceOutputs.get(indexedMultipleJson));
  assert.equal(indexedMultiple.variants.length, 2, "two font variants retained");
  for (const [index, mappings] of [[[32, 3], [65, 36]], [[65, 3], [84, 36]]].entries()) {
    assertMappedGlyphs(indexedMultiple.variants[index], nativeIndexedMultiple.variants[index], mappings, `variant ${index}`);
    assert.deepEqual(indexedMultiple.variants[index].glyphs.map((glyph) => glyph.unicode), mappings.map(([unicode]) => unicode), "each variant uses its own cmap");
  }

  const trailingJson = join(outputDirectory, "trailing and.json");
  await compareCase(
    "trailing and preserves one converted font",
    ["-font", join(fixtures, "ChangaOne.ttf"), "-allglyphs", "-and", "-size", "16", "-json", trailingJson, "-threads", "1"],
    temporary,
    { outputs: [trailingJson], status: 0 },
  );
  const trailingMetadata = JSON.parse(await readFile(trailingJson, "utf8"));
  assert.equal("variants" in trailingMetadata, false, "trailing -and does not duplicate fonts");
  assert.equal(trailingMetadata.glyphs.length, 242, "trailing -and exports the single font charset");
  assertUnicodeGlyphs(trailingMetadata, "trailing -and");

  const { convertJsonToUnicode } = await import("../cli/unicode-json.mjs");
  const Module = await createModule({ print() {}, printErr() {} });
  const syntheticGlyphs = [0, 1, 2, 3, 40, 330].map((index) => ({
    index, advance: index / 1000,
    atlasBounds: { left: index, bottom: 1, right: index + 1, top: 2 },
  }));
  const synthetic = {
    atlas: { type: "mtsdf", width: 512, height: 32 },
    glyphs: structuredClone(syntheticGlyphs),
    kerning: [
      { index1: 3, index2: 330, advance: -0.04 },
      { index1: 330, index2: 2, advance: 0.02 },
      { index1: 1, index2: 3, advance: -0.01 },
      { index1: 0, index2: 3, advance: -0.2 },
    ],
  };
  assert.equal(await convertJsonToUnicode(Module, synthetic, [regular]), true, "indexed JSON reports conversion");
  assert.deepEqual(synthetic.glyphs, aliasMappings.map(([unicode, index]) => {
    const { index: _index, ...geometry } = syntheticGlyphs.find((glyph) => glyph.index === index);
    return { ...geometry, unicode };
  }), "conversion duplicates exact geometry for each alias");
  const expectedKerning = [
    { unicode1: 0, unicode2: 65, advance: -0.01 },
    { unicode1: 45, unicode2: 32, advance: 0.02 },
    { unicode1: 45, unicode2: 160, advance: 0.02 },
    { unicode1: 65, unicode2: 45, advance: -0.04 },
    { unicode1: 65, unicode2: 173, advance: -0.04 },
    { unicode1: 65, unicode2: 8208, advance: -0.04 },
    { unicode1: 173, unicode2: 32, advance: 0.02 },
    { unicode1: 173, unicode2: 160, advance: 0.02 },
    { unicode1: 8208, unicode2: 32, advance: 0.02 },
    { unicode1: 8208, unicode2: 160, advance: 0.02 },
  ];
  assert.deepEqual([...synthetic.kerning].sort((left, right) => left.unicode1 - right.unicode1 || left.unicode2 - right.unicode2), expectedKerning, "kerning expands every mapped alias pair and omits unmapped glyphs");
  const convertedSnapshot = structuredClone(synthetic);
  assert.equal(await convertJsonToUnicode(Module, synthetic, [join(temporary, "missing-font.ttf")]), false, "Unicode JSON does not need a cmap or reconversion");
  assert.deepEqual(synthetic, convertedSnapshot, "existing Unicode JSON is unchanged");

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.bin?.main, "cli/main.mjs", "package-local bin entry");

  console.log(JSON.stringify({
    cases: 22,
    cliDefaults: true,
    positionalFont: true,
    filesystem: "NODEFS",
    externalCwd: true,
    relativePaths: true,
    absolutePaths: true,
    unicodeAndSpaces: true,
    varfontSuffix: true,
    exactStreams: true,
    unicodeGlyphs: true,
    kerningAliases: true,
  }));
} finally {
  await chmod(temporary, 0o700).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
