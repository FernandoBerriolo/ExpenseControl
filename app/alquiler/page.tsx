'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { RentalSettings } from '@/lib/alquiler/types'
import PagosTab from './PagosTab'
import AsistenteTab from './AsistenteTab'
import ConfigTab from './ConfigTab'
import BottomNav from '@/app/components/BottomNav'
import { BuildingIcon } from '@/app/components/Icons'

type Tab = 'pagos' | 'asistente' | 'config'

const TABS: { value: Tab; label: string }[] = [
  { value: 'pagos',     label: '💰 Pagos' },
  { value: 'asistente', label: '✨ Asistente' },
  { value: 'config',    label: '⚙️ Config' },
]

export default function AlquilerPage() {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [homeId, setHomeId] = useState('')
  const [loadError, setLoadError] = useState('')
  const [settings, setSettings] = useState<RentalSettings | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('pagos')

  const loadSettings = useCallback(async (hid: string) => {
    const { data } = await supabase.from('rental_settings').select('*').eq('home_id', hid).maybeSingle()
    setSettings((data as RentalSettings | null) ?? null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      setUserId(session.user.id)
      // El hogar es compartido: si la persona todavía no tiene uno, se le crea
      const { data: hid, error } = await supabase.rpc('rental_ensure_home')
      if (error || !hid) {
        setLoadError('No se pudo cargar la sección. ¿Corriste supabase-schema-v10.sql en Supabase?')
        setReady(true)
        return
      }
      setHomeId(hid as string)
      await loadSettings(hid as string)
      setReady(true)
    })
  }, [router, loadSettings])

  return (
    <div className="min-h-screen pb-32" style={{ background: 'var(--bg)' }}>
      <header className="sticky top-0 z-20 border-b border-line"
        style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white flex-shrink-0" style={{ background: 'var(--grad)' }}>
              <BuildingIcon size={19} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-muted leading-none">Edificio Asencio · 705</p>
              <p className="text-base font-bold text-ink leading-tight">Mi apartamento</p>
            </div>
          </div>
          <div className="mt-3 p-1 rounded-2xl bg-surface-2 grid grid-cols-3 gap-1" role="tablist">
            {TABS.map(t => (
              <button
                key={t.value}
                role="tab"
                aria-selected={tab === t.value}
                onClick={() => setTab(t.value)}
                className="py-2 rounded-xl text-xs font-semibold transition-all"
                style={tab === t.value
                  ? { background: 'var(--surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-card)' }
                  : { background: 'transparent', color: 'var(--muted)' }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pt-4">
        {!ready ? (
          <p className="text-center text-sm text-muted-2 py-8">Cargando…</p>
        ) : loadError ? (
          <p className="text-center text-sm text-danger py-8">{loadError}</p>
        ) : (
          <>
            {tab === 'pagos' && <PagosTab userId={userId} homeId={homeId} settings={settings} />}
            {tab === 'asistente' && <AsistenteTab userId={userId} homeId={homeId} />}
            {tab === 'config' && <ConfigTab userId={userId} homeId={homeId} settings={settings} onSaved={() => loadSettings(homeId)} />}
          </>
        )}
      </main>

      <BottomNav />
    </div>
  )
}
