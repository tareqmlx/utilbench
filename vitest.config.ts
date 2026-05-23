import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportOnFailure: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
        "src/test/setup.ts",
        "src/main.tsx",
        "src/App.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
        "src/components/ui/**",
        "src/workers/worker.ts",
      ],
      thresholds: {
        lines: 85,
        functions: 75,
        branches: 70,
        statements: 83,
      },
    },
  },
});
