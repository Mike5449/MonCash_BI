import { useState } from "react"
import { RefreshCw, Search, Calendar } from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { usePeriodChannelMatrix, usePeriodRegulatoryReport } from "../hooks/useAnalytics"
import type {
  ChannelCategoryMatrix,
  RegulatoryReport,
} from "../api/services/PeriodReportService"
import "../premium.css"

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}
const minusDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}
const fmtNum = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })

type Preset = '7' | '30' | '60' | '90' | 'custom'

// Report tabs — AR001 = regulatory quarterly report, OS001 = channel × category matrix.
type ReportTab = 'AR001' | 'OS001'
const REPORT_TABS: { id: ReportTab; label: string; sub: string }[] = [
  { id: 'AR001', label: 'AR001', sub: 'Rapport trimestriel' },
  { id: 'OS001', label: 'OS001', sub: 'Canal × type d\'opération' },
]

export default function PeriodReport() {
  const [activeTab, setActiveTab] = useState<ReportTab>('AR001')
  // ── Local editing state ──
  const [preset, setPreset] = useState<Preset>('30')
  const [localStart, setLocalStart] = useState<string>(minusDays(30))
  const [localEnd,   setLocalEnd]   = useState<string>(todayMinus1())

  // ── Applied state ──
  const [start, setStart] = useState<string>(minusDays(30))
  const [end,   setEnd]   = useState<string>(todayMinus1())

  const apply = () => { setStart(localStart); setEnd(localEnd) }
  const setQuick = (n: 7 | 30 | 60 | 90) => {
    const p = String(n) as Preset
    setPreset(p)
    const s = minusDays(n), e = todayMinus1()
    setLocalStart(s); setLocalEnd(e)
    setStart(s); setEnd(e)
  }

  // Point-in-time reference for the regulatory report = the picker's end date.
  const { data: regulatoryData, isFetching: isRegFetching, refetch } =
    usePeriodRegulatoryReport({ referenceDate: end })
  const { data: matrixData, isFetching: isMatrixFetching } = usePeriodChannelMatrix({
    startDate: start, endDate: end,
  })

  const regulatory = regulatoryData as RegulatoryReport | undefined
  const matrix = matrixData as ChannelCategoryMatrix | undefined
  const busy = isRegFetching
  const busyMatrix = isMatrixFetching

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
            Tools · Custom Period Report
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            Period Report
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
            maxWidth: '720px',
          }}>
            Customer accounts (registered / active / dormant by gender) · Merchants (registered / active / dormant)
            · Total Volume & Value over the chosen window.
          </p>
        </div>
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
      </div>

      {/* ── FILTER PANEL ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-6)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap',
        gap: 'var(--space-5)',
        marginBottom: 'var(--space-4)',
      }}>
        <Field label="From">
          <DateInput value={localStart} max={localEnd || todayMinus1()}
            onChange={(v) => { setLocalStart(v); setPreset('custom') }} />
        </Field>
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-tertiary)', paddingBottom: '10px', fontWeight: 400 }}>→</div>
        <Field label="To">
          <DateInput value={localEnd} max={todayMinus1()}
            onChange={(v) => { setLocalEnd(v); setPreset('custom') }} />
        </Field>

        <Field label="Quick range">
          <Segmented options={([7, 30, 60, 90] as const).map(n => ({
            value: String(n),
            label: `${n}d`,
            active: preset === String(n),
            onClick: () => setQuick(n),
          }))} />
        </Field>

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
            {start} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>→</span> {end}
          </span>
        </div>
      </div>

      {/* ── REPORT TABS (AR001 / OS001) ── */}
      <div
        role="tablist"
        aria-label="Report"
        style={{
          display: 'inline-flex',
          background: 'var(--surface-muted)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: '4px',
          gap: '2px',
          marginBottom: 'var(--space-4)',
        }}
      >
        {REPORT_TABS.map((t) => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(t.id)}
              style={{
                display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start',
                gap: '2px',
                padding: '6px var(--space-4)',
                border: 'none',
                borderRadius: 'var(--radius-xs)',
                background: active ? 'var(--surface-card)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                boxShadow: active ? '0 0 0 1px var(--border-default) inset' : 'none',
                cursor: 'pointer',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              <span style={{
                fontSize: 'var(--fs-body)', fontWeight: active ? 700 : 600,
                letterSpacing: 'var(--tracking-tight)',
              }}>
                {t.label}
              </span>
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: active ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-uppercase)',
              }}>
                {t.sub}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── ACTIVE TAB CONTENT ── */}
      {activeTab === 'AR001' && (
        <RegulatorySection report={regulatory} loading={busy} referenceDate={end} />
      )}
      {activeTab === 'OS001' && (
        <ChannelMatrixSection
          matrix={matrix}
          loading={busyMatrix}
          period={{ start, end }}
        />
      )}
    </DashboardLayout>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Channel × Category matrix section — reproduces the compliance report layout
