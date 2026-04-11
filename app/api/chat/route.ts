import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseExpenseMessage } from '@/lib/parse-expense'

const OWED_USER_EMAIL = process.env.OWED_USER_EMAIL ?? ''

const CATEGORY_LABELS: Record<string, string> = {
  comida: '🍔 Comida', nafta: '⛽ Nafta', ropa: '👕 Ropa', hogar: '🏠 Hogar',
  salud: '💊 Salud', ocio: '🎬 Ocio', transporte: '🚌 Transporte', tech: '📱 Tech',
  mascotas: '🐾 Mascotas', educacion: '📚 Educación', regalos: '🎁 Regalos',
  facturas: '📄 Facturas', viajes: '✈️ Viajes', belleza: '💅 Belleza', otros: '📦 Otros',
}

export async function POST(req: NextRequest) {
  // Obtener usuario autenticado
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { message } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 })

  const result = await parseExpenseMessage(message.trim())

  if (!result) {
    return NextResponse.json({ reply: '❌ No pude entender el gasto. Probá con: "pizza 350 itau" o "gasté 800 en super"' })
  }

  // ── Consulta ────────────────────────────────────────────────────────────────
  if (result.type === 'query') {
    const month = result.month
    const monthLabel = formatMonthLabel(month)

    if (result.query === 'owed') {
      const { data } = await supabaseAdmin.from('expenses').select('amount')
        .eq('user_id', user.id).eq('is_owed', true).eq('month', month)
      const total = (data ?? []).reduce((s, e) => s + Number(e.amount), 0)
      return NextResponse.json({
        reply: total === 0
          ? `No tenés gastos marcados como "Debes a Fer" en ${monthLabel}.`
          : `💸 Debes a Fer en ${monthLabel}: $${total.toLocaleString('es-UY')}`
      })
    }

    if (result.query === 'category_total' && result.category) {
      const { data } = await supabaseAdmin.from('expenses').select('amount')
        .eq('user_id', user.id).eq('category', result.category).eq('month', month)
      const total = (data ?? []).reduce((s, e) => s + Number(e.amount), 0)
      const cat = CATEGORY_LABELS[result.category] ?? result.category
      return NextResponse.json({
        reply: total === 0
          ? `No tenés gastos en ${cat} en ${monthLabel}.`
          : `${cat} en ${monthLabel}: $${total.toLocaleString('es-UY')}`
      })
    }

    if (result.query === 'monthly_total') {
      const { data } = await supabaseAdmin.from('expenses').select('amount, category')
        .eq('user_id', user.id).eq('month', month)
      const expenses = data ?? []
      const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
      if (total === 0) return NextResponse.json({ reply: `No tenés gastos en ${monthLabel}.` })

      const byCategory: Record<string, number> = {}
      for (const e of expenses) {
        const k = (e.category as string | null) ?? 'otros'
        byCategory[k] = (byCategory[k] ?? 0) + Number(e.amount)
      }
      const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([cat, amt]) => `  ${CATEGORY_LABELS[cat] ?? cat}: $${amt.toLocaleString('es-UY')}`).join('\n')
      return NextResponse.json({ reply: `📊 Gastos en ${monthLabel}\n\nTotal: $${total.toLocaleString('es-UY')}\n\n${top}` })
    }
  }

  // ── Guardar gastos ──────────────────────────────────────────────────────────
  const isOwed = OWED_USER_EMAIL && user.email === OWED_USER_EMAIL
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`

  const allEntries: Record<string, unknown>[] = []
  for (const item of result.items) {
    const expenseDate = item.date ?? todayStr
    const installments = item.installments && item.installments > 1 ? item.installments : 1
    const installmentAmount = Math.round((item.amount / installments) * 100) / 100
    const [baseYear, baseMonthNum] = expenseDate.split('-').map(Number)

    for (let i = 0; i < installments; i++) {
      const d = new Date(Date.UTC(baseYear, baseMonthNum - 1 + i, 1))
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      allEntries.push({
        user_id:      user.id,
        description:  installments > 1 ? `${item.description} (${i + 1}/${installments})` : item.description,
        amount:       installmentAmount,
        currency:     'UYU',
        bank:         item.bank,
        month,
        expense_date: expenseDate,
        category:     item.category,
        is_owed:      isOwed && !!item.bank,
      })
    }
  }

  const { error } = await supabaseAdmin.from('expenses').insert(allEntries)
  if (error) return NextResponse.json({ reply: '❌ Error al guardar. Intentá de nuevo.' })

  // Armar respuesta
  if (result.items.length === 1) {
    const item = result.items[0]
    const installments = item.installments && item.installments > 1 ? item.installments : 1
    const installmentAmount = Math.round((item.amount / installments) * 100) / 100
    const lines = [
      `✅ **${item.description}** guardado`,
      `$${item.amount.toLocaleString('es-UY')}`,
      installments > 1 ? `${installments} cuotas de $${installmentAmount.toLocaleString('es-UY')}` : null,
      item.bank ? `Tarjeta: ${item.bank}` : 'Efectivo',
      item.category ? CATEGORY_LABELS[item.category] : null,
      item.date ? `Fecha: ${item.date.split('-').reverse().join('/')}` : null,
    ].filter(Boolean).join(' · ')
    return NextResponse.json({ reply: lines, saved: true })
  } else {
    const lines = result.items.map(i => `• ${i.description}: $${i.amount.toLocaleString('es-UY')}`).join('\n')
    const total = result.items.reduce((s, i) => s + i.amount, 0)
    return NextResponse.json({ reply: `✅ ${result.items.length} gastos guardados\n${lines}\nTotal: $${total.toLocaleString('es-UY')}`, saved: true })
  }
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const names = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return year === now.getUTCFullYear() ? names[m - 1] : `${names[m - 1]} ${year}`
}
