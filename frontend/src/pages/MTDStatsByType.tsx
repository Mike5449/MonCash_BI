import { useState, useMemo } from "react"
import {
  Search, Download, RefreshCw, XCircle, CalendarDays,
  Users as UsersIcon, BarChart3, Wallet, DollarSign,
  TrendingUp, TrendingDown,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useMtdStatsByMonthAndType } from "../hooks/useAnalytics"
import { downloadXlsxStream, type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const TR_TYPE_LABELS: Record<string, string> = {
  CASHIN: 'Cash In', CASHIN_OTC: 'Cash In OTC',
  CASHOUT: 'Cash Out', P2P_SEND: 'P2P Send', P2P_RECEIVE: 'P2P Receive',
  PAY2MERC: 'Pay to Merchant', BILLPAY: 'Bill Payment',
  DIGI_PRODUCT: 'Digicel Products', TOPUP_GIFT: 'Top-up Gift',
  SELF_TOPUP: 'Top-up Self', IMT: 'IMT Receive',
  B2W: 'B2W (Prefunded)', PREFUNDED: 'Prefunded',
  W2B: 'Wallet to Bank', 'Payroll | disbursements': 'Payroll / Disbursements',
}

const MONTH_NAMES_EN = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]

const pad2 = (n: number) => String(n).padStart(2, '0')
const monthIso = (y: number, m: number) => `${y}-${pad2(m)}`
/** Convertit "yyyy-MM" -> ISO "yyyy-MM-01" pour l'API. */
const monthToIsoDate = (yyyyMM: string) => `${yyyyMM}-01`
/** Display "May 2026" from "2026-05" */
const monthLabel = (yyyyMM: string) => {
  const [y, m] = yyyyMM.split('-')
  return `${MONTH_NAMES_EN[parseInt(m)]} ${y}`
}
const currentYyyyMM = () => {
  const d = new Date()
  return monthIso(d.getFullYear(), d.getMonth() + 1)
}
const sixMonthsAgoYyyyMM = () => {
  const d = new Date()
  d.setDate(1); d.setMonth(d.getMonth() - 5)
  return monthIso(d.getFullYear(), d.getMonth() + 1)
}
/** Jour du mois d'hier (1..31) — sert de défaut pour borner chaque mois à la même date. */
const yesterdayDayOfMonth = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.getDate()
}

type Metric = 'SUBS' | 'VOLUME' | 'VALUE' | 'REVENUE'

const METRIC_TABS: { id: Metric; label: string; accent: string }[] = [
  { id: 'SUBS',    label: 'Subscribers',  accent: 'var(--data-subs)'    },
  { id: 'VOLUME',  label: 'Volume',       accent: 'var(--data-volume)'  },
  { id: 'VALUE',   label: 'Value (HTG)',  accent: 'var(--data-value)'   },
  { id: 'REVENUE', label: 'Revenue (HTG)', accent: 'var(--data-revenue)' },
]

interface Pivot {
  months: string[]
  rows: { tr: string; cells: number[]; total: number }[]
  colTotals: number[]
  grandTotal: number
}

function buildPivot(rows: any[], metric: Metric): Pivot {
  // Mois uniques, triés ascendant
  const months = Array.from(new Set(rows.map(r => String(r.MONTH || '')).filter(Boolean))).sort()
  // TR_TYPE uniques, triés alphabétique
  const trTypes = Array.from(new Set(rows.map(r => String(r.TR_TYPE || '')).filter(Boolean))).sort()
  // Lookup table par (TR_TYPE, MONTH)
  const map = new Map<string, any>()
  for (const r of rows) map.set(`${r.TR_TYPE}|${r.MONTH}`, r)

  const data = trTypes.map(t => {
    const cells = months.map(m => Number((map.get(`${t}|${m}`) || {})[metric] ?? 0))
    return { tr: t, cells, total: cells.reduce((s, v) => s + v, 0) }
  })
  const colTotals  = months.map((_, i) => data.reduce((s, d) => s + d.cells[i], 0))
  const grandTotal = colTotals.reduce((s, v) => s + v, 0)
  return { months, rows: data, colTotals, grandTotal }
}

