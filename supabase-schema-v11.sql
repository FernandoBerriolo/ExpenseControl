-- v11: nuevos rubros y categorías en "Mi apartamento" + datos del apartamento.
-- Correr DESPUÉS de supabase-schema-v10.sql. Es idempotente y no toca los datos existentes.

-- 1. Datos libres del apartamento (piso, apto, garage, cerradura…) que lee el asistente
ALTER TABLE rental_settings ADD COLUMN IF NOT EXISTS unit_info TEXT;

-- 2. Rubros nuevos: garantia (rubro fijo) y comida / mantenimiento / hogar / suscripciones (otros gastos)
ALTER TABLE rental_charges DROP CONSTRAINT IF EXISTS rental_charges_kind_check;
ALTER TABLE rental_charges ADD CONSTRAINT rental_charges_kind_check CHECK (kind IN (
  'alquiler', 'gastos_comunes', 'luz', 'wifi', 'garantia', 'impuesto_municipal',
  'comida', 'mantenimiento', 'hogar', 'suscripciones', 'otro'
));

-- 3. Las categorías de "otros gastos" se pueden repetir en el mes y siempre llevan descripción
ALTER TABLE rental_charges DROP CONSTRAINT IF EXISTS rental_charges_label_for_otro;
ALTER TABLE rental_charges DROP CONSTRAINT IF EXISTS rental_charges_label_required;
ALTER TABLE rental_charges ADD CONSTRAINT rental_charges_label_required CHECK (
  kind NOT IN ('comida', 'mantenimiento', 'hogar', 'suscripciones', 'otro')
  OR (label IS NOT NULL AND length(trim(label)) > 0)
);

DROP INDEX IF EXISTS rental_charges_home_kind_period_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS rental_charges_home_kind_period_uniq
  ON rental_charges(home_id, kind, period)
  WHERE kind NOT IN ('comida', 'mantenimiento', 'hogar', 'suscripciones', 'otro');
