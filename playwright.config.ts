import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  outputDir: "output/playwright/test-results",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command:
      "node apps/web/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
  projects: [
    ...(["chromium", "webkit"] as const).flatMap((browserName) =>
      [
        ["mobile-320x568", { width: 320, height: 568 }],
        ["mobile-390x844", { width: 390, height: 844 }],
        ["mobile-568x320", { width: 568, height: 320 }],
      ].map(([viewportName, viewport]) => ({
        name: `${browserName}-${viewportName}`,
        use: {
          ...(browserName === "webkit"
            ? devices["iPhone 13"]
            : devices["Desktop Chrome"]),
          browserName,
          viewport,
          isMobile: true,
          hasTouch: true,
        },
      })),
    ),
  ],
});
