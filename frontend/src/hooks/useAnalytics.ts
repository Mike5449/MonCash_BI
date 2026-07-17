import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query"
import { AnalyticsService } from "../api/services/AnalyticsService"
import { CustomerService } from "../api/services/CustomerService"
import { BillerService } from "../api/services/BillerService"
import { MerchantService } from "../api/services/MerchantService"
import { PrefundedService } from "../api/services/PrefundedService"
import { IMTService } from "../api/services/IMTService"
import { PeriodReportService } from "../api/services/PeriodReportService"
import { OperationsService } from "../api/services/OperationsService"

export const useTransactions = (options: { startDate?: string, endDate?: string, limit?: number, activeOnly?: boolean, serviceNames?: string[], msisdns?: string[], channels?: string[], transactionStatuses?: string[], enabled?: boolean } = {}) => {
  return useQuery({
    queryKey: ["transactions", options],
    enabled: options.enabled !== false,
    queryFn: () => CustomerService.getTransactions(
      options.startDate,
      options.endDate,
      options.serviceNames || [],
      options.msisdns || [],
      0,
      options.limit || 100,
      options.activeOnly || false,
      options.channels || [],
      options.transactionStatuses || [],
    )
  })
}

export const useTransactionsSummary = (options: { startDate?: string, endDate?: string, serviceNames?: string[], msisdns?: string[], channels?: string[], transactionStatuses?: string[] } = {}) => {
  return useQuery({
    queryKey: ["transactions-summary", options],
    queryFn: () => CustomerService.getTransactionsSummary(
      options.startDate,
      options.endDate,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.transactionStatuses || [],
    )
  })
}

export const useDailyStatsByType = (options: { startDate?: string, endDate?: string, serviceNames?: string[], msisdns?: string[], channels?: string[], limit?: number } = {}) => {
  return useQuery({
    queryKey: ["daily-stats-by-type", options],
    queryFn: () => CustomerService.getDailyStatsByType(
      options.startDate,
      options.endDate,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.limit || 5000
    )
  })
}

export const useDailyStatsByChannel = (options: { startDate?: string, endDate?: string, serviceNames?: string[], msisdns?: string[], channels?: string[], limit?: number, enabled?: boolean } = {}) => {
  return useQuery({
    queryKey: ["daily-stats-by-channel", options],
    enabled: options.enabled !== false,
    queryFn: () => CustomerService.getDailyStatsByChannel(
      options.startDate,
      options.endDate,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.limit || 10000
    ),
    placeholderData: keepPreviousData,
  })
}

export const useDailyStatsByDepartment = (options: { startDate?: string, endDate?: string, serviceNames?: string[], msisdns?: string[], channels?: string[], limit?: number, enabled?: boolean } = {}) => {
  return useQuery({
    queryKey: ["daily-stats-by-department", options],
    enabled: options.enabled !== false,
    queryFn: () => CustomerService.getDailyStatsByDepartment(
      options.startDate,
      options.endDate,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.limit || 10000
    ),
    placeholderData: keepPreviousData,
  })
}

export const useDailyTotals = (options: { startDate?: string, endDate?: string, serviceNames?: string[], msisdns?: string[], channels?: string[], departments?: string[] } = {}) => {
  return useQuery({
    queryKey: ["daily-totals", options],
    queryFn: () => CustomerService.getDailyTotals(
      options.startDate,
      options.endDate,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.departments || [],
    ),
    placeholderData: keepPreviousData,
  })
}

export const useSnapshotDailyByType = (options: { reportDate?: string, serviceNames?: string[], msisdns?: string[], channels?: string[] } = {}) => {
  return useQuery({
    queryKey: ["snapshot-daily-by-type", options],
    queryFn: () => CustomerService.getSnapshotDailyByType(
      options.reportDate,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || []
    )
  })
}

export const useActiveCustomers = (options: {
  startDate?: string, endDate?: string, limit?: number, offset?: number,
  walletType?: string | null,
  msisdns?: string[],
  transactionStatuses?: string[],
  enabled?: boolean,
} = {}) => {
  return useQuery({
    queryKey: ["active-customers", options],
    enabled: options.enabled !== false && !!options.startDate && !!options.endDate,
    queryFn: () => CustomerService.getActiveCustomers(
      options.startDate, options.endDate, options.limit ?? 100, options.offset ?? 0,
      options.walletType ?? null, options.msisdns ?? [], options.transactionStatuses ?? []
    )
  })
}

