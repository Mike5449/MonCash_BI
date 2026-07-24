import {
  Users,
  Receipt,
  ChevronDown,
  Home,
  LayoutDashboard,
  Sparkles,
  Search,
  Circle,
  Camera,
  Globe,
  History,
  FileBarChart,
  IdCard,
  Workflow,
  LogOut,
} from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useMemo, useState } from "react"
import { getCurrentUser, logout } from "../../services/auth"
import "../../premium.css"

type SubItem = { label: string; to: string }

const NavItem = ({ icon: LucideIcon, children, to, active = false }: any) => {
  return (
    <Link to={to} className={`nav-item ${active ? 'active' : ''}`}>
      <span className="nav-item-indicator" />
      <LucideIcon size={17} />
      <span className="nav-item-label">{children}</span>
    </Link>
  )
}

const DropdownNavItem = ({ icon: LucideIcon, title, items }: { icon: any, title: string, items: SubItem[] }) => {
  const location = useLocation()
  const anyActive = items.some(item => location.pathname === item.to)
  const [isOpen, setIsOpen] = useState(anyActive)

  return (
    <div className="nav-dropdown">
      <div
        className={`nav-dropdown-trigger ${anyActive ? 'is-active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="nav-item-indicator" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', flex: 1, minWidth: 0 }}>
          <LucideIcon size={17} />
          <span className="nav-item-label">{title}</span>
        </div>
        <span className="nav-count">{items.length}</span>
        <ChevronDown
          size={14}
          style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', opacity: 0.5, flexShrink: 0 }}
        />
      </div>

      <div className={`nav-dropdown-content ${isOpen ? 'open' : ''}`}>
        <div className="nav-dropdown-guide" />
        {items.map(item => (
          <Link
            key={item.to}
            to={item.to}
            className={`nav-sub-item ${location.pathname === item.to ? 'active' : ''}`}
          >
            <span className="nav-sub-dot" />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const currentUser = getCurrentUser()

  const handleLogout = async () => {
    await logout()
    navigate("/login", { replace: true })
  }

  const profileInitials = (currentUser?.email || currentUser?.name || "U")
    .split(/[@\s.]+/).filter(Boolean).slice(0, 2)
    .map(s => s[0]?.toUpperCase() || "").join("") || "U"
  const profileLabel = currentUser?.name || currentUser?.email?.split("@")[0] || "Guest"

  const allItems = useMemo(() => ([
    { label: "Home", to: "/", group: "Main" },
    { label: "Overview", to: "/dashboard", group: "Main" },
    { label: "Customer · Accounts", to: "/customers/active", group: "Customer" },
    { label: "Customer · Transactions", to: "/customers/transactions", group: "Customer" },
    { label: "Customer · Daily Stats by Type", to: "/customers/daily-stats-by-type", group: "Customer" },
    { label: "Customer · Daily Stats by Department", to: "/customers/daily-stats-by-department", group: "Customer" },
    { label: "Customer · Daily Stats by Channel", to: "/customers/daily-stats-by-channel", group: "Customer" },
    { label: "Customer · MTD Stats by Type", to: "/customers/mtd-stats-by-type", group: "Customer" },
    { label: "Customer · MTD Stats by Department", to: "/customers/mtd-stats-by-department", group: "Customer" },
    { label: "Customer · MTD Stats by Channel", to: "/customers/mtd-stats-by-channel", group: "Customer" },
    { label: "Customer · Churn (30/60/90)", to: "/customers/churn", group: "Customer" },
    { label: "Customer · Churn Custom", to: "/customers/churn-custom", group: "Customer" },
    { label: "Customer · Active Customers", to: "/customers/active-customers", group: "Customer" },
    { label: "Customer · Transaction Range", to: "/customers/transaction-range", group: "Customer" },
    { label: "Customer · Subs Dashboard", to: "/customers/subs-dashboard", group: "Customer" },
    { label: "Customer · Compliance KYC Info", to: "/customers/compliance-kyc-info", group: "Customer" },
    { label: "Snapshot · WoW", to: "/customers/snapshot-daily", group: "Snapshots" },
    { label: "Snapshot · MoM (MTD)", to: "/customers/snapshot-mtd", group: "Snapshots" },
    { label: "Snapshot · Bank vs Wallet WoW", to: "/customers/snapshot-bank-wallet-daily", group: "Snapshots" },
    { label: "Snapshot · Bank vs Wallet MoM (MTD)", to: "/customers/snapshot-bank-wallet-mtd", group: "Snapshots" },
    { label: "Snapshot · Department WoW",      to: "/customers/snapshot-department-daily", group: "Snapshots" },
    { label: "Snapshot · Department MoM (MTD)", to: "/customers/snapshot-department-mtd",  group: "Snapshots" },
    { label: "Snapshot · Channel WoW",         to: "/customers/snapshot-channel-daily",    group: "Snapshots" },
    { label: "Snapshot · Channel MoM (MTD)",   to: "/customers/snapshot-channel-mtd",      group: "Snapshots" },
    { label: "IMT · Transactions",      to: "/imt/transactions",      group: "IMT" },
    { label: "IMT · Lost Receivers",    to: "/imt/churn",             group: "IMT" },
    { label: "IMT · Department Lookup", to: "/imt/department-lookup", group: "IMT" },
    { label: "Operation · Transactions", to: "/operations/transactions", group: "Operation" },
    { label: "Operation · E-money Transactions", to: "/operations/emoney-transactions", group: "Operation" },
    { label: "B2B · Biller · Accounts",         to: "/billers/accounts",          group: "B2B" },
    { label: "B2B · Biller · Transactions",     to: "/billers/transactions",      group: "B2B" },
    { label: "B2B · Biller · Monthly Stats",    to: "/billers/monthly-stats",     group: "B2B" },
    { label: "B2B · Prefunded · Accounts",      to: "/prefunded/accounts",        group: "B2B" },
    { label: "B2B · Prefunded · Transactions",  to: "/prefunded/transactions",    group: "B2B" },
    { label: "B2B · Prefunded · Monthly Stats", to: "/prefunded/monthly-stats",   group: "B2B" },
    { label: "B2B · Merchant · Accounts", to: "/merchants/accounts", group: "B2B" },
    { label: "B2B · Merchant · Transactions", to: "/merchants/transactions", group: "B2B" },
    { label: "B2B · Merchant · Monthly Stats", to: "/merchants/monthly-stats", group: "B2B" },
    { label: "B2B · Merchant · Active Merchants", to: "/merchants/active-merchants", group: "B2B" },
    { label: "File Verification", to: "/enrich", group: "Tools" },
    { label: "Transaction History", to: "/tools/transaction-history", group: "Tools" },
    { label: "Agent OTC", to: "/tools/agent-otc", group: "Tools" },
    { label: "BRH Report", to: "/tools/period-report", group: "Tools" },
    { label: "ID Card Scanner", to: "/tools/id-card-scanner", group: "Tools" },
  ]), [])

  const filtered = search.trim().length > 0
    ? allItems.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
    : null

  return (
    <aside className="sidebar premium">
      <div className="sidebar-header">
        <img
          src="/moncah-logo.png"
          alt="MonCash"
          className="sidebar-logo-img"
        />
        <div>
          <div className="sidebar-title">MonCash <span>BI</span></div>
          <div className="sidebar-subtitle">Analytics & Audit Portal</div>
        </div>
      </div>

      <div className="sidebar-search">
        <Search size={14} />
        <input
          type="text"
          placeholder="Search navigation..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="sidebar-search-clear" onClick={() => setSearch("")}>×</button>
        )}
      </div>

      <div className="sidebar-content">
        {filtered ? (
          <div className="nav-search-results">
            <div className="sidebar-label">Results · {filtered.length}</div>
            {filtered.length === 0 && (
              <div className="nav-empty">No match for "{search}"</div>
            )}
            {filtered.map(item => (
              <Link
                key={item.to}
                to={item.to}
                className={`nav-item ${location.pathname === item.to ? 'active' : ''}`}
                onClick={() => setSearch("")}
              >
                <span className="nav-item-indicator" />
                <Circle size={6} fill="currentColor" />
                <span className="nav-item-label">{item.label}</span>
              </Link>
            ))}
          </div>
        ) : (
          <>
            <div className="sidebar-label">Main</div>
            <NavItem to="/" icon={Home} active={location.pathname === "/"}>Home</NavItem>
            <NavItem to="/dashboard" icon={LayoutDashboard} active={location.pathname === "/dashboard"}>Overview</NavItem>

            <div className="sidebar-divider" />
            <div className="sidebar-label">Core Analytics</div>

            <DropdownNavItem
              icon={Users}
              title="Customer"
              items={[
                { label: "Accounts List", to: "/customers/active" },
                { label: "Transactions", to: "/customers/transactions" },
                { label: "Daily Stats by Type", to: "/customers/daily-stats-by-type" },
                { label: "Daily Stats by Department", to: "/customers/daily-stats-by-department" },
                { label: "Daily Stats by Channel", to: "/customers/daily-stats-by-channel" },
                { label: "MTD Stats by Type", to: "/customers/mtd-stats-by-type" },
                { label: "MTD Stats by Department", to: "/customers/mtd-stats-by-department" },
                { label: "MTD Stats by Channel", to: "/customers/mtd-stats-by-channel" },
                { label: "Churn (30/60/90)", to: "/customers/churn" },
                { label: "Churn Custom", to: "/customers/churn-custom" },
                { label: "Active Customers", to: "/customers/active-customers" },
                { label: "Transaction Range", to: "/customers/transaction-range" },
                { label: "Subs Dashboard", to: "/customers/subs-dashboard" },
                { label: "Compliance KYC Info", to: "/customers/compliance-kyc-info" },
              ]}
            />

            <DropdownNavItem
              icon={Camera}
              title="Snapshots"
              items={[
                { label: "Snapshot WoW", to: "/customers/snapshot-daily" },
                { label: "Snapshot MoM (MTD)", to: "/customers/snapshot-mtd" },
                { label: "Bank vs Wallet WoW", to: "/customers/snapshot-bank-wallet-daily" },
                { label: "Bank vs Wallet MoM (MTD)", to: "/customers/snapshot-bank-wallet-mtd" },
                { label: "Department WoW", to: "/customers/snapshot-department-daily" },
                { label: "Department MoM (MTD)", to: "/customers/snapshot-department-mtd" },
                { label: "Channel WoW", to: "/customers/snapshot-channel-daily" },
                { label: "Channel MoM (MTD)", to: "/customers/snapshot-channel-mtd" },
              ]}
            />

            <DropdownNavItem
              icon={Receipt}
              title="B2B"
              items={[
                { label: "Biller · Accounts",         to: "/billers/accounts" },
                { label: "Biller · Transactions",     to: "/billers/transactions" },
                { label: "Biller · Monthly Stats",    to: "/billers/monthly-stats" },
                { label: "Prefunded · Accounts",      to: "/prefunded/accounts" },
                { label: "Prefunded · Transactions",  to: "/prefunded/transactions" },
                { label: "Prefunded · Monthly Stats", to: "/prefunded/monthly-stats" },
                { label: "Merchant · Accounts",       to: "/merchants/accounts" },
                { label: "Merchant · Transactions",   to: "/merchants/transactions" },
                { label: "Merchant · Monthly Stats",  to: "/merchants/monthly-stats" },
                { label: "Merchant · Active",         to: "/merchants/active-merchants" },
              ]}
            />

            <DropdownNavItem
              icon={Globe}
              title="IMT"
              items={[
                { label: "Transactions",            to: "/imt/transactions" },
                { label: "Lost Receivers (Churn)",  to: "/imt/churn" },
                { label: "Department Lookup",       to: "/imt/department-lookup" },
              ]}
            />

            <DropdownNavItem
              icon={Workflow}
              title="Operation"
              items={[
                { label: "Transactions", to: "/operations/transactions" },
                { label: "E-money Transactions", to: "/operations/emoney-transactions" },
              ]}
            />

            <div className="sidebar-divider" />
            <div className="sidebar-label">Business Tools</div>
            <NavItem to="/enrich" icon={Sparkles} active={location.pathname === "/enrich"}>File Verification</NavItem>
            <NavItem to="/tools/transaction-history" icon={History} active={location.pathname === "/tools/transaction-history"}>Transaction History</NavItem>
            <NavItem to="/tools/agent-otc" icon={Users} active={location.pathname === "/tools/agent-otc"}>Agent OTC</NavItem>
            <NavItem to="/tools/period-report" icon={FileBarChart} active={location.pathname === "/tools/period-report"}>BRH Report</NavItem>
            <NavItem to="/tools/id-card-scanner" icon={IdCard} active={location.pathname === "/tools/id-card-scanner"}>ID Card Scanner</NavItem>
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-profile">
          <div className="sidebar-avatar">{profileInitials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="sidebar-profile-name"
              title={currentUser?.email || ""}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {profileLabel}
            </div>
            <div className="sidebar-profile-status">
              <span className="status-dot" /> Connected · Databricks
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
            className="sidebar-logout"
          >
            <LogOut size={13} strokeWidth={2} />
            <span>Out</span>
          </button>
        </div>
        <div className="sidebar-version">© 2026 Digicel MonCash BI · v2.6</div>
      </div>
    </aside>
  )
}
