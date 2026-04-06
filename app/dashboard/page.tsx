'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Expense, type SharedAccess, type Account, BANKS } from '@/lib/supabase'

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

function formatMoney(amount: number, currency: 'UYU' | 'USD') {
  if (currency === 'USD') {
    return `USD ${amount.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `$ ${amount.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function getTodayDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function parseMonth(month: string) {
  const [year, m] = month.split('-')
  return { year: parseInt(year), month: parseInt(m) }
}

function monthLabel(month: string) {
  const { year, month: m } = parseMonth(month)
  return `${MONTHS[m - 1]} ${year}`
}

function prevMonth(month: string) {
  const { year, month: m } = parseMonth(month)
  const d = new Date(year, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(month: string) {
  const { year, month: m } = parseMonth(month)
  const d = new Date(year, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

function generateCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

type ModalMode = 'add' | 'edit' | null

export default function Dashboard() {
  const router = useRouter()
  const [myUserId, setMyUserId] = useState('')
  const [myEmail, setMyEmail] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccount, setActiveAccount] = useState<Account | null>(null)

  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth())
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Share modal
  const [showShare, setShowShare] = useState(false)
  const [shareTab, setShareTab] = useState<'mycode' | 'join'>('mycode')
  const [myInviteCode, setMyInviteCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [joinSuccess, setJoinSuccess] = useState('')
  const [codeCopied, setCodeCopied] = useState(false)

  // Form state
  const [formDesc, setFormDesc] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formCurrency, setFormCurrency] = useState<'UYU' | 'USD'>('UYU')
  const [formBank, setFormBank] = useState('')
  const [formDate, setFormDate] = useState(getTodayDate())
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')

  // Check auth and load accounts
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }

      const uid = session.user.id
      const email = session.user.email ?? ''
      setMyUserId(uid)
      setMyEmail(email)

      const ownAccount: Account = { user_id: uid, email, isOwn: true }
      setActiveAccount(ownAccount)

      // Load shared accounts
      const { data } = await supabase
        .from('shared_access')
        .select('*')
        .eq('status', 'accepted')

      const shared: Account[] = (data as SharedAccess[] ?? []).map(row => {
        if (row.owner_id === uid) {
          // I shared my account with someone — still my own data
          return null
        } else {
          // Someone shared their account with me
          return { user_id: row.owner_id, email: row.owner_email, isOwn: false }
        }
      }).filter(Boolean) as Account[]

      setAccounts([ownAccount, ...shared])

      // Load existing invite code
      const { data: codeData } = await supabase
        .from('shared_access')
        .select('invite_code')
        .eq('owner_id', uid)
        .limit(1)
        .single()

      if (codeData) setMyInviteCode(codeData.invite_code)
    })
  }, [router])

  // Load expenses for active account + month
  const loadExpenses = useCallback(async () => {
    if (!activeAccount) return
    setLoading(true)

    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('user_id', activeAccount.user_id)
      .eq('month', selectedMonth)
      .order('expense_date', { ascending: false })

    if (!error && data) setExpenses(data as Expense[])
    setLoading(false)
  }, [selectedMonth, activeAccount])

  useEffect(() => {
    loadExpenses()
  }, [loadExpenses])

  // --- Share logic ---
  async function handleGenerateCode() {
    const code = generateCode()
    const { error } = await supabase.from('shared_access').insert({
      owner_id: myUserId,
      owner_email: myEmail,
      invite_code: code,
      status: 'pending',
    })
    if (!error) setMyInviteCode(code)
  }

  async function handleCopyCode() {
    await navigator.clipboard.writeText(myInviteCode)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  async function handleJoin() {
    setJoinError('')
    setJoinSuccess('')
    if (!joinCode.trim()) return
    setJoinLoading(true)

    const { data, error } = await supabase.rpc('join_shared_account', {
      p_invite_code: joinCode.trim().toUpperCase(),
      p_user_email: myEmail,
    })

    if (error) {
      setJoinError(error.message.includes('invalido') || error.message.includes('nvalid')
        ? 'Código inválido o ya utilizado'
        : error.message)
    } else {
      const row = data as SharedAccess
      const newAccount: Account = { user_id: row.owner_id, email: row.owner_email, isOwn: false }
      setAccounts(prev => [...prev, newAccount])
      setJoinSuccess(`¡Listo! Ahora podés ver los gastos de ${row.owner_email}`)
      setJoinCode('')
    }
    setJoinLoading(false)
  }

  // --- Expense form ---
  function openAddModal() {
    setFormDesc('')
    setFormAmount('')
    setFormCurrency('UYU')
    setFormBank('')
    setFormDate(getTodayDate())
    setFormError('')
    setEditingExpense(null)
    setModalMode('add')
  }

  function openEditModal(expense: Expense) {
    setFormDesc(expense.description)
    setFormAmount(String(expense.amount))
    setFormCurrency(expense.currency)
    setFormBank(expense.bank ?? '')
    setFormDate(expense.expense_date ?? getTodayDate())
    setFormError('')
    setEditingExpense(expense)
    setModalMode('edit')
  }

  function closeModal() {
    setModalMode(null)
    setEditingExpense(null)
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setFormError('')

    const amount = parseFloat(formAmount)
    if (isNaN(amount) || amount <= 0) { setFormError('El monto debe ser mayor a 0'); return }
    if (!formDesc.trim()) { setFormError('La descripción no puede estar vacía'); return }
    if (!activeAccount) return

    // Derive month from selected date
    const dateMonth = formDate.substring(0, 7)

    setFormLoading(true)

    if (modalMode === 'add') {
      const { error } = await supabase.from('expenses').insert({
        user_id: activeAccount.user_id,
        description: formDesc.trim(),
        amount,
        currency: formCurrency,
        bank: formBank || null,
        month: dateMonth,
        expense_date: formDate,
      })
      if (error) setFormError('Error al guardar. Intentá de nuevo.')
      else { closeModal(); loadExpenses() }
    } else if (modalMode === 'edit' && editingExpense) {
      const { error } = await supabase.from('expenses').update({
        description: formDesc.trim(),
        amount,
        currency: formCurrency,
        bank: formBank || null,
        month: dateMonth,
        expense_date: formDate,
      }).eq('id', editingExpense.id)

      if (error) setFormError('Error al actualizar. Intentá de nuevo.')
      else { closeModal(); loadExpenses() }
    }
    setFormLoading(false)
  }

  async function handleDelete(id: string) {
    await supabase.from('expenses').delete().eq('id', id)
    setDeleteConfirm(null)
    loadExpenses()
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  // Totals
  const totalARS = expenses.filter(e => e.currency === 'UYU').reduce((s, e) => s + e.amount, 0)
  const totalUSD = expenses.filter(e => e.currency === 'USD').reduce((s, e) => s + e.amount, 0)

  const viewingShared = activeAccount && !activeAccount.isOwn

  return (
    <div className="min-h-screen" style={{ background: '#f0f2ff' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 shadow-sm" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💸</span>
            <span className="text-white font-bold text-lg">Mis Gastos</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowShare(true); setJoinError(''); setJoinSuccess(''); setJoinCode('') }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
            >
              <span>🔗</span> Compartir
            </button>
            <button onClick={handleLogout} className="text-white/70 hover:text-white text-sm transition-colors px-1">
              Salir
            </button>
          </div>
        </div>

        {/* Account selector (only if has shared accounts) */}
        {accounts.length > 1 && (
          <div className="max-w-lg mx-auto px-4 pb-3 flex gap-2 overflow-x-auto">
            {accounts.map(acc => (
              <button
                key={acc.user_id}
                onClick={() => setActiveAccount(acc)}
                className="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={activeAccount?.user_id === acc.user_id
                  ? { background: 'white', color: '#667eea' }
                  : { background: 'rgba(255,255,255,0.2)', color: 'white' }}
              >
                {acc.isOwn ? '👤 Mis gastos' : `👥 ${acc.email.split('@')[0]}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Viewing shared banner */}
        {viewingShared && (
          <div className="rounded-2xl px-4 py-3 text-sm font-medium flex items-center gap-2"
            style={{ background: '#e8edff', color: '#667eea' }}>
            <span>👥</span> Estás viendo los gastos de <strong>{activeAccount?.email}</strong>
          </div>
        )}

        {/* Month Selector */}
        <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
          <button
            onClick={() => setSelectedMonth(prevMonth(selectedMonth))}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors text-gray-600 text-xl"
          >‹</button>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Período</p>
            <p className="text-lg font-bold text-gray-800">{monthLabel(selectedMonth)}</p>
          </div>
          <button
            onClick={() => setSelectedMonth(nextMonth(selectedMonth))}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors text-gray-600 text-xl"
          >›</button>
        </div>

        {/* Totals */}
        {expenses.length > 0 && (
          <div className={`grid gap-3 ${totalARS > 0 && totalUSD > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {totalARS > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <p className="text-xs text-gray-400 font-medium mb-1">Total en Pesos</p>
                <p className="text-xl font-bold" style={{ color: '#667eea' }}>
                  $ {totalARS.toLocaleString('es-UY', { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
            {totalUSD > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <p className="text-xs text-gray-400 font-medium mb-1">Total en Dólares</p>
                <p className="text-xl font-bold" style={{ color: '#764ba2' }}>
                  USD {totalUSD.toLocaleString('es-UY', { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Expenses list */}
        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            </div>
          ) : expenses.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
              <div className="text-5xl mb-3">🧾</div>
              <p className="text-gray-500 font-medium">Sin gastos en {monthLabel(selectedMonth)}</p>
              <p className="text-gray-400 text-sm mt-1">Tocá + para agregar uno</p>
            </div>
          ) : (
            expenses.map(expense => (
              <div key={expense.id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: expense.currency === 'USD' ? '#f3e8ff' : '#e8edff' }}>
                  <span className="text-lg">{expense.currency === 'USD' ? '💵' : '💰'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 truncate">{expense.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-gray-400">
                      {expense.expense_date ? formatDate(expense.expense_date) : new Date(expense.created_at).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' })}
                    </p>
                    {expense.bank && (
                      <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: '#f0f2ff', color: '#667eea' }}>
                        {expense.bank}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="font-bold text-base" style={{ color: expense.currency === 'USD' ? '#764ba2' : '#667eea' }}>
                    {formatMoney(expense.amount, expense.currency)}
                  </p>
                  <div className="flex gap-1">
                    <button onClick={() => openEditModal(expense)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
                      ✏️
                    </button>
                    <button onClick={() => setDeleteConfirm(expense.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors">
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Floating Add Button */}
      <button
        onClick={openAddModal}
        className="fixed bottom-6 right-6 w-16 h-16 rounded-full shadow-xl flex items-center justify-center text-white text-3xl transition-all active:scale-90 hover:shadow-2xl"
        style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
      >+</button>

      {/* Add / Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-800">
                {modalMode === 'add' ? 'Agregar gasto' : 'Editar gasto'}
              </h2>
              <button onClick={closeModal}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Descripción</label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  required
                  placeholder="Ej: Supermercado, Nafta..."
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 placeholder-gray-400 transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Fecha</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Moneda</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setFormCurrency('UYU')}
                    className="py-3 px-4 rounded-xl border-2 font-semibold text-sm transition-all"
                    style={formCurrency === 'UYU'
                      ? { borderColor: '#667eea', background: '#e8edff', color: '#667eea' }
                      : { borderColor: '#e5e7eb', background: 'white', color: '#9ca3af' }}>
                    💰 Pesos
                  </button>
                  <button type="button" onClick={() => setFormCurrency('USD')}
                    className="py-3 px-4 rounded-xl border-2 font-semibold text-sm transition-all"
                    style={formCurrency === 'USD'
                      ? { borderColor: '#764ba2', background: '#f3e8ff', color: '#764ba2' }
                      : { borderColor: '#e5e7eb', background: 'white', color: '#9ca3af' }}>
                    💵 Dólares
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Banco <span className="text-gray-400 font-normal">(opcional)</span></label>
                <select
                  value={formBank}
                  onChange={e => setFormBank(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 transition-all bg-white"
                >
                  <option value="">Sin banco</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">
                  Monto ({formCurrency === 'UYU' ? '$' : 'USD'})
                </label>
                <input
                  type="number"
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  required
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 placeholder-gray-400 transition-all text-lg font-semibold"
                />
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
                  {formError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="flex-1 py-3 rounded-xl font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={formLoading}
                  className="flex-1 py-3 rounded-xl font-semibold text-white transition-all active:scale-95 disabled:opacity-70"
                  style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                  {formLoading
                    ? <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Guardando...
                      </span>
                    : modalMode === 'add' ? 'Agregar' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xs p-6 text-center"
            onClick={e => e.stopPropagation()}>
            <div className="text-4xl mb-3">🗑️</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">¿Eliminar gasto?</h3>
            <p className="text-gray-500 text-sm mb-5">Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-3 rounded-xl font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-3 rounded-xl font-semibold text-white bg-red-500 hover:bg-red-600">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShare && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowShare(false) }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-800">Compartir cuenta</h2>
              <button onClick={() => setShowShare(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">✕</button>
            </div>

            {/* Tabs */}
            <div className="flex rounded-xl overflow-hidden border border-gray-200 mb-5">
              <button
                onClick={() => setShareTab('mycode')}
                className="flex-1 py-2.5 text-sm font-semibold transition-colors"
                style={shareTab === 'mycode'
                  ? { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }
                  : { background: 'white', color: '#6b7280' }}>
                Mi código
              </button>
              <button
                onClick={() => setShareTab('join')}
                className="flex-1 py-2.5 text-sm font-semibold transition-colors"
                style={shareTab === 'join'
                  ? { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }
                  : { background: 'white', color: '#6b7280' }}>
                Unirme
              </button>
            </div>

            {shareTab === 'mycode' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Compartí este código con la persona que quieras que vea tus gastos.
                </p>
                {myInviteCode ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-50 rounded-xl px-4 py-3 font-mono text-xl font-bold text-center tracking-widest"
                        style={{ color: '#667eea' }}>
                        {myInviteCode}
                      </div>
                      <button onClick={handleCopyCode}
                        className="px-4 py-3 rounded-xl font-semibold text-sm transition-all"
                        style={{ background: codeCopied ? '#e8edff' : '#f3f4f6', color: codeCopied ? '#667eea' : '#374151' }}>
                        {codeCopied ? '✓ Copiado' : 'Copiar'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 text-center">
                      Una vez que alguien use este código, podrá ver y agregar gastos en tu cuenta.
                    </p>
                  </>
                ) : (
                  <button onClick={handleGenerateCode}
                    className="w-full py-3 rounded-xl font-semibold text-white transition-all active:scale-95"
                    style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                    Generar código
                  </button>
                )}
              </div>
            )}

            {shareTab === 'join' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Ingresá el código que te pasó la otra persona para ver sus gastos.
                </p>
                <input
                  type="text"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Ej: AB12CD34"
                  maxLength={8}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-center font-mono text-xl tracking-widest text-gray-800 uppercase"
                />
                {joinError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
                    {joinError}
                  </div>
                )}
                {joinSuccess && (
                  <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl">
                    {joinSuccess}
                  </div>
                )}
                <button onClick={handleJoin} disabled={joinLoading || !joinCode.trim()}
                  className="w-full py-3 rounded-xl font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                  {joinLoading
                    ? <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Uniéndome...
                      </span>
                    : 'Unirme'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
