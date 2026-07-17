import html2canvas from "html2canvas"
import { jsPDF } from "jspdf"

/**
 * Snapshot wide tables sit inside `overflow-x: auto` containers, which
 * html2canvas respects — only the visible portion is captured. To include
 * the right-side columns that would otherwise be clipped, we temporarily
 * unlock every non-visible overflow inside the node, capture, then restore.
 */
type SavedStyle = {
  el:         HTMLElement
  overflow:   string
  overflowX:  string
  overflowY:  string
  maxWidth:   string
  width:      string
}

function unlockOverflows(root: HTMLElement): SavedStyle[] {
  const saved: SavedStyle[] = []
  const nodes: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  for (const el of nodes) {
    const cs = window.getComputedStyle(el)
    if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      saved.push({
        el,
        overflow:  el.style.overflow,
        overflowX: el.style.overflowX,
        overflowY: el.style.overflowY,
        maxWidth:  el.style.maxWidth,
        width:     el.style.width,
      })
      el.style.overflow  = 'visible'
      el.style.overflowX = 'visible'
      el.style.overflowY = 'visible'
      // Widen constrained containers so their overflowing child (typically a
      // wide table) actually determines the layout width.
      if (cs.maxWidth !== 'none') el.style.maxWidth = 'none'
    }
  }
  return saved
}

function restoreOverflows(saved: SavedStyle[]) {
  for (const s of saved) {
    s.el.style.overflow  = s.overflow
    s.el.style.overflowX = s.overflowX
    s.el.style.overflowY = s.overflowY
    s.el.style.maxWidth  = s.maxWidth
    s.el.style.width     = s.width
  }
}

/**
 * Capture le DOM passé en paramètre et génère un PDF (A4 paysage)
 * avec pagination automatique si la hauteur dépasse une page.
 *
 * @param node    L'élément HTML à capturer (le contenu entier de la page)
 * @param filename Nom du fichier final (sans extension)
 */
export async function exportNodeToPdf(node: HTMLElement, filename: string): Promise<void> {
  if (!node) throw new Error("exportNodeToPdf: node is null")

  // 1) Unlock every overflow constraint inside the node so wide tables
  //    (snapshot period columns) render at their FULL width.
  const saved = unlockOverflows(node)

  // 2) Wait a paint tick so the browser re-lays out with the new overflow.
  await new Promise(r => requestAnimationFrame(() => r(null)))

  // 3) Measure the true content width (scrollWidth alone isn't reliable once
  //    overflow is visible — walk descendants to find the rightmost pixel).
  const nodeLeft = node.getBoundingClientRect().left
  let fullWidth = Math.max(node.scrollWidth, node.getBoundingClientRect().width)
  node.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const rect = el.getBoundingClientRect()
    const rightOffset = rect.right - nodeLeft
    if (rightOffset > fullWidth) fullWidth = rightOffset
  })
  const fullHeight = Math.max(node.scrollHeight, node.getBoundingClientRect().height)

  let canvas: HTMLCanvasElement
  try {
    canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth:  fullWidth,
      windowHeight: fullHeight,
      width:        fullWidth,
      height:       fullHeight,
      scrollX: 0,
      scrollY: -window.scrollY,
    })
  } finally {
    // 4) Always restore the original styles, even on capture failure.
    restoreOverflows(saved)
  }

  const imgData = canvas.toDataURL('image/png')
  // A3 landscape : 420 x 297 mm — chosen over A4 so wide snapshot tables
  // aren't compressed as much, which makes the printed text ~42% larger.
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  // Fit the captured image inside the page width (with a small margin).
  // Very wide captures get scaled down proportionally — height paginates.
  const margin = 8
  const imgWidth = pageWidth - margin * 2
  const imgHeight = (canvas.height * imgWidth) / canvas.width

  if (imgHeight <= pageHeight - margin * 2) {
    // Fits on a single page
    pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight, undefined, 'FAST')
  } else {
    // Pagination — slice the image vertically across pages.
    let positionY = margin
    let heightLeft = imgHeight
    pdf.addImage(imgData, 'PNG', margin, positionY, imgWidth, imgHeight, undefined, 'FAST')
    heightLeft -= (pageHeight - margin * 2)
    while (heightLeft > 0) {
      positionY = heightLeft - imgHeight + margin
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', margin, positionY, imgWidth, imgHeight, undefined, 'FAST')
      heightLeft -= (pageHeight - margin * 2)
    }
  }

  pdf.save(`${filename}.pdf`)
}
