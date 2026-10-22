const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  projects: [
    { name: 'static', metadata: { gamePath: '/index.html' } },
    { name: 'gas-bundle', metadata: { gamePath: '/build/gas/Index.html' } },
  ],
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8765',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 820, height: 1180 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: 'python3 -m http.server 8765 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8765/index.html',
    reuseExistingServer: false,
  },
});
