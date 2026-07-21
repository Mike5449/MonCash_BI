import { useState, useMemo, useRef } from "react"
import {
  Minus,
  Users as UsersIcon, BarChart3, Wallet, DollarSign,
  MapPin, Smartphone,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import {
  useSnapshotDailyByDimension,
  useMtdSnapshotByDimension,
} from "../hooks/useAnalytics"
import { exportNodeToPdf } from "../utils/pdfExport"
import { SnapshotHeader, SnapshotFilterBar, SnapshotCell, useXlsxExport } from "../components/SnapshotChrome"
import "../premium.css"

// ── Shared MonCash KPIs Snapshot · grouped by DEPARTMENT or CHANNEL ───────────
// Sert pour les 4 pages :
//   /customers/snapshot-department-daily  — Department WoW
//   /customers/snapshot-department-mtd    — Department MoM (MTD)
//   /customers/snapshot-channel-daily     — Channel WoW
//   /customers/snapshot-channel-mtd       — Channel MoM (MTD)

type Period = 'daily' | 'mtd'
type Dimension = 'DEPARTMENT' | 'CHANNEL'

interface DimensionSnapshotPageProps {
  dimension: Dimension
  period: Period
}


const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

export default function DimensionSnapshotPage({ dimension, period }: DimensionSnapshotPageProps) {
  const [localReportDate, setLocalReportDate] = useState<string>(todayMinus1())
  const [submittedDate, setSubmittedDate] = useState<string>(todayMinus1())
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const xlsx = useXlsxExport()

  // Branche le bon hook selon la période
  const dailyQ = useSnapshotDailyByDimension({
    reportDate: period === 'daily' ? submittedDate : '',
    dimension,
  })
  const mtdQ = useMtdSnapshotByDimension({
    reportDate: period === 'mtd' ? submittedDate : '',
    dimension,
  })
  const active = period === 'daily' ? dailyQ : mtdQ
  const { data, isLoading, isFetching, refetch } = active

  const handleApply = () => setSubmittedDate(localReportDate)
  const busy = isLoading || isFetching

  const periods = useMemo(() => {
    if (period === 'daily') {
      const prev = new Date(submittedDate)
      prev.setDate(prev.getDate() - 7)
      return {
        currStart: (data as any)?.current_date ?? submittedDate,
        currEnd:   (data as any)?.current_date ?? submittedDate,
        prevStart: (data as any)?.prev_date ?? prev.toISOString().split('T')[0],
        prevEnd:   (data as any)?.prev_date ?? prev.toISOString().split('T')[0],
      }
    }
    return {
      currStart: (data as any)?.current_start ?? '',
      currEnd:   (data as any)?.current_end   ?? submittedDate,
      prevStart: (data as any)?.prev_start    ?? '',
      prevEnd:   (data as any)?.prev_end      ?? '',
    }
  }, [data, submittedDate, period])

  const rows: any[] = (data as any)?.rows ?? []

  // Trie par CURR_VALUE décroissant (déjà fait côté SQL mais on garde la stabilité React)
  const sortedRows = useMemo(() => {
    const arr = [...rows]
    arr.sort((a: any, b: any) => Number(b.CURR_VALUE ?? 0) - Number(a.CURR_VALUE ?? 0))
    return arr
  }, [rows])

  const dimLabel = dimension === 'DEPARTMENT' ? 'Department' : 'Channel'
  const dimColumnHeader = dimLabel.toUpperCase()
  const compareLabel = period === 'daily' ? 'WEEK-ON-WEEK' : 'MONTH-ON-MONTH'
  const compareDesc =
    period === 'daily'
      ? <>Comparaison <strong>Current</strong> vs <strong>Preview (J-7)</strong> par {dimLabel.toLowerCase()}.</>
      : <>MTD courant vs MTD mois précédent (même jour-du-mois), par {dimLabel.toLowerCase()}.</>

  const filenameTag = period === 'daily'
    ? `Snapshot_${dimLabel}_WoW_${periods.currEnd}_vs_${periods.prevEnd}`
    : `Snapshot_${dimLabel}_MTD_${periods.currEnd}_vs_${periods.prevEnd}`

  const downloadAsPdf = async () => {
    if (!pageRef.current || !sortedRows.length) {
      if (!sortedRows.length) alert("Aucune donnée à exporter.")
      return
    }
    setIsExportingPdf(true)
    try {
      await exportNodeToPdf(pageRef.current, filenameTag)
    } catch (e) {
      console.error("PDF export failed", e)
      alert("L'export PDF a échoué — voir la console.")
    } finally {
      setIsExportingPdf(false)
    }
  }

  const downloadAsXlsx = () => xlsx.downloadXlsx(
    period === 'daily'
      ? '/customers/snapshot-daily-by-dimension/export.xlsx'
      : '/customers/snapshot-mtd-by-dimension/export.xlsx',
    { report_date: submittedDate, dimension },
    `${filenameTag}.xlsx`,
  )

  return (
    <DashboardLayout>
     <div ref={pageRef} style={{ background: 'var(--surface-canvas)', padding: 'var(--space-1)' }}>
      <SnapshotHeader
        icon={dimension === 'DEPARTMENT'
          ? <MapPin size={20} strokeWidth={1.75} />
          : <Smartphone size={20} strokeWidth={1.75} />}
        title="MonCash KPIs Snapshot"
        subtitle={`By ${dimLabel}${period === 'mtd' ? ' · MTD' : ''}`}
        tag={compareLabel}
        tagColor={period === 'daily' ? 'slate' : 'brand'}
        description={compareDesc}
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
        prevStart={periods.prevStart}
        prevEnd={periods.prevEnd}
        prevLabel={period === 'daily' ? 'Preview Day' : 'Previous MTD'}
        currStart={periods.currStart}
        currEnd={periods.currEnd}
        currLabel={period === 'daily' ? 'Current Day' : 'Current MTD'}
        busy={busy}
      />

      {/* ── KPI GRID ─────────────────────────────────────────────── */}
      <div style={{ marginTop: 'var(--space-6)', overflowX: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '220px repeat(4, minmax(230px, 1fr))',
          gap: 'var(--space-3)',
          alignItems: 'stretch',
        }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end',
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
            padding: 'var(--space-2) var(--space-3) var(--space-3)',
            borderBottom: '1px solid var(--border-default)',
          }}>
            {dimColumnHeader}
          </div>
          <ColumnHeader icon={<UsersIcon size={12} strokeWidth={1.75} />} label="Subscribers" />
          <ColumnHeader icon={<BarChart3 size={12} strokeWidth={1.75} />} label="Volume" />
          <ColumnHeader icon={<Wallet     size={12} strokeWidth={1.75} />} label="Value" />
          <ColumnHeader icon={<DollarSign size={12} strokeWidth={1.75} />} label="Revenue" />

          {busy && sortedRows.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--text-secondary)' }}>
                Loading {dimLabel.toLowerCase()} snapshot…
              </div>
            </div>
          ) : sortedRows.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Minus size={22} strokeWidth={1.75} style={{ opacity: 0.35 }} />
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
                No data for these two periods.
              </div>
            </div>
          ) : sortedRows.map((row: any) => (
            <div key={row.DIM_VALUE} style={{ display: 'contents' }}>
              <RowLabel dim_value={row.DIM_VALUE} />
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

// --------- Subcomponents ---------

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

function RowLabel({ dim_value }: { dim_value: string }) {
  const label = dim_value || 'Unknown'
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: 'var(--space-2) var(--space-3)',
      minHeight: '68px',
      borderRight: '1px solid var(--border-default)',
    }}>
      <div style={{
        fontSize: 'var(--fs-md)', fontWeight: 600,
        color: 'var(--text-primary)',
        letterSpacing: 'var(--tracking-tight)',
        lineHeight: 1.2,
      }}>
        {label}
      </div>
    </div>
  )
}

