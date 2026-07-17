import { useState, useMemo } from "react"
import {
  RefreshCw, Download, Search, Activity, XCircle, X, Calendar,
  Smartphone, CheckCircle, UserSearch, Building2, ArrowUpDown,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { usePrefundedMonthlyStats } from "../hooks/useAnalytics"
import { type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const EXPORT_LIMIT = 200_000

const pad2 = (n: number) => String(n).padStart(2, '0')
const currentYyyyMM = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
const monthsAgoYyyyMM = (n: number) => {
  const d = new Date()
  d.setDate(1); d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
const monthToIsoDate = (yyyyMM: string) => `${yyyyMM}-01`
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December']
const monthLabel = (yyyyMM: string) => {
  const [y, m] = yyyyMM.split('-')
  return `${MONTH_NAMES[parseInt(m, 10)]} ${y}`
}

const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtMoney = (v: any) => {
  const n = Number(v ?? 0)
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + ' M'
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + ' K'
  return n.toFixed(0)
}

const parseList = (raw: string): string[] | undefined => {
  const arr = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
  return arr.length > 0 ? arr : undefined
}

type SortKey = 'MONTH' | 'ORG_ID' | 'ORG_NAME' | 'SUBS' | 'VOLUME' | 'VALUE' | 'REVENUE'
type SortDir = 'asc' | 'desc'

export default function PrefundedMonthlyStats() {
  const [localStartMonth, setLocalStartMonth] = useState<string>(monthsAgoYyyyMM(5))
  const [localEndMonth,   setLocalEndMonth]   = useState<string>(currentYyyyMM())
  const [orgIdsInput,  setOrgIdsInput]  = useState("")
  const [msisdnsInput, setMsisdnsInput] = useState("")
  const [localChannel, setLocalChannel] = useState<string>("")
  const [localStatus,  setLocalStatus]  = useState<string>("Completed")

  const [startMonth, setStartMonth] = useState<string>(monthsAgoYyyyMM(5))
  const [endMonth,   setEndMonth]   = useState<string>(currentYyyyMM())
  const [orgIds,   setOrgIds]   = useState<string[] | undefined>(undefined)
  const [msisdns,  setMsisdns]  = useState<string[] | undefined>(undefined)
  const [channels, setChannels] = useState<string[] | undefined>(undefined)
  const [statuses, setStatuses] = useState<string[] | undefined>(["Completed"])

  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>('MONTH')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)

  const apply = () => {
    setStartMonth(localStartMonth); setEndMonth(localEndMonth)
    setOrgIds(parseList(orgIdsInput))
    setMsisdns(parseList(msisdnsInput))
    setChannels(localChannel ? [localChannel] : undefined)
    setStatuses(localStatus === 'all' ? ['*'] : [localStatus])
  }
  const clearFilters = () => {
    setLocalStartMonth(monthsAgoYyyyMM(5)); setLocalEndMonth(currentYyyyMM())
    setOrgIdsInput(""); setMsisdnsInput(""); setLocalChannel(""); setLocalStatus("Completed")
    setStartMonth(monthsAgoYyyyMM(5)); setEndMonth(currentYyyyMM())
    setOrgIds(undefined); setMsisdns(undefined); setChannels(undefined); setStatuses(["Completed"])
  }
  const setQuickMonths = (n: 3 | 6 | 12 | 24) => {
    const s = monthsAgoYyyyMM(n - 1), e = currentYyyyMM()
    setLocalStartMonth(s); setLocalEndMonth(e)
    setStartMonth(s); setEndMonth(e)
  }

  const { data, isLoading, isFetching, refetch } = usePrefundedMonthlyStats({
    startMonth: monthToIsoDate(startMonth),
    endMonth:   monthToIsoDate(endMonth),
    orgIds, msisdns, channels, statuses,
  })

  const busy = isLoading || isFetching
  const rows: any[] = ((data as any)?.rows as any[]) ?? []
  const totals = useMemo(() => ({
    UNIQUE_ORGS: Number((data as any)?.totals?.UNIQUE_ORGS ?? 0),
    UNIQUE_SUBS: Number((data as any)?.totals?.UNIQUE_SUBS ?? 0),
    VOLUME:      Number((data as any)?.totals?.VOLUME      ?? 0),
    VALUE:       Number((data as any)?.totals?.VALUE       ?? 0),
    REVENUE:     Number((data as any)?.totals?.REVENUE     ?? 0),
  }), [data])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r: any) =>
      String(r.ORG_ID ?? '').toLowerCase().includes(s) ||
      String(r.ORG_NAME ?? '').toLowerCase().includes(s) ||
      String(r.MONTH ?? '').toLowerCase().includes(s)
    )
  }, [rows, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a: any, b: any) => {
      const av = a[sortKey], bv = b[sortKey]
      if (sortKey === 'MONTH' || sortKey === 'ORG_ID' || sortKey === 'ORG_NAME') {
        const as = String(av ?? ''), bs = String(bv ?? '')
        return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
      }
      const an = Number(av ?? 0), bn = Number(bv ?? 0)
      return sortDir === 'asc' ? an - bn : bn - an
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'ORG_ID' || k === 'ORG_NAME' ? 'asc' : 'desc') }
  }

  const isCustomStatus = statuses && !(statuses.length === 1 && statuses[0] === 'Completed')
  const hasFilters = !!orgIds || !!msisdns || !!channels || !!isCustomStatus

  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    setExportProgress({ bytesReceived: 0, totalBytes: 0, phase: 'Server is generating the file…' })
    try {
      const { OpenAPI } = await import("../api/core/OpenAPI")
      const qs = new URLSearchParams()
      qs.set('start_month', monthToIsoDate(startMonth))
      qs.set('end_month',   monthToIsoDate(endMonth))
      qs.set('limit', String(EXPORT_LIMIT))
      orgIds?.forEach(o => qs.append('org_ids', o))
      msisdns?.forEach(m => qs.append('msisdns', m))
      channels?.forEach(c => qs.append('channels', c))
      statuses?.forEach(s => qs.append('statuses', s))

      const res = await fetch(`${OpenAPI.BASE}/prefunded/monthly-stats/export.xlsx?${qs.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('Content-Length') || 0)
      setExportProgress({ bytesReceived: 0, totalBytes: total, phase: 'Downloading…' })
      const reader = res.body!.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) { chunks.push(value); received += value.length
          setExportProgress(prev => prev ? { ...prev, bytesReceived: received } : null) }
      }
      const blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const dl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = dl
      a.download = `Prefunded_Monthly_Stats_${startMonth}_to_${endMonth}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(dl)
    } catch (e) {
      console.error("Export failed", e)
      alert("Export failed — see console.")
    } finally {
      setIsExporting(false)
      setExportProgress(null)
    }
  }

  const canExport = !busy && !isExporting && rows.length > 0

  return (
    <DashboardLayout>
      {/* ── HERO ── */}
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
            B2B · Prefunded · Monthly · Aggregate by month × organization
          </div>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)', fontWeight: 600, letterSpacing: 'var(--tracking-tight)', color: 'var(--text-primary)', lineHeight: 1.15 }}>
            Prefunded Monthly Stats
          </h1>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
            Each row aggregates one (month, organization) — distinct customers receiving (Subs), volume, value and revenue.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Btn onClick={() => refetch()} disabled={busy} variant="outline"><RefreshCw size={13} strokeWidth={1.75} className={busy ? "animate-spin" : ""} /> Refresh</Btn>
          <Btn onClick={handleExport} disabled={!canExport} variant="positive">
            {isExporting ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <Download size={13} strokeWidth={1.75} />}
            {isExporting ? "Exporting" : "Export Excel"}
          </Btn>
        </div>
      </div>

      {/* ── KPI STRIP ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        <KpiCard label="Unique subs"   value={busy ? '—' : fmtNum(totals.UNIQUE_SUBS)} accent="var(--data-subs)"    sub="distinct MSISDN receiving" />
        <KpiCard label="Unique orgs"   value={busy ? '—' : fmtNum(totals.UNIQUE_ORGS)} accent="var(--data-volume)"  sub="distinct organizations" />
        <KpiCard label="Volume"        value={busy ? '—' : fmtNum(totals.VOLUME)}      accent="var(--data-value)"   sub="distinct transactions" />
        <KpiCard label="Value (HTG)"   value={busy ? '—' : fmtMoney(totals.VALUE)}     accent="var(--positive)"     sub="sum of amounts" />
        <KpiCard label="Revenue (HTG)" value={busy ? '—' : fmtMoney(totals.REVENUE)}   accent="var(--data-revenue)" sub="MFS charges" />
      </div>

      {/* ── FILTER PANEL ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-6)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap',
        gap: 'var(--space-5)',
      }}>
        <Field label="From month">
          <MonthInput value={localStartMonth} max={localEndMonth} onChange={setLocalStartMonth} />
        </Field>
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-tertiary)', paddingBottom: '10px' }}>→</div>
        <Field label="To month">
          <MonthInput value={localEndMonth} min={localStartMonth} max={currentYyyyMM()} onChange={setLocalEndMonth} />
        </Field>

        <Field label="Quick range">
          <Segmented options={([3, 6, 12, 24] as const).map(n => ({
            value: String(n), label: `${n}m`, active: false, onClick: () => setQuickMonths(n),
          }))} />
        </Field>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)', margin: '0 var(--space-2)' }} />

        <Field label="Organization IDs">
          <TextInputWithIcon
            icon={<Building2 size={13} strokeWidth={1.75} color="var(--text-tertiary)" />}
            value={orgIdsInput} onChange={setOrgIdsInput} onEnter={apply}
            placeholder="Org ID(s)…" width={200}
          />
        </Field>
        <Field label="MSISDNs">
          <TextInputWithIcon
            icon={<UserSearch size={13} strokeWidth={1.75} color="var(--text-tertiary)" />}
            value={msisdnsInput} onChange={setMsisdnsInput} onEnter={apply}
            placeholder="50937…, 50938…" width={200}
          />
        </Field>
        <Field label="Channel">
          <SelectWithIcon icon={<Smartphone size={13} strokeWidth={1.75} color="var(--text-tertiary)" />} value={localChannel} active={!!localChannel} onChange={setLocalChannel}>
            <option value="">All channels</option>
            <option value="API">API</option>
            <option value="Web">Web</option>
            <option value="QR">QR</option>
            <option value="USSD_Digicel">USSD_Digicel</option>
          </SelectWithIcon>
        </Field>
        <Field label="Status">
          <SelectWithIcon icon={<CheckCircle size={13} strokeWidth={1.75} color="var(--text-tertiary)" />} value={localStatus} active={localStatus !== 'Completed'} onChange={setLocalStatus}>
            <option value="all">All statuses</option>
            <option value="Completed">Completed</option>
            <option value="Pending">Pending</option>
            <option value="Failed">Failed</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Reversed">Reversed</option>
          </SelectWithIcon>
        </Field>

        <div style={{ paddingBottom: '0', display: 'flex', gap: 'var(--space-2)' }}>
          <Btn onClick={apply} disabled={busy} variant="brand"><Search size={13} strokeWidth={1.75} /> Apply</Btn>
          <Btn onClick={clearFilters} variant="outline">Clear</Btn>
        </div>

        <div style={{ marginLeft: 'auto', paddingBottom: '10px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)' }}>Applied window</span>
          <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)' }}>
            {monthLabel(startMonth)} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>→</span> {monthLabel(endMonth)}
          </span>
          {hasFilters && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '380px' }}>
              {orgIds   && <Tag>{orgIds.length} org{orgIds.length > 1 ? 's' : ''}</Tag>}
              {msisdns  && <Tag>{msisdns.length} MSISDN{msisdns.length > 1 ? 's' : ''}</Tag>}
              {channels && <Tag>{channels[0]}</Tag>}
              {isCustomStatus && <Tag>{statuses?.[0] === '*' ? 'All statuses' : `Status: ${statuses?.[0]}`}</Tag>}
            </div>
          )}
        </div>
      </div>

      {/* ── TABLE ── */}
      <div style={{ marginTop: 'var(--space-4)', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <TableHeader icon={<Building2 size={13} strokeWidth={1.75} color="var(--text-tertiary)" />} title="Monthly stats · month × organization"
          countBadge={!busy && rows.length > 0 ? `${fmtNum(sorted.length)} / ${fmtNum(rows.length)} rows` : null}
          busy={busy} search={search} setSearch={setSearch}
          placeholder="Filter month, org ID/name…" />

        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{ width: '100%', minWidth: '1100px', borderCollapse: 'collapse', fontSize: 'var(--fs-body)', fontVariantNumeric: 'tabular-nums' }}>
            <thead style={{ background: 'var(--surface-muted)' }}>
              <tr>
                <SortHead k="MONTH"    label="Month"           sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHead k="ORG_ID"   label="Organization ID" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHead k="ORG_NAME" label="Organization name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHead k="SUBS"     label="Subs"            sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortHead k="VOLUME"   label="Volume"          sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortHead k="VALUE"    label="Value (HTG)"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortHead k="REVENUE"  label="Revenue (HTG)"   sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {busy && rows.length === 0 ? (
                <tr><td colSpan={7} style={emptyCellStyle}>
                  <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Aggregating monthly stats…</div>
                </td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={7} style={emptyCellStyle}>
                  <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
                    {rows.length === 0 ? "No monthly aggregate for this window and filter combination." : "No row matches the search."}
                  </div>
                </td></tr>
              ) : sorted.map((r: any, idx: number) => (
                <tr key={`${r.MONTH}-${r.ORG_ID}-${idx}`} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                  <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {monthLabel(r.MONTH)}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                    <Chip>{r.ORG_ID || '—'}</Chip>
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)', color: r.ORG_NAME ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: 500, maxWidth: '260px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.ORG_NAME || ''}>
                    {r.ORG_NAME || '—'}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 500 }}>{fmtNum(r.SUBS)}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 500 }}>{fmtNum(r.VOLUME)}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{fmtNum(r.VALUE)}</td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 500 }}>{fmtNum(r.REVENUE)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div style={tableFooterStyle}>
            <div><strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(rows.length)}</strong> (month × org) rows</div>
            <div>Excel export retrieves <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>all</strong> rows (up to {fmtNum(EXPORT_LIMIT)})</div>
          </div>
        )}
      </div>

      <ExportOverlay progress={exportProgress} />
    </DashboardLayout>
  )
}

