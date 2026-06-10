// Тесты прототипов открывают HTML-файлы напрямую через file:// — сервер не нужен.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
  },
  projects: [{ name: 'chromium' }],
});
