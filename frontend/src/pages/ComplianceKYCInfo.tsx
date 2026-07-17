import { useState, useRef, useMemo } from "react"
import {
  RefreshCw, Download, Upload, X, XCircle, Check,
  ShieldCheck, Search,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useComplianceKYCInfo, useUploadBulk } from "../hooks/useAnalytics"
import { downloadXlsxStream, type ExportProgress } from "../utils/exportXlsx"
import { ExportOverlay } from "../components/ExportOverlay"
import "../premium.css"

// Keys match the mixed-case aliases returned by the backend (compliance SQL).
type KYCRow = {
  msisdn?: string
  Nom_complet?: string
  identification_Bene_phys?: string
  numero_identite_Bene_phys?: string
  pays_identification_Bene_phys?: string
  sexe_Bene_phys?: string
  date_de_naissance_Bene_phys?: string
  adresse_Bene_phys?: string
  ville_Bene_phys?: string
  departement_Bene_phys?: string
  pays_de_residence_Bene_phys?: string
  MONCASH_STATUS?: string
}

const STATUS_COLORS: Record<string, string> = {
  Active: 'var(--positive)',
  'Pending Active': 'var(--data-subs)',
  Suspended: 'var(--negative)',
  Dormant: 'var(--text-tertiary)',
  Frozen: 'var(--data-value)',
  Closed: 'var(--text-secondary)',
}