// ── Shared primitives ──

const emptyCellStyle = { padding: 'var(--space-16) 0', textAlign: 'center' as const, color: 'var(--text-tertiary)' }
const tableFooterStyle = {
  padding: 'var(--space-3) var(--space-4)',
  borderTop: '1px solid var(--border-default)', background: 'var(--surface-muted)',
  display: 'flex', justifyContent: 'space-between' as const, alignItems: 'center' as const,
  fontSize: 'var(--fs-label)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' as const,
}
const headerCellStyle = {
  padding: 'var(--space-2) var(--space-4)', textAlign: 'left' as const,
  fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--text-tertiary)',
  textTransform: 'uppercase' as const, letterSpacing: 'var(--tracking-uppercase)',
  borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap' as const,
}

function SortHead({ k, label, sortKey, sortDir, onClick, align = 'left' }: {
  k: SortKey, label: string, sortKey: SortKey, sortDir: SortDir,
  onClick: (k: SortKey) => void, align?: 'left' | 'right',
}) {
  const active = sortKey === k
  return (
    <th onClick={() => onClick(k)} style={{ ...headerCellStyle, textAlign: align, cursor: 'pointer', userSelect: 'none' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: active ? 'var(--text-primary)' : 'inherit' }}>
        {label}
        <ArrowUpDown size={10} strokeWidth={1.75} style={{ opacity: active ? 1 : 0.35 }} />
        {active && <span style={{ fontSize: 'var(--fs-micro)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}

function TableHeader({ icon, title, countBadge, busy, search, setSearch, placeholder }: {
  icon: React.ReactNode, title: string, countBadge: string | null, busy: boolean,
  search: string, setSearch: (s: string) => void, placeholder: string,
}) {
  return (
    <div style={{
      padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-default)',
      background: 'var(--surface-muted)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {icon}
        <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)' }}>{title}</span>
        {countBadge && (
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500, color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)', background: 'var(--surface-card)',
            padding: '1px var(--space-2)', borderRadius: 'var(--radius-xs)', fontVariantNumeric: 'tabular-nums',
          }}>{countBadge}</span>
        )}
      </div>
      {busy ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-tertiary)', fontSize: 'var(--fs-micro)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)' }}>
          <div className="spinner-small" /> <span>Querying</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--positive)', fontSize: 'var(--fs-micro)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)' }}>
          <Activity size={11} strokeWidth={1.75} /> <span>Ready</span>
        </div>
      )}
      <div style={{
        marginLeft: 'auto', position: 'relative', display: 'flex', alignItems: 'center',
        background: 'var(--surface-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)',
      }}>
        <Search size={13} strokeWidth={1.75} color="var(--text-tertiary)" style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
        <input type="text" placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ border: 'none', background: 'transparent', outline: 'none', height: '34px', paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-3)', fontSize: 'var(--fs-body)', fontWeight: 500, width: '320px', color: 'var(--text-primary)' }} />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 'var(--space-2)', background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)' }} title="Clear search">
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, accent }: { label: string, value: string, sub?: string, accent: string }) {
  return (
    <div style={{ position: 'relative', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ height: '3px', background: accent }} />
      <div style={{ padding: 'var(--space-6) var(--space-5) var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: accent, flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)' }}>{label}</span>
        </div>
        <div style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 'var(--fs-label)', fontWeight: 500, color: 'var(--text-tertiary)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-faint)' }}>{sub}</div>}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <label style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)' }}>{label}</label>
      {children}
    </div>
  )
}

