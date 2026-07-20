import { useMemo, useState } from "react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useBillerAccounts } from "../hooks/useAnalytics"
import { Building, Download, Search, RefreshCw, Calendar, X } from "lucide-react"
import "../premium.css"

const isoToApiDate = (iso: string) => iso ? iso.replace(/-/g, "") : undefined

export default function BillerAccounts() {
  const [search, setSearch] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")

  const { data: accounts, isLoading, isFetching, refetch } = useBillerAccounts({
    limit: 100,
    startDate: isoToApiDate(startDate),
    endDate:   isoToApiDate(endDate),
  })

  const filtered = useMemo(() => {
    if (!accounts) return []
    const q = search.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter((a: any) =>
      [a.BILLER_NAME, a.ACCOUNT_ID, a.BILLER_SHORT_CODE, a.IDENTITY_ID, a.DEPARTMENT, a.BILLER_TYPE, a.ACCOUNT_GL_CODE]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    )
  }, [accounts, search])

  const resetFilters = () => { setSearch(""); setStartDate(""); setEndDate("") }
  const hasFilter = search.trim() || startDate || endDate
  const totalLoaded = accounts?.length ?? 0
  const totalShown  = filtered.length

  return (
    <DashboardLayout>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Biller Account Directory</h1>
          <p className="page-subtitle">Organizational partner registry for utility products and services.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => refetch()} disabled={isFetching} className="nav-action-btn" style={{ background: 'white', color: 'var(--mc-text-main)', border: '1px solid var(--mc-border)', width: 'auto', padding: '0 20px', gap: '8px', opacity: isFetching ? 0.6 : 1 }}>
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} /> Refresh Directory
          </button>
          <button className="nav-action-btn" style={{ background: 'var(--mc-red)', color: 'white', border: 'none', width: 'auto', padding: '0 20px', gap: '8px' }}>
            <Download size={16} /> Export Detailed List (CSV)
          </button>
        </div>
      </div>

      <div style={{
        background: 'white',
        padding: '20px 24px',
        borderRadius: '16px',
        border: '1px solid var(--mc-border)',
        marginTop: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: 'var(--mc-shadow)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'rgba(227, 27, 35, 0.08)', padding: '10px', borderRadius: '12px' }}>
            <Building size={20} color="var(--mc-red)" />
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--mc-red)', letterSpacing: '0.05em' }}>Biller Repository</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>Organizational Profiles</span>
          </div>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {isLoading ? "…" : `${totalShown} shown / ${totalLoaded} loaded`}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <div className="search-container" style={{ flex: '1 1 300px', minWidth: '260px', marginBottom: 0, height: '42px' }}>
            <Search size={18} color="#94a3b8" />
            <input
              type="text"
              className="search-input"
              placeholder="Search by name, ID, shortcode, department..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 6px', color: '#94a3b8', display: 'flex' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid var(--mc-border)', borderRadius: '10px', padding: '4px 10px', height: '42px', background: '#f8fafc' }}>
            <Calendar size={14} color="#64748b" />
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Registered</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ border: 'none', background: 'transparent', fontSize: '12px', fontWeight: 600, color: '#0f172a', outline: 'none', fontFamily: 'inherit' }}
            />
            <span style={{ color: '#94a3b8', fontSize: '12px' }}>→</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ border: 'none', background: 'transparent', fontSize: '12px', fontWeight: 600, color: '#0f172a', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>

          {hasFilter && (
            <button
              type="button"
              onClick={resetFilters}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: 'white', border: '1px solid var(--mc-border)',
                color: '#64748b', fontSize: '12px', fontWeight: 700,
                height: '42px', padding: '0 14px', borderRadius: '10px',
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.03em',
              }}
            >
              <X size={14} /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="table-card animate-fade-in" style={{ marginTop: '24px' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--mc-border)', background: '#f8fafc' }}>
           <h3 style={{ fontSize: '13px', fontWeight: 800, margin: 0, textTransform: 'uppercase', color: '#64748b' }}>
             Registered Biller Partners{hasFilter ? ` · filtered (${totalShown})` : ` (Top ${totalLoaded || 100})`}
           </h3>
        </div>
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table className="mc-table" style={{ minWidth: '1300px' }}>
            <thead>
              <tr>
                <th style={{ width: '120px' }}>DATE CODE</th>
                <th style={{ width: '250px' }}>BILLER NAME</th>
                <th style={{ width: '180px' }}>ACCOUNT ID / MSISDN</th>
                <th style={{ width: '140px' }}>SHORTCODE</th>
                <th style={{ width: '150px' }}>IDENTITY ID</th>
                <th style={{ width: '160px' }}>DEPARTMENT</th>
                <th style={{ width: '180px' }}>BILLER TYPE</th>
                <th style={{ width: '140px' }}>GL CODE</th>
                <th style={{ width: '120px', textAlign: 'right' }}>FEE RATE</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '100px', color: '#94a3b8' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                    <div className="spinner"></div>
                    Retrieving global biller base...
                  </div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '100px', color: '#94a3b8' }}>
                  {hasFilter
                    ? `No biller matches the current filters${search ? ` for "${search}"` : ""}.`
                    : "No biller accounts found."}
                </td></tr>
              ) : filtered.map((a: any, idx: number) => (
                <tr key={idx}>
                  <td style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>{a.DATE_CODE}</td>
                  <td style={{ fontWeight: 800 }}>{a.BILLER_NAME}</td>
                  <td style={{ color: 'var(--mc-text-sub)', fontSize: '12px', fontWeight: 600 }}>{a.ACCOUNT_ID}</td>
                  <td style={{ fontWeight: 700, fontSize: '11px' }}>{a.BILLER_SHORT_CODE}</td>
                  <td style={{ fontSize: '11px', color: '#94a3b8' }}>{a.IDENTITY_ID}</td>
                  <td style={{ fontSize: '12px', fontWeight: 600 }}>{a.DEPARTMENT}</td>
                  <td><span className="badge badge-blue" style={{ fontSize: '10px' }}>{a.BILLER_TYPE}</span></td>
                  <td><code style={{ fontSize: '11px', color: '#64748b' }}>{a.ACCOUNT_GL_CODE}</code></td>
                  <td style={{ textAlign: 'right', fontWeight: 900, color: 'var(--mc-red)' }}>{a.FEE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}
