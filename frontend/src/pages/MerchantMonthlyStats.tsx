import { useState, useMemo } from "react"
import {
  RefreshCw, Download, Search, Activity, XCircle, X, Calendar,
  Smartphone, CheckCircle, UserSearch, Store, ArrowUpDown,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useMerchantMonthlyStats } from "../hooks/useAnalytics"
import { type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const EXPORT_LIMIT = 200_000

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
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

type SortKey = 'MONTH' | 'MERCHANT_ID' | 'MERCHANT_NAME' | 'SUBS' | 'VOLUME' | 'VALUE' | 'REVENUE'
type SortDir = 'asc' | 'desc'

export default function MerchantMonthlyStats() {
  // ── Local editing state ──
  const [localStartMonth, setLocalStartMonth] = useState<string>(monthsAgoYyyyMM(5))
  const [localEndMonth,   setLocalEndMonth]   = useState<string>(currentYyyyMM())
  const [merchantIdsInput, setMerchantIdsInput] = useState("")
  const [msisdnsInput,     setMsisdnsInput]     = useState("")
  const [localChannel,     setLocalChannel]     = useState<string>("")
  const [localStatus,      setLocalStatus]      = useState<string>("Completed")

  // ── Applied / submitted state ──
  const [startMonth, setStartMonth] = useState<string>(monthsAgoYyyyMM(5))
  const [endMonth,   setEndMonth]   = useState<string>(currentYyyyMM())
  const [merchantIds, setMerchantIds] = useState<string[] | undefined>(undefined)
  const [msisdns,     setMsisdns]     = useState<string[] | undefined>(undefined)
  const [channels,    setChannels]    = useState<string[] | undefined>(undefined)
  const [statuses,    setStatuses]    = useState<string[] | undefined>(["Completed"])

  // ── UI state ──
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>('MONTH')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // ── Export ──
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)

  const apply = () => {
    setStartMonth(localStartMonth); setEndMonth(localEndMonth)
    setMerchantIds(parseList(merchantIdsInput))
    setMsisdns(parseList(msisdnsInput))
    setChannels(localChannel ? [localChannel] : undefined)
    setStatuses(localStatus === 'all' ? ['*'] : [localStatus])
  }
  const clearFilters = () => {
    setLocalStartMonth(monthsAgoYyyyMM(5)); setLocalEndMonth(currentYyyyMM())
    setMerchantIdsInput(""); setMsisdnsInput(""); setLocalChannel(""); setLocalStatus("Completed")
    setStartMonth(monthsAgoYyyyMM(5)); setEndMonth(currentYyyyMM())
    setMerchantIds(undefined); setMsisdns(undefined); setChannels(undefined); setStatuses(["Completed"])
  }
  const setQuickMonths = (n: 3 | 6 | 12 | 24) => {
    const s = monthsAgoYyyyMM(n - 1), e = currentYyyyMM()
    setLocalStartMonth(s); setLocalEndMonth(e)
    setStartMonth(s); setEndMonth(e)
  }

  // ── Fetch ──
  const { data, isLoading, isFetching, refetch } = useMerchantMonthlyStats({
    startMonth: monthToIsoDate(startMonth),
    endMonth:   monthToIsoDate(endMonth),
    merchantIds, msisdns, channels, statuses,
  })

  const busy = isLoading || isFetching
  const rows: any[] = ((data as any)?.rows as any[]) ?? []
  const totals = useMemo(() => ({
    UNIQUE_SUBS:      Number((data as any)?.totals?.UNIQUE_SUBS      ?? 0),
    UNIQUE_MERCHANTS: Number((data as any)?.totals?.UNIQUE_MERCHANTS ?? 0),
    VOLUME:           Number((data as any)?.totals?.VOLUME           ?? 0),
    VALUE:            Number((data as any)?.totals?.VALUE            ?? 0),
    REVENUE:          Number((data as any)?.totals?.REVENUE          ?? 0),
  }), [data])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r: any) =>
      String(r.MERCHANT_ID ?? '').toLowerCase().includes(s) ||
      String(r.MERCHANT_NAME ?? '').toLowerCase().includes(s) ||
      String(r.MERCHANT_TYPE ?? '').toLowerCase().includes(s) ||
      String(r.DEPARTMENT ?? '').toLowerCase().includes(s) ||
      String(r.MONTH ?? '').toLowerCase().includes(s)
    )
  }, [rows, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a: any, b: any) => {
      const av = a[sortKey], bv = b[sortKey]
      if (sortKey === 'MONTH' || sortKey === 'MERCHANT_ID' || sortKey === 'MERCHANT_NAME') {
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
    else { setSortKey(k); setSortDir(k === 'MERCHANT_ID' || k === 'MERCHANT_NAME' ? 'asc' : 'desc') }
  }

  const isCustomStatus = statuses && !(statuses.length === 1 && statuses[0] === 'Completed')
  const hasFilters = !!merchantIds || !!msisdns || !!channels || !!isCustomStatus

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
      merchantIds?.forEach(m => qs.append('merchant_ids', m))
      msisdns?.forEach(m => qs.append('msisdns', m))
      channels?.forEach(c => qs.append('channels', c))
      statuses?.forEach(s => qs.append('statuses', s))

      const res = await fetch(`${OpenAPI.BASE}/merchants/monthly-stats/export.xlsx?${qs.toString()}`)
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
      a.download = `Merchant_Monthly_Stats_${startMonth}_to_${endMonth}.xlsx`
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

  // Helper for date input → yyyy-MM convert (input type="month")
  void todayMinus1

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
            Merchant · Monthly · Aggregate by month × merchant
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Merchant Monthly Stats
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            Each row aggregates one (month, merchant) — distinct customers (Subs), volume, value and revenue.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => refetch()} disabled={busy} title="Refresh"
            style={{
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              height: '34px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: busy ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              opacity: busy ? 0.5 : 1,
            }}>
            <RefreshCw size={13} strokeWidth={1.75} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={handleExport} disabled={!canExport}
            style={{
              background: canExport ? 'var(--positive)' : 'var(--surface-muted)',
              color: canExport ? 'white' : 'var(--text-muted)',
              border: '1px solid ' + (canExport ? 'var(--positive)' : 'var(--border-default)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: canExport ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            {isExporting ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <Download size={13} strokeWidth={1.75} />}
            {isExporting ? "Exporting" : "Export Excel"}
          </button>
        </div>
      </div>

      {/* ── KPI STRIP — Subs · Volume · Value · Revenue · Merchants ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        <KpiCard label="Unique subs"      value={busy ? '—' : fmtNum(totals.UNIQUE_SUBS)}      accent="var(--data-subs)"    sub="distinct customers" />
        <KpiCard label="Unique merchants" value={busy ? '—' : fmtNum(totals.UNIQUE_MERCHANTS)} accent="var(--data-volume)"  sub="distinct merchant IDs" />
        <KpiCard label="Volume"           value={busy ? '—' : fmtNum(totals.VOLUME)}           accent="var(--data-value)"   sub="distinct transactions" />
        <KpiCard label="Value (HTG)"      value={busy ? '—' : fmtMoney(totals.VALUE)}          accent="var(--positive)"     sub="sum of amounts" />
        <KpiCard label="Revenue (HTG)"    value={busy ? '—' : fmtMoney(totals.REVENUE)}        accent="var(--data-revenue)" sub="MFS charges" />
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
        <div style={{
          fontSize: 'var(--fs-md)', color: 'var(--text-tertiary)',
          paddingBottom: '10px', fontWeight: 400,
        }}>→</div>
        <Field label="To month">
          <MonthInput value={localEndMonth} min={localStartMonth} max={currentYyyyMM()} onChange={setLocalEndMonth} />
        </Field>

        <Field label="Quick range">
          <Segmented
            options={([3, 6, 12, 24] as const).map(n => ({
              value: String(n),
              label: `${n}m`,
              active: false,
              onClick: () => setQuickMonths(n),
            }))}
          />
        </Field>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)', margin: '0 var(--space-2)' }} />

        <Field label="Merchant IDs">
          <TextInputWithIcon
            icon={<Store size={13} strokeWidth={1.75} color="var(--text-tertiary)" />}
            value={merchantIdsInput} onChange={setMerchantIdsInput} onEnter={apply}
            placeholder="Merchant ID(s)…" width={200}
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
          <div style={{
            position: 'relative',
            display: 'flex', alignItems: 'center',
            background: 'var(--surface-card)',
            border: '1px solid ' + (localChannel ? 'var(--text-primary)' : 'var(--border-default)'),
            borderRadius: 'var(--radius-md)',
          }}>
            <Smartphone size={13} strokeWidth={1.75} color="var(--text-tertiary)"
              style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
            <select value={localChannel} onChange={(e) => setLocalChannel(e.target.value)}
              style={{
                height: '38px', width: '160px',
                paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)',
                border: 'none', background: 'transparent', outline: 'none',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                color: 'var(--text-primary)',
              }}>
              <option value="">All channels</option>
              <option value="API">API</option>
              <option value="Web">Web</option>
              <option value="QR">QR</option>
              <option value="USSD_Digicel">USSD_Digicel</option>
            </select>
          </div>
        </Field>

        <Field label="Status">
          <div style={{
            position: 'relative',
            display: 'flex', alignItems: 'center',
            background: 'var(--surface-card)',
            border: '1px solid ' + (localStatus !== 'Completed' ? 'var(--text-primary)' : 'var(--border-default)'),
            borderRadius: 'var(--radius-md)',
          }}>
            <CheckCircle size={13} strokeWidth={1.75} color="var(--text-tertiary)"
              style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
            <select value={localStatus} onChange={(e) => setLocalStatus(e.target.value)}
              style={{
                height: '38px', width: '160px',
                paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)',
                border: 'none', background: 'transparent', outline: 'none',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                color: 'var(--text-primary)',
              }}>
              <option value="all">All statuses</option>
              <option value="Completed">Completed</option>
              <option value="Pending">Pending</option>
              <option value="Failed">Failed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Reversed">Reversed</option>
            </select>
          </div>
        </Field>

        <div style={{ paddingBottom: '0', display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={apply} disabled={busy}
            style={{
              background: 'var(--brand)', color: 'white',
              border: '1px solid var(--brand)',
              height: '38px', padding: '0 var(--space-5)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 600, fontSize: 'var(--fs-body)',
              letterSpacing: '0.01em',
              cursor: busy ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              opacity: busy ? 0.5 : 1,
            }}>
            <Search size={13} strokeWidth={1.75} /> Apply
          </button>
          <button onClick={clearFilters}
            style={{
              background: 'var(--surface-card)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
              height: '38px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: 'pointer',
            }}>
            Clear
          </button>
        </div>

        <div style={{
          marginLeft: 'auto',
          paddingBottom: '10px',
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
          gap: 'var(--space-1)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Applied window</span>
          <span style={{
            fontSize: 'var(--fs-body)', fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            {monthLabel(startMonth)} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>→</span> {monthLabel(endMonth)}
          </span>
          {hasFilters && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '380px' }}>
              {merchantIds && <Tag>{merchantIds.length} merchant{merchantIds.length > 1 ? 's' : ''}</Tag>}
              {msisdns     && <Tag>{msisdns.length} MSISDN{msisdns.length > 1 ? 's' : ''}</Tag>}
              {channels    && <Tag>{channels[0]}</Tag>}
              {isCustomStatus && <Tag>{statuses?.[0] === '*' ? 'All statuses' : `Status: ${statuses?.[0]}`}</Tag>}
            </div>
          )}
        </div>
      </div>

      {/* ── TABLE · newspaper-style ── */}
      <div style={{
        marginTop: 'var(--space-4)',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--surface-muted)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Store size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>Monthly stats · month × merchant</span>
            {!busy && rows.length > 0 && (
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                padding: '1px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {fmtNum(sorted.length)} / {fmtNum(rows.length)} rows
              </span>
            )}
          </div>
          {busy ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>
              <div className="spinner-small" /> <span>Querying</span>
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              color: 'var(--positive)',
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>
              <Activity size={11} strokeWidth={1.75} /> <span>Ready</span>
            </div>
          )}
          <div style={{
            marginLeft: 'auto',
            position: 'relative',
            display: 'flex', alignItems: 'center',
            background: 'var(--surface-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
          }}>
            <Search size={13} strokeWidth={1.75} color="var(--text-tertiary)"
              style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Filter month, merchant ID/name, department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                border: 'none', background: 'transparent', outline: 'none',
                height: '34px',
                paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-3)',
                fontSize: 'var(--fs-body)', fontWeight: 500,
                width: '320px',
                color: 'var(--text-primary)',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')}
                style={{
                  position: 'absolute', right: 'var(--space-2)',
                  background: 'transparent', border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer', padding: '2px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 'var(--radius-xs)',
                }} title="Clear search">
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{
            width: '100%', minWidth: '1500px',
            borderCollapse: 'collapse',
            fontSize: 'var(--fs-body)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <thead style={{ background: 'var(--surface-muted)' }}>
              <tr>
                <SortHead k="MONTH"         label="Month"          sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHead k="MERCHANT_ID"   label="Merchant ID"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHead k="MERCHANT_NAME" label="Merchant name"  sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <th style={headerCellStyle}>Type</th>
                <th style={headerCellStyle}>Fee</th>
                <th style={headerCellStyle}>Department</th>
                <SortHead k="SUBS"          label="Subs"           sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortHead k="VOLUME"        label="Volume"         sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortHead k="VALUE"         label="Value (HTG)"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortHead k="REVENUE"       label="Revenue (HTG)"  sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {busy && rows.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Aggregating monthly stats…</div>
                </td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
                    {rows.length === 0 ? "No monthly aggregate for this window and filter combination." : "No row matches the search."}
                  </div>
                </td></tr>
              ) : sorted.map((r: any, idx: number) => (
                <tr key={`${r.MONTH}-${r.MERCHANT_ID}-${idx}`} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    color: 'var(--text-primary)', fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}>
                    {monthLabel(r.MONTH)}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                    <span style={{
                      border: '1px solid var(--border-default)',
                      background: 'var(--surface-card)',
                      padding: '1px var(--space-2)',
                      borderRadius: 'var(--radius-xs)',
                      fontSize: 'var(--fs-label)', fontWeight: 500,
                      color: 'var(--text-primary)',
                      fontFamily: 'ui-monospace, monospace',
                    }}>{r.MERCHANT_ID || '—'}</span>
                  </td>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    color: r.MERCHANT_NAME ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: 500,
                    maxWidth: '220px',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }} title={r.MERCHANT_NAME || ''}>
                    {r.MERCHANT_NAME || '—'}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                    {r.MERCHANT_TYPE || '—'}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                    {r.FEE || '—'}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                    {r.DEPARTMENT || '—'}
                  </td>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: 'right',
                    color: 'var(--text-primary)', fontWeight: 500,
                  }}>
                    {fmtNum(r.SUBS)}
                  </td>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: 'right',
                    color: 'var(--text-primary)', fontWeight: 500,
                  }}>
                    {fmtNum(r.VOLUME)}
                  </td>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: 'right',
                    color: 'var(--text-primary)', fontWeight: 600,
                  }}>
                    {fmtNum(r.VALUE)}
                  </td>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: 'right',
                    color: 'var(--text-primary)', fontWeight: 500,
                  }}>
                    {fmtNum(r.REVENUE)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            borderTop: '1px solid var(--border-default)',
            background: 'var(--surface-muted)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 'var(--fs-label)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <div>
              <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(rows.length)}</strong> (month × merchant) rows
            </div>
            <div>
              Excel export retrieves <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>all</strong> rows (up to {fmtNum(EXPORT_LIMIT)})
            </div>
          </div>
        )}
      </div>

      <ExportOverlay progress={exportProgress} />
    </DashboardLayout>
  )
}

