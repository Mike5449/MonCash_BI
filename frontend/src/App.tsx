import { BrowserRouter, Routes, Route } from "react-router-dom"
import Home from "./pages/Home"
import Overview from "./pages/Overview"
import Customers from "./pages/Customers"
import Transactions from "./pages/Transactions"
import DailyStatsByType from "./pages/DailyStatsByType"
import DailyStatsByDepartment from "./pages/DailyStatsByDepartment"
import DailyStatsByChannel from "./pages/DailyStatsByChannel"
import SnapshotDaily from "./pages/SnapshotDaily"
import SnapshotMTD from "./pages/SnapshotMTD"
import SnapshotBankWalletDaily from "./pages/SnapshotBankWalletDaily"
import SnapshotBankWalletMTD from "./pages/SnapshotBankWalletMTD"
import SnapshotDepartmentDaily from "./pages/SnapshotDepartmentDaily"
import SnapshotDepartmentMTD from "./pages/SnapshotDepartmentMTD"
import SnapshotChannelDaily from "./pages/SnapshotChannelDaily"
import SnapshotChannelMTD from "./pages/SnapshotChannelMTD"
import ImtChurn from "./pages/ImtChurn"
import ImtDepartmentLookup from "./pages/ImtDepartmentLookup"
import IMTTransactions from "./pages/IMTTransactions"
import MTDStatsByType from "./pages/MTDStatsByType"
import MTDStatsByDepartment from "./pages/MTDStatsByDepartment"
import MTDStatsByChannel from "./pages/MTDStatsByChannel"
import CustomerChurn from "./pages/CustomerChurn"
import CustomerChurnCustom from "./pages/CustomerChurnCustom"
import ActiveCustomers from "./pages/ActiveCustomers"
import ComplianceKYCInfo from "./pages/ComplianceKYCInfo"
import TransactionRange from "./pages/TransactionRange"
import SubsDashboard from "./pages/SubsDashboard"
import BillerAccounts from "./pages/BillerAccounts"
import BillerTransactions from "./pages/BillerTransactions"
import BillerMonthlyStats from "./pages/BillerMonthlyStats"
import MerchantAccounts from "./pages/MerchantAccounts"
import MerchantTransactions from "./pages/MerchantTransactions"
import MerchantMonthlyStats from "./pages/MerchantMonthlyStats"
import ActiveMerchants from "./pages/ActiveMerchants"
import PrefundedAccounts from "./pages/PrefundedAccounts"
import PrefundedTransactions from "./pages/PrefundedTransactions"
import PrefundedMonthlyStats from "./pages/PrefundedMonthlyStats"
import Enrichment from "./pages/Enrichment"
import TransactionHistory from "./pages/TransactionHistory"
import AgentOtc from "./pages/AgentOtc"
import PeriodReport from "./pages/PeriodReport"
import IdCardScanner from "./pages/IdCardScanner"
import OperationsTransactions from "./pages/OperationsTransactions"
import EmoneyOpsTransactions from "./pages/EmoneyOpsTransactions"
import Login from "./pages/Login"
import { PrivateRoute } from "./components/PrivateRoute"
import { GlobalFetchIndicator } from "./components/GlobalFetchIndicator"

