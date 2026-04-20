-- v8: User settings, payment methods, EUR support, legacy migration

-- 1. Update currency constraints to allow EUR
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_currency_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_currency_check CHECK (currency IN ('UYU', 'USD', 'EUR'));

ALTER TABLE incomes DROP CONSTRAINT IF EXISTS incomes_currency_check;
ALTER TABLE incomes ADD CONSTRAINT incomes_currency_check CHECK (currency IN ('UYU', 'USD', 'EUR'));

-- 2. User settings table
CREATE TABLE IF NOT EXISTS user_settings (
  user_id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  currencies        TEXT[] NOT NULL DEFAULT ARRAY['UYU', 'USD'],
  default_currency  TEXT NOT NULL DEFAULT 'UYU' CHECK (default_currency IN ('UYU', 'USD', 'EUR')),
  is_legacy         BOOLEAN NOT NULL DEFAULT FALSE,
  setup_completed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id);

-- 3. Payment methods table
CREATE TABLE IF NOT EXISTS payment_methods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'cash')),
  closing_day INTEGER CHECK (closing_day >= 1 AND closing_day <= 31),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own payment methods" ON payment_methods
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS payment_methods_user_idx ON payment_methods(user_id);

-- 4. Mark ALL existing users as legacy (they keep their current setup)
INSERT INTO user_settings (user_id, currencies, default_currency, is_legacy, setup_completed)
SELECT id, ARRAY['UYU', 'USD'], 'UYU', TRUE, TRUE
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 5. Insert legacy payment methods for all existing users
-- Efectivo (cash) - for everyone
INSERT INTO payment_methods (user_id, name, type, closing_day, sort_order)
SELECT u.id, 'Efectivo', 'cash', NULL, 0
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm WHERE pm.user_id = u.id AND pm.name = 'Efectivo'
);

-- Itaú (credit, closing day 26)
INSERT INTO payment_methods (user_id, name, type, closing_day, sort_order)
SELECT u.id, 'Itaú', 'credit', 26, 1
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm WHERE pm.user_id = u.id AND pm.name = 'Itaú'
);

-- BROU (credit, closing day 25)
INSERT INTO payment_methods (user_id, name, type, closing_day, sort_order)
SELECT u.id, 'BROU', 'credit', 25, 2
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm WHERE pm.user_id = u.id AND pm.name = 'BROU'
);

-- Scotiabank (credit, no closing day configured)
INSERT INTO payment_methods (user_id, name, type, closing_day, sort_order)
SELECT u.id, 'Scotiabank', 'credit', NULL, 3
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm WHERE pm.user_id = u.id AND pm.name = 'Scotiabank'
);