export const useComplianceKYCInfo = (options: { msisdns: string[], enabled?: boolean }) => {
  return useQuery({
    queryKey: ["compliance-kyc-info", options.msisdns.slice().sort()],
    enabled: options.enabled !== false && options.msisdns.length > 0,
    queryFn: () => CustomerService.getComplianceKYCInfo(options.msisdns),
    staleTime: 5 * 60_000,
  })
}

export const useSubsDashboard = (options: { startDate?: string, endDate?: string } = {}) => {
  return useQuery({
    queryKey: ["subs-dashboard", options],
    enabled: !!options.startDate && !!options.endDate,
    queryFn: () => CustomerService.getSubsDashboard(options.startDate, options.endDate)
  })
}

export const useAgentOtc = (options: {
  startDate?: string, endDate?: string, dateCode?: string,
  enabled?: boolean,
} = {}) => {
  return useQuery({
    queryKey: ["agent-otc", options],
    enabled: options.enabled !== false && !!options.startDate && !!options.endDate,
    queryFn: () => CustomerService.getAgentOtc(
      options.startDate!, options.endDate!, options.dateCode || null
    )
  })
}

export const useTransactionHistory = (options: {
  msisdn?: string, startDate?: string, endDate?: string, status?: string,
  enabled?: boolean,
} = {}) => {
  return useQuery({
    queryKey: ["transaction-history", options],
    enabled: options.enabled !== false && !!options.msisdn && !!options.startDate && !!options.endDate,
    queryFn: () => CustomerService.getTransactionHistory(
      options.msisdn!, options.startDate, options.endDate, options.status
    )
  })
}

export const useTransactionRange = (options: {
  startDate?: string, endDate?: string, serviceNames?: string[],
} = {}) => {
  return useQuery({
    queryKey: ["transaction-range", options],
    enabled: !!options.startDate && !!options.endDate,
    queryFn: () => CustomerService.getTransactionRange(
      options.startDate, options.endDate, options.serviceNames || []
    )
  })
}

export const useMtdByServiceName = (options: { reportDate?: string } = {}) => {
  return useQuery({
    queryKey: ["mtd-by-service-name", options],
    queryFn: () => CustomerService.getMtdByServiceName(options.reportDate)
  })
}

export const useMtdByDepartment = (options: { reportDate?: string } = {}) => {
  return useQuery({
    queryKey: ["mtd-by-department", options],
    queryFn: () => CustomerService.getMtdByDepartment(options.reportDate)
  })
}

export const useMtdByChannel = (options: { reportDate?: string } = {}) => {
  return useQuery({
    queryKey: ["mtd-by-channel", options],
    queryFn: () => CustomerService.getMtdByChannel(options.reportDate)
  })
}

export const useCustomerChurnCustom = (options: {
  activeStart?: string, activeEnd?: string,
  excludeStart?: string, excludeEnd?: string,
  returnList?: boolean, limit?: number,
  enabled?: boolean,
} = {}) => {
  return useQuery({
    queryKey: ["customer-churn-custom", options],
    enabled: options.enabled !== false
      && !!options.activeStart && !!options.activeEnd
      && !!options.excludeStart && !!options.excludeEnd,
    queryFn: () => CustomerService.getCustomerChurnCustom(
      options.activeStart!,
      options.activeEnd!,
      options.excludeStart!,
      options.excludeEnd!,
      options.returnList ?? false,
      options.limit ?? 100,
    )
  })
}

export const useCustomerChurnCustomEnriched = (options: {
  activeStart?: string, activeEnd?: string,
  excludeStart?: string, excludeEnd?: string,
  limit?: number, offset?: number,
  enabled?: boolean,
} = {}) => {
  return useQuery({
    queryKey: ["customer-churn-custom-enriched", options],
    enabled: options.enabled !== false
      && !!options.activeStart && !!options.activeEnd
      && !!options.excludeStart && !!options.excludeEnd,
    queryFn: () => CustomerService.getCustomerChurnCustomEnriched(
      options.activeStart!,
      options.activeEnd!,
      options.excludeStart!,
      options.excludeEnd!,
      options.limit ?? 500,
      options.offset ?? 0,
    )
  })
}