// ──────────────────────────────────────────────────────────────────────────────

const fmtDec = (v: number) =>
  Number(v ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

function ChannelMatrixSection({
  matrix, loading, period,
}: {
  matrix: ChannelCategoryMatrix | undefined
  loading: boolean
  period: { start: string, end: string }
}) {
  const categories = matrix?.categories || []
  const rows = matrix?.rows || []
  const colTotals = matrix?.col_totals || {}

  return (
    <section style={{ marginBottom: 'var(--space-6)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 'var(--space-4)', flexWrap: 'wrap',
        marginBottom: 'var(--space-4)',
      }}>
        <div>
          <div style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
            marginBottom: 'var(--space-1)',
          }}>
            Compliance report · Channel × Category
          </div>
          <h2 style={{
            margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 600,
            color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)',
          }}>
            Rapport par canal × type d'opération
          </h2>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-label)', color: 'var(--text-secondary)',
            maxWidth: '780px',
          }}>
            Volume + valeur des transactions ventilés par canal
            (Mobile = USSD_Digicel · En ligne = API + APP + QR)
            et par type d'opération. Période : {period.start} → {period.end}.
          </p>
        </div>
      </div>

      {/* Table card */}
      <div style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{
            width: '100%', minWidth: '1100px',
            borderCollapse: 'collapse',
            fontSize: 'var(--fs-label)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <colgroup>
              <col />
              {categories.map((c) => (
                <>
                  <col key={`${c.id}-vol`} />
                  <col key={`${c.id}-val`} />
                </>
              ))}
            </colgroup>

            {/* Two-row header : category group span + volume/value sub-cols */}
            <thead>
              <tr style={{ background: 'var(--surface-muted)' }}>
                <th rowSpan={2} style={thTitleStyle}>
                  Type d'opération
                </th>
                {categories.map((c) => {
                  const isTotal = c.id === 'total'
                  return (
                    <th key={c.id} colSpan={2} style={{
                      ...thGroupStyle,
                      background: isTotal ? 'var(--surface-card)' : 'var(--surface-muted)',
                      color: isTotal ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: isTotal ? 700 : 600,
                    }}>
                      {c.label}
                    </th>
                  )
                })}
              </tr>
              <tr style={{ background: 'var(--surface-muted)' }}>
                {categories.map((c) => {
                  const isTotal = c.id === 'total'
                  return (
                    <>
                      <th key={`${c.id}-h-vol`} style={{
                        ...thSubStyle,
                        background: isTotal ? 'var(--surface-card)' : 'var(--surface-muted)',
                      }}>En volume</th>
                      <th key={`${c.id}-h-val`} style={{
                        ...thSubStyle,
                        background: isTotal ? 'var(--surface-card)' : 'var(--surface-muted)',
                      }}>En valeur</th>
                    </>
                  )
                })}
              </tr>
            </thead>

            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={1 + categories.length * 2} style={emptyRowStyle}>
                    <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                    Chargement de la matrice…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={1 + categories.length * 2} style={emptyRowStyle}>
                    Aucune donnée pour la période sélectionnée.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                    <td style={rowLabelStyle} title={r.tr_types.join(', ')}>
                      {r.label}
                      {r.tr_types.length > 0 && (
                        <span style={{
                          display: 'block', marginTop: '2px',
                          fontSize: '10px', color: 'var(--text-tertiary)',
                          fontWeight: 400, fontFamily: 'monospace',
                        }}>
                          {r.tr_types.join(' + ')}
                        </span>
                      )}
                    </td>
                    {categories.map((c) => {
                      const cell = r.cells[c.id] || { volume: 0, value: 0 }
                      const isTotal = c.id === 'total'
                      return (
                        <>
                          <td key={`${r.id}-${c.id}-vol`} style={{
                            ...numCellStyle,
                            background: isTotal ? 'rgba(0,0,0,0.02)' : 'transparent',
                            fontWeight: isTotal ? 700 : 500,
                          }}>
                            {cell.volume > 0 ? fmtDec(cell.volume) : <Dash />}
                          </td>
                          <td key={`${r.id}-${c.id}-val`} style={{
                            ...numCellStyle,
                            background: isTotal ? 'rgba(0,0,0,0.02)' : 'transparent',
                            fontWeight: isTotal ? 700 : 500,
                            borderRight: '1px solid var(--border-faint)',
                          }}>
                            {cell.value > 0 ? fmtDec(cell.value) : <Dash />}
                          </td>
                        </>
                      )
                    })}
                  </tr>
                ))
              )}

              {/* Column-totals row */}
              {rows.length > 0 && (
                <tr style={{ background: 'var(--surface-muted)' }}>
                  <td style={{
                    ...rowLabelStyle,
                    borderTop: '2px solid var(--text-primary)',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-uppercase)',
                    fontSize: 'var(--fs-micro)',
                  }}>
                    Total général
                  </td>
                  {categories.map((c) => {
                    const cell = colTotals[c.id] || { volume: 0, value: 0 }
                    const isTotal = c.id === 'total'
                    return (
                      <>
                        <td key={`tot-${c.id}-vol`} style={{
                          ...numCellStyle,
                          background: isTotal ? 'var(--surface-card)' : 'var(--surface-muted)',
                          borderTop: '2px solid var(--text-primary)',
                          fontWeight: 800,
                          color: 'var(--text-primary)',
                        }}>
                          {cell.volume > 0 ? fmtDec(cell.volume) : <Dash />}
                        </td>
                        <td key={`tot-${c.id}-val`} style={{
                          ...numCellStyle,
                          background: isTotal ? 'var(--surface-card)' : 'var(--surface-muted)',
                          borderTop: '2px solid var(--text-primary)',
                          borderRight: '1px solid var(--border-faint)',
                          fontWeight: 800,
                          color: 'var(--text-primary)',
                        }}>
                          {cell.value > 0 ? fmtDec(cell.value) : <Dash />}
                        </td>
                      </>
                    )
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

const thTitleStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: 'var(--space-3) var(--space-4)',
  fontSize: 'var(--fs-micro)', fontWeight: 700,
  color: 'var(--text-primary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
  borderRight: '1px solid var(--border-default)',
  borderBottom: '1px solid var(--border-default)',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
  minWidth: '260px',
}

const thGroupStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: 'var(--fs-micro)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
  borderBottom: '1px solid var(--border-default)',
  borderRight: '1px solid var(--border-default)',
  whiteSpace: 'nowrap',
}

const thSubStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: '10px', fontWeight: 600,
  color: 'var(--text-tertiary)',
  textTransform: 'none',
  borderBottom: '1px solid var(--border-default)',
  whiteSpace: 'nowrap',
  minWidth: '120px',
}

const rowLabelStyle: React.CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  color: 'var(--text-primary)', fontWeight: 500,
  borderRight: '1px solid var(--border-default)',
  whiteSpace: 'nowrap',
  background: 'var(--surface-card)',
}

