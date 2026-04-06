'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Expense } from '@/lib/supabase'

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

function formatMoney(amount: number, currency: 'ARS' | 'USD') {
  if (currency === 'USD') {
    return `USD ${amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `$ ${amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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

type ModalMode = 'add' | 'edit' | null

export default function Dashboard() {
  const router = useRouter()
  const [userEmail, setUserEmail] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth())
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Form state
  const [formDesc, setFormDesc] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formCurrency, setFormCurrency] = useState<'ARS' | 'USD'>('ARS')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')

  // Check auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login')
      } else {
        setUserEmail(session.user.email ?? '')
      }
    })
  }, [router])

  // Load expenses
  const loadExpenses = useCallback(async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('month', selectedMonth)
      .order('created_at', { ascending: false })

    if (!error && data) {
      setExpenses(data as Expense[])
    }
    setLoading(false)
  }, [selectedMonth])

  useEffect(() => {
    loadExpenses()
  }, [loadExpenses])

  function openAddModal() {
    setFormDesc('')
    setFormAmount('')
    setFormCurrency('ARS')
    setFormError('')
    setEditingExpense(null)
    setModalMode('add')
  }

  function openEditModal(expense: Expense) {
    setFormDesc(expense.description)
    setFormAmount(String(expense.amount))
    setFormCurrency(expense.currency)
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
    if (isNaN(amount) || amount <= 0) {
      setFormError('El monto debe ser un número mayor a 0')
      return
    }
    if (!formDesc.trim()) {
      setFormError('La descripción no puede estar vacía')
      return
    }

    setFormLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    if (modalMode === 'add') {
      const { error } = await supabase.from('expenses').insert({
        user_id: session.user.id,
        description: formDesc.trim(),
        amount,
        currency: formCurrency,
        month: selectedMonth,
      })
      if (error) {
        setFormError('Error al guardar. Intentá de nuevo.')
      } else {
        closeModal()
        loadExpenses()
      }
    } else if (modalMode === 'edit' && editingExpense) {
      const { error } = await supabase.from('expenses').update({
        description: formDesc.trim(),
        amount,
        currency: formCurrency,
      }).eq('id', editingExpense.id)

      if (error) {
        setFormError('Error al actualizar. Intentá de nuevo.')
      } else {
        closeModal()
        loadExpenses()
      }
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
  const totalARS = expenses.filter(e => e.currency === 'ARS').reduce((s, e) => s + e.amount, 0)
  const totalUSD = expenses.filter(e => e.currency === 'USD').reduce((s, e) => s + e.amount, 0)

  return (
    <div className="min-h-screen" style={{ background: '#f0f2ff' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 shadow-sm" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💸</span>
            <span className="text-white font-bold text-lg">Mis Gastos</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-white/70 text-xs hidden sm:block">{userEmail}</span>
            <button
              onClick={handleLogout}
              className="text-white/80 hover:text-white text-sm font-medium transition-colors"
            >
              Salir
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Month Selector */}
        <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
          <button
            onClick={() => setSelectedMonth(prevMonth(selectedMonth))}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors text-gray-600 text-xl font-light"
          >
            ‹
          </button>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Período</p>
            <p className="text-lg font-bold text-gray-800">{monthLabel(selectedMonth)}</p>
          </div>
          <button
            onClick={() => setSelectedMonth(nextMonth(selectedMonth))}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors text-gray-600 text-xl font-light"
          >
            ›
          </button>
        </div>

        {/* Totals */}
        {expenses.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {totalARS > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <p className="text-xs text-gray-400 font-medium mb-1">Total en Pesos</p>
                <p className="text-xl font-bold" style={{ color: '#667eea' }}>
                  $ {totalARS.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
            {totalUSD > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <p className="text-xs text-gray-400 font-medium mb-1">Total en Dólares</p>
                <p className="text-xl font-bold" style={{ color: '#764ba2' }}>
                  USD {totalUSD.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
            {totalARS > 0 && totalUSD > 0 && (
              <div className="col-span-2 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-3 border border-indigo-100">
                <p className="text-xs text-gray-500 text-center">
                  {expenses.length} gasto{expenses.length !== 1 ? 's' : ''} en {monthLabel(selectedMonth)}
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
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(expense.created_at).toLocaleDateString('es-AR')}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="font-bold text-base" style={{ color: expense.currency === 'USD' ? '#764ba2' : '#667eea' }}>
                    {formatMoney(expense.amount, expense.currency)}
                  </p>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditModal(expense)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(expense.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors text-gray-400 hover:text-red-500"
                      title="Eliminar"
                    >
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
        title="Agregar gasto"
      >
        +
      </button>

      {/* Add / Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-800">
                {modalMode === 'add' ? 'Agregar gasto' : 'Editar gasto'}
              </h2>
              <button onClick={closeModal}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 transition-colors">
                ✕
              </button>
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
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:border-transparent text-gray-800 placeholder-gray-400 transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Moneda</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormCurrency('ARS')}
                    className="py-3 px-4 rounded-xl border-2 font-semibold text-sm transition-all"
                    style={formCurrency === 'ARS'
                      ? { borderColor: '#667eea', background: '#e8edff', color: '#667eea' }
                      : { borderColor: '#e5e7eb', background: 'white', color: '#9ca3af' }}
                  >
                    💰 Pesos (ARS)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormCurrency('USD')}
                    className="py-3 px-4 rounded-xl border-2 font-semibold text-sm transition-all"
                    style={formCurrency === 'USD'
                      ? { borderColor: '#764ba2', background: '#f3e8ff', color: '#764ba2' }
                      : { borderColor: '#e5e7eb', background: 'white', color: '#9ca3af' }}
                  >
                    💵 Dólares (USD)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">
                  Monto ({formCurrency === 'ARS' ? '$' : 'USD'})
                </label>
                <input
                  type="number"
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  required
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:border-transparent text-gray-800 placeholder-gray-400 transition-all text-lg font-semibold"
                />
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
                  {formError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-3 rounded-xl font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 py-3 rounded-xl font-semibold text-white transition-all active:scale-95 disabled:opacity-70"
                  style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
                >
                  {formLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Guardando...
                    </span>
                  ) : modalMode === 'add' ? 'Agregar' : 'Guardar'}
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
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-3 rounded-xl font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-3 rounded-xl font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
