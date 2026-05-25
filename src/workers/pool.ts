import DiffWorker from "./worker.ts?worker";

export interface TaskMessage {
  id: string;
  type: string;
  payload: unknown;
}

export interface TaskResult {
  id: string;
  type: string;
  result?: unknown;
  error?: string;
}

interface PendingTask {
  id: string;
  resolve: (result: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedTask {
  message: TaskMessage;
  resolve: (result: unknown) => void;
  reject: (reason: Error) => void;
  timeout: number;
}

interface WorkerEntry {
  worker: Worker;
  busy: boolean;
  currentTask: PendingTask | null;
}

export interface DispatchHandle<T = unknown> {
  promise: Promise<T>;
  cancel: () => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class WorkerPool {
  private readonly workerFactory: () => Worker;
  private readonly poolSize: number;
  private workers: WorkerEntry[] = [];
  private initialized = false;
  private nextWorkerIndex = 0;
  private readonly queue: QueuedTask[] = [];
  private readonly pendingTasks = new Map<string, PendingTask>();

  constructor(workerFactory: () => Worker) {
    this.workerFactory = workerFactory;
    this.poolSize = Math.max(2, Math.min(4, navigator.hardwareConcurrency || 2));
  }

  private init(): void {
    if (this.initialized) return;
    this.initialized = true;

    for (let i = 0; i < this.poolSize; i++) {
      const worker = this.workerFactory();
      const entry: WorkerEntry = {
        worker,
        busy: false,
        currentTask: null,
      };

      worker.onmessage = (e: MessageEvent<TaskResult>) => {
        const { id, error, result } = e.data;
        const pending = this.pendingTasks.get(id);
        if (!pending) return;

        clearTimeout(pending.timer);
        this.pendingTasks.delete(id);
        entry.busy = false;
        entry.currentTask = null;

        if (error !== undefined) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }

        this.drainQueue();
      };

      worker.onerror = (ev: ErrorEvent) => {
        if (entry.currentTask) {
          const pending = entry.currentTask;
          clearTimeout(pending.timer);
          this.pendingTasks.delete(pending.id);
          entry.busy = false;
          entry.currentTask = null;
          pending.reject(new Error(ev.message || "Worker error"));
        }
        this.drainQueue();
      };

      this.workers.push(entry);
    }
  }

  dispatch<T = unknown>(
    type: string,
    payload: unknown = null,
    timeout: number = DEFAULT_TIMEOUT_MS,
  ): DispatchHandle<T> {
    this.init();

    const id = crypto.randomUUID();
    const message: TaskMessage = { id, type, payload };

    let taskResolve!: (value: T) => void;
    let taskReject!: (reason: Error) => void;
    let cancelled = false;

    const promise = new Promise<T>((resolve, reject) => {
      taskResolve = resolve;
      taskReject = reject;
    });

    const cancel = () => {
      if (cancelled) return;
      cancelled = true;

      const pending = this.pendingTasks.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingTasks.delete(id);

        const entry = this.workers.find((w) => w.currentTask?.id === id);
        if (entry) {
          entry.busy = false;
          entry.currentTask = null;
          this.drainQueue();
        }

        pending.reject(new Error("Task cancelled"));
        return;
      }

      const queueIndex = this.queue.findIndex((q) => q.message.id === id);
      if (queueIndex !== -1) {
        this.queue.splice(queueIndex, 1);
        taskReject(new Error("Task cancelled"));
      }
    };

    const idle = this.findIdleWorker();
    if (idle) {
      this.assignTask(idle, message, taskResolve, taskReject, timeout);
    } else {
      this.queue.push({
        message,
        resolve: taskResolve,
        reject: taskReject,
        timeout,
      });
    }

    return { promise, cancel };
  }

  private findIdleWorker(): WorkerEntry | undefined {
    for (let i = 0; i < this.poolSize; i++) {
      const index = (this.nextWorkerIndex + i) % this.poolSize;
      const entry = this.workers[index];
      if (entry && !entry.busy) {
        this.nextWorkerIndex = (index + 1) % this.poolSize;
        return entry;
      }
    }
    return undefined;
  }

  private assignTask(
    entry: WorkerEntry,
    message: TaskMessage,
    resolve: (value: never) => void,
    reject: (reason: Error) => void,
    timeout: number,
  ): void {
    const timer = setTimeout(() => {
      this.pendingTasks.delete(message.id);
      entry.busy = false;
      entry.currentTask = null;
      reject(new Error(`Task ${message.id} timed out after ${timeout}ms`));
      this.drainQueue();
    }, timeout);

    const pending: PendingTask = {
      id: message.id,
      resolve,
      reject,
      timer,
    };

    entry.busy = true;
    entry.currentTask = pending;
    this.pendingTasks.set(message.id, pending);
    entry.worker.postMessage(message);
  }

  private drainQueue(): void {
    while (this.queue.length > 0) {
      const idle = this.findIdleWorker();
      if (!idle) break;

      const queued = this.queue.shift();
      if (!queued) break;
      this.assignTask(idle, queued.message, queued.resolve, queued.reject, queued.timeout);
    }
  }

  terminate(): void {
    for (const entry of this.workers) {
      if (entry.currentTask) {
        clearTimeout(entry.currentTask.timer);
        entry.currentTask.reject(new Error("Pool terminated"));
        this.pendingTasks.delete(entry.currentTask.id);
      }
      entry.worker.terminate();
    }

    for (const queued of this.queue) {
      queued.reject(new Error("Pool terminated"));
    }

    this.queue.length = 0;
    this.workers = [];
    this.initialized = false;
    this.nextWorkerIndex = 0;
  }
}

export const workerPool = new WorkerPool(() => new DiffWorker());
