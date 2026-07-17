import { OpenAPI } from "../api/core/OpenAPI"

export type ExportProgress = {
  bytesReceived: number
  totalBytes: number
  phase: string
}

/**
 * Télécharge un fichier XLSX depuis un endpoint streaming côté serveur.
 * Lit la réponse par chunks pour exposer une progression (utile pour exports massifs).
 *
 * @param path - chemin relatif (ex: "/customers/active-customers/export.xlsx")
 * @param params - query params à envoyer
 * @param filename - nom du fichier à proposer en téléchargement
 * @param onProgress - callback de progression (bytesReceived, totalBytes, phase)
 */
export async function downloadXlsxStream(
  path: string,
  params: Record<string, string | number | undefined | null | string[]>,
  filename: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<void> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      // Repeat the param once per value : `?msisdns=A&msisdns=B` — FastAPI's
      // `List[str] = Query(...)` picks it up natively.
      v.forEach((item) => qs.append(k, String(item)))
    } else {
      qs.set(k, String(v))
    }
  }
  const url = `${OpenAPI.BASE}${path}?${qs.toString()}`

  onProgress?.({ bytesReceived: 0, totalBytes: 0, phase: 'Génération du fichier côté serveur…' })

  const res = await fetch(url)
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} : ${txt}`)
  }

  const total = Number(res.headers.get('Content-Length') || 0)
  onProgress?.({ bytesReceived: 0, totalBytes: total, phase: 'Téléchargement du fichier…' })

  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.length
      onProgress?.({ bytesReceived: received, totalBytes: total, phase: 'Téléchargement du fichier…' })
    }
  }

  const blob = new Blob(chunks as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  const dl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = dl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(dl)
}

const fmtBytes = (n: number) => {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

/** Formatte un objet ExportProgress en label lisible. */
export function formatProgress(p: ExportProgress): string {
  if (p.totalBytes > 0) {
    const pct = Math.min(100, Math.round((p.bytesReceived / p.totalBytes) * 100))
    return `${fmtBytes(p.bytesReceived)} / ${fmtBytes(p.totalBytes)} · ${pct}%`
  }
  if (p.bytesReceived > 0) return fmtBytes(p.bytesReceived) + ' reçus'
  return p.phase
}

/**
 * Déclenche un téléchargement **natif** du navigateur via `<a download>`.
 * Le navigateur gère le streaming et affiche sa propre barre de progression dans son UI.
 * Idéal pour CSV (true streaming) — le téléchargement démarre dès que le serveur
 * envoie le 1er chunk, sans JS qui lit la response.
 *
 * Inconvénient vs `downloadXlsxStream` : pas de progression custom à afficher
 * (le navigateur la montre dans son download bar). Plus pas de gestion d'erreur facile.
 */
export function triggerNativeDownload(
  path: string,
  params: Record<string, string | number | undefined | null | string[]>,
  filename: string,
): void {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      // Repeat the param once per value : `?msisdns=A&msisdns=B` — FastAPI's
      // `List[str] = Query(...)` picks it up natively.
      v.forEach((item) => qs.append(k, String(item)))
    } else {
      qs.set(k, String(v))
    }
  }
  const url = `${OpenAPI.BASE}${path}?${qs.toString()}`

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // Petit délai avant remove pour laisser le browser démarrer le download
  setTimeout(() => document.body.removeChild(a), 100)
}
