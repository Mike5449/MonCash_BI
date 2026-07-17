import { jsPDF } from "jspdf"

/**
 * Charge une image (PNG/SVG/JPG) depuis une URL, la rasterise via canvas,
 * et la retourne en data URL PNG. jsPDF.addImage exige PNG/JPG — il ne sait
 * pas lire les SVG directement, d'où la conversion canvas.
 */
async function loadImageAsDataURL(url: string): Promise<{ dataUrl: string, width: number, height: number }> {
  // 1. Fetch et data URL initial (préserve le format SVG ou PNG)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const srcDataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

  // 2. Charger l'image dans un <img> (le navigateur sait lire SVG/PNG/JPG)
  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = (e) => reject(e)
    i.src = srcDataUrl
  })

  // 3. Rasteriser sur canvas → data URL PNG (jsPDF-compatible)
  const naturalW = img.naturalWidth || img.width || 400
  const naturalH = img.naturalHeight || img.height || 320
  // Render à scale 2x pour avoir une bonne résolution dans le PDF
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width  = naturalW * scale
  canvas.height = naturalH * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("Cannot create canvas context")
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const pngDataUrl = canvas.toDataURL('image/png')

  return { dataUrl: pngDataUrl, width: naturalW, height: naturalH }
}

/**
 * Formatage FR sans utiliser `toLocaleString('fr-FR')` qui insère des espaces
 * insécables (U+00A0) que la police Helvetica de jsPDF ne connaît pas — elles
 * sont alors remplacées par des glyphes aléatoires (`&`, `/`, `+`…) dans le PDF.
 * On utilise donc un espace ASCII normal comme séparateur de milliers et la
 * virgule comme séparateur décimal.
 */
const fmtHTG = (v: any) => {
  const n = Number(v ?? 0)
  const negative = n < 0
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  const intWithSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (negative ? '-' : '') + intWithSep + ',' + dec
}

/** Formatage FR d'un entier (sans décimales) — même règles que fmtHTG. */
const fmtIntFR = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

const formatDateTime = (s?: string) => {
  if (!s) return ''
  const parts = s.replace('T', ' ').split(' ')
  if (parts.length === 0) return s
  const [datePart, timePart] = parts
  if (!datePart) return s
  const dParts = datePart.split('-')
  if (dParts.length !== 3) return s
  // Format français : JJ/MM/AAAA HH:MM (caractères ASCII uniquement)
  return `${dParts[2]}/${dParts[1]}/${dParts[0]} ${timePart ? timePart.slice(0, 5) : ''}`
}

/** Génère "JJ/MM/AAAA HH:MM" à partir d'un Date, sans utiliser toLocaleString. */
const formatDateFR = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} `
       + `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type TxRow = {
  TRANSACTION_DATE?: string
  TR_ID?: string
  SIDE?: 'CREDIT' | 'DEBIT'
  TRANSACTIONTYPE?: string  // catégorie métier renvoyée par mfs_transaction_aml
  SERVICENAME?: string      // gardé comme fallback si TRANSACTIONTYPE est null
  TR_CHANNEL?: string
  TRANS_STATUS?: string
  DEBITOR?: string
  CREDITOR?: string
  AMOUNT?: number | string
  FEE?: number | string
  BAL_BEFORE?: number | string
  BAL_AFTER?: number | string
}

export type TxReportMeta = {
  msisdn: string
  startDate: string
  endDate: string
  status: string
  entityType?: 'Customer' | 'Organization'  // type de l'entité (défaut: Customer)
  ownerName?: string           // Nom complet (IDENTITYNAME)
  ownerAddress?: string        // Adresse du customer
  ownerAccountStatus?: string  // Active / Suspended / Dormant / etc.
  ownerWallet?: string         // Wallet tier (Mini / Full)
  openingBalance?: number      // BAL_AFTER de la 1ère transaction du tri chronologique
  closingBalance?: number      // BAL_AFTER de la dernière transaction du tri chronologique
  generatedAt?: Date
}

