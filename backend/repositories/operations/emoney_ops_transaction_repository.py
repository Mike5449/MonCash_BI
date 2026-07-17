import logging
from sqlalchemy import text
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


class EmoneyOpsTransactionRepository:
    """
    E-money operations transactions — TRANSACTIONTYPE IN ('E-money Withdrawal', 'E-money Deposit').

    Adds an ACCOUNT_CLASS column that classifies each transaction:
    - 'Payroll'   if CREDITPARTYNAME or DEBITPARTYNAME contains 'payroll' or 'payable' (case-insensitive)
    - 'Merchant'  if either party identifier matches a registered Merchant account
    - 'Agent'     if either party identifier matches a registered Agent account
                  (PRODUCTS LIKE '%Agent%' EXCLUDING the exact value '[Merchant Product][Master Agent]')
    - 'Biller'    if either party identifier matches a registered Biller account
    - 'Prefunded' if either party identifier matches a registered Prefunded partner account
    - 'Other'     otherwise

    Priority order: Payroll > Merchant > Agent > Biller > Prefunded > Other.
    Account matching is done against the latest snapshot of the audit table on either
    IDENTITYMSISDN (= account_id) OR ORGANIZATIONSHORTCODE (= short code).
    """

    TX_TABLE = "hive_metastore.ods_dl.mfs_transaction_aml"
    AUDIT_TABLE = "gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit"

    TX_TYPES = ("E-money Withdrawal", "E-money Deposit")

    def __init__(self, db):
        self.db = db

    @staticmethod
    def _quote_list(values: List[str]) -> str:
        cleaned = [
            str(v).replace("\\", "\\\\").replace("'", "''").strip()
            for v in values if v and str(v).strip()
        ]
        return "'" + "','".join(cleaned) + "'"

    def _account_class_ctes(self) -> str:
        """
        CTEs that produce two single-column tables `biller_ids(id)` and `merchant_ids(id)`,
        each containing both the IDENTITYMSISDN and ORGANIZATIONSHORTCODE values for the
        latest snapshot. Reused across queries needing the ACCOUNT_CLASS classification.
        """
        return f"""
        latest_audit_date AS (
            SELECT MAX(TO_DATE(DATE_CODE, 'yyyyMMdd')) AS d FROM {self.AUDIT_TABLE}
        ),
        biller_raw AS (
            SELECT
                IDENTITYMSISDN          AS account_id,
                ORGANIZATIONSHORTCODE   AS short_code
            FROM {self.AUDIT_TABLE}
            WHERE PRODUCTS LIKE '%[Utility Product]%'
              AND TO_DATE(DATE_CODE, 'yyyyMMdd') = (SELECT d FROM latest_audit_date)
        ),
        merchant_raw AS (
            SELECT
                IDENTITYMSISDN          AS account_id,
                ORGANIZATIONSHORTCODE   AS short_code
            FROM {self.AUDIT_TABLE}
            WHERE PRODUCTS LIKE '%[Merchant Product]%'
              AND TO_DATE(DATE_CODE, 'yyyyMMdd') = (SELECT d FROM latest_audit_date)
        ),
        agent_raw AS (
            SELECT
                IDENTITYMSISDN          AS account_id,
                ORGANIZATIONSHORTCODE   AS short_code
            FROM {self.AUDIT_TABLE}
            WHERE PRODUCTS LIKE '%Agent%'
              AND PRODUCTS <> '[Merchant Product][Master Agent]'
              AND TO_DATE(DATE_CODE, 'yyyyMMdd') = (SELECT d FROM latest_audit_date)
        ),
        prefunded_raw AS (
            SELECT
                IDENTITYMSISDN          AS account_id,
                ORGANIZATIONSHORTCODE   AS short_code
            FROM {self.AUDIT_TABLE}
            WHERE PRODUCTS LIKE '%[Prefunded partner Product]%'
              AND TO_DATE(DATE_CODE, 'yyyyMMdd') = (SELECT d FROM latest_audit_date)
        ),
        biller_ids AS (
            SELECT DISTINCT id FROM (
                SELECT account_id   AS id FROM biller_raw
                UNION ALL
                SELECT short_code   AS id FROM biller_raw
            ) WHERE id IS NOT NULL AND TRIM(id) <> ''
        ),
        merchant_ids AS (
            SELECT DISTINCT id FROM (
                SELECT account_id   AS id FROM merchant_raw
                UNION ALL
                SELECT short_code   AS id FROM merchant_raw
            ) WHERE id IS NOT NULL AND TRIM(id) <> ''
        ),
        agent_ids AS (
            SELECT DISTINCT id FROM (
                SELECT account_id   AS id FROM agent_raw
                UNION ALL
                SELECT short_code   AS id FROM agent_raw
            ) WHERE id IS NOT NULL AND TRIM(id) <> ''
        ),
        prefunded_ids AS (
            SELECT DISTINCT id FROM (
                SELECT account_id   AS id FROM prefunded_raw
                UNION ALL
                SELECT short_code   AS id FROM prefunded_raw
            ) WHERE id IS NOT NULL AND TRIM(id) <> ''
        )
        """

    def _build_where(
        self,
        start_date:   Optional[str],
        end_date:     Optional[str],
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
        account_classes: Optional[List[str]] = None,
    ) -> str:
        # Universal TRANSACTIONID lookup — bypasses every other filter (including TX_TYPES).
        if transaction_ids:
            cleaned_ids = [t.strip() for t in transaction_ids if t and t.strip()]
            if cleaned_ids:
                return f"WHERE t.TRANSACTIONID IN ({self._quote_list(cleaned_ids)})"

        tx_types_sql = self._quote_list(list(self.TX_TYPES))
        where = f"WHERE t.TRANSACTIONTYPE IN ({tx_types_sql})"

        # Status — default 'Completed', wildcard '*' disables
        if statuses:
            cleaned = [s.strip() for s in statuses if s and s.strip()]
            wildcards = {"*", "ALL", "all"}
            if cleaned and not any(s in wildcards for s in cleaned):
                where += f" AND t.TRANSACTIONSTATUS IN ({self._quote_list(cleaned)})"
        else:
            where += " AND t.TRANSACTIONSTATUS = 'Completed'"

        if initiators:
            cleaned = [i.strip().upper() for i in initiators if i and i.strip()]
            if cleaned:
                where += f" AND UPPER(TRIM(t.INITIATOR)) IN ({self._quote_list(cleaned)})"

        # Account-class filter — applied via the computed ACCOUNT_CLASS column (post-classification).
        # We materialize it in HAVING-like fashion via an outer wrapper, since ACCOUNT_CLASS doesn't
        # exist in the base table. Caller pushes this filter into the outer SELECT.

        if start_date:
            ymd = start_date.replace("-", "")
            where += f" AND t.PROCESS_DATE >= '{ymd}'"
        if end_date:
            ymd = end_date.replace("-", "")
            where += f" AND t.PROCESS_DATE <= '{ymd}'"

        return where

    @staticmethod
    def _account_class_filter(account_classes: Optional[List[str]]) -> str:
        if not account_classes:
            return ""
        allowed = {c.strip() for c in account_classes if c and c.strip()}
        all_classes = {"Biller", "Merchant", "Agent", "Prefunded", "Other", "Payroll"}
        allowed &= all_classes
        if not allowed or allowed == all_classes:
            return ""
        quoted = "'" + "','".join(sorted(allowed)) + "'"
        return f" WHERE ACCOUNT_CLASS IN ({quoted})"

    @staticmethod
    def _payroll_predicate() -> str:
        """
        Case-insensitive match on creditor/debitor name containing 'payroll' or 'payable'.
        Returns a SQL predicate (boolean expression). Both names are NULL-safe via COALESCE.
        """
        return (
            "("
            "  LOWER(COALESCE(t.CREDITPARTYNAME, '')) LIKE '%payroll%'"
            "  OR LOWER(COALESCE(t.DEBITPARTYNAME,  '')) LIKE '%payroll%'"
            "  OR LOWER(COALESCE(t.CREDITPARTYNAME, '')) LIKE '%payable%'"
            "  OR LOWER(COALESCE(t.DEBITPARTYNAME,  '')) LIKE '%payable%'"
            ")"
        )

    def get_transactions(
        self,
        start_date:   Optional[str] = None,
        end_date:     Optional[str] = None,
        limit:        int = 100,
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
        account_classes: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        where = self._build_where(
            start_date, end_date, statuses, initiators, transaction_ids,
        )
        class_filter = self._account_class_filter(account_classes)

        logger.info("[EMONEY_OPS] get_transactions filters: statuses=%s initiators=%s "
                    "transaction_ids=%s account_classes=%s | WHERE=%s",
                    statuses, initiators, transaction_ids, account_classes, where)

        query = f"""
        WITH {self._account_class_ctes()}
        SELECT * FROM (
            SELECT
                t.TRANSACTIONID,
                t.TRANSACTIONFINISHTIME           AS TRANSACTION_DATE,
                t.CREDITPARTYIDENTIFIER           AS CREDITOR_ID,
                t.CREDITPARTYNAME                 AS CREDITOR_NAME,
                t.DEBITPARTYIDENTIFIER            AS DEBITOR_ID,
                t.DEBITPARTYNAME                  AS DEBITOR_NAME,
                t.ORIGINALAMOUNT,
                t.CHARGEAMOUNT,
                t.TRANSACTIONTYPE                 AS TR_TYPE,
                t.REASONTYPE,
                t.CHANNEL,
                t.TRANSACTIONSTATUS               AS STATUS,
                t.INITIATOR,
                t.FAILUREREASON,
                CASE
                    WHEN {self._payroll_predicate()} THEN 'Payroll'
                    WHEN mc.id IS NOT NULL OR md.id IS NOT NULL THEN 'Merchant'
                    WHEN ac.id IS NOT NULL OR ad.id IS NOT NULL THEN 'Agent'
                    WHEN bc.id IS NOT NULL OR bd.id IS NOT NULL THEN 'Biller'
                    WHEN pc.id IS NOT NULL OR pd.id IS NOT NULL THEN 'Prefunded'
                    ELSE 'Other'
                END                               AS ACCOUNT_CLASS
            FROM {self.TX_TABLE} t
            LEFT JOIN merchant_ids  mc ON mc.id = t.CREDITPARTYIDENTIFIER
            LEFT JOIN merchant_ids  md ON md.id = t.DEBITPARTYIDENTIFIER
            LEFT JOIN agent_ids     ac ON ac.id = t.CREDITPARTYIDENTIFIER
            LEFT JOIN agent_ids     ad ON ad.id = t.DEBITPARTYIDENTIFIER
            LEFT JOIN biller_ids    bc ON bc.id = t.CREDITPARTYIDENTIFIER
            LEFT JOIN biller_ids    bd ON bd.id = t.DEBITPARTYIDENTIFIER
            LEFT JOIN prefunded_ids pc ON pc.id = t.CREDITPARTYIDENTIFIER
            LEFT JOIN prefunded_ids pd ON pd.id = t.DEBITPARTYIDENTIFIER
            {where}
        ) classified
        {class_filter}
        ORDER BY TRANSACTION_DATE DESC
        LIMIT {limit}
        """
        result = self.db.execute(text(query))
        rows = [dict(row) for row in result.mappings()]
        logger.info("[EMONEY_OPS] get_transactions returned %d rows", len(rows))
        return rows

    def get_summary(
        self,
        start_date:   Optional[str] = None,
        end_date:     Optional[str] = None,
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
        account_classes: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        where = self._build_where(
            start_date, end_date, statuses, initiators, transaction_ids,
        )
        class_filter = self._account_class_filter(account_classes)

        query = f"""
        WITH {self._account_class_ctes()},
        classified AS (
            SELECT
                t.TRANSACTIONID,
                t.TRANSACTIONTYPE,
                t.CREDITPARTYIDENTIFIER,
                t.DEBITPARTYIDENTIFIER,
                t.ORIGINALAMOUNT,
                t.CHARGEAMOUNT,
                CASE
                    WHEN {self._payroll_predicate()} THEN 'Payroll'
                    WHEN mc.id IS NOT NULL OR md.id IS NOT NULL THEN 'Merchant'
                    WHEN ac.id IS NOT NULL OR ad.id IS NOT NULL THEN 'Agent'
                    WHEN bc.id IS NOT NULL OR bd.id IS NOT NULL THEN 'Biller'
                    WHEN pc.id IS NOT NULL OR pd.id IS NOT NULL THEN 'Prefunded'
                    ELSE 'Other'
                END AS ACCOUNT_CLASS
            FROM {self.TX_TABLE} t
            LEFT JOIN merchant_ids  mc ON mc.id = t.CREDITPARTYIDENTIFIER
            LEFT JOIN merchant_ids  md ON md.id = t.DEBITPARTYIDENTIFIER
            LEFT JOIN agent_ids     ac ON ac.id = t.CREDITPARTYIDENTIFIER
            LEFT JOIN agent_ids     ad ON ad.id = t.DEBITPARTYIDENTIFIER
            LEFT JOIN biller_ids    bc ON bc.id = t.CREDITPARTYIDENTIFIER
            LEFT JOIN biller_ids    bd ON bd.id = t.DEBITPARTYIDENTIFIER
            LEFT JOIN prefunded_ids pc ON pc.id = t.CREDITPARTYIDENTIFIER
            LEFT JOIN prefunded_ids pd ON pd.id = t.DEBITPARTYIDENTIFIER
            {where}
        )
        SELECT
            CAST(COUNT(DISTINCT CREDITPARTYIDENTIFIER) AS STRING)  AS UNIQUE_CREDITORS,
            CAST(COUNT(DISTINCT DEBITPARTYIDENTIFIER)  AS STRING)  AS UNIQUE_DEBITORS,
            CAST(COUNT(DISTINCT TRANSACTIONID)         AS STRING)  AS VOLUME,
            CAST(COALESCE(SUM(CASE WHEN TRANSACTIONTYPE = 'E-money Withdrawal' THEN ORIGINALAMOUNT END), 0) AS STRING) AS VALUE_WITHDRAWAL,
            CAST(COALESCE(SUM(CASE WHEN TRANSACTIONTYPE = 'E-money Deposit'    THEN ORIGINALAMOUNT END), 0) AS STRING) AS VALUE_DEPOSIT,
            CAST(SUM(CASE WHEN ACCOUNT_CLASS = 'Biller'    THEN 1 ELSE 0 END) AS STRING) AS COUNT_BILLER,
            CAST(SUM(CASE WHEN ACCOUNT_CLASS = 'Merchant'  THEN 1 ELSE 0 END) AS STRING) AS COUNT_MERCHANT,
            CAST(SUM(CASE WHEN ACCOUNT_CLASS = 'Agent'     THEN 1 ELSE 0 END) AS STRING) AS COUNT_AGENT,
            CAST(SUM(CASE WHEN ACCOUNT_CLASS = 'Prefunded' THEN 1 ELSE 0 END) AS STRING) AS COUNT_PREFUNDED,
            CAST(SUM(CASE WHEN ACCOUNT_CLASS = 'Payroll'   THEN 1 ELSE 0 END) AS STRING) AS COUNT_PAYROLL,
            CAST(SUM(CASE WHEN ACCOUNT_CLASS = 'Other'     THEN 1 ELSE 0 END) AS STRING) AS COUNT_OTHER
        FROM classified
        {class_filter}
        """
        row = next(iter(self.db.execute(text(query)).mappings()), None) or {}

        def _to_int(v) -> int:
            try: return int(v) if v is not None else 0
            except (TypeError, ValueError):
                try: return int(float(v))
                except (TypeError, ValueError): return 0

        def _to_float(v) -> float:
            try: return float(v) if v is not None else 0.0
            except (TypeError, ValueError): return 0.0

        return {
            "UNIQUE_CREDITORS": _to_int(row.get("UNIQUE_CREDITORS")),
            "UNIQUE_DEBITORS":  _to_int(row.get("UNIQUE_DEBITORS")),
            "VOLUME":           _to_int(row.get("VOLUME")),
            "VALUE_WITHDRAWAL": _to_float(row.get("VALUE_WITHDRAWAL")),
            "VALUE_DEPOSIT":    _to_float(row.get("VALUE_DEPOSIT")),
            "COUNT_BILLER":     _to_int(row.get("COUNT_BILLER")),
            "COUNT_MERCHANT":   _to_int(row.get("COUNT_MERCHANT")),
            "COUNT_AGENT":      _to_int(row.get("COUNT_AGENT")),
            "COUNT_PREFUNDED":  _to_int(row.get("COUNT_PREFUNDED")),
            "COUNT_PAYROLL":    _to_int(row.get("COUNT_PAYROLL")),
            "COUNT_OTHER":      _to_int(row.get("COUNT_OTHER")),
        }

    def get_distinct_initiators(
        self,
        start_date: Optional[str] = None,
        end_date:   Optional[str] = None,
    ) -> List[str]:
        """List of distinct INITIATOR values for the dropdown filter."""
        tx_types_sql = self._quote_list(list(self.TX_TYPES))
        where = f"WHERE TRANSACTIONTYPE IN ({tx_types_sql})"
        if start_date:
            ymd = start_date.replace("-", "")
            where += f" AND PROCESS_DATE >= '{ymd}'"
        if end_date:
            ymd = end_date.replace("-", "")
            where += f" AND PROCESS_DATE <= '{ymd}'"

        query = f"""
        SELECT DISTINCT TRIM(UPPER(INITIATOR)) AS INITIATOR
        FROM {self.TX_TABLE}
        {where}
          AND INITIATOR IS NOT NULL AND TRIM(INITIATOR) <> ''
        ORDER BY INITIATOR
        """
        result = self.db.execute(text(query))
        return [r["INITIATOR"] for r in result.mappings() if r.get("INITIATOR")]
