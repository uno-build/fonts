import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testsDirectory, "..");
const cli = join(root, "cli/msdf-atlas-gen.mjs");
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

async function compareCase(name, args, cwd, { outputs = [], status } = {}) {
  await removeOutputs(outputs);
  const reference = run(nativeCli, args, cwd);
  await removeOutputs(outputs);
  const wasm = run(process.execPath, [cli, ...args], cwd);

  assert.equal(wasm.status, reference.status, `${name}: exit code`);
  assert.deepEqual(wasm.stdout, reference.stdout, `${name}: stdout bytes`);
  assert.deepEqual(wasm.stderr, reference.stderr, `${name}: stderr bytes`);
  if (status !== undefined) assert.equal(wasm.status, status, `${name}: expected exit code`);
  if (wasm.stdout.length) assert.equal(wasm.stdout.at(-1), 0x0a, `${name}: stdout final newline`);
  if (wasm.stderr.length) assert.equal(wasm.stderr.at(-1), 0x0a, `${name}: stderr final newline`);
  return wasm;
}

await stat(nativeCli).catch(() => {
  throw new Error(`Native reference CLI not found: ${nativeCli}\nRun npm run build:reference first.`);
});
assert.ok((await stat(cli)).mode & 0o100, "CLI must be executable");

const temporary = await mkdtemp(join(tmpdir(), "msdf-atlas-cli-"));
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

  await compareCase("help alias", ["--help"], temporary, { status: 0 });
  await compareCase("version alias", ["--version"], temporary, { status: 0 });
  await compareCase("no arguments", [], temporary, { status: 0 });
  await compareCase("invalid arguments", ["--font", regular, "--type", "not-an-atlas-type"], temporary, { status: 1 });
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
  await compareCase(
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
    { outputs: [absolutePng, absoluteJson], status: 0 },
  );
  const absoluteJsonBytes = await readFile(absoluteJson);
  assert.doesNotThrow(() => JSON.parse(absoluteJsonBytes.toString()), "absolute JSON output");

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

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.bin?.["msdf-atlas-gen"], "cli/msdf-atlas-gen.mjs", "package-local bin entry");

  console.log(JSON.stringify({
    cases: 10,
    filesystem: "NODEFS",
    externalCwd: true,
    relativePaths: true,
    absolutePaths: true,
    unicodeAndSpaces: true,
    varfontSuffix: true,
    exactStreams: true,
  }));
} finally {
  await chmod(temporary, 0o700).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
