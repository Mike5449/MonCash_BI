import { useState, useMemo } from "react"
import {
  Calendar, RefreshCw, Package, MapPin, Smartphone,
  Users as UsersIcon, BarChart3, Wallet, DollarSign,
  TrendingUp, TrendingDown, Minus, History, LineChart as LineChartIcon,
  PieChart as PieChartIcon, X,
} from "lucide-react"
import {
  ResponsiveContainer,
  Tooltip,
  XAxis, YAxis, CartesianGrid,
  Line, LineChart,
  PieChart, Pie, Cell,
} from "recharts"
import { DashboardLayout } from "../components/Layout/DashboardLayout"
import {
  useMtdByDepartment, useMtdByChannel, useMtdSnapshotByType,
  useMonthlyTotals, useDailyTotals, useDailyStatsByChannel,
  usePeriodAggregatesByDimension,
} from "../hooks/useAnalytics"
import "../premium.css"

type Tab = 'products' | 'departments' | 'channels'

// Labels lisibles pour les TR_TYPE (mêmes codes que dans le Snapshot MTD).
// Une seule entrée par TR_TYPE — `CASHIN_OTC` est l'identifiant officiel,
// l'ancien doublon 'Cash In OTC' (qui ne mappait à aucun TR_TYPE réel et
// renvoyait toujours 0) a été retiré.
const TR_TYPE_LABELS: Record<string, string> = {
  CASHIN: 'Cash In',
  CASHIN_OTC: 'Cash In OTC',
  CASHOUT: 'Cash Out',
  P2P_SEND: 'P2P Send',
  P2P_RECEIVE: 'P2P Receive',
  PAY2MERC: 'Pay to Merchant',
  BILLPAY: 'Bill Payment',
  DIGI_PRODUCT: 'Digicel Products',
  TOPUP_GIFT: 'Top-up Gift',
  SELF_TOPUP: 'Top-up Self',
  IMT: 'IMT Receive',
  B2W: 'B2W (Prefunded)',
  PREFUNDED: 'Prefunded',
  W2B: 'Wallet to Bank',
  'Payroll | disbursements': 'Payroll / Disbursements',
}

const todayMinus1 = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

// Ink-toned palette for per-channel lines on the trends charts
const CHANNEL_PALETTE = [
  '#1e3a8a',  // deep ink blue
  '#15803d',  // ink green
  '#b45309',  // ink amber
  '#7c2d12',  // ink rust
  '#5b21b6',  // ink violet
  '#0e7490',  // ink teal
  '#831843',  // ink magenta
  '#374151',  // ink graphite
]
const channelColor = (_name: string, idx: number) => CHANNEL_PALETTE[idx % CHANNEL_PALETTE.length] || '#374151'

const fmtNum = (v: any) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const fmtMoney = (v: any) => {
  const n = Number(v ?? 0)
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + ' M'
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + ' K'
  return n.toFixed(0)
}

const fmtPct = (v: number) =>
  (v >= 0 ? '+' : '') + v.toFixed(1) + '%'

const variation = (prev: number, curr: number): number => {
  if (!prev && !curr) return 0
  if (!prev) return 100
  return ((curr - prev) / prev) * 100
}

