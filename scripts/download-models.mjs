// Downloads the MediaPipe pose landmarker models into public/models/ (git-ignored).
// Usage: node scripts/download-models.mjs [lite] [full] [heavy]   (default: all three)
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALL = ["lite", "full", "heavy"];
const variants = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models");
await mkdir(outDir, { recursive: true });

for (const variant of variants) {
  if (!ALL.includes(variant)) throw new Error(`Unknown variant "${variant}", expected one of ${ALL.join(", ")}`);
  const name = `pose_landmarker_${variant}.task`;
  const target = join(outDir, name);
  const existing = await stat(target).catch(() => null);
  if (existing && existing.size > 0) {
    console.log(`${name}: already present (${existing.size} bytes)`);
    continue;
  }
  const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/latest/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(target, bytes);
  console.log(`${name}: downloaded ${bytes.length} bytes`);
}
