import { defineConfig, devices } from '@playwright/test'

// E2E contra una app ya levantada (staging o local): E2E_BASE_URL, y un tutor con permiso de crear hijos
// en E2E_EMAIL / E2E_PASSWORD. Se llaman *.e2e.ts para que vitest no los recoja.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    ...devices['iPhone 13'],
    defaultBrowserType: 'chromium',
    serviceWorkers: 'block', // sin SW: siempre la build actual, nunca una cacheada
    trace: 'retain-on-failure',
  },
})
