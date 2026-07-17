import { useState, useMemo } from "react"
import {
  Calendar, RefreshCw, Download, Search, Activity, Store,
  BarChart3, Wallet, DollarSign, XCircle, Check
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useActiveMerchants } from "../hooks/useAnalytics"
import { triggerNativeDownload, downloadXlsxStream, type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const DISPLAY_LIMIT = 500
const EXPORT_LIMIT = 2_000_000

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
const minusDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtMoney = (v: any) => {
  const n = Number(v ?? 0)
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + ' M'
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + ' K'
  return n.toFixed(0)
}
const formatDisplayDate = (s?: string) => {
  if (!s) return 'N/A'
  const parts = s.split('-')
  if (parts.length !== 3) return s
  return `${parts[1]}/${parts[2].slice(0, 2)}/${parts[0]}`
}

type ExportColumn = { key: string; label: string; pick: (r: any) => any }
const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "SHORTCODE",     label: "Shortcode",       pick: (r) => r.ORGANIZATIONSHORTCODE ?? "" },
  { key: "NAME",          label: "Merchant Name",   pick: (r) => r.MERCHANT_NAME ?? "" },
  { key: "ACCOUNT_ID",    label: "Account ID",      pick: (r) => r.ACCOUNT_ID ?? "" },
  { key: "IDENTITY_ID",   label: "Identity ID",     pick: (r) => r.IDENTITY_ID ?? "" },
  { key: "MERCHANT_TYPE", label: "Merchant Type",   pick: (r) => r.MERCHANT_TYPE ?? "" },
  { key: "FEE",           label: "Fee",             pick: (r) => r.FEE ?? "" },
  { key: "DEPARTMENT",    label: "Department",      pick: (r) => r.DEPARTMENT ?? "" },
  { key: "COMMUNE",       label: "Commune",         pick: (r) => r.COMMUNE ?? "" },
  { key: "ACCOUNT_GL",    label: "Account GL",      pick: (r) => r.ACCOUNTGLCODE ?? "" },
  { key: "VOLUME",        label: "Volume",          pick: (r) => Number(r.VOLUME ?? 0) },
  { key: "VALUE",         label: "Value (HTG)",     pick: (r) => Number(r.VALUE ?? 0) },
  { key: "REVENUE",       label: "Revenue (HTG)",   pick: (r) => Number(r.REVENUE ?? 0) },
  { key: "FIRST_TX",      label: "First TX",        pick: (r) => formatDisplayDate(r.FIRST_TX) },
  { key: "LAST_TX",       label: "Last TX",         pick: (r) => formatDisplayDate(r.LAST_TX) },
]

