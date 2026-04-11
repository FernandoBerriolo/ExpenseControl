import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { phone } = await req.json()
  if (!phone?.trim()) return NextResponse.json({ error: 'Número vacío' }, { status: 400 })

  // Intentar update primero (si ya tiene fila por Telegram)
  const { data: updated } = await supabaseAdmin
    .from('phone_users')
    .update({ whatsapp_phone: phone.trim() })
    .eq('user_id', user.id)
    .select('user_id')

  // Si no había fila, insertar una nueva
  if (!updated || updated.length === 0) {
    await supabaseAdmin
      .from('phone_users')
      .insert({ user_id: user.id, phone: '', whatsapp_phone: phone.trim() })
  }

  return NextResponse.json({ ok: true })
}
