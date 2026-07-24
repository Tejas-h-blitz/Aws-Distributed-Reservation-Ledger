export interface Transaction {
  transaction_id?: string;
  reservation_id: string;
  user_id: string;
  amount: number;
  currency: string;
  account_debited: string;
  account_credited: string;
  status: "PENDING" | "RECONCILED" | "FLAGGED";
  created_at?: Date;
}

export interface LedgerRepository {
  createTransaction(tx: Omit<Transaction, "transaction_id" | "created_at">): Promise<Transaction>;
  getTransactionByReservationId(reservationId: string): Promise<Transaction | null>;
  updateTransactionStatus(reservationId: string, status: Transaction["status"]): Promise<void>;
  getAllTransactions(): Promise<Transaction[]>;
}