export default function Home() {
  const [reportDate, setReportDate] = useState<string>(todayMinus1())
  const [tab, setTab] = useState<Tab>('products')
  const [historyMonths, setHistoryMonths] = useState<6 | 12 | 24>(12)
  // Filtres pour les 4 line charts journaliers
  const [selectedProducts,    setSelectedProducts]    = useState<string[]>([])
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([])
  const [selectedChannels,    _setSelectedChannels]   = useState<string[]>([])
  // Visibility per-channel (toggleable in the channels tab)
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set())

  // Daily Trends — preset (7/30/60/90) or custom range
  type DailyPreset = '7' | '30' | '60' | '90' | 'custom'
  const [dailyPreset, setDailyPreset] = useState<DailyPreset>('30')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd,   setCustomEnd]   = useState<string>('')

  // ── Percent-breakdown modal ──
  // 'daily' = composition sur la fenêtre quotidienne sélectionnée
  // 'mtd'   = composition sur le MTD courant
  const [percentModal, setPercentModal] = useState<null | 'daily' | 'mtd'>(null)

  // Per-department snapshot (toujours non-filtré — donne la liste des départements)
  const depts    = useMtdByDepartment({ reportDate })
  // Per-channel snapshot (toujours non-filtré — donne la liste des canaux pour le toggle)
  const channels = useMtdByChannel({ reportDate })

  // ── Canaux visibles → filtre actif sur l'onglet Channels ──
  // Le tab Channels n'utilise pas `selectedChannels` mais bien `hiddenChannels`
  // (toggle de visibilité). On dérive donc la liste visible = univers - cachés.
  // Si tout est visible (hiddenChannels vide), on n'envoie PAS de filtre → snapshot
  // cross-channel complet. Si tout est caché, idem (sinon les cards montreraient 0).
  const channelOptions = useMemo<string[]>(() => {
    const rows = (channels.data?.rows as any[]) ?? []
    return rows
      .map((r: any) => String(r.CHANNEL ?? '').trim())
      .filter(Boolean)
  }, [channels.data])

  const visibleChannelsFilter = useMemo<string[] | undefined>(() => {
    if (tab !== 'channels') return undefined
    if (channelOptions.length === 0) return undefined
    if (hiddenChannels.size === 0) return undefined          // tout visible = pas de filtre
    const visible = channelOptions.filter(ch => !hiddenChannels.has(ch))
    if (visible.length === 0) return undefined                // tout caché = on garde le total
    if (visible.length === channelOptions.length) return undefined
    return visible
  }, [tab, channelOptions, hiddenChannels])

  // SOURCE DE VÉRITÉ : snapshot MTD (par TR_TYPE, avec PREV et CURR).
  // Tous les filtres de l'onglet actif sont poussés au backend → les totaux
  // (current_total / prev_total) sont recalculés sur la base filtrée, avec
  // SUBS = COUNT(DISTINCT MSISDN) cross-TR_TYPE garanti côté SQL.
  const snapshot = useMtdSnapshotByType({
    reportDate,
    serviceNames: tab === 'products'    ? selectedProducts    : undefined,
    channels:     visibleChannelsFilter,
    departments:  tab === 'departments' ? selectedDepartments : undefined,
  })

  // HISTORIQUE — MTD jusqu'au même day-of-month sur les N derniers mois
  // Parse manuel pour éviter les décalages de fuseau horaire (new Date('YYYY-MM-DD')
  // est interprété comme UTC, puis getDate() renvoie en local → décalage de ±1 jour)
  const { year: rYear, month: rMonth, day: dayOfMonth } = useMemo(() => {
    const [y, m, d] = (reportDate || '').split('-').map(Number)
    return { year: y || 1970, month: m || 1, day: d || 1 }
  }, [reportDate])

  const historyRange = useMemo(() => {
    // endMonth = 1er du mois courant
    const pad = (n: number) => String(n).padStart(2, '0')
    const endMonth = `${rYear}-${pad(rMonth)}-01`
    // startMonth = (historyMonths - 1) mois en arrière
    let sY = rYear
    let sM = rMonth - (historyMonths - 1)
    while (sM <= 0) { sM += 12; sY -= 1 }
    const startMonth = `${sY}-${pad(sM)}-01`
    return { startMonth, endMonth }
  }, [rYear, rMonth, historyMonths])

  const history = useMonthlyTotals({
    startMonth:   historyRange.startMonth,
    endMonth:     historyRange.endMonth,
    dayOfMonth:   dayOfMonth,
    serviceNames: tab === 'products'    ? selectedProducts    : undefined,
    departments:  tab === 'departments' ? selectedDepartments : undefined,
    channels:     tab === 'channels'    ? selectedChannels    : undefined,
  })

  // DAILY TRENDS — preset (last N days ending at reportDate) or custom range
  const dailyRange = useMemo(() => {
    if (dailyPreset === 'custom' && customStart && customEnd) {
      return { start: customStart, end: customEnd }
    }
    const days = parseInt(dailyPreset === 'custom' ? '30' : dailyPreset, 10)
    const end = new Date(reportDate)
    const start = new Date(reportDate)
    start.setDate(start.getDate() - (days - 1))
    return {
      start: start.toISOString().split('T')[0],
      end:   end.toISOString().split('T')[0],
    }
  }, [reportDate, dailyPreset, customStart, customEnd])

  const dailyStats = useDailyTotals({
    startDate:    dailyRange.start,
    endDate:      dailyRange.end,
    serviceNames: tab === 'products'    ? selectedProducts    : undefined,
    departments:  tab === 'departments' ? selectedDepartments : undefined,
    channels:     tab === 'channels'    ? selectedChannels    : undefined,
  })

  // Per-channel daily breakdown — only fetched when channels tab is active
  const dailyByChannel = useDailyStatsByChannel({
    startDate: dailyRange.start,
    endDate:   dailyRange.end,
    channels:  selectedChannels.length > 0 ? selectedChannels : undefined,
    enabled:   tab === 'channels',
  })

  // Pivot: list of channel names + array of { date, ch1: v, ch2: v, ... } per metric
  const channelPivot = useMemo(() => {
    const rows = ((dailyByChannel.data as any[]) ?? [])
    const channelSet = new Set<string>()
    const dateSet = new Set<string>()
    const acc: Record<string, Record<string, { SUBS: number, VOLUME: number, VALUE: number, REVENUE: number }>> = {}

    for (const r of rows) {
      const dRaw = r.TRANSACTION_DATE
      const d = String(dRaw ?? '').slice(0, 10)
      const ch = String(r.CHANNEL ?? 'Unknown').trim() || 'Unknown'
      if (!d) continue
      dateSet.add(d); channelSet.add(ch)
      if (!acc[d]) acc[d] = {}
      acc[d][ch] = {
        SUBS:    Number(r.SUBS    ?? 0),
        VOLUME:  Number(r.VOLUME  ?? 0),
        VALUE:   Number(r.VALUE   ?? 0),
        REVENUE: Number(r.REVENUE ?? 0),
      }
    }

    const sortedDates = Array.from(dateSet).sort()
    // Sort channels by total VALUE desc (biggest first)
    const channelTotals: Record<string, number> = {}
    for (const ch of channelSet) {
      channelTotals[ch] = sortedDates.reduce((sum, d) => sum + (acc[d]?.[ch]?.VALUE ?? 0), 0)
    }
    const sortedChannels = Array.from(channelSet).sort((a, b) => (channelTotals[b] ?? 0) - (channelTotals[a] ?? 0))

    const buildSeries = (metric: 'SUBS' | 'VOLUME' | 'VALUE' | 'REVENUE') =>
      sortedDates.map(d => {
        const row: any = { DATE: d }
        for (const ch of sortedChannels) {
          row[ch] = acc[d]?.[ch]?.[metric] ?? null
        }
        return row
      })

    return {
      channels: sortedChannels,
      series: {
        SUBS:    buildSeries('SUBS'),
        VOLUME:  buildSeries('VOLUME'),
        VALUE:   buildSeries('VALUE'),
        REVENUE: buildSeries('REVENUE'),
      },
    }
  }, [dailyByChannel.data])

  const dailyAggregated = useMemo(() => {
    return ((dailyStats.data as any[]) ?? [])
      .map((r: any) => ({
        DATE:    String(r.TRANSACTION_DATE ?? '').slice(0, 10),
        SUBS:    Number(r.SUBS    ?? 0),
        VOLUME:  Number(r.VOLUME  ?? 0),
        VALUE:   Number(r.VALUE   ?? 0),
        REVENUE: Number(r.REVENUE ?? 0),
      }))
      .filter(r => r.DATE)
      .sort((a, b) => a.DATE.localeCompare(b.DATE))
  }, [dailyStats.data])

  const busy = snapshot.isFetching || depts.isFetching || channels.isFetching
  const refresh = () => {
    snapshot.refetch(); depts.refetch(); channels.refetch();
    history.refetch(); dailyStats.refetch(); dailyByChannel.refetch()
  }

  const snapRows:    any[] = snapshot.data?.rows ?? []
  const deptRows:    any[] = depts.data?.rows    ?? []
  const channelRows: any[] = channels.data?.rows ?? []

  // ROWS PRODUITS = snapshot remapé en format unifié
  const productRows = useMemo(() => snapRows.map((r: any) => ({
    NAME:    TR_TYPE_LABELS[r.TR_TYPE] || r.TR_TYPE,
    SUBS:    Number(r.CURR_SUBS    ?? 0),
    VOLUME:  Number(r.CURR_VOLUME  ?? 0),
    VALUE:   Number(r.CURR_VALUE   ?? 0),
    REVENUE: Number(r.CURR_REVENUE ?? 0),
    // Pour les KPI prev
    PREV_SUBS:    Number(r.PREV_SUBS    ?? 0),
    PREV_VOLUME:  Number(r.PREV_VOLUME  ?? 0),
    PREV_VALUE:   Number(r.PREV_VALUE   ?? 0),
    PREV_REVENUE: Number(r.PREV_REVENUE ?? 0),
  })), [snapRows])

  // ROWS DEPARTMENTS — même format unifié
  const departmentRows = useMemo(() => deptRows.map((r: any) => ({
    NAME:    r.DEPARTMENT,
    SUBS:    Number(r.SUBS    ?? 0),
    VOLUME:  Number(r.VOLUME  ?? 0),
    VALUE:   Number(r.VALUE   ?? 0),
    REVENUE: Number(r.REVENUE ?? 0),
  })), [deptRows])

  // ROWS CHANNELS — même format unifié
  const channelRowsUnified = useMemo(() => channelRows.map((r: any) => ({
    NAME:    r.CHANNEL,
    SUBS:    Number(r.SUBS    ?? 0),
    VOLUME:  Number(r.VOLUME  ?? 0),
    VALUE:   Number(r.VALUE   ?? 0),
    REVENUE: Number(r.REVENUE ?? 0),
  })), [channelRows])

  // KPI TOTALS — utilise les totaux cross-TR_TYPE renvoyés par le backend :
  // - SUBS    = COUNT(DISTINCT MSISDN) cross-types (vrai unique, pas de double-comptage)
  // - VOLUME / VALUE / REVENUE = somme cross-TR_TYPE (cohérent avec Snapshot MTD)
  const totals = useMemo(() => {
    const t = (snapshot.data as any)?.current_total
    if (t) {
      return {
        SUBS:    Number(t.SUBS    ?? 0),
        VOLUME:  Number(t.VOLUME  ?? 0),
        VALUE:   Number(t.VALUE   ?? 0),
        REVENUE: Number(t.REVENUE ?? 0),
      }
    }
    // Fallback (anciens backends sans current_total) : somme des rows
    const sum = (k: keyof typeof productRows[number]) =>
      productRows.reduce((acc, r) => acc + Number(r[k] ?? 0), 0)
    return { SUBS: sum('SUBS'), VOLUME: sum('VOLUME'), VALUE: sum('VALUE'), REVENUE: sum('REVENUE') }
  }, [snapshot.data, productRows])

  const prevTotals = useMemo(() => {
    const t = (snapshot.data as any)?.prev_total
    if (t) {
      return {
        SUBS:    Number(t.SUBS    ?? 0),
        VOLUME:  Number(t.VOLUME  ?? 0),
        VALUE:   Number(t.VALUE   ?? 0),
        REVENUE: Number(t.REVENUE ?? 0),
      }
    }
    // Fallback
    const sum = (k: keyof typeof productRows[number]) =>
      productRows.reduce((acc, r) => acc + Number(r[k] ?? 0), 0)
    return {
      SUBS:    sum('PREV_SUBS' as any),
      VOLUME:  sum('PREV_VOLUME' as any),
      VALUE:   sum('PREV_VALUE' as any),
      REVENUE: sum('PREV_REVENUE' as any),
    }
  }, [snapshot.data, productRows])

  const currentRows = tab === 'products' ? productRows
                    : tab === 'departments' ? departmentRows
                    : channelRowsUnified

  // ── Daily breakdown par dimension (pour le modal "% Daily") ──
  // SUBS DISTINCT GARANTI : un appel server-side dédié calcule
  // COUNT(DISTINCT MSISDN) sur la FENÊTRE ENTIÈRE (pas la somme des distincts journaliers).
  // On ne lance le fetch QUE quand le modal Daily est ouvert pour économiser une query.
  const periodDimension: 'TR_TYPE' | 'CHANNEL' | 'DEPARTMENT' =
    tab === 'products'    ? 'TR_TYPE'
    : tab === 'channels'  ? 'CHANNEL'
    : 'DEPARTMENT'

  const periodAggregates = usePeriodAggregatesByDimension({
    startDate: dailyRange.start,
    endDate:   dailyRange.end,
    dimension: periodDimension,
    serviceNames: tab === 'products'    ? selectedProducts    : undefined,
    channels:     tab === 'channels'    ? visibleChannelsFilter : undefined,
    departments:  tab === 'departments' ? selectedDepartments : undefined,
    enabled:      percentModal === 'daily',
  })

  const dailyByDimensionRows = useMemo(() => {
    const rows = (periodAggregates.data as any[]) ?? []
    return rows.map((r: any) => {
      const raw = String(r.DIM_VALUE ?? '').trim()
      // Pour les TR_TYPE, on remappe vers le label lisible (Cash In, P2P Send, …)
      const name = periodDimension === 'TR_TYPE'
        ? (TR_TYPE_LABELS[raw] || raw || 'Unknown')
        : (raw || 'Unknown')
      return {
        NAME:    name,
        SUBS:    Number(r.SUBS    ?? 0),
        VOLUME:  Number(r.VOLUME  ?? 0),
        VALUE:   Number(r.VALUE   ?? 0),
        REVENUE: Number(r.REVENUE ?? 0),
      }
    })
  }, [periodAggregates.data, periodDimension])

  // HISTORICAL — déjà clean par mois côté backend (SUBS = DISTINCT MSISDN du mois)
  const monthlyTotals = useMemo(() => {
    return ((history.data as any[]) ?? [])
      .map((r: any) => ({
        MONTH:   String(r.MONTH ?? ''),
        SUBS:    Number(r.SUBS    ?? 0),
        VOLUME:  Number(r.VOLUME  ?? 0),
        VALUE:   Number(r.VALUE   ?? 0),
        REVENUE: Number(r.REVENUE ?? 0),
      }))
      .filter(r => r.MONTH)
      .sort((a, b) => a.MONTH.localeCompare(b.MONTH))
  }, [history.data])

  const period = `${snapshot.data?.current_start ?? '—'} → ${snapshot.data?.current_end ?? reportDate}`
  const prevPeriod = `${snapshot.data?.prev_start ?? '—'} → ${snapshot.data?.prev_end ?? '—'}`

  return (
    <DashboardLayout>
      <div>

        {/* ── HERO · title + toolbar on canvas, separated by hairline ── */}
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
              MonCash · BI Analytics
            </div>
            <h1 style={{
              margin: 0,
              fontSize: 'var(--fs-xl)', fontWeight: 600,
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--text-primary)', lineHeight: 1.15,
            }}>
              Activity Dashboard
            </h1>
            <p style={{
              margin: 'var(--space-2) 0 0',
              fontSize: 'var(--fs-body)', color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              MTD <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{period}</span>
              <span style={{ color: 'var(--text-muted)', margin: '0 var(--space-2)' }}>·</span>
              vs <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{prevPeriod}</span>
            </p>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: '0 var(--space-3)', height: '34px',
              fontSize: 'var(--fs-label)', color: 'var(--text-secondary)',
            }}>
              <Calendar size={13} strokeWidth={1.75} />
              <span style={{ fontWeight: 500 }}>As of</span>
              <input
                type="date"
                value={reportDate}
                max={todayMinus1()}
                onChange={(e) => setReportDate(e.target.value)}
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
            </label>
            <button onClick={refresh} disabled={busy} title="Refresh"
              style={{
                background: 'var(--surface-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                height: '34px', padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontWeight: 500, fontSize: 'var(--fs-body)',
                cursor: busy ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                opacity: busy ? 0.6 : 1,
                transition: 'background 0.12s ease',
              }}>
              <RefreshCw size={13} strokeWidth={1.75} className={busy ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── KPI STRIP — operational ledger row ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 'var(--space-3)',
        }}>
          <KpiCard label="Subscribers"   curr={totals.SUBS}    prev={prevTotals.SUBS}    accent="var(--data-subs)" />
          <KpiCard label="Volume"        curr={totals.VOLUME}  prev={prevTotals.VOLUME}  accent="var(--data-volume)" />
          <KpiCard label="Value (HTG)"   curr={totals.VALUE}   prev={prevTotals.VALUE}   accent="var(--data-value)"   money />
          <KpiCard label="Revenue (HTG)" curr={totals.REVENUE} prev={prevTotals.REVENUE} accent="var(--data-revenue)" money />
        </div>

        <div style={{
          marginTop: 'var(--space-2)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap',
          fontSize: 'var(--fs-label)',
          color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {(() => {
            const productsActive = tab === 'products'    && selectedProducts.length > 0
            const channelsActive = tab === 'channels'    && !!visibleChannelsFilter
            const deptActive     = tab === 'departments' && selectedDepartments.length > 0
            const filterActive   = productsActive || channelsActive || deptActive

            if (filterActive) {
              const channelsCount = visibleChannelsFilter?.length ?? 0
              const label =
                productsActive ? `${selectedProducts.length} product${selectedProducts.length > 1 ? 's' : ''}` :
                channelsActive ? `${channelsCount} channel${channelsCount > 1 ? 's' : ''}` :
                /* deptActive */ `${selectedDepartments.length} department${selectedDepartments.length > 1 ? 's' : ''}`
              return (
                <>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '2px var(--space-2)',
                    border: '1px solid var(--brand)',
                    background: 'rgba(227, 27, 35, 0.06)',
                    color: 'var(--brand)',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: 'var(--fs-micro)', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                  }}>Filter active</span>
                  <span>
                    Cards reflect MTD totals for <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{label}</strong> — Subs is DISTINCT MSISDN computed server-side.
                  </span>
                </>
              )
            }
            return <span>MTD totals · matches Snapshot MTD · P2P transactions count on both send + receive sides.</span>
          })()}
        </div>

        {/* ── TABS · bottom-border navigation, anchored to canvas, right-aligned ── */}
        <div style={{
          marginTop: 'var(--space-6)',
          display: 'flex', alignItems: 'flex-end',
          gap: 'var(--space-6)',
          borderBottom: '1px solid var(--border-default)',
          justifyContent: 'flex-end',
        }}>
          <TabButton active={tab === 'products'}    onClick={() => setTab('products')}    icon={<Package size={13} />}    label="By Product"    count={productRows.length} />
          <TabButton active={tab === 'departments'} onClick={() => setTab('departments')} icon={<MapPin size={13} />}     label="By Department" count={departmentRows.length} />
          <TabButton active={tab === 'channels'}    onClick={() => setTab('channels')}    icon={<Smartphone size={13} />} label="By Channel"    count={channelRowsUnified.length} />
        </div>

        {busy && currentRows.length === 0 ? (
          <div style={{
            marginTop: 'var(--space-6)',
            padding: 'var(--space-12) 0',
            textAlign: 'center',
            color: 'var(--text-tertiary)',
          }}>
            <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
            <div style={{ fontWeight: 500, color: 'var(--text-secondary)', fontSize: 'var(--fs-body)' }}>
              Loading dashboard
            </div>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              Aggregating transactions, please wait
            </div>
          </div>
        ) : currentRows.length === 0 ? (
          <div style={{
            marginTop: 'var(--space-6)',
            padding: 'var(--space-12) 0',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: 'var(--fs-md)', fontWeight: 600,
              color: 'var(--text-secondary)',
            }}>
              No data for this month
            </div>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              Try a different report date
            </div>
          </div>
        ) : (
          <>
            {/* ── DAILY TRENDS · presets or custom range · tab-aware filter ── */}
            <div style={{ marginTop: 'var(--space-6)' }}>
              <SectionHeader
                icon={<LineChartIcon size={15} strokeWidth={1.75} />}
                title="Daily Trends"
                subtitle={`${dailyPreset === 'custom' ? 'Custom range' : `Last ${dailyPreset} days`} · ${tab === 'products' ? 'by product' : tab === 'departments' ? 'by department' : 'by channel'}`}
                badge={`${dailyRange.start} → ${dailyRange.end}`}
                loading={dailyStats.isFetching}
                action={<PercentButton label="% Breakdown" onClick={() => setPercentModal('daily')} />}
              />

              {/* ── RANGE CONTROL · presets + custom ── */}
              <div style={{
                marginBottom: 'var(--space-3)',
                display: 'flex', alignItems: 'center', flexWrap: 'wrap',
                gap: 'var(--space-3)',
              }}>
                <div style={{
                  display: 'inline-flex',
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '3px',
                  gap: '2px',
                }}>
                  {(['7', '30', '60', '90', 'custom'] as DailyPreset[]).map(opt => {
                    const active = dailyPreset === opt
                    return (
                      <button key={opt}
                        onClick={() => {
                          if (opt === 'custom' && (!customStart || !customEnd)) {
                            // Seed custom with current preset range
                            setCustomStart(dailyRange.start)
                            setCustomEnd(dailyRange.end)
                          }
                          setDailyPreset(opt)
                        }}
                        style={{
                          padding: '0 var(--space-3)', height: '28px',
                          borderRadius: 'var(--radius-xs)',
                          border: 'none',
                          background: active ? 'var(--surface-card)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                          fontWeight: active ? 600 : 500,
                          fontSize: 'var(--fs-label)',
                          cursor: 'pointer',
                          transition: 'background 0.12s, color 0.12s',
                          boxShadow: active ? '0 0 0 1px var(--border-default) inset' : 'none',
                        }}>
                        {opt === 'custom' ? 'Custom' : `${opt}d`}
                      </button>
                    )
                  })}
                </div>

                {dailyPreset === 'custom' && (
                  <>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    }}>
                      <span style={{
                        fontSize: 'var(--fs-micro)', fontWeight: 600,
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: 'var(--tracking-uppercase)',
                      }}>From</span>
                      <div style={{
                        position: 'relative',
                        display: 'flex', alignItems: 'center',
                        background: 'var(--surface-card)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                      }}>
                        <Calendar size={12} strokeWidth={1.75} color="var(--text-tertiary)"
                          style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
                        <input type="date"
                          value={customStart}
                          max={customEnd || todayMinus1()}
                          onChange={(e) => setCustomStart(e.target.value)}
                          style={{
                            height: '32px', width: '150px',
                            paddingLeft: '30px', paddingRight: 'var(--space-2)',
                            border: 'none', background: 'transparent', outline: 'none',
                            fontWeight: 500, fontSize: 'var(--fs-body)',
                            fontVariantNumeric: 'tabular-nums',
                            color: 'var(--text-primary)',
                          }} />
                      </div>
                    </div>

                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    }}>
                      <span style={{
                        fontSize: 'var(--fs-micro)', fontWeight: 600,
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: 'var(--tracking-uppercase)',
                      }}>To</span>
                      <div style={{
                        position: 'relative',
                        display: 'flex', alignItems: 'center',
                        background: 'var(--surface-card)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                      }}>
                        <Calendar size={12} strokeWidth={1.75} color="var(--text-tertiary)"
                          style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
                        <input type="date"
                          value={customEnd}
                          min={customStart}
                          max={todayMinus1()}
                          onChange={(e) => setCustomEnd(e.target.value)}
                          style={{
                            height: '32px', width: '150px',
                            paddingLeft: '30px', paddingRight: 'var(--space-2)',
                            border: 'none', background: 'transparent', outline: 'none',
                            fontWeight: 500, fontSize: 'var(--fs-body)',
                            fontVariantNumeric: 'tabular-nums',
                            color: 'var(--text-primary)',
                          }} />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* FILTER — depending on active tab */}
              {tab === 'products' ? (
                <MultiSelectChips
                  label="Products"
                  options={Object.entries(TR_TYPE_LABELS)
                    // dedupe : certaines clés différentes mappent le même label
                    .reduce<{ id: string; label: string }[]>((acc, [id, lab]) => {
                      if (!acc.some(o => o.id === id)) acc.push({ id, label: lab })
                      return acc
                    }, [])
                    .sort((a, b) => a.label.localeCompare(b.label))}
                  selected={selectedProducts}
                  onChange={setSelectedProducts}
                  placeholderAll="All products"
                />
              ) : tab === 'departments' ? (
                <MultiSelectChips
                  label="Departments"
                  options={[...deptRows]
                    .map((r: any) => String(r.DEPARTMENT ?? '').trim())
                    .filter(Boolean)
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .sort()
                    .map(d => ({ id: d, label: d }))}
                  selected={selectedDepartments}
                  onChange={setSelectedDepartments}
                  placeholderAll="All departments"
                />
              ) : (
                <ChannelToggleChips
                  channels={channelPivot.channels}
                  hidden={hiddenChannels}
                  setHidden={setHiddenChannels}
                  loading={dailyByChannel.isFetching}
                />
              )}

              <div style={{
                marginTop: 'var(--space-3)',
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: 'var(--space-3)',
              }}>
                {[
                  { key: 'SUBS',    title: 'Subscribers',  subtitle: 'distinct MSISDN per day',    color: 'var(--data-subs)',    icon: <UsersIcon size={13} strokeWidth={1.75} />,  isMoney: false },
                  { key: 'VOLUME',  title: 'Volume',       subtitle: 'transactions per day',        color: 'var(--data-volume)',  icon: <BarChart3 size={13} strokeWidth={1.75} />,  isMoney: false },
                  { key: 'VALUE',   title: 'Value (HTG)',  subtitle: 'total amount per day',        color: 'var(--data-value)',   icon: <Wallet size={13} strokeWidth={1.75} />,     isMoney: true  },
                  { key: 'REVENUE', title: 'Revenue (HTG)', subtitle: 'total revenue per day',      color: 'var(--data-revenue)', icon: <DollarSign size={13} strokeWidth={1.75} />, isMoney: true  },
                ].map((c) => {
                  const isChannelMode = tab === 'channels'
                  const chartData = isChannelMode
                    ? (channelPivot.series as any)[c.key]
                    : dailyAggregated
                  const visibleChannels = isChannelMode
                    ? channelPivot.channels.filter(ch => !hiddenChannels.has(ch))
                    : []
                  return (
                    <ChartCard key={c.key} icon={c.icon} title={c.title} subtitle={isChannelMode ? `per channel · ${visibleChannels.length} visible` : c.subtitle}>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="2 4" stroke="rgba(15,23,42,0.06)" />
                          <XAxis
                            dataKey="DATE"
                            tickFormatter={(v: string) => (v ? v.slice(5) : '')}
                            style={{ fontSize: '10px', fontWeight: 500, fill: 'var(--text-tertiary)' }}
                            stroke="rgba(15,23,42,0.12)"
                            tickLine={false}
                            interval="preserveStartEnd"
                            minTickGap={24}
                          />
                          <YAxis
                            tickFormatter={(v) => (c.isMoney ? fmtMoney(v) : fmtNum(v))}
                            style={{ fontSize: '10px', fontWeight: 500, fill: 'var(--text-tertiary)' }}
                            stroke="rgba(15,23,42,0.12)"
                            tickLine={false}
                            axisLine={false}
                            width={52}
                          />
                          <Tooltip
                            formatter={(value: any) => (c.isMoney ? fmtMoney(value) + ' HTG' : fmtNum(value))}
                            labelFormatter={(label: any) => `${label}`}
                            contentStyle={{
                              background: 'var(--text-primary)',
                              border: 'none', borderRadius: 'var(--radius-md)',
                              fontSize: 'var(--fs-label)', padding: 'var(--space-2) var(--space-3)',
                            }}
                            itemStyle={{ color: 'white' }}
                            labelStyle={{ color: 'rgba(255,255,255,0.6)', fontWeight: 500, marginBottom: '2px' }}
                            cursor={{ stroke: 'rgba(15,23,42,0.18)', strokeWidth: 1 }}
                          />
                          {isChannelMode
                            ? visibleChannels.map((ch) => {
                                const colorIdx = channelPivot.channels.indexOf(ch)
                                return (
                                  <Line
                                    key={ch}
                                    type="monotone"
                                    dataKey={ch}
                                    name={ch}
                                    stroke={channelColor(ch, colorIdx)}
                                    strokeWidth={1.75}
                                    dot={false}
                                    activeDot={{ r: 3, strokeWidth: 0 }}
                                    connectNulls
                                  />
                                )
                              })
                            : (
                              <Line
                                type="monotone"
                                dataKey={c.key}
                                name={c.key}
                                stroke={c.color}
                                strokeWidth={1.75}
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 0 }}
                              />
                            )}
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  )
                })}
              </div>

              <div style={{
                marginTop: 'var(--space-3)',
                fontSize: 'var(--fs-label)',
                color: 'var(--text-tertiary)',
              }}>
                {tab === 'products'
                  ? (selectedProducts.length === 0
                      ? 'All products · aggregated across TR_TYPE.'
                      : `Filtered on ${selectedProducts.length} product${selectedProducts.length > 1 ? 's' : ''}.`)
                  : tab === 'departments'
                  ? (selectedDepartments.length === 0
                      ? 'All departments · aggregated across departments.'
                      : `Filtered on ${selectedDepartments.length} department${selectedDepartments.length > 1 ? 's' : ''}.`)
                  : (selectedChannels.length === 0
                      ? 'All channels · aggregated across channels.'
                      : `Filtered on ${selectedChannels.length} channel${selectedChannels.length > 1 ? 's' : ''}.`)}
                <span style={{ color: 'var(--text-muted)' }}>{' '}· Subs = COUNT(DISTINCT MSISDN) per day · Value / Revenue = cross-type sum (P2P counted on send + receive).</span>
              </div>
            </div>

            {/* ── HISTORICAL MTD · cross-month comparison ── */}
            <div style={{ marginTop: 'var(--space-10)' }}>
              <SectionHeader
                icon={<History size={15} strokeWidth={1.75} />}
                title="Historical MTD"
                subtitle={`Last ${historyMonths} months · same day-of-month`}
                badge={`Day ${dayOfMonth} of each month`}
                loading={history.isFetching}
                action={<PercentButton label="% Breakdown" onClick={() => setPercentModal('mtd')} />}
              />

              {/* Range selector — segmented control */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                marginBottom: 'var(--space-4)',
              }}>
                <span style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 500,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                }}>
                  Range
                </span>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                  {([6, 12, 24] as const).map(n => (
                    <button key={n} onClick={() => setHistoryMonths(n)}
                      style={{
                        padding: '2px 0',
                        border: 'none',
                        borderBottom: '1px solid ' + (historyMonths === n ? 'var(--brand)' : 'transparent'),
                        background: 'transparent',
                        color: historyMonths === n ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        fontWeight: historyMonths === n ? 600 : 500,
                        fontSize: 'var(--fs-body)',
                        fontVariantNumeric: 'tabular-nums',
                        cursor: 'pointer',
                        transition: 'color 0.12s ease, border-color 0.12s ease',
                      }}>
                      {n}M
                    </button>
                  ))}
                </div>
              </div>

              {monthlyTotals.length === 0 ? (
                <div style={{
                  padding: 'var(--space-12) 0',
                  textAlign: 'center',
                }}>
                  {history.isFetching ? (
                    <>
                      <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                      <div style={{
                        fontWeight: 500, color: 'var(--text-secondary)',
                        fontSize: 'var(--fs-body)',
                      }}>
                        Loading historical data
                      </div>
                    </>
                  ) : (
                    <div style={{
                      fontSize: 'var(--fs-md)', fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}>
                      No historical data
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* 4 LineCharts MTD — tab-aware filter */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--space-3)',
                  }}>
                    {[
                      { key: 'SUBS',    title: 'Subscribers',  subtitle: `MTD to day ${dayOfMonth}`, color: 'var(--data-subs)',    icon: <UsersIcon size={13} strokeWidth={1.75} />,  isMoney: false },
                      { key: 'VOLUME',  title: 'Volume',       subtitle: `MTD to day ${dayOfMonth}`, color: 'var(--data-volume)',  icon: <BarChart3 size={13} strokeWidth={1.75} />,  isMoney: false },
                      { key: 'VALUE',   title: 'Value (HTG)',  subtitle: `MTD to day ${dayOfMonth}`, color: 'var(--data-value)',   icon: <Wallet size={13} strokeWidth={1.75} />,     isMoney: true  },
                      { key: 'REVENUE', title: 'Revenue (HTG)', subtitle: `MTD to day ${dayOfMonth}`, color: 'var(--data-revenue)', icon: <DollarSign size={13} strokeWidth={1.75} />, isMoney: true  },
                    ].map((c) => (
                      <ChartCard key={c.key} icon={c.icon} title={c.title} subtitle={c.subtitle}>
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={monthlyTotals} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="2 4" stroke="rgba(15,23,42,0.06)" />
                            <XAxis
                              dataKey="MONTH"
                              style={{ fontSize: '10px', fontWeight: 500, fill: 'var(--text-tertiary)' }}
                              stroke="rgba(15,23,42,0.12)"
                              tickLine={false}
                              interval="preserveStartEnd"
                              minTickGap={20}
                            />
                            <YAxis
                              tickFormatter={(v) => (c.isMoney ? fmtMoney(v) : fmtNum(v))}
                              style={{ fontSize: '10px', fontWeight: 500, fill: 'var(--text-tertiary)' }}
                              stroke="rgba(15,23,42,0.12)"
                              tickLine={false}
                              axisLine={false}
                              width={52}
                            />
                            <Tooltip
                              formatter={(value: any) => (c.isMoney ? fmtMoney(value) + ' HTG' : fmtNum(value))}
                              labelFormatter={(label: any) => `${label}`}
                              contentStyle={{
                                background: 'var(--text-primary)',
                                border: 'none', borderRadius: 'var(--radius-md)',
                                fontSize: 'var(--fs-label)', padding: 'var(--space-2) var(--space-3)',
                              }}
                              itemStyle={{ color: 'white' }}
                              labelStyle={{ color: 'rgba(255,255,255,0.6)', fontWeight: 500, marginBottom: '2px' }}
                              cursor={{ stroke: 'rgba(15,23,42,0.18)', strokeWidth: 1 }}
                            />
                            <Line
                              type="monotone"
                              dataKey={c.key}
                              name={c.key}
                              stroke={c.color}
                              strokeWidth={1.75}
                              dot={false}
                              activeDot={{ r: 4, strokeWidth: 0 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartCard>
                    ))}
                  </div>

                  <div style={{
                    marginTop: 'var(--space-3)',
                    fontSize: 'var(--fs-label)',
                    color: 'var(--text-tertiary)',
                  }}>
                    {tab === 'products'
                      ? (selectedProducts.length === 0
                          ? 'All products · aggregated across TR_TYPE.'
                          : `Filtered on ${selectedProducts.length} product${selectedProducts.length > 1 ? 's' : ''}.`)
                      : tab === 'departments'
                      ? (selectedDepartments.length === 0
                          ? 'All departments · aggregated across departments.'
                          : `Filtered on ${selectedDepartments.length} department${selectedDepartments.length > 1 ? 's' : ''}.`)
                      : (selectedChannels.length === 0
                          ? 'All channels · aggregated across channels.'
                          : `Filtered on ${selectedChannels.length} channel${selectedChannels.length > 1 ? 's' : ''}.`)}
                    <span style={{ color: 'var(--text-muted)' }}>{' '}· MTD bounded at day {dayOfMonth} of each month — constant-scope comparison.</span>
                  </div>
                </>
              )}
            </div>
          </>
        )}

      </div>

      {/* ── PERCENT BREAKDOWN MODAL ── */}
      <PercentBreakdownModal
        open={percentModal !== null}
        onClose={() => setPercentModal(null)}
        title={percentModal === 'daily' ? 'Daily — % Breakdown' : 'MTD — % Breakdown'}
        period={percentModal === 'daily'
          ? `${dailyRange.start} → ${dailyRange.end}`
          : `${snapshot.data?.current_start ?? '—'} → ${snapshot.data?.current_end ?? reportDate}`}
        rows={percentModal === 'daily' ? dailyByDimensionRows : currentRows}
        dimensionLabel={tab === 'products' ? 'product' : tab === 'departments' ? 'department' : 'channel'}
        loading={
          percentModal === 'daily'
            ? periodAggregates.isFetching
            : (tab === 'products' ? snapshot.isFetching
              : tab === 'departments' ? depts.isFetching
              : channels.isFetching)
        }
        note={null}
      />
    </DashboardLayout>
  )
}