export const useImtChurn = (options: {
  activeStart?: string, activeEnd?: string,
  excludeStart?: string, excludeEnd?: string,
  returnList?: boolean, limit?: number,
  enabled?: boolean,
} = {}) => {
  return useQuery({
    queryKey: ["imt-churn", options],
    enabled: options.enabled !== false
      && !!options.activeStart && !!options.activeEnd
      && !!options.excludeStart && !!options.excludeEnd,
    queryFn: () => CustomerService.getImtChurn(
      options.activeStart!,
      options.activeEnd!,
      options.excludeStart!,
      options.excludeEnd!,
      options.returnList ?? false,
      options.limit ?? 100,
    )
  })
}

export const useBankWalletSnapshotDaily = (options: { reportDate?: string } = {}) => {
  return useQuery({
    queryKey: ["bank-wallet-snapshot-daily", options],
    queryFn: () => CustomerService.getBankWalletSnapshotDaily(options.reportDate)
  })
}

export const useBankWalletSnapshotMtd = (options: { reportDate?: string } = {}) => {
  return useQuery({
    queryKey: ["bank-wallet-snapshot-mtd", options],
    queryFn: () => CustomerService.getBankWalletSnapshotMtd(options.reportDate)
  })
}

export const useCustomerChurn = (options: { startDate?: string, period?: 30 | 60 | 90, returnList?: boolean, limit?: number } = {}) => {
  return useQuery({
    queryKey: ["customer-churn", options],
    queryFn: () => CustomerService.getCustomerChurn(
      options.startDate,
      options.period ?? 30,
      options.returnList ?? false,
      options.limit ?? 100
    )
  })
}

export const useSnapshotDailyByDimension = (options: {
  reportDate?: string,
  dimension?: 'DEPARTMENT' | 'CHANNEL',
  serviceNames?: string[],
  channels?: string[],
  departments?: string[],
  enabled?: boolean,
} = {}) => {
  return useQuery({
    queryKey: ["snapshot-daily-by-dimension", options],
    enabled: (options.enabled !== false) && !!options.reportDate && !!options.dimension,
    queryFn: () => CustomerService.getSnapshotDailyByDimension(
      options.reportDate, options.dimension ?? 'DEPARTMENT',
      options.serviceNames, options.channels, options.departments,
    ),
    placeholderData: keepPreviousData,
  })
}

export const useMtdSnapshotByDimension = (options: {
  reportDate?: string,
  dimension?: 'DEPARTMENT' | 'CHANNEL',
  serviceNames?: string[],
  channels?: string[],
  departments?: string[],
  enabled?: boolean,
} = {}) => {
  return useQuery({
    queryKey: ["mtd-snapshot-by-dimension", options],
    enabled: (options.enabled !== false) && !!options.reportDate && !!options.dimension,
    queryFn: () => CustomerService.getMtdSnapshotByDimension(
      options.reportDate, options.dimension ?? 'DEPARTMENT',
      options.serviceNames, options.channels, options.departments,
    ),
    placeholderData: keepPreviousData,
  })
}

export const usePeriodAggregatesByDimension = (options: {
  startDate?: string, endDate?: string,
  dimension?: 'TR_TYPE' | 'CHANNEL' | 'DEPARTMENT',
  serviceNames?: string[], msisdns?: string[],
  channels?: string[], departments?: string[],
  enabled?: boolean,
} = {}) => {
  return useQuery({
    queryKey: ["period-aggregates-by-dimension", options],
    enabled: (options.enabled !== false)
      && !!options.startDate && !!options.endDate && !!options.dimension,
    queryFn: () => CustomerService.getPeriodAggregatesByDimension(
      options.startDate!,
      options.endDate!,
      options.dimension!,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.departments || [],
    ),
    placeholderData: keepPreviousData,
  })
}

export const useMtdSnapshotByType = (options: {
  reportDate?: string, serviceNames?: string[], msisdns?: string[],
  channels?: string[], departments?: string[],
} = {}) => {
  return useQuery({
    queryKey: ["mtd-snapshot-by-type", options],
    queryFn: () => CustomerService.getMtdSnapshotByType(
      options.reportDate,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.departments || [],
    ),
    // Garde la donnée précédente pendant le refetch quand les filtres changent :
    // évite que la page bascule en "Loading dashboard" plein écran à chaque clic
    // de chip et masque temporairement le filtre + les charts.
    placeholderData: keepPreviousData,
  })
}

