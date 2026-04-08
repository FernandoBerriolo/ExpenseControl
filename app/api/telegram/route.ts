import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN!
const GEMINI_KEY      = process.env.GEMINI_API_KEY!
const OWED_USER_EMAIL = process.env.OWED_USER_EMAIL ?? ''
const API_BASE        = `https://api.telegram.org/bot${BOT_TOKEN}`

// ─── Types ────────────────────────────────────────────────────────────────────
type ExpenseItem = {
  description: string
  amount: number
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

type AIResult = ExpensesResult | QueryResult | null

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()

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
    if (fileData) {
      transcribedText = await transcribeAudio(fileData.base64, fileData.mime)
      if (!transcribedText) {
        await sendMessage(chatId, '❌ No pude escuchar el audio\\. Intentá mandar el gasto por texto\\.', 'MarkdownV2')
        return NextResponse.json({ ok: true })
      }
      console.log('[Audio] transcription:', transcribedText)
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

  const result = await parseWithAI(text || null)

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

  // ── Guardar gastos ────────────────────────────────────────────────────────
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(phoneUser.user_id)
  const isGuille = !!OWED_USER_EMAIL && authUser?.user?.email === OWED_USER_EMAIL

  const allEntries = []
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
        currency:     'UYU',
        bank:         item.bank,
        month,
        expense_date: expenseDate,
        category:     item.category,
        is_owed:      isGuille && !!item.bank,
      })
    }
  }

  const { error } = await supabaseAdmin.from('expenses').insert(allEntries)

  if (error) {
    await sendMessage(chatId, '❌ Error al guardar\\. Intentá de nuevo\\.', 'MarkdownV2')
  } else if (result.items.length === 1) {
    const item = result.items[0]
    const installments = item.installments && item.installments > 1 ? item.installments : 1
    const installmentAmount = Math.round((item.amount / installments) * 100) / 100
    const expenseDate = item.date ?? (() => {
      const y = now.getUTCFullYear()
      const m = String(now.getUTCMonth() + 1).padStart(2, '0')
      const d = String(now.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    })()
    const bankLine   = item.bank ? `\nTarjeta: ${escapeMarkdown(item.bank)}` : '\nPago: Efectivo'
    const catLine    = item.category ? `\nCategoría: ${escapeMarkdown(CATEGORY_LABELS[item.category] ?? item.category)}` : ''
    const owedLine   = isGuille && item.bank ? '\n💸 Marcado como Debes a Fer' : ''
    const cuotasLine = installments > 1 ? `\n${installments} cuotas de \\$${escapeMarkdown(installmentAmount.toLocaleString('es-UY'))}` : ''
    const dateLine   = item.date ? `\nFecha: ${escapeMarkdown(expenseDate.split('-').reverse().join('/'))}` : ''
    await sendMessage(chatId,
      `✅ *Gasto guardado*\n\n` +
      `*${escapeMarkdown(item.description)}*\n` +
      `\\$ ${escapeMarkdown(item.amount.toLocaleString('es-UY'))}` +
      `${cuotasLine}${bankLine}${catLine}${dateLine}${owedLine}`,
      'MarkdownV2'
    )
  } else {
    // Múltiples gastos
    const lines = result.items.map(item =>
      `• *${escapeMarkdown(item.description)}* \\$${escapeMarkdown(item.amount.toLocaleString('es-UY'))}` +
      (item.bank ? ` \\(${escapeMarkdown(item.bank)}\\)` : '')
    ).join('\n')
    const total = result.items.reduce((s, i) => s + i.amount, 0)
    await sendMessage(chatId,
      `✅ *${result.items.length} gastos guardados*\n\n${lines}\n\n*Total: \\$${escapeMarkdown(total.toLocaleString('es-UY'))}*`,
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
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    console.log('[Audio] transcription result:', text)
    return text || null
  } catch (e) {
    console.error('[Audio] transcription error:', e)
    return null
  }
}

// ─── Parsing con Gemini ───────────────────────────────────────────────────────
async function parseWithAI(text: string | null): Promise<AIResult> {
  const today = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
  const monthStr = todayStr.slice(0, 7)

  const prompt = `Sos un asistente de gastos personales. Hoy es ${todayStr}.
Mensaje: "${text}"

Tu tarea: determinar si el mensaje contiene GASTOS a registrar o una CONSULTA sobre gastos.

═══ GASTOS ═══
Si hay uno o más gastos, respondé con este JSON (SIEMPRE con "items" como array):
{
  "type": "expenses",
  "items": [
    {
      "description": "nombre corto del gasto (2-4 palabras)",
      "amount": número (solo dígitos, sin símbolos),
      "bank": "Itaú" | "BROU" | "Scotiabank" | null,
      "category": "comida"|"nafta"|"ropa"|"hogar"|"salud"|"ocio"|"transporte"|"tech"|"mascotas"|"educacion"|"regalos"|"facturas"|"viajes" | null,
      "installments": número de cuotas o null,
      "date": "YYYY-MM-DD" solo si mencionan fecha distinta a hoy, si no null
    }
  ]
}

CRÍTICO — Ejemplos de extracción de monto:
- "compré un helado por 150" → amount: 150
- "me compré unas sandalias por 3000" → amount: 3000
- "gasté 300 en la cena" → amount: 300
- "pagué 500 por el super" → amount: 500
- "me salió 200 la pizza" → amount: 200

CRÍTICO — Múltiples gastos: si el mensaje menciona más de un gasto, CADA UNO va como un item separado:
- "compré un helado por 150 y en la cena gasté 300 que fue una milanesa" →
  items: [{description:"Helado", amount:150, category:"comida"}, {description:"Milanesa al pan", amount:300, category:"comida"}]
- "hamburguesa 100 y papas 50 con itau" →
  items: [{description:"Hamburguesa", amount:100, bank:"Itaú"}, {description:"Papas", amount:50, bank:"Itaú"}]

═══ CONSULTAS ═══
Si es una pregunta sobre gastos, respondé con:
{
  "type": "query",
  "query": "owed" | "category_total" | "monthly_total",
  "category": categoría (solo para category_total),
  "month": "YYYY-MM"
}
- "owed": cuánto le debo a Fer
- "category_total": cuánto gasté en [categoría]
- "monthly_total": cuánto gasté en total

═══ REGLAS ═══
- Sin monto claro → {"error": "sin_monto"}
- "itau"/"itaú" → "Itaú" | "brou" → "BROU" | "scotia" → "Scotiabank"
- "este mes" → "${monthStr}" | "el mes pasado" → mes anterior
- Meses: enero=01 feb=02 mar=03 abr=04 may=05 jun=06 jul=07 ago=08 sep=09 oct=10 nov=11 dic=12
- Respondé ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown`

  const parts: object[] = [{ text: prompt }]

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

    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    console.log('[Gemini] response:', clean)
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

    // Normalizar: soportar tanto {type:"expenses", items:[...]} como {type:"expense", ...}
    let rawItems: unknown[] = []
    if (parsed.type === 'expenses' && Array.isArray(parsed.items)) {
      rawItems = parsed.items
    } else if (parsed.amount && Number(parsed.amount) > 0) {
      // Gemini devolvió formato singular — envolverlo en array
      rawItems = [parsed]
    }

    const items: ExpenseItem[] = (rawItems as { description?: string; amount?: unknown; bank?: string | null; category?: string | null; installments?: unknown; date?: string | null }[])
      .filter(i => i.amount && Number(i.amount) > 0)
      .map(i => ({
        description:  i.description ?? 'Gasto',
        amount:       Number(i.amount),
        bank:         i.bank ?? null,
        category:     i.category ?? null,
        installments: i.installments ? Number(i.installments) : null,
        date:         i.date ?? null,
      }))

    if (items.length === 0) return null
    return { type: 'expenses', items }
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