// --------- Subcomponents ---------

function SectionHeader({ icon, title, subtitle, badge, loading, action }: any) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex', alignSelf: 'center' }}>
          {icon}
        </span>
        <h2 style={{
          margin: 0,
          fontSize: 'var(--fs-lg)', fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: 'var(--tracking-tight)', lineHeight: 1.2,
        }}>
          {title}
        </h2>
        {subtitle && (
          <span style={{
            fontSize: 'var(--fs-body)',
            color: 'var(--text-tertiary)',
            fontWeight: 400,
          }}>
            {subtitle}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {badge && (
          <span style={{
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-micro)', fontWeight: 500,
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {badge}
          </span>
        )}
        {action}
        {loading && (
          <span style={{
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-label)',
            display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: 'var(--brand)',
              animation: 'pulse 1.2s ease-in-out infinite',
            }} />
            Loading
          </span>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, curr, prev, accent, money = false }: any) {
  const c = Number(curr ?? 0)
  const p = Number(prev ?? 0)
  const v = variation(p, c)
  const isUp = v > 0
  const isFlat = v === 0
  const trendColor = isFlat ? 'var(--neutral)'   : isUp ? 'var(--positive)' : 'var(--negative)'
  const TrendIcon  = isFlat ? Minus : isUp ? TrendingUp : TrendingDown

  return (
    <div style={{
      position: 'relative',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-4) var(--space-3)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      {/* Vertical accent bar — single-color identity for the metric */}
      <span style={{
        position: 'absolute', left: 0, top: 'var(--space-3)', bottom: 'var(--space-3)',
        width: '2px', background: accent, borderRadius: '0 1px 1px 0',
      }} />

      {/* Label */}
      <span style={{
        fontSize: 'var(--fs-micro)', fontWeight: 500,
        textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
        color: 'var(--text-tertiary)',
      }}>
        {label}
      </span>

      {/* Value */}
      <div style={{
        fontSize: 'var(--fs-data)', fontWeight: 600,
        color: 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 'var(--tracking-tight)',
        lineHeight: 1,
      }}>
        {money ? fmtMoney(c) : fmtNum(c)}
      </div>

      {/* Delta vs previous — inline, no chip background */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        fontSize: 'var(--fs-label)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '2px',
          color: trendColor, fontWeight: 600,
        }}>
          <TrendIcon size={12} strokeWidth={2} /> {fmtPct(v)}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          vs {money ? fmtMoney(p) : fmtNum(p)}
        </span>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label, count }: any) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) 0',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
        marginBottom: '-1px',
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        fontWeight: active ? 600 : 500,
        fontSize: 'var(--fs-md)',
        cursor: 'pointer',
        transition: 'color 0.12s ease, border-color 0.12s ease',
      }}>
      <span style={{ color: active ? 'var(--brand)' : 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>{icon}</span>
      {label}
      <span style={{
        color: 'var(--text-muted)',
        fontSize: 'var(--fs-label)',
        fontWeight: 500,
        fontVariantNumeric: 'tabular-nums',
        marginLeft: '2px',
      }}>
        {count}
      </span>
    </button>
  )
}

