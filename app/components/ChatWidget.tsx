'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type Message = { role: 'user' | 'bot'; text: string; saved?: boolean; isImage?: boolean }

export default function ChatWidget({ onExpenseSaved, hidden }: { onExpenseSaved?: () => void; hidden?: boolean }) {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', text: '¡Hola! Contame qué gastaste, mandá una foto de un recibo, o preguntame sobre tus gastos 💬' }
  ])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  useEffect(() => {
    if (hidden) setOpen(false)
  }, [hidden])

  async function callApi(bodyPayload: object) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(bodyPayload),
    })
    return res.json()
  }

  async function sendImage(file: File) {
    if (loading) return
    setLoading(true)
    setMessages((prev: Message[]) => [...prev, { role: 'user', text: '📷 Foto de recibo', isImage: true }])
    try {
      const base64 = await fileToBase64(file)
      const data = await callApi({ image: { data: base64, mimeType: file.type } })
      setMessages((prev: Message[]) => [...prev, { role: 'bot', text: data.reply ?? '❌ Error inesperado', saved: data.saved }])
      if (data.saved && onExpenseSaved) onExpenseSaved()
    } catch {
      setMessages((prev: Message[]) => [...prev, { role: 'bot', text: '❌ No se pudo conectar. Revisá tu conexión.' }])
    } finally {
      setLoading(false)
    }
  }

  async function send(text: string) {
    if (!text.trim() || loading) return
    const userMsg = text.trim()
    setInput('')
    setMessages((prev: Message[]) => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)
    try {
      const data = await callApi({ message: userMsg })
      setMessages((prev: Message[]) => [...prev, { role: 'bot', text: data.reply ?? '❌ Error inesperado', saved: data.saved }])
      if (data.saved && onExpenseSaved) onExpenseSaved()
    } catch {
      setMessages((prev: Message[]) => [...prev, { role: 'bot', text: '❌ No se pudo conectar. Revisá tu conexión.' }])
    } finally {
      setLoading(false)
    }
  }

  if (hidden) return null

  return (
    <>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        />
      )}

      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 24, left: 24, zIndex: 1001,
          width: 64, height: 64, borderRadius: '50%',
          background: 'linear-gradient(135deg, #10b981, #059669)',
          border: 'none', cursor: 'pointer', boxShadow: '0 4px 16px rgba(16,185,129,0.4)',
          fontSize: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="Asistente de gastos"
      >
        {open ? '✕' : '💬'}
      </button>

      {open && (
        <div style={{
          position: 'fixed', bottom: 100, left: 24, zIndex: 1001,
          width: 340, maxWidth: 'calc(100vw - 48px)',
          background: '#fff', borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', border: '1px solid #e5e7eb',
        }}>
          <div style={{
            padding: '12px 16px', background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff', fontWeight: 600, fontSize: 15,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>✨</span> Asistente de gastos
          </div>

          <div style={{ padding: 12, overflowY: 'auto', maxHeight: 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '80%', padding: '8px 12px', borderRadius: 12,
                  fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-line',
                  background: m.role === 'user' ? '#10b981' : '#f3f4f6',
                  color: m.role === 'user' ? '#fff' : '#111827',
                  borderBottomRightRadius: m.role === 'user' ? 4 : 12,
                  borderBottomLeftRadius: m.role === 'bot' ? 4 : 12,
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '8px 12px', borderRadius: 12, background: '#f3f4f6', fontSize: 14, color: '#6b7280' }}>
                  ···
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: '8px 12px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) sendImage(file)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Subir foto de recibo"
              style={{
                width: 36, height: 36, borderRadius: 8, border: 'none',
                cursor: loading ? 'default' : 'pointer',
                background: '#f0fdf4', fontSize: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, opacity: loading ? 0.5 : 1,
              }}
            >
              📷
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              placeholder='Ej: "pizza 350 itau"'
              disabled={loading}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 14,
                border: '1px solid #d1d5db', outline: 'none',
                background: loading ? '#f9fafb' : '#fff',
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              style={{
                width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: input.trim() && !loading ? '#10b981' : '#d1d5db',
                fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
