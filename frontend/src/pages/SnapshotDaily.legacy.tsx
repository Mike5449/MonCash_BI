import { useState, useMemo, useRef } from "react"
import {
  Calendar, RefreshCw, Download, TrendingUp, TrendingDown, Minus,
  Users as UsersIcon, BarChart3, Wallet, DollarSign, ArrowDownCircle, ArrowUpCircle
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useSnapshotDailyByType } from "../hooks/useAnalytics"
import { exportNodeToPdf } from "../utils/pdfExport"
import "../premium.css"

const TR_TYPE_LABELS: Record<string, string> = {
  CASHIN: 'Cash In',
  CASHIN_OTC: 'Cash In OTC',
  'Cash In OTC': 'Cash In OTC',
  CASHOUT: 'Cash Out',
  P2P_SEND: 'P2P Send',
  P2P_RECEIVE: 'P2P Receive',
  PAY2MERC: 'Pay to Merchant',
  BILLPAY: 'Bill Payment',
  DIGI_PRODUCT: 'Digicel Products',
  TOPUP_GIFT: 'Top-up Gift',
  SELF_TOPUP: 'Top-up Self',
  IMT: 'IMT Receive',
  B2W: 'B2W (Prefunded)',
  PREFUNDED: 'Prefunded',
  W2B: 'Wallet to Bank',
  'Payroll | disbursements': 'Payroll / Disbursements',
}

const CATEGORIES: Record<string, 'Inbound' | 'Outbound'> = {
  CASHIN: 'Inbound', CASHIN_OTC: 'Inbound', 'Cash In OTC': 'Inbound',
  P2P_RECEIVE: 'Inbound', IMT: 'Inbound', B2W: 'Inbound', PREFUNDED: 'Inbound',
  'Payroll | disbursements': 'Inbound',
  CASHOUT: 'Outbound', P2P_SEND: 'Outbound', PAY2MERC: 'Outbound',
  BILLPAY: 'Outbound', DIGI_PRODUCT: 'Outbound', TOPUP_GIFT: 'Outbound',
  SELF_TOPUP: 'Outbound', W2B: 'Outbound',
}

const fmtNum = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const fmtPct = (v: number) =>
  (v >= 0 ? '+' : '') + v.toFixed(1) + '%'

const variation = (prev: number, curr: number): number => {
  if (!prev && !curr) return 0
  if (!prev) return 100
  return ((curr - prev) / prev) * 100
}

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

