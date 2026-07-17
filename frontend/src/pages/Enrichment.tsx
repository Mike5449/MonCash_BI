import { useState, useRef, useMemo } from "react"
import {
  Play, CheckCircle, AlertCircle, Download, RefreshCw, FileUp,
  FileSpreadsheet, Server, Upload as UploadIcon, XCircle
} from "lucide-react"
import * as XLSX from "xlsx"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useHtListInfo, useProcessHtList } from "../hooks/useAnalytics"
import { AnalyticsService } from "../api/services/AnalyticsService"
import "../premium.css"

type Mode = 'upload' | 'server'

const fmtNum = (v: any) => Number(v ?? 0).toLocaleString('en-US')

export default function Enrichment() {
  const [mode, setMode] = useState<Mode>('upload')

  // ====== Server file mode (existing flow) ======
  const { data: info, isLoading: isLoadingInfo, refetch: refreshInfo } = useHtListInfo()
  const { mutateAsync: processList } = useProcessHtList()

  // ====== Shared state ======
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // ====== Upload mode state ======
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingColumns, setPendingColumns] = useState<string[]>([])
  // "" = auto-detect, "__none__" = aucune colonne IDENTIFY, sinon le nom exact de la colonne
  const [identifyChoice, setIdentifyChoice] = useState<string>("")

  const handleProcessServer = async () => {
    setIsProcessing(true); setError(null); setResult(null)
    try {
      const res = await processList()
      if (res.status === "success") setResult({ ...res, source: 'server', filename: info?.path?.split(/[/\\]/).pop() })
      else setError(res.message || "Erreur durant l'enrichissement.")
    } catch (e: any) {
      setError(e.message || "Échec de l'appel au moteur d'enrichissement.")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleProcessUpload = async () => {
    if (!pendingFile) return
    setIsProcessing(true); setError(null); setResult(null)
    try {
      // Construction du map MSISDN → IDENTIFY côté client (défensif, garantit
      // que IDENTIFY est dans le résultat et l'export, peu importe le backend).
      let clientIdentifyMap: Record<string, string> | null = null
      const useExplicitIdentify = identifyChoice && identifyChoice !== "" && identifyChoice !== "__none__"
      if (useExplicitIdentify) {
        try {
          const { headers, rows } = await parseFileFull(pendingFile)
          const msisdnCol = headers.find(c => /msisdn|phone|tel|mobile|num|sim|cell|gsm/i.test(c)) || headers[0] || ""
          if (msisdnCol && headers.includes(identifyChoice)) {
            const map: Record<string, string> = {}
            for (const r of rows) {
              const msisdn = normalizeMsisdn(r[msisdnCol])
              if (!msisdn || map[msisdn]) continue
              const v = r[identifyChoice]
              if (v === null || v === undefined) {
                map[msisdn] = ""
              } else {
                let s = String(v).trim()
                if (s.endsWith('.0')) s = s.slice(0, -2)
                map[msisdn] = s
              }
            }
            clientIdentifyMap = map
          }
        } catch {
          // si le parsing échoue, on laisse le backend gérer
        }
      }

      // "" = auto, "__none__" = aucune, sinon le nom exact
      const identifyParam = identifyChoice === "" ? undefined : identifyChoice
      const res: any = await AnalyticsService.processUploadedList(pendingFile, identifyParam)
      if (res?.status === "success") {
        let data = res.data || []
        // Injection client-side de IDENTIFY (override / fallback de la version backend)
        if (clientIdentifyMap) {
          data = data.map((row: any) => {
            const msisdn = normalizeMsisdn(row.MSISDN ?? row.msisdn ?? "")
            const identify = clientIdentifyMap![msisdn] ?? ""
            // Place IDENTIFY EN PREMIER (préservation de l'ordre des autres clés)
            const { IDENTIFY: _drop, ...rest } = row
            return { IDENTIFY: identify, ...rest }
          })
        }
        setResult({
          ...res,
          data,
          source: 'upload',
          identify_column: useExplicitIdentify ? identifyChoice : (res.identify_column || null),
        })
      } else {
        setError(res?.message || "Erreur durant la vérification.")
      }
    } catch (e: any) {
      setError(e?.message || "Échec du traitement du fichier.")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleExport = () => {
    if (!result?.data || result.data.length === 0) return

    // Calcule l'union de toutes les clés de toutes les lignes pour qu'aucune colonne
    // ne soit perdue (json_to_sheet par défaut ne regarde que la 1ère ligne).
    const seen = new Set<string>()
    const header: string[] = []
    // Si IDENTIFY est détecté côté backend, on le force en première colonne
    if (result.identify_column) {
      header.push('IDENTIFY')
      seen.add('IDENTIFY')
    }
    for (const row of result.data) {
      for (const k of Object.keys(row)) {
        if (!seen.has(k)) {
          seen.add(k)
          header.push(k)
        }
      }
    }

    const ws = XLSX.utils.json_to_sheet(result.data, { header })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Verified')
    const base = (result.filename || 'verification').replace(/\.(xlsx|xls|csv)$/i, '')
    const ts = new Date().toISOString().split('T')[0]
    XLSX.writeFile(wb, `${base}_verified_${ts}.xlsx`)
  }

  const handleReset = () => {
    setResult(null); setError(null); setPendingFile(null)
    setPendingColumns([]); setIdentifyChoice("")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Parse only the header row to populate the IDENTIFY column dropdown
  const parseHeaders = async (file: File): Promise<string[]> => {
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', sheetRows: 1 })
      const sn = wb.SheetNames[0]
      const sheet = wb.Sheets[sn]
      const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
      const hdrs = (aoa[0] || []).map((h: any) => String(h ?? "").trim()).filter(Boolean)
      return hdrs
    } catch {
      return []
    }
  }

  // Parse the FULL file (headers + rows) to build the MSISDN → IDENTIFY map client-side
  const parseFileFull = async (file: File): Promise<{ headers: string[]; rows: Record<string, any>[] }> => {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sn = wb.SheetNames[0]
    const sheet = wb.Sheets[sn]
    const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true })
    const headers = (aoa[0] || []).map((h: any) => String(h ?? "").trim()).filter(Boolean)
    const rows: Record<string, any>[] = []
    for (let i = 1; i < aoa.length; i++) {
      const r: Record<string, any> = {}
      for (let j = 0; j < headers.length; j++) {
        r[headers[j]] = aoa[i]?.[j] ?? ""
      }
      if (Object.values(r).some(v => String(v ?? "").trim() !== "")) rows.push(r)
    }
    return { headers, rows }
  }

  const normalizeMsisdn = (v: any): string => {
    if (v === null || v === undefined) return ""
    return String(v).replace(/[^\d+]/g, "").trim()
  }

  const autoPickIdentify = (cols: string[]): string => {
    // Auto-détecte la colonne IDENTIFY (substring, case-insensitive, en évitant NAME)
    const re = /(identify|identifier|identity|ident)/i
    const match = cols.find(c => re.test(c) && !/name|nom/i.test(c))
    return match || ""
  }

  const handleFilePick = async (f: File) => {
    setPendingFile(f); setResult(null); setError(null)
    const hdrs = await parseHeaders(f)
    setPendingColumns(hdrs)
    setIdentifyChoice(autoPickIdentify(hdrs))
  }

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFilePick(f)
  }
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) handleFilePick(f)
  }

  const columns = useMemo(() => {
    if (!result?.data || result.data.length === 0) return []
    return Object.keys(result.data[0])
  }, [result])

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
              Business Tools · Verification
            </div>
            <h1 style={{
              margin: 0,
              fontSize: 'var(--fs-xl)', fontWeight: 600,
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--text-primary)', lineHeight: 1.15,
            }}>
              File Verification
            </h1>
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
              Check a list of MSISDN against Databricks · MFS · SDP · account status · wallet tier · balance.
            </p>
          </div>
          {(result || pendingFile) && (
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

        {/* ── MODE SELECTOR · borders-only ── */}
        <div style={{
          background: 'white', borderRadius: '6px',
          border: '1px solid #e2e8f0', padding: '6px',
          marginBottom: '16px',
          display: 'inline-flex', gap: '2px',
        }}>
          <ModeButton active={mode === 'upload'} onClick={() => { setMode('upload'); setResult(null); setError(null) }}
            icon={<UploadIcon size={14} />} label="Upload File" />
          <ModeButton active={mode === 'server'} onClick={() => { setMode('server'); setResult(null); setError(null) }}
            icon={<Server size={14} />} label="Server File" />
        </div>

        {/* ============ UPLOAD MODE ============ */}
        {mode === 'upload' && !result && (
          <>
            {!pendingFile ? (
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: 'white', borderRadius: '6px',
                  border: '2px dashed #e2e8f0',
                  padding: '60px 24px', textAlign: 'center', cursor: 'pointer',
                }}
              >
                <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm,.csv" style={{ display: 'none' }} onChange={onFilePicked} />
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '56px', height: '56px', borderRadius: '6px',
                  background: '#fef2f2', color: 'var(--mc-red)',
                  border: '1px solid #fecaca', marginBottom: '14px',
                }}>
                  <FileUp size={28} />
                </div>
                <div style={{ fontSize: '14px', fontWeight: '900', color: '#0f172a', marginBottom: '4px' }}>
                  Drop your file here
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>
                  ou clique pour parcourir · formats : <strong>.xlsx</strong>, <strong>.xlsm</strong>, <strong>.csv</strong>
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '12px', fontStyle: 'italic' }}>
                  Une colonne MSISDN (ou Phone, Tel, Mobile…) sera détectée automatiquement.
                </div>
              </div>
            ) : (
              <>
                {/* File info + actions */}
                <div style={{
                  background: 'white', borderRadius: '6px',
                  border: '1px solid #e2e8f0', padding: '16px 18px',
                  marginBottom: '12px',
                  display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
                }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '4px',
                    background: '#dcfce7', color: '#16a34a',
                    border: '1px solid #bbf7d0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <FileSpreadsheet size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a' }}>{pendingFile.name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>
                      {fmtNum(Math.round(pendingFile.size / 1024))} KB · {pendingColumns.length > 0 ? `${pendingColumns.length} colonnes détectées` : 'prêt à être vérifié'}
                    </div>
                  </div>
                  <button onClick={() => fileInputRef.current?.click()}
                    style={{
                      background: 'white', color: '#475569',
                      border: '1px solid #e2e8f0',
                      height: '38px', padding: '0 14px', borderRadius: '6px',
                      fontWeight: '700', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
                    }}>
                    Change file
                  </button>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm,.csv" style={{ display: 'none' }} onChange={onFilePicked} />
                  <button onClick={handleProcessUpload} disabled={isProcessing}
                    style={{
                      background: isProcessing ? '#cbd5e1' : 'var(--mc-red)', color: 'white',
                      border: '1px solid ' + (isProcessing ? '#cbd5e1' : 'var(--mc-red)'),
                      height: '38px', padding: '0 18px', borderRadius: '6px',
                      fontWeight: '800', cursor: isProcessing ? 'wait' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
                    }}>
                    <Play size={14} className={isProcessing ? 'animate-spin' : ''} />
                    {isProcessing ? 'Verifying…' : 'Run Verification'}
                  </button>
                </div>

                {/* Column mapping — IDENTIFY override */}
                {pendingColumns.length > 0 && (
                  <div style={{
                    background: 'white', borderRadius: '6px',
                    border: '1px solid #e2e8f0', padding: '14px 18px',
                    display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        IDENTIFY column (preserved)
                      </label>
                      <select
                        value={identifyChoice}
                        onChange={e => setIdentifyChoice(e.target.value)}
                        style={{
                          height: '36px', padding: '0 10px', borderRadius: '4px',
                          border: '1px solid #e2e8f0', background: 'white',
                          fontWeight: '700', fontSize: '12px', minWidth: '220px',
                        }}
                      >
                        <option value="">Auto-detect</option>
                        <option value="__none__">— None (skip IDENTIFY) —</option>
                        {pendingColumns.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1, fontSize: '11px', color: '#64748b', fontWeight: '500', lineHeight: 1.5 }}>
                      {identifyChoice === "" && <>Le backend tentera de détecter automatiquement la colonne IDENTIFY (markers : IDENTIFY, IDENTITY, IDENT…).</>}
                      {identifyChoice === "__none__" && <>Aucune colonne IDENTIFY ne sera attachée au résultat.</>}
                      {identifyChoice !== "" && identifyChoice !== "__none__" && (
                        <>La colonne <strong style={{ color: '#6d28d9' }}>{identifyChoice}</strong> sera préservée pour chaque MSISDN dans le résultat.</>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ============ SERVER FILE MODE ============ */}
        {mode === 'server' && !result && (
          <div style={{
            background: 'white', borderRadius: '6px',
            border: '1px solid #e2e8f0', padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '4px',
                  background: '#f8fafc', color: 'var(--mc-red)',
                  border: '1px solid #e2e8f0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Server size={16} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a' }}>Server Input File</div>
                  <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.5px' }}>
                    Configured path on disk
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => refreshInfo()}
                  style={{
                    background: 'white', color: '#475569',
                    border: '1px solid #e2e8f0',
                    height: '36px', padding: '0 12px', borderRadius: '6px',
                    fontWeight: '700', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px',
                  }}>
                  <RefreshCw size={13} /> Reload
                </button>
                <button onClick={handleProcessServer} disabled={isProcessing || info?.status !== 'success'}
                  style={{
                    background: (isProcessing || info?.status !== 'success') ? '#cbd5e1' : 'var(--mc-red)',
                    color: 'white',
                    border: '1px solid ' + ((isProcessing || info?.status !== 'success') ? '#cbd5e1' : 'var(--mc-red)'),
                    height: '36px', padding: '0 16px', borderRadius: '6px',
                    fontWeight: '800', cursor: isProcessing ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px',
                  }}>
                  <Play size={13} className={isProcessing ? 'animate-spin' : ''} />
                  {isProcessing ? 'Verifying…' : 'Run Verification'}
                </button>
              </div>
            </div>

            {isLoadingInfo ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontWeight: '700' }}>
                <div className="spinner" style={{ margin: '0 auto 10px' }} />
                Analyzing target file…
              </div>
            ) : info?.status === 'success' ? (
              <>
                <div style={{
                  background: '#f8fafc', padding: '10px 14px', borderRadius: '4px',
                  fontSize: '12px', marginBottom: '14px',
                  border: '1px solid #e2e8f0',
                  display: 'flex', alignItems: 'center', gap: '8px',
                  color: '#475569', fontWeight: '600',
                }}>
                  <strong style={{ color: '#0f172a' }}>Path:</strong>
                  <code style={{ background: 'white', padding: '2px 8px', borderRadius: '3px', fontSize: '11px' }}>
                    {info.path}
                  </code>
                </div>
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ background: '#f8fafc' }}>
                      <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                        {info.columns.map((col: string) => (
                          <th key={col} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {info.preview.map((row: any, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                          {info.columns.map((col: string) => (
                            <td key={col} style={{ padding: '8px 14px', color: '#475569', fontWeight: '500', whiteSpace: 'nowrap' }}>
                              {row[col] || <span style={{ color: '#cbd5e1' }}>—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{
                padding: '14px 18px', background: '#fef2f2', color: '#991b1b',
                borderRadius: '4px', border: '1px solid #fecaca',
                display: 'flex', alignItems: 'center', gap: '10px',
                fontSize: '12px', fontWeight: '600',
              }}>
                <AlertCircle size={16} />
                <div>
                  <strong>File error:</strong> {info?.message || "Couldn't read input file."}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============ ERROR ============ */}
        {error && (
          <div style={{
            background: '#fef2f2', color: '#991b1b',
            border: '1px solid #fecaca', borderRadius: '6px',
            padding: '12px 14px', marginTop: '14px',
            fontSize: '12px', fontWeight: '600',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <XCircle size={16} /> {error}
          </div>
        )}

        {/* ============ RESULT ============ */}
        {result && (
          <>
            {/* Summary card */}
            <div style={{
              background: 'white', borderRadius: '6px',
              border: '1px solid #e2e8f0', padding: '14px 18px',
              marginBottom: '14px',
              display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
            }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '4px',
                background: '#dcfce7', color: '#16a34a',
                border: '1px solid #bbf7d0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CheckCircle size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  Verification complete · {fmtNum(result.records_found)} records found
                  {result.identify_column && (
                    <span style={{
                      background: '#ede9fe', color: '#6d28d9',
                      fontSize: '10px', fontWeight: '800',
                      padding: '3px 8px', borderRadius: '4px',
                      border: '1px solid #ddd6fe',
                      letterSpacing: '0.3px',
                    }}>
                      IDENTIFY preserved
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>
                  Source : {result.source === 'upload' ? 'uploaded file' : 'server file'}
                  {result.filename && <> · {result.filename}</>}
                  {result.msisdn_column && <> · MSISDN column : <strong>{result.msisdn_column}</strong></>}
                  {result.identify_column && <> · IDENTIFY column : <strong>{result.identify_column}</strong></>}
                </div>
                {(result.saved_to_server || result.output_file) && (
                  <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: '600', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Server size={12} />
                    Sauvegardé sur le serveur :
                    <code style={{ background: '#f0fdf4', padding: '2px 8px', borderRadius: '3px', fontSize: '11px', border: '1px solid #bbf7d0', color: '#15803d' }}>
                      {result.saved_to_server || result.output_file}
                    </code>
                  </div>
                )}
              </div>
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
            </div>

            {/* Data table */}
            <div style={{
              background: 'white', borderRadius: '6px',
              border: '1px solid #e2e8f0', overflow: 'hidden',
            }}>
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid #e2e8f0',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ fontSize: '12px', fontWeight: '900', color: '#0f172a' }}>
                  Enriched results
                </div>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>
                  {fmtNum(result.data.length)} rows · {columns.length} columns
                </span>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: '60vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                      {columns.map(c => (
                        <th key={c} style={{
                          padding: '10px 14px', textAlign: 'left',
                          fontSize: '10px', fontWeight: '800', color: c === 'IDENTIFY' ? '#6d28d9' : '#64748b',
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                          whiteSpace: 'nowrap',
                          background: c === 'IDENTIFY' ? '#faf5ff' : (c === 'MSISDN' ? '#eff6ff' : '#f8fafc'),
                        }}>
                          {c}
                          {c === 'IDENTIFY' && <span style={{ marginLeft: '6px', fontSize: '9px' }}>· preserved</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((row: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                        {columns.map(c => {
                          const val = row[c]
                          const isStatus = c.toUpperCase().includes('STATUS')
                          const isActive = isStatus && String(val).toLowerCase() === 'active'
                          const isIdentify = c === 'IDENTIFY'
                          const isMsisdn = c === 'MSISDN'
                          return (
                            <td key={c} style={{
                              padding: '8px 14px',
                              fontWeight: isMsisdn || isIdentify ? '800' : '500',
                              color: isIdentify ? '#6d28d9' : (isMsisdn ? '#2563eb' : (isActive ? '#16a34a' : (isStatus ? '#dc2626' : '#475569'))),
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                              background: isIdentify ? 'rgba(250, 245, 255, 0.6)' : 'transparent',
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
          </>
        )}
      </div>
    </DashboardLayout>
  )
}

function ModeButton({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick}
      style={{
        padding: '8px 16px',
        background: active ? 'var(--mc-red)' : 'transparent',
        color: active ? 'white' : '#475569',
        border: 'none',
        borderRadius: '4px',
        fontWeight: active ? '900' : '700',
        fontSize: '12px',
        cursor: 'pointer',
        letterSpacing: '0.3px',
        display: 'flex', alignItems: 'center', gap: '8px',
        transition: 'all 0.15s ease',
      }}>
      {icon} {label}
    </button>
  )
}
