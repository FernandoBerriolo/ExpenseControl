'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MAX_DOC_CHARS, type RentalDocument } from '@/lib/alquiler/types'

type Message = { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  '¿Cuándo hay que pagar los gastos comunes?',
  '¿Hasta qué hora puedo usar la barbacoa?',
  '¿Cómo contrato internet?',
  '¿Qué pagos me faltan este mes?',
]

export default function AsistenteTab({ userId }: { userId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [docs, setDocs] = useState<RentalDocument[]>([])
  const [docsLoaded, setDocsLoaded] = useState(false)
  const [showDocs, setShowDocs] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadDocs = useCallback(async () => {
    const { data } = await supabase.from('rental_documents').select('id, name, created_at')
      .eq('user_id', userId).order('created_at')
    setDocs((data ?? []) as RentalDocument[])
    setDocsLoaded(true)
  }, [userId])

  useEffect(() => { loadDocs() }, [loadDocs])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  async function send(text: string) {
    const q = text.trim()
    if (!q || loading) return
    const next: Message[] = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/alquiler/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json().catch(() => ({}))
      const reply = data.reply ?? (res.status === 401 ? '❌ Sesión vencida. Volvé a iniciar sesión.' : '❌ Error inesperado')
      setMessages(m => [...m, { role: 'assistant', content: reply }])
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: '❌ No se pudo conectar. Revisá tu conexión.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 space-y-2 min-h-[240px] max-h-[55vh] overflow-y-auto flex flex-col">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                Preguntame sobre el reglamento y el manual del edificio, o sobre el estado de tus pagos.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="text-xs px-3 py-2 rounded-xl text-left"
                    style={{ background: '#e8edff', color: '#667eea' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-line leading-relaxed"
                style={m.role === 'user'
                  ? { background: '#667eea', color: '#fff', borderBottomRightRadius: 4 }
                  : { background: '#f3f4f6', color: '#111827', borderBottomLeftRadius: 4 }}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded-xl text-sm text-gray-400" style={{ background: '#f3f4f6' }}>···</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-gray-100 flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send(input)}
            placeholder="Escribí tu pregunta…"
            disabled={loading}
            maxLength={2000}
            className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-indigo-400"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="w-10 h-10 rounded-xl text-white flex items-center justify-center"
            style={{ background: input.trim() && !loading ? '#667eea' : '#d1d5db' }}
          >
            ➤
          </button>
        </div>
      </div>

      {docsLoaded && docs.length === 0 && (
        <p className="text-xs rounded-xl px-3 py-2" style={{ background: '#fef3c7', color: '#92400e' }}>
          Todavía no cargaste documentos. Agregá el reglamento y el manual para que pueda responder sobre el edificio.
        </p>
      )}

      <button onClick={() => setShowDocs(s => !s)}
        className="w-full py-3 rounded-2xl text-sm font-semibold text-gray-600 bg-white shadow-sm">
        📄 Documentos del asistente ({docs.length}) {showDocs ? '▴' : '▾'}
      </button>
      {showDocs && <DocumentsManager userId={userId} docs={docs} onChanged={loadDocs} />}
    </div>
  )
}

function DocumentsManager({ userId, docs, onChanged }: { userId: string; docs: RentalDocument[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function loadFile(file: File) {
    setErr('')
    if (!/\.(txt|md)$/i.test(file.name)) { setErr('Por ahora solo archivos .txt o .md (o pegá el texto)'); return }
    const text = await file.text()
    setContent(text)
    if (!name.trim()) setName(file.name.replace(/\.(txt|md)$/i, ''))
  }

  async function save() {
    const text = content.trim()
    if (!name.trim() || !text) { setErr('Poné un nombre y el texto del documento'); return }
    if (text.length > MAX_DOC_CHARS) { setErr(`El documento es muy largo (máximo ${MAX_DOC_CHARS.toLocaleString('es-UY')} caracteres)`); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('rental_documents').insert({ user_id: userId, name: name.trim(), content: text })
    setBusy(false)
    if (error) { setErr('No se pudo guardar el documento'); return }
    setName(''); setContent('')
    onChanged()
  }

  async function remove(d: RentalDocument) {
    if (!confirm(`¿Borrar "${d.name}"? El asistente dejará de usarlo.`)) return
    const { error } = await supabase.from('rental_documents').delete().eq('id', d.id)
    if (error) { setErr('No se pudo borrar'); return }
    onChanged()
  }

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-800 outline-none focus:border-indigo-400'

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
      {docs.map(d => (
        <div key={d.id} className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-700 truncate">📄 {d.name}</p>
          <button onClick={() => remove(d)} className="text-xs text-gray-400 hover:text-red-500 px-1">✕</button>
        </div>
      ))}

      <div className="space-y-2 pt-2 border-t border-gray-100">
        <p className="text-xs font-medium text-gray-500">Agregar documento (texto)</p>
        <input className={inputCls} placeholder="Nombre (ej: Reglamento interno)" value={name} onChange={e => setName(e.target.value)} />
        <textarea className={inputCls} rows={5} placeholder="Pegá el texto acá o subí un .txt / .md"
          value={content} onChange={e => setContent(e.target.value)} />
        <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }} />
        <div className="flex gap-2">
          <button onClick={() => fileRef.current?.click()} className="px-3 py-2 rounded-xl text-sm text-gray-600 bg-gray-100">Subir archivo</button>
          <button onClick={save} disabled={busy}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
            {busy ? 'Guardando…' : 'Guardar documento'}
          </button>
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
      </div>
    </div>
  )
}
