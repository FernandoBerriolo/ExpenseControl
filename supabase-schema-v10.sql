-- v10: "Mi apartamento" compartido — los datos pasan de ser por usuario a ser por hogar (home).
-- Correr DESPUÉS de supabase-schema-v9.sql. Es idempotente y migra datos existentes si los hubiera.
-- Nota: si ya habías subido archivos con la v9, quedaron en la carpeta <user_id>/ y dejan de ser
-- accesibles (ahora la carpeta es <home_id>/). Si no subiste nada todavía, no pasa nada.

-- 1. Hogares y miembros
CREATE TABLE IF NOT EXISTS rental_homes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL DEFAULT 'Mi apartamento',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rental_home_members (
  home_id     UUID NOT NULL REFERENCES rental_homes(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (home_id, user_id),
  UNIQUE (user_id)   -- por ahora cada persona pertenece a un solo hogar
);

-- 2. Funciones auxiliares (SECURITY DEFINER para no caer en recursión de RLS)
CREATE OR REPLACE FUNCTION is_rental_member(p_home UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM rental_home_members WHERE home_id = p_home AND user_id = auth.uid()
  )
$$;

-- Para Storage: la primera carpeta de la ruta es el id del hogar
CREATE OR REPLACE FUNCTION rental_storage_member(p_name TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN is_rental_member(((storage.foldername(p_name))[1])::uuid);
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END
$$;

-- Devuelve el hogar de quien llama; si no tiene, le crea uno propio
CREATE OR REPLACE FUNCTION rental_ensure_home()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_home  UUID;
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT home_id INTO v_home FROM rental_home_members WHERE user_id = auth.uid();
  IF v_home IS NOT NULL THEN RETURN v_home; END IF;

  BEGIN
    INSERT INTO rental_homes DEFAULT VALUES RETURNING id INTO v_home;
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
    INSERT INTO rental_home_members (home_id, user_id, user_email) VALUES (v_home, auth.uid(), v_email);
  EXCEPTION WHEN unique_violation THEN
    -- dos llamadas a la vez: nos quedamos con el hogar que ganó
    SELECT home_id INTO v_home FROM rental_home_members WHERE user_id = auth.uid();
  END;
  RETURN v_home;
END
$$;

REVOKE ALL ON FUNCTION rental_ensure_home() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rental_ensure_home() TO authenticated;
GRANT EXECUTE ON FUNCTION is_rental_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rental_storage_member(TEXT) TO authenticated;

-- 3. Agregar home_id a las tablas de la v9
ALTER TABLE rental_settings  ADD COLUMN IF NOT EXISTS home_id UUID REFERENCES rental_homes(id) ON DELETE CASCADE;
ALTER TABLE rental_charges   ADD COLUMN IF NOT EXISTS home_id UUID REFERENCES rental_homes(id) ON DELETE CASCADE;
ALTER TABLE rental_receipts  ADD COLUMN IF NOT EXISTS home_id UUID REFERENCES rental_homes(id) ON DELETE CASCADE;
ALTER TABLE rental_documents ADD COLUMN IF NOT EXISTS home_id UUID REFERENCES rental_homes(id) ON DELETE CASCADE;

-- 4. Migrar datos existentes: un hogar por usuario que ya tenga algo cargado
DO $migrate$
DECLARE
  r      RECORD;
  v_home UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM rental_settings
      UNION SELECT user_id FROM rental_charges
      UNION SELECT user_id FROM rental_receipts
      UNION SELECT user_id FROM rental_documents
    ) t WHERE user_id IS NOT NULL
  LOOP
    IF NOT EXISTS (SELECT 1 FROM rental_home_members WHERE user_id = r.user_id) THEN
      INSERT INTO rental_homes DEFAULT VALUES RETURNING id INTO v_home;
      INSERT INTO rental_home_members (home_id, user_id, user_email)
      SELECT v_home, r.user_id, email FROM auth.users WHERE id = r.user_id;
    END IF;
  END LOOP;
END
$migrate$;

UPDATE rental_settings  t SET home_id = (SELECT m.home_id FROM rental_home_members m WHERE m.user_id = t.user_id) WHERE t.home_id IS NULL;
UPDATE rental_charges   t SET home_id = (SELECT m.home_id FROM rental_home_members m WHERE m.user_id = t.user_id) WHERE t.home_id IS NULL;
UPDATE rental_receipts  t SET home_id = (SELECT m.home_id FROM rental_home_members m WHERE m.user_id = t.user_id) WHERE t.home_id IS NULL;
UPDATE rental_documents t SET home_id = (SELECT m.home_id FROM rental_home_members m WHERE m.user_id = t.user_id) WHERE t.home_id IS NULL;

ALTER TABLE rental_settings  ALTER COLUMN home_id SET NOT NULL;
ALTER TABLE rental_charges   ALTER COLUMN home_id SET NOT NULL;
ALTER TABLE rental_receipts  ALTER COLUMN home_id SET NOT NULL;
ALTER TABLE rental_documents ALTER COLUMN home_id SET NOT NULL;

-- 5. rental_settings: la clave pasa a ser el hogar
DO $pk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'rental_settings'::regclass AND i.indisprimary
      AND (SELECT attname FROM pg_attribute WHERE attrelid = i.indrelid AND attnum = i.indkey[0]) = 'home_id'
  ) THEN
    ALTER TABLE rental_settings DROP CONSTRAINT rental_settings_pkey;
    ALTER TABLE rental_settings ADD PRIMARY KEY (home_id);
  END IF;
