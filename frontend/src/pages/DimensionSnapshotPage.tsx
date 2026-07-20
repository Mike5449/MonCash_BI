import { useState, useMemo, useRef } from "react"
import {
  TrendingUp, TrendingDown, Minus,
  Users as UsersIcon, BarChart3, Wallet, DollarSign,
  MapPin, Smartphone,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import {
  useSnapshotDailyByDimension,
  useMtdSnapshotByDimension,
} from "../hooks/useAnalytics"
import { exportNodeToPdf } from "../utils/pdfExport"
import { SnapshotHeader, SnapshotFilterBar, useXlsxExport, SNAPSHOT_TREND } from "../components/SnapshotChrome"
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
     <div ref={pageRef} style={{ background: 'var(--mc-bg)', padding: '4px' }}>
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

      {/* Spacer entre filter et grid */}
      <div style={{ height: '8px' }} />

      {/* GRID */}
      <div style={{ marginTop: '20px', overflowX: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '220px repeat(4, minmax(auto, 1fr))',
          gap: '10px',
          alignItems: 'stretch',
        }}>
          {/* COLUMN HEADERS */}
          <div style={{
            display: 'flex', alignItems: 'flex-end',
            fontSize: '11px', fontWeight: 800, color: '#0f172a',
            textTransform: 'uppercase', letterSpacing: '0.5px',
            padding: '6px 12px',
          }}>
            {dimColumnHeader}
          </div>
          <ColumnHeader icon={<UsersIcon size={13} />} label="Subscribers" />
          <ColumnHeader icon={<BarChart3 size={13} />} label="Volume" />
          <ColumnHeader icon={<Wallet size={13} />}    label="Value" />
          <ColumnHeader icon={<DollarSign size={13} />} label="Revenue" />

          {busy && sortedRows.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: '#94a3b8' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontWeight: 700, color: '#475569' }}>
                Loading {dimLabel.toLowerCase()} snapshot…
              </div>
            </div>
          ) : sortedRows.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: '#94a3b8' }}>
              <Minus size={28} style={{ opacity: 0.3 }} />
              <div style={{ fontWeight: 700, color: '#475569', marginTop: '8px' }}>
                Aucune donnée pour ces deux périodes.
              </div>
            </div>
          ) : sortedRows.map((row: any) => (
            <div key={row.DIM_VALUE} style={{ display: 'contents' }}>
              <RowLabel dim_value={row.DIM_VALUE} />
              <Cell prev={row.PREV_SUBS}    curr={row.CURR_SUBS} />
              <Cell prev={row.PREV_VOLUME}  curr={row.CURR_VOLUME} />
              <Cell prev={row.PREV_VALUE}   curr={row.CURR_VALUE} />
              <Cell prev={row.PREV_REVENUE} curr={row.CURR_REVENUE} />
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
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
      fontSize: '11px', fontWeight: 800, color: '#0f172a',
      textTransform: 'uppercase', letterSpacing: '0.5px',
      padding: '6px 0',
    }}>
      <span style={{ color: 'var(--mc-red)' }}>{icon}</span>
      {label}
    </div>
  )
}

function RowLabel({ dim_value }: { dim_value: string }) {
  const label = dim_value || 'Unknown'
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '0 12px', minHeight: '64px',
      borderRight: '1px solid var(--mc-border)',
    }}>
      <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.2px' }}>
        {label}
      </div>
    </div>
  )
}

function Cell({ prev, curr }: { prev: any, curr: any }) {
  const p = Number(prev ?? 0)
  const c = Number(curr ?? 0)
  const diff = c - p
  const varPct = variation(p, c)
  const isUp = diff > 0
  const isFlat = diff === 0

  const color = isFlat ? SNAPSHOT_TREND.FLAT_FG : isUp ? SNAPSHOT_TREND.UP_FG : SNAPSHOT_TREND.DOWN_FG
  const bg    = isFlat ? SNAPSHOT_TREND.FLAT_BG : isUp ? SNAPSHOT_TREND.UP_BG : SNAPSHOT_TREND.DOWN_BG
  const TrendIcon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown

  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--mc-border)',
      borderRadius: '6px',
      padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: '8px',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', fontSize: '9px', fontWeight: 800, color: '#94a3b8', letterSpacing: '0.4px', textTransform: 'uppercase', textAlign: 'center' }}>
        <span>Prev</span>
        <span>Curr</span>
        <span>Diff</span>
        <span>Var</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', fontVariantNumeric: 'tabular-nums', textAlign: 'center', whiteSpace: 'nowrap' }}>
          {fmtNum(p)}
        </span>
        <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums', textAlign: 'center', whiteSpace: 'nowrap' }}>
          {fmtNum(c)}
        </span>
        <span style={{
          fontSize: '11px', fontWeight: 800,
          color, background: bg,
          padding: '2px 6px', borderRadius: '5px',
          textAlign: 'center', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        }}>
          {diff >= 0 ? '+' : '−'}{fmtNum(Math.abs(diff))}
        </span>
        <span style={{
          fontSize: '11px', fontWeight: 800,
          color, background: bg,
          padding: '2px 6px', borderRadius: '5px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '3px',
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        }}>
          <TrendIcon size={10} />
          {fmtPct(varPct)}
        </span>
      </div>
    </div>
  )
}
