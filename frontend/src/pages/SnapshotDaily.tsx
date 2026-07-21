import { useState, useMemo, useRef } from "react"
import {
  Minus,
  Users as UsersIcon, BarChart3, Wallet, DollarSign, ArrowDownCircle, ArrowUpCircle,
  CalendarDays,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useSnapshotDailyByType } from "../hooks/useAnalytics"
import { exportNodeToPdf } from "../utils/pdfExport"
import { SnapshotHeader, SnapshotFilterBar, SnapshotCell, useXlsxExport } from "../components/SnapshotChrome"
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

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

export default function SnapshotDaily() {
  const [localReportDate, setLocalReportDate] = useState<string>(todayMinus1())
  const [submittedDate, setSubmittedDate] = useState<string>(todayMinus1())
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const xlsx = useXlsxExport()

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

  const downloadAsXlsx = () => xlsx.downloadXlsx(
    '/customers/snapshot-daily-by-type/export.xlsx',
    { report_date: submittedDate },
    `Snapshot_WoW_${submittedDate}_vs_${previewDate}.xlsx`,
  )

  return (
    <DashboardLayout>
     <div ref={pageRef} style={{ background: 'var(--surface-canvas)', padding: 'var(--space-1)' }}>
      <SnapshotHeader
        icon={<CalendarDays size={20} strokeWidth={1.75} />}
        title="MonCash KPIs Snapshot"
        subtitle="By TR_TYPE"
        tag="WEEK-ON-WEEK"
        tagColor="slate"
        description={<>Comparison <strong>Current</strong> vs <strong>Preview (J-7)</strong> per TR_TYPE.</>}
        onRefresh={() => refetch()}
        busy={busy}
        hasData={sortedRows.length > 0}
        onExportXlsx={downloadAsXlsx}
        isExportingXlsx={xlsx.isExportingXlsx}
        onExportPdf={downloadAsPdf}
        isExportingPdf={isExportingPdf}
      />

      <SnapshotFilterBar
        localReportDate={localReportDate}
        setLocalReportDate={setLocalReportDate}
        submittedDate={submittedDate}
        onApply={handleApply}
        prevStart={previewDate} prevEnd={previewDate} prevLabel="Preview Day"
        currStart={submittedDate} currEnd={submittedDate} currLabel="Current Day"
        busy={busy}
      />

      {/* ── KPI GRID ─────────────────────────────────────────────── */}
      <div style={{ marginTop: 'var(--space-6)', overflowX: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '200px repeat(4, minmax(230px, 1fr))',
          gap: 'var(--space-3)',
          alignItems: 'stretch',
        }}>
          {/* Column headers */}
          <div />
          <ColumnHeader icon={<UsersIcon size={12} strokeWidth={1.75} />} label="Subscribers" />
          <ColumnHeader icon={<BarChart3 size={12} strokeWidth={1.75} />} label="Volume" />
          <ColumnHeader icon={<Wallet     size={12} strokeWidth={1.75} />} label="Value" />
          <ColumnHeader icon={<DollarSign size={12} strokeWidth={1.75} />} label="Revenue" />

          {busy ? (
            <div style={{ gridColumn: '1 / -1', padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--text-secondary)' }}>Loading snapshot…</div>
            </div>
          ) : sortedRows.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Minus size={22} strokeWidth={1.75} style={{ opacity: 0.35 }} />
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
                No data for {submittedDate} or {previewDate}.
              </div>
            </div>
          ) : sortedRows.map((row: any) => (
            <div key={row.TR_TYPE} style={{ display: 'contents' }}>
              <RowLabel tr_type={row.TR_TYPE} />
              <SnapshotCell prev={row.PREV_SUBS}    curr={row.CURR_SUBS} />
              <SnapshotCell prev={row.PREV_VOLUME}  curr={row.CURR_VOLUME} />
              <SnapshotCell prev={row.PREV_VALUE}   curr={row.CURR_VALUE} />
              <SnapshotCell prev={row.PREV_REVENUE} curr={row.CURR_REVENUE} />
            </div>
          ))}
        </div>
      </div>
     </div>
     {xlsx.overlay}
    </DashboardLayout>
  )
}

/* ── Subcomponents ──────────────────────────────────────────────── */

function ColumnHeader({ icon, label }: { icon: React.ReactNode, label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 'var(--space-2)',
      fontSize: 'var(--fs-micro)', fontWeight: 600,
      color: 'var(--text-tertiary)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-uppercase)',
      padding: 'var(--space-2) 0 var(--space-3)',
      borderBottom: '1px solid var(--border-default)',
    }}>
      <span style={{ display: 'inline-flex', color: 'var(--text-tertiary)' }}>{icon}</span>
      {label}
    </div>
  )
}

function RowLabel({ tr_type }: { tr_type: string }) {
  const label = TR_TYPE_LABELS[tr_type] || tr_type
  const cat = CATEGORIES[tr_type]
  const isInbound = cat === 'Inbound'
  const catColor = isInbound ? 'var(--positive)' : cat === 'Outbound' ? 'var(--negative)' : 'var(--text-muted)'
  const icon = isInbound
    ? <ArrowDownCircle size={11} strokeWidth={1.75} color="var(--positive)" />
    : cat === 'Outbound'
      ? <ArrowUpCircle size={11} strokeWidth={1.75} color="var(--negative)" />
      : null
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: 'var(--space-2) var(--space-3)',
      minHeight: '68px',
      borderRight: '1px solid var(--border-default)',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          {icon}
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: catColor,
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
          }}>
            {cat || 'Other'}
          </span>
        </div>
        <div style={{
          fontSize: 'var(--fs-md)', fontWeight: 600,
          color: 'var(--text-primary)',
          marginTop: 'var(--space-1)',
          letterSpacing: 'var(--tracking-tight)',
          lineHeight: 1.2,
        }}>
          {label}
        </div>
      </div>
    </div>
  )
}

