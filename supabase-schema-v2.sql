-- =============================================
-- ACTUALIZACIÓN V2: CUENTAS COMPARTIDAS + FECHA
-- Ejecutar en el SQL Editor de Supabase
-- =============================================

-- 0. Agregar columnas nuevas a gastos existentes
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_date DATE;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank TEXT CHECK (bank IN ('Itaú', 'Scotiabank', 'BROU'));

-- Primero dropear el check constraint viejo
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_currency_check;
-- Actualizar los datos antes de agregar el nuevo constraint
UPDATE expenses SET currency = 'UYU' WHERE currency = 'ARS';
-- Recién ahora agregar el nuevo constraint
ALTER TABLE expenses ADD CONSTRAINT expenses_currency_check CHECK (currency IN ('UYU', 'USD'));
-- Rellenar fecha con created_at donde no haya
UPDATE expenses SET expense_date = created_at::DATE WHERE expense_date IS NULL;


-- 1. Tabla de accesos compartidos
CREATE TABLE IF NOT EXISTS shared_access (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  owner_email     TEXT NOT NULL,
  shared_with_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_with_email TEXT,
  invite_code     TEXT UNIQUE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shared_access ENABLE ROW LEVEL SECURITY;

-- El dueño puede ver y borrar sus invitaciones
CREATE POLICY "owner_manage_shares"
  ON shared_access FOR ALL
  USING (auth.uid() = owner_id);

-- El invitado puede ver las filas donde fue aceptado
CREATE POLICY "invited_can_view"
  ON shared_access FOR SELECT
  USING (auth.uid() = shared_with_id);

-- 2. Función para unirse con código (bypasa RLS de forma segura)
CREATE OR REPLACE FUNCTION join_shared_account(p_invite_code TEXT, p_user_email TEXT)
RETURNS shared_access AS $$
DECLARE
  v_row shared_access;
BEGIN
  SELECT * INTO v_row
    FROM shared_access
   WHERE invite_code = p_invite_code
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código inválido o ya utilizado';
  END IF;

  IF v_row.owner_id = auth.uid() THEN
    RAISE EXCEPTION 'No podés unirte a tu propia cuenta';
  END IF;

  UPDATE shared_access
     SET shared_with_id    = auth.uid(),
         shared_with_email = p_user_email,
         status            = 'accepted'
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Actualizar políticas de gastos para acceso compartido

-- Borrar política vieja
DROP POLICY IF EXISTS "Users can manage their own expenses" ON expenses;

-- Dueño tiene acceso completo
CREATE POLICY "owner_full_access" ON expenses
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Invitados pueden ver
CREATE POLICY "shared_can_select" ON expenses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shared_access
       WHERE owner_id = expenses.user_id
         AND shared_with_id = auth.uid()
         AND status = 'accepted'
    )
  );

-- Invitados pueden agregar (con el user_id del dueño)
CREATE POLICY "shared_can_insert" ON expenses
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM shared_access
       WHERE owner_id = user_id
         AND shared_with_id = auth.uid()
         AND status = 'accepted'
    )
  );

-- Invitados pueden editar
CREATE POLICY "shared_can_update" ON expenses
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM shared_access
       WHERE owner_id = expenses.user_id
         AND shared_with_id = auth.uid()
         AND status = 'accepted'
    )
  );

-- Invitados pueden borrar
CREATE POLICY "shared_can_delete" ON expenses
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM shared_access
       WHERE owner_id = expenses.user_id
         AND shared_with_id = auth.uid()
         AND status = 'accepted'
    )
  );
