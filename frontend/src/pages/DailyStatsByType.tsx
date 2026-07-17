import { useState, useEffect, useRef, useMemo } from "react"
import {
  Search, Download,
  ChevronDown, Check, XCircle,
  RefreshCw, ArrowDownCircle, ArrowUpCircle,
  TrendingUp, TrendingDown,
  Users as UsersIcon, BarChart3, Wallet, DollarSign,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useDailyStatsByType } from "../hooks/useAnalytics"
import { type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

type TrCategory = "Inbound" | "Outbound"
const TRANSACTION_TYPES: { id: string; label: string; category: TrCategory }[] = [
  { id: 'B2W',                     label: 'B2W (Prefunded)',         category: 'Inbound'  },
  { id: 'P2P_RECEIVE',             label: 'P2P Receive',             category: 'Inbound'  },
  { id: 'CASHIN',                  label: 'Cash In',                 category: 'Inbound'  },
  { id: 'CASHIN_OTC',              label: 'Cash In OTC',             category: 'Inbound'  },
  { id: 'IMT',                     label: 'IMT Receive',             category: 'Inbound'  },
  { id: 'PREFUNDED',               label: 'Prefunded General',       category: 'Inbound'  },
  { id: 'Payroll | disbursements', label: 'Payroll / Disbursements', category: 'Inbound'  },
  { id: 'P2P_SEND',                label: 'P2P Send',                category: 'Outbound' },
  { id: 'CASHOUT',                 label: 'Cash Out',                category: 'Outbound' },
  { id: 'DIGI_PRODUCT',            label: 'Digicel Products',        category: 'Outbound' },
  { id: 'BILLPAY',                 label: 'Bill Payment',            category: 'Outbound' },
  { id: 'TOPUP_GIFT',              label: 'Top-up Gift',             category: 'Outbound' },
  { id: 'SELF_TOPUP',              label: 'Top-up Self',             category: 'Outbound' },
  { id: 'PAY2MERC',                label: 'Merchant Payment',        category: 'Outbound' },
  { id: 'W2B',                     label: 'Wallet to Bank',          category: 'Outbound' },
]

const TYPE_META: Record<string, { cat: TrCategory }> = Object.fromEntries(
  TRANSACTION_TYPES.map(t => [t.id, { cat: t.category }])
)


type Metric = 'SUBS' | 'VOLUME' | 'VALUE' | 'REVENUE'

const METRIC_TABS: { id: Metric; label: string; accent: string }[] = [
  { id: 'SUBS',    label: 'Subscribers',  accent: 'var(--data-subs)'    },
  { id: 'VOLUME',  label: 'Volume',       accent: 'var(--data-volume)'  },
  { id: 'VALUE',   label: 'Value (HTG)',  accent: 'var(--data-value)'   },
  { id: 'REVENUE', label: 'Revenue (HTG)', accent: 'var(--data-revenue)' },
]

interface Pivot {
  /** Liste des dates (YYYY-MM-DD) ordonnées ascendant — colonnes du pivot. */
  dates: string[]
  /** Une ligne par TR_TYPE (triés alphabétique). */
  rows: { tr: string; cells: number[]; total: number }[]
  /** Totaux par colonne (ligne Grand Total). */
  colTotals: number[]
  /** Grand total absolu. */
  grandTotal: number
}

/** Normalise une TRANSACTION_DATE renvoyée par Spark (TIMESTAMP ou DATE) en 'YYYY-MM-DD'. */
function normDate(v: any): string {
  if (!v) return ''
  const s = String(v)
  // Format ISO complet (avec T) → ne garde que la partie date
  if (s.includes('T')) return s.split('T')[0]
  // Sinon prend les 10 premiers chars (YYYY-MM-DD)
  return s.slice(0, 10)
}

function buildPivot(rows: any[], metric: Metric): Pivot {
  // Dates uniques, triées ascendant
  const dates = Array.from(new Set(rows.map(r => normDate(r.TRANSACTION_DATE)).filter(Boolean))).sort()
  // TR_TYPE uniques, triés alpha
  const trTypes = Array.from(new Set(rows.map(r => String(r.TR_TYPE || '')).filter(Boolean))).sort()
  // Lookup (TR_TYPE, DATE) → row pour O(1) accès
  const map = new Map<string, any>()
  for (const r of rows) map.set(`${r.TR_TYPE}|${normDate(r.TRANSACTION_DATE)}`, r)

  const pivotRows = trTypes.map(t => {
    const cells = dates.map(d => Number((map.get(`${t}|${d}`) || {})[metric] ?? 0))
    return { tr: t, cells, total: cells.reduce((s, v) => s + v, 0) }
  })
  const colTotals  = dates.map((_, i) => pivotRows.reduce((s, d) => s + d.cells[i], 0))
  const grandTotal = colTotals.reduce((s, v) => s + v, 0)
  return { dates, rows: pivotRows, colTotals, grandTotal }
}

export default function DailyStatsByType() {
  const formatDate = (date: Date) => date.toISOString().split('T')[0]
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 31)

  const [localDateRange, setLocalDateRange] = useState({ start: formatDate(thirtyDaysAgo), end: formatDate(yesterday) })
  const [localPreset, setLocalPreset] = useState("30")
  const [localSelectedTypes, setLocalSelectedTypes] = useState<string[]>([])
  /** Indices de jours de la semaine sélectionnés (0=Sun .. 6=Sat).
   *  Vide ou complet = pas de filtre. */
  const [localSelectedDays, setLocalSelectedDays] = useState<number[]>([])

  /** Onglet métrique actif. */
  const [activeMetric, setActiveMetric] = useState<Metric>('SUBS')

  const toggleDayOfWeek = (idx: number) =>
    setLocalSelectedDays(prev => prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx])

  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [submittedFilters, setSubmittedFilters] = useState({
    startDate: formatDate(thirtyDaysAgo),
    endDate: formatDate(yesterday),
    types: [] as string[],
    msisdns: [] as string[],
    channels: [] as string[],
  })

  const [showTypeDropdown, setShowTypeDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (localPreset !== "custom") {
      const end = new Date(); end.setDate(end.getDate() - 1)
      const start = new Date(); start.setDate(start.getDate() - (parseInt(localPreset) + 1))
      setLocalDateRange({ start: formatDate(start), end: formatDate(end) })
    }
  }, [localPreset])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowTypeDropdown(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const { data: rows, isLoading, isFetching, refetch } = useDailyStatsByType({
    startDate: submittedFilters.startDate,
    endDate: submittedFilters.endDate,
    serviceNames: submittedFilters.types,
    msisdns: submittedFilters.msisdns,
    channels: submittedFilters.channels,
    limit: 5000,
  })

  const handleSubmitSearch = () => {
    setSubmittedFilters({
      startDate: localDateRange.start,
      endDate: localDateRange.end,
      types: localSelectedTypes,
      msisdns: [],
      channels: [],
    })
  }

  const toggleType = (id: string) =>
    setLocalSelectedTypes(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])

  const allRows = (rows as any[] | undefined) ?? []

  // Filtre client-side par jour de la semaine : si l'utilisateur a sélectionné
  // Lundi+Mardi, on ne garde que les rows tombant un lundi ou mardi.
  // Sélection vide = pas de filtre.
  const filteredRows = useMemo(() => {
    if (localSelectedDays.length === 0 || localSelectedDays.length === 7) return allRows
    return allRows.filter(r => {
      const iso = normDate(r.TRANSACTION_DATE)
      if (!iso || iso.length < 10) return false
      const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
      return localSelectedDays.includes(dow)
    })
  }, [allRows, localSelectedDays])

  // 4 pivots (un par métrique) — alimentés par filteredRows
  const pivots = useMemo(() => ({
    SUBS:    buildPivot(filteredRows, 'SUBS'),
    VOLUME:  buildPivot(filteredRows, 'VOLUME'),
    VALUE:   buildPivot(filteredRows, 'VALUE'),
    REVENUE: buildPivot(filteredRows, 'REVENUE'),
  }), [filteredRows])

  const exportToExcel = async () => {
    setExportProgress({ bytesReceived: 0, totalBytes: 0, phase: 'Génération du fichier côté serveur…' })
    try {
      const { OpenAPI } = await import("../api/core/OpenAPI")
      const qs = new URLSearchParams()
      if (submittedFilters.startDate) qs.set('start_date', submittedFilters.startDate)
      if (submittedFilters.endDate)   qs.set('end_date',   submittedFilters.endDate)
      submittedFilters.types?.forEach((t: string)    => qs.append('service_names', t))
      submittedFilters.msisdns?.forEach((m: string)  => qs.append('msisdns', m))
      submittedFilters.channels?.forEach((c: string) => qs.append('channels', c))

      const res = await fetch(`${OpenAPI.BASE}/customers/daily-stats-by-type/export.xlsx?${qs.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('Content-Length') || 0)
      setExportProgress({ bytesReceived: 0, totalBytes: total, phase: 'Téléchargement du fichier…' })
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
      a.download = `Daily_Stats_by_Type_${submittedFilters.startDate}_to_${submittedFilters.endDate}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(dl)
    } catch (e) {
      console.error("Export failed", e)
      alert("L'export a échoué — voir la console.")
    } finally {
      setExportProgress(null)
    }
  }

  const busy = isLoading || isFetching
  const canExport = !busy && allRows.length > 0

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
            Customer · Daily by transaction type
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Daily Stats by Transaction Type
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            Volume, subs, value and revenue aggregated by day × TR_TYPE · {submittedFilters.startDate} → {submittedFilters.endDate}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => refetch()} disabled={busy} title="Refresh"
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
          <button onClick={exportToExcel} disabled={!canExport}
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

      {/* ── FILTER BAR ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        marginTop: 'var(--space-4)',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        gap: 'var(--space-3)',
        position: 'relative', zIndex: 10,
      }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <select
            value={localPreset} onChange={(e) => setLocalPreset(e.target.value)}
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
            value={localDateRange.start}
            onChange={(e) => { setLocalDateRange({ ...localDateRange, start: e.target.value }); setLocalPreset("custom") }}
            style={{
              height: '32px', padding: '0 var(--space-2)',
              width: '140px',
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
            max={formatDate(yesterday)} value={localDateRange.end}
            onChange={(e) => { setLocalDateRange({ ...localDateRange, end: e.target.value }); setLocalPreset("custom") }}
            style={{
              height: '32px', padding: '0 var(--space-2)',
              width: '140px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
            }} />
        </div>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)' }} />

        {/* ── Filter par jour de la semaine — purement client-side ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {DAY_NAMES_EN.map((dn, idx) => {
            const active = localSelectedDays.includes(idx)
            const palette = DAY_COLORS[idx]
            return (
              <button key={dn}
                onClick={() => toggleDayOfWeek(idx)}
                title={`Toggle ${dn}`}
                style={{
                  height: '28px', minWidth: '38px',
                  padding: '0 var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid ' + (active ? palette.border : 'var(--border-default)'),
                  background: active ? palette.bg : 'var(--surface-card)',
                  color: active ? palette.color : 'var(--text-tertiary)',
                  fontSize: 'var(--fs-micro)', fontWeight: active ? 800 : 600,
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}>
                {dn}
              </button>
            )
          })}
          {localSelectedDays.length > 0 && localSelectedDays.length < 7 && (
            <button onClick={() => setLocalSelectedDays([])}
              title="Show all days"
              style={{
                height: '28px', padding: '0 var(--space-2)',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--fs-micro)', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.5px',
                cursor: 'pointer', textDecoration: 'underline',
              }}>
              All
            </button>
          )}
        </div>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)' }} />

        <div style={{ position: 'relative', minWidth: '220px', flex: '1 1 220px' }} ref={dropdownRef}>
          <button onClick={() => setShowTypeDropdown(!showTypeDropdown)}
            style={{
              width: '100%', height: '32px',
              padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid ' + (localSelectedTypes.length > 0 ? 'var(--text-primary)' : 'var(--border-default)'),
              background: 'var(--surface-card)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer',
              fontSize: 'var(--fs-body)', fontWeight: 500,
              color: 'var(--text-primary)',
            }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {localSelectedTypes.length === 0 ? 'All transaction types' : `${localSelectedTypes.length} types selected`}
            </span>
            <ChevronDown size={12} strokeWidth={1.75} />
          </button>

          {showTypeDropdown && (
            <div style={{
              position: 'absolute', top: '38px', left: 0, right: 0,
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2)',
              maxHeight: '420px', overflowY: 'auto', zIndex: 100, minWidth: '360px',
            }}>
              <div style={{
                padding: 'var(--space-1) var(--space-2)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 'var(--space-2)',
              }}>
                <span style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 500,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--tracking-uppercase)',
                }}>Available flows</span>
                <button onClick={() => setLocalSelectedTypes([])} style={{
                  background: 'none', border: 'none',
                  color: 'var(--brand)',
                  fontSize: 'var(--fs-label)', fontWeight: 500,
                  cursor: 'pointer',
                }}>Clear all</button>
              </div>
              {(['Inbound', 'Outbound'] as TrCategory[]).map(cat => (
                <div key={cat} style={{ marginBottom: 'var(--space-2)' }}>
                  <div style={{
                    padding: 'var(--space-1) var(--space-2)',
                    fontSize: 'var(--fs-micro)', fontWeight: 500,
                    color: cat === 'Inbound' ? 'var(--positive)' : 'var(--negative)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                  }}>
                    {cat}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
                    {TRANSACTION_TYPES.filter(t => t.category === cat).map(type => {
                      const checked = localSelectedTypes.includes(type.id)
                      return (
                        <div key={type.id} onClick={() => toggleType(type.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                            padding: 'var(--space-2)',
                            borderRadius: 'var(--radius-xs)',
                            cursor: 'pointer',
                          }}>
                          <div style={{
                            width: '14px', height: '14px',
                            borderRadius: 'var(--radius-xs)',
                            border: '1px solid ' + (checked ? 'var(--text-primary)' : 'var(--border-default)'),
                            background: checked ? 'var(--text-primary)' : 'var(--surface-card)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', flexShrink: 0,
                          }}>
                            {checked && <Check size={10} strokeWidth={3} />}
                          </div>
                          <span style={{
                            fontSize: 'var(--fs-body)', fontWeight: 500,
                            color: 'var(--text-primary)',
                          }}>{type.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={handleSubmitSearch} disabled={busy}
          style={{
            background: 'var(--brand)', color: 'white',
            border: '1px solid var(--brand)',
            height: '32px', padding: '0 var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontWeight: 500, fontSize: 'var(--fs-body)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            opacity: busy ? 0.5 : 1,
          }}>
          {busy ? <div className="spinner-small" /> : <Search size={13} strokeWidth={1.75} />} Run
        </button>
      </div>

      {/* ── ACTIVE CRITERIA ── */}
      {(submittedFilters.types.length > 0 || localSelectedDays.length > 0) && (
        <div style={{
          marginTop: 'var(--space-3)',
          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          gap: 'var(--space-2)',
          background: 'var(--surface-muted)',
          padding: 'var(--space-2) var(--space-3)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-faint)',
        }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
          }}>Active criteria</span>
          {localSelectedDays.length > 0 && localSelectedDays.length < 7 && (
            <span style={{
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              fontSize: 'var(--fs-label)', fontWeight: 500,
              color: 'var(--text-primary)',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              {localSelectedDays
                .slice()
                .sort((a, b) => a - b)
                .map(i => DAY_NAMES_EN[i])
                .join(', ')}
            </span>
          )}
          {submittedFilters.types.map(t => {
            const meta = TYPE_META[t]
            return (
              <span key={`type-${t}`} style={{
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                fontSize: 'var(--fs-label)', fontWeight: 500,
                color: 'var(--text-primary)',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                {meta?.cat === 'Inbound' ? <ArrowDownCircle size={10} strokeWidth={1.75} color="var(--positive)" /> : <ArrowUpCircle size={10} strokeWidth={1.75} color="var(--negative)" />}
                {t}
              </span>
            )
          })}
          <button onClick={() => {
              setLocalSelectedTypes([]); setLocalSelectedDays([])
              setSubmittedFilters({ ...submittedFilters, msisdns: [], types: [], channels: [] })
            }}
            style={{
              marginLeft: 'auto',
              background: 'none', border: 'none',
              color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: '4px',
              cursor: 'pointer',
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>
            <XCircle size={11} strokeWidth={1.75} /> Clear
          </button>
        </div>
      )}

      {/* ── 4 PIVOT TABLES — un par métrique, dates en colonnes, TR_TYPE en lignes ── */}
      <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {busy && allRows.length === 0 ? (
          <div style={{
            padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div className="spinner" />
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Aggregating daily stats…</div>
            </div>
          </div>
        ) : allRows.length === 0 ? (
          <div style={{
            padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
              <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>No data for these criteria.</div>
            </div>
          </div>
        ) : (
          <>
            {/* ── METRIC TABS ── */}
            <div
              role="tablist"
              aria-label="Metric"
              style={{
                display: 'inline-flex',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                padding: '4px',
                gap: '2px',
                marginBottom: 'var(--space-3)',
              }}
            >
              {METRIC_TABS.map(tab => {
                const active = activeMetric === tab.id
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveMetric(tab.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                      height: '34px', padding: '0 var(--space-4)',
                      border: 'none',
                      borderRadius: 'var(--radius-xs)',
                      background: active ? 'var(--surface-card)' : 'transparent',
                      color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      fontWeight: active ? 600 : 500,
                      fontSize: 'var(--fs-body)',
                      cursor: 'pointer',
                      boxShadow: active ? '0 0 0 1px var(--border-default) inset' : 'none',
                      transition: 'background 0.12s, color 0.12s',
                    }}
                  >
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: tab.accent,
                    }} />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {activeMetric === 'SUBS' && (
              <PivotTable
                title="Subscribers"
                subtitle="Distinct MSISDN per day"
                icon={<UsersIcon size={14} strokeWidth={1.75} />}
                accent="var(--data-subs)"
                pivot={pivots.SUBS}
                hideGrandTotal
              />
            )}
            {activeMetric === 'VOLUME' && (
              <PivotTable
                title="Volume"
                subtitle="Distinct transactions per day"
                icon={<BarChart3 size={14} strokeWidth={1.75} />}
                accent="var(--data-volume)"
                pivot={pivots.VOLUME}
              />
            )}
            {activeMetric === 'VALUE' && (
              <PivotTable
                title="Value (HTG)"
                subtitle="Sum of ORIGINALAMOUNT per day"
                icon={<Wallet size={14} strokeWidth={1.75} />}
                accent="var(--data-value)"
                pivot={pivots.VALUE}
              />
            )}
            {activeMetric === 'REVENUE' && (
              <PivotTable
                title="Revenue (HTG)"
                subtitle="Sum of CHARGEAMOUNT per day"
                icon={<DollarSign size={14} strokeWidth={1.75} />}
                accent="var(--data-revenue)"
                pivot={pivots.REVENUE}
              />
            )}
          </>
        )}
      </div>
      <ExportOverlay progress={exportProgress} />
    </DashboardLayout>
  )
}

// ── Pivot Table component — TR_TYPE en lignes, dates en colonnes ──

const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DAY_NAMES_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Format long lisible : "2026 June 21" */
const formatLongDate = (iso: string): string => {
  if (!iso || iso.length < 10) return iso
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${y} ${MONTH_NAMES_EN[m - 1]} ${d}`
}

/** Calcul jour de la semaine + couleurs associées (header). */
const DAY_COLORS: Record<number, { bg: string; color: string; border: string }> = {
  0: { bg: '#cffafe', color: '#155e75', border: '#67e8f9' },   // Sun · cyan
  1: { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },   // Mon · blue
  2: { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },   // Tue · emerald
  3: { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },   // Wed · amber
  4: { bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },   // Thu · violet
  5: { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },   // Fri · red
  6: { bg: '#fce7f3', color: '#9d174d', border: '#f9a8d4' },   // Sat · pink
}

/** Renvoie {dow (0-6), name, palette} pour un ISO 'YYYY-MM-DD'. UTC-safe (pas de souci de fuseau). */
const dayInfo = (iso: string) => {
  if (!iso || iso.length < 10) return { dow: 0, name: '', palette: DAY_COLORS[0] }
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return { dow, name: DAY_NAMES_EN[dow], palette: DAY_COLORS[dow] }
}

function PivotTable({ title, subtitle, icon, accent, pivot, hideGrandTotal = false }: {
  title: string
  subtitle: string
  icon: React.ReactNode
  accent: string
  pivot: Pivot
  /** Quand `true`, la colonne et la ligne « Grand Total » ne sont PAS affichées
   *  (utile pour Subscribers : sommer des COUNT(DISTINCT) cross-jours/produits
   *  double-compte les MSISDN actifs sur plusieurs périodes). */
  hideGrandTotal?: boolean
}) {
  const fmt = (v: any) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <div style={{ height: '3px', background: accent }} />

      <div style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-default)',
        background: 'var(--surface-muted)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
      }}>
        <span style={{
          width: '28px', height: '28px',
          borderRadius: 'var(--radius-xs)',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          color: accent,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>{icon}</span>
        <div>
          <div style={{
            fontSize: 'var(--fs-body)', fontWeight: 700,
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>{title}</div>
          <div style={{
            fontSize: 'var(--fs-micro)',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            marginTop: '2px',
            fontVariantNumeric: 'tabular-nums',
          }}>{subtitle}</div>
        </div>
        <span style={{ marginLeft: 'auto' }} />
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 500,
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-default)',
          background: 'var(--surface-card)',
          padding: '1px var(--space-2)',
          borderRadius: 'var(--radius-xs)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {pivot.rows.length} TR_TYPE · {pivot.dates.length} day{pivot.dates.length > 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ overflowX: 'auto', width: '100%' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 'var(--fs-body)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <thead>
            <tr style={{ background: 'var(--surface-card)' }}>
              <th style={{
                position: 'sticky', left: 0, zIndex: 1,
                background: 'var(--surface-card)',
                textAlign: 'left',
                padding: 'var(--space-2) var(--space-4)',
                fontSize: 'var(--fs-micro)', fontWeight: 600,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                borderBottom: '1px solid var(--border-default)',
                borderRight: '1px solid var(--border-faint)',
                whiteSpace: 'nowrap',
                minWidth: '200px',
              }}>Products</th>
              {pivot.dates.map(d => {
                const di = dayInfo(d)
                return (
                  <th key={d} title={`${formatLongDate(d)} · ${di.name}`} style={{
                    textAlign: 'right',
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: 'var(--fs-micro)', fontWeight: 700,
                    color: 'var(--text-tertiary)',
                    textTransform: 'none',
                    letterSpacing: '0.02em',
                    borderBottom: '1px solid var(--border-default)',
                    background: 'transparent',
                    whiteSpace: 'nowrap',
                    minWidth: '120px',
                    verticalAlign: 'bottom',
                  }}>
                    <div style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                      gap: '1px',
                    }}>
                      <span style={{
                        fontSize: '9px', fontWeight: 800,
                        textTransform: 'uppercase', letterSpacing: '0.6px',
                        color: di.palette.color,
                      }}>{di.name}</span>
                      <span style={{
                        fontSize: 'var(--fs-label)', fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color: di.palette.color,
                      }}>{formatLongDate(d)}</span>
                    </div>
                  </th>
                )
              })}
              {!hideGrandTotal && (
                <th style={{
                  textAlign: 'right',
                  padding: 'var(--space-2) var(--space-4)',
                  fontSize: 'var(--fs-micro)', fontWeight: 700,
                  color: accent,
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                  borderBottom: '1px solid var(--border-default)',
                  borderLeft: '1px solid var(--border-faint)',
                  whiteSpace: 'nowrap',
                  minWidth: '110px',
                  background: 'var(--surface-card)',
                }}>Grand Total</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pivot.rows.map((row) => (
              <tr key={row.tr} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                <td style={{
                  position: 'sticky', left: 0, zIndex: 1,
                  background: 'var(--surface-card)',
                  padding: 'var(--space-2) var(--space-4)',
                  borderRight: '1px solid var(--border-faint)',
                  color: 'var(--text-primary)', fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>{row.tr}</td>
                {row.cells.map((c, i) => {
                  const prev = i > 0 ? row.cells[i - 1] : null
                  const isUp   = prev !== null && c > prev
                  const isDown = prev !== null && c < prev
                  return (
                    <td key={i} style={{
                      textAlign: 'right',
                      padding: 'var(--space-2) var(--space-3)',
                      color: c > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontWeight: 500,
                    }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
                        gap: '3px',
                      }}>
                        {isUp   && <TrendingUp   size={10} strokeWidth={2} color="var(--positive)" />}
                        {isDown && <TrendingDown size={10} strokeWidth={2} color="var(--negative)" />}
                        {fmt(c)}
                      </span>
                    </td>
                  )
                })}
                {!hideGrandTotal && (
                  <td style={{
                    textAlign: 'right',
                    padding: 'var(--space-2) var(--space-4)',
                    color: accent, fontWeight: 700,
                    borderLeft: '1px solid var(--border-faint)',
                    background: 'rgba(0, 0, 0, 0.015)',
                  }}>{fmt(row.total)}</td>
                )}
              </tr>
            ))}
            {!hideGrandTotal && (
              <tr style={{ background: 'var(--surface-muted)' }}>
                <td style={{
                  position: 'sticky', left: 0, zIndex: 1,
                  background: 'var(--surface-muted)',
                  padding: 'var(--space-3) var(--space-4)',
                  borderRight: '1px solid var(--border-default)',
                  borderTop: '2px solid ' + accent,
                  color: accent, fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                  fontSize: 'var(--fs-micro)',
                  whiteSpace: 'nowrap',
                }}>Grand Total</td>
                {pivot.colTotals.map((c, i) => {
                  const prev = i > 0 ? pivot.colTotals[i - 1] : null
                  const isUp   = prev !== null && c > prev
                  const isDown = prev !== null && c < prev
                  return (
                    <td key={i} style={{
                      textAlign: 'right',
                      padding: 'var(--space-3) var(--space-3)',
                      color: accent, fontWeight: 800,
                      borderTop: '2px solid ' + accent,
                    }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
                        gap: '3px',
                      }}>
                        {isUp   && <TrendingUp   size={11} strokeWidth={2.25} color="var(--positive)" />}
                        {isDown && <TrendingDown size={11} strokeWidth={2.25} color="var(--negative)" />}
                        {fmt(c)}
                      </span>
                    </td>
                  )
                })}
                <td style={{
                  textAlign: 'right',
                  padding: 'var(--space-3) var(--space-4)',
                  color: accent, fontWeight: 800,
                  borderTop: '2px solid ' + accent,
                  borderLeft: '1px solid var(--border-default)',
                  background: 'var(--surface-card)',
                }}>{fmt(pivot.grandTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
