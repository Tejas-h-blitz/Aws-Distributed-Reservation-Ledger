"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryInventoryRepository = void 0;
class MemoryInventoryRepository {
    stockMap = new Map();
    isUnreachable = false;
    setUnreachable(status) {
        this.isUnreachable = status;
    }
    async decrementStock(eventId) {
        if (this.isUnreachable) {
            throw new Error("Redis connection failure (simulated).");
        }
        const current = this.stockMap.get(eventId) ?? -1;
        if (current === -1) {
            throw new Error(`Inventory key inventory:${eventId} is not initialized in Redis.`);
        }
        if (current > 0) {
            this.stockMap.set(eventId, current - 1);
            return true;
        }
        return false;
    }
    async incrementStock(eventId) {
        if (this.isUnreachable) {
            throw new Error("Redis connection failure (simulated).");
        }
        const current = this.stockMap.get(eventId) ?? -1;
        if (current !== -1) {
            this.stockMap.set(eventId, current + 1);
        }
    }
    async getCurrentStock(eventId) {
        if (this.isUnreachable) {
            throw new Error("Redis connection failure (simulated).");
        }
        return this.stockMap.get(eventId) ?? -1;
    }
    async setStock(eventId, count) {
        if (this.isUnreachable) {
            throw new Error("Redis connection failure (simulated).");
        }
        this.stockMap.set(eventId, count);
    }
}
exports.MemoryInventoryRepository = MemoryInventoryRepository;
