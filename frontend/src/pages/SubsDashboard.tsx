import { useState, useMemo } from "react"
import {
  Calendar, RefreshCw, Download, XCircle, LineChart as LineChartIcon, Activity, Maximize2, X
} from "lucide-react"
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from "recharts"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useSubsDashboard } from "../hooks/useAnalytics"
import { triggerNativeDownload } from "../utils/exportXlsx"
import "../premium.css"

const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

// Ordre canonique des MEMO (colonnes du tableau, comme dans l'image)
const MEMO_ORDER = [
  'ACTIVE_AGENT',
  'CHURN 30', 'CHURN 60', 'CHURN 90',
  'FW_ACTIVE_30', 'FW_ACTIVE_60', 'FW_ACTIVE_90',
  'MERCHANT_AGENT',
  'MFS_ACTIVE_30', 'MFS_ACTIVE_60', 'MFS_ACTIVE_90',
  'MFS_ACTIVE_DAILY',
]

// Type label pour la classification visuelle (couleur des cellules)
const MEMO_KIND: Record<string, 'agent' | 'churn' | 'fw' | 'mfs' | 'merchant' | 'daily'> = {
  ACTIVE_AGENT: 'agent', MERCHANT_AGENT: 'merchant',
  'CHURN 30': 'churn', 'CHURN 60': 'churn', 'CHURN 90': 'churn',
  FW_ACTIVE_30: 'fw', FW_ACTIVE_60: 'fw', FW_ACTIVE_90: 'fw',
  MFS_ACTIVE_30: 'mfs', MFS_ACTIVE_60: 'mfs', MFS_ACTIVE_90: 'mfs',
  MFS_ACTIVE_DAILY: 'daily',
}

const KIND_COLOR: Record<string, string> = {
  agent: '#7c3aed', churn: '#dc2626', fw: '#16a34a',
  mfs: '#2563eb', merchant: '#ea580c', daily: '#0891b2',
}

