import { useState, useMemo, useRef } from "react"
import {
  TrendingUp, TrendingDown, Minus,
  Users as UsersIcon, BarChart3, Wallet, DollarSign,
  Building2, ArrowDownCircle, ArrowUpCircle,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useBankWalletSnapshotMtd } from "../hooks/useAnalytics"
import { exportNodeToPdf } from "../utils/pdfExport"
import { SnapshotHeader, SnapshotFilterBar, useXlsxExport, SNAPSHOT_TREND } from "../components/SnapshotChrome"
import "../premium.css"

const fmtNum = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const fmtPct = (v: number) =>
  (v >= 0 ? '+' : '') + v.toFixed(2) + '%'

const variation = (prev: number, curr: number): number => {
  if (!prev && !curr) return 0
  if (!prev) return 100
  return ((curr - prev) / prev) * 100
}

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

type BankRow = {
  BANK_NAME: string
  TRANSACTION_TYPE: 'BANK TO WALLET' | 'WALLET TO BANK'
  PREV_SUBS: number; CURR_SUBS: number
  PREV_VOLUME: number; CURR_VOLUME: number
  PREV_VALUE: number; CURR_VALUE: number
  PREV_REVENUE: number; CURR_REVENUE: number
}

type BankGroup = {
  bank: string
  b2w?: BankRow
  w2b?: BankRow
}

