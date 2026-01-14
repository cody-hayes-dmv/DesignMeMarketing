import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  optimizeDeps: {
    // Pre-bundle lucide-react so dev doesn't request individual icon modules like
    // `/node_modules/lucide-react/dist/esm/icons/fingerprint.js`, which can be blocked by
    // some browser extensions (ERR_BLOCKED_BY_CLIENT).
    include: ["lucide-react"],
  },
});
