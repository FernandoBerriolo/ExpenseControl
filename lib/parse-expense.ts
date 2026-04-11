const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!

export type ExpenseItem = {
  description: string
  amount: number
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
export type ParseResult = ParsedExpenses | ParsedQuery | null

export async function parseExpenseMessage(text: string): Promise<ParseResult> {
  const today = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
  const monthStr = todayStr.slice(0, 7)

  const systemPrompt = `Sos un asistente de gastos personales. Hoy es ${todayStr}.
Tu tarea: determinar si el mensaje contiene GASTOS a registrar o una CONSULTA sobre gastos.

═══ GASTOS ═══
Si hay uno o más gastos, respondé con este JSON (SIEMPRE con "items" como array):
{
  "type": "expenses",
  "items": [
    {
      "description": "nombre corto del gasto (2-4 palabras)",
      "amount": número (solo dígitos, sin símbolos de moneda),
      "bank": "Itaú" | "BROU" | "Scotiabank" | null,
      "category": "comida"|"nafta"|"ropa"|"hogar"|"salud"|"ocio"|"transporte"|"tech"|"mascotas"|"educacion"|"regalos"|"facturas"|"viajes"|"belleza" | null,
      "installments": número de cuotas o null,
      "date": "YYYY-MM-DD" solo si mencionan fecha distinta a hoy, si no null
    }
  ]
}

CRÍTICO — Extracción de monto (ignorar $, $U, U$S):
- "compré un helado por $150" → amount: 150
- "me hice las uñas por $750" → amount: 750
- "gasté $300 en la cena" → amount: 300
- "me salió 200 la pizza" → amount: 200

CRÍTICO — Categoría "belleza": uñas, peluquería, corte de pelo, tintura, shampú, cremas, maquillaje, depilación, manicura, pedicura, perfume, skincare → category: "belleza"

CRÍTICO — Múltiples gastos: cada gasto mencionado va como un item separado:
- "helado por 150 y milanesa por 300" → items con 2 entradas

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

    let rawItems: unknown[] = []
    if (parsed.type === 'expenses' && Array.isArray(parsed.items)) {
      rawItems = parsed.items
    } else if (parsed.amount && Number(parsed.amount) > 0) {
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
  } catch {
    return null
  }
}
