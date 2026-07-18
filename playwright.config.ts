import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "WORKER_PORT=3213 RELAY_RENDER_MODE=fake RELAY_RENDER_OUTPUT_DIR=.relay/browser-renders npm run start --workspace @relay/worker",
      url: "http://127.0.0.1:3213/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "RELAY_WORKER_URL=http://127.0.0.1:3213 npm run start --workspace @relay/web -- --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
