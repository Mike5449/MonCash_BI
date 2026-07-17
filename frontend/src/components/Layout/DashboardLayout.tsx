import { Sidebar } from "./Sidebar"
import { Bell, Settings } from "lucide-react"
import { ClearCacheButton } from "../ClearCacheButton"
import { ChatbotAssistant } from "../ChatbotAssistant"
import "../../premium.css"

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-container">
      <Sidebar />
      <div className="app-main-wrapper">
        <div className="navbar">
          <div className="navbar-actions" style={{ marginLeft: 'auto' }}>
            <ClearCacheButton />
            <button className="nav-action-btn"><Bell size={20} /></button>
            <button className="nav-action-btn"><Settings size={20} /></button>

            <div className="user-profile">
              <div className="avatar">M</div>
              <div className="user-info">
                <span className="user-name">Mike</span>
                <span className="user-role">BI Administrator</span>
              </div>
            </div>
          </div>
        </div>

        <main className="main-content">
          {children}
        </main>
      </div>
      <ChatbotAssistant />
    </div>
  )
}
