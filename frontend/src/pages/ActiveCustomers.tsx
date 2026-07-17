import { useState, useMemo, useRef } from "react"
import {
  RefreshCw, Download, Search, Activity, MapPin,
  XCircle, Check, X, Calendar, Upload
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useActiveCustomers, useUploadBulk } from "../hooks/useAnalytics"
import { downloadXlsxStream, triggerNativeDownload, type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const DISPLAY_LIMIT = 500
const EXPORT_LIMIT = 2_000_000  // jusqu'à 2M lignes via streaming XLSX côté serveur

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
const formatDisplayDate = (s?: string) => {
  if (!s) return 'N/A'
  const parts = s.split('-')
  if (parts.length !== 3) return s
  return `${parts[1]}/${parts[2].slice(0, 2)}/${parts[0]}`
}

const STATUS_COLORS: Record<string, string> = {
  Active: 'var(--positive)', 'Pending Active': 'var(--data-subs)', Suspended: 'var(--negative)',
  Dormant: 'var(--text-tertiary)', Frozen: 'var(--data-value)', Closed: 'var(--text-secondary)',
}

type ExportColumn = { key: string; label: string; pick: (r: any) => any }
const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "MSISDN",       label: "MSISDN",         pick: (r) => r.MSISDN ?? "" },
  { key: "NAME",         label: "Full Name",      pick: (r) => r.IDENTITYNAME ?? "" },
  { key: "STATUS",       label: "Account Status", pick: (r) => r.STATUS ?? "" },
  { key: "WALLET",       label: "Wallet Type",    pick: (r) => r.KYC ?? "" },
  { key: "BALANCE",      label: "Balance (HTG)",  pick: (r) => Number(r.BALANCE ?? 0) },
  { key: "TX_COUNT",     label: "TX Count",       pick: (r) => Number(r.TX_COUNT ?? 0) },
  { key: "TOTAL_VALUE",  label: "Total Value",    pick: (r) => Number(r.TOTAL_VALUE ?? 0) },
  { key: "TOTAL_CHARGE", label: "Total Charge",   pick: (r) => Number(r.TOTAL_CHARGE ?? 0) },
  { key: "FIRST_TX",     label: "First TX",       pick: (r) => formatDisplayDate(r.FIRST_TX) },
  { key: "LAST_TX",      label: "Last TX",        pick: (r) => formatDisplayDate(r.LAST_TX) },
  { key: "ADDRESS",      label: "Address",        pick: (r) => r.ADDRESS || "N/A" },
  { key: "IMT_OPT_IN",   label: "IMT Opt-in",     pick: (r) => r.IMTOPTIN ?? "" },
  { key: "ID_TYPE",      label: "ID Type",        pick: (r) => r.ID_TYPE ?? "" },
  { key: "ID_STATUS",    label: "ID Status",      pick: (r) => r.ID_STATUS ?? "" },
  { key: "ID_EXPIRY",    label: "ID Expiry",      pick: (r) => formatDisplayDate(r.ID_EXPIRY_DATE) },
  { key: "CREATED",      label: "Created Date",   pick: (r) => formatDisplayDate(r.CREATED_DATE) },
  { key: "SECTOR",       label: "Sector",         pick: (r) => r.SECTOR ?? "" },
  { key: "CITY",         label: "City",           pick: (r) => r.CITY ?? "" },
  { key: "DEPARTMENT",   label: "Department",     pick: (r) => r.DEPARTMENT ?? "" },
  { key: "ZONE",         label: "Zone (Cluster)", pick: (r) => r.ZONE ?? "" },
]

type WalletFilter = '' | 'FULL' | 'MINI'

