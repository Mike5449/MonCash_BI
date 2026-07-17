import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { useBillerAccounts, useBillerTransactions } from "../hooks/useAnalytics"
import { Receipt, TrendingUp, ArrowRightLeft, Building2, ShieldCheck, Download } from "lucide-react"
import "../premium.css"

export default function BillerAnalytics() {
  const { data: billers, isLoading: loadingBillers } = useBillerAccounts(100)
  const { data: transactions, isLoading: loadingTXs } = useBillerTransactions(100)

  return (
    <DashboardLayout>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Biller Partner Intelligence</h1>
          <p className="page-subtitle">Monitoring status, fees, and real-time payments for utility and service partners.</p>
        </div>
        <button className="nav-action-btn" style={{ background: '#16a34a', color: 'white', width: 'auto', padding: '0 20px', gap: '8px' }}>
          <Download size={16} /> Export Reports
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#dcfce7', color: '#10b981' }}>
            <Building2 size={24} />
          </div>
          <div>
            <div className="kpi-label" style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Active Biller Nodes</div>
            <div className="kpi-value" style={{ fontSize: '24px', fontWeight: '800' }}>{billers?.length || 0}</div>
          </div>
        </div>
        
        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#eff6ff', color: '#3b82f6' }}>
            <ArrowRightLeft size={24} />
          </div>
          <div>
            <div className="kpi-label" style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Recent Payment Volume</div>
            <div className="kpi-value" style={{ fontSize: '24px', fontWeight: '800' }}>{transactions?.length || 0} TXs</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#fef2f2', color: '#e31b23' }}>
            <ShieldCheck size={24} />
          </div>
          <div>
            <div className="kpi-label" style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Partner Compliance</div>
            <div className="kpi-value" style={{ fontSize: '24px', fontWeight: '800' }}>100%</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '32px', marginTop: '32px' }}>
        {/* Biller Directory */}
        <div className="table-card">
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--mc-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', margin: 0, textTransform: 'uppercase' }}>Biller Directory</h3>
            <span className="badge badge-blue">Utility Segment</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="mc-table">
              <thead>
                <tr>
                  <th>Biller Name</th>
                  <th>ID / Shortcode</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Fee Profile</th>
                </tr>
              </thead>
              <tbody>
                {loadingBillers ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: '40px' }}>Syncing Biller accounts...</td></tr>
                ) : billers?.map((b, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: '700' }}>{b.BILLER_NAME}</td>
                    <td style={{ color: 'var(--mc-text-sub)', fontSize: '11px' }}>{b.BILLER_SHORT_CODE || b.ACCOUNT_ID}</td>
                    <td><span className="badge badge-green">{b.BILLER_TYPE}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: '800' }}>{b.FEE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Transaction History */}
        <div className="table-card">
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--mc-border)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', margin: 0, textTransform: 'uppercase' }}>Live Payments</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="mc-table">
              <thead>
                <tr>
                  <th>TX ID</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {loadingTXs ? (
                  <tr><td colSpan={3} style={{ textAlign: 'center', padding: '40px' }}>Loading transactions...</td></tr>
                ) : transactions?.map((tx, idx) => (
                  <tr key={idx}>
                    <td style={{ fontSize: '11px', color: 'var(--mc-text-sub)' }}>{tx.TRANSACTIONID}</td>
                    <td style={{ textAlign: 'right', fontWeight: '800', color: 'var(--mc-red)' }}>{parseFloat(tx.ORIGINALAMOUNT).toLocaleString()} HTG</td>
                    <td style={{ textAlign: 'right', fontSize: '11px', color: '#94a3b8' }}>{new Date(tx.TRANSACTION_DATE).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
