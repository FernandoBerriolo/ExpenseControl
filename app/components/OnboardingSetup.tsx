'use client'
import { useState } from 'react'
import { supabase, type Currency, type PaymentMethod, type UserSettings } from '@/lib/supabase'

type NewCard = { name: string; type: 'credit' | 'debit'; closing_day: string }

const CURRENCY_OPTIONS: { value: Currency; label: string; symbol: string; emoji: string }[] = [
  { value: 'UYU', label: 'Peso Uruguayo', symbol: '$',   emoji: '🇺🇾' },
  { value: 'USD', label: 'Dólar',         symbol: 'USD', emoji: '🇺🇸' },
  { value: 'EUR', label: 'Euro',          symbol: '€',   emoji: '🇪🇺' },
]

export default function OnboardingSetup({
  userId,
  onComplete,
}: {
  userId: string
  onComplete: (settings: UserSettings, methods: PaymentMethod[]) => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [currencies, setCurrencies] = useState<Currency[]>(['UYU'])
  const [defaultCurrency, setDefaultCurrency] = useState<Currency>('UYU')
  const [cards, setCards] = useState<NewCard[]>([])
  const [cardName, setCardName] = useState('')
  const [cardType, setCardType] = useState<'credit' | 'debit'>('credit')
  const [cardClosingDay, setCardClosingDay] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleCurrency(c: Currency) {
    setCurrencies(prev => {
      const newCurrencies = prev.includes(c)
        ? prev.length > 1 ? prev.filter(x => x !== c) : prev
        : [...prev, c]
      // Si deseleccionas la moneda por defecto, cambia a la primera disponible
      if (!newCurrencies.includes(defaultCurrency)) {
        setDefaultCurrency(newCurrencies[0])
      }
      return newCurrencies
    })
  }

  function addCard() {
    const name = cardName.trim()
    if (!name) return
    if (cards.find(c => c.name.toLowerCase() === name.toLowerCase())) return
    setCards(prev => [...prev, { name, type: cardType, closing_day: cardClosingDay }])
    setCardName('')
    setCardType('credit')
    setCardClosingDay('')
  }

  function removeCard(name: string) {
    setCards(prev => prev.filter(c => c.name !== name))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      // Step 1: Guardar user settings
      const { error: settingsErr } = await supabase.from('user_settings').upsert({
        user_id:           userId,
        currencies,
        default_currency:  defaultCurrency,
        is_legacy:         false,
        setup_completed:   true,
      })
      if (settingsErr) {
        console.error('❌ Error guardando user_settings:', settingsErr)
        throw new Error(`Error en configuración: ${settingsErr.message}`)
      }

      // Step 2: Preparar métodos de pago
      const methods: { user_id: string; name: string; type: string; closing_day: number | null; sort_order: number }[] = [
        { user_id: userId, name: 'Efectivo', type: 'cash', closing_day: null, sort_order: 0 },
      ]
      cards.forEach((c, i) => {
        methods.push({
          user_id:     userId,
          name:        c.name,
          type:        c.type,
          closing_day: c.type === 'credit' && c.closing_day ? parseInt(c.closing_day) : null,
          sort_order:  i + 1,
        })
      })

      // Step 3: Borrar métodos de pago antiguos primero
      const { error: deleteErr } = await supabase.from('payment_methods').delete().eq('user_id', userId)
      if (deleteErr) {
        console.error('❌ Error borrando payment_methods:', deleteErr)
        throw new Error(`Error al limpiar tarjetas: ${deleteErr.message}`)
      }
      
      // Step 4: Guardar nuevos métodos de pago
      const { data: savedMethods, error: pmErr } = await supabase
        .from('payment_methods')
        .insert(methods)
        .select('*')
      if (pmErr) {
        console.error('❌ Error guardando payment_methods:', pmErr)
        throw new Error(`Error al guardar tarjetas: ${pmErr.message}`)
      }

      // Step 5: Obtener configuración guardada
      const { data: settingsData, error: fetchErr } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .single()
      
      if (fetchErr) {
        console.error('❌ Error obteniendo user_settings:', fetchErr)
        throw new Error(`Error al obtener configuración: ${fetchErr.message}`)
      }

      onComplete(settingsData as UserSettings, (savedMethods ?? []) as PaymentMethod[])
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error desconocido'
      console.error('❌ Error en handleSave:', message)
      setError(message || 'Error al guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'var(--grad)' }}>
      <div className="bg-surface rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="text-4xl mb-3 text-center">💸</div>
          <h1 className="text-xl font-bold text-ink text-center">¡Bienvenido!</h1>
          <p className="text-sm text-muted text-center mt-1">Configurá tu cuenta en 2 pasos</p>
          {/* Steps */}
          <div className="flex items-center gap-2 mt-4">
            <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--primary)' }} />
            <div className="flex-1 h-1.5 rounded-full"
              style={{ background: step === 2 ? 'var(--primary)' : 'var(--line)' }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs font-medium" style={{ color: 'var(--primary)' }}>Monedas</span>
            <span className="text-xs font-medium" style={{ color: step === 2 ? 'var(--primary)' : 'var(--muted-2)' }}>Métodos de pago</span>
          </div>
        </div>

        <div className="px-6 pb-6 max-h-[70vh] overflow-y-auto">
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-ink-2 font-medium">¿Qué monedas usás?</p>
              {CURRENCY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleCurrency(opt.value)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all"
                  style={currencies.includes(opt.value)
                    ? { borderColor: 'var(--primary)', background: 'var(--primary-soft)' }
                    : { borderColor: 'var(--line)', background: 'var(--surface)' }}>
                  <span className="text-2xl">{opt.emoji}</span>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-sm text-ink">{opt.label}</p>
                    <p className="text-xs text-muted-2">{opt.symbol}</p>
                  </div>
                  <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                    style={currencies.includes(opt.value)
                      ? { borderColor: 'var(--primary)', background: 'var(--primary)' }
                      : { borderColor: 'var(--line)' }}>
                    {currencies.includes(opt.value) && <span className="text-white text-xs">✓</span>}
                  </div>
                </button>
              ))}

              {/* Moneda por defecto */}
              <div className="mt-5 pt-4 border-t border-line">
                <p className="text-sm text-ink-2 font-medium mb-2">Moneda por defecto</p>
                <select
                  value={defaultCurrency}
                  onChange={(e) => setDefaultCurrency(e.target.value as Currency)}
                  className="field focus:ring-purple-500 text-ink bg-surface">
                  {currencies.map(c => {
                    const opt = CURRENCY_OPTIONS.find(o => o.value === c)
                    return <option key={c} value={c}>{opt?.emoji} {opt?.label}</option>
                  })}
                </select>
                <p className="text-xs text-muted-2 mt-1">Se usará cuando no especifiques moneda en un gasto</p>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={currencies.length === 0}
                className="w-full mt-4 py-3 rounded-xl font-semibold text-white"
                style={{ background: 'var(--grad)' }}>
                Siguiente →
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-ink-2 font-medium">¿Con qué pagás? <span className="text-muted-2 font-normal">(Efectivo siempre incluido)</span></p>

              {/* Card added */}
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: 'var(--income-soft)', border: '1px solid var(--line)' }}>
                <span>💵</span>
                <span className="text-sm font-medium text-income">Efectivo</span>
                <span className="text-xs text-income ml-auto">Siempre disponible</span>
              </div>

              {cards.map(c => (
                <div key={c.name} className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                  style={{ background: 'var(--primary-softer)', border: '1px solid var(--line)' }}>
                  <span>{c.type === 'credit' ? '💳' : '🏦'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-indigo-700">{c.name}</p>
                    <p className="text-xs text-indigo-400">
                      {c.type === 'credit' ? 'Crédito' : 'Débito'}
                      {c.type === 'credit' && c.closing_day ? ` · Cierre día ${c.closing_day}` : ''}
                    </p>
                  </div>
                  <button onClick={() => removeCard(c.name)} className="text-danger hover:text-danger text-lg">×</button>
                </div>
              ))}

              {/* Add card form */}
              <div className="rounded-xl border border-line p-3 space-y-2.5">
                <p className="text-xs font-semibold text-muted">AGREGAR TARJETA</p>
                <input
                  type="text"
                  value={cardName}
                  onChange={e => setCardName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCard()}
                  placeholder="Nombre (ej: Visa, Itaú, BROU)"
                  className="w-full px-3 py-2 rounded-lg border border-line text-sm text-ink placeholder-muted-2 focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  {(['credit', 'debit'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCardType(t)}
                      className="py-2 rounded-lg border-2 text-xs font-semibold transition-all"
                      style={cardType === t
                        ? { borderColor: 'var(--primary)', background: 'var(--primary-soft)', color: 'var(--primary)' }
                        : { borderColor: 'var(--line)', color: 'var(--muted-2)' }}>
                      {t === 'credit' ? '💳 Crédito' : '🏦 Débito'}
                    </button>
                  ))}
                </div>
                {cardType === 'credit' && (
                  <input
                    type="number"
                    value={cardClosingDay}
                    onChange={e => setCardClosingDay(e.target.value)}
                    placeholder="Día de cierre (ej: 26)"
                    min={1} max={31}
                    className="w-full px-3 py-2 rounded-lg border border-line text-sm text-ink placeholder-muted-2 focus:outline-none"
                  />
                )}
                <button
                  type="button"
                  onClick={addCard}
                  disabled={!cardName.trim()}
                  className="w-full py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
                  style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
                  + Agregar
                </button>
              </div>

              {error && <p className="text-xs text-danger">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setStep(1)}
                  className="flex-1 py-3 rounded-xl font-semibold text-ink-2 border border-line">
                  ← Volver
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl font-semibold text-white"
                  style={{ background: 'var(--grad)' }}>
                  {saving ? '...' : '¡Listo!'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
