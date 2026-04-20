import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Expense = {
  id: string
  user_id: string
  description: string
  amount: number
  currency: 'UYU' | 'USD'
  bank: string | null
  month: string        // YYYY-MM
  expense_date: string // YYYY-MM-DD
  category: string | null
  subcategory: string | null
  is_owed: boolean
  created_at: string
}

export type Income = {
  id: string
  user_id: string
  description: string
  amount: number
  currency: 'UYU' | 'USD'
  month: string        // YYYY-MM
  income_date: string | null
  type: 'income' | 'savings'
  created_at: string
}

export const BANKS = ['Itaú', 'Scotiabank', 'BROU'] as const
export type Bank = typeof BANKS[number]

export const CATEGORIES = [
  { value: 'comida',          label: 'Comida',       emoji: '🍔' },
  { value: 'ropa',            label: 'Ropa',         emoji: '👕' },
  { value: 'nafta',           label: 'Nafta',        emoji: '⛽' },
  { value: 'hogar',           label: 'Hogar',        emoji: '🏠' },
  { value: 'salud',           label: 'Salud',        emoji: '💊' },
  { value: 'ocio',            label: 'Ocio',         emoji: '🎬' },
  { value: 'transporte',      label: 'Transporte',   emoji: '🚌' },
  { value: 'tech',            label: 'Tech',         emoji: '📱' },
  { value: 'mascotas',        label: 'Mascotas',     emoji: '🐾' },
  { value: 'educacion',       label: 'Educación',    emoji: '📚' },
  { value: 'viajes',          label: 'Viajes',       emoji: '✈️' },
  { value: 'regalos',         label: 'Regalos',      emoji: '🎁' },
  { value: 'facturas',        label: 'Facturas',     emoji: '📄' },
  { value: 'belleza',         label: 'Belleza',      emoji: '💅' },
  { value: 'otros',           label: 'Otros',        emoji: '📦' },
] as const

export type SharedAccess = {
  id: string
  owner_id: string
  owner_email: string
  shared_with_id: string | null
  shared_with_email: string | null
  invite_code: string
  status: 'pending' | 'accepted'
  created_at: string
}

export type Account = {
  user_id: string
  email: string
  isOwn: boolean
}
