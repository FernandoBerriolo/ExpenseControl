import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN!
const GEMINI_KEY      = process.env.GEMINI_API_KEY!
const OWED_USER_EMAIL = process.env.OWED_USER_EMAIL ?? ''
const API_BASE        = `https://api.telegram.org/bot${BOT_TOKEN}`

// ─── Types ────────────────────────────────────────────────────────────────────
type ExpenseResult = {
  type: 'expense'
  description: string
  amount: number
  bank: string | null
  category: string | null
  installments: number | null
  date: string | null
}

type QueryResult = {
  type: 'query'
  query: 'owed' | 'category_total' | 'monthly_total'
  category: string | null
  month: string   // YYYY-MM
}

type AIResult = ExpenseResult | QueryResult | null

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()

  const message = body.message
  if (!message || (!message.text && !message.voice && !message.audio)) {
    return NextResponse.json({ ok: true })
  }

  const chatId = String(message.chat.id)

  let inputText: string | null = null
  let audioBase64: string | null = null
  let audioMime: string | null = null

  if (message.text) {
    inputText = (message.text as string).trim()
  } else if (message.voice || message.audio) {
    const fileId = (message.voice ?? message.audio).file_id
    const fileData = await downloadTelegramFile(fileId)
    if (fileData) {
      audioBase64 = fileData.base64
      audioMime   = fileData.mime
    }
  }

  const text = inputText ?? ''

  // /start → muestra el chat ID para registrarse en la app
  if (text.startsWith('/start')) {
    await sendMessage(chatId,
      `👋 Hola\\! Soy tu bot de gastos\\.\n\n` +
      `Tu ID de Telegram es:\n\`${chatId}\`\n\n` +
      `Copialo y pegalo en la app \\(botón 🔗 → tab Telegram\\) para vincular tu cuenta\\.\n\n` +
      `Después podés registrar gastos o consultar:\n` +
      `_"pizza 350 itau"_\n` +
      `_"celular 30000 en 6 cuotas con itau"_\n` +
      `_"cuánto gasté en comida en abril"_\n` +
      `_"cuánto le debo a Fer este mes"_`,
      'MarkdownV2'
    )
    return NextResponse.json({ ok: true })
  }

  // Buscar usuario vinculado
  const { data: phoneUser } = await supabaseAdmin
    .from('phone_users')
    .select('user_id')
    .eq('phone', chatId)
    .single()

  if (!phoneUser) {
    await sendMessage(chatId,
      '❌ Tu cuenta no está vinculada\\.\n\nMandá /start para ver tu ID y registrarte en la app\\.',
      'MarkdownV2'
    )
    return NextResponse.json({ ok: true })
  }

  const result = await parseWithAI(text || null, audioBase64, audioMime)

  if (!result) {
    await sendMessage(chatId,
      '❌ No pude entender el mensaje\\.\n\n' +
      '*Registrar gastos:*\n' +
      '_"pizza 350 itau"_\n' +
      '_"gasté 1200 en ropa con brou"_\n' +
      '_"celular 30000 en 6 cuotas con itau"_\n' +
      '_"super 800 el 3 de abril"_\n\n' +
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

  // ── Guardar gasto ─────────────────────────────────────────────────────────
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)

  let expenseDate: string
  if (result.date) {
    expenseDate = result.date
  } else {
    const y = now.getUTCFullYear()
    const m = String(now.getUTCMonth() + 1).padStart(2, '0')
    const d = String(now.getUTCDate()).padStart(2, '0')
    expenseDate = `${y}-${m}-${d}`
  }

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(phoneUser.user_id)
  const isGuille = !!OWED_USER_EMAIL && authUser?.user?.email === OWED_USER_EMAIL

  const installments = result.installments && result.installments > 1 ? result.installments : 1
  const installmentAmount = Math.round((result.amount / installments) * 100) / 100
  const [baseYear, baseMonthNum] = expenseDate.split('-').map(Number)

  const entries = Array.from({ length: installments }, (_, i) => {
    const d = new Date(Date.UTC(baseYear, baseMonthNum - 1 + i, 1))
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    return {
      user_id:      phoneUser.user_id,
      description:  installments > 1 ? `${result.description} (${i + 1}/${installments})` : result.description,
      amount:       installmentAmount,
      currency:     'UYU',
      bank:         result.bank,
      month,
      expense_date: expenseDate,
      category:     result.category,
      is_owed:      isGuille && !!result.bank,
    }
  })

  const { error } = await supabaseAdmin.from('expenses').insert(entries)

  if (error) {
    await sendMessage(chatId, '❌ Error al guardar el gasto\\. Intentá de nuevo\\.', 'MarkdownV2')
  } else {
    const bankLine   = result.bank ? `\nTarjeta: ${escapeMarkdown(result.bank)}` : '\nPago: Efectivo'
    const catLine    = result.category ? `\nCategoría: ${escapeMarkdown(CATEGORY_LABELS[result.category] ?? result.category)}` : ''
    const owedLine   = isGuille && result.bank ? '\n💸 Marcado como Debes a Fer' : ''
    const cuotasLine = installments > 1 ? `\n${installments} cuotas de \\$${escapeMarkdown(installmentAmount.toLocaleString('es-UY'))}` : ''
    const dateLine   = result.date ? `\nFecha: ${escapeMarkdown(expenseDate.split('-').reverse().join('/'))}` : ''
    await sendMessage(chatId,
      `✅ *Gasto guardado*\n\n` +
      `*${escapeMarkdown(result.description)}*\n` +
      `\\$ ${escapeMarkdown(result.amount.toLocaleString('es-UY'))}` +
      `${cuotasLine}${bankLine}${catLine}${dateLine}${owedLine}`,
      'MarkdownV2'
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
      .select('amount, category, bank')
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

    // Top categorías
    const byCategory: Record<string, number> = {}
    for (const e of expenses) {
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

// ─── Parsing con Gemini ───────────────────────────────────────────────────────
async function parseWithAI(
  text: string | null,
  audioBase64: string | null = null,
  audioMime: string | null = null
): Promise<AIResult> {
  const today = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const todayStr  = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
  const monthStr  = todayStr.slice(0, 7)

  const prompt = `Sos un asistente de gastos personales. Hoy es ${todayStr}.
${text ? `Mensaje: "${text}"` : 'El mensaje es un audio de voz — transcribilo primero.'}

Determiná si el mensaje es un GASTO a registrar o una CONSULTA sobre gastos.

Si es un GASTO, respondé con este JSON:
{
  "type": "expense",
  "description": "nombre corto del gasto (2-4 palabras)",
  "amount": número total (sin símbolos),
  "bank": "Itaú" | "BROU" | "Scotiabank" | null,
  "category": "comida"|"nafta"|"ropa"|"hogar"|"salud"|"ocio"|"transporte"|"tech"|"mascotas"|"educacion"|"regalos"|"facturas"|"viajes" | null,
  "installments": número de cuotas o null,
  "date": "YYYY-MM-DD" si mencionan fecha específica o null
}

Si es una CONSULTA, respondé con este JSON:
{
  "type": "query",
  "query": "owed" | "category_total" | "monthly_total",
  "category": categoría (solo para category_total, si no null),
  "month": "YYYY-MM" del mes consultado
}

Tipos de consulta:
- "owed": cuánto le debo a Fer / cuánto debo
- "category_total": cuánto gasté en [categoría]
- "monthly_total": cuánto gasté en total / resumen del mes

Reglas:
- Si no hay monto claro en un gasto, respondé: {"error": "sin_monto"}
- "itau"/"itaú" → "Itaú", "brou" → "BROU", "scotia" → "Scotiabank"
- "este mes" → "${monthStr}", "el mes pasado" → mes anterior
- Meses en español: enero=01, febrero=02, marzo=03, abril=04, mayo=05, junio=06, julio=07, agosto=08, septiembre=09, octubre=10, noviembre=11, diciembre=12
- Respondé ÚNICAMENTE con JSON válido, sin texto adicional`

  const parts: object[] = []
  if (audioBase64 && audioMime) {
    parts.push({ inlineData: { mimeType: audioMime, data: audioBase64 } })
  }
  parts.push({ text: prompt })

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0 },
        }),
      }
    )

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) return null

    const clean  = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
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

    if (parsed.type === 'expense') {
      if (!parsed.amount || Number(parsed.amount) <= 0) return null
      return {
        type:         'expense',
        description:  parsed.description ?? text ?? 'Gasto',
        amount:       Number(parsed.amount),
        bank:         parsed.bank ?? null,
        category:     parsed.category ?? null,
        installments: parsed.installments ? Number(parsed.installments) : null,
        date:         parsed.date ?? null,
      }
    }

    return null
  } catch (e) {
    console.error('[Gemini] error:', e)
    return null
  }
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  comida: '🍔 Comida', nafta: '⛽ Nafta', ropa: '👕 Ropa', hogar: '🏠 Hogar',
  salud: '💊 Salud', ocio: '🎬 Ocio', transporte: '🚌 Transporte', tech: '📱 Tech',
  mascotas: '🐾 Mascotas', educacion: '📚 Educación', regalos: '🎁 Regalos',
  facturas: '📄 Facturas', viajes: '✈️ Viajes', otros: '📦 Otros',
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────
async function sendMessage(chatId: string, text: string, parseMode?: string) {
  try {
    await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
    })
  } catch {
    // No bloquear la respuesta si falla el reply
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}
