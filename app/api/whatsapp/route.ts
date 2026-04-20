import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN!
const ANTHROPIC_KEY      = process.env.ANTHROPIC_API_KEY!
const GEMINI_KEY         = process.env.GEMINI_API_KEY!
const OWED_USER_EMAIL    = process.env.OWED_USER_EMAIL ?? ''

const CATEGORY_LABELS: Record<string, string> = {
  comida: '🍔 Comida', nafta: '⛽ Nafta', ropa: '👕 Ropa', hogar: '🏠 Hogar',
  salud: '💊 Salud', ocio: '🎬 Ocio', transporte: '🚌 Transporte', tech: '📱 Tech',
  mascotas: '🐾 Mascotas', educacion: '📚 Educación', regalos: '🎁 Regalos',
  facturas: '📄 Facturas', viajes: '✈️ Viajes', belleza: '💅 Belleza', otros: '📦 Otros',
}

type ExpenseItem = {
  description: string; amount: number; currency: 'UYU' | 'USD'; bank: string | null
  category: string | null; installments: number | null; date: string | null
}
type ExpensesResult = { type: 'expenses'; items: ExpenseItem[] }
type QueryResult    = { type: 'query'; query: 'owed' | 'category_total' | 'monthly_total'; category: string | null; month: string }
type EntryResult    = { type: 'income' | 'savings'; description: string; amount: number; currency: 'UYU' | 'USD' }
type AIResult       = ExpensesResult | QueryResult | EntryResult | null

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const rawBody   = await req.text()
  const params    = new URLSearchParams(rawBody)
  const body      = (params.get('Body') ?? '').trim()
  const from      = (params.get('From') ?? '').replace('whatsapp:', '')
  const numMedia  = parseInt(params.get('NumMedia') ?? '0')
  const mediaUrl  = numMedia > 0 ? params.get('MediaUrl0')         : null
  const mediaType = numMedia > 0 ? params.get('MediaContentType0') : null

  if (!from) return twiml('')

  // ── Lookup usuario ─────────────────────────────────────────────────────────
  const { data: phoneUser } = await supabaseAdmin
    .from('phone_users')
    .select('user_id, last_expense_ids, pending_edit')
    .eq('whatsapp_phone', from)
    .single()

  // Hola / start → instrucciones
  const lower = body.toLowerCase().trim()
  if (!body || lower === 'hola' || lower === 'start' || lower === '/start') {
    if (!phoneUser) {
      return twiml(
        '👋 Hola! Soy tu asistente de gastos.\n\n' +
        'Para vincular tu cuenta, abrí la app y en el botón 🔗 elegí la pestaña *WhatsApp*. ' +
        'Ingresá tu número con código de país (ej: +59812345678) y guardalo.\n\n' +
        'Después podés registrar gastos:\n"pizza 350 itau"\n"gasté 1200 en ropa con brou"\n"celular 30000 en 6 cuotas"\n\n' +
        'O consultar:\n"cuánto gasté en abril"\n"cuánto gasté en comida este mes"'
      )
    }
    return twiml(
      '👋 Tu cuenta está vinculada.\n\n' +
      'Ejemplos:\n"pizza 350 itau"\n"me compré unas sandalias por 3000"\n"cuánto gasté en abril"'
    )
  }

  if (!phoneUser) {
    return twiml(
      '❌ Tu número no está vinculado.\n\nAbrí la app, tocá el botón 🔗 y en la pestaña *WhatsApp* ingresá tu número para vincularlo.'
    )
  }

  const ids: string[] = phoneUser.last_expense_ids ?? []

  // ── Borrar ─────────────────────────────────────────────────────────────────
  if (lower === 'borrar' || lower === 'eliminar') {
    if (ids.length === 0) return twiml('No hay gasto reciente para eliminar.')
    await supabaseAdmin.from('expenses').delete().in('id', ids)
    await supabaseAdmin.from('phone_users')
      .update({ last_expense_ids: [], pending_edit: false })
      .eq('whatsapp_phone', from)
    return twiml('🗑️ Gasto eliminado correctamente.')
  }

  // ── Editar (activar modo) ──────────────────────────────────────────────────
  if (lower === 'editar') {
    if (ids.length === 0) return twiml('No hay gasto reciente para editar.')
    await supabaseAdmin.from('phone_users')
      .update({ pending_edit: true })
      .eq('whatsapp_phone', from)
    return twiml('✏️ Mandá el gasto corregido y reemplazará al anterior.\n\nEj: "salió 600 en realidad" o "fue en itau"')
  }

  // ── Audio ──────────────────────────────────────────────────────────────────
  let inputText: string | null = body || null

  if (!inputText && mediaUrl && mediaType?.startsWith('audio/')) {
    const transcribed = await transcribeAudio(mediaUrl, mediaType)
    if (!transcribed) return twiml('❌ No pude escuchar el audio. Intentá mandar el gasto por texto.')
    inputText = transcribed
  }

  if (!inputText) return twiml('')

  // ── Edición pendiente ──────────────────────────────────────────────────────
  let originalExpense: Record<string, unknown> | null = null
  let pendingEditIds: string[] = []
  if (phoneUser.pending_edit) {
    pendingEditIds = ids
    if (pendingEditIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('expenses').select('description, amount, bank, category')
        .eq('id', pendingEditIds[0]).single()
      if (data) originalExpense = data as Record<string, unknown>
    }
  }

  // ── Parsear con Claude ─────────────────────────────────────────────────────
  const result = await parseWithAI(inputText, originalExpense)

  if (!result) {
    return twiml(
      '❌ No pude entender el mensaje.\n\n' +
      'Ejemplos:\n"pizza 350 itau"\n"gasté 1200 en ropa con brou"\n"celular 30000 en 6 cuotas"\n\n' +
      'Consultas:\n"cuánto gasté en abril"\n"cuánto gasté en comida este mes"'
    )
  }

  // ── Consulta ───────────────────────────────────────────────────────────────
  if (result.type === 'query') {
    const reply = await handleQuery(phoneUser.user_id, result)
    return twiml(reply)
  }

  // ── Guardar ingreso o ahorro ───────────────────────────────────────────────
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)

  if (result.type === 'income' || result.type === 'savings') {
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const { error } = await supabaseAdmin.from('incomes').insert({
      user_id:     phoneUser.user_id,
      description: result.description,
      amount:      result.amount,
      currency:    result.currency,
      month,
      income_date: `${month}-01`,
      type:        result.type,
    })
    if (error) return twiml('❌ Error al guardar. Intentá de nuevo.')
    const label = result.type === 'income' ? '💼 Ingreso' : '🏦 Ahorro'
    const amtStr = result.currency === 'USD'
      ? `USD ${result.amount.toLocaleString('es-UY')}`
      : `$${result.amount.toLocaleString('es-UY')}`
    return twiml(`✅ ${result.description} guardado como ${label}\n${amtStr}`)
  }

  // ── Guardar gastos ─────────────────────────────────────────────────────────
  if (result.type !== 'expenses') return twiml('')

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(phoneUser.user_id)
  const isOwed = !!OWED_USER_EMAIL && authUser?.user?.email === OWED_USER_EMAIL

  const allEntries: Record<string, unknown>[] = []
  for (const item of result.items) {
    const expenseDate = item.date ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
    const installments = item.installments && item.installments > 1 ? item.installments : 1
    const installmentAmount = Math.round((item.amount / installments) * 100) / 100
    const [baseYear, baseMonthNum] = expenseDate.split('-').map(Number)
    for (let i = 0; i < installments; i++) {
      const d = new Date(Date.UTC(baseYear, baseMonthNum - 1 + i, 1))
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      allEntries.push({
        user_id: phoneUser.user_id,
        description: installments > 1 ? `${item.description} (${i + 1}/${installments})` : item.description,
        amount: installmentAmount, currency: item.currency, bank: item.bank,
        month, expense_date: expenseDate, category: item.category,
        is_owed: isOwed && !!item.bank,
      })
    }
  }

  const { data: inserted, error } = await supabaseAdmin.from('expenses').insert(allEntries).select('id')
  if (error) return twiml('❌ Error al guardar. Intentá de nuevo.')

  if (phoneUser.pending_edit && pendingEditIds.length > 0) {
    await supabaseAdmin.from('expenses').delete().in('id', pendingEditIds)
  }

  const savedIds = (inserted ?? []).map((r: { id: string }) => r.id)
  await supabaseAdmin.from('phone_users')
    .update({ last_expense_ids: savedIds, pending_edit: false })
    .eq('whatsapp_phone', from)

  const actionHint = '\n\nRespondé *editar* o *borrar* para modificarlo.'

  if (result.items.length === 1) {
    const item = result.items[0]
    const installments = item.installments && item.installments > 1 ? item.installments : 1
    const installmentAmount = Math.round((item.amount / installments) * 100) / 100
    const fmt = (n: number) => item.currency === 'USD' ? `USD ${n.toLocaleString('es-UY')}` : `$${n.toLocaleString('es-UY')}`
    const parts = [
      `✅ *${item.description}* guardado`,
      fmt(item.amount),
      installments > 1 ? `${installments} cuotas de ${fmt(installmentAmount)}` : null,
      item.bank ? `Tarjeta: ${item.bank}` : 'Efectivo',
      item.category ? CATEGORY_LABELS[item.category] : null,
      item.date ? `Fecha: ${item.date.split('-').reverse().join('/')}` : null,
      isOwed && item.bank ? '💸 Debes a Fer' : null,
    ].filter(Boolean).join(' · ')
    return twiml(parts + actionHint)
  }

  const lines = result.items.map(i => {
    const amt = i.currency === 'USD' ? `USD ${i.amount.toLocaleString('es-UY')}` : `$${i.amount.toLocaleString('es-UY')}`
    return `• ${i.description}: ${amt}`
  }).join('\n')
  const totalUYU = result.items.filter(i => i.currency === 'UYU').reduce((s, i) => s + i.amount, 0)
  const totalUSD = result.items.filter(i => i.currency === 'USD').reduce((s, i) => s + i.amount, 0)
  const totals = [
    totalUYU > 0 ? `$${totalUYU.toLocaleString('es-UY')}` : null,
    totalUSD > 0 ? `USD ${totalUSD.toLocaleString('es-UY')}` : null,
  ].filter(Boolean).join(' + ')
  return twiml(`✅ ${result.items.length} gastos guardados\n${lines}\nTotal: ${totals}${actionHint}`)
}

