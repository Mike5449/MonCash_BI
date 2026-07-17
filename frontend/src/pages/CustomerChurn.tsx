import { useState, useMemo } from "react"
import {
  RefreshCw, Download, UserMinus, Activity, XCircle, Users, Search, TrendingDown
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useCustomerChurn } from "../hooks/useAnalytics"
import { CustomerService } from "../api/services/CustomerService"
import { downloadXlsxStream, type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

const DISPLAY_LIMIT = 100   // ce que la table affiche

const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US')

type Period = 30 | 60 | 90

export default function CustomerChurn() {
  const [localStartDate, setLocalStartDate] = useState<string>(todayMinus1())
  const [submittedStartDate, setSubmittedStartDate] = useState<string>(todayMinus1())
  const [selectedPeriod, setSelectedPeriod] = useState<Period>(30)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [msisdnList, setMsisdnList] = useState<string[] | null>(null)
  const [listLoading, setListLoading] = useState(false)

  // Trois fetches parallèles pour les 3 KPI (count seul, rapide)
  const c30 = useCustomerChurn({ startDate: submittedStartDate, period: 30 })
  const c60 = useCustomerChurn({ startDate: submittedStartDate, period: 60 })
  const c90 = useCustomerChurn({ startDate: submittedStartDate, period: 90 })

  const handleApply = () => {
    setSubmittedStartDate(localStartDate)
    setMsisdnList(null) // reset la liste affichée car les fenêtres ont changé
  }

  const fetchList = async (period: Period) => {
    setSelectedPeriod(period)
    setListLoading(true)
    setMsisdnList(null)
    try {
      // Affichage limité à DISPLAY_LIMIT lignes — count global toujours exact côté KPI
      const res = await CustomerService.getCustomerChurn(submittedStartDate, period, true, DISPLAY_LIMIT)
      setMsisdnList(res?.msisdns ?? [])
    } catch (e) {
      console.error("Churn list fetch failed", e)
      alert("Impossible de récupérer la liste des churners — voir la console.")
    } finally {
      setListLoading(false)
    }
  }

  const exportToExcel = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      await downloadXlsxStream(
        '/customers/churn/export.xlsx',
        { start_date: submittedStartDate, period: selectedPeriod },
        `Churn_${selectedPeriod}d_at_${submittedStartDate}.xlsx`,
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

  const refetchAll = () => {
    c30.refetch(); c60.refetch(); c90.refetch()
    if (msisdnList) fetchList(selectedPeriod)
  }

  const busy = c30.isFetching || c60.isFetching || c90.isFetching
  const activeData = selectedPeriod === 30 ? c30.data : selectedPeriod === 60 ? c60.data : c90.data

  const windowsText = useMemo(() => {
    if (!activeData) return null
    return {
      baseline: activeData.baseline_window?.join(' → '),
      recent:   activeData.recent_window?.join(' → '),
    }
  }, [activeData])

  return (
    <DashboardLayout>
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
            Customer · Churn 30 · 60 · 90
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Customer Churn
          </h1>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            Customers active in <strong style={{ fontWeight: 600 }}>baseline</strong> and inactive in <strong style={{ fontWeight: 600 }}>recent</strong> · reference <strong style={{ fontWeight: 600 }}>{submittedStartDate}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={refetchAll} disabled={busy}
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
          <button onClick={exportToExcel} disabled={isExporting}
            style={{
              background: isExporting ? 'var(--surface-muted)' : 'var(--positive)',
              color: isExporting ? 'var(--text-muted)' : 'white',
              border: '1px solid ' + (isExporting ? 'var(--border-default)' : 'var(--positive)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: isExporting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            {isExporting ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <Download size={13} strokeWidth={1.75} />}
            {isExporting ? "Exporting" : `Export Churn ${selectedPeriod}`}
          </button>
        </div>
      </div>

      {/* ── DATE CONTROL · borders-only ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'center',
        gap: 'var(--space-3)', flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 500,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
        }}>Reference date</span>
        <input
          type="date"
          value={localStartDate}
          max={todayMinus1()}
          onChange={(e) => setLocalStartDate(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleApply() }}
          style={{
            height: '32px', padding: '0 var(--space-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
            background: 'var(--surface-card)',
            fontWeight: 500, fontSize: 'var(--fs-body)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
          }}
        />
        <button onClick={handleApply} disabled={busy || localStartDate === submittedStartDate}
          style={{
            background: 'var(--brand)', color: 'white',
            border: '1px solid var(--brand)',
            height: '32px', padding: '0 var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontWeight: 500, fontSize: 'var(--fs-body)',
            cursor: 'pointer',
            opacity: (busy || localStartDate === submittedStartDate) ? 0.5 : 1,
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          }}>
          <Search size={13} strokeWidth={1.75} /> Apply
        </button>

        {windowsText && (
          <div style={{
            marginLeft: 'auto',
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px',
            fontSize: 'var(--fs-label)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <div>
              <span style={{
                color: 'var(--positive)', fontWeight: 600,
                textTransform: 'uppercase',
                fontSize: 'var(--fs-micro)',
                letterSpacing: 'var(--tracking-uppercase)',
              }}>Baseline</span> · {windowsText.baseline}
            </div>
            <div>
              <span style={{
                color: 'var(--negative)', fontWeight: 600,
                textTransform: 'uppercase',
                fontSize: 'var(--fs-micro)',
                letterSpacing: 'var(--tracking-uppercase)',
              }}>Recent</span> · {windowsText.recent}
            </div>
          </div>
        )}
      </div>

      {/* KPI CARDS — 3 churn periods */}
      <div style={{
        marginTop: 'var(--space-4)',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--space-3)',
      }}>
        <ChurnCard
          period={30}
          loading={c30.isFetching}
          count={c30.data?.churn_count ?? 0}
          windows={c30.data}
          active={selectedPeriod === 30}
          onSelect={() => fetchList(30)}
        />
        <ChurnCard
          period={60}
          loading={c60.isFetching}
          count={c60.data?.churn_count ?? 0}
          windows={c60.data}
          active={selectedPeriod === 60}
          onSelect={() => fetchList(60)}
        />
        <ChurnCard
          period={90}
          loading={c90.isFetching}
          count={c90.data?.churn_count ?? 0}
          windows={c90.data}
          active={selectedPeriod === 90}
          onSelect={() => fetchList(90)}
        />
      </div>

      {/* ── LIST TABLE · newspaper-style header ── */}
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
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 'var(--space-3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <UserMinus size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
            <h3 style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500, margin: 0,
              textTransform: 'uppercase',
              color: 'var(--text-tertiary)',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>
              Churners list · {selectedPeriod} days
            </h3>
            {msisdnList && (
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                padding: '1px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {fmtNum(msisdnList.length)} shown (max {DISPLAY_LIMIT}) · {fmtNum(activeData?.churn_count ?? 0)} total
              </span>
            )}
          </div>
          {listLoading ? (
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

        {!msisdnList && !listLoading ? (
          <div style={{
            padding: 'var(--space-12) 0', textAlign: 'center',
            color: 'var(--text-tertiary)',
          }}>
            <Users size={24} strokeWidth={1.5} style={{ opacity: 0.4 }} />
            <div style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--fs-body)',
              color: 'var(--text-secondary)',
            }}>
              Select a KPI (30 / 60 / 90) above to load churner list.
            </div>
          </div>
        ) : listLoading ? (
          <div style={{ padding: 'var(--space-12) 0', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
            <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Loading churners…</div>
          </div>
        ) : msisdnList && msisdnList.length === 0 ? (
          <div style={{
            padding: 'var(--space-12) 0', textAlign: 'center',
            color: 'var(--text-tertiary)',
          }}>
            <XCircle size={24} strokeWidth={1.5} style={{ opacity: 0.4 }} />
            <div style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--fs-body)',
              color: 'var(--text-secondary)',
            }}>
              No churner MSISDN for this period and reference date.
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontSize: 'var(--fs-body)', fontVariantNumeric: 'tabular-nums',
            }}>
              <thead style={{
                position: 'sticky', top: 0,
                background: 'var(--surface-muted)',
                zIndex: 1,
              }}>
                <tr>
                  <th style={{
                    width: '80px', textAlign: 'left',
                    padding: 'var(--space-2) var(--space-4)',
                    fontSize: 'var(--fs-micro)', fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                    borderBottom: '1px solid var(--border-default)',
                  }}>#</th>
                  <th style={{
                    textAlign: 'left',
                    padding: 'var(--space-2) var(--space-4)',
                    fontSize: 'var(--fs-micro)', fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                    borderBottom: '1px solid var(--border-default)',
                  }}>MSISDN</th>
                </tr>
              </thead>
              <tbody>
                {msisdnList!.map((m, i) => (
                  <tr key={m} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      fontSize: 'var(--fs-label)',
                      color: 'var(--text-tertiary)',
                    }}>{i + 1}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-body)',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}>
                        {m}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ExportOverlay progress={exportProgress} />
    </DashboardLayout>
  )
}

function ChurnCard({ period, loading, count, windows, active, onSelect }: any) {
  // Ink-toned accents — period 30/60/90 distinguished by depth
  const accent =
    period === 30 ? 'var(--data-volume)'
    : period === 60 ? 'var(--data-value)'
    : 'var(--data-revenue)'
  return (
    <div
      onClick={onSelect}
      style={{
        position: 'relative',
        background: 'var(--surface-card)',
        border: '1px solid ' + (active ? 'var(--text-primary)' : 'var(--border-default)'),
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.12s',
      }}
    >
      <div style={{ height: '3px', background: accent }} />
      <div style={{ padding: 'var(--space-6) var(--space-8) var(--space-8)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginBottom: 'var(--space-6)',
        }}>
          <span style={{
            width: '7px', height: '7px',
            borderRadius: '50%',
            background: accent,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
          }}>
            Churn · {period} days
          </span>
          {active && (
            <span style={{
              marginLeft: 'auto',
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              padding: '1px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>
              Selected
            </span>
          )}
        </div>
        <div style={{
          fontSize: '32px', fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}>
          {loading ? '—' : fmtNum(count)}
        </div>
        {windows && (
          <div style={{
            fontSize: 'var(--fs-label)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--border-faint)',
            fontVariantNumeric: 'tabular-nums',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          }}>
            <TrendingDown size={11} strokeWidth={1.75} />
            <span>Baseline {windows.baseline_window?.[0]} → {windows.baseline_window?.[1]}</span>
          </div>
        )}
      </div>
    </div>
  )
}
