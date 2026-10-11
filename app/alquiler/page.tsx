'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { RentalSettings } from '@/lib/alquiler/types'
import PagosTab from './PagosTab'
import AsistenteTab from './AsistenteTab'
import ConfigTab from './ConfigTab'

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
    <div className="min-h-screen" style={{ background: '#f0f2ff' }}>
      <div className="sticky top-0 z-10 shadow-sm" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-white/80 hover:text-white text-xl" title="Volver">‹</button>
          <span className="text-2xl">🏠</span>
          <span className="text-white font-bold text-lg">Mi apartamento</span>
        </div>
        <div className="max-w-lg mx-auto px-4 pb-3 flex gap-2">
          {TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className="flex-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={tab === t.value
                ? { background: 'white', color: '#667eea' }
                : { background: 'rgba(255,255,255,0.2)', color: 'white' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {!ready ? (
          <p className="text-center text-sm text-gray-400 py-8">Cargando…</p>
        ) : loadError ? (
          <p className="text-center text-sm text-red-500 py-8">{loadError}</p>
        ) : (
          <>
            {tab === 'pagos' && <PagosTab userId={userId} homeId={homeId} settings={settings} />}
            {tab === 'asistente' && <AsistenteTab userId={userId} homeId={homeId} />}
            {tab === 'config' && <ConfigTab userId={userId} homeId={homeId} settings={settings} onSaved={() => loadSettings(homeId)} />}
          </>
        )}
      </div>
    </div>
  )
}
