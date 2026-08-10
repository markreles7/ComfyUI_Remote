import crypto from "node:crypto";

export class GpuResourceBusyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "GpuResourceBusyError";
    this.code = "GPU_RESOURCE_BUSY";
    this.statusCode = 409;
    this.details = details;
  }
}

export class GpuResourceManager {
  constructor({ releaseComfyMemory } = {}) {
    this.releaseComfyMemory = releaseComfyMemory;
    this.active = null;
    this.waiters = [];
  }

  status() {
    return {
      active: this.active ? this.#publicLease(this.active) : null,
      queued: this.waiters.map((waiter) => ({ operation: waiter.operation, queuedAt: waiter.queuedAt })),
    };
  }

  async acquire(operation = "ai-task") {
    if (this.active) {
      return new Promise((resolve, reject) => {
        this.waiters.push({
          operation,
          queuedAt: new Date().toISOString(),
          resolve,
          reject,
        });
      });
    }
    return this.#activate(operation);
  }

  async prepare(operation = "ai-task") {
    return this.acquire(operation);
  }

  release(lease) {
    if (!this.active) return { released: false, reason: "idle" };
    if (!lease?.id || lease.id !== this.active.id) {
      return {
        released: false,
        reason: "lease-mismatch",
        active: this.#publicLease(this.active),
      };
    }
    const previous = this.#publicLease(this.active);
    this.active = null;
    queueMicrotask(() => this.#drain());
    return { released: true, previous };
  }

  async run(operation, task) {
    const lease = await this.acquire(operation);
    try {
      const value = await task(lease);
      return { value, resource: this.#publicLease(lease) };
    } finally {
      this.release(lease);
    }
  }

  async #activate(operation) {
    const lease = {
      id: crypto.randomUUID(),
      operation,
      startedAt: new Date().toISOString(),
      comfy: null,
    };
    this.active = lease;
    try {
      lease.comfy = this.releaseComfyMemory ? await this.releaseComfyMemory() : null;
      if (lease.comfy?.reason === "queue-busy") {
        throw new GpuResourceBusyError(
          "ComfyUI sta usando la GPU. Attendi il termine della generazione prima di avviare questo motore.",
          { operation, comfy: lease.comfy },
        );
      }
      return lease;
    } catch (error) {
      if (this.active?.id === lease.id) this.active = null;
      queueMicrotask(() => this.#drain());
      throw error;
    }
  }

  async #drain() {
    if (this.active || !this.waiters.length) return;
    const waiter = this.waiters.shift();
    try {
      waiter.resolve(await this.#activate(waiter.operation));
    } catch (error) {
      waiter.reject(error);
    }
  }

  #publicLease(lease) {
    return {
      id: lease.id,
      operation: lease.operation,
      startedAt: lease.startedAt,
      comfy: lease.comfy,
    };
  }
}