export default function SnapshotDaily() {
  const [localReportDate, setLocalReportDate] = useState<string>(todayMinus1())
  const [submittedDate, setSubmittedDate] = useState<string>(todayMinus1())
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, isFetching, refetch } = useSnapshotDailyByType({
    reportDate: submittedDate,
  })

  const handleApply = () => setSubmittedDate(localReportDate)
  const busy = isLoading || isFetching

  const previewDate = useMemo(() => {
    const d = new Date(submittedDate)
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  }, [submittedDate])

  const rows: any[] = data?.rows ?? []

  // Order Inbound first, then Outbound, alphabetically within
  const sortedRows = useMemo(() => {
    const arr = [...rows]
    arr.sort((a: any, b: any) => {
      const ca = CATEGORIES[a.TR_TYPE] || 'Outbound'
      const cb = CATEGORIES[b.TR_TYPE] || 'Outbound'
      if (ca !== cb) return ca === 'Inbound' ? -1 : 1
      const la = TR_TYPE_LABELS[a.TR_TYPE] || a.TR_TYPE
      const lb = TR_TYPE_LABELS[b.TR_TYPE] || b.TR_TYPE
      return la.localeCompare(lb)
    })
    return arr
  }, [rows])

  const downloadAsPdf = async () => {
    if (!pageRef.current || !sortedRows.length) {
      if (!sortedRows.length) alert("Aucune donnée à exporter.")
      return
    }
    setIsExportingPdf(true)
    try {
      await exportNodeToPdf(pageRef.current, `Snapshot_WoW_${submittedDate}_vs_${previewDate}`)
    } catch (e) {
      console.error("PDF export failed", e)
      alert("L'export PDF a échoué — voir la console.")
    } finally {
      setIsExportingPdf(false)
    }
  }

  return (
    <DashboardLayout>
     <div ref={pageRef} style={{ background: 'var(--mc-bg)', padding: '4px' }}>
      {/* HEADER */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 className="page-title" style={{ margin: 0 }}>MonCash KPIs Snapshot</h1>
            <span style={{ background: '#1e293b', color: 'white', fontSize: '10px', fontWeight: '800', padding: '4px 8px', borderRadius: '6px', letterSpacing: '0.5px' }}>WEEK-ON-WEEK</span>
          </div>
          <p className="page-subtitle" style={{ marginTop: '6px' }}>
            Comparaison <strong>Current</strong> vs <strong>Preview (J-7)</strong> par TR_TYPE.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => refetch()} disabled={busy} title="Refresh"
            style={{ background: 'white', color: 'var(--mc-text-main)', border: '1px solid var(--mc-border)', height: '40px', padding: '0 14px', borderRadius: '8px', fontWeight: '700', cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={downloadAsPdf} disabled={!sortedRows.length || busy || isExportingPdf}
            title="Télécharge la page en PDF (KPI + tous les TR_TYPE)"
            style={{ background: (!sortedRows.length || busy || isExportingPdf) ? '#cbd5e1' : '#dc2626', color: 'white', border: 'none', height: '40px', padding: '0 16px', borderRadius: '8px', fontWeight: '800', cursor: (!sortedRows.length || busy || isExportingPdf) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', boxShadow: (!sortedRows.length || busy || isExportingPdf) ? 'none' : '0 4px 6px -1px rgba(220, 38, 38, 0.2)' }}>
            {isExportingPdf ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
            {isExportingPdf ? "Génération…" : "Download PDF"}
          </button>
        </div>
      </div>

      {/* DATE CONTROL BAR */}
      <div style={{
        background: 'white', padding: '14px 18px', borderRadius: '6px',
        border: '1px solid var(--mc-border)', boxShadow: 'var(--mc-card-shadow)',
        marginTop: '6px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Calendar size={14} color="var(--mc-red)" />
          <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.5px' }}>Report Date</span>
        </div>
        <input
          type="date"
          className="search-input"
          style={{ width: '160px', height: '36px', marginBottom: 0, borderRadius: '6px' }}
          value={localReportDate}
          max={todayMinus1()}
          onChange={(e) => setLocalReportDate(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleApply() }}
        />
        <button onClick={handleApply} disabled={busy || localReportDate === submittedDate}
          style={{ background: 'var(--mc-red)', color: 'white', border: 'none', height: '36px', padding: '0 18px', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px', opacity: (busy || localReportDate === submittedDate) ? 0.6 : 1 }}>
          Apply
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '24px' }}>
          <DateBadge label="Preview Date" date={previewDate} accent="#059669" />
          <DateBadge label="Current Date" date={submittedDate}  accent="#2563eb" bold />
        </div>
      </div>

      {/* GRID — une seule grille parente pour aligner toutes les colonnes entre lignes */}
      <div style={{ marginTop: '20px', overflowX: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '180px repeat(4, minmax(auto, 1fr))',
          gap: '10px',
          alignItems: 'stretch',
        }}>
          {/* COLUMN HEADERS */}
          <div /> {/* row label slot */}
          <ColumnHeader icon={<UsersIcon size={13} />} label="Subscribers" />
          <ColumnHeader icon={<BarChart3 size={13} />} label="Volume" />
          <ColumnHeader icon={<Wallet size={13} />}    label="Value" />
          <ColumnHeader icon={<DollarSign size={13} />} label="Revenue" />

          {busy ? (
            <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: '#94a3b8' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontWeight: '700', color: '#475569' }}>Loading snapshot…</div>
            </div>
          ) : sortedRows.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: '#94a3b8' }}>
              <Minus size={28} style={{ opacity: 0.3 }} />
              <div style={{ fontWeight: '700', color: '#475569', marginTop: '8px' }}>
                Aucune donnée pour {submittedDate} ou {previewDate}.
              </div>
            </div>
          ) : sortedRows.map((row: any) => (
            <div key={row.TR_TYPE} style={{ display: 'contents' }}>
              <RowLabel tr_type={row.TR_TYPE} />
              <Cell metric="SUBS"    prev={row.PREV_SUBS}    curr={row.CURR_SUBS} />
              <Cell metric="VOLUME"  prev={row.PREV_VOLUME}  curr={row.CURR_VOLUME} />
              <Cell metric="VALUE"   prev={row.PREV_VALUE}   curr={row.CURR_VALUE} />
              <Cell metric="REVENUE" prev={row.PREV_REVENUE} curr={row.CURR_REVENUE} />
            </div>
          ))}
        </div>
      </div>
     </div>
    </DashboardLayout>
  )
}

// --------- Subcomponents ---------

function DateBadge({ label, date, accent, bold = false }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', color: accent, letterSpacing: '0.5px' }}>{label}</span>
      <span style={{ fontSize: bold ? '14px' : '12px', fontWeight: bold ? '900' : '700', color: 'var(--mc-text-main)', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>{date}</span>
    </div>
  )
}

function ColumnHeader({ icon, label }: { icon: React.ReactNode, label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
      fontSize: '11px', fontWeight: '800', color: '#0f172a',
      textTransform: 'uppercase', letterSpacing: '0.5px',
      padding: '6px 0',
    }}>
      <span style={{ color: 'var(--mc-red)' }}>{icon}</span>
      {label}
    </div>
  )
}