END
$pk$;

-- 6. user_id pasa a ser "quién lo cargó": si esa persona borra su cuenta, los datos del hogar quedan
ALTER TABLE rental_settings  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE rental_charges   ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE rental_receipts  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE rental_documents ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE rental_settings  DROP CONSTRAINT IF EXISTS rental_settings_user_id_fkey;
ALTER TABLE rental_charges   DROP CONSTRAINT IF EXISTS rental_charges_user_id_fkey;
ALTER TABLE rental_receipts  DROP CONSTRAINT IF EXISTS rental_receipts_user_id_fkey;
ALTER TABLE rental_documents DROP CONSTRAINT IF EXISTS rental_documents_user_id_fkey;
ALTER TABLE rental_settings  ADD CONSTRAINT rental_settings_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE rental_charges   ADD CONSTRAINT rental_charges_user_id_fkey   FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE rental_receipts  ADD CONSTRAINT rental_receipts_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE rental_documents ADD CONSTRAINT rental_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 7. Un solo cargo por rubro y mes, ahora por hogar
DROP INDEX IF EXISTS rental_charges_kind_period_uniq;
DROP INDEX IF EXISTS rental_charges_user_period_idx;
CREATE UNIQUE INDEX IF NOT EXISTS rental_charges_home_kind_period_uniq
  ON rental_charges(home_id, kind, period) WHERE kind <> 'otro';
CREATE INDEX IF NOT EXISTS rental_charges_home_period_idx ON rental_charges(home_id, period);
CREATE INDEX IF NOT EXISTS rental_receipts_home_idx ON rental_receipts(home_id);
CREATE INDEX IF NOT EXISTS rental_documents_home_idx ON rental_documents(home_id);

-- 8. Policies por hogar (cualquier miembro puede ver y editar todo)
ALTER TABLE rental_homes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members select home" ON rental_homes;
DROP POLICY IF EXISTS "Members update home" ON rental_homes;
CREATE POLICY "Members select home" ON rental_homes FOR SELECT USING (is_rental_member(id));
CREATE POLICY "Members update home" ON rental_homes FOR UPDATE USING (is_rental_member(id)) WITH CHECK (is_rental_member(id));

ALTER TABLE rental_home_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members select members" ON rental_home_members;
CREATE POLICY "Members select members" ON rental_home_members FOR SELECT USING (is_rental_member(home_id));
-- Sin policies de escritura: los miembros se agregan solo con rental_ensure_home() o desde el SQL Editor.

