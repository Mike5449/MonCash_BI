from sqlalchemy import text
from typing import List, Dict, Any, Optional


class ImtTransactionRepository:
    """
    International Money Transfer (IMT) — money received in Haiti from abroad.

    Data semantics:
    - SERVICENAME = 'IMT revceiving'   (note: typo in source data, kept as-is)
    - DEBITPARTYIDENTIFIER  = sender (international remittance operator / source identifier)
    - DEBITPARTYNAME        = sender display name (when populated by source)
    - CREDITPARTYIDENTIFIER = customer MSISDN in Haiti (the receiver)

    KPIs follow the same shape as Biller / Prefunded for consistency.
    """

    IMT_SERVICE = "IMT revceiving"  # source typo — DO NOT correct

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
        msisdns: Optional[List[str]],          # CREDIT side — Haitian receiver
        sender_ids: Optional[List[str]],       # DEBIT side — IMT operator / source
        channels: Optional[List[str]],
        statuses: Optional[List[str]] = None,
    ) -> str:
        # Hardcoded service filter — this repository is scoped to IMT receiving only.
        where = f"WHERE SERVICENAME = '{self.IMT_SERVICE}'"

        # TRANSACTIONSTATUS — default 'Completed', wildcard '*' disables.
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
        if msisdns:
            cleaned = [m.strip() for m in msisdns if m and m.strip()]
            if cleaned:
                where += f" AND CREDITPARTYIDENTIFIER IN ({self._quote_list(cleaned)})"
        if sender_ids:
            cleaned = [s.strip() for s in sender_ids if s and s.strip()]
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
        msisdns: Optional[List[str]] = None,
        sender_ids: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        where_clause = self._build_where(
            start_date, end_date, msisdns, sender_ids, channels, statuses
        )

        # Base IMT transactions LIMITed first to keep the location lookup small.
        # We add TX_DATE = TO_DATE(TRANSACTIONFINISHTIME) so we can join ht_location
        # snapshot of that exact day (avoids 'Unknown' when the customer's location
        # on the day of the transaction differs from yesterday's snapshot, or when
        # CURRENT_DATE-1 simply has no row for that MSISDN).
        base_select = f"""
        SELECT
            TRANSACTIONID,
            TRANSACTIONFINISHTIME           AS TRANSACTION_DATE,
            TO_DATE(TRANSACTIONFINISHTIME)  AS TX_DATE,
            CREDITPARTYIDENTIFIER           AS MSISDN,
            DEBITPARTYIDENTIFIER            AS SENDER_ID,
            DEBITPARTYNAME                  AS SENDER_NAME,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            SERVICENAME                     AS TR_TYPE,
            CHANNEL,
            TRANSACTIONSTATUS               AS STATUS,
            REASONTYPE,
            INITIATOR,
            FAILUREREASON,
            'IMT'                           AS ACCOUNT_TYPE
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        {where_clause}
        ORDER BY TRANSACTIONFINISHTIME DESC
        LIMIT {limit}
        """

        # Enriched query :
        # - ht_location is partitioned by DATE_CODE (yyyyMMdd) — one snapshot per day per MSISDN.
        # - For each transaction, we join the snapshot of the day the tx happened
        #   (TX_DATE = TO_DATE(TRANSACTIONFINISHTIME)). If that day's snapshot has no row
        #   for the MSISDN, we fall back to the latest snapshot ≤ TX_DATE.
        enriched_query = f"""
        WITH base AS (
            {base_select}
        ),
        location_pool AS (
            -- All location rows for our MSISDNs, across all available snapshots
            -- up to the maximum TX_DATE we have in base.
            SELECT
                LO.MSISDN,
                TO_DATE(LO.DATE_CODE, 'yyyyMMdd') AS LOC_DATE,
                SI.CITY,
                SI.DEPARTMENT,
                ROW_NUMBER() OVER (
                    PARTITION BY LO.MSISDN, TO_DATE(LO.DATE_CODE, 'yyyyMMdd')
                    ORDER BY SI.SITE_CODE, SI.SECTOR
                ) AS loc_rn
            FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
            INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
            WHERE LO.MSISDN IN (SELECT DISTINCT MSISDN FROM base)
              AND TO_DATE(LO.DATE_CODE, 'yyyyMMdd') <= (SELECT MAX(TX_DATE) FROM base)
        ),
        location_per_tx_day AS (
            -- 1 location per (MSISDN, tx_date) : take the snapshot whose LOC_DATE
            -- is the closest one ≤ TX_DATE. This auto-uses the same-day snapshot
            -- when present, otherwise the most recent earlier one.
            SELECT
                b.TRANSACTIONID,
                b.MSISDN,
                lp.LOC_DATE,
                lp.CITY,
                lp.DEPARTMENT,
                ROW_NUMBER() OVER (
                    PARTITION BY b.TRANSACTIONID
                    ORDER BY lp.LOC_DATE DESC
                ) AS pick_rn
            FROM base b
            LEFT JOIN location_pool lp
              ON b.MSISDN = lp.MSISDN
             AND lp.loc_rn = 1
             AND lp.LOC_DATE <= b.TX_DATE
        )
        SELECT
            b.TRANSACTIONID,
            b.TRANSACTION_DATE,
            b.MSISDN,
            b.SENDER_ID,
            b.SENDER_NAME,
            b.ORIGINALAMOUNT,
            b.CHARGEAMOUNT,
            b.TR_TYPE,
            b.CHANNEL,
            b.STATUS,
            b.REASONTYPE,
            b.INITIATOR,
            b.FAILUREREASON,
            b.ACCOUNT_TYPE,
            COALESCE(l.DEPARTMENT, 'Unknown') AS DEPARTMENT,
            COALESCE(l.CITY,       'Unknown') AS CITY,
            l.LOC_DATE                        AS LOCATION_SNAPSHOT_DATE
        FROM base b
        LEFT JOIN location_per_tx_day l
          ON b.TRANSACTIONID = l.TRANSACTIONID
         AND l.pick_rn = 1
        ORDER BY b.TRANSACTION_DATE DESC
        """

        try:
            result = self.db.execute(text(enriched_query))
            return [dict(row) for row in result.mappings()]
        except Exception as e:
            # Fallback : si la jointure de localisation échoue, on renvoie la base sans enrichissement.
            print(f"[IMT_TX] enriched query failed, fallback to base only: {e}")
            result = self.db.execute(text(base_select))
            rows = [dict(row) for row in result.mappings()]
            for r in rows:
                r.setdefault("DEPARTMENT",             "Unknown")
                r.setdefault("CITY",                   "Unknown")
                r.setdefault("LOCATION_SNAPSHOT_DATE", None)
            return rows

    def get_summary(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        msisdns: Optional[List[str]] = None,
        sender_ids: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        KPI aggregate over the filtered period:
        - UNIQUE_SUBS    = COUNT(DISTINCT CREDITPARTYIDENTIFIER) — distinct receivers in Haiti
        - UNIQUE_SENDERS = COUNT(DISTINCT DEBITPARTYIDENTIFIER)  — distinct sender IDs / operators
        - VOLUME         = COUNT(DISTINCT TRANSACTIONID)
        - VALUE          = SUM(ORIGINALAMOUNT) HTG
        - REVENUE        = SUM(CHARGEAMOUNT)   HTG
        """
        where_clause = self._build_where(
            start_date, end_date, msisdns, sender_ids, channels, statuses
        )
        query = f"""
        SELECT
            COUNT(DISTINCT CREDITPARTYIDENTIFIER) AS UNIQUE_SUBS,
            COUNT(DISTINCT DEBITPARTYIDENTIFIER)  AS UNIQUE_SENDERS,
            COUNT(DISTINCT TRANSACTIONID)         AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT), 0)      AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),  0)       AS REVENUE
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        {where_clause}
        """
        row = next(iter(self.db.execute(text(query)).mappings()), None) or {}
        return {
            "UNIQUE_SUBS":    int(row.get("UNIQUE_SUBS")    or 0),
            "UNIQUE_SENDERS": int(row.get("UNIQUE_SENDERS") or 0),
            "VOLUME":         int(row.get("VOLUME")         or 0),
            "VALUE":          float(row.get("VALUE")        or 0),
            "REVENUE":        float(row.get("REVENUE")      or 0),
        }
