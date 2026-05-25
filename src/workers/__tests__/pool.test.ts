import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchHandle } from "../pool";
import { WorkerPool } from "../pool";

// Mock Worker that lets us control message delivery
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private posted: unknown[] = [];

  postMessage(msg: unknown) {
    this.posted.push(msg);
  }

  terminate() {
    this.onmessage = null;
    this.onerror = null;
  }

  getLastPosted() {
    return this.posted[this.posted.length - 1];
  }

  getAllPosted() {
    return [...this.posted];
  }

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  simulateError(message = "Worker error") {
    this.onerror?.(new ErrorEvent("error", { message }));
  }
}

// Capture created workers so tests can interact with them
let createdWorkers: MockWorker[] = [];

function mockWorkerConstructor() {
  const mock = new MockWorker();
  createdWorkers.push(mock);
  return mock;
}

vi.stubGlobal("Worker", vi.fn(mockWorkerConstructor));

// Stable UUID counter for deterministic IDs
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

function getWorker(index: number): MockWorker {
  const w = createdWorkers[index];
  if (!w) throw new Error(`No worker at index ${index}`);
  return w;
}

describe("WorkerPool", () => {
  let pool: WorkerPool;
  let handles: DispatchHandle[];

  function dispatch<T = unknown>(
    type: string,
    payload: unknown = null,
    timeout?: number,
  ): DispatchHandle<T> {
    const handle = pool.dispatch<T>(type, payload, timeout);
    handles.push(handle);
    return handle;
  }

  function cleanupPool() {
    for (const h of handles) {
      h.promise.catch(() => {});
    }
    pool.terminate();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    createdWorkers = [];
    handles = [];
    uuidCounter = 0;
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    pool = new WorkerPool(() => new Worker(new URL("http://localhost/worker.ts")));
  });

  afterEach(() => {
    cleanupPool();
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("creates workers lazily on first dispatch", () => {
      expect(createdWorkers).toHaveLength(0);
      dispatch("ping");
      expect(createdWorkers).toHaveLength(2);
    });

    it("only initializes once across multiple dispatches", () => {
      dispatch("ping");
      dispatch("ping");
      expect(createdWorkers).toHaveLength(2);
    });

    it("respects hardwareConcurrency clamped to 2-4", () => {
      cleanupPool();

      vi.stubGlobal("navigator", { hardwareConcurrency: 1 });
      const smallPool = new WorkerPool(() => new Worker(new URL("http://localhost/worker.ts")));
      createdWorkers = [];
      const h1 = smallPool.dispatch("ping");
      h1.promise.catch(() => {});
      expect(createdWorkers).toHaveLength(2); // min 2
      smallPool.terminate();

      vi.stubGlobal("navigator", { hardwareConcurrency: 16 });
      const bigPool = new WorkerPool(() => new Worker(new URL("http://localhost/worker.ts")));
      createdWorkers = [];
      const h2 = bigPool.dispatch("ping");
      h2.promise.catch(() => {});
      expect(createdWorkers).toHaveLength(4); // max 4
      bigPool.terminate();

      // Re-create main pool for afterEach
      vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
      pool = new WorkerPool(() => new Worker(new URL("http://localhost/worker.ts")));
    });
  });

  describe("dispatch and resolve", () => {
    it("sends message to an idle worker and resolves on response", async () => {
      const { promise } = dispatch<string>("ping");

      const worker = getWorker(0);
      const posted = worker.getLastPosted() as { id: string; type: string };
      expect(posted.type).toBe("ping");

      worker.simulateMessage({ id: posted.id, type: "ping", result: "pong" });

      await expect(promise).resolves.toBe("pong");
    });

    it("passes payload to the worker", () => {
      dispatch("encode", { text: "hello" });

      const worker = getWorker(0);
      const posted = worker.getLastPosted() as { payload: unknown };
      expect(posted.payload).toEqual({ text: "hello" });
    });

    it("rejects when worker returns an error", async () => {
      const { promise } = dispatch("bad");

      const worker = getWorker(0);
      const posted = worker.getLastPosted() as { id: string };
      worker.simulateMessage({ id: posted.id, type: "bad", error: "Unknown task" });

      await expect(promise).rejects.toThrow("Unknown task");
    });
  });

  describe("task queue", () => {
    it("queues tasks when all workers are busy", () => {
      dispatch("task1");
      dispatch("task2");
      dispatch("task3");

      expect(getWorker(0).getAllPosted()).toHaveLength(1);
      expect(getWorker(1).getAllPosted()).toHaveLength(1);
    });

    it("drains queue when a worker becomes idle", async () => {
      dispatch("task1");
      dispatch("task2");
      const { promise: p3 } = dispatch<string>("task3");

      const worker0 = getWorker(0);
      const posted = worker0.getLastPosted() as { id: string };
      worker0.simulateMessage({ id: posted.id, type: "task1", result: "done" });

      expect(worker0.getAllPosted()).toHaveLength(2);
      const task3Msg = worker0.getAllPosted()[1] as { id: string; type: string };
      expect(task3Msg.type).toBe("task3");

      worker0.simulateMessage({ id: task3Msg.id, type: "task3", result: "done3" });
      await expect(p3).resolves.toBe("done3");
    });
  });

  describe("timeout", () => {
    it("rejects after default 30s timeout", async () => {
      const { promise } = dispatch("slow");

      vi.advanceTimersByTime(30_000);

      await expect(promise).rejects.toThrow("timed out");
    });

    it("respects custom timeout", async () => {
      const { promise } = dispatch("slow", null, 5000);

      vi.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow("timed out");
    });

    it("frees worker after timeout so queue can drain", () => {
      dispatch("slow1");
      dispatch("slow2");
      dispatch("queued");

      vi.advanceTimersByTime(30_000);

      const totalPosted = createdWorkers.reduce((sum, w) => sum + w.getAllPosted().length, 0);
      expect(totalPosted).toBeGreaterThan(2);
    });
  });

  describe("cancellation", () => {
    it("cancels a running task", async () => {
      const { promise, cancel } = dispatch("long");

      cancel();

      await expect(promise).rejects.toThrow("Task cancelled");
    });

    it("cancels a queued task", async () => {
      dispatch("task1");
      dispatch("task2");
      const { promise, cancel } = dispatch("queued");

      cancel();

      await expect(promise).rejects.toThrow("Task cancelled");
    });

    it("is idempotent — calling cancel twice does not throw", async () => {
      const { promise, cancel } = dispatch("task");

      cancel();
      cancel();

      await expect(promise).rejects.toThrow("Task cancelled");
    });
  });

  describe("error handling", () => {
    it("rejects on worker error event", async () => {
      const { promise } = dispatch("crash");

      getWorker(0).simulateError("Worker crashed");

      await expect(promise).rejects.toThrow("Worker crashed");
    });

    it("frees worker after error so queue can drain", () => {
      dispatch("crash");
      dispatch("task2");
      dispatch("queued");

      getWorker(0).simulateError("crash");

      const totalPosted = createdWorkers.reduce((sum, w) => sum + w.getAllPosted().length, 0);
      expect(totalPosted).toBeGreaterThan(2);
    });
  });

  describe("terminate", () => {
    it("rejects pending tasks", async () => {
      const { promise } = dispatch("task");

      pool.terminate();

      await expect(promise).rejects.toThrow("Pool terminated");
    });

    it("rejects queued tasks", async () => {
      dispatch("task1");
      dispatch("task2");
      const { promise } = dispatch("queued");

      pool.terminate();

      await expect(promise).rejects.toThrow("Pool terminated");
    });

    it("allows re-initialization after terminate", () => {
      dispatch("first");
      expect(createdWorkers).toHaveLength(2);

      cleanupPool();
      createdWorkers = [];
      handles = [];

      dispatch("second");
      expect(createdWorkers).toHaveLength(2);
    });
  });
});
