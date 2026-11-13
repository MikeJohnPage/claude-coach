import { cpSync, createReadStream, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The MediaPipe WASM runtime is served from the installed npm package, never from a CDN.
const WASM_FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];

function mediapipeWasm(): Plugin {
  const source = resolve(import.meta.dirname, "node_modules/@mediapipe/tasks-vision/wasm");
  let outDir = "dist";
  return {
    name: "mediapipe-wasm",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use("/wasm", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0]!.replace(/^\//, "");
        const file = join(source, name);
        if (!WASM_FILES.includes(name) || !existsSync(file)) return next();
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const name of WASM_FILES) cpSync(join(source, name), join(outDir, "wasm", name));
    },
  };
}

export default defineConfig({
  // Relative paths, so the build works at any sub-path such as GitHub Pages.
  base: "./",
  plugins: [mediapipeWasm()],
  test: { include: ["tests/**/*.test.ts"] },
});
