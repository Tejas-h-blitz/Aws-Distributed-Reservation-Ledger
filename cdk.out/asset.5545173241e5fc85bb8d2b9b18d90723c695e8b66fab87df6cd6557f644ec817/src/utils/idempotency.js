"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdempotencyService = exports.MemoryIdempotencyStore = void 0;
class MemoryIdempotencyStore {
    cache = new Map();
    async getRecord(key) {
        const record = this.cache.get(key);
        if (!record)
            return null;
        // Check TTL
        if (Date.now() / 1000 > record.expirationTime) {
            this.cache.delete(key);
            return null;
        }
        return record;
    }
    async saveRecord(key, record) {
        this.cache.set(key, record);
    }
}
exports.MemoryIdempotencyStore = MemoryIdempotencyStore;
class IdempotencyService {
    store;
    ttlSeconds;
    constructor(store, ttlSeconds = 86400) {
        this.store = store;
        this.ttlSeconds = ttlSeconds;
    } // 24 Hours default
    /**
     * Evaluates the idempotency key.
     * If a completed response exists, returns it immediately.
     * If in progress, throws an error indicating the request is concurrent/pending.
     * Otherwise, executes the function and caches the result.
     */
    async getOrExecute(key, executeFn) {
        if (!key) {
            return await executeFn();
        }
        const existing = await this.store.getRecord(key);
        if (existing) {
            if (existing.status === "PENDING") {
                throw new Error("Concurrent request with the same idempotency key is already in progress.");
            }
            return existing.response;
        }
        // Set status to PENDING
        const expirationTime = Math.floor(Date.now() / 1000) + this.ttlSeconds;
        await this.store.saveRecord(key, {
            status: "PENDING",
            expirationTime
        });
        try {
            const response = await executeFn();
            // Update status to COMPLETED with response
            await this.store.saveRecord(key, {
                status: "COMPLETED",
                response,
                expirationTime
            });
            return response;
        }
        catch (error) {
            // Clean up the pending record on execution failure so the request can be retried
            await this.store.saveRecord(key, {
                status: "COMPLETED",
                response: { error: error.message, failed: true },
                expirationTime: Math.floor(Date.now() / 1000) + 60 // expire failed attempts in 60s
            });
            throw error;
        }
    }
}
exports.IdempotencyService = IdempotencyService;