function ChartCard({ icon, title, subtitle, children, style = {} }: any) {
  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        ...style,
      }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)',
        marginBottom: 'var(--space-4)',
        paddingBottom: 'var(--space-3)',
        borderBottom: '1px solid var(--border-faint)',
      }}>
        <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex', alignSelf: 'center' }}>
          {icon}
        </span>
        <span style={{
          fontSize: 'var(--fs-md)', fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: 'var(--tracking-tight)',
        }}>
          {title}
        </span>
        {subtitle && (
          <span style={{
            fontSize: 'var(--fs-label)',
            color: 'var(--text-tertiary)',
            fontWeight: 400,
          }}>
            · {subtitle}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function MultiSelectChips({
  label,
  options,
  selected,
  onChange,
  placeholderAll,
}: {
  label: string
  options: { id: string; label: string }[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholderAll: string
}) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }
  const clear = () => onChange([])
  const isAll = selected.length === 0

  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-2) var(--space-3)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontSize: 'var(--fs-micro)',
        fontWeight: 500,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-uppercase)',
        whiteSpace: 'nowrap',
        marginRight: 'var(--space-1)',
      }}>
        {label}
      </span>

      <button
        onClick={clear}
        style={{
          padding: '3px var(--space-3)',
          borderRadius: 'var(--radius-pill)',
          border: '1px solid ' + (isAll ? 'var(--brand)' : 'var(--border-default)'),
          background: isAll ? 'var(--brand)' : 'var(--surface-card)',
          color: isAll ? 'white' : 'var(--text-secondary)',
          fontWeight: 500,
          fontSize: 'var(--fs-label)',
          cursor: 'pointer',
          transition: 'background 0.12s ease, color 0.12s ease',
        }}
        title="Show all (clear filter)"
      >
        {placeholderAll}
      </button>

      {options.map(opt => {
        const active = selected.includes(opt.id)
        return (
          <button
            key={opt.id}
            onClick={() => toggle(opt.id)}
            style={{
              padding: '3px var(--space-3)',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid ' + (active ? 'var(--brand)' : 'var(--border-default)'),
              background: active ? 'var(--brand)' : 'var(--surface-card)',
              color: active ? 'white' : 'var(--text-secondary)',
              fontWeight: 500,
              fontSize: 'var(--fs-label)',
              cursor: 'pointer',
              transition: 'background 0.12s ease, color 0.12s ease, border-color 0.12s ease',
            }}
          >
            {opt.label}
          </button>
        )
      })}

      {!isAll && (
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 500, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
          fontVariantNumeric: 'tabular-nums',
          marginLeft: 'auto',
        }}>
          {selected.length} selected
        </span>
      )}
    </div>
  )
}

