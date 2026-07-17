import { useState } from "react"
import { Calendar, RefreshCw, Download, FileText, ArrowRight } from "lucide-react"
import { type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "./ExportOverlay"

// ── Header + Filter chrome partagé entre les snapshots ────────────────────────
// Centralise le visuel "page-header bandeau + filter card" appliqué identiquement
// sur les 5 pages snapshot (Daily, MTD, BankWallet × WoW/MoM, Dimension × Daily/MTD).
//
// Apporte aussi le bouton Export Excel + l'ExportOverlay progress.

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

// ───── HEADER ─────────────────────────────────────────────────────────────────

export interface SnapshotHeaderProps {
  /** Icône à gauche du titre (cercle rouge brand) */
  icon: React.ReactNode
  /** Titre principal (ex: "MonCash KPIs Snapshot") */
  title: string
  /** Sous-titre / suffixe du titre (ex: "By Department · MTD") */
  subtitle: string
  /** Badge à droite du titre (ex: "WEEK-ON-WEEK", "MONTH-ON-MONTH") */
  tag: string
  /** Couleur du tag — défaut slate (WoW), rouge brand pour MoM */
  tagColor?: 'slate' | 'brand'
  /** Description complète (sous le titre) */
  description: React.ReactNode
  /** Callback Refresh */
  onRefresh: () => void
  /** État busy global */
  busy: boolean
  /** Données dispos (pour activer les boutons d'export) */
  hasData: boolean

  /** Excel export (optionnel — si absent, le bouton n'est pas affiché) */
  onExportXlsx?: () => Promise<void> | void
  isExportingXlsx?: boolean

  /** PDF export (optionnel) */
  onExportPdf?: () => Promise<void> | void
  isExportingPdf?: boolean
}

export function SnapshotHeader({
  icon, title, subtitle, tag, tagColor = 'slate', description,
  onRefresh, busy, hasData,
  onExportXlsx, isExportingXlsx,
  onExportPdf,  isExportingPdf,
}: SnapshotHeaderProps) {
  const tagBg = tagColor === 'brand' ? 'var(--mc-red)' : '#1e293b'

  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--mc-border)',
      borderRadius: '8px',
      boxShadow: 'var(--mc-card-shadow)',
      padding: '18px 22px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: '20px', flexWrap: 'wrap',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Accent stripe rouge brand à gauche */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: '4px', background: 'var(--mc-red)',
      }} />

      {/* Bloc identité */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', paddingLeft: '6px' }}>
        <div style={{
          width: '44px', height: '44px',
          borderRadius: '10px',
          background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.10), rgba(220, 38, 38, 0.02))',
          border: '1px solid rgba(220, 38, 38, 0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--mc-red)', flexShrink: 0,
        }}>
          {icon}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{
              margin: 0, fontSize: '18px', letterSpacing: '-0.3px',
            }}>{title}</h1>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', padding: '0 4px' }}>·</span>
            <span style={{
              fontSize: '15px', fontWeight: 700, color: '#0f172a',
              letterSpacing: '-0.2px',
            }}>{subtitle}</span>
            <span style={{
              background: tagBg, color: 'white',
              fontSize: '10px', fontWeight: 800,
              padding: '3px 8px',
              borderRadius: '4px',
              letterSpacing: '0.6px',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>{tag}</span>
          </div>
          <p className="page-subtitle" style={{ marginTop: '4px', fontSize: '12.5px' }}>
            {description}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onRefresh} disabled={busy} title="Refresh"
          style={{
            background: 'white', color: 'var(--mc-text-main)',
            border: '1px solid var(--mc-border)',
            height: '38px', padding: '0 14px',
            borderRadius: '6px', fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
          }}>
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Refresh
        </button>

        {onExportXlsx && (
          <button onClick={onExportXlsx} disabled={!hasData || busy || !!isExportingXlsx}
            title="Export Excel — Diff + Var précalculés"
            style={{
              background: (!hasData || busy || isExportingXlsx) ? '#cbd5e1' : '#059669',
              color: 'white', border: 'none',
              height: '38px', padding: '0 14px',
              borderRadius: '6px', fontWeight: 800,
              cursor: (!hasData || busy || isExportingXlsx) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
              boxShadow: (!hasData || busy || isExportingXlsx) ? 'none' : '0 2px 4px rgba(5, 150, 105, 0.25)',
            }}>
            {isExportingXlsx
              ? <RefreshCw size={14} className="animate-spin" />
              : <Download size={14} />}
            {isExportingXlsx ? "Exporting…" : "Excel"}
          </button>
        )}

        {onExportPdf && (
          <button onClick={onExportPdf} disabled={!hasData || busy || !!isExportingPdf}
            title="Télécharge la page en PDF"
            style={{
              background: (!hasData || busy || isExportingPdf) ? '#cbd5e1' : '#dc2626',
              color: 'white', border: 'none',
              height: '38px', padding: '0 14px',
              borderRadius: '6px', fontWeight: 800,
              cursor: (!hasData || busy || isExportingPdf) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
              boxShadow: (!hasData || busy || isExportingPdf) ? 'none' : '0 2px 4px rgba(220, 38, 38, 0.25)',
            }}>
            {isExportingPdf
              ? <RefreshCw size={14} className="animate-spin" />
              : <FileText size={14} />}
            {isExportingPdf ? "Génération…" : "PDF"}
          </button>
        )}
      </div>
    </div>
  )
}

