import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { usePrefundedAccounts, usePrefundedTransactions } from "../hooks/useAnalytics"
import { Banknote, TrendingUp, History, MapPin, Search, Download } from "lucide-react"
import "../premium.css"

export default function PrefundedAnalytics() {
  const { data: accounts, isLoading: loadingAccounts } = usePrefundedAccounts(100)
  const { data: transactions, isLoading: loadingTXs } = usePrefundedTransactions(100)

  return (
    <DashboardLayout>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Prefunded Partner Management</h1>
          <p className="page-subtitle">Global reconciliation, account audits, and settlement monitoring for partner nodes.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="nav-action-btn" style={{ background: '#16a34a', color: 'white', width: 'auto', padding: '0 20px', gap: '8px' }}>
            <Download size={16} /> Settlement Report
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#dbeafe', color: '#3b82f6' }}>
            <Banknote size={24} />
          </div>
          <div>
            <div className="kpi-label" style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Active Prefunded Accounts</div>
            <div className="kpi-value" style={{ fontSize: '24px', fontWeight: '800' }}>{accounts?.length || 0}</div>
          </div>
        </div>
        
        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#fef2f2', color: '#e31b23' }}>
            <History size={24} />
          </div>
          <div>
            <div className="kpi-label" style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Recent Inflows</div>
            <div className="kpi-value" style={{ fontSize: '24px', fontWeight: '800' }}>{transactions?.length || 0} TXs</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#f8fafc', color: '#64748b' }}>
            <TrendingUp size={24} />
          </div>
          <div>
            <div className="kpi-label" style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Reconciliation Rate</div>
            <div className="kpi-value" style={{ fontSize: '24px', fontWeight: '800' }}>100%</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '32px', marginTop: '32px' }}>
        <div className="table-card">
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--mc-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', margin: 0, textTransform: 'uppercase' }}>Global Account Snapshot</h3>
            <span className="badge badge-orange">Prefunded Partners</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="mc-table">
              <thead>
                <tr>
                  <th>Partner Name</th>
                  <th>ID / Shortcode</th>
                  <th>Location</th>
                  <th style={{ textAlign: 'right' }}>Fee Profile</th>
                </tr>
              </thead>
              <tbody>
                {loadingAccounts ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: '40px' }}>Mapping Prefunded accounts...</td></tr>
                ) : accounts?.map((a, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: '700' }}>{a.PREFUNDED_NAME}</td>
                    <td style={{ color: 'var(--mc-text-sub)', fontSize: '11px' }}>{a.PREFUNDED_SHORT_CODE || a.ACCOUNT_ID}</td>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={12} color="#94a3b8" /><span style={{ fontSize: '12px' }}>{a.DEPARTMENT}, {a.COMMUNE}</span></div></td>
                    <td style={{ textAlign: 'right', fontWeight: '800' }}>{a.FEE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="table-card">
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--mc-border)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', margin: 0, textTransform: 'uppercase' }}>Movement Log</h3>
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