// ── Primitives ──

const headerCellStyle = {
  padding: 'var(--space-2) var(--space-4)',
  textAlign: 'left' as const,
  fontSize: 'var(--fs-micro)',
  fontWeight: 600,
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase' as const,
  letterSpacing: 'var(--tracking-uppercase)',
  borderBottom: '1px solid var(--border-default)',
  whiteSpace: 'nowrap' as const,
}

function SortHead({ k, label, sortKey, sortDir, onClick, align = 'left' }: {
  k: SortKey, label: string,
  sortKey: SortKey, sortDir: SortDir,
  onClick: (k: SortKey) => void,
  align?: 'left' | 'right',
}) {
  const active = sortKey === k
  return (
    <th onClick={() => onClick(k)} style={{
      ...headerCellStyle,
      textAlign: align,
      cursor: 'pointer', userSelect: 'none',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        color: active ? 'var(--text-primary)' : 'inherit',
      }}>
        {label}
        <ArrowUpDown size={10} strokeWidth={1.75} style={{ opacity: active ? 1 : 0.35 }} />
        {active && <span style={{ fontSize: 'var(--fs-micro)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}

function KpiCard({ label, value, sub, accent }: { label: string, value: string, sub?: string, accent: string }) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <div style={{ height: '3px', background: accent }} />
      <div style={{ padding: 'var(--space-6) var(--space-5) var(--space-6)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginBottom: 'var(--space-5)',
        }}>
          <span style={{
            width: '7px', height: '7px',
            borderRadius: '50%',
            background: accent,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
          }}>{label}</span>
        </div>
        <div style={{
          fontSize: '28px', fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}>{value}</div>
        {sub && (
          <div style={{
            fontSize: 'var(--fs-label)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--border-faint)',
          }}>{sub}</div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <label style={{
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-uppercase)',
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function MonthInput({ value, min, max, onChange }: { value: string, min?: string, max?: string, onChange: (v: string) => void }) {
  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
    }}>
      <Calendar size={13} strokeWidth={1.75} color="var(--text-tertiary)"
        style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
      <input type="month"
        value={value} min={min} max={max}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: '38px', width: '160px',
          paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)',
          border: 'none', background: 'transparent', outline: 'none',
          fontWeight: 500, fontSize: 'var(--fs-body)',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--text-primary)',
        }} />
    </div>
  )
}

function TextInputWithIcon({
  icon, value, onChange, onEnter, placeholder, width,
}: {
  icon: React.ReactNode
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  placeholder: string
  width: number
}) {
  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center',
      background: 'var(--surface-card)',
      border: '1px solid ' + (value ? 'var(--text-primary)' : 'var(--border-default)'),
      borderRadius: 'var(--radius-md)',
    }}>
      <span style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none', display: 'inline-flex' }}>
        {icon}
      </span>
      <input type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter() }}
        placeholder={placeholder}
        style={{
          height: '38px', width: `${width}px`,
          paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)',
          border: 'none', background: 'transparent', outline: 'none',
          fontWeight: 500, fontSize: 'var(--fs-body)',
          color: 'var(--text-primary)',
        }} />
      {value && (
        <button onClick={() => onChange('')}
          style={{
            position: 'absolute', right: 'var(--space-2)',
            background: 'transparent', border: 'none',
            color: 'var(--text-tertiary)',
            cursor: 'pointer', padding: '2px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'var(--radius-xs)',
          }} title="Clear">
          <X size={11} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

type SegOption = { value: string, label: string, active: boolean, title?: string, onClick: () => void }

function Segmented({ options }: { options: SegOption[] }) {
  return (
    <div style={{
      display: 'inline-flex',
      background: 'var(--surface-muted)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '3px',
      gap: '2px',
    }}>
      {options.map(opt => (
        <button key={opt.value || 'all'}
          onClick={opt.onClick}
          title={opt.title}
          style={{
            padding: '0 var(--space-3)', height: '30px',
            borderRadius: 'var(--radius-xs)',
            border: 'none',
            background: opt.active ? 'var(--surface-card)' : 'transparent',
            color: opt.active ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontWeight: opt.active ? 600 : 500,
            fontSize: 'var(--fs-label)',
            cursor: 'pointer',
            transition: 'background 0.12s, color 0.12s',
            boxShadow: opt.active ? '0 0 0 1px var(--border-default) inset' : 'none',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      border: '1px solid var(--border-default)',
      background: 'var(--surface-muted)',
      padding: '2px var(--space-2)',
      borderRadius: 'var(--radius-xs)',
      fontWeight: 500,
      fontSize: 'var(--fs-micro)',
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-uppercase)',
    }}>{children}</span>
  )
}
