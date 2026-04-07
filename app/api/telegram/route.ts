import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN!
const API_BASE     = `https://api.telegram.org/bot${BOT_TOKEN}`

export async function POST(req: NextRequest) {
  const body = await req.json()

  const message = body.message
  if (!message || !message.text) {
    return NextResponse.json({ ok: true })
  }

  const chatId = String(message.chat.id)
  const text   = (message.text as string).trim()

  // Comando /start → le muestra su chat ID para registrarse en la app
  if (text === '/start' || text.startsWith('/start')) {
    await sendMessage(chatId,
      `👋 Hola\\! Soy tu bot de gastos\\.\n\n` +
      `Tu ID de Telegram es:\n\`${chatId}\`\n\n` +
      `Copialo y pegalo en la app \\(botón 🔗 → tab Telegram\\) para vincular tu cuenta\\.\n\n` +
      `Después podés mandar gastos así:\n` +
      `*Compra helado por 150 con itau*\n` +
      `*Pizza por 350*\n` +
      `*Uber por 80 con brou*`
    , 'MarkdownV2')
    return NextResponse.json({ ok: true })
  }

  // Buscar usuario registrado para este chat ID
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

  // Parsear el mensaje de gasto
  const parsed = parseMessage(text)
  if (!parsed) {
    await sendMessage(chatId,
      '❌ No entendí el mensaje\\.\n\n' +
      'Formato: `Compra helado por 150 con itau`\n\n' +
      'Bancos: `itau`, `brou`, `scotiabank`\n' +
      'Sin banco \\(efectivo\\): `Pizza por 350`',
      'MarkdownV2'
    )
    return NextResponse.json({ ok: true })
  }

  // Fecha y mes actuales (Uruguay UTC-3)
  const now         = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const month       = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const expenseDate = `${month}-${String(now.getUTCDate()).padStart(2, '0')}`

  const { error } = await supabaseAdmin.from('expenses').insert({
    user_id:      phoneUser.user_id,
    description:  parsed.description,
    amount:       parsed.amount,
    currency:     'UYU',
    bank:         parsed.bank,
    month,
    expense_date: expenseDate,
    category:     parsed.category,
    is_owed:      !!parsed.bank,
  })

  if (error) {
    await sendMessage(chatId, '❌ Error al guardar el gasto\\. Intentá de nuevo\\.', 'MarkdownV2')
  } else {
    const bankLine  = parsed.bank ? `\nTarjeta: ${escapeMarkdown(parsed.bank)}` : '\nPago: Efectivo'
    const catLine   = parsed.category ? `\nCategoría: ${escapeMarkdown(CATEGORY_LABELS[parsed.category] ?? parsed.category)}` : ''
    const owedLine  = parsed.bank ? '\n💸 Marcado como Debes a Fer' : ''
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

// ─── Parser de mensajes ───────────────────────────────────────────────────────
function parseMessage(text: string): {
  description: string
  amount: number
  bank: string | null
  category: string | null
} | null {
  const match = text.match(/^(.+?)\s+por\s+([\d.,]+)(?:\s+con\s+(\w+))?$/i)
  if (!match) return null

  const description = match[1].trim()
  const amount      = parseFloat(match[2].replace(',', '.'))
  if (isNaN(amount) || amount <= 0) return null

  const bank     = normalizeBank(match[3] ?? null)
  const category = detectCategory(description)

  return { description, amount, bank, category }
}

function normalizeBank(raw: string | null): string | null {
  if (!raw) return null
  const r = raw.toLowerCase()
  if (r.includes('ita')) return 'Itaú'
  if (r.includes('brou')) return 'BROU'
  if (r.includes('scotia')) return 'Scotiabank'
  return null
}

// ─── Categorías por keywords ──────────────────────────────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  comida:     ['comida', 'helado', 'pizza', 'sushi', 'café', 'cafe', 'restaurant', 'restaurante',
               'almuerzo', 'cena', 'desayuno', 'super', 'supermercado', 'verdulería', 'verduleria',
               'panadería', 'panaderia', 'carnicería', 'carniceria', 'mercado', 'delivery',
               'hamburguesa', 'empanadas', 'medialunas', 'asado', 'milanesa', 'pan', 'leche'],
  nafta:      ['nafta', 'combustible', 'gasoil', 'ypf', 'ancap', 'petrobras', 'axion'],
  ropa:       ['ropa', 'zapatillas', 'zapatos', 'camisa', 'pantalón', 'pantalon', 'vestido',
               'remera', 'buzo', 'campera', 'zara', 'calzado'],
  hogar:      ['hogar', 'ferretería', 'ferreteria', 'mueble', 'decoración', 'decoracion',
               'limpieza', 'sodimac'],
  salud:      ['farmacia', 'médico', 'medico', 'doctor', 'clinica', 'clínica', 'dentista',
               'medicamento', 'remedio', 'óptica', 'optica'],
  ocio:       ['cine', 'teatro', 'bar', 'boliche', 'netflix', 'spotify', 'gym', 'gimnasio', 'pilates'],
  transporte: ['uber', 'taxi', 'colectivo', 'ómnibus', 'omnibus', 'remis', 'peaje',
               'estacionamiento', 'parking', 'cabify'],
  tech:       ['computadora', 'celular', 'tablet', 'auriculares', 'cargador', 'notebook'],
  mascotas:   ['veterinaria', 'veterinario', 'mascota', 'perro', 'gato', 'petshop'],
  educacion:  ['curso', 'libro', 'universidad', 'colegio', 'udemy', 'clases'],
  regalos:    ['regalo', 'cumpleaños', 'flores'],
  facturas:   ['factura', 'luz', 'agua', 'gas', 'internet', 'antel', 'ute', 'ose', 'alquiler'],
  viajes:     ['hotel', 'vuelo', 'pasaje', 'airbnb', 'hostel', 'turismo'],
}

const CATEGORY_LABELS: Record<string, string> = {
  comida: '🍔 Comida', nafta: '⛽ Nafta', ropa: '👕 Ropa', hogar: '🏠 Hogar',
  salud: '💊 Salud', ocio: '🎬 Ocio', transporte: '🚌 Transporte', tech: '📱 Tech',
  mascotas: '🐾 Mascotas', educacion: '📚 Educación', regalos: '🎁 Regalos',
  facturas: '📄 Facturas', viajes: '✈️ Viajes',
}

function detectCategory(description: string): string | null {
  const lower = description.toLowerCase()
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some(w => lower.includes(w))) return category
  }
  return null
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────
async function sendMessage(chatId: string, text: string, parseMode?: string) {
  try {
    await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    chatId,
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
