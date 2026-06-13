/**
 * Phase 2.5 viewport verification (ADR-007): the layout engine is checked at
 * iPhone SE / 15 / 15 Pro Max sizes (webkit, touch) in both orientations,
 * plus a desktop chromium baseline. Screenshots land in e2e/screenshots/ and
 * are committed for review.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  webServer: {
    command: 'pnpm exec vite --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: true,
  },
  use: { baseURL: 'http://localhost:5179' },
  projects: [
    {
      name: 'iphone-se',
      use: {
        browserName: 'webkit',
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iphone-15',
      use: {
        browserName: 'webkit',
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iphone-15-pro-max',
      use: {
        browserName: 'webkit',
        viewport: { width: 430, height: 932 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
});
