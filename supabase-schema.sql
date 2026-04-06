-- =============================================
-- ESQUEMA PARA LA APP "MIS GASTOS"
-- Ejecutar en el SQL Editor de Supabase
-- =============================================

-- Tabla de gastos
CREATE TABLE IF NOT EXISTS expenses (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  amount     DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  currency   TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
  month      TEXT NOT NULL, -- Formato: YYYY-MM (ej: 2024-03)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para acelerar las búsquedas por usuario y mes
CREATE INDEX IF NOT EXISTS expenses_user_month_idx ON expenses (user_id, month);

-- Habilitar Row Level Security (RLS)
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Política: cada usuario solo puede ver y modificar sus propios gastos
CREATE POLICY "Users can manage their own expenses"
  ON expenses
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
