import { defineConfig } from "vite";

// The development build is written directly to Origo's plugins folder, the production build to build/js
export default defineConfig(({ mode }) => {
  const dev = mode === "development";
  return {
    build: {
      outDir: dev ? "../origo/plugins" : "build/js",
      emptyOutDir: !dev,
      minify: !dev,
      sourcemap: false,
      lib: {
        entry: "origo-matomo.js",
        name: "OrigoMatomo",
        formats: ["iife"],
        fileName: () => (dev ? "origo-matomo.js" : "origo-matomo.min.js"),
      },
      rollupOptions: {
        external: ["Origo"],
        output: {
          globals: { Origo: "Origo" },
        },
      },
    },
  };
});
