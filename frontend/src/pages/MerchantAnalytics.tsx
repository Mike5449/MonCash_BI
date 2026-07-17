import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useMerchantAccounts } from "../hooks/useAnalytics"
import { Store, TrendingUp, MapPin, Tag, Download } from "lucide-react"
import "../premium.css"

export default function MerchantAnalytics() {
  const { data: merchants, isLoading } = useMerchantAccounts({ limit: 100 })

  return (
    <DashboardLayout>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Merchant Intelligence Directory</h1>
          <p className="page-subtitle">Complete directory of all MonCash merchants, including tier classification and fee profiles.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="nav-action-btn" style={{ background: '#16a34a', color: 'white', width: 'auto', padding: '0 20px', gap: '8px' }}>
            <Download size={16} /> Merchant Export
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#dcfce7', color: '#10b981' }}>
            <Store size={24} />
          </div>
          <div>
            <div className="kpi-label" style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Total Active Merchants</div>
            <div className="kpi-value" style={{ fontSize: '24px', fontWeight: '800' }}>{merchants?.total ?? merchants?.rows?.length ?? 0}</div>
          </div>
        </div>
        
        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#eff6ff', color: '#3b82f6' }}>
            <Tag size={24} />
          </div>
          <div>
            <div className="kpi-label" style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Data Source Status</div>
            <div className="kpi-value" style={{ fontSize: '24px', fontWeight: '800' }}>LIVE</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#f8fafc', color: '#64748b' }}>
            <TrendingUp size={24} />
          </div>
          <div>
            <div className="kpi-label" style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Market coverage</div>
            <div className="kpi-value" style={{ fontSize: '24px', fontWeight: '800' }}>100%</div>
          </div>
        </div>
      </div>

      <div className="table-card" style={{ marginTop: '32px' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--mc-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '800', margin: 0, textTransform: 'uppercase' }}>Merchant Directory</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
             <span className="badge badge-green">MFS Merchant Segment</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="mc-table">
            <thead>
              <tr>
                <th>Merchant Name</th>
                <th>ID / Shortcode</th>
                <th>Merchant Type</th>
                <th>Location</th>
                <th style={{ textAlign: 'right' }}>Fee Profile</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '60px' }}>Connecting to Databricks cluster for merchant data...</td></tr>
              ) : (merchants?.rows?.length ?? 0) === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '60px' }}>No merchants found in the latest data code.</td></tr>
              ) : merchants?.rows?.map((m: any, idx: number) => (
                <tr key={idx}>
                  <td style={{ fontWeight: '700' }}>{m.MERCHANT_NAME}</td>
                  <td style={{ color: 'var(--mc-text-sub)', fontSize: '11px' }}>{m.MERCHANT_SHORT_CODE || m.ACCOUNT_ID}</td>
                  <td>
                    <span className={`badge ${m.MERCHANT_TYPE?.includes('Gold') ? 'badge-blue' : (m.MERCHANT_TYPE?.includes('Silver') ? 'badge-orange' : 'badge-green')}`}>
                      {m.MERCHANT_TYPE}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={12} color="#94a3b8" />
                      <span style={{ fontSize: '12px' }}>{m.DEPARTMENT}, {m.COMMUNE}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: '800', color: 'var(--mc-red)' }}>{m.FEE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}
