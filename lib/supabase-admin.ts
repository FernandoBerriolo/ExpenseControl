import { createClient } from '@supabase/supabase-js'

// Cliente con service role key — solo usar en rutas de servidor (API routes)
// NUNCA importar este archivo desde código cliente ('use client')
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
