import { useState, useEffect, useRef, useMemo } from "react"
import {
  RefreshCw, Download, Search, Activity, XCircle, X, Calendar,
  Smartphone, CheckCircle, UserSearch, Store, ChevronDown, Check,
  ArrowDownCircle, ArrowUpCircle,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useMerchantTransactions, useMerchantTransactionsSummary } from "../hooks/useAnalytics"
import { type ExportProgress } from "../utils/exportXlsx"
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
const fmtHTG = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const parseList = (raw: string): string[] | undefined => {
  const arr = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
  return arr.length > 0 ? arr : undefined
}

type Preset = '7' | '30' | '60' | '90' | 'custom'
type TrCategory = "Inbound" | "Outbound"
const TRANSACTION_TYPES: { id: string; label: string; category: TrCategory }[] = [
  // CREDIT — merchant reçoit
  { id: 'AGENT2MERC',        label: 'Agent → Merchant',         category: 'Inbound'  },
  { id: 'MERC_PAY',          label: 'Merchant Payment',         category: 'Inbound'  },
  { id: 'MERC_QR',           label: 'Merchant QR',              category: 'Inbound'  },
  { id: 'MERC_TILL',         label: 'Merchant Till',            category: 'Inbound'  },
  { id: 'MERC_ONLINE',       label: 'Merchant Online',          category: 'Inbound'  },
  { id: 'M2M_IN',            label: 'M2M (in)',                 category: 'Inbound'  },
  { id: 'M2M_TILL_IN',       label: 'M2M Till (in)',            category: 'Inbound'  },
  { id: 'MERC_CASHOUT_IN',   label: 'Cashout (received)',       category: 'Inbound'  },
  { id: 'AGENT_BILLPAY_IN',  label: 'Agent/Merch Bill (in)',    category: 'Inbound'  },
  // DEBIT — merchant paie
  { id: 'MERC_CASHOUT',      label: 'Merchant Cashout',         category: 'Outbound' },
  { id: 'AGENT_BILLPAY',     label: 'Agent/Merch Bill Pay',     category: 'Outbound' },
  { id: 'M2M_OUT',           label: 'M2M (out)',                category: 'Outbound' },
  { id: 'M2M_TILL_OUT',      label: 'M2M Till (out)',           category: 'Outbound' },
]
const TYPE_META: Record<string, { cat: TrCategory }> = Object.fromEntries(
  TRANSACTION_TYPES.map(t => [t.id, { cat: t.category }])
)

type ExportColumn = { key: string; label: string }
const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "DATE",           label: "Date" },
  { key: "TRANSACTION_ID", label: "Transaction ID" },
  { key: "TYPE",           label: "Type" },
  { key: "MSISDN",         label: "MSISDN" },
  { key: "MERCHANT_ID",    label: "Merchant ID" },
  { key: "AMOUNT",         label: "Amount (HTG)" },
  { key: "CHARGE",         label: "Charge (HTG)" },
  { key: "CHANNEL",        label: "Channel" },
  { key: "STATUS",         label: "Status" },
  { key: "REASON_TYPE",    label: "Reason Type" },
  { key: "INITIATOR",      label: "Initiator" },
  { key: "FAILURE_REASON", label: "Failure Reason" },
]

