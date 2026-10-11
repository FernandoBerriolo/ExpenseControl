'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, type Currency } from '@/lib/supabase'
import {
  MONTHLY_KINDS, RENTAL_KINDS, isRepeatable, kindInfo,
  type RentalCharge, type RentalKind, type RentalReceipt, type RentalSettings,
} from '@/lib/alquiler/types'
import { currentMonth, formatMoney, monthLabel, parseAmount, shiftMonth } from '@/lib/alquiler/format'
import ChargeCard from './ChargeCard'
import { ChevronLeftIcon, ChevronRightIcon } from '@/app/components/Icons'

const KIND_ORDER = RENTAL_KINDS.map(k => k.value)

export default function PagosTab({ userId, homeId, settings }: { userId: string; homeId: string; settings: RentalSettings | null }) {
  const [month, setMonth] = useState(currentMonth())
  const [charges, setCharges] = useState<RentalCharge[]>([])
  const [receipts, setReceipts] = useState<Record<string, RentalReceipt[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const reqId = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqId.current
    const { data, error: err } = await supabase.from('rental_charges').select('*')
      .eq('home_id', homeId).eq('period', month).order('created_at')
    if (id !== reqId.current) return
    if (err) { setError('No se pudieron cargar los pagos'); setLoading(false); return }

    const list = ((data ?? []) as RentalCharge[])
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))

    const grouped: Record<string, RentalReceipt[]> = {}
    if (list.length > 0) {
      const { data: rData } = await supabase.from('rental_receipts').select('*')
        .in('charge_id', list.map(c => c.id)).order('created_at')
      if (id !== reqId.current) return
      for (const r of (rData ?? []) as RentalReceipt[]) (grouped[r.charge_id] ??= []).push(r)
    }
    setError('')
    setCharges(list)
    setReceipts(grouped)
    setLoading(false)
  }, [homeId, month])

  useEffect(() => { setLoading(true); load() }, [load])

  const presentKinds = useMemo(() => new Set(charges.filter(c => !isRepeatable(c.kind)).map(c => c.kind)), [charges])
  const missingMonthly = MONTHLY_KINDS.filter(k => !presentKinds.has(k))

  async function addMonthlyItems() {
    setGenerating(true); setError('')
    const rows = missingMonthly.map(kind => ({
      home_id: homeId, user_id: userId, kind, period: month,
      currency: kind === 'alquiler' ? (settings?.rent_currency ?? 'UYU') : 'UYU',
      amount: kind === 'alquiler' ? (settings?.monthly_rent ?? null) : null,
    }))
    const { error: err } = await supabase.from('rental_charges').insert(rows)
    setGenerating(false)
    if (err && err.code !== '23505') { setError('No se pudieron agregar los rubros del mes'); return }
    load()
  }

  // Resumen del mes
  const paidCount = charges.filter(c => c.paid).length
  const { paidByCurrency, pendingByCurrency } = useMemo(() => {
    const paid: Partial<Record<Currency, number>> = {}
    const pending: Partial<Record<Currency, number>> = {}
    for (const c of charges) {
      if (c.amount == null) continue
      const bucket = c.paid ? paid : pending
      bucket[c.currency] = (bucket[c.currency] ?? 0) + c.amount
    }
    return {
      paidByCurrency: Object.entries(paid) as [Currency, number][],
      pendingByCurrency: Object.entries(pending) as [Currency, number][],
    }
  }, [charges])

  return (
    <div className="space-y-4">
      {/* Selector de mes */}
      <div className="card p-3 flex items-center justify-between">
        <button onClick={() => setMonth(shiftMonth(month, -1))}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-2 text-ink-2" aria-label="Mes anterior">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="text-center">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium">Período</p>
          <p className="text-lg font-bold text-ink">{monthLabel(month)}</p>
        </div>
        <button onClick={() => setMonth(shiftMonth(month, 1))}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-2 text-ink-2" aria-label="Mes siguiente">
          <ChevronRightIcon size={20} />
        </button>
      </div>

      {/* Resumen */}
      {charges.length > 0 && (
        <div className="rounded-3xl p-5 text-white" style={{ background: 'var(--grad-hero)', boxShadow: 'var(--shadow-float)' }}>
          <div className="flex items-baseline justify-between">
            <p className="text-xs text-white/70 uppercase tracking-wider font-medium">Resumen</p>
            <p className="text-sm text-white/90">
              <strong>{paidCount}</strong> de <strong>{charges.length}</strong> pagados
            </p>
          </div>
          <div className="h-2 rounded-full bg-white/20 mt-3 overflow-hidden">
            <div className="h-full rounded-full bg-white transition-all" style={{ width: `${(paidCount / charges.length) * 100}%` }} />
          </div>
          <p className="num text-2xl font-bold mt-4">
            {paidByCurrency.length > 0 ? paidByCurrency.map(([cur, n]) => formatMoney(n, cur)).join(' + ') : '$ 0'}
          </p>
          <p className="text-xs text-white/70">Pagado este mes</p>
          <p className="num text-sm text-white/90 mt-2">
            {pendingByCurrency.length > 0
              ? `Pendiente: ${pendingByCurrency.map(([cur, n]) => formatMoney(n, cur)).join(' + ')}`
              : paidCount === charges.length ? 'Todo al día 🎉' : 'Pendiente: faltan cargar montos'}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-danger text-center">{error}</p>}

      {loading ? (
        <p className="text-center text-sm text-muted-2 py-8">Cargando…</p>
      ) : (
        <>
          {charges.map(c => (
            <ChargeCard
              key={c.id}
              charge={c}
              receipts={receipts[c.id] ?? []}
              settings={settings}
              userId={userId}
              homeId={homeId}
              onChanged={load}
            />
          ))}

          {missingMonthly.length > 0 && (
            <button
              onClick={addMonthlyItems}
              disabled={generating}
              className="w-full py-3 rounded-2xl text-sm font-semibold"
              style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
            >
              {generating ? 'Agregando…' : charges.length === 0
                ? `Armar ${monthLabel(month)} (alquiler, gastos comunes, luz, wifi y garantía)`
                : `Agregar rubros que faltan (${missingMonthly.length})`}
            </button>
          )}

          {showAdd ? (
            <AddChargeForm
              userId={userId}
              homeId={homeId}
              month={month}
              presentKinds={presentKinds}
              onDone={() => { setShowAdd(false); load() }}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <button onClick={() => setShowAdd(true)}
              className="w-full py-3 rounded-2xl text-sm font-semibold text-muted card">
              + Agregar gasto (impuesto, comida, suscripciones…)
            </button>
          )}
        </>
      )}
    </div>
  )
}

function AddChargeForm({ userId, homeId, month, presentKinds, onDone, onCancel }: {
  userId: string
  homeId: string
  month: string
  presentKinds: Set<RentalKind>
  onDone: () => void
  onCancel: () => void
}) {
  // Los rubros del mes (alquiler, gastos comunes, luz, wifi, garantía) se agregan con "Armar mes".
  // Acá van los rubros sueltos que todavía no existen este mes y las categorías de otros gastos, que se pueden repetir.
  const fixedOptions = RENTAL_KINDS.filter(k => !k.repeatable && !MONTHLY_KINDS.includes(k.value) && !presentKinds.has(k.value))
  const extraOptions = RENTAL_KINDS.filter(k => k.repeatable)
  const [kind, setKind] = useState<RentalKind>((fixedOptions[0] ?? extraOptions[0]).value)
  const info = kindInfo(kind)
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('UYU')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    const parsed = parseAmount(amount)
    if (Number.isNaN(parsed)) { setErr('El monto no es válido'); return }
    if (info.repeatable && !label.trim()) { setErr('Ingresá una descripción del gasto'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('rental_charges').insert({
      home_id: homeId, user_id: userId, kind, period: month, currency, amount: parsed,
      label: info.repeatable ? label.trim() : null,
    })
    setBusy(false)
    if (error) { setErr(error.code === '23505' ? 'Ese rubro ya existe este mes' : 'No se pudo guardar'); return }
    onDone()
  }

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-line bg-surface text-sm text-ink placeholder-muted-2 outline-none focus:border-primary'

  return (
    <div className="card p-4 space-y-2">
      <p className="font-semibold text-ink text-sm">Nuevo gasto en {monthLabel(month)}</p>
      <select className={inputCls} value={kind} onChange={e => setKind(e.target.value as RentalKind)}>
        {fixedOptions.length > 0 && (
          <optgroup label="Rubros">
            {fixedOptions.map(o => <option key={o.value} value={o.value}>{o.emoji} {o.label}</option>)}
          </optgroup>
        )}
        <optgroup label="Otros gastos">
          {extraOptions.map(o => <option key={o.value} value={o.value}>{o.emoji} {o.label}</option>)}
        </optgroup>
      </select>
      {info.repeatable && (
        <input className={inputCls} placeholder={info.placeholder ?? 'Descripción'} value={label} onChange={e => setLabel(e.target.value)} />
      )}
      <div className="flex gap-2">
        <input className={inputCls} inputMode="decimal" placeholder="Monto (opcional)" value={amount} onChange={e => setAmount(e.target.value)} />
        <select className={`${inputCls} !w-28`} value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
          <option value="UYU">$ UYU</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy}
          className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'var(--grad)' }}>
          {busy ? 'Guardando…' : 'Agregar'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-muted bg-surface-2">Cancelar</button>
      </div>
    </div>
  )
}
