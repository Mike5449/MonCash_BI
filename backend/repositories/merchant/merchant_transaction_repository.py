from sqlalchemy import text
from typing import List, Dict, Any, Optional, Tuple
from datetime import date, timedelta


class MerchantTransactionRepository:
    """
    Daily merchant transactions sourced from hive_metastore.ods_dl.mfs_transaction_aml.
    Date axis is PROCESS_DATE (yyyyMMdd string), exposed as TRANSACTION_DATE.
    Pipeline aligné sur customer_transaction_repository (mêmes colonnes, mêmes filtres).
    """

    # ── Hardcoded exclusions (test / internal accounts / reason types) ──
    # These rows are always removed from the result set regardless of filters.
    # '104' is excluded on BOTH sides (when it acts as customer AND as merchant).
    EXCLUDED_MSISDNS       = ("30013563", "104")   # internal customer-side IDs
    EXCLUDED_MERCHANTS     = ("104",)              # internal merchant-side ID
    EXCLUDED_REASON_TYPES  = ("Agent UBP payment",) # internal reason types to hide

    def __init__(self, db):
        self.db = db

    @staticmethod
    def _quote_list(values: List[str]) -> str:
        cleaned = [str(v).replace("'", "''").strip() for v in values if v and str(v).strip()]
        return "'" + "','".join(cleaned) + "'"

    def _build_filters(
        self,
        start_date: Optional[date],
        end_date: Optional[date],
        merchant_id_list: Optional[List[str]],
        service_names: Optional[List[str]],
        channels: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> Tuple[str, str, str, str, str]:
        """
        Return (start_str, end_str, sub_id_cred, sub_id_debt, outer_filters).

        - merchant_id_list filters MERCHANT_ID (CREDIT side for inbound, DEBIT side for outbound)
        - msisdns filters CUSTOMER_MSISDN (the customer side — opposite leg of MERCHANT_ID)
        - statuses filters TRANSACTIONSTATUS at the outer level (default 'Completed';
          ['*']/['ALL'] disables the status filter to show all statuses)
        - service_names filters TR_TYPE
        - channels filters CHANNEL
        """
        if not start_date:
            start_date = date.today() - timedelta(days=30)
        if not end_date:
            end_date = date.today() - timedelta(days=1)

        start_str = start_date.strftime('%Y%m%d')
        end_str = (end_date + timedelta(days=1)).strftime('%Y%m%d')

        sub_id_cred = ""
        sub_id_debt = ""
        id_outer = ""
        if merchant_id_list:
            cleaned = [m.strip() for m in merchant_id_list if m and m.strip()]
            if cleaned:
                m_list_str = self._quote_list(cleaned)
                id_outer = f"AND MERCHANT_ID IN ({m_list_str})"
                # Merchant side is CREDIT in inbound, DEBIT in outbound.
                sub_id_cred = f"AND CREDITPARTYIDENTIFIER IN ({m_list_str})"
                sub_id_debt = f"AND DEBITPARTYIDENTIFIER IN ({m_list_str})"

        msisdn_outer = ""
        if msisdns:
            cleaned = [m.strip() for m in msisdns if m and m.strip()]
            if cleaned:
                msisdn_outer = f"AND CUSTOMER_MSISDN IN ({self._quote_list(cleaned)})"

        tr_type_outer = ""
        if service_names:
            cleaned = [s.strip() for s in service_names if s and s.strip()]
            if cleaned:
                tr_type_outer = f"AND TR_TYPE IN ({self._quote_list(cleaned)})"

        channel_outer = ""
        if channels:
            cleaned = [c.strip().upper() for c in channels if c and c.strip()]
            if cleaned:
                channel_outer = f"AND UPPER(CHANNEL) IN ({self._quote_list(cleaned)})"

        # Status filter — default 'Completed', wildcard '*' disables
        status_outer = "AND TRANSACTIONSTATUS = 'Completed'"
        if statuses:
            cleaned = [s.strip() for s in statuses if s and s.strip()]
            wildcards = {"*", "ALL", "all"}
            if cleaned and not any(s in wildcards for s in cleaned):
                status_outer = f"AND TRANSACTIONSTATUS IN ({self._quote_list(cleaned)})"
            elif cleaned and any(s in wildcards for s in cleaned):
                status_outer = ""

        # Always-on exclusions (test / internal accounts / reason types) — applied to every query
        exclusions = []
        if self.EXCLUDED_MERCHANTS:
            exclusions.append(f"AND MERCHANT_ID NOT IN ({self._quote_list(list(self.EXCLUDED_MERCHANTS))})")
        if self.EXCLUDED_MSISDNS:
            exclusions.append(f"AND CUSTOMER_MSISDN NOT IN ({self._quote_list(list(self.EXCLUDED_MSISDNS))})")
        if self.EXCLUDED_REASON_TYPES:
            exclusions.append(f"AND (REASONTYPE IS NULL OR REASONTYPE NOT IN ({self._quote_list(list(self.EXCLUDED_REASON_TYPES))}))")

        outer_filters = " ".join(
            f for f in [id_outer, msisdn_outer, tr_type_outer, channel_outer, status_outer, *exclusions] if f
        ).strip()
        return start_str, end_str, sub_id_cred, sub_id_debt, outer_filters

    def _inner_union(self, start_str: str, end_str: str, sub_id_cred: str, sub_id_debt: str) -> str:
        """
        CREDIT (paiements reçus par les Merchants) + DEBIT (paiements faits par les Merchants).

        Columns:
        - MERCHANT_ID       = side facing the merchant (CREDIT party for inbound, DEBIT for outbound)
        - CUSTOMER_MSISDN   = opposite leg (the customer involved in the transaction)
        - TRANSACTIONSTATUS = raw status (filtered at outer level, default 'Completed')

        NOTE: status filtering is now done at the OUTER level so it can be parameterized.
        ORIGINALAMOUNT IS NOT NULL stays inline (data-quality filter).
        """
        return f"""
            SELECT
                TRANSACTIONID,
                to_date(PROCESS_DATE, 'yyyyMMdd') AS TRANSACTION_DATE,
                CREDITPARTYIDENTIFIER AS MERCHANT_ID,
                DEBITPARTYIDENTIFIER  AS CUSTOMER_MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT,
                TRANSACTIONSTATUS,
                CASE
                    WHEN SERVICENAME = 'Agent Payment to Merchant'                   THEN 'AGENT2MERC'
                    WHEN SERVICENAME = 'Merchant Payment'                             THEN 'MERC_PAY'
                    WHEN SERVICENAME = 'Merchant QR Payment'                          THEN 'MERC_QR'
                    WHEN SERVICENAME = 'Merchant Till payment'                        THEN 'MERC_TILL'
                    WHEN SERVICENAME = 'Merchant Online Payment'                      THEN 'MERC_ONLINE'
                    WHEN SERVICENAME = 'Merchant Payment to Merchant'                 THEN 'M2M_IN'
                    WHEN SERVICENAME = 'Merchant to Merchant Payment via Till ID'     THEN 'M2M_TILL_IN'
                    WHEN SERVICENAME = 'Merchant Cashout'                             THEN 'MERC_CASHOUT_IN'
                    WHEN SERVICENAME = 'Agent/Merchant Bill Payment'                  THEN 'AGENT_BILLPAY_IN'
                END AS TR_TYPE,
                CHANNEL,
                REASONTYPE,
                INITIATOR,
                FAILUREREASON
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE to_date(PROCESS_DATE, 'yyyyMMdd') >= to_date('{start_str}', 'yyyyMMdd')
              AND to_date(PROCESS_DATE, 'yyyyMMdd') <  to_date('{end_str}',   'yyyyMMdd')
              AND ORIGINALAMOUNT IS NOT NULL
              AND SERVICENAME IN (
                    'Agent Payment to Merchant',
                    'Merchant Payment',
                    'Merchant Payment to Merchant',
                    'Merchant QR Payment',
                    'Merchant Till payment',
                    'Merchant to Merchant Payment via Till ID',
                    'Merchant Online Payment',
                    'Merchant Cashout',
                    'Agent/Merchant Bill Payment'
              )
              {sub_id_cred}

            UNION ALL

            SELECT
                TRANSACTIONID,
                to_date(PROCESS_DATE, 'yyyyMMdd') AS TRANSACTION_DATE,
                DEBITPARTYIDENTIFIER  AS MERCHANT_ID,
                CREDITPARTYIDENTIFIER AS CUSTOMER_MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT,
                TRANSACTIONSTATUS,
                CASE
                    WHEN SERVICENAME = 'Merchant Cashout'                            THEN 'MERC_CASHOUT'
                    WHEN SERVICENAME = 'Agent/Merchant Bill Payment'                 THEN 'AGENT_BILLPAY'
                    WHEN SERVICENAME = 'Merchant Payment to Merchant'                THEN 'M2M_OUT'
                    WHEN SERVICENAME = 'Merchant to Merchant Payment via Till ID'    THEN 'M2M_TILL_OUT'
                END AS TR_TYPE,
                CHANNEL,
                REASONTYPE,
                INITIATOR,
                FAILUREREASON
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE to_date(PROCESS_DATE, 'yyyyMMdd') >= to_date('{start_str}', 'yyyyMMdd')
              AND to_date(PROCESS_DATE, 'yyyyMMdd') <  to_date('{end_str}',   'yyyyMMdd')
              AND ORIGINALAMOUNT IS NOT NULL
              AND SERVICENAME IN (
                    'Merchant Cashout',
                    'Agent/Merchant Bill Payment',
                    'Merchant Payment to Merchant',
                    'Merchant to Merchant Payment via Till ID'
              )
              {sub_id_debt}
        """

    def get_active_merchants(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 500,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Active merchants = merchants ayant effectué AU MOINS UNE transaction
        (credit OU debit, selon la liste de SERVICENAME merchant) dans la période.

        Logique analogue aux Active Customers : on prend toutes les transactions
        merchant (via _inner_union → MERCHANT_ID = CREDIT ou DEBIT party), on agrège
        par MERCHANT_ID, puis on JOIN avec le profil sur ORGANIZATIONSHORTCODE.

        Renvoie par MERCHANT : profil + VOLUME, VALUE, REVENUE, FIRST_TX, LAST_TX.
        (PAS de SUBS — c'est une métrique customer-centric, pas merchant-centric.)
        """
        if not start_date:
            start_date = date.today() - timedelta(days=30)
        if not end_date:
            end_date = date.today() - timedelta(days=1)

        # PROCESS_DATE en string yyyyMMdd → partition pruning Spark (comme le script de réf)
        start_ymd    = start_date.strftime('%Y%m%d')
        end_ymd_excl = (end_date + timedelta(days=1)).strftime('%Y%m%d')

        # Services CREDIT (merchant reçoit) — copie exacte du script
        credit_services = (
            "'Agent Payment to Merchant','Merchant Payment','Merchant Payment to Merchant',"
            "'Merchant QR Payment','Merchant Till payment','Merchant to Merchant Payment via Till ID',"
            "'Merchant Online Payment','Merchant Cashout','Agent/Merchant Bill Payment'"
        )
        # Services DEBIT (merchant paie)
        debit_services = (
            "'Merchant Cashout','Agent/Merchant Bill Payment',"
            "'Merchant Payment to Merchant','Merchant to Merchant Payment via Till ID'"
        )

        excluded_merch_sql = self._quote_list(list(self.EXCLUDED_MERCHANTS)) if self.EXCLUDED_MERCHANTS else ""
        excl_account = f"AND ORGANIZATIONSHORTCODE NOT IN ({excluded_merch_sql})" if excluded_merch_sql else ""

        query = f"""
        WITH merchant_account AS (
            -- Profil merchant — DATE_CODE = yesterday, PRODUCTS LIKE '%Merchant Product%'
            SELECT * FROM (
                SELECT
                    DATE_CODE,
                    ORGANIZATIONSHORTCODE,
                    UNIQUESYSTEMID AS IDENTITY_ID,
                    IDENTITYMSISDN AS ACCOUNT_ID,
                    IDENTITYNAME   AS MERCHANT_NAME,
                    DEPARTMENT,
                    COMMUNE,
                    ACCOUNTGLCODE,
                    INITCAP(REPLACE(REPLACE(SEGMENT, 'mcommerchant#', ''), ' Merchant', '')) AS MERCHANT_TYPE,
                    CASE
                        WHEN INITCAP(REPLACE(SEGMENT, 'mcommerchant#', ''))
                             IN ('Gold Merchant','Silver Merchant','Silver1 Merchant','Silver2 Merchant') THEN '2%'
                        WHEN INITCAP(REPLACE(SEGMENT, 'mcommerchant#', '')) = 'Blue Merchant' THEN '1.5%'
                        ELSE '0%'
                    END AS FEE,
                    ROW_NUMBER() OVER (
                        PARTITION BY ORGANIZATIONSHORTCODE
                        ORDER BY TO_TIMESTAMP(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
                WHERE PRODUCTS LIKE '%Merchant Product%'
                  AND DATE_CODE = date_format(current_date - 1, 'yyyyMMdd')
                  {excl_account}
            ) WHERE rn = 1
        ),
        merchant_tx AS (
            -- CREDIT (merchant reçoit)
            SELECT
                CREDITPARTYIDENTIFIER AS ORGANIZATION_SHORTCODE,
                TRANSACTIONID,
                ORIGINALAMOUNT,
                CHARGEAMOUNT,
                to_date(PROCESS_DATE, 'yyyyMMdd') AS TRANSACTION_DATE
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE < '{end_ymd_excl}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND SERVICENAME IN ({credit_services})
            UNION ALL
            -- DEBIT (merchant paie)
            SELECT
                DEBITPARTYIDENTIFIER  AS ORGANIZATION_SHORTCODE,
                TRANSACTIONID,
                ORIGINALAMOUNT,
                CHARGEAMOUNT,
                to_date(PROCESS_DATE, 'yyyyMMdd') AS TRANSACTION_DATE
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE < '{end_ymd_excl}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND SERVICENAME IN ({debit_services})
        ),
        merchant_tx_dedup AS (
            -- Dédup pour les tx qui apparaitraient sur les 2 côtés (M2M etc.)
            SELECT DISTINCT
                ORGANIZATION_SHORTCODE, TRANSACTIONID, ORIGINALAMOUNT, CHARGEAMOUNT, TRANSACTION_DATE
            FROM merchant_tx
            WHERE ORGANIZATION_SHORTCODE IS NOT NULL
        ),
        merchant_aggregates AS (
            SELECT
                ORGANIZATION_SHORTCODE,
                COUNT(DISTINCT TRANSACTIONID)    AS VOLUME,
                COALESCE(SUM(ORIGINALAMOUNT), 0) AS VALUE,
                COALESCE(SUM(CHARGEAMOUNT), 0)   AS REVENUE,
                MIN(TRANSACTION_DATE)            AS FIRST_TX,
                MAX(TRANSACTION_DATE)            AS LAST_TX
            FROM merchant_tx_dedup
            GROUP BY ORGANIZATION_SHORTCODE
        )
        SELECT
            ma.ORGANIZATIONSHORTCODE,
            ma.MERCHANT_NAME,
            ma.ACCOUNT_ID,
            ma.IDENTITY_ID,
            ma.MERCHANT_TYPE,
            ma.FEE,
            ma.DEPARTMENT,
            ma.COMMUNE,
            ma.ACCOUNTGLCODE,
            agg.VOLUME,
            agg.VALUE,
            agg.REVENUE,
            agg.FIRST_TX,
            agg.LAST_TX
        FROM merchant_account ma
        INNER JOIN merchant_aggregates agg
            ON ma.ORGANIZATIONSHORTCODE = agg.ORGANIZATION_SHORTCODE
        ORDER BY agg.VOLUME DESC, agg.VALUE DESC
        LIMIT {limit} OFFSET {offset}
        """

        # Comptage global (sans LIMIT) — même logique : INNER JOIN account × tx
        count_query = f"""
        WITH merchant_account AS (
            SELECT ORGANIZATIONSHORTCODE FROM (
                SELECT
                    ORGANIZATIONSHORTCODE,
                    ROW_NUMBER() OVER (
                        PARTITION BY ORGANIZATIONSHORTCODE
                        ORDER BY TO_TIMESTAMP(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
                WHERE PRODUCTS LIKE '%Merchant Product%'
                  AND DATE_CODE = date_format(current_date - 1, 'yyyyMMdd')
                  {excl_account}
            ) WHERE rn = 1
        ),
        merchant_tx_dedup AS (
            SELECT DISTINCT ORGANIZATION_SHORTCODE, TRANSACTIONID, ORIGINALAMOUNT, CHARGEAMOUNT FROM (
                SELECT CREDITPARTYIDENTIFIER AS ORGANIZATION_SHORTCODE, TRANSACTIONID, ORIGINALAMOUNT, CHARGEAMOUNT
                FROM hive_metastore.ods_dl.mfs_transaction_aml
                WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE < '{end_ymd_excl}'
                  AND TRANSACTIONSTATUS = 'Completed' AND ORIGINALAMOUNT IS NOT NULL
                  AND SERVICENAME IN ({credit_services})
                UNION ALL
                SELECT DEBITPARTYIDENTIFIER AS ORGANIZATION_SHORTCODE, TRANSACTIONID, ORIGINALAMOUNT, CHARGEAMOUNT
                FROM hive_metastore.ods_dl.mfs_transaction_aml
                WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE < '{end_ymd_excl}'
                  AND TRANSACTIONSTATUS = 'Completed' AND ORIGINALAMOUNT IS NOT NULL
                  AND SERVICENAME IN ({debit_services})
            ) WHERE ORGANIZATION_SHORTCODE IS NOT NULL
        )
        SELECT
            CAST(COUNT(DISTINCT t.ORGANIZATION_SHORTCODE) AS BIGINT) AS TOTAL_MERCHANTS,
            CAST(COUNT(DISTINCT t.TRANSACTIONID) AS BIGINT)          AS TOTAL_VOLUME,
            CAST(COALESCE(SUM(t.ORIGINALAMOUNT), 0) AS DOUBLE)        AS TOTAL_VALUE,
            CAST(COALESCE(SUM(t.CHARGEAMOUNT), 0) AS DOUBLE)          AS TOTAL_REVENUE
        FROM merchant_tx_dedup t
        INNER JOIN merchant_account ma ON ma.ORGANIZATIONSHORTCODE = t.ORGANIZATION_SHORTCODE
        """

        rows = [dict(r) for r in self.db.execute(text(query)).mappings()]

        totals = {"TOTAL_MERCHANTS": 0, "TOTAL_VOLUME": 0, "TOTAL_VALUE": 0, "TOTAL_REVENUE": 0}
        try:
            count_result = self.db.execute(text(count_query)).mappings().first()
            if count_result:
                totals = {k: (v or 0) for k, v in dict(count_result).items()}
        except Exception as e:
            print(f"[ACTIVE_MERCHANTS] count failed: {e}")

        return {
            "start_date": start_date.strftime('%Y-%m-%d'),
            "end_date":   end_date.strftime('%Y-%m-%d'),
            "total_merchants": int(totals.get("TOTAL_MERCHANTS") or 0),
            "total_volume":    int(totals.get("TOTAL_VOLUME") or 0),
            "total_value":     float(totals.get("TOTAL_VALUE") or 0),
            "total_revenue":   float(totals.get("TOTAL_REVENUE") or 0),
            "rows": rows,
        }

    def get_transactions(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        merchant_id_list: Optional[List[str]] = None,
        limit: int = 100,
        offset: int = 0,
        channels: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_date, end_date, merchant_id_list, service_names, channels, msisdns, statuses
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        query = f"""
        SELECT DISTINCT
            TRANSACTIONID,
            TRANSACTION_DATE,
            MERCHANT_ID,
            CUSTOMER_MSISDN   AS MSISDN,
            ORIGINALAMOUNT    AS AMOUNT,
            CHARGEAMOUNT      AS CHARGE,
            TRANSACTIONSTATUS AS STATUS,
            TR_TYPE,
            REASONTYPE,
            CHANNEL,
            INITIATOR,
            FAILUREREASON
        FROM ({inner})
        WHERE TR_TYPE IS NOT NULL {outer}
        ORDER BY TRANSACTION_DATE DESC
        LIMIT {limit} OFFSET {offset}
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_transactions_summary(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        merchant_id_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Aggregate KPIs over the full filtered period (no LIMIT).

        Returns (Operational Ledger naming):
        - UNIQUE_SUBS      : COUNT(DISTINCT CUSTOMER_MSISDN)
        - UNIQUE_MERCHANTS : COUNT(DISTINCT MERCHANT_ID)
        - VOLUME           : COUNT(DISTINCT TRANSACTIONID)
        - VALUE            : SUM(ORIGINALAMOUNT)
        - REVENUE          : SUM(CHARGEAMOUNT)

        Backward-compat aliases (legacy callers):
        - TOTAL_COUNT       = COUNT(*) over the de-duplicated inner set (counts both legs of M2M)
        - DISTINCT_MERCHANT = UNIQUE_MERCHANTS
        - TOTAL_VOLUME      = VALUE (deprecated naming; was sum of amounts)
        - TOTAL_CHARGE      = REVENUE
        """
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_date, end_date, merchant_id_list, service_names, channels, msisdns, statuses
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        query = f"""
        SELECT
            COUNT(*)                                AS TOTAL_COUNT,
            COUNT(DISTINCT TRANSACTIONID)           AS VOLUME,
            COUNT(DISTINCT MERCHANT_ID)             AS UNIQUE_MERCHANTS,
            COUNT(DISTINCT CUSTOMER_MSISDN)         AS UNIQUE_SUBS,
            COALESCE(SUM(ORIGINALAMOUNT), 0)        AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),  0)         AS REVENUE
        FROM (
            SELECT DISTINCT
                TRANSACTIONID, TRANSACTION_DATE, MERCHANT_ID, CUSTOMER_MSISDN,
                ORIGINALAMOUNT, CHARGEAMOUNT, TR_TYPE
            FROM ({inner})
            WHERE TR_TYPE IS NOT NULL {outer}
        )
        """
        result = self.db.execute(text(query))
        row = result.mappings().first()
        if not row:
            empty = {
                "UNIQUE_SUBS": 0, "UNIQUE_MERCHANTS": 0,
                "VOLUME": 0, "VALUE": 0, "REVENUE": 0,
                # Legacy aliases
                "TOTAL_COUNT": 0, "DISTINCT_MERCHANT": 0, "TOTAL_VOLUME": 0, "TOTAL_CHARGE": 0,
            }
            return empty
        d = dict(row)
        # Add legacy aliases
        d["DISTINCT_MERCHANT"] = d["UNIQUE_MERCHANTS"]
        d["TOTAL_VOLUME"]      = d["VALUE"]
        d["TOTAL_CHARGE"]      = d["REVENUE"]
        return d

    def get_monthly_stats_by_merchant(
        self,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        merchant_id_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> Dict[str, Any]:
        """
        Monthly aggregates per (MONTH, MERCHANT_ID), with profile join.

        For each (YYYY-MM, MERCHANT_ID):
        - SUBS    = COUNT(DISTINCT CUSTOMER_MSISDN)
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID)
        - VALUE   = SUM(ORIGINALAMOUNT) HTG
        - REVENUE = SUM(CHARGEAMOUNT)   HTG

        LEFT JOIN onto merchant profile (ORGANIZATIONSHORTCODE) so each row carries
        MERCHANT_NAME, MERCHANT_TYPE, FEE, DEPARTMENT, COMMUNE.
        Profile rows where MERCHANT_NAME is NULL → still returned (merchant has tx but
        no profile snapshot for current_date − 1).

        Hardcoded exclusions (EXCLUDED_MSISDNS / MERCHANTS / REASON_TYPES) apply
        automatically through _build_filters.
        """
        # Normalize month bounds: first day of start month → last day of end month
        if not end_month:
            end_month = date.today() - timedelta(days=1)
        if not start_month:
            # Default to 6 months back, first of month
            y, m = end_month.year, end_month.month - 5
            while m <= 0:
                m += 12; y -= 1
            start_month = date(y, m, 1)
        # Normalize start to first of month, end to last day of its month
        start_month = date(start_month.year, start_month.month, 1)
        if end_month.month == 12:
            next_first = date(end_month.year + 1, 1, 1)
        else:
            next_first = date(end_month.year, end_month.month + 1, 1)
        end_last = next_first - timedelta(days=1)

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_month, end_last, merchant_id_list, service_names,
            channels, msisdns, statuses,
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        query = f"""
        WITH merchant_account AS (
            SELECT * FROM (
                SELECT
                    ORGANIZATIONSHORTCODE,
                    IDENTITYNAME   AS MERCHANT_NAME,
                    IDENTITYMSISDN AS ACCOUNT_ID,
                    DEPARTMENT,
                    COMMUNE,
                    ACCOUNTGLCODE,
                    INITCAP(REPLACE(REPLACE(SEGMENT, 'mcommerchant#', ''), ' Merchant', '')) AS MERCHANT_TYPE,
                    CASE
                        WHEN INITCAP(REPLACE(SEGMENT, 'mcommerchant#', ''))
                             IN ('Gold Merchant','Silver Merchant','Silver1 Merchant','Silver2 Merchant') THEN '2%'
                        WHEN INITCAP(REPLACE(SEGMENT, 'mcommerchant#', '')) = 'Blue Merchant' THEN '1.5%'
                        ELSE '0%'
                    END AS FEE,
                    ROW_NUMBER() OVER (
                        PARTITION BY ORGANIZATIONSHORTCODE
                        ORDER BY TO_TIMESTAMP(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
                WHERE PRODUCTS LIKE '%Merchant Product%'
                  AND DATE_CODE = date_format(current_date - 1, 'yyyyMMdd')
            ) WHERE rn = 1
        ),
        dedup AS (
            SELECT DISTINCT
                date_format(TRANSACTION_DATE, 'yyyy-MM') AS MONTH,
                MERCHANT_ID,
                TRANSACTIONID,
                CUSTOMER_MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT
            FROM ({inner})
            WHERE TR_TYPE IS NOT NULL {outer}
        ),
        agg AS (
            SELECT
                MONTH,
                MERCHANT_ID,
                COUNT(DISTINCT CUSTOMER_MSISDN) AS SUBS,
                COUNT(DISTINCT TRANSACTIONID)   AS VOLUME,
                COALESCE(SUM(ORIGINALAMOUNT),0) AS VALUE,
                COALESCE(SUM(CHARGEAMOUNT),0)   AS REVENUE
            FROM dedup
            GROUP BY MONTH, MERCHANT_ID
        )
        SELECT
            a.MONTH,
            a.MERCHANT_ID,
            ma.MERCHANT_NAME,
            ma.MERCHANT_TYPE,
            ma.FEE,
            ma.DEPARTMENT,
            ma.COMMUNE,
            ma.ACCOUNTGLCODE,
            a.SUBS,
            a.VOLUME,
            a.VALUE,
            a.REVENUE
        FROM agg a
        LEFT JOIN merchant_account ma ON ma.ORGANIZATIONSHORTCODE = a.MERCHANT_ID
        ORDER BY a.MONTH DESC, a.VALUE DESC
        LIMIT {limit}
        """
        rows = [dict(r) for r in self.db.execute(text(query)).mappings()]

        # Period totals (single query for KPI cards)
        totals_query = f"""
        SELECT
            COUNT(DISTINCT MERCHANT_ID)     AS UNIQUE_MERCHANTS,
            COUNT(DISTINCT CUSTOMER_MSISDN) AS UNIQUE_SUBS,
            COUNT(DISTINCT TRANSACTIONID)   AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT),0) AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),0)   AS REVENUE
        FROM (
            SELECT DISTINCT
                TRANSACTIONID, MERCHANT_ID, CUSTOMER_MSISDN,
                ORIGINALAMOUNT, CHARGEAMOUNT
            FROM ({inner})
            WHERE TR_TYPE IS NOT NULL {outer}
        )
        """
        totals_row = next(iter(self.db.execute(text(totals_query)).mappings()), None) or {}
        totals = {
            "UNIQUE_MERCHANTS": int(totals_row.get("UNIQUE_MERCHANTS") or 0),
            "UNIQUE_SUBS":      int(totals_row.get("UNIQUE_SUBS") or 0),
            "VOLUME":           int(totals_row.get("VOLUME") or 0),
            "VALUE":            float(totals_row.get("VALUE") or 0),
            "REVENUE":          float(totals_row.get("REVENUE") or 0),
        }

        return {
            "start_month": start_month.strftime('%Y-%m'),
            "end_month":   end_last.strftime('%Y-%m'),
            "totals":      totals,
            "rows":        rows,
        }
