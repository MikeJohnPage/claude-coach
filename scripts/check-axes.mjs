// Prints a few landmarks of a photo of a person, run through the real model upright and rotated by ±90°.
// It is how the world-landmark convention was confirmed: x is image-right, y is image-down,
// smaller z is closer to the camera, and the axes follow the image, not gravity.
// Usage: node scripts/check-axes.mjs photo.jpg   (needs `npm run models`)
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createServer } from "vite";

const photo = "data:image/jpeg;base64," + readFileSync(process.argv[2]).toString("base64");
const server = await createServer({ server: { port: 5199 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const result = await page.evaluate(async (src) => {
    const { PoseLandmarker } = await import("/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs");
    const landmarker = await PoseLandmarker.createFromOptions(
      { wasmLoaderPath: "/wasm/vision_wasm_internal.js", wasmBinaryPath: "/wasm/vision_wasm_internal.wasm" },
      { baseOptions: { modelAssetPath: "/models/pose_landmarker_full.task", delegate: "CPU" }, runningMode: "IMAGE" },
    );
    const image = new Image();
    image.src = src;
    await image.decode();
    const names = { 0: "nose", 11: "leftShoulder", 12: "rightShoulder", 23: "leftHip", 24: "rightHip" };
    const rows = [];
    for (const rotation of [0, 90, -90]) {
      const canvas = document.createElement("canvas");
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      canvas.width = rotation ? h : w;
      canvas.height = rotation ? w : h;
      const ctx = canvas.getContext("2d");
      if (rotation === 90) ctx.setTransform(0, 1, -1, 0, h, 0);
      if (rotation === -90) ctx.setTransform(0, -1, 1, 0, 0, w);
      ctx.drawImage(image, 0, 0);
      const detected = landmarker.detect(canvas);
      for (const [i, name] of Object.entries(names)) {
        const fix = (l) => [l.x, l.y, l.z].map((v) => v.toFixed(3)).join(" ");
        rows.push({ rotation, name, image: fix(detected.landmarks[0][i]), world: fix(detected.worldLandmarks[0][i]) });
      }
    }
    return rows;
  }, photo);
  console.table(result);
} finally {
  await browser.close();
  await server.close();
}
