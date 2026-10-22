import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: {
    // The commit this build is made from; the deploy publishes the same one in
    // version.json, and the app reloads onto a newer build (src/appVersion.ts).
    // A local build is "dev" and never reloads itself.
    __APP_COMMIT__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? "dev"),
  },
  base: command === "serve" ? "/" : "/nutriapp/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
