-- src/models/bootstrap_sql.sql

BEGIN;

-- 1) Core crypto tables
CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  network TEXT NOT NULL,
  token TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  token_account TEXT,
  priv_enc TEXT,
  sweep_enabled BOOLEAN DEFAULT true,
  account_id BIGINT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  account_id BIGINT,
  network TEXT NOT NULL,
  token TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  from_addr TEXT,
  to_addr TEXT,
  amount NUMERIC(38,8) NOT NULL,
  confirmations INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  swept BOOLEAN DEFAULT false,
  sweep_tx_hash TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  account_id BIGINT,
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  provider TEXT,
  provider_ref TEXT UNIQUE,
  checkout_url TEXT,
  status TEXT NOT NULL DEFAULT 'initiated',
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  account_id BIGINT,
  network TEXT NOT NULL,
  token TEXT NOT NULL,
  to_addr TEXT,
  address TEXT,  -- legacy alias
  amount NUMERIC(38,8),
  amount_cents BIGINT,
  fee_amount NUMERIC(38,8) DEFAULT 0,
  fee_cents BIGINT DEFAULT 0,
  net_cents BIGINT,
  currency TEXT DEFAULT 'usd',
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 2) Accounts / tiers
CREATE TABLE IF NOT EXISTS account_tiers (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL CHECK (code IN ('standard','pro','elite')),
  display_name TEXT NOT NULL,
  return_percent INT NOT NULL,
  min_deposit_cents INT NOT NULL,
  fee_cents INT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  tier_id INT NOT NULL REFERENCES account_tiers(id),
  account_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  balance_cents BIGINT NOT NULL DEFAULT 0,
  profit_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_wallets (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  symbol TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  priv_enc TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Safe ALTERs to normalize legacy withdrawals / deposits / wallets
-- Add columns if missing (safe on re-run)
ALTER TABLE IF EXISTS withdrawals ADD COLUMN IF NOT EXISTS account_id bigint;
ALTER TABLE IF EXISTS withdrawals ADD COLUMN IF NOT EXISTS amount_cents bigint;
ALTER TABLE IF EXISTS withdrawals ADD COLUMN IF NOT EXISTS fee_cents bigint DEFAULT 0;
ALTER TABLE IF EXISTS withdrawals ADD COLUMN IF NOT EXISTS net_cents bigint;
ALTER TABLE IF EXISTS withdrawals ADD COLUMN IF NOT EXISTS currency text DEFAULT 'usd';
ALTER TABLE IF EXISTS withdrawals ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE IF EXISTS withdrawals ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE IF EXISTS withdrawals ADD COLUMN IF NOT EXISTS tx_hash text;
ALTER TABLE IF EXISTS withdrawals ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW();

-- ensure foreign key exists (ignore if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'withdrawals_account_fk'
  ) THEN
    BEGIN
      ALTER TABLE withdrawals
        ADD CONSTRAINT withdrawals_account_fk
        FOREIGN KEY (account_id) REFERENCES accounts(id)
        ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN
      -- ignore
      NULL;
    END;
  END IF;
END$$;

-- deposit extras
ALTER TABLE IF EXISTS deposits
  ADD COLUMN IF NOT EXISTS swept BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS sweep_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS account_id BIGINT;

-- wallets extras
ALTER TABLE IF EXISTS wallets
  ADD COLUMN IF NOT EXISTS sweep_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES accounts(id);

-- helpful indexes
CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);
CREATE INDEX IF NOT EXISTS account_wallets_account_id_idx ON account_wallets(account_id);
CREATE INDEX IF NOT EXISTS deposits_user_acct_idx ON deposits(user_id, account_id);
CREATE INDEX IF NOT EXISTS withdrawals_account_id_idx ON withdrawals(account_id);

COMMIT;


-- Seed/refresh tiers (idempotent)
BEGIN;
INSERT INTO account_tiers (code, display_name, return_percent, min_deposit_cents, fee_cents)
VALUES 
  ('standard','Standard Account',15,   2000,    0),
  ('pro',     'Pro Account',     20,  20000, 2000),
  ('elite',   'Elite Account',   25, 100000, 5000)
ON CONFLICT (code) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      return_percent = EXCLUDED.return_percent,
      min_deposit_cents = EXCLUDED.min_deposit_cents,
      fee_cents = EXCLUDED.fee_cents;
COMMIT;

-- End of bootstrap SQL
