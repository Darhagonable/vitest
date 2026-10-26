import { defineConfig } from 'vitest/config'
import { createReusePool } from './pool/reuse-pool'

export default defineConfig({
  test: {
    name: 'reuse-pool-test',
    pool: createReusePool(),
  },
})