function App() {
  return (
    <BrowserRouter>
      {/* Top-of-viewport progress bar — visible dès qu'une requête React Query tourne, sur toutes les pages */}
      <GlobalFetchIndicator />
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Protected — wrapped in PrivateRoute */}
        <Route path="/"          element={<PrivateRoute><Home /></PrivateRoute>} />
        <Route path="/dashboard" element={<PrivateRoute><Overview /></PrivateRoute>} />

        {/* Customer Domain */}
        <Route path="/customers/active"                       element={<PrivateRoute><Customers /></PrivateRoute>} />
        <Route path="/customers/transactions"                 element={<PrivateRoute><Transactions /></PrivateRoute>} />
        <Route path="/customers/daily-stats-by-type"          element={<PrivateRoute><DailyStatsByType /></PrivateRoute>} />
        <Route path="/customers/daily-stats-by-department"    element={<PrivateRoute><DailyStatsByDepartment /></PrivateRoute>} />
        <Route path="/customers/daily-stats-by-channel"       element={<PrivateRoute><DailyStatsByChannel /></PrivateRoute>} />
        <Route path="/customers/snapshot-daily"               element={<PrivateRoute><SnapshotDaily /></PrivateRoute>} />
        <Route path="/customers/snapshot-mtd"                 element={<PrivateRoute><SnapshotMTD /></PrivateRoute>} />
        <Route path="/customers/snapshot-bank-wallet-daily"   element={<PrivateRoute><SnapshotBankWalletDaily /></PrivateRoute>} />
        <Route path="/customers/snapshot-bank-wallet-mtd"     element={<PrivateRoute><SnapshotBankWalletMTD /></PrivateRoute>} />
        <Route path="/customers/snapshot-department-daily"    element={<PrivateRoute><SnapshotDepartmentDaily /></PrivateRoute>} />
        <Route path="/customers/snapshot-department-mtd"      element={<PrivateRoute><SnapshotDepartmentMTD /></PrivateRoute>} />
        <Route path="/customers/snapshot-channel-daily"       element={<PrivateRoute><SnapshotChannelDaily /></PrivateRoute>} />
        <Route path="/customers/snapshot-channel-mtd"         element={<PrivateRoute><SnapshotChannelMTD /></PrivateRoute>} />

        {/* IMT Domain */}
        <Route path="/imt/churn"                              element={<PrivateRoute><ImtChurn /></PrivateRoute>} />
        <Route path="/imt/department-lookup"                  element={<PrivateRoute><ImtDepartmentLookup /></PrivateRoute>} />
        <Route path="/imt/transactions"                       element={<PrivateRoute><IMTTransactions /></PrivateRoute>} />
        <Route path="/customers/mtd-stats-by-type"            element={<PrivateRoute><MTDStatsByType /></PrivateRoute>} />
        <Route path="/customers/mtd-stats-by-department"      element={<PrivateRoute><MTDStatsByDepartment /></PrivateRoute>} />
        <Route path="/customers/mtd-stats-by-channel"         element={<PrivateRoute><MTDStatsByChannel /></PrivateRoute>} />
        <Route path="/customers/churn"                        element={<PrivateRoute><CustomerChurn /></PrivateRoute>} />
        <Route path="/customers/churn-custom"                 element={<PrivateRoute><CustomerChurnCustom /></PrivateRoute>} />
        <Route path="/customers/active-customers"             element={<PrivateRoute><ActiveCustomers /></PrivateRoute>} />
        <Route path="/customers/transaction-range"            element={<PrivateRoute><TransactionRange /></PrivateRoute>} />
        <Route path="/customers/subs-dashboard"               element={<PrivateRoute><SubsDashboard /></PrivateRoute>} />
        <Route path="/customers/compliance-kyc-info"          element={<PrivateRoute><ComplianceKYCInfo /></PrivateRoute>} />

        {/* Biller Domain */}
        <Route path="/billers/accounts"        element={<PrivateRoute><BillerAccounts /></PrivateRoute>} />
        <Route path="/billers/transactions"    element={<PrivateRoute><BillerTransactions /></PrivateRoute>} />
        <Route path="/billers/monthly-stats"   element={<PrivateRoute><BillerMonthlyStats /></PrivateRoute>} />

        {/* Merchant Domain */}
        <Route path="/merchants/accounts"         element={<PrivateRoute><MerchantAccounts /></PrivateRoute>} />
        <Route path="/merchants/transactions"     element={<PrivateRoute><MerchantTransactions /></PrivateRoute>} />
        <Route path="/merchants/monthly-stats"    element={<PrivateRoute><MerchantMonthlyStats /></PrivateRoute>} />
        <Route path="/merchants/active-merchants" element={<PrivateRoute><ActiveMerchants /></PrivateRoute>} />

        {/* Prefunded Domain */}
        <Route path="/prefunded/accounts"       element={<PrivateRoute><PrefundedAccounts /></PrivateRoute>} />
        <Route path="/prefunded/transactions"   element={<PrivateRoute><PrefundedTransactions /></PrivateRoute>} />
        <Route path="/prefunded/monthly-stats"  element={<PrivateRoute><PrefundedMonthlyStats /></PrivateRoute>} />

        {/* Tools */}
        <Route path="/enrich"                     element={<PrivateRoute><Enrichment /></PrivateRoute>} />
        <Route path="/tools/transaction-history"  element={<PrivateRoute><TransactionHistory /></PrivateRoute>} />
        <Route path="/tools/agent-otc"            element={<PrivateRoute><AgentOtc /></PrivateRoute>} />
        <Route path="/tools/period-report"        element={<PrivateRoute><PeriodReport /></PrivateRoute>} />
        <Route path="/tools/id-card-scanner"      element={<PrivateRoute><IdCardScanner /></PrivateRoute>} />
        <Route path="/operations/transactions"          element={<PrivateRoute><OperationsTransactions /></PrivateRoute>} />
        <Route path="/operations/emoney-transactions"    element={<PrivateRoute><EmoneyOpsTransactions /></PrivateRoute>} />

      </Routes>
    </BrowserRouter>
  )
}

export default App
