Before running the build scripts, clone the official `msdf-atlas-gen`
repository into this project's root and check out the pinned revision:

```sh
git clone https://github.com/Chlumsky/msdf-atlas-gen.git msdf-atlas-gen
git -C msdf-atlas-gen checkout --detach 6148900d59423059bafde2f51a0cb303184404bd
git -C msdf-atlas-gen submodule update --init msdfgen
npm install
```

The submodule command checks out the matching `msdfgen` revision. The build
scripts download the other pinned dependencies, including Artery Font and
Skia. The official checkout is ignored by Git in this project and remains
unchanged during builds: the scripts apply `wasm/upstream.patch` to a staged
copy instead.

| Command | Description |
| --- | --- |
| `npm run build:reference` | Builds the official C++ CLI with pinned versions to use as the test reference. |
| `npm run build:api` | Compiles `src/index.ts` into `dist/index.js` and `dist/index.d.ts`, and copies the browser Worker. Also runs as part of `build:wasm`. |
| `npm run build:wasm` | Builds the dependencies and generates the JavaScript and WASM module shared by Node and the web. |
| `npm test` | Runs the reference, WASM, Node, and browser tests against the existing build artifacts. |
| `npm run test:reference` | Runs the reference CLI and compares its results with the saved corpus. |
| `npm run test:wasm` | Inspects the WASM exports and verifies that it has no pthread imports or imported memory. |
| `npm run test:node` | Runs the WASM in Node and checks initialization, filesystem support, variable fonts, and the official exporters. |
| `npm run test:cli` | Compares the local Node/WASM CLI's exit codes and streams with the C++ reference, and checks host filesystem access. |
| `npm run test:browser:prepare` | Prepares browser test fonts in `tests/assets`. Uses system fonts on macOS or the paths specified by `MSDF_TEST_TTF`, `MSDF_TEST_OTF`, and `MSDF_TEST_COMPLEX_TTF`. |
| `npm run test:browser` | Prepares the fonts, starts a local server, runs the test harness in Chromium, and closes the browser and server when finished. Requires Chromium installed with `npx playwright install chromium`. |
| `npm run reference:update` | Regenerates the expected results corpus using the reference CLI. Modifies the corpus files and is not run as part of `npm test`. |

After building the WASM module, run the local CLI with the same arguments as
the official executable:

```sh
node cli/msdf-atlas-gen.mjs -font path/to/font.ttf -imageout atlas.png
```

It is also exposed as the package-local `msdf-atlas-gen` binary.