// ─── Consultas ────────────────────────────────────────────────────────────────
async function handleQuery(userId: string, q: QueryResult): Promise<string> {
  const monthLabel = formatMonthLabel(q.month)

  if (q.query === 'owed') {
    const { data } = await supabaseAdmin.from('expenses').select('amount')
      .eq('user_id', userId).eq('is_owed', true).eq('month', q.month)
    const total = (data ?? []).reduce((s: number, e: { amount: unknown }) => s + Number(e.amount), 0)
    return total === 0
      ? `No tenés gastos marcados como "Debes a Fer" en ${monthLabel}.`
      : `💸 Debes a Fer en ${monthLabel}: $${total.toLocaleString('es-UY')}`
  }

  if (q.query === 'category_total' && q.category) {
    const { data } = await supabaseAdmin.from('expenses').select('amount')
      .eq('user_id', userId).eq('category', q.category).eq('month', q.month)
    const total = (data ?? []).reduce((s: number, e: { amount: unknown }) => s + Number(e.amount), 0)
    const cat = CATEGORY_LABELS[q.category] ?? q.category
    return total === 0
      ? `No tenés gastos en ${cat} en ${monthLabel}.`
      : `${cat} en ${monthLabel}: $${total.toLocaleString('es-UY')}`
  }

  if (q.query === 'monthly_total') {
    const { data } = await supabaseAdmin.from('expenses').select('amount, category')
      .eq('user_id', userId).eq('month', q.month)
    const expenses = data ?? []
    const total = expenses.reduce((s: number, e: { amount: unknown }) => s + Number(e.amount), 0)
    if (total === 0) return `No tenés gastos registrados en ${monthLabel}.`
    const byCategory: Record<string, number> = {}
    for (const e of expenses as { amount: unknown; category: string | null }[]) {
      const k = e.category ?? 'otros'
      byCategory[k] = (byCategory[k] ?? 0) + Number(e.amount)
    }
    const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([cat, amt]) => `  ${CATEGORY_LABELS[cat] ?? cat}: $${amt.toLocaleString('es-UY')}`).join('\n')
    return `📊 Gastos en ${monthLabel}\n\nTotal: $${total.toLocaleString('es-UY')}\n\n${top}`
  }

  return '❌ No entendí la consulta.'
}