export const useMonthlyTotals = (options: { startMonth?: string, endMonth?: string, serviceNames?: string[], msisdns?: string[], channels?: string[], dayOfMonth?: number | null, departments?: string[] } = {}) => {
  return useQuery({
    queryKey: ["monthly-totals", options],
    queryFn: () => CustomerService.getMonthlyTotals(
      options.startMonth,
      options.endMonth,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.dayOfMonth ?? null,
      options.departments || [],
    ),
    placeholderData: keepPreviousData,
  })
}

export const useMtdStatsByMonthAndType = (options: { startMonth?: string, endMonth?: string, serviceNames?: string[], msisdns?: string[], channels?: string[], dayOfMonth?: number | null, departments?: string[] } = {}) => {
  return useQuery({
    queryKey: ["mtd-stats-by-month-type", options],
    queryFn: () => CustomerService.getMtdStatsByMonthAndType(
      options.startMonth,
      options.endMonth,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.dayOfMonth ?? null,
      options.departments || [],
    )
  })
}

export const useMtdStatsByMonthAndDepartment = (options: { startMonth?: string, endMonth?: string, serviceNames?: string[], msisdns?: string[], channels?: string[], dayOfMonth?: number | null } = {}) => {
  return useQuery({
    queryKey: ["mtd-stats-by-month-department", options],
    queryFn: () => CustomerService.getMtdStatsByMonthAndDepartment(
      options.startMonth,
      options.endMonth,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.dayOfMonth ?? null,
    )
  })
}

export const useMtdStatsByMonthAndChannel = (options: { startMonth?: string, endMonth?: string, serviceNames?: string[], msisdns?: string[], channels?: string[], dayOfMonth?: number | null } = {}) => {
  return useQuery({
    queryKey: ["mtd-stats-by-month-channel", options],
    queryFn: () => CustomerService.getMtdStatsByMonthAndChannel(
      options.startMonth,
      options.endMonth,
      options.serviceNames || [],
      options.msisdns || [],
      options.channels || [],
      options.dayOfMonth ?? null,
    )
  })
}

export const useCustomers = (options: {
  status?: string, kyc?: string, idStatus?: string, idClean?: string,
  hasAddress?: string, imtOptIn?: string,
  expiryDate?: string, createdStart?: string, createdEnd?: string,
  msisdn?: string, msisdns?: string[],
  shortcodes?: string[],
  identityType?: string,
  name?: string, names?: string[],
  dateCode?: string,
  limit?: number
} = {}) => {
  return useQuery({
    queryKey: ["customers", options],
    queryFn: () => CustomerService.getCustomers(
      options.status,
      options.kyc,
      options.idStatus,
      options.idClean,
      options.hasAddress,
      options.imtOptIn,
      options.expiryDate,
      options.createdStart,
      options.createdEnd,
      options.msisdn,
      options.msisdns,
      0,
      options.limit || 100,
      options.shortcodes,
      options.identityType,
      options.name,
      options.names,
      options.dateCode,
    )
  })
}

export const useUploadBulk = () => {
  return useMutation({
    mutationFn: (file: File) => AnalyticsService.uploadBulkAnalyticsUploadBulkPost(file)
  })
}

export const useHtListInfo = () => {
  return useQuery({
    queryKey: ["ht-list-info"],
    queryFn: () => AnalyticsService.getHtListInfoAnalyticsHtListInfoGet()
  })
}

export const useProcessHtList = () => {
  return {
    mutateAsync: () => AnalyticsService.processHtListAnalyticsProcessHtListPost()
  }
}

