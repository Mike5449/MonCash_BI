import { useState, useEffect, useRef, useMemo } from "react"
import {
  Search, Download, ArrowUpDown, CheckCircle, Activity, Smartphone,
  ChevronDown, Check, UserSearch, XCircle,
  RefreshCw, ArrowDownCircle, ArrowUpCircle, Upload, X
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useTransactions, useTransactionsSummary, useUploadBulk } from "../hooks/useAnalytics"
import { type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const EXPORT_LIMIT = 2_000_000  // streaming XLSX côté serveur

type ExportColumn = { key: string; label: string; pick: (tr: any) => any }
const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "DATE",           label: "Date",           pick: (tr) => tr.TRANSACTION_DATE ? new Date(tr.TRANSACTION_DATE).toISOString().split('T')[0] : "" },
  { key: "TRANSACTION_ID", label: "Transaction ID", pick: (tr) => tr.TRANSACTIONID ?? "" },
  { key: "TYPE",           label: "Type",           pick: (tr) => tr.TR_TYPE ?? "" },
  { key: "MSISDN",         label: "MSISDN",         pick: (tr) => tr.MSISDN ?? "" },
  { key: "AMOUNT",         label: "Amount (HTG)",   pick: (tr) => Number(tr.AMOUNT ?? 0) },
  { key: "CHARGE",         label: "Charge (HTG)",   pick: (tr) => Number(tr.CHARGE ?? 0) },
  { key: "CHANNEL",        label: "Channel",        pick: (tr) => tr.CHANNEL ?? "" },
  { key: "STATUS",         label: "Status",         pick: (tr) => tr.STATUS ?? "" },
  { key: "REASON_TYPE",    label: "Reason Type",    pick: (tr) => tr.REASONTYPE ?? "" },
  { key: "INITIATOR",      label: "Initiator",      pick: (tr) => tr.INITIATOR ?? "" },
  { key: "FAILURE_REASON", label: "Failure Reason", pick: (tr) => tr.FAILUREREASON ?? "" },
]

type TrCategory = "Inbound" | "Outbound"
const TRANSACTION_TYPES: { id: string; label: string; category: TrCategory }[] = [
  { id: 'B2W',                     label: 'B2W (Prefunded)',         category: 'Inbound'  },
  { id: 'P2P_RECEIVE',             label: 'P2P Receive',             category: 'Inbound'  },
  { id: 'CASHIN',                  label: 'Cash In',                 category: 'Inbound'  },
  { id: 'CASHIN_OTC',              label: 'Cash In OTC',             category: 'Inbound'  },
  { id: 'IMT',                     label: 'IMT Receive',             category: 'Inbound'  },
  { id: 'PREFUNDED',               label: 'Prefunded General',       category: 'Inbound'  },
  { id: 'Payroll | disbursements', label: 'Payroll / Disbursements', category: 'Inbound'  },
  { id: 'P2P_SEND',                label: 'P2P Send',                category: 'Outbound' },
  { id: 'CASHOUT',                 label: 'Cash Out',                category: 'Outbound' },
  { id: 'DIGI_PRODUCT',            label: 'Digicel Products',        category: 'Outbound' },
  { id: 'BILLPAY',                 label: 'Bill Payment',            category: 'Outbound' },
  { id: 'TOPUP_GIFT',              label: 'Top-up Gift',             category: 'Outbound' },
  { id: 'SELF_TOPUP',              label: 'Top-up Self',             category: 'Outbound' },
  { id: 'PAY2MERC',                label: 'Merchant Payment',        category: 'Outbound' },
  { id: 'W2B',                     label: 'Wallet to Bank',          category: 'Outbound' },
]

const TYPE_META: Record<string, { cat: TrCategory }> = Object.fromEntries(
  TRANSACTION_TYPES.map(t => [t.id, { cat: t.category }])
)

