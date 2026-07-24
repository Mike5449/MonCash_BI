import { useState, useMemo } from "react"
import {
  Calendar, RefreshCw, Download, Search, XCircle, MapPin, X, Activity
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useAgentOtc } from "../hooks/useAnalytics"
import { triggerNativeDownload } from "../utils/exportXlsx"
import "../premium.css"

const fmtHTG = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMoney = (v: any) => {
  const n = Number(v ?? 0)
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + ' M'
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + ' K'
  return n.toFixed(0)
}
const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const todayMinus30 = () => {
  const d = new Date(); d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}
const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

/** Convertit "yyyy-MM-dd" → "yyyyMMdd" */
const toYyyyMMdd = (s: string) => (s || "").replace(/-/g, "")
/** Convertit "yyyyMMdd" → "yyyy-MM-dd" */
const fromYyyyMMdd = (s: string) => {
  if (!s || s.length !== 8) return ""
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

export default function AgentOtc() {
  // Filtres "locaux" (en édition)
  const [localStart, setLocalStart] = useState<string>(todayMinus30())
  const [localEnd, setLocalEnd]     = useState<string>(todayMinus1())
  // DATE_CODE manuel — pour la snapshot du profil agent (yyyyMMdd)
  const [localDateCode, setLocalDateCode] = useState<string>("")  // vide = défaut backend (MAX)
  const [useDefaultDateCode, setUseDefaultDateCode] = useState<boolean>(true)

  // Filtres "submitted" (déclenchent le fetch)
  const [start, setStart] = useState<string>(todayMinus30())
  const [end, setEnd]     = useState<string>(todayMinus1())
  const [dateCode, setDateCode] = useState<string>("")
  const [search, setSearch] = useState("")

  const { data, isLoading, isFetching, refetch } = useAgentOtc({
    startDate: start, endDate: end,
    dateCode: dateCode || undefined,
  })
  const busy = isLoading || isFetching
  const rows: any[] = (data as any[]) ?? []

  const apply = () => {
    setStart(localStart); setEnd(localEnd)
    setDateCode(useDefaultDateCode ? "" : toYyyyMMdd(localDateCode))
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r: any) =>
      String(r.AGENT_MSISDN ?? '').toLowerCase().includes(s) ||
      String(r.AGENT_NAME ?? '').toLowerCase().includes(s) ||
      String(r.AGENT_ADRESS ?? '').toLowerCase().includes(s)
    )
  }, [rows, search])

  const totals = useMemo(() => {
    let total = 0
    let volume = 0
    for (const r of rows) {
      total += Number(r.TR_VALUE ?? 0)
      volume += Number(r.VOLUME_ ?? r.volume_ ?? 0)
    }
    return { agentsCount: rows.length, totalValue: total, volume }
  }, [rows])

  const handleExportCsv = () => {
    const params: Record<string, string> = { start_date: start, end_date: end }
    if (dateCode) params.date_code = dateCode
    triggerNativeDownload(
      '/customers/agent-otc/export.csv',
      params,
      `Agent_OTC_${start}_to_${end}.csv`,
    )
  }

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
            Tools · Agent OTC · Business tool
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Agent OTC
          </h1>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
            Volume of <strong style={{ fontWeight: 600 }}>Cash In OTC</strong> / <strong style={{ fontWeight: 600 }}>Agent Payment to Agent</strong> transactions per agent, joined to agent profile snapshot.
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
          <button onClick={handleExportCsv} disabled={busy || rows.length === 0}
            style={{
              background: (busy || rows.length === 0) ? 'var(--surface-muted)' : 'var(--positive)',
              color: (busy || rows.length === 0) ? 'var(--text-muted)' : 'white',
              border: '1px solid ' + ((busy || rows.length === 0) ? 'var(--border-default)' : 'var(--positive)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: (busy || rows.length === 0) ? 'not-allowed' : 'pointer',
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

        {/* Vertical divider */}
        <div style={{
          width: '1px',
          alignSelf: 'stretch',
          background: 'var(--border-default)',
          margin: '0 var(--space-2)',
        }} />

        {/* Snapshot DATE_CODE — toggle + optional date */}
        <Field label="Snapshot date_code">
          <div style={{
            display: 'inline-flex',
            background: 'var(--surface-muted)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '3px',
            gap: '2px',
          }}>
            <button
              onClick={() => setUseDefaultDateCode(true)}
              style={{
                padding: '0 var(--space-3)', height: '30px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: useDefaultDateCode ? 'var(--surface-card)' : 'transparent',
                color: useDefaultDateCode ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontWeight: useDefaultDateCode ? 600 : 500,
                fontSize: 'var(--fs-label)',
                cursor: 'pointer',
                boxShadow: useDefaultDateCode ? '0 0 0 1px var(--border-default) inset' : 'none',
              }}>
              Auto (latest)
            </button>
            <button
              onClick={() => setUseDefaultDateCode(false)}
              style={{
                padding: '0 var(--space-3)', height: '30px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: !useDefaultDateCode ? 'var(--surface-card)' : 'transparent',
                color: !useDefaultDateCode ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontWeight: !useDefaultDateCode ? 600 : 500,
                fontSize: 'var(--fs-label)',
                cursor: 'pointer',
                boxShadow: !useDefaultDateCode ? '0 0 0 1px var(--border-default) inset' : 'none',
              }}>
              Custom
            </button>
          </div>
        </Field>

        {!useDefaultDateCode && (
          <Field label="Snapshot date">
            <DateInput
              value={fromYyyyMMdd(localDateCode) || ""}
              max={todayMinus1()}
              onChange={(v) => setLocalDateCode(toYyyyMMdd(v))}
            />
          </Field>
        )}

        <div style={{ paddingBottom: '0' }}>
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
              opacity: busy ? 0.4 : 1,
            }}>
            <Search size={13} strokeWidth={1.75} /> Search
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
          {dateCode && (
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
            }}>Snapshot {fromYyyyMMdd(dateCode)}</span>
          )}
        </div>
      </div>

      {/* ── KPI STRIP ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-4)',
      }}>
        <KpiCard label="Agents"               value={fmtNum(totals.agentsCount)}     accent="var(--data-subs)"    sub="agents with ≥1 OTC tx" />
        <KpiCard label="Volume"               value={fmtNum(totals.volume)}          accent="var(--data-volume)"  sub="distinct transactions" />
        <KpiCard label="Total TR value (HTG)" value={fmtMoney(totals.totalValue)}    accent="var(--data-value)"   sub="sum of amounts" />
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
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>Agents</span>
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
            <span
              title="Only the top 100 agents by transaction value are shown here. Use Export to download the full list."
              style={{
                fontSize: 'var(--fs-micro)', fontWeight: 600,
                color: 'var(--brand)',
                background: 'var(--brand-soft)',
                border: '1px solid var(--brand-border)',
                padding: '1px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-uppercase)',
              }}
            >Top 100 · export for all</span>
          </div>
          {busy && rows.length === 0 ? null : (
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
              placeholder="Filter agent MSISDN, name, address…"
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

        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%', minWidth: '1100px',
            borderCollapse: 'collapse',
            fontSize: 'var(--fs-body)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <thead style={{ background: 'var(--surface-muted)' }}>
              <tr>
                {[
                  { label: 'Agent MSISDN',  align: 'left'  },
                  { label: 'Agent name',    align: 'left'  },
                  { label: 'TR value (HTG)', align: 'right' },
                  { label: 'Volume',        align: 'right' },
                  { label: 'Agent address', align: 'left'  },
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
                <tr><td colSpan={5} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>Loading Agent OTC…</div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <XCircle size={24} strokeWidth={1.5} opacity={0.4} />
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
                    {rows.length === 0 ? "No agent with OTC transaction in this period." : "No results match the filter."}
                  </div>
                </td></tr>
              ) : filtered.map((r: any, idx: number) => (
                <tr key={(r.AGENT_MSISDN ?? '') + idx} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                  <td style={{ padding: 'var(--space-2) var(--space-4)' }}>
                    <span style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 'var(--fs-body)', fontWeight: 500,
                      color: 'var(--text-primary)',
                    }}>{r.AGENT_MSISDN}</span>
                  </td>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    color: 'var(--text-primary)', fontWeight: 500,
                  }}>
                    {r.AGENT_NAME || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: 'right',
                    color: 'var(--text-primary)', fontWeight: 600,
                  }}>
                    {fmtHTG(r.TR_VALUE)}
                  </td>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    textAlign: 'right',
                    color: 'var(--text-secondary)', fontWeight: 500,
                  }}>
                    {fmtNum(r.VOLUME_ ?? r.volume_)}
                  </td>
                  <td style={{
                    padding: 'var(--space-2) var(--space-4)',
                    color: 'var(--text-secondary)',
                  }}>
                    {r.AGENT_ADRESS
                      ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <MapPin size={11} strokeWidth={1.75} color="var(--text-tertiary)" /> {r.AGENT_ADRESS}
                        </span>
                      )
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                </tr>
              ))}
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
              <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtNum(rows.length)}</strong> agents · Total TR value: <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmtHTG(totals.totalValue)} HTG</strong>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

// ── Cards & primitives ──

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
