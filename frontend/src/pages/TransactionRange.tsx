import { useState, useMemo, Fragment } from "react"
import {
  RefreshCw, Download, Users as UsersIcon, BarChart3, Wallet,
  ChevronDown, Check, XCircle, Filter
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useTransactionRange } from "../hooks/useAnalytics"
import { downloadXlsxStream, type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

type MetricKey = 'SUBS' | 'VOLUME' | 'VALUE'

const TIER_ORDER = [
  'T00 : 0 - 19', 'T01 : 20 - 99', 'T02 : 100 - 249', 'T03 : 250 - 499',
  'T04 : 500 - 999', 'T05 : 1000 - 1999', 'T06 : 2000 - 3999', 'T07 : 4000 - 7999',
  'T08 : 8000 - 11999', 'T09 : 12000 - 19999', 'T10 : 20000 - 39999',
  'T11 : 40000 - 59999', 'T12 : 60000 - 75000', 'T13 : 75K+',
]

const SERVICENAMES: { id: string, label: string }[] = [
  { id: 'Cash In Self',            label: 'Cash In Self'           },
  { id: 'Cash In',                 label: 'Cash In (OTC)'          },
  { id: 'Cash Out',                label: 'Cash Out'               },
  { id: 'P2P_SEND',                label: 'P2P Send'               },
  { id: 'P2P_RECEIVE',             label: 'P2P Receive'            },
  { id: 'PAY2MERC',                label: 'Pay to Merchant'        },
  { id: 'BILLPAY',                 label: 'Bill Payment'           },
  { id: 'DIGI_PRODUCT',            label: 'Digicel Products'       },
  { id: 'TOPUP_GIFT',              label: 'Top-up Gift'            },
  { id: 'SELF_TOPUP',              label: 'Top-up Self'            },
  { id: 'IMT',                     label: 'IMT Receive'            },
  { id: 'B2W',                     label: 'B2W (Prefunded)'        },
  { id: 'PREFUNDED',               label: 'Prefunded'              },
  { id: 'W2B',                     label: 'Wallet to Bank'         },
  { id: 'Payroll | disbursements', label: 'Payroll / Disbursements' },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtMoney = (v: any) => {
  const n = Number(v ?? 0)
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + ' M'
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + ' K'
  return n.toFixed(0)
}

const currentYear = new Date().getFullYear()
const AVAILABLE_YEARS = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3]

export default function TransactionRange() {
  const [year, setYear]            = useState<number>(currentYear)
  const [month, setMonth]          = useState<number | 'all'>('all')  // 0-11 ou 'all'
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [showServiceDropdown, setShowServiceDropdown] = useState(false)
  const [metric, setMetric]        = useState<MetricKey>('VOLUME')
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv')
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)

  // Date range basé sur année + mois
  const { startDate, endDate } = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    if (month === 'all') {
      const start = `${year}-01-01`
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
      const yYear = yesterday.getFullYear()
      const endY = Math.min(year, yYear)
      const endM = endY < year ? 12 : (yYear === year ? yesterday.getMonth() + 1 : 12)
      const endD = endY < year ? 31 : (yYear === year ? yesterday.getDate() : 31)
      return { startDate: start, endDate: `${endY}-${pad(endM)}-${pad(endD)}` }
    } else {
      const m = month + 1
      const lastDay = new Date(year, m, 0).getDate()
      return { startDate: `${year}-${pad(m)}-01`, endDate: `${year}-${pad(m)}-${pad(lastDay)}` }
    }
  }, [year, month])

  const { data, isLoading, isFetching, refetch } = useTransactionRange({
    startDate, endDate,
    serviceNames: selectedServices.length > 0 ? selectedServices : undefined,
  })

  const busy = isLoading || isFetching
  const rows: any[] = data ?? []

  // Mois présents dans les données (triés)
  const monthsInData = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.DATE_CODE) set.add(r.DATE_CODE)
    return Array.from(set).sort()
  }, [rows])

  // Pivot : SERVICENAME → TIER → { month: value }
  const pivot = useMemo(() => {
    const metricKey = metric === 'VOLUME' ? 'TR_VOLUME' : metric === 'SUBS' ? 'DISTINCT_SUBS' : 'TR_VALUE'
    const grouped: Record<string, Record<string, Record<string, number>>> = {}
    for (const r of rows) {
      const svc = r.SERVICENAME || '—'
      const tier = r.TIER || '—'
      if (!grouped[svc]) grouped[svc] = {}
      if (!grouped[svc][tier]) grouped[svc][tier] = {}
      grouped[svc][tier][r.DATE_CODE] = Number(r[metricKey] ?? 0)
    }
    return grouped
  }, [rows, metric])

  // Liste des services présents, triés selon l'ordre de SERVICENAMES (ou alphabétique sinon)
  const sortedServices = useMemo(() => {
    const services = Object.keys(pivot)
    const orderMap = new Map(SERVICENAMES.map((s, i) => [s.id, i]))
    return services.sort((a, b) => {
      const ia = orderMap.has(a) ? orderMap.get(a)! : 999
      const ib = orderMap.has(b) ? orderMap.get(b)! : 999
      if (ia !== ib) return ia - ib
      return a.localeCompare(b)
    })
  }, [pivot])

  // Total par (service, month)
  const totalRow = (service: string): Record<string, number> => {
    const totals: Record<string, number> = {}
    for (const m of monthsInData) totals[m] = 0
    const tiers = pivot[service] || {}
    for (const t in tiers) {
      for (const m in tiers[t]) {
        totals[m] = (totals[m] || 0) + (tiers[t][m] || 0)
      }
    }
    return totals
  }

  const monthLabel = (dateCode: string) => {
    const [y, m] = dateCode.split('-')
    return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`
  }

  const formatCell = (v: number) => metric === 'VALUE' ? fmtMoney(v) : fmtNum(v)

  const toggleService = (id: string) =>
    setSelectedServices(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])

  const clearServices = () => setSelectedServices([])

  const handleExport = async () => {
    const fileName = `Transaction_Range_${metric}_${startDate}_to_${endDate}`
    const params = {
      start_date:    startDate,
      end_date:      endDate,
      metric,
    }
    // Note: service_names array doesn't work with simple params helper — inline fetch for arrays
    const { OpenAPI } = await import("../api/core/OpenAPI")
    const qs = new URLSearchParams(Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]))
    selectedServices.forEach(s => qs.append('service_names', s))

    const ext = exportFormat
    const path = `/customers/transaction-range/export.${ext}`
    const url = `${OpenAPI.BASE}${path}?${qs.toString()}`

    if (exportFormat === 'csv') {
      const a = document.createElement('a')
      a.href = url; a.download = `${fileName}.csv`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      return
    }

    // XLSX → fetch + blob + overlay
    setIsExporting(true)
    setExportProgress({ bytesReceived: 0, totalBytes: 0, phase: 'Génération du fichier côté serveur…' })
    try {
      await downloadXlsxStream(path, { ...params }, `${fileName}.xlsx`, (p) => setExportProgress(p))
    } catch (e) {
      console.error("Export failed", e)
      alert("L'export a échoué — voir la console.")
    } finally {
      setIsExporting(false)
      setExportProgress(null)
    }
  }

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
            Customer · Transaction range · By tier × month
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Transaction Range
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
          }}>
            Distribution of transactions by <strong style={{ fontWeight: 600 }}>amount tier</strong> and <strong style={{ fontWeight: 600 }}>month</strong>, broken down by service.
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
            title={`Export active metric (${metric}) pivoted`}
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
            {isExporting ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <Download size={13} strokeWidth={1.75} />}
            {isExporting ? "Exporting" : `Export ${metric}`}
          </button>
        </div>
      </div>

      {/* ── FILTERS BAR ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap',
        gap: 'var(--space-3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Year</span>
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}
            style={{
              height: '32px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}>
            {AVAILABLE_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Month</span>
          <select value={month === 'all' ? 'all' : String(month)}
            onChange={(e) => setMonth(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))}
            style={{
              height: '32px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}>
            <option value="all">All months</option>
            {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
        </div>

        {/* Service multi-select */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowServiceDropdown(!showServiceDropdown)}
            style={{
              height: '32px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid ' + (selectedServices.length > 0 ? 'var(--text-primary)' : 'var(--border-default)'),
              background: 'var(--surface-card)',
              color: 'var(--text-primary)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            <Filter size={12} strokeWidth={1.75} />
            {selectedServices.length === 0 ? 'All services' : `${selectedServices.length} selected`}
            <ChevronDown size={12} strokeWidth={1.75} />
          </button>
          {showServiceDropdown && (
            <>
              <div onClick={() => setShowServiceDropdown(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
              <div style={{
                position: 'absolute', top: '38px', left: 0, zIndex: 100,
                background: 'var(--surface-card)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                width: '280px', maxHeight: '400px', overflowY: 'auto',
              }}>
                <div style={{
                  padding: 'var(--space-2) var(--space-3)',
                  borderBottom: '1px solid var(--border-default)',
                  background: 'var(--surface-muted)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{
                    fontSize: 'var(--fs-micro)', fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                  }}>Services ({selectedServices.length})</span>
                  {selectedServices.length > 0 && (
                    <button onClick={clearServices} style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--brand)',
                      fontSize: 'var(--fs-label)', fontWeight: 500,
                      cursor: 'pointer',
                    }}>Clear</button>
                  )}
                </div>
                {SERVICENAMES.map(s => {
                  const checked = selectedServices.includes(s.id)
                  return (
                    <label key={s.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        padding: 'var(--space-2) var(--space-3)',
                        cursor: 'pointer',
                        fontSize: 'var(--fs-body)', fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}
                      onClick={() => toggleService(s.id)}>
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
                      {s.label}
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Format toggle */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Export</span>
          <button onClick={() => setExportFormat('csv')}
            style={{
              padding: '0 var(--space-3)', height: '28px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid ' + (exportFormat === 'csv' ? 'var(--text-primary)' : 'var(--border-default)'),
              background: exportFormat === 'csv' ? 'var(--text-primary)' : 'var(--surface-card)',
              color: exportFormat === 'csv' ? 'white' : 'var(--text-secondary)',
              fontWeight: 500, fontSize: 'var(--fs-label)',
              cursor: 'pointer',
            }}>CSV</button>
          <button onClick={() => setExportFormat('xlsx')}
            style={{
              padding: '0 var(--space-3)', height: '28px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid ' + (exportFormat === 'xlsx' ? 'var(--text-primary)' : 'var(--border-default)'),
              background: exportFormat === 'xlsx' ? 'var(--text-primary)' : 'var(--surface-card)',
              color: exportFormat === 'xlsx' ? 'white' : 'var(--text-secondary)',
              fontWeight: 500, fontSize: 'var(--fs-label)',
              cursor: 'pointer',
            }}>XLSX</button>
        </div>
      </div>

      {/* ── METRIC TABS · bottom-border ── */}
      <div style={{
        marginTop: 'var(--space-6)',
        display: 'flex', gap: 'var(--space-6)',
        borderBottom: '1px solid var(--border-default)',
      }}>
        <MetricTab active={metric === 'VOLUME'} onClick={() => setMetric('VOLUME')} icon={<BarChart3 size={13} strokeWidth={1.75} />} label="Volume" />
        <MetricTab active={metric === 'SUBS'}   onClick={() => setMetric('SUBS')}   icon={<UsersIcon size={13} strokeWidth={1.75} />}  label="Subs" />
        <MetricTab active={metric === 'VALUE'}  onClick={() => setMetric('VALUE')}  icon={<Wallet size={13} strokeWidth={1.75} />}     label="Value (HTG)" />
      </div>

      {/* ── PIVOT TABLE ── */}
      <div style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderTop: 'none',
        borderRadius: '0 0 var(--radius-md) var(--radius-md)',
        overflow: 'hidden',
      }}>
        {busy && rows.length === 0 ? (
          <div style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
            <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Loading transaction range…</div>
          </div>
        ) : monthsInData.length === 0 ? (
          <div style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <XCircle size={24} strokeWidth={1.5} style={{ opacity: 0.4 }} />
            <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>No data for this period.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontSize: 'var(--fs-body)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: '900px',
            }}>
              <thead>
                <tr style={{ background: 'var(--surface-muted)' }}>
                  <th style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: 'left',
                    fontSize: 'var(--fs-micro)', fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                    borderBottom: '1px solid var(--border-default)',
                    position: 'sticky', left: 0,
                    background: 'var(--surface-muted)',
                    zIndex: 1, minWidth: '220px',
                  }}>
                    Service · tier
                  </th>
                  {monthsInData.map(m => (
                    <th key={m} style={{
                      padding: 'var(--space-2) var(--space-3)',
                      textAlign: 'right',
                      fontSize: 'var(--fs-micro)', fontWeight: 500,
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: 'var(--tracking-uppercase)',
                      borderBottom: '1px solid var(--border-default)',
                      minWidth: '90px',
                    }}>
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedServices.map((service, sIdx) => {
                  const tiers = pivot[service] || {}
                  const tierKeys = Object.keys(tiers).sort((a, b) => {
                    const ia = TIER_ORDER.indexOf(a)
                    const ib = TIER_ORDER.indexOf(b)
                    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
                  })
                  const totals = totalRow(service)
                  const labelMatch = SERVICENAMES.find(s => s.id === service)
                  const displayName = labelMatch ? labelMatch.label : service
                  return (
                    <Fragment key={service}>
                      <tr style={{
                        background: 'var(--surface-muted)',
                        borderTop: sIdx > 0 ? '1px solid var(--border-default)' : 'none',
                      }}>
                        <td colSpan={monthsInData.length + 1} style={{
                          padding: 'var(--space-2) var(--space-4)',
                          fontSize: 'var(--fs-micro)', fontWeight: 500,
                          color: 'var(--text-tertiary)',
                          textTransform: 'uppercase',
                          letterSpacing: 'var(--tracking-uppercase)',
                          borderBottom: '1px solid var(--border-default)',
                        }}>
                          {displayName}
                        </td>
                      </tr>
                      {tierKeys.map((tier) => (
                        <tr key={tier} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                          <td style={{
                            padding: 'var(--space-2) var(--space-4) var(--space-2) var(--space-8)',
                            fontWeight: 500,
                            color: 'var(--text-secondary)',
                            position: 'sticky', left: 0,
                            background: 'var(--surface-card)',
                          }}>
                            {tier}
                          </td>
                          {monthsInData.map(m => (
                            <td key={m} style={{
                              padding: 'var(--space-2) var(--space-3)',
                              textAlign: 'right',
                              color: 'var(--text-primary)',
                            }}>
                              {tiers[tier][m] != null
                                ? formatCell(tiers[tier][m])
                                : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr style={{
                        background: 'var(--surface-muted)',
                        borderTop: '1px solid var(--border-default)',
                      }}>
                        <td style={{
                          padding: 'var(--space-2) var(--space-4) var(--space-2) var(--space-8)',
                          fontWeight: 600,
                          fontSize: 'var(--fs-micro)',
                          color: 'var(--text-primary)',
                          textTransform: 'uppercase',
                          letterSpacing: 'var(--tracking-uppercase)',
                          position: 'sticky', left: 0,
                          background: 'var(--surface-muted)',
                        }}>
                          Total
                        </td>
                        {monthsInData.map(m => (
                          <td key={m} style={{
                            padding: 'var(--space-2) var(--space-3)',
                            textAlign: 'right',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                          }}>
                            {formatCell(totals[m] || 0)}
                          </td>
                        ))}
                      </tr>
                    </Fragment>
                  )
                })}
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
      </div>

      <ExportOverlay progress={exportProgress} />
    </DashboardLayout>
  )
}

function MetricTab({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) 0',
        background: 'transparent',
        border: 'none',
        borderBottom: '2px solid ' + (active ? 'var(--brand)' : 'transparent'),
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        fontWeight: 500,
        fontSize: 'var(--fs-body)',
        cursor: 'pointer',
        marginBottom: '-1px',
      }}>
      {icon} {label}
    </button>
  )
}