const formatHTG = (v: any) => {
  const n = Number(v ?? 0)
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

const compact = (v: number) => {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B'
  if (v >= 1_000_000)     return (v / 1_000_000).toFixed(1) + 'M'
  if (v >= 1_000)         return (v / 1_000).toFixed(1) + 'K'
  return v.toFixed(0)
}

export default function Transactions() {
  const formatDate = (date: Date) => date.toISOString().split('T')[0]
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 31)

  const [localDateRange, setLocalDateRange] = useState({ start: formatDate(thirtyDaysAgo), end: formatDate(yesterday) })
  const [localPreset, setLocalPreset] = useState("30")
  const [localSelectedTypes, setLocalSelectedTypes] = useState<string[]>([])
  const [localMsisdnInput, setLocalMsisdnInput] = useState("")
  const [localSelectedChannel, setLocalSelectedChannel] = useState("")
  const [localSelectedStatuses, setLocalSelectedStatuses] = useState<string[]>(["Completed"])

  const [submittedFilters, setSubmittedFilters] = useState({
    startDate: formatDate(thirtyDaysAgo),
    endDate: formatDate(yesterday),
    types: [] as string[],
    msisdns: [] as string[],
    channels: [] as string[],
    statuses: ["Completed"] as string[],
    // True when the current search was submitted with an imported bulk MSISDN
    // list — the on-screen table is skipped in that mode (see rationale below).
    fromBulk: false,
  })

  const [showTypeDropdown, setShowTypeDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Bulk MSISDN upload (CSV/Excel)
  const [bulkMsisdns, setBulkMsisdns] = useState<string[]>([])
  const [bulkFileName, setBulkFileName] = useState<string | null>(null)
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null)
  const [uploadToast, setUploadToast] = useState<{ kind: 'success' | 'error', message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadBulk = useUploadBulk()

  useEffect(() => {
    if (localPreset !== "custom") {
      const end = new Date(); end.setDate(end.getDate() - 1)
      const start = new Date(); start.setDate(start.getDate() - (parseInt(localPreset) + 1))
      setLocalDateRange({ start: formatDate(start), end: formatDate(end) })
    }
  }, [localPreset])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowTypeDropdown(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const { data: transactions, isLoading, isFetching, refetch } = useTransactions({
    startDate: submittedFilters.startDate,
    endDate: submittedFilters.endDate,
    limit: 500,
    serviceNames: submittedFilters.types,
    msisdns: submittedFilters.msisdns,
    channels: submittedFilters.channels,
    transactionStatuses: submittedFilters.statuses,
  })

  const { data: summary, isFetching: summaryFetching } = useTransactionsSummary({
    startDate: submittedFilters.startDate,
    endDate: submittedFilters.endDate,
    serviceNames: submittedFilters.types,
    msisdns: submittedFilters.msisdns,
    channels: submittedFilters.channels,
    transactionStatuses: submittedFilters.statuses,
  })

  const [isExporting, setIsExporting] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [selectedExportCols, setSelectedExportCols] = useState<string[]>(EXPORT_COLUMNS.map(c => c.key))
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)

  const handleSubmitSearch = () => {
    // Fusionne MSISDN tapés + MSISDN du bulk file (dédoublonnés)
    const typed = localMsisdnInput.split(/[\s,;/]+/).map(m => m.trim()).filter(Boolean)
    const mList = Array.from(new Set([...typed, ...bulkMsisdns]))
    const cList = localSelectedChannel ? [localSelectedChannel] : []
    setSubmittedFilters({
      startDate: localDateRange.start,
      endDate: localDateRange.end,
      types: localSelectedTypes,
      msisdns: mList,
      channels: cList,
      statuses: localSelectedStatuses.length > 0 ? localSelectedStatuses : ["Completed"],
      fromBulk: bulkMsisdns.length > 0,
    })
  }

  const toggleStatus = (s: string) =>
    setLocalSelectedStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  const handleBulkFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingFileName(file.name)
    setUploadToast(null)
    try {
      const res = await uploadBulk.mutateAsync(file)
      const kind = res?.kind === 'shortcode' ? 'shortcode' : 'msisdn'
      if (kind === 'shortcode') {
        setUploadToast({ kind: 'error', message: "Le fichier contient des SHORTCODE — cette page filtre par MSISDN uniquement." })
        setBulkFileName(null)
        setBulkMsisdns([])
        return
      }
      const list: string[] = res?.msisdns || []
      setBulkFileName(file.name)
      setBulkMsisdns(list)
      setUploadToast({ kind: 'success', message: `✓ ${list.length.toLocaleString('en-US')} MSISDN importés depuis ${file.name}` })
      // Auto-hide toast après 5s
      setTimeout(() => setUploadToast(null), 5000)
    } catch (err: any) {
      console.error("Bulk upload failed", err)
      const apiMessage =
        typeof err === "object" && err !== null && "body" in err &&
        typeof err.body === "object" && err.body !== null && "detail" in err.body
          ? String(err.body.detail)
          : "Erreur de lecture du fichier. Assure-toi qu'il contient une colonne MSISDN."
      setUploadToast({ kind: 'error', message: apiMessage })
      setBulkFileName(null)
      setBulkMsisdns([])
    } finally {
      setUploadingFileName(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const clearBulkMsisdns = () => {
    setBulkFileName(null)
    setBulkMsisdns([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const toggleType = (id: string) =>
    setLocalSelectedTypes(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])

  const kpis = useMemo(() => ({
    totalCount:     Number(summary?.TOTAL_COUNT     ?? 0),
    distinctMsisdn: Number(summary?.DISTINCT_MSISDN ?? 0),
    totalValue:     Number(summary?.TOTAL_VOLUME    ?? 0),
    totalCharge:    Number(summary?.TOTAL_CHARGE    ?? 0),
  }), [summary])

  const toggleExportCol = (key: string) =>
    setSelectedExportCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const runExport = async () => {
    if (isExporting || selectedExportCols.length === 0) return
    setIsExporting(true)
    setShowExportModal(false)
    try {
      const idsTag = submittedFilters.msisdns.length > 0
        ? `_${submittedFilters.msisdns.slice(0, 3).join("-")}${submittedFilters.msisdns.length > 3 ? "+" : ""}`
        : ""
      const { OpenAPI } = await import("../api/core/OpenAPI")
      const qs = new URLSearchParams()
      if (submittedFilters.startDate) qs.set('start_date', submittedFilters.startDate)
      if (submittedFilters.endDate)   qs.set('end_date',   submittedFilters.endDate)
      qs.set('limit', String(EXPORT_LIMIT))
      qs.set('columns', selectedExportCols.join(','))
      submittedFilters.types?.forEach(t => qs.append('service_names', t))
      submittedFilters.msisdns?.forEach(m => qs.append('msisdns', m))
      submittedFilters.channels?.forEach(c => qs.append('channels', c))
      submittedFilters.statuses?.forEach(s => qs.append('transaction_statuses', s))

      setExportProgress({ bytesReceived: 0, totalBytes: 0, phase: 'Génération du fichier côté serveur…' })
      const res = await fetch(`${OpenAPI.BASE}/customers/transactions/export.xlsx?${qs.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const total = Number(res.headers.get('Content-Length') || 0)
      setExportProgress({ bytesReceived: 0, totalBytes: total, phase: 'Téléchargement du fichier…' })
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
      a.download = `Daily_Transactions_${submittedFilters.startDate}_to_${submittedFilters.endDate}${idsTag}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(dl)
    } catch (e) {
      console.error("Export failed", e)
      alert("L'export a échoué — voir la console.")
    } finally {
      setIsExporting(false)
      setExportProgress(null)
    }
  }

  const canExport = !isLoading && !isExporting && (kpis.totalCount > 0 || (transactions?.length ?? 0) > 0)
  const busy = isLoading || isFetching

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
            Customer · Daily transactions
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Daily Customer Transactions
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            Period: {submittedFilters.startDate} → {submittedFilters.endDate}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={() => refetch()}
            disabled={busy}
            title="Refresh"
            style={{
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              height: '34px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: busy ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              opacity: busy ? 0.5 : 1,
            }}
          >
            <RefreshCw size={13} strokeWidth={1.75} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            disabled={!canExport}
            title={isExporting ? "Preparing file…" : "Export all transactions for the period"}
            style={{
              background: canExport ? 'var(--positive)' : 'var(--surface-muted)',
              color: canExport ? 'white' : 'var(--text-muted)',
              border: '1px solid ' + (canExport ? 'var(--positive)' : 'var(--border-default)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: canExport ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}
          >
            {isExporting ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <Download size={13} strokeWidth={1.75} />}
            {isExporting ? "Exporting" : "Export Excel"}
          </button>
        </div>
      </div>

      {/* ── KPI STRIP ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 'var(--space-3)',
      }}>
        <Kpi label="Subscribers"  value={summaryFetching ? '—' : kpis.distinctMsisdn.toLocaleString()} accent="var(--data-subs)"    sub="distinct MSISDN" />
        <Kpi label="Transactions" value={summaryFetching ? '—' : kpis.totalCount.toLocaleString()}     accent="var(--data-volume)"  sub="across the period" />
        <Kpi label="Value"        value={summaryFetching ? '—' : compact(kpis.totalValue)  + ' HTG'}   accent="var(--data-value)"   sub="sum of amounts" />
        <Kpi label="Revenue"      value={summaryFetching ? '—' : compact(kpis.totalCharge) + ' HTG'}   accent="var(--data-revenue)" sub="MFS charges" />
      </div>

      {/* ── FILTER BAR ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        marginTop: 'var(--space-4)',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        gap: 'var(--space-3)',
        position: 'relative', zIndex: 10,
      }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <select
            value={localPreset} onChange={(e) => setLocalPreset(e.target.value)}
            style={{
              height: '32px', padding: '0 var(--space-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              color: 'var(--text-primary)',
            }}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom</option>
          </select>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>From</span>
          <input type="date"
            value={localDateRange.start} onChange={(e) => { setLocalDateRange({ ...localDateRange, start: e.target.value }); setLocalPreset("custom") }}
            style={{
              height: '32px', padding: '0 var(--space-2)',
              width: '140px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
            }} />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>To</span>
          <input type="date"
            max={formatDate(yesterday)} value={localDateRange.end}
            onChange={(e) => { setLocalDateRange({ ...localDateRange, end: e.target.value }); setLocalPreset("custom") }}
            style={{
              height: '32px', padding: '0 var(--space-2)',
              width: '140px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
            }} />
        </div>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)' }} />

        {/* msisdn input + bulk upload */}
        <div style={{ position: 'relative', minWidth: '230px', flex: '1 1 230px', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <UserSearch size={13} strokeWidth={1.75} style={{ position: 'absolute', left: 'var(--space-3)', top: '9px', color: 'var(--text-tertiary)' }} />
            <input type="text"
              placeholder="MSISDN(s) — separated by , ; / or space"
              value={localMsisdnInput} onChange={(e) => setLocalMsisdnInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitSearch() }}
              style={{
                width: '100%', height: '32px',
                paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                fontSize: 'var(--fs-body)', fontWeight: 500,
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <input type="file" ref={fileInputRef} onChange={handleBulkFileUpload}
                 accept=".xlsx,.xlsm,.csv" style={{ display: 'none' }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadBulk.isPending}
            title="Upload CSV/Excel with MSISDN column"
            style={{
              background: bulkFileName ? 'var(--text-primary)' : 'var(--surface-card)',
              color: bulkFileName ? 'white' : 'var(--text-secondary)',
              border: '1px solid ' + (bulkFileName ? 'var(--text-primary)' : 'var(--border-default)'),
              height: '32px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-label)',
              cursor: uploadBulk.isPending ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              whiteSpace: 'nowrap',
            }}
          >
            {uploadBulk.isPending
              ? <RefreshCw size={12} strokeWidth={1.75} className="animate-spin" />
              : <Upload size={12} strokeWidth={1.75} />}
            {bulkFileName ? `Bulk · ${bulkMsisdns.length}` : 'Bulk'}
            {bulkFileName && (
              <X size={12} strokeWidth={1.75} style={{ marginLeft: '2px' }}
                 onClick={(e) => { e.stopPropagation(); clearBulkMsisdns() }} />
            )}
          </button>
        </div>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)' }} />

        <div style={{ position: 'relative', minWidth: '180px' }}>
          <Smartphone size={13} strokeWidth={1.75} style={{
            position: 'absolute', left: 'var(--space-3)', top: '9px',
            color: 'var(--text-tertiary)',
            pointerEvents: 'none', zIndex: 1,
          }} />
          <select
            value={localSelectedChannel}
            onChange={(e) => setLocalSelectedChannel(e.target.value)}
            style={{
              width: '100%', height: '32px',
              paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid ' + (localSelectedChannel ? 'var(--text-primary)' : 'var(--border-default)'),
              background: 'var(--surface-card)',
              fontSize: 'var(--fs-body)', fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            <option value="">All channels</option>
            <option value="API">API</option>
            <option value="Web">Web</option>
            <option value="QR">QR</option>
            <option value="USSD_Digicel">USSD_Digicel</option>
          </select>
        </div>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)' }} />

        {/* ── TRANSACTIONSTATUS multi-select — default Completed ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
            marginRight: '2px',
          }}>Status</span>
          {(['Completed', 'Cancelled', 'Declined', 'Expired'] as const).map(s => {
            const active = localSelectedStatuses.includes(s)
            return (
              <button key={s}
                onClick={() => toggleStatus(s)}
                title={`Toggle ${s}`}
                style={{
                  height: '28px', minWidth: '58px',
                  padding: '0 var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid ' + (active ? 'var(--text-primary)' : 'var(--border-default)'),
                  background: active ? 'var(--surface-muted)' : 'var(--surface-card)',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  fontSize: 'var(--fs-micro)', fontWeight: active ? 700 : 500,
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                  cursor: 'pointer',
                }}>
                {s}
              </button>
            )
          })}
        </div>

        <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)' }} />

        <div style={{ position: 'relative', minWidth: '220px', flex: '1 1 220px' }} ref={dropdownRef}>
          <button
            onClick={() => setShowTypeDropdown(!showTypeDropdown)}
            style={{
              width: '100%', height: '32px',
              padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid ' + (localSelectedTypes.length > 0 ? 'var(--text-primary)' : 'var(--border-default)'),
              background: 'var(--surface-card)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer',
              fontSize: 'var(--fs-body)', fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {localSelectedTypes.length === 0 ? 'All transaction types' : `${localSelectedTypes.length} types selected`}
            </span>
            <ChevronDown size={12} strokeWidth={1.75} />
          </button>

          {showTypeDropdown && (
            <div style={{
              position: 'absolute', top: '38px', left: 0, right: 0,
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2)',
              maxHeight: '420px', overflowY: 'auto', zIndex: 100, minWidth: '360px',
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
                    {cat}
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

        <button onClick={handleSubmitSearch} disabled={busy}
          style={{
            background: 'var(--brand)', color: 'white',
            border: '1px solid var(--brand)',
            height: '32px', padding: '0 var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontWeight: 500, fontSize: 'var(--fs-body)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            opacity: busy ? 0.5 : 1,
          }}>
          {busy ? <div className="spinner-small" /> : <Search size={13} strokeWidth={1.75} />} Run audit
        </button>
      </div>

      {/* ── ACTIVE CRITERIA ── */}
      {(submittedFilters.msisdns.length > 0 || submittedFilters.types.length > 0 || submittedFilters.channels.length > 0) && (
        <div style={{
          marginTop: 'var(--space-3)',
          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          gap: 'var(--space-2)',
          background: 'var(--surface-muted)',
          padding: 'var(--space-2) var(--space-3)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-faint)',
        }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
          }}>Active criteria</span>
          {submittedFilters.fromBulk ? (
            submittedFilters.msisdns.length > 0 && (
              <span style={{
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                fontSize: 'var(--fs-label)', fontWeight: 500,
                color: 'var(--text-primary)',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                <Upload size={10} strokeWidth={1.75} />
                {submittedFilters.msisdns.length.toLocaleString('en-US')} MSISDN (bulk)
              </span>
            )
          ) : (
            submittedFilters.msisdns.map(m => (
              <span key={`msisdn-${m}`} style={{
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                fontSize: 'var(--fs-label)', fontWeight: 500,
                color: 'var(--text-primary)',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                <UserSearch size={10} strokeWidth={1.75} /> {m}
              </span>
            ))
          )}
          {submittedFilters.channels.map(c => (
            <span key={`channel-${c}`} style={{
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              fontSize: 'var(--fs-label)', fontWeight: 500,
              color: 'var(--text-primary)',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <Smartphone size={10} strokeWidth={1.75} /> {c.toUpperCase()}
            </span>
          ))}
          {submittedFilters.types.map(t => {
            const meta = TYPE_META[t]
            return (
              <span key={`type-${t}`} style={{
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                fontSize: 'var(--fs-label)', fontWeight: 500,
                color: 'var(--text-primary)',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                {meta?.cat === 'Inbound' ? <ArrowDownCircle size={10} strokeWidth={1.75} color="var(--positive)" /> : <ArrowUpCircle size={10} strokeWidth={1.75} color="var(--negative)" />}
                {t}
              </span>
            )
          })}
          {submittedFilters.statuses.map(s => (
            <span key={`status-${s}`} style={{
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              fontSize: 'var(--fs-label)', fontWeight: 500,
              color: 'var(--text-primary)',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <Activity size={10} strokeWidth={1.75} /> {s}
            </span>
          ))}
          <button onClick={() => {
              setLocalMsisdnInput(""); setLocalSelectedTypes([]); setLocalSelectedChannel("")
              setLocalSelectedStatuses(["Completed"])
              setSubmittedFilters({ ...submittedFilters, msisdns: [], types: [], channels: [], statuses: ["Completed"] })
            }}
            style={{
              marginLeft: 'auto',
              background: 'none', border: 'none',
              color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: '4px',
              cursor: 'pointer',
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>
            <XCircle size={11} strokeWidth={1.75} /> Clear
          </button>
        </div>
      )}

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
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <h3 style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500, margin: 0,
              textTransform: 'uppercase',
              color: 'var(--text-tertiary)',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>Daily audit log</h3>
            {!busy && transactions && transactions.length > 0 && (
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                padding: '1px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {transactions.length.toLocaleString('en-US')} rows
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
        </div>

        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{
            width: '100%', minWidth: '1600px',
            borderCollapse: 'collapse',
            fontSize: 'var(--fs-body)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <thead style={{ background: 'var(--surface-muted)' }}>
              <tr>
                {['Date','Transaction ID','Type','MSISDN','Amount','Charge','Channel','Status','Reason','Initiator','Failure'].map((h, i) => (
                  <th key={h} style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: (i === 4 || i === 5) ? 'right' : 'left',
                    fontSize: 'var(--fs-micro)', fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                    borderBottom: '1px solid var(--border-default)',
                    whiteSpace: 'nowrap',
                  }}>
                    {i === 0 ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>{h} <ArrowUpDown size={10} strokeWidth={1.75} style={{ opacity: 0.5 }} /></span> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {busy ? (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 'var(--space-16) 0', color: 'var(--text-tertiary)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div className="spinner" />
                    <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Extracting daily records…</div>
                    <div style={{ fontSize: 'var(--fs-label)' }}>UNION (credit + debit) on PROCESS_DATE — a few seconds depending on volume.</div>
                  </div>
                </td></tr>
              ) : !transactions || transactions.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 'var(--space-16) 0', color: 'var(--text-tertiary)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
                    <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>No record matches these criteria.</div>
                    <div style={{ fontSize: 'var(--fs-label)' }}>Check the MSISDNs, widen the time window, or remove type filters.</div>
                  </div>
                </td></tr>
              ) : transactions.map((tr: any, idx: number) => {
                const meta = TYPE_META[tr.TR_TYPE]
                return (
                  <tr key={`${tr.TRANSACTIONID}-${idx}`} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      {tr.TRANSACTION_DATE ? new Date(tr.TRANSACTION_DATE).toISOString().split('T')[0] : '—'}
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 'var(--fs-label)',
                      color: 'var(--text-secondary)',
                    }}>
                      {tr.TRANSACTIONID}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        color: 'var(--text-primary)',
                        fontWeight: 500,
                      }}>
                        {meta?.cat === 'Inbound' ? <ArrowDownCircle size={12} strokeWidth={1.75} color="var(--positive)" /> : meta?.cat === 'Outbound' ? <ArrowUpCircle size={12} strokeWidth={1.75} color="var(--negative)" /> : null}
                        {tr.TR_TYPE || '—'}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-body)',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}>{tr.MSISDN}</span>
                    </td>
                    <td style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-4)', color: 'var(--text-primary)', fontWeight: 500 }}>
                      {formatHTG(tr.AMOUNT)} <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-micro)' }}>HTG</span>
                    </td>
                    <td style={{ textAlign: 'right', padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                      {formatHTG(tr.CHARGE)}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        color: 'var(--text-secondary)',
                      }}>
                        <Smartphone size={11} strokeWidth={1.75} /> {tr.CHANNEL || '—'}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        color: tr.STATUS === 'Completed' ? 'var(--positive)' : 'var(--warning)',
                      }}>
                        <CheckCircle size={11} strokeWidth={1.75} />
                        <span style={{
                          fontSize: 'var(--fs-micro)', fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: 'var(--tracking-uppercase)',
                        }}>{tr.STATUS || '—'}</span>
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-tertiary)' }}>{tr.REASONTYPE || '—'}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{tr.INITIATOR || '—'}</td>
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
      </div>

      {/* EXPORT PROGRESS OVERLAY */}
      <ExportOverlay progress={exportProgress} />

      {/* ── BULK UPLOAD OVERLAY ── */}
      {uploadingFileName && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000,
        }}>
          <div style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-6) var(--space-8)',
            width: '420px', maxWidth: '92vw',
            textAlign: 'center',
          }}>
            <Upload size={28} strokeWidth={1.5} style={{ color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }} />
            <h3 style={{
              margin: 0,
              fontSize: 'var(--fs-md)', fontWeight: 600,
              color: 'var(--text-primary)',
            }}>
              Importing file
            </h3>
            <p style={{
              margin: 'var(--space-2) 0 var(--space-4)',
              fontSize: 'var(--fs-body)', fontWeight: 500,
              color: 'var(--text-secondary)',
              fontFamily: 'ui-monospace, monospace',
            }}>
              {uploadingFileName}
            </p>
            <div style={{
              width: '100%', height: '4px',
              background: 'var(--surface-muted)',
              borderRadius: 'var(--radius-pill)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: '40%', height: '100%',
                background: 'var(--brand)',
                borderRadius: 'var(--radius-pill)',
                animation: 'bulk-pulse 1.4s ease-in-out infinite',
              }} />
            </div>
            <p style={{
              margin: 'var(--space-3) 0 0',
              fontSize: 'var(--fs-label)',
              color: 'var(--text-tertiary)',
            }}>
              Reading MSISDNs from file…
            </p>
          </div>
          <style>{`
            @keyframes bulk-pulse {
              0%, 100% { transform: translateX(-100%); }
              50%      { transform: translateX(250%); }
            }
          `}</style>
        </div>
      )}

      {/* ── BULK UPLOAD TOAST ── */}
      {uploadToast && (
        <div style={{
          position: 'fixed', top: 'var(--space-6)', right: 'var(--space-6)',
          zIndex: 2100,
          background: 'var(--surface-card)',
          border: '1px solid ' + (uploadToast.kind === 'success' ? 'var(--positive)' : 'var(--negative)'),
          borderLeft: '3px solid ' + (uploadToast.kind === 'success' ? 'var(--positive)' : 'var(--negative)'),
          color: 'var(--text-primary)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          maxWidth: '420px',
          display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
          fontSize: 'var(--fs-body)', fontWeight: 500,
          animation: 'slide-in 0.25s ease-out',
        }}>
          <div style={{ flex: 1 }}>{uploadToast.message}</div>
          <button
            onClick={() => setUploadToast(null)}
            style={{
              background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-tertiary)',
              padding: 0, lineHeight: 1,
            }}
          >
            <X size={13} strokeWidth={1.75} />
          </button>
          <style>{`
            @keyframes slide-in {
              from { opacity: 0; transform: translateX(20px); }
              to   { opacity: 1; transform: translateX(0); }
            }
          `}</style>
        </div>
      )}

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
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface-card)',
              borderRadius: 'var(--radius-md)',
              width: '480px', maxWidth: '92vw',
              overflow: 'hidden',
              border: '1px solid var(--border-default)',
            }}
          >
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
                }}>Export · Daily transactions</div>
                <div style={{
                  fontSize: 'var(--fs-micro)',
                  color: 'var(--text-tertiary)',
                  marginTop: '2px',
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                }}>Choose columns to include</div>
              </div>
              <button
                onClick={() => !isExporting && setShowExportModal(false)}
                disabled={isExporting}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  padding: 'var(--space-1)',
                  borderRadius: 'var(--radius-xs)',
                }}
                title="Close"
              >
                <XCircle size={16} strokeWidth={1.75} />
              </button>
            </div>

            <div style={{ padding: 'var(--space-4)', maxHeight: '50vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <button
                  onClick={() => setSelectedExportCols(EXPORT_COLUMNS.map(c => c.key))}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    padding: '0 var(--space-3)', height: '28px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--fs-label)', fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >Select all</button>
                <button
                  onClick={() => setSelectedExportCols([])}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    padding: '0 var(--space-3)', height: '28px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--fs-label)', fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >Deselect all</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
                {EXPORT_COLUMNS.map(col => {
                  const checked = selectedExportCols.includes(col.key)
                  return (
                    <label
                      key={col.key}
                      onClick={() => toggleExportCol(col.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        padding: 'var(--space-2)',
                        borderRadius: 'var(--radius-xs)',
                        cursor: 'pointer',
                      }}
                    >
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
              }}>
                {selectedExportCols.length} / {EXPORT_COLUMNS.length} columns
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  onClick={() => setShowExportModal(false)}
                  disabled={isExporting}
                  style={{
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    height: '32px', padding: '0 var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 500, fontSize: 'var(--fs-body)',
                    cursor: isExporting ? 'not-allowed' : 'pointer',
                  }}
                >Cancel</button>
                <button
                  onClick={runExport}
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
                  }}
                >
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

function Kpi({ label, value, sub, accent }: { label: string, value: string, sub?: string, accent: string }) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <div style={{ height: '3px', background: accent }} />
      <div style={{ padding: 'var(--space-6) var(--space-8) var(--space-8)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginBottom: 'var(--space-6)',
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
          fontSize: '32px', fontWeight: 600,
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
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--border-faint)',
          }}>{sub}</div>
        )}
      </div>
    </div>
  )
}
