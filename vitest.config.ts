import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Never touch the owner's .env keys or the live SearXNG instance from tests.
    env: { BLACKHOLE_ENV_FILE: 'off', SEARXNG_URL: 'http://127.0.0.1:9', SEARXNG_GAP_MS: '0' },
    // Tests that touch guide-page fetching stub global fetch; nothing reaches real sites.
  },
});
