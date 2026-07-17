/* hand-written — Operations team transactions */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';

export class OperationsService {
    public static getTransactions(
        startDate?: string,
        endDate?:   string,
        limit:      number = 100,
        reasonTypes?: Array<string>,
        statuses?:    Array<string>,
        initiators?:  Array<string>,
        transactionIds?: Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/operations/transactions',
            query: {
                'start_date':      startDate,
                'end_date':        endDate,
                'limit':           limit,
                'reason_types':    reasonTypes,
                'statuses':        statuses,
                'initiators':      initiators,
                'transaction_ids': transactionIds,
            },
        });
    }

    public static getTransactionsSummary(
        startDate?: string,
        endDate?:   string,
        reasonTypes?: Array<string>,
        statuses?:    Array<string>,
        initiators?:  Array<string>,
        transactionIds?: Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/operations/transactions/summary',
            query: {
                'start_date':      startDate,
                'end_date':        endDate,
                'reason_types':    reasonTypes,
                'statuses':        statuses,
                'initiators':      initiators,
                'transaction_ids': transactionIds,
            },
        });
    }

    public static getDistinctInitiators(
        startDate?: string,
        endDate?:   string,
    ): CancelablePromise<Array<string>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/operations/initiators',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
            },
        });
    }

    // ── E-money operations transactions (Withdrawal / Deposit) with ACCOUNT_CLASS ──
    public static getEmoneyTransactions(
        startDate?: string,
        endDate?:   string,
        limit:      number = 100,
        statuses?:        Array<string>,
        initiators?:      Array<string>,
        transactionIds?:  Array<string>,
        accountClasses?:  Array<string>,
    ): CancelablePromise<Array<any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/operations/emoney-transactions',
            query: {
                'start_date':      startDate,
                'end_date':        endDate,
                'limit':           limit,
                'statuses':        statuses,
                'initiators':      initiators,
                'transaction_ids': transactionIds,
                'account_classes': accountClasses,
            },
        });
    }

    public static getEmoneyTransactionsSummary(
        startDate?: string,
        endDate?:   string,
        statuses?:        Array<string>,
        initiators?:      Array<string>,
        transactionIds?:  Array<string>,
        accountClasses?:  Array<string>,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/operations/emoney-transactions/summary',
            query: {
                'start_date':      startDate,
                'end_date':        endDate,
                'statuses':        statuses,
                'initiators':      initiators,
                'transaction_ids': transactionIds,
                'account_classes': accountClasses,
            },
        });
    }

    public static getEmoneyDistinctInitiators(
        startDate?: string,
        endDate?:   string,
    ): CancelablePromise<Array<string>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/operations/emoney-initiators',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
            },
        });
    }
}
