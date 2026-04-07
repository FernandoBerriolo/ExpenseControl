-- =============================================
-- ACTUALIZACIÓN V3: CATEGORÍAS + INGRESOS
-- Ejecutar en el SQL Editor de Supabase
-- =============================================

-- 1. Agregar columnas nuevas a la tabla de gastos
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category    TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_owed     BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Tabla de ingresos
CREATE TABLE IF NOT EXISTS incomes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  amount      DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL CHECK (currency IN ('UYU', 'USD')),
  month       TEXT NOT NULL,  -- YYYY-MM
  income_date DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE incomes ENABLE ROW LEVEL SECURITY;

-- El dueño tiene acceso completo a sus ingresos
CREATE POLICY "owner_full_access_incomes" ON incomes
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Invitados pueden ver los ingresos del dueño
CREATE POLICY "shared_can_select_incomes" ON incomes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shared_access
       WHERE owner_id = incomes.user_id
         AND shared_with_id = auth.uid()
         AND status = 'accepted'
    )
  );
