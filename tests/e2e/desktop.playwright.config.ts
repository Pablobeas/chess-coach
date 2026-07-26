import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "desktop-smoke.spec.ts",
  timeout: 30_000,
  outputDir: "../../output/playwright/desktop-test-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  },
  webServer: {
    command:
      "node apps/web/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
});
