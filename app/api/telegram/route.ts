import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN!
const GEMINI_KEY       = process.env.GEMINI_API_KEY!       // solo para transcribir audio
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY!
const OWED_USER_EMAIL  = process.env.OWED_USER_EMAIL ?? ''
const API_BASE         = `https://api.telegram.org/bot${BOT_TOKEN}`

// ─── Types ────────────────────────────────────────────────────────────────────
type ExpenseItem = {
  description: string
  amount: number
  currency: 'UYU' | 'USD'
  bank: string | null
  category: string | null
  installments: number | null
  date: string | null
}

type ExpensesResult = {
  type: 'expenses'
  items: ExpenseItem[]
}

type QueryResult = {
  type: 'query'
  query: 'owed' | 'category_total' | 'monthly_total'
  category: string | null
  month: string   // YYYY-MM
}

type EntryResult = {
  type: 'income' | 'savings'
  description: string
  amount: number
  currency: 'UYU' | 'USD'
}

type AIResult = ExpensesResult | QueryResult | EntryResult | null

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()

  // ── Callback de botones inline ────────────────────────────────────────────
  if (body.callback_query) {
    const cb     = body.callback_query
    const cbId   = cb.id
    const chatId = String(cb.message.chat.id)
    const action = cb.data as string

    const { data: phoneUser } = await supabaseAdmin
      .from('phone_users')
      .select('user_id, last_expense_ids, pending_edit')
      .eq('phone', chatId)
      .single()

    if (!phoneUser) {
      await answerCallback(cbId, '❌ Cuenta no vinculada')
      return NextResponse.json({ ok: true })
    }

    const ids: string[] = phoneUser.last_expense_ids ?? []

    if (action === 'del_last') {
      if (ids.length === 0) {
        await answerCallback(cbId, 'No hay gasto reciente para eliminar')
        return NextResponse.json({ ok: true })
      }
      await supabaseAdmin.from('expenses').delete().in('id', ids)
      await supabaseAdmin.from('phone_users')
        .update({ last_expense_ids: [] })
        .eq('phone', chatId)
      await answerCallback(cbId, '🗑️ Gasto eliminado')
      await sendMessage(chatId, '🗑️ Gasto eliminado correctamente\\.', 'MarkdownV2')
    }

    if (action === 'edit_last') {
      if (ids.length === 0) {
        await answerCallback(cbId, 'No hay gasto reciente para editar')
        return NextResponse.json({ ok: true })
      }
      // NO borramos todavía — el gasto se reemplaza recién cuando llegue el mensaje corregido
      await supabaseAdmin.from('phone_users')
        .update({ pending_edit: true })
        .eq('phone', chatId)
      await answerCallback(cbId, '✏️ Mandá el gasto corregido')
      await sendMessage(chatId, '✏️ Mandá el gasto corregido y reemplazará al anterior:', 'MarkdownV2')
    }

    return NextResponse.json({ ok: true })
  }

  // ── Mensaje normal ────────────────────────────────────────────────────────
  const message = body.message
  if (!message || (!message.text && !message.voice && !message.audio)) {
    return NextResponse.json({ ok: true })
  }

  const chatId = String(message.chat.id)

  let inputText: string | null = null
  let transcribedText: string | null = null

  if (message.text) {
    inputText = (message.text as string).trim()
  } else if (message.voice || message.audio) {
    const fileId = (message.voice ?? message.audio).file_id
    const fileData = await downloadTelegramFile(fileId)
    if (!fileData) {
      await sendMessage(chatId, '❌ No pude descargar el audio\\.', 'MarkdownV2')
      return NextResponse.json({ ok: true })
    }
    transcribedText = await transcribeAudio(fileData.base64, fileData.mime)
    if (!transcribedText) {
      await sendMessage(chatId, '❌ No pude escuchar el audio\\. Intentá mandar el gasto por texto\\.', 'MarkdownV2')
      return NextResponse.json({ ok: true })
    }
  }

  const text = inputText ?? transcribedText ?? ''

  // /start → muestra el chat ID para registrarse en la app
  if (text.startsWith('/start')) {
    await sendMessage(chatId,
      `👋 Hola\\! Soy tu bot de gastos\\.\n\n` +
      `Tu ID de Telegram es:\n\`${chatId}\`\n\n` +
      `Copialo y pegalo en la app \\(botón 🔗 → tab Telegram\\) para vincular tu cuenta\\.\n\n` +
      `Después podés registrar gastos o consultar:\n` +
      `_"pizza 350 itau"_\n` +
      `_"me compré unas sandalias por 3000"_\n` +
      `_"compré hamburguesa por 100 y papas por 300"_\n` +
      `_"cuánto gasté en comida en abril"_\n` +
      `_"cuánto le debo a Fer este mes"_`,
      'MarkdownV2'
    )
    return NextResponse.json({ ok: true })
  }

  // Buscar usuario vinculado
  const { data: phoneUser } = await supabaseAdmin
    .from('phone_users')
    .select('user_id, pending_edit')
    .eq('phone', chatId)
    .single()

  if (!phoneUser) {
    await sendMessage(chatId,
      '❌ Tu cuenta no está vinculada\\.\n\nMandá /start para ver tu ID y registrarte en la app\\.',
      'MarkdownV2'
    )
    return NextResponse.json({ ok: true })
  }

  // Si hay edición pendiente, obtener el gasto original para pasarle contexto a Claude
  let originalExpense: Record<string, unknown> | null = null
  let pendingEditIds: string[] = []
  if (phoneUser.pending_edit) {
    const { data: sessionData } = await supabaseAdmin
      .from('phone_users')
      .select('last_expense_ids')
      .eq('phone', chatId)
      .single()
    pendingEditIds = sessionData?.last_expense_ids ?? []
    if (pendingEditIds.length > 0) {
      const { data: origData } = await supabaseAdmin
        .from('expenses')
        .select('description, amount, bank, category')
        .eq('id', pendingEditIds[0])
        .single()
      if (origData) originalExpense = origData as Record<string, unknown>
    }
  }

  const result = await parseWithAI(text || null, originalExpense)

  if (!result) {
    await sendMessage(chatId,
      '❌ No pude entender el mensaje\\.\n\n' +
      '*Registrar gastos:*\n' +
      '_"me compré unas sandalias por 3000"_\n' +
      '_"gasté 1200 en ropa con brou"_\n' +
      '_"celular 30000 en 6 cuotas con itau"_\n' +
      '_"hamburguesa por 150 y gaseosa por 80"_\n\n' +
      '*Consultas:*\n' +
      '_"cuánto gasté en abril"_\n' +
      '_"cuánto gasté en comida este mes"_\n' +
      '_"cuánto le debo a Fer en abril"_',
      'MarkdownV2'
    )
    return NextResponse.json({ ok: true })
  }

  if (result.type === 'query') {
    await handleQuery(chatId, phoneUser.user_id, result)
    return NextResponse.json({ ok: true })
  }

  // ── Guardar ingreso o ahorro ──────────────────────────────────────────────
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
    if (error) {
      await sendMessage(chatId, '❌ Error al guardar\\. Intentá de nuevo\\.', 'MarkdownV2')
      return NextResponse.json({ ok: true })
    }
    const label = result.type === 'income' ? '💼 Ingreso' : '🏦 Ahorro'
    const amtStr = result.currency === 'USD'
      ? `USD ${escapeMarkdown(result.amount.toLocaleString('es-UY'))}`
      : `\\$${escapeMarkdown(result.amount.toLocaleString('es-UY'))}`
    await sendMessage(chatId,
      `✅ *${escapeMarkdown(result.description)}* guardado como ${escapeMarkdown(label)}\n${amtStr}`,
      'MarkdownV2'
    )
    return NextResponse.json({ ok: true })
  }

  // ── Guardar gastos ────────────────────────────────────────────────────────
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(phoneUser.user_id)
  const isGuille = !!OWED_USER_EMAIL && authUser?.user?.email === OWED_USER_EMAIL

  const allEntries: Record<string, unknown>[] = []
  for (const item of result.items) {
    let expenseDate: string
    if (item.date) {
      expenseDate = item.date
    } else {
      const y = now.getUTCFullYear()
      const m = String(now.getUTCMonth() + 1).padStart(2, '0')
      const d = String(now.getUTCDate()).padStart(2, '0')
      expenseDate = `${y}-${m}-${d}`
    }

    const installments = item.installments && item.installments > 1 ? item.installments : 1
    const installmentAmount = Math.round((item.amount / installments) * 100) / 100
    const [baseYear, baseMonthNum] = expenseDate.split('-').map(Number)

    for (let i = 0; i < installments; i++) {
      const d = new Date(Date.UTC(baseYear, baseMonthNum - 1 + i, 1))
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      allEntries.push({
        user_id:      phoneUser.user_id,
        description:  installments > 1 ? `${item.description} (${i + 1}/${installments})` : item.description,
        amount:       installmentAmount,
        currency:     item.currency,
        bank:         item.bank,
        month,
        expense_date: expenseDate,
        category:     item.category,
        is_owed:      isGuille && !!item.bank,
      })
    }
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('expenses').insert(allEntries).select('id')

  if (error) {
    await sendMessage(chatId, '❌ Error al guardar\\. Intentá de nuevo\\.', 'MarkdownV2')
    return NextResponse.json({ ok: true })
  }

  // Si era una edición, borrar el gasto original ahora que el nuevo está guardado
  if (phoneUser.pending_edit && pendingEditIds.length > 0) {
    await supabaseAdmin.from('expenses').delete().in('id', pendingEditIds)
  }

  // Guardar IDs para poder borrar/editar después
  const savedIds = (inserted ?? []).map((r: { id: string }) => r.id)
  await supabaseAdmin.from('phone_users')
    .update({ last_expense_ids: savedIds, pending_edit: false })
    .eq('phone', chatId)

  // Botones de acción
  const editButtons = {
    inline_keyboard: [[
      { text: '✏️ Editar', callback_data: 'edit_last' },
      { text: '🗑️ Eliminar', callback_data: 'del_last' },
    ]]
  }

  if (result.items.length === 1) {
    const item = result.items[0]
    const installments = item.installments && item.installments > 1 ? item.installments : 1
    const installmentAmount = Math.round((item.amount / installments) * 100) / 100
    const expenseDate = item.date ?? (() => {
      const y = now.getUTCFullYear()
      const m = String(now.getUTCMonth() + 1).padStart(2, '0')
      const d = String(now.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    })()
    const amtPrefix  = item.currency === 'USD' ? 'USD ' : '\\$ '
    const cuotaPrefix = item.currency === 'USD' ? 'USD ' : '\\$'
    const bankLine   = item.bank ? `\nTarjeta: ${escapeMarkdown(item.bank)}` : '\nPago: Efectivo'
    const catLine    = item.category ? `\nCategoría: ${escapeMarkdown(CATEGORY_LABELS[item.category] ?? item.category)}` : ''
    const owedLine   = isGuille && item.bank ? '\n💸 Marcado como Debes a Fer' : ''
    const cuotasLine = installments > 1 ? `\n${installments} cuotas de ${cuotaPrefix}${escapeMarkdown(installmentAmount.toLocaleString('es-UY'))}` : ''
    const dateLine   = item.date ? `\nFecha: ${escapeMarkdown(expenseDate.split('-').reverse().join('/'))}` : ''
    await sendMessage(chatId,
      `✅ *Gasto guardado*\n\n` +
      `*${escapeMarkdown(item.description)}*\n` +
      `${amtPrefix}${escapeMarkdown(item.amount.toLocaleString('es-UY'))}` +
      `${cuotasLine}${bankLine}${catLine}${dateLine}${owedLine}`,
      'MarkdownV2',
      editButtons
    )
  } else {
    const lines = result.items.map(item => {
      const amtStr = item.currency === 'USD'
        ? `USD ${escapeMarkdown(item.amount.toLocaleString('es-UY'))}`
        : `\\$${escapeMarkdown(item.amount.toLocaleString('es-UY'))}`
      return `• *${escapeMarkdown(item.description)}* ${amtStr}` +
        (item.bank ? ` \\(${escapeMarkdown(item.bank)}\\)` : '')
    }).join('\n')
    const totalUYU = result.items.filter(i => i.currency === 'UYU').reduce((s, i) => s + i.amount, 0)
    const totalUSD = result.items.filter(i => i.currency === 'USD').reduce((s, i) => s + i.amount, 0)
    const totalParts = [
      totalUYU > 0 ? `\\$${escapeMarkdown(totalUYU.toLocaleString('es-UY'))}` : null,
      totalUSD > 0 ? `USD ${escapeMarkdown(totalUSD.toLocaleString('es-UY'))}` : null,
    ].filter(Boolean).join(' \\+ ')
    await sendMessage(chatId,
      `✅ *${result.items.length} gastos guardados*\n\n${lines}\n\n*Total: ${totalParts}*`,
      'MarkdownV2',
      editButtons
    )
  }

  return NextResponse.json({ ok: true })
}

// ─── Manejo de consultas ──────────────────────────────────────────────────────
async function handleQuery(chatId: string, userId: string, q: QueryResult) {
  const monthLabel = formatMonthLabel(q.month)

  if (q.query === 'owed') {
    const { data } = await supabaseAdmin
      .from('expenses')
      .select('amount')
      .eq('user_id', userId)
      .eq('is_owed', true)
      .eq('month', q.month)

    const total = (data ?? []).reduce((sum: number, e: { amount: unknown }) => sum + Number(e.amount), 0)
    if (total === 0) {
      await sendMessage(chatId,
        `💸 No tenés gastos marcados como "Debes a Fer" en ${escapeMarkdown(monthLabel)}\\.`,
        'MarkdownV2'
      )
    } else {
      await sendMessage(chatId,
        `💸 *Debes a Fer en ${escapeMarkdown(monthLabel)}*\n\n` +
        `\\$ ${escapeMarkdown(total.toLocaleString('es-UY'))}`,
        'MarkdownV2'
      )
    }
    return
  }

  if (q.query === 'category_total' && q.category) {
    const { data } = await supabaseAdmin
      .from('expenses')
      .select('amount')
      .eq('user_id', userId)
      .eq('category', q.category)
      .eq('month', q.month)

    const total = (data ?? []).reduce((sum: number, e: { amount: unknown }) => sum + Number(e.amount), 0)
    const catLabel = escapeMarkdown(CATEGORY_LABELS[q.category] ?? q.category)
    if (total === 0) {
      await sendMessage(chatId,
        `No tenés gastos en ${catLabel} en ${escapeMarkdown(monthLabel)}\\.`,
        'MarkdownV2'
      )
    } else {
      await sendMessage(chatId,
        `${catLabel} en *${escapeMarkdown(monthLabel)}*\n\n` +
        `\\$ ${escapeMarkdown(total.toLocaleString('es-UY'))}`,
        'MarkdownV2'
      )
    }
    return
  }

  if (q.query === 'monthly_total') {
    const { data } = await supabaseAdmin
      .from('expenses')
      .select('amount, category')
      .eq('user_id', userId)
      .eq('month', q.month)

    const expenses = data ?? []
    const total = expenses.reduce((sum: number, e: { amount: unknown }) => sum + Number(e.amount), 0)

    if (total === 0) {
      await sendMessage(chatId,
        `No tenés gastos registrados en ${escapeMarkdown(monthLabel)}\\.`,
        'MarkdownV2'
      )
      return
    }

    const byCategory: Record<string, number> = {}
    for (const e of expenses as { amount: unknown; category: string | null }[]) {
      const key = e.category ?? 'otros'
      byCategory[key] = (byCategory[key] ?? 0) + Number(e.amount)
    }
    const topCats = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([cat, amt]) => `  ${CATEGORY_LABELS[cat] ?? cat}: \\$${escapeMarkdown(amt.toLocaleString('es-UY'))}`)
      .join('\n')

    await sendMessage(chatId,
      `📊 *Gastos en ${escapeMarkdown(monthLabel)}*\n\n` +
      `*Total: \\$${escapeMarkdown(total.toLocaleString('es-UY'))}*\n\n` +
      `${topCats}`,
      'MarkdownV2'
    )
    return
  }
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const names = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const currentYear = now.getUTCFullYear()
  return year === currentYear ? names[m - 1] : `${names[m - 1]} ${year}`
}

