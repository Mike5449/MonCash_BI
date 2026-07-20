import { useState } from "react"
import { Calendar, RefreshCw, Download, FileText, ArrowRight } from "lucide-react"
import { type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "./ExportOverlay"

// ── Shared header + filter chrome for all snapshot pages ─────────────────────
// Centralises the "page-header card + filter card" chrome so every snapshot
// (Daily, MTD, BankWallet × WoW/MoM, Dimension × Daily/MTD) has an identical
// visual identity. Uses only design-system tokens (no hardcoded hex).

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

// Slightly darker green/red used across snapshot pills — the design-system
// -soft variants are too pale for high-density comparison cards.
// Trend palette shared by every snapshot Cell — medium tones (Tailwind -200 bg
// / -800 fg) so the diff/var pills read clearly even at small sizes.
export const SNAPSHOT_TREND = {
  UP_BG:   '#bbf7d0',   // green-200
  UP_FG:   '#166534',   // green-800
  DOWN_BG: '#fecaca',   // red-200
  DOWN_FG: '#991b1b',   // red-800
  FLAT_BG: '#fef08a',   // yellow-200 (neutral movement is highlighted, not hidden)
  FLAT_FG: '#854d0e',   // yellow-800
} as const

// ───── HEADER ─────────────────────────────────────────────────────────────────

export interface SnapshotHeaderProps {
  /** Icon shown left of the title */
  icon: React.ReactNode
  /** Main title (e.g. "MonCash KPIs Snapshot") */
  title: string
  /** Subtitle appended to the title (e.g. "By Department · MTD") */
  subtitle: string
  /** Right-side tag (e.g. "WEEK-ON-WEEK", "MONTH-ON-MONTH") */
  tag: string
  /** Tag colour — slate for WoW, brand for MoM */
  tagColor?: 'slate' | 'brand'
  /** Full description under the title */
  description: React.ReactNode
  /** Refresh callback */
  onRefresh: () => void
  /** Global busy state */
  busy: boolean
  /** Whether data is available (enables the export buttons) */
  hasData: boolean

  /** Excel export (optional — the button is hidden when absent) */
  onExportXlsx?: () => Promise<void> | void
  isExportingXlsx?: boolean

  /** PDF export (optional) */
  onExportPdf?: () => Promise<void> | void
  isExportingPdf?: boolean
}

export function SnapshotHeader({
  icon, title, subtitle, tag, tagColor = 'slate', description,
  onRefresh, busy, hasData,
  onExportXlsx, isExportingXlsx,
  onExportPdf,  isExportingPdf,
}: SnapshotHeaderProps) {
  const tagBg = tagColor === 'brand' ? 'var(--brand)' : 'var(--text-primary)'

  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-6)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: 'var(--space-4)', flexWrap: 'wrap',
    }}>
      {/* Identity block */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <div style={{
          width: '38px', height: '38px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--brand-soft)',
          border: '1px solid var(--brand-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--brand)', flexShrink: 0,
        }}>
          {icon}
        </div>

        <div>
          <div style={{
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-uppercase)',
            marginBottom: 'var(--space-1)',
          }}>
            Snapshot · {subtitle}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <h1 style={{
              margin: 0,
              fontSize: 'var(--fs-lg)', fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: 'var(--tracking-tight)',
              lineHeight: 1.2,
            }}>{title}</h1>
            <span style={{
              background: tagBg, color: 'white',
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              letterSpacing: 'var(--tracking-uppercase)',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>{tag}</span>
          </div>
          <p style={{
            margin: 'var(--space-1) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
          }}>
            {description}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={onRefresh} disabled={busy} title="Refresh"
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

        {onExportXlsx && (
          <button onClick={onExportXlsx} disabled={!hasData || busy || !!isExportingXlsx}
            title="Export Excel"
            style={{
              background: (!hasData || busy || isExportingXlsx) ? 'var(--surface-muted)' : 'var(--positive)',
              color: (!hasData || busy || isExportingXlsx) ? 'var(--text-muted)' : 'white',
              border: '1px solid ' + ((!hasData || busy || isExportingXlsx) ? 'var(--border-default)' : 'var(--positive)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: (!hasData || busy || isExportingXlsx) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            {isExportingXlsx
              ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
              : <Download size={13} strokeWidth={1.75} />}
            {isExportingXlsx ? "Exporting…" : "Excel"}
          </button>
        )}

        {onExportPdf && (
          <button onClick={onExportPdf} disabled={!hasData || busy || !!isExportingPdf}
            title="Download page as PDF"
            style={{
              background: (!hasData || busy || isExportingPdf) ? 'var(--surface-muted)' : 'var(--brand)',
              color: (!hasData || busy || isExportingPdf) ? 'var(--text-muted)' : 'white',
              border: '1px solid ' + ((!hasData || busy || isExportingPdf) ? 'var(--border-default)' : 'var(--brand)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: (!hasData || busy || isExportingPdf) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            {isExportingPdf
              ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
              : <FileText size={13} strokeWidth={1.75} />}
            {isExportingPdf ? "Generating…" : "PDF"}
          </button>
        )}
      </div>
    </div>
  )
}

// ───── FILTER BAR ─────────────────────────────────────────────────────────────

export interface SnapshotFilterBarProps {
  /** Currently edited date (before Apply) */
  localReportDate: string
  setLocalReportDate: (v: string) => void
  /** Submitted (applied) date */
  submittedDate: string
  /** Apply callback */
  onApply: () => void
  /** Preview period shown right-side */
  prevStart: string
  prevEnd:   string
  prevLabel: string
  /** Current period shown right-side */
  currStart: string
  currEnd:   string
  currLabel: string
  /** Busy state */
  busy: boolean
}

export function SnapshotFilterBar({
  localReportDate, setLocalReportDate, submittedDate, onApply,
  prevStart, prevEnd, prevLabel,
  currStart, currEnd, currLabel,
  busy,
}: SnapshotFilterBarProps) {
  const dirty = localReportDate !== submittedDate
  return (
    <div style={{
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-default)',
      marginTop: 'var(--space-3)',
      padding: 'var(--space-4) var(--space-6)',
      display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap',
      gap: 'var(--space-6)',
    }}>
      {/* Report date input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <label style={{
          fontSize: 'var(--fs-micro)', fontWeight: 600,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-uppercase)',
        }}>Report date</label>
        <div style={{
          position: 'relative',
          display: 'flex', alignItems: 'center',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
        }}>
          <Calendar size={13} strokeWidth={1.75} color="var(--text-tertiary)"
            style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
          <input
            type="date"
            value={localReportDate}
            max={todayMinus1()}
            onChange={(e) => setLocalReportDate(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && dirty && !busy) onApply() }}
            style={{
              height: '38px', width: '170px',
              paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-2)',
              border: 'none', background: 'transparent', outline: 'none',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      </div>

      <button onClick={onApply} disabled={busy || !dirty}
        style={{
          background: (busy || !dirty) ? 'var(--surface-muted)' : 'var(--brand)',
          color: (busy || !dirty) ? 'var(--text-muted)' : 'white',
          border: '1px solid ' + ((busy || !dirty) ? 'var(--border-default)' : 'var(--brand)'),
          height: '38px', padding: '0 var(--space-5, 20px)',
          borderRadius: 'var(--radius-md)',
          fontWeight: 500, fontSize: 'var(--fs-body)',
          cursor: (busy || !dirty) ? 'not-allowed' : 'pointer',
        }}>
        Apply
      </button>

      {/* Period badges */}
      <div style={{
        marginLeft: 'auto',
        display: 'flex', alignItems: 'center',
        gap: 'var(--space-4)', flexWrap: 'wrap',
        paddingBottom: '2px',
      }}>
        <SnapshotPeriodBadge label={prevLabel} start={prevStart} end={prevEnd} accent="var(--data-subs)" />
        <ArrowRight size={14} strokeWidth={2} color="var(--text-muted)" />
        <SnapshotPeriodBadge label={currLabel} start={currStart} end={currEnd} accent="var(--brand)" current />
      </div>
    </div>
  )
}

// ───── PERIOD BADGE ───────────────────────────────────────────────────────────

export function SnapshotPeriodBadge({ label, start, end, accent, current = false }: {
  label: string, start: string, end: string, accent: string, current?: boolean,
}) {
  const sameDay = start && end && start === end
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      paddingLeft: 'var(--space-3)',
      borderLeft: '2px solid ' + accent,
    }}>
      <span style={{
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: accent,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
      }}>{label}</span>
      <span style={{
        fontSize: 'var(--fs-body)',
        fontWeight: current ? 600 : 500,
        color: 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
        marginTop: 'var(--space-1)',
        whiteSpace: 'nowrap',
      }}>
        {sameDay ? start : (start && end ? `${start} → ${end}` : '—')}
      </span>
    </div>
  )
}

// ───── useXlsxExport — hook helper to stream an Excel export ─────────────────

export function useXlsxExport() {
  const [isExportingXlsx, setIsExportingXlsx] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)

  const downloadXlsx = async (path: string, queryParams: Record<string, string>, filename: string) => {
    if (isExportingXlsx) return
    setIsExportingXlsx(true)
    setExportProgress({ bytesReceived: 0, totalBytes: 0, phase: 'Server is generating the file…' })
    try {
      const { OpenAPI } = await import("../api/core/OpenAPI")
      const qs = new URLSearchParams(queryParams)
      const res = await fetch(`${OpenAPI.BASE}${path}?${qs.toString()}`)
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
      const blob = new Blob(chunks as BlobPart[], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error("Excel export failed", e)
      alert("L'export Excel a échoué — voir la console.")
    } finally {
      setIsExportingXlsx(false); setExportProgress(null)
    }
  }

  return {
    isExportingXlsx,
    exportProgress,
    downloadXlsx,
    /** Mount this at the end of your JSX to show the progress overlay */
    overlay: <ExportOverlay progress={exportProgress} />,
  }
}
