"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryLedgerRepository = void 0;
const uuid_1 = require("uuid");
class MemoryLedgerRepository {
    transactions = new Map();
    async createTransaction(tx) {
        // Enforce UNIQUE constraint manually
        if (this.transactions.has(tx.reservation_id)) {
            throw new Error(`Duplicate reservation_id: ${tx.reservation_id}`);
        }
        const transaction_id = (0, uuid_1.v4)();
        const created_at = new Date();
        const newTx = {
            ...tx,
            transaction_id,
            created_at,
        };
        this.transactions.set(tx.reservation_id, newTx);
        return newTx;
    }
    async getTransactionByReservationId(reservationId) {
        return this.transactions.get(reservationId) || null;
    }
    async updateTransactionStatus(reservationId, status) {
        const tx = this.transactions.get(reservationId);
        if (tx) {
            tx.status = status;
            this.transactions.set(reservationId, tx);
        }
    }
    async getAllTransactions() {
        return Array.from(this.transactions.values()).sort((a, b) => (b.created_at?.getTime() || 0) - (a.created_at?.getTime() || 0));
    }
}
exports.MemoryLedgerRepository = MemoryLedgerRepository;
