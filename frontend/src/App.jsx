import { useEffect, useState } from 'react'
import './App.css'

const API_BASE = 'https://instance-20240820-0114.tail3c8a81.ts.net'

function getErrorMessage(error, fallback) {
  if (error instanceof TypeError) {
    return 'No se pudo conectar con el servidor. Verifica la conexión e inténtalo nuevamente.'
  }

  if (error?.message?.startsWith('API error:')) {
    const status = error.message.replace('API error: ', '')

    if (status === '401' || status === '403') {
      return 'No tienes autorización para realizar esta operación.'
    }

    if (status === '404') {
      return 'El recurso solicitado no fue encontrado.'
    }

    if (status === '429') {
      return 'Demasiadas solicitudes. Espera unos segundos e inténtalo nuevamente.'
    }

    if (status.startsWith('5')) {
      return 'El servidor tuvo un problema. Inténtalo nuevamente en unos momentos.'
    }
  }

  return error?.message || fallback
}

function App() {
  const [accounts, setAccounts] = useState([])
  const [syncStatuses, setSyncStatuses] = useState({})
  const [accountId, setAccountId] = useState('')
  const [includeInactiveAccounts, setIncludeInactiveAccounts] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [payouts, setPayouts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [retryingDashboard, setRetryingDashboard] = useState(false)
  const [retryingSync, setRetryingSync] = useState(false)
  const [retryingAccounts, setRetryingAccounts] = useState(false)
  const [syncingAccountId, setSyncingAccountId] = useState(null)
  const [initializing, setInitializing] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('dashboard')
  const [editingAccountId, setEditingAccountId] = useState(null)
  const [accountName, setAccountName] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)
  const [showNewAccountForm, setShowNewAccountForm] = useState(false)
  const [newAccountName, setNewAccountName] = useState('')
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [dashboardTotals, setDashboardTotals] = useState({
    accounts: 0,
    authorizedAccounts: 0,
    payouts: 0,
    latestPayouts: [],
  })

  async function loadAccounts() {
    const response = await fetch(`${API_BASE}/api/ebay/accounts`)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.detail || `API error: ${response.status}`)
    }

    const data = await response.json()
    const nextAccounts = data.accounts || []

    setAccounts(nextAccounts)

    if (!accountId && nextAccounts.length > 0) {
      setAccountId(String(nextAccounts[0].id))
    }

    return nextAccounts
  }

  async function loadDashboardTotals(accountList) {
    const activeAccounts = (accountList || []).filter(
      (account) => account.status === 'active',
    )

    if (activeAccounts.length === 0) {
      setDashboardTotals({
        accounts: 0,
        authorizedAccounts: 0,
        payouts: 0,
        latestPayouts: [],
      })
      return
    }

    const results = await Promise.all(
      activeAccounts.map(async (account) => {
        const params = new URLSearchParams({
          limit: '1',
          offset: '0',
        })

        const response = await fetch(
          `${API_BASE}/api/ebay/accounts/${account.id}/payouts?${params}`,
        )

        if (!response.ok) {
          const data = await response.json().catch(() => null)
          throw new Error(data?.detail || `API error: ${response.status}`)
        }

        const data = await response.json()

        return {
          account,
          data,
        }
      }),
    )

    const payouts = results.reduce(
      (sum, result) => sum + (result.data.total || 0),
      0,
    )

    const latestPayouts = results
      .map((result) => ({
        account: result.account,
        payout: result.data.payouts?.[0] || null,
      }))
      .filter((item) => item.payout !== null)

    const authorizedAccounts = activeAccounts.filter(
      (account) => account.authorized,
    ).length

    setDashboardTotals({
      accounts: activeAccounts.length,
      authorizedAccounts,
      payouts,
      latestPayouts,
    })
  }

  async function loadSyncStatuses(accountList) {
    if (!accountList || accountList.length === 0) {
      setSyncStatuses({})
      return
    }

    const results = await Promise.all(
      accountList.map(async (account) => {
        const response = await fetch(
          `${API_BASE}/api/ebay/accounts/${account.id}/sync/status`,
        )

        if (!response.ok) {
          const data = await response.json().catch(() => null)
          throw new Error(data?.detail || `API error: ${response.status}`)
        }

        return response.json()
      }),
    )

    const nextStatuses = {}

    results.forEach((status) => {
      nextStatuses[status.account_id] = status
    })

    setSyncStatuses(nextStatuses)
  }

  async function handleDashboardRetry() {
    try {
      setRetryingDashboard(true)
      setError('')

      const currentAccounts = await loadAccounts()
      await loadDashboardTotals(currentAccounts)
      await loadSyncStatuses(currentAccounts)
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo actualizar el Dashboard'))
    } finally {
      setRetryingDashboard(false)
    }
  }

  async function handleSyncRetry() {
    try {
      setRetryingSync(true)
      setError('')

      const currentAccounts = await loadAccounts()
      await loadSyncStatuses(currentAccounts)
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo actualizar el estado de sincronización'))
    } finally {
      setRetryingSync(false)
    }
  }

  async function handleSyncAccount(accountIdToSync) {
    try {
      setSyncingAccountId(accountIdToSync)
      setError('')

      const response = await fetch(
        `${API_BASE}/api/ebay/accounts/${accountIdToSync}/sync/payouts`,
        {
          method: 'POST',
        },
      )

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.detail || `API error: ${response.status}`)
      }

      const currentAccounts = accounts
      await loadSyncStatuses(currentAccounts)
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo sincronizar la cuenta'))
    } finally {
      setSyncingAccountId(null)
    }
  }

  async function handleAccountsRetry() {
    try {
      setRetryingAccounts(true)
      setError('')

      await loadAccounts()
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudieron cargar las cuentas'))
    } finally {
      setRetryingAccounts(false)
    }
  }

  async function loadPayouts(selectedAccountId = accountId) {
    if (!selectedAccountId) return

    try {
      setError('')

      const accountIds =
        selectedAccountId === 'all'
          ? accounts.map((account) => account.id)
          : [selectedAccountId]

      if (accountIds.length === 0) {
        setPayouts([])
        setTotal(0)
        return
      }

      const results = await Promise.all(
        accountIds.map(async (id) => {
          const params = new URLSearchParams({
            limit: '100',
            offset: '0',
          })

          if (dateFrom) {
            params.set('date_from', `${dateFrom}T00:00:00Z`)
          }

          if (dateTo) {
            params.set('date_to', `${dateTo}T23:59:59Z`)
          }

          const response = await fetch(
            `${API_BASE}/api/ebay/accounts/${id}/payouts?${params}`,
          )

          if (!response.ok) {
            const data = await response.json().catch(() => null)
            throw new Error(data?.detail || `API error: ${response.status}`)
          }

          return response.json()
        }),
      )

      const combinedPayouts = results
        .flatMap((data, index) =>
          (data.payouts || []).map((payout) => ({
            ...payout,
            ebay_account_name:
              accounts.find(
                (account) => String(account.id) === String(accountIds[index]),
              )?.name || `Cuenta ${accountIds[index]}`,
            ebay_account_id: accountIds[index],
          })),
        )
        .sort(
          (a, b) =>
            new Date(b.payout_date || 0) - new Date(a.payout_date || 0),
        )

      const combinedTotal = results.reduce(
        (sum, data) => sum + (data.total || 0),
        0,
      )

      setPayouts(combinedPayouts)
      setTotal(combinedTotal)
    } catch (err) {
      setError(
        getErrorMessage(err, 'No se pudieron cargar los payouts'),
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    async function initialize() {
      try {
        setError('')

        const params = new URLSearchParams(window.location.search)
        const oauthStatus = params.get('oauth')
        const oauthAccountId = params.get('account_id')

        if (oauthStatus === 'success' && oauthAccountId) {
          window.history.replaceState({}, '', window.location.pathname)
        }

        const nextAccounts = await loadAccounts()
        await loadDashboardTotals(nextAccounts)
        await loadSyncStatuses(nextAccounts)

        if (nextAccounts.length > 0) {
          const selectedAccountId =
            oauthStatus === 'success' && oauthAccountId
              ? oauthAccountId
              : String(nextAccounts[0].id)

          setAccountId(selectedAccountId)
          await loadPayouts(selectedAccountId)
        } else {
          setLoading(false)
        }
      } catch (err) {
        setError(getErrorMessage(err, 'No se pudieron cargar las cuentas'))
        setLoading(false)
      } finally {
        setInitializing(false)
      }
    }

    initialize()
  }, [])

  function handleFilter(event) {
    event.preventDefault()
    setLoading(true)
    loadPayouts()
  }

  function handleRefresh() {
    setRefreshing(true)
    loadPayouts()
  }

  async function createAccount() {
    const trimmedName = newAccountName.trim()

    if (!trimmedName) {
      setError('El nombre de la cuenta no puede estar vacío')
      return
    }

    try {
      setCreatingAccount(true)
      setError('')

      const response = await fetch(`${API_BASE}/api/ebay/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.detail || `API error: ${response.status}`)
      }

      const newAccount = await response.json()

      setAccounts((currentAccounts) => [...currentAccounts, newAccount])
      setNewAccountName('')
      setShowNewAccountForm(false)
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo crear la cuenta'))
    } finally {
      setCreatingAccount(false)
    }
  }

  function startEditingAccount(account) {
    setEditingAccountId(account.id)
    setAccountName(account.name)
    setError('')
  }

  function cancelEditingAccount() {
    setEditingAccountId(null)
    setAccountName('')
  }

  async function saveAccountName(accountIdToUpdate) {
    const trimmedName = accountName.trim()

    if (!trimmedName) {
      setError('El nombre de la cuenta no puede estar vacío')
      return
    }

    try {
      setSavingAccount(true)
      setError('')

      const response = await fetch(
        `${API_BASE}/api/ebay/accounts/${accountIdToUpdate}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: trimmedName,
          }),
        },
      )

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.detail || `API error: ${response.status}`)
      }

      const updatedAccount = await response.json()

      setAccounts((currentAccounts) =>
        currentAccounts.map((account) =>
          account.id === updatedAccount.id
            ? { ...account, ...updatedAccount }
            : account,
        ),
      )

      setEditingAccountId(null)
      setAccountName('')
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo actualizar el nombre de la cuenta'))
    } finally {
      setSavingAccount(false)
    }
  }

  async function toggleAccountStatus(account) {
    const nextStatus = account.status === 'active' ? 'inactive' : 'active'
    const action = nextStatus === 'active' ? 'reactivar' : 'desactivar'

    if (!window.confirm(`¿Seguro que deseas ${action} la cuenta "${account.name}"?`)) {
      return
    }

    try {
      setError('')

      const response = await fetch(
        `${API_BASE}/api/ebay/accounts/${account.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: nextStatus,
          }),
        },
      )

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.detail || `API error: ${response.status}`)
      }

      const updatedAccount = await response.json()

      setAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) =>
          currentAccount.id === updatedAccount.id
            ? { ...currentAccount, ...updatedAccount }
            : currentAccount,
        ),
      )
    } catch (err) {
      setError(getErrorMessage(err, `No se pudo ${action} la cuenta`))
    }
  }

  function getSyncError(sync) {
    if (!sync) return null

    return sync.last_error || sync.last_run?.error_message || null
  }

  function formatSyncDuration(startedAt, finishedAt) {
    if (!startedAt || !finishedAt) return '—'

    const seconds = Math.max(
      0,
      Math.round(
        (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) /
          1000,
      ),
    )

    if (seconds < 60) {
      return `${seconds}s`
    }

    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60

    return `${minutes}m ${remainingSeconds}s`
  }

  function formatSyncStatus(status) {
    const labels = {
      success: 'Correcto',
      syncing: 'Sincronizando',
      failed: 'Error',
      never_synced: 'Nunca sincronizado',
    }

    return labels[status] || status || 'Desconocido'
  }

  function formatDate(value) {
    if (!value) return '—'

    return new Date(value).toLocaleString()
  }

  function formatInstrument(instrument) {
    if (!instrument) return '—'

    const nickname = instrument.nickname || '—'
    const lastFour = instrument.accountLastFourDigits || '—'

    return `${nickname} •••• ${lastFour}`
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>eBay Reconciliation</h1>
          <p>
            {view === 'dashboard'
              ? 'Dashboard'
              : view === 'payouts'
                ? 'Payouts'
                : view === 'sync'
                  ? 'Sincronización'
                  : 'Cuentas'}
          </p>
        </div>

      </header>

      <nav className="navigation">
        <button
          type="button"
          className={view === 'dashboard' ? 'nav-button active' : 'nav-button'}
          onClick={() => setView('dashboard')}
        >
          <span className="nav-icon">⌂</span>
          <span>Dashboard</span>
        </button>

        <button
          type="button"
          className={view === 'payouts' ? 'nav-button active' : 'nav-button'}
          onClick={() => setView('payouts')}
        >
          <span className="nav-icon">↗</span>
          <span>Payouts</span>
        </button>

        <button
          type="button"
          className={view === 'sync' ? 'nav-button active' : 'nav-button'}
          onClick={() => setView('sync')}
        >
          <span className="nav-icon">↻</span>
          <span>Sincronización</span>
        </button>

        <button
          type="button"
          className={view === 'accounts' ? 'nav-button active' : 'nav-button'}
          onClick={() => setView('accounts')}
        >
          <span className="nav-icon">◉</span>
          <span>Cuentas</span>
        </button>
      </nav>

      {initializing ? (
        <section className="loading-state">
          <div className="loading-spinner" aria-hidden="true" />
          <p>Cargando aplicación...</p>
        </section>
      ) : (
        <>
          {view === 'dashboard' && (
        <section className="dashboard-section">
          <div className="section-header">
            <div>
              <h2>Dashboard</h2>
              <p>Resumen general de tu operación eBay.</p>
            </div>
          </div>

          {error && (
            <div className="error">
              <strong>Error:</strong> {error}
              <button
                type="button"
                className="retry-button"
                onClick={handleDashboardRetry}
                disabled={retryingDashboard}
              >
                {retryingDashboard ? 'Reintentando...' : 'Reintentar'}
              </button>
            </div>
          )}

          <div className="dashboard-stats">
            <article className="dashboard-stat-card">
              <span>Cuentas eBay</span>
              <strong>{dashboardTotals.accounts}</strong>
              <small>cuentas configuradas</small>
            </article>

            <article className="dashboard-stat-card">
              <span>Cuentas conectadas</span>
              <strong>{dashboardTotals.authorizedAccounts}</strong>
              <small>con autorización activa</small>
            </article>

            <article className="dashboard-stat-card">
              <span>Total payouts</span>
              <strong>{dashboardTotals.payouts}</strong>
              <small>registrados en el sistema</small>
            </article>
          </div>

          <div className="dashboard-grid">
            <article className="dashboard-panel">
              <div className="dashboard-panel-header">
                <div>
                  <h3>Estado de sincronización</h3>
                  <p>Último estado conocido por cuenta.</p>
                </div>
              </div>

              <div className="dashboard-account-list">
                {accounts.map((account) => {
                  const sync = syncStatuses[account.id]

                  return (
                    <div className="dashboard-account-row" key={account.id}>
                      <div>
                        <strong>{account.name}</strong>
                        <span>
                          {account.ebay_username || 'Sin usuario eBay'}
                        </span>
                      </div>

                      <span
                        className={`status status-${sync?.status || 'unknown'}`}
                      >
                        {formatSyncStatus(sync?.status)}
                      </span>
                    </div>
                  )
                })}

                {accounts.length === 0 && (
                  <p className="dashboard-empty">
                    No hay cuentas configuradas.
                  </p>
                )}
              </div>
            </article>

            <article className="dashboard-panel">
              <div className="dashboard-panel-header">
                <div>
                  <h3>Últimos payouts</h3>
                  <p>Último payout registrado por cuenta.</p>
                </div>
              </div>

              <div className="dashboard-payout-list">
                {dashboardTotals.latestPayouts.map((item) => (
                  <div className="dashboard-payout-row" key={item.account.id}>
                    <div>
                      <strong>{item.account.name}</strong>
                      <span>
                        {item.payout.payout_date
                          ? formatDate(item.payout.payout_date)
                          : 'Sin fecha'}
                      </span>
                    </div>

                    <div className="dashboard-payout-amount">
                      <strong>
                        {item.payout.amount} {item.payout.currency}
                      </strong>
                      <span>{item.payout.status}</span>
                    </div>
                  </div>
                ))}

                {dashboardTotals.latestPayouts.length === 0 && (
                  <p className="dashboard-empty">
                    No hay payouts registrados.
                  </p>
                )}
              </div>
            </article>

            <article className="dashboard-panel dashboard-actions-panel">
              <div className="dashboard-panel-header">
                <div>
                  <h3>Accesos rápidos</h3>
                  <p>Administra tu operación desde aquí.</p>
                </div>
              </div>

              <div className="dashboard-actions">
                <button
                  type="button"
                  onClick={() => setView('payouts')}
                >
                  <strong>Payouts</strong>
                  <span>Consultar movimientos y pagos</span>
                </button>

                <button
                  type="button"
                  onClick={() => setView('sync')}
                >
                  <strong>Sincronización</strong>
                  <span>Revisar el estado de las cuentas</span>
                </button>

                <button
                  type="button"
                  onClick={() => setView('accounts')}
                >
                  <strong>Cuentas</strong>
                  <span>Administrar cuentas eBay</span>
                </button>
              </div>
            </article>
          </div>
        </section>
      )}

      {view === 'payouts' && (
        <>
          <section className="filters">
            <form onSubmit={handleFilter}>
              <div className="filter-group">
                <label htmlFor="account">Cuenta</label>

                <select
                  id="account"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  disabled={accounts.length === 0}
                >
                  {accounts.length === 0 && (
                    <option value="">Sin cuentas</option>
                  )}

                  {accounts.length > 0 && (
                    <option value="all">Todas las cuentas activas</option>
                  )}

                  {accounts
                    .filter(
                      (account) =>
                        includeInactiveAccounts || account.status === 'active',
                    )
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                        {account.status === 'inactive' ? ' (inactiva)' : ''}
                      </option>
                    ))}
                </select>

                <label className="inactive-filter">
                  <input
                    type="checkbox"
                    checked={includeInactiveAccounts}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setIncludeInactiveAccounts(checked)

                      if (!checked) {
                        const selectedAccount = accounts.find(
                          (account) => String(account.id) === String(accountId),
                        )

                        if (selectedAccount?.status === 'inactive') {
                          setAccountId('all')
                        }
                      }
                    }}
                  />
                  <span>Incluir cuentas inactivas</span>
                </label>
              </div>

              <div className="filter-group">
                <label htmlFor="date-from">Desde</label>
                <input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </div>

              <div className="filter-group">
                <label htmlFor="date-to">Hasta</label>
                <input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </div>

              <button
                className="filter-button"
                type="submit"
                disabled={!accountId}
              >
                Filtrar
              </button>
            </form>
          </section>

          <section className="summary">
            <div className="summary-card">
              <span>Total payouts</span>
              <strong>{total}</strong>
            </div>
          </section>

          {loading && <p className="message">Cargando payouts...</p>}

          {error && (
            <div className="error">
              <strong>Error:</strong> {error}
              <button
                type="button"
                className="retry-button"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {refreshing ? 'Reintentando...' : 'Reintentar'}
              </button>
            </div>
          )}

          {!loading && !error && (
            <section className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Payout ID</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th>Instrumento</th>
                  </tr>
                </thead>

                <tbody>
                  {payouts.length === 0 && (
                    <tr>
                      <td className="empty" colSpan="5">
                        No hay payouts para los filtros seleccionados.
                      </td>
                    </tr>
                  )}

                  {payouts.map((payout) => (
                    <tr
                      key={payout.id}
                    >
                      <td>{formatDate(payout.payout_date)}</td>
                      <td>{payout.ebay_payout_id}</td>
                      <td>
                        {payout.amount} {payout.currency}
                      </td>
                      <td>
                        <span
                          className={`status status-${payout.status.toLowerCase()}`}
                        >
                          {payout.status}
                        </span>
                      </td>
                      <td>{formatInstrument(payout.payout_instrument)}</td>                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}


      {view === 'sync' && (
        <section className="sync-section">
          <div className="section-header">
            <div>
              <h2>Dashboard de sincronización</h2>
              <p>Estado de sincronización por cuenta.</p>
            </div>
          </div>

          {error && (
            <div className="error">
              <strong>Error:</strong> {error}
              <button
                type="button"
                className="retry-button"
                onClick={handleSyncRetry}
                disabled={retryingSync}
              >
                {retryingSync ? 'Reintentando...' : 'Reintentar'}
              </button>
            </div>
          )}

          <div className="sync-grid">
            {accounts.map((account) => {
              const sync = syncStatuses[account.id]

              return (
                <article className="sync-card" key={account.id}>
                  <div className="sync-card-header">
                    <div>
                      <h3>{account.name}</h3>
                      <p>
                        {account.ebay_username || 'Sin usuario eBay'}
                      </p>
                    </div>

                    <span
                      className={`status status-${sync?.status || 'unknown'}`}
                    >
                      {formatSyncStatus(sync?.status)}
                    </span>
                  </div>

                  <div className="sync-card-details">
                    <div>
                      <span>Última sincronización</span>
                      <strong>
                        {formatDate(sync?.last_successful_sync_at)}
                      </strong>
                    </div>

                    <div>
                      <span>Último intento</span>
                      <strong>
                        {formatDate(sync?.last_attempt_at)}
                      </strong>
                    </div>

                    <div>
                      <span>Registros encontrados</span>
                      <strong>
                        {sync?.last_run?.records_found ?? '—'}
                      </strong>
                    </div>

                    <div>
                      <span>Registros creados</span>
                      <strong>
                        {sync?.last_run?.records_created ?? '—'}
                      </strong>
                    </div>

                    <div>
                      <span>Registros actualizados</span>
                      <strong>
                        {sync?.last_run?.records_updated ?? '—'}
                      </strong>
                    </div>

                    <div>
                      <span>Duración última ejecución</span>
                      <strong>
                        {formatSyncDuration(
                          sync?.last_run?.started_at,
                          sync?.last_run?.finished_at,
                        )}
                      </strong>
                    </div>
                  </div>

                  {getSyncError(sync) && (
                    <div className="sync-error">
                      <span>Error</span>
                      <strong>{getSyncError(sync)}</strong>
                    </div>
                  )}

                  <button
                    type="button"
                    className="sync-button"
                    onClick={() => handleSyncAccount(account.id)}
                    disabled={
                      account.status === 'inactive' ||
                      syncingAccountId !== null
                    }
                  >
                    {account.status === 'inactive'
                      ? 'Cuenta inactiva'
                      : syncingAccountId === account.id
                        ? 'Sincronizando...'
                        : 'Sincronizar ahora'}
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {view === 'accounts' && (
        <section className="accounts-section">
          {error && (
            <div className="error">
              <strong>Error:</strong> {error}
              <button
                type="button"
                className="retry-button"
                onClick={handleAccountsRetry}
                disabled={retryingAccounts}
              >
                {retryingAccounts ? 'Reintentando...' : 'Reintentar'}
              </button>
            </div>
          )}

          <div className="accounts-header">
            <div>
              <h2>Cuentas eBay</h2>
              <p>Administra las cuentas conectadas a tu sistema.</p>
            </div>

            {!showNewAccountForm && (
              <button
                type="button"
                className="add-account-button"
                onClick={() => {
                  setError('')
                  setShowNewAccountForm(true)
                }}
              >
                + Agregar cuenta
              </button>
            )}
          </div>

          {showNewAccountForm && (
            <div className="new-account-card">
              <label htmlFor="new-account-name">
                Nombre de la cuenta
              </label>

              <input
                id="new-account-name"
                className="account-name-input"
                type="text"
                value={newAccountName}
                maxLength="100"
                placeholder="Ej. Cuenta eBay Principal"
                onChange={(event) => setNewAccountName(event.target.value)}
                disabled={creatingAccount}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    createAccount()
                  }
                }}
              />

              <div className="account-actions">
                <button
                  type="button"
                  className="save-button"
                  onClick={createAccount}
                  disabled={creatingAccount}
                >
                  {creatingAccount ? 'Creando...' : 'Crear cuenta'}
                </button>

                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => {
                    setShowNewAccountForm(false)
                    setNewAccountName('')
                    setError('')
                  }}
                  disabled={creatingAccount}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="accounts-grid">
            {accounts.map((account) => (
              <article className="account-card" key={account.id}>
                {editingAccountId === account.id ? (
                  <>
                    <label htmlFor={`account-name-${account.id}`}>
                      Nombre de la cuenta
                    </label>

                    <input
                      id={`account-name-${account.id}`}
                      className="account-name-input"
                      type="text"
                      value={accountName}
                      maxLength="100"
                      onChange={(event) => setAccountName(event.target.value)}
                      disabled={savingAccount}
                      autoFocus
                    />

                    <div className="account-actions">
                      <button
                        type="button"
                        className="save-button"
                        onClick={() => saveAccountName(account.id)}
                        disabled={savingAccount}
                      >
                        {savingAccount ? 'Guardando...' : 'Guardar'}
                      </button>

                      <button
                        type="button"
                        className="cancel-button"
                        onClick={cancelEditingAccount}
                        disabled={savingAccount}
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="account-card-header">
                      <div>
                        <span className="account-label">Cuenta</span>
                        <h2>{account.name}</h2>
                      </div>

                      <span className="account-status">
                        {account.status}
                      </span>
                    </div>

                    <div className="account-details">
                      <span>eBay username</span>
                      <strong>{account.ebay_username || 'No configurado'}</strong>
                    </div>

                    <div className="account-details">
                      <span>OAuth</span>
                      <strong>
                        {account.oauth_status === 'refresh_failed'
                          ? '⚠ Requiere autorización'
                          : '✓ Autorizado'}
                      </strong>
                    </div>

                    <div className="account-card-actions">
                      {account.status === 'inactive' ? (
                        <button
                          type="button"
                          className="inactive-button"
                          disabled
                        >
                          Cuenta inactiva
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={
                            account.oauth_status === 'refresh_failed'
                              ? 'connect-button'
                              : account.authorized
                                ? 'connected-button'
                                : 'connect-button'
                          }
                          onClick={() => {
                            window.location.href = `${API_BASE}/api/ebay/auth/start?account_id=${account.id}`
                          }}
                        >
                          {account.oauth_status === 'refresh_failed'
                            ? 'Reautorizar eBay'
                            : account.authorized
                              ? 'Reconectar eBay'
                              : 'Conectar eBay'}
                        </button>
                      )}

                      <button
                        type="button"
                        className="edit-button"
                        onClick={() => startEditingAccount(account)}
                      >
                        Editar nombre
                      </button>

                      <button
                        type="button"
                        className={
                          account.status === 'active'
                            ? 'deactivate-button'
                            : 'reactivate-button'
                        }
                        onClick={() => toggleAccountStatus(account)}
                      >
                        {account.status === 'active'
                          ? 'Desactivar'
                          : 'Reactivar'}
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))}

            {accounts.length === 0 && (
              <p className="message">No hay cuentas activas.</p>
            )}
          </div>
        </section>
          )}
        </>
      )}
    </main>
  )
}

export default App
