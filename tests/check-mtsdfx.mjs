import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import createModule from "../dist/msdf-atlas.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "cli/main.mjs");
const nativeCli = resolve(process.env.MSDF_NATIVE_CLI || join(root, ".wasm-deps/native-reference/bin/msdf-atlas-gen"));
const fixtures = join(root, "tests/reference/fixtures");

await stat(nativeCli).catch(() => {
  throw new Error(`Native reference CLI not found: ${nativeCli}\nRun npm run build:reference first.`);
});

const temporary = await mkdtemp(join(tmpdir(), "msdf-atlas-mtsdfx-"));
const scratch = join(temporary, "temporales");
const outputs = join(temporary, "salida con espacio 漢");
const fonts = join(temporary, "fuentes con espacio Ω");
let cases = 0;

function run(args, native = false) {
  const result = spawnSync(native ? nativeCli : process.execPath, native ? args : [cli, ...args], {
    cwd: temporary,
    env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function expectSuccess(result, name) {
  assert.equal(result.status, 0, `${name}: exit code\n${result.stdout}\n${result.stderr}`);
}

async function expectCleanTemporaryDirectory(name) {
  assert.deepEqual(await readdir(scratch), [], `${name}: temporary files removed`);
}

function quantize(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function roundedNativeMetadata(value) {
  // Native and WASM differ at the last double-precision digit in plane bounds.
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "number" ? Number(item.toPrecision(14)) : item));
}

// This reference starts from the official generator's float output, before either
// the RGB range conversion or 8-bit quantization performed by the extended CLI.
function expectedPixels(floats, atlas, rgbRange, effectRange) {
  assert.equal(floats.length, atlas.width * atlas.height * 4 * 4, "reference float image size");
  const pixels = Buffer.alloc(atlas.width * atlas.height * 4);
  for (let y = 0; y < atlas.height; y++) {
    const outputY = atlas.yOrigin === "bottom" ? atlas.height - y - 1 : y;
    for (let x = 0; x < atlas.width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        const sample = floats.readFloatLE(((y * atlas.width + x) * 4 + channel) * 4);
        const value = channel === 3 ? sample : (sample - 0.5) * effectRange / rgbRange + 0.5;
        pixels[(outputY * atlas.width + x) * 4 + channel] = quantize(value);
      }
    }
  }
  return pixels;
}

async function compareAtlas(name, {
  input,
  type = "mtsdfx",
  rangeArguments = [],
  rgbRange = 8,
  effectRange = 12,
  origin = "bottom",
  aliases = false,
  relativePaths = false,
  image = true,
  json = true,
  csv = false,
  nativeReference = false,
  nativeMappings,
  explicitFormat = false,
} = {}) {
  const prefix = join(outputs, name);
  const flag = (value) => aliases ? `-${value}` : value;
  const outputPath = (suffix) => relativePaths ? relative(temporary, `${prefix}.${suffix}`) : `${prefix}.${suffix}`;
  const common = [...input, flag("-yorigin"), origin, flag("-threads"), "1"];
  const extensionArguments = [
    ...common,
    flag("-type"), type,
    ...rangeArguments,
    ...(explicitFormat ? [flag("-format"), "png"] : []),
    ...(image ? [flag("-imageout"), outputPath("png")] : []),
    ...(json ? [flag("-json"), outputPath("json")] : []),
    ...(csv ? [flag("-csv"), outputPath("csv")] : []),
  ];
  const result = run(extensionArguments);
  expectSuccess(result, name);
  assert.match(result.stderr, /^Atlas parameters:\n/, `${name}: generation parameters printed`);
  assert.match(result.stderr, new RegExp(`^  ${flag("-type")} +${type}$`, "m"), `${name}: public atlas type printed`);
  assert.match(result.stderr, new RegExp(`^  -{1,2}effectpxrange +${effectRange}$`, "m"), `${name}: effect range printed`);
  await expectCleanTemporaryDirectory(name);

  const referenceArguments = [
    ...common,
    "-type", "mtsdf",
    "-pxrange", String(effectRange),
    "-format", "binfloat",
    "-imageout", `${prefix}.reference.bin`,
    "-json", `${prefix}.reference.json`,
    ...(csv ? ["-csv", `${prefix}.reference.csv`] : []),
  ];
  expectSuccess(run(referenceArguments), `${name}: official WASM reference`);
  const referenceJson = JSON.parse(await readFile(`${prefix}.reference.json`, "utf8"));
  const floats = await readFile(`${prefix}.reference.bin`);
  assert.equal(referenceJson.atlas.type, "mtsdf", `${name}: reference atlas type`);
  const expectedJson = structuredClone(referenceJson);
  expectedJson.atlas.type = "mtsdfx";
  expectedJson.atlas.distanceRange = rgbRange;
  expectedJson.atlas.effectDistanceRange = effectRange;
  assert.equal(expectedJson.atlas.distanceRangeMiddle, 0, `${name}: symmetric distance range`);

  let png;
  if (image) {
    png = PNG.sync.read(await readFile(`${prefix}.png`));
    assert.equal(png.width, referenceJson.atlas.width, `${name}: width includes effect padding`);
    assert.equal(png.height, referenceJson.atlas.height, `${name}: height includes effect padding`);
    assert.deepEqual(png.data, expectedPixels(floats, referenceJson.atlas, rgbRange, effectRange), `${name}: exact RGBA pixels`);
  }
  if (json) {
    assert.deepEqual(JSON.parse(await readFile(`${prefix}.json`, "utf8")), expectedJson, `${name}: metadata and glyph geometry`);
  } else {
    assert.equal((await readdir(outputs)).includes(`${name}.json`), false, `${name}: no unsolicited JSON output`);
  }
  if (!image) {
    assert.equal((await readdir(outputs)).includes(`${name}.png`), false, `${name}: no unsolicited PNG output`);
  }
  if (csv) {
    assert.deepEqual(await readFile(`${prefix}.csv`), await readFile(`${prefix}.reference.csv`), `${name}: CSV uses effect-range geometry`);
  }
  if (nativeReference) {
    expectSuccess(run(referenceArguments, true), `${name}: official native reference`);
    const nativeMetadata = JSON.parse(await readFile(`${prefix}.reference.json`, "utf8"));
    if (nativeMappings) {
      const { glyphs: nativeGlyphs, kerning: _nativeKerning, ...nativeLayout } = nativeMetadata;
      const { glyphs, kerning: _kerning, ...layout } = referenceJson;
      assert.deepEqual(roundedNativeMetadata(layout), roundedNativeMetadata(nativeLayout), `${name}: native atlas layout and metrics`);
      for (const [unicode, index] of nativeMappings) {
        const { index: _index, ...geometry } = nativeGlyphs.find((glyph) => glyph.index === index);
        assert.deepEqual(
          roundedNativeMetadata(glyphs.find((glyph) => glyph.unicode === unicode)),
          roundedNativeMetadata({ ...geometry, unicode }),
          `${name}: U+${unicode.toString(16)} keeps native glyph ${index} geometry`,
        );
      }
    } else {
      assert.deepEqual(roundedNativeMetadata(nativeMetadata), roundedNativeMetadata(referenceJson), `${name}: native and WASM geometry`);
    }
    // Full-font distance fields can differ between the native and WASM builds;
    // the indexed atlas is checked against direct WASM below instead.
    if (!nativeMappings) assert.deepEqual(await readFile(`${prefix}.reference.bin`), floats, `${name}: native and WASM float output`);
  }
  cases++;
  return { png, floats, atlas: referenceJson.atlas, metadata: expectedJson };
}

try {
  await Promise.all([mkdir(scratch), mkdir(outputs), mkdir(fonts)]);
  const regular = join(fonts, "Lato Regular Ω.ttf");
  const bold = join(fonts, "Lato Bold 漢.ttf");
  const variable = join(fonts, "Roboto Variable Ω.ttf");
  const charset = join(fonts, "caracteres Ω.txt");
  const glyphset = join(fonts, "glifos 漢.txt");
  await Promise.all([
    copyFile(join(fixtures, "Lato-Regular.ttf"), regular),
    copyFile(join(fixtures, "Lato-Bold.ttf"), bold),
    copyFile(join(fixtures, "Roboto-Variable.ttf"), variable),
    writeFile(charset, "[0x41, 0x43]\n"),
    copyFile(join(fixtures, "glyphset.txt"), glyphset),
  ]);
  const standardInput = ["-font", regular, "-chars", "[0x41, 0x43]", "-size", "24"];

  const defaults = await compareAtlas("defaults Ω", {
    input: ["-font", relative(temporary, regular), "-charset", relative(temporary, charset), "-size", "24"],
    relativePaths: true,
    csv: true,
    nativeReference: true,
  });
  assert.equal(defaults.metadata.glyphs.length, 3, "explicit charset is retained");
  assert.equal(defaults.atlas.size, 24, "explicit size is retained");
  const defaultRangeScale = defaults.metadata.atlas.effectDistanceRange / defaults.metadata.atlas.distanceRange;
  let prematureQuantizationChangesPixels = false;
  for (let offset = 0; offset < defaults.floats.length; offset += 4) {
    if ((offset / 4) % 4 === 3) continue;
    const value = defaults.floats.readFloatLE(offset);
    if (quantize((value - 0.5) * defaultRangeScale + 0.5) !== quantize((quantize(value) / 255 - 0.5) * defaultRangeScale + 0.5)) {
      prematureQuantizationChangesPixels = true;
      break;
    }
  }
  assert.ok(prematureQuantizationChangesPixels, "fixture detects conversion after premature 8-bit quantization");

  const bottom = await compareAtlas("custom bottom", {
    input: standardInput,
    rangeArguments: ["-pxrange", "4", "-effectpxrange", "20"],
    rgbRange: 4,
    effectRange: 20,
  });
  const top = await compareAtlas("double-dash aliases top 漢", {
    input: ["--font", regular, "--chars", "[0x41, 0x43]", "--size", "24"],
    type: "mtsdfx",
    rangeArguments: ["--effectpxrange", "20", "--pxrange", "4"],
    rgbRange: 4,
    effectRange: 20,
    origin: "top",
    aliases: true,
    explicitFormat: true,
  });
  assert.deepEqual(top.png.data, bottom.png.data, "PNG pixels do not depend on JSON y-origin");

  await compareAtlas("equal ranges", {
    input: standardInput,
    rangeArguments: ["-pxrange", "16", "-effectpxrange", "16"],
    rgbRange: 16,
    effectRange: 16,
  });
  await compareAtlas("variable absolute", {
    input: ["-varfont", `${variable}?wdth=75&wght=700`, "-glyphset", glyphset, "-size", "28"],
    rangeArguments: ["-pxrange", "5.5", "-effectpxrange", "23.5"],
    rgbRange: 5.5,
    effectRange: 23.5,
  });
  const multiple = await compareAtlas("multiple fonts", {
    input: [
      "-font", regular, "-fontname", "regular", "-chars", "65",
      "-and", "-font", bold, "-fontname", "bold", "-chars", "66", "-size", "24",
    ],
    csv: true,
  });
  assert.deepEqual(multiple.metadata.variants.map(({ name }) => name), ["regular", "bold"], "multiple font variants retained");
  await compareAtlas("JSON only", {
    input: standardInput,
    image: false,
    rangeArguments: ["-pxrange", "6", "-effectpxrange", "24"],
    rgbRange: 6,
    effectRange: 24,
  });
  await compareAtlas("PNG only", { input: standardInput, json: false });
  const defaultSize = await compareAtlas("CLI default size", {
    input: ["-font", regular, "-chars", "65"],
    image: false,
    effectRange: 16,
  });
  assert.equal(defaultSize.atlas.size, 32, "CLI default size");
  await compareAtlas("effect range scales with size", {
    input: [...standardInput, "--size", "64"],
    effectRange: 32,
  });
  await compareAtlas("effect range clamps to RGB range", {
    input: [...standardInput, "-size", "16"],
    rangeArguments: ["-pxrange", "24"],
    rgbRange: 24,
    effectRange: 24,
  });
  await compareAtlas("fractional default effect range", {
    input: [...standardInput, "-size", "25"],
    effectRange: 12.5,
  });
  await compareAtlas("effect range uses minimum size", {
    input: ["-font", regular, "-chars", "65", "-minsize", "48"],
    effectRange: 24,
  });
  const allGlyphs = await compareAtlas("allglyphs Unicode with native packing", {
    input: ["-font", join(fixtures, "ChangaOne.ttf"), "-allglyphs", "-size", "16"],
    effectRange: 8,
    nativeReference: true,
    nativeMappings: [[32, 3], [65, 36], [193, 128], [225, 160], [241, 176]],
  });
  assert.equal(allGlyphs.metadata.glyphs.length, 242, "mtsdfx exports all 242 mapped Unicode characters");
  assert.ok(allGlyphs.metadata.glyphs.every((glyph) => Number.isInteger(glyph.unicode) && !("index" in glyph)), "mtsdfx allglyphs JSON uses Unicode identifiers only");
  const allCodepoints = allGlyphs.metadata.glyphs.map((glyph) => glyph.unicode);
  assert.deepEqual(allCodepoints, [...new Set(allCodepoints)].sort((left, right) => left - right), "mtsdfx glyphs are sorted by Unicode");
  assert.equal(allCodepoints.includes(0), false, "mtsdfx does not invent U+0000 for unmapped glyphs");
  const directModule = await createModule({ print() {}, printErr() {} });
  directModule.FS.writeFile("/changa.ttf", await readFile(join(fixtures, "ChangaOne.ttf")));
  assert.equal(directModule.callMain([
    "-font", "/changa.ttf", "-allglyphs", "-type", "mtsdf", "-size", "16", "-pxrange", "8",
    "-threads", "1", "-format", "binfloat", "-imageout", "/atlas.bin", "-json", "/atlas.json",
  ]), 0, "direct official WASM allglyphs reference succeeds");
  assert.deepEqual(Buffer.from(directModule.FS.readFile("/atlas.bin")), allGlyphs.floats, "Unicode conversion leaves the direct official WASM float pixels unchanged");
  const directMetadata = JSON.parse(directModule.FS.readFile("/atlas.json", { encoding: "utf8" }));
  assert.equal(directMetadata.glyphs.length, 245, "direct WASM still packs all glyph indices");
  assert.deepEqual(directMetadata.atlas, allGlyphs.atlas, "Unicode conversion leaves direct official WASM packing unchanged");
  const aliases = await compareAtlas("glyph selection aliases and U+0000", {
    input: ["-font", regular, "-glyphs", "0,1,2,3,40,330", "-size", "16"],
    image: false,
    effectRange: 8,
  });
  assert.deepEqual(aliases.metadata.glyphs.map((glyph) => glyph.unicode), [0, 32, 45, 65, 86, 160, 173, 8208], "mtsdfx exports every real alias and U+0000");
  const { unicode: _space, ...spaceGeometry } = aliases.metadata.glyphs.find((glyph) => glyph.unicode === 32);
  const { unicode: _nbsp, ...nbspGeometry } = aliases.metadata.glyphs.find((glyph) => glyph.unicode === 160);
  assert.deepEqual(spaceGeometry, nbspGeometry, "mtsdfx aliases retain identical packed geometry");
  await compareAtlas("option-like name in extended mode", {
    input: [...standardInput, "-fontname", "-type"],
    image: false,
  });

  const defaultImagePath = regular.replace(/\.ttf$/, ".png");
  const defaultJsonPath = regular.replace(/\.ttf$/, ".json");
  await Promise.all([defaultImagePath, defaultJsonPath].map((path) => rm(path, { force: true })));
  expectSuccess(run([...standardInput, "-threads", "1"]), "inferred outputs");
  assert.deepEqual(JSON.parse(await readFile(defaultJsonPath, "utf8")), defaults.metadata, "inferred JSON output");
  assert.deepEqual(PNG.sync.read(await readFile(defaultImagePath)).data, defaults.png.data, "inferred PNG output");
  await expectCleanTemporaryDirectory("inferred outputs");
  cases++;

  for (const args of [["-type", "mtsdfx", "-help"], ["--type", "mtsdfx", "--help"]]) {
    const result = run(args);
    expectSuccess(result, "extended help");
    assert.doesNotMatch(result.stderr, /Atlas parameters:/, "help does not print generation parameters");
    assert.match(result.stdout + result.stderr, /mtsdfx/, "help describes mtsdfx");
    assert.match(result.stdout + result.stderr, /effectpxrange/, "help describes effect range");
    cases++;
  }

  for (const name of ["-type", "-effectpxrange"]) {
    const path = join(outputs, `official option-like ${name}.json`);
    const args = [...standardInput, "-type", "msdf", "-pxrange", "2", "-fontname", name,
      "-imageout", join(outputs, `official option-like ${name}.png`), "-json", path, "-threads", "1"];
    const reference = run(args, true);
    expectSuccess(reference, `official option-like ${name}`);
    const referenceJson = await readFile(path);
    await rm(path);
    const actual = run(args);
    expectSuccess(actual, `option-like operand ${name}`);
    assert.equal(actual.stdout, reference.stdout, "option-like operand: stdout unchanged");
    assert.equal(actual.stderr.replace(/^Atlas parameters:\n(?:  [^\n]*\n)+\n/, ""), reference.stderr, "option-like operand: generator stderr unchanged");
    assert.deepEqual(
      roundedNativeMetadata(JSON.parse(await readFile(path, "utf8"))),
      roundedNativeMetadata(JSON.parse(referenceJson.toString())),
      "option-like operand does not activate extension",
    );
    cases++;
  }

  const earlyExitImage = join(outputs, "expected-no-file.png");
  const earlyExitArguments = ["-errorcorrection", "help", "-imageout", earlyExitImage];
  const officialEarlyExit = run(["-type", "mtsdf", ...earlyExitArguments]);
  const extendedEarlyExit = run(["-type", "mtsdfx", ...earlyExitArguments]);
  expectSuccess(extendedEarlyExit, "upstream early exit without output");
  assert.equal(extendedEarlyExit.stdout, officialEarlyExit.stdout, "upstream early exit: stdout");
  assert.equal(extendedEarlyExit.stderr, officialEarlyExit.stderr, "upstream early exit: stderr");
  assert.equal((await readdir(outputs)).includes("expected-no-file.png"), false, "upstream help does not create PNG");
  await expectCleanTemporaryDirectory("upstream early exit");
  cases++;

  const sentinel = Buffer.from("existing output must survive rejected arguments\n");
  const protectedPaths = ["png", "json", "csv"].map((extension) => join(outputs, `protected.${extension}`));
  const protectedArguments = ["-imageout", protectedPaths[0], "-json", protectedPaths[1], "-csv", protectedPaths[2]];
  const invalidCases = [
    ["zero RGB range", ["-pxrange", "0"]],
    ["negative RGB range", ["-pxrange", "-1"]],
    ["nonfinite RGB range", ["-pxrange", "Infinity"]],
    ["NaN RGB range", ["-pxrange", "NaN"]],
    ["zero effect range", ["-effectpxrange", "0"]],
    ["negative effect range", ["-effectpxrange", "-1"]],
    ["nonfinite effect range", ["-effectpxrange", "Infinity"]],
    ["NaN effect range", ["-effectpxrange", "NaN"]],
    ["effect smaller than RGB", ["-pxrange", "16", "-effectpxrange", "8"]],
    ["float image output", ["-format", "binfloat"]],
    ["BMP image output", ["-format", "bmp"]],
    ["em range", ["-emrange", "1"]],
    ["asymmetric em range", ["-aemrange", "-0.5", "0.5"]],
    ["asymmetric pixel range", ["-apxrange", "-4", "4"]],
    ["Artery output", ["-arfont", join(outputs, "unsupported.arfont")]],
    ["Shadron output", ["-shadronpreview", join(outputs, "unsupported.shadron"), "ABC"]],
    ["missing RGB operand", ["-pxrange"]],
    ["missing effect operand", ["-effectpxrange"]],
    ["empty image destination", ["-imageout", ""]],
    ["empty JSON destination", ["-json", ""]],
    ["missing font", ["-font", join(fonts, "missing.ttf")]],
  ];
  for (const [name, args] of invalidCases) {
    await Promise.all(protectedPaths.map((path) => writeFile(path, sentinel)));
    const result = run([...standardInput, "-type", "mtsdfx", ...protectedArguments, ...args]);
    assert.equal(result.status, 1, `${name}: rejected\n${result.stdout}\n${result.stderr}`);
    for (const path of protectedPaths) {
      assert.deepEqual(await readFile(path), sentinel, `${name}: existing output preserved`);
    }
    await expectCleanTemporaryDirectory(name);
    cases++;
  }

  const outsideMode = run([...standardInput, "-type", "mtsdf", "-effectpxrange", "32"]);
  assert.equal(outsideMode.status, 1, "effect range is rejected outside the extended mode");
  await expectCleanTemporaryDirectory("effect range outside extended mode");
  cases++;

  const inferredBmp = run([...standardInput, "-type", "mtsdfx", "-imageout", join(outputs, "unsupported.bmp")]);
  assert.equal(inferredBmp.status, 1, "non-PNG inferred output format is rejected");
  assert.equal((await readdir(outputs)).includes("unsupported.bmp"), false, "rejected format creates no image");
  await expectCleanTemporaryDirectory("inferred output format");
  cases++;

  const writeFailure = run([
    ...standardInput, "-type", "mtsdfx",
    "-imageout", join(outputs, "missing directory", "atlas.png"),
    "-json", join(outputs, "missing directory", "atlas.json"),
  ]);
  assert.equal(writeFailure.status, 1, "output write failure is reported");
  await expectCleanTemporaryDirectory("output write failure");
  cases++;

  for (const failedOutput of ["csv", "png"]) {
    const name = `partial ${failedOutput} write failure`;
    const jsonPath = join(outputs, `${name}.json`);
    const imagePath = failedOutput === "png"
      ? join(outputs, "missing directory", `${name}.png`)
      : join(outputs, `${name}.png`);
    const result = run([
      ...standardInput, "-type", "mtsdfx", "-threads", "1",
      "-imageout", imagePath, "-json", jsonPath,
      ...(failedOutput === "csv" ? ["-csv", join(outputs, "missing directory", `${name}.csv`)] : []),
    ]);
    assert.equal(result.status, 1, `${name}: failed output is reported`);
    assert.deepEqual(JSON.parse(await readFile(jsonPath, "utf8")), defaults.metadata, `${name}: valid JSON still saved`);
    if (failedOutput === "csv") {
      const png = PNG.sync.read(await readFile(imagePath));
      assert.equal(png.width, defaults.png.width, `${name}: PNG width`);
      assert.equal(png.height, defaults.png.height, `${name}: PNG height`);
      assert.deepEqual(png.data, defaults.png.data, `${name}: valid PNG still saved`);
    }
    await expectCleanTemporaryDirectory(name);
    cases++;
  }

  console.log(JSON.stringify({
    cases,
    exactFloatConversion: true,
    nativeReference: true,
    independentRanges: true,
    bothOrigins: true,
    unicodeAndSpaces: true,
    outputPreservation: true,
    temporaryCleanup: true,
  }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
