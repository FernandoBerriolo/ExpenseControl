'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type Expense, type Income, type SharedAccess, type Account, BANKS, CATEGORIES } from '@/lib/supabase'
import ChatWidget from '@/app/components/ChatWidget'

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

const CARD_CLOSING_DAYS: Record<string, number> = {
  'Itaú': 26,
  'BROU': 25,
}

function getBillingMonth(purchaseDateStr: string, bank: string): string {
  const closingDay = CARD_CLOSING_DAYS[bank]
  if (!closingDay) return purchaseDateStr.substring(0, 7)
  const [year, month, day] = purchaseDateStr.split('-').map(Number)
  if (day > closingDay) {
    const d = new Date(year, month, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return `${year}-${String(month).padStart(2, '0')}`
}

function addMonths(monthStr: string, n: number): string {
  const [year, month] = monthStr.split('-').map(Number)
  const d = new Date(year, month - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function lastDayOfMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-').map(Number)
  const day = new Date(year, month, 0).getDate()
  return `${monthStr}-${String(day).padStart(2, '0')}`
}

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

function getDefaultDateForMonth(month: string): string {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return todayStr.startsWith(month) ? todayStr : `${month}-01`
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

function formatDateFull(dateStr: string) {
  if (!dateStr) return 'DD/MM/AAAA'
  const [year, m, d] = dateStr.split('-')
  return `${d}/${m}/${year}`
}

function generateCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

function getCategoryInfo(value: string | null | undefined) {
  if (!value) return null
  return CATEGORIES.find(c => c.value === value) ?? null
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

  const [showHistory, setShowHistory] = useState(false)
  const [monthlyHistory, setMonthlyHistory] = useState<{ month: string; uyu: number; usd: number }[]>([])
  const [showCategoryChart, setShowCategoryChart] = useState(true)

  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Income state
  const [incomes, setIncomes] = useState<Income[]>([])
  const [showIncomeModal, setShowIncomeModal] = useState(false)
  const [incomeDesc, setIncomeDesc] = useState('Sueldo')
  const [incomeAmount, setIncomeAmount] = useState('')
  const [incomeCurrency, setIncomeCurrency] = useState<'UYU' | 'USD'>('UYU')
  const [incomeFormLoading, setIncomeFormLoading] = useState(false)
  const [incomeError, setIncomeError] = useState('')
  const [deleteIncomeConfirm, setDeleteIncomeConfirm] = useState<string | null>(null)

  // Share modal
  const [showShare, setShowShare] = useState(false)
  const [shareTab, setShareTab] = useState<'mycode' | 'join' | 'telegram' | 'whatsapp'>('mycode')
  const [myPhone, setMyPhone] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneLoading, setPhoneLoading] = useState(false)
  const [phoneSaved, setPhoneSaved] = useState(false)

  const [myWhatsapp, setMyWhatsapp] = useState('')
  const [whatsappInput, setWhatsappInput] = useState('')
  const [whatsappLoading, setWhatsappLoading] = useState(false)
  const [whatsappSaved, setWhatsappSaved] = useState(false)
  const [myInviteCode, setMyInviteCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [joinSuccess, setJoinSuccess] = useState('')
  const [codeCopied, setCodeCopied] = useState(false)

  // Expense form state
  const [formDesc, setFormDesc] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formCurrency, setFormCurrency] = useState<'UYU' | 'USD'>('UYU')
  const [formBank, setFormBank] = useState('')
  const [formDate, setFormDate] = useState(getDefaultDateForMonth(getCurrentMonth()))
  const [formInstallments, setFormInstallments] = useState(1)
  const [formCategory, setFormCategory] = useState('')
  const [formIsOwed, setFormIsOwed] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')

  const billingMonth = useMemo(() => {
    if (!formDate) return selectedMonth
    if (formBank && CARD_CLOSING_DAYS[formBank]) {
      return getBillingMonth(formDate, formBank)
    }
    return formDate.substring(0, 7)
  }, [formDate, formBank, selectedMonth])

  const billingDiffersFromDate = billingMonth !== formDate.substring(0, 7)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }

      const uid = session.user.id
      const email = session.user.email ?? ''
      setMyUserId(uid)
      setMyEmail(email)

      const ownAccount: Account = { user_id: uid, email, isOwn: true }
      setActiveAccount(ownAccount)

      const { data } = await supabase
        .from('shared_access')
        .select('*')
        .eq('status', 'accepted')

      const shared: Account[] = (data as SharedAccess[] ?? [])
        .filter(row => row.owner_id !== uid)
        .map(row => ({ user_id: row.owner_id, email: row.owner_email, isOwn: false }))

      setAccounts([ownAccount, ...shared])

      const { data: codeData } = await supabase
        .from('shared_access')
        .select('invite_code')
        .eq('owner_id', uid)
        .limit(1)
        .single()

      if (codeData) setMyInviteCode(codeData.invite_code)

      const { data: phoneData } = await supabase
        .from('phone_users')
        .select('phone, whatsapp_phone')
        .eq('user_id', uid)
        .single()

      if (phoneData) {
        setMyPhone(phoneData.phone); setPhoneInput(phoneData.phone)
        if (phoneData.whatsapp_phone) { setMyWhatsapp(phoneData.whatsapp_phone); setWhatsappInput(phoneData.whatsapp_phone) }
      }
    })
  }, [router])

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

  useEffect(() => { loadExpenses() }, [loadExpenses])

  const loadIncomes = useCallback(async () => {
    if (!activeAccount) return
    const { data, error } = await supabase
      .from('incomes')
      .select('*')
      .eq('user_id', activeAccount.user_id)
      .eq('month', selectedMonth)
      .order('created_at', { ascending: false })

    if (!error && data) setIncomes(data as Income[])
  }, [selectedMonth, activeAccount])

  useEffect(() => { loadIncomes() }, [loadIncomes])

  const [owedTotalUYU, setOwedTotalUYU] = useState(0)
  const [owedTotalUSD, setOwedTotalUSD] = useState(0)

  const loadOwedTotal = useCallback(async () => {
    if (!activeAccount) return
    const { data } = await supabase
      .from('expenses')
      .select('amount, currency')
      .eq('user_id', activeAccount.user_id)
      .eq('month', selectedMonth)
      .eq('is_owed', true)
    if (data) {
      const rows = data as { amount: number; currency: string }[]
      setOwedTotalUYU(rows.filter(e => e.currency === 'UYU').reduce((s, e) => s + e.amount, 0))
      setOwedTotalUSD(rows.filter(e => e.currency === 'USD').reduce((s, e) => s + e.amount, 0))
    }
  }, [activeAccount, selectedMonth])

  useEffect(() => { loadOwedTotal() }, [loadOwedTotal])

  const loadMonthlyHistory = useCallback(async () => {
    if (!activeAccount) return
    const { data } = await supabase
      .from('expenses')
      .select('month, amount, currency')
      .eq('user_id', activeAccount.user_id)
      .order('month', { ascending: true })
    if (!data) return
    const map: Record<string, { uyu: number; usd: number }> = {}
    for (const e of data as { month: string; amount: number; currency: string }[]) {
      if (!map[e.month]) map[e.month] = { uyu: 0, usd: 0 }
      if (e.currency === 'UYU') map[e.month].uyu += e.amount
      else map[e.month].usd += e.amount
    }
    setMonthlyHistory(Object.entries(map).map(([month, v]) => ({ month, ...v })))
  }, [activeAccount])

  useEffect(() => { if (showHistory) loadMonthlyHistory() }, [showHistory, loadMonthlyHistory])

  // --- Share ---
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
      setJoinError('Código inválido o ya utilizado')
    } else {
      const row = data as SharedAccess
      setAccounts(prev => [...prev, { user_id: row.owner_id, email: row.owner_email, isOwn: false }])
      setJoinSuccess(`¡Listo! Ahora podés ver los gastos de ${row.owner_email}`)
      setJoinCode('')
    }
    setJoinLoading(false)
  }

  async function handleSavePhone() {
    if (!phoneInput.trim()) return
    setPhoneLoading(true)
    setPhoneSaved(false)
    const phone = phoneInput.trim().replace(/\D/g, '') // solo dígitos
    const { error } = await supabase.from('phone_users').upsert(
      { phone, user_id: myUserId },
      { onConflict: 'phone' }
    )
    if (!error) { setMyPhone(phone); setPhoneSaved(true); setTimeout(() => setPhoneSaved(false), 3000) }
    setPhoneLoading(false)
  }

  async function handleSaveWhatsapp() {
    if (!whatsappInput.trim()) return
    setWhatsappLoading(true)
    setWhatsappSaved(false)
    const phone = whatsappInput.trim()
    const { error } = await supabase.from('phone_users')
      .update({ whatsapp_phone: phone })
      .eq('user_id', myUserId)
    if (!error) { setMyWhatsapp(phone); setWhatsappSaved(true); setTimeout(() => setWhatsappSaved(false), 3000) }
    setWhatsappLoading(false)
  }

  // --- Income ---
  async function handleAddIncome(e: React.SyntheticEvent) {
    e.preventDefault()
    setIncomeError('')
    const amount = parseFloat(incomeAmount)
    if (isNaN(amount) || amount <= 0) { setIncomeError('El monto debe ser mayor a 0'); return }
    if (!incomeDesc.trim()) { setIncomeError('La descripción no puede estar vacía'); return }
    if (!activeAccount) return
    setIncomeFormLoading(true)
    const { error } = await supabase.from('incomes').insert({
      user_id: activeAccount.user_id,
      description: incomeDesc.trim(),
      amount,
      currency: incomeCurrency,
      month: selectedMonth,
      income_date: `${selectedMonth}-01`,
    })
    if (error) {
      setIncomeError('Error al guardar. Intentá de nuevo.')
    } else {
      setShowIncomeModal(false)
      setIncomeAmount('')
      setIncomeDesc('Sueldo')
      setIncomeCurrency('UYU')
      loadIncomes()
    }
    setIncomeFormLoading(false)
  }

  async function handleDeleteIncome(id: string) {
    await supabase.from('incomes').delete().eq('id', id)
    setDeleteIncomeConfirm(null)
    loadIncomes()
  }

  // --- Expense form ---
  function openAddModal() {
    setFormDesc('')
    setFormAmount('')
    setFormCurrency('UYU')
    setFormBank('')
    setFormDate(getDefaultDateForMonth(selectedMonth))
    setFormInstallments(1)
    setFormCategory('')
    setFormIsOwed(false)
    setFormError('')
    setEditingExpense(null)
    setModalMode('add')
  }

  function openEditModal(expense: Expense) {
    setFormDesc(expense.description)
    setFormAmount(String(expense.amount))
    setFormCurrency(expense.currency)
    setFormBank(expense.bank ?? '')
    setFormDate(expense.expense_date ?? getDefaultDateForMonth(selectedMonth))
    setFormInstallments(1)
    setFormCategory(expense.category ?? '')
    setFormIsOwed(expense.is_owed ?? false)
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

    setFormLoading(true)

    if (modalMode === 'add') {
      const installmentAmount = Math.round((amount / formInstallments) * 100) / 100

      const entries = Array.from({ length: formInstallments }, (_, i) => ({
        user_id: activeAccount.user_id,
        description: formInstallments > 1
          ? `${formDesc.trim()} (${i + 1}/${formInstallments})`
          : formDesc.trim(),
        amount: installmentAmount,
        currency: formCurrency,
        bank: formBank || null,
        month: addMonths(billingMonth, i),
        expense_date: formDate,
        category: formCategory || null,
        is_owed: formIsOwed,
      }))

      const { error } = await supabase.from('expenses').insert(entries)
      if (error) setFormError('Error al guardar. Intentá de nuevo.')
      else { closeModal(); loadExpenses(); loadOwedTotal() }

    } else if (modalMode === 'edit' && editingExpense) {
      const { error } = await supabase.from('expenses').update({
        description: formDesc.trim(),
        amount,
        currency: formCurrency,
        bank: formBank || null,
        month: billingMonth,
        expense_date: formDate,
        category: formCategory || null,
        is_owed: formIsOwed,
      }).eq('id', editingExpense.id)

      if (error) setFormError('Error al actualizar. Intentá de nuevo.')
      else { closeModal(); loadExpenses(); loadOwedTotal() }
    }

    setFormLoading(false)
  }

  async function handleDelete(id: string) {
    await supabase.from('expenses').delete().eq('id', id)
    setDeleteConfirm(null)
    loadExpenses()
    loadOwedTotal()
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const totalUYU = expenses.filter(e => e.currency === 'UYU').reduce((s, e) => s + e.amount, 0)
  const totalUSD = expenses.filter(e => e.currency === 'USD').reduce((s, e) => s + e.amount, 0)
  // Balance only counts "Otros" (cash) expenses, not card expenses
  const cardTotalUYU = expenses.filter(e => e.currency === 'UYU' && !e.bank).reduce((s, e) => s + e.amount, 0)
  const cardTotalUSD = expenses.filter(e => e.currency === 'USD' && !e.bank).reduce((s, e) => s + e.amount, 0)
  const incomeTotalUYU = incomes.filter(i => i.currency === 'UYU').reduce((s, i) => s + i.amount, 0)
  const incomeTotalUSD = incomes.filter(i => i.currency === 'USD').reduce((s, i) => s + i.amount, 0)
  const viewingShared = activeAccount && !activeAccount.isOwn

  // Category chart data
  const categoryData = useMemo(() => {
    const groups: Record<string, { uyu: number; usd: number }> = {}
    for (const e of expenses) {
      const key = e.category || '__sin__'
      if (!groups[key]) groups[key] = { uyu: 0, usd: 0 }
      if (e.currency === 'UYU') groups[key].uyu += e.amount
      else groups[key].usd += e.amount
    }
    return Object.entries(groups)
      .map(([cat, totals]) => {
        const info = getCategoryInfo(cat)
        return {
          cat,
          uyu: totals.uyu,
          usd: totals.usd,
          label: info?.label ?? 'Sin categoría',
          emoji: info?.emoji ?? '📦',
        }
      })
      .sort((a, b) => b.uyu - a.uyu)
  }, [expenses])

  const maxUYU = Math.max(...categoryData.map(d => d.uyu), 1)
  const maxUSD = Math.max(...categoryData.map(d => d.usd), 1)

  const dateMin = `${selectedMonth}-01`
  const dateMax = lastDayOfMonth(selectedMonth)

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
            {myEmail && (
              <span className="text-white/90 text-sm font-medium capitalize">
                {myEmail.split('@')[0]} 👋
              </span>
            )}
            <button
              onClick={() => { setShowShare(true); setJoinError(''); setJoinSuccess(''); setJoinCode('') }}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-lg"
              style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
            >
              🔗
            </button>
            <button onClick={handleLogout} className="text-white/70 hover:text-white text-sm px-1">
              Salir
            </button>
          </div>
        </div>

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
        {viewingShared && (
          <div className="rounded-2xl px-4 py-3 text-sm font-medium flex items-center gap-2"
            style={{ background: '#e8edff', color: '#667eea' }}>
            <span>👥</span> Estás viendo los gastos de <strong>{activeAccount?.email}</strong>
          </div>
        )}

        {/* Month Selector */}
        <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
          <button onClick={() => setSelectedMonth(prevMonth(selectedMonth))}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-600 text-xl">‹</button>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Período</p>
            <p className="text-lg font-bold text-gray-800">{monthLabel(selectedMonth)}</p>
          </div>
          <button onClick={() => setSelectedMonth(nextMonth(selectedMonth))}
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-600 text-xl">›</button>
        </div>

        {/* Income Section */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">💼 Ingresos del mes</p>
            {!viewingShared && (
              <button
                onClick={() => { setShowIncomeModal(true); setIncomeError('') }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-lg font-bold"
                style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }}
              >+</button>
            )}
          </div>

          {incomes.length === 0 ? (
            <p className="text-sm text-gray-400">Sin ingresos registrados este mes</p>
          ) : (
            <div className="space-y-2">
              {incomes.map(income => (
                <div key={income.id} className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">{income.description}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-green-600">{formatMoney(income.amount, income.currency)}</p>
                    {!viewingShared && (
                      <button onClick={() => setDeleteIncomeConfirm(income.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-sm">🗑️</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Balance — solo tarjetas, no efectivo */}
          {(incomeTotalUYU > 0 || incomeTotalUSD > 0) && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
              {incomeTotalUYU > 0 && cardTotalUYU > 0 && (
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-500">Balance Pesos <span className="text-gray-400">(solo tarjetas)</span></p>
                  <p className={`text-sm font-bold ${incomeTotalUYU - cardTotalUYU >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {incomeTotalUYU - cardTotalUYU >= 0 ? '+' : ''}{formatMoney(incomeTotalUYU - cardTotalUYU, 'UYU')}
                  </p>
                </div>
              )}
              {incomeTotalUSD > 0 && cardTotalUSD > 0 && (
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-500">Balance Dólares <span className="text-gray-400">(solo tarjetas)</span></p>
                  <p className={`text-sm font-bold ${incomeTotalUSD - cardTotalUSD >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {incomeTotalUSD - cardTotalUSD >= 0 ? '+' : ''}{formatMoney(incomeTotalUSD - cardTotalUSD, 'USD')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Totals */}
        {expenses.length > 0 && (
          <div className={`grid gap-3 ${totalUYU > 0 && totalUSD > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {totalUYU > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <p className="text-xs text-gray-400 font-medium mb-1">Total en Pesos</p>
                <p className="text-xl font-bold" style={{ color: '#667eea' }}>
                  $ {totalUYU.toLocaleString('es-UY', { minimumFractionDigits: 2 })}
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

        {/* Debes a Fer — total histórico */}
        {(owedTotalUYU > 0 || owedTotalUSD > 0) && (
          <div className="rounded-2xl p-4" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
            <p className="text-sm font-semibold mb-2" style={{ color: '#c2410c' }}>💸 Debés a Fer este mes</p>
            <div className="flex flex-wrap gap-3">
              {owedTotalUYU > 0 && (
                <p className="text-lg font-bold" style={{ color: '#ea580c' }}>{formatMoney(owedTotalUYU, 'UYU')}</p>
              )}
              {owedTotalUSD > 0 && (
                <p className="text-lg font-bold" style={{ color: '#9a3412' }}>{formatMoney(owedTotalUSD, 'USD')}</p>
              )}
            </div>
          </div>
        )}

        {/* Category Chart */}
        {expenses.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <button
              className="w-full px-4 py-3.5 flex items-center justify-between"
              onClick={() => setShowCategoryChart(!showCategoryChart)}
            >
              <span className="text-sm font-semibold text-gray-700">📊 Gastos por categoría</span>
              <span className="text-gray-400 text-lg">{showCategoryChart ? '▲' : '▼'}</span>
            </button>

            {showCategoryChart && (
              <div className="px-4 pb-4">
                {totalUYU > 0 && (
                  <div className="space-y-3">
                    {categoryData.filter(d => d.uyu > 0).map(d => (
                      <div key={`uyu-${d.cat}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-base">{d.emoji}</span>
                            <span className="text-xs font-medium text-gray-600">{d.label}</span>
                          </div>
                          <span className="text-xs font-bold" style={{ color: '#667eea' }}>
                            {formatMoney(d.uyu, 'UYU')}
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className="h-2 rounded-full transition-all"
                            style={{
                              width: `${(d.uyu / maxUYU) * 100}%`,
                              background: 'linear-gradient(135deg, #667eea, #764ba2)'
                            }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {totalUSD > 0 && (
                  <>
                    {totalUYU > 0 && <div className="my-4 border-t border-gray-100" />}
                    <p className="text-xs text-gray-400 font-medium mb-3">En dólares</p>
                    <div className="space-y-3">
                      {categoryData.filter(d => d.usd > 0).map(d => (
                        <div key={`usd-${d.cat}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-base">{d.emoji}</span>
                              <span className="text-xs font-medium text-gray-600">{d.label}</span>
                            </div>
                            <span className="text-xs font-bold" style={{ color: '#764ba2' }}>
                              {formatMoney(d.usd, 'USD')}
                            </span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div className="h-2 rounded-full transition-all"
                              style={{
                                width: `${(d.usd / maxUSD) * 100}%`,
                                background: 'linear-gradient(135deg, #764ba2, #a855f7)'
                              }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Historial mensual */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <button
            className="w-full px-4 py-3.5 flex items-center justify-between"
            onClick={() => setShowHistory(!showHistory)}
          >
            <span className="text-sm font-semibold text-gray-700">📅 Historial por mes</span>
            <span className="text-gray-400 text-lg">{showHistory ? '▲' : '▼'}</span>
          </button>

          {showHistory && (
            <div className="px-4 pb-4">
              {monthlyHistory.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">Sin datos</p>
              ) : (() => {
                const maxUYUh = Math.max(...monthlyHistory.map(m => m.uyu), 1)
                const totalAllTimeUYU = monthlyHistory.reduce((s, m) => s + m.uyu, 0)
                const totalAllTimeUSD = monthlyHistory.reduce((s, m) => s + m.usd, 0)
                return (
                  <>
                    {/* Totales acumulados */}
                    <div className="flex gap-3 mb-4">
                      {totalAllTimeUYU > 0 && (
                        <div className="flex-1 rounded-xl px-3 py-2.5" style={{ background: '#f0f2ff' }}>
                          <p className="text-xs text-gray-400 mb-0.5">Acumulado pesos</p>
                          <p className="text-sm font-bold" style={{ color: '#667eea' }}>
                            $ {totalAllTimeUYU.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </p>
                        </div>
                      )}
                      {totalAllTimeUSD > 0 && (
                        <div className="flex-1 rounded-xl px-3 py-2.5" style={{ background: '#f5f3ff' }}>
                          <p className="text-xs text-gray-400 mb-0.5">Acumulado dólares</p>
                          <p className="text-sm font-bold" style={{ color: '#764ba2' }}>
                            USD {totalAllTimeUSD.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Barras por mes */}
                    <div className="space-y-2.5">
                      {[...monthlyHistory].reverse().map(m => {
                        const isSelected = m.month === selectedMonth
                        return (
                          <button
                            key={m.month}
                            className="w-full text-left"
                            onClick={() => setSelectedMonth(m.month)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-xs font-medium ${isSelected ? 'text-indigo-600' : 'text-gray-500'}`}>
                                {monthLabel(m.month)} {isSelected && '◀'}
                              </span>
                              <span className={`text-xs font-bold ${isSelected ? 'text-indigo-600' : 'text-gray-700'}`}>
                                $ {m.uyu.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                {m.usd > 0 && <span className="text-purple-500 ml-1">· USD {m.usd.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>}
                              </span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full transition-all"
                                style={{
                                  width: `${(m.uyu / maxUYUh) * 100}%`,
                                  background: isSelected
                                    ? 'linear-gradient(135deg, #667eea, #764ba2)'
                                    : '#c7d2fe',
                                }}
                              />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </div>

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
            expenses.map(expense => {
              const catInfo = getCategoryInfo(expense.category)
              return (
                <div key={expense.id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: expense.currency === 'USD' ? '#f3e8ff' : '#e8edff' }}>
                    <span className="text-lg">{catInfo ? catInfo.emoji : (expense.currency === 'USD' ? '💵' : '💰')}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 truncate">{expense.description}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <p className="text-xs text-gray-400">
                        {expense.expense_date ? formatDate(expense.expense_date) : ''}
                      </p>
                      {expense.bank && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: '#f0f2ff', color: '#667eea' }}>
                          {expense.bank}
                        </span>
                      )}
                      {catInfo && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: '#f5f3ff', color: '#7c3aed' }}>
                          {catInfo.label}
                        </span>
                      )}
                      {expense.is_owed && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: '#fff7ed', color: '#c2410c' }}>
                          💸 Debes a Fer
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
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100">✏️</button>
                      <button onClick={() => setDeleteConfirm(expense.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50">🗑️</button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Floating Add Button */}
      <button
        onClick={openAddModal}
        className="fixed bottom-6 right-6 w-16 h-16 rounded-full shadow-xl flex items-center justify-center text-white text-3xl active:scale-90"
        style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
      >+</button>

      {/* Add / Edit Expense Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-800">
                {modalMode === 'add' ? 'Agregar gasto' : 'Editar gasto'}
              </h2>
              <button onClick={closeModal}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Descripción */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Descripción</label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  required
                  placeholder="Ej: Supermercado, Nafta..."
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 placeholder-gray-400"
                />
              </div>

              {/* Categoría */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2">Categoría</label>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  <button
                    type="button"
                    onClick={() => setFormCategory('')}
                    className="flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl border-2 transition-all"
                    style={!formCategory
                      ? { borderColor: '#667eea', background: '#e8edff' }
                      : { borderColor: '#e5e7eb', background: 'white' }}>
                    <span className="text-lg">—</span>
                    <span className="text-xs font-medium" style={{ color: !formCategory ? '#667eea' : '#9ca3af' }}>Ninguna</span>
                  </button>
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setFormCategory(cat.value)}
                      className="flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl border-2 transition-all"
                      style={formCategory === cat.value
                        ? { borderColor: '#667eea', background: '#e8edff' }
                        : { borderColor: '#e5e7eb', background: 'white' }}>
                      <span className="text-lg">{cat.emoji}</span>
                      <span className="text-xs font-medium" style={{ color: formCategory === cat.value ? '#667eea' : '#9ca3af' }}>
                        {cat.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Fecha */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Fecha de compra</label>
                <div className="relative">
                  <div className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-800 flex items-center justify-between pointer-events-none">
                    <span>{formatDateFull(formDate)}</span>
                    <span className="text-gray-400 text-base">📅</span>
                  </div>
                  <input
                    type="date"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    required
                    min={dateMin}
                    max={dateMax}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
              </div>

              {/* Moneda */}
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

              {/* Tarjeta */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Tarjeta utilizada</label>
                <select
                  value={formBank}
                  onChange={e => { setFormBank(e.target.value); setFormInstallments(1) }}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 bg-white"
                >
                  <option value="">Otros</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                {formBank && CARD_CLOSING_DAYS[formBank] && (
                  <p className="text-xs text-gray-400 mt-1.5 ml-1">
                    Cierre: día {CARD_CLOSING_DAYS[formBank]} de cada mes
                  </p>
                )}
              </div>

              {/* Aviso mes de cobro */}
              {billingDiffersFromDate && (
                <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: '#fff7e6', border: '1px solid #fde68a', color: '#92400e' }}>
                  <span className="mt-0.5">⚠️</span>
                  <span>Por el cierre de <strong>{formBank}</strong>, este gasto se asignará a <strong>{monthLabel(billingMonth)}</strong></span>
                </div>
              )}

              {/* Cuotas */}
              {formBank && modalMode === 'add' && (
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">Cuotas</label>
                  <div className="flex gap-2 flex-wrap">
                    {[1, 2, 3, 6, 12].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setFormInstallments(n)}
                        className="px-4 py-2 rounded-xl border-2 font-semibold text-sm transition-all"
                        style={formInstallments === n
                          ? { borderColor: '#667eea', background: '#e8edff', color: '#667eea' }
                          : { borderColor: '#e5e7eb', background: 'white', color: '#9ca3af' }}
                      >
                        {n === 1 ? 'Sin cuotas' : `${n}x`}
                      </button>
                    ))}
                  </div>
                  {formInstallments > 1 && formAmount && !isNaN(parseFloat(formAmount)) && (
                    <p className="text-xs text-gray-500 mt-2 ml-1">
                      Se crearán {formInstallments} cuotas de {formatMoney(Math.round(parseFloat(formAmount) / formInstallments * 100) / 100, formCurrency)} desde <strong>{monthLabel(billingMonth)}</strong>
                    </p>
                  )}
                </div>
              )}

              {/* Monto */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">
                  {formInstallments > 1 ? `Monto total (${formCurrency === 'UYU' ? '$' : 'USD'})` : `Monto (${formCurrency === 'UYU' ? '$' : 'USD'})`}
                </label>
                <input
                  type="number"
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  required
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 placeholder-gray-400 text-lg font-semibold"
                />
              </div>

              {/* Debes a Fer */}
              <button
                type="button"
                onClick={() => setFormIsOwed(prev => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all"
                style={formIsOwed
                  ? { borderColor: '#f97316', background: '#fff7ed' }
                  : { borderColor: '#e5e7eb', background: 'white' }}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">💸</span>
                  <span className="text-sm font-medium" style={{ color: formIsOwed ? '#c2410c' : '#6b7280' }}>
                    Debes a Fer
                  </span>
                </div>
                <div className="w-10 h-6 rounded-full transition-all relative"
                  style={{ background: formIsOwed ? '#f97316' : '#e5e7eb' }}>
                  <div className="w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm"
                    style={{ left: formIsOwed ? '22px' : '2px' }} />
                </div>
              </button>

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
                  {formError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="flex-1 py-3 rounded-xl font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={formLoading}
                  className="flex-1 py-3 rounded-xl font-semibold text-white active:scale-95 disabled:opacity-70"
                  style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                  {formLoading
                    ? <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Guardando...
                      </span>
                    : modalMode === 'add'
                      ? (formInstallments > 1 ? `Agregar ${formInstallments} cuotas` : 'Agregar')
                      : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Income Modal */}
      {showIncomeModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowIncomeModal(false) }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-800">Agregar ingreso</h2>
              <button onClick={() => setShowIncomeModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">✕</button>
            </div>

            <form onSubmit={handleAddIncome} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Descripción</label>
                <input
                  type="text"
                  value={incomeDesc}
                  onChange={e => setIncomeDesc(e.target.value)}
                  required
                  placeholder="Ej: Sueldo, Freelance..."
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 placeholder-gray-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Moneda</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setIncomeCurrency('UYU')}
                    className="py-3 px-4 rounded-xl border-2 font-semibold text-sm transition-all"
                    style={incomeCurrency === 'UYU'
                      ? { borderColor: '#667eea', background: '#e8edff', color: '#667eea' }
                      : { borderColor: '#e5e7eb', background: 'white', color: '#9ca3af' }}>
                    💰 Pesos
                  </button>
                  <button type="button" onClick={() => setIncomeCurrency('USD')}
                    className="py-3 px-4 rounded-xl border-2 font-semibold text-sm transition-all"
                    style={incomeCurrency === 'USD'
                      ? { borderColor: '#764ba2', background: '#f3e8ff', color: '#764ba2' }
                      : { borderColor: '#e5e7eb', background: 'white', color: '#9ca3af' }}>
                    💵 Dólares
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">
                  Monto ({incomeCurrency === 'UYU' ? '$' : 'USD'})
                </label>
                <input
                  type="number"
                  value={incomeAmount}
                  onChange={e => setIncomeAmount(e.target.value)}
                  required
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 placeholder-gray-400 text-lg font-semibold"
                />
              </div>

              {incomeError && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
                  {incomeError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowIncomeModal(false)}
                  className="flex-1 py-3 rounded-xl font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={incomeFormLoading}
                  className="flex-1 py-3 rounded-xl font-semibold text-white active:scale-95 disabled:opacity-70"
                  style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}>
                  {incomeFormLoading
                    ? <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Guardando...
                      </span>
                    : 'Agregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Expense Confirm */}
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

      {/* Delete Income Confirm */}
      {deleteIncomeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setDeleteIncomeConfirm(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xs p-6 text-center"
            onClick={e => e.stopPropagation()}>
            <div className="text-4xl mb-3">🗑️</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">¿Eliminar ingreso?</h3>
            <p className="text-gray-500 text-sm mb-5">Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteIncomeConfirm(null)}
                className="flex-1 py-3 rounded-xl font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => handleDeleteIncome(deleteIncomeConfirm)}
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

            <div className="flex rounded-xl overflow-hidden border border-gray-200 mb-5">
              <button onClick={() => setShareTab('mycode')}
                className="flex-1 py-2.5 text-xs font-semibold"
                style={shareTab === 'mycode'
                  ? { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }
                  : { background: 'white', color: '#6b7280' }}>
                Mi código
              </button>
              <button onClick={() => setShareTab('join')}
                className="flex-1 py-2.5 text-xs font-semibold"
                style={shareTab === 'join'
                  ? { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }
                  : { background: 'white', color: '#6b7280' }}>
                Unirme
              </button>
              <button onClick={() => setShareTab('telegram')}
                className="flex-1 py-2.5 text-xs font-semibold"
                style={shareTab === 'telegram'
                  ? { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }
                  : { background: 'white', color: '#6b7280' }}>
                ✈️ Telegram
              </button>
              <button onClick={() => setShareTab('whatsapp')}
                className="flex-1 py-2.5 text-xs font-semibold"
                style={shareTab === 'whatsapp'
                  ? { background: 'linear-gradient(135deg, #25d366 0%, #128c7e 100%)', color: 'white' }
                  : { background: 'white', color: '#6b7280' }}>
                💬 WhatsApp
              </button>
            </div>

            {shareTab === 'mycode' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Compartí este código para que otra persona pueda ver y agregar tus gastos.
                </p>
                {myInviteCode ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-50 rounded-xl px-4 py-3 font-mono text-xl font-bold text-center tracking-widest"
                        style={{ color: '#667eea' }}>
                        {myInviteCode}
                      </div>
                      <button onClick={handleCopyCode}
                        className="px-4 py-3 rounded-xl font-semibold text-sm"
                        style={{ background: codeCopied ? '#e8edff' : '#f3f4f6', color: codeCopied ? '#667eea' : '#374151' }}>
                        {codeCopied ? '✓' : 'Copiar'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 text-center">
                      Quien use este código podrá ver y agregar gastos en tu cuenta.
                    </p>
                  </>
                ) : (
                  <button onClick={handleGenerateCode}
                    className="w-full py-3 rounded-xl font-semibold text-white"
                    style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                    Generar código
                  </button>
                )}
              </div>
            )}

            {shareTab === 'join' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Ingresá el código de la persona para ver sus gastos.
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
                  <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">{joinError}</div>
                )}
                {joinSuccess && (
                  <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl">{joinSuccess}</div>
                )}
                <button onClick={handleJoin} disabled={joinLoading || !joinCode.trim()}
                  className="w-full py-3 rounded-xl font-semibold text-white disabled:opacity-50"
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

            {shareTab === 'telegram' && (
              <div className="space-y-4">
                <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
                  <p className="font-semibold mb-1.5">Cómo vincular tu cuenta:</p>
                  <p>1. Abrí Telegram y buscá tu bot</p>
                  <p>2. Mandále <span className="font-mono font-bold">/start</span></p>
                  <p>3. El bot te responde con tu ID — pegalo abajo</p>
                </div>
                <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>
                  <p className="font-semibold">Formato para agregar gastos:</p>
                  <p className="font-mono">Compra helado por 150 con itau</p>
                  <p className="font-mono">Pizza por 350</p>
                  <p className="font-mono">Uber por 80 con brou</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">Tu ID de Telegram</label>
                  <input
                    type="text"
                    value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value)}
                    placeholder="Ej: 987654321"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 placeholder-gray-400 font-mono text-lg tracking-wider"
                  />
                </div>
                {phoneSaved && (
                  <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl">
                    ✓ ID guardado correctamente
                  </div>
                )}
                <button onClick={handleSavePhone} disabled={phoneLoading || !phoneInput.trim()}
                  className="w-full py-3 rounded-xl font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                  {phoneLoading
                    ? <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Guardando...
                      </span>
                    : 'Guardar ID'}
                </button>
              </div>
            )}

            {shareTab === 'whatsapp' && (
              <div className="space-y-4">
                <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>
                  <p className="font-semibold mb-1.5">Cómo vincular tu cuenta:</p>
                  <p>1. Activá el sandbox enviando el mensaje de Twilio a su número de WhatsApp</p>
                  <p>2. Ingresá tu número abajo con código de país (ej: +59812345678)</p>
                  <p>3. ¡Listo! Ya podés mandar gastos por WhatsApp</p>
                </div>
                <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
                  <p className="font-semibold">Comandos disponibles:</p>
                  <p className="font-mono">"pizza 350 itau"</p>
                  <p className="font-mono">"cuánto gasté en abril"</p>
                  <p className="font-mono">Respondé <strong>editar</strong> o <strong>borrar</strong> al último gasto</p>
                </div>
                {myWhatsapp && (
                  <div className="rounded-xl px-4 py-2.5 text-sm flex items-center gap-2" style={{ background: '#f0fdf4', color: '#166534' }}>
                    <span>✓</span> Vinculado: <span className="font-mono font-semibold">{myWhatsapp}</span>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">Tu número de WhatsApp</label>
                  <input
                    type="tel"
                    value={whatsappInput}
                    onChange={e => setWhatsappInput(e.target.value)}
                    placeholder="Ej: +59812345678"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 placeholder-gray-400 font-mono text-lg tracking-wider"
                  />
                </div>
                {whatsappSaved && (
                  <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl">
                    ✓ Número guardado correctamente
                  </div>
                )}
                <button onClick={handleSaveWhatsapp} disabled={whatsappLoading || !whatsappInput.trim()}
                  className="w-full py-3 rounded-xl font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #25d366 0%, #128c7e 100%)' }}>
                  {whatsappLoading
                    ? <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Guardando...
                      </span>
                    : 'Guardar número'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <ChatWidget onExpenseSaved={loadExpenses} hidden={!!modalMode} />
    </div>
  )
}