export const useCustomerSummary = (options: {
  status?: string, kyc?: string, idStatus?: string, idClean?: string,
  hasAddress?: string, imtOptIn?: string,
  expiryDate?: string, createdStart?: string, createdEnd?: string,
  msisdn?: string, msisdns?: string[],
  shortcodes?: string[],
  identityType?: string,
  name?: string, names?: string[],
} = {}) => {
  return useQuery({
    queryKey: ["customer-summary", options],
    queryFn: () => CustomerService.getSummary(
      options.status,
      options.kyc,
      options.idStatus,
      options.idClean,
      options.hasAddress,
      options.imtOptIn,
      options.expiryDate,
      options.createdStart,
      options.createdEnd,
      options.msisdn,
      options.msisdns,
      options.shortcodes,
      options.identityType,
      options.name,
      options.names,
    )
  })
}

export const useCustomerMTDStats = (options: { msisdns?: string[], startDate?: string, endDate?: string } = {}) => {
  return useQuery({
    queryKey: ["customer-mtd-stats", options],
    queryFn: () => CustomerService.getMtdStats(
      options.msisdns,
      options.startDate,
      options.endDate
    )
  })
}

export const useCustomerMTDStatsByDay = (options: { trType?: string, msisdns?: string[], startDate?: string, endDate?: string } = {}) => {
  return useQuery({
    queryKey: ["customer-mtd-stats-by-day", options],
    queryFn: () => CustomerService.getMtdStatsByDay(
      options.trType,
      options.msisdns,
      options.startDate,
      options.endDate
    )
  })
}

export const useBillerAccounts = (options: { limit?: number } = {}) => {
  return useQuery({
    queryKey: ["biller-accounts", options],
    queryFn: () => BillerService.getAccounts(
      options.limit || 100
    )
  })
}

export const useBillerTransactions = (options: { startDate?: string, endDate?: string, limit?: number, activeOnly?: boolean, billerIds?: string[], msisdns?: string[], channels?: string[], statuses?: string[] } = {}) => {
  return useQuery({
    queryKey: ["biller-transactions", options],
    queryFn: () => BillerService.getTransactions(
      options.startDate,
      options.endDate,
      options.limit || 100,
      options.activeOnly || false,
      options.billerIds,
      options.msisdns,
      options.channels,
      options.statuses,
    )
  })
}

export const useBillerMonthlyStats = (options: { startMonth?: string, endMonth?: string, billerIds?: string[], msisdns?: string[], channels?: string[], statuses?: string[], limit?: number } = {}) => {
  return useQuery({
    queryKey: ["biller-monthly-stats", options],
    queryFn: () => BillerService.getMonthlyStatsByBiller(
      options.startMonth,
      options.endMonth,
      options.billerIds,
      options.msisdns,
      options.channels,
      options.statuses,
      options.limit ?? 10000,
    )
  })
}

export const useBillerTransactionsSummary = (options: { startDate?: string, endDate?: string, billerIds?: string[], msisdns?: string[], channels?: string[], statuses?: string[] } = {}) => {
  return useQuery({
    queryKey: ["biller-transactions-summary", options],
    queryFn: () => BillerService.getTransactionsSummary(
      options.startDate,
      options.endDate,
      options.billerIds,
      options.msisdns,
      options.channels,
      options.statuses,
    )
  })
}

export const usePrefundedAccounts = (options: { limit?: number } = {}) => {
  return useQuery({
    queryKey: ["prefunded-accounts", options],
    queryFn: () => PrefundedService.getAccounts(
      options.limit || 100
    )
  })
}

export const usePrefundedTransactions = (options: { startDate?: string, endDate?: string, limit?: number, activeOnly?: boolean, orgIds?: string[], msisdns?: string[], channels?: string[], statuses?: string[] } = {}) => {
  return useQuery({
    queryKey: ["prefunded-transactions", options],
    queryFn: () => PrefundedService.getTransactions(
      options.startDate,
      options.endDate,
      options.limit || 100,
      options.activeOnly || false,
      options.orgIds,
      options.msisdns,
      options.channels,
      options.statuses,
    )
  })
}

export const usePrefundedMonthlyStats = (options: { startMonth?: string, endMonth?: string, orgIds?: string[], msisdns?: string[], channels?: string[], statuses?: string[], limit?: number } = {}) => {
  return useQuery({
    queryKey: ["prefunded-monthly-stats", options],
    queryFn: () => PrefundedService.getMonthlyStatsByOrg(
      options.startMonth,
      options.endMonth,
      options.orgIds,
      options.msisdns,
      options.channels,
      options.statuses,
      options.limit ?? 10000,
    )
  })
}