// ─── Claude parsing ───────────────────────────────────────────────────────────
async function parseWithAI(text: string, originalExpense: Record<string, unknown> | null = null): Promise<AIResult> {
  const today    = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
  const monthStr = todayStr.slice(0, 7)

  if (originalExpense) {
    const editPrompt = `El usuario tenía registrado este gasto:\n${JSON.stringify(originalExpense)}\n\nAhora manda esta corrección: "${text}"\n\nAplicá los cambios al gasto original y devolvé ÚNICAMENTE este JSON:\n{"type":"expenses","items":[{"description":"...","amount":número,"bank":"Itaú"|"BROU"|"Scotiabank"|null,"category":"comida"|"nafta"|"ropa"|"hogar"|"salud"|"ocio"|"transporte"|"tech"|"mascotas"|"educacion"|"regalos"|"facturas"|"viajes"|"belleza"|null,"installments":null,"date":null}]}`
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 256, messages: [{ role: 'user', content: editPrompt }] }),
      })
      const data = await res.json()
      if (res.status !== 200) return null
      const clean = data.content?.[0]?.text?.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(clean)
      if (parsed.type === 'expenses' && Array.isArray(parsed.items) && parsed.items.length > 0) {
        const i = parsed.items[0]
        return { type: 'expenses', items: [{ description: i.description, amount: Number(i.amount), currency: i.currency === 'USD' ? 'USD' : 'UYU', bank: i.bank ?? null, category: i.category ?? null, installments: null, date: null }] }
      }
      return null
    } catch { return null }
  }

  const systemPrompt = `Sos un asistente de gastos personales. Hoy es ${todayStr}.
Tu tarea: determinar si el mensaje contiene GASTOS, INGRESOS, AHORROS o una CONSULTA.

═══ GASTOS ═══
{"type":"expenses","items":[{"description":"nombre corto (2-4 palabras)","amount":número,"currency":"UYU"|"USD","bank":"Itaú"|"BROU"|"Scotiabank"|null,"category":"comida"|"nafta"|"ropa"|"hogar"|"salud"|"ocio"|"transporte"|"tech"|"mascotas"|"educacion"|"regalos"|"facturas"|"viajes"|"belleza"|null,"installments":número o null,"date":"YYYY-MM-DD" o null}]}

CRÍTICO — Moneda: "dólares","dolar","USD","U$S","us$","usd"→currency:"USD" | sin mención o "pesos"→currency:"UYU"
CRÍTICO — ignorar $, $U, U$S al extraer monto
CRÍTICO — "belleza": uñas, peluquería, cremas, maquillaje, manicura, pedicura, perfume, skincare
CRÍTICO — múltiples gastos → múltiples items

═══ INGRESOS ═══
Si es sueldo, cobro recibido, freelance: {"type":"income","description":"Sueldo"|descripción corta,"amount":número,"currency":"UYU"|"USD"}

═══ AHORROS ═══
Si ahorró o guardó dinero: {"type":"savings","description":"Ahorro"|descripción corta,"amount":número,"currency":"UYU"|"USD"}

═══ CONSULTAS ═══
{"type":"query","query":"owed"|"category_total"|"monthly_total","category":null o categoría,"month":"YYYY-MM"}

═══ REGLAS ═══
- Sin monto claro → {"error":"sin_monto"}
- "itau"→"Itaú" | "brou"→"BROU" | "scotia"→"Scotiabank"
- "este mes"→"${monthStr}" | "el mes pasado"→mes anterior
- Respondé ÚNICAMENTE con JSON válido, sin texto adicional`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 512, system: systemPrompt, messages: [{ role: 'user', content: text }] }),
    })
    const data = await res.json()
    if (res.status !== 200) return null
    const clean = data.content?.[0]?.text?.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(clean)
    if (parsed.error) return null
    if (parsed.type === 'query') {
      if (!parsed.query || !parsed.month) return null
      return { type: 'query', query: parsed.query, category: parsed.category ?? null, month: parsed.month }
    }
    if (parsed.type === 'income' || parsed.type === 'savings') {
      if (!parsed.amount || Number(parsed.amount) <= 0) return null
      return {
        type: parsed.type,
        description: parsed.description ?? (parsed.type === 'income' ? 'Sueldo' : 'Ahorro'),
        amount: Number(parsed.amount),
        currency: parsed.currency === 'USD' ? 'USD' : 'UYU',
      }
    }
    let rawItems: unknown[] = []
    if (parsed.type === 'expenses' && Array.isArray(parsed.items)) rawItems = parsed.items
    else if (parsed.amount && Number(parsed.amount) > 0) rawItems = [parsed]
    const items: ExpenseItem[] = (rawItems as { description?: string; amount?: unknown; currency?: string; bank?: string | null; category?: string | null; installments?: unknown; date?: string | null }[])
      .filter(i => i.amount && Number(i.amount) > 0)
      .map(i => ({ description: i.description ?? 'Gasto', amount: Number(i.amount), currency: i.currency === 'USD' ? 'USD' : 'UYU', bank: i.bank ?? null, category: i.category ?? null, installments: i.installments ? Number(i.installments) : null, date: i.date ?? null }))
    if (items.length === 0) return null
    return { type: 'expenses', items }
  } catch { return null }
}

// ─── Audio: descargar desde Twilio y transcribir con Gemini ──────────────────
async function transcribeAudio(url: string, mimeType: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`) }
    })
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const bytes  = new Uint8Array(buffer)
    let binary   = ''
    bytes.forEach(b => { binary += String.fromCharCode(b) })
    const base64 = btoa(binary)
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: 'Transcribí este mensaje de voz al español exactamente como se dice. Devolvé solo el texto transcripto, sin explicaciones ni comillas.' },
          ]}],
          generationConfig: { temperature: 0 },
        }),
      }
    )
    const gdata = await geminiRes.json()
    return gdata.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
  } catch { return null }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function twiml(message: string): NextResponse {
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${safe}</Message>` : ''}</Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const names = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return year === now.getUTCFullYear() ? names[m - 1] : `${names[m - 1]} ${year}`
}
