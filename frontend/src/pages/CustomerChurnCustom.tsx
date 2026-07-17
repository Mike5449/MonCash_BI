import { useState, useMemo } from "react"
import {
  RefreshCw, Download, UserMinus, Search, TrendingDown, Activity,
  MapPin, XCircle, Check
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useCustomerChurnCustomEnriched } from "../hooks/useAnalytics"
import { downloadXlsxStream, triggerNativeDownload, type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const DISPLAY_LIMIT = 500
const EXPORT_LIMIT = 2_000_000

const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US')

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
const minusDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}
const formatDisplayDate = (s?: string) => {
  if (!s) return 'N/A'
  const parts = s.split('-')
  if (parts.length !== 3) return s
  return `${parts[1]}/${parts[2].slice(0, 2)}/${parts[0]}`
}

const STATUS_COLORS: Record<string, string> = {
  Active: 'var(--positive)', 'Pending Active': 'var(--data-subs)', Suspended: 'var(--negative)',
  Dormant: 'var(--text-tertiary)', Frozen: 'var(--data-value)', Closed: 'var(--text-secondary)',
}

type ExportColumn = { key: string; label: string; pick: (r: any) => any }
const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "MSISDN",         label: "MSISDN",          pick: (r) => r.MSISDN ?? "" },
  { key: "NAME",           label: "Full Name",       pick: (r) => r.IDENTITYNAME ?? "" },
  { key: "GENDER",         label: "Gender",          pick: (r) => r.GENDER ?? "" },
  { key: "STATUS",         label: "Account Status",  pick: (r) => r.STATUS ?? "" },
  { key: "WALLET",         label: "Wallet Type",     pick: (r) => r.KYC ?? "" },
  { key: "BALANCE",        label: "Balance (HTG)",   pick: (r) => Number(r.BALANCE ?? 0) },
  { key: "ADDRESS",        label: "Address",         pick: (r) => r.ADDRESS || "N/A" },
  { key: "IMT_OPT_IN",     label: "IMT Opt-in",      pick: (r) => r.IMTOPTIN ?? "" },
  { key: "ID_TYPE",        label: "ID Type",         pick: (r) => r.ID_TYPE ?? "" },
  { key: "ID_NUMBER",      label: "ID Number",       pick: (r) => r.ID_NUMBER ?? "" },
  { key: "IDNUMBER_CLEAN", label: "ID Number Clean", pick: (r) => r.IDNUMBER_CLEAN ?? "" },
  { key: "ID_CLEAN",       label: "ID Clean Flag",   pick: (r) => r.ID_CLEAN ?? "" },
  { key: "ID_STATUS",      label: "ID Status",       pick: (r) => r.ID_STATUS ?? "" },
  { key: "ID_EXPIRY",      label: "ID Expiry",       pick: (r) => formatDisplayDate(r.ID_EXPIRY_DATE) },
  { key: "CREATED",        label: "Created Date",    pick: (r) => formatDisplayDate(r.CREATED_DATE) },
  { key: "SECTOR",         label: "Sector",          pick: (r) => r.SECTOR ?? "" },
  { key: "CITY",           label: "City",            pick: (r) => r.CITY ?? "" },
  { key: "DEPARTMENT",     label: "Department",      pick: (r) => r.DEPARTMENT ?? "" },
  { key: "ZONE",           label: "Zone (Cluster)",  pick: (r) => r.ZONE ?? "" },
  { key: "LAST_TR_TYPE",   label: "Last TR Type",    pick: (r) => r.LAST_TR_TYPE ?? "" },
  { key: "LAST_TX",        label: "Last TX Date",    pick: (r) => formatDisplayDate(r.LAST_TX) },
]

