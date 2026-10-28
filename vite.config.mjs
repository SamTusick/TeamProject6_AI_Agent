import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "frontend/renderer",
  base: "./",
  build: { outDir: resolve("frontend/dist"), emptyOutDir: true },
});
