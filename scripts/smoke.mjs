// Browser smoke test: serves the production build, opens it in Chromium with a fake camera,
// and checks that the model loads, frames are processed, nothing is fetched from another origin,
// the console stays free of errors, and the app reports that it can't see a person.
// Run `npm run build` first. Set CHROMIUM_PATH to use a specific browser binary.
import { chromium } from "playwright";
import { preview } from "vite";

const server = await preview({ preview: { port: 4173, strictPort: false }, logLevel: "warn" });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const failures = [];
try {
  const page = await browser.newPage();
  const errors = [];
  const foreign = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
    else if (msg.type() === "warning") console.log(`[browser warning] ${msg.text()}`);
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => {
    const target = request.url();
    if (!target.startsWith(url) && !target.startsWith("blob:") && !target.startsWith("data:")) foreign.push(target);
  });

  await page.goto(url);
  await page.waitForFunction(() => window.__coach?.modelReady, null, { timeout: 60000 });
  await page.click("#start");
  await page.waitForFunction(() => window.__coach.frames >= 30 && window.__coach.state === "lost", null, { timeout: 60000 });

  const status = await page.evaluate(() => ({ ...window.__coach, label: document.getElementById("state").textContent }));
  console.log(JSON.stringify(status));
  if (!status.said.includes("I can't see you.")) failures.push("the app did not say that it can't see a person");
  if (status.label !== "Can't see you") failures.push(`unexpected state label "${status.label}"`);
  if (status.error) failures.push(`app error: ${status.error}`);
  if (errors.length) failures.push(`console errors:\n  ${errors.join("\n  ")}`);
  if (foreign.length) failures.push(`requests to other origins:\n  ${foreign.join("\n  ")}`);
} catch (error) {
  failures.push(String(error));
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) {
  console.error(`Smoke test failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("Smoke test passed.");
