import { useState, useRef, useCallback } from "react"
import {
  Upload, RefreshCw, AlertTriangle, CheckCircle, IdCard, Eye, EyeOff,
  Copy, X, FileImage, MapPin,
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { OpenAPI } from "../api/core/OpenAPI"
import "../premium.css"

type Fields = {
  prenom: string
  nom: string
  sexe: string
  nationalite: string
  lieu_naissance: string
  date_naissance: string
  date_emission: string
  date_expiration: string
  numero_carte: string
  numero_identification_unique: string
  // verso
  departement: string
  commune: string
  section_communale: string
  adresse: string
  numero_serie: string
}

const EMPTY: Fields = {
  prenom: "", nom: "", sexe: "", nationalite: "",
  lieu_naissance: "", date_naissance: "", date_emission: "",
  date_expiration: "", numero_carte: "", numero_identification_unique: "",
  departement: "", commune: "", section_communale: "", adresse: "", numero_serie: "",
}

export default function IdCardScanner() {
  const frontInputRef = useRef<HTMLInputElement | null>(null)
  const backInputRef  = useRef<HTMLInputElement | null>(null)

  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile,  setBackFile]  = useState<File | null>(null)
  const [frontUrl,  setFrontUrl]  = useState<string | null>(null)
  const [backUrl,   setBackUrl]   = useState<string | null>(null)

  const [busy, setBusy]               = useState(false)
  const [fields, setFields]           = useState<Fields>(EMPTY)
  const [rawText, setRawText]         = useState<{ front: string, back: string }>({ front: "", back: "" })
  const [showRaw, setShowRaw]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [warning, setWarning]         = useState<string | null>(null)
  const [hasResult, setHasResult]     = useState(false)
  const [dragOverFront, setDragOverFront] = useState(false)
  const [dragOverBack,  setDragOverBack]  = useState(false)

  const reset = () => {
    if (frontUrl) URL.revokeObjectURL(frontUrl)
    if (backUrl)  URL.revokeObjectURL(backUrl)
    setFrontFile(null); setBackFile(null)
    setFrontUrl(null);  setBackUrl(null)
    setFields(EMPTY); setRawText({ front: "", back: "" })
    setError(null); setWarning(null); setHasResult(false)
    if (frontInputRef.current) frontInputRef.current.value = ""
    if (backInputRef.current)  backInputRef.current.value  = ""
  }

  const handleFront = (file: File) => {
    if (frontUrl) URL.revokeObjectURL(frontUrl)
    setFrontUrl(URL.createObjectURL(file))
    setFrontFile(file)
  }
  const handleBack = (file: File) => {
    if (backUrl) URL.revokeObjectURL(backUrl)
    setBackUrl(URL.createObjectURL(file))
    setBackFile(file)
  }

  const runScan = useCallback(async () => {
    if (!frontFile) {
      setError("Upload au moins le recto avant de lancer le scan.")
      return
    }
    setError(null); setWarning(null); setHasResult(false); setBusy(true)
    try {
      const form = new FormData()
      form.append("file",  frontFile, frontFile.name)
      if (backFile) form.append("back",  backFile,  backFile.name)
      const res = await fetch(`${OpenAPI.BASE}/tools/id-card/scan`, {
        method: "POST", body: form,
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          if (body?.detail) detail = String(body.detail)
        } catch { /* keep generic */ }
        throw new Error(detail)
      }
      const data = await res.json()
      setFields({ ...EMPTY, ...(data?.fields || {}) })
      setRawText({
        front: String(data?.raw_text?.front || ""),
        back:  String(data?.raw_text?.back  || ""),
      })
      setWarning(data?.warning || null)
      setHasResult(true)
    } catch (e: any) {
      console.error("[IdCardScanner] OCR failed", e)
      setError(e?.message || "Échec de l'OCR")
    } finally {
      setBusy(false)
    }
  }, [frontFile, backFile])

  const setField = (key: keyof Fields, v: string) => {
    setFields(prev => ({ ...prev, [key]: v }))
  }

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(fields, null, 2))
    } catch { /* ignore */ }
  }

  const filledCount = Object.values(fields).filter(Boolean).length

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
            Tools · KYC · ID Card Scanner
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 'var(--fs-xl)', fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)', lineHeight: 1.15,
          }}>
            ID Card Scanner
          </h1>
          <p style={{
            margin: 'var(--space-2) 0 0',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
            maxWidth: '720px',
          }}>
            Upload une photo de Carte d'Identification Nationale (CIN haïtienne) — l'OCR (Tesseract, 100% local)
            extrait les champs. Vérifie et corrige avant de copier dans un formulaire.
          </p>
        </div>
        {hasResult && (
          <button onClick={reset}
            style={{
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              height: '34px', padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            <X size={13} strokeWidth={1.75} /> Reset
          </button>
        )}
      </div>

      {/* Two-column layout : upload/preview à gauche, fields à droite */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(360px, 440px) 1fr',
        gap: 'var(--space-4)',
      }}>
        {/* ── LEFT · UPLOADS / PREVIEWS ── */}
        <div style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-5)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
        }}>
          <div style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          }}>1 · Source images</div>

          {/* Recto */}
          <UploadSlot
            label="Recto (Devant)"
            required
            url={frontUrl}
            dragOver={dragOverFront}
            setDragOver={setDragOverFront}
            onPick={handleFront}
            onClick={() => frontInputRef.current?.click()}
          />
          <input ref={frontInputRef} type="file" accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFront(f) }}
            style={{ display: 'none' }} />

          {/* Verso */}
          <UploadSlot
            label="Verso (Dèyè) — fortement recommandé (MRZ déterministe)"
            url={backUrl}
            dragOver={dragOverBack}
            setDragOver={setDragOverBack}
            onPick={handleBack}
            onClick={() => backInputRef.current?.click()}
          />
          <input ref={backInputRef} type="file" accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBack(f) }}
            style={{ display: 'none' }} />

          {/* Scan button */}
          <button onClick={runScan} disabled={!frontFile || busy}
            style={{
              background: (!frontFile || busy) ? 'var(--surface-muted)' : 'var(--brand)',
              color: (!frontFile || busy) ? 'var(--text-muted)' : 'white',
              border: '1px solid ' + ((!frontFile || busy) ? 'var(--border-default)' : 'var(--brand)'),
              height: '40px', padding: '0 var(--space-5)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 600, fontSize: 'var(--fs-body)',
              cursor: (!frontFile || busy) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
            }}>
            {busy ? <RefreshCw size={14} strokeWidth={1.75} className="animate-spin" /> : <Upload size={14} strokeWidth={1.75} />}
            {busy ? "OCR en cours…" : "Lancer le scan"}
          </button>

          {busy && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              fontSize: 'var(--fs-body)', color: 'var(--text-secondary)',
              padding: 'var(--space-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-muted)',
            }}>
              <RefreshCw size={14} strokeWidth={1.75} className="animate-spin" />
              OCR en cours… (peut prendre 3-10 sec)
            </div>
          )}

          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
              padding: 'var(--space-3)',
              border: '1px solid var(--negative)',
              background: 'rgba(220, 38, 38, 0.06)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-label)', color: 'var(--negative)',
            }}>
              <AlertTriangle size={14} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{error}</span>
            </div>
          )}

          {warning && !error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
              padding: 'var(--space-3)',
              border: '1px solid var(--warning)',
              background: 'rgba(245, 158, 11, 0.06)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-label)', color: 'var(--text-primary)',
            }}>
              <AlertTriangle size={14} strokeWidth={1.75} color="var(--warning)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{warning}</span>
            </div>
          )}

          {hasResult && !error && !warning && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-3)',
              border: '1px solid var(--positive)',
              background: 'rgba(22, 163, 74, 0.06)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-label)', color: 'var(--positive)',
            }}>
              <CheckCircle size={14} strokeWidth={1.75} />
              <span>{filledCount} / 10 champs extraits</span>
            </div>
          )}

          {(rawText.front || rawText.back) && (
            <div>
              <button onClick={() => setShowRaw(s => !s)}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-tertiary)',
                  fontSize: 'var(--fs-micro)', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                  cursor: 'pointer', padding: '0',
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                }}>
                {showRaw ? <EyeOff size={11} /> : <Eye size={11} />}
                {showRaw ? "Masquer le texte OCR brut" : "Voir le texte OCR brut"}
              </button>
              {showRaw && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  {rawText.front && <RawPanel title="Recto" text={rawText.front} />}
                  {rawText.back  && <RawPanel title="Verso (MRZ inclus)" text={rawText.back} />}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT · EDITABLE FIELDS ── */}
        <div style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-5)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>
              2 · Champs extraits (éditables)
            </div>
            <button onClick={copyJson} disabled={!hasResult}
              title="Copier les champs en JSON"
              style={{
                background: 'var(--surface-card)',
                color: hasResult ? 'var(--text-primary)' : 'var(--text-muted)',
                border: '1px solid var(--border-default)',
                height: '28px', padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 500, fontSize: 'var(--fs-label)',
                cursor: hasResult ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                opacity: hasResult ? 1 : 0.5,
              }}>
              <Copy size={11} strokeWidth={1.75} /> Copy JSON
            </button>
          </div>

          {/* Identity */}
          <SectionHeader icon={<IdCard size={12} strokeWidth={1.75} />}>Identity</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
            <FieldInput label="Prénom"      value={fields.prenom}      onChange={v => setField('prenom', v)} />
            <FieldInput label="Nom"         value={fields.nom}         onChange={v => setField('nom', v)} />
            <FieldInput label="Sexe (M/F)"  value={fields.sexe}        onChange={v => setField('sexe', v)} />
            <FieldInput label="Nationalité" value={fields.nationalite} onChange={v => setField('nationalite', v)} />
          </div>

          {/* Birth */}
          <SectionHeader>Birth</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
            <FieldInput label="Date de naissance" value={fields.date_naissance} onChange={v => setField('date_naissance', v)} placeholder="DD-MM-YYYY" />
            <FieldInput label="Lieu de naissance" value={fields.lieu_naissance} onChange={v => setField('lieu_naissance', v)} />
          </div>

          {/* Card */}
          <SectionHeader icon={<FileImage size={12} strokeWidth={1.75} />}>Card</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
            <FieldInput label="Numéro de carte"     value={fields.numero_carte}    onChange={v => setField('numero_carte', v)}    placeholder="ex. H001CH620" mono />
            <FieldInput label="NIU (10 chiffres)"   value={fields.numero_identification_unique} onChange={v => setField('numero_identification_unique', v)} placeholder="ex. 1312503994" mono />
            <FieldInput label="Date d'émission"     value={fields.date_emission}   onChange={v => setField('date_emission', v)}   placeholder="DD-MM-YYYY" />
            <FieldInput label="Date d'expiration"   value={fields.date_expiration} onChange={v => setField('date_expiration', v)} placeholder="DD-MM-YYYY" />
          </div>

          {/* Address — back side */}
          <SectionHeader icon={<MapPin size={12} strokeWidth={1.75} />}>Address (verso)</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <FieldInput label="Département"        value={fields.departement}       onChange={v => setField('departement', v)}        placeholder="ex. OUEST" />
            <FieldInput label="Commune"            value={fields.commune}           onChange={v => setField('commune', v)}            placeholder="ex. GRESSIER" />
            <FieldInput label="Section communale"  value={fields.section_communale} onChange={v => setField('section_communale', v)}  placeholder="ex. 1RE MORNE À BATEAU" />
            <FieldInput label="Adresse"            value={fields.adresse}           onChange={v => setField('adresse', v)}            placeholder="ex. MARIANI 15" />
            <FieldInput label="Numéro de série"    value={fields.numero_serie}      onChange={v => setField('numero_serie', v)}       placeholder="ex. 0003483336" mono />
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

