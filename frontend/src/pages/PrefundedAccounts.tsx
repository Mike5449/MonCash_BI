import { DashboardLayout } from "../components/Layout/DashboardLayout"
import { usePrefundedAccounts } from "../hooks/useAnalytics"
import { Banknote, Download, Search, RefreshCw } from "lucide-react"
import "../premium.css"

export default function PrefundedAccounts() {
  const { data: accounts, isLoading, refetch } = usePrefundedAccounts({ limit: 100 })

  return (
    <DashboardLayout>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Prefunded Account List</h1>
          <p className="page-subtitle">Organizational partner directory for settlements and managed nodes.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => refetch()} className="nav-action-btn" style={{ background: 'white', color: 'var(--mc-text-main)', border: '1px solid var(--mc-border)', width: 'auto', padding: '0 20px', gap: '8px' }}>
            <RefreshCw size={16} /> Refresh Directory
          </button>
          <button className="nav-action-btn" style={{ background: 'var(--mc-red)', color: 'white', border: 'none', width: 'auto', padding: '0 20px', gap: '8px' }}>
            <Download size={16} /> Export Detailed Directory
          </button>
        </div>
      </div>

      <div style={{ 
        background: 'white', 
        padding: '20px 24px', 
        borderRadius: '16px', 
        border: '1px solid var(--mc-border)',
        marginTop: '24px',
        display: 'flex',
        alignItems: 'center',
        gap: '32px',
        boxShadow: 'var(--mc-shadow)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--mc-red)15', padding: '10px', borderRadius: '12px' }}>
             <Banknote size={20} color="var(--mc-red)" />
          </div>
          <div>
            <span style={{ display: 'block', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--mc-red)' }}>Prefunded Repository</span>
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Settlement Profile Base</span>
          </div>
        </div>
        
        <div className="search-container" style={{ flex: 1, marginBottom: 0, height: '44px' }}>
           <Search size={18} color="#94a3b8" />
           <input type="text" className="search-input" placeholder="Search partners by name, ID or code..." />
        </div>
      </div>

      <div className="table-card animate-fade-in" style={{ marginTop: '24px' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--mc-border)', background: '#f8fafc' }}>
           <h3 style={{ fontSize: '13px', fontWeight: '800', margin: 0, textTransform: 'uppercase', color: '#64748b' }}>Registered Prefunded Partners (Top 100)</h3>
        </div>
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table className="mc-table" style={{ minWidth: '1300px' }}>
            <thead>
              <tr>
                <th style={{ width: '120px' }}>DATE CODE</th>
                <th style={{ width: '250px' }}>PARTNER NAME</th>
                <th style={{ width: '180px' }}>ACCOUNT ID / MSISDN</th>
                <th style={{ width: '140px' }}>SHORTCODE</th>
                <th style={{ width: '150px' }}>IDENTITY ID</th>
                <th style={{ width: '160px' }}>DEPARTMENT</th>
                <th style={{ width: '180px' }}>PRODUCTS</th>
                <th style={{ width: '140px' }}>GL CODE</th>
                <th style={{ width: '120px', textAlign: 'right' }}>FEE RATE</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '100px', color: '#94a3b8' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                    <div className="spinner"></div>
                    Retrieving global partner base...
                  </div>
                </td></tr>
              ) : accounts?.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '100px', color: '#94a3b8' }}>No prefunded accounts found.</td></tr>
              ) : accounts?.map((a, idx) => (
                <tr key={idx}>
                  <td style={{ fontSize: '11px', fontWeight: '700', color: '#64748b' }}>{a.DATE_CODE}</td>
                  <td style={{ fontWeight: '800' }}>{a.PREFUNDED_NAME}</td>
                  <td style={{ color: 'var(--mc-text-sub)', fontSize: '12px', fontWeight: '600' }}>{a.ACCOUNT_ID}</td>
                  <td style={{ fontWeight: '700', fontSize: '11px' }}>{a.PREFUNDED_SHORT_CODE}</td>
                  <td style={{ fontSize: '11px', color: '#94a3b8' }}>{a.IDENTITY_ID}</td>
                  <td style={{ fontSize: '12px', fontWeight: '600' }}>{a.DEPARTMENT}</td>
                  <td><span className="badge badge-orange" style={{ fontSize: '10px' }}>{a.PRODUCTS}</span></td>
                  <td><code style={{ fontSize: '11px', color: '#64748b' }}>{a.ACCOUNT_GL_CODE}</code></td>
                  <td style={{ textAlign: 'right', fontWeight: '900', color: 'var(--mc-red)' }}>{a.FEE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}
