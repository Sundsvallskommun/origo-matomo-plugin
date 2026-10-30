import { defineConfig } from "vite";

// The statistics page in dashboard/ is built to build/dashboard and can be served from any web server
export default defineConfig({
  root: "dashboard",
  base: "./",
  build: {
    outDir: "../build/dashboard",
    emptyOutDir: true
  }
});
