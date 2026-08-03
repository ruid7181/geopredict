import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const basePath = process.env.GITHUB_PAGES_BASE_PATH?.replace(/\/$/, "") ?? "";

export default defineConfig({
  root: "pages",
  base: basePath ? `${basePath}/` : "/",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
  },
});
