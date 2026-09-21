import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const referenceDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(referenceDir, "../..");
const fixtures = join(referenceDir, "fixtures");
const expectedCorpus = join(referenceDir, "corpus");
const verify = process.argv.includes("--verify");
const nativeCli = resolve(process.env.MSDF_NATIVE_CLI || join(root, ".wasm-deps/native-reference/bin/msdf-atlas-gen"));

const fixtureHashes = {
  "Lato-Regular.ttf": "d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251",
  "Lato-Bold.ttf": "8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1",
  "Roboto-Variable.ttf": "d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134",
};

const revisions = {
  msdfAtlasGen: "6148900d59423059bafde2f51a0cb303184404bd",
  msdfgen: "84f183a6c8137c42abc5728b29ed274bab3edeb0",
  skia: "a004a27085d7dcc4efc3766c9abe92df03654c7c",
  arteryFont: "af79386abe0857fe1c30be97eec760dbd84022c5",
  freetype: "2.13.3",
  libpng: "1.6.39",
  zlib: "1.2.13",
};

const cases = [
  {
    name: "normal",
    args: (out) => ["-font", "fixtures/Lato-Regular.ttf", "-charset", "fixtures/charset.txt", "-type", "msdf", "-size", "32", "-pxrange", "4", "-imageout", join(out, "atlas.png"), "-json", join(out, "atlas.json"), "-arfont", join(out, "atlas.arfont"), "-threads", "1"],
    outputs: ["atlas.png", "atlas.json", "atlas.arfont"],
  },
  {
    name: "variable-axes",
    args: () => ["-varfont", "fixtures/Roboto-Variable.ttf", "-printvaraxes", "-threads", "1"],
    outputs: [],
  },
  {
    name: "variable-instance",
    args: (out) => ["-varfont", "fixtures/Roboto-Variable.ttf?wdth=75&wght=700", "-chars", "[65,90]", "-size", "28", "-imageout", join(out, "atlas.png"), "-json", join(out, "atlas.json"), "-threads", "1"],
    outputs: ["atlas.png", "atlas.json"],
  },
  {
    name: "kerning",
    args: (out) => ["-font", "fixtures/Lato-Regular.ttf", "-chars", "65,86,84,111,87,97", "-size", "32", "-json", join(out, "atlas.json"), "-threads", "1"],
    outputs: ["atlas.json"],
  },
  {
    name: "overlap",
    args: (out) => ["-font", "fixtures/Lato-Regular.ttf", "-chars", "56,64,66,103", "-type", "mtsdf", "-size", "40", "-overlap", "-scanline", "-imageout", join(out, "atlas.png"), "-threads", "1"],
    outputs: ["atlas.png"],
  },
  {
    name: "multiple-fonts",
    args: (out) => ["-font", "fixtures/Lato-Regular.ttf", "-fontname", "regular", "-chars", "[65,67]", "-and", "-font", "fixtures/Lato-Bold.ttf", "-fontname", "bold", "-chars", "[120,122]", "-size", "30", "-imageout", join(out, "atlas.png"), "-json", join(out, "atlas.json"), "-threads", "1"],
    outputs: ["atlas.png", "atlas.json"],
  },
  {
    name: "glyphset-file",
    args: (out) => ["-font", "fixtures/Lato-Regular.ttf", "-glyphset", "fixtures/glyphset.txt", "-size", "24", "-csv", join(out, "atlas.csv"), "-threads", "1"],
    outputs: ["atlas.csv"],
  },
  {
    name: "invalid-arguments",
    args: () => ["-font", "fixtures/Lato-Regular.ttf", "-type", "not-an-atlas-type"],
    outputs: [],
    exitCode: 1,
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function validateFixtures() {
  for (const [name, expected] of Object.entries(fixtureHashes)) {
    const actual = sha256(await readFile(join(fixtures, name)));
    if (actual !== expected) throw new Error(`Fixture checksum mismatch for ${name}: ${actual}`);
  }
}

function normalizedCommand(args, outputDirectory) {
  const prefix = `${outputDirectory}/`;
  return ["msdf-atlas-gen", ...args.map((arg) => arg.startsWith(prefix) ? `<output>/${arg.slice(prefix.length)}` : arg)];
}

async function generateCorpus(destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const testCase of cases) {
    const outputDirectory = join(destination, testCase.name);
    await mkdir(outputDirectory, { recursive: true });
    const args = testCase.args(outputDirectory);
    const result = spawnSync(nativeCli, args, { cwd: referenceDir, encoding: null });
    const exitCode = result.status ?? 128;
    const expectedExitCode = testCase.exitCode ?? 0;
    await writeFile(join(outputDirectory, "stdout.txt"), result.stdout || Buffer.alloc(0));
    await writeFile(join(outputDirectory, "stderr.txt"), result.stderr || Buffer.alloc(0));

    const files = [];
    for (const name of testCase.outputs) {
      const path = join(outputDirectory, name);
      const bytes = await readFile(path).catch(() => null);
      if (bytes) files.push({ path: name, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
    const record = {
      command: normalizedCommand(args, outputDirectory),
      exitCode,
      signal: result.signal,
      stdout: "stdout.txt",
      stderr: "stderr.txt",
      files,
      revisions,
    };
    await writeFile(join(outputDirectory, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
    if (result.error) throw result.error;
    if (exitCode !== expectedExitCode) {
      throw new Error(`${testCase.name}: expected exit ${expectedExitCode}, got ${exitCode}\n${result.stderr?.toString() || ""}`);
    }
    if (files.length !== testCase.outputs.length) {
      throw new Error(`${testCase.name}: expected ${testCase.outputs.length} output files, got ${files.length}`);
    }
  }
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function verifyCorpus(actual) {
  const expectedFiles = (await filesBelow(expectedCorpus)).map((path) => relative(expectedCorpus, path)).sort();
  const actualFiles = (await filesBelow(actual)).map((path) => relative(actual, path)).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Corpus file list differs\nexpected=${JSON.stringify(expectedFiles)}\nactual=${JSON.stringify(actualFiles)}`);
  }
  for (const name of expectedFiles) {
    const expected = await readFile(join(expectedCorpus, name));
    const got = await readFile(join(actual, name));
    if (!expected.equals(got)) throw new Error(`Corpus mismatch: ${name}`);
  }
}

await stat(nativeCli).catch(() => { throw new Error(`Native reference CLI not found: ${nativeCli}\nRun scripts/build-native-reference.sh first.`); });
await validateFixtures();

if (verify) {
  const temporary = await mkdtemp(join(tmpdir(), "msdf-native-corpus-"));
  try {
    const actual = join(temporary, "corpus");
    await generateCorpus(actual);
    await verifyCorpus(actual);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(`PASS: ${cases.length} native reference cases match the frozen corpus`);
} else {
  await generateCorpus(expectedCorpus);
  console.log(`Generated ${cases.length} native reference cases in ${expectedCorpus}`);
}
