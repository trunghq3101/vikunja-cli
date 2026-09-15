import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['smoke/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
