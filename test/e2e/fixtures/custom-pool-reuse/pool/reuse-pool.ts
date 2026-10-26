import type { RunnerTestCase } from 'vitest'
import type { PoolOptions, PoolRunnerInitializer, PoolWorker, WorkerRequest, WorkerResponse } from 'vitest/node'
import { createFileTask } from '../../../../../packages/vitest/src/utils/tasks'
import { basename } from 'pathe'
import EventEmitter from 'node:events'

let workerSeq = 0
let runSeq = 0

const __vitest_worker_response__ = true

export function createReusePool(): PoolRunnerInitializer {
  return {
    name: 'reuse-pool',
    createPoolWorker: options => new ReusePoolWorker('reuse-pool', options),
  }
}

export class ReusePoolWorker implements PoolWorker {
  public readonly name: string
  protected readonly options: PoolOptions
  private readonly events = new EventEmitter()
  private readonly id = ++workerSeq

  constructor(name: string, options: PoolOptions) {
    this.name = name
    this.options = options
    this.log(`created ${this.id}`)
  }

  canReuse(): boolean {
    return true
  }

  send(request: WorkerRequest): void {
    void this.onMessage(request).then((response) => {
      if (response) {
        this.events.emit('message', response)
      }
    })
  }

  on(event: string, callback: (arg: any) => void): void {
    this.events.on(event, callback)
  }

  off(event: string, callback: (arg: any) => void): void {
    this.events.off(event, callback)
  }

  deserialize(data: unknown): unknown {
    return data
  }

  async start(): Promise<void> {
  }

  async stop(): Promise<void> {
    this.log(`stopped ${this.id}`)
  }

  private async onMessage(message: WorkerRequest): Promise<WorkerResponse | void> {
    if (message?.__vitest_worker_request__ !== true) {
      return undefined
    }

    switch (message.type) {
      case 'start': {
        return { type: 'started', __vitest_worker_response__ }
      }

      case 'run': {
        const files = message.context.files.map(file => file.filepath)
        const project = this.options.project

        for (const moduleId of files) {
          const { vitest } = project
          vitest.state.clearFiles(project)
          const taskFile = createFileTask(
            moduleId,
            project.config.root,
            project.name,
            'custom',
          )
          taskFile.mode = 'run'
          taskFile.result = { state: 'pass' }
          const taskName = 'custom test'
          const taskTest: RunnerTestCase = {
            type: 'test',
            name: taskName,
            fullName: `${taskFile.fullName} > ${taskName}`,
            fullTestName: `${taskFile.fullTestName} > ${taskName}`,
            id: `${taskFile.id}_0`,
            context: {} as any,
            suite: taskFile,
            mode: 'run',
            meta: {},
            annotations: [],
            artifacts: [],
            timeout: 0,
            file: taskFile,
            benchmarks: [],
            result: { state: 'pass' },
          }
          taskFile.tasks.push(taskTest)
          await vitest._reportFileTask(taskFile)
        }

        this.log(`run #${++runSeq} worker ${this.id} ${files.map(file => basename(file)).join(',')}`)
        return { type: 'testfileFinished', __vitest_worker_response__ }
      }

      case 'stop': {
        return { type: 'stopped', __vitest_worker_response__ }
      }
    }

    throw new Error(`Unexpected message ${JSON.stringify(message, null, 2)}`)
  }

  protected log(message: string): void {
    this.options.project.vitest.logger.console.log(`[${this.name}] ${message}`)
  }
}
