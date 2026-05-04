'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type SharedGroup, SHARED_THEMES } from '@/lib/supabase'

function generateCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

export default function SharedGroupsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [groups, setGroups] = useState<SharedGroup[]>([])
  const [loading, setLoading] = useState(true)

  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createTheme, setCreateTheme] = useState('general')
  const [createCurrency, setCreateCurrency] = useState<'UYU' | 'USD' | 'EUR'>('UYU')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  const [showJoin, setShowJoin] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinError, setJoinError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      setUserId(session.user.id)
      await loadGroups(session.user.id)
    })
  }, [router])

  async function loadGroups(uid: string) {
    setLoading(true)
    const { data } = await supabase
      .from('shared_group_members')
      .select('group_id')
      .eq('user_id', uid)

    const groupIds = (data ?? []).map((r: { group_id: string }) => r.group_id)
    if (groupIds.length === 0) { setGroups([]); setLoading(false); return }

    const { data: groupData } = await supabase
      .from('shared_groups')
      .select('*')
      .in('id', groupIds)
      .order('created_at', { ascending: false })

    setGroups((groupData ?? []) as SharedGroup[])
    setLoading(false)
  }

  async function handleCreate() {
    if (!createName.trim()) { setCreateError('Ingresá un nombre'); return }
    setCreateLoading(true)
    setCreateError('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const code = generateCode()
    const { error: insertError } = await supabase
      .from('shared_groups')
      .insert({
        name: createName.trim(),
        theme: createTheme,
        currency: createCurrency,
        invite_code: code,
        created_by: session.user.id,
      })

    if (insertError) { setCreateError('Error al crear el grupo'); setCreateLoading(false); return }

    const { data: group, error: fetchError } = await supabase
      .from('shared_groups')
      .select('id')
      .eq('invite_code', code)
      .single()

    if (fetchError || !group) { setCreateError('Error al obtener el grupo'); setCreateLoading(false); return }

    await supabase.from('shared_group_members').insert({
      group_id: group.id,
      user_id: session.user.id,
      user_email: session.user.email,
    })

    setCreateLoading(false)
    setShowCreate(false)
    setCreateName('')
    setCreateTheme('general')
    router.push(`/shared/${group.id}`)
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase()
    if (!code) { setJoinError('Ingresá un código'); return }
    setJoinLoading(true)
    setJoinError('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const { data: group } = await supabase
      .from('shared_groups')
      .select('id')
      .eq('invite_code', code)
      .single()

    if (!group) { setJoinError('Código inválido'); setJoinLoading(false); return }

    const { error } = await supabase.from('shared_group_members').insert({
      group_id: group.id,
      user_id: session.user.id,
      user_email: session.user.email,
    })

    if (error?.code === '23505') { setJoinError('Ya sos miembro de este grupo'); setJoinLoading(false); return }
    if (error) { setJoinError('Error al unirse'); setJoinLoading(false); return }

    setJoinLoading(false)
    setShowJoin(false)
    router.push(`/shared/${group.id}`)
  }

  const themeInfo = (theme: string) => SHARED_THEMES.find(t => t.value === theme) ?? SHARED_THEMES[0]

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/dashboard')} className="text-gray-400 hover:text-white transition-colors">
            ← Volver
          </button>
          <h1 className="text-xl font-bold flex-1">Gastos Compartidos</h1>
        </div>

        <div className="flex gap-3 mb-6">
          <button
            onClick={() => { setShowCreate(true); setShowJoin(false) }}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-xl transition-colors"
          >
            + Crear grupo
          </button>
          <button
            onClick={() => { setShowJoin(true); setShowCreate(false) }}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-medium py-2.5 rounded-xl transition-colors"
          >
            Unirse con código
          </button>
        </div>

        {showCreate && (
          <div className="bg-gray-900 rounded-2xl p-4 mb-4 border border-gray-800">
            <h2 className="font-semibold mb-3">Nuevo grupo</h2>
            <input
              className="w-full bg-gray-800 rounded-xl px-4 py-2.5 text-sm mb-3 outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Nombre del grupo"
              value={createName}
              onChange={e => setCreateName(e.target.value)}
            />
            <div className="grid grid-cols-3 gap-2 mb-3">
              {SHARED_THEMES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setCreateTheme(t.value)}
                  className={`py-2 rounded-xl text-sm font-medium transition-colors ${createTheme === t.value ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              {(['UYU', 'USD', 'EUR'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setCreateCurrency(c)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${createCurrency === c ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                >
                  {c}
                </button>
              ))}
            </div>
            {createError && <p className="text-red-400 text-sm mb-2">{createError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={createLoading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-2 rounded-xl transition-colors"
              >
                {createLoading ? 'Creando...' : 'Crear'}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2 rounded-xl transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {showJoin && (
          <div className="bg-gray-900 rounded-2xl p-4 mb-4 border border-gray-800">
            <h2 className="font-semibold mb-3">Unirse a un grupo</h2>
            <input
              className="w-full bg-gray-800 rounded-xl px-4 py-2.5 text-sm mb-3 outline-none focus:ring-2 focus:ring-emerald-500 uppercase tracking-widest"
              placeholder="Código de invitación"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
            />
            {joinError && <p className="text-red-400 text-sm mb-2">{joinError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleJoin}
                disabled={joinLoading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-2 rounded-xl transition-colors"
              >
                {joinLoading ? 'Uniéndose...' : 'Unirse'}
              </button>
              <button
                onClick={() => setShowJoin(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2 rounded-xl transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-500 py-12">Cargando...</div>
        ) : groups.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <p className="text-4xl mb-3">👥</p>
            <p>No tenés grupos todavía.</p>
            <p className="text-sm mt-1">Creá uno o unite con un código.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map(g => {
              const t = themeInfo(g.theme)
              return (
                <button
                  key={g.id}
                  onClick={() => router.push(`/shared/${g.id}`)}
                  className="w-full bg-gray-900 hover:bg-gray-800 rounded-2xl p-4 text-left border border-gray-800 hover:border-gray-700 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{t.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{g.name}</p>
                      <p className="text-sm text-gray-400">{t.label} · {g.currency}</p>
                    </div>
                    <span className="text-gray-500">→</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