// ── Upload slot (recto / verso) ──

function UploadSlot({ label, required, url, dragOver, setDragOver, onPick, onClick }: {
  label: string,
  required?: boolean,
  url: string | null,
  dragOver: boolean,
  setDragOver: (b: boolean) => void,
  onPick: (f: File) => void,
  onClick: () => void,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
      }}>
        {label}
        {required && <span style={{ color: 'var(--brand)' }}>*</span>}
      </div>
      {!url ? (
        <div
          onClick={onClick}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false)
            const f = e.dataTransfer.files?.[0]; if (f) onPick(f)
          }}
          style={{
            border: '2px dashed ' + (dragOver ? 'var(--brand)' : 'var(--border-default)'),
            background: dragOver ? 'rgba(227, 27, 35, 0.04)' : 'var(--surface-muted)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4) var(--space-4)',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.15s, background 0.15s',
            minHeight: '90px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
          }}>
          <Upload size={18} strokeWidth={1.5} color="var(--text-tertiary)" />
          <div style={{ fontSize: 'var(--fs-label)', fontWeight: 600, color: 'var(--text-primary)' }}>
            Glisse-dépose ou clique
          </div>
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--text-tertiary)' }}>
            JPEG ou PNG · 15 MB max
          </div>
        </div>
      ) : (
        <div style={{
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          background: 'var(--surface-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          maxHeight: '180px',
          cursor: 'pointer',
        }}
        onClick={onClick}
        title="Click pour remplacer">
          <img src={url} alt={label}
            style={{ maxWidth: '100%', maxHeight: '180px', display: 'block' }} />
        </div>
      )}
    </div>
  )
}

