import { useState, useMemo, useRef } from "react"
import {
  Upload, FileSpreadsheet, Download, RefreshCw, CheckCircle, XCircle, Map as MapIcon, FileUp
} from "lucide-react"
import * as XLSX from "xlsx"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { CustomerService } from "../api/services/CustomerService"
import "../premium.css"

type Row = Record<string, any>

const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US')

export default function ImtDepartmentLookup() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [fileName, setFileName] = useState<string>("")
  const [sheetName, setSheetName] = useState<string>("")
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [msisdnCol, setMsisdnCol]   = useState<string>("")
  const [deptCol,   setDeptCol]     = useState<string>("")

  const [isProcessing, setIsProcessing] = useState(false)
  const [enriched, setEnriched] = useState(false)
  const [progress, setProgress] = useState<{ found: number; missing: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Auto-detect MSISDN column / Department column when headers change
  const autoDetect = (hdrs: string[]) => {
    const msisdnLike = hdrs.find(h => /msisdn|phone|tel|numero|number/i.test(h)) || hdrs[0] || ""
    const deptLike   = hdrs.find(h => /depart|location|region|zone/i.test(h)) || hdrs[hdrs.length - 1] || ""
    setMsisdnCol(msisdnLike)
    setDeptCol(deptLike)
  }

  const handleFile = async (file: File) => {
    setError(null); setEnriched(false); setProgress(null)
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sn = wb.SheetNames[0]
      setSheetName(sn)
      const sheet = wb.Sheets[sn]
      // header:1 → returns array of arrays (preserves empty cells)
      const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true })
      if (aoa.length === 0) {
        setError("Le fichier semble vide.")
        setRows([]); setHeaders([])
        return
      }
      const hdrs = (aoa[0] || []).map((h, i) => String(h ?? "").trim() || `Column_${i + 1}`)
      const dataRows: Row[] = []
      for (let i = 1; i < aoa.length; i++) {
        const r: Row = {}
        for (let j = 0; j < hdrs.length; j++) {
          r[hdrs[j]] = aoa[i]?.[j] ?? ""
        }
        // skip fully empty rows
        if (Object.values(r).some(v => String(v ?? "").trim() !== "")) {
          dataRows.push(r)
        }
      }
      setHeaders(hdrs)
      setRows(dataRows)
      autoDetect(hdrs)
    } catch (e: any) {
      setError(`Échec du parsing : ${e?.message || e}`)
    }
  }

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const normalizeMsisdn = (v: any): string => {
    if (v === null || v === undefined) return ""
    return String(v).replace(/[^\d+]/g, "").trim()
  }

  const handleEnrich = async () => {
    if (!msisdnCol || !deptCol || rows.length === 0) return
    setIsProcessing(true); setError(null)
    try {
      const msisdns = Array.from(new Set(
        rows.map(r => normalizeMsisdn(r[msisdnCol])).filter(Boolean)
      ))
      if (msisdns.length === 0) {
        setError("Aucun MSISDN valide trouvé dans la colonne sélectionnée.")
        setIsProcessing(false)
        return
      }
      const resp = await CustomerService.lookupMsisdnDepartments(msisdns)
      const map = new Map<string, string>()
      for (const r of (resp.results || [])) {
        map.set(normalizeMsisdn(r.MSISDN), r.DEPARTMENT || 'Unknown')
      }

      let found = 0, missing = 0
      const updated = rows.map(r => {
        const key = normalizeMsisdn(r[msisdnCol])
        const dept = key && map.has(key) ? map.get(key)! : (key ? 'Unknown' : '')
        if (key) {
          if (map.has(key)) found++; else missing++
        }
        return { ...r, [deptCol]: dept }
      })
      setRows(updated)
      setProgress({ found, missing })
      setEnriched(true)
    } catch (e: any) {
      setError(`Lookup échoué : ${e?.message || e}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleExport = () => {
    if (rows.length === 0) return
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1')
    const ts = new Date().toISOString().split('T')[0]
    const base = fileName.replace(/\.(xlsx|xls|csv)$/i, '') || 'msisdn_departments'
    XLSX.writeFile(wb, `${base}_with_departments_${ts}.xlsx`)
  }

  const handleReset = () => {
    setFileName(""); setSheetName(""); setHeaders([]); setRows([])
    setMsisdnCol(""); setDeptCol("")
    setEnriched(false); setProgress(null); setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const previewRows = useMemo(() => rows.slice(0, 50), [rows])

  return (
    <DashboardLayout>
      <div>

        {/* ── HERO · title on canvas + hairline ── */}
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
              IMT · Network location
            </div>
            <h1 style={{
              margin: 0,
              fontSize: 'var(--fs-xl)', fontWeight: 600,
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--text-primary)', lineHeight: 1.15,
            }}>
              Department Lookup
            </h1>
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
              Upload an Excel file · attach DEPARTMENT (network location) for each MSISDN · export the enriched file.
            </p>
          </div>
          {rows.length > 0 && (
            <button onClick={handleReset}
              style={{
                background: 'var(--surface-card)', color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                height: '34px', padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              }}>
              <RefreshCw size={13} strokeWidth={1.75} /> Reset
            </button>
          )}
        </div>

        {/* ============ STEP 1 — UPLOAD ============ */}
        {rows.length === 0 ? (
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            style={{
              background: 'white', borderRadius: '6px',
              border: '2px dashed #e2e8f0',
              padding: '60px 24px', textAlign: 'center',
              cursor: 'pointer',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={onFilePicked}
            />
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '56px', height: '56px', borderRadius: '6px',
              background: '#fef2f2', color: 'var(--mc-red)',
              marginBottom: '12px', border: '1px solid #fecaca',
            }}>
              <FileUp size={28} />
            </div>
            <div style={{ fontSize: '14px', fontWeight: '900', color: '#0f172a', marginBottom: '4px' }}>
              Drop your Excel file here
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>
              ou clique pour parcourir · formats acceptés : <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong>
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '12px', fontStyle: 'italic' }}>
              Le fichier doit contenir une colonne MSISDN et une colonne vide pour le DEPARTMENT.
            </div>
          </div>
        ) : (
          <>
            {/* File info card */}
            <div style={{
              background: 'white', borderRadius: '6px',
              border: '1px solid #e2e8f0', padding: '14px 18px', marginBottom: '14px',
              display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
            }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '4px',
                background: '#dcfce7', color: '#16a34a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid #bbf7d0',
              }}>
                <FileSpreadsheet size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a' }}>{fileName}</div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>
                  Sheet : <strong>{sheetName}</strong> · {fmtNum(rows.length)} lignes · {headers.length} colonnes
                </div>
              </div>
              {progress && (
                <span style={{
                  background: progress.missing === 0 ? '#dcfce7' : '#fef3c7',
                  color: progress.missing === 0 ? '#15803d' : '#a16207',
                  padding: '5px 11px', borderRadius: '4px',
                  fontWeight: '800', fontSize: '11px',
                  border: `1px solid ${progress.missing === 0 ? '#bbf7d0' : '#fde68a'}`,
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                }}>
                  <CheckCircle size={12} /> {fmtNum(progress.found)} found · {fmtNum(progress.missing)} unknown
                </span>
              )}
            </div>

            {/* Column mapping + actions */}
            <div style={{
              background: 'white', borderRadius: '6px',
              border: '1px solid #e2e8f0', padding: '16px 18px', marginBottom: '14px',
              display: 'flex', alignItems: 'flex-end', gap: '14px', flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  MSISDN column
                </label>
                <select value={msisdnCol} onChange={e => setMsisdnCol(e.target.value)}
                  style={{ height: '36px', padding: '0 10px', borderRadius: '4px', border: '1px solid #e2e8f0', background: 'white', fontWeight: '700', fontSize: '12px', minWidth: '180px' }}>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Department target column
                </label>
                <select value={deptCol} onChange={e => setDeptCol(e.target.value)}
                  style={{ height: '36px', padding: '0 10px', borderRadius: '4px', border: '1px solid #e2e8f0', background: 'white', fontWeight: '700', fontSize: '12px', minWidth: '180px' }}>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
                <button onClick={handleEnrich} disabled={isProcessing || !msisdnCol || !deptCol}
                  style={{
                    background: isProcessing ? '#cbd5e1' : 'var(--mc-red)',
                    color: 'white',
                    border: '1px solid ' + (isProcessing ? '#cbd5e1' : 'var(--mc-red)'),
                    height: '38px', padding: '0 16px', borderRadius: '6px',
                    fontWeight: '800', cursor: isProcessing ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
                  }}>
                  <MapIcon size={14} className={isProcessing ? 'animate-spin' : ''} />
                  {isProcessing ? 'Looking up…' : 'Lookup Departments'}
                </button>
                {enriched && (
                  <button onClick={handleExport}
                    style={{
                      background: '#16a34a', color: 'white',
                      border: '1px solid #16a34a',
                      height: '38px', padding: '0 16px', borderRadius: '6px',
                      fontWeight: '800', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
                    }}>
                    <Download size={14} /> Export XLSX
                  </button>
                )}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: '#fef2f2', color: '#991b1b',
                border: '1px solid #fecaca', borderRadius: '6px',
                padding: '12px 14px', marginBottom: '14px',
                fontSize: '12px', fontWeight: '600',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <XCircle size={16} /> {error}
              </div>
            )}

            {/* Preview table */}
            <div style={{
              background: 'white', borderRadius: '6px',
              border: '1px solid #e2e8f0', overflow: 'hidden',
            }}>
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid #e2e8f0',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ fontSize: '12px', fontWeight: '900', color: '#0f172a' }}>
                  Preview · first 50 rows
                </div>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>
                  {fmtNum(rows.length)} total rows
                </span>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: '60vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                      {headers.map(h => (
                        <th key={h} style={{
                          padding: '10px 14px', textAlign: 'left',
                          fontSize: '10px', fontWeight: '800', color: '#64748b',
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                          background: h === deptCol ? '#fef2f2' : (h === msisdnCol ? '#eff6ff' : 'transparent'),
                          whiteSpace: 'nowrap',
                        }}>
                          {h}
                          {h === msisdnCol && <span style={{ marginLeft: '6px', fontSize: '9px', color: '#2563eb' }}>· MSISDN</span>}
                          {h === deptCol   && <span style={{ marginLeft: '6px', fontSize: '9px', color: 'var(--mc-red)' }}>· DEPT</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                        {headers.map(h => {
                          const val = r[h]
                          const isDeptUnknown = h === deptCol && val === 'Unknown'
                          return (
                            <td key={h} style={{
                              padding: '8px 14px',
                              fontWeight: h === msisdnCol || h === deptCol ? '800' : '500',
                              color: isDeptUnknown ? '#94a3b8' : (h === deptCol && val ? 'var(--mc-red)' : (h === msisdnCol ? '#2563eb' : '#475569')),
                              fontVariantNumeric: 'tabular-nums',
                              fontStyle: isDeptUnknown ? 'italic' : 'normal',
                              whiteSpace: 'nowrap',
                            }}>
                              {val == null || val === '' ? <span style={{ color: '#cbd5e1' }}>—</span> : String(val)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>
              <Upload size={11} /> Upload &gt; pick columns &gt; Lookup &gt; Export. La colonne MSISDN reste intacte, seul le champ DEPARTMENT est rempli.
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
