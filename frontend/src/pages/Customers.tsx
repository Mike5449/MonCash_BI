import { useState, useRef, useMemo } from "react"
import {
  Search, Phone, Activity, RefreshCw,
  FileText, X, Upload, Calendar, Download, ChevronDown, ChevronUp, XCircle, Check,
  Users as UsersIcon, MapPin
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useCustomers, useCustomerSummary, useUploadBulk } from "../hooks/useAnalytics"
import { type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const EXPORT_LIMIT = 2_000_000  // jusqu'à 2M lignes via streaming XLSX côté serveur

type ExportColumn = { key: string; label: string; pick: (c: any) => any }
const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "DATE_CODE",      label: "Date Code",        pick: (c) => c.DATE_CODE ?? "" },
  { key: "NAME",           label: "Full Name",        pick: (c) => c.IDENTITYNAME ?? "" },
  { key: "MSISDN",         label: "MSISDN",           pick: (c) => c.MSISDN ?? "" },
  { key: "GENDER",         label: "Gender",           pick: (c) => c.GENDER ?? "" },
  { key: "DOB",            label: "Date of Birth",    pick: (c) => formatDisplayDate(c.DOB) },
  { key: "AGE",            label: "Age",              pick: (c) => c.AGE ?? "" },
  { key: "STATUS",         label: "Account Status",   pick: (c) => c.STATUS ?? "" },
  { key: "WALLET",         label: "Wallet Type",      pick: (c) => c.KYC ?? "" },
  { key: "BALANCE",        label: "Balance (HTG)",    pick: (c) => Number(c.BALANCE ?? 0) },
  { key: "ADDRESS",        label: "Address",          pick: (c) => c.ADDRESS || "N/A" },
  { key: "IMT_OPT",        label: "IMT Opt-in",       pick: (c) => c.IMTOPTIN ?? "" },
  { key: "ID_TYPE",        label: "ID Type",          pick: (c) => c.ID_TYPE ?? "" },
  { key: "ID_NUMBER",      label: "ID Number",        pick: (c) => c.ID_NUMBER ?? "" },
  { key: "IDNUMBER_CLEAN", label: "ID Number Clean",  pick: (c) => c.IDNUMBER_CLEAN ?? "" },
  { key: "ID_CLEAN",       label: "ID Clean Flag",    pick: (c) => c.ID_CLEAN ?? "" },
  { key: "ID_STATUS",      label: "ID Status",        pick: (c) => c.ID_STATUS ?? "" },
  { key: "EXPIRY_DATE",    label: "Expiry Date",      pick: (c) => formatDisplayDate(c.ID_EXPIRY_DATE) },
  { key: "CREATED_DATE",   label: "Created Date",     pick: (c) => formatDisplayDate(c.CREATED_DATE) },
  { key: "SECTOR",         label: "Sector",           pick: (c) => c.SECTOR ?? "" },
  { key: "CITY",           label: "City",             pick: (c) => c.CITY ?? "" },
  { key: "DEPARTMENT",     label: "Department",       pick: (c) => c.DEPARTMENT ?? "" },
  { key: "ZONE",           label: "Zone (Cluster)",   pick: (c) => c.ZONE ?? "" },
]

const formatDisplayDate = (dateStr?: string) => {
  if (!dateStr) return 'N/A'
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  const [year, month, day] = parts
  return `${month}/${day}/${year}`
}

const formatHTG = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS_COLORS: Record<string, string> = {
  Active: 'var(--positive)', 'Pending Active': 'var(--data-subs)', Suspended: 'var(--negative)',
  Dormant: 'var(--text-tertiary)', Frozen: 'var(--data-value)', Closed: 'var(--text-secondary)',
}