function ChannelToggleChips({
  channels,
  hidden,
  setHidden,
  loading,
}: {
  channels: string[]
  hidden: Set<string>
  setHidden: (next: Set<string>) => void
  loading: boolean
}) {
  const visibleCount = channels.length - hidden.size
  const toggle = (ch: string) => {
    const next = new Set(hidden)
    if (next.has(ch)) next.delete(ch)
    else next.add(ch)
    setHidden(next)
  }
  const showAll = () => setHidden(new Set())
  const hideAll = () => setHidden(new Set(channels))

  return (
    <div style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
      display: 'flex',
      alignItems: 'center', flexWrap: 'wrap',
      gap: 'var(--space-2)',
    }}>
      <span style={{
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-uppercase)',
        marginRight: 'var(--space-2)',
      }}>Channels</span>

      <button onClick={showAll}
        disabled={loading}
        style={{
          padding: '3px var(--space-3)',
          height: '26px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-default)',
          background: 'var(--surface-card)',
          color: 'var(--text-secondary)',
          fontWeight: 500, fontSize: 'var(--fs-label)',
          cursor: loading ? 'wait' : 'pointer',
        }}>
        All
      </button>
      <button onClick={hideAll}
        disabled={loading}
        style={{
          padding: '3px var(--space-3)',
          height: '26px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-default)',
          background: 'var(--surface-card)',
          color: 'var(--text-secondary)',
          fontWeight: 500, fontSize: 'var(--fs-label)',
          cursor: loading ? 'wait' : 'pointer',
        }}>
        None
      </button>

      <span style={{
        width: '1px', height: '18px',
        background: 'var(--border-default)',
        margin: '0 var(--space-1)',
      }} />

      {channels.length === 0 ? (
        <span style={{
          fontSize: 'var(--fs-label)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          {loading ? 'Loading channels…' : 'No channel data for this period.'}
        </span>
      ) : (
        channels.map((ch, idx) => {
          const active = !hidden.has(ch)
          const color = CHANNEL_PALETTE[idx % CHANNEL_PALETTE.length]
          return (
            <button key={ch} onClick={() => toggle(ch)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: '3px var(--space-3)',
                height: '26px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid ' + (active ? 'var(--text-primary)' : 'var(--border-default)'),
                background: active ? 'var(--surface-card)' : 'var(--surface-muted)',
                color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontWeight: active ? 600 : 500,
                fontSize: 'var(--fs-label)',
                cursor: 'pointer',
                transition: 'border-color 0.12s, color 0.12s, background 0.12s',
              }}>
              <span style={{
                width: '7px', height: '7px',
                borderRadius: '50%',
                background: color,
                opacity: active ? 1 : 0.35,
              }} />
              {ch}
            </button>
          )
        })
      )}

      {channels.length > 0 && (
        <span style={{
          marginLeft: 'auto',
          fontSize: 'var(--fs-micro)', fontWeight: 500,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-uppercase)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {visibleCount} / {channels.length} visible
        </span>
      )}
    </div>
  )
}

