'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase, type SharedGroup, type SharedGroupMember, type SharedGroupExpense, type SharedExpensePayment, SHARED_THEMES } from '@/lib/supabase'

function fmtMoney(amount: number, currency: string) {
  if (currency === 'USD') return `USD ${amount.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (currency === 'EUR') return `EUR ${amount.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `$ ${amount.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type MemberSummary = {
  user_id: string
  user_email: string
  shouldPay: number
  paid: number
  pending: number
}

export default function GroupDetailPage() {
  const router = useRouter()
  const params = useParams()
  const groupId = params.groupId as string

  const [userId, setUserId] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [group, setGroup] = useState<SharedGroup | null>(null)
  const [members, setMembers] = useState<SharedGroupMember[]>([])
  const [expenses, setExpenses] = useState<SharedGroupExpense[]>([])
  const [payments, setPayments] = useState<SharedExpensePayment[]>([])
  const [loading, setLoading] = useState(true)
  const [codeCopied, setCodeCopied] = useState(false)

  // Add expense
  const [showAddExpense, setShowAddExpense] = useState(false)
  const [expDesc, setExpDesc] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expLoading, setExpLoading] = useState(false)
  const [expError, setExpError] = useState('')

  // Add payment
  const [payingExpenseId, setPayingExpenseId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState('')

  // Delete confirm
  const [deleteExpenseId, setDeleteExpenseId] = useState<string | null>(null)
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null)

  // Active tab
  const [tab, setTab] = useState<'expenses' | 'summary'>('expenses')

  const loadData = useCallback(async () => {
    const { data: groupData } = await supabase
      .from('shared_groups')
      .select('*')
      .eq('id', groupId)
      .single()

    if (!groupData) { router.replace('/shared'); return }
    setGroup(groupData as SharedGroup)

    const [{ data: memberData }, { data: expData }] = await Promise.all([
      supabase.from('shared_group_members').select('*').eq('group_id', groupId).order('joined_at'),
      supabase.from('shared_group_expenses').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
    ])

    const mems = (memberData ?? []) as SharedGroupMember[]
    const exps = (expData ?? []) as SharedGroupExpense[]
    setMembers(mems)
    setExpenses(exps)

    if (exps.length > 0) {
      const expIds = exps.map(e => e.id)
      const { data: payData } = await supabase
        .from('shared_expense_payments')
        .select('*')
        .in('expense_id', expIds)
        .order('created_at')
      setPayments((payData ?? []) as SharedExpensePayment[])
    } else {
      setPayments([])
    }

    setLoading(false)
  }, [groupId, router])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      setUserId(session.user.id)
      setUserEmail(session.user.email ?? '')
      loadData()
    })
  }, [router, loadData])

  async function handleAddExpense() {
    if (!expDesc.trim()) { setExpError('Ingresá una descripción'); return }
    const amt = parseFloat(expAmount.replace(',', '.'))
    if (!amt || amt <= 0) { setExpError('Ingresá un monto válido'); return }
    setExpLoading(true)
    setExpError('')

    const { error } = await supabase.from('shared_group_expenses').insert({
      group_id: groupId,
      description: expDesc.trim(),
      total_amount: amt,
      currency: group!.currency,
      member_count: members.length,
      created_by: userId,
    })

    if (error) { setExpError('Error al guardar'); setExpLoading(false); return }
    setExpLoading(false)
    setShowAddExpense(false)
    setExpDesc('')
    setExpAmount('')
    loadData()
  }

  async function handleDeleteExpense(id: string) {
    await supabase.from('shared_group_expenses').delete().eq('id', id)
    setDeleteExpenseId(null)
    loadData()
  }

  async function handleAddPayment(expenseId: string) {
    const amt = parseFloat(payAmount.replace(',', '.'))
    if (!amt || amt <= 0) { setPayError('Ingresá un monto válido'); return }
    setPayLoading(true)
    setPayError('')

    const { error } = await supabase.from('shared_expense_payments').insert({
      expense_id: expenseId,
      user_id: userId,
      user_email: userEmail,
      amount: amt,
      note: payNote.trim() || null,
    })

    if (error) { setPayError('Error al guardar'); setPayLoading(false); return }
    setPayLoading(false)
    setPayingExpenseId(null)
    setPayAmount('')
    setPayNote('')
    loadData()
  }

  async function handleDeletePayment(id: string) {
    await supabase.from('shared_expense_payments').delete().eq('id', id)
    setDeletePaymentId(null)
    loadData()
  }

  function copyCode() {
    if (group) {
      navigator.clipboard.writeText(group.invite_code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    }
  }

  // Compute per-member summary across all expenses
  const memberSummaries: MemberSummary[] = members.map(m => {
    let shouldPay = 0
    let paid = 0
    for (const exp of expenses) {
      shouldPay += exp.total_amount / members.length
      const expPayments = payments.filter(p => p.expense_id === exp.id && p.user_id === m.user_id)
      paid += expPayments.reduce((s, p) => s + Number(p.amount), 0)
    }
    return {
      user_id: m.user_id,
      user_email: m.user_email,
      shouldPay,
      paid,
      pending: Math.max(0, shouldPay - paid),
    }
  })

  const totalAmount = expenses.reduce((s, e) => s + Number(e.total_amount), 0)

  const themeInfo = group ? (SHARED_THEMES.find(t => t.value === group.theme) ?? SHARED_THEMES[0]) : null

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    )
  }

  if (!group) return null

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <button onClick={() => router.push('/shared')} className="text-gray-400 hover:text-white transition-colors mt-1">
            ←
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{themeInfo?.emoji}</span>
              <h1 className="text-xl font-bold truncate">{group.name}</h1>
            </div>
            <p className="text-sm text-gray-400">{members.length} miembro{members.length !== 1 ? 's' : ''} · {group.currency}</p>
          </div>
          <button
            onClick={copyCode}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            {codeCopied ? '✓ Copiado' : `# ${group.invite_code}`}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 mb-4">
          <button
            onClick={() => setTab('expenses')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'expenses' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Gastos
          </button>
          <button
            onClick={() => setTab('summary')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'summary' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Resumen por persona
          </button>
        </div>

        {tab === 'expenses' && (
          <>
            <button
              onClick={() => setShowAddExpense(true)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-xl mb-4 transition-colors"
            >
              + Agregar gasto
            </button>

            {showAddExpense && (
              <div className="bg-gray-900 rounded-2xl p-4 mb-4 border border-gray-800">
                <h2 className="font-semibold mb-3">Nuevo gasto</h2>
                <input
                  className="w-full bg-gray-800 rounded-xl px-4 py-2.5 text-sm mb-3 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Descripción (ej: Asado, Hotel, Combustible)"
                  value={expDesc}
                  onChange={e => setExpDesc(e.target.value)}
                />
                <input
                  className="w-full bg-gray-800 rounded-xl px-4 py-2.5 text-sm mb-3 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder={`Monto total (${group.currency})`}
                  type="text"
                  inputMode="decimal"
                  value={expAmount}
                  onChange={e => setExpAmount(e.target.value)}
                />
                <p className="text-xs text-gray-500 mb-3">
                  Se divide entre {members.length} persona{members.length !== 1 ? 's' : ''} = {members.length > 0 && expAmount ? fmtMoney(parseFloat(expAmount.replace(',', '.') || '0') / members.length, group.currency) : '—'} c/u
                </p>
                {expError && <p className="text-red-400 text-sm mb-2">{expError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddExpense}
                    disabled={expLoading}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-2 rounded-xl"
                  >
                    {expLoading ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button
                    onClick={() => { setShowAddExpense(false); setExpDesc(''); setExpAmount(''); setExpError('') }}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2 rounded-xl"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {expenses.length === 0 ? (
              <div className="text-center text-gray-500 py-12">
                <p className="text-4xl mb-3">🧾</p>
                <p>Sin gastos todavía.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {expenses.map(exp => {
                  const expPayments = payments.filter(p => p.expense_id === exp.id)
                  const totalPaid = expPayments.reduce((s, p) => s + Number(p.amount), 0)
                  const perPerson = exp.total_amount / members.length
                  const myPayments = expPayments.filter(p => p.user_id === userId)
                  const myPaid = myPayments.reduce((s, p) => s + Number(p.amount), 0)
                  const myPending = Math.max(0, perPerson - myPaid)
                  const isExpanding = payingExpenseId === exp.id

                  return (
                    <div key={exp.id} className="bg-gray-900 rounded-2xl border border-gray-800">
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{exp.description}</p>
                            <p className="text-sm text-gray-400">
                              Total: {fmtMoney(exp.total_amount, exp.currency)} · {fmtMoney(perPerson, exp.currency)} c/u
                            </p>
                          </div>
                          {exp.created_by === userId && (
                            <button
                              onClick={() => setDeleteExpenseId(exp.id)}
                              className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none"
                            >
                              ×
                            </button>
                          )}
                        </div>

                        {/* Progress bar */}
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>Pagado: {fmtMoney(totalPaid, exp.currency)}</span>
                            <span>Pendiente: {fmtMoney(Math.max(0, exp.total_amount - totalPaid), exp.currency)}</span>
                          </div>
                          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full transition-all"
                              style={{ width: `${Math.min(100, (totalPaid / exp.total_amount) * 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* My status */}
                        <div className="mt-2 flex items-center justify-between">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${myPending <= 0 ? 'bg-emerald-900 text-emerald-300' : 'bg-amber-900 text-amber-300'}`}>
                            {myPending <= 0 ? '✓ Pagado' : `Debés: ${fmtMoney(myPending, exp.currency)}`}
                          </span>
                          <button
                            onClick={() => {
                              setPayingExpenseId(isExpanding ? null : exp.id)
                              setPayAmount('')
                              setPayNote('')
                              setPayError('')
                            }}
                            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                          >
                            {isExpanding ? 'Cerrar' : 'Registrar pago'}
                          </button>
                        </div>
                      </div>

                      {/* Payments list */}
                      {expPayments.length > 0 && (
                        <div className="border-t border-gray-800 px-4 py-2 space-y-1">
                          {expPayments.map(pay => (
                            <div key={pay.id} className="flex items-center justify-between text-xs text-gray-400">
                              <span className="truncate flex-1">{pay.user_email.split('@')[0]}: {fmtMoney(Number(pay.amount), exp.currency)}{pay.note ? ` · ${pay.note}` : ''}</span>
                              {pay.user_id === userId && (
                                <button
                                  onClick={() => setDeletePaymentId(pay.id)}
                                  className="text-gray-700 hover:text-red-400 transition-colors ml-2"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add payment form */}
                      {isExpanding && (
                        <div className="border-t border-gray-800 p-4">
                          <p className="text-sm font-medium mb-2">Registrar mi pago</p>
                          <input
                            className="w-full bg-gray-800 rounded-xl px-4 py-2 text-sm mb-2 outline-none focus:ring-2 focus:ring-emerald-500"
                            placeholder={`Monto (${exp.currency})`}
                            type="text"
                            inputMode="decimal"
                            value={payAmount}
                            onChange={e => setPayAmount(e.target.value)}
                          />
                          <input
                            className="w-full bg-gray-800 rounded-xl px-4 py-2 text-sm mb-2 outline-none focus:ring-2 focus:ring-emerald-500"
                            placeholder="Nota (opcional)"
                            value={payNote}
                            onChange={e => setPayNote(e.target.value)}
                          />
                          {payError && <p className="text-red-400 text-xs mb-2">{payError}</p>}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAddPayment(exp.id)}
                              disabled={payLoading}
                              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-xl"
                            >
                              {payLoading ? 'Guardando...' : 'Guardar pago'}
                            </button>
                            <button
                              onClick={() => setPayingExpenseId(null)}
                              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-xl"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Delete expense confirm */}
                      {deleteExpenseId === exp.id && (
                        <div className="border-t border-gray-800 p-4 bg-red-950 rounded-b-2xl">
                          <p className="text-sm mb-3">¿Eliminar este gasto y todos sus pagos?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleDeleteExpense(exp.id)}
                              className="flex-1 bg-red-600 hover:bg-red-500 text-white text-sm font-medium py-2 rounded-xl"
                            >
                              Eliminar
                            </button>
                            <button
                              onClick={() => setDeleteExpenseId(null)}
                              className="flex-1 bg-gray-800 text-gray-300 text-sm font-medium py-2 rounded-xl"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Delete payment confirm */}
                      {deletePaymentId && expPayments.some(p => p.id === deletePaymentId) && (
                        <div className="border-t border-gray-800 p-4 bg-red-950 rounded-b-2xl">
                          <p className="text-sm mb-3">¿Eliminar este pago?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleDeletePayment(deletePaymentId)}
                              className="flex-1 bg-red-600 hover:bg-red-500 text-white text-sm font-medium py-2 rounded-xl"
                            >
                              Eliminar
                            </button>
                            <button
                              onClick={() => setDeletePaymentId(null)}
                              className="flex-1 bg-gray-800 text-gray-300 text-sm font-medium py-2 rounded-xl"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Total */}
            {expenses.length > 0 && (
              <div className="mt-4 bg-gray-900 rounded-2xl p-4 border border-gray-800">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total del grupo</span>
                  <span className="font-semibold">{fmtMoney(totalAmount, group.currency)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-400">Por persona</span>
                  <span className="font-semibold">{members.length > 0 ? fmtMoney(totalAmount / members.length, group.currency) : '—'}</span>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'summary' && (
          <div className="space-y-3">
            {memberSummaries.length === 0 ? (
              <div className="text-center text-gray-500 py-12">Sin gastos todavía.</div>
            ) : (
              memberSummaries.map(ms => (
                <div key={ms.user_id} className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-medium truncate">{ms.user_email.split('@')[0]}</p>
                    {ms.user_id === userId && <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">Vos</span>}
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Debe pagar</span>
                      <span>{fmtMoney(ms.shouldPay, group.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Pagado</span>
                      <span className="text-emerald-400">{fmtMoney(ms.paid, group.currency)}</span>
                    </div>
                    <div className="flex justify-between font-semibold border-t border-gray-800 pt-1.5 mt-1.5">
                      <span className={ms.pending <= 0 ? 'text-emerald-400' : 'text-amber-400'}>
                        {ms.pending <= 0 ? 'Al día ✓' : 'Pendiente'}
                      </span>
                      <span className={ms.pending <= 0 ? 'text-emerald-400' : 'text-amber-400'}>
                        {ms.pending <= 0 ? fmtMoney(0, group.currency) : fmtMoney(ms.pending, group.currency)}
                      </span>
                    </div>
                  </div>

                  {/* Per-expense breakdown */}
                  {expenses.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800 space-y-1">
                      {expenses.map(exp => {
                        const perPerson = exp.total_amount / members.length
                        const expPayments = payments.filter(p => p.expense_id === exp.id && p.user_id === ms.user_id)
                        const paid = expPayments.reduce((s, p) => s + Number(p.amount), 0)
                        const pending = Math.max(0, perPerson - paid)
                        return (
                          <div key={exp.id} className="flex justify-between text-xs text-gray-500">
                            <span className="truncate flex-1 mr-2">{exp.description}</span>
                            <span className={pending <= 0 ? 'text-emerald-600' : 'text-amber-600'}>
                              {pending <= 0 ? '✓' : `- ${fmtMoney(pending, exp.currency)}`}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Group total summary */}
            {expenses.length > 0 && (
              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                <p className="font-semibold mb-3">Totales del grupo</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total gastos</span>
                    <span>{fmtMoney(totalAmount, group.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total pagado</span>
                    <span className="text-emerald-400">{fmtMoney(payments.reduce((s, p) => s + Number(p.amount), 0), group.currency)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-gray-800 pt-1.5 mt-1.5">
                    <span className="text-amber-400">Total pendiente</span>
                    <span className="text-amber-400">{fmtMoney(memberSummaries.reduce((s, m) => s + m.pending, 0), group.currency)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
