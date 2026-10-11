'use client'

import { useEffect, useState } from 'react'
import { supabase, type Currency } from '@/lib/supabase'
import type { RentalMember, RentalSettings } from '@/lib/alquiler/types'
import { parseAmount } from '@/lib/alquiler/format'

export default function ConfigTab({ userId, homeId, settings, onSaved }: {
  userId: string
  homeId: string
  settings: RentalSettings | null
  onSaved: () => void
}) {
  const [rent, setRent] = useState(settings?.monthly_rent != null ? String(settings.monthly_rent).replace('.', ',') : '')
  const [currency, setCurrency] = useState<Currency>(settings?.rent_currency ?? 'UYU')
  const [ute, setUte] = useState(settings?.ute_reference ?? '')
  const [adminUrl, setAdminUrl] = useState(settings?.admin_url ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [members, setMembers] = useState<RentalMember[]>([])

  useEffect(() => {
    supabase.from('rental_home_members').select('user_id, user_email').eq('home_id', homeId)
      .then(({ data }) => setMembers((data ?? []) as RentalMember[]))
  }, [homeId])

  async function save() {
    setMsg(''); setErr('')
    const parsed = parseAmount(rent)
    if (Number.isNaN(parsed)) { setErr('El valor del alquiler no es válido'); return }

    let url = adminUrl.trim()
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`
    if (url) {
      try { new URL(url) } catch { setErr('La web de la administración no es una URL válida'); return }
    }

    setBusy(true)
    const { error } = await supabase.from('rental_settings').upsert({
      home_id: homeId,
      user_id: userId,
      monthly_rent: parsed,
      rent_currency: currency,
      ute_reference: ute.trim() || null,
      admin_url: url || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'home_id' })
    setBusy(false)
    if (error) { setErr('No se pudo guardar'); return }
    setAdminUrl(url)
    setMsg('Guardado ✓')
    onSaved()
  }

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-800 outline-none focus:border-indigo-400'

  return (
    <div className="space-y-4">
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
      <div>
        <label className="text-xs font-medium text-gray-500">Valor del alquiler mensual</label>
        <div className="flex gap-2 mt-1">
          <input className={inputCls} inputMode="decimal" placeholder="Ej: 25.000" value={rent} onChange={e => setRent(e.target.value)} />
          <select className={`${inputCls} !w-28`} value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
            <option value="UYU">$ UYU</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <p className="text-xs text-gray-400 mt-1">Se usa al armar cada mes. Podés cambiarlo en un mes puntual desde Pagos.</p>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500">Nro. de trámite UTE</label>
        <input className={`${inputCls} mt-1`} value={ute} onChange={e => setUte(e.target.value)} />
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500">Web de gastos comunes</label>
        <input className={`${inputCls} mt-1`} placeholder="https://…" value={adminUrl} onChange={e => setAdminUrl(e.target.value)} />
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}
      {msg && <p className="text-xs text-green-600">{msg}</p>}

      <button onClick={save} disabled={busy}
        className="w-full py-3 rounded-xl text-sm font-semibold text-white"
        style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
        {busy ? 'Guardando…' : 'Guardar'}
      </button>
    </div>

    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-1">
      <p className="text-xs font-medium text-gray-500">👥 Compartido con</p>
      {members.length === 0 ? (
        <p className="text-sm text-gray-400">Solo vos</p>
      ) : members.map(m => (
        <p key={m.user_id} className="text-sm text-gray-700">
          {m.user_email ?? 'Usuario'}{m.user_id === userId ? ' (vos)' : ''}
        </p>
      ))}
      <p className="text-xs text-gray-400 pt-1">Todos los miembros ven y editan los mismos pagos, comprobantes y documentos.</p>
    </div>
    </div>
  )
}
