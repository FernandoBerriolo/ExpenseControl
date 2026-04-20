const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!

export type ExpenseItem = {
  description: string
  amount: number
  currency: 'UYU' | 'USD' | 'EUR'
  bank: string | null
  category: string | null
  installments: number | null
  date: string | null
}

export type ParsedExpenses = { type: 'expenses'; items: ExpenseItem[] }
export type ParsedQuery = {
  type: 'query'
  query: 'owed' | 'category_total' | 'monthly_total'
  category: string | null
  month: string
}
export type ParsedEntry = {
  type: 'income' | 'savings'
  description: string
  amount: number
  currency: 'UYU' | 'USD' | 'EUR'
}
export type ParseResult = ParsedExpenses | ParsedQuery | ParsedEntry | null

export async function parseExpenseMessage(
  text: string,
  cards: string[] = ['Itaú', 'BROU', 'Scotiabank'],
): Promise<ParseResult> {
  const today = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
  const monthStr = todayStr.slice(0, 7)

  const cardOptions = cards.length > 0 ? cards.map(c => `"${c}"`).join(' | ') + ' | null' : 'null'

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
      "currency": "UYU" | "USD" | "EUR",
      "bank": ${cardOptions},
      "category": "comida"|"nafta"|"ropa"|"hogar"|"alquiler"|"salud"|"ocio"|"transporte"|"tech"|"mascotas"|"educacion"|"regalos"|"facturas"|"viajes"|"belleza" | null,
      "installments": número de cuotas o null,
      "date": "YYYY-MM-DD" solo si mencionan fecha distinta a hoy, si no null
    }
  ]
}

CRÍTICO — Moneda:
- "dólares","dolar","dolares","USD","U$S","us$","usd" → currency: "USD"
- "euros","euro","EUR","€" → currency: "EUR"
- Sin mención o "pesos","$" → currency: "UYU"

CRÍTICO — Extracción de monto (ignorar $, $U, U$S, €):
- "compré un helado por $150" → amount: 150
- "gasté 30 dólares" → amount: 30, currency: "USD"
- "pagué 20 euros" → amount: 20, currency: "EUR"

CRÍTICO — Categoría "belleza": uñas, peluquería, corte, tintura, cremas, maquillaje, depilación, manicura, pedicura, perfume, skincare
CRÍTICO — Categoría "alquiler": alquiler, renta, arrendamiento

CRÍTICO — Múltiples gastos → múltiples items

═══ INGRESOS ═══
Si el mensaje es un ingreso recibido (sueldo, cobro, freelance, salario):
{"type":"income","description":"Sueldo"|descripción corta,"amount":número,"currency":"UYU"|"USD"|"EUR"}

═══ AHORROS ═══
Si el mensaje indica que ahorró o guardó dinero:
{"type":"savings","description":"Ahorro"|descripción corta,"amount":número,"currency":"UYU"|"USD"|"EUR"}

═══ CONSULTAS ═══
{"type":"query","query":"owed"|"category_total"|"monthly_total","category":null o categoría,"month":"YYYY-MM"}

═══ REGLAS ═══
- Sin monto claro → {"error": "sin_monto"}
- Tarjetas disponibles: ${cards.join(', ')} (o efectivo si no menciona tarjeta)
- "este mes" → "${monthStr}" | "el mes pasado" → mes anterior
- Respondé ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown`

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
        max_tokens: 512,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: text }],
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
      return { type: 'query', query: parsed.query, category: parsed.category ?? null, month: parsed.month }
    }

    if (parsed.type === 'income' || parsed.type === 'savings') {
      if (!parsed.amount || Number(parsed.amount) <= 0) return null
      return {
        type:        parsed.type,
        description: parsed.description ?? (parsed.type === 'income' ? 'Sueldo' : 'Ahorro'),
        amount:      Number(parsed.amount),
        currency:    normalizeCurrency(parsed.currency),
      }
    }

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
        currency:     normalizeCurrency(i.currency),
        bank:         normalizeBank(i.bank, cards),
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

export async function analyzeReceiptImage(
  base64: string,
  mimeType: string,
  cards: string[] = [],
): Promise<ParseResult> {
  const cardOptions = cards.length > 0 ? cards.map(c => `"${c}"`).join(' | ') + ' | null' : 'null'
  const prompt = `Analizá esta imagen de un ticket, factura o recibo.
Si hay un "monto total", "total" o similar, extrae SOLO ese monto como UN ÚNICO gasto.
NO incluyas los items individuales, solo el total.
Devolvé ÚNICAMENTE este JSON (sin markdown, sin texto extra):
{
  "type": "expenses",
  "items": [{
    "description": "nombre corto del gasto (2-4 palabras)",
    "amount": monto total del recibo,
    "currency": "UYU" | "USD" | "EUR",
    "bank": ${cardOptions},
    "category": "comida"|"nafta"|"ropa"|"hogar"|"alquiler"|"salud"|"ocio"|"transporte"|"tech"|"mascotas"|"educacion"|"regalos"|"facturas"|"viajes"|"belleza"|null,
    "installments": null,
    "date": "YYYY-MM-DD" si se ve la fecha, si no null
  }]
}
Si no hay monto total identificable, devolvé: {"error":"no_total"}
Tarjetas disponibles: ${cards.join(', ') || 'ninguna'}`

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
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text',  text: prompt },
          ],
        }],
      }),
    })
    const data = await res.json()
    if (res.status !== 200) return null
    const raw = data.content?.[0]?.text?.trim()
    if (!raw) return null

    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(clean)
    if (parsed.error) return null

    let rawItems: unknown[] = []
    if (parsed.type === 'expenses' && Array.isArray(parsed.items)) rawItems = parsed.items
    else if (parsed.amount && Number(parsed.amount) > 0) rawItems = [parsed]

    const items: ExpenseItem[] = (rawItems as { description?: string; amount?: unknown; currency?: string; bank?: string | null; category?: string | null; installments?: unknown; date?: string | null }[])
      .filter(i => i.amount && Number(i.amount) > 0)
      .map(i => ({
        description:  i.description ?? 'Gasto',
        amount:       Number(i.amount),
        currency:     normalizeCurrency(i.currency),
        bank:         normalizeBank(i.bank, cards),
        category:     i.category ?? null,
        installments: null,
        date:         i.date ?? null,
      }))

    if (items.length === 0) return null
    return { type: 'expenses', items }
  } catch {
    return null
  }
}

function normalizeCurrency(c: string | undefined | null): 'UYU' | 'USD' | 'EUR' {
  if (c === 'USD') return 'USD'
  if (c === 'EUR') return 'EUR'
  return 'UYU'
}

function normalizeBank(bank: string | null | undefined, validCards: string[]): string | null {
  if (!bank) return null
  const found = validCards.find(c => c.toLowerCase() === bank.toLowerCase())
  return found ?? null
}