function RowLabel({ tr_type }: { tr_type: string }) {
  const label = TR_TYPE_LABELS[tr_type] || tr_type
  const cat = CATEGORIES[tr_type]
  const icon = cat === 'Inbound'
    ? <ArrowDownCircle size={12} color="#059669" />
    : cat === 'Outbound'
      ? <ArrowUpCircle size={12} color="#b91c1c" />
      : null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '0 12px', minHeight: '64px',
      borderRight: '1px solid var(--mc-border)',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {icon}
          <span style={{ fontSize: '10px', fontWeight: '800', color: cat === 'Inbound' ? '#059669' : '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            {cat || ''}
          </span>
        </div>
        <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a', marginTop: '2px', letterSpacing: '-0.2px' }}>
          {label}
        </div>
      </div>
    </div>
  )
}

function Cell({ prev, curr }: { metric: string, prev: any, curr: any }) {
  const p = Number(prev ?? 0)
  const c = Number(curr ?? 0)
  const diff = c - p
  const varPct = variation(p, c)
  const isUp = diff > 0
  const isFlat = diff === 0

  const color = isFlat ? '#94a3b8' : isUp ? '#16a34a' : '#dc2626'
  const bg    = isFlat ? '#f1f5f9' : isUp ? '#dcfce7' : '#fee2e2'
  const TrendIcon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown

  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--mc-border)',
      borderRadius: '6px',
      padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: '8px',
      transition: 'box-shadow 0.15s',
    }}>
      {/* labels row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', fontSize: '9px', fontWeight: '800', color: '#94a3b8', letterSpacing: '0.4px', textTransform: 'uppercase', textAlign: 'center' }}>
        <span>Prev</span>
        <span>Curr</span>
        <span>Diff</span>
        <span>Var</span>
      </div>
      {/* values row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', color: '#475569', fontVariantNumeric: 'tabular-nums', textAlign: 'center', whiteSpace: 'nowrap' }}>
          {fmtNum(p)}
        </span>
        <span style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', fontVariantNumeric: 'tabular-nums', textAlign: 'center', whiteSpace: 'nowrap' }}>
          {fmtNum(c)}
        </span>
        <span style={{
          fontSize: '11px', fontWeight: '800',
          color, background: bg,
          padding: '2px 6px', borderRadius: '5px',
          textAlign: 'center', fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}>
          {diff >= 0 ? '+' : '−'}{fmtNum(Math.abs(diff))}
        </span>
        <span style={{
          fontSize: '11px', fontWeight: '800',
          color, background: bg,
          padding: '2px 6px', borderRadius: '5px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '3px',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}>
          <TrendIcon size={10} />
          {fmtPct(varPct)}
        </span>
      </div>
    </div>
  )
}
