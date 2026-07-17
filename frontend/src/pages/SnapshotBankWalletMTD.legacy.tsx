import { useState, useMemo, useRef } from "react"
import {
  Calendar, RefreshCw, Download, TrendingUp, TrendingDown, Minus,
  Users as UsersIcon, BarChart3, Wallet, DollarSign,
  Building2, ArrowDownCircle, ArrowUpCircle
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useBankWalletSnapshotMtd } from "../hooks/useAnalytics"
import { exportNodeToPdf } from "../utils/pdfExport"
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

  return (
    <DashboardLayout>
      <div ref={pageRef} style={{ background: 'var(--mc-bg)', padding: '4px' }}>
        {/* HEADER */}
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 className="page-title" style={{ margin: 0 }}>Bank vs Wallet — Snapshot</h1>
              <span style={{ background: '#1e293b', color: 'white', fontSize: '10px', fontWeight: '800', padding: '4px 8px', borderRadius: '6px', letterSpacing: '0.5px' }}>MONTH-ON-MONTH · MTD</span>
            </div>
            <p className="page-subtitle" style={{ marginTop: '6px' }}>
              Comparaison <strong>Current MTD</strong> vs <strong>Previous Month MTD</strong> par banque (Bank↔Wallet).
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => refetch()} disabled={busy} title="Refresh"
              style={{ background: 'white', color: 'var(--mc-text-main)', border: '1px solid var(--mc-border)', height: '40px', padding: '0 14px', borderRadius: '8px', fontWeight: '700', cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={downloadAsPdf} disabled={!groups.length || busy || isExportingPdf}
              title="Télécharge la page en PDF"
              style={{ background: (!groups.length || busy || isExportingPdf) ? '#cbd5e1' : '#dc2626', color: 'white', border: 'none', height: '40px', padding: '0 16px', borderRadius: '8px', fontWeight: '800', cursor: (!groups.length || busy || isExportingPdf) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', boxShadow: (!groups.length || busy || isExportingPdf) ? 'none' : '0 4px 6px -1px rgba(220, 38, 38, 0.2)' }}>
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
            <DateBadge label="Previous MTD" date={prevStart && prevEnd ? `${prevStart} → ${prevEnd}` : '—'} accent="#059669" />
            <DateBadge label="Current MTD"  date={currStart && currEnd ? `${currStart} → ${currEnd}` : '—'} accent="#2563eb" bold />
          </div>
        </div>

        {/* GRID */}
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
                <div style={{ fontWeight: '700', color: '#475569' }}>Loading Bank vs Wallet MTD…</div>
              </div>
            ) : groups.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '80px 0', textAlign: 'center', color: '#94a3b8' }}>
                <Minus size={28} style={{ opacity: 0.3 }} />
                <div style={{ fontWeight: '700', color: '#475569', marginTop: '8px' }}>
                  Aucune donnée pour la période sélectionnée.
                </div>
              </div>
            ) : groups.map((g) => (
              <BankBlock key={g.bank} group={g} />
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
      <span style={{ fontSize: bold ? '13px' : '12px', fontWeight: bold ? '900' : '700', color: 'var(--mc-text-main)', fontVariantNumeric: 'tabular-nums', marginTop: '2px' }}>{date}</span>
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
