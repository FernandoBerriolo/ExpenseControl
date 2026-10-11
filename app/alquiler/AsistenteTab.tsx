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

export default function AsistenteTab({ userId, homeId }: { userId: string; homeId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [docs, setDocs] = useState<RentalDocument[]>([])
  const [docsLoaded, setDocsLoaded] = useState(false)
  const [showDocs, setShowDocs] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadDocs = useCallback(async () => {
    const { data } = await supabase.from('rental_documents').select('id, name, created_at')
      .eq('home_id', homeId).order('created_at')
    setDocs((data ?? []) as RentalDocument[])
    setDocsLoaded(true)
  }, [homeId])

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
      <div className="card overflow-hidden">
        <div className="p-4 space-y-2 min-h-[240px] max-h-[55vh] overflow-y-auto flex flex-col">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Preguntame sobre el reglamento y el manual del edificio, o sobre el estado de tus pagos.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="text-xs px-3 py-2 rounded-xl text-left"
                    style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
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
                  ? { background: 'var(--primary)', color: '#fff', borderBottomRightRadius: 4 }
                  : { background: 'var(--surface-2)', color: 'var(--ink)', borderBottomLeftRadius: 4 }}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded-xl text-sm text-muted-2" style={{ background: 'var(--surface-2)' }}>···</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-line flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send(input)}
            placeholder="Escribí tu pregunta…"
            disabled={loading}
            maxLength={2000}
            className="flex-1 px-3 py-2 rounded-xl border border-line bg-surface text-sm text-ink placeholder-muted-2 outline-none focus:border-primary"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="w-10 h-10 rounded-xl text-white flex items-center justify-center"
            style={{ background: input.trim() && !loading ? 'var(--primary)' : 'var(--line)' }}
          >
            ➤
          </button>
        </div>
      </div>

      {docsLoaded && docs.length === 0 && (
        <p className="text-xs rounded-xl px-3 py-2" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
          Todavía no cargaste documentos. Agregá el reglamento y el manual para que pueda responder sobre el edificio.
        </p>
      )}

      <button onClick={() => setShowDocs(s => !s)}
        className="w-full py-3 rounded-2xl text-sm font-semibold text-ink-2 card">
        📄 Documentos del asistente ({docs.length}) {showDocs ? '▴' : '▾'}
      </button>
      {showDocs && <DocumentsManager userId={userId} homeId={homeId} docs={docs} onChanged={loadDocs} />}
    </div>
  )
}

function DocumentsManager({ userId, homeId, docs, onChanged }: { userId: string; homeId: string; docs: RentalDocument[]; onChanged: () => void }) {
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
    const { error } = await supabase.from('rental_documents').insert({ home_id: homeId, user_id: userId, name: name.trim(), content: text })
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

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-line bg-surface text-sm text-ink placeholder-muted-2 outline-none focus:border-primary'

  return (
    <div className="card p-4 space-y-3">
      {docs.map(d => (
        <div key={d.id} className="flex items-center justify-between gap-2">
          <p className="text-sm text-ink truncate">📄 {d.name}</p>
          <button onClick={() => remove(d)} className="text-xs text-muted-2 hover:text-danger px-1">✕</button>
        </div>
      ))}

      <div className="space-y-2 pt-2 border-t border-line">
        <p className="text-xs font-medium text-muted">Agregar documento (texto)</p>
        <input className={inputCls} placeholder="Nombre (ej: Reglamento interno)" value={name} onChange={e => setName(e.target.value)} />
        <textarea className={inputCls} rows={5} placeholder="Pegá el texto acá o subí un .txt / .md"
          value={content} onChange={e => setContent(e.target.value)} />
        <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }} />
        <div className="flex gap-2">
          <button onClick={() => fileRef.current?.click()} className="px-3 py-2 rounded-xl text-sm text-ink-2 bg-surface-2">Subir archivo</button>
          <button onClick={save} disabled={busy}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--grad)' }}>
            {busy ? 'Guardando…' : 'Guardar documento'}
          </button>
        </div>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </div>
  )
}
