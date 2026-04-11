-- Guardar IDs del último gasto guardado por Telegram (para poder borrarlo/editarlo)
ALTER TABLE phone_users ADD COLUMN IF NOT EXISTS last_expense_ids JSONB DEFAULT '[]';
-- Flag para saber si el próximo mensaje es una edición
ALTER TABLE phone_users ADD COLUMN IF NOT EXISTS pending_edit BOOLEAN DEFAULT FALSE;
