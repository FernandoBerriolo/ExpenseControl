import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN!
const GEMINI_KEY      = process.env.GEMINI_API_KEY!
const OWED_USER_EMAIL = process.env.OWED_USER_EMAIL ?? ''   // email de quien debe a Fer
const API_BASE        = `https://api.telegram.org/bot${BOT_TOKEN}`

export async function POST(req: NextRequest) {
  const body = await req.json()

  const message = body.message
  if (!message || !message.text) {
    return NextResponse.json({ ok: true })
  }

  const chatId = String(message.chat.id)

  // Determinar si es texto o audio de voz
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
      `Después podés mandar gastos en lenguaje natural, por ejemplo:\n` +
      `_"me comí una pizza y pagué 350 con el itau"_\n` +
      `_"nafta 800 brou"_\n` +
      `_"fui al super gasté 2500"_`,
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

  // Parsear con IA (texto o audio)
  const parsed = await parseWithAI(text || null, audioBase64, audioMime)
  if (!parsed) {
    await sendMessage(chatId,
      '❌ No pude entender el gasto\\. Asegurate de mencionar el monto\\.\n\n' +
      'Podés mandar texto o un mensaje de voz, por ejemplo:\n' +
      '_"pizza 350 itau"_\n' +
      '_"gasté 1200 en ropa con brou"_',
      'MarkdownV2'
    )
    return NextResponse.json({ ok: true })
  }

  // Fecha y mes actuales (Uruguay UTC-3)
  const now         = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const month       = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const expenseDate = `${month}-${String(now.getUTCDate()).padStart(2, '0')}`

  // is_owed solo si hay tarjeta Y el usuario es Guille
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(phoneUser.user_id)
  const isGuille = !!OWED_USER_EMAIL && authUser?.user?.email === OWED_USER_EMAIL

  const { error } = await supabaseAdmin.from('expenses').insert({
    user_id:      phoneUser.user_id,
    description:  parsed.description,
    amount:       parsed.amount,
    currency:     'UYU',
    bank:         parsed.bank,
    month,
    expense_date: expenseDate,
    category:     parsed.category,
    is_owed:      isGuille && !!parsed.bank,
  })

  if (error) {
    await sendMessage(chatId, '❌ Error al guardar el gasto\\. Intentá de nuevo\\.', 'MarkdownV2')
  } else {
    const bankLine = parsed.bank ? `\nTarjeta: ${escapeMarkdown(parsed.bank)}` : '\nPago: Efectivo'
    const catLine  = parsed.category ? `\nCategoría: ${escapeMarkdown(CATEGORY_LABELS[parsed.category] ?? parsed.category)}` : ''
    const owedLine = parsed.bank ? '\n💸 Marcado como Debes a Fer' : ''
    await sendMessage(chatId,
      `✅ *Gasto guardado*\n\n` +
      `*${escapeMarkdown(parsed.description)}*\n` +
      `\\$ ${escapeMarkdown(parsed.amount.toLocaleString('es-UY'))}` +
      `${bankLine}${catLine}${owedLine}`,
      'MarkdownV2'
    )
  }

  return NextResponse.json({ ok: true })
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
): Promise<{
  description: string
  amount: number
  bank: string | null
  category: string | null
} | null> {
  const prompt = `Sos un asistente que extrae datos de gastos personales a partir de mensajes en español rioplatense.
${text ? `Mensaje de texto: "${text}"` : 'El mensaje es un audio de voz — transcribilo y extraé el gasto.'}

Extraé la información y respondé ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "description": "nombre corto y claro del gasto (ej: Pizza, Supermercado, Nafta YPF)",
  "amount": número (solo el valor numérico, sin símbolos),
  "bank": "Itaú" | "BROU" | "Scotiabank" | null (null si es efectivo o no se menciona tarjeta),
  "category": una de estas opciones o null: "comida", "nafta", "ropa", "hogar", "salud", "ocio", "transporte", "tech", "mascotas", "educacion", "regalos", "facturas", "viajes"
}

Reglas:
- Si no hay monto claro, respondé: {"error": "sin_monto"}
- "itau" o "itaú" → "Itaú", "brou" → "BROU", "scotia" o "scotiabank" → "Scotiabank"
- La descripción debe ser corta (2-4 palabras máximo)
- Inferí la categoría según el contexto (pizza/helado/super → comida, uber/taxi → transporte, etc.)`

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
    console.log('[Gemini] status:', res.status)
    console.log('[Gemini] response:', JSON.stringify(data))

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) return null

    const clean  = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    console.log('[Gemini] parsed text:', clean)

    const parsed = JSON.parse(clean)
    if (parsed.error || !parsed.amount || Number(parsed.amount) <= 0) return null

    return {
      description: parsed.description ?? text,
      amount:      Number(parsed.amount),
      bank:        parsed.bank ?? null,
      category:    parsed.category ?? null,
    }
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
  facturas: '📄 Facturas', viajes: '✈️ Viajes',
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
