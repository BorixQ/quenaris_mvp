import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', timeout: 45000, expect: { timeout: 10000 }, workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL: process.env.SECURITY_BROWSER_BASE_URL || 'http://localhost:8080', headless: true,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
    trace: 'off', screenshot: 'only-on-failure',
  },
});
