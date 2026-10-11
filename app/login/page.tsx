'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.SyntheticEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Email o contraseña incorrectos')
      setLoading(false)
    } else {
      router.replace('/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--grad-hero)' }}>
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <span className="text-3xl">💸</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Mis Gastos</h1>
          <p className="text-white/70 mt-1 text-sm">Iniciá sesión para continuar</p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-3xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-ink mb-6">Bienvenida de nuevo</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="tu@email.com"
                className="field text-ink placeholder-muted-2 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="field text-ink placeholder-muted-2 transition-all"
              />
            </div>

            {error && (
              <div className="bg-danger-soft border border-danger/30 text-danger text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-white transition-all active:scale-95 disabled:opacity-70 mt-2"
              style={{ background: 'var(--grad)' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Entrando...
                </span>
              ) : 'Iniciar sesión'}
            </button>
          </form>

          <p className="text-center text-sm text-muted mt-6">
            ¿No tenés cuenta?{' '}
            <Link href="/register" className="font-semibold" style={{ color: 'var(--primary)' }}>
              Registrate
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