-- rental_settings
DROP POLICY IF EXISTS "Users select own rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Users insert own rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Users update own rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Users delete own rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Members select rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Members insert rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Members update rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Members delete rental settings" ON rental_settings;
CREATE POLICY "Members select rental settings" ON rental_settings FOR SELECT USING (is_rental_member(home_id));
CREATE POLICY "Members insert rental settings" ON rental_settings FOR INSERT WITH CHECK (is_rental_member(home_id));
CREATE POLICY "Members update rental settings" ON rental_settings FOR UPDATE USING (is_rental_member(home_id)) WITH CHECK (is_rental_member(home_id));
CREATE POLICY "Members delete rental settings" ON rental_settings FOR DELETE USING (is_rental_member(home_id));

-- rental_charges
DROP POLICY IF EXISTS "Users select own rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Users insert own rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Users update own rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Users delete own rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Members select rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Members insert rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Members update rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Members delete rental charges" ON rental_charges;
CREATE POLICY "Members select rental charges" ON rental_charges FOR SELECT USING (is_rental_member(home_id));
CREATE POLICY "Members insert rental charges" ON rental_charges FOR INSERT WITH CHECK (is_rental_member(home_id));
CREATE POLICY "Members update rental charges" ON rental_charges FOR UPDATE USING (is_rental_member(home_id)) WITH CHECK (is_rental_member(home_id));
CREATE POLICY "Members delete rental charges" ON rental_charges FOR DELETE USING (is_rental_member(home_id));

-- rental_receipts (el cargo tiene que ser del mismo hogar)
DROP POLICY IF EXISTS "Users select own rental receipts" ON rental_receipts;
DROP POLICY IF EXISTS "Users insert own rental receipts" ON rental_receipts;
DROP POLICY IF EXISTS "Users delete own rental receipts" ON rental_receipts;
DROP POLICY IF EXISTS "Members select rental receipts" ON rental_receipts;
DROP POLICY IF EXISTS "Members insert rental receipts" ON rental_receipts;
DROP POLICY IF EXISTS "Members delete rental receipts" ON rental_receipts;
CREATE POLICY "Members select rental receipts" ON rental_receipts FOR SELECT USING (is_rental_member(home_id));
CREATE POLICY "Members insert rental receipts" ON rental_receipts FOR INSERT WITH CHECK (
  is_rental_member(home_id)
  AND EXISTS (SELECT 1 FROM rental_charges c WHERE c.id = charge_id AND c.home_id = rental_receipts.home_id)
);
CREATE POLICY "Members delete rental receipts" ON rental_receipts FOR DELETE USING (is_rental_member(home_id));

-- rental_documents
DROP POLICY IF EXISTS "Users select own rental documents" ON rental_documents;
DROP POLICY IF EXISTS "Users insert own rental documents" ON rental_documents;
DROP POLICY IF EXISTS "Users delete own rental documents" ON rental_documents;
DROP POLICY IF EXISTS "Members select rental documents" ON rental_documents;
DROP POLICY IF EXISTS "Members insert rental documents" ON rental_documents;
DROP POLICY IF EXISTS "Members delete rental documents" ON rental_documents;
CREATE POLICY "Members select rental documents" ON rental_documents FOR SELECT USING (is_rental_member(home_id));
CREATE POLICY "Members insert rental documents" ON rental_documents FOR INSERT WITH CHECK (is_rental_member(home_id));
CREATE POLICY "Members delete rental documents" ON rental_documents FOR DELETE USING (is_rental_member(home_id));

-- 9. Storage: la carpeta de cada archivo es el id del hogar (<home_id>/<charge_id>/archivo)
DROP POLICY IF EXISTS "rental receipts select own" ON storage.objects;
DROP POLICY IF EXISTS "rental receipts insert own" ON storage.objects;
DROP POLICY IF EXISTS "rental receipts delete own" ON storage.objects;
DROP POLICY IF EXISTS "rental receipts select home" ON storage.objects;
DROP POLICY IF EXISTS "rental receipts insert home" ON storage.objects;
DROP POLICY IF EXISTS "rental receipts delete home" ON storage.objects;
CREATE POLICY "rental receipts select home" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'rental-receipts' AND rental_storage_member(name));
CREATE POLICY "rental receipts insert home" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'rental-receipts' AND rental_storage_member(name));
CREATE POLICY "rental receipts delete home" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'rental-receipts' AND rental_storage_member(name));
