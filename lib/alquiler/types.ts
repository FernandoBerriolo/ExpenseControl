import type { Currency } from '@/lib/supabase'

export type RentalKind = 'alquiler' | 'gastos_comunes' | 'luz' | 'wifi' | 'impuesto_municipal' | 'otro'
export type ReceiptDocType = 'comprobante' | 'factura'

export type RentalSettings = {
  user_id: string
  monthly_rent: number | null
  rent_currency: Currency
  ute_reference: string | null
  admin_url: string | null
}

export type RentalCharge = {
  id: string
  user_id: string
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
  user_id: string
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
  size?: number
}

export const RENTAL_BUCKET = 'rental-receipts'

// Rubros que se generan automáticamente para cada mes
export const MONTHLY_KINDS: RentalKind[] = ['alquiler', 'gastos_comunes', 'luz', 'wifi']

export const RENTAL_KINDS: { value: RentalKind; label: string; emoji: string; receiptHint: string }[] = [
  { value: 'alquiler',           label: 'Alquiler',           emoji: '🏠', receiptHint: 'Comprobante de transferencia' },
  { value: 'gastos_comunes',     label: 'Gastos comunes',     emoji: '🏢', receiptHint: 'Comprobante de pago' },
  { value: 'luz',                label: 'Luz (UTE)',          emoji: '💡', receiptHint: 'Factura de UTE' },
  { value: 'wifi',               label: 'Wifi / Internet',    emoji: '📶', receiptHint: 'Factura de internet' },
  { value: 'impuesto_municipal', label: 'Impuesto municipal', emoji: '🏛️', receiptHint: 'Comprobante de pago' },
  { value: 'otro',               label: 'Otro',               emoji: '📦', receiptHint: 'Comprobante' },
]

export function kindInfo(kind: RentalKind) {
  return RENTAL_KINDS.find(k => k.value === kind) ?? RENTAL_KINDS[RENTAL_KINDS.length - 1]
}

export function chargeTitle(c: Pick<RentalCharge, 'kind' | 'label'>) {
  return c.kind === 'otro' && c.label ? c.label : kindInfo(c.kind).label
}

// Límites del asistente
export const MAX_DOC_CHARS = 120_000       // por documento
export const MAX_TOTAL_DOC_CHARS = 300_000 // suma de todos los documentos en el prompt