function MonthInput({ value, min, max, onChange }: { value: string, min?: string, max?: string, onChange: (v: string) => void }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
      <Calendar size={13} strokeWidth={1.75} color="var(--text-tertiary)" style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
      <input type="month" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)}
        style={{ height: '38px', width: '160px', paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)', border: 'none', background: 'transparent', outline: 'none', fontWeight: 500, fontSize: 'var(--fs-body)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }} />
    </div>
  )
}

function TextInputWithIcon({ icon, value, onChange, onEnter, placeholder, width }: {
  icon: React.ReactNode, value: string, onChange: (v: string) => void,
  onEnter?: () => void, placeholder: string, width: number,
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', background: 'var(--surface-card)', border: '1px solid ' + (value ? 'var(--text-primary)' : 'var(--border-default)'), borderRadius: 'var(--radius-md)' }}>
      <span style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none', display: 'inline-flex' }}>{icon}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter() }}
        placeholder={placeholder}
        style={{ height: '38px', width: `${width}px`, paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)', border: 'none', background: 'transparent', outline: 'none', fontWeight: 500, fontSize: 'var(--fs-body)', color: 'var(--text-primary)' }} />
      {value && (
        <button onClick={() => onChange('')} style={{ position: 'absolute', right: 'var(--space-2)', background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)' }} title="Clear">
          <X size={11} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

function SelectWithIcon({ icon, value, active, onChange, children }: {
  icon: React.ReactNode, value: string, active: boolean,
  onChange: (v: string) => void, children: React.ReactNode,
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', background: 'var(--surface-card)', border: '1px solid ' + (active ? 'var(--text-primary)' : 'var(--border-default)'), borderRadius: 'var(--radius-md)' }}>
      <span style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none', display: 'inline-flex' }}>{icon}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ height: '38px', width: '160px', paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)', border: 'none', background: 'transparent', outline: 'none', fontWeight: 500, fontSize: 'var(--fs-body)', color: 'var(--text-primary)' }}>
        {children}
      </select>
    </div>
  )
}

type SegOption = { value: string, label: string, active: boolean, title?: string, onClick: () => void }

function Segmented({ options }: { options: SegOption[] }) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--surface-muted)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '3px', gap: '2px' }}>
      {options.map(opt => (
        <button key={opt.value || 'all'} onClick={opt.onClick} title={opt.title}
          style={{ padding: '0 var(--space-3)', height: '30px', borderRadius: 'var(--radius-xs)', border: 'none', background: opt.active ? 'var(--surface-card)' : 'transparent', color: opt.active ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: opt.active ? 600 : 500, fontSize: 'var(--fs-label)', cursor: 'pointer', transition: 'background 0.12s, color 0.12s', boxShadow: opt.active ? '0 0 0 1px var(--border-default) inset' : 'none' }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ border: '1px solid var(--border-default)', background: 'var(--surface-muted)', padding: '2px var(--space-2)', borderRadius: 'var(--radius-xs)', fontWeight: 500, fontSize: 'var(--fs-micro)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)' }}>
      {children}
    </span>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      border: '1px solid var(--border-default)', background: 'var(--surface-card)',
      padding: '1px var(--space-2)', borderRadius: 'var(--radius-xs)',
      fontSize: 'var(--fs-label)', fontWeight: 500, color: 'var(--text-primary)',
      fontFamily: 'ui-monospace, monospace',
    }}>{children}</span>
  )
}

