import { useState, useEffect, useMemo } from "react"
import {
  RefreshCw, Download, Search, XCircle, X, ArrowDownCircle, ArrowUpCircle,
  Tag, Hash, Users, Activity,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import {
  useEmoneyOpsTransactions,
  useEmoneyOpsTransactionsSummary,
  useEmoneyOpsInitiators,
} from "../hooks/useAnalytics"
import { type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const DISPLAY_LIMIT = 500
const EXPORT_LIMIT  = 2_000_000

type Preset = '7' | '30' | '60' | '90' | 'custom'
type AccountClass = 'Biller' | 'Merchant' | 'Agent' | 'Prefunded' | 'Payroll' | 'Other'
const ACCOUNT_CLASSES: AccountClass[] = ['Biller', 'Merchant', 'Agent', 'Prefunded', 'Payroll', 'Other']

const CLASS_COLOR: Record<AccountClass, string> = {
  Biller:    '#3A7AE6',
  Merchant:  '#16A34A',
  Agent:     '#F59E0B',
  Prefunded: '#06B6D4',
  Payroll:   '#7C3AED',
  Other:     '#94A3B8',
}

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
const minusDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}
const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtHTG = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (v: any) => {
  if (!v) return '—'
  const s = String(v)
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10)
}

export default function EmoneyOpsTransactions() {
  // ── Local editing state ──
  const [preset, setPreset] = useState<Preset>('30')
  const [localStart, setLocalStart] = useState<string>(minusDays(30))
  const [localEnd,   setLocalEnd]   = useState<string>(todayMinus1())
  const [localStatus, setLocalStatus] = useState<string>("Completed")
  const [localInitiators, setLocalInitiators] = useState<string[]>([])
  const [localAccountClasses, setLocalAccountClasses] = useState<AccountClass[]>([...ACCOUNT_CLASSES])
  const [txIdsInput, setTxIdsInput] = useState<string>("")

  // ── Applied state ──
  const [start, setStart] = useState<string>(minusDays(30))
  const [end,   setEnd]   = useState<string>(todayMinus1())
  const [statuses,        setStatuses]        = useState<string[] | undefined>(["Completed"])
  const [initiators,      setInitiators]      = useState<string[] | undefined>(undefined)
  const [accountClasses,  setAccountClasses]  = useState<string[] | undefined>(undefined)
  const [transactionIds,  setTransactionIds]  = useState<string[] | undefined>(undefined)

  const [search, setSearch] = useState("")
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)

  useEffect(() => {
    if (preset !== 'custom') {
      const days = parseInt(preset, 10)
      setLocalStart(minusDays(days))
      setLocalEnd(todayMinus1())
    }
  }, [preset])

  const parseList = (raw: string): string[] | undefined => {
    const arr = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
    return arr.length > 0 ? arr : undefined
  }

  const apply = () => {
    setStart(localStart); setEnd(localEnd)
    setStatuses(localStatus === 'all' ? ['*'] : [localStatus])
    setInitiators(localInitiators.length > 0 ? localInitiators : undefined)
    const allC = localAccountClasses.length === ACCOUNT_CLASSES.length
    const noneC = localAccountClasses.length === 0
    setAccountClasses(allC || noneC ? undefined : localAccountClasses)
    setTransactionIds(parseList(txIdsInput))
  }
  const clearFilters = () => {
    setPreset('30')
    setLocalStart(minusDays(30)); setLocalEnd(todayMinus1())
    setLocalStatus("Completed")
    setLocalInitiators([]); setLocalAccountClasses([...ACCOUNT_CLASSES])
    setTxIdsInput("")
    setStart(minusDays(30)); setEnd(todayMinus1())
    setStatuses(["Completed"]); setInitiators(undefined)
    setAccountClasses(undefined); setTransactionIds(undefined)
  }
  const toggleClass = (c: AccountClass) =>
    setLocalAccountClasses(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  const toggleInitiator = (i: string) =>
    setLocalInitiators(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])

  // ── Server data ──
  const queryArgs = {
    startDate: start, endDate: end,
    statuses,
    initiators,
    transactionIds,
    accountClasses,
  }
  const { data: rows = [], isFetching, isLoading, refetch } = useEmoneyOpsTransactions({
    ...queryArgs,
    limit: DISPLAY_LIMIT,
  })
  const { data: summary } = useEmoneyOpsTransactionsSummary(queryArgs)
  const { data: distinctInitiators = [] } = useEmoneyOpsInitiators({ startDate: start, endDate: end })

  // ── Client-side search filter ──
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows
    const s = search.trim().toLowerCase()
    return (rows as any[]).filter(r =>
      String(r.TRANSACTIONID || '').toLowerCase().includes(s) ||
      String(r.CREDITOR_ID || '').toLowerCase().includes(s) ||
      String(r.CREDITOR_NAME || '').toLowerCase().includes(s) ||
      String(r.DEBITOR_ID || '').toLowerCase().includes(s) ||
      String(r.DEBITOR_NAME || '').toLowerCase().includes(s) ||
      String(r.INITIATOR || '').toLowerCase().includes(s)
    )
  }, [rows, search])

  const handleExport = async () => {
    setExportProgress({ bytesReceived: 0, totalBytes: 0, phase: 'Generating XLSX…' })
    try {
      const { OpenAPI } = await import("../api/core/OpenAPI")
      const qs = new URLSearchParams()
      if (start) qs.set('start_date', start)
      if (end)   qs.set('end_date',   end)
      qs.set('limit', String(EXPORT_LIMIT))
      ;(statuses        || []).forEach(s => qs.append('statuses', s))
      ;(initiators      || []).forEach(i => qs.append('initiators', i))
      ;(transactionIds  || []).forEach(t => qs.append('transaction_ids', t))
      ;(accountClasses  || []).forEach(c => qs.append('account_classes', c))

      const res = await fetch(`${OpenAPI.BASE}/operations/emoney-transactions/export.xlsx?${qs.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('Content-Length') || 0)
      setExportProgress({ bytesReceived: 0, totalBytes: total, phase: 'Downloading…' })
      const reader = res.body!.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) { chunks.push(value); received += value.length
          setExportProgress(prev => prev ? { ...prev, bytesReceived: received } : null) }
      }
      const blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const dl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = dl
      a.download = `Emoney_Ops_Transactions_${start}_to_${end}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(dl)
    } catch (e) {
      console.error('Export failed', e)
      alert("Export failed — see console.")
    } finally {
      setExportProgress(null)
    }
  }

  const busy = isLoading || isFetching
  const canExport = !busy && rows.length > 0

  return (
    <DashboardLayout>
      {/* ── HERO ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        gap: 'var(--space-4)', flexWrap: 'wrap',
        paddingBottom: 'var(--space-4)',
        marginBottom: 'var(--space-6)',
        borderBottom: '1px solid var(--border-default)',
      }}>
        <div>
          <div style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            marginBottom: 'var(--space-1)',
          }}>
            Operation · E-money transactions
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            E-money Withdrawal &amp; Deposit
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            Classified by counterparty account · Biller / Merchant / Other · {start} → {end}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => refetch()} disabled={busy}
            style={{
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              height: '34px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: busy ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              opacity: busy ? 0.5 : 1,
            }}>
            <RefreshCw size={13} strokeWidth={1.75} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={handleExport} disabled={!canExport}
            style={{
              background: canExport ? 'var(--positive)' : 'var(--surface-muted)',
              color: canExport ? 'white' : 'var(--text-muted)',
              border: '1px solid ' + (canExport ? 'var(--positive)' : 'var(--border-default)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: canExport ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            <Download size={13} strokeWidth={1.75} /> Export Excel
          </button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        <Kpi label="Volume"             value={fmtNum(summary?.VOLUME)}            icon={<Activity size={14} strokeWidth={1.75} />} />
        <Kpi label="Unique creditors"   value={fmtNum(summary?.UNIQUE_CREDITORS)}  icon={<Users size={14} strokeWidth={1.75} />} />
        <Kpi label="Unique debitors"    value={fmtNum(summary?.UNIQUE_DEBITORS)}   icon={<Users size={14} strokeWidth={1.75} />} />
        <Kpi label="Value Withdrawal"   value={fmtHTG(summary?.VALUE_WITHDRAWAL)}  icon={<ArrowUpCircle size={14} strokeWidth={1.75} />} accent="var(--negative)" />
        <Kpi label="Value Deposit"      value={fmtHTG(summary?.VALUE_DEPOSIT)}     icon={<ArrowDownCircle size={14} strokeWidth={1.75} />} accent="var(--positive)" />
      </div>

      {/* ── Class breakdown chips ── */}
      <div style={{
        display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap',
        marginBottom: 'var(--space-4)',
      }}>
        {ACCOUNT_CLASSES.map(c => {
          const key = `COUNT_${c.toUpperCase()}` as const
          const count = (summary as any)?.[key] ?? 0
          return (
            <div key={c} style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderLeft: `3px solid ${CLASS_COLOR[c]}`,
              padding: '6px var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-label)',
            }}>
              <span style={{
                fontWeight: 600, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                fontSize: 'var(--fs-micro)',
              }}>{c}</span>
              <span style={{
                fontWeight: 700, color: 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}>{fmtNum(count)}</span>
            </div>
          )
        })}
      </div>

      {/* ── FILTER PANEL ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        marginBottom: 'var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      }}>
        {/* Row 1 : Date range + status */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
          <select
            value={preset} onChange={(e) => setPreset(e.target.value as Preset)}
            style={{
              height: '32px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              color: 'var(--text-primary)',
            }}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom</option>
          </select>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>From</span>
          <input type="date"
            value={localStart} max={todayMinus1()}
            onChange={(e) => { setLocalStart(e.target.value); setPreset('custom') }}
            style={{
              height: '32px', padding: '0 var(--space-2)', width: '140px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
            }} />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>To</span>
          <input type="date"
            value={localEnd} max={todayMinus1()}
            onChange={(e) => { setLocalEnd(e.target.value); setPreset('custom') }}
            style={{
              height: '32px', padding: '0 var(--space-2)', width: '140px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
            }} />

          <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)' }} />

          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Status</span>
          <select
            value={localStatus} onChange={(e) => setLocalStatus(e.target.value)}
            style={{
              height: '32px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              color: 'var(--text-primary)',
            }}>
            <option value="Completed">Completed</option>
            <option value="Failed">Failed</option>
            <option value="all">All</option>
          </select>

          <button onClick={apply} disabled={busy}
            style={{
              marginLeft: 'auto',
              background: 'var(--brand)', color: 'white',
              border: '1px solid var(--brand)',
              height: '32px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              opacity: busy ? 0.5 : 1,
            }}>
            <Search size={13} strokeWidth={1.75} /> Run
          </button>
          <button onClick={clearFilters}
            title="Clear filters"
            style={{
              background: 'transparent', color: 'var(--text-tertiary)',
              border: '1px solid var(--border-default)',
              height: '32px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            <XCircle size={13} strokeWidth={1.75} /> Clear
          </button>
        </div>

        {/* Row 2 : Account class chips + Tx IDs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Account class</span>
          {ACCOUNT_CLASSES.map(c => {
            const active = localAccountClasses.includes(c)
            return (
              <button key={c} onClick={() => toggleClass(c)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                  padding: '5px var(--space-3)',
                  border: '1px solid ' + (active ? CLASS_COLOR[c] : 'var(--border-default)'),
                  background: active ? `${CLASS_COLOR[c]}15` : 'var(--surface-card)',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  fontWeight: active ? 700 : 500,
                  fontSize: 'var(--fs-label)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: CLASS_COLOR[c],
                }} />
                {c}
              </button>
            )
          })}

          <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)' }} />

          <Hash size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Tx ID lookup</span>
          <input
            value={txIdsInput} onChange={(e) => setTxIdsInput(e.target.value)}
            placeholder="One or many Tx IDs (comma / space separated)"
            style={{
              flex: '1 1 240px', minWidth: '240px',
              height: '32px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              color: 'var(--text-primary)',
            }} />
        </div>

        {/* Row 3 : Initiator multi-select */}
        {distinctInitiators.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
              marginRight: 'var(--space-2)',
            }}>Initiator</span>
            {localInitiators.length > 0 && (
              <button onClick={() => setLocalInitiators([])}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--brand)', fontWeight: 500,
                  fontSize: 'var(--fs-label)', cursor: 'pointer',
                }}>Clear all</button>
            )}
            {(distinctInitiators as string[]).slice(0, 50).map(i => {
              const active = localInitiators.includes(i)
              return (
                <button key={i} onClick={() => toggleInitiator(i)}
                  style={{
                    padding: '3px var(--space-2)',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid ' + (active ? 'var(--text-primary)' : 'var(--border-default)'),
                    background: active ? 'var(--surface-card)' : 'var(--surface-muted)',
                    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: active ? 600 : 500,
                    fontSize: 'var(--fs-micro)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                  }}>
                  {i}
                </button>
              )
            })}
            {distinctInitiators.length > 50 && (
              <span style={{
                fontSize: 'var(--fs-micro)', color: 'var(--text-tertiary)',
              }}>… and {distinctInitiators.length - 50} more</span>
            )}
          </div>
        )}
      </div>

      {/* ── TABLE ── */}
      <div style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--surface-muted)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 'var(--space-3)', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Tag size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>Transactions</span>
            {!busy && (
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: 'var(--text-secondary)',
                background: 'var(--surface-card)',
                border: '1px solid var(--border-default)',
                padding: '1px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {fmtNum(filteredRows.length)} of {fmtNum(rows.length)} loaded · cap {DISPLAY_LIMIT}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: '0 0 auto' }}>
            <Search size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, name, initiator…"
              style={{
                height: '30px', padding: '0 var(--space-3)', width: '260px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                color: 'var(--text-primary)',
              }} />
            {search && (
              <button onClick={() => setSearch("")}
                style={{
                  height: '30px', padding: '0 var(--space-2)',
                  background: 'transparent', border: 'none',
                  color: 'var(--text-tertiary)', cursor: 'pointer',
                }}>
                <X size={12} strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>

        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          {busy && rows.length === 0 ? (
            <div style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
              Loading transactions…
            </div>
          ) : filteredRows.length === 0 ? (
            <div style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <XCircle size={24} strokeWidth={1.5} opacity={0.4} style={{ margin: '0 auto var(--space-3)' }} />
              No transactions for these criteria.
            </div>
          ) : (
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontSize: 'var(--fs-label)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <thead>
                <tr style={{ background: 'var(--surface-card)', borderBottom: '1px solid var(--border-default)' }}>
                  <Th>Date</Th>
                  <Th>Tx ID</Th>
                  <Th>Type</Th>
                  <Th>Class</Th>
                  <Th>Creditor</Th>
                  <Th>Debitor</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Charge</Th>
                  <Th>Channel</Th>
                  <Th>Status</Th>
                  <Th>Initiator</Th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r: any, idx: number) => {
                  const cls = (r.ACCOUNT_CLASS || 'Other') as AccountClass
                  const isInbound = r.TR_TYPE === 'E-money Deposit'
                  return (
                    <tr key={r.TRANSACTIONID || idx} style={{
                      borderBottom: '1px solid var(--border-faint)',
                    }}>
                      <Td>{fmtDate(r.TRANSACTION_DATE)}</Td>
                      <Td mono>{r.TRANSACTIONID || '—'}</Td>
                      <Td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '2px var(--space-2)',
                          borderRadius: 'var(--radius-xs)',
                          background: isInbound ? 'rgba(22, 163, 74, 0.08)' : 'rgba(227, 27, 35, 0.08)',
                          color: isInbound ? 'var(--positive)' : 'var(--negative)',
                          fontWeight: 600, fontSize: 'var(--fs-micro)',
                        }}>
                          {isInbound
                            ? <ArrowDownCircle size={10} strokeWidth={2} />
                            : <ArrowUpCircle size={10} strokeWidth={2} />}
                          {r.TR_TYPE}
                        </span>
                      </Td>
                      <Td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '2px var(--space-2)',
                          border: '1px solid ' + CLASS_COLOR[cls],
                          background: `${CLASS_COLOR[cls]}12`,
                          color: 'var(--text-primary)',
                          borderRadius: 'var(--radius-xs)',
                          fontWeight: 700, fontSize: 'var(--fs-micro)',
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                        }}>
                          <span style={{
                            width: '7px', height: '7px', borderRadius: '50%',
                            background: CLASS_COLOR[cls],
                          }} />
                          {cls}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 600 }}>{r.CREDITOR_NAME || '—'}</div>
                        <div style={{
                          color: 'var(--text-tertiary)',
                          fontSize: 'var(--fs-micro)',
                          fontFamily: 'monospace',
                        }}>{r.CREDITOR_ID || '—'}</div>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 600 }}>{r.DEBITOR_NAME || '—'}</div>
                        <div style={{
                          color: 'var(--text-tertiary)',
                          fontSize: 'var(--fs-micro)',
                          fontFamily: 'monospace',
                        }}>{r.DEBITOR_ID || '—'}</div>
                      </Td>
                      <Td align="right">{fmtHTG(r.ORIGINALAMOUNT)}</Td>
                      <Td align="right" muted>{fmtHTG(r.CHARGEAMOUNT)}</Td>
                      <Td>{r.CHANNEL || '—'}</Td>
                      <Td>{r.STATUS || '—'}</Td>
                      <Td mono>{r.INITIATOR || '—'}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <ExportOverlay progress={exportProgress} />
    </DashboardLayout>
  )
}

