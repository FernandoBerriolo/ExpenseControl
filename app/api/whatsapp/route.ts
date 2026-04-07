import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const VERIFY_TOKEN    = process.env.WHATSAPP_VERIFY_TOKEN!
const ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN!
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!

// ─── Verificación de webhook (Meta lo llama al configurarlo) ──────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

// ─── Recibir mensajes entrantes ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()

  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
  if (!message || message.type !== 'text') {
    return NextResponse.json({ status: 'ok' })
  }

  const fromPhone = message.from as string          // ej: "59899123456"
  const text      = (message.text.body as string).trim()

  // Buscar el usuario registrado para este número
  const { data: phoneUser } = await supabaseAdmin
    .from('phone_users')
    .select('user_id')
    .eq('phone', fromPhone)
    .single()

  if (!phoneUser) {
    await reply(fromPhone, '❌ Tu número no está registrado. Entrá a la app, abrí la sección WhatsApp y registrá tu número.')
    return NextResponse.json({ status: 'ok' })
  }

  // Parsear el mensaje
  const parsed = parseMessage(text)
  if (!parsed) {
    await reply(fromPhone, '❌ No entendí el mensaje.\n\nFormato: *Compra helado por 150 con itau*\n\nBancos: itau, brou, scotiabank (o sin banco para efectivo)')
    return NextResponse.json({ status: 'ok' })
  }

  // Fecha y mes actuales (Uruguay, UTC-3)
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
    is_owed:      !!parsed.bank,  // si se pagó con tarjeta → debes a Fer
  })

  if (error) {
    await reply(fromPhone, '❌ Error al guardar el gasto. Intentá de nuevo.')
  } else {
    const bankLine   = parsed.bank ? `\nTarjeta: ${parsed.bank}` : '\nPago: Efectivo'
    const catLine    = parsed.category ? `\nCategoría: ${CATEGORY_LABELS[parsed.category] ?? parsed.category}` : ''
    const owedLine   = parsed.bank ? '\n💸 Marcado como Debes a Fer' : ''
    await reply(fromPhone, `✅ Gasto guardado\n\n*${parsed.description}*\n$ ${parsed.amount.toLocaleString('es-UY')}${bankLine}${catLine}${owedLine}`)
  }

  return NextResponse.json({ status: 'ok' })
}

// ─── Parser de mensajes ───────────────────────────────────────────────────────
// Formato esperado: "Compra helado por 150 con itau"
//                   "Pizza por 350"
//                   "Uber por 80 con brou"

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

// ─── Detección automática de categoría por keywords ──────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  comida:       ['comida', 'helado', 'pizza', 'sushi', 'café', 'cafe', 'restaurant', 'restaurante',
                 'almuerzo', 'cena', 'desayuno', 'super', 'supermercado', 'verdulería', 'verduleria',
                 'panadería', 'panaderia', 'carnicería', 'carniceria', 'mercado', 'delivery',
                 'hamburguesa', 'hamburgesa', 'empanadas', 'medialunas', 'asado', 'milanesa',
                 'facturas', 'mate', 'pan', 'leche', 'yogur', 'queso', 'fiambre'],
  nafta:        ['nafta', 'combustible', 'gasoil', 'ypf', 'ancap', 'petrobras', 'axion'],
  ropa:         ['ropa', 'zapatillas', 'zapatos', 'camisa', 'pantalón', 'pantalon', 'vestido',
                 'remera', 'buzo', 'campera', 'zara', 'h&m', 'calzado'],
  hogar:        ['hogar', 'ferretería', 'ferreteria', 'mueble', 'decoración', 'decoracion',
                 'limpieza', 'sodimac', 'pinturas', 'herramienta'],
  salud:        ['farmacia', 'médico', 'medico', 'doctor', 'clinica', 'clínica', 'dentista',
                 'medicamento', 'remedio', 'óptica', 'optica'],
  ocio:         ['cine', 'teatro', 'bar', 'boliche', 'netflix', 'spotify', 'gym', 'gimnasio',
                 'pilates', 'fiesta', 'juego', 'deporte'],
  transporte:   ['uber', 'taxi', 'colectivo', 'ómnibus', 'omnibus', 'remis', 'peaje',
                 'estacionamiento', 'parking', 'cabify'],
  tech:         ['computadora', 'celular', 'tablet', 'auriculares', 'cargador', 'cable',
                 'notebook', 'teclado', 'mouse'],
  mascotas:     ['veterinaria', 'veterinario', 'mascota', 'perro', 'gato', 'petshop', 'purina'],
  educacion:    ['curso', 'libro', 'universidad', 'colegio', 'udemy', 'clases', 'academia'],
  regalos:      ['regalo', 'cumpleaños', 'flores', 'tarjeta'],
  facturas:     ['factura', 'luz', 'agua', 'gas', 'internet', 'celular', 'antel', 'ute', 'ose',
                 'alquiler', 'expensas'],
  viajes:       ['hotel', 'vuelo', 'pasaje', 'airbnb', 'hostel', 'turismo', 'excursión'],
}

const CATEGORY_LABELS: Record<string, string> = {
  comida: '🍔 Comida', nafta: '⛽ Nafta', ropa: '👕 Ropa', hogar: '🏠 Hogar',
  salud: '💊 Salud', ocio: '🎬 Ocio', transporte: '🚌 Transporte', tech: '📱 Tech',
  mascotas: '🐾 Mascotas', educacion: '📚 Educación', regalos: '🎁 Regalos',
  facturas: '📄 Facturas', viajes: '✈️ Viajes', otros: '📦 Otros',
}

function detectCategory(description: string): string | null {
  const lower = description.toLowerCase()
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some(w => lower.includes(w))) return category
  }
  return null
}

// ─── Enviar respuesta por WhatsApp ────────────────────────────────────────────
async function reply(to: string, message: string) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) return
  try {
    await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    })
  } catch {
    // No bloquear la respuesta si falla el reply
  }
}