export default function SnapshotBankWalletMTD() {
  const [localReportDate, setLocalReportDate] = useState<string>(todayMinus1())
  const [submittedDate, setSubmittedDate] = useState<string>(todayMinus1())
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const xlsx = useXlsxExport()

  const { data, isLoading, isFetching, refetch } = useBankWalletSnapshotMtd({
    reportDate: submittedDate,
  })

  const handleApply = () => setSubmittedDate(localReportDate)
  const busy = isLoading || isFetching

  const rows: BankRow[] = data?.rows ?? []
  const currStart = data?.current_start
  const currEnd   = data?.current_end
  const prevStart = data?.prev_start
  const prevEnd   = data?.prev_end

  const groups: BankGroup[] = useMemo(() => {
    const byBank = new Map<string, BankGroup>()
    for (const r of rows) {
      const key = (r.BANK_NAME || '').trim() || '—'
      if (!byBank.has(key)) byBank.set(key, { bank: key })
      const g = byBank.get(key)!
      if (r.TRANSACTION_TYPE === 'BANK TO WALLET') g.b2w = r
      else if (r.TRANSACTION_TYPE === 'WALLET TO BANK') g.w2b = r
    }
    return Array.from(byBank.values()).sort((a, b) => a.bank.localeCompare(b.bank))
  }, [rows])

  const downloadAsPdf = async () => {
    if (!pageRef.current || !groups.length) {
      if (!groups.length) alert("Aucune donnée à exporter.")
      return
    }
    setIsExportingPdf(true)
    try {
      await exportNodeToPdf(pageRef.current, `Snapshot_BankWallet_MoM_MTD_${submittedDate}`)
    } catch (e) {
      console.error("PDF export failed", e)
      alert("L'export PDF a échoué — voir la console.")
    } finally {
      setIsExportingPdf(false)
    }
  }

  const downloadAsXlsx = () => xlsx.downloadXlsx(
    '/customers/snapshot-bank-wallet-mtd/export.xlsx',
    { report_date: submittedDate },
    `Snapshot_BankWallet_MoM_MTD_${submittedDate}.xlsx`,
  )

  return (
    <DashboardLayout>
      <div ref={pageRef} style={{ background: 'var(--surface-canvas)', padding: 'var(--space-1)' }}>
        <SnapshotHeader
          icon={<Building2 size={20} strokeWidth={1.75} />}
          title="Bank vs Wallet"
          subtitle="Snapshot · MTD"
          tag="MONTH-ON-MONTH · MTD"
          tagColor="brand"
          description={<>Comparison <strong>Current MTD</strong> vs <strong>Previous Month MTD</strong> per bank (Bank↔Wallet).</>}
          onRefresh={() => refetch()}
          busy={busy}
          hasData={groups.length > 0}
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
          prevStart={prevStart || ''} prevEnd={prevEnd || ''} prevLabel="Previous MTD"
          currStart={currStart || ''} currEnd={currEnd || ''} currLabel="Current MTD"
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
            <div />
            <ColumnHeader icon={<UsersIcon size={12} strokeWidth={1.75} />} label="Subscriber" />
            <ColumnHeader icon={<BarChart3 size={12} strokeWidth={1.75} />} label="Volume" />
            <ColumnHeader icon={<Wallet     size={12} strokeWidth={1.75} />} label="Value" />
            <ColumnHeader icon={<DollarSign size={12} strokeWidth={1.75} />} label="Revenue" />

            {busy ? (
              <div style={{ gridColumn: '1 / -1', padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--text-secondary)' }}>Loading Bank vs Wallet MTD…</div>
              </div>
            ) : groups.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <Minus size={22} strokeWidth={1.75} style={{ opacity: 0.35 }} />
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
                  No data for the selected period.
                </div>
              </div>
            ) : groups.map((g) => (
              <BankBlock key={g.bank} group={g} />
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

function BankBlock({ group }: { group: BankGroup }) {
  const b2w = group.b2w
  const w2b = group.w2b
  return (
    <div style={{ display: 'contents' }}>
      <BankLabel bank={group.bank} direction="B2W" />
      <Cell prev={b2w?.PREV_SUBS}    curr={b2w?.CURR_SUBS} />
      <Cell prev={b2w?.PREV_VOLUME}  curr={b2w?.CURR_VOLUME} />
      <Cell prev={b2w?.PREV_VALUE}   curr={b2w?.CURR_VALUE} />
      <Cell prev={b2w?.PREV_REVENUE} curr={b2w?.CURR_REVENUE} />

      <BankLabel bank={group.bank} direction="W2B" showBank={false} />
      <Cell prev={w2b?.PREV_SUBS}    curr={w2b?.CURR_SUBS} />
      <Cell prev={w2b?.PREV_VOLUME}  curr={w2b?.CURR_VOLUME} />
      <Cell prev={w2b?.PREV_VALUE}   curr={w2b?.CURR_VALUE} />
      <Cell prev={w2b?.PREV_REVENUE} curr={w2b?.CURR_REVENUE} />
    </div>
  )
}

function BankLabel({ bank, direction, showBank = true }: { bank: string, direction: 'B2W' | 'W2B', showBank?: boolean }) {
  const isInbound = direction === 'B2W'
  const dirLabel = isInbound ? 'Bank to Wallet' : 'Wallet to Bank'
  const dirColor = isInbound ? 'var(--positive)' : 'var(--negative)'
  const DirIcon = isInbound ? ArrowDownCircle : ArrowUpCircle
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
      padding: 'var(--space-2) var(--space-3)', minHeight: '68px',
      borderRight: '1px solid var(--border-default)',
    }}>
      <div style={{ width: '22px', display: 'flex', justifyContent: 'center' }}>
        {showBank && <Building2 size={16} strokeWidth={1.75} color="var(--text-secondary)" />}
      </div>
      <div style={{ flex: 1 }}>
        {showBank && (
          <div style={{
            fontSize: 'var(--fs-md)', fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: 'var(--tracking-tight)',
            lineHeight: 1.2,
          }}>
            {bank}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginTop: showBank ? 'var(--space-1)' : 0 }}>
          <DirIcon size={11} strokeWidth={1.75} color={dirColor} />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: dirColor,
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
          }}>
            {dirLabel}
          </span>
        </div>
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

  const trendColor = isFlat ? SNAPSHOT_TREND.FLAT_FG : isUp ? SNAPSHOT_TREND.UP_FG : SNAPSHOT_TREND.DOWN_FG
  const trendBg    = isFlat ? SNAPSHOT_TREND.FLAT_BG : isUp ? SNAPSHOT_TREND.UP_BG : SNAPSHOT_TREND.DOWN_BG
  const TrendIcon  = isFlat ? Minus : isUp ? TrendingUp : TrendingDown

  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: 'var(--text-tertiary)',
        letterSpacing: 'var(--tracking-uppercase)',
        textTransform: 'uppercase',
        textAlign: 'center',
      }}>
        <span>Prev</span>
        <span>Curr</span>
        <span>Diff</span>
        <span>Var</span>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        alignItems: 'center', gap: 'var(--space-1)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span style={{
          fontSize: 'var(--fs-body)', fontWeight: 500,
          color: 'var(--text-secondary)',
          textAlign: 'center', whiteSpace: 'nowrap',
        }}>
          {fmtNum(p)}
        </span>
        <span style={{
          fontSize: 'var(--fs-body)', fontWeight: 600,
          color: 'var(--text-primary)',
          textAlign: 'center', whiteSpace: 'nowrap',
        }}>
          {fmtNum(c)}
        </span>
        <span style={{
          fontSize: 'var(--fs-label)', fontWeight: 600,
          color: trendColor, background: trendBg,
          padding: '2px var(--space-2)', borderRadius: 'var(--radius-sm)',
          textAlign: 'center', whiteSpace: 'nowrap',
        }}>
          {diff >= 0 ? '+' : '−'}{fmtNum(Math.abs(diff))}
        </span>
        <span style={{
          fontSize: 'var(--fs-label)', fontWeight: 600,
          color: trendColor, background: trendBg,
          padding: '2px var(--space-2)', borderRadius: 'var(--radius-sm)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '3px',
          whiteSpace: 'nowrap',
        }}>
          <TrendIcon size={10} strokeWidth={2} />
          {fmtPct(varPct)}
        </span>
      </div>
    </div>
  )
}
