import { LedgerRepository, Transaction } from "./ledger.interface";
import { v4 as uuidv4 } from "uuid";

export class MemoryLedgerRepository implements LedgerRepository {
  private transactions: Map<string, Transaction> = new Map();

  async createTransaction(tx: Omit<Transaction, "transaction_id" | "created_at">): Promise<Transaction> {
    // Enforce UNIQUE constraint manually
    if (this.transactions.has(tx.reservation_id)) {
      throw new Error(`Duplicate reservation_id: ${tx.reservation_id}`);
    }

    const transaction_id = uuidv4();
    const created_at = new Date();
    const newTx: Transaction = {
      ...tx,
      transaction_id,
      created_at,
    };
    this.transactions.set(tx.reservation_id, newTx);
    return newTx;
  }

  async getTransactionByReservationId(reservationId: string): Promise<Transaction | null> {
    return this.transactions.get(reservationId) || null;
  }

  async updateTransactionStatus(reservationId: string, status: Transaction["status"]): Promise<void> {
    const tx = this.transactions.get(reservationId);
    if (tx) {
      tx.status = status;
      this.transactions.set(reservationId, tx);
    }
  }

  async getAllTransactions(): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).sort(
      (a, b) => (b.created_at?.getTime() || 0) - (a.created_at?.getTime() || 0)
    );
  }
}
