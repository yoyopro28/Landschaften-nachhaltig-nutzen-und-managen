import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "./" : "/",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
}));
