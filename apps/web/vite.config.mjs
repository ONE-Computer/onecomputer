import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  cacheDir: process.env.ONECOMPUTER_VITE_CACHE_DIR,
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
    proxy: {
      "/api": {
        target: process.env.ONECOMPUTER_CONTROL_URL ?? "http://127.0.0.1:4100",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: {
          "x-onecomputer-proxy-token": process.env.ONECOMPUTER_WEB_PROXY_TOKEN ?? "local-web-proxy-token-change-me",
          "x-onecomputer-tenant-id": process.env.ONECOMPUTER_DEV_TENANT_ID ?? "acme",
          "x-onecomputer-subject-id": process.env.ONECOMPUTER_DEV_SUBJECT_ID ?? "alex-morgan",
          "x-onecomputer-audience": "onecomputer-control",
        },
      },
    },
  },
  plugins: [react()],
});