// ───── FILTER BAR ─────────────────────────────────────────────────────────────

export interface SnapshotFilterBarProps {
  /** Date local en cours d'édition */
  localReportDate: string
  setLocalReportDate: (v: string) => void
  /** Date soumise (= currently applied) */
  submittedDate: string
  /** Callback Apply */
  onApply: () => void
  /** Période "preview" affichée à droite (badge vert) */
  prevStart: string
  prevEnd:   string
  prevLabel: string  // ex: "Preview Day", "Previous MTD"
  /** Période "current" affichée à droite (badge bleu) */
  currStart: string
  currEnd:   string
  currLabel: string  // ex: "Current Day", "Current MTD"
  /** État busy */
  busy: boolean
}

export function SnapshotFilterBar({
  localReportDate, setLocalReportDate, submittedDate, onApply,
  prevStart, prevEnd, prevLabel,
  currStart, currEnd, currLabel,
  busy,
}: SnapshotFilterBarProps) {
  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      border: '1px solid var(--mc-border)',
      boxShadow: 'var(--mc-card-shadow)',
      marginTop: '12px',
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      alignItems: 'stretch',
      overflow: 'hidden',
    }}>
      {/* Bloc gauche — Date sélection */}
      <div style={{
        padding: '14px 20px',
        background: 'linear-gradient(135deg, #fafbfc, #f1f5f9)',
        borderRight: '1px solid var(--mc-border)',
        display: 'flex', flexDirection: 'column', gap: '8px',
        minWidth: '280px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
          color: '#64748b', letterSpacing: '0.6px',
        }}>
          <Calendar size={12} color="var(--mc-red)" />
          Report Date
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="date"
            className="search-input"
            style={{
              width: '160px', height: '36px',
              marginBottom: 0, borderRadius: '6px',
              fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            }}
            value={localReportDate}
            max={todayMinus1()}
            onChange={(e) => setLocalReportDate(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onApply() }}
          />
          <button onClick={onApply} disabled={busy || localReportDate === submittedDate}
            style={{
              background: 'var(--mc-red)', color: 'white', border: 'none',
              height: '36px', padding: '0 18px',
              borderRadius: '6px', fontWeight: 800,
              cursor: (busy || localReportDate === submittedDate) ? 'not-allowed' : 'pointer',
              fontSize: '12px', letterSpacing: '0.3px',
              opacity: (busy || localReportDate === submittedDate) ? 0.5 : 1,
              boxShadow: (busy || localReportDate === submittedDate) ? 'none' : '0 2px 4px rgba(220, 38, 38, 0.25)',
            }}>
            Apply
          </button>
        </div>
      </div>

      {/* Bloc droite — Period badges */}
      <div style={{
        padding: '14px 22px',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: '20px', flexWrap: 'wrap',
      }}>
        <SnapshotPeriodBadge
          label={prevLabel} start={prevStart} end={prevEnd} accent="#059669" />
        <ArrowRight size={18} color="#cbd5e1" strokeWidth={2} />
        <SnapshotPeriodBadge
          label={currLabel} start={currStart} end={currEnd} accent="#2563eb" current />
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
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      paddingLeft: '12px',
      borderLeft: '3px solid ' + accent,
    }}>
      <span style={{
        fontSize: '10px', fontWeight: 800,
        color: accent,
        textTransform: 'uppercase', letterSpacing: '0.6px',
      }}>{label}</span>
      <span style={{
        fontSize: current ? '14px' : '13px',
        fontWeight: current ? 900 : 700,
        color: 'var(--mc-text-main)',
        fontVariantNumeric: 'tabular-nums',
        marginTop: '2px', whiteSpace: 'nowrap',
        letterSpacing: '-0.2px',
      }}>
        {sameDay ? start : (start && end ? `${start} → ${end}` : '—')}
      </span>
    </div>
  )
}

// ───── useXlsxExport — hook helper pour streamer un export Excel ─────────────

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
    /** À monter dans le JSX (par exemple en fin de page) */
    overlay: <ExportOverlay progress={exportProgress} />,
  }
}