export default function CustomerChurnCustom() {
  const [localActiveStart, setLocalActiveStart]   = useState<string>(minusDays(60))
  const [localActiveEnd,   setLocalActiveEnd]     = useState<string>(minusDays(31))
  const [localExcludeStart, setLocalExcludeStart] = useState<string>(minusDays(30))
  const [localExcludeEnd,   setLocalExcludeEnd]   = useState<string>(todayMinus1())

  const [submittedActiveStart,  setSubmittedActiveStart]   = useState<string>(minusDays(60))
  const [submittedActiveEnd,    setSubmittedActiveEnd]     = useState<string>(minusDays(31))
  const [submittedExcludeStart, setSubmittedExcludeStart]  = useState<string>(minusDays(30))
  const [submittedExcludeEnd,   setSubmittedExcludeEnd]    = useState<string>(todayMinus1())

  const [search, setSearch] = useState("")
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [selectedExportCols, setSelectedExportCols] = useState<string[]>(EXPORT_COLUMNS.map(c => c.key))
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv')
  const [exportMode, setExportMode] = useState<'list' | 'enriched'>('list')

  const { data, isLoading, isFetching, refetch } = useCustomerChurnCustomEnriched({
    activeStart:  submittedActiveStart,
    activeEnd:    submittedActiveEnd,
    excludeStart: submittedExcludeStart,
    excludeEnd:   submittedExcludeEnd,
    limit:        DISPLAY_LIMIT,
  })

  const busy = isLoading || isFetching
  const rows: any[] = data?.rows ?? []
  const totalCount = data?.churn_count ?? 0
  const activeWin  = data?.active_window
  const excludeWin = data?.exclude_window

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r: any) =>
      String(r.MSISDN ?? '').toLowerCase().includes(s) ||
      String(r.IDENTITYNAME ?? '').toLowerCase().includes(s) ||
      String(r.DEPARTMENT ?? '').toLowerCase().includes(s) ||
      String(r.CITY ?? '').toLowerCase().includes(s) ||
      String(r.LAST_TR_TYPE ?? '').toLowerCase().includes(s)
    )
  }, [rows, search])

  const handleApply = () => {
    setSubmittedActiveStart(localActiveStart)
    setSubmittedActiveEnd(localActiveEnd)
    setSubmittedExcludeStart(localExcludeStart)
    setSubmittedExcludeEnd(localExcludeEnd)
  }

  const toggleExportCol = (key: string) =>
    setSelectedExportCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const runExport = async () => {
    if (selectedExportCols.length === 0) return
    setShowExportModal(false)
    const baseName = `Customer_Churn_${submittedActiveStart}_to_${submittedActiveEnd}_excl_${submittedExcludeStart}_to_${submittedExcludeEnd}`

    const commonParams = {
      active_start:  submittedActiveStart,
      active_end:    submittedActiveEnd,
      exclude_start: submittedExcludeStart,
      exclude_end:   submittedExcludeEnd,
      limit:         EXPORT_LIMIT,
      mode:          exportMode,
      columns:       exportMode === 'enriched' ? selectedExportCols.join(',') : undefined,
    }

    if (exportFormat === 'csv') {
      triggerNativeDownload(
        '/customers/churn-custom/export.csv',
        commonParams,
        `${baseName}_${exportMode}.csv`,
      )
      return
    }

    setIsExporting(true)
    try {
      await downloadXlsxStream(
        '/customers/churn-custom/export.xlsx',
        commonParams,
        `${baseName}_${exportMode}.xlsx`,
        (p) => setExportProgress(p),
      )
    } catch (e) {
      console.error("Export failed", e)
      alert("L'export a échoué — voir la console.")
    } finally {
      setIsExporting(false)
      setExportProgress(null)
    }
  }

  const Dash = () => <span style={{ color: 'var(--text-muted)' }}>—</span>

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
            Customer · Churn · Free windows
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Customer Churn — Custom Periods
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
          }}>
            MSISDN who <strong style={{ fontWeight: 600 }}>transacted</strong> during the <strong style={{ fontWeight: 600 }}>active period</strong> but <strong style={{ fontWeight: 600 }}>did not transact</strong> during the <strong style={{ fontWeight: 600 }}>exclude period</strong> — with profile, location, and last TR type.
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
          <button onClick={() => setShowExportModal(true)} disabled={busy || isExporting || totalCount === 0}
            title="Choose columns to export"
            style={{
              background: (busy || isExporting || totalCount === 0) ? 'var(--surface-muted)' : 'var(--positive)',
              color: (busy || isExporting || totalCount === 0) ? 'var(--text-muted)' : 'white',
              border: '1px solid ' + ((busy || isExporting || totalCount === 0) ? 'var(--border-default)' : 'var(--positive)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: (busy || isExporting || totalCount === 0) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            {isExporting ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <Download size={13} strokeWidth={1.75} />}
            {isExporting ? "Exporting" : "Export"}
          </button>
        </div>
      </div>

      {/* ── PERIODS CONTROL ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr auto',
        gap: 'var(--space-5)',
        alignItems: 'end',
      }}>
        <PeriodGroup
          label="Active period" sublabel="must have transacted" accent="var(--data-subs)"
          start={localActiveStart} setStart={setLocalActiveStart}
          end={localActiveEnd} setEnd={setLocalActiveEnd}
        />
        <PeriodGroup
          label="Exclude period" sublabel="did NOT transact" accent="var(--negative)"
          start={localExcludeStart} setStart={setLocalExcludeStart}
          end={localExcludeEnd} setEnd={setLocalExcludeEnd}
        />
        <button onClick={handleApply} disabled={busy}
          style={{
            background: 'var(--brand)', color: 'white',
            border: '1px solid var(--brand)',
            height: '32px', padding: '0 var(--space-5)',
            borderRadius: 'var(--radius-md)',
            fontWeight: 500, fontSize: 'var(--fs-body)',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.5 : 1,
          }}>
          Apply
        </button>
      </div>

      {/* ── KPI + INFO ── */}
      <div style={{
        marginTop: 'var(--space-4)',
        display: 'grid', gridTemplateColumns: '320px 1fr',
        gap: 'var(--space-3)',
      }}>
        <KpiCard count={totalCount} loading={busy} />
        <InfoCard activeWin={activeWin} excludeWin={excludeWin} totalCount={totalCount} displayed={rows.length} />
      </div>

      {/* ── TABLE ── */}
      <div style={{
        marginTop: 'var(--space-4)',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--surface-muted)',
          display: 'flex', alignItems: 'center',
          gap: 'var(--space-3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <UserMinus size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>Churners</span>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              padding: '1px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtNum(filtered.length)} / {fmtNum(totalCount)}
            </span>
          </div>
          <div style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            background: 'var(--surface-card)',
            padding: 'var(--space-1) var(--space-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
          }}>
            <Search size={12} strokeWidth={1.75} color="var(--text-tertiary)" />
            <input
              type="text"
              placeholder="Filter MSISDN / name / city / department / last TR…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                border: 'none', background: 'transparent', outline: 'none',
                fontSize: 'var(--fs-body)', fontWeight: 500,
                width: '320px',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{
            width: '100%', minWidth: '2700px',
            borderCollapse: 'collapse',
            fontSize: 'var(--fs-body)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <thead style={{ background: 'var(--surface-muted)' }}>
              <tr>
                {['MSISDN','Name','Gender','Status','Wallet','Balance','Last TR type','Last TX','Sector','City','Department','Zone','Address','IMT','ID type','ID number','ID status','Expiry','Created'].map((h, i) => (
                  <th key={h} style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: i === 5 ? 'right' : 'left',
                    fontSize: 'var(--fs-micro)', fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                    borderBottom: '1px solid var(--border-default)',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {busy && rows.length === 0 ? (
                <tr><td colSpan={19} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Loading churners…</div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={19} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
                    {totalCount === 0 ? "No churner for this period combination." : "No results match the filter."}
                  </div>
                </td></tr>
              ) : filtered.map((r: any, idx: number) => {
                const statusDot = STATUS_COLORS[r.STATUS] || 'var(--text-tertiary)'
                return (
                  <tr key={(r.MSISDN ?? '') + idx} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-body)', fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}>{r.MSISDN}</span>
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      color: 'var(--text-primary)', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {r.IDENTITYNAME || <Dash />}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                      {r.GENDER || <Dash />}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{
                          width: '6px', height: '6px',
                          borderRadius: '50%',
                          background: statusDot,
                        }} />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.STATUS || '—'}</span>
                      </div>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        border: '1px solid var(--border-default)',
                        background: 'var(--surface-card)',
                        padding: '1px var(--space-2)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: 'var(--fs-micro)', fontWeight: 500,
                        color: 'var(--text-primary)',
                        textTransform: 'uppercase',
                        letterSpacing: 'var(--tracking-uppercase)',
                      }}>
                        {r.KYC || '—'}
                      </span>
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      textAlign: 'right',
                      color: 'var(--text-primary)', fontWeight: 500,
                    }}>
                      {Number(r.BALANCE ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      {r.LAST_TR_TYPE
                        ? <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.LAST_TR_TYPE}</span>
                        : <Dash />}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                      {formatDisplayDate(r.LAST_TX)}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{r.SECTOR || <Dash />}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{r.CITY || <Dash />}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{r.DEPARTMENT || <Dash />}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      {r.ZONE
                        ? <span style={{
                            border: '1px solid var(--border-default)',
                            background: 'var(--surface-card)',
                            padding: '1px var(--space-2)',
                            borderRadius: 'var(--radius-xs)',
                            fontSize: 'var(--fs-micro)', fontWeight: 500,
                            color: 'var(--text-primary)',
                          }}>{r.ZONE}</span>
                        : <Dash />}
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      color: 'var(--text-secondary)',
                    }}>
                      {(!r.ADDRESS || r.ADDRESS.toLowerCase() === 'default')
                        ? <Dash />
                        : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <MapPin size={11} strokeWidth={1.75} color="var(--text-tertiary)" /> {r.ADDRESS}
                          </span>
                        )}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      {r.IMTOPTIN || <Dash />}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                      {r.ID_TYPE || <Dash />}
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      fontFamily: 'ui-monospace, monospace',
                      color: r.ID_NUMBER ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}>
                      {r.ID_NUMBER || '—'}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        color: r.ID_STATUS === 'Expired' ? 'var(--negative)' : r.ID_STATUS === 'Valid' ? 'var(--positive)' : 'var(--text-tertiary)',
                        fontWeight: 500,
                      }}>
                        {r.ID_STATUS || '—'}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                      {formatDisplayDate(r.ID_EXPIRY_DATE)}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-tertiary)' }}>
                      {formatDisplayDate(r.CREATED_DATE)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTop: '1px solid var(--border-default)',
          background: 'var(--surface-muted)',
        }}>
          <div style={{
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-label)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            Display limited to <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(DISPLAY_LIMIT)}</strong> rows · export retrieves <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>all</strong> churners ({fmtNum(totalCount)})
          </div>
        </div>
      </div>

      {/* EXPORT PROGRESS OVERLAY */}
      <ExportOverlay progress={exportProgress} />

      {/* ── EXPORT MODAL ── */}
      {showExportModal && (
        <div onClick={() => !isExporting && setShowExportModal(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface-card)',
              borderRadius: 'var(--radius-md)',
              width: '480px', maxWidth: '92vw',
              overflow: 'hidden',
              border: '1px solid var(--border-default)',
            }}>
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid var(--border-default)',
              background: 'var(--surface-muted)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{
                  fontSize: 'var(--fs-md)', fontWeight: 600,
                  color: 'var(--text-primary)',
                }}>Export · Customer churn</div>
                <div style={{
                  fontSize: 'var(--fs-micro)',
                  color: 'var(--text-tertiary)',
                  marginTop: '2px',
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                }}>Choose columns to include</div>
              </div>
              <button onClick={() => !isExporting && setShowExportModal(false)} disabled={isExporting}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  padding: 'var(--space-1)',
                  borderRadius: 'var(--radius-xs)',
                }} title="Close">
                <XCircle size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div style={{ padding: 'var(--space-4)', maxHeight: '50vh', overflowY: 'auto' }}>
              {/* Mode toggle */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--surface-muted)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-2)',
                border: '1px solid var(--border-faint)',
              }}>
                <span style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 500,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                }}>Mode</span>
                <button onClick={() => setExportMode('list')}
                  style={{
                    padding: '0 var(--space-3)', height: '28px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid ' + (exportMode === 'list' ? 'var(--text-primary)' : 'var(--border-default)'),
                    background: exportMode === 'list' ? 'var(--text-primary)' : 'var(--surface-card)',
                    color: exportMode === 'list' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 500, fontSize: 'var(--fs-label)',
                    cursor: 'pointer',
                  }}>MSISDN only</button>
                <button onClick={() => setExportMode('enriched')}
                  style={{
                    padding: '0 var(--space-3)', height: '28px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid ' + (exportMode === 'enriched' ? 'var(--text-primary)' : 'var(--border-default)'),
                    background: exportMode === 'enriched' ? 'var(--text-primary)' : 'var(--surface-card)',
                    color: exportMode === 'enriched' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 500, fontSize: 'var(--fs-label)',
                    cursor: 'pointer',
                  }}>Enriched (profile + location)</button>
              </div>

              {/* Format toggle */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--surface-muted)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-3)',
                border: '1px solid var(--border-faint)',
              }}>
                <span style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 500,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                }}>Format</span>
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

              {exportMode === 'list' ? (
                <div style={{
                  padding: 'var(--space-5)',
                  textAlign: 'center',
                  background: 'var(--surface-muted)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-tertiary)',
                  fontSize: 'var(--fs-body)',
                  border: '1px dashed var(--border-default)',
                }}>
                  In <strong style={{ fontWeight: 600 }}>MSISDN-only</strong> mode, the export contains only <code>#, MSISDN</code> — column selection disabled.
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <button onClick={() => setSelectedExportCols(EXPORT_COLUMNS.map(c => c.key))} style={{
                      background: 'transparent',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-secondary)',
                      padding: '0 var(--space-3)', height: '28px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--fs-label)', fontWeight: 500,
                      cursor: 'pointer',
                    }}>Select all</button>
                    <button onClick={() => setSelectedExportCols([])} style={{
                      background: 'transparent',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-secondary)',
                      padding: '0 var(--space-3)', height: '28px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--fs-label)', fontWeight: 500,
                      cursor: 'pointer',
                    }}>Deselect all</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
                    {EXPORT_COLUMNS.map(col => {
                      const checked = selectedExportCols.includes(col.key)
                      return (
                        <label key={col.key}
                          onClick={() => toggleExportCol(col.key)}
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
                          }}>
                            {col.label}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              borderTop: '1px solid var(--border-default)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'var(--surface-muted)',
            }}>
              <div style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
              }}>
                {exportMode === 'list' ? 'MSISDN only' : `${selectedExportCols.length} / ${EXPORT_COLUMNS.length} columns`}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button onClick={() => setShowExportModal(false)} disabled={isExporting} style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  height: '32px', padding: '0 var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 500, fontSize: 'var(--fs-body)',
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                }}>Cancel</button>
                <button onClick={runExport} disabled={isExporting || (exportMode === 'enriched' && selectedExportCols.length === 0)}
                  style={{
                    background: (isExporting || (exportMode === 'enriched' && selectedExportCols.length === 0)) ? 'var(--surface-muted)' : 'var(--positive)',
                    color: (isExporting || (exportMode === 'enriched' && selectedExportCols.length === 0)) ? 'var(--text-muted)' : 'white',
                    border: '1px solid ' + ((isExporting || (exportMode === 'enriched' && selectedExportCols.length === 0)) ? 'var(--border-default)' : 'var(--positive)'),
                    height: '32px', padding: '0 var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 500, fontSize: 'var(--fs-body)',
                    cursor: (isExporting || (exportMode === 'enriched' && selectedExportCols.length === 0)) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  }}>
                  {isExporting ? <RefreshCw size={12} strokeWidth={1.75} className="animate-spin" /> : <Download size={12} strokeWidth={1.75} />}
                  {isExporting ? "Exporting" : "Export"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

// ── Subcomponents ──

function PeriodGroup({ label, sublabel, accent, start, setStart, end, setEnd }: any) {
  return (
    <div style={{ position: 'relative', paddingLeft: 'var(--space-3)' }}>
      <div style={{
        position: 'absolute', top: '4px', bottom: '4px', left: 0,
        width: '2px', background: accent,
      }} />
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)',
        marginBottom: 'var(--space-2)',
      }}>
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 500,
          color: 'var(--text-primary)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-uppercase)',
        }}>{label}</span>
        <span style={{
          fontSize: 'var(--fs-micro)',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-uppercase)',
        }}>· {sublabel}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 600,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
        }}>From</span>
        <input type="date" value={start} max={todayMinus1()} onChange={(e) => setStart(e.target.value)}
          style={{
            width: '150px', height: '32px', padding: '0 var(--space-2)',
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
        <input type="date" value={end} max={todayMinus1()} onChange={(e) => setEnd(e.target.value)}
          style={{
            width: '150px', height: '32px', padding: '0 var(--space-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
            background: 'var(--surface-card)',
            fontWeight: 500, fontSize: 'var(--fs-body)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
          }} />
      </div>
    </div>
  )
}

