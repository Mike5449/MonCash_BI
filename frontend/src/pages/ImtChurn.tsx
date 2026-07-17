import { useState, useMemo } from "react"
import {
  Calendar, RefreshCw, Download, Globe, UserMinus, Search, TrendingDown, Activity
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useImtChurn } from "../hooks/useAnalytics"
import { downloadXlsxStream, type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const DISPLAY_LIMIT = 100

const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US')

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

const monthAgo = () => {
  const d = new Date(); d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}

const monthAgoEnd = () => {
  const d = new Date(); d.setDate(d.getDate() - 21)
  return d.toISOString().split('T')[0]
}

const tenDaysAgo = () => {
  const d = new Date(); d.setDate(d.getDate() - 10)
  return d.toISOString().split('T')[0]
}

export default function ImtChurn() {
  // Defaults: active = il y a un mois (10 jours), exclude = derniers 10 jours
  const [localActiveStart, setLocalActiveStart]   = useState<string>(monthAgo())
  const [localActiveEnd,   setLocalActiveEnd]     = useState<string>(monthAgoEnd())
  const [localExcludeStart, setLocalExcludeStart] = useState<string>(tenDaysAgo())
  const [localExcludeEnd,   setLocalExcludeEnd]   = useState<string>(todayMinus1())

  const [submittedActiveStart,   setSubmittedActiveStart]   = useState<string>(monthAgo())
  const [submittedActiveEnd,     setSubmittedActiveEnd]     = useState<string>(monthAgoEnd())
  const [submittedExcludeStart,  setSubmittedExcludeStart]  = useState<string>(tenDaysAgo())
  const [submittedExcludeEnd,    setSubmittedExcludeEnd]    = useState<string>(todayMinus1())

  const [imtRows, setImtRows] = useState<any[] | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [search, setSearch] = useState("")

  // Fetch du compteur (renvoie aussi la liste limitée à DISPLAY_LIMIT en une seule requête)
  const { data, isLoading, isFetching, refetch } = useImtChurn({
    activeStart:  submittedActiveStart,
    activeEnd:    submittedActiveEnd,
    excludeStart: submittedExcludeStart,
    excludeEnd:   submittedExcludeEnd,
    returnList:   true,
    limit:        DISPLAY_LIMIT,
  })

  const busy = isLoading || isFetching

  const handleApply = () => {
    setSubmittedActiveStart(localActiveStart)
    setSubmittedActiveEnd(localActiveEnd)
    setSubmittedExcludeStart(localExcludeStart)
    setSubmittedExcludeEnd(localExcludeEnd)
    setImtRows(null)
  }

  const list = imtRows ?? data?.rows ?? ((data?.msisdns ?? []).map((m: string) => ({ MSISDN: m })))
  const totalCount = data?.churn_count ?? 0
  const activeWin = data?.active_window
  const excludeWin = data?.exclude_window

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return list
    return list.filter((r: any) =>
      String(r.MSISDN ?? '').toLowerCase().includes(s) ||
      String(r.DEPARTMENT ?? '').toLowerCase().includes(s) ||
      String(r.CITY ?? '').toLowerCase().includes(s)
    )
  }, [list, search])

  const refresh = async () => {
    setImtRows(null)
    await refetch()
  }

  const exportToExcel = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      await downloadXlsxStream(
        '/customers/imt-churn/export.xlsx',
        {
          active_start:  submittedActiveStart,
          active_end:    submittedActiveEnd,
          exclude_start: submittedExcludeStart,
          exclude_end:   submittedExcludeEnd,
        },
        `IMT_Churn_${submittedActiveStart}_to_${submittedActiveEnd}_excl_${submittedExcludeStart}_to_${submittedExcludeEnd}.xlsx`,
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

  return (
    <DashboardLayout>
      <div style={{ background: 'var(--mc-bg)', padding: '4px' }}>
        {/* HEADER */}
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 className="page-title" style={{ margin: 0 }}>IMT — Lost Receivers</h1>
              <span style={{ background: '#1e293b', color: 'white', fontSize: '10px', fontWeight: '800', padding: '4px 8px', borderRadius: '6px', letterSpacing: '0.5px' }}>CHURN ANALYSIS</span>
            </div>
            <p className="page-subtitle" style={{ marginTop: '6px' }}>
              MSISDN ayant <strong>reçu</strong> un IMT pendant la <strong>période active</strong> mais qui <strong>n'en ont pas reçu</strong> pendant la <strong>période exclude</strong>.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={refresh} disabled={busy} title="Refresh"
              style={{ background: 'white', color: 'var(--mc-text-main)', border: '1px solid var(--mc-border)', height: '40px', padding: '0 14px', borderRadius: '8px', fontWeight: '700', cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={exportToExcel} disabled={busy || isExporting || totalCount === 0}
              title="Exporter tous les MSISDN en Excel"
              style={{ background: (busy || isExporting || totalCount === 0) ? '#cbd5e1' : '#16a34a', color: 'white', border: 'none', height: '40px', padding: '0 16px', borderRadius: '8px', fontWeight: '800', cursor: (busy || isExporting || totalCount === 0) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              {isExporting ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
              {isExporting ? "Export…" : "Export Excel"}
            </button>
          </div>
        </div>

        {/* PERIODS CONTROL */}
        <div style={{
          background: 'white', padding: '16px 18px', borderRadius: '8px',
          border: '1px solid var(--mc-border)', boxShadow: 'var(--mc-card-shadow)',
          marginTop: '6px', display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '20px', alignItems: 'end'
        }}>
          <PeriodGroup
            label="Période Active"
            sublabel="Doit avoir reçu IMT"
            accent="#2563eb"
            start={localActiveStart} setStart={setLocalActiveStart}
            end={localActiveEnd}     setEnd={setLocalActiveEnd}
          />
          <PeriodGroup
            label="Période Exclude"
            sublabel="N'a PAS reçu IMT"
            accent="#dc2626"
            start={localExcludeStart} setStart={setLocalExcludeStart}
            end={localExcludeEnd}     setEnd={setLocalExcludeEnd}
          />
          <button onClick={handleApply} disabled={busy}
            style={{ background: 'var(--mc-red)', color: 'white', border: 'none', height: '40px', padding: '0 24px', borderRadius: '8px', fontWeight: '800', cursor: busy ? 'wait' : 'pointer', fontSize: '12px' }}>
            Apply
          </button>
        </div>

        {/* KPI CARD + INFO */}
        <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '320px 1fr', gap: '16px' }}>
          <KpiCard
            count={totalCount}
            loading={busy}
          />
          <InfoCard activeWin={activeWin} excludeWin={excludeWin} totalCount={totalCount} displayed={list.length} />
        </div>

        {/* TABLE */}
        <div className="table-card" style={{ marginTop: '16px' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--mc-border)', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserMinus size={16} color="var(--mc-red)" />
              <span style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a' }}>
                Lost Receivers
              </span>
              <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '999px', letterSpacing: '0.4px' }}>
                {fmtNum(filtered.length)} / {fmtNum(totalCount)}
              </span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--mc-border)' }}>
              <Search size={14} color="#64748b" />
              <input
                type="text"
                placeholder="Filter MSISDN / Department / City..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '12px', width: '200px', color: '#0f172a' }}
              />
            </div>
          </div>

          <div style={{ maxHeight: '460px', overflowY: 'auto' }}>
            {busy && list.length === 0 ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8' }}>
                <div className="spinner" style={{ margin: '0 auto 12px' }} />
                <div style={{ fontWeight: '700', color: '#475569' }}>Loading IMT churners…</div>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8' }}>
                <UserMinus size={28} style={{ opacity: 0.3 }} />
                <div style={{ fontWeight: '700', color: '#475569', marginTop: '8px' }}>
                  {totalCount === 0 ? "Aucun churner pour cette combinaison de périodes." : "Aucun résultat pour ce filtre."}
                </div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '10px', width: '60px', borderBottom: '1px solid var(--mc-border)' }}>#</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '10px', borderBottom: '1px solid var(--mc-border)' }}>MSISDN</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '10px', borderBottom: '1px solid var(--mc-border)' }}>Department</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '10px', borderBottom: '1px solid var(--mc-border)' }}>City</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: any, i: number) => (
                    <tr key={`${r.MSISDN ?? ''}-${i}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 14px', color: '#94a3b8', fontVariantNumeric: 'tabular-nums', fontWeight: '700' }}>{i + 1}</td>
                      <td style={{ padding: '8px 14px', color: '#0f172a', fontVariantNumeric: 'tabular-nums', fontWeight: '700' }}>{r.MSISDN}</td>
                      <td style={{ padding: '8px 14px', color: r.DEPARTMENT ? '#475569' : '#cbd5e1', fontWeight: '700', fontStyle: r.DEPARTMENT ? 'normal' : 'italic' }}>{r.DEPARTMENT || '—'}</td>
                      <td style={{ padding: '8px 14px', color: r.CITY ? '#475569' : '#cbd5e1', fontWeight: '700', fontStyle: r.CITY ? 'normal' : 'italic' }}>{r.CITY || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      <ExportOverlay progress={exportProgress} />
    </DashboardLayout>
  )
}

// --------- Subcomponents ---------

function PeriodGroup({ label, sublabel, accent, start, setStart, end, setEnd }: any) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <Calendar size={13} color={accent} />
        <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: accent, letterSpacing: '0.5px' }}>
          {label}
        </span>
        <span style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8' }}>· {sublabel}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="date"
          className="search-input"
          style={{ width: '150px', height: '36px', marginBottom: 0, borderRadius: '6px' }}
          value={start}
          max={todayMinus1()}
          onChange={(e) => setStart(e.target.value)}
        />
        <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '12px' }}>→</span>
        <input
          type="date"
          className="search-input"
          style={{ width: '150px', height: '36px', marginBottom: 0, borderRadius: '6px' }}
          value={end}
          max={todayMinus1()}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
    </div>
  )
}

function KpiCard({ count, loading }: { count: number, loading: boolean }) {
  return (
    <div className="kpi-card" style={{
      background: 'linear-gradient(135deg, #fef2f2 0%, white 60%)',
      border: '1px solid var(--mc-border)',
      borderRadius: '6px',
      padding: '20px',
      display: 'flex', flexDirection: 'column', gap: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b' }}>
          IMT Churners
        </span>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--mc-red)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Globe size={16} />
        </div>
      </div>
      <div style={{ fontSize: '34px', fontWeight: '900', color: '#0f172a', fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px' }}>
        {loading ? '…' : fmtNum(count)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
        <TrendingDown size={12} color="#dc2626" />
        <span style={{ fontWeight: '700' }}>MSISDN ayant cessé de recevoir IMT</span>
      </div>
    </div>
  )
}

function InfoCard({ activeWin, excludeWin, totalCount, displayed }: any) {
  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--mc-border)',
      borderRadius: '6px',
      padding: '20px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px',
    }}>
      <WindowBox icon={<Activity size={14} color="#2563eb" />} title="Active Window" accent="#2563eb" win={activeWin} />
      <WindowBox icon={<TrendingDown size={14} color="#dc2626" />} title="Exclude Window" accent="#dc2626" win={excludeWin} />
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '16px', paddingTop: '12px', borderTop: '1px solid var(--mc-border)', fontSize: '11px', color: '#64748b' }}>
        <div>
          <span style={{ fontWeight: '800', color: '#0f172a' }}>{fmtNum(totalCount)}</span> total churners
        </div>
        <div>
          <span style={{ fontWeight: '800', color: '#0f172a' }}>{fmtNum(displayed)}</span> displayed (limited)
        </div>
        <div style={{ marginLeft: 'auto', color: '#94a3b8' }}>
          Export retrieves the full list.
        </div>
      </div>
    </div>
  )
}

function WindowBox({ icon, title, accent, win }: any) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        {icon}
        <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', color: accent, letterSpacing: '0.5px' }}>
          {title}
        </span>
      </div>
      <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
        {win ? `${win[0]} → ${win[1]}` : '—'}
      </div>
    </div>
  )
}
