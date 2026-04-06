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
  created_at: string
}

export const BANKS = ['Itaú', 'Scotiabank', 'BROU'] as const
export type Bank = typeof BANKS[number]

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