export const usePrefundedTransactionsSummary = (options: { startDate?: string, endDate?: string, orgIds?: string[], msisdns?: string[], channels?: string[], statuses?: string[] } = {}) => {
  return useQuery({
    queryKey: ["prefunded-transactions-summary", options],
    queryFn: () => PrefundedService.getTransactionsSummary(
      options.startDate,
      options.endDate,
      options.orgIds,
      options.msisdns,
      options.channels,
      options.statuses,
    )
  })
}

export const useMerchantAccounts = (options: {
  limit?: number, offset?: number,
  createdStart?: string, createdEnd?: string,
  merchantTypes?: string[], departments?: string[], statuses?: string[],
  search?: string,
} = {}) => {
  return useQuery({
    queryKey: ["merchant-accounts", options],
    queryFn: () => MerchantService.getAccounts(
      options.limit ?? 100, options.offset ?? 0,
      options.createdStart, options.createdEnd,
      options.merchantTypes, options.departments, options.statuses,
      options.search,
    ),
    placeholderData: keepPreviousData,
  })
}

export const useMerchantAccountsFilterOptions = () => {
  return useQuery({
    queryKey: ["merchant-accounts-filter-options"],
    queryFn:  () => MerchantService.getAccountsFilterOptions(),
    staleTime: 5 * 60_000,
  })
}

export const useActiveMerchants = (options: {
  startDate?: string, endDate?: string, limit?: number, offset?: number,
} = {}) => {
  return useQuery({
    queryKey: ["active-merchants", options],
    enabled: !!options.startDate && !!options.endDate,
    queryFn: () => MerchantService.getActiveMerchants(
      options.startDate, options.endDate, options.limit ?? 500, options.offset ?? 0
    )
  })
}

export const useMerchantTransactions = (options: { startDate?: string, endDate?: string, limit?: number, serviceNames?: string[], merchantIds?: string[], channels?: string[], msisdns?: string[], statuses?: string[] } = {}) => {
  return useQuery({
    queryKey: ["merchant-transactions", options],
    queryFn: () => MerchantService.getTransactions(
      options.startDate,
      options.endDate,
      options.serviceNames || [],
      options.merchantIds || [],
      0,
      options.limit || 100,
      options.channels || [],
      options.msisdns || [],
      options.statuses,
    )
  })
}

export const useMerchantMonthlyStats = (options: { startMonth?: string, endMonth?: string, serviceNames?: string[], merchantIds?: string[], msisdns?: string[], channels?: string[], statuses?: string[], limit?: number } = {}) => {
  return useQuery({
    queryKey: ["merchant-monthly-stats", options],
    queryFn: () => MerchantService.getMonthlyStatsByMerchant(
      options.startMonth,
      options.endMonth,
      options.serviceNames || [],
      options.merchantIds || [],
      options.msisdns || [],
      options.channels || [],
      options.statuses,
      options.limit ?? 10000,
    )
  })
}

export const useMerchantTransactionsSummary = (options: { startDate?: string, endDate?: string, serviceNames?: string[], merchantIds?: string[], channels?: string[], msisdns?: string[], statuses?: string[] } = {}) => {
  return useQuery({
    queryKey: ["merchant-transactions-summary", options],
    queryFn: () => MerchantService.getTransactionsSummary(
      options.startDate,
      options.endDate,
      options.serviceNames || [],
      options.merchantIds || [],
      options.channels || [],
      options.msisdns || [],
      options.statuses,
    )
  })
}

export const useIMTTransactions = (options: { startDate?: string, endDate?: string, limit?: number, msisdns?: string[], senderIds?: string[], channels?: string[], statuses?: string[] } = {}) => {
  return useQuery({
    queryKey: ["imt-transactions", options],
    queryFn: () => IMTService.getTransactions(
      options.startDate,
      options.endDate,
      options.limit || 100,
      options.msisdns,
      options.senderIds,
      options.channels,
      options.statuses,
    )
  })
}

export const useIMTTransactionsSummary = (options: { startDate?: string, endDate?: string, msisdns?: string[], senderIds?: string[], channels?: string[], statuses?: string[] } = {}) => {
  return useQuery({
    queryKey: ["imt-transactions-summary", options],
    queryFn: () => IMTService.getTransactionsSummary(
      options.startDate,
      options.endDate,
      options.msisdns,
      options.senderIds,
      options.channels,
      options.statuses,
    )
  })
}

