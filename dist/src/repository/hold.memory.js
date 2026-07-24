"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryHoldRepository = void 0;
class MemoryHoldRepository {
    holds = new Map();
    async createHold(hold) {
        if (this.holds.has(hold.HoldID)) {
            const err = new Error("The conditional request failed: HoldID already exists.");
            err.name = "ConditionalCheckFailedException";
            throw err;
        }
        this.holds.set(hold.HoldID, {
            ...hold,
            Version: 1,
        });
    }
    async getHold(holdId) {
        return this.holds.get(holdId) || null;
    }
    async updateHoldStatus(holdId, status, expectedVersion) {
        const hold = this.holds.get(holdId);
        if (!hold) {
            throw new Error("Transaction hold record not found.");
        }
        if (hold.Version !== expectedVersion) {
            const err = new Error("The conditional request failed: Version mismatch (OCC failure).");
            err.name = "ConditionalCheckFailedException";
            throw err;
        }
        hold.Status = status;
        hold.Version += 1;
        this.holds.set(holdId, hold);
    }
    async deleteHold(holdId) {
        this.holds.delete(holdId);
    }
    async getHoldsByEventId(eventId) {
        return Array.from(this.holds.values()).filter(h => h.EventID === eventId);
    }
    async getAllHolds() {
        return Array.from(this.holds.values());
    }
}
exports.MemoryHoldRepository = MemoryHoldRepository;
