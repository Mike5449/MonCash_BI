from sqlalchemy import text
from typing import List, Dict, Any, Optional


class PrefundedTransactionRepository:
    """
    Prefunded (B2C) transactions: organizations sending money to customers.

    Data semantics:
    - DEBITPARTYIDENTIFIER = organization (the payer)        → ORG_ID
    - DEBITPARTYNAME       = organization name               → ORG_NAME
    - CREDITPARTYIDENTIFIER = customer MSISDN (the receiver) → MSISDN

    Scoped to:
      SERVICENAME IN ('OD Money Transfer Prefunded', 'Money Transfer Prefunded')
      DEBITPARTYTYPE = 'Organization'
    """

    PREFUNDED_SERVICES = ("OD Money Transfer Prefunded", "Money Transfer Prefunded")

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
        org_ids: Optional[List[str]],
        msisdns: Optional[List[str]],
        channels: Optional[List[str]],
        statuses: Optional[List[str]] = None,
    ) -> str:
        services = self._quote_list(list(self.PREFUNDED_SERVICES))
        where = (
            f"WHERE SERVICENAME IN ({services}) "
            f"AND DEBITPARTYTYPE = 'Organization'"
        )

        # TRANSACTIONSTATUS — default Completed (legacy behaviour); ['*']/['ALL'] disables
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
        if org_ids:
            cleaned = [o.strip() for o in org_ids if o and o.strip()]
            if cleaned:
                where += f" AND DEBITPARTYIDENTIFIER IN ({self._quote_list(cleaned)})"
        if msisdns:
            cleaned = [m.strip() for m in msisdns if m and m.strip()]
            if cleaned:
                where += f" AND CREDITPARTYIDENTIFIER IN ({self._quote_list(cleaned)})"
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
        org_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        where_clause = self._build_where(
            start_date, end_date, org_ids, msisdns, channels, statuses
        )

        if active_only:
            query = f"""
            SELECT
                DEBITPARTYIDENTIFIER          AS ACCOUNT_ID,
                MAX(DEBITPARTYNAME)           AS ORG_NAME,
                MAX(TRANSACTIONFINISHTIME)    AS LATEST_TRANSACTION,
                COUNT(*)                      AS TRANSACTION_COUNT,
                SUM(ORIGINALAMOUNT)           AS TOTAL_VOLUME,
                'PREFUNDED'                   AS ACCOUNT_TYPE
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            {where_clause}
            GROUP BY DEBITPARTYIDENTIFIER
            ORDER BY MAX(TRANSACTIONFINISHTIME) DESC
            LIMIT {limit}
            """
        else:
            query = f"""
            SELECT
                TRANSACTIONID,
                TRANSACTIONFINISHTIME         AS TRANSACTION_DATE,
                DEBITPARTYIDENTIFIER          AS ORG_ID,
                DEBITPARTYNAME                AS ORG_NAME,
                CREDITPARTYIDENTIFIER         AS MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT,
                SERVICENAME                   AS TR_TYPE,
                CHANNEL,
                TRANSACTIONSTATUS             AS STATUS,
                'PREFUNDED'                   AS ACCOUNT_TYPE
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
        org_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        KPI aggregate over the filtered period:
        - UNIQUE_SUBS = COUNT(DISTINCT CREDITPARTYIDENTIFIER) — MSISDN ayant reçu un prefunded transfer
        - UNIQUE_ORGS = COUNT(DISTINCT DEBITPARTYIDENTIFIER)  — organisations ayant émis au moins un transfert
        - VOLUME      = COUNT(DISTINCT TRANSACTIONID)
        - VALUE       = SUM(ORIGINALAMOUNT)                   — montants transférés (HTG)
        - REVENUE     = SUM(CHARGEAMOUNT)                     — revenus MFS (HTG)
        """
        where_clause = self._build_where(
            start_date, end_date, org_ids, msisdns, channels, statuses
        )
        query = f"""
        SELECT
            COUNT(DISTINCT CREDITPARTYIDENTIFIER) AS UNIQUE_SUBS,
            COUNT(DISTINCT DEBITPARTYIDENTIFIER)  AS UNIQUE_ORGS,
            COUNT(DISTINCT TRANSACTIONID)         AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT), 0)      AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),  0)       AS REVENUE
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        {where_clause}
        """
        row = next(iter(self.db.execute(text(query)).mappings()), None) or {}
        return {
            "UNIQUE_SUBS": int(row.get("UNIQUE_SUBS") or 0),
            "UNIQUE_ORGS": int(row.get("UNIQUE_ORGS") or 0),
            "VOLUME":      int(row.get("VOLUME")      or 0),
            "VALUE":       float(row.get("VALUE")     or 0),
            "REVENUE":     float(row.get("REVENUE")   or 0),
        }

    def get_monthly_stats_by_org(
        self,
        start_month: Optional[str] = None,
        end_month: Optional[str] = None,
        org_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> Dict[str, Any]:
        """
        Monthly aggregates per (MONTH, ORG_ID = DEBITPARTYIDENTIFIER).

        For each (YYYY-MM, ORG_ID):
        - SUBS    = COUNT(DISTINCT CREDITPARTYIDENTIFIER)  — distinct MSISDNs that received transfers
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID)
        - VALUE   = SUM(ORIGINALAMOUNT) HTG
        - REVENUE = SUM(CHARGEAMOUNT)   HTG
        - ORG_NAME = MAX(DEBITPARTYNAME)

        Scoped to SERVICENAME IN PREFUNDED_SERVICES + DEBITPARTYTYPE = 'Organization'
        via _build_where (hardcoded). Default status = 'Completed' unless overridden.
        """
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
            org_ids, msisdns, channels, statuses,
        )

        query = f"""
        WITH base AS (
            SELECT
                date_format(TRANSACTIONFINISHTIME, 'yyyy-MM')  AS MONTH,
                DEBITPARTYIDENTIFIER                           AS ORG_ID,
                DEBITPARTYNAME                                 AS ORG_NAME,
                CREDITPARTYIDENTIFIER                          AS MSISDN,
                TRANSACTIONID,
                ORIGINALAMOUNT,
                CHARGEAMOUNT
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            {where_clause}
        )
        SELECT
            MONTH,
            ORG_ID,
            MAX(ORG_NAME)                   AS ORG_NAME,
            COUNT(DISTINCT MSISDN)          AS SUBS,
            COUNT(DISTINCT TRANSACTIONID)   AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT),0) AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),0)   AS REVENUE
        FROM base
        GROUP BY MONTH, ORG_ID
        ORDER BY MONTH DESC, VALUE DESC
        LIMIT {limit}
        """
        rows = [dict(r) for r in self.db.execute(text(query)).mappings()]

        totals_query = f"""
        SELECT
            COUNT(DISTINCT DEBITPARTYIDENTIFIER)  AS UNIQUE_ORGS,
            COUNT(DISTINCT CREDITPARTYIDENTIFIER) AS UNIQUE_SUBS,
            COUNT(DISTINCT TRANSACTIONID)         AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT),0)       AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),0)         AS REVENUE
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        {where_clause}
        """
        tr = next(iter(self.db.execute(text(totals_query)).mappings()), None) or {}
        totals = {
            "UNIQUE_ORGS": int(tr.get("UNIQUE_ORGS") or 0),
            "UNIQUE_SUBS": int(tr.get("UNIQUE_SUBS") or 0),
            "VOLUME":      int(tr.get("VOLUME")      or 0),
            "VALUE":       float(tr.get("VALUE")     or 0),
            "REVENUE":     float(tr.get("REVENUE")   or 0),
        }
        return {
            "start_month": start_d.strftime('%Y-%m'),
            "end_month":   end_d.strftime('%Y-%m'),
            "totals":      totals,
            "rows":        rows,
        }
