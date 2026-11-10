import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// In the dev container a matching Chromium is preinstalled at /opt/pw-browsers.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run start -- -p ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          PGLITE_DIR: ".data/e2e-pglite",
          APP_URL: baseURL,
          LAB_RUNS_PER_CLIENT: "500",
          DEMO_PER_CLIENT_HOURLY: "1000",
          // The simulator unless E2E_SANDBOX=1 (tests/e2e/sandbox-flow.spec.ts).
          PAYPAL_MODE: process.env.E2E_SANDBOX === "1" ? "auto" : "sim",
        },
      },
});