// ── PERCENT BREAKDOWN MODAL ──────────────────────────────────────────

// Palette monochromatique rouge — Digicel brand-first.
// Construite par alternance dark / light pour maximiser la lisibilité entre
// slices adjacentes du donut. La 1ère couleur (#E31B23) est attribuée à la
// part la plus importante (cf. colorByName tri par VALUE desc dans le modal).
const DONUT_PALETTE = [
  '#E31B23',  // 0  · Digicel brand red — biggest slice
  '#7C2D12',  // 1  · burnt sienna (dark)
  '#F87171',  // 2  · coral (light)
  '#8B0000',  // 3  · dark wine
  '#FB7185',  // 4  · rose pink
  '#B91C1C',  // 5  · deep red
  '#FCA5A5',  // 6  · pink
  '#450A0A',  // 7  · almost-black red
  '#EF4444',  // 8  · vivid red
  '#FECACA',  // 9  · pale pink
  '#991B1B',  // 10 · crimson
  '#FDA4AF',  // 11 · soft rose
  '#A21B1B',  // 12 · carmine
  '#FEE2E2',  // 13 · faint blush
  '#64748B',  // 14 · slate gray (fallback / outlier)
]

function PercentButton({ label, onClick }: { label: string, onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
        background: 'var(--surface-card)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-default)',
        height: '28px', padding: '0 var(--space-3)',
        borderRadius: 'var(--radius-md)',
        fontWeight: 500, fontSize: 'var(--fs-label)',
        cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-muted)'
        e.currentTarget.style.borderColor = 'var(--text-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--surface-card)'
        e.currentTarget.style.borderColor = 'var(--border-default)'
      }}>
      <PieChartIcon size={12} strokeWidth={1.75} />
      {label}
    </button>
  )
}

