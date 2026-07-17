import { useState, useMemo } from "react"
import {
  RefreshCw, Download, Search, Activity, XCircle, X, Calendar,
  Store, Tag, MapPin, CheckCircle,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import {
  useMerchantAccounts,
  useMerchantAccountsFilterOptions,
} from "../hooks/useAnalytics"
import { type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

const DISPLAY_LIMIT = 200
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

// Couleur fee → couleur badge
const FEE_COLOR: Record<string, string> = {
  '2%':   '#E31B23',   // brand red — premium
  '1.5%': '#F59E0B',   // amber     — blue
  '0%':   '#64748B',   // slate     — other/free
}

export default function MerchantAccounts() {
  // ── Local editing state ──
  const [localStart, setLocalStart] = useState<string>('')
  const [localEnd,   setLocalEnd]   = useState<string>('')
  const [localSearch, setLocalSearch] = useState<string>('')
  const [localTypes,   setLocalTypes]   = useState<string[]>([])
  const [localDepts,   setLocalDepts]   = useState<string[]>([])
  const [localStatuses, setLocalStatuses] = useState<string[]>([])

  // ── Applied state (envoyé au backend) ──
  const [start, setStart] = useState<string>('')
  const [end,   setEnd]   = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [types,    setTypes]    = useState<string[] | undefined>(undefined)
  const [depts,    setDepts]    = useState<string[] | undefined>(undefined)
  const [statuses, setStatuses] = useState<string[] | undefined>(undefined)

  const [page, setPage] = useState<number>(0)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)

  const apply = () => {
    setStart(localStart); setEnd(localEnd)
    setSearch(localSearch.trim())
    setTypes(localTypes.length > 0 ? localTypes : undefined)
    setDepts(localDepts.length > 0 ? localDepts : undefined)
    setStatuses(localStatuses.length > 0 ? localStatuses : undefined)
    setPage(0)
  }
  const clearFilters = () => {
    setLocalStart(''); setLocalEnd(''); setLocalSearch('')
    setLocalTypes([]); setLocalDepts([]); setLocalStatuses([])
    setStart(''); setEnd(''); setSearch('')
    setTypes(undefined); setDepts(undefined); setStatuses(undefined)
    setPage(0)
  }
  const setQuick = (n: 7 | 30 | 90 | 365) => {
    const s = minusDays(n), e = todayMinus1()
    setLocalStart(s); setLocalEnd(e)
    setStart(s); setEnd(e); setPage(0)
  }

  const toggle = (list: string[], setter: (v: string[]) => void, v: string) => {
    setter(list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  }

  // ── Fetches ──
  const { data, isLoading, isFetching, refetch } = useMerchantAccounts({
    limit:  DISPLAY_LIMIT,
    offset: page * DISPLAY_LIMIT,
    createdStart:  start || undefined,
    createdEnd:    end   || undefined,
    merchantTypes: types,
    departments:   depts,
    statuses,
    search: search || undefined,
  })
  const { data: filterOpts } = useMerchantAccountsFilterOptions()

  const busy = isLoading || isFetching
  const rows: any[] = (data as any)?.rows ?? []
  const total: number = Number((data as any)?.total ?? 0)
  const summary = useMemo(() => ({
    total:   Number((data as any)?.summary?.total   ?? 0),
    premium: Number((data as any)?.summary?.premium ?? 0),
    blue:    Number((data as any)?.summary?.blue    ?? 0),
    other:   Number((data as any)?.summary?.other   ?? 0),
    active:  Number((data as any)?.summary?.active  ?? 0),
  }), [data])

  const typeOptions   = (filterOpts as any)?.merchant_types ?? []
  const deptOptions   = (filterOpts as any)?.departments    ?? []
  const statusOptions = (filterOpts as any)?.statuses       ?? []

  const hasActiveFilters = !!(start || end || search || types || depts || statuses)
  const pageCount = Math.max(1, Math.ceil(total / DISPLAY_LIMIT))

  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    setExportProgress({ bytesReceived: 0, totalBytes: 0, phase: 'Server is generating the file…' })
    try {
      const { OpenAPI } = await import("../api/core/OpenAPI")
      const qs = new URLSearchParams()
      qs.set('limit', String(EXPORT_LIMIT))
      if (start)  qs.set('created_start', start)
      if (end)    qs.set('created_end',   end)
      if (search) qs.set('search', search)
      types?.forEach(t    => qs.append('merchant_types', t))
      depts?.forEach(d    => qs.append('departments',    d))
      statuses?.forEach(s => qs.append('statuses',       s))

      const res = await fetch(`${OpenAPI.BASE}/merchants/accounts/export.xlsx?${qs.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const tot = Number(res.headers.get('Content-Length') || 0)
      setExportProgress({ bytesReceived: 0, totalBytes: tot, phase: 'Downloading…' })
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
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const dl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = dl
      a.download = `Merchant_Accounts_${start || 'all'}_to_${end || 'now'}.xlsx`
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

  const canExport = !busy && !isExporting && total > 0

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
            Merchants · Partner directory · Registered accounts
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Merchant Accounts
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
          }}>
            Annuaire des comptes Merchant — dernier snapshot disponible, fee rate par segment.
            Filtres : date d'enregistrement, type, département, statut, recherche libre.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => refetch()} disabled={busy}
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
            }}>
            <RefreshCw size={13} strokeWidth={1.75} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={handleExport} disabled={!canExport}
            title={canExport ? "Export filtered list to Excel" : "No data to export"}
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

      {/* ── KPI STRIP — 5 cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        <KpiCard label="Total merchants" value={busy ? '—' : fmtNum(summary.total)}   accent="var(--brand)"        sub="matching filters" />
        <KpiCard label="Premium (2%)"    value={busy ? '—' : fmtNum(summary.premium)} accent="#E31B23"             sub="Gold / Silver" />
        <KpiCard label="Blue (1.5%)"     value={busy ? '—' : fmtNum(summary.blue)}    accent="#F59E0B"             sub="standard" />
        <KpiCard label="Other (0%)"      value={busy ? '—' : fmtNum(summary.other)}   accent="#64748B"             sub="free / unclassified" />
        <KpiCard label="Active status"   value={busy ? '—' : fmtNum(summary.active)}  accent="var(--positive)"     sub="IDENTITYSTATUS = Active" />
      </div>

      {/* ── FILTER PANEL ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-5)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        display: 'flex', flexDirection: 'column',
        gap: 'var(--space-4)',
      }}>
        {/* Ligne 1 : dates + quick range + search */}
        <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <Field label="Registered from">
            <DateInput value={localStart} max={localEnd || todayMinus1()}
              onChange={setLocalStart} />
          </Field>
          <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-tertiary)', paddingBottom: '10px' }}>→</div>
          <Field label="To">
            <DateInput value={localEnd} max={todayMinus1()}
              onChange={setLocalEnd} />
          </Field>

          <Field label="Quick range">
            <Segmented options={([7, 30, 90, 365] as const).map(n => ({
              value: String(n),
              label: n === 365 ? '1Y' : `${n}d`,
              active: false,
              onClick: () => setQuick(n),
            }))} />
          </Field>

          <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-default)', margin: '0 var(--space-2)' }} />

          <Field label="Search">
            <TextInputWithIcon
              icon={<Search size={13} strokeWidth={1.75} color="var(--text-tertiary)" />}
              value={localSearch} onChange={setLocalSearch} onEnter={apply}
              placeholder="Name / MSISDN / Shortcode / ID…" width={260}
            />
          </Field>

          <div style={{ paddingBottom: 0, display: 'flex', gap: 'var(--space-2)' }}>
            <button onClick={apply} disabled={busy}
              style={{
                background: 'var(--brand)', color: 'white',
                border: '1px solid var(--brand)',
                height: '38px', padding: '0 var(--space-5)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 600, fontSize: 'var(--fs-body)',
                cursor: busy ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                opacity: busy ? 0.5 : 1,
              }}>
              <Search size={13} strokeWidth={1.75} /> Apply
            </button>
            <button onClick={clearFilters}
              disabled={!hasActiveFilters && !localStart && !localEnd && !localSearch
                        && localTypes.length === 0 && localDepts.length === 0 && localStatuses.length === 0}
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
            marginLeft: 'auto', paddingBottom: '10px',
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
            gap: 'var(--space-1)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>Applied window</span>
            <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {start || '—'} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>→</span> {end || '—'}
            </span>
            {hasActiveFilters && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '420px' }}>
                {types    && <Tagchip>{types.length} type{types.length > 1 ? 's' : ''}</Tagchip>}
                {depts    && <Tagchip>{depts.length} dept{depts.length > 1 ? 's' : ''}</Tagchip>}
                {statuses && <Tagchip>{statuses.length} status{statuses.length > 1 ? 'es' : ''}</Tagchip>}
                {search   && <Tagchip>Search: "{search.length > 20 ? search.slice(0, 20) + '…' : search}"</Tagchip>}
              </div>
            )}
          </div>
        </div>

        {/* Ligne 2 : merchant types multi-select */}
        <FilterRow
          icon={<Tag size={11} strokeWidth={1.75} />}
          label="Merchant types"
          options={typeOptions}
          selected={localTypes}
          onToggle={(v) => toggle(localTypes, setLocalTypes, v)}
          onToggleAll={() =>
            setLocalTypes(localTypes.length === typeOptions.length ? [] : [...typeOptions])
          }
          renderOption={(t) => (
            <>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: FEE_COLOR[fee(t)] || 'var(--text-muted)',
              }} />
              {t}
            </>
          )}
        />

        {/* Ligne 3 : departments */}
        <FilterRow
          icon={<MapPin size={11} strokeWidth={1.75} />}
          label="Departments"
          options={deptOptions}
          selected={localDepts}
          onToggle={(v) => toggle(localDepts, setLocalDepts, v)}
          onToggleAll={() =>
            setLocalDepts(localDepts.length === deptOptions.length ? [] : [...deptOptions])
          }
        />

        {/* Ligne 4 : statuses */}
        {statusOptions.length > 0 && (
          <FilterRow
            icon={<CheckCircle size={11} strokeWidth={1.75} />}
            label="Status"
            options={statusOptions}
            selected={localStatuses}
            onToggle={(v) => toggle(localStatuses, setLocalStatuses, v)}
            onToggleAll={() =>
              setLocalStatuses(localStatuses.length === statusOptions.length ? [] : [...statusOptions])
            }
          />
        )}
      </div>

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
          <Store size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>Merchant directory</span>
          {!busy && (
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              padding: '1px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtNum(rows.length)} of {fmtNum(total)}
            </span>
          )}
          {busy ? (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>
              <div className="spinner-small" /> <span>Loading</span>
            </span>
          ) : (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              color: 'var(--positive)',
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>
              <Activity size={11} strokeWidth={1.75} /> <span>Ready</span>
            </span>
          )}
          {pageCount > 1 && (
            <div style={{
              marginLeft: 'auto',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              fontSize: 'var(--fs-label)', color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || busy}
                style={{
                  height: '28px', padding: '0 var(--space-3)',
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 500, cursor: page === 0 || busy ? 'not-allowed' : 'pointer',
                  opacity: page === 0 || busy ? 0.5 : 1,
                }}>Prev</button>
              <span>Page <strong>{page + 1}</strong> / {pageCount}</span>
              <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1 || busy}
                style={{
                  height: '28px', padding: '0 var(--space-3)',
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 500, cursor: page >= pageCount - 1 || busy ? 'not-allowed' : 'pointer',
                  opacity: page >= pageCount - 1 || busy ? 0.5 : 1,
                }}>Next</button>
            </div>
          )}
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
                {[
                  { label: 'Created',     align: 'left'  },
                  { label: 'Merchant',    align: 'left'  },
                  { label: 'Account ID',  align: 'left'  },
                  { label: 'Shortcode',   align: 'left'  },
                  { label: 'Type',        align: 'left'  },
                  { label: 'Department',  align: 'left'  },
                  { label: 'Status',      align: 'left'  },
                  { label: 'GL code',     align: 'left'  },
                  { label: 'Fee',         align: 'right' },
                ].map(c => (
                  <th key={c.label} style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: c.align as any,
                    fontSize: 'var(--fs-micro)', fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                    borderBottom: '1px solid var(--border-default)',
                    whiteSpace: 'nowrap',
                  }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {busy && rows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Loading merchant directory…</div>
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
                    No merchant matches the current filters.
                  </div>
                </td></tr>
              ) : rows.map((m: any, idx: number) => {
                const createdStr = m.CREATED_DATE
                  ? String(m.CREATED_DATE).slice(0, 10)
                  : '—'
                const feeColor = FEE_COLOR[String(m.FEE || '0%')] || 'var(--text-muted)'
                const isActive = String(m.STATUS || '').toLowerCase() === 'active'
                return (
                  <tr key={(m.MERCHANT_SHORT_CODE ?? '') + idx} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap',
                    }}>{createdStr}</td>

                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      color: 'var(--text-primary)', fontWeight: 600,
                      maxWidth: '240px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={m.MERCHANT_NAME || ''}>
                      {m.MERCHANT_NAME || '—'}
                    </td>

                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-label)',
                        color: 'var(--text-secondary)',
                      }}>{m.ACCOUNT_ID || '—'}</span>
                    </td>

                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 'var(--fs-label)', fontWeight: 600,
                        color: 'var(--text-primary)',
                      }}>{m.MERCHANT_SHORT_CODE || '—'}</span>
                    </td>

                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        background: 'var(--surface-card)',
                        border: '1px solid ' + feeColor,
                        padding: '1px var(--space-2)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: 'var(--fs-micro)', fontWeight: 600,
                        color: 'var(--text-primary)',
                      }}>
                        <span style={{
                          width: '5px', height: '5px', borderRadius: '50%',
                          background: feeColor,
                        }} />
                        {m.MERCHANT_TYPE || 'Other'}
                      </span>
                    </td>

                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}>
                      {m.DEPARTMENT || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>

                    <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        color: isActive ? 'var(--positive)' : 'var(--text-secondary)',
                        fontSize: 'var(--fs-micro)', fontWeight: 500,
                        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                      }}>
                        <span style={{
                          width: '6px', height: '6px', borderRadius: '50%',
                          background: isActive ? 'var(--positive)' : 'var(--text-muted)',
                        }} />
                        {m.STATUS || '—'}
                      </span>
                    </td>

                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 'var(--fs-label)',
                      color: 'var(--text-tertiary)',
                    }}>{m.ACCOUNT_GL_CODE || '—'}</td>

                    <td style={{
                      padding: 'var(--space-2) var(--space-4)',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: feeColor,
                    }}>{m.FEE || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ExportOverlay progress={exportProgress} />
    </DashboardLayout>
  )
}

// fee mapping helper (par segment lisible → fee)
function fee(merchantType: string): string {
  if (['Gold', 'Silver', 'Silver1', 'Silver2'].includes(merchantType)) return '2%'
  if (merchantType === 'Blue') return '1.5%'
  return '0%'
}

// ── Primitives ──

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
      <div style={{ padding: 'var(--space-5)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
        }}>
          <span style={{
            width: '7px', height: '7px', borderRadius: '50%',
            background: accent, flexShrink: 0,
          }} />
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>{label}</span>
        </div>
        <div style={{
          fontSize: '26px', fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}>{value}</div>
        {sub && (
          <div style={{
            fontSize: 'var(--fs-label)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-2)',
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
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
      }}>{label}</label>
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
      <input type="date" value={value} max={max} min={min}
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

function TextInputWithIcon({ icon, value, onChange, onEnter, placeholder, width }: {
  icon: React.ReactNode, value: string, onChange: (v: string) => void,
  onEnter?: () => void, placeholder: string, width: number,
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

type SegOption = { value: string, label: string, active: boolean, onClick: () => void }

function Segmented({ options }: { options: SegOption[] }) {
  return (
    <div style={{
      display: 'inline-flex',
      background: 'var(--surface-muted)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '3px', gap: '2px',
    }}>
      {options.map(opt => (
        <button key={opt.value} onClick={opt.onClick}
          style={{
            padding: '0 var(--space-3)', height: '30px',
            borderRadius: 'var(--radius-xs)', border: 'none',
            background: opt.active ? 'var(--surface-card)' : 'transparent',
            color: opt.active ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontWeight: opt.active ? 600 : 500,
            fontSize: 'var(--fs-label)',
            cursor: 'pointer',
          }}>{opt.label}</button>
      ))}
    </div>
  )
}

function Tagchip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      border: '1px solid var(--border-default)',
      background: 'var(--surface-muted)',
      padding: '2px var(--space-2)',
      borderRadius: 'var(--radius-xs)',
      fontWeight: 500, fontSize: 'var(--fs-micro)',
      color: 'var(--text-secondary)',
      textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
    }}>{children}</span>
  )
}

function FilterRow({
  icon, label, options, selected, onToggle, onToggleAll, renderOption,
}: {
  icon: React.ReactNode
  label: string
  options: string[]
  selected: string[]
  onToggle: (v: string) => void
  onToggleAll: () => void
  renderOption?: (v: string) => React.ReactNode
}) {
  if (options.length === 0) return null
  return (
    <div style={{
      paddingTop: 'var(--space-3)',
      borderTop: '1px solid var(--border-faint)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
      }}>
        {icon} {label}
        <button onClick={onToggleAll}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            cursor: 'pointer', padding: '0',
            textDecoration: 'underline',
          }}>
          {selected.length === options.length ? 'Clear all' : 'Select all'}
        </button>
        <span style={{ marginLeft: 'auto', fontWeight: 500, color: 'var(--text-secondary)' }}>
          {selected.length}/{options.length} selected
        </span>
      </div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px',
        maxHeight: '110px', overflowY: 'auto',
        padding: 'var(--space-1)',
      }}>
        {options.map(opt => {
          const active = selected.includes(opt)
          return (
            <button key={opt} onClick={() => onToggle(opt)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: active ? 'var(--surface-card)' : 'var(--surface-muted)',
                border: '1px solid ' + (active ? 'var(--brand)' : 'var(--border-default)'),
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                padding: '4px var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontWeight: active ? 600 : 500,
                fontSize: 'var(--fs-label)',
                cursor: 'pointer',
              }}>
              {renderOption ? renderOption(opt) : (
                <>
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%',
                    background: active ? 'var(--brand)' : 'var(--text-muted)',
                  }} />
                  {opt}
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
