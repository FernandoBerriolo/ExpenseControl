'use client'

import { useRef, useState } from 'react'
import { supabase, type Currency } from '@/lib/supabase'
import {
  RENTAL_BUCKET, chargeTitle, kindInfo,
  type ReceiptDocType, type RentalCharge, type RentalReceipt, type RentalSettings,
} from '@/lib/alquiler/types'
import { formatBytes, formatDayMonth, formatMoney, parseAmount, todayStr } from '@/lib/alquiler/format'

const MAX_FILE_BYTES = 10 * 1024 * 1024

const SLOTS: { type: ReceiptDocType; label: string }[] = [
  { type: 'comprobante', label: 'Comprobante de pago' },
  { type: 'factura',     label: 'Factura / recibo' },
]

type Props = {
  charge: RentalCharge
  receipts: RentalReceipt[]
  settings: RentalSettings | null
  userId: string
  onChanged: () => void
}

export default function ChargeCard({ charge, receipts, settings, userId, onChanged }: Props) {
  const info = kindInfo(charge.kind)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [label, setLabel] = useState(charge.label ?? '')
  const [amount, setAmount] = useState(charge.amount != null ? String(charge.amount).replace('.', ',') : '')
  const [currency, setCurrency] = useState<Currency>(charge.currency)
  const [dueDate, setDueDate] = useState(charge.due_date ?? '')
  const [paidAt, setPaidAt] = useState(charge.paid_at ?? '')
  const [notes, setNotes] = useState(charge.notes ?? '')

  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const hasProof = receipts.some(r => r.doc_type === 'comprobante')

  function startEdit() {
    setLabel(charge.label ?? '')
    setAmount(charge.amount != null ? String(charge.amount).replace('.', ',') : '')
    setCurrency(charge.currency)
    setDueDate(charge.due_date ?? '')
    setPaidAt(charge.paid_at ?? '')
    setNotes(charge.notes ?? '')
    setErr('')
    setEditing(true)
  }

  async function saveEdit() {
    const parsed = parseAmount(amount)
    if (Number.isNaN(parsed)) { setErr('El monto no es válido'); return }
    if (charge.kind === 'otro' && !label.trim()) { setErr('Ingresá un nombre para el gasto'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('rental_charges').update({
      label:    charge.kind === 'otro' ? label.trim() : charge.label,
      amount:   parsed,
      currency,
      due_date: dueDate || null,
      paid_at:  charge.paid ? (paidAt || null) : null,
      notes:    notes.trim() || null,
    }).eq('id', charge.id)
    setBusy(false)
    if (error) { setErr('No se pudo guardar. Intentá de nuevo.'); return }
    setEditing(false)
    onChanged()
  }

  async function togglePaid() {
    setBusy(true); setErr('')
    const nowPaid = !charge.paid
    const { error } = await supabase.from('rental_charges')
      .update({ paid: nowPaid, paid_at: nowPaid ? todayStr() : null })
      .eq('id', charge.id)
    setBusy(false)
    if (error) { setErr('No se pudo actualizar el estado'); return }
    onChanged()
  }

  async function upload(file: File, docType: ReceiptDocType) {
    setErr('')
    if (file.size > MAX_FILE_BYTES) { setErr('El archivo supera los 10 MB'); return }
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      setErr('Solo se aceptan imágenes o PDF'); return
    }
    const safeName = file.name
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
    const path = `${userId}/${charge.id}/${Date.now()}-${safeName}`

    setBusy(true)
    const { error: upErr } = await supabase.storage.from(RENTAL_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) { setBusy(false); setErr('No se pudo subir el archivo'); return }

    const { error: dbErr } = await supabase.from('rental_receipts').insert({
      charge_id: charge.id, user_id: userId, doc_type: docType,
      file_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size,
    })
    if (dbErr) {
      await supabase.storage.from(RENTAL_BUCKET).remove([path])
      setBusy(false); setErr('No se pudo registrar el archivo'); return
    }
    setBusy(false)
    onChanged()
  }

  async function openReceipt(r: RentalReceipt) {
    // Abrimos la pestaña antes del await para que el navegador no bloquee el popup
    const win = window.open('', '_blank')
    const { data, error } = await supabase.storage.from(RENTAL_BUCKET).createSignedUrl(r.file_path, 120)
    if (error || !data) { win?.close(); setErr('No se pudo abrir el archivo'); return }
    if (win) win.location.replace(data.signedUrl)
    else window.location.assign(data.signedUrl)
  }

  async function deleteReceipt(r: RentalReceipt) {
    if (!confirm(`¿Borrar "${r.file_name}"?`)) return
    setBusy(true); setErr('')
    await supabase.storage.from(RENTAL_BUCKET).remove([r.file_path])
    const { error } = await supabase.from('rental_receipts').delete().eq('id', r.id)
    setBusy(false)
    if (error) { setErr('No se pudo borrar el archivo'); return }
    onChanged()
  }

  async function deleteCharge() {
    if (!confirm(`¿Eliminar "${chargeTitle(charge)}" de este mes${receipts.length ? ' y sus archivos' : ''}?`)) return
    setBusy(true); setErr('')
    if (receipts.length > 0) {
      await supabase.storage.from(RENTAL_BUCKET).remove(receipts.map(r => r.file_path))
    }
    const { error } = await supabase.from('rental_charges').delete().eq('id', charge.id)
    setBusy(false)
    if (error) { setErr('No se pudo eliminar'); return }
    onChanged()
  }

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-800 outline-none focus:border-indigo-400'

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3" style={{ opacity: busy ? 0.7 : 1 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 truncate">{info.emoji} {chargeTitle(charge)}</p>
          <p className="text-lg font-bold text-gray-900">{formatMoney(charge.amount, charge.currency)}</p>
          <p className="text-xs text-gray-400">
            {charge.due_date ? `Vence ${formatDayMonth(charge.due_date)}` : 'Sin vencimiento'}
            {charge.paid && charge.paid_at ? ` · Pagado ${formatDayMonth(charge.paid_at)}` : ''}
          </p>
        </div>
        <button
          onClick={togglePaid}
          disabled={busy}
          className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold"
          style={charge.paid
            ? { background: '#dcfce7', color: '#15803d' }
            : { background: '#f3f4f6', color: '#6b7280' }}
        >
          {charge.paid ? '✓ Pagado' : 'Marcar pagado'}
        </button>
      </div>

      {charge.paid && !hasProof && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#fef3c7', color: '#92400e' }}>
          ⚠️ Falta subir el comprobante de pago
        </p>
      )}

      {charge.kind === 'luz' && settings?.ute_reference && (
        <p className="text-xs text-gray-500">Trámite UTE: <span className="font-mono">{settings.ute_reference}</span></p>
      )}
      {charge.kind === 'gastos_comunes' && settings?.admin_url && (
        <a href={settings.admin_url} target="_blank" rel="noopener noreferrer"
          className="inline-block text-xs font-semibold" style={{ color: '#667eea' }}>
          Abrir web de la administración ↗
        </a>
      )}
      {charge.notes && !editing && <p className="text-xs text-gray-500 whitespace-pre-line">{charge.notes}</p>}

      {/* Archivos */}
      <div className="space-y-2">
        {SLOTS.map(slot => {
          const files = receipts.filter(r => r.doc_type === slot.type)
          return (
            <div key={slot.type} className="rounded-xl px-3 py-2" style={{ background: '#f8f9ff' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-600">{slot.label}</p>
                <button
                  onClick={() => fileInputs.current[slot.type]?.click()}
                  disabled={busy}
                  className="text-xs font-semibold"
                  style={{ color: '#667eea' }}
                >
                  + Subir
                </button>
                <input
                  ref={el => { fileInputs.current[slot.type] = el }}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) upload(f, slot.type)
                    e.target.value = ''
                  }}
                />
              </div>
              {files.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2 mt-1.5">
                  <button onClick={() => openReceipt(r)} className="text-xs text-left text-gray-700 truncate hover:underline">
                    📎 {r.file_name}{r.size_bytes ? ` · ${formatBytes(r.size_bytes)}` : ''}
                  </button>
                  <button onClick={() => deleteReceipt(r)} disabled={busy} className="text-xs text-gray-400 hover:text-red-500 px-1">✕</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}

      {editing ? (
        <div className="space-y-2 pt-1">
          {charge.kind === 'otro' && (
            <input className={inputCls} placeholder="Nombre del gasto" value={label} onChange={e => setLabel(e.target.value)} />
          )}
          <div className="flex gap-2">
            <input className={inputCls} inputMode="decimal" placeholder="Monto" value={amount} onChange={e => setAmount(e.target.value)} />
            <select className={`${inputCls} !w-28`} value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
              <option value="UYU">$ UYU</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <label className="block text-xs text-gray-500">Vencimiento
            <input type="date" className={`${inputCls} mt-1`} value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </label>
          {charge.paid && (
            <label className="block text-xs text-gray-500">Fecha de pago
              <input type="date" className={`${inputCls} mt-1`} value={paidAt} onChange={e => setPaidAt(e.target.value)} />
            </label>
          )}
          <textarea className={inputCls} rows={2} placeholder="Notas (opcional)" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={saveEdit} disabled={busy}
              className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
              Guardar
            </button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl text-sm text-gray-500 bg-gray-100">Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-4 pt-1">
          <button onClick={startEdit} className="text-xs font-medium text-gray-500 hover:text-gray-800">✏️ Editar</button>
          <button onClick={deleteCharge} disabled={busy} className="text-xs font-medium text-gray-400 hover:text-red-500">🗑️ Eliminar</button>
        </div>
      )}
    </div>
  )
}
