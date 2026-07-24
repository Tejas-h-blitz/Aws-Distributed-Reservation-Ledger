-- Create pgcrypto extension for gen_random_uuid() support
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS transaction_ledger (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id VARCHAR(64) NOT NULL UNIQUE,
    user_id VARCHAR(64) NOT NULL,
    amount DECIMAL(12,4) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    account_debited VARCHAR(64) NOT NULL,
    account_credited VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING', -- PENDING, RECONCILED, FLAGGED
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_reservation ON transaction_ledger(reservation_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON transaction_ledger(user_id);