type DonutRow = { NAME: string; SUBS: number; VOLUME: number; VALUE: number; REVENUE: number }

// Animations CSS dédiées au modal — injectées une seule fois via un <style> module.
// Évite d'avoir à modifier premium.css pour des keyframes locales.
const PCT_MODAL_KEYFRAMES = `
@keyframes pct-spin {
  to { transform: rotate(360deg); }
}
@keyframes pct-modal-in {
  from { opacity: 0; transform: translateY(8px) scale(0.985); }
  to   { opacity: 1; transform: translateY(0)  scale(1); }
}
@keyframes pct-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@keyframes pct-bounce {
  0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
  40%           { opacity: 1;   transform: translateY(-3px); }
}
`

// Donut skeleton — 1 placeholder par card du grid. Reproduit la structure du
// vrai DonutCard (header + cercle + lignes de légende) avec animation shimmer.
function DonutSkeleton({ title }: { title: string }) {
  return (
    <div style={{
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface-card)',
      padding: 'var(--space-4)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: 'var(--border-default)',
        }} />
        <span style={{
          fontSize: 'var(--fs-md)', fontWeight: 600,
          color: 'var(--text-tertiary)',
        }}>{title}</span>
        <span style={{ flex: 1 }} />
        <SkeletonBar width="80px" height="10px" />
      </div>

      {/* Body : cercle (donut shape) + 5 lignes de légende */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        gap: 'var(--space-5)',
        alignItems: 'center',
      }}>
        <div style={{
          height: '240px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <DonutShapeSkeleton />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[1, 0.85, 0.7, 0.55, 0.4].map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{
                width: '8px', height: '8px', borderRadius: '2px',
                background: 'var(--border-default)',
              }} />
              <SkeletonBar width={`${w * 70}%`} height="10px" />
              <SkeletonBar width="44px"  height="10px" />
              <SkeletonBar width="32px"  height="10px" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SkeletonBar({ width, height }: { width: string, height: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width, height,
      borderRadius: '3px',
      background: 'linear-gradient(90deg, var(--border-default) 0%, var(--border-faint) 50%, var(--border-default) 100%)',
      backgroundSize: '200% 100%',
      animation: 'pct-shimmer 1.6s ease-in-out infinite',
    }} />
  )
}

function DonutShapeSkeleton() {
  // Cercle gris avec un "trou" central → mime la forme donut
  return (
    <div style={{
      width: '208px', height: '208px',
      borderRadius: '50%',
      background: 'conic-gradient(var(--border-default) 0deg, var(--border-faint) 120deg, var(--border-default) 240deg, var(--border-faint) 360deg)',
      animation: 'pct-shimmer 2.4s ease-in-out infinite',
      position: 'relative',
      maskImage: 'radial-gradient(circle, transparent 60px, black 62px)',
      WebkitMaskImage: 'radial-gradient(circle, transparent 60px, black 62px)',
    }} />
  )
}

