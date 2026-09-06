import { defineConfig } from 'vitest/config'

// Pure-logic tests only — no svelte components, no DOM, no browser shims.
// Keeping the environment as `node` (the default) keeps the suite fast and
// means adding tests for utility modules does not pull in a DOM polyfill.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
