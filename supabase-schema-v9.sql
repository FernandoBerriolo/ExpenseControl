-- v9: Alquiler — administración del apartamento (pagos, comprobantes, documentos para el asistente)
-- Correr completo en el SQL Editor de Supabase. Es idempotente.

-- 1. Configuración por usuario
CREATE TABLE IF NOT EXISTS rental_settings (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_rent    NUMERIC(12,2) CHECK (monthly_rent >= 0),
  rent_currency   TEXT NOT NULL DEFAULT 'UYU' CHECK (rent_currency IN ('UYU', 'USD', 'EUR')),
  ute_reference   TEXT,   -- nro. de trámite / referencia UTE
  admin_url       TEXT,   -- web de la administración (gastos comunes)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rental_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Users insert own rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Users update own rental settings" ON rental_settings;
DROP POLICY IF EXISTS "Users delete own rental settings" ON rental_settings;
CREATE POLICY "Users select own rental settings" ON rental_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own rental settings" ON rental_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own rental settings" ON rental_settings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own rental settings" ON rental_settings
  FOR DELETE USING (auth.uid() = user_id);

-- 2. Pagos / gastos del apartamento (uno por rubro y mes)
CREATE TABLE IF NOT EXISTS rental_charges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('alquiler', 'gastos_comunes', 'luz', 'wifi', 'impuesto_municipal', 'otro')),
  label       TEXT,                                   -- nombre libre, obligatorio si kind = 'otro'
  period      TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),  -- YYYY-MM
  amount      NUMERIC(12,2) CHECK (amount >= 0),      -- puede ser NULL hasta que llegue la factura
  currency    TEXT NOT NULL DEFAULT 'UYU' CHECK (currency IN ('UYU', 'USD', 'EUR')),
  due_date    DATE,
  paid        BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at     DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT rental_charges_label_for_otro CHECK (kind <> 'otro' OR (label IS NOT NULL AND length(trim(label)) > 0))
);

-- Un solo cargo por rubro y mes (salvo "otro", que puede repetirse)
CREATE UNIQUE INDEX IF NOT EXISTS rental_charges_kind_period_uniq
  ON rental_charges(user_id, kind, period) WHERE kind <> 'otro';
CREATE INDEX IF NOT EXISTS rental_charges_user_period_idx ON rental_charges(user_id, period);

ALTER TABLE rental_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Users insert own rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Users update own rental charges" ON rental_charges;
DROP POLICY IF EXISTS "Users delete own rental charges" ON rental_charges;
CREATE POLICY "Users select own rental charges" ON rental_charges
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own rental charges" ON rental_charges
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own rental charges" ON rental_charges
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own rental charges" ON rental_charges
  FOR DELETE USING (auth.uid() = user_id);

-- 3. Comprobantes de pago y facturas/recibos (archivos en Storage)
CREATE TABLE IF NOT EXISTS rental_receipts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id   UUID NOT NULL REFERENCES rental_charges(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('comprobante', 'factura')),
  file_path   TEXT NOT NULL,   -- ruta dentro del bucket: <user_id>/<charge_id>/<archivo>
  file_name   TEXT NOT NULL,
  mime_type   TEXT,
  size_bytes  INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rental_receipts_charge_idx ON rental_receipts(charge_id);

ALTER TABLE rental_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own rental receipts" ON rental_receipts;
DROP POLICY IF EXISTS "Users insert own rental receipts" ON rental_receipts;
DROP POLICY IF EXISTS "Users delete own rental receipts" ON rental_receipts;
CREATE POLICY "Users select own rental receipts" ON rental_receipts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own rental receipts" ON rental_receipts
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM rental_charges c WHERE c.id = charge_id AND c.user_id = auth.uid())
  );
CREATE POLICY "Users delete own rental receipts" ON rental_receipts
  FOR DELETE USING (auth.uid() = user_id);

-- 4. Documentos de texto que lee el asistente (reglamento, manual, contrato, etc.)
CREATE TABLE IF NOT EXISTS rental_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rental_documents_user_idx ON rental_documents(user_id);

ALTER TABLE rental_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own rental documents" ON rental_documents;
DROP POLICY IF EXISTS "Users insert own rental documents" ON rental_documents;
DROP POLICY IF EXISTS "Users delete own rental documents" ON rental_documents;
CREATE POLICY "Users select own rental documents" ON rental_documents
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own rental documents" ON rental_documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own rental documents" ON rental_documents
  FOR DELETE USING (auth.uid() = user_id);

-- 5. Bucket privado para los comprobantes (10 MB por archivo, imágenes y PDF)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rental-receipts', 'rental-receipts', FALSE, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Cada usuario solo accede a su carpeta: <user_id>/...
DROP POLICY IF EXISTS "rental receipts select own" ON storage.objects;
DROP POLICY IF EXISTS "rental receipts insert own" ON storage.objects;
DROP POLICY IF EXISTS "rental receipts delete own" ON storage.objects;
CREATE POLICY "rental receipts select own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'rental-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "rental receipts insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rental-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "rental receipts delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rental-receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
