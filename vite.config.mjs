import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "desktop/ui",
  base: "./",
  build: { outDir: resolve("desktop-dist"), emptyOutDir: true },
});