function KpiCard({ count, loading }: { count: number, loading: boolean }) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <div style={{ height: '3px', background: 'var(--brand)' }} />
      <div style={{ padding: 'var(--space-6) var(--space-8) var(--space-8)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginBottom: 'var(--space-6)',
        }}>
          <span style={{
            width: '7px', height: '7px',
            borderRadius: '50%',
            background: 'var(--brand)',
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
          }}>Customer churners</span>
        </div>
        <div style={{
          fontSize: '32px', fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}>{loading ? '—' : fmtNum(count)}</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginTop: 'var(--space-4)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-faint)',
          fontSize: 'var(--fs-label)', fontWeight: 500,
          color: 'var(--text-tertiary)',
        }}>
          <TrendingDown size={11} strokeWidth={1.75} />
          <span>MSISDN that stopped transacting</span>
        </div>
      </div>
    </div>
  )
}

function InfoCard({ activeWin, excludeWin, totalCount, displayed }: any) {
  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-6) var(--space-8)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 'var(--space-5)',
    }}>
      <WindowBox icon={<Activity size={11} strokeWidth={1.75} color="var(--data-subs)" />} title="Active window" win={activeWin} />
      <WindowBox icon={<TrendingDown size={11} strokeWidth={1.75} color="var(--negative)" />} title="Exclude window" win={excludeWin} />
      <div style={{
        gridColumn: '1 / -1',
        display: 'flex', gap: 'var(--space-4)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-faint)',
        fontSize: 'var(--fs-label)',
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <div><span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(totalCount)}</span> total churners</div>
        <div><span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(displayed)}</span> displayed</div>
        <div style={{ marginLeft: 'auto' }}>Export retrieves the full list.</div>
      </div>
    </div>
  )
}

function WindowBox({ icon, title, win }: any) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        marginBottom: 'var(--space-1)',
      }}>
        {icon}
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 500,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-uppercase)',
        }}>{title}</span>
      </div>
      <div style={{
        fontSize: 'var(--fs-md)', fontWeight: 500,
        color: 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {win ? `${win[0]} → ${win[1]}` : '—'}
      </div>
    </div>
  )
}