export default function Customers() {
  const [filters, setFilters] = useState({
    status: "", kyc: "", idStatus: "", idClean: "", hasAddress: "", imtOptIn: "",
    expiryDate: "", createdStart: "", createdEnd: "", msisdn: "",
    msisdns: [] as string[],
    shortcodes: [] as string[],
    identityType: "Customer" as "Customer" | "Organization",
    name: "",
    names: [] as string[],
    dateCode: "",
    limit: 100,
  })

  const [showDates, setShowDates] = useState(false)
  const [bulkFileName, setBulkFileName] = useState<string | null>(null)
  const [bulkKind, setBulkKind] = useState<'msisdn' | 'shortcode' | 'name' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [selectedExportCols, setSelectedExportCols] = useState<string[]>(EXPORT_COLUMNS.map(c => c.key))
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)

  const { data: customers, isLoading, isFetching, refetch } = useCustomers(filters)
  const { data: summary, isFetching: isLoadingSummary } = useCustomerSummary(filters)
  const uploadBulk = useUploadBulk()

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const { name, value } = e.target
    setFilters(prev => {
      const newFilters: any = { ...prev, [name]: value }
      if (name === 'expiryDate' && value) {
        newFilters.createdStart = ""; newFilters.createdEnd = ""
      } else if ((name === 'createdStart' || name === 'createdEnd') && value) {
        newFilters.expiryDate = ""
      }
      return newFilters
    })
  }

  const clearFilters = () => {
    setFilters({
      status: "", kyc: "", idStatus: "", idClean: "", hasAddress: "", imtOptIn: "",
      expiryDate: "", createdStart: "", createdEnd: "", msisdn: "",
      msisdns: [], shortcodes: [],
      identityType: "Customer",
      name: "", names: [],
      dateCode: "",
      limit: 100,
    })
    setBulkFileName(null)
    setBulkKind(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setBulkFileName(file.name)
      const res = await uploadBulk.mutateAsync(file)
      const kind = (res?.kind === 'shortcode' ? 'shortcode' : res?.kind === 'name' ? 'name' : 'msisdn') as 'msisdn' | 'shortcode' | 'name'
      setBulkKind(kind)
      if (kind === 'shortcode') {
        setFilters(prev => ({
          ...prev,
          msisdns: [], names: [],
          shortcodes: res.shortcodes || [],
          identityType: 'Organization',  // auto-bascule
        }))
      } else if (kind === 'name') {
        setFilters(prev => ({
          ...prev,
          msisdns: [], shortcodes: [],
          names: res.names || [],
          // identityType reste tel quel — les noms s'appliquent aux deux
        }))
      } else {
        setFilters(prev => ({
          ...prev,
          msisdns: res.msisdns || [],
          shortcodes: [], names: [],
          identityType: 'Customer',  // auto-bascule
        }))
      }
    } catch (err) {
      console.error("Upload failed", err)
      const apiMessage =
        typeof err === "object" && err !== null && "body" in err &&
        typeof (err as any).body === "object" && (err as any).body !== null &&
        "detail" in (err as any).body
          ? String((err as any).body.detail)
          : "Erreur de lecture du fichier. Assure-toi qu'il contient une colonne MSISDN, SHORTCODE ou FULL_NAMES."
      alert(apiMessage); setBulkFileName(null); setBulkKind(null)
    }
  }

  const clearBulkFilter = () => {
    setBulkFileName(null)
    setBulkKind(null)
    setFilters(prev => ({ ...prev, msisdns: [], shortcodes: [], names: [] }))
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const toggleExportCol = (key: string) =>
    setSelectedExportCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const runExport = async () => {
    if (selectedExportCols.length === 0) return
    setIsExporting(true)
    setShowExportModal(false)
    try {
      // Streaming XLSX côté serveur — pas de double parsing JSON, pas de freeze navigateur
      const dateStr = new Date().toISOString().split('T')[0]
      const kind = filters.identityType === 'Organization' ? 'Organizations' : 'Customers'
      // URLSearchParams ne supporte pas les tableaux directement — on les passe en CSV via le helper
      const params: Record<string, any> = {
        status:        filters.status,
        kyc:           filters.kyc,
        id_status:     filters.idStatus,
        id_clean:      filters.idClean,
        has_address:   filters.hasAddress,
        imt_opt_in:    filters.imtOptIn,
        expiry_date:   filters.expiryDate,
        created_start: filters.createdStart,
        created_end:   filters.createdEnd,
        msisdn:        filters.msisdn,
        identity_type: filters.identityType,
        date_code:     filters.dateCode,
        columns:       selectedExportCols.join(','),
        limit:         EXPORT_LIMIT,
      }
      // FastAPI accepte des arrays via répétition de param: msisdns=A&msisdns=B
      // On préfére passer via URLSearchParams custom
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
      }
      if (filters.msisdns && filters.msisdns.length) {
        filters.msisdns.forEach(m => qs.append('msisdns', m))
      }
      if (filters.shortcodes && filters.shortcodes.length) {
        filters.shortcodes.forEach(s => qs.append('shortcodes', s))
      }

      // On bypass downloadXlsxStream car notre URL nécessite des params en répétition (arrays)
      const { OpenAPI } = await import("../api/core/OpenAPI")
      const url = `${OpenAPI.BASE}/customers/export.xlsx?${qs.toString()}`
      setExportProgress({ bytesReceived: 0, totalBytes: 0, phase: 'Génération du fichier côté serveur…' })
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} : ${await res.text()}`)
      const total = Number(res.headers.get('Content-Length') || 0)
      setExportProgress({ bytesReceived: 0, totalBytes: total, phase: 'Téléchargement du fichier…' })
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
      const blob = new Blob(chunks as BlobPart[], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const dl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = dl
      a.download = `${kind}_${dateStr}.xlsx`
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

  const activeFiltersCount = useMemo(() => {
    let n = 0
    if (filters.status) n++
    if (filters.kyc) n++
    if (filters.idClean) n++
    if (filters.idStatus) n++
    if (filters.imtOptIn) n++
    if (filters.hasAddress) n++
    if (filters.msisdn) n++
    if (filters.name) n++
    if (filters.createdStart || filters.createdEnd) n++
    if (filters.msisdns.length > 0) n++
    if (filters.shortcodes.length > 0) n++
    if (filters.names.length > 0) n++
    return n
  }, [filters])

  const busy = isLoading || isFetching
  // L'export tape sur l'API → on autorise dès qu'un fetch est en place (les filtres actifs définissent le périmètre).
  const canExport = !busy && !isExporting

  return (
    <DashboardLayout>
      <div style={{ maxWidth: '100%', overflowX: 'hidden' }}>
        {/* ── HERO · title on canvas + hairline ── */}
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
              Customer · Accounts
            </div>
            <h1 style={{
              margin: 0,
              fontSize: 'var(--fs-xl)', fontWeight: 600,
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--text-primary)', lineHeight: 1.15,
            }}>
              {filters.identityType === 'Organization' ? 'Organization Base' : 'Customer Base'}
            </h1>
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
              {filters.identityType === 'Organization'
                ? 'Organizations / billers audit · lookup by shortcode or bulk file (Excel / CSV).'
                : 'Customer portfolio audit · single MSISDN or bulk file (Excel / CSV).'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xlsm,.csv" style={{ display: 'none' }} />
            <button onClick={() => refetch()} disabled={busy}
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
              onClick={() => fileInputRef.current?.click()}
              title="File must contain an MSISDN, SHORTCODE or FULL_NAMES column"
              style={{
                background: bulkFileName ? 'var(--brand)' : 'var(--surface-card)',
                color: bulkFileName ? 'white' : 'var(--text-primary)',
                border: '1px solid ' + (bulkFileName ? 'var(--brand)' : 'var(--border-default)'),
                height: '34px', padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              }}
            >
              {uploadBulk.isPending ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <Upload size={13} strokeWidth={1.75} />}
              {bulkFileName
                ? `Bulk ${bulkKind === 'shortcode' ? 'shortcode' : bulkKind === 'name' ? 'names' : 'MSISDN'} · ${bulkKind === 'shortcode' ? filters.shortcodes.length : bulkKind === 'name' ? filters.names.length : filters.msisdns.length}`
                : 'Bulk filter'}
              {bulkFileName && (
                <X size={12} strokeWidth={1.75} style={{ marginLeft: '4px' }} onClick={(e) => { e.stopPropagation(); clearBulkFilter() }} />
              )}
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              disabled={!canExport}
              title="Export all records matching active filters"
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
              {isExporting ? "Exporting" : "Export"}
            </button>
          </div>
        </div>

        {/* ── SUMMARY CARDS · vertical accent bar ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}>
          <SummaryCard
            title="Full wallets"
            total={summary?.full_total}
            accent="var(--positive)"
            loading={isLoadingSummary}
            stats={[
              { label: 'Active',    value: summary?.full_active,    dot: 'var(--positive)'      },
              { label: 'Pending',   value: summary?.full_pending,   dot: 'var(--data-subs)'     },
              { label: 'Suspended', value: summary?.full_suspended, dot: 'var(--negative)'      },
              { label: 'Dormant',   value: summary?.full_dormant,   dot: 'var(--text-tertiary)' },
              { label: 'Frozen',    value: summary?.full_frozen,    dot: 'var(--data-value)'    },
              { label: 'Closed',    value: summary?.full_closed,    dot: 'var(--text-secondary)' },
            ]}
          />
          <SummaryCard
            title="Mini wallets"
            total={summary?.mini_total}
            accent="var(--data-value)"
            loading={isLoadingSummary}
            stats={[
              { label: 'Active',    value: summary?.mini_active,    dot: 'var(--positive)'      },
              { label: 'Pending',   value: summary?.mini_pending,   dot: 'var(--data-subs)'     },
              { label: 'Suspended', value: summary?.mini_suspended, dot: 'var(--negative)'      },
              { label: 'Dormant',   value: summary?.mini_dormant,   dot: 'var(--text-tertiary)' },
              { label: 'Frozen',    value: summary?.mini_frozen,    dot: 'var(--data-value)'    },
              { label: 'Closed',    value: summary?.mini_closed,    dot: 'var(--text-secondary)' },
            ]}
          />
          <SummaryCard
            title="All Accounts"
            total={summary?.total}
            accent="var(--data-subs)"
            loading={isLoadingSummary}
            stats={[
              { label: 'With address',   value: summary?.with_address,    dot: 'var(--positive)'     },
              { label: 'No address',     value: summary?.without_address, dot: 'var(--negative)'     },
              { label: 'IMT opt-yes',    value: summary?.imt_yes,         dot: 'var(--data-volume)'  },
              { label: 'Expired IDs',    value: summary?.id_expired,      dot: 'var(--negative)'     },
              { label: 'Clean ID ratio', value: summary?.total ? Math.round((summary?.id_valid / summary?.total) * 100) + '%' : '0%', dot: 'var(--positive)' },
            ]}
          />
        </div>

        {/* ── FILTER CARD · borders-only ── */}
        <div style={{
          marginBottom: 'var(--space-4)',
          padding: 'var(--space-4)',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 'var(--space-4)',
            paddingBottom: 'var(--space-3)',
            borderBottom: '1px solid var(--border-faint)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Search size={13} strokeWidth={1.75} style={{ color: 'var(--text-tertiary)' }} />
              <h3 style={{
                fontSize: 'var(--fs-md)', fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: 'var(--tracking-tight)',
                margin: 0,
              }}>Filters</h3>
              {activeFiltersCount > 0 && (
                <span style={{
                  color: 'var(--text-tertiary)',
                  fontSize: 'var(--fs-micro)', fontWeight: 500,
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                  fontVariantNumeric: 'tabular-nums',
                  marginLeft: 'var(--space-1)',
                }}>
                  {activeFiltersCount} active
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <button
                onClick={clearFilters}
                disabled={activeFiltersCount === 0}
                title="Reset all filters"
                style={{
                  background: activeFiltersCount > 0 ? 'var(--brand)' : 'var(--surface-muted)',
                  color: activeFiltersCount > 0 ? 'white' : 'var(--text-muted)',
                  border: '1px solid ' + (activeFiltersCount > 0 ? 'var(--brand)' : 'var(--border-default)'),
                  padding: '5px var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--fs-label)', fontWeight: 500,
                  cursor: activeFiltersCount > 0 ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                }}
              >
                <X size={12} strokeWidth={1.75} /> Clear filters
              </button>
              <button
                onClick={() => setShowDates(!showDates)}
                style={{
                  background: showDates ? 'var(--brand-soft)' : 'var(--surface-card)',
                  color: showDates ? 'var(--brand)' : 'var(--text-secondary)',
                  border: '1px solid ' + (showDates ? 'var(--brand-border)' : 'var(--border-default)'),
                  padding: '5px var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--fs-label)', fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                }}
              >
                <Calendar size={12} strokeWidth={1.75} /> {showDates ? 'Hide dates' : 'Date filters'} {showDates ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
            <FilterField label="Search MSISDN">
              <div className="search-container" style={{ height: '38px', borderColor: filters.msisdn ? 'var(--mc-red)' : 'var(--mc-border)', borderRadius: '6px' }}>
                <Phone size={14} color={filters.msisdn ? 'var(--mc-red)' : '#94a3b8'} />
                <input type="text" name="msisdn" value={filters.msisdn} onChange={handleFilterChange} className="search-input" placeholder="Enter number…" autoComplete="off" />
              </div>
            </FilterField>
            <FilterField label="Search by Name">
              <div className="search-container" style={{ height: '38px', borderColor: filters.name ? 'var(--mc-red)' : 'var(--mc-border)', borderRadius: '6px' }}>
                <UsersIcon size={14} color={filters.name ? 'var(--mc-red)' : '#94a3b8'} />
                <input
                  type="text" name="name"
                  value={filters.name} onChange={handleFilterChange}
                  className="search-input"
                  placeholder="Nom complet (ordre libre)…"
                  title="Tolère l'ordre des mots, la casse et la ponctuation"
                  autoComplete="off"
                />
              </div>
            </FilterField>
            <FilterField label="Account Status">
              <Select name="status" value={filters.status} onChange={handleFilterChange}>
                <option value="">All (Closed inclus)</option>
                <option value="Active">Active</option>
                <option value="Pending Active">Pending Active</option>
                <option value="Suspended">Suspended</option>
                <option value="Dormant">Dormant</option>
                <option value="Frozen">Frozen</option>
                <option value="Closed">Closed</option>
              </Select>
            </FilterField>
            <FilterField label="Wallet Tier">
              <Select name="kyc" value={filters.kyc} onChange={handleFilterChange}>
                <option value="">All Tiers</option>
                <option value="Registered Customer Level 0">Mini Wallet</option>
                <option value="Registered Customer Level 1">Full Wallet</option>
              </Select>
            </FilterField>
            <FilterField label="ID Quality">
              <Select name="idClean" value={filters.idClean} onChange={handleFilterChange}>
                <option value="">All Qualities</option>
                <option value="YES">Clean ID</option>
                <option value="NO">Dirty ID (Raw)</option>
              </Select>
            </FilterField>
            <FilterField label="ID Status">
              <Select name="idStatus" value={filters.idStatus} onChange={handleFilterChange}>
                <option value="">All</option>
                <option value="Valid">Valid</option>
                <option value="Expired">Expired</option>
              </Select>
            </FilterField>
            <FilterField label="IMT Opt-in">
              <Select name="imtOptIn" value={filters.imtOptIn} onChange={handleFilterChange}>
                <option value="">All</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </Select>
            </FilterField>
            <FilterField label="Address Quality">
              <Select name="hasAddress" value={filters.hasAddress} onChange={handleFilterChange}>
                <option value="">All Addresses</option>
                <option value="YES">Has Valid Address</option>
                <option value="NO">Null or "Default"</option>
              </Select>
            </FilterField>
          </div>

          {showDates && (
            <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px dashed var(--mc-border)' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--mc-red)', marginBottom: '10px', letterSpacing: '0.5px' }}>
                Registration interval
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <FilterField label="Registration Start">
                  <input type="date" name="createdStart" value={filters.createdStart} onChange={handleFilterChange} className="search-input" style={{ width: '100%', borderRadius: '6px', border: filters.createdStart ? '1px solid var(--mc-red)' : '1px solid var(--mc-border)', padding: '0 10px', background: '#fff', height: '38px', marginBottom: 0 }} />
                </FilterField>
                <FilterField label="Registration End">
                  <input type="date" name="createdEnd" value={filters.createdEnd} onChange={handleFilterChange} className="search-input" style={{ width: '100%', borderRadius: '6px', border: filters.createdEnd ? '1px solid var(--mc-red)' : '1px solid var(--mc-border)', padding: '0 10px', background: '#fff', height: '38px', marginBottom: 0 }} />
                </FilterField>
              </div>
            </div>
          )}
        </div>

        {/* ── TABLE · newspaper-style ── */}
        <div style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          maxWidth: '100%', overflow: 'hidden',
        }}>
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border-default)',
            background: 'var(--surface-muted)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <UsersIcon size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
              <h3 style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500, margin: 0,
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
                letterSpacing: 'var(--tracking-uppercase)',
              }}>Customer records</h3>
              {!busy && customers && (
                <span style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 500,
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-card)',
                  padding: '1px var(--space-2)',
                  borderRadius: 'var(--radius-xs)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {customers.length.toLocaleString('en-US')} rows
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
          </div>

          {bulkFileName && (
            <div style={{
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--surface-muted)',
              borderBottom: '1px solid var(--border-faint)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
              <FileText size={12} strokeWidth={1.75} color="var(--text-tertiary)" />
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-uppercase)',
              }}>
                Bulk {bulkKind === 'shortcode' ? 'shortcode' : bulkKind === 'name' ? 'names' : 'MSISDN'} · "{bulkFileName}" ({bulkKind === 'shortcode' ? filters.shortcodes.length : bulkKind === 'name' ? filters.names.length : filters.msisdns.length})
              </span>
              <button onClick={clearBulkFilter} style={{
                marginLeft: 'auto',
                border: 'none', background: 'transparent',
                color: 'var(--brand)',
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
              }}>Clear</button>
            </div>
          )}

          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{
              width: '100%', minWidth: '3100px',
              borderCollapse: 'collapse',
              fontSize: 'var(--fs-body)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <thead style={{ background: 'var(--surface-muted)' }}>
                <tr>
                  {['Date code','Name','MSISDN','Gender','DOB','Age','Status','Wallet','Balance','Address','IMT','ID type','ID number','ID clean','ID status','Expiry','Created','Sector','City','Department','Zone'].map((h, i) => (
                    <th key={h} style={{
                      padding: 'var(--space-2) var(--space-4)',
                      textAlign: (i === 5 || i === 8 || i === 15 || i === 16) ? 'right' : (i === 10 ? 'center' : 'left'),
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
                {busy ? (
                  <tr><td colSpan={21} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div className="spinner" />
                      <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Loading customer base…</div>
                    </div>
                  </td></tr>
                ) : !customers || customers.length === 0 ? (
                  <tr><td colSpan={21} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
                      <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>No customer matches these filters.</div>
                    </div>
                  </td></tr>
                ) : customers.map((cust: any, idx: number) => {
                  const statusDot = STATUS_COLORS[cust.STATUS] || 'var(--text-tertiary)'
                  const noAddress = !cust.ADDRESS || cust.ADDRESS.toLowerCase() === 'default'
                  const Dash = <span style={{ color: 'var(--text-muted)' }}>—</span>
                  return (
                    <tr key={cust.MSISDN + idx} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-label)',
                        color: cust.DATE_CODE ? 'var(--text-secondary)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }} title={cust.DATE_CODE || ''}>
                        {cust.DATE_CODE || '—'}
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        color: 'var(--text-primary)', fontWeight: 500,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {cust.IDENTITYNAME || Dash}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                        <span style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 'var(--fs-body)', fontWeight: 500,
                          color: 'var(--text-primary)',
                        }}>{cust.MSISDN}</span>
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                        {cust.GENDER || Dash}
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-label)',
                        color: cust.DOB ? 'var(--text-secondary)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}>
                        {cust.DOB ? formatDisplayDate(cust.DOB) : Dash}
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        textAlign: 'right',
                        color: cust.AGE != null ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontWeight: 500,
                      }}>
                        {cust.AGE != null
                          ? <>{cust.AGE}<span style={{ color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: '3px' }}>ans</span></>
                          : Dash}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusDot, flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{cust.STATUS}</span>
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
                          {cust.KYC || '—'}
                        </span>
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        textAlign: 'right',
                        color: 'var(--text-primary)', fontWeight: 500,
                      }}>
                        {formatHTG(cust.BALANCE)} <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-micro)' }}>HTG</span>
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        color: noAddress ? 'var(--text-muted)' : 'var(--text-secondary)',
                      }}>
                        {noAddress
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><MapPin size={11} strokeWidth={1.75} /> No valid address</span>
                          : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><MapPin size={11} strokeWidth={1.75} color="var(--text-tertiary)" /> {cust.ADDRESS}</span>}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {cust.IMTOPTIN || Dash}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>
                        {cust.ID_TYPE || Dash}
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        fontFamily: 'ui-monospace, monospace',
                        color: cust.ID_NUMBER ? 'var(--text-primary)' : 'var(--text-muted)',
                      }}>
                        {cust.ID_NUMBER || '—'}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                        {cust.IDNUMBER_CLEAN
                          ? (
                            <span style={{
                              fontFamily: 'ui-monospace, monospace',
                              color: 'var(--text-secondary)',
                              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                            }}>
                              <span style={{
                                width: '5px', height: '5px',
                                borderRadius: '50%',
                                background: cust.ID_CLEAN === 'YES' ? 'var(--positive)' : 'var(--negative)',
                              }} />
                              {cust.IDNUMBER_CLEAN}
                            </span>
                          )
                          : Dash}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <span style={{
                            width: '6px', height: '6px',
                            borderRadius: '50%',
                            background: cust.ID_STATUS === 'Valid' ? 'var(--positive)' : 'var(--negative)',
                          }} />
                          <span style={{
                            color: cust.ID_STATUS === 'Expired' ? 'var(--negative)' : 'var(--text-primary)',
                            fontWeight: 500,
                          }}>{cust.ID_STATUS}</span>
                        </div>
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        textAlign: 'right',
                        color: cust.ID_STATUS === 'Expired' ? 'var(--negative)' : 'var(--text-secondary)',
                        fontWeight: 500,
                      }}>
                        {formatDisplayDate(cust.ID_EXPIRY_DATE)}
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-4)',
                        textAlign: 'right',
                        color: 'var(--text-tertiary)',
                      }}>
                        {formatDisplayDate(cust.CREATED_DATE)}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{cust.SECTOR || Dash}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{cust.CITY || Dash}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)', color: 'var(--text-secondary)' }}>{cust.DEPARTMENT || Dash}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                        {cust.ZONE
                          ? <span style={{
                              border: '1px solid var(--border-default)',
                              background: 'var(--surface-card)',
                              padding: '1px var(--space-2)',
                              borderRadius: 'var(--radius-xs)',
                              fontSize: 'var(--fs-micro)', fontWeight: 500,
                              color: 'var(--text-primary)',
                            }}>{cust.ZONE}</span>
                          : Dash}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* footer */}
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderTop: '1px solid var(--border-default)',
            background: 'var(--surface-muted)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              fontSize: 'var(--fs-label)',
              color: 'var(--text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <span>
                Total segment: <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{summary?.total?.toLocaleString() ?? '—'}</strong> accounts
              </span>
              {customers && (
                <span>
                  Displayed: {customers.length}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-uppercase)',
              }}>Page size</span>
              <select
                name="limit"
                value={filters.limit}
                onChange={handleFilterChange}
                style={{
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-card)',
                  fontWeight: 500, fontSize: 'var(--fs-body)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  height: '28px', padding: '0 var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <option value="100">100</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
              </select>
            </div>
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
                }}>Export · Customers</div>
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

// ----- subcomponents -----

function FilterField({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', color: '#94a3b8', marginBottom: '6px', letterSpacing: '0.5px' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Select({ name, value, onChange, children }: any) {
  return (
    <select
      name={name}
      value={value}
      onChange={onChange}
      style={{
        width: '100%', height: '38px', borderRadius: '6px',
        border: value ? '1px solid var(--mc-red)' : '1px solid var(--mc-border)',
        padding: '0 10px', background: '#fff',
        fontSize: '12px', fontWeight: '600', color: 'var(--mc-text-main)',
      }}
    >
      {children}
    </select>
  )
}

function SummaryCard({ title, total, accent, stats, loading }: any) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Top accent strip — full-width hairline */}
      <div style={{ height: '3px', background: accent }} />

      {/* Top body: stats grid only (title + total moved to footer) */}
      <div style={{ padding: 'var(--space-6) var(--space-8) var(--space-6)' }}>
        {/* Stats grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          columnGap: 'var(--space-5)',
          rowGap: 'var(--space-3)',
        }}>
          {stats.map((s: any) => (
            <div key={s.label} style={{
              display: 'flex', alignItems: 'center',
              gap: 'var(--space-3)',
              fontSize: 'var(--fs-body)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                minWidth: 0,
              }}>
                <span style={{
                  width: '8px', height: '8px',
                  borderRadius: '50%',
                  background: s.dot || 'var(--text-tertiary)',
                  flexShrink: 0,
                }} />
                <span style={{
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontWeight: 500,
                }}>
                  {s.label}
                </span>
              </div>
              <span style={{
                fontWeight: 700,
                fontSize: 'var(--fs-md)',
                color: 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {loading ? '—' : (typeof s.value === 'number' ? s.value.toLocaleString('en-US') : (s.value ?? '—'))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom footer: title + big total in muted surface */}
      <div style={{
        padding: 'var(--space-5) var(--space-8) var(--space-6)',
        background: 'var(--surface-muted)',
        borderTop: '1px solid var(--border-faint)',
      }}>
        {/* Title row: dot + title */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}>
          <span style={{
            width: '7px', height: '7px',
            borderRadius: '50%',
            background: accent,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 'var(--fs-label)', fontWeight: 800,
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
          }}>{title}</span>
        </div>

        {/* Big total */}
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)',
        }}>
          <div style={{
            fontSize: '34px', fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}>
            {loading ? '—' : Number(total ?? 0).toLocaleString('en-US')}
          </div>
          <div style={{
            fontSize: 'var(--fs-label)',
            color: 'var(--text-tertiary)',
            fontWeight: 500,
          }}>accounts</div>
        </div>
      </div>
    </div>
  )
}
