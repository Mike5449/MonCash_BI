import { useMemo, useState } from "react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { usePrefundedAccounts } from "../hooks/useAnalytics"
import { Banknote, Download, Search, RefreshCw, Calendar, X, Activity } from "lucide-react"
import "../premium.css"

const isoToApiDate = (iso: string) => iso ? iso.replace(/-/g, "") : undefined
const fmtNum = (n: number) => new Intl.NumberFormat("en-US").format(n)

export default function PrefundedAccounts() {
  const [search, setSearch] = useState("")
  const [localStart, setLocalStart] = useState("")
  const [localEnd,   setLocalEnd]   = useState("")

  const { data: accounts, isLoading, isFetching, refetch } = usePrefundedAccounts({
    limit: 100,
    startDate: isoToApiDate(localStart),
    endDate:   isoToApiDate(localEnd),
  })

  const rows = accounts ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((a: any) =>
      [a.PREFUNDED_NAME, a.ACCOUNT_ID, a.PREFUNDED_SHORT_CODE, a.IDENTITY_ID, a.DEPARTMENT, a.PRODUCTS, a.ACCOUNT_GL_CODE]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    )
  }, [rows, search])

  const clearFilters = () => { setLocalStart(""); setLocalEnd(""); setSearch("") }
  const hasPeriod = Boolean(localStart || localEnd)
  const busy = isLoading || isFetching

  return (
    <DashboardLayout>
      {/* ── PAGE HEADER ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-5)',
      }}>
        <div>
          <div style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            marginBottom: 'var(--space-1)',
          }}>
            B2B · Prefunded · Partner directory
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Prefunded Accounts
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
          }}>
            Organizational partner directory for settlements and managed nodes — one row per unique partner shortcode.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
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
          <button title="Export"
            style={{
              background: 'var(--positive)', color: 'white',
              border: '1px solid var(--positive)',
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            <Download size={13} strokeWidth={1.75} /> Export CSV
          </button>
        </div>
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
        <Field label="Registered from">
          <DateInput value={localStart} max={localEnd || undefined}
            onChange={setLocalStart} />
        </Field>
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-tertiary)', paddingBottom: '10px' }}>→</div>
        <Field label="Registered to">
          <DateInput value={localEnd} min={localStart || undefined}
            onChange={setLocalEnd} />
        </Field>

        <div style={{ paddingBottom: '0', display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={clearFilters} disabled={!hasPeriod && !search}
            style={{
              background: 'var(--surface-card)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
              height: '38px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: (!hasPeriod && !search) ? 'not-allowed' : 'pointer',
              opacity: (!hasPeriod && !search) ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            <X size={13} strokeWidth={1.75} /> Clear
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
          <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)' }}>
            {hasPeriod
              ? <>{localStart || '…'} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>→</span> {localEnd || '…'}</>
              : <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>Latest snapshot</span>
            }
          </span>
        </div>
      </div>

      {/* ── TABLE CARD ── */}
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
            <Banknote size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>Registered partners</span>
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
              placeholder="Filter by name, ID, shortcode, department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                border: 'none', background: 'transparent', outline: 'none',
                height: '34px',
                paddingLeft: 'var(--space-8)', paddingRight: search ? 'var(--space-6)' : 'var(--space-3)',
                fontSize: 'var(--fs-body)', fontWeight: 500,
                width: '320px',
                color: 'var(--text-primary)',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} title="Clear search"
                style={{
                  position: 'absolute', right: 'var(--space-2)',
                  background: 'transparent', border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer', padding: '2px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 'var(--radius-xs)',
                }}>
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ background: 'var(--surface-muted)' }}>
                <Th w={110}>Date code</Th>
                <Th w={260}>Partner name</Th>
                <Th w={170}>Account ID</Th>
                <Th w={130}>Shortcode</Th>
                <Th w={140}>Identity ID</Th>
                <Th w={150}>Department</Th>
                <Th w={170}>Products</Th>
                <Th w={130}>GL code</Th>
                <Th w={110} align="right">Fee rate</Th>
              </tr>
            </thead>
            <tbody>
              {busy ? (
                <tr>
                  <td colSpan={9} style={{ padding: 'var(--space-8) var(--space-4)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 500 }}>Retrieving partner directory…</div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 'var(--space-8) var(--space-4)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-body)' }}>
                    {(search || hasPeriod)
                      ? <>No partner matches the current filters{search && <> for <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>"{search}"</span></>}.</>
                      : "No prefunded accounts found."}
                  </td>
                </tr>
              ) : filtered.map((a: any, idx: number) => (
                <tr key={idx} style={{ borderTop: '1px solid var(--border-faint)' }}>
                  <Td muted mono>{a.DATE_CODE}</Td>
                  <Td strong>{a.PREFUNDED_NAME}</Td>
                  <Td mono>{a.ACCOUNT_ID}</Td>
                  <Td mono>{a.PREFUNDED_SHORT_CODE}</Td>
                  <Td muted mono>{a.IDENTITY_ID}</Td>
                  <Td>{a.DEPARTMENT}</Td>
                  <Td muted>{a.PRODUCTS}</Td>
                  <Td muted mono>{a.ACCOUNT_GL_CODE}</Td>
                  <Td align="right" strong>{a.FEE}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
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

function Th({ children, w, align }: { children: React.ReactNode, w?: number, align?: "left" | "right" }) {
  return (
    <th style={{
      width: w ? `${w}px` : undefined,
      padding: 'var(--space-3) var(--space-4)',
      textAlign: align || 'left',
      fontSize: 'var(--fs-micro)', fontWeight: 600,
      color: 'var(--text-tertiary)',
      textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
      borderBottom: '1px solid var(--border-default)',
      whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({ children, muted, mono, strong, align }: { children: React.ReactNode, muted?: boolean, mono?: boolean, strong?: boolean, align?: "left" | "right" }) {
  return (
    <td style={{
      padding: 'var(--space-3) var(--space-4)',
      textAlign: align || 'left',
      fontSize: 'var(--fs-body)',
      fontWeight: strong ? 600 : 400,
      color: muted ? 'var(--text-tertiary)' : 'var(--text-primary)',
      fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    }}>{children ?? '—'}</td>
  )
}
