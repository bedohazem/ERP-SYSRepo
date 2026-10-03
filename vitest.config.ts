import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],

    /*
     * Repository tests create and reset SQLite databases heavily.
     * Running test files in parallel can starve Windows CI runners
     * and make beforeEach hooks exceed their timeout even though
     * the tests themselves are healthy.
     */
    fileParallelism: false,

    testTimeout: 10000,
  },
})
