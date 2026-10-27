import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const { resolveCloudConfig } = createRequire(import.meta.url)("../desktop/src/cloud-config.cjs");

export default defineConfig({
  define: { __COLORIDE_CLOUD_CONFIG__: JSON.stringify(resolveCloudConfig()) },
  plugins: [react(), {
    name: "coloride-boot-artwork",
    transformIndexHtml(html, context) {
      // Production HTML gets Vite's hashed asset URL. During development this
      // shared Electron resource sits outside the renderer's root directory.
      if (!context.server) return html;
      const artwork = fileURLToPath(new URL("../desktop/resources/branding/coloride-loading.svg", import.meta.url));
      const reduced = fileURLToPath(new URL("../desktop/resources/branding/coloride-loading-reduced.svg", import.meta.url));
      return html
        .replace('src="../desktop/resources/branding/coloride-loading.svg"', `src="/@fs/${artwork}"`)
        .replace('src="../desktop/resources/branding/coloride-loading-reduced.svg"', `src="/@fs/${reduced}"`);
    },
  }],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});