// ─── Descarga archivo de Telegram y lo convierte a base64 ────────────────────
async function downloadTelegramFile(fileId: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const infoRes  = await fetch(`${API_BASE}/getFile?file_id=${fileId}`)
    const infoData = await infoRes.json()
    const filePath = infoData.result?.file_path
    if (!filePath) return null

    const fileRes  = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`)
    const buffer   = await fileRes.arrayBuffer()
    const bytes    = new Uint8Array(buffer)
    let binary     = ''
    bytes.forEach(b => { binary += String.fromCharCode(b) })
    const base64   = btoa(binary)
    const mime     = filePath.endsWith('.oga') || filePath.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg'
    return { base64, mime }
  } catch {
    return null
  }
}

// ─── Transcripción de audio con Gemini ───────────────────────────────────────
async function transcribeAudio(audioBase64: string, audioMime: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: audioMime, data: audioBase64 } },
              { text: 'Transcribí este mensaje de voz al español exactamente como se dice. Devolvé solo el texto transcripto, sin explicaciones ni comillas.' },
            ]
          }],
          generationConfig: { temperature: 0 },
        }),
      }
    )
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
  } catch {
    return null
  }
}

// ─── Parsing con Claude ───────────────────────────────────────────────────────
async function parseWithAI(text: string | null, originalExpense: Record<string, unknown> | null = null): Promise<AIResult> {
  const today = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
  const monthStr = todayStr.slice(0, 7)

  // Prompt especial para edición: aplicar corrección parcial al gasto original
  if (originalExpense) {
    const editPrompt = `El usuario tenía registrado este gasto:
${JSON.stringify(originalExpense)}

Ahora manda esta corrección: "${text}"

Aplicá los cambios mencionados al gasto original y devolvé el gasto actualizado. Si solo menciona el monto, actualizá el monto. Si menciona otro lugar/descripción, actualizá description y category. Si no menciona algo, mantené el valor original.

Respondé ÚNICAMENTE con este JSON, sin texto adicional:
{
  "type": "expenses",
  "items": [{
    "description": "...",
    "amount": número,
    "bank": "Itaú"|"BROU"|"Scotiabank"|null,
    "category": "comida"|"nafta"|"ropa"|"hogar"|"salud"|"ocio"|"transporte"|"tech"|"mascotas"|"educacion"|"regalos"|"facturas"|"viajes"|"belleza"|null,
    "installments": null,
    "date": null
  }]
}`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages:   [{ role: 'user', content: editPrompt }],
        }),
      })
      const data = await res.json()
      if (res.status !== 200) return null
      const raw = data.content?.[0]?.text
      if (!raw) return null
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(clean)
      if (parsed.type === 'expenses' && Array.isArray(parsed.items) && parsed.items.length > 0) {
        const i = parsed.items[0]
        return { type: 'expenses', items: [{ description: i.description, amount: Number(i.amount), bank: i.bank ?? null, category: i.category ?? null, installments: null, date: null }] }
      }
      return null
    } catch { return null }
  }

  const systemPrompt = `Sos un asistente de gastos personales. Hoy es ${todayStr}.
Tu tarea: determinar si el mensaje contiene GASTOS, INGRESOS, AHORROS o una CONSULTA.

═══ GASTOS ═══
Si hay uno o más gastos, respondé con este JSON (SIEMPRE con "items" como array):
{
  "type": "expenses",
  "items": [
    {
      "description": "nombre corto del gasto (2-4 palabras)",
      "amount": número (solo dígitos, sin símbolos de moneda),
      "currency": "UYU" | "USD",
      "bank": "Itaú" | "BROU" | "Scotiabank" | null,
      "category": "comida"|"nafta"|"ropa"|"hogar"|"salud"|"ocio"|"transporte"|"tech"|"mascotas"|"educacion"|"regalos"|"facturas"|"viajes"|"belleza" | null,
      "installments": número de cuotas o null,
      "date": "YYYY-MM-DD" solo si mencionan fecha distinta a hoy, si no null
    }
  ]
}

CRÍTICO — Moneda:
- "dólares", "dolar", "USD", "U$S", "us$", "usd" → currency: "USD"
- Sin mención de moneda o "pesos", "$" → currency: "UYU"
- "gasté 30 dólares" → amount: 30, currency: "USD"
- "pizza $350" → amount: 350, currency: "UYU"

CRÍTICO — Extracción de monto (ignorar $, $U, U$S):
- "compré un helado por $150" → amount: 150
- "me hice las uñas por $750" → amount: 750
- "gasté $300 en la cena" → amount: 300
- "me salió 200 la pizza" → amount: 200

CRÍTICO — Categoría "belleza": uñas, peluquería, corte de pelo, tintura, shampú, cremas, maquillaje, depilación, manicura, pedicura, perfume, skincare → category: "belleza"

CRÍTICO — Múltiples gastos: cada gasto mencionado va como un item separado:
- "helado por 150 y milanesa por 300" → items con 2 entradas
- "hamburguesa 100 y papas 50 con itau" → items con 2 entradas, ambas con bank:"Itaú"

═══ INGRESOS ═══
Si el mensaje es un ingreso recibido (sueldo, cobro, freelance, salario):
{"type":"income","description":"Sueldo"|descripción corta,"amount":número,"currency":"UYU"|"USD"}
- "cobré el sueldo de 50000" → type:"income", currency:"UYU"
- "recibí 1000 dólares de freelance" → type:"income", currency:"USD"

═══ AHORROS ═══
Si el mensaje indica que ahorró o guardó dinero:
{"type":"savings","description":"Ahorro"|descripción corta,"amount":número,"currency":"UYU"|"USD"}
- "ahorré 5000 este mes" → type:"savings", currency:"UYU"
- "guardé 200 dólares" → type:"savings", currency:"USD"

═══ CONSULTAS ═══
Si es una pregunta sobre gastos, respondé con:
{
  "type": "query",
  "query": "owed" | "category_total" | "monthly_total",
  "category": categoría (solo para category_total, si no null),
  "month": "YYYY-MM"
}
- "owed": cuánto le debo a Fer
- "category_total": cuánto gasté en [categoría]
- "monthly_total": cuánto gasté en total / resumen del mes

═══ REGLAS ═══
- Sin monto claro → {"error": "sin_monto"}
- "itau"/"itaú" → "Itaú" | "brou" → "BROU" | "scotia" → "Scotiabank"
- "este mes" → "${monthStr}" | "el mes pasado" → mes anterior
- Meses: enero=01 feb=02 mar=03 abr=04 may=05 jun=06 jul=07 ago=08 sep=09 oct=10 nov=11 dic=12
- Respondé ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: text ?? '' }],
      }),
    })

    const data = await res.json()
    if (res.status !== 200) return null

    const raw = data.content?.[0]?.text
    if (!raw) return null

    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(clean)

    if (parsed.error) return null

    if (parsed.type === 'query') {
      if (!parsed.query || !parsed.month) return null
      return {
        type:     'query',
        query:    parsed.query,
        category: parsed.category ?? null,
        month:    parsed.month,
      }
    }

    if (parsed.type === 'income' || parsed.type === 'savings') {
      if (!parsed.amount || Number(parsed.amount) <= 0) return null
      return {
        type:        parsed.type,
        description: parsed.description ?? (parsed.type === 'income' ? 'Sueldo' : 'Ahorro'),
        amount:      Number(parsed.amount),
        currency:    parsed.currency === 'USD' ? 'USD' : 'UYU',
      }
    }

    // Normalizar: soportar tanto {type:"expenses", items:[...]} como formato singular
    let rawItems: unknown[] = []
    if (parsed.type === 'expenses' && Array.isArray(parsed.items)) {
      rawItems = parsed.items
    } else if (parsed.amount && Number(parsed.amount) > 0) {
      rawItems = [parsed]
    }

    const items: ExpenseItem[] = (rawItems as { description?: string; amount?: unknown; currency?: string; bank?: string | null; category?: string | null; installments?: unknown; date?: string | null }[])
      .filter(i => i.amount && Number(i.amount) > 0)
      .map(i => ({
        description:  i.description ?? 'Gasto',
        amount:       Number(i.amount),
        currency:     i.currency === 'USD' ? 'USD' : 'UYU',
        bank:         i.bank ?? null,
        category:     i.category ?? null,
        installments: i.installments ? Number(i.installments) : null,
        date:         i.date ?? null,
      }))

    if (items.length === 0) return null
    return { type: 'expenses', items }
  } catch {
    return null
  }
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  comida: '🍔 Comida', nafta: '⛽ Nafta', ropa: '👕 Ropa', hogar: '🏠 Hogar',
  salud: '💊 Salud', ocio: '🎬 Ocio', transporte: '🚌 Transporte', tech: '📱 Tech',
  mascotas: '🐾 Mascotas', educacion: '📚 Educación', regalos: '🎁 Regalos',
  facturas: '📄 Facturas', viajes: '✈️ Viajes', belleza: '💅 Belleza', otros: '📦 Otros',
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────
async function sendMessage(chatId: string, text: string, parseMode?: string, replyMarkup?: object) {
  try {
    await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode    ? { parse_mode:    parseMode    } : {}),
        ...(replyMarkup  ? { reply_markup:  replyMarkup  } : {}),
      }),
    })
  } catch {
    // No bloquear la respuesta si falla el reply
  }
}

async function answerCallback(callbackQueryId: string, text?: string) {
  try {
    await fetch(`${API_BASE}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    })
  } catch {
    // ignorar
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}
