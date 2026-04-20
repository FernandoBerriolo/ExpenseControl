-- v7: Add type column to incomes table to support savings entries
ALTER TABLE incomes ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'income'
  CHECK (type IN ('income', 'savings'));