const numCellStyle: React.CSSProperties = {
  padding: 'var(--space-3) var(--space-3)',
  textAlign: 'right',
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
}

const emptyRowStyle: React.CSSProperties = {
  padding: 'var(--space-16) 0',
  textAlign: 'center',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--fs-body)',
}

function Dash() {
  return <span style={{ color: 'var(--text-muted)' }}>—</span>
}

// ──────────────────────────────────────────────────────────────────────────────
// Regulatory report section — single-column table (Trimestre courant)
// ──────────────────────────────────────────────────────────────────────────────

type RegRow =
  | { kind: 'header';  label: string }
  | { kind: 'gender';  label: string; homme: number | null; femme: number | null }
  | { kind: 'single';  label: string; value: number | null; footer?: boolean }

function RegulatorySection({
  report, loading, referenceDate,
}: {
  report: RegulatoryReport | undefined
  loading: boolean
  referenceDate: string
}) {
  // Build the rows in display order — pulls from `report` or renders nulls if
  // the row isn't populated yet.
  const rows: RegRow[] = [
    { kind: 'gender', label: "Nombre de Clients GSM",
      homme: report?.clients?.homme ?? null,
      femme: report?.clients?.femme ?? null },
    { kind: 'gender', label: "Nombre de comptes de fonds de paiement électronique enregistrés",
      homme: report?.accounts_registered?.homme ?? null,
      femme: report?.accounts_registered?.femme ?? null },
    { kind: 'gender', label: "Nombre de comptes de fonds de paiement électronique actifs (au moins une transaction au cours des 90 derniers jours)",
      homme: report?.accounts_active_90d?.homme ?? null,
      femme: report?.accounts_active_90d?.femme ?? null },
    { kind: 'gender', label: "Nombre de comptes de fonds de paiement électronique dormants (aucune transaction au cours des 90 derniers jours)",
      homme: report?.accounts_dormant_90d?.homme ?? null,
      femme: report?.accounts_dormant_90d?.femme ?? null },

    { kind: 'single', label: "Nombre d'agents enregistrés",
      value: report?.agents_registered ?? null },
    { kind: 'single', label: "Nombre d'agents actifs (au moins une transaction au cours des 90 derniers jours)",
      value: report?.agents_active_90d ?? null },
    { kind: 'single', label: "Nombre d'agents dormants (aucune transaction au cours des 90 derniers jours)",
      value: report?.agents_dormant_90d ?? null },

    { kind: 'single', label: "Nombre de commerçants affiliés enregistrés",
      value: report?.merchants_registered ?? null },
    { kind: 'single', label: "Nombre de commerçants affiliés actifs",
      value: report?.merchants_active_90d ?? null },
    { kind: 'single', label: "Nombre de commerçants affiliés dormants",
      value: report?.merchants_dormant_90d ?? null },

    { kind: 'single', label: "Nombre total de transactions",
      value: report?.transactions_volume ?? null, footer: true },
    { kind: 'single', label: "Valeur totale des transactions (en milliers de gourdes)",
      value: report?.transactions_value_thousands ?? null, footer: true },
  ]

  return (
    <section style={{ marginBottom: 'var(--space-6)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 'var(--space-4)', flexWrap: 'wrap',
        marginBottom: 'var(--space-4)',
      }}>
        <div>
          <div style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
            marginBottom: 'var(--space-1)',
          }}>
            Compliance report · Point-in-time snapshot
          </div>
          <h2 style={{
            margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 600,
            color: 'var(--text-primary)', letterSpacing: 'var(--tracking-tight)',
          }}>
            Rapport trimestriel — Trimestre courant
          </h2>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-label)', color: 'var(--text-secondary)',
          }}>
            Snapshot au <strong style={{ color: 'var(--text-primary)' }}>{referenceDate}</strong>.
            {loading && <span style={{ marginLeft: 'var(--space-2)', color: 'var(--text-tertiary)' }}>Chargement…</span>}
          </p>
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 'var(--fs-label)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <colgroup>
              <col style={{ width: '55%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '30%' }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'var(--surface-muted)' }}>
                <th style={regThLabel} />
                <th style={regThLabel} />
                <th style={regThValue}>Trimestre courant</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => renderRow(r, i, loading, i % 2 === 1))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

/** Subtle zebra background — kept very light so gender-split rows still read as one band. */
const ZEBRA_BG = 'rgba(15, 23, 42, 0.035)'  // ~ subtle slate tint

function renderRow(r: RegRow, i: number, loading: boolean, even: boolean) {
  const fmtCell = (n: number | null) => {
    if (loading && n === null) return <span style={{ color: 'var(--text-muted)' }}>…</span>
    if (n === null || n === undefined) return <span style={{ color: 'var(--text-muted)' }}>—</span>
    return fmtNum(n)
  }

  // Zebra background override — footer rows keep their strong muted look.
  const rowBg = r.kind !== 'single' || !r.footer
    ? (even ? ZEBRA_BG : 'var(--surface-card)')
    : 'var(--surface-muted)'

  if (r.kind === 'gender') {
    return (
      <>
        <tr key={`${i}-h`} style={{ borderTop: '1px solid var(--border-faint)' }}>
          <td rowSpan={2} style={{ ...regTdLabel, background: rowBg }}>{r.label}</td>
          <td style={{ ...regTdSubLabel, background: rowBg }}>Homme</td>
          <td style={{ ...regTdValue, background: rowBg }}>{fmtCell(r.homme)}</td>
        </tr>
        <tr key={`${i}-f`}>
          <td style={{ ...regTdSubLabel, background: rowBg }}>Femme</td>
          <td style={{ ...regTdValue, background: rowBg }}>{fmtCell(r.femme)}</td>
        </tr>
      </>
    )
  }
  // Single-row (no gender split)
  const footerExtra: React.CSSProperties = r.footer ? {
    fontWeight: 700,
    borderTop: '2px solid var(--border-default)',
  } : {}
  return (
    <tr key={i} style={{ borderTop: '1px solid var(--border-faint)', ...footerExtra }}>
      <td colSpan={2} style={{ ...regTdLabel, background: rowBg }}>{r.label}</td>
      <td style={{ ...regTdValue, background: rowBg }}>{fmtCell(r.value)}</td>
    </tr>
  )
}

const regThLabel: React.CSSProperties = {
  textAlign: 'left',
  padding: 'var(--space-3) var(--space-4)',
  fontSize: 'var(--fs-micro)', fontWeight: 700,
  color: 'var(--text-primary)',
  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
  borderBottom: '1px solid var(--border-default)',
  borderRight: '1px solid var(--border-default)',
  whiteSpace: 'nowrap',
}

const regThValue: React.CSSProperties = {
  ...regThLabel,
  textAlign: 'right',
  borderRight: 'none',
  background: 'var(--surface-card)',
}

const regTdLabel: React.CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  color: 'var(--text-primary)',
  borderRight: '1px solid var(--border-faint)',
  verticalAlign: 'middle',
  lineHeight: 1.35,
  background: 'var(--surface-card)',
}

const regTdSubLabel: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  color: 'var(--text-secondary)',
  fontWeight: 500,
  borderRight: '1px solid var(--border-faint)',
  background: 'var(--surface-card)',
  whiteSpace: 'nowrap',
}

const regTdValue: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4)',
  textAlign: 'right',
  color: 'var(--text-primary)',
  fontWeight: 600,
  background: 'var(--surface-card)',
  whiteSpace: 'nowrap',
}

// ── Filter primitives (kept from the original page) ──

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

type SegOption = { value: string, label: string, active: boolean, onClick: () => void }

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
        <button key={opt.value} onClick={opt.onClick}
          style={{
            padding: '0 var(--space-3)', height: '30px',
            borderRadius: 'var(--radius-xs)',
            border: 'none',
            background: opt.active ? 'var(--surface-card)' : 'transparent',
            color: opt.active ? 'var(--text-primary)' : 'var(--text-tertiary)',
            fontWeight: opt.active ? 600 : 500,
            fontSize: 'var(--fs-label)',
            cursor: 'pointer',
            boxShadow: opt.active ? '0 0 0 1px var(--border-default) inset' : 'none',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}