export default function MerchantTransactions() {
  // ── Local editing state ──
  const [preset, setPreset] = useState<Preset>('30')
  const [localStart, setLocalStart] = useState<string>(minusDays(30))
  const [localEnd,   setLocalEnd]   = useState<string>(todayMinus1())
  const [merchantIdsInput, setMerchantIdsInput] = useState("")
  const [msisdnsInput,     setMsisdnsInput]     = useState("")
  const [localChannel,     setLocalChannel]     = useState<string>("")
  const [localStatus,      setLocalStatus]      = useState<string>("Completed")
  const [localSelectedTypes, setLocalSelectedTypes] = useState<string[]>([])
  const [showTypeDropdown, setShowTypeDropdown] = useState(false)
  const typeDropdownRef = useRef<HTMLDivElement>(null)

  // ── Applied / submitted state (drives the queries) ──
  const [start, setStart] = useState<string>(minusDays(30))
  const [end,   setEnd]   = useState<string>(todayMinus1())
  const [merchantIds, setMerchantIds] = useState<string[] | undefined>(undefined)
  const [msisdns,     setMsisdns]     = useState<string[] | undefined>(undefined)
  const [channels,    setChannels]    = useState<string[] | undefined>(undefined)
  const [statuses,    setStatuses]    = useState<string[] | undefined>(["Completed"])
  const [serviceNames, setServiceNames] = useState<string[] | undefined>(undefined)

  // ── Local search in the displayed rows ──
  const [search, setSearch] = useState("")

  // ── Export state ──
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [selectedExportCols, setSelectedExportCols] = useState<string[]>(EXPORT_COLUMNS.map(c => c.key))

  // Sync preset → local date inputs
  useEffect(() => {
    if (preset !== 'custom') {
      const days = parseInt(preset, 10)
      setLocalStart(minusDays(days))
      setLocalEnd(todayMinus1())
    }
  }, [preset])

  // Close type dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) setShowTypeDropdown(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const apply = () => {
    setStart(localStart); setEnd(localEnd)
    setMerchantIds(parseList(merchantIdsInput))
    setMsisdns(parseList(msisdnsInput))
    setChannels(localChannel ? [localChannel] : undefined)
    setStatuses(localStatus === 'all' ? ['*'] : [localStatus])
    setServiceNames(localSelectedTypes.length > 0 ? localSelectedTypes : undefined)
  }
  const clearFilters = () => {
    setPreset('30')
    setLocalStart(minusDays(30)); setLocalEnd(todayMinus1())
    setMerchantIdsInput(""); setMsisdnsInput(""); setLocalChannel(""); setLocalStatus("Completed")
    setLocalSelectedTypes([])
    setStart(minusDays(30)); setEnd(todayMinus1())
    setMerchantIds(undefined); setMsisdns(undefined); setChannels(undefined)
    setStatuses(["Completed"]); setServiceNames(undefined)
  }
  const setQuick = (n: 7 | 30 | 60 | 90) => {
    const p = String(n) as Preset
    setPreset(p)
    const s = minusDays(n), e = todayMinus1()
    setLocalStart(s); setLocalEnd(e)
    setStart(s); setEnd(e)
  }
  const toggleType = (id: string) =>
    setLocalSelectedTypes(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])

  // ── Fetches ──
  const { data: transactions, isLoading, isFetching, refetch: refetchRows } = useMerchantTransactions({
    startDate: start, endDate: end,
    limit: DISPLAY_LIMIT,
    serviceNames, merchantIds, msisdns, channels, statuses,
  })
  const { data: summaryData, isFetching: summaryFetching, refetch: refetchSummary } = useMerchantTransactionsSummary({
    startDate: start, endDate: end,
    serviceNames, merchantIds, msisdns, channels, statuses,
  })

  const busy = isLoading || isFetching || summaryFetching

  const summary = useMemo(() => ({
    UNIQUE_SUBS:      Number((summaryData as any)?.UNIQUE_SUBS      ?? 0),
    UNIQUE_MERCHANTS: Number((summaryData as any)?.UNIQUE_MERCHANTS ?? (summaryData as any)?.DISTINCT_MERCHANT ?? 0),
    VOLUME:           Number((summaryData as any)?.VOLUME           ?? (summaryData as any)?.TOTAL_COUNT       ?? 0),
    VALUE:            Number((summaryData as any)?.VALUE            ?? (summaryData as any)?.TOTAL_VOLUME      ?? 0),
    REVENUE:          Number((summaryData as any)?.REVENUE          ?? (summaryData as any)?.TOTAL_CHARGE      ?? 0),
  }), [summaryData])

  const refetchAll = () => { refetchRows(); refetchSummary() }

  const rows: any[] = (transactions as any[]) ?? []
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r: any) =>
      String(r.TRANSACTIONID ?? '').toLowerCase().includes(s) ||
      String(r.MSISDN ?? '').toLowerCase().includes(s) ||
      String(r.MERCHANT_ID ?? '').toLowerCase().includes(s) ||
      String(r.TR_TYPE ?? '').toLowerCase().includes(s) ||
      String(r.CHANNEL ?? '').toLowerCase().includes(s)
    )
  }, [rows, search])

  const isCustomStatus = statuses && !(statuses.length === 1 && statuses[0] === 'Completed')
  const hasFilters = !!merchantIds || !!msisdns || !!channels || !!serviceNames || !!isCustomStatus

  const toggleExportCol = (key: string) =>
    setSelectedExportCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const runExport = async () => {
    if (isExporting || selectedExportCols.length === 0) return
    setIsExporting(true)
    setShowExportModal(false)
    setExportProgress({ bytesReceived: 0, totalBytes: 0, phase: 'Server is generating the file…' })
    try {
      const idsTag = merchantIds && merchantIds.length > 0
        ? `_${merchantIds.slice(0, 3).join("-")}${merchantIds.length > 3 ? "+" : ""}`
        : ""
      const { OpenAPI } = await import("../api/core/OpenAPI")
      const qs = new URLSearchParams()
      qs.set('start_date', start)
      qs.set('end_date',   end)
      qs.set('limit', String(EXPORT_LIMIT))
      qs.set('columns', selectedExportCols.join(','))
      serviceNames?.forEach(t => qs.append('service_names', t))
      merchantIds?.forEach(m => qs.append('merchant_ids', m))
      msisdns?.forEach(m => qs.append('msisdns', m))
      channels?.forEach(c => qs.append('channels', c))
      statuses?.forEach(s => qs.append('statuses', s))

      const res = await fetch(`${OpenAPI.BASE}/merchants/transactions/export.xlsx?${qs.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('Content-Length') || 0)
      setExportProgress({ bytesReceived: 0, totalBytes: total, phase: 'Downloading…' })
      const reader = res.body!.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value); received += value.length
          setExportProgress(prev => prev ? { ...prev, bytesReceived: received } : null)
        }
      }
      const blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const dl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = dl
      a.download = `Merchant_Transactions_${start}_to_${end}${idsTag}.xlsx`
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

  const canExport = !busy && !isExporting && summary.VOLUME > 0

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
            Merchant · Transactions · Daily audit log
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Merchant Transactions
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            Period: {start} → {end} · UNION credit + debit on PROCESS_DATE — both legs of M2M are shown.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={refetchAll} disabled={busy} title="Refresh"
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
          <button onClick={() => setShowExportModal(true)} disabled={!canExport}
            title={canExport ? "Export current result to Excel" : "No data to export"}
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

      {/* ── KPI STRIP — 5 cards (above filters) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        <KpiCard label="Unique subs"      value={summaryFetching ? '—' : fmtNum(summary.UNIQUE_SUBS)}      accent="var(--data-subs)"    sub="distinct customers" />
        <KpiCard label="Unique merchants" value={summaryFetching ? '—' : fmtNum(summary.UNIQUE_MERCHANTS)} accent="var(--data-volume)"  sub="distinct merchant IDs" />
        <KpiCard label="Volume"           value={summaryFetching ? '—' : fmtNum(summary.VOLUME)}           accent="var(--data-value)"   sub="distinct transactions" />
        <KpiCard label="Value (HTG)"      value={summaryFetching ? '—' : fmtMoney(summary.VALUE)}          accent="var(--positive)"     sub="sum of amounts" />
        <KpiCard label="Revenue (HTG)"    value={summaryFetching ? '—' : fmtMoney(summary.REVENUE)}        accent="var(--data-revenue)" sub="MFS charges" />
      </div>

      {/* ── FILTER PANEL ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-6)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap',
        gap: 'var(--space-5)',
        position: 'relative', zIndex: 10,
      }}>
        <Field label="From">
          <DateInput value={localStart} max={localEnd || todayMinus1()}
            onChange={(v) => { setLocalStart(v); setPreset('custom') }} />
        </Field>
        <div style={{
          fontSize: 'var(--fs-md)', color: 'var(--text-tertiary)',
          paddingBottom: '10px', fontWeight: 400,
        }}>→</div>
        <Field label="To">
          <DateInput value={localEnd} max={todayMinus1()}
            onChange={(v) => { setLocalEnd(v); setPreset('custom') }} />
        </Field>

        <Field label="Quick range">
          <Segmented
            options={([7, 30, 60, 90] as const).map(n => ({
              value: String(n),
              label: `${n}d`,
              active: preset === String(n),
              onClick: () => setQuick(n),
            }))}
          />
        </Field>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)', margin: '0 var(--space-2)' }} />

        <Field label="Merchant IDs">
          <TextInputWithIcon
            icon={<Store size={13} strokeWidth={1.75} color="var(--text-tertiary)" />}
            value={merchantIdsInput}
            onChange={setMerchantIdsInput}
            onEnter={apply}
            placeholder="Merchant ID(s)…"
            width={200}
          />
        </Field>

        <Field label="MSISDNs">
          <TextInputWithIcon
            icon={<UserSearch size={13} strokeWidth={1.75} color="var(--text-tertiary)" />}
            value={msisdnsInput}
            onChange={setMsisdnsInput}
            onEnter={apply}
            placeholder="50937…, 50938…"
            width={200}
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

        <Field label="Transaction types">
          <div style={{ position: 'relative', minWidth: '240px' }} ref={typeDropdownRef}>
            <button
              onClick={() => setShowTypeDropdown(!showTypeDropdown)}
              style={{
                width: '100%', height: '38px',
                padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid ' + (localSelectedTypes.length > 0 ? 'var(--text-primary)' : 'var(--border-default)'),
                background: 'var(--surface-card)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer',
                fontSize: 'var(--fs-body)', fontWeight: 500,
                color: 'var(--text-primary)',
              }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {localSelectedTypes.length === 0 ? 'All types' : `${localSelectedTypes.length} types selected`}
              </span>
              <ChevronDown size={12} strokeWidth={1.75} />
            </button>

            {showTypeDropdown && (
              <div style={{
                position: 'absolute', top: '42px', left: 0,
                background: 'var(--surface-card)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2)',
                maxHeight: '420px', overflowY: 'auto',
                zIndex: 100, minWidth: '420px',
              }}>
                <div style={{
                  padding: 'var(--space-1) var(--space-2)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 'var(--space-2)',
                }}>
                  <span style={{
                    fontSize: 'var(--fs-micro)', fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                  }}>Available flows</span>
                  <button onClick={() => setLocalSelectedTypes([])} style={{
                    background: 'none', border: 'none',
                    color: 'var(--brand)',
                    fontSize: 'var(--fs-label)', fontWeight: 500,
                    cursor: 'pointer',
                  }}>Clear all</button>
                </div>
                {(['Inbound', 'Outbound'] as TrCategory[]).map(cat => (
                  <div key={cat} style={{ marginBottom: 'var(--space-2)' }}>
                    <div style={{
                      padding: 'var(--space-1) var(--space-2)',
                      fontSize: 'var(--fs-micro)', fontWeight: 500,
                      color: cat === 'Inbound' ? 'var(--positive)' : 'var(--negative)',
                      textTransform: 'uppercase',
                      letterSpacing: 'var(--tracking-uppercase)',
                    }}>
                      {cat === 'Inbound' ? 'Inbound (received)' : 'Outbound (paid)'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
                      {TRANSACTION_TYPES.filter(t => t.category === cat).map(type => {
                        const checked = localSelectedTypes.includes(type.id)
                        return (
                          <div key={type.id} onClick={() => toggleType(type.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                              padding: 'var(--space-2)',
                              borderRadius: 'var(--radius-xs)',
                              cursor: 'pointer',
                            }}>
                            <div style={{
                              width: '14px', height: '14px',
                              borderRadius: 'var(--radius-xs)',
                              border: '1px solid ' + (checked ? 'var(--text-primary)' : 'var(--border-default)'),
                              background: checked ? 'var(--text-primary)' : 'var(--surface-card)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: 'white', flexShrink: 0,
                            }}>
                              {checked && <Check size={10} strokeWidth={3} />}
                            </div>
                            <span style={{
                              fontSize: 'var(--fs-body)', fontWeight: 500,
                              color: 'var(--text-primary)',
                            }}>{type.label}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
            disabled={!hasFilters && preset === '30' && localStatus === 'Completed'}
            style={{
              background: 'var(--surface-card)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
              height: '38px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: (!hasFilters && preset === '30' && localStatus === 'Completed') ? 'not-allowed' : 'pointer',
              opacity: (!hasFilters && preset === '30' && localStatus === 'Completed') ? 0.5 : 1,
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
            {start} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>→</span> {end}
          </span>
          {hasFilters && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '420px' }}>
              {merchantIds  && <Tag>{merchantIds.length} merchant{merchantIds.length > 1 ? 's' : ''}</Tag>}
              {msisdns      && <Tag>{msisdns.length} MSISDN{msisdns.length > 1 ? 's' : ''}</Tag>}
              {channels     && <Tag>{channels[0]}</Tag>}
              {serviceNames && <Tag>{serviceNames.length} type{serviceNames.length > 1 ? 's' : ''}</Tag>}
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
            }}>Daily merchant log</span>
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
                {fmtNum(filtered.length)} / {fmtNum(rows.length)}
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
              <div className="spinner-small" /> <span>Loading</span>
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
              placeholder="Filter tx ID, MSISDN, merchant, type, channel…"
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
            width: '100%', minWidth: '1700px',
            borderCollapse: 'collapse',
            fontSize: 'var(--fs-body)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <thead style={{ background: 'var(--surface-muted)' }}>
              <tr>
                {[
                  { label: 'Date',           align: 'left'  },
                  { label: 'Transaction ID', align: 'left'  },
                  { label: 'Type',           align: 'left'  },
                  { label: 'MSISDN',         align: 'left'  },
                  { label: 'Merchant ID',    align: 'left'  },
                  { label: 'Amount',         align: 'right' },
                  { label: 'Charge',         align: 'right' },
                  { label: 'Channel',        align: 'left'  },
                  { label: 'Status',         align: 'left'  },
                  { label: 'Reason',         align: 'left'  },
                  { label: 'Initiator',      align: 'left'  },
                  { label: 'Failure',        align: 'left'  },
                ].map(c => (
                  <th key={c.label} style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: c.align as any,
                    fontSize: 'var(--fs-micro)', fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                    borderBottom: '1px solid var(--border-default)',
                    whiteSpace: 'nowrap',
                  }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {busy && rows.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Extracting merchant records…</div>
                  <div style={{ fontSize: 'var(--fs-label)', marginTop: 'var(--space-1)' }}>UNION (credit + debit) on PROCESS_DATE.</div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
                    {rows.length === 0 ? "No record matches these criteria." : "No row matches the search."}
                  </div>
                  {rows.length === 0 && (
                    <div style={{ fontSize: 'var(--fs-label)', marginTop: 'var(--space-1)' }}>
                      Check the Merchant IDs, widen the time window, or remove type filters.
                    </div>
                  )}
                </td></tr>
              ) : filtered.map((tr: any, idx: number) => {
                const meta = TYPE_META[tr.TR_TYPE]
                const dateStr = tr.TRANSACTION_DATE
                  ? String(tr.TRANSACTION_DATE).slice(0, 10)
                  : '—'
                const isCompleted = String(tr.STATUS ?? '').toLowerCase() === 'completed'
                return (
                  <tr key={`${tr.TRANSACTIONID}-${idx}`} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      color: 'var(--text-secondary)', fontWeight: 500,
                      whiteSpace: 'nowrap',
                    }}>
                      {dateStr}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-label)',
                        color: 'var(--text-secondary)',
                      }}>{tr.TRANSACTIONID || '—'}</span>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        color: 'var(--text-primary)', fontWeight: 500,
                      }}>
                        {meta?.cat === 'Inbound' ? <ArrowDownCircle size={11} strokeWidth={1.75} color="var(--positive)" /> : meta?.cat === 'Outbound' ? <ArrowUpCircle size={11} strokeWidth={1.75} color="var(--negative)" /> : null}
                        {tr.TR_TYPE || '—'}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-body)', fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}>{tr.MSISDN || '—'}</span>
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
                      }}>{tr.MERCHANT_ID || '—'}</span>
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      textAlign: 'right',
                      color: 'var(--text-primary)', fontWeight: 600,
                    }}>
                      {fmtHTG(tr.AMOUNT)} <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-micro)', fontWeight: 500 }}>HTG</span>
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      textAlign: 'right',
                      color: 'var(--text-secondary)', fontWeight: 500,
                    }}>
                      {fmtHTG(tr.CHARGE)}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        color: 'var(--text-secondary)',
                      }}>
                        <Smartphone size={11} strokeWidth={1.75} color="var(--text-tertiary)" /> {tr.CHANNEL || '—'}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        color: isCompleted ? 'var(--positive)' : 'var(--warning)',
                      }}>
                        <CheckCircle size={11} strokeWidth={1.75} />
                        <span style={{
                          fontSize: 'var(--fs-micro)', fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: 'var(--tracking-uppercase)',
                        }}>{tr.STATUS || '—'}</span>
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-tertiary)' }}>
                      {tr.REASONTYPE || '—'}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                      {tr.INITIATOR || '—'}
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      color: tr.FAILUREREASON ? 'var(--negative)' : 'var(--text-muted)',
                    }}>
                      {tr.FAILUREREASON || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderTop: '1px solid var(--border-default)',
            background: 'var(--surface-muted)',
            fontSize: 'var(--fs-label)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <div>
              Display limited to <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(DISPLAY_LIMIT)}</strong> rows · period total: <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(summary.VOLUME)}</strong> transactions
            </div>
            <div>
              Excel export retrieves <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>all</strong> rows (up to {fmtNum(EXPORT_LIMIT)})
            </div>
          </div>
        )}
      </div>

      <ExportOverlay progress={exportProgress} />

      {/* ── EXPORT MODAL ── */}
      {showExportModal && (
        <div
          onClick={() => !isExporting && setShowExportModal(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface-card)',
              borderRadius: 'var(--radius-md)',
              width: '480px', maxWidth: '92vw',
              overflow: 'hidden',
              border: '1px solid var(--border-default)',
            }}>
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid var(--border-default)',
              background: 'var(--surface-muted)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{
                  fontSize: 'var(--fs-md)', fontWeight: 600,
                  color: 'var(--text-primary)',
                }}>Export · Merchant transactions</div>
                <div style={{
                  fontSize: 'var(--fs-micro)',
                  color: 'var(--text-tertiary)',
                  marginTop: '2px',
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                }}>Choose columns to include</div>
              </div>
              <button onClick={() => !isExporting && setShowExportModal(false)} disabled={isExporting}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  padding: 'var(--space-1)',
                  borderRadius: 'var(--radius-xs)',
                }} title="Close">
                <XCircle size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div style={{ padding: 'var(--space-4)', maxHeight: '50vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <button onClick={() => setSelectedExportCols(EXPORT_COLUMNS.map(c => c.key))} style={{
                  background: 'transparent',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  padding: '0 var(--space-3)', height: '28px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--fs-label)', fontWeight: 500,
                  cursor: 'pointer',
                }}>Select all</button>
                <button onClick={() => setSelectedExportCols([])} style={{
                  background: 'transparent',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  padding: '0 var(--space-3)', height: '28px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--fs-label)', fontWeight: 500,
                  cursor: 'pointer',
                }}>Deselect all</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
                {EXPORT_COLUMNS.map(col => {
                  const checked = selectedExportCols.includes(col.key)
                  return (
                    <label key={col.key}
                      onClick={() => toggleExportCol(col.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        padding: 'var(--space-2)',
                        borderRadius: 'var(--radius-xs)',
                        cursor: 'pointer',
                      }}>
                      <div style={{
                        width: '14px', height: '14px',
                        borderRadius: 'var(--radius-xs)',
                        border: '1px solid ' + (checked ? 'var(--text-primary)' : 'var(--border-default)'),
                        background: checked ? 'var(--text-primary)' : 'var(--surface-card)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', flexShrink: 0,
                      }}>
                        {checked && <Check size={10} strokeWidth={3} />}
                      </div>
                      <span style={{
                        fontSize: 'var(--fs-body)', fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}>
                        {col.label}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              borderTop: '1px solid var(--border-default)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'var(--surface-muted)',
            }}>
              <div style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
              }}>{selectedExportCols.length} / {EXPORT_COLUMNS.length} columns</div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button onClick={() => setShowExportModal(false)} disabled={isExporting} style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  height: '32px', padding: '0 var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 500, fontSize: 'var(--fs-body)',
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                }}>Cancel</button>
                <button onClick={runExport}
                  disabled={isExporting || selectedExportCols.length === 0}
                  style={{
                    background: (isExporting || selectedExportCols.length === 0) ? 'var(--surface-muted)' : 'var(--positive)',
                    color: (isExporting || selectedExportCols.length === 0) ? 'var(--text-muted)' : 'white',
                    border: '1px solid ' + ((isExporting || selectedExportCols.length === 0) ? 'var(--border-default)' : 'var(--positive)'),
                    height: '32px', padding: '0 var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 500, fontSize: 'var(--fs-body)',
                    cursor: (isExporting || selectedExportCols.length === 0) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  }}>
                  {isExporting ? <RefreshCw size={12} strokeWidth={1.75} className="animate-spin" /> : <Download size={12} strokeWidth={1.75} />}
                  {isExporting ? "Exporting" : "Export"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

// ── Cards & form primitives ──

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

function DateInput({ value, max, min, onChange }: { value: string, max?: string, min?: string, onChange: (v: string) => void }) {
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
      <input type="date"
        value={value} max={max} min={min}
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
