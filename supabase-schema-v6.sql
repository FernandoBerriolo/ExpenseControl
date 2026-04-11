-- Número de WhatsApp vinculado al usuario (formato internacional, ej: +59812345678)
ALTER TABLE phone_users ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS phone_users_whatsapp_phone_idx ON phone_users(whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;
