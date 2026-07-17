from sqlalchemy import text
from typing import List, Dict, Any, Optional


class BillerTransactionRepository:
    """
    Customer Bill Payment transactions.

    Data semantics:
    - DEBITPARTYIDENTIFIER = subscriber MSISDN (the customer paying)
    - CREDITPARTYIDENTIFIER = biller ID (the entity collecting payment)
    """

    def __init__(self, db):
        self.db = db

    @staticmethod
    def _quote_list(values: List[str]) -> str:
        cleaned = [str(v).replace("'", "''").strip() for v in values if v and str(v).strip()]
        return "'" + "','".join(cleaned) + "'"

    def _build_where(
        self,
        start_date: Optional[str],
        end_date: Optional[str],
        biller_ids: Optional[List[str]],
        msisdns: Optional[List[str]],
        channels: Optional[List[str]],
        statuses: Optional[List[str]] = None,
    ) -> str:
        # SERVICENAME stays hardcoded — this repository is scoped to Customer Bill Payment only.
        where = "WHERE SERVICENAME = 'Customer Bill Payment'"

        # TRANSACTIONSTATUS: if no explicit status filter is provided, default to 'Completed'
        # (= legacy behaviour). Pass statuses=['*'] (or any wildcard) to disable the filter.
        if statuses:
            cleaned = [s.strip() for s in statuses if s and s.strip()]
            wildcards = {"*", "ALL", "all"}
            if cleaned and not any(s in wildcards for s in cleaned):
                where += f" AND TRANSACTIONSTATUS IN ({self._quote_list(cleaned)})"
        else:
            where += " AND TRANSACTIONSTATUS = 'Completed'"

        if start_date:
            where += f" AND TO_DATE(TRANSACTIONFINISHTIME) >= '{start_date}'"
        if end_date:
            where += f" AND TO_DATE(TRANSACTIONFINISHTIME) <= '{end_date}'"
        if biller_ids:
            cleaned = [b.strip() for b in biller_ids if b and b.strip()]
            if cleaned:
                where += f" AND CREDITPARTYIDENTIFIER IN ({self._quote_list(cleaned)})"
        if msisdns:
            cleaned = [m.strip() for m in msisdns if m and m.strip()]
            if cleaned:
                where += f" AND DEBITPARTYIDENTIFIER IN ({self._quote_list(cleaned)})"
        if channels:
            cleaned = [c.strip().upper() for c in channels if c and c.strip()]
            if cleaned:
                where += f" AND UPPER(CHANNEL) IN ({self._quote_list(cleaned)})"
        return where

    def get_transactions(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: int = 100,
        active_only: bool = False,
        biller_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        where_clause = self._build_where(start_date, end_date, biller_ids, msisdns, channels, statuses)

        if active_only:
            query = f"""
            SELECT
                CREDITPARTYIDENTIFIER          AS ACCOUNT_ID,
                MAX(TRANSACTIONFINISHTIME)     AS LATEST_TRANSACTION,
                COUNT(*)                       AS TRANSACTION_COUNT,
                SUM(ORIGINALAMOUNT)            AS TOTAL_VOLUME,
                'BILLER'                       AS ACCOUNT_TYPE
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            {where_clause}
            GROUP BY CREDITPARTYIDENTIFIER
            ORDER BY MAX(TRANSACTIONFINISHTIME) DESC
            LIMIT {limit}
            """
        else:
            query = f"""
            SELECT
                TRANSACTIONID,
                TRANSACTIONFINISHTIME           AS TRANSACTION_DATE,
                DEBITPARTYIDENTIFIER            AS MSISDN,
                CREDITPARTYIDENTIFIER           AS ACCOUNT_ID,
                CREDITPARTYNAME                 AS BILLER_NAME,
                ORIGINALAMOUNT,
                CHARGEAMOUNT,
                SERVICENAME                     AS TR_TYPE,
                CHANNEL,
                TRANSACTIONSTATUS               AS STATUS,
                'BILLER'                        AS ACCOUNT_TYPE
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            {where_clause}
            ORDER BY TRANSACTIONFINISHTIME DESC
            LIMIT {limit}
            """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_summary(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        biller_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        KPI aggregate over the filtered period:
        - UNIQUE_SUBS    = COUNT(DISTINCT DEBITPARTYIDENTIFIER)
        - UNIQUE_BILLERS = COUNT(DISTINCT CREDITPARTYIDENTIFIER)
        - VOLUME         = COUNT(DISTINCT TRANSACTIONID)
        - VALUE          = SUM(ORIGINALAMOUNT)
        - REVENUE        = SUM(CHARGEAMOUNT)
        """
        where_clause = self._build_where(start_date, end_date, biller_ids, msisdns, channels, statuses)
        query = f"""
        SELECT
            COUNT(DISTINCT DEBITPARTYIDENTIFIER)  AS UNIQUE_SUBS,
            COUNT(DISTINCT CREDITPARTYIDENTIFIER) AS UNIQUE_BILLERS,
            COUNT(DISTINCT TRANSACTIONID)         AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT), 0)      AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),  0)       AS REVENUE
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        {where_clause}
        """
        row = next(iter(self.db.execute(text(query)).mappings()), None) or {}
        return {
            "UNIQUE_SUBS":    int(row.get("UNIQUE_SUBS")    or 0),
            "UNIQUE_BILLERS": int(row.get("UNIQUE_BILLERS") or 0),
            "VOLUME":         int(row.get("VOLUME")         or 0),
            "VALUE":          float(row.get("VALUE")        or 0),
            "REVENUE":        float(row.get("REVENUE")      or 0),
        }

    def get_monthly_stats_by_biller(
        self,
        start_month: Optional[str] = None,
        end_month: Optional[str] = None,
        biller_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> Dict[str, Any]:
        """
        Monthly aggregates per (MONTH, BILLER_ID = CREDITPARTYIDENTIFIER).

        For each (YYYY-MM, BILLER_ID):
        - SUBS    = COUNT(DISTINCT DEBITPARTYIDENTIFIER)  — distinct customers paying this biller this month
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID)
        - VALUE   = SUM(ORIGINALAMOUNT) HTG
        - REVENUE = SUM(CHARGEAMOUNT)   HTG
        - BILLER_NAME = MAX(CREDITPARTYNAME)  — biller display name

        Hardcoded service filter ('Customer Bill Payment') and default status filter
        ('Completed') apply through _build_where.
        """
        # Normalize month bounds: first day of start_month → last day of end_month
        from datetime import date, timedelta
        def first_of(yyyy_mm_dd: str) -> date:
            y, m, _ = yyyy_mm_dd.split('-')
            return date(int(y), int(m), 1)
        def end_of_month(d: date) -> date:
            if d.month == 12:
                nxt = date(d.year + 1, 1, 1)
            else:
                nxt = date(d.year, d.month + 1, 1)
            return nxt - timedelta(days=1)

        # Default: 6 months back through current month
        if not end_month:
            today = date.today()
            end_month = today.strftime('%Y-%m-%d')
        if not start_month:
            ed = first_of(end_month)
            y, m = ed.year, ed.month - 5
            while m <= 0:
                m += 12; y -= 1
            start_month = date(y, m, 1).strftime('%Y-%m-%d')

        start_d = first_of(start_month)
        end_d   = end_of_month(first_of(end_month))

        where_clause = self._build_where(
            start_d.strftime('%Y-%m-%d'),
            end_d.strftime('%Y-%m-%d'),
            biller_ids, msisdns, channels, statuses,
        )

        query = f"""
        WITH base AS (
            SELECT
                date_format(TRANSACTIONFINISHTIME, 'yyyy-MM')  AS MONTH,
                CREDITPARTYIDENTIFIER                          AS BILLER_ID,
                CREDITPARTYNAME                                AS BILLER_NAME,
                DEBITPARTYIDENTIFIER                           AS MSISDN,
                TRANSACTIONID,
                ORIGINALAMOUNT,
                CHARGEAMOUNT
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            {where_clause}
        )
        SELECT
            MONTH,
            BILLER_ID,
            MAX(BILLER_NAME)                AS BILLER_NAME,
            COUNT(DISTINCT MSISDN)          AS SUBS,
            COUNT(DISTINCT TRANSACTIONID)   AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT),0) AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),0)   AS REVENUE
        FROM base
        GROUP BY MONTH, BILLER_ID
        ORDER BY MONTH DESC, VALUE DESC
        LIMIT {limit}
        """
        rows = [dict(r) for r in self.db.execute(text(query)).mappings()]

        # Totals — single aggregation over the same window
        totals_query = f"""
        SELECT
            COUNT(DISTINCT CREDITPARTYIDENTIFIER) AS UNIQUE_BILLERS,
            COUNT(DISTINCT DEBITPARTYIDENTIFIER)  AS UNIQUE_SUBS,
            COUNT(DISTINCT TRANSACTIONID)         AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT),0)       AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),0)         AS REVENUE
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        {where_clause}
        """
        tr = next(iter(self.db.execute(text(totals_query)).mappings()), None) or {}
        totals = {
            "UNIQUE_BILLERS": int(tr.get("UNIQUE_BILLERS") or 0),
            "UNIQUE_SUBS":    int(tr.get("UNIQUE_SUBS")    or 0),
            "VOLUME":         int(tr.get("VOLUME")         or 0),
            "VALUE":          float(tr.get("VALUE")        or 0),
            "REVENUE":        float(tr.get("REVENUE")      or 0),
        }
        return {
            "start_month": start_d.strftime('%Y-%m'),
            "end_month":   end_d.strftime('%Y-%m'),
            "totals":      totals,
            "rows":        rows,
        }
