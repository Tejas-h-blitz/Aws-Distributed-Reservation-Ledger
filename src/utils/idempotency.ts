export interface IdempotencyRecord {
  status: "PENDING" | "COMPLETED";
  response?: any;
  expirationTime: number; // epoch timestamp in seconds
  requestHash?: string;
}

export interface IdempotencyStore {
  getRecord(key: string): Promise<IdempotencyRecord | null>;
  saveRecord(key: string, record: IdempotencyRecord): Promise<void>;
  acquirePending(
    key: string,
    requestHash: string,
    expirationTime: number
  ): Promise<IdempotencyAcquireResult>;
  completePending(
    key: string,
    requestHash: string,
    response: any,
    expirationTime: number
  ): Promise<"COMPLETED" | "STALE" | "MISMATCH">;
}

export type IdempotencyAcquireResult =
  | { outcome: "ACQUIRED" }
  | { outcome: "COMPLETED"; response: any }
  | { outcome: "PENDING" }
  | { outcome: "MISMATCH" };

export class MemoryIdempotencyStore implements IdempotencyStore {
  private cache = new Map<string, IdempotencyRecord>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(cleanupIntervalMs?: number) {
    if (cleanupIntervalMs) {
      this.cleanupInterval = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  public stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  public cleanupExpired(): void {
    const now = Date.now() / 1000;
    for (const [key, record] of this.cache.entries()) {
      if (now > record.expirationTime) {
        this.cache.delete(key);
      }
    }
  }

  // Get size of cache (helpful for unit testing)
  public getCacheSize(): number {
    return this.cache.size;
  }

  async getRecord(key: string): Promise<IdempotencyRecord | null> {
    const record = this.cache.get(key);
    if (!record) return null;
    
    // Check TTL
    if (Date.now() / 1000 > record.expirationTime) {
      this.cache.delete(key);
      return null;
    }
    return record;
  }

  async saveRecord(key: string, record: IdempotencyRecord): Promise<void> {
    this.cache.set(key, record);
  }

  async acquirePending(
    key: string,
    requestHash: string,
    expirationTime: number
  ): Promise<IdempotencyAcquireResult> {
    const existing = this.cache.get(key);
    const now = Date.now() / 1000;
    if (existing && now > existing.expirationTime) {
      this.cache.delete(key);
    } else if (existing) {
      if (existing.requestHash && existing.requestHash !== requestHash) {
        return { outcome: "MISMATCH" };
      }
      if (existing.status === "COMPLETED") {
        return { outcome: "COMPLETED", response: existing.response };
      }
      return { outcome: "PENDING" };
    }

    this.cache.set(key, {
      status: "PENDING",
      requestHash,
      expirationTime,
    });
    return { outcome: "ACQUIRED" };
  }

  async completePending(
    key: string,
    requestHash: string,
    response: any,
    expirationTime: number
  ): Promise<"COMPLETED" | "STALE" | "MISMATCH"> {
    const existing = this.cache.get(key);
    if (!existing || Date.now() / 1000 > existing.expirationTime) {
      if (existing) this.cache.delete(key);
      return "STALE";
    }
    if (existing.requestHash !== requestHash) {
      return "MISMATCH";
    }
    if (existing.status === "COMPLETED") {
      return "COMPLETED";
    }

    this.cache.set(key, {
      status: "COMPLETED",
      requestHash,
      response,
      expirationTime,
    });
    return "COMPLETED";
  }
}

export class IdempotencyService {
  constructor(private store: IdempotencyStore, private ttlSeconds = 86400) {} // 24 Hours default

  private requestHash(requestPayload: unknown): string {
    const payload = typeof requestPayload === "undefined"
      ? ""
      : JSON.stringify(requestPayload);
    return require("node:crypto").createHash("sha256").update(payload).digest("hex");
  }

  /**
   * Evaluates the idempotency key.
   * If a completed response exists, returns it immediately.
   * If in progress, throws an error indicating the request is concurrent/pending.
   * Otherwise, executes the function and caches the result.
   */
  public async getOrExecute<T>(
    key: string,
    executeFn: () => Promise<T>,
    requestPayload?: unknown
  ): Promise<T> {
    if (!key) {
      return await executeFn();
    }

    const requestHash = this.requestHash(requestPayload);
    const expirationTime = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const acquired = await this.store.acquirePending(key, requestHash, expirationTime);
    if (acquired.outcome === "COMPLETED") {
      return acquired.response as T;
    }
    if (acquired.outcome === "PENDING") {
      throw new Error("Concurrent request with the same idempotency key is already in progress.");
    }
    if (acquired.outcome === "MISMATCH") {
      throw new Error("Idempotency key was reused with a different request payload.");
    }

    try {
      const response = await executeFn();
      await this.store.completePending(key, requestHash, response, expirationTime);

      return response;
    } catch (error) {
      await this.store.completePending(
        key,
        requestHash,
        { error: (error as Error).message, failed: true },
        Math.floor(Date.now() / 1000) + 60
      );
      throw error;
    }
  }
}