function RawPanel({ title, text }: { title: string, text: string }) {
  return (
    <div>
      <div style={{
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
        marginBottom: 'var(--space-1)',
      }}>{title}</div>
      <pre style={{
        background: 'var(--surface-muted)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        fontSize: '11px', lineHeight: 1.4,
        color: 'var(--text-secondary)',
        fontFamily: 'ui-monospace, monospace',
        maxHeight: '180px',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        margin: 0,
      }}>{text}</pre>
    </div>
  )
}

// ── Primitives ──

function SectionHeader({ icon, children }: { icon?: React.ReactNode, children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      fontSize: 'var(--fs-micro)', fontWeight: 600,
      color: 'var(--text-tertiary)',
      textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
      marginBottom: 'var(--space-3)',
      paddingBottom: 'var(--space-2)',
      borderBottom: '1px solid var(--border-faint)',
    }}>
      {icon}{children}
    </div>
  )
}

function FieldInput({ label, value, onChange, placeholder, mono }: {
  label: string, value: string, onChange: (v: string) => void,
  placeholder?: string, mono?: boolean,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <label style={{
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
      }}>{label}</label>
      <input type="text" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          height: '36px', padding: '0 var(--space-3)',
          background: 'var(--surface-card)',
          border: '1px solid ' + (value ? 'var(--border-default)' : 'var(--border-faint)'),
          borderRadius: 'var(--radius-md)',
          outline: 'none',
          fontSize: 'var(--fs-body)', fontWeight: 500,
          color: 'var(--text-primary)',
          fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
          fontVariantNumeric: 'tabular-nums',
        }} />
    </div>
  )
}