/**
 * Génère un rapport PDF professionnel de l'historique transactions.
 * - Page 1 header : logo MonCash + titre + métadonnées (MSISDN, période, status)
 * - Tableau paginé : 1 row par transaction (10 colonnes essentielles)
 */
export async function exportTransactionHistoryPdf(
  rows: TxRow[],
  meta: TxReportMeta,
  filename: string,
): Promise<void> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()   // 297 mm
  const pageHeight = pdf.internal.pageSize.getHeight() // 210 mm
  const margin = 12

  // ─── Charge le logo (PNG uniquement) ───
  let logo: { dataUrl: string, width: number, height: number } | null = null
  try {
    logo = await loadImageAsDataURL('/moncah-logo.png')
  } catch {
    logo = null
  }

  // ─── WATERMARK ──────────────────────────────────────
  // Filigrane anti-reproduction : logo MonCash centré, large, très faible
  // opacité, légèrement incliné. Dessiné EN PREMIER (donc sous tout le reste)
  // sur chaque page via drawHeader().
  const drawWatermark = () => {
    if (!logo) return
    const anyPdf = pdf as any
    const hasGState = typeof anyPdf.GState === 'function' && typeof anyPdf.setGState === 'function'

    // Taille du filigrane : ~70% de la largeur de page
    const watermarkW = pageWidth * 0.70
    const watermarkH = (logo.height / logo.width) * watermarkW
    const cx = pageWidth / 2
    const cy = pageHeight / 2

    if (hasGState) anyPdf.setGState(new anyPdf.GState({ opacity: 0.07 }))
    // Rotation -25° pour un rendu diagonal classique
    pdf.addImage(
      logo.dataUrl, 'PNG',
      cx - watermarkW / 2, cy - watermarkH / 2,
      watermarkW, watermarkH,
      undefined as any, 'NONE', -25,
    )

    // Texte "CONFIDENTIEL · NE PAS REPRODUIRE" sous le logo, même opacité
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    pdf.setTextColor(120, 120, 120)
    pdf.text(
      'CONFIDENTIEL · NE PAS REPRODUIRE',
      cx, cy + watermarkH / 2 + 6,
      { align: 'center', angle: -25 },
    )

    // Restaure l'opacité pour le reste du contenu de la page
    if (hasGState) anyPdf.setGState(new anyPdf.GState({ opacity: 1 }))
  }

  // ─── HEADER ─────────────────────────────────────────
  const drawHeader = (pageNumber: number, totalPages: number) => {
    // Filigrane en premier — il passe sous le reste du contenu
    drawWatermark()

    // Logo en haut à gauche
    if (logo) {
      const logoH = 22
      const logoW = (logo.width / logo.height) * logoH
      pdf.addImage(logo.dataUrl, 'PNG', margin, margin, logoW, logoH)
    }

    // Bandeau rouge MonCash à droite — largeur adaptée au texte
    // (le libellé FR est plus long que l'ancien libellé EN, donc on mesure
    // la largeur réelle et on ajoute 4 mm de padding de chaque côté).
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    const bannerText = 'RAPPORT HISTORIQUE DES TRANSACTIONS'
    const bannerWidth = pdf.getTextWidth(bannerText) + 8
    pdf.setFillColor(227, 27, 35) // MonCash red
    pdf.rect(pageWidth - margin - bannerWidth, margin, bannerWidth, 8, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.text(bannerText, pageWidth - margin - bannerWidth / 2, margin + 5.5, { align: 'center' })

    // Numéro de page en haut à droite
    pdf.setTextColor(120, 120, 120)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`Page ${pageNumber} / ${totalPages}`, pageWidth - margin, margin + 12, { align: 'right' })

    // Date de génération (format FR manuel, ASCII uniquement)
    const gen = formatDateFR(meta.generatedAt || new Date())
    pdf.text(`Généré le : ${gen}`, pageWidth - margin, margin + 16, { align: 'right' })
  }

  // ─── METADATA SECTION (rendu sur toutes les pages) ──
  const drawMetadata = () => {
    let y = margin + 32

    // Titre principal + ligne d'accent rouge
    pdf.setFillColor(227, 27, 35)
    pdf.rect(margin, y - 3, 3, 8, 'F')

    pdf.setTextColor(15, 23, 42)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(15)
    pdf.text('Rapport Historique des Transactions', margin + 7, y + 3)

    y += 9
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor(100, 116, 139)
    pdf.text("Détail chronologique des transactions du compte MonCash, côté débiteur et créditeur, avec balances avant/après.", margin, y)

    // ─── CUSTOMER INFO BOX (Profile + Period + Balances) ───
    y += 7
    const customerBoxH = 38
    pdf.setDrawColor(226, 232, 240)
    pdf.setFillColor(255, 255, 255)
    pdf.roundedRect(margin, y, pageWidth - margin * 2, customerBoxH, 2, 2, 'FD')

    const isOrg = meta.entityType === 'Organization'

    // En-tête section
    pdf.setFillColor(248, 250, 252)
    pdf.rect(margin, y, pageWidth - margin * 2, 5, 'F')
    pdf.setFontSize(6.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(100, 116, 139)
    pdf.text(isOrg ? 'PROFIL DE L\'ORGANISATION' : 'PROFIL DU CLIENT', margin + 3, y + 3.5)

    // Ligne 1 : Nom + Compte (MSISDN ou SHORTCODE) + Wallet
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(148, 163, 184)
    pdf.text(isOrg ? "NOM DE L'ORGANISATION" : 'NOM COMPLET', margin + 3, y + 9.5)
    pdf.text(isOrg ? 'CODE COURT' : 'COMPTE', margin + 110, y + 9.5)
    pdf.text(isOrg ? 'TYPE' : 'PORTEFEUILLE', margin + 200, y + 9.5)

    pdf.setFontSize(8.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(15, 23, 42)
    pdf.text(truncateStr(meta.ownerName || '—', 55), margin + 3, y + 14)
    pdf.text(meta.msisdn || '—', margin + 110, y + 14)
    const walletShort = (meta.ownerWallet || '—').replace('Registered Customer Level ', 'L')
    pdf.text(truncateStr(walletShort, 28), margin + 200, y + 14)

    // Ligne 2 : ADRESSE (gauche) + PERIODE (sous Compte) — labels alignés
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(148, 163, 184)
    pdf.text('ADRESSE', margin + 3, y + 19.5)
    pdf.text('PERIODE', margin + 110, y + 19.5)

    // Valeurs ligne 2
    pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(15, 23, 42)
    pdf.text(truncateStr(meta.ownerAddress || 'Non renseignée', 60), margin + 3, y + 24)

    // Période : DE [date] A [date]
    pdf.setFontSize(8); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(15, 23, 42)
    pdf.text('DE', margin + 110, y + 24)
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(185, 28, 28)
    pdf.text(meta.startDate || '—', margin + 117, y + 24)

    pdf.setTextColor(15, 23, 42); pdf.setFont('helvetica', 'bold')
    pdf.text('A', margin + 146, y + 24)
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(185, 28, 28)
    pdf.text(meta.endDate || '—', margin + 151, y + 24)

    // Ligne 3 : Balance d'ouverture + Balance de fermeture + Nombre de transactions
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(148, 163, 184)
    pdf.text("BALANCE D'OUVERTURE (HTG)", margin + 3, y + 29.5)
    pdf.text('BALANCE DE FERMETURE (HTG)', margin + 110, y + 29.5)
    pdf.text('NB TRANSACTIONS', margin + 220, y + 29.5)

    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold')
    const openTxt = meta.openingBalance != null ? fmtHTG(meta.openingBalance) : '—'
    const closeTxt = meta.closingBalance != null ? fmtHTG(meta.closingBalance) : '—'
    pdf.setTextColor(37, 99, 235)  // bleu pour ouverture
    pdf.text(openTxt, margin + 3, y + 34)
    pdf.setTextColor(15, 23, 42)   // gris foncé pour fermeture
    pdf.text(closeTxt, margin + 110, y + 34)
    pdf.setTextColor(227, 27, 35)  // rouge MonCash pour le compteur
    pdf.text(fmtIntFR(rows.length), margin + 220, y + 34)

    return y + customerBoxH + 4  // y après la box
  }

  function truncateStr(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 1) + '…' : s
  }

  // ─── TABLE ──────────────────────────────────────────
  // 10 colonnes essentielles, labels en FR. Widths en mm (somme ≈ pageWidth - margin*2 = 273)
  const cols = [
    { key: 'TRANSACTION_DATE', label: 'Date',        w: 30, align: 'left'  as const },
    { key: 'TR_ID',            label: 'ID Tx',       w: 34, align: 'left'  as const },
    { key: 'TRANSACTIONTYPE',  label: 'Type',        w: 36, align: 'left'  as const },
    { key: 'TRANS_STATUS',     label: 'Statut',      w: 18, align: 'left'  as const },
    { key: 'DEBITOR',          label: 'Débiteur',    w: 22, align: 'left'  as const },
    { key: 'CREDITOR',         label: 'Créditeur',   w: 22, align: 'left'  as const },
    { key: 'AMOUNT',           label: 'Montant',     w: 22, align: 'right' as const },
    { key: 'FEE',              label: 'Frais',       w: 18, align: 'right' as const },
    { key: 'BAL_BEFORE',       label: 'Solde avant', w: 24, align: 'right' as const },
    { key: 'BAL_AFTER',        label: 'Solde après', w: 24, align: 'right' as const },
  ]

  const rowHeight = 6
  const headerHeight = 7
  const footerHeight = 12  // espace pour le footer seul (numéro de page)

  // Bloc métadonnées identique sur toutes les pages → mêmes coordonnées de départ
  const startTableY = 96
  const continuationTableY = startTableY

  const drawTableHeader = (y: number): number => {
    pdf.setFillColor(227, 27, 35) // red
    pdf.rect(margin, y, pageWidth - margin * 2, headerHeight, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    let x = margin
    for (const c of cols) {
      const tx = c.align === 'right' ? x + c.w - 1 : x + 1.5
      pdf.text(c.label, tx, y + 4.8, { align: c.align })
      x += c.w
    }
    return y + headerHeight
  }

  const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + '…' : s
  const formatCell = (row: TxRow, key: string): string => {
    if (key === 'TRANSACTION_DATE') return formatDateTime(row.TRANSACTION_DATE)
    if (key === 'AMOUNT')           { const v = Number(row.AMOUNT ?? 0); return (row.SIDE === 'CREDIT' ? '+' : '-') + fmtHTG(Math.abs(v)) }
    if (key === 'FEE')              return fmtHTG(row.FEE)
    if (key === 'BAL_BEFORE')       return fmtHTG(row.BAL_BEFORE)
    if (key === 'BAL_AFTER')        return fmtHTG(row.BAL_AFTER)
    if (key === 'TRANSACTIONTYPE')  return String(row.TRANSACTIONTYPE ?? row.SERVICENAME ?? '—')
    const v = (row as any)[key]
    return v == null ? '—' : String(v)
  }

  const drawRow = (row: TxRow, y: number, alt: boolean): void => {
    if (alt) {
      pdf.setFillColor(248, 250, 252)
      pdf.rect(margin, y, pageWidth - margin * 2, rowHeight, 'F')
    }
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(30, 41, 59)

    let x = margin
    for (const c of cols) {
      let raw = formatCell(row, c.key)
      // Compute max chars based on column width (rough estimate)
      const maxChars = Math.floor(c.w / 1.6)
      const text = truncate(raw, maxChars)

      // Couleurs spéciales par colonne
      if (c.key === 'AMOUNT') {
        const isCredit = row.SIDE === 'CREDIT'
        pdf.setTextColor(isCredit ? 22 : 220, isCredit ? 163 : 38, isCredit ? 74 : 38)
        pdf.setFont('helvetica', 'bold')
      } else if (c.key === 'FEE') {
        pdf.setTextColor(227, 27, 35)   // rouge MonCash — met les frais en évidence
        pdf.setFont('helvetica', 'bold')
      } else if (c.key === 'BAL_AFTER') {
        pdf.setTextColor(15, 23, 42)
        pdf.setFont('helvetica', 'bold')
      } else {
        pdf.setTextColor(30, 41, 59)
        pdf.setFont('helvetica', 'normal')
      }

      const tx = c.align === 'right' ? x + c.w - 1 : x + 1.5
      pdf.text(text, tx, y + 4.2, { align: c.align })
      x += c.w
    }
    // Bordure légère sous la row
    pdf.setDrawColor(241, 245, 249)
    pdf.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight)
  }

  // ─── SIGNATURE FOOTER — disabled for now ────────────
  // Bloc signature retiré temporairement à la demande du client.
  // Conservé en commentaire pour pouvoir le réactiver facilement.
  /*
  const drawSignatures = () => {
    const y = pageHeight - margin - footerHeight + 4
    pdf.setDrawColor(180, 180, 180)
    pdf.setLineWidth(0.3)

    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(8)
    pdf.setTextColor(120, 120, 120)
    pdf.text(
      "Ce relevé est délivré au client à sa demande. Les signatures ci-dessous attestent la remise et la prise en compte du document.",
      margin, y
    )
    pdf.text(
      "Pour toute question ou réclamation, contactez le service client MonCash.",
      margin, y + 4
    )

    const sigBoxY = y + 18
    const sigBoxH = 28
    const sigBoxW = (pageWidth - margin * 2 - 30) / 2

    // SIGNATURE 1 (gauche) — Customer
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(80, 80, 80)
    pdf.text('Customer', margin + 2, sigBoxY - 2)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8); pdf.setTextColor(140, 140, 140)
    pdf.text(`(${meta.msisdn})`, margin + 2 + 20, sigBoxY - 2)

    pdf.setDrawColor(150, 150, 150)
    pdf.setLineWidth(0.5)
    pdf.line(margin, sigBoxY + sigBoxH - 8, margin + sigBoxW, sigBoxY + sigBoxH - 8)
    pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(120, 120, 120)
    pdf.text('Nom & Signature', margin + 2, sigBoxY + sigBoxH - 3)
    pdf.text('Date:  ___________________', margin + sigBoxW - 50, sigBoxY + sigBoxH - 3)

    // SIGNATURE 2 (droite) — MonCash Representative
    const sig2X = margin + sigBoxW + 30
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(80, 80, 80)
    pdf.text('Représentant MonCash', sig2X + 2, sigBoxY - 2)

    pdf.setDrawColor(150, 150, 150)
    pdf.line(sig2X, sigBoxY + sigBoxH - 8, sig2X + sigBoxW, sigBoxY + sigBoxH - 8)
    pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(120, 120, 120)
    pdf.text('Nom & Signature', sig2X + 2, sigBoxY + sigBoxH - 3)
    pdf.text('Date:  ___________________', sig2X + sigBoxW - 50, sigBoxY + sigBoxH - 3)
  }
  */

  // ─── PAGINATION : on dessine tout en 2 passes pour connaitre totalPages ──
  // Pass 1 : compter les pages
  let pageCount = 1
  let y = startTableY + headerHeight
  for (let i = 0; i < rows.length; i++) {
    const limit = pageHeight - margin - footerHeight
    if (y + rowHeight > limit) {
      pageCount++
      y = continuationTableY + headerHeight
    }
    y += rowHeight
  }
  const totalPages = pageCount

  // Pass 2 : dessiner
  let currentPage = 1
  drawHeader(currentPage, totalPages)
  let yPos = drawMetadata()
  yPos = drawTableHeader(yPos)

  rows.forEach((row, idx) => {
    const limit = pageHeight - margin - footerHeight
    if (yPos + rowHeight > limit) {
      // Nouvelle page : header + métadonnées complètes (identiques à la page 1) + en-tête tableau
      pdf.addPage()
      currentPage++
      drawHeader(currentPage, totalPages)
      yPos = drawMetadata()
      yPos = drawTableHeader(yPos)
    }
    drawRow(row, yPos, idx % 2 === 1)
    yPos += rowHeight
  })

  pdf.save(`${filename}.pdf`)
}
