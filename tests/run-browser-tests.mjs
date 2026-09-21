import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { host: "127.0.0.1", port: 0, open: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}/tests/browser-harness.html`);
  await page.waitForFunction(() => window.__testSummary || window.__testError, null, { timeout: 120_000 });
  const { summary, error } = await page.evaluate(() => ({
    summary: window.__testSummary,
    error: window.__testError,
  }));
  assert.equal(error, undefined, error);
  assert.ok(summary?.assertions.length > 0, "Harness must execute assertions");
  assert.deepEqual(errors, [], "Browser must not report errors");
  console.log(`PASS: ${summary.assertions.length} browser assertions (Chromium)`);
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
