import type { Currency } from '@/lib/supabase'

export type RentalKind =
  | 'alquiler' | 'gastos_comunes' | 'luz' | 'wifi' | 'garantia' | 'impuesto_municipal'
  | 'comida' | 'mantenimiento' | 'hogar' | 'suscripciones' | 'otro'
export type ReceiptDocType = 'comprobante' | 'factura'

export type RentalSettings = {
  home_id: string
  monthly_rent: number | null
  rent_currency: Currency
  ute_reference: string | null
  admin_url: string | null
  unit_info: string | null   // piso, apto, garage, cerradura, etc.
}

export type RentalCharge = {
  id: string
  home_id: string
  kind: RentalKind
  label: string | null
  period: string        // YYYY-MM
  amount: number | null
  currency: Currency
  due_date: string | null
  paid: boolean
  paid_at: string | null
  notes: string | null
  created_at: string
}

export type RentalReceipt = {
  id: string
  charge_id: string
  home_id: string
  doc_type: ReceiptDocType
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}

export type RentalDocument = {
  id: string
  name: string
  created_at: string
}

export type RentalMember = {
  user_id: string
  user_email: string | null
}

export const RENTAL_BUCKET = 'rental-receipts'

// Rubros que se generan automáticamente para cada mes
export const MONTHLY_KINDS: RentalKind[] = ['alquiler', 'gastos_comunes', 'luz', 'wifi', 'garantia']

// repeatable = categoría de "otros gastos": puede haber varios por mes y siempre lleva una descripción
export type KindInfo = { value: RentalKind; label: string; emoji: string; repeatable: boolean; placeholder?: string }

export const RENTAL_KINDS: KindInfo[] = [
  { value: 'alquiler',           label: 'Alquiler',           emoji: '🏠', repeatable: false },
  { value: 'gastos_comunes',     label: 'Gastos comunes',     emoji: '🏢', repeatable: false },
  { value: 'luz',                label: 'Luz (UTE)',          emoji: '💡', repeatable: false },
  { value: 'wifi',               label: 'Wifi / Internet',    emoji: '📶', repeatable: false },
  { value: 'garantia',           label: 'Pago garantía',      emoji: '🔐', repeatable: false },
  { value: 'impuesto_municipal', label: 'Impuesto municipal', emoji: '🏛️', repeatable: false },
  { value: 'comida',             label: 'Comida',             emoji: '🍔', repeatable: true, placeholder: 'Ej: supermercado' },
  { value: 'mantenimiento',      label: 'Mantenimiento',      emoji: '🧽', repeatable: true, placeholder: 'Ej: jabón, trapos, limpieza' },
  { value: 'hogar',              label: 'Hogar',              emoji: '🛋️', repeatable: true, placeholder: 'Ej: mesa ratona, cortinas' },
  { value: 'suscripciones',      label: 'Suscripciones',      emoji: '📺', repeatable: true, placeholder: 'Ej: Netflix' },
  { value: 'otro',               label: 'Otro',               emoji: '📦', repeatable: true, placeholder: 'Ej: arreglo canilla' },
]

export function kindInfo(kind: RentalKind): KindInfo {
  return RENTAL_KINDS.find(k => k.value === kind) ?? RENTAL_KINDS[RENTAL_KINDS.length - 1]
}

export function isRepeatable(kind: RentalKind) {
  return kindInfo(kind).repeatable
}

// Título corto para mostrar en la tarjeta
export function chargeTitle(c: Pick<RentalCharge, 'kind' | 'label'>) {
  return isRepeatable(c.kind) && c.label ? c.label : kindInfo(c.kind).label
}

// Texto completo para el asistente: "Suscripciones: Netflix"
export function chargeDescription(c: Pick<RentalCharge, 'kind' | 'label'>) {
  const base = kindInfo(c.kind).label
  return isRepeatable(c.kind) && c.label && c.kind !== 'otro' ? `${base}: ${c.label}` : chargeTitle(c)
}

// Límites del asistente
export const MAX_DOC_CHARS = 120_000       // por documento
export const MAX_TOTAL_DOC_CHARS = 300_000 // suma de todos los documentos en el prompt