export default function MTDStatsByType() {
  const [localStart, setLocalStart] = useState<string>(sixMonthsAgoYyyyMM())
  const [localEnd, setLocalEnd] = useState<string>(currentYyyyMM())
  const [localDayOfMonth, setLocalDayOfMonth] = useState<string>(String(yesterdayDayOfMonth())) // "last" | "1".."31"
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [activeMetric, setActiveMetric] = useState<Metric>('SUBS')
  const [submitted, setSubmitted] = useState({
    startMonth: sixMonthsAgoYyyyMM(),
    endMonth:   currentYyyyMM(),
    dayOfMonth: yesterdayDayOfMonth() as number | null,
  })

  const { data: rows, isLoading, isFetching, refetch } = useMtdStatsByMonthAndType({
    startMonth: monthToIsoDate(submitted.startMonth),
    endMonth:   monthToIsoDate(submitted.endMonth),
    dayOfMonth: submitted.dayOfMonth,
  })

  const handleApply = () => setSubmitted({
    startMonth: localStart,
    endMonth: localEnd,
    dayOfMonth: localDayOfMonth === "last" ? null : parseInt(localDayOfMonth, 10),
  })

  const allRows = (rows as any[] | undefined) ?? []

  const pivots = useMemo(() => ({
    SUBS:    buildPivot(allRows, 'SUBS'),
    VOLUME:  buildPivot(allRows, 'VOLUME'),
    VALUE:   buildPivot(allRows, 'VALUE'),
    REVENUE: buildPivot(allRows, 'REVENUE'),
  }), [allRows])

  const exportToExcel = async () => {
    try {
      await downloadXlsxStream(
        '/customers/mtd-stats-by-month-type/export.xlsx',
        {
          start_month:  monthToIsoDate(submitted.startMonth),
          end_month:    monthToIsoDate(submitted.endMonth),
          day_of_month: submitted.dayOfMonth ?? undefined,
        },
        `MTD_by_Month_Type_${submitted.startMonth}_to_${submitted.endMonth}.xlsx`,
        (p) => setExportProgress(p),
      )
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
            Customer · Month-to-date by type
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Month-to-Date Stats by Type
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            Aggregate by month × TR_TYPE — {monthLabel(submitted.startMonth)} → {monthLabel(submitted.endMonth)}
            {submitted.dayOfMonth !== null
              ? <span style={{ color: 'var(--text-primary)', fontWeight: 600, marginLeft: 'var(--space-2)' }}>· through day {submitted.dayOfMonth}</span>
              : <span style={{ color: 'var(--text-tertiary)', marginLeft: 'var(--space-2)' }}>· through last day (yesterday for current month)</span>}
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
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        gap: 'var(--space-3)',
      }}>
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 500,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
        }}>Range</span>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>From</span>
          <input type="month"
            value={localStart} max={localEnd}
            onChange={(e) => setLocalStart(e.target.value)}
            style={{
              width: '150px', height: '32px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontSize: 'var(--fs-body)', fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
            }} />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>To</span>
          <input type="month"
            value={localEnd} min={localStart} max={currentYyyyMM()}
            onChange={(e) => setLocalEnd(e.target.value)}
            style={{
              width: '150px', height: '32px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontSize: 'var(--fs-body)', fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
            }} />
        </div>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <CalendarDays size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Day of month</span>
          <select
            value={localDayOfMonth}
            onChange={(e) => setLocalDayOfMonth(e.target.value)}
            style={{
              width: '120px', height: '32px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid ' + (localDayOfMonth !== "last" ? 'var(--text-primary)' : 'var(--border-default)'),
              background: 'var(--surface-card)',
              fontSize: 'var(--fs-body)', fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            <option value="last">Last (default)</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
              <option key={d} value={String(d)}>Day {d}</option>
            ))}
          </select>
        </div>

        <button onClick={handleApply} disabled={busy}
          style={{
            background: 'var(--brand)', color: 'white',
            border: '1px solid var(--brand)',
            height: '32px', padding: '0 var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontWeight: 500, fontSize: 'var(--fs-body)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            opacity: busy ? 0.5 : 1,
            marginLeft: 'auto',
          }}>
          {busy ? <div className="spinner-small" /> : <Search size={13} strokeWidth={1.75} />} Run
        </button>
      </div>

      {/* ── 4 PIVOT TABLES — un par métrique ── */}
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
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Aggregating monthly stats…</div>
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
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>No data for this range.</div>
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
                subtitle="Distinct MSISDN per month (MTD)"
                icon={<UsersIcon size={14} strokeWidth={1.75} />}
                accent="var(--data-subs)"
                pivot={pivots.SUBS}
                hideGrandTotal
              />
            )}
            {activeMetric === 'VOLUME' && (
              <PivotTable
                title="Volume"
                subtitle="Distinct transactions per month (MTD)"
                icon={<BarChart3 size={14} strokeWidth={1.75} />}
                accent="var(--data-volume)"
                pivot={pivots.VOLUME}
              />
            )}
            {activeMetric === 'VALUE' && (
              <PivotTable
                title="Value (HTG)"
                subtitle="Sum of ORIGINALAMOUNT per month (MTD)"
                icon={<Wallet size={14} strokeWidth={1.75} />}
                accent="var(--data-value)"
                pivot={pivots.VALUE}
              />
            )}
            {activeMetric === 'REVENUE' && (
              <PivotTable
                title="Revenue (HTG)"
                subtitle="Sum of CHARGEAMOUNT per month (MTD)"
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

// ── Pivot Table component ──
function PivotTable({ title, subtitle, icon, accent, pivot, hideGrandTotal = false }: {
  title: string
  subtitle: string
  icon: React.ReactNode
  accent: string
  pivot: Pivot
  /** Quand `true`, la colonne et la ligne « Grand Total » ne sont PAS affichées
   *  (utile pour Subscribers : sommer des COUNT(DISTINCT) cross-mois/produits
   *  double-compte les MSISDN actifs sur plusieurs périodes/produits). */
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
      {/* Stripe accent en haut */}
      <div style={{ height: '3px', background: accent }} />

      {/* Header de la card */}
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
        }}>
          {icon}
        </span>
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
          {pivot.rows.length} TR_TYPE · {pivot.months.length} months
        </span>
      </div>

      {/* Pivot table */}
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
              {pivot.months.map(m => (
                <th key={m} style={{
                  textAlign: 'right',
                  padding: 'var(--space-2) var(--space-4)',
                  fontSize: 'var(--fs-micro)', fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                  borderBottom: '1px solid var(--border-default)',
                  whiteSpace: 'nowrap',
                  minWidth: '110px',
                }}>{m}</th>
              ))}
              {/* Colonne Grand Total (somme par TR_TYPE) — masquée pour Subscribers */}
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
                  minWidth: '120px',
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
                }}>
                  {TR_TYPE_LABELS[row.tr] || row.tr}
                </td>
                {row.cells.map((c, i) => {
                  // Compare with previous month (skip for i=0)
                  const prev = i > 0 ? row.cells[i - 1] : null
                  const isUp = prev !== null && c > prev
                  const isDown = prev !== null && c < prev
                  return (
                    <td key={i} style={{
                      textAlign: 'right',
                      padding: 'var(--space-2) var(--space-4)',
                      color: c > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontWeight: 500,
                    }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
                        gap: '4px',
                      }}>
                        {isUp   && <TrendingUp   size={11} strokeWidth={2} color="var(--positive)" />}
                        {isDown && <TrendingDown size={11} strokeWidth={2} color="var(--negative)" />}
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
            {/* Grand Total row — masquée pour Subscribers (sommer des DISTINCT n'a pas de sens) */}
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
                const isUp = prev !== null && c > prev
                const isDown = prev !== null && c < prev
                return (
                  <td key={i} style={{
                    textAlign: 'right',
                    padding: 'var(--space-3) var(--space-4)',
                    color: accent, fontWeight: 800,
                    borderTop: '2px solid ' + accent,
                  }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
                      gap: '4px',
                    }}>
                      {isUp   && <TrendingUp   size={12} strokeWidth={2.25} color="var(--positive)" />}
                      {isDown && <TrendingDown size={12} strokeWidth={2.25} color="var(--negative)" />}
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

