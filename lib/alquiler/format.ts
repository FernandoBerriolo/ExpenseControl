import type { Currency } from '@/lib/supabase'

export const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function todayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function monthLabel(month: string) {
  const [year, m] = month.split('-').map(Number)
  return `${MONTHS[m - 1]} ${year}`
}

export function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split('-').map(Number)
  const d = new Date(year, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function formatMoney(amount: number | null, currency: Currency) {
  if (amount == null) return 'Sin monto'
  const n = amount.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return currency === 'UYU' ? `$ ${n}` : `${currency} ${n}`
}

// "25/09" a partir de "2026-09-25"
export function formatDayMonth(date: string) {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

export function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Formato es-UY: "." separa miles y "," es decimal ("25.000" → 25000, "1.500,50" → 1500.5).
// Devuelve null si está vacío y NaN si no es un número válido.
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '').replace(/^[$]|^U\$S|^USD|^EUR|^€/i, '')
  if (!s) return null
  let normalized: string
  if (s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '')
  else normalized = s
  if (!/^\d+(\.\d+)?$/.test(normalized)) return NaN
  return Number(normalized)
}
