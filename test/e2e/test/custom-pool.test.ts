import type { PoolOptions } from 'vitest/node'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { editFile, runVitest, StableTestFileOrderSorter } from '../../test-utils'
import { ReusePoolWorker } from '../fixtures/custom-pool-reuse/pool/reuse-pool'

test('can run custom pools with Vitest', async () => {
  const vitest = await runVitest({
    root: './fixtures/custom-pool',
    reporters: [['default', { isTTY: false }]],
  })

  expect(vitest.stderr).toMatchInlineSnapshot(`
    "[pool] printing: options are respected
    [pool] array option [ 1, 2, 3 ]
    [pool] running tests for custom-pool-test in /fixtures/custom-pool/tests/custom-not-run.spec.ts
    [pool] custom pool is closed!
    "
  `)

  expect(vitest.stdout).toContain('✓ |custom-pool-test| tests/custom-not-run.spec.ts')
  expect(vitest.stdout).toContain('✓ |threads-pool-test| tests/custom-run.threads.spec.ts')
  expect(vitest.stdout).toContain('Test Files  2 passed')
  expect(vitest.stdout).toContain('Tests  2 passed')
})

test('custom pool can deliver the first message while the worker registers its listener', async () => {
  const vitest = await runVitest({
    root: './fixtures/custom-pool-sync-transport',
    reporters: [['default', { isTTY: false }]],
  })

  expect(vitest.stderr).toBe('')
  expect(vitest.stdout).toContain('✓ |sync-transport-pool-test| tests/basic.spec.ts')
  expect(vitest.stdout).toContain('Test Files  1 passed')
  expect(vitest.stdout).toContain('Tests  1 passed')
})

test('custom pool workers with canReuse are parked between isolated test files in watch mode', async () => {
  const { vitest, ctx } = await runVitest({
    root: './fixtures/custom-pool-reuse',
    watch: true,
    reporters: [['default', { isTTY: false }]],
    sequence: { sequencer: StableTestFileOrderSorter },
  })

  await vitest.waitForStdout('[reuse-pool] run #2 worker 2 b.test.ts')
  await vitest.waitForStdout('Test Files  2 passed')

  expect(vitest.stderr).toBe('')
  expect(poolEvents(vitest.stdout)).toMatchInlineSnapshot(`
    [
      "[reuse-pool] created 1",
      "[reuse-pool] run #1 worker 1 a.test.ts",
      "[reuse-pool] created 2",
      "[reuse-pool] run #2 worker 2 b.test.ts",
    ]
  `)
  // parked workers stay alive until Vitest closes
  expect(vitest.stdout).not.toContain('[reuse-pool] stopped')

  await ctx!.close()

  expect(vitest.stdout).toContain('[reuse-pool] stopped 1')
  expect(vitest.stdout).toContain('[reuse-pool] stopped 2')
})

test('custom pool workers with canReuse are reused across watch mode reruns', async () => {
  const { vitest } = await runVitest({
    root: './fixtures/custom-pool-reuse',
    watch: true,
    reporters: [['default', { isTTY: false }]],
    sequence: { sequencer: StableTestFileOrderSorter },
  })

  await vitest.waitForStdout('[reuse-pool] run #2 worker 2 b.test.ts')

  editFile(
    resolve(import.meta.dirname, '../fixtures/custom-pool-reuse/tests/a.test.ts'),
    (content) => `${content}\n`,
  )
  await vitest.waitForStdout('[reuse-pool] run #3 worker 1 a.test.ts')

  expect(vitest.stderr).toBe('')
  expect(vitest.stdout).not.toContain('[reuse-pool] created 3')
  expect(vitest.stdout).not.toContain('[reuse-pool] stopped 1')
})

test('custom pool workers with canReuse are terminated after the run without watch mode', async () => {
  const vitest = await runVitest({
    root: './fixtures/custom-pool-reuse',
    reporters: [['default', { isTTY: false }]],
    sequence: { sequencer: StableTestFileOrderSorter },
  })

  expect(vitest.stderr).toBe('')
  expect(vitest.stdout).toContain('Test Files  2 passed')
  expect(vitest.stdout).toContain('[reuse-pool] stopped 1')
  expect(vitest.stdout).toContain('[reuse-pool] stopped 2')
  expect(poolEvents(vitest.stdout)).toMatchInlineSnapshot(`
    [
      "[reuse-pool] created 1",
      "[reuse-pool] run #1 worker 1 a.test.ts",
      "[reuse-pool] created 2",
      "[reuse-pool] run #2 worker 2 b.test.ts",
    ]
  `)
})

test('custom pool worker that declines reuse behaves like no reuse', async () => {
  const { vitest } = await runVitest({
    root: './fixtures/custom-pool-reuse',
    config: false,
    include: ['tests/*.test.ts'],
    watch: true,
    reporters: [['default', { isTTY: false }]],
    sequence: { sequencer: StableTestFileOrderSorter },
    pool: {
      name: 'decline-pool',
      createPoolWorker: (options) => new DeclinePoolWorker(options),
    },
  })

  await vitest.waitForStdout('[decline-pool] run #2 worker 2 b.test.ts')

  editFile(
    resolve(import.meta.dirname, '../fixtures/custom-pool-reuse/tests/a.test.ts'),
    (content) => `${content}\n`,
  )
  await vitest.waitForStdout('[decline-pool] run #3 worker 3 a.test.ts')

  expect(vitest.stderr).toBe('')
  expect(vitest.stdout).toContain('[decline-pool] created 3')
  expect(vitest.stdout).toContain('[decline-pool] stopped 1')
  expect(vitest.stdout).toContain('[decline-pool] stopped 2')
})

class DeclinePoolWorker extends ReusePoolWorker {
  constructor(options: PoolOptions) {
    super('decline-pool', options)
  }

  canReuse(): boolean {
    return false
  }
}

function poolEvents(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('[reuse-pool]') && !line.startsWith('[reuse-pool] stopped'))
}
