/* generated using openapi-typescript-codegen -- do not edit */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';

export class MerchantService {
    public static getAccounts(
        limit: number = 100,
        offset: number = 0,
        createdStart?: string,
        createdEnd?:   string,
        merchantTypes?: Array<string>,
        departments?:   Array<string>,
        statuses?:      Array<string>,
        search?:        string,
    ): CancelablePromise<{ rows: any[]; total: number; summary: any }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/merchants/accounts',
            query: {
                'limit':          limit,
                'offset':         offset,
                'created_start':  createdStart,
                'created_end':    createdEnd,
                'merchant_types': merchantTypes,
                'departments':    departments,
                'statuses':       statuses,
                'search':         search,
            },
        });
    }

    public static getAccountsFilterOptions(): CancelablePromise<{
        merchant_types: string[]; departments: string[]; statuses: string[];
    }> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/merchants/accounts/filter-options',
        });
    }

    public static getTransactions(
        startDate?: (string | null),
        endDate?: (string | null),
        serviceNames?: Array<string>,
        merchantIds?: Array<string>,
        skip?: number,
        limit: number = 100,
        channels?: Array<string>,
        msisdns?: Array<string>,
        statuses?: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/merchants/transactions',
            query: {
                'start_date':    startDate,
                'end_date':      endDate,
                'service_names': serviceNames,
                'merchant_ids':  merchantIds,
                'msisdns':       msisdns,
                'channels':      channels,
                'statuses':      statuses,
                'skip':          skip,
                'limit':         limit,
            },
        });
    }

    public static getActiveMerchants(
        startDate?: (string | null),
        endDate?: (string | null),
        limit: number = 500,
        offset: number = 0,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/merchants/active-merchants',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
                'limit':      limit,
                'offset':     offset,
            },
        });
    }

    public static getMonthlyStatsByMerchant(
        startMonth?: (string | null),
        endMonth?: (string | null),
        serviceNames?: Array<string>,
        merchantIds?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        statuses?: Array<string>,
        limit: number = 10000,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/merchants/monthly-stats',
            query: {
                'start_month':   startMonth,
                'end_month':     endMonth,
                'service_names': serviceNames,
                'merchant_ids':  merchantIds,
                'msisdns':       msisdns,
                'channels':      channels,
                'statuses':      statuses,
                'limit':         limit,
            },
        });
    }

    public static getTransactionsSummary(
        startDate?: (string | null),
        endDate?: (string | null),
        serviceNames?: Array<string>,
        merchantIds?: Array<string>,
        channels?: Array<string>,
        msisdns?: Array<string>,
        statuses?: Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/merchants/transactions/summary',
            query: {
                'start_date':    startDate,
                'end_date':      endDate,
                'service_names': serviceNames,
                'merchant_ids':  merchantIds,
                'msisdns':       msisdns,
                'channels':      channels,
                'statuses':      statuses,
            },
        });
    }
}
