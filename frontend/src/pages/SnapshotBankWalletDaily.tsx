import { useState, useMemo, useRef } from "react"
import {
  TrendingUp, TrendingDown, Minus,
  Users as UsersIcon, BarChart3, Wallet, DollarSign,
  Building2, ArrowDownCircle, ArrowUpCircle,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useBankWalletSnapshotDaily } from "../hooks/useAnalytics"
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

export default function SnapshotBankWalletDaily() {
  const [localReportDate, setLocalReportDate] = useState<string>(todayMinus1())
  const [submittedDate, setSubmittedDate] = useState<string>(todayMinus1())
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const xlsx = useXlsxExport()

  const { data, isLoading, isFetching, refetch } = useBankWalletSnapshotDaily({
    reportDate: submittedDate,
  })

  const handleApply = () => setSubmittedDate(localReportDate)
  const busy = isLoading || isFetching

  const previewDate = useMemo(() => {
    const d = new Date(submittedDate)
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  }, [submittedDate])

  const rows: BankRow[] = data?.rows ?? []

  // Regrouper par BANK_NAME, avec b2w / w2b
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
      await exportNodeToPdf(pageRef.current, `Snapshot_BankWallet_WoW_${submittedDate}_vs_${previewDate}`)
    } catch (e) {
      console.error("PDF export failed", e)
      alert("L'export PDF a échoué — voir la console.")
    } finally {
      setIsExportingPdf(false)
    }
  }

  const downloadAsXlsx = () => xlsx.downloadXlsx(
    '/customers/snapshot-bank-wallet-daily/export.xlsx',
    { report_date: submittedDate },
    `Snapshot_BankWallet_WoW_${submittedDate}_vs_${previewDate}.xlsx`,
  )

  return (
    <DashboardLayout>
      <div ref={pageRef} style={{ background: 'var(--mc-bg)', padding: '4px' }}>
        <SnapshotHeader
          icon={<Building2 size={20} strokeWidth={1.75} />}
          title="Bank vs Wallet"
          subtitle="Snapshot"
          tag="WEEK-ON-WEEK"
          tagColor="slate"
          description={<>Comparison <strong>Current</strong> vs <strong>Preview (J-7)</strong> per bank (Bank↔Wallet).</>}
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
          prevStart={previewDate} prevEnd={previewDate} prevLabel="Preview Day"
          currStart={submittedDate} currEnd={submittedDate} currLabel="Current Day"
          busy={busy}
        />

        {/* GRID: 1 colonne label (banque+direction) + 4 colonnes (SUBS/VOLUME/VALUE/REVENUE) */}
        <div style={{ marginTop: '20px', overflowX: 'auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '220px repeat(4, minmax(auto, 1fr))',
            gap: '10px',
            alignItems: 'stretch',
          }}>
            <div />
            <ColumnHeader icon={<UsersIcon size={13} />} label="Subscriber" />
            <ColumnHeader icon={<BarChart3 size={13} />} label="Volume" />
            <ColumnHeader icon={<Wallet size={13} />}    label="Value" />
            <ColumnHeader icon={<DollarSign size={13} />} label="Revenue" />

            {busy ? (
              <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: '#94a3b8' }}>
                <div className="spinner" style={{ margin: '0 auto 12px' }} />
                <div style={{ fontWeight: '700', color: '#475569' }}>Loading Bank vs Wallet snapshot…</div>
              </div>
            ) : groups.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: '#94a3b8' }}>
                <Minus size={28} style={{ opacity: 0.3 }} />
                <div style={{ fontWeight: '700', color: '#475569', marginTop: '8px' }}>
                  Aucune donnée pour {submittedDate} ou {previewDate}.
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

function BankBlock({ group }: { group: BankGroup }) {
  const b2w = group.b2w
  const w2b = group.w2b
  return (
    <div style={{ display: 'contents' }}>
      {/* Bank label (spans 2 rows via flex on label cell; we use 2 separate label cells in grid) */}
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
  const dirColor = isInbound ? '#059669' : '#b91c1c'
  const DirIcon = isInbound ? ArrowDownCircle : ArrowUpCircle
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '0 12px', minHeight: '64px',
      borderRight: '1px solid var(--mc-border)',
    }}>
      <div style={{ width: '24px', display: 'flex', justifyContent: 'center' }}>
        {showBank && <Building2 size={18} color="#0f172a" />}
      </div>
      <div style={{ flex: 1 }}>
        {showBank && (
          <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a', letterSpacing: '-0.2px' }}>
            {bank}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: showBank ? '2px' : 0 }}>
          <DirIcon size={12} color={dirColor} />
          <span style={{ fontSize: '11px', fontWeight: '800', color: dirColor }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', fontSize: '9px', fontWeight: '800', color: '#94a3b8', letterSpacing: '0.4px', textTransform: 'uppercase', textAlign: 'center' }}>
        <span>Prev</span>
        <span>Curr</span>
        <span>Diff</span>
        <span>Var</span>
      </div>
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
