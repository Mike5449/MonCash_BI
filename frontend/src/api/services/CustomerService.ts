/* generated using openapi-typescript-codegen -- do not edit */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';

export class CustomerService {
    public static getCustomers(
        status?: (string | null),
        kyc?: (string | null),
        idStatus?: (string | null),
        idClean?: (string | null),
        hasAddress?: (string | null),
        imtOptIn?: (string | null),
        expiryDate?: (string | null),
        createdStart?: (string | null),
        createdEnd?: (string | null),
        msisdn?: (string | null),
        msisdns?: Array<string>,
        skip?: number,
        limit: number = 100,
        shortcodes?: Array<string>,
        identityType?: (string | null),
        name?: (string | null),
        names?: Array<string>,
        dateCode?: (string | null),
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers',
            query: {
                'status': status,
                'kyc': kyc,
                'id_status': idStatus,
                'id_clean': idClean,
                'has_address': hasAddress,
                'imt_opt_in': imtOptIn,
                'expiry_date': expiryDate,
                'created_start': createdStart,
                'created_end': createdEnd,
                'msisdn': msisdn,
                'msisdns': msisdns,
                'shortcodes': shortcodes,
                'identity_type': identityType,
                'name':  name,
                'names': names,
                'date_code': dateCode,
                'skip': skip,
                'limit': limit,
            },
        });
    }

    public static getSummary(
        status?: (string | null),
        kyc?: (string | null),
        idStatus?: (string | null),
        idClean?: (string | null),
        hasAddress?: (string | null),
        imtOptIn?: (string | null),
        expiryDate?: (string | null),
        createdStart?: (string | null),
        createdEnd?: (string | null),
        msisdn?: (string | null),
        msisdns?: Array<string>,
        shortcodes?: Array<string>,
        identityType?: (string | null),
        name?: (string | null),
        names?: Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/summary',
            query: {
                'status': status,
                'kyc': kyc,
                'id_status': idStatus,
                'id_clean': idClean,
                'has_address': hasAddress,
                'imt_opt_in': imtOptIn,
                'expiry_date': expiryDate,
                'created_start': createdStart,
                'created_end': createdEnd,
                'msisdn': msisdn,
                'msisdns': msisdns,
                'shortcodes': shortcodes,
                'identity_type': identityType,
                'name':  name,
                'names': names,
            },
        });
    }

    public static getTransactions(
        startDate?: (string | null),
        endDate?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        skip?: number,
        limit: number = 100,
        activeOnly: boolean = false,
        channels?: Array<string>,
        transactionStatuses?: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/transactions',
            query: {
                'start_date': startDate,
                'end_date': endDate,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'transaction_statuses': transactionStatuses,
                'skip': skip,
                'limit': limit,
                'active_only': activeOnly
            },
        });
    }

    public static getTransactionsSummary(
        startDate?: (string | null),
        endDate?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        transactionStatuses?: Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/transactions/summary',
            query: {
                'start_date': startDate,
                'end_date': endDate,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'transaction_statuses': transactionStatuses,
            },
        });
    }

    public static getDailyStatsByType(
        startDate?: (string | null),
        endDate?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        limit: number = 5000
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/daily-stats-by-type',
            query: {
                'start_date': startDate,
                'end_date': endDate,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'limit': limit,
            },
        });
    }

    public static getDailyStatsByChannel(
        startDate?: (string | null),
        endDate?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        limit: number = 10000
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/daily-stats-by-channel',
            query: {
                'start_date': startDate,
                'end_date': endDate,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'limit': limit,
            },
        });
    }

    public static getDailyStatsByDepartment(
        startDate?: (string | null),
        endDate?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        limit: number = 10000
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/daily-stats-by-department',
            query: {
                'start_date': startDate,
                'end_date': endDate,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'limit': limit,
            },
        });
    }

    public static getDailyTotals(
        startDate?: (string | null),
        endDate?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        departments?: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/daily-totals',
            query: {
                'start_date': startDate,
                'end_date': endDate,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'departments': departments,
            },
        });
    }

    public static getSnapshotDailyByType(
        reportDate?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/snapshot-daily-by-type',
            query: {
                'report_date': reportDate,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
            },
        });
    }

    public static getMtdSnapshotByType(
        reportDate?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        departments?: Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/snapshot-mtd-by-type',
            query: {
                'report_date':   reportDate,
                'service_names': serviceNames,
                'msisdns':       msisdns,
                'channels':      channels,
                'departments':   departments,
            },
        });
    }

    public static getSnapshotDailyByDimension(
        reportDate?: (string | null),
        dimension: 'DEPARTMENT' | 'CHANNEL' = 'DEPARTMENT',
        serviceNames?: Array<string>,
        channels?:     Array<string>,
        departments?:  Array<string>,
        msisdns?:      Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/snapshot-daily-by-dimension',
            query: {
                'report_date':   reportDate,
                'dimension':     dimension,
                'service_names': serviceNames,
                'msisdns':       msisdns,
                'channels':      channels,
                'departments':   departments,
            },
        });
    }

    public static getMtdSnapshotByDimension(
        reportDate?: (string | null),
        dimension: 'DEPARTMENT' | 'CHANNEL' = 'DEPARTMENT',
        serviceNames?: Array<string>,
        channels?:     Array<string>,
        departments?:  Array<string>,
        msisdns?:      Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/snapshot-mtd-by-dimension',
            query: {
                'report_date':   reportDate,
                'dimension':     dimension,
                'service_names': serviceNames,
                'msisdns':       msisdns,
                'channels':      channels,
                'departments':   departments,
            },
        });
    }

    public static getPeriodAggregatesByDimension(
        startDate: string,
        endDate:   string,
        dimension: 'TR_TYPE' | 'CHANNEL' | 'DEPARTMENT',
        serviceNames?: Array<string>,
        msisdns?:      Array<string>,
        channels?:     Array<string>,
        departments?:  Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/period-aggregates-by-dimension',
            query: {
                'start_date':    startDate,
                'end_date':      endDate,
                'dimension':     dimension,
                'service_names': serviceNames,
                'msisdns':       msisdns,
                'channels':      channels,
                'departments':   departments,
            },
        });
    }

    public static getActiveCustomers(
        startDate?: (string | null),
        endDate?: (string | null),
        limit: number = 100,
        offset: number = 0,
        walletType?: (string | null),
        msisdns?: Array<string>,
        transactionStatuses?: Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/active-customers',
            query: {
                'start_date':           startDate,
                'end_date':             endDate,
                'limit':                limit,
                'offset':               offset,
                'wallet_type':          walletType,
                'msisdns':              msisdns,
                'transaction_statuses': transactionStatuses,
            },
        });
    }

    public static getComplianceKYCInfo(
        msisdns: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/compliance-kyc-info',
            query: {
                'msisdns': msisdns,
            },
        });
    }

    public static getSubsDashboard(
        startDate?: (string | null),
        endDate?: (string | null),
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/subs-dashboard',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
            },
        });
    }

    public static getAgentOtc(
        startDate: string,
        endDate: string,
        dateCode?: (string | null),
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/agent-otc',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
                'date_code':  dateCode,
            },
        });
    }

    public static getTransactionHistory(
        msisdn: string,
        startDate?: (string | null),
        endDate?: (string | null),
        status?: (string | null),
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/transaction-history',
            query: {
                'msisdn':     msisdn,
                'start_date': startDate,
                'end_date':   endDate,
                'status':     status,
            },
        });
    }

    public static getTransactionRange(
        startDate?: (string | null),
        endDate?: (string | null),
        serviceNames?: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/transaction-range',
            query: {
                'start_date':    startDate,
                'end_date':      endDate,
                'service_names': serviceNames,
            },
        });
    }

    public static getMtdByServiceName(
        reportDate?: (string | null),
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/mtd-by-service-name',
            query: {
                'report_date': reportDate,
            },
        });
    }

    public static getMtdByDepartment(
        reportDate?: (string | null),
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/mtd-by-department',
            query: {
                'report_date': reportDate,
            },
        });
    }

    public static getMtdByChannel(
        reportDate?: (string | null),
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/mtd-by-channel',
            query: {
                'report_date': reportDate,
            },
        });
    }

    public static getCustomerChurnCustom(
        activeStart: string,
        activeEnd: string,
        excludeStart: string,
        excludeEnd: string,
        returnList: boolean = false,
        limit: number = 100,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/churn-custom',
            query: {
                'active_start':  activeStart,
                'active_end':    activeEnd,
                'exclude_start': excludeStart,
                'exclude_end':   excludeEnd,
                'return_list':   returnList,
                'limit':         limit,
            },
        });
    }

    public static getCustomerChurnCustomEnriched(
        activeStart: string,
        activeEnd: string,
        excludeStart: string,
        excludeEnd: string,
        limit: number = 500,
        offset: number = 0,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/churn-custom-enriched',
            query: {
                'active_start':  activeStart,
                'active_end':    activeEnd,
                'exclude_start': excludeStart,
                'exclude_end':   excludeEnd,
                'limit':         limit,
                'offset':        offset,
            },
        });
    }

    public static getImtChurn(
        activeStart: string,
        activeEnd: string,
        excludeStart: string,
        excludeEnd: string,
        returnList: boolean = false,
        limit: number = 100,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/imt-churn',
            query: {
                'active_start':  activeStart,
                'active_end':    activeEnd,
                'exclude_start': excludeStart,
                'exclude_end':   excludeEnd,
                'return_list':   returnList,
                'limit':         limit,
            },
        });
    }

    public static getBankWalletSnapshotDaily(
        reportDate?: (string | null),
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/snapshot-bank-wallet-daily',
            query: {
                'report_date': reportDate,
            },
        });
    }

    public static getBankWalletSnapshotMtd(
        reportDate?: (string | null),
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/snapshot-bank-wallet-mtd',
            query: {
                'report_date': reportDate,
            },
        });
    }

    public static getCustomerChurn(
        startDate?: (string | null),
        period: number = 30,
        returnList: boolean = false,
        limit: number = 100
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/churn',
            query: {
                'start_date': startDate,
                'period': period,
                'return_list': returnList,
                'limit': limit,
            },
        });
    }

    public static lookupMsisdnDepartments(
        msisdns: Array<string>,
    ): CancelablePromise<{ results: Array<{ MSISDN: string; DEPARTMENT: string }> }> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/customers/msisdn-departments',
            body: { msisdns },
            mediaType: 'application/json',
        });
    }

    public static getMonthlyTotals(
        startMonth?: (string | null),
        endMonth?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        dayOfMonth?: (number | null),
        departments?: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/monthly-totals',
            query: {
                'start_month': startMonth,
                'end_month': endMonth,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'day_of_month': dayOfMonth,
                'departments': departments,
            },
        });
    }

    public static getMtdStatsByMonthAndType(
        startMonth?: (string | null),
        endMonth?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        dayOfMonth?: (number | null),
        departments?: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/mtd-stats-by-month-type',
            query: {
                'start_month': startMonth,
                'end_month': endMonth,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'day_of_month': dayOfMonth,
                'departments': departments,
            },
        });
    }

    public static getMtdStatsByMonthAndDepartment(
        startMonth?: (string | null),
        endMonth?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        dayOfMonth?: (number | null),
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/mtd-stats-by-month-department',
            query: {
                'start_month': startMonth,
                'end_month': endMonth,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'day_of_month': dayOfMonth,
            },
        });
    }

    public static getMtdStatsByMonthAndChannel(
        startMonth?: (string | null),
        endMonth?: (string | null),
        serviceNames?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        dayOfMonth?: (number | null),
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/mtd-stats-by-month-channel',
            query: {
                'start_month': startMonth,
                'end_month': endMonth,
                'service_names': serviceNames,
                'msisdns': msisdns,
                'channels': channels,
                'day_of_month': dayOfMonth,
            },
        });
    }

    public static getMtdStats(
        msisdns?: Array<string>,
        startDate?: string,
        endDate?: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/mtd-stats',
            query: {
                'msisdns': msisdns,
                'start_date': startDate,
                'end_date': endDate,
            },
        });
    }

    public static getMtdStatsByDay(
        trType?: string,
        msisdns?: Array<string>,
        startDate?: string,
        endDate?: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/customers/mtd-stats/by-day',
            query: {
                'tr_type': trType,
                'msisdns': msisdns,
                'start_date': startDate,
                'end_date': endDate,
            },
        });
    }

}
