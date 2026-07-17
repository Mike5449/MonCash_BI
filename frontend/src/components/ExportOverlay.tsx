import { Download, FileSpreadsheet } from "lucide-react"
import { formatProgress, type ExportProgress } from "../utils/exportXlsx"

/**
 * Overlay plein-écran qui s'affiche pendant un export streaming XLSX.
 * Montre la phase courante + bytes reçus / total + barre de progression.
 */
export function ExportOverlay({ progress }: { progress: ExportProgress | null }) {
  if (!progress) return null

  const pct = progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.bytesReceived / progress.totalBytes) * 100))
    : null

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(15, 23, 42, 0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, backdropFilter: 'blur(3px)',
    }}>
      <div style={{
        background: 'white', borderRadius: '12px',
        padding: '32px 40px', width: '440px', maxWidth: '92vw',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
        textAlign: 'center',
      }}>
        <div style={{
          width: '64px', height: '64px',
          background: 'linear-gradient(135deg, #16a34a, #15803d)',
          borderRadius: '16px',
          margin: '0 auto 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white',
          boxShadow: '0 10px 25px -5px rgba(22, 163, 74, 0.45)',
        }}>
          <FileSpreadsheet size={32} />
        </div>

        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
          Export Excel en cours
        </h3>
        <p style={{ margin: '6px 0 18px', fontSize: '12px', color: '#64748b', fontWeight: '600' }}>
          {progress.phase}
        </p>

        {/* Barre de progression */}
        <div style={{
          width: '100%', height: '10px',
          background: '#f1f5f9', borderRadius: '999px',
          overflow: 'hidden', marginBottom: '10px',
        }}>
          <div style={{
            width: pct !== null ? `${pct}%` : '40%',
            height: '100%',
            background: 'linear-gradient(90deg, #16a34a, #22c55e)',
            borderRadius: '999px',
            transition: 'width 0.2s ease',
            animation: pct === null ? 'pulse 1.5s ease-in-out infinite' : 'none',
          }} />
        </div>

        <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Download size={14} color="#16a34a" />
          <span>{formatProgress(progress)}</span>
        </div>

        <p style={{ margin: '14px 0 0', fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>
          Ne fermez pas cette page tant que le téléchargement n'a pas démarré.
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.6; transform: scaleX(0.4); transform-origin: left; }
          50%      { opacity: 1;   transform: scaleX(0.9); }
        }
      `}</style>
    </div>
  )
}
