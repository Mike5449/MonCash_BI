/* generated using openapi-typescript-codegen -- do not edit */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';

export class BillerService {
    public static getAccounts(
        limit: number = 100,
        startDate?: string,
        endDate?: string,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billers/accounts',
            query: {
                'limit':      limit,
                'start_date': startDate,
                'end_date':   endDate,
            },
        });
    }

    public static getTransactions(
        startDate?: string,
        endDate?: string,
        limit: number = 100,
        activeOnly: boolean = false,
        billerIds?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        statuses?: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billers/transactions',
            query: {
                'start_date':  startDate,
                'end_date':    endDate,
                'limit':       limit,
                'active_only': activeOnly,
                'biller_ids':  billerIds,
                'msisdns':     msisdns,
                'channels':    channels,
                'statuses':    statuses,
            },
        });
    }

    public static getMonthlyStatsByBiller(
        startMonth?: string,
        endMonth?: string,
        billerIds?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        statuses?: Array<string>,
        limit: number = 10000,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billers/monthly-stats',
            query: {
                'start_month': startMonth,
                'end_month':   endMonth,
                'biller_ids':  billerIds,
                'msisdns':     msisdns,
                'channels':    channels,
                'statuses':    statuses,
                'limit':       limit,
            },
        });
    }

    public static getTransactionsSummary(
        startDate?: string,
        endDate?: string,
        billerIds?: Array<string>,
        msisdns?: Array<string>,
        channels?: Array<string>,
        statuses?: Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billers/transactions/summary',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
                'biller_ids': billerIds,
                'msisdns':    msisdns,
                'channels':   channels,
                'statuses':   statuses,
            },
        });
    }
}