export default function ComplianceKYCInfo() {
  const [bulkMsisdns, setBulkMsisdns] = useState<string[]>([])
  const [bulkFileName, setBulkFileName] = useState<string | null>(null)
  const [uploadToast, setUploadToast] = useState<{ kind: 'success' | 'error', message: string } | null>(null)
  const [search, setSearch] = useState("")
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadBulk = useUploadBulk()

  const { data: rows = [], isFetching, refetch } = useComplianceKYCInfo({
    msisdns: bulkMsisdns,
  })

  const busy = isFetching

  const filtered = useMemo(() => {
    if (!search.trim()) return rows as KYCRow[]
    const s = search.trim().toLowerCase()
    return (rows as KYCRow[]).filter(r =>
      String(r.msisdn ?? '').toLowerCase().includes(s) ||
      String(r.Nom_complet ?? '').toLowerCase().includes(s) ||
      String(r.numero_identite_Bene_phys ?? '').toLowerCase().includes(s) ||
      String(r.ville_Bene_phys ?? '').toLowerCase().includes(s) ||
      String(r.departement_Bene_phys ?? '').toLowerCase().includes(s)
    )
  }, [rows, search])

  const foundCount    = rows.length
  const requestedCount = bulkMsisdns.length
  const missingCount   = Math.max(0, requestedCount - foundCount)

  const handleBulkFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadToast(null)
    try {
      const res = await uploadBulk.mutateAsync(file)
      const kind = res?.kind === 'shortcode' ? 'shortcode' : 'msisdn'
      if (kind === 'shortcode') {
        setUploadToast({ kind: 'error', message: "Le fichier contient des SHORTCODE — cette page attend des MSISDN clients uniquement." })
        setBulkFileName(null)
        setBulkMsisdns([])
        return
      }
      const list: string[] = res?.msisdns || []
      setBulkFileName(file.name)
      setBulkMsisdns(list)
      setUploadToast({ kind: 'success', message: `✓ ${list.length.toLocaleString('en-US')} MSISDN importés depuis ${file.name}` })
      setTimeout(() => setUploadToast(null), 5000)
    } catch (err: any) {
      console.error("Bulk upload failed", err)
      const apiMessage =
        typeof err === "object" && err !== null && "body" in err &&
        typeof err.body === "object" && err.body !== null && "detail" in err.body
          ? String(err.body.detail)
          : "Erreur de lecture du fichier. Assure-toi qu'il contient une colonne MSISDN."
      setUploadToast({ kind: 'error', message: apiMessage })
      setBulkFileName(null)
      setBulkMsisdns([])
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const clearBulk = () => {
    setBulkFileName(null)
    setBulkMsisdns([])
    setUploadToast(null)
  }

  const handleExport = async () => {
    if (bulkMsisdns.length === 0) return
    setIsExporting(true)
    try {
      await downloadXlsxStream(
        '/customers/compliance-kyc-info/export.xlsx',
        { msisdns: bulkMsisdns },
        `Compliance_KYC_Info_${new Date().toISOString().slice(0, 10)}.xlsx`,
        (p) => setExportProgress(p),
      )
    } catch (e) {
      console.error("Export failed", e)
      alert("L'export a échoué — voir la console.")
    } finally {
      setIsExporting(false)
      setExportProgress(null)
    }
  }

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
            Customer · Compliance · KYC info
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
            display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
          }}>
            <ShieldCheck size={24} strokeWidth={1.75} color="var(--brand)" />
            Compliance KYC Info
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
            maxWidth: '720px',
          }}>
            Importez un fichier Excel contenant une colonne MSISDN — le portail
            retourne les champs KYC requis pour la conformité
            (identité, sexe, DOB, adresse, commune, département, statut MonCash).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => refetch()} disabled={busy || bulkMsisdns.length === 0}
            style={{
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              height: '34px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: busy ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              opacity: (busy || bulkMsisdns.length === 0) ? 0.5 : 1,
            }}>
            <RefreshCw size={13} strokeWidth={1.75} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={handleExport} disabled={busy || isExporting || bulkMsisdns.length === 0}
            style={{
              background: (busy || bulkMsisdns.length === 0) ? 'var(--surface-muted)' : 'var(--positive)',
              color: (busy || bulkMsisdns.length === 0) ? 'var(--text-muted)' : 'white',
              border: '1px solid ' + ((busy || bulkMsisdns.length === 0) ? 'var(--border-default)' : 'var(--positive)'),
              height: '34px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: (busy || bulkMsisdns.length === 0) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            <Download size={13} strokeWidth={1.75} /> Export Excel
          </button>
        </div>
      </div>

      {/* ── UPLOAD PANEL ── */}
      <div style={{
        background: 'var(--surface-card)',
        padding: 'var(--space-4) var(--space-5)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap',
        gap: 'var(--space-4)',
      }}>
        <input type="file" ref={fileInputRef} onChange={handleBulkFileUpload}
               accept=".xlsx,.xlsm,.csv" style={{ display: 'none' }} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadBulk.isPending}
          style={{
            background: bulkFileName ? 'var(--text-primary)' : 'var(--brand)',
            color: 'white',
            border: '1px solid ' + (bulkFileName ? 'var(--text-primary)' : 'var(--brand)'),
            height: '38px', padding: '0 var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600, fontSize: 'var(--fs-body)',
            cursor: uploadBulk.isPending ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          }}
        >
          {uploadBulk.isPending
            ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
            : <Upload size={13} strokeWidth={1.75} />}
          {bulkFileName ? "Changer le fichier" : "Importer un fichier MSISDN"}
        </button>

        {bulkFileName && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            fontSize: 'var(--fs-body)',
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: '4px var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-muted)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)', fontWeight: 500,
            }}>
              <Upload size={12} strokeWidth={1.75} color="var(--text-tertiary)" />
              {bulkFileName}
              <button onClick={clearBulk}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-tertiary)', cursor: 'pointer',
                  display: 'flex', marginLeft: '2px',
                }}>
                <X size={12} strokeWidth={1.75} />
              </button>
            </span>
            <span style={{
              fontSize: 'var(--fs-label)', color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <strong style={{ color: 'var(--text-primary)' }}>
                {requestedCount.toLocaleString('en-US')}
              </strong> MSISDN demandés ·{' '}
              <strong style={{ color: 'var(--positive)' }}>
                {foundCount.toLocaleString('en-US')}
              </strong> trouvés
              {missingCount > 0 && (
                <> ·{' '}
                  <strong style={{ color: 'var(--negative)' }}>
                    {missingCount.toLocaleString('en-US')}
                  </strong> manquants
                </>
              )}
            </span>
          </div>
        )}

        {!bulkFileName && (
          <div style={{
            fontSize: 'var(--fs-label)',
            color: 'var(--text-tertiary)',
            fontStyle: 'italic',
          }}>
            Fichier CSV ou Excel avec une colonne « MSISDN » (formats acceptés : .csv, .xlsx, .xlsm).
          </div>
        )}
      </div>

      {/* ── Upload toast ── */}
      {uploadToast && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid ' + (uploadToast.kind === 'success' ? 'var(--positive)' : 'var(--negative)'),
          background: uploadToast.kind === 'success'
            ? 'rgba(22, 163, 74, 0.08)'
            : 'rgba(227, 27, 35, 0.08)',
          color: uploadToast.kind === 'success' ? 'var(--positive)' : 'var(--negative)',
          fontSize: 'var(--fs-body)', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        }}>
          {uploadToast.kind === 'success'
            ? <Check size={14} strokeWidth={2} />
            : <XCircle size={14} strokeWidth={2} />}
          <span style={{ flex: 1 }}>{uploadToast.message}</span>
          <button onClick={() => setUploadToast(null)} style={{
            background: 'transparent', border: 'none',
            color: 'inherit', cursor: 'pointer', display: 'flex',
          }}><X size={14} strokeWidth={1.75} /></button>
        </div>
      )}

      {/* ── TABLE ── */}
      <div style={{
        marginTop: 'var(--space-4)',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--surface-muted)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 'var(--space-3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <ShieldCheck size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>KYC records</span>
            {!busy && bulkMsisdns.length > 0 && (
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 500,
                color: 'var(--text-secondary)',
                background: 'var(--surface-card)',
                border: '1px solid var(--border-default)',
                padding: '1px var(--space-2)',
                borderRadius: 'var(--radius-xs)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {filtered.length.toLocaleString('en-US')} of {foundCount.toLocaleString('en-US')} shown
              </span>
            )}
          </div>
          {bulkMsisdns.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Search size={13} strokeWidth={1.75} color="var(--text-tertiary)" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter MSISDN, name, ID number…"
                style={{
                  height: '30px', padding: '0 var(--space-3)', width: '260px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-card)',
                  fontWeight: 500, fontSize: 'var(--fs-body)',
                  color: 'var(--text-primary)',
                }} />
              {search && (
                <button onClick={() => setSearch("")}
                  style={{
                    height: '30px', padding: '0 var(--space-2)',
                    background: 'transparent', border: 'none',
                    color: 'var(--text-tertiary)', cursor: 'pointer',
                  }}>
                  <X size={12} strokeWidth={1.75} />
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ overflowX: 'auto', width: '100%' }}>
          {bulkMsisdns.length === 0 ? (
            <div style={{
              padding: 'var(--space-16) 0', textAlign: 'center',
              color: 'var(--text-tertiary)',
            }}>
              <Upload size={28} strokeWidth={1.5} opacity={0.4}
                      style={{ margin: '0 auto var(--space-3)' }} />
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
                Aucun fichier importé.
              </div>
              <div style={{ fontSize: 'var(--fs-label)', marginTop: 'var(--space-2)' }}>
                Cliquez sur <strong>Importer un fichier MSISDN</strong> ci-dessus pour commencer.
              </div>
            </div>
          ) : busy ? (
            <div style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
              Chargement des informations KYC…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 'var(--space-16) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <XCircle size={24} strokeWidth={1.5} opacity={0.4} style={{ margin: '0 auto var(--space-3)' }} />
              Aucun résultat.
            </div>
          ) : (
            <table style={{
              width: '100%', minWidth: '2000px',
              borderCollapse: 'collapse',
              fontSize: 'var(--fs-label)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <thead style={{ background: 'var(--surface-muted)' }}>
                <tr>
                  {[
                    'MSISDN', 'Nom complet', 'Identification', "Numéro d'identité",
                    'Pays ident.', 'Sexe', 'Date de naissance', 'Adresse',
                    'Ville', 'Département', 'Pays résidence', 'Statut MonCash',
                  ].map((h) => (
                    <th key={h} style={{
                      padding: 'var(--space-2) var(--space-3)',
                      textAlign: 'left',
                      fontSize: 'var(--fs-micro)', fontWeight: 600,
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: 'var(--tracking-uppercase)',
                      borderBottom: '1px solid var(--border-default)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const statusColor = STATUS_COLORS[r.MONCASH_STATUS || ''] || 'var(--text-tertiary)'
                  const Dash = <span style={{ color: 'var(--text-muted)' }}>—</span>
                  return (
                    <tr key={(r.msisdn ?? '') + i} style={{ borderBottom: '1px solid var(--border-faint)' }}>
                      <td style={cellMono}>{r.msisdn || Dash}</td>
                      <td style={cellPrimary}>{r.Nom_complet || Dash}</td>
                      <td style={cellSecondary}>{r.identification_Bene_phys || Dash}</td>
                      <td style={cellMono}>{r.numero_identite_Bene_phys || Dash}</td>
                      <td style={cellSecondary}>{r.pays_identification_Bene_phys || Dash}</td>
                      <td style={cellSecondary}>{r.sexe_Bene_phys || Dash}</td>
                      <td style={cellMono}>{r.date_de_naissance_Bene_phys || Dash}</td>
                      <td style={cellSecondary}>{r.adresse_Bene_phys || Dash}</td>
                      <td style={cellSecondary}>{r.ville_Bene_phys || Dash}</td>
                      <td style={cellSecondary}>{r.departement_Bene_phys || Dash}</td>
                      <td style={cellSecondary}>{r.pays_de_residence_Bene_phys || Dash}</td>
                      <td style={{ ...cellSecondary, whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <span style={{
                            width: '7px', height: '7px', borderRadius: '50%',
                            background: statusColor,
                          }} />
                          {r.MONCASH_STATUS || Dash}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <ExportOverlay progress={exportProgress} />
    </DashboardLayout>
  )
}

const cellSecondary: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  color: 'var(--text-secondary)',
  fontWeight: 500,
}
const cellPrimary: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  color: 'var(--text-primary)',
  fontWeight: 600,
}
const cellMono: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  color: 'var(--text-primary)',
  fontWeight: 500,
  fontFamily: 'ui-monospace, monospace',
  fontSize: 'var(--fs-body)',
}
