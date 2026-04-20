import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseExpenseMessage, analyzeReceiptImage } from '@/lib/parse-expense'

const OWED_USER_EMAIL = process.env.OWED_USER_EMAIL ?? ''

const CATEGORY_LABELS: Record<string, string> = {
  comida: '🍔 Comida', nafta: '⛽ Nafta', ropa: '👕 Ropa', hogar: '🏠 Hogar',
  alquiler: '🏘️ Alquiler', salud: '💊 Salud', ocio: '🎬 Ocio', transporte: '🚌 Transporte',
  tech: '📱 Tech', mascotas: '🐾 Mascotas', educacion: '📚 Educación', regalos: '🎁 Regalos',
  facturas: '📄 Facturas', viajes: '✈️ Viajes', belleza: '💅 Belleza', otros: '📦 Otros',
}

function fmtAmount(amount: number, currency: string): string {
  if (currency === 'USD') return `USD ${amount.toLocaleString('es-UY')}`
  if (currency === 'EUR') return `EUR ${amount.toLocaleString('es-UY')}`
  return `$${amount.toLocaleString('es-UY')}`
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const body = await req.json()
  const { message, image } = body

  // Fetch payment methods and user settings in parallel
  const [pmRes, settingsRes] = await Promise.all([
    supabaseAdmin.from('payment_methods').select('name, type').eq('user_id', user.id).order('sort_order'),
    supabaseAdmin.from('user_settings').select('is_legacy').eq('user_id', user.id).single(),
  ])
  const cards: string[] = ((pmRes.data ?? []) as { name: string; type: string }[])
    .filter(m => m.type !== 'cash')
    .map(m => m.name)
  const isLegacy = (settingsRes.data as { is_legacy: boolean } | null)?.is_legacy ?? true

  let result = null

  if (image?.data && image?.mimeType) {
    result = await analyzeReceiptImage(image.data, image.mimeType, cards)
    if (!result) {
      return NextResponse.json({ reply: '❌ No pude leer el recibo. Intentá con una foto más clara o ingresá el gasto manualmente.' })
    }
  } else if (message?.trim()) {
    result = await parseExpenseMessage(message.trim(), cards)
    if (!result) {
      return NextResponse.json({ reply: '❌ No pude entender. Probá: "pizza 350 itau", "cobré el sueldo 50000", "ahorré 5000"' })
    }
  } else {
    return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 })
  }

  // ── Ingreso o ahorro ────────────────────────────────────────────────────────
  if (result.type === 'income' || result.type === 'savings') {
    const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const { error } = await supabaseAdmin.from('incomes').insert({
      user_id:     user.id,
      description: result.description,
      amount:      result.amount,
      currency:    result.currency,
      month,
      income_date: `${month}-01`,
      type:        result.type,
    })
    if (error) return NextResponse.json({ reply: '❌ Error al guardar. Intentá de nuevo.' })
    const label = result.type === 'income' ? '💼 Ingreso' : '🏦 Ahorro'
    return NextResponse.json({
      reply: `✅ **${result.description}** guardado como ${label}\n${fmtAmount(result.amount, result.currency)}`,
      saved: true,
    })
  }

  // ── Consulta ────────────────────────────────────────────────────────────────
  if (result.type === 'query') {
    const month = result.month
    const monthLabel = formatMonthLabel(month)

    if (result.query === 'owed') {
      const { data } = await supabaseAdmin.from('expenses').select('amount')
        .eq('user_id', user.id).eq('is_owed', true).eq('month', month)
      const total = (data ?? []).reduce((s: number, e: { amount: unknown }) => s + Number(e.amount), 0)
      return NextResponse.json({
        reply: total === 0
          ? `No tenés gastos marcados como "Debes a Fer" en ${monthLabel}.`
          : `💸 Debes a Fer en ${monthLabel}: $${total.toLocaleString('es-UY')}`
      })
    }

    if (result.query === 'category_total' && result.category) {
      const { data } = await supabaseAdmin.from('expenses').select('amount')
        .eq('user_id', user.id).eq('category', result.category).eq('month', month)
      const total = (data ?? []).reduce((s: number, e: { amount: unknown }) => s + Number(e.amount), 0)
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
      const total = expenses.reduce((s: number, e: { amount: unknown }) => s + Number(e.amount), 0)
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
  if (result.type !== 'expenses') return NextResponse.json({ reply: '❌ No pude entender el gasto.' })

  const isOwed = isLegacy && !!OWED_USER_EMAIL && user.email === OWED_USER_EMAIL
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
        currency:     item.currency,
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

  if (result.items.length === 1) {
    const item = result.items[0]
    const installments = item.installments && item.installments > 1 ? item.installments : 1
    const installmentAmount = Math.round((item.amount / installments) * 100) / 100
    const lines = [
      `✅ **${item.description}** guardado`,
      fmtAmount(item.amount, item.currency),
      installments > 1 ? `${installments} cuotas de ${fmtAmount(installmentAmount, item.currency)}` : null,
      item.bank ? `Tarjeta: ${item.bank}` : 'Efectivo',
      item.category ? CATEGORY_LABELS[item.category] : null,
      item.date ? `Fecha: ${item.date.split('-').reverse().join('/')}` : null,
    ].filter(Boolean).join(' · ')
    return NextResponse.json({ reply: lines, saved: true })
  } else {
    const lines = result.items.map(i => `• ${i.description}: ${fmtAmount(i.amount, i.currency)}`).join('\n')
    const totalUYU = result.items.filter(i => i.currency === 'UYU').reduce((s, i) => s + i.amount, 0)
    const totalUSD = result.items.filter(i => i.currency === 'USD').reduce((s, i) => s + i.amount, 0)
    const totalEUR = result.items.filter(i => i.currency === 'EUR').reduce((s, i) => s + i.amount, 0)
    const totals = [
      totalUYU > 0 ? `$${totalUYU.toLocaleString('es-UY')}` : null,
      totalUSD > 0 ? `USD ${totalUSD.toLocaleString('es-UY')}` : null,
      totalEUR > 0 ? `EUR ${totalEUR.toLocaleString('es-UY')}` : null,
    ].filter(Boolean).join(' + ')
    return NextResponse.json({ reply: `✅ ${result.items.length} gastos guardados\n${lines}\nTotal: ${totals}`, saved: true })
  }
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const names = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return year === now.getUTCFullYear() ? names[m - 1] : `${names[m - 1]} ${year}`
}