export default function ActiveCustomers() {
  const [localStart, setLocalStart] = useState<string>(minusDays(30))
  const [localEnd,   setLocalEnd]   = useState<string>(todayMinus1())
  const [start,      setStart]      = useState<string>(minusDays(30))
  const [end,        setEnd]        = useState<string>(todayMinus1())
  const [walletFilter, setWalletFilter] = useState<WalletFilter>('')
  const [search, setSearch] = useState("")
  const [isExporting, setIsExporting] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [selectedExportCols, setSelectedExportCols] = useState<string[]>(EXPORT_COLUMNS.map(c => c.key))
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv')

  // ── Bulk MSISDN upload (CSV/Excel) ──
  const [bulkMsisdns, setBulkMsisdns] = useState<string[]>([])
  const [bulkFileName, setBulkFileName] = useState<string | null>(null)
  const [uploadToast, setUploadToast] = useState<{ kind: 'success' | 'error', message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadBulk = useUploadBulk()

  // ── TRANSACTIONSTATUS filter (default Completed) ──
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["Completed"])
  const toggleStatus = (s: string) =>
    setSelectedStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  const { data, isLoading, isFetching, refetch } = useActiveCustomers({
    startDate: start, endDate: end, limit: DISPLAY_LIMIT,
    walletType: walletFilter || null,
    msisdns: bulkMsisdns,
    transactionStatuses: selectedStatuses.length > 0 ? selectedStatuses : ["Completed"],
  })

  const handleBulkFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
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
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const clearBulkMsisdns = () => {
    setBulkFileName(null)
    setBulkMsisdns([])
    setUploadToast(null)
  }

  const busy = isLoading || isFetching

  const rows: any[] = data?.rows ?? []
  const totalActive = data?.total_active ?? 0
  const totalTx     = data?.total_tx     ?? 0
  const totalValue  = data?.total_value  ?? 0
  const totalCharge = data?.total_charge ?? 0

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r: any) =>
      String(r.MSISDN ?? '').toLowerCase().includes(s) ||
      String(r.IDENTITYNAME ?? '').toLowerCase().includes(s) ||
      String(r.DEPARTMENT ?? '').toLowerCase().includes(s) ||
      String(r.CITY ?? '').toLowerCase().includes(s)
    )
  }, [rows, search])

  const apply = () => { setStart(localStart); setEnd(localEnd) }

  const toggleExportCol = (key: string) =>
    setSelectedExportCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const runExport = async () => {
    if (selectedExportCols.length === 0) return
    setShowExportModal(false)
    const wSuffix = walletFilter ? `_${walletFilter}` : ''

    const msisdnsParam = bulkMsisdns.length > 0 ? bulkMsisdns : undefined
    const statusesParam = selectedStatuses.length > 0 ? selectedStatuses : ["Completed"]

    if (exportFormat === 'csv') {
      // CSV : download natif du navigateur → démarre immédiatement, progression
      // visible dans le download bar du browser, pas de JS qui lit la response.
      triggerNativeDownload(
        '/customers/active-customers/export.csv',
        {
          start_date:           start,
          end_date:             end,
          wallet_type:          walletFilter || undefined,
          limit:                EXPORT_LIMIT,
          columns:              selectedExportCols.join(','),
          msisdns:              msisdnsParam,
          transaction_statuses: statusesParam,
        },
        `Active_Customers_${start}_to_${end}${wSuffix}.csv`,
      )
      return
    }

    // XLSX : fetch + blob + overlay (le fichier doit être complet avant download)
    setIsExporting(true)
    try {
      await downloadXlsxStream(
        '/customers/active-customers/export.xlsx',
        {
          start_date:           start,
          end_date:             end,
          wallet_type:          walletFilter || undefined,
          limit:                EXPORT_LIMIT,
          columns:              selectedExportCols.join(','),
          msisdns:              msisdnsParam,
          transaction_statuses: statusesParam,
        },
        `Active_Customers_${start}_to_${end}${wSuffix}.xlsx`,
        (p) => setExportProgress(p),
      )
    } catch (e) {
      console.error("Export failed", e)
      alert("L'export a échoué — voir la console.")
    } finally {
      setIsExporting(false)
      setExportProgress(null)
    }
  }

  const Dash = () => <span style={{ color: 'var(--text-muted)' }}>—</span>

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
            Customer · Active customers · ≥1 transaction
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Active Customers
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
          }}>
            Customers who completed <strong style={{ fontWeight: 600 }}>at least one transaction</strong> in the selected period, with profile and summary info.
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
          <button onClick={() => setShowExportModal(true)} disabled={busy || isExporting || totalActive === 0}
            title="Choose columns to export"
            style={{
              background: (busy || isExporting || totalActive === 0) ? 'var(--surface-muted)' : 'var(--positive)',
              color: (busy || isExporting || totalActive === 0) ? 'var(--text-muted)' : 'white',
              border: '1px solid ' + ((busy || isExporting || totalActive === 0) ? 'var(--border-default)' : 'var(--positive)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: (busy || isExporting || totalActive === 0) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
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
        <KpiCard label="Active customers"   value={fmtNum(totalActive)}    accent="var(--data-subs)"    sub={`${fmtNum(rows.length)} loaded · ${fmtNum(filtered.length)} after filter`} />
        <KpiCard label="Total transactions" value={fmtNum(totalTx)}        accent="var(--data-volume)"  sub="across all customers" />
        <KpiCard label="Total value (HTG)"  value={fmtMoney(totalValue)}   accent="var(--data-value)"   sub="sum of amounts" />
        <KpiCard label="Total charges (HTG)" value={fmtMoney(totalCharge)} accent="var(--data-revenue)" sub="MFS revenue" />
      </div>

      {/* ── FILTER PANEL ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-6) var(--space-6)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        marginTop: 'var(--space-4)',
        display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap',
        gap: 'var(--space-5)',
      }}>
        {/* Date field group */}
        <Field label="From">
          <DateInput value={localStart} max={todayMinus1()} onChange={setLocalStart} />
        </Field>
        <div style={{
          fontSize: 'var(--fs-md)', color: 'var(--text-tertiary)',
          paddingBottom: '10px', fontWeight: 400,
        }}>→</div>
        <Field label="To">
          <DateInput value={localEnd} max={todayMinus1()} onChange={setLocalEnd} />
        </Field>

        <div style={{ paddingBottom: '0' }}>
          <button onClick={apply} disabled={busy || (localStart === start && localEnd === end)}
            style={{
              background: 'var(--brand)', color: 'white',
              border: '1px solid var(--brand)',
              height: '38px', padding: '0 var(--space-5)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 600, fontSize: 'var(--fs-body)',
              letterSpacing: '0.01em',
              cursor: 'pointer',
              opacity: (busy || (localStart === start && localEnd === end)) ? 0.4 : 1,
            }}>
            Apply
          </button>
        </div>

        {/* Quick range · segmented control */}
        <Field label="Quick range">
          <Segmented
            disabled={busy}
            options={([30, 60, 90] as const).map(n => {
              const qStart = minusDays(n)
              const qEnd = todayMinus1()
              return {
                value: String(n),
                label: `${n}d`,
                active: start === qStart && end === qEnd,
                title: `${qStart} → ${qEnd}`,
                onClick: () => {
                  setLocalStart(qStart); setLocalEnd(qEnd)
                  setStart(qStart); setEnd(qEnd)
                },
              }
            })}
          />
        </Field>

        {/* Wallet filter · segmented control */}
        <Field label="Wallet tier">
          <Segmented
            disabled={busy}
            options={[
              { val: '' as WalletFilter, label: 'All'  },
              { val: 'FULL' as WalletFilter, label: 'Full' },
              { val: 'MINI' as WalletFilter, label: 'Mini' },
            ].map(opt => ({
              value: opt.val,
              label: opt.label,
              active: walletFilter === opt.val,
              onClick: () => setWalletFilter(opt.val),
            }))}
          />
        </Field>

        {/* TRANSACTIONSTATUS multi-select — default Completed */}
        <Field label="Tx status">
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {(['Completed', 'Cancelled', 'Declined', 'Expired'] as const).map(s => {
              const active = selectedStatuses.includes(s)
              return (
                <button key={s} onClick={() => toggleStatus(s)}
                  title={`Toggle ${s}`}
                  style={{
                    height: '38px', minWidth: '68px',
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
        </Field>

        {/* Bulk MSISDN upload · CSV / XLSX with a MSISDN column */}
        <Field label="Bulk MSISDN">
          <input type="file" ref={fileInputRef} onChange={handleBulkFileUpload}
                 accept=".xlsx,.xlsm,.csv" style={{ display: 'none' }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadBulk.isPending || busy}
            title="Import a CSV/Excel file with a MSISDN column to filter this list"
            style={{
              background: bulkFileName ? 'var(--text-primary)' : 'var(--surface-card)',
              color: bulkFileName ? 'white' : 'var(--text-secondary)',
              border: '1px solid ' + (bulkFileName ? 'var(--text-primary)' : 'var(--border-default)'),
              height: '38px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: (uploadBulk.isPending || busy) ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              whiteSpace: 'nowrap',
            }}
          >
            {uploadBulk.isPending
              ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
              : <Upload size={13} strokeWidth={1.75} />}
            {bulkFileName ? `Bulk · ${bulkMsisdns.length.toLocaleString('en-US')}` : 'Import'}
            {bulkFileName && (
              <X size={12} strokeWidth={1.75} style={{ marginLeft: '2px' }}
                 onClick={(e) => { e.stopPropagation(); clearBulkMsisdns() }} />
            )}
          </button>
        </Field>

        {/* Active range summary */}
        <div style={{
          marginLeft: 'auto',
          paddingBottom: '10px',
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
          gap: 'var(--space-1)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Applied window</span>
          <span style={{
            fontSize: 'var(--fs-body)', fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            {start} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>→</span> {end}
          </span>
          {walletFilter && (
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
            }}>{walletFilter} wallets only</span>
          )}
          {bulkFileName && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-muted)',
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              fontWeight: 500,
              fontSize: 'var(--fs-micro)',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>
              <Upload size={10} strokeWidth={1.75} />
              {bulkMsisdns.length.toLocaleString('en-US')} MSISDN (bulk)
            </span>
          )}
          {selectedStatuses.length > 0 && !(selectedStatuses.length === 1 && selectedStatuses[0] === 'Completed') && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-muted)',
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              fontWeight: 500,
              fontSize: 'var(--fs-micro)',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>
              <Activity size={10} strokeWidth={1.75} />
              Status: {selectedStatuses.join(' + ')}
            </span>
          )}
        </div>
      </div>

      {/* ── Upload toast ── */}
      {uploadToast && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid ' + (uploadToast.kind === 'success' ? 'var(--positive)' : 'var(--negative)'),
          background: uploadToast.kind === 'success'
            ? 'rgba(22, 163, 74, 0.08)'
            : 'rgba(227, 27, 35, 0.08)',
          color: uploadToast.kind === 'success' ? 'var(--positive)' : 'var(--negative)',
          fontSize: 'var(--fs-body)', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        }}>
          {uploadToast.kind === 'success'
            ? <Check size={14} strokeWidth={2} />
            : <XCircle size={14} strokeWidth={2} />}
          <span style={{ flex: 1 }}>{uploadToast.message}</span>
          <button onClick={() => setUploadToast(null)} style={{
            background: 'transparent', border: 'none',
            color: 'inherit', cursor: 'pointer', display: 'flex',
          }}><X size={14} strokeWidth={1.75} /></button>
        </div>
      )}

      {/* ── TABLE ── */}
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
            <Activity size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>Active customers</span>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              padding: '1px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtNum(filtered.length)} / {fmtNum(totalActive)}
            </span>
          </div>
          <div style={{
            marginLeft: 'auto',
            position: 'relative',
            display: 'flex', alignItems: 'center',
            background: 'var(--surface-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
            transition: 'border-color 0.12s',
          }}>
            <Search size={13} strokeWidth={1.75} color="var(--text-tertiary)"
              style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Filter MSISDN, name, city, department…"
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
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute', right: 'var(--space-2)',
                  background: 'transparent', border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 'var(--radius-xs)',
                }}
                title="Clear search"
              >
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{
            width: '100%', minWidth: '2400px',
            borderCollapse: 'collapse',
            fontSize: 'var(--fs-body)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <thead style={{ background: 'var(--surface-muted)' }}>
              <tr>
                {['MSISDN','Name','Status','Wallet','Balance','TX count','Total value','Charge','First TX','Last TX','Sector','City','Department','Zone','Address','ID status'].map((h, i) => (
                  <th key={h} style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: (i >= 4 && i <= 7) ? 'right' : 'left',
                    fontSize: 'var(--fs-micro)', fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                    borderBottom: '1px solid var(--border-default)',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {busy && rows.length === 0 ? (
                <tr><td colSpan={16} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Loading active customers…</div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={16} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
                    {totalActive === 0 ? "No active customer for this period." : "No results match the filter."}
                  </div>
                </td></tr>
              ) : filtered.map((r: any, idx: number) => {
                const statusDot = STATUS_COLORS[r.STATUS] || 'var(--text-tertiary)'
                return (
                  <tr key={(r.MSISDN ?? '') + idx} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-body)', fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}>{r.MSISDN}</span>
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      color: 'var(--text-primary)', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {r.IDENTITYNAME || <Dash />}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusDot }} />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.STATUS || '—'}</span>
                      </div>
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        border: '1px solid var(--border-default)',
                        background: 'var(--surface-card)',
                        padding: '1px var(--space-2)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: 'var(--fs-micro)', fontWeight: 500,
                        color: 'var(--text-primary)',
                        textTransform: 'uppercase',
                        letterSpacing: 'var(--tracking-uppercase)',
                      }}>
                        {r.KYC || '—'}
                      </span>
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      textAlign: 'right',
                      color: 'var(--text-primary)', fontWeight: 500,
                    }}>
                      {Number(r.BALANCE ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      textAlign: 'right',
                      color: 'var(--text-primary)', fontWeight: 500,
                    }}>
                      {fmtNum(r.TX_COUNT)}
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      textAlign: 'right',
                      color: 'var(--text-primary)', fontWeight: 500,
                    }}>
                      {fmtMoney(r.TOTAL_VALUE)}
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      textAlign: 'right',
                      color: 'var(--text-primary)', fontWeight: 500,
                    }}>
                      {fmtMoney(r.TOTAL_CHARGE)}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                      {formatDisplayDate(r.FIRST_TX)}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                      {formatDisplayDate(r.LAST_TX)}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{r.SECTOR || <Dash />}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{r.CITY || <Dash />}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{r.DEPARTMENT || <Dash />}</td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      {r.ZONE
                        ? <span style={{
                            border: '1px solid var(--border-default)',
                            background: 'var(--surface-card)',
                            padding: '1px var(--space-2)',
                            borderRadius: 'var(--radius-xs)',
                            fontSize: 'var(--fs-micro)', fontWeight: 500,
                            color: 'var(--text-primary)',
                          }}>{r.ZONE}</span>
                        : <Dash />}
                    </td>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      color: 'var(--text-secondary)',
                    }}>
                      {(!r.ADDRESS || r.ADDRESS.toLowerCase() === 'default')
                        ? <Dash />
                        : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <MapPin size={11} strokeWidth={1.75} color="var(--text-tertiary)" /> {r.ADDRESS}
                          </span>
                        )}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        color: r.ID_STATUS === 'Expired' ? 'var(--negative)' : r.ID_STATUS === 'Valid' ? 'var(--positive)' : 'var(--text-tertiary)',
                        fontWeight: 500,
                      }}>
                        {r.ID_STATUS || '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTop: '1px solid var(--border-default)',
          background: 'var(--surface-muted)',
        }}>
          <div style={{
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-label)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            Display limited to <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(DISPLAY_LIMIT)}</strong> rows · Excel export retrieves <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>all</strong> active customers ({fmtNum(totalActive)})
          </div>
        </div>
      </div>

      {/* EXPORT PROGRESS OVERLAY */}
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
                }}>Export · Active customers</div>
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
              {/* Format toggle */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--surface-muted)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-3)',
                border: '1px solid var(--border-faint)',
              }}>
                <span style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 500,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                }}>Format</span>
                <button onClick={() => setExportFormat('csv')}
                  style={{
                    padding: '0 var(--space-3)', height: '28px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid ' + (exportFormat === 'csv' ? 'var(--text-primary)' : 'var(--border-default)'),
                    background: exportFormat === 'csv' ? 'var(--text-primary)' : 'var(--surface-card)',
                    color: exportFormat === 'csv' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 500, fontSize: 'var(--fs-label)',
                    cursor: 'pointer',
                  }}>CSV (recommended)</button>
                <button onClick={() => setExportFormat('xlsx')}
                  style={{
                    padding: '0 var(--space-3)', height: '28px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid ' + (exportFormat === 'xlsx' ? 'var(--text-primary)' : 'var(--border-default)'),
                    background: exportFormat === 'xlsx' ? 'var(--text-primary)' : 'var(--surface-card)',
                    color: exportFormat === 'xlsx' ? 'white' : 'var(--text-secondary)',
                    fontWeight: 500, fontSize: 'var(--fs-label)',
                    cursor: 'pointer',
                  }}>XLSX</button>
              </div>

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

function KpiCard({ label, value, sub, accent }: { label: string, value: string, sub?: string, accent: string }) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Top accent strip */}
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

// ── Form primitives ──

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

function DateInput({ value, max, onChange }: { value: string, max?: string, onChange: (v: string) => void }) {
  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      transition: 'border-color 0.12s',
    }}>
      <Calendar size={13} strokeWidth={1.75} color="var(--text-tertiary)"
        style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
      <input type="date"
        value={value} max={max}
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

type SegOption = {
  value: string
  label: string
  active: boolean
  title?: string
  onClick: () => void
}

function Segmented({ options, disabled }: { options: SegOption[], disabled?: boolean }) {
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
          disabled={disabled}
          title={opt.title}
          style={{
            padding: '0 var(--space-3)', height: '30px',
            borderRadius: 'var(--radius-xs)',
            border: 'none',
            background: opt.active ? 'var(--surface-card)' : 'transparent',
            color: opt.active ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontWeight: opt.active ? 600 : 500,
            fontSize: 'var(--fs-label)',
            cursor: disabled ? 'wait' : 'pointer',
            transition: 'background 0.12s, color 0.12s',
            boxShadow: opt.active ? '0 0 0 1px var(--border-default) inset' : 'none',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}
