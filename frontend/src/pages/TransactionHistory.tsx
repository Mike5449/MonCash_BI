import { useState, useMemo } from "react"
import {
  Calendar, RefreshCw, Download, Search, Phone, ArrowDownCircle, ArrowUpCircle,
  Activity, User, MapPin, FileText, ShieldCheck, Building2
} from "lucide-react"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useTransactionHistory, useCustomers } from "../hooks/useAnalytics"
import { triggerNativeDownload } from "../utils/exportXlsx"
import { exportTransactionHistoryPdf } from "../utils/transactionHistoryPdf"
import "../premium.css"

type Status = 'Completed' | 'Expired' | 'Cancelled' | 'Declined' | 'All'

const STATUS_OPTIONS: Status[] = ['Completed', 'Expired', 'Cancelled', 'Declined', 'All']

const STATUS_COLOR: Record<string, string> = {
  Completed: '#16a34a',
  Expired:   '#94a3b8',
  Cancelled: '#dc2626',
  Declined:  '#ea580c',
}

const todayMinus30 = () => {
  const d = new Date(); d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}
const today = () => new Date().toISOString().split('T')[0]

const fmtHTG = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNum = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const formatDateTime = (s?: string) => {
  if (!s) return ''
  // Try to parse "yyyy-MM-dd HH:mm:ss" or similar
  const parts = s.replace('T', ' ').split(' ')
  if (parts.length === 0) return s
  const [datePart, timePart] = parts
  if (!datePart) return s
  const dParts = datePart.split('-')
  if (dParts.length !== 3) return s
  return `${dParts[1]}/${dParts[2]}/${dParts[0]} ${timePart ? timePart.slice(0, 5) : ''}`
}

type EntityType = 'Customer' | 'Organization'

