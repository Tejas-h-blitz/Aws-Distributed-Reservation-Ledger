"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresLedgerRepository = void 0;
const pg_1 = require("pg");
class PostgresLedgerRepository {
    pool;
    constructor(config) {
        this.pool = new pg_1.Pool({
            host: config?.host || process.env.DB_HOST || "localhost",
            port: config?.port || Number(process.env.DB_PORT) || 5432,
            user: config?.user || process.env.DB_USER || "postgres",
            password: config?.password || process.env.DB_PASSWORD || "postgres",
            database: config?.database || process.env.DB_NAME || "ledger_db",
        });
    }
    async createTransaction(tx) {
        const query = `
      INSERT INTO transaction_ledger 
      (reservation_id, user_id, amount, currency, account_debited, account_credited, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
        const values = [
            tx.reservation_id,
            tx.user_id,
            tx.amount,
            tx.currency || "USD",
            tx.account_debited,
            tx.account_credited,
            tx.status || "PENDING",
        ];
        const res = await this.pool.query(query, values);
        const row = res.rows[0];
        return {
            transaction_id: row.transaction_id,
            reservation_id: row.reservation_id,
            user_id: row.user_id,
            amount: parseFloat(row.amount),
            currency: row.currency,
            account_debited: row.account_debited,
            account_credited: row.account_credited,
            status: row.status,
            created_at: row.created_at,
        };
    }
    async getTransactionByReservationId(reservationId) {
        const query = "SELECT * FROM transaction_ledger WHERE reservation_id = $1;";
        const res = await this.pool.query(query, [reservationId]);
        if (res.rows.length === 0)
            return null;
        const row = res.rows[0];
        return {
            transaction_id: row.transaction_id,
            reservation_id: row.reservation_id,
            user_id: row.user_id,
            amount: parseFloat(row.amount),
            currency: row.currency,
            account_debited: row.account_debited,
            account_credited: row.account_credited,
            status: row.status,
            created_at: row.created_at,
        };
    }
    async updateTransactionStatus(reservationId, status) {
        const query = "UPDATE transaction_ledger SET status = $1 WHERE reservation_id = $2;";
        await this.pool.query(query, [status, reservationId]);
    }
    async getAllTransactions() {
        const query = "SELECT * FROM transaction_ledger ORDER BY created_at DESC;";
        const res = await this.pool.query(query);
        return res.rows.map(row => ({
            transaction_id: row.transaction_id,
            reservation_id: row.reservation_id,
            user_id: row.user_id,
            amount: parseFloat(row.amount),
            currency: row.currency,
            account_debited: row.account_debited,
            account_credited: row.account_credited,
            status: row.status,
            created_at: row.created_at,
        }));
    }
    async close() {
        await this.pool.end();
    }
}
exports.PostgresLedgerRepository = PostgresLedgerRepository;
