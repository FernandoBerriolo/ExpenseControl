'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleRegister(e: React.SyntheticEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message || 'Error al registrarse. Intentá de nuevo.')
      setLoading(false)
    } else {
      // Try to sign in directly
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
      if (!loginError) {
        router.replace('/dashboard')
      } else {
        setSuccess(true)
        setLoading(false)
      }
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--grad-hero)' }}>
        <div className="bg-surface rounded-3xl shadow-2xl p-8 w-full max-w-sm text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-ink mb-2">¡Cuenta creada!</h2>
          <p className="text-muted text-sm mb-6">Revisá tu email para confirmar tu cuenta y luego iniciá sesión.</p>
          <Link href="/login" className="block w-full py-3 rounded-xl font-semibold text-white text-center transition-all"
            style={{ background: 'var(--grad)' }}>
            Ir al login
          </Link>
        </div>
      </div>
    )
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
          <p className="text-white/70 mt-1 text-sm">Creá tu cuenta gratis</p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-3xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-ink mb-6">Crear cuenta</h2>

          <form onSubmit={handleRegister} className="space-y-4">
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
                placeholder="Mínimo 6 caracteres"
                className="field text-ink placeholder-muted-2 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Confirmá la contraseña</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
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
                  Creando cuenta...
                </span>
              ) : 'Crear cuenta'}
            </button>
          </form>

          <p className="text-center text-sm text-muted mt-6">
            ¿Ya tenés cuenta?{' '}
            <Link href="/login" className="font-semibold" style={{ color: 'var(--primary)' }}>
              Iniciá sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