export default function TransactionHistory() {
  const [identityType, setIdentityType] = useState<EntityType>('Customer')
  const [localIdentityType, setLocalIdentityType] = useState<EntityType>('Customer')
  const [msisdnInput, setMsisdnInput] = useState("")
  const [localStart, setLocalStart]   = useState<string>(todayMinus30())
  const [localEnd, setLocalEnd]       = useState<string>(today())
  const [localStatus, setLocalStatus] = useState<Status>('All')

  const [submittedMsisdn, setSubmittedMsisdn] = useState("")
  const [start, setStart]                     = useState<string>(todayMinus30())
  const [end, setEnd]                         = useState<string>(today())
  const [status, setStatus]                   = useState<Status>('All')
  const [pdfBusy, setPdfBusy] = useState(false)

  const { data, isLoading, isFetching, refetch } = useTransactionHistory({
    msisdn: submittedMsisdn,
    startDate: start, endDate: end,
    // 'All' → empty string côté backend = pas de filtre sur le status
    status: status === 'All' ? '' : status,
  })

  // Récupère les infos entité — Customer via MSISDN ou Organization via SHORTCODE
  const isOrg = identityType === 'Organization'
  const { data: customerList } = useCustomers({
    msisdn:     !isOrg && submittedMsisdn ? submittedMsisdn : undefined,
    shortcodes:  isOrg && submittedMsisdn ? [submittedMsisdn] : undefined,
    identityType: identityType,
    limit: 1,
  })
  const customer: any = (customerList && customerList[0]) || null
  const customerName = customer?.IDENTITYNAME || ''
  const customerAddress = customer?.ADDRESS || ''
  const customerStatus = customer?.STATUS || ''
  // Customers → KYC (FULL WALLET / MINI WALLET).
  // Organizations → derive type from PRODUCTS, stripping square brackets:
  //   '[Merchant Product]'                 → 'Merchant Product'
  //   '[Merchant Product][Agent Product]'  → 'Merchant Product, Agent Product'
  const customerWallet = isOrg
    ? String(customer?.PRODUCTS || '')
        .replace(/\]\[/g, ', ')   // separator between adjacent product tags
        .replace(/[\[\]]/g, '')   // strip remaining brackets
        .trim()
    : (customer?.KYC || '')

  const busy = isLoading || isFetching
  const rows: any[] = (data as any[]) ?? []

  const apply = () => {
    if (!msisdnInput.trim()) {
      alert(localIdentityType === 'Organization'
        ? "Saisis un SHORTCODE d'organisation pour rechercher."
        : "Saisis un MSISDN pour rechercher.")
      return
    }
    setIdentityType(localIdentityType)
    setSubmittedMsisdn(msisdnInput.trim())
    setStart(localStart); setEnd(localEnd); setStatus(localStatus)
  }

  // Stats rapides à partir du résultat
  const stats = useMemo(() => {
    let totalAmount = 0; let totalFee = 0
    let credits = 0; let debits = 0
    for (const r of rows) {
      totalAmount += Number(r.AMOUNT ?? 0)
      totalFee    += Number(r.FEE ?? 0)
      if (r.SIDE === 'CREDIT') credits++
      else if (r.SIDE === 'DEBIT') debits++
    }
    return { count: rows.length, totalAmount, totalFee, credits, debits }
  }, [rows])

  // Balance d'ouverture = 1ère BAL_AFTER valide DANS la période (tri chronologique strict)
  // Balance de fermeture = dernière BAL_AFTER valide DANS la période
  const balances = useMemo(() => {
    if (rows.length === 0) return { opening: null as number | null, closing: null as number | null }

    // Borne stricte sur la période [start, end] côté client (défensif)
    const startTs = start ? new Date(start + 'T00:00:00').getTime() : 0
    const endTs   = end   ? new Date(end   + 'T23:59:59').getTime() : Number.POSITIVE_INFINITY

    const inPeriod = rows.filter(r => {
      const raw = String(r.TRANSACTION_DATE ?? '').replace('T', ' ')
      const t = new Date(raw).getTime()
      if (isNaN(t)) return false
      if (t < startTs || t > endTs) return false
      const bal = r.BAL_AFTER
      return bal != null && bal !== '' && !isNaN(Number(bal))
    })
    if (inPeriod.length === 0) return { opening: null, closing: null }

    // Tri chronologique ascendant sur le timestamp numérique
    const sorted = [...inPeriod].sort((a, b) => {
      const ta = new Date(String(a.TRANSACTION_DATE ?? '').replace('T', ' ')).getTime()
      const tb = new Date(String(b.TRANSACTION_DATE ?? '').replace('T', ' ')).getTime()
      return ta - tb
    })

    return {
      opening: Number(sorted[0].BAL_AFTER),
      closing: Number(sorted[sorted.length - 1].BAL_AFTER),
    }
  }, [rows, start, end])

  const handleExportCsv = () => {
    if (!submittedMsisdn) return
    triggerNativeDownload(
      '/customers/transaction-history/export.csv',
      { msisdn: submittedMsisdn, start_date: start, end_date: end, status: status === 'All' ? '' : status },
      `Transaction_History_${submittedMsisdn}_${start}_to_${end}.csv`,
    )
  }

  const handleExportPdf = async () => {
    if (!submittedMsisdn || rows.length === 0) return
    setPdfBusy(true)
    try {
      await exportTransactionHistoryPdf(
        rows as any,
        {
          msisdn: submittedMsisdn,
          startDate: start,
          endDate: end,
          status: status,
          entityType: identityType,
          ownerName: customerName || undefined,
          ownerAddress: customerAddress || undefined,
          ownerAccountStatus: customerStatus || undefined,
          ownerWallet: customerWallet || undefined,
          openingBalance: balances.opening ?? undefined,
          closingBalance: balances.closing ?? undefined,
          generatedAt: new Date(),
        },
        `Transaction_History_${submittedMsisdn}_${start}_to_${end}`,
      )
    } catch (e) {
      console.error("PDF export failed", e)
      alert("La génération du PDF a échoué — voir la console.")
    } finally {
      setPdfBusy(false)
    }
  }

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
              Business Tools · Investigations
            </div>
            <h1 style={{
              margin: 0,
              fontSize: 'var(--fs-xl)', fontWeight: 600,
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--text-primary)', lineHeight: 1.15,
            }}>
              Transaction History Report
            </h1>
            <p style={{
              margin: 'var(--space-2) 0 0',
              fontSize: 'var(--fs-body)', color: 'var(--text-secondary)',
            }}>
              Full transaction log for a MSISDN or organization · debitor + creditor side · balances before/after.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button onClick={() => refetch()} disabled={busy || !submittedMsisdn} title="Refresh"
              style={{
                background: 'var(--surface-card)', color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                height: '34px', padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                cursor: (busy || !submittedMsisdn) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                opacity: (busy || !submittedMsisdn) ? 0.5 : 1,
                transition: 'background 0.12s ease',
              }}>
              <RefreshCw size={13} strokeWidth={1.75} className={busy ? "animate-spin" : ""} />
              Refresh
            </button>
            <button onClick={handleExportCsv} disabled={busy || rows.length === 0}
              title="Export CSV"
              style={{
                background: 'var(--surface-card)', color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                height: '34px', padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                cursor: (busy || rows.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                opacity: (busy || rows.length === 0) ? 0.5 : 1,
              }}>
              <Download size={13} strokeWidth={1.75} /> CSV
            </button>
            <button onClick={handleExportPdf} disabled={busy || pdfBusy || rows.length === 0}
              title="Generate PDF report"
              style={{
                background: (busy || pdfBusy || rows.length === 0) ? 'var(--surface-muted)' : 'var(--brand)',
                color: (busy || pdfBusy || rows.length === 0) ? 'var(--text-muted)' : 'white',
                border: '1px solid ' + ((busy || pdfBusy || rows.length === 0) ? 'var(--border-default)' : 'var(--brand)'),
                height: '34px', padding: '0 var(--space-4)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                cursor: (busy || pdfBusy || rows.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              }}>
              {pdfBusy ? <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" /> : <FileText size={13} strokeWidth={1.75} />}
              {pdfBusy ? "Generating" : "PDF Report"}
            </button>
          </div>
        </div>

        {/* ── FILTER BAR · borders-only ── */}
        <div style={{
          background: 'var(--surface-card)',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-default)',
          display: 'flex', alignItems: 'center',
          gap: 'var(--space-3)', flexWrap: 'wrap',
        }}>
          {/* Entity type toggle */}
          <div style={{
            display: 'flex', gap: '1px',
            background: 'var(--surface-muted)',
            padding: '2px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-faint)',
          }}>
            {(['Customer', 'Organization'] as const).map(t => {
              const active = localIdentityType === t
              const Icn = t === 'Organization' ? Building2 : User
              return (
                <button key={t}
                  onClick={() => setLocalIdentityType(t)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                    padding: '4px 10px', borderRadius: 'var(--radius-xs)',
                    background: active ? 'var(--surface-card)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    border: '1px solid ' + (active ? 'var(--border-default)' : 'transparent'),
                    fontWeight: active ? 600 : 500,
                    fontSize: 'var(--fs-label)', cursor: 'pointer',
                    transition: 'color 0.12s ease, background 0.12s ease',
                  }}>
                  <Icn size={11} strokeWidth={1.75} /> {t}
                </button>
              )
            })}
          </div>

          {/* MSISDN / SHORTCODE input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: '1 1 240px', minWidth: '240px' }}>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
              whiteSpace: 'nowrap',
            }}>
              {localIdentityType === 'Organization' ? 'Shortcode' : 'MSISDN'}
            </span>
            <input type="text"
              placeholder={localIdentityType === 'Organization' ? "e.g. 314" : "e.g. 50912345678"}
              value={msisdnInput}
              onChange={(e) => setMsisdnInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') apply() }}
              style={{
                flex: 1, height: '32px', padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                fontSize: 'var(--fs-body)', fontWeight: 500,
                fontFamily: 'ui-monospace, monospace',
                color: 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            />
          </div>

          {/* Date range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>From</span>
            <input type="date" value={localStart} onChange={(e) => setLocalStart(e.target.value)} max={today()}
              style={{
                height: '32px', padding: '0 var(--space-2)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                fontSize: 'var(--fs-body)', fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--text-primary)',
              }} />
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>To</span>
            <input type="date" value={localEnd} onChange={(e) => setLocalEnd(e.target.value)} max={today()}
              style={{
                height: '32px', padding: '0 var(--space-2)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                fontSize: 'var(--fs-body)', fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--text-primary)',
              }} />
          </div>

          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            }}>Status</span>
            <select value={localStatus} onChange={(e) => setLocalStatus(e.target.value as Status)}
              style={{
                height: '32px', padding: '0 var(--space-2)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                fontSize: 'var(--fs-body)', fontWeight: 500,
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <button onClick={apply} disabled={busy}
            style={{
              background: 'var(--brand)', color: 'white',
              border: '1px solid var(--brand)',
              height: '32px', padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500, fontSize: 'var(--fs-body)',
              cursor: busy ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
            <Search size={13} strokeWidth={1.75} />
            Search
          </button>
        </div>

        {/* ── INFO CARD · borders-only ── */}
        {submittedMsisdn && (
          <div style={{
            background: 'var(--surface-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
            padding: 'var(--space-4)',
            marginTop: 'var(--space-4)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)',
              marginBottom: 'var(--space-4)',
              paddingBottom: 'var(--space-3)',
              borderBottom: '1px solid var(--border-faint)',
            }}>
              <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex', alignSelf: 'center' }}>
                {identityType === 'Organization' ? <Building2 size={14} strokeWidth={1.75} /> : <User size={14} strokeWidth={1.75} />}
              </span>
              <span style={{
                fontSize: 'var(--fs-md)', fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: 'var(--tracking-tight)',
              }}>
                {identityType === 'Organization' ? 'Organization profile' : 'Customer profile'}
              </span>
              <span style={{
                fontSize: 'var(--fs-label)',
                color: 'var(--text-tertiary)',
              }}>
                · report scope
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
              <InfoField
                icon={identityType === 'Organization' ? <Building2 size={12} strokeWidth={1.75} /> : <User size={12} strokeWidth={1.75} />}
                label={identityType === 'Organization' ? 'Organization Name' : 'Full Name'}
                value={customerName || <Dash />} />
              <InfoField
                icon={identityType === 'Organization' ? <Building2 size={12} strokeWidth={1.75} /> : <Phone size={12} strokeWidth={1.75} />}
                label={identityType === 'Organization' ? 'Shortcode' : 'MSISDN'}
                value={<span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: 'var(--text-primary)' }}>{submittedMsisdn}</span>} />
              <InfoField icon={<ShieldCheck size={12} strokeWidth={1.75} />} label="Account Status"
                value={customerStatus ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: customerStatus === 'Active' ? 'var(--positive)' : 'var(--text-muted)',
                    }} />
                    {customerStatus}
                    {customerWallet && (
                      <span style={{
                        marginLeft: 'var(--space-1)',
                        color: 'var(--text-tertiary)',
                        fontSize: 'var(--fs-micro)', fontWeight: 500,
                        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                      }}>
                        · {customerWallet.replace('Registered Customer Level ', 'L')}
                      </span>
                    )}
                  </span>
                ) : <Dash />} />
              <InfoField icon={<MapPin size={12} strokeWidth={1.75} />} label="Address"
                value={customerAddress || <Dash />} />
              <InfoField icon={<Calendar size={12} strokeWidth={1.75} />} label="Period"
                value={<span style={{ fontVariantNumeric: 'tabular-nums' }}><strong style={{ fontWeight: 600 }}>{start}</strong> <span style={{ color: 'var(--text-muted)' }}>→</span> <strong style={{ fontWeight: 600 }}>{end}</strong></span>} />
              <InfoField icon={<Activity size={12} strokeWidth={1.75} />} label="Opening balance (HTG)"
                value={balances.opening === null
                  ? <Dash />
                  : <span style={{ color: 'var(--data-value)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtHTG(balances.opening)}</span>} />
              <InfoField icon={<Activity size={12} strokeWidth={1.75} />} label="Closing balance (HTG)"
                value={balances.closing === null
                  ? <Dash />
                  : <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtHTG(balances.closing)}</span>} />
            </div>
          </div>
        )}

        {/* ── STATS STRIP · operational ledger row ── */}
        {submittedMsisdn && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 'var(--space-3)', marginTop: 'var(--space-4)',
          }}>
            <StatCard label="Transactions"      value={fmtNum(stats.count)}       accent="var(--text-primary)" />
            <StatCard label="Credits"           value={fmtNum(stats.credits)}     accent="var(--positive)" />
            <StatCard label="Debits"            value={fmtNum(stats.debits)}      accent="var(--negative)" />
            <StatCard label="Total amount (HTG)" value={fmtHTG(stats.totalAmount)} accent="var(--data-subs)" />
            <StatCard label="Total fees (HTG)"   value={fmtHTG(stats.totalFee)}    accent="var(--data-volume)" />
          </div>
        )}

        {/* ── TABLE · newspaper-style header, hairline rows ── */}
        <div style={{
          marginTop: 'var(--space-4)',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontSize: 'var(--fs-body)', minWidth: '1900px',
            }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface-muted)' }}>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {[
                    { label: 'Date',         w: '140px', align: 'left'  },
                    { label: 'Tx ID',        w: '120px', align: 'left'  },
                    { label: 'Side',         w: '90px',  align: 'left'  },
                    { label: 'Service',      w: '160px', align: 'left'  },
                    { label: 'Channel',      w: '90px',  align: 'left'  },
                    { label: 'Status',       w: '110px', align: 'left'  },
                    { label: 'Debitor',      w: '140px', align: 'left'  },
                    { label: 'Debitor name', w: '160px', align: 'left'  },
                    { label: 'Creditor',     w: '140px', align: 'left'  },
                    { label: 'Creditor name',w: '160px', align: 'left'  },
                    { label: 'Amount',       w: '120px', align: 'right' },
                    { label: 'Fee',          w: '90px',  align: 'right' },
                    { label: 'Bal. before',  w: '140px', align: 'right' },
                    { label: 'Bal. after',   w: '140px', align: 'right' },
                    { label: 'Reason',       w: '120px', align: 'left'  },
                  ].map(col => (
                    <th key={col.label} style={{
                      padding: 'var(--space-3) var(--space-3)',
                      textAlign: col.align as any,
                      fontSize: 'var(--fs-micro)', fontWeight: 500,
                      textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                      color: 'var(--text-tertiary)',
                      minWidth: col.w, whiteSpace: 'nowrap',
                    }}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!submittedMsisdn ? (
                  <tr><td colSpan={15} style={{ padding: 'var(--space-16) 0', textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Enter a <strong>{localIdentityType === 'Organization' ? 'shortcode' : 'MSISDN'}</strong> and click Search to load the history.
                    </div>
                  </td></tr>
                ) : busy ? (
                  <tr><td colSpan={15} style={{ padding: 'var(--space-16) 0', textAlign: 'center' }}>
                    <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                    <div style={{ fontWeight: 500, color: 'var(--text-secondary)', fontSize: 'var(--fs-body)' }}>
                      Loading transaction history
                    </div>
                  </td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={15} style={{ padding: 'var(--space-16) 0', textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      No transactions for <span style={{ fontFamily: 'ui-monospace, monospace' }}>{submittedMsisdn}</span> in this period.
                    </div>
                  </td></tr>
                ) : rows.map((r: any, idx: number) => {
                  const isCredit = r.SIDE === 'CREDIT'
                  const isStatusCompleted = r.TRANS_STATUS === 'Completed'
                  const statusColor = isStatusCompleted ? 'var(--positive)' : (STATUS_COLOR[r.TRANS_STATUS] ? 'var(--text-tertiary)' : 'var(--text-tertiary)')
                  return (
                    <tr key={(r.TR_ID ?? '') + idx} style={{
                      borderBottom: '1px solid var(--border-faint)',
                      background: idx % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-muted)',
                    }}>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {formatDateTime(r.TRANSACTION_DATE)}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'ui-monospace, monospace', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                        {r.TR_ID}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
                          color: isCredit ? 'var(--positive)' : 'var(--negative)',
                          fontWeight: 500, fontSize: 'var(--fs-label)',
                        }}>
                          {isCredit ? <ArrowDownCircle size={11} strokeWidth={1.75} /> : <ArrowUpCircle size={11} strokeWidth={1.75} />}
                          {r.SIDE}
                        </span>
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-primary)' }}>{r.SERVICENAME || '—'}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-tertiary)' }}>{r.TR_CHANNEL || '—'}</td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                          color: statusColor, fontWeight: 500,
                        }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor }} />
                          {r.TRANS_STATUS}
                        </span>
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-3)',
                        fontFamily: 'ui-monospace, monospace',
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        fontWeight: (r.DEBITOR === submittedMsisdn) ? 700 : 500,
                      }}>
                        {r.DEBITOR || '—'}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>
                        {r.DEBITPARTYNAME || '—'}
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-3)',
                        fontFamily: 'ui-monospace, monospace',
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        fontWeight: (r.CREDITOR === submittedMsisdn) ? 700 : 500,
                      }}>
                        {r.CREDITOR || '—'}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>
                        {r.CREDITPARTYNAME || '—'}
                      </td>
                      <td style={{
                        padding: 'var(--space-2) var(--space-3)', textAlign: 'right',
                        fontWeight: 600, color: isCredit ? 'var(--positive)' : 'var(--negative)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {isCredit ? '+' : '−'}{fmtHTG(r.AMOUNT)}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtHTG(r.FEE)}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtHTG(r.BAL_BEFORE)}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtHTG(r.BAL_AFTER)}
                      </td>
                      <td style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--fs-label)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                        {r.REASONTYPE || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {submittedMsisdn && (
          <div style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--fs-label)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {localIdentityType === 'Organization' ? 'Shortcode' : 'MSISDN'} <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{submittedMsisdn}</strong>
            <span style={{ color: 'var(--text-muted)' }}> · </span>
            <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{start}</strong> → <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{end}</strong>
            <span style={{ color: 'var(--text-muted)' }}> · status </span>
            <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{status}</strong>
            <span style={{ color: 'var(--text-muted)' }}> · </span>
            <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{rows.length}</strong> rows
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

function Dash() {
  return <span style={{ color: 'var(--text-muted)' }}>—</span>
}

function InfoField({ icon, label, value }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
        color: 'var(--text-tertiary)',
      }}>
        {icon}
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 500,
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
        }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: 'var(--fs-body)', fontWeight: 500,
        color: 'var(--text-primary)',
        lineHeight: 1.4, wordBreak: 'break-word',
      }}>
        {value}
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }: any) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
    }}>
      <span style={{
        position: 'absolute', left: 0, top: 'var(--space-2)', bottom: 'var(--space-2)',
        width: '2px', background: accent, borderRadius: '0 1px 1px 0',
      }} />
      <span style={{
        fontSize: 'var(--fs-micro)', fontWeight: 500,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
        color: 'var(--text-tertiary)',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 'var(--fs-lg)', fontWeight: 600,
        color: 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 'var(--tracking-tight)',
        lineHeight: 1,
      }}>
        {value}
      </span>
    </div>
  )
}