function PercentBreakdownModal({
  open, onClose, title, period, rows, dimensionLabel, loading, note,
}: {
  open: boolean
  onClose: () => void
  title: string
  period: string
  rows: DonutRow[]
  dimensionLabel: string
  loading: boolean
  note: string | null
}) {
  // Hooks must run unconditionally — colorByName is memoized.
  // On trie les noms par VALUE totale décroissante → la plus grosse part reçoit
  // la couleur brand (#E31B23) en premier, et la palette descend en cascade.
  // Conservation de la stabilité visuelle : un même produit/canal/dept garde sa
  // couleur sur les 4 donuts (SUBS/VOLUME/VALUE/REVENUE).
  const colorByName = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const r of rows) {
      if (!r.NAME) continue
      totals[r.NAME] = (totals[r.NAME] ?? 0) + Number(r.VALUE ?? 0)
    }
    const names = Object.keys(totals).sort((a, b) => {
      const diff = totals[b] - totals[a]
      return diff !== 0 ? diff : a.localeCompare(b)  // tie-break alphabétique
    })
    const map: Record<string, string> = {}
    names.forEach((n, i) => { map[n] = DONUT_PALETTE[i % DONUT_PALETTE.length] })
    return map
  }, [rows])

  if (!open) return null

  const metrics = [
    { key: 'SUBS'    as const, title: 'Subscribers',  accent: 'var(--data-subs)',    money: false },
    { key: 'VOLUME'  as const, title: 'Volume',       accent: 'var(--data-volume)',  money: false },
    { key: 'VALUE'   as const, title: 'Value (HTG)',  accent: 'var(--data-value)',   money: true  },
    { key: 'REVENUE' as const, title: 'Revenue (HTG)', accent: 'var(--data-revenue)', money: true  },
  ]

  const buildSeries = (metric: 'SUBS' | 'VOLUME' | 'VALUE' | 'REVENUE') => {
    const arr = rows
      .map(r => ({ name: r.NAME, value: Number(r[metric] ?? 0) }))
      .filter(r => r.value > 0)
      .sort((a, b) => b.value - a.value)
    const total = arr.reduce((s, r) => s + r.value, 0)
    return { arr, total }
  }

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--space-6)',
      }}>
      {/* Inject keyframes for spin / modal-in / shimmer / bounce */}
      <style>{PCT_MODAL_KEYFRAMES}</style>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface-card)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-default)',
          width:     'min(1480px, 96vw)',
          minHeight: 'min(740px, 88vh)',
          maxHeight: '94vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 28px 80px rgba(15,23,42,0.22)',
          overflow: 'hidden',
          animation: 'pct-modal-in 0.22s ease-out',
        }}>
        <div style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--border-default)',
          display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
        }}>
          <div style={{
            width: '32px', height: '32px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-muted)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--brand)',
            flexShrink: 0,
          }}>
            <PieChartIcon size={16} strokeWidth={1.75} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            }}>
              <span style={{
                fontSize: 'var(--fs-md)', fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: 'var(--tracking-tight)',
              }}>{title}</span>

              {/* Chip "Refreshing" visible pendant le refetch quand on a déjà des données affichées */}
              {loading && rows.length > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '2px var(--space-2)',
                  border: '1px solid var(--brand)',
                  background: 'rgba(227, 27, 35, 0.06)',
                  color: 'var(--brand)',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: 'var(--fs-micro)', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
                }}>
                  <span style={{
                    width: '10px', height: '10px',
                    border: '2px solid currentColor',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'pct-spin 0.6s linear infinite',
                  }} />
                  Refreshing
                </span>
              )}
            </div>
            <div style={{
              marginTop: '2px',
              fontSize: 'var(--fs-label)', color: 'var(--text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              Composition by <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{dimensionLabel}</strong> · {period}
            </div>
          </div>
          <button onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-tertiary)',
              cursor: 'pointer', padding: 'var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="Close">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {note && (
          <div style={{
            padding: 'var(--space-3) var(--space-5)',
            background: 'rgba(245, 158, 11, 0.06)',
            borderBottom: '1px solid var(--border-faint)',
            fontSize: 'var(--fs-label)', color: 'var(--text-secondary)',
          }}>
            <strong style={{ color: 'var(--warning)', fontWeight: 600 }}>Note · </strong>{note}
          </div>
        )}

        <div style={{
          flex: 1, overflow: 'auto',
          padding: 'var(--space-5)',
        }}>
          {loading && rows.length === 0 ? (
            // Squelette 2×2 : même layout que les donut cards finaux, animation shimmer
            // discrète. La barre globale en haut de viewport signale l'activité réseau.
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 'var(--space-4)',
            }}>
              {['Subscribers', 'Volume', 'Value (HTG)', 'Revenue (HTG)'].map(t => (
                <DonutSkeleton key={t} title={t} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 'var(--space-12) 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No data to display for this period and filter combination.
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 'var(--space-4)',
            }}>
              {metrics.map(m => {
                const { arr, total } = buildSeries(m.key)
                return (
                  <DonutCard
                    key={m.key}
                    title={m.title}
                    accent={m.accent}
                    money={m.money}
                    data={arr}
                    total={total}
                    colorByName={colorByName}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DonutCard({
  title, accent, money, data, total, colorByName,
}: {
  title: string
  accent: string
  money: boolean
  data: { name: string; value: number }[]
  total: number
  colorByName: Record<string, string>
}) {
  const fmt = money ? fmtMoney : fmtNum
  return (
    <div style={{
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface-card)',
      padding: 'var(--space-4)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      }}>
        <span style={{
          width: '8px', height: '8px',
          borderRadius: '50%',
          background: accent,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 'var(--fs-md)', fontWeight: 600,
          color: 'var(--text-primary)',
        }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 'var(--fs-label)', fontWeight: 600,
          color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}>Total: {fmt(total)}</span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        gap: 'var(--space-5)',
        alignItems: 'center',
      }}>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name"
              cx="50%" cy="50%"
              innerRadius={62} outerRadius={104}
              paddingAngle={data.length > 1 ? 1 : 0}
              stroke="var(--surface-card)" strokeWidth={2}
              label={(props: any) => {
                const pct = total > 0 ? (props.value / total) * 100 : 0
                if (pct < 5) return ''
                return pct.toFixed(0) + '%'
              }}
              labelLine={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={colorByName[d.name] || DONUT_PALETTE[i % DONUT_PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: any, name: any) => {
                const pct = total > 0 ? ((Number(value) / total) * 100).toFixed(1) : '0.0'
                return [fmt(value) + ' (' + pct + '%)', name]
              }}
              contentStyle={{
                background: 'var(--text-primary)',
                border: 'none', borderRadius: 'var(--radius-md)',
                fontSize: 'var(--fs-label)', padding: 'var(--space-2) var(--space-3)',
              }}
              itemStyle={{ color: 'white' }}
              labelStyle={{ color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}
            />
          </PieChart>
        </ResponsiveContainer>

        <div style={{
          display: 'flex', flexDirection: 'column', gap: '5px',
          maxHeight: '240px', overflowY: 'auto',
        }}>
          {data.map((d) => {
            const pct = total > 0 ? (d.value / total) * 100 : 0
            return (
              <div key={d.name} style={{
                display: 'grid',
                gridTemplateColumns: '12px 1fr auto auto',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: '2px 0',
                fontSize: 'var(--fs-label)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                <span style={{
                  width: '8px', height: '8px',
                  borderRadius: '2px',
                  background: colorByName[d.name] || 'var(--text-muted)',
                }} />
                <span style={{
                  color: 'var(--text-secondary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{d.name}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  {fmt(d.value)}
                </span>
                <span style={{
                  color: 'var(--text-tertiary)',
                  fontWeight: 600,
                  minWidth: '44px', textAlign: 'right',
                }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