// ── Table helpers ──
function Th({ children, align = 'left' }: { children: React.ReactNode, align?: 'left' | 'right' | 'center' }) {
  return (
    <th style={{
      textAlign: align,
      padding: 'var(--space-2) var(--space-3)',
      fontSize: 'var(--fs-micro)', fontWeight: 600,
      color: 'var(--text-tertiary)',
      textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
      whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({ children, align = 'left', mono = false, muted = false }: {
  children: React.ReactNode, align?: 'left' | 'right' | 'center',
  mono?: boolean, muted?: boolean,
}) {
  return (
    <td style={{
      textAlign: align,
      padding: 'var(--space-2) var(--space-3)',
      color: muted ? 'var(--text-tertiary)' : 'var(--text-primary)',
      fontWeight: 500,
      fontFamily: mono ? 'monospace' : undefined,
      verticalAlign: 'top',
    }}>{children}</td>
  )
}

function Kpi({ label, value, icon, accent }: { label: string, value: string, icon: React.ReactNode, accent?: string }) {
  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
      borderLeft: accent ? `3px solid ${accent}` : undefined,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        color: accent ?? 'var(--text-tertiary)',
        marginBottom: 'var(--space-1)',
      }}>
        {icon}
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
        }}>{label}</span>
      </div>
      <div style={{
        fontSize: 'var(--fs-lg)', fontWeight: 700,
        color: 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
      }}>{value}</div>
    </div>
  )
}
