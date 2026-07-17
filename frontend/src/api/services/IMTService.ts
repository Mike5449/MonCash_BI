/* hand-written — IMT receiving transactions */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';

export class IMTService {
    public static getTransactions(
        startDate?: string,
        endDate?: string,
        limit: number = 100,
        msisdns?: Array<string>,
        senderIds?: Array<string>,
        channels?: Array<string>,
        statuses?: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/imt/transactions',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
                'limit':      limit,
                'msisdns':    msisdns,
                'sender_ids': senderIds,
                'channels':   channels,
                'statuses':   statuses,
            },
        });
    }

    public static getTransactionsSummary(
        startDate?: string,
        endDate?: string,
        msisdns?: Array<string>,
        senderIds?: Array<string>,
        channels?: Array<string>,
        statuses?: Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/imt/transactions/summary',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
                'msisdns':    msisdns,
                'sender_ids': senderIds,
                'channels':   channels,
                'statuses':   statuses,
            },
        });
    }
}