export const usePeriodReport = (options: { startDate: string, endDate: string, enabled?: boolean }) => {
  return useQuery({
    queryKey: ["period-report", options.startDate, options.endDate],
    queryFn: () => PeriodReportService.getPeriodReport(options.startDate, options.endDate),
    enabled: options.enabled !== false && !!options.startDate && !!options.endDate,
    staleTime: 60_000,
  })
}

export const usePeriodChannelMatrix = (options: { startDate: string, endDate: string, enabled?: boolean }) => {
  return useQuery({
    queryKey: ["period-report-channel-matrix", options.startDate, options.endDate],
    queryFn: () => PeriodReportService.getChannelCategoryMatrix(options.startDate, options.endDate),
    enabled: options.enabled !== false && !!options.startDate && !!options.endDate,
    staleTime: 60_000,
  })
}

export const usePeriodRegulatoryReport = (options: { referenceDate: string, enabled?: boolean }) => {
  return useQuery({
    queryKey: ["period-report-regulatory", options.referenceDate],
    queryFn: () => PeriodReportService.getRegulatoryReport(options.referenceDate),
    enabled: options.enabled !== false && !!options.referenceDate,
    staleTime: 60_000,
  })
}

export const useOperationsTransactions = (options: {
  startDate?: string, endDate?: string, limit?: number,
  reasonTypes?: string[], statuses?: string[],
  initiators?: string[], transactionIds?: string[],
} = {}) => {
  return useQuery({
    queryKey: ["operations-transactions", options],
    queryFn: () => OperationsService.getTransactions(
      options.startDate, options.endDate, options.limit || 100,
      options.reasonTypes, options.statuses,
      options.initiators, options.transactionIds,
    )
  })
}

export const useOperationsTransactionsSummary = (options: {
  startDate?: string, endDate?: string,
  reasonTypes?: string[], statuses?: string[],
  initiators?: string[], transactionIds?: string[],
} = {}) => {
  return useQuery({
    queryKey: ["operations-transactions-summary", options],
    queryFn: () => OperationsService.getTransactionsSummary(
      options.startDate, options.endDate, options.reasonTypes, options.statuses,
      options.initiators, options.transactionIds,
    )
  })
}

export const useOperationsInitiators = (options: { startDate?: string, endDate?: string } = {}) => {
  return useQuery({
    queryKey: ["operations-initiators", options.startDate, options.endDate],
    queryFn: () => OperationsService.getDistinctInitiators(options.startDate, options.endDate),
    staleTime: 5 * 60_000,   // dropdown — pas besoin de refetch souvent
  })
}

// ── E-money operations transactions (Withdrawal / Deposit) with Biller/Merchant/Other classification ──
export const useEmoneyOpsTransactions = (options: {
  startDate?: string, endDate?: string, limit?: number,
  statuses?: string[], initiators?: string[], transactionIds?: string[],
  accountClasses?: string[],
} = {}) => {
  return useQuery({
    queryKey: ["emoney-ops-transactions", options],
    queryFn: () => OperationsService.getEmoneyTransactions(
      options.startDate, options.endDate, options.limit || 100,
      options.statuses, options.initiators,
      options.transactionIds, options.accountClasses,
    )
  })
}

export const useEmoneyOpsTransactionsSummary = (options: {
  startDate?: string, endDate?: string,
  statuses?: string[], initiators?: string[], transactionIds?: string[],
  accountClasses?: string[],
} = {}) => {
  return useQuery({
    queryKey: ["emoney-ops-transactions-summary", options],
    queryFn: () => OperationsService.getEmoneyTransactionsSummary(
      options.startDate, options.endDate, options.statuses,
      options.initiators, options.transactionIds, options.accountClasses,
    )
  })
}

export const useEmoneyOpsInitiators = (options: { startDate?: string, endDate?: string } = {}) => {
  return useQuery({
    queryKey: ["emoney-ops-initiators", options.startDate, options.endDate],
    queryFn: () => OperationsService.getEmoneyDistinctInitiators(options.startDate, options.endDate),
    staleTime: 5 * 60_000,
  })
}
