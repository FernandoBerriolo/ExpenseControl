-- =============================================
-- ACTUALIZACIÓN V4: REGISTRO DE TELÉFONOS (WhatsApp)
-- Ejecutar en el SQL Editor de Supabase
-- =============================================

-- Tabla que mapea número de WhatsApp → usuario de la app
CREATE TABLE IF NOT EXISTS phone_users (
  phone    TEXT PRIMARY KEY,  -- número en formato internacional, ej: "59899123456"
  user_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE phone_users ENABLE ROW LEVEL SECURITY;

-- Cada usuario puede ver y gestionar solo su propio número
CREATE POLICY "owner_manage_phone" ON phone_users
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
