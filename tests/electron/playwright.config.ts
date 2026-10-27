import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "**/*.spec.ts", workers: 1, timeout: 90_000,
  expect: { timeout: 15_000 }, retries: 0,
  reporter: [["list"]], outputDir: "../../artifacts/electron",
});
