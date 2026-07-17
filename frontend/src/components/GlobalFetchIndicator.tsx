import { useIsFetching, useIsMutating } from "@tanstack/react-query"

/**
 * Top-of-viewport progress bar — discrète mais toujours visible.
 *
 * S'allume dès qu'au moins UNE requête / mutation React Query est active n'importe
 * où dans l'app (snapshot, KPIs, tables, modals, etc.). Disparait dès que tout est fini.
 *
 * Inspiré de la barre de YouTube / GitHub / Linear : 3 px, brand-color, animation
 * indéterminée smooth — assez visible pour signaler une activité, assez discrète pour
 * ne jamais gêner la lecture du contenu.
 */
export function GlobalFetchIndicator() {
  const fetching = useIsFetching()
  const mutating = useIsMutating()
  const active   = fetching + mutating

  if (active === 0) return null

  return (
    <>
      <style>{`
        @keyframes gfi-slide {
          0%   { transform: translateX(-40%); }
          50%  { transform: translateX(60%);  }
          100% { transform: translateX(180%); }
        }
        @keyframes gfi-glow {
          0%, 100% { opacity: 0.7; }
          50%      { opacity: 1.0; }
        }
      `}</style>

      <div
        role="progressbar"
        aria-busy="true"
        aria-label={`${active} request${active > 1 ? 's' : ''} in flight`}
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0,
          height: '3px',
          background: 'rgba(227, 27, 35, 0.10)',  // faint brand tint as base
          zIndex: 99999,
          overflow: 'hidden',
          pointerEvents: 'none',
          animation: 'gfi-glow 1.6s ease-in-out infinite',
        }}>
        {/* Sliding brand-color sub-bar — indeterminate progress */}
        <div style={{
          position: 'absolute',
          top: 0, bottom: 0,
          width: '35%',
          background: 'linear-gradient(90deg, transparent 0%, var(--brand) 50%, transparent 100%)',
          animation: 'gfi-slide 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        }} />
      </div>
    </>
  )
}