function Btn({ onClick, disabled, variant, children }: {
  onClick: () => void, disabled?: boolean, variant: 'brand' | 'outline' | 'positive',
  children: React.ReactNode,
}) {
  const base = {
    height: variant === 'outline' ? '34px' : '38px',
    padding: variant === 'positive' ? '0 var(--space-4)' : variant === 'brand' ? '0 var(--space-5)' : '0 var(--space-3)',
    borderRadius: 'var(--radius-md)',
    fontWeight: variant === 'brand' ? 600 : 500,
    fontSize: 'var(--fs-body)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex' as const, alignItems: 'center' as const, gap: 'var(--space-2)',
    opacity: disabled ? 0.5 : 1,
  }
  if (variant === 'brand') return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, background: 'var(--brand)', color: 'white', border: '1px solid var(--brand)', letterSpacing: '0.01em' }}>{children}</button>
  )
  if (variant === 'positive') return (
    <button onClick={onClick} disabled={disabled} style={{
      ...base,
      background: disabled ? 'var(--surface-muted)' : 'var(--positive)',
      color: disabled ? 'var(--text-muted)' : 'white',
      border: '1px solid ' + (disabled ? 'var(--border-default)' : 'var(--positive)'),
    }}>{children}</button>
  )
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...base, background: 'var(--surface-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)',
    }}>{children}</button>
  )
}