export default function ActiveMerchants() {
  const [localStart, setLocalStart] = useState<string>(minusDays(30))
  const [localEnd,   setLocalEnd]   = useState<string>(todayMinus1())
  const [start,      setStart]      = useState<string>(minusDays(30))
  const [end,        setEnd]        = useState<string>(todayMinus1())
  const [search, setSearch] = useState("")
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [selectedExportCols, setSelectedExportCols] = useState<string[]>(EXPORT_COLUMNS.map(c => c.key))
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv')

  const { data, isLoading, isFetching, refetch } = useActiveMerchants({
    startDate: start, endDate: end, limit: DISPLAY_LIMIT,
  })
  const busy = isLoading || isFetching

  const rows: any[] = data?.rows ?? []
  const totalMerchants = data?.total_merchants ?? 0
  const totalVolume    = data?.total_volume   ?? 0
  const totalValue     = data?.total_value    ?? 0
  const totalRevenue   = data?.total_revenue  ?? 0

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r: any) =>
      String(r.ORGANIZATIONSHORTCODE ?? '').toLowerCase().includes(s) ||
      String(r.MERCHANT_NAME ?? '').toLowerCase().includes(s) ||
      String(r.MERCHANT_TYPE ?? '').toLowerCase().includes(s) ||
      String(r.DEPARTMENT ?? '').toLowerCase().includes(s) ||
      String(r.COMMUNE ?? '').toLowerCase().includes(s)
    )
  }, [rows, search])

  const apply = () => { setStart(localStart); setEnd(localEnd) }

  const toggleExportCol = (key: string) =>
    setSelectedExportCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const runExport = async () => {
    if (selectedExportCols.length === 0) return
    setShowExportModal(false)
    const baseName = `Active_Merchants_${start}_to_${end}`
    const params = {
      start_date: start, end_date: end, limit: EXPORT_LIMIT, columns: selectedExportCols.join(','),
    }
    if (exportFormat === 'csv') {
      triggerNativeDownload('/merchants/active-merchants/export.csv', params, `${baseName}.csv`)
      return
    }
    setIsExporting(true)
    try {
      await downloadXlsxStream(
        '/merchants/active-merchants/export.xlsx', params, `${baseName}.xlsx`,
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
              <h1 className="page-title" style={{ margin: 0 }}>Active Merchants</h1>
              <span style={{ background: '#1e293b', color: 'white', fontSize: '10px', fontWeight: '800', padding: '4px 8px', borderRadius: '6px', letterSpacing: '0.5px' }}>≥1 TRANSACTION</span>
            </div>
            <p className="page-subtitle" style={{ marginTop: '6px' }}>
              Merchants ayant <strong>reçu</strong> au moins une transaction Customer sur la période — joint sur <strong>ORGANIZATIONSHORTCODE</strong>.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => refetch()} disabled={busy} title="Refresh"
              style={{ background: 'white', color: 'var(--mc-text-main)', border: '1px solid var(--mc-border)', height: '40px', padding: '0 14px', borderRadius: '8px', fontWeight: '700', cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={() => setShowExportModal(true)} disabled={busy || isExporting || totalMerchants === 0}
              title="Choisir les colonnes à exporter"
              style={{ background: (busy || isExporting || totalMerchants === 0) ? '#cbd5e1' : '#16a34a', color: 'white', border: 'none', height: '40px', padding: '0 16px', borderRadius: '8px', fontWeight: '800', cursor: (busy || isExporting || totalMerchants === 0) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              {isExporting ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
              {isExporting ? "Export…" : "Export"}
            </button>
          </div>
        </div>

        {/* DATE CONTROL with LAST 30/60/90 quick filters */}
        <div style={{
          background: 'white', padding: '14px 18px', borderRadius: '8px',
          border: '1px solid var(--mc-border)', boxShadow: 'var(--mc-card-shadow)',
          marginTop: '6px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={14} color="var(--mc-red)" />
            <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.5px' }}>Période</span>
          </div>
          <input type="date" className="search-input"
            style={{ width: '150px', height: '36px', marginBottom: 0, borderRadius: '6px' }}
            value={localStart} max={todayMinus1()} onChange={(e) => setLocalStart(e.target.value)} />
          <span style={{ color: '#94a3b8', fontWeight: '800' }}>→</span>
          <input type="date" className="search-input"
            style={{ width: '150px', height: '36px', marginBottom: 0, borderRadius: '6px' }}
            value={localEnd} max={todayMinus1()} onChange={(e) => setLocalEnd(e.target.value)} />
          <button onClick={apply} disabled={busy || (localStart === start && localEnd === end)}
            style={{ background: 'var(--mc-red)', color: 'white', border: 'none', height: '36px', padding: '0 18px', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px', opacity: (busy || (localStart === start && localEnd === end)) ? 0.6 : 1 }}>
            Apply
          </button>

          {/* QUICK RANGES */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '8px', borderLeft: '1px solid var(--mc-border)' }}>
            <span style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Quick :</span>
            {([30, 60, 90] as const).map(n => {
              const qStart = minusDays(n); const qEnd = todayMinus1()
              const isActive = start === qStart && end === qEnd
              return (
                <button key={n}
                  onClick={() => { setLocalStart(qStart); setLocalEnd(qEnd); setStart(qStart); setEnd(qEnd) }}
                  disabled={busy}
                  title={`${qStart} → ${qEnd}`}
                  style={{
                    padding: '5px 12px', borderRadius: '6px',
                    border: '1px solid var(--mc-border)',
                    background: isActive ? 'var(--mc-red)' : 'white',
                    color: isActive ? 'white' : '#475569',
                    fontWeight: '800', fontSize: '11px', cursor: busy ? 'wait' : 'pointer',
                  }}>
                  LAST {n}
                </button>
              )
            })}
          </div>

          <div style={{ marginLeft: 'auto', fontSize: '11px', color: '#64748b' }}>
            <strong style={{ color: '#0f172a' }}>{start}</strong> → <strong style={{ color: '#0f172a' }}>{end}</strong>
          </div>
        </div>

        {/* KPI STRIP */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px', marginTop: '16px' }}>
          <KpiCard icon={<Store size={16} />}      label="Active Merchants"  value={fmtNum(totalMerchants)} accent="#7c3aed" sub={`${fmtNum(rows.length)} loaded · ${fmtNum(filtered.length)} after filter`} />
          <KpiCard icon={<BarChart3 size={16} />}  label="Total Volume"      value={fmtNum(totalVolume)}    accent="#0891b2" sub="transactions" />
          <KpiCard icon={<Wallet size={16} />}     label="Total Value (HTG)" value={fmtMoney(totalValue)}   accent="#16a34a" sub="somme amounts" />
          <KpiCard icon={<DollarSign size={16} />} label="Total Revenue"     value={fmtMoney(totalRevenue)} accent="#dc2626" sub="MFS revenue" />
        </div>

        {/* TABLE */}
        <div className="table-card" style={{ marginTop: '16px' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--mc-border)', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={16} color="var(--mc-red)" />
              <span style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a' }}>Active Merchants</span>
              <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '999px' }}>
                {fmtNum(filtered.length)} / {fmtNum(totalMerchants)}
              </span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--mc-border)' }}>
              <Search size={14} color="#64748b" />
              <input
                type="text"
                placeholder="Filter Shortcode / Name / Type / City..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '12px', width: '280px', color: '#0f172a' }}
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table className="mc-table mc-table-zebra" style={{ minWidth: '2200px' }}>
              <thead>
                <tr>
                  <th style={{ width: '120px' }}>SHORTCODE</th>
                  <th style={{ width: '220px' }}>MERCHANT NAME</th>
                  <th style={{ width: '130px' }}>TYPE</th>
                  <th style={{ width: '60px', textAlign: 'right' }}>FEE</th>
                  <th style={{ width: '110px', textAlign: 'right' }}>VOLUME</th>
                  <th style={{ width: '140px', textAlign: 'right' }}>VALUE</th>
                  <th style={{ width: '130px', textAlign: 'right' }}>REVENUE</th>
                  <th style={{ width: '110px' }}>FIRST TX</th>
                  <th style={{ width: '110px' }}>LAST TX</th>
                  <th style={{ width: '120px' }}>DEPARTMENT</th>
                  <th style={{ width: '120px' }}>COMMUNE</th>
                  <th style={{ width: '140px' }}>ACCOUNT ID</th>
                </tr>
              </thead>
              <tbody>
                {busy && rows.length === 0 ? (
                  <tr><td colSpan={12} style={{ padding: '90px', textAlign: 'center', color: '#94a3b8' }}>
                    <div className="spinner" style={{ margin: '0 auto 12px' }} />
                    <div style={{ fontWeight: '700', color: '#475569' }}>Loading active merchants…</div>
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={12} style={{ padding: '90px', textAlign: 'center', color: '#94a3b8' }}>
                    <XCircle size={36} opacity={0.25} />
                    <div style={{ fontWeight: '700', color: '#475569', marginTop: '10px' }}>
                      {totalMerchants === 0 ? "Aucun merchant actif sur cette période." : "Aucun résultat pour ce filtre."}
                    </div>
                  </td></tr>
                ) : filtered.map((r: any, idx: number) => (
                  <tr key={(r.ORGANIZATIONSHORTCODE ?? '') + idx}>
                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#ede9fe', color: '#5b21b6', padding: '3px 9px', borderRadius: '6px', fontWeight: '800', fontSize: '12px', fontFamily: 'ui-monospace, monospace' }}>
                        {r.ORGANIZATIONSHORTCODE}
                      </div>
                    </td>
                    <td style={{ fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.MERCHANT_NAME || <span style={{ color: '#cbd5e1', fontStyle: 'italic', fontWeight: '500' }}>(unknown)</span>}
                    </td>
                    <td style={{ fontSize: '11px', fontWeight: '700', color: r.MERCHANT_TYPE ? '#475569' : '#cbd5e1' }}>
                      {r.MERCHANT_TYPE ? (
                        <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '6px' }}>{r.MERCHANT_TYPE}</span>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '11px', fontWeight: '800', color: '#0f172a' }}>
                      {r.FEE || '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '900', color: '#0891b2', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtNum(r.VOLUME)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '800', color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(r.VALUE)} <span style={{ color: '#94a3b8', fontSize: '9px', fontWeight: '700' }}>HTG</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '800', color: '#dc2626', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(r.REVENUE)} <span style={{ color: '#94a3b8', fontSize: '9px', fontWeight: '700' }}>HTG</span>
                    </td>
                    <td style={{ fontSize: '11px', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{formatDisplayDate(r.FIRST_TX)}</td>
                    <td style={{ fontSize: '11px', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{formatDisplayDate(r.LAST_TX)}</td>
                    <td style={{ fontSize: '11px', fontWeight: '600', color: r.DEPARTMENT ? '#475569' : '#cbd5e1' }}>{r.DEPARTMENT || '—'}</td>
                    <td style={{ fontSize: '11px', fontWeight: '600', color: r.COMMUNE ? '#475569' : '#cbd5e1' }}>{r.COMMUNE || '—'}</td>
                    <td style={{ fontSize: '11px', color: '#0f172a', fontFamily: 'ui-monospace, monospace' }}>{r.ACCOUNT_ID || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--mc-border)', background: '#f8fafc' }}>
            <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>
              Affichage limité à <strong style={{ color: '#0f172a' }}>{fmtNum(DISPLAY_LIMIT)}</strong> lignes · L'export récupère <strong style={{ color: '#0f172a' }}>tous</strong> les merchants ({fmtNum(totalMerchants)})
            </div>
          </div>
        </div>
      </div>

      {/* EXPORT PROGRESS OVERLAY */}
      <ExportOverlay progress={exportProgress} />

      {/* EXPORT MODAL */}
      {showExportModal && (
        <div onClick={() => !isExporting && setShowExportModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '8px', width: '460px', maxWidth: '92vw', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)', overflow: 'hidden', border: '1px solid var(--mc-border)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--mc-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '800', color: 'var(--mc-text-main)' }}>Export — Active Merchants</div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Choisir les colonnes à inclure</div>
              </div>
              <button onClick={() => !isExporting && setShowExportModal(false)} disabled={isExporting}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: isExporting ? 'not-allowed' : 'pointer', padding: '4px', borderRadius: '6px' }} title="Fermer">
                <XCircle size={18} />
              </button>
            </div>
            <div style={{ padding: '14px 18px', maxHeight: '50vh', overflowY: 'auto' }}>
              {/* FORMAT TOGGLE */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#f8fafc', borderRadius: '6px', marginBottom: '12px', border: '1px solid var(--mc-border)' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Format :</span>
                <button onClick={() => setExportFormat('csv')}
                  style={{ padding: '5px 12px', borderRadius: '6px', border: exportFormat === 'csv' ? '1px solid #16a34a' : '1px solid var(--mc-border)', background: exportFormat === 'csv' ? '#16a34a' : 'white', color: exportFormat === 'csv' ? 'white' : '#475569', fontWeight: '800', fontSize: '11px', cursor: 'pointer' }}>CSV ⚡</button>
                <button onClick={() => setExportFormat('xlsx')}
                  style={{ padding: '5px 12px', borderRadius: '6px', border: exportFormat === 'xlsx' ? '1px solid var(--mc-red)' : '1px solid var(--mc-border)', background: exportFormat === 'xlsx' ? 'var(--mc-red)' : 'white', color: exportFormat === 'xlsx' ? 'white' : '#475569', fontWeight: '800', fontSize: '11px', cursor: 'pointer' }}>XLSX</button>
                <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>
                  {exportFormat === 'csv' ? 'Téléchargement instantané · ouvre dans Excel' : 'Plus lent pour >100k lignes'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <button onClick={() => setSelectedExportCols(EXPORT_COLUMNS.map(c => c.key))} style={{ background: 'transparent', border: '1px solid var(--mc-border)', color: '#475569', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>Tout sélectionner</button>
                <button onClick={() => setSelectedExportCols([])} style={{ background: 'transparent', border: '1px solid var(--mc-border)', color: '#475569', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>Tout désélectionner</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                {EXPORT_COLUMNS.map(col => {
                  const checked = selectedExportCols.includes(col.key)
                  return (
                    <label key={col.key}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', background: checked ? '#fef2f2' : '#f8fafc', border: `1px solid ${checked ? 'var(--mc-red)' : 'transparent'}`, transition: '0.15s' }}>
                      <div onClick={() => toggleExportCol(col.key)}
                        style={{ width: '16px', height: '16px', borderRadius: '4px', border: `1px solid ${checked ? 'var(--mc-red)' : '#cbd5e1'}`, background: checked ? 'var(--mc-red)' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}>
                        {checked && <Check size={11} strokeWidth={4} />}
                      </div>
                      <span onClick={() => toggleExportCol(col.key)} style={{ fontSize: '12px', fontWeight: '700', color: checked ? 'var(--mc-red)' : 'var(--mc-text-main)' }}>
                        {col.label}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--mc-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>{selectedExportCols.length} / {EXPORT_COLUMNS.length} colonnes</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setShowExportModal(false)} disabled={isExporting} style={{ background: 'white', border: '1px solid var(--mc-border)', color: '#475569', height: '34px', padding: '0 14px', borderRadius: '6px', fontWeight: '700', fontSize: '12px', cursor: isExporting ? 'not-allowed' : 'pointer' }}>Annuler</button>
                <button onClick={runExport} disabled={isExporting || selectedExportCols.length === 0}
                  style={{ background: (isExporting || selectedExportCols.length === 0) ? '#cbd5e1' : '#16a34a', color: 'white', border: 'none', height: '34px', padding: '0 16px', borderRadius: '6px', fontWeight: '800', fontSize: '12px', cursor: (isExporting || selectedExportCols.length === 0) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {isExporting ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
                  {isExporting ? "Export…" : "Exporter"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

function KpiCard({ icon, label, value, sub, accent }: any) {
  return (
    <div style={{
      background: 'white', border: '1px solid var(--mc-border)', borderRadius: '6px',
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px',
      boxShadow: 'var(--mc-card-shadow)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.5px' }}>
          {label}
        </span>
        <div style={{ width: '26px', height: '26px', borderRadius: '6px', background: accent, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize: '22px', fontWeight: '900', color: '#0f172a', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>
        {value}
      </div>
      <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '700' }}>{sub}</div>
    </div>
  )
}