const formatDate = (s: string) => {
  // s = "2026-05-24" → "5/24/2026"
  const [y, m, d] = s.split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`
}

const toIso = (d: Date) => d.toISOString().split('T')[0]

// Séries disponibles pour le filtre du chart unique
const ALL_SERIES = [
  'CHURN 30', 'CHURN 60', 'CHURN 90',
  'FW_ACTIVE_30', 'FW_ACTIVE_60', 'FW_ACTIVE_90',
  'MFS_ACTIVE_30', 'MFS_ACTIVE_60', 'MFS_ACTIVE_90',
  'MFS_ACTIVE_DAILY',
] as const

// Couleur de la ligne par série (variante de l'opacité pour 30 / 60 / 90)
const SERIES_COLOR: Record<string, string> = {
  'CHURN 30':         '#fca5a5',
  'CHURN 60':         '#ef4444',
  'CHURN 90':         '#991b1b',
  'FW_ACTIVE_30':     '#86efac',
  'FW_ACTIVE_60':     '#16a34a',
  'FW_ACTIVE_90':     '#14532d',
  'MFS_ACTIVE_30':    '#93c5fd',
  'MFS_ACTIVE_60':    '#2563eb',
  'MFS_ACTIVE_90':    '#1e3a8a',
  'MFS_ACTIVE_DAILY': '#0891b2',
}

export default function SubsDashboard() {
  // Plage de dates : derniers 30 jours par défaut (today-29 → today-1)
  const defaultRange = useMemo(() => {
    const end = new Date(); end.setDate(end.getDate() - 1)
    const start = new Date(end); start.setDate(end.getDate() - 29)
    return { start: toIso(start), end: toIso(end) }
  }, [])
  const [startDate, setStartDate] = useState<string>(defaultRange.start)
  const [endDate,   setEndDate]   = useState<string>(defaultRange.end)

  // Filtre des séries affichées sur le chart unique
  const [selectedSeries, setSelectedSeries] = useState<string[]>([...ALL_SERIES])

  // Modal d'agrandissement du chart
  const [chartModalOpen, setChartModalOpen] = useState(false)

  const { data, isLoading, isFetching, refetch } = useSubsDashboard({ startDate, endDate })
  const busy = isLoading || isFetching

  const rows: any[] = (data as any[]) ?? []

  // Pivot : DATE_CODE → MEMO → SUBS
  const { pivot, dates, memos } = useMemo(() => {
    const piv: Record<string, Record<string, number>> = {}
    const dateSet = new Set<string>()
    const memoSet = new Set<string>()
    for (const r of rows) {
      const dc = r.DATE_CODE; const m = r.MEMO
      if (!dc || !m) continue
      dateSet.add(dc); memoSet.add(m)
      if (!piv[dc]) piv[dc] = {}
      piv[dc][m] = Number(r.SUBS ?? 0)
    }
    // Tri DESC sur date (plus récent en haut)
    const datesArr = Array.from(dateSet).sort((a, b) => b.localeCompare(a))
    // Tri des MEMO selon ordre canonique, le reste à la fin alphabétiquement
    const memoArr = Array.from(memoSet).sort((a, b) => {
      const ia = MEMO_ORDER.indexOf(a)
      const ib = MEMO_ORDER.indexOf(b)
      const va = ia === -1 ? 999 : ia
      const vb = ib === -1 ? 999 : ib
      if (va !== vb) return va - vb
      return a.localeCompare(b)
    })
    return { pivot: piv, dates: datesArr, memos: memoArr }
  }, [rows])

  // Données chronologiques (ASC) pour les LineCharts
  const chartData = useMemo(() => {
    return [...dates].sort((a, b) => a.localeCompare(b)).map(d => ({
      date: d,
      'CHURN 30':         pivot[d]?.['CHURN 30']         ?? null,
      'CHURN 60':         pivot[d]?.['CHURN 60']         ?? null,
      'CHURN 90':         pivot[d]?.['CHURN 90']         ?? null,
      'FW_ACTIVE_30':     pivot[d]?.['FW_ACTIVE_30']     ?? null,
      'FW_ACTIVE_60':     pivot[d]?.['FW_ACTIVE_60']     ?? null,
      'FW_ACTIVE_90':     pivot[d]?.['FW_ACTIVE_90']     ?? null,
      'MFS_ACTIVE_30':    pivot[d]?.['MFS_ACTIVE_30']    ?? null,
      'MFS_ACTIVE_60':    pivot[d]?.['MFS_ACTIVE_60']    ?? null,
      'MFS_ACTIVE_90':    pivot[d]?.['MFS_ACTIVE_90']    ?? null,
      'MFS_ACTIVE_DAILY': pivot[d]?.['MFS_ACTIVE_DAILY'] ?? null,
    }))
  }, [dates, pivot])

  const handleExport = () => {
    triggerNativeDownload(
      '/customers/subs-dashboard/export.csv',
      { start_date: startDate, end_date: endDate },
      `Subs_Dashboard_${startDate}_to_${endDate}.csv`,
    )
  }

  const setPreset = (days: number) => {
    const end = new Date(); end.setDate(end.getDate() - 1)
    const start = new Date(end); start.setDate(end.getDate() - (days - 1))
    setStartDate(toIso(start)); setEndDate(toIso(end))
  }

  const toggleSeries = (s: string) => {
    setSelectedSeries(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  return (
    <DashboardLayout>
      <div>
        {/* ── HERO · title on canvas + hairline ── */}
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
              Customer · Daily snapshot
            </div>
            <h1 style={{
              margin: 0,
              fontSize: 'var(--fs-xl)', fontWeight: 600,
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--text-primary)', lineHeight: 1.15,
            }}>
              Subs Dashboard
            </h1>
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
              Daily indicators · Active agents · CHURN 30/60/90 · FW/MFS active 30/60/90 · Merchant agents · MFS active daily.
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
            <button onClick={handleExport} disabled={busy || rows.length === 0}
              title="Export pivoted CSV"
              style={{
                background: (busy || rows.length === 0) ? 'var(--surface-muted)' : 'var(--positive)',
                color: (busy || rows.length === 0) ? 'var(--text-muted)' : 'white',
                border: '1px solid ' + ((busy || rows.length === 0) ? 'var(--border-default)' : 'var(--positive)'),
                height: '34px', padding: '0 var(--space-4)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                cursor: (busy || rows.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              }}>
              <Download size={13} strokeWidth={1.75} /> Export CSV
            </button>
          </div>
        </div>

        {/* ── FILTER PANEL ── */}
        <div style={{
          background: 'var(--surface-card)',
          padding: 'var(--space-6)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-default)',
          display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap',
          gap: 'var(--space-5)',
        }}>
          <Field label="From">
            <DateInput value={startDate} max={endDate} onChange={setStartDate} />
          </Field>
          <div style={{
            fontSize: 'var(--fs-md)', color: 'var(--text-tertiary)',
            paddingBottom: '10px', fontWeight: 400,
          }}>→</div>
          <Field label="To">
            <DateInput value={endDate} min={startDate} onChange={setEndDate} />
          </Field>

          <Field label="Quick range">
            <Segmented
              options={([7, 30, 60, 90] as const).map(n => ({
                value: String(n),
                label: `${n}d`,
                active: false,
                onClick: () => setPreset(n),
              }))}
            />
          </Field>

          <div style={{
            marginLeft: 'auto',
            paddingBottom: '10px',
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
            gap: 'var(--space-1)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>Applied window</span>
            <span style={{
              fontSize: 'var(--fs-body)', fontWeight: 600,
              color: 'var(--text-primary)',
            }}>
              {startDate} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>→</span> {endDate}
            </span>
            {dates.length > 0 && (
              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--text-tertiary)' }}>
                {dates.length} days observed
              </span>
            )}
          </div>
        </div>

        {/* LEGEND */}
        <div style={{
          marginTop: 'var(--space-4)',
          display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)',
        }}>
          {Object.entries(KIND_COLOR).map(([kind, color]) => (
            <span key={kind} style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: '4px var(--space-3)',
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color }} />
              {kind === 'fw' ? 'Full Wallet' : kind === 'mfs' ? 'MFS Active' : kind === 'daily' ? 'MFS Daily' : kind.charAt(0).toUpperCase() + kind.slice(1)}
            </span>
          ))}
        </div>

        {/* ── TRENDS CHART · trigger (chart lives in modal) ── */}
        {chartData.length > 0 && (
          <div style={{
            marginTop: 'var(--space-4)',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4) var(--space-5)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            flexWrap: 'wrap',
          }}>
            <LineChartIcon size={14} strokeWidth={1.75} color="var(--text-tertiary)" />
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>Trends · all series</span>
            <span style={{
              fontSize: 'var(--fs-label)', fontWeight: 500,
              color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {selectedSeries.length} / {ALL_SERIES.length} active series
              {dates.length > 0 && ` · ${dates.length} days`}
            </span>
            <button
              onClick={() => setChartModalOpen(true)}
              title="Open trends chart"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                height: '34px', padding: '0 var(--space-4)',
                border: '1px solid var(--brand)',
                background: 'var(--brand)',
                color: 'white',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
              }}
            >
              <Maximize2 size={13} strokeWidth={1.75} />
              View trends chart
            </button>
          </div>
        )}

        {/* ── DAILY MATRIX TABLE ── */}
        <div style={{
          marginTop: 'var(--space-4)',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          {/* header bar */}
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border-default)',
            background: 'var(--surface-muted)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 600,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-uppercase)',
              }}>Daily matrix · date × memo</span>
              {!busy && dates.length > 0 && (
                <span style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 500,
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-card)',
                  padding: '1px var(--space-2)',
                  borderRadius: 'var(--radius-xs)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {dates.length} dates · {memos.length} memos
                </span>
              )}
            </div>
            {busy ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
              }}>
                <div className="spinner-small" /> <span>Loading</span>
              </div>
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                color: 'var(--positive)',
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
              }}>
                <Activity size={11} strokeWidth={1.75} /> <span>Ready</span>
              </div>
            )}
          </div>

          {busy && rows.length === 0 ? (
            <div style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Loading subs dashboard…</div>
            </div>
          ) : dates.length === 0 ? (
            <div style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
              <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
                No data for this period.
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
              <table style={{
                width: '100%', minWidth: '1000px',
                borderCollapse: 'collapse',
                fontSize: 'var(--fs-body)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr style={{ background: 'var(--surface-muted)' }}>
                    <th style={{
                      padding: 'var(--space-3) var(--space-4)',
                      textAlign: 'left',
                      fontSize: 'var(--fs-micro)', fontWeight: 600,
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: 'var(--tracking-uppercase)',
                      borderBottom: '1px solid var(--border-default)',
                      position: 'sticky', left: 0,
                      background: 'var(--surface-muted)',
                      zIndex: 3, minWidth: '120px',
                    }}>
                      Date
                    </th>
                    {memos.map(m => {
                      const kind = MEMO_KIND[m]
                      return (
                        <th key={m} style={{
                          padding: 'var(--space-3) var(--space-3)',
                          textAlign: 'right',
                          fontSize: 'var(--fs-micro)', fontWeight: 600,
                          color: 'var(--text-tertiary)',
                          textTransform: 'uppercase',
                          letterSpacing: 'var(--tracking-uppercase)',
                          borderBottom: '1px solid var(--border-default)',
                          minWidth: '100px', whiteSpace: 'nowrap',
                        }}>
                          <div style={{
                            display: 'inline-flex', alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: 'var(--space-2)',
                          }}>
                            {kind && <span style={{
                              width: '6px', height: '6px',
                              borderRadius: '50%',
                              background: KIND_COLOR[kind],
                              flexShrink: 0,
                            }} />}
                            {m}
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {dates.map((d) => (
                    <tr key={d} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        position: 'sticky', left: 0,
                        background: 'var(--surface-card)',
                      }}>
                        {formatDate(d)}
                      </td>
                      {memos.map(m => {
                        const v = pivot[d]?.[m]
                        return (
                          <td key={m} style={{
                            padding: 'var(--space-2) var(--space-3)',
                            textAlign: 'right',
                            color: 'var(--text-primary)',
                            fontWeight: 500,
                          }}>
                            {v != null && v !== 0
                              ? fmtNum(v)
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{
          marginTop: 'var(--space-2)',
          fontSize: 'var(--fs-label)',
          color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          Period queried: <strong style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{startDate}</strong> → <strong style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{endDate}</strong>
          {dates.length > 0 && <> · <strong style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{dates.length}</strong> dates displayed</>}
        </div>
      </div>

      {/* ── CHART MODAL ── */}
      {chartModalOpen && (
        <div
          onClick={() => setChartModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-6)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1400px, 96vw)',
              maxHeight: '92vh',
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28)',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: 'var(--space-4) var(--space-5)',
              borderBottom: '1px solid var(--border-default)',
              background: 'var(--surface-muted)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
              <LineChartIcon size={14} strokeWidth={1.75} color="var(--text-tertiary)" />
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 600,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-uppercase)',
              }}>Trends · expanded view</span>
              <span style={{
                fontSize: 'var(--fs-label)', fontWeight: 500,
                color: 'var(--text-secondary)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {startDate} → {endDate}
                {dates.length > 0 && ` · ${dates.length} days`}
              </span>
              <button
                onClick={() => setChartModalOpen(false)}
                title="Close"
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '28px', height: '28px',
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-card)',
                  color: 'var(--text-secondary)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>

            {/* Series chips inside modal */}
            <div style={{
              padding: 'var(--space-3) var(--space-5)',
              borderBottom: '1px solid var(--border-default)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap',
            }}>
              <button
                onClick={() => setSelectedSeries([...ALL_SERIES])}
                style={{
                  padding: '3px var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-card)',
                  color: 'var(--text-secondary)',
                  fontWeight: 500, fontSize: 'var(--fs-label)',
                  cursor: 'pointer',
                }}
              >All</button>
              <button
                onClick={() => setSelectedSeries([])}
                style={{
                  padding: '3px var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-card)',
                  color: 'var(--text-secondary)',
                  fontWeight: 500, fontSize: 'var(--fs-label)',
                  cursor: 'pointer',
                }}
              >None</button>
              <span style={{
                width: '1px', height: '16px',
                background: 'var(--border-default)',
                margin: '0 var(--space-1)',
              }} />
              {ALL_SERIES.map(s => {
                const active = selectedSeries.includes(s)
                const color = SERIES_COLOR[s]
                return (
                  <button key={s} onClick={() => toggleSeries(s)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                      padding: '3px var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid ' + (active ? 'var(--text-primary)' : 'var(--border-default)'),
                      background: active ? 'var(--surface-card)' : 'var(--surface-muted)',
                      color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      fontWeight: active ? 600 : 500,
                      fontSize: 'var(--fs-label)',
                      cursor: 'pointer',
                    }}>
                    <span style={{
                      width: '8px', height: '8px',
                      borderRadius: '50%',
                      background: color,
                      opacity: active ? 1 : 0.4,
                    }} />
                    {s}
                  </button>
                )
              })}
            </div>

            {/* Modal chart body */}
            <div style={{ padding: 'var(--space-5)', flex: 1, minHeight: 0 }}>
              {selectedSeries.length === 0 ? (
                <div style={{
                  padding: 'var(--space-16) 0', textAlign: 'center',
                  color: 'var(--text-tertiary)',
                  fontSize: 'var(--fs-body)',
                }}>
                  Select at least one series to display the chart.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(420, Math.min(720, window.innerHeight - 260))}>
                  <LineChart data={chartData} margin={{ top: 12, right: 24, left: 12, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="rgba(15,23,42,0.06)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v: string) => (v ? v.slice(5) : '')}
                      tick={{ fontSize: 11, fontWeight: 500, fill: 'var(--text-tertiary)' }}
                      stroke="var(--border-default)"
                      interval="preserveStartEnd"
                      minTickGap={20}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--border-default)' }}
                    />
                    <YAxis
                      tickFormatter={fmtNum}
                      tick={{ fontSize: 11, fontWeight: 500, fill: 'var(--text-tertiary)' }}
                      stroke="var(--border-default)"
                      width={64}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(value: any, name: any) => [fmtNum(value), name]}
                      labelFormatter={(label: any) => `Date · ${label}`}
                      contentStyle={{
                        background: 'var(--surface-card)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--fs-label)',
                        fontFamily: 'inherit',
                        padding: 'var(--space-3)',
                      }}
                      itemStyle={{ color: 'var(--text-primary)', padding: '2px 0' }}
                      labelStyle={{
                        color: 'var(--text-tertiary)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        fontSize: 'var(--fs-micro)',
                        letterSpacing: 'var(--tracking-uppercase)',
                        marginBottom: 'var(--space-2)',
                      }}
                      cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                    />
                    <Legend
                      wrapperStyle={{
                        fontSize: 'var(--fs-label)',
                        fontWeight: 500,
                        paddingTop: 'var(--space-3)',
                      }}
                      iconType="plainline"
                    />
                    {selectedSeries.map(s => (
                      <Line
                        key={s}
                        type="monotone"
                        dataKey={s}
                        name={s}
                        stroke={SERIES_COLOR[s]}
                        strokeWidth={s === 'MFS_ACTIVE_DAILY' ? 2.25 : 2}
                        strokeDasharray={s === 'MFS_ACTIVE_DAILY' ? '4 3' : undefined}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

// ── Form primitives ──

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <label style={{
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-uppercase)',
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function DateInput({ value, min, max, onChange }: { value: string, min?: string, max?: string, onChange: (v: string) => void }) {
  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
    }}>
      <Calendar size={13} strokeWidth={1.75} color="var(--text-tertiary)"
        style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
      <input type="date"
        value={value} min={min} max={max}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: '38px', width: '160px',
          paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)',
          border: 'none', background: 'transparent', outline: 'none',
          fontWeight: 500, fontSize: 'var(--fs-body)',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--text-primary)',
        }} />
    </div>
  )
}

type SegOption = {
  value: string
  label: string
  active: boolean
  title?: string
  onClick: () => void
}

function Segmented({ options }: { options: SegOption[] }) {
  return (
    <div style={{
      display: 'inline-flex',
      background: 'var(--surface-muted)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '3px',
      gap: '2px',
    }}>
      {options.map(opt => (
        <button key={opt.value || 'all'}
          onClick={opt.onClick}
          title={opt.title}
          style={{
            padding: '0 var(--space-3)', height: '30px',
            borderRadius: 'var(--radius-xs)',
            border: 'none',
            background: opt.active ? 'var(--surface-card)' : 'transparent',
            color: opt.active ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontWeight: opt.active ? 600 : 500,
            fontSize: 'var(--fs-label)',
            cursor: 'pointer',
            transition: 'background 0.12s, color 0.12s',
            boxShadow: opt.active ? '0 0 0 1px var(--border-default) inset' : 'none',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}
