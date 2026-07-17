/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TransactionResponse = {
    TRANSACTIONID: string;
    TRANSACTION_DATE: string;
    TR_TYPE: string;
    MSISDN: string;
    ORIGINALAMOUNT: number;
    CHARGEAMOUNT?: (number | null);
    STATUS: string;
    FAILURE_REASON?: (string | null);
    INITIORTE_TYPE?: (string | null);
    INITIATOR?: (string | null);
};

