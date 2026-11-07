import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8000"
    }
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(rootDirectory, "index.html"),
        incidents: resolve(rootDirectory, "historico.html"),
        management: resolve(rootDirectory, "gerencial.html")
      }
    }
  }
});
