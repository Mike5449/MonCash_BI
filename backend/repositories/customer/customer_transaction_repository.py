from sqlalchemy import text
from typing import List, Dict, Any, Optional, Tuple
from datetime import date, timedelta


class CustomerTransactionRepository:
    """
    Daily customer transactions sourced from hive_metastore.ods_dl.mfs_transaction_aml.
    Date axis is PROCESS_DATE (yyyyMMdd string), exposed as TRANSACTION_DATE.
    """

    def __init__(self, db):
        self.db = db

    def _build_filters(
        self,
        start_date: Optional[date],
        end_date: Optional[date],
        msisdn_list: Optional[List[str]],
        service_names: Optional[List[str]],
        channels: Optional[List[str]] = None,
        departments: Optional[List[str]] = None,
    ) -> Tuple[str, str, str, str, str]:
        """Return (start_str, end_str, sub_msisdn_cred, sub_msisdn_debt, outer_filters)."""
        if not start_date:
            start_date = date.today() - timedelta(days=30)
        if not end_date:
            end_date = date.today() - timedelta(days=1)

        start_str = start_date.strftime('%Y%m%d')
        # end is exclusive in source script, shift +1 day to include end_date
        end_str = (end_date + timedelta(days=1)).strftime('%Y%m%d')

        sub_msisdn_cred = ""
        sub_msisdn_debt = ""
        msisdn_outer = ""
        if msisdn_list:
            cleaned = [m.strip() for m in msisdn_list if m and m.strip()]
            if cleaned:
                m_list_str = "', '".join(cleaned)
                msisdn_outer = f"AND MSISDN IN ('{m_list_str}')"
                sub_msisdn_cred = f"AND CREDITPARTYIDENTIFIER IN ('{m_list_str}')"
                sub_msisdn_debt = f"AND DEBITPARTYIDENTIFIER IN ('{m_list_str}')"

        tr_type_outer = ""
        if service_names:
            cleaned = [s.strip() for s in service_names if s and s.strip()]
            if cleaned:
                names_str = "', '".join(cleaned)
                tr_type_outer = f"AND TR_TYPE IN ('{names_str}')"

        channel_outer = ""
        if channels:
            cleaned = [c.strip().upper() for c in channels if c and c.strip()]
            if cleaned:
                ch_str = "', '".join(cleaned)
                channel_outer = f"AND UPPER(CHANNEL) IN ('{ch_str}')"

        # Filtre département : sous-requête `MSISDN IN (...)` qui joint la location
        # (snapshot d'hier) avec la table des sites pour récupérer le DEPARTMENT.
        # On garde un format outer (s'applique sur les rows déjà construits dans `base`).
        dept_outer = ""
        if departments:
            # Whitelist : seules les lettres/espaces/tirets/apostrophes (départements haïtiens)
            import re as _re
            cleaned_depts = []
            for d in departments:
                if not d:
                    continue
                safe = _re.sub(r"[^\w\s\-'À-ſ]", "", str(d).strip())
                if safe:
                    cleaned_depts.append(safe.replace("'", "''").upper())
            if cleaned_depts:
                depts_str = "', '".join(cleaned_depts)
                dept_outer = (
                    f"AND MSISDN IN (SELECT DISTINCT LO.MSISDN "
                    f"FROM gr_dgc_dwh_prd.temp_dl.ht_location LO "
                    f"INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI "
                    f"ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector "
                    f"WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1 "
                    f"AND UPPER(TRIM(SI.DEPARTMENT)) IN ('{depts_str}'))"
                )

        outer_filters = f"{msisdn_outer} {tr_type_outer} {channel_outer} {dept_outer}".strip()
        return start_str, end_str, sub_msisdn_cred, sub_msisdn_debt, outer_filters

    # Statuses accepted by the /transactions and /active-customers pages.
    # The frontend picker shows exactly these four values ; anything outside
    # the whitelist is silently dropped from the query for safety.
    ALLOWED_TX_STATUSES = ("Completed", "Cancelled", "Declined", "Expired")

    def _build_status_filter(self, statuses: Optional[List[str]]) -> str:
        """
        Build the SQL clause for TRANSACTIONSTATUS. Whitelisted values only.

        Default (statuses is None) → "AND TRANSACTIONSTATUS = 'Completed'".
        Single valid value        → "AND TRANSACTIONSTATUS = 'X'".
        Multiple valid values     → "AND TRANSACTIONSTATUS IN ('X', 'Y')".
        Empty / all invalid       → falls back to Completed (never emits empty).
        """
        if not statuses:
            return "AND TRANSACTIONSTATUS = 'Completed'"
        allowed = [s.strip() for s in statuses if s and s.strip() in self.ALLOWED_TX_STATUSES]
        if not allowed:
            return "AND TRANSACTIONSTATUS = 'Completed'"
        if len(allowed) == 1:
            return f"AND TRANSACTIONSTATUS = '{allowed[0]}'"
        joined = "', '".join(allowed)
        return f"AND TRANSACTIONSTATUS IN ('{joined}')"

    def _inner_union(
        self,
        start_str: str,
        end_str: str,
        sub_msisdn_cred: str,
        sub_msisdn_debt: str,
        transaction_statuses: Optional[List[str]] = None,
    ) -> str:
        status_filter = self._build_status_filter(transaction_statuses)
        return f"""
            SELECT
                TRANSACTIONID,
                to_date(PROCESS_DATE, 'yyyyMMdd') AS TRANSACTION_DATE,
                CREDITPARTYIDENTIFIER AS MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT,
                TRANSACTIONSTATUS,
                CASE
                    WHEN SERVICENAME = 'OD Money Transfer Prefunded' THEN 'B2W'
                    WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code')
                         THEN 'P2P_RECEIVE'
                    WHEN SERVICENAME = 'Cash In' THEN 'CASHIN'
                    WHEN SERVICENAME = 'Cash In OTC' THEN 'CASHIN_OTC'
                    WHEN SERVICENAME = 'IMT revceiving' THEN 'IMT'
                    WHEN SERVICENAME = 'Money Transfer Prefunded' THEN 'PREFUNDED'
                    WHEN SERVICENAME = 'Bulk B2C transfer' THEN 'Payroll | disbursements'
                END AS TR_TYPE,
                CHANNEL,
                REASONTYPE,
                INITIATOR,
                FAILUREREASON
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE to_date(PROCESS_DATE, 'yyyyMMdd') >= to_date('{start_str}', 'yyyyMMdd')
              AND to_date(PROCESS_DATE, 'yyyyMMdd') <  to_date('{end_str}',   'yyyyMMdd')
              {status_filter}
              AND SERVICENAME IN (
                    'Cash In', 'P2P Transfer', 'Send Money to Registered Customer by QR Code',
                    'Cash In OTC', 'OD Money Transfer Prefunded', 'IMT revceiving',
                    'Money Transfer Prefunded', 'Bulk B2C transfer'
              )
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'
              {sub_msisdn_cred}

            UNION ALL

            SELECT
                TRANSACTIONID,
                to_date(PROCESS_DATE, 'yyyyMMdd') AS TRANSACTION_DATE,
                DEBITPARTYIDENTIFIER AS MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT,
                TRANSACTIONSTATUS,
                CASE
                    WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code')
                         THEN 'P2P_SEND'
                    WHEN SERVICENAME = 'Cash Out' THEN 'CASHOUT'
                    WHEN SERVICENAME = 'Customer Bill Payment'
                         AND CREDITPARTYIDENTIFIER IN ('314','318','322','326','310')
                         THEN 'DIGI_PRODUCT'
                    WHEN SERVICENAME = 'Customer Bill Payment' THEN 'BILLPAY'
                    WHEN SERVICENAME = 'Gift Top up' THEN 'TOPUP_GIFT'
                    WHEN SERVICENAME = 'Prepaid Top up' THEN 'SELF_TOPUP'
                    WHEN SERVICENAME IN (
                          'Merchant Payment', 'Merchant QR Payment', 'Merchant Till payment',
                          'Merchant to Merchant Payment via Till ID', 'Merchant Online Payment'
                    ) THEN 'PAY2MERC'
                    WHEN SERVICENAME = 'Wallet to Bank' THEN 'W2B'
                END AS TR_TYPE,
                CHANNEL,
                REASONTYPE,
                INITIATOR,
                FAILUREREASON
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE to_date(PROCESS_DATE, 'yyyyMMdd') >= to_date('{start_str}', 'yyyyMMdd')
              AND to_date(PROCESS_DATE, 'yyyyMMdd') <  to_date('{end_str}',   'yyyyMMdd')
              {status_filter}
              AND SERVICENAME IN (
                    'Cash Out', 'Merchant Cashout', 'Customer Bill Payment', 'Agent/Merchant Bill Payment',
                    'Merchant Payment to Merchant', 'Merchant Payment', 'Merchant QR Payment',
                    'Merchant Till payment', 'Merchant to Merchant Payment via Till ID',
                    'Merchant Online Payment', 'P2P Transfer',
                    'Send Money to Registered Customer by QR Code',
                    'Prepaid Top up', 'Gift Top up', 'OTC Top Up', 'Wallet to Bank'
              )
              AND ORIGINALAMOUNT IS NOT NULL
              AND DEBITPARTYTYPE = 'Customer'
              {sub_msisdn_debt}
        """

    def get_transactions(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        limit: int = 100,
        offset: int = 0,
        active_only: bool = False,
        channels: Optional[List[str]] = None,
        transaction_statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_date, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt, transaction_statuses)

        if active_only:
            query = f"""
            SELECT
                MSISDN,
                MAX(TRANSACTION_DATE) AS LATEST_TRANSACTION,
                COUNT(*) AS TRANSACTION_COUNT,
                SUM(ORIGINALAMOUNT) AS TOTAL_VOLUME,
                'CUSTOMER' AS ACCOUNT_TYPE
            FROM ({inner})
            WHERE 1=1 {outer}
            GROUP BY MSISDN
            ORDER BY MAX(TRANSACTION_DATE) DESC
            LIMIT {limit} OFFSET {offset}
            """
        else:
            query = f"""
            SELECT DISTINCT
                TRANSACTIONID,
                TRANSACTION_DATE,
                MSISDN,
                ORIGINALAMOUNT AS AMOUNT,
                CHARGEAMOUNT  AS CHARGE,
                TRANSACTIONSTATUS AS STATUS,
                TR_TYPE,
                REASONTYPE,
                CHANNEL,
                INITIATOR,
                FAILUREREASON
            FROM ({inner})
            WHERE 1=1 {outer}
            ORDER BY TRANSACTION_DATE DESC
            LIMIT {limit} OFFSET {offset}
            """

        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_daily_stats_by_type(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        limit: int = 5000,
    ) -> List[Dict[str, Any]]:
        """
        Pour chaque (TRANSACTION_DATE, TR_TYPE), agrège :
        - SUBS    = COUNT(DISTINCT MSISDN)       du jour pour ce TR_TYPE
                    (MSISDN actifs ce jour-là sur ce produit)
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID) du jour pour ce TR_TYPE
        - VALUE   = SUM(ORIGINALAMOUNT)          du jour pour ce TR_TYPE
        - REVENUE = SUM(CHARGEAMOUNT)            du jour pour ce TR_TYPE

        NB : SUBS est calculé PAR JOUR (et non plus en cumul sur toute la période),
        ce qui est nécessaire pour un affichage pivot day × TR_TYPE.
        Si tu veux le total cumulé cross-jours par TR_TYPE, il faut un autre endpoint
        (le snapshot MTD/WoW ou get_mtd_snapshot_by_type le fait).
        """
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_date, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        query = f"""
        WITH base AS (
            {inner}
        )
        SELECT
            TRANSACTION_DATE,
            TR_TYPE,
            COUNT(DISTINCT MSISDN)           AS SUBS,
            COUNT(DISTINCT TRANSACTIONID)    AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT), 0) AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),  0) AS REVENUE
        FROM base
        WHERE TR_TYPE IS NOT NULL {outer}
        GROUP BY TRANSACTION_DATE, TR_TYPE
        ORDER BY TRANSACTION_DATE DESC, VALUE DESC
        LIMIT {limit}
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_daily_stats_by_channel(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> List[Dict[str, Any]]:
        """
        Pour chaque (TRANSACTION_DATE, CHANNEL), agrège :
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID) du jour pour ce CHANNEL
        - VALUE   = SUM(ORIGINALAMOUNT)          du jour pour ce CHANNEL
        - REVENUE = SUM(CHARGEAMOUNT)            du jour pour ce CHANNEL
        - SUBS    = COUNT(DISTINCT MSISDN) du jour pour ce CHANNEL **avec attribution
                    par canal primaire** : chaque MSISDN n'est comptée que sur SON canal
                    primaire du jour (= celui où elle a le plus de transactions, tie-break
                    alphabétique sur CHANNEL). Ainsi la somme des SUBS sur tous les channels
                    = nombre total unique de subscribers du jour.

        VOLUME / VALUE / REVENUE restent attribués au canal réel de la transaction.
        CHANNEL NULL ou vide → 'Unknown'.
        """
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_date, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        query = f"""
        WITH base AS (
            {inner}
        ),
        normalized AS (
            SELECT
                TRANSACTION_DATE,
                CASE WHEN CHANNEL IS NULL OR TRIM(CHANNEL) = '' THEN 'Unknown' ELSE CHANNEL END AS CHANNEL,
                TRANSACTIONID,
                MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT
            FROM base
            WHERE TR_TYPE IS NOT NULL {outer}
        ),
        -- Primary channel per (MSISDN, DAY) : channel where the MSISDN has the most
        -- distinct transactions that day, alphabetical tie-break. Guarantees each MSISDN
        -- is counted in EXACTLY ONE channel per day.
        msisdn_channel_counts AS (
            SELECT
                MSISDN,
                TRANSACTION_DATE,
                CHANNEL,
                COUNT(DISTINCT TRANSACTIONID) AS tx_count
            FROM normalized
            GROUP BY MSISDN, TRANSACTION_DATE, CHANNEL
        ),
        primary_channel AS (
            SELECT MSISDN, TRANSACTION_DATE, CHANNEL FROM (
                SELECT
                    MSISDN, TRANSACTION_DATE, CHANNEL,
                    ROW_NUMBER() OVER (
                        PARTITION BY MSISDN, TRANSACTION_DATE
                        ORDER BY tx_count DESC, CHANNEL ASC
                    ) AS rn
                FROM msisdn_channel_counts
            ) WHERE rn = 1
        ),
        subs_per_day_channel AS (
            SELECT
                TRANSACTION_DATE,
                CHANNEL,
                COUNT(DISTINCT MSISDN) AS SUBS
            FROM primary_channel
            GROUP BY TRANSACTION_DATE, CHANNEL
        ),
        metrics_per_day_channel AS (
            SELECT
                TRANSACTION_DATE,
                CHANNEL,
                COUNT(DISTINCT TRANSACTIONID)    AS VOLUME,
                COALESCE(SUM(ORIGINALAMOUNT), 0) AS VALUE,
                COALESCE(SUM(CHARGEAMOUNT),  0)  AS REVENUE
            FROM normalized
            GROUP BY TRANSACTION_DATE, CHANNEL
        )
        SELECT
            m.TRANSACTION_DATE,
            m.CHANNEL,
            m.VOLUME,
            COALESCE(s.SUBS, 0) AS SUBS,
            m.VALUE,
            m.REVENUE
        FROM metrics_per_day_channel m
        LEFT JOIN subs_per_day_channel s
            ON s.TRANSACTION_DATE = m.TRANSACTION_DATE
           AND s.CHANNEL = m.CHANNEL
        ORDER BY m.TRANSACTION_DATE DESC, m.VALUE DESC
        LIMIT {limit}
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_daily_stats_by_department(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> List[Dict[str, Any]]:
        """
        Pour chaque (TRANSACTION_DATE, DEPARTMENT), agrège :
        - SUBS    = COUNT(DISTINCT MSISDN)       du jour pour ce département
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID) du jour pour ce département
        - VALUE   = SUM(ORIGINALAMOUNT)          du jour pour ce département
        - REVENUE = SUM(CHARGEAMOUNT)            du jour pour ce département

        DEPARTMENT vient du JOIN ht_location × vw_dt_network_sites (snapshot d'hier).
        Chaque MSISDN est attribué à UN département (loc_rn = 1) → la somme des SUBS
        cross-départements approche le total unique du jour (à 'Unknown' près).
        """
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_date, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        query = f"""
        WITH base AS (
            {inner}
        ),
        filtered AS (
            SELECT *
            FROM base
            WHERE TR_TYPE IS NOT NULL {outer}
        ),
        location_data AS (
            SELECT MSISDN, DEPARTMENT FROM (
                SELECT
                    LO.MSISDN,
                    SI.DEPARTMENT,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                  AND LO.MSISDN IN (SELECT DISTINCT MSISDN FROM filtered)
            ) WHERE loc_rn = 1
        ),
        enriched AS (
            SELECT f.*, COALESCE(l.DEPARTMENT, 'Unknown') AS DEPARTMENT_VAL
            FROM filtered f
            LEFT JOIN location_data l ON f.MSISDN = l.MSISDN
        )
        SELECT
            TRANSACTION_DATE,
            DEPARTMENT_VAL                   AS DEPARTMENT,
            COUNT(DISTINCT MSISDN)           AS SUBS,
            COUNT(DISTINCT TRANSACTIONID)    AS VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT), 0) AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),  0)  AS REVENUE
        FROM enriched
        GROUP BY TRANSACTION_DATE, DEPARTMENT_VAL
        ORDER BY TRANSACTION_DATE DESC, VALUE DESC
        LIMIT {limit}
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_daily_totals(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        departments: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Pour chaque TRANSACTION_DATE, totaux quotidiens :
        - SUBS    = COUNT(DISTINCT MSISDN) du jour (clean, pas de double comptage)
        - VOLUME  = Σ over TR_TYPE de COUNT(DISTINCT TRANSACTIONID) — identique à la somme
                    cross-types de daily-stats-by-type
        - VALUE   = Σ over TR_TYPE de SUM(ORIGINALAMOUNT)
        - REVENUE = Σ over TR_TYPE de SUM(CHARGEAMOUNT)

        Filtres optionnels :
        - service_names : liste de TR_TYPE (ex. ['CASHIN','P2P_SEND'])
        - departments   : liste de DEPARTMENT (network location, ex. ['Ouest','Sud-Est'])
        """
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_date, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        # Optional DEPARTMENT filter — applique un JOIN avec location_data uniquement si nécessaire
        dept_join = ""
        dept_filter = ""
        if departments:
            cleaned = [d.strip() for d in departments if d and d.strip()]
            import re as _re
            safe_list: List[str] = []
            for d in cleaned:
                safe_d = _re.sub(r"[^\w\s\-'À-ſ]", "", d).replace("'", "''").strip()
                if safe_d:
                    safe_list.append(safe_d)
            if safe_list:
                dept_in = "', '".join(safe_list)
                dept_join = """
        LEFT JOIN (
            SELECT MSISDN, DEPARTMENT FROM (
                SELECT
                    LO.MSISDN,
                    SI.DEPARTMENT,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
            ) WHERE loc_rn = 1
        ) loc ON src.MSISDN = loc.MSISDN
        """
                dept_filter = f"AND COALESCE(loc.DEPARTMENT, 'Unknown') IN ('{dept_in}')"

        query = f"""
        WITH base AS (
            SELECT src.*
            FROM ({inner}) src
            {dept_join}
            WHERE TR_TYPE IS NOT NULL {outer} {dept_filter}
        ),
        per_type_per_day AS (
            SELECT
                TRANSACTION_DATE,
                TR_TYPE,
                COUNT(DISTINCT TRANSACTIONID)    AS V,
                COALESCE(SUM(ORIGINALAMOUNT), 0) AS VA,
                COALESCE(SUM(CHARGEAMOUNT),  0)  AS R
            FROM base
            GROUP BY TRANSACTION_DATE, TR_TYPE
        ),
        totals_per_day AS (
            SELECT
                TRANSACTION_DATE,
                SUM(V)  AS VOLUME,
                SUM(VA) AS VALUE,
                SUM(R)  AS REVENUE
            FROM per_type_per_day
            GROUP BY TRANSACTION_DATE
        ),
        subs_per_day AS (
            SELECT TRANSACTION_DATE, COUNT(DISTINCT MSISDN) AS SUBS
            FROM base
            GROUP BY TRANSACTION_DATE
        )
        SELECT
            t.TRANSACTION_DATE,
            COALESCE(s.SUBS, 0) AS SUBS,
            t.VOLUME,
            t.VALUE,
            t.REVENUE
        FROM totals_per_day t
        LEFT JOIN subs_per_day s ON s.TRANSACTION_DATE = t.TRANSACTION_DATE
        ORDER BY t.TRANSACTION_DATE
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    @staticmethod
    def _first_of_month(d: date) -> date:
        return date(d.year, d.month, 1)

    @staticmethod
    def _previous_mtd_end(report_date: date) -> date:
        """
        Renvoie la même day-of-month dans le mois précédent.
        Borne au dernier jour du mois précédent si nécessaire (ex: 31 mars -> 28/29 fév).
        """
        year = report_date.year
        month = report_date.month - 1
        if month == 0:
            month = 12
            year -= 1
        # dernier jour du mois précédent
        next_first = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        last_of_prev = next_first - timedelta(days=1)
        day = min(report_date.day, last_of_prev.day)
        return date(year, month, day)

    def get_mtd_snapshot_by_type(
        self,
        report_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        departments: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Month-on-Month MTD snapshot, par TR_TYPE :
        - CURR = [1er du mois de report_date, report_date]
        - PREV = [1er du mois précédent, même day-of-month du mois précédent]

        Pour chaque période et chaque TR_TYPE :
        SUBS = COUNT(DISTINCT MSISDN) sur la période (par TR_TYPE)
        VOLUME = COUNT(DISTINCT TRANSACTIONID)
        VALUE = SUM(ORIGINALAMOUNT)
        REVENUE = SUM(CHARGEAMOUNT)

        En plus des rows par TR_TYPE, la réponse contient `current_total` et `prev_total` :
        - SUBS_UNIQUE : COUNT(DISTINCT MSISDN) **cross TR_TYPE** sur la période
                        (= vrai nombre de subscribers uniques actifs, sans double-comptage
                        par TR_TYPE — utiliser ces valeurs pour les cartes KPI).
        - VOLUME / VALUE / REVENUE : somme cross-TR_TYPE (cohérent avec le Snapshot MTD,
                                      où P2P compte sur send + receive).
        """
        if not report_date:
            report_date = date.today() - timedelta(days=1)

        curr_start = self._first_of_month(report_date)
        curr_end   = report_date
        prev_end   = self._previous_mtd_end(report_date)
        prev_start = self._first_of_month(prev_end)

        # Fenêtre couvrant les deux MTD : du début du mois précédent à la date courante
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            prev_start, curr_end, msisdn_list, service_names, channels, departments
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        curr_start_str = curr_start.strftime('%Y-%m-%d')
        curr_end_str   = curr_end.strftime('%Y-%m-%d')
        prev_start_str = prev_start.strftime('%Y-%m-%d')
        prev_end_str   = prev_end.strftime('%Y-%m-%d')

        rows_query = f"""
        WITH base AS (
            {inner}
        ),
        filtered AS (
            SELECT *
            FROM base
            WHERE TR_TYPE IS NOT NULL {outer}
        )
        SELECT
            TR_TYPE,
            -- PREVIOUS MTD
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{prev_start_str}') AND to_date('{prev_end_str}')
                THEN MSISDN END) AS PREV_SUBS,
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{prev_start_str}') AND to_date('{prev_end_str}')
                THEN TRANSACTIONID END) AS PREV_VOLUME,
            COALESCE(SUM(CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{prev_start_str}') AND to_date('{prev_end_str}')
                THEN ORIGINALAMOUNT END), 0) AS PREV_VALUE,
            COALESCE(SUM(CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{prev_start_str}') AND to_date('{prev_end_str}')
                THEN CHARGEAMOUNT END), 0) AS PREV_REVENUE,
            -- CURRENT MTD
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{curr_start_str}') AND to_date('{curr_end_str}')
                THEN MSISDN END) AS CURR_SUBS,
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{curr_start_str}') AND to_date('{curr_end_str}')
                THEN TRANSACTIONID END) AS CURR_VOLUME,
            COALESCE(SUM(CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{curr_start_str}') AND to_date('{curr_end_str}')
                THEN ORIGINALAMOUNT END), 0) AS CURR_VALUE,
            COALESCE(SUM(CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{curr_start_str}') AND to_date('{curr_end_str}')
                THEN CHARGEAMOUNT END), 0) AS CURR_REVENUE
        FROM filtered
        GROUP BY TR_TYPE
        ORDER BY TR_TYPE
        """
        result = self.db.execute(text(rows_query))
        rows = [dict(r) for r in result.mappings()]

        # Totaux cross TR_TYPE : SUBS = unique MSISDN (sans double-comptage par TR_TYPE).
        # VOLUME / VALUE / REVENUE = somme cross-TR_TYPE (P2P compté sur send + receive).
        totals_query = f"""
        WITH base AS (
            {inner}
        ),
        filtered AS (
            SELECT *
            FROM base
            WHERE TR_TYPE IS NOT NULL {outer}
        )
        SELECT
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{prev_start_str}') AND to_date('{prev_end_str}')
                THEN MSISDN END) AS PREV_SUBS_UNIQUE,
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{curr_start_str}') AND to_date('{curr_end_str}')
                THEN MSISDN END) AS CURR_SUBS_UNIQUE
        FROM filtered
        """
        tot_row = next(iter(self.db.execute(text(totals_query)).mappings()), None) or {}

        # VOLUME / VALUE / REVENUE totals = somme des rows (cohérent avec le Snapshot MTD)
        prev_volume  = sum(int(r.get("PREV_VOLUME")  or 0) for r in rows)
        prev_value   = sum(float(r.get("PREV_VALUE")  or 0) for r in rows)
        prev_revenue = sum(float(r.get("PREV_REVENUE") or 0) for r in rows)
        curr_volume  = sum(int(r.get("CURR_VOLUME")  or 0) for r in rows)
        curr_value   = sum(float(r.get("CURR_VALUE")  or 0) for r in rows)
        curr_revenue = sum(float(r.get("CURR_REVENUE") or 0) for r in rows)

        return {
            "current_start": curr_start_str,
            "current_end":   curr_end_str,
            "prev_start":    prev_start_str,
            "prev_end":      prev_end_str,
            "rows": rows,
            "current_total": {
                "SUBS":    int(tot_row.get("CURR_SUBS_UNIQUE") or 0),
                "VOLUME":  curr_volume,
                "VALUE":   curr_value,
                "REVENUE": curr_revenue,
            },
            "prev_total": {
                "SUBS":    int(tot_row.get("PREV_SUBS_UNIQUE") or 0),
                "VOLUME":  prev_volume,
                "VALUE":   prev_value,
                "REVENUE": prev_revenue,
            },
        }

    def get_period_aggregates_by_dimension(
        self,
        start_date: date,
        end_date:   date,
        dimension:  str,
        service_names: Optional[List[str]] = None,
        msisdn_list:   Optional[List[str]] = None,
        channels:      Optional[List[str]] = None,
        departments:   Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Aggregats par dimension ('TR_TYPE' | 'CHANNEL' | 'DEPARTMENT') sur une plage
        arbitraire [start_date, end_date].

        Pour chaque valeur de la dimension :
        - SUBS    = COUNT(DISTINCT MSISDN) sur la FENÊTRE ENTIÈRE → vrai unique
                    (pas de double-comptage par jour).
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID)
        - VALUE   = SUM(ORIGINALAMOUNT) HTG
        - REVENUE = SUM(CHARGEAMOUNT)   HTG

        Filtres utilisateur (service_names, channels, departments) appliqués via
        _build_filters (mêmes règles que get_mtd_snapshot_by_type).
        """
        allowed_dims = {"TR_TYPE", "CHANNEL", "DEPARTMENT"}
        if dimension not in allowed_dims:
            raise ValueError(f"dimension must be one of {allowed_dims}, got {dimension!r}")

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_date, end_date, msisdn_list, service_names, channels, departments,
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        if dimension in ("TR_TYPE", "CHANNEL"):
            # Colonne déjà présente dans le base set du UNION
            dim_col = dimension
            query = f"""
            WITH base AS (
                {inner}
            ),
            filtered AS (
                SELECT *
                FROM base
                WHERE TR_TYPE IS NOT NULL {outer}
            )
            SELECT
                COALESCE({dim_col}, 'Unknown') AS DIM_VALUE,
                COUNT(DISTINCT MSISDN)                AS SUBS,
                COUNT(DISTINCT TRANSACTIONID)         AS VOLUME,
                COALESCE(SUM(ORIGINALAMOUNT), 0)      AS VALUE,
                COALESCE(SUM(CHARGEAMOUNT),  0)       AS REVENUE
            FROM filtered
            GROUP BY {dim_col}
            ORDER BY VALUE DESC
            """
        else:
            # DEPARTMENT → JOIN avec ht_location (snapshot d'hier) + sites
            query = f"""
            WITH base AS (
                {inner}
            ),
            filtered AS (
                SELECT *
                FROM base
                WHERE TR_TYPE IS NOT NULL {outer}
            ),
            location_data AS (
                SELECT MSISDN, DEPARTMENT FROM (
                    SELECT
                        LO.MSISDN,
                        SI.DEPARTMENT,
                        ROW_NUMBER() OVER (
                            PARTITION BY LO.MSISDN
                            ORDER BY SI.SITE_CODE, SI.SECTOR
                        ) AS loc_rn
                    FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                    INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                        ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                    WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                      AND LO.MSISDN IN (SELECT DISTINCT MSISDN FROM filtered)
                ) WHERE loc_rn = 1
            ),
            enriched AS (
                SELECT f.*, COALESCE(l.DEPARTMENT, 'Unknown') AS DEPARTMENT_VAL
                FROM filtered f
                LEFT JOIN location_data l ON f.MSISDN = l.MSISDN
            )
            SELECT
                DEPARTMENT_VAL                        AS DIM_VALUE,
                COUNT(DISTINCT MSISDN)                AS SUBS,
                COUNT(DISTINCT TRANSACTIONID)         AS VOLUME,
                COALESCE(SUM(ORIGINALAMOUNT), 0)      AS VALUE,
                COALESCE(SUM(CHARGEAMOUNT),  0)       AS REVENUE
            FROM enriched
            GROUP BY DEPARTMENT_VAL
            ORDER BY VALUE DESC
            """

        result = self.db.execute(text(query))
        return [dict(r) for r in result.mappings()]

    # ─── Snapshot WoW / MoM par dimension (DEPARTMENT | CHANNEL) ──────────────
    # Même esprit que get_snapshot_daily_by_type / get_mtd_snapshot_by_type, mais
    # GROUP BY DEPARTMENT ou CHANNEL au lieu de TR_TYPE.
    # Pour DEPARTMENT : JOIN avec ht_location (snapshot d'hier) + vw_dt_network_sites.
    # SUBS = COUNT(DISTINCT MSISDN) garanti par dimension et par période.

    def _build_dimension_cte(self, dimension: str, inner: str, outer: str) -> str:
        """Construit la CTE 'filtered' avec une colonne DIM_VALUE selon la dimension.
        - CHANNEL    : DIM_VALUE = CHANNEL (déjà présent dans base)
        - DEPARTMENT : DIM_VALUE = département via JOIN ht_location + vw_dt_network_sites
        """
        if dimension == "CHANNEL":
            return f"""
            WITH base AS (
                {inner}
            ),
            filtered AS (
                SELECT *,
                       COALESCE(CHANNEL, 'Unknown') AS DIM_VALUE
                FROM base
                WHERE TR_TYPE IS NOT NULL {outer}
            )
            """
        # DEPARTMENT
        return f"""
        WITH base AS (
            {inner}
        ),
        base_filtered AS (
            SELECT *
            FROM base
            WHERE TR_TYPE IS NOT NULL {outer}
        ),
        location_data AS (
            SELECT MSISDN, DEPARTMENT FROM (
                SELECT
                    LO.MSISDN,
                    SI.DEPARTMENT,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                  AND LO.MSISDN IN (SELECT DISTINCT MSISDN FROM base_filtered)
            ) WHERE loc_rn = 1
        ),
        filtered AS (
            SELECT b.*, COALESCE(l.DEPARTMENT, 'Unknown') AS DIM_VALUE
            FROM base_filtered b
            LEFT JOIN location_data l ON b.MSISDN = l.MSISDN
        )
        """

    def get_snapshot_daily_by_dimension(
        self,
        report_date: Optional[date] = None,
        dimension:   str = "DEPARTMENT",
        service_names: Optional[List[str]] = None,
        msisdn_list:   Optional[List[str]] = None,
        channels:      Optional[List[str]] = None,
        departments:   Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """WoW snapshot par DEPARTMENT ou CHANNEL.
        - PREV = report_date - 7 jours, CURR = report_date.
        - Métriques par DIM_VALUE : PREV/CURR pour SUBS, VOLUME, VALUE, REVENUE.
        """
        if dimension not in ("DEPARTMENT", "CHANNEL"):
            raise ValueError("dimension must be 'DEPARTMENT' or 'CHANNEL'")
        if not report_date:
            report_date = date.today() - timedelta(days=1)
        prev_date = report_date - timedelta(days=7)

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            prev_date, report_date, msisdn_list, service_names, channels, departments,
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        curr_str = report_date.strftime('%Y-%m-%d')
        prev_str = prev_date.strftime('%Y-%m-%d')

        cte = self._build_dimension_cte(dimension, inner, outer)
        query = f"""
        {cte}
        SELECT
            DIM_VALUE,
            COUNT(DISTINCT CASE WHEN TRANSACTION_DATE = to_date('{prev_str}') THEN MSISDN        END) AS PREV_SUBS,
            COUNT(DISTINCT CASE WHEN TRANSACTION_DATE = to_date('{prev_str}') THEN TRANSACTIONID END) AS PREV_VOLUME,
            COALESCE(SUM(CASE WHEN TRANSACTION_DATE = to_date('{prev_str}') THEN ORIGINALAMOUNT END), 0) AS PREV_VALUE,
            COALESCE(SUM(CASE WHEN TRANSACTION_DATE = to_date('{prev_str}') THEN CHARGEAMOUNT  END), 0) AS PREV_REVENUE,
            COUNT(DISTINCT CASE WHEN TRANSACTION_DATE = to_date('{curr_str}') THEN MSISDN        END) AS CURR_SUBS,
            COUNT(DISTINCT CASE WHEN TRANSACTION_DATE = to_date('{curr_str}') THEN TRANSACTIONID END) AS CURR_VOLUME,
            COALESCE(SUM(CASE WHEN TRANSACTION_DATE = to_date('{curr_str}') THEN ORIGINALAMOUNT END), 0) AS CURR_VALUE,
            COALESCE(SUM(CASE WHEN TRANSACTION_DATE = to_date('{curr_str}') THEN CHARGEAMOUNT  END), 0) AS CURR_REVENUE
        FROM filtered
        GROUP BY DIM_VALUE
        ORDER BY CURR_VALUE DESC
        """
        rows = [dict(r) for r in self.db.execute(text(query)).mappings()]
        return {
            "current_date": curr_str,
            "prev_date":    prev_str,
            "dimension":    dimension,
            "rows":         rows,
        }

    def get_mtd_snapshot_by_dimension(
        self,
        report_date: Optional[date] = None,
        dimension:   str = "DEPARTMENT",
        service_names: Optional[List[str]] = None,
        msisdn_list:   Optional[List[str]] = None,
        channels:      Optional[List[str]] = None,
        departments:   Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """MoM snapshot par DEPARTMENT ou CHANNEL.
        - CURR = [1er du mois, report_date]
        - PREV = [1er du mois précédent, même day-of-month]
        """
        if dimension not in ("DEPARTMENT", "CHANNEL"):
            raise ValueError("dimension must be 'DEPARTMENT' or 'CHANNEL'")
        if not report_date:
            report_date = date.today() - timedelta(days=1)

        curr_start = self._first_of_month(report_date)
        curr_end   = report_date
        prev_end   = self._previous_mtd_end(report_date)
        prev_start = self._first_of_month(prev_end)

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            prev_start, curr_end, msisdn_list, service_names, channels, departments,
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        curr_start_str = curr_start.strftime('%Y-%m-%d')
        curr_end_str   = curr_end.strftime('%Y-%m-%d')
        prev_start_str = prev_start.strftime('%Y-%m-%d')
        prev_end_str   = prev_end.strftime('%Y-%m-%d')

        cte = self._build_dimension_cte(dimension, inner, outer)
        query = f"""
        {cte}
        SELECT
            DIM_VALUE,
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{prev_start_str}') AND to_date('{prev_end_str}')
                THEN MSISDN END) AS PREV_SUBS,
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{prev_start_str}') AND to_date('{prev_end_str}')
                THEN TRANSACTIONID END) AS PREV_VOLUME,
            COALESCE(SUM(CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{prev_start_str}') AND to_date('{prev_end_str}')
                THEN ORIGINALAMOUNT END), 0) AS PREV_VALUE,
            COALESCE(SUM(CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{prev_start_str}') AND to_date('{prev_end_str}')
                THEN CHARGEAMOUNT END), 0) AS PREV_REVENUE,
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{curr_start_str}') AND to_date('{curr_end_str}')
                THEN MSISDN END) AS CURR_SUBS,
            COUNT(DISTINCT CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{curr_start_str}') AND to_date('{curr_end_str}')
                THEN TRANSACTIONID END) AS CURR_VOLUME,
            COALESCE(SUM(CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{curr_start_str}') AND to_date('{curr_end_str}')
                THEN ORIGINALAMOUNT END), 0) AS CURR_VALUE,
            COALESCE(SUM(CASE
                WHEN TRANSACTION_DATE BETWEEN to_date('{curr_start_str}') AND to_date('{curr_end_str}')
                THEN CHARGEAMOUNT END), 0) AS CURR_REVENUE
        FROM filtered
        GROUP BY DIM_VALUE
        ORDER BY CURR_VALUE DESC
        """
        rows = [dict(r) for r in self.db.execute(text(query)).mappings()]
        return {
            "current_start": curr_start_str,
            "current_end":   curr_end_str,
            "prev_start":    prev_start_str,
            "prev_end":      prev_end_str,
            "dimension":     dimension,
            "rows":          rows,
        }

    def get_monthly_totals(
        self,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        day_of_month: Optional[int] = None,
        departments: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Pour chaque MONTH (YYYY-MM) dans [start_month, end_month], totaux clean :
        - SUBS    = COUNT(DISTINCT MSISDN) du mois (pas de double-comptage cross TR_TYPE)
        - VOLUME  = Σ over TR_TYPE de COUNT(DISTINCT TRANSACTIONID) — somme cross-types
        - VALUE   = Σ over TR_TYPE de SUM(ORIGINALAMOUNT) — somme cross-types
        - REVENUE = Σ over TR_TYPE de SUM(CHARGEAMOUNT)   — somme cross-types

        Filtres optionnels :
        - service_names : liste de TR_TYPE
        - departments   : liste de DEPARTMENT (network location)
        - day_of_month  : borne chaque mois à [1er, day_of_month] pour comparaisons MTD
        """
        today = date.today()
        if not end_month:
            end_month = self._first_of_month(today)
        else:
            end_month = self._first_of_month(end_month)
        if not start_month:
            y, m = end_month.year, end_month.month - 5
            while m <= 0:
                m += 12; y -= 1
            start_month = date(y, m, 1)
        else:
            start_month = self._first_of_month(start_month)

        if end_month.month == 12:
            next_first = date(end_month.year + 1, 1, 1)
        else:
            next_first = date(end_month.year, end_month.month + 1, 1)
        last_day_of_end = next_first - timedelta(days=1)
        yesterday = today - timedelta(days=1)
        end_date = min(last_day_of_end, yesterday)

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_month, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        day_filter = ""
        if day_of_month is not None and 1 <= day_of_month <= 31:
            day_filter = f"AND DAY(src.TRANSACTION_DATE) <= {day_of_month}"

        # Optional DEPARTMENT filter — JOIN avec location_data si nécessaire
        dept_join = ""
        dept_filter = ""
        if departments:
            cleaned = [d.strip() for d in departments if d and d.strip()]
            import re as _re
            safe_list: List[str] = []
            for d in cleaned:
                safe_d = _re.sub(r"[^\w\s\-'À-ſ]", "", d).replace("'", "''").strip()
                if safe_d:
                    safe_list.append(safe_d)
            if safe_list:
                dept_in = "', '".join(safe_list)
                dept_join = """
        LEFT JOIN (
            SELECT MSISDN, DEPARTMENT FROM (
                SELECT
                    LO.MSISDN,
                    SI.DEPARTMENT,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
            ) WHERE loc_rn = 1
        ) loc ON src.MSISDN = loc.MSISDN
        """
                dept_filter = f"AND COALESCE(loc.DEPARTMENT, 'Unknown') IN ('{dept_in}')"

        query = f"""
        WITH base AS (
            SELECT src.*
            FROM ({inner}) src
            {dept_join}
            WHERE src.TR_TYPE IS NOT NULL {outer} {day_filter} {dept_filter}
        ),
        per_type_per_month AS (
            SELECT
                date_format(TRANSACTION_DATE, 'yyyy-MM') AS MONTH,
                TR_TYPE,
                COUNT(DISTINCT TRANSACTIONID)    AS V,
                COALESCE(SUM(ORIGINALAMOUNT), 0) AS VA,
                COALESCE(SUM(CHARGEAMOUNT),  0)  AS R
            FROM base
            GROUP BY date_format(TRANSACTION_DATE, 'yyyy-MM'), TR_TYPE
        ),
        totals_per_month AS (
            SELECT
                MONTH,
                SUM(V)  AS VOLUME,
                SUM(VA) AS VALUE,
                SUM(R)  AS REVENUE
            FROM per_type_per_month
            GROUP BY MONTH
        ),
        subs_per_month AS (
            SELECT
                date_format(TRANSACTION_DATE, 'yyyy-MM') AS MONTH,
                COUNT(DISTINCT MSISDN) AS SUBS
            FROM base
            GROUP BY date_format(TRANSACTION_DATE, 'yyyy-MM')
        )
        SELECT
            t.MONTH,
            COALESCE(s.SUBS, 0) AS SUBS,
            t.VOLUME,
            t.VALUE,
            t.REVENUE
        FROM totals_per_month t
        LEFT JOIN subs_per_month s ON s.MONTH = t.MONTH
        ORDER BY t.MONTH
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_mtd_stats_by_month_and_type(
        self,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        day_of_month: Optional[int] = None,
        departments: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Pour chaque mois dans [start_month, end_month], et pour chaque TR_TYPE :
        - SUBS    = COUNT(DISTINCT MSISDN) du mois
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID) du mois
        - VALUE   = SUM(ORIGINALAMOUNT) du mois
        - REVENUE = SUM(CHARGEAMOUNT) du mois

        Si end_month est le mois courant : borne sur yesterday (sinon dernier jour du mois).
        Si day_of_month (1..31) est fourni, on borne chaque mois à [1er, day_of_month]
        (utile pour comparer MTD à mi-mois : ex. "15ème jour de chaque mois").
        start_month et end_month sont normalisés au 1er du mois.
        """
        today = date.today()
        if not end_month:
            # défaut : mois courant
            end_month = self._first_of_month(today)
        else:
            end_month = self._first_of_month(end_month)
        if not start_month:
            # défaut : 6 mois en arrière
            y, m = end_month.year, end_month.month - 5
            while m <= 0:
                m += 12; y -= 1
            start_month = date(y, m, 1)
        else:
            start_month = self._first_of_month(start_month)

        # borne basse = 1er du start_month
        # borne haute = dernier jour de end_month OU yesterday si end_month est le mois courant
        if end_month.month == 12:
            next_first = date(end_month.year + 1, 1, 1)
        else:
            next_first = date(end_month.year, end_month.month + 1, 1)
        last_day_of_end = next_first - timedelta(days=1)
        yesterday = today - timedelta(days=1)
        end_date = min(last_day_of_end, yesterday)

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_month, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        day_filter = ""
        if day_of_month is not None and 1 <= day_of_month <= 31:
            day_filter = f"AND DAY(TRANSACTION_DATE) <= {day_of_month}"

        # Optional DEPARTMENT filter — JOIN avec location_data si nécessaire
        dept_join = ""
        dept_filter = ""
        if departments:
            cleaned = [d.strip() for d in departments if d and d.strip()]
            import re as _re
            safe_list: List[str] = []
            for d in cleaned:
                safe_d = _re.sub(r"[^\w\s\-'À-ſ]", "", d).replace("'", "''").strip()
                if safe_d:
                    safe_list.append(safe_d)
            if safe_list:
                dept_in = "', '".join(safe_list)
                dept_join = """
        LEFT JOIN (
            SELECT MSISDN, DEPARTMENT FROM (
                SELECT
                    LO.MSISDN,
                    SI.DEPARTMENT,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
            ) WHERE loc_rn = 1
        ) loc ON src.MSISDN = loc.MSISDN
        """
                dept_filter = f"AND COALESCE(loc.DEPARTMENT, 'Unknown') IN ('{dept_in}')"

        query = f"""
        WITH base AS (
            {inner}
        ),
        filtered AS (
            SELECT
                date_format(src.TRANSACTION_DATE, 'yyyy-MM') AS MONTH,
                src.TR_TYPE,
                src.TRANSACTIONID,
                src.MSISDN,
                src.ORIGINALAMOUNT,
                src.CHARGEAMOUNT
            FROM base src
            {dept_join}
            WHERE src.TR_TYPE IS NOT NULL {outer} {day_filter} {dept_filter}
        )
        SELECT
            MONTH,
            TR_TYPE,
            COUNT(DISTINCT TRANSACTIONID)    AS VOLUME,
            COUNT(DISTINCT MSISDN)           AS SUBS,
            COALESCE(SUM(ORIGINALAMOUNT), 0) AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),  0) AS REVENUE
        FROM filtered
        GROUP BY MONTH, TR_TYPE
        ORDER BY MONTH DESC, VALUE DESC
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_mtd_stats_by_month_and_department(
        self,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        day_of_month: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Pour chaque mois dans [start_month, end_month], et pour chaque DEPARTMENT :
        - SUBS    = COUNT(DISTINCT MSISDN) du mois
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID) du mois
        - VALUE   = SUM(ORIGINALAMOUNT) du mois
        - REVENUE = SUM(CHARGEAMOUNT) du mois

        DEPARTMENT vient du JOIN ht_location × vw_dt_network_sites (snapshot d'hier).
        Si day_of_month (1..31) est fourni, on borne chaque mois à [1er, day_of_month].
        """
        today = date.today()
        if not end_month:
            end_month = self._first_of_month(today)
        else:
            end_month = self._first_of_month(end_month)
        if not start_month:
            y, m = end_month.year, end_month.month - 5
            while m <= 0:
                m += 12; y -= 1
            start_month = date(y, m, 1)
        else:
            start_month = self._first_of_month(start_month)

        if end_month.month == 12:
            next_first = date(end_month.year + 1, 1, 1)
        else:
            next_first = date(end_month.year, end_month.month + 1, 1)
        last_day_of_end = next_first - timedelta(days=1)
        yesterday = today - timedelta(days=1)
        end_date = min(last_day_of_end, yesterday)

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_month, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        day_filter = ""
        if day_of_month is not None and 1 <= day_of_month <= 31:
            day_filter = f"AND DAY(TRANSACTION_DATE) <= {day_of_month}"

        query = f"""
        WITH base AS (
            {inner}
        ),
        base_filtered AS (
            SELECT *
            FROM base
            WHERE TR_TYPE IS NOT NULL {outer} {day_filter}
        ),
        location_data AS (
            SELECT MSISDN, DEPARTMENT FROM (
                SELECT
                    LO.MSISDN,
                    SI.DEPARTMENT,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                  AND LO.MSISDN IN (SELECT DISTINCT MSISDN FROM base_filtered)
            ) WHERE loc_rn = 1
        ),
        enriched AS (
            SELECT
                date_format(b.TRANSACTION_DATE, 'yyyy-MM') AS MONTH,
                COALESCE(l.DEPARTMENT, 'Unknown')          AS DEPARTMENT,
                b.TRANSACTIONID,
                b.MSISDN,
                b.ORIGINALAMOUNT,
                b.CHARGEAMOUNT
            FROM base_filtered b
            LEFT JOIN location_data l ON b.MSISDN = l.MSISDN
        )
        SELECT
            MONTH,
            DEPARTMENT,
            COUNT(DISTINCT TRANSACTIONID)    AS VOLUME,
            COUNT(DISTINCT MSISDN)           AS SUBS,
            COALESCE(SUM(ORIGINALAMOUNT), 0) AS VALUE,
            COALESCE(SUM(CHARGEAMOUNT),  0) AS REVENUE
        FROM enriched
        GROUP BY MONTH, DEPARTMENT
        ORDER BY MONTH DESC, VALUE DESC
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_mtd_stats_by_month_and_channel(
        self,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        day_of_month: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Pour chaque mois dans [start_month, end_month], et pour chaque CHANNEL :
        - VOLUME  = COUNT(DISTINCT TRANSACTIONID) du mois pour ce CHANNEL
        - VALUE   = SUM(ORIGINALAMOUNT)           du mois pour ce CHANNEL
        - REVENUE = SUM(CHARGEAMOUNT)             du mois pour ce CHANNEL
        - SUBS    = COUNT(DISTINCT MSISDN) du mois pour ce CHANNEL **avec attribution
                    par canal primaire** : chaque MSISDN n'est comptée que sur SON canal
                    primaire du mois (= celui où elle a le plus de transactions, tie-break
                    alphabétique sur CHANNEL). Garantit que Σ SUBS(channel) ≈ SUBS_total
                    pour un mois donné.

        Si day_of_month (1..31) est fourni, on borne chaque mois à [1er, day_of_month].
        CHANNEL NULL ou vide → 'Unknown'.
        """
        today = date.today()
        if not end_month:
            end_month = self._first_of_month(today)
        else:
            end_month = self._first_of_month(end_month)
        if not start_month:
            y, m = end_month.year, end_month.month - 5
            while m <= 0:
                m += 12; y -= 1
            start_month = date(y, m, 1)
        else:
            start_month = self._first_of_month(start_month)

        if end_month.month == 12:
            next_first = date(end_month.year + 1, 1, 1)
        else:
            next_first = date(end_month.year, end_month.month + 1, 1)
        last_day_of_end = next_first - timedelta(days=1)
        yesterday = today - timedelta(days=1)
        end_date = min(last_day_of_end, yesterday)

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_month, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        day_filter = ""
        if day_of_month is not None and 1 <= day_of_month <= 31:
            day_filter = f"AND DAY(TRANSACTION_DATE) <= {day_of_month}"

        query = f"""
        WITH base AS (
            {inner}
        ),
        normalized AS (
            SELECT
                date_format(TRANSACTION_DATE, 'yyyy-MM') AS MONTH,
                CASE WHEN CHANNEL IS NULL OR TRIM(CHANNEL) = '' THEN 'Unknown' ELSE CHANNEL END AS CHANNEL,
                TRANSACTIONID,
                MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT
            FROM base
            WHERE TR_TYPE IS NOT NULL {outer} {day_filter}
        ),
        msisdn_channel_counts AS (
            SELECT
                MSISDN, MONTH, CHANNEL,
                COUNT(DISTINCT TRANSACTIONID) AS tx_count
            FROM normalized
            GROUP BY MSISDN, MONTH, CHANNEL
        ),
        primary_channel AS (
            SELECT MSISDN, MONTH, CHANNEL FROM (
                SELECT
                    MSISDN, MONTH, CHANNEL,
                    ROW_NUMBER() OVER (
                        PARTITION BY MSISDN, MONTH
                        ORDER BY tx_count DESC, CHANNEL ASC
                    ) AS rn
                FROM msisdn_channel_counts
            ) WHERE rn = 1
        ),
        subs_per_month_channel AS (
            SELECT MONTH, CHANNEL, COUNT(DISTINCT MSISDN) AS SUBS
            FROM primary_channel
            GROUP BY MONTH, CHANNEL
        ),
        metrics_per_month_channel AS (
            SELECT
                MONTH, CHANNEL,
                COUNT(DISTINCT TRANSACTIONID)    AS VOLUME,
                COALESCE(SUM(ORIGINALAMOUNT), 0) AS VALUE,
                COALESCE(SUM(CHARGEAMOUNT),  0)  AS REVENUE
            FROM normalized
            GROUP BY MONTH, CHANNEL
        )
        SELECT
            m.MONTH,
            m.CHANNEL,
            m.VOLUME,
            COALESCE(s.SUBS, 0) AS SUBS,
            m.VALUE,
            m.REVENUE
        FROM metrics_per_month_channel m
        LEFT JOIN subs_per_month_channel s
            ON s.MONTH = m.MONTH AND s.CHANNEL = m.CHANNEL
        ORDER BY m.MONTH DESC, m.VALUE DESC
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_snapshot_daily_by_type(
        self,
        report_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Week-on-week snapshot pour chaque TR_TYPE :
        - PREV = report_date - 7 jours
        - CURR = report_date
        Métriques renvoyées par TR_TYPE :
        - PREV_SUBS / CURR_SUBS         (COUNT DISTINCT MSISDN)
        - PREV_VOLUME / CURR_VOLUME     (COUNT DISTINCT TRANSACTIONID)
        - PREV_VALUE / CURR_VALUE       (SUM ORIGINALAMOUNT)
        - PREV_REVENUE / CURR_REVENUE   (SUM CHARGEAMOUNT)
        """
        if not report_date:
            report_date = date.today() - timedelta(days=1)
        prev_date = report_date - timedelta(days=7)

        # On fenêtre la requête sur la plage [prev, current] inclus
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            prev_date, report_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        curr_str = report_date.strftime('%Y-%m-%d')
        prev_str = prev_date.strftime('%Y-%m-%d')

        query = f"""
        WITH base AS (
            {inner}
        ),
        filtered AS (
            SELECT *
            FROM base
            WHERE TR_TYPE IS NOT NULL {outer}
        )
        SELECT
            TR_TYPE,
            -- previous day (J-7)
            COUNT(DISTINCT CASE WHEN TRANSACTION_DATE = to_date('{prev_str}') THEN MSISDN        END) AS PREV_SUBS,
            COUNT(DISTINCT CASE WHEN TRANSACTION_DATE = to_date('{prev_str}') THEN TRANSACTIONID END) AS PREV_VOLUME,
            COALESCE(SUM(CASE WHEN TRANSACTION_DATE = to_date('{prev_str}') THEN ORIGINALAMOUNT END), 0) AS PREV_VALUE,
            COALESCE(SUM(CASE WHEN TRANSACTION_DATE = to_date('{prev_str}') THEN CHARGEAMOUNT  END), 0) AS PREV_REVENUE,
            -- current day
            COUNT(DISTINCT CASE WHEN TRANSACTION_DATE = to_date('{curr_str}') THEN MSISDN        END) AS CURR_SUBS,
            COUNT(DISTINCT CASE WHEN TRANSACTION_DATE = to_date('{curr_str}') THEN TRANSACTIONID END) AS CURR_VOLUME,
            COALESCE(SUM(CASE WHEN TRANSACTION_DATE = to_date('{curr_str}') THEN ORIGINALAMOUNT END), 0) AS CURR_VALUE,
            COALESCE(SUM(CASE WHEN TRANSACTION_DATE = to_date('{curr_str}') THEN CHARGEAMOUNT  END), 0) AS CURR_REVENUE
        FROM filtered
        GROUP BY TR_TYPE
        ORDER BY TR_TYPE
        """
        result = self.db.execute(text(query))
        rows = [dict(r) for r in result.mappings()]
        return {
            "current_date": curr_str,
            "prev_date": prev_str,
            "rows": rows,
        }

    def get_churn(
        self,
        start_date: Optional[date] = None,
        period_days: int = 30,
        return_list: bool = False,
        limit: int = 100,
    ) -> Dict[str, Any]:
        """
        Compute churn for a given period (logique du script Databricks de référence):
        - **baseline window** : [start_date - (N+30), start_date - (N+1)] = TOUJOURS 30 jours d'activité
        - **recent window**   : [start_date - N, start_date]             = N jours d'inactivité requise

        Exemples avec J = start_date :
        - CHURN 30 → baseline = [J-60, J-31], recent = [J-30, J]
        - CHURN 60 → baseline = [J-90, J-61], recent = [J-60, J]
        - CHURN 90 → baseline = [J-120, J-91], recent = [J-90, J]

        Churn = MSISDN actifs en baseline (30j) MAIS inactifs en recent (N j).

        Optimisations :
        - UN SEUL scan de mfs_transaction_aml sur la fenêtre globale [baseline_start, recent_end]
        - Extraction MSISDN credit OU debit via CASE WHEN dans le même scan
        - GROUP BY MSISDN + HAVING (somme conditionnelle) calcule baseline/recent en un seul passage
        - PROCESS_DATE comparé comme string yyyyMMdd → partition pruning Spark
        - Comptage en Python (len) pour éviter le bug pandas du driver databricks-sql-connector
        """
        if not start_date:
            start_date = date.today() - timedelta(days=1)
        if period_days not in (30, 60, 90):
            period_days = 30

        N = period_days
        # baseline = 30 jours FIXES, finissant à J-(N+1)
        baseline_start = start_date - timedelta(days=N + 30)
        baseline_end   = start_date - timedelta(days=N + 1)
        # recent = N jours, finissant à J
        recent_start   = start_date - timedelta(days=N)
        recent_end     = start_date

        bs = baseline_start.strftime('%Y%m%d')
        be = baseline_end.strftime('%Y%m%d')
        rs = recent_start.strftime('%Y%m%d')
        re_ = recent_end.strftime('%Y%m%d')

        credit_services = (
            "'Cash In','P2P Transfer','Send Money to Registered Customer by QR Code',"
            "'Cash In OTC','OD Money Transfer Prefunded','IMT revceiving',"
            "'Money Transfer Prefunded','Bulk B2C transfer'"
        )
        debit_services = (
            "'Cash Out','Merchant Cashout','Customer Bill Payment','Agent/Merchant Bill Payment',"
            "'Merchant Payment to Merchant','Merchant Payment','Merchant QR Payment','Merchant Till payment',"
            "'Merchant to Merchant Payment via Till ID','Merchant Online Payment','P2P Transfer',"
            "'Send Money to Registered Customer by QR Code','Prepaid Top up','Gift Top up','OTC Top Up','Wallet to Bank'"
        )

        # Reproduction EXACTE du script Databricks de référence :
        #   baseline_set = UNION(credit_party, debit_party) sur baseline window
        #   recent_set   = UNION(credit_party, debit_party) sur recent window
        #   churners     = baseline_set EXCEPT recent_set
        #
        # Capture le SENDER et le RECEIVER pour les transactions où les deux sont
        # Customer (ex: P2P Transfer) — c'est essentiel pour matcher les résultats
        # du script Databricks.
        #
        # Optimisations vs script brut :
        #  - PROCESS_DATE comparé comme STRING yyyyMMdd → partition pruning Spark
        #  - UNION ALL + DISTINCT externe au lieu de UNION (évite un shuffle DISTINCT
        #    intermédiaire — l'EXCEPT final fait déjà un DISTINCT)
        def active_set(start_yyyymmdd: str, end_yyyymmdd: str) -> str:
            return f"""
            SELECT MSISDN FROM (
                SELECT CREDITPARTYIDENTIFIER AS MSISDN
                FROM hive_metastore.ods_dl.mfs_transaction_aml
                WHERE PROCESS_DATE >= '{start_yyyymmdd}' AND PROCESS_DATE <= '{end_yyyymmdd}'
                  AND TRANSACTIONSTATUS = 'Completed'
                  AND SERVICENAME IN ({credit_services})
                  AND ORIGINALAMOUNT IS NOT NULL
                  AND CREDITPARTYTYPE = 'Customer'
                  AND CREDITPARTYIDENTIFIER LIKE '509%'
                UNION ALL
                SELECT DEBITPARTYIDENTIFIER AS MSISDN
                FROM hive_metastore.ods_dl.mfs_transaction_aml
                WHERE PROCESS_DATE >= '{start_yyyymmdd}' AND PROCESS_DATE <= '{end_yyyymmdd}'
                  AND TRANSACTIONSTATUS = 'Completed'
                  AND SERVICENAME IN ({debit_services})
                  AND ORIGINALAMOUNT IS NOT NULL
                  AND DEBITPARTYTYPE = 'Customer'
                  AND DEBITPARTYIDENTIFIER LIKE '509%'
            ) AS u
            WHERE MSISDN IS NOT NULL
            """

        baseline_set = active_set(bs, be)
        recent_set   = active_set(rs, re_)

        # EXCEPT (équivalent Spark de MINUS Oracle) : déduplique implicitement et
        # gère NULL correctement (contrairement à NOT IN).
        churners_query = f"""
        SELECT MSISDN FROM ({baseline_set}) AS baseline_q
        EXCEPT
        SELECT MSISDN FROM ({recent_set})   AS recent_q
        """

        # On itère via tuples (r[0]) — pas de .mappings() qui peut déclencher
        # la conversion pandas problématique du driver databricks-sql-connector.
        all_msisdns: List[str] = []
        result = self.db.execute(text(churners_query))
        for r in result:
            v = r[0] if r else None
            if v is not None:
                all_msisdns.append(str(v))

        total_count = len(all_msisdns)

        print(f"[CHURN] period={N}d start_date={start_date} → total={total_count} "
              f"baseline=[{baseline_start}, {baseline_end}] recent=[{recent_start}, {recent_end}]")

        returned_list: List[str] = []
        if return_list:
            all_msisdns.sort()
            returned_list = all_msisdns[:limit] if (limit and limit > 0) else all_msisdns

        return {
            "period_days": N,
            "start_date": start_date.strftime('%Y-%m-%d'),
            "baseline_window": [baseline_start.strftime('%Y-%m-%d'), baseline_end.strftime('%Y-%m-%d')],
            "recent_window":   [recent_start.strftime('%Y-%m-%d'),   recent_end.strftime('%Y-%m-%d')],
            "churn_count": total_count,
            "msisdns": returned_list,
        }

    # ============================================================
    # BANK ↔ WALLET (B2W via 'OD Money Transfer Prefunded', W2B via 'Wallet to Bank')
    # ============================================================
    # IDs des organisations bancaires côté DEBIT pour B2W et côté CREDIT pour W2B
    B2W_BANK_DEBIT_IDS = ["140958", "07421468", "103020"]
    W2B_BANK_CREDIT_IDS = ["900001", "900002", "900003"]

    def _bank_wallet_union_sql(self, start_yyyymmdd: str, end_yyyymmdd: str) -> str:
        """
        Renvoie un sous-SQL unifié (UNION ALL) avec colonnes :
          PROCESS_DATE, BANK_NAME, TRANSACTION_TYPE, PARTY_IDENTIFIER,
          ORIGINALAMOUNT, CHARGEAMOUNT, TRANSACTIONID
        sur la fenêtre [start, end] (PROCESS_DATE en string yyyyMMdd → partition pruning).
        """
        b2w_ids = "','".join(self.B2W_BANK_DEBIT_IDS)
        w2b_ids = "','".join(self.W2B_BANK_CREDIT_IDS)
        return f"""
        SELECT DISTINCT
            PROCESS_DATE,
            TRIM(DEBITPARTYNAME) AS BANK_NAME,
            'BANK TO WALLET'     AS TRANSACTION_TYPE,
            CREDITPARTYIDENTIFIER AS PARTY_IDENTIFIER,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            TRANSACTIONID
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        WHERE PROCESS_DATE >= '{start_yyyymmdd}' AND PROCESS_DATE <= '{end_yyyymmdd}'
          AND TRANSACTIONSTATUS IN ('Success', 'Completed')
          AND DEBITPARTYIDENTIFIER IN ('{b2w_ids}')
          AND DEBITPARTYTYPE = 'Organization'
          AND CREDITPARTYTYPE = 'Customer'
          AND SERVICENAME = 'OD Money Transfer Prefunded'

        UNION ALL

        SELECT DISTINCT
            PROCESS_DATE,
            TRIM(REPLACE(CREDITPARTYNAME, 'SA', '')) AS BANK_NAME,
            'WALLET TO BANK'     AS TRANSACTION_TYPE,
            DEBITPARTYIDENTIFIER AS PARTY_IDENTIFIER,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            TRANSACTIONID
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        WHERE PROCESS_DATE >= '{start_yyyymmdd}' AND PROCESS_DATE <= '{end_yyyymmdd}'
          AND TRANSACTIONSTATUS IN ('Success', 'Completed')
          AND ORIGINALAMOUNT IS NOT NULL
          AND CREDITPARTYIDENTIFIER IN ('{w2b_ids}')
          AND CREDITPARTYTYPE = 'Organization'
          AND DEBITPARTYTYPE = 'Customer'
          AND SERVICENAME = 'Wallet to Bank'
        """

    def get_bank_wallet_snapshot_daily(
        self,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        Snapshot WoW Bank↔Wallet par (BANK_NAME, TRANSACTION_TYPE) :
        - CURR = report_date (défaut: yesterday)
        - PREV = report_date - 7 jours
        Métriques : SUBS, VOLUME, VALUE, REVENUE.
        """
        if not report_date:
            report_date = date.today() - timedelta(days=1)
        prev_date = report_date - timedelta(days=7)

        curr_ymd = report_date.strftime('%Y%m%d')
        prev_ymd = prev_date.strftime('%Y%m%d')

        # Fenêtre = juste les 2 jours (partition pruning maximal)
        # On utilise un IN explicite pour ne lire que 2 partitions
        b2w_ids = "','".join(self.B2W_BANK_DEBIT_IDS)
        w2b_ids = "','".join(self.W2B_BANK_CREDIT_IDS)

        unified = f"""
        SELECT DISTINCT
            PROCESS_DATE,
            TRIM(DEBITPARTYNAME) AS BANK_NAME,
            'BANK TO WALLET'     AS TRANSACTION_TYPE,
            CREDITPARTYIDENTIFIER AS PARTY_IDENTIFIER,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            TRANSACTIONID
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        WHERE PROCESS_DATE IN ('{prev_ymd}', '{curr_ymd}')
          AND TRANSACTIONSTATUS IN ('Success', 'Completed')
          AND DEBITPARTYIDENTIFIER IN ('{b2w_ids}')
          AND DEBITPARTYTYPE = 'Organization'
          AND CREDITPARTYTYPE = 'Customer'
          AND SERVICENAME = 'OD Money Transfer Prefunded'

        UNION ALL

        SELECT DISTINCT
            PROCESS_DATE,
            TRIM(REPLACE(CREDITPARTYNAME, 'SA', '')) AS BANK_NAME,
            'WALLET TO BANK'     AS TRANSACTION_TYPE,
            DEBITPARTYIDENTIFIER AS PARTY_IDENTIFIER,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            TRANSACTIONID
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        WHERE PROCESS_DATE IN ('{prev_ymd}', '{curr_ymd}')
          AND TRANSACTIONSTATUS IN ('Success', 'Completed')
          AND ORIGINALAMOUNT IS NOT NULL
          AND CREDITPARTYIDENTIFIER IN ('{w2b_ids}')
          AND CREDITPARTYTYPE = 'Organization'
          AND DEBITPARTYTYPE = 'Customer'
          AND SERVICENAME = 'Wallet to Bank'
        """

        query = f"""
        SELECT
            BANK_NAME,
            TRANSACTION_TYPE,
            COUNT(DISTINCT CASE WHEN PROCESS_DATE = '{prev_ymd}' THEN PARTY_IDENTIFIER END) AS PREV_SUBS,
            COUNT(DISTINCT CASE WHEN PROCESS_DATE = '{curr_ymd}' THEN PARTY_IDENTIFIER END) AS CURR_SUBS,
            COUNT(CASE WHEN PROCESS_DATE = '{prev_ymd}' THEN TRANSACTIONID END) AS PREV_VOLUME,
            COUNT(CASE WHEN PROCESS_DATE = '{curr_ymd}' THEN TRANSACTIONID END) AS CURR_VOLUME,
            COALESCE(SUM(CASE WHEN PROCESS_DATE = '{prev_ymd}' THEN ORIGINALAMOUNT END), 0) AS PREV_VALUE,
            COALESCE(SUM(CASE WHEN PROCESS_DATE = '{curr_ymd}' THEN ORIGINALAMOUNT END), 0) AS CURR_VALUE,
            COALESCE(SUM(CASE WHEN PROCESS_DATE = '{prev_ymd}' THEN CHARGEAMOUNT  END), 0) AS PREV_REVENUE,
            COALESCE(SUM(CASE WHEN PROCESS_DATE = '{curr_ymd}' THEN CHARGEAMOUNT  END), 0) AS CURR_REVENUE
        FROM ({unified}) AS unified_q
        WHERE BANK_NAME IS NOT NULL AND TRIM(BANK_NAME) <> ''
        GROUP BY BANK_NAME, TRANSACTION_TYPE
        ORDER BY BANK_NAME, TRANSACTION_TYPE
        """
        result = self.db.execute(text(query))
        rows = [dict(r) for r in result.mappings()]
        return {
            "current_date": report_date.strftime('%Y-%m-%d'),
            "prev_date":    prev_date.strftime('%Y-%m-%d'),
            "rows": rows,
        }

    def get_bank_wallet_snapshot_mtd(
        self,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        Snapshot MoM (MTD) Bank↔Wallet par (BANK_NAME, TRANSACTION_TYPE) :
        - CURR = [1er du mois de report_date, report_date]
        - PREV = [1er du mois précédent, même day-of-month du mois précédent]
        Métriques : SUBS, VOLUME, VALUE, REVENUE.
        """
        if not report_date:
            report_date = date.today() - timedelta(days=1)

        curr_start = self._first_of_month(report_date)
        curr_end   = report_date
        prev_end   = self._previous_mtd_end(report_date)
        prev_start = self._first_of_month(prev_end)

        # Fenêtre globale = du début du mois précédent à report_date
        start_ymd = prev_start.strftime('%Y%m%d')
        end_ymd   = report_date.strftime('%Y%m%d')

        curr_start_ymd = curr_start.strftime('%Y%m%d')
        curr_end_ymd   = curr_end.strftime('%Y%m%d')
        prev_start_ymd = prev_start.strftime('%Y%m%d')
        prev_end_ymd   = prev_end.strftime('%Y%m%d')

        unified = self._bank_wallet_union_sql(start_ymd, end_ymd)

        query = f"""
        SELECT
            BANK_NAME,
            TRANSACTION_TYPE,
            COUNT(DISTINCT CASE
                WHEN PROCESS_DATE >= '{prev_start_ymd}' AND PROCESS_DATE <= '{prev_end_ymd}'
                THEN PARTY_IDENTIFIER END) AS PREV_SUBS,
            COUNT(DISTINCT CASE
                WHEN PROCESS_DATE >= '{curr_start_ymd}' AND PROCESS_DATE <= '{curr_end_ymd}'
                THEN PARTY_IDENTIFIER END) AS CURR_SUBS,
            COUNT(CASE
                WHEN PROCESS_DATE >= '{prev_start_ymd}' AND PROCESS_DATE <= '{prev_end_ymd}'
                THEN TRANSACTIONID END) AS PREV_VOLUME,
            COUNT(CASE
                WHEN PROCESS_DATE >= '{curr_start_ymd}' AND PROCESS_DATE <= '{curr_end_ymd}'
                THEN TRANSACTIONID END) AS CURR_VOLUME,
            COALESCE(SUM(CASE
                WHEN PROCESS_DATE >= '{prev_start_ymd}' AND PROCESS_DATE <= '{prev_end_ymd}'
                THEN ORIGINALAMOUNT END), 0) AS PREV_VALUE,
            COALESCE(SUM(CASE
                WHEN PROCESS_DATE >= '{curr_start_ymd}' AND PROCESS_DATE <= '{curr_end_ymd}'
                THEN ORIGINALAMOUNT END), 0) AS CURR_VALUE,
            COALESCE(SUM(CASE
                WHEN PROCESS_DATE >= '{prev_start_ymd}' AND PROCESS_DATE <= '{prev_end_ymd}'
                THEN CHARGEAMOUNT END), 0) AS PREV_REVENUE,
            COALESCE(SUM(CASE
                WHEN PROCESS_DATE >= '{curr_start_ymd}' AND PROCESS_DATE <= '{curr_end_ymd}'
                THEN CHARGEAMOUNT END), 0) AS CURR_REVENUE
        FROM ({unified}) AS unified_q
        WHERE BANK_NAME IS NOT NULL AND TRIM(BANK_NAME) <> ''
        GROUP BY BANK_NAME, TRANSACTION_TYPE
        ORDER BY BANK_NAME, TRANSACTION_TYPE
        """
        result = self.db.execute(text(query))
        rows = [dict(r) for r in result.mappings()]
        return {
            "current_start": curr_start.strftime('%Y-%m-%d'),
            "current_end":   curr_end.strftime('%Y-%m-%d'),
            "prev_start":    prev_start.strftime('%Y-%m-%d'),
            "prev_end":      prev_end.strftime('%Y-%m-%d'),
            "rows": rows,
        }

    def iter_active_customers(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 2_000_000,
        offset: int = 0,
        wallet_type: Optional[str] = None,
        msisdns: Optional[List[str]] = None,
        transaction_statuses: Optional[List[str]] = None,
    ):
        """
        Récupère TOUTES les rows en mémoire en un seul fetch (rapide via cloud fetch
        Databricks), puis yield depuis la liste. On évite ainsi le ConnectionReset
        qui survient quand on garde le curseur ouvert pendant un streaming lent.

        Trade-off : un délai initial (~10-30s pour la query) AVANT le 1er yield, MAIS
        une fois démarré, le streaming va à plein débit (pas de roundtrips réseau).
        Le BOM + header sont yieldés AVANT cet appel (cf. stream_csv) → le navigateur
        voit "download started" instantanément.
        """
        # Délègue la construction à get_active_customers en lui demandant le SQL via un flag
        # Pour rester DRY, on appelle l'exécution interne en passant par les mêmes paramètres
        # mais via un curseur streaming SQLAlchemy.
        if not start_date:
            start_date = date.today() - timedelta(days=30)
        if not end_date:
            end_date = date.today() - timedelta(days=1)

        start_str, end_str, sub_cred, sub_debt, _outer = self._build_filters(
            start_date, end_date, msisdns, None, None
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt, transaction_statuses)

        wallet_filter = ""
        join_kind = "LEFT JOIN"
        wt = (wallet_type or "").upper().strip()
        if wt in ("FULL", "FULL_WALLET", "FULLWALLET"):
            wallet_filter = "AND TRUSTLEVEL = 'Registered Customer Level 1'"
            join_kind = "INNER JOIN"
        elif wt in ("MINI", "MINI_WALLET", "MINIWALLET"):
            wallet_filter = "AND TRUSTLEVEL = 'Registered Customer Level 0'"
            join_kind = "INNER JOIN"

        # SQL identique à get_active_customers — duplication assumée pour éviter un gros refactor
        query = f"""
        WITH active_msisdns AS (
            SELECT
                MSISDN,
                COUNT(DISTINCT TRANSACTIONID)        AS TX_COUNT,
                COALESCE(SUM(ORIGINALAMOUNT), 0)     AS TOTAL_VALUE,
                COALESCE(SUM(CHARGEAMOUNT), 0)       AS TOTAL_CHARGE,
                MIN(TRANSACTION_DATE)                AS FIRST_TX,
                MAX(TRANSACTION_DATE)                AS LAST_TX
            FROM (
                SELECT DISTINCT TRANSACTIONID, MSISDN, TRANSACTION_DATE, ORIGINALAMOUNT, CHARGEAMOUNT
                FROM ({inner})
                WHERE TR_TYPE IS NOT NULL
            )
            WHERE MSISDN IS NOT NULL
            GROUP BY MSISDN
        ),
        customer_info AS (
            SELECT
                IDENTITYMSISDN AS MSISDN,
                replace(IDENTITYNAME, '/', '') AS IDENTITYNAME,
                IDENTITYSTATUS                  AS STATUS,
                CASE
                    WHEN TRUSTLEVEL = 'Registered Customer Level 0' THEN 'MINI WALLET'
                    WHEN TRUSTLEVEL = 'Registered Customer Level 1' THEN 'FULL WALLET'
                    ELSE 'OTHER'
                END                             AS KYC,
                ADDRESS, IMTOPTIN,
                IDNUMBER AS ID_NUMBER, IDTYPE AS ID_TYPE,
                TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') AS ID_EXPIRY_DATE,
                CASE
                    WHEN TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') IS NULL THEN 'Unknown'
                    WHEN TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') <= current_date THEN 'Expired'
                    ELSE 'Valid'
                END AS ID_STATUS,
                to_date(DATEIDENTITYREGISTERED,'yyyyMMddHHmmss') AS CREATED_DATE,
                split(ACCOUNT, '\\\\^')[4] AS BALANCE,
                ROW_NUMBER() OVER (
                    PARTITION BY IDENTITYMSISDN
                    ORDER BY TO_DATE(LASTMODIFIED,'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
            WHERE IDENTITYTYPE = 'Customer'
              AND TO_DATE(DATE_CODE, 'yyyyMMdd') = (
                  SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd'))
                  FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
              )
              AND IDENTITYMSISDN IN (SELECT MSISDN FROM active_msisdns)
              {wallet_filter}
        ),
        latest_customer AS (SELECT * FROM customer_info WHERE rn = 1),
        location_data AS (
            SELECT MSISDN, SECTOR, CITY, DEPARTMENT, ZONE FROM (
                SELECT LO.MSISDN, SI.SECTOR, SI.CITY, SI.DEPARTMENT, SI.CLUSTERS AS ZONE,
                       ROW_NUMBER() OVER (PARTITION BY LO.MSISDN ORDER BY SI.SITE_CODE, SI.SECTOR) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                  AND LO.MSISDN IN (SELECT MSISDN FROM active_msisdns)
            ) WHERE loc_rn = 1
        )
        SELECT
            a.MSISDN, c.IDENTITYNAME, c.STATUS, c.KYC, c.BALANCE, c.ADDRESS, c.IMTOPTIN,
            c.ID_NUMBER, c.ID_TYPE, c.ID_STATUS, c.ID_EXPIRY_DATE, c.CREATED_DATE,
            l.SECTOR, l.CITY, l.DEPARTMENT, l.ZONE,
            a.TX_COUNT, a.TOTAL_VALUE, a.TOTAL_CHARGE, a.FIRST_TX, a.LAST_TX
        FROM active_msisdns a
        {join_kind} latest_customer c ON a.MSISDN = c.MSISDN
        LEFT JOIN location_data l    ON a.MSISDN = l.MSISDN
        LIMIT {limit} OFFSET {offset}
        """
        # ⚠️ PAS d'ORDER BY ici : il forcerait Databricks à matérialiser tout
        # le résultat avant de renvoyer la 1ère ligne. Pour l'export, l'ordre
        # n'a pas d'importance — l'utilisateur peut trier dans Excel.

        # Fetchall en un seul shot — la connexion HTTP vers Databricks ne reste pas
        # ouverte pendant le streaming. Avec cloud fetch activé, c'est très rapide
        # (résultats en parquet streamés depuis blob storage, puis décodés en local).
        result = self.db.execute(text(query))
        all_rows = result.mappings().all()
        # Maintenant on yield depuis la mémoire — pas de risque de ConnectionReset
        for row in all_rows:
            yield dict(row)

    def get_active_customers(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 100,
        offset: int = 0,
        wallet_type: Optional[str] = None,
        msisdns: Optional[List[str]] = None,
        transaction_statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Customers ayant effectué au moins une transaction (credit OU debit, Customer haïtien)
        dans la période [start_date, end_date].

        Renvoie pour chaque MSISDN :
        - Infos profil (NAME, STATUS, KYC, ADDRESS, ID_STATUS, CREATED_DATE, …)
        - Localisation réseau (SECTOR, CITY, DEPARTMENT, ZONE)
        - Summary tx sur la période (TX_COUNT, TOTAL_VALUE, TOTAL_CHARGE, FIRST_TX, LAST_TX)

        Note : un même MSISDN compte une fois (DISTINCT) même s'il a fait 1000 tx.
        Le filtre `msisdns` restreint aux comptes de la liste (utile pour un bulk upload).
        Le filtre `transaction_statuses` restreint sur TRANSACTIONSTATUS
        (défaut : ['Completed']).
        """
        if not start_date:
            start_date = date.today() - timedelta(days=30)
        if not end_date:
            end_date = date.today() - timedelta(days=1)

        start_str, end_str, sub_cred, sub_debt, _outer = self._build_filters(
            start_date, end_date, msisdns, None, None
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt, transaction_statuses)

        # Whitelist wallet_type → filtre TRUSTLEVEL
        wallet_filter = ""
        join_kind = "LEFT JOIN"
        wt = (wallet_type or "").upper().strip()
        if wt in ("FULL", "FULL_WALLET", "FULLWALLET"):
            wallet_filter = "AND TRUSTLEVEL = 'Registered Customer Level 1'"
            join_kind = "INNER JOIN"
        elif wt in ("MINI", "MINI_WALLET", "MINIWALLET"):
            wallet_filter = "AND TRUSTLEVEL = 'Registered Customer Level 0'"
            join_kind = "INNER JOIN"

        query = f"""
        WITH active_msisdns AS (
            SELECT
                MSISDN,
                COUNT(DISTINCT TRANSACTIONID)        AS TX_COUNT,
                COALESCE(SUM(ORIGINALAMOUNT), 0)     AS TOTAL_VALUE,
                COALESCE(SUM(CHARGEAMOUNT), 0)       AS TOTAL_CHARGE,
                MIN(TRANSACTION_DATE)                AS FIRST_TX,
                MAX(TRANSACTION_DATE)                AS LAST_TX
            FROM (
                SELECT DISTINCT TRANSACTIONID, MSISDN, TRANSACTION_DATE, ORIGINALAMOUNT, CHARGEAMOUNT
                FROM ({inner})
                WHERE TR_TYPE IS NOT NULL
            )
            WHERE MSISDN IS NOT NULL
            GROUP BY MSISDN
        ),
        customer_info AS (
            SELECT
                IDENTITYMSISDN AS MSISDN,
                replace(IDENTITYNAME, '/', '') AS IDENTITYNAME,
                IDENTITYSTATUS                  AS STATUS,
                CASE
                    WHEN TRUSTLEVEL = 'Registered Customer Level 0' THEN 'MINI WALLET'
                    WHEN TRUSTLEVEL = 'Registered Customer Level 1' THEN 'FULL WALLET'
                    ELSE 'OTHER'
                END                             AS KYC,
                ADDRESS,
                IMTOPTIN,
                IDNUMBER                        AS ID_NUMBER,
                IDTYPE                          AS ID_TYPE,
                TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') AS ID_EXPIRY_DATE,
                CASE
                    WHEN TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') IS NULL THEN 'Unknown'
                    WHEN TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') <= current_date THEN 'Expired'
                    ELSE 'Valid'
                END                             AS ID_STATUS,
                to_date(DATEIDENTITYREGISTERED,'yyyyMMddHHmmss') AS CREATED_DATE,
                split(ACCOUNT, '\\\\^')[4]      AS BALANCE,
                ROW_NUMBER() OVER (
                    PARTITION BY IDENTITYMSISDN
                    ORDER BY TO_DATE(LASTMODIFIED,'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
            WHERE IDENTITYTYPE = 'Customer'
              AND TO_DATE(DATE_CODE, 'yyyyMMdd') = (
                  SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd'))
                  FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
              )
              AND IDENTITYMSISDN IN (SELECT MSISDN FROM active_msisdns)
              {wallet_filter}
        ),
        latest_customer AS (
            SELECT * FROM customer_info WHERE rn = 1
        ),
        location_data AS (
            SELECT MSISDN, SECTOR, CITY, DEPARTMENT, ZONE FROM (
                SELECT
                    LO.MSISDN,
                    SI.SECTOR, SI.CITY, SI.DEPARTMENT, SI.CLUSTERS AS ZONE,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                  AND LO.MSISDN IN (SELECT MSISDN FROM active_msisdns)
            ) WHERE loc_rn = 1
        )
        SELECT
            a.MSISDN,
            c.IDENTITYNAME,
            c.STATUS,
            c.KYC,
            c.BALANCE,
            c.ADDRESS,
            c.IMTOPTIN,
            c.ID_NUMBER,
            c.ID_TYPE,
            c.ID_STATUS,
            c.ID_EXPIRY_DATE,
            c.CREATED_DATE,
            l.SECTOR,
            l.CITY,
            l.DEPARTMENT,
            l.ZONE,
            a.TX_COUNT,
            a.TOTAL_VALUE,
            a.TOTAL_CHARGE,
            a.FIRST_TX,
            a.LAST_TX
        FROM active_msisdns a
        {join_kind} latest_customer c ON a.MSISDN = c.MSISDN
        LEFT JOIN location_data l    ON a.MSISDN = l.MSISDN
        ORDER BY a.TX_COUNT DESC, a.TOTAL_VALUE DESC
        LIMIT {limit} OFFSET {offset}
        """

        # Comptage total (sans LIMIT) — applique aussi le filtre wallet pour cohérence KPI.
        # On agrège par MSISDN dans active_agg, puis on filtre via INNER JOIN avec le wallet filter.
        count_query = f"""
        WITH active_agg AS (
            SELECT
                MSISDN,
                COUNT(DISTINCT TRANSACTIONID)        AS TX_COUNT,
                COALESCE(SUM(ORIGINALAMOUNT), 0)     AS TOTAL_VALUE,
                COALESCE(SUM(CHARGEAMOUNT), 0)       AS TOTAL_CHARGE
            FROM (
                SELECT DISTINCT TRANSACTIONID, MSISDN, ORIGINALAMOUNT, CHARGEAMOUNT
                FROM ({inner}) WHERE TR_TYPE IS NOT NULL
            )
            WHERE MSISDN IS NOT NULL
            GROUP BY MSISDN
        ),
        wallet_filtered AS (
            SELECT DISTINCT IDENTITYMSISDN AS MSISDN
            FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
            WHERE IDENTITYTYPE = 'Customer'
              AND TO_DATE(DATE_CODE, 'yyyyMMdd') = (
                  SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd'))
                  FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
              )
              AND IDENTITYMSISDN IN (SELECT MSISDN FROM active_agg)
              {wallet_filter}
        )
        SELECT
            CAST(COUNT(DISTINCT a.MSISDN) AS BIGINT)        AS TOTAL_ACTIVE,
            CAST(COALESCE(SUM(a.TX_COUNT), 0) AS BIGINT)    AS TOTAL_TX,
            CAST(COALESCE(SUM(a.TOTAL_VALUE), 0) AS DOUBLE) AS TOTAL_VALUE,
            CAST(COALESCE(SUM(a.TOTAL_CHARGE),0) AS DOUBLE) AS TOTAL_CHARGE
        FROM active_agg a
        {join_kind} wallet_filtered w ON a.MSISDN = w.MSISDN
        """

        rows_result = self.db.execute(text(query))
        rows = [dict(r) for r in rows_result.mappings()]

        # Comptage — avec fallback try/except pour le bug pandas driver
        summary = {"TOTAL_ACTIVE": 0, "TOTAL_TX": 0, "TOTAL_VALUE": 0, "TOTAL_CHARGE": 0}
        try:
            count_result = self.db.execute(text(count_query)).mappings().first()
            if count_result:
                summary = {k: (v or 0) for k, v in dict(count_result).items()}
        except Exception as e:
            print(f"[ACTIVE_CUSTOMERS] summary query failed: {e}")

        return {
            "start_date": start_date.strftime('%Y-%m-%d'),
            "end_date":   end_date.strftime('%Y-%m-%d'),
            "total_active":  int(summary.get("TOTAL_ACTIVE", 0) or 0),
            "total_tx":      int(summary.get("TOTAL_TX", 0) or 0),
            "total_value":   float(summary.get("TOTAL_VALUE", 0) or 0),
            "total_charge":  float(summary.get("TOTAL_CHARGE", 0) or 0),
            "rows": rows,
        }

    def get_subs_dashboard(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[Dict[str, Any]]:
        """
        Snapshot quotidien des subs : UNION de
          1) gr_dgc_dwh_prd.temp_dl.ht_DASHBOARD_GSM_ACT (MEMO/DATE_CODE/SUBS pré-agrégés :
             ACTIVE_AGENT, CHURN 30/60/90, FW_ACTIVE_*, MFS_ACTIVE_*, MERCHANT_AGENT)
          2) MFS_ACTIVE_DAILY calculé à la volée depuis mfs_transaction_aml.

        Retourne rows {DATE_CODE: 'yyyy-MM-dd', MEMO: str, SUBS: int}, triés DESC sur la date.
        """
        if not start_date:
            start_date = date(date.today().year, 1, 1)
        if not end_date:
            end_date = date.today()

        start_str = start_date.strftime('%Y-%m-%d')
        end_str   = end_date.strftime('%Y-%m-%d')
        # Pour partition pruning sur PROCESS_DATE (string yyyyMMdd).
        # +1 jour sur la borne haute : les transactions du dernier jour peuvent avoir
        # PROCESS_DATE = J+1 (cas ETL processé le lendemain), il faut les inclure.
        start_ymd = start_date.strftime('%Y%m%d')
        end_ymd   = (end_date + timedelta(days=1)).strftime('%Y%m%d')

        query = f"""
        SELECT * FROM (
            SELECT
                MEMO,
                DATE_CODE,
                SUBS
            FROM gr_dgc_dwh_prd.temp_dl.ht_DASHBOARD_GSM_ACT
            WHERE DATE_CODE BETWEEN to_date('{start_str}', 'yyyy-MM-dd') AND to_date('{end_str}', 'yyyy-MM-dd')

            UNION ALL

            SELECT
                'MFS_ACTIVE_DAILY' AS MEMO,
                to_date(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') AS DATE_CODE,
                COUNT(DISTINCT MSISDN) AS SUBS
            FROM (
                SELECT DISTINCT
                    TRANSACTIONFINISHTIME,
                    CREDITPARTYIDENTIFIER AS MSISDN
                FROM hive_metastore.ods_dl.mfs_transaction_aml
                WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
                  AND to_date(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN to_date('{start_str}', 'yyyy-MM-dd') AND to_date('{end_str}', 'yyyy-MM-dd')
                  AND TRANSACTIONSTATUS IN ('Success', 'Completed')
                  AND SERVICENAME IN (
                        'Cash In','P2P Transfer','Send Money to Registered Customer by QR Code',
                        'Cash In OTC','OD Money Transfer Prefunded','IMT revceiving',
                        'Money Transfer Prefunded','Bulk B2C transfer'
                  )
                  AND ORIGINALAMOUNT IS NOT NULL
                  AND CREDITPARTYTYPE = 'Customer'

                UNION ALL

                SELECT DISTINCT
                    TRANSACTIONFINISHTIME,
                    DEBITPARTYIDENTIFIER AS MSISDN
                FROM hive_metastore.ods_dl.mfs_transaction_aml
                WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
                  AND to_date(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN to_date('{start_str}', 'yyyy-MM-dd') AND to_date('{end_str}', 'yyyy-MM-dd')
                  AND TRANSACTIONSTATUS IN ('Success', 'Completed')
                  AND SERVICENAME IN (
                        'Cash Out','Merchant Cashout','Customer Bill Payment','Agent/Merchant Bill Payment',
                        'Merchant Payment to Merchant','Merchant Payment','Merchant QR Payment','Merchant Till payment',
                        'Merchant to Merchant Payment via Till ID','Merchant Online Payment','P2P Transfer',
                        'Send Money to Registered Customer by QR Code','Prepaid Top up','Gift Top up','OTC Top Up','Wallet to Bank'
                  )
                  AND ORIGINALAMOUNT IS NOT NULL
                  AND DEBITPARTYTYPE = 'Customer'
            )
            GROUP BY to_date(TRANSACTIONFINISHTIME, 'yyyy-MM-dd')
        )
        WHERE DATE_CODE IS NOT NULL
        ORDER BY DATE_CODE DESC
        """
        result = self.db.execute(text(query))
        rows = []
        for r in result.mappings():
            d = dict(r)
            # Normalise DATE_CODE en string yyyy-MM-dd
            dc = d.get("DATE_CODE")
            if dc is not None and not isinstance(dc, str):
                d["DATE_CODE"] = dc.strftime("%Y-%m-%d") if hasattr(dc, "strftime") else str(dc)
            rows.append(d)
        return rows

    def get_agent_otc(
        self,
        start_date: date,
        end_date: date,
        date_code: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Agents OTC : somme des transactions Cash In OTC / Agent Payment to Agent
        par DEBITPARTYIDENTIFIER (= agent), jointe avec le profil agent.

        Args:
            start_date / end_date : période des transactions (inclusive both sides)
            date_code : snapshot du profil agent (format yyyyMMdd).
                        Si None, on prend le MAX(DATE_CODE) disponible.
            limit     : nombre max de lignes retournees (ORDER BY TR_VALUE DESC).
                        None = pas de limite (utile pour l'export CSV/XLSX).

        Returns: list de {AGENT_MSISDN (formaté (509)XXXXXXXX), AGENT_NAME, TR_VALUE, VOLUME_, AGENT_ADRESS}
        """
        if not start_date or not end_date:
            raise ValueError("start_date and end_date are required")

        start_str = start_date.strftime('%Y-%m-%d')
        end_str   = end_date.strftime('%Y-%m-%d')

        # Whitelist du date_code (yyyyMMdd, 8 chiffres) — anti-injection
        import re as _re
        agent_snapshot_filter = ""
        if date_code:
            dc_clean = _re.sub(r'[^0-9]', '', str(date_code))
            if len(dc_clean) == 8:
                agent_snapshot_filter = f"DATE_CODE = '{dc_clean}'"
        if not agent_snapshot_filter:
            # Défaut : MAX(DATE_CODE) disponible
            agent_snapshot_filter = (
                "DATE_CODE = (SELECT MAX(DATE_CODE) FROM hive_metastore.ods_dl.ods_mfs_agent)"
            )

        # LIMIT anti-injection : cast en int strict, None = pas de limite
        limit_clause = ""
        if limit is not None:
            try:
                lim = int(limit)
                if lim > 0:
                    limit_clause = f"LIMIT {lim}"
            except (TypeError, ValueError):
                pass

        query = f"""
        WITH AGENT AS (
            SELECT
                AD_ALIAS AS MSISDN,
                AB_SALT AS AGENT_MSISDN,
                AB_NAME AS AGENT_NAME,
                REPLACE(AD_PERMANENTADRESS1, ',', ' ') AS AGENT_ADRESS
            FROM (
                SELECT
                    AD_ALIAS,
                    AB_SALT,
                    AB_NAME,
                    AD_PERMANENTADRESS1,
                    AB_CREATED_DATE,
                    ROW_NUMBER() OVER (
                        PARTITION BY AD_ALIAS
                        ORDER BY AB_CREATED_DATE DESC
                    ) AS RN
                FROM hive_metastore.ods_dl.ods_mfs_agent
                WHERE {agent_snapshot_filter}
                  AND AG_GROUP_LIST IN ('mcomagent', 'distributor')
            ) T
            WHERE RN = 1
        ),
        TRANSACTIONS AS (
            SELECT
                DEBITPARTYIDENTIFIER AS AGENT_MSISDN,
                SUM(ORIGINALAMOUNT) AS TR_VALUE,
                COUNT(DISTINCT TRANSACTIONID) AS VOLUME_
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE TO_DATE(PROCESS_DATE, 'yyyyMMdd')
                  BETWEEN TO_DATE('{start_str}', 'yyyy-MM-dd')
                  AND     TO_DATE('{end_str}',   'yyyy-MM-dd')
              AND TRANSACTIONSTATUS = 'Completed'
              AND SERVICENAME IN ('Cash In OTC', 'Agent Payment to Agent')
              AND DEBITPARTYTYPE = 'Organization'
              AND REASONTYPE IN (
                    'Customer cash in OTC at Express',
                    'Agent Payment to Agent Via USSD_Digicel',
                    'Customer cash in OTC at Agent',
                    'Customer cash in OTC at Master'
              )
            GROUP BY DEBITPARTYIDENTIFIER
        )
        SELECT
            CONCAT('(509)', SUBSTRING(A.AGENT_MSISDN, 4)) AS AGENT_MSISDN,
            A.AGENT_NAME,
            T.TR_VALUE,
            T.VOLUME_,
            A.AGENT_ADRESS
        FROM TRANSACTIONS T
        INNER JOIN AGENT A
            ON T.AGENT_MSISDN = A.MSISDN
        ORDER BY T.TR_VALUE DESC
        {limit_clause}
        """
        try:
            result = self.db.execute(text(query))
        except Exception as e:
            print(f"[AGENT_OTC] SQL failed: {e}")
            raise
        return [dict(r) for r in result.mappings()]

    def get_transaction_history(
        self,
        msisdn: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Historique des transactions pour un MSISDN donné (debiteur OU crediteur).
        Renvoie chaque transaction avec balances avant/après calculées selon le côté
        où apparaît le MSISDN.

        Args:
            msisdn: identifiant du party (utilisé pour debit ET credit side)
            start_date / end_date: bornes inclusives sur PROCESS_DATE (yyyyMMdd partition)
            status: 'Completed' (défaut), 'Expired', 'Cancelled', 'Declined', ou None=All
        """
        if not msisdn or not msisdn.strip():
            return []
        # Whitelist du MSISDN — caractères alphanumériques seulement, anti-injection
        import re as _re
        safe_msisdn = _re.sub(r"[^0-9A-Za-z]", "", str(msisdn))
        if not safe_msisdn:
            return []

        if not start_date:
            start_date = date.today() - timedelta(days=30)
        if not end_date:
            end_date = date.today()
        start_ymd = start_date.strftime('%Y%m%d')
        end_ymd   = end_date.strftime('%Y%m%d')

        # Whitelist du status
        status_filter = ""
        allowed = {"Completed", "Expired", "Cancelled", "Declined"}
        if status and status in allowed:
            status_filter = f"AND TRANSACTIONSTATUS = '{status}'"
        # else: All → pas de filtre

        # TRANSACTIONTYPE = catégorie métier renvoyée par mfs_transaction_aml,
        # préférée au SERVICENAME pour l'affichage. SERVICENAME reste exposé en
        # fallback si TRANSACTIONTYPE est null.
        query = f"""
        SELECT DISTINCT
            TRANSACTIONFINISHTIME AS TRANSACTION_DATE,
            TRANSACTIONID         AS TR_ID,
            TRANSACTIONTYPE,
            SERVICENAME,
            CHANNEL               AS TR_CHANNEL,
            TRANSACTIONSTATUS     AS TRANS_STATUS,
            CREDITPARTYIDENTIFIER AS CREDITOR,
            CREDITPARTYNAME,
            DEBITPARTYIDENTIFIER  AS DEBITOR,
            DEBITPARTYNAME,
            REASONTYPE,
            CAST(COALESCE(ORIGINALAMOUNT, 0) AS DOUBLE) AS AMOUNT,
            CAST(COALESCE(CHARGEAMOUNT,   0) AS DOUBLE) AS FEE,
            CAST(
                CASE
                    WHEN DEBITPARTYIDENTIFIER = '{safe_msisdn}'
                        THEN COALESCE(BALBEFORETRANSDEBITACCOUNT, 0)
                    ELSE COALESCE(BALBEFORETRANSCREDITACCOUNT, 0)
                END AS DOUBLE
            ) AS BAL_BEFORE,
            CAST(
                CASE
                    WHEN DEBITPARTYIDENTIFIER = '{safe_msisdn}'
                        THEN COALESCE(BALAFTERTRANSDEBITACCOUNT, 0)
                    ELSE COALESCE(BALAFTERTRANSCREDITACCOUNT, 0)
                END AS DOUBLE
            ) AS BAL_AFTER,
            CASE
                WHEN DEBITPARTYIDENTIFIER = '{safe_msisdn}' THEN 'DEBIT'
                ELSE 'CREDIT'
            END AS SIDE
        FROM hive_metastore.ods_dl.mfs_transaction_aml
        WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
          AND (DEBITPARTYIDENTIFIER = '{safe_msisdn}' OR CREDITPARTYIDENTIFIER = '{safe_msisdn}')
          {status_filter}
        ORDER BY TRANSACTION_DATE ASC, TR_ID ASC
        """
        try:
            result = self.db.execute(text(query))
        except Exception as e:
            # Log explicite pour debug
            print(f"[TRANSACTION_HISTORY] SQL failed for msisdn={safe_msisdn}: {e}")
            raise

        rows = []
        for r in result.mappings():
            d = dict(r)
            td = d.get("TRANSACTION_DATE")
            if td is not None and not isinstance(td, str):
                d["TRANSACTION_DATE"] = td.strftime("%Y-%m-%d %H:%M:%S") if hasattr(td, "strftime") else str(td)
            rows.append(d)
        return rows

    def get_transaction_range(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Agrégat par (mois × NORMALIZED_SERVICENAME × TIER) — pour la page Transaction Range.
        Retourne par ligne : DATE_CODE (1er du mois), SERVICENAME, TIER, DISTINCT_SUBS, TR_VOLUME, TR_VALUE.

        Les TIER sont des tranches de montant ORIGINALAMOUNT (T00 = 0-19, T01 = 20-99, ..., T13 = 75K+).
        Filtre optionnel par NORMALIZED_SERVICENAME (Cash In Self, Cash Out, P2P_SEND, etc.).
        """
        if not start_date:
            start_date = date(date.today().year, 1, 1)
        if not end_date:
            end_date = date.today() - timedelta(days=1)

        start_ymd = start_date.strftime('%Y%m%d')
        end_ymd   = end_date.strftime('%Y%m%d')

        credit_services = (
            "'Cash In','P2P Transfer','Send Money to Registered Customer by QR Code',"
            "'Cash In OTC','OD Money Transfer Prefunded','IMT revceiving',"
            "'Money Transfer Prefunded','Bulk B2C transfer'"
        )
        debit_services = (
            "'Cash Out','Merchant Cashout','Customer Bill Payment','Agent/Merchant Bill Payment',"
            "'Merchant Payment to Merchant','Merchant Payment','Merchant QR Payment','Merchant Till payment',"
            "'Merchant to Merchant Payment via Till ID','Merchant Online Payment','P2P Transfer',"
            "'Send Money to Registered Customer by QR Code','Prepaid Top up','Gift Top up','OTC Top Up','Wallet to Bank'"
        )

        # Filtre service_names (sur la colonne NORMALIZED_SERVICENAME)
        service_filter = ""
        if service_names:
            cleaned = [s.strip().replace("'", "''") for s in service_names if s and s.strip()]
            if cleaned:
                quoted = ",".join(f"'{s}'" for s in cleaned)
                service_filter = f"AND NORMALIZED_SERVICENAME IN ({quoted})"

        # On utilise PROCESS_DATE en string pour partition pruning, comme partout ailleurs.
        # Le CASE WHEN sur SERVICENAME normalise les noms (matche le script de référence).
        # Pour distinguer P2P_RECEIVE vs P2P_SEND, on ajoute un FLOW = CREDIT|DEBIT
        # injecté dans chaque côté du UNION.
        query = f"""
        WITH all_transactions AS (
            SELECT
                PROCESS_DATE,
                CREDITPARTYIDENTIFIER AS MSISDN,
                SERVICENAME,
                ORIGINALAMOUNT,
                TRANSACTIONID,
                'CREDIT' AS FLOW
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS IN ('Success', 'Completed')
              AND SERVICENAME IN ({credit_services})
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'

            UNION

            SELECT
                PROCESS_DATE,
                DEBITPARTYIDENTIFIER AS MSISDN,
                SERVICENAME,
                ORIGINALAMOUNT,
                TRANSACTIONID,
                'DEBIT' AS FLOW
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS IN ('Success', 'Completed')
              AND SERVICENAME IN ({debit_services})
              AND ORIGINALAMOUNT IS NOT NULL
              AND DEBITPARTYTYPE = 'Customer'
        ),
        classified AS (
            SELECT DISTINCT
                PROCESS_DATE,
                MSISDN,
                ORIGINALAMOUNT,
                TRANSACTIONID,
                CASE
                    WHEN SERVICENAME = 'OD Money Transfer Prefunded' THEN 'B2W'
                    WHEN SERVICENAME IN ('P2P Transfer','Send Money to Registered Customer by QR Code')
                         AND FLOW = 'CREDIT' THEN 'P2P_RECEIVE'
                    WHEN SERVICENAME IN ('P2P Transfer','Send Money to Registered Customer by QR Code')
                         AND FLOW = 'DEBIT'  THEN 'P2P_SEND'
                    WHEN SERVICENAME = 'Bulk B2C transfer' THEN 'Payroll | disbursements'
                    WHEN SERVICENAME = 'Cash In'     THEN 'Cash In Self'
                    WHEN SERVICENAME = 'Cash In OTC' THEN 'Cash In'
                    WHEN SERVICENAME = 'Cash Out'    THEN 'Cash Out'
                    WHEN SERVICENAME = 'Customer Bill Payment'
                         AND MSISDN IN ('314','318','322','326','310') THEN 'DIGI_PRODUCT'
                    WHEN SERVICENAME = 'Customer Bill Payment' THEN 'BILLPAY'
                    WHEN SERVICENAME = 'Gift Top up'    THEN 'TOPUP_GIFT'
                    WHEN SERVICENAME = 'Prepaid Top up' THEN 'SELF_TOPUP'
                    WHEN SERVICENAME IN (
                        'Merchant Payment','Merchant QR Payment','Merchant Till payment',
                        'Merchant to Merchant Payment via Till ID','Merchant Online Payment'
                    ) THEN 'PAY2MERC'
                    WHEN SERVICENAME = 'Wallet to Bank' THEN 'W2B'
                    WHEN SERVICENAME = 'IMT revceiving' THEN 'IMT'
                    WHEN SERVICENAME = 'Money Transfer Prefunded' THEN 'PREFUNDED'
                END AS NORMALIZED_SERVICENAME,
                CASE
                    WHEN ORIGINALAMOUNT < 20     THEN 'T00 : 0 - 19'
                    WHEN ORIGINALAMOUNT < 100    THEN 'T01 : 20 - 99'
                    WHEN ORIGINALAMOUNT < 250    THEN 'T02 : 100 - 249'
                    WHEN ORIGINALAMOUNT < 500    THEN 'T03 : 250 - 499'
                    WHEN ORIGINALAMOUNT < 1000   THEN 'T04 : 500 - 999'
                    WHEN ORIGINALAMOUNT < 2000   THEN 'T05 : 1000 - 1999'
                    WHEN ORIGINALAMOUNT < 4000   THEN 'T06 : 2000 - 3999'
                    WHEN ORIGINALAMOUNT < 8000   THEN 'T07 : 4000 - 7999'
                    WHEN ORIGINALAMOUNT < 12000  THEN 'T08 : 8000 - 11999'
                    WHEN ORIGINALAMOUNT < 20000  THEN 'T09 : 12000 - 19999'
                    WHEN ORIGINALAMOUNT < 40000  THEN 'T10 : 20000 - 39999'
                    WHEN ORIGINALAMOUNT < 60000  THEN 'T11 : 40000 - 59999'
                    WHEN ORIGINALAMOUNT <= 75000 THEN 'T12 : 60000 - 75000'
                    ELSE 'T13 : 75K+'
                END AS TIER
            FROM all_transactions
        )
        SELECT
            date_format(trunc(TO_DATE(PROCESS_DATE, 'yyyyMMdd'), 'MONTH'), 'yyyy-MM-01') AS DATE_CODE,
            NORMALIZED_SERVICENAME                                     AS SERVICENAME,
            TIER,
            COUNT(DISTINCT MSISDN)                                     AS DISTINCT_SUBS,
            COUNT(DISTINCT TRANSACTIONID)                              AS TR_VOLUME,
            COALESCE(SUM(ORIGINALAMOUNT), 0)                           AS TR_VALUE
        FROM classified
        WHERE NORMALIZED_SERVICENAME IS NOT NULL
          {service_filter}
        GROUP BY
            trunc(TO_DATE(PROCESS_DATE, 'yyyyMMdd'), 'MONTH'),
            NORMALIZED_SERVICENAME,
            TIER
        ORDER BY DATE_CODE, SERVICENAME, TIER
        """
        result = self.db.execute(text(query))
        return [dict(r) for r in result.mappings()]

    def get_mtd_by_service_name(
        self,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        MTD courant (1er du mois → report_date) agrégé par SERVICENAME (produit).
        Pour chaque SERVICENAME : SUBS (clients uniques participants), VOLUME (transactions uniques),
        VALUE (somme amounts, dédupliquée), REVENUE (somme charges, dédupliquée).

        Note : pour P2P / QR (credit+debit Customer), un ROW_NUMBER par TRANSACTIONID
        garantit que VALUE/REVENUE ne sont comptés qu'une fois.
        """
        if not report_date:
            report_date = date.today() - timedelta(days=1)

        start = self._first_of_month(report_date)
        end   = report_date
        start_ymd = start.strftime('%Y%m%d')
        end_ymd   = end.strftime('%Y%m%d')

        credit_services = (
            "'Cash In','P2P Transfer','Send Money to Registered Customer by QR Code',"
            "'Cash In OTC','OD Money Transfer Prefunded','IMT revceiving',"
            "'Money Transfer Prefunded','Bulk B2C transfer'"
        )
        debit_services = (
            "'Cash Out','Merchant Cashout','Customer Bill Payment','Agent/Merchant Bill Payment',"
            "'Merchant Payment to Merchant','Merchant Payment','Merchant QR Payment','Merchant Till payment',"
            "'Merchant to Merchant Payment via Till ID','Merchant Online Payment','P2P Transfer',"
            "'Send Money to Registered Customer by QR Code','Prepaid Top up','Gift Top up','OTC Top Up','Wallet to Bank'"
        )

        query = f"""
        WITH unified AS (
            SELECT
                SERVICENAME,
                TRANSACTIONID,
                CREDITPARTYIDENTIFIER AS MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND SERVICENAME IN ({credit_services})
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'

            UNION ALL

            SELECT
                SERVICENAME,
                TRANSACTIONID,
                DEBITPARTYIDENTIFIER AS MSISDN,
                ORIGINALAMOUNT,
                CHARGEAMOUNT
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND SERVICENAME IN ({debit_services})
              AND ORIGINALAMOUNT IS NOT NULL
              AND DEBITPARTYTYPE = 'Customer'
        ),
        ranked AS (
            SELECT
                SERVICENAME, TRANSACTIONID, MSISDN, ORIGINALAMOUNT, CHARGEAMOUNT,
                ROW_NUMBER() OVER (PARTITION BY TRANSACTIONID ORDER BY MSISDN) AS tr_rn
            FROM unified
        )
        SELECT
            SERVICENAME,
            COUNT(DISTINCT MSISDN)                                           AS SUBS,
            COUNT(DISTINCT TRANSACTIONID)                                    AS VOLUME,
            COALESCE(SUM(CASE WHEN tr_rn = 1 THEN ORIGINALAMOUNT END), 0)    AS VALUE,
            COALESCE(SUM(CASE WHEN tr_rn = 1 THEN CHARGEAMOUNT  END), 0)    AS REVENUE
        FROM ranked
        GROUP BY SERVICENAME
        ORDER BY VALUE DESC
        """
        result = self.db.execute(text(query))
        rows = [dict(r) for r in result.mappings()]
        return {
            "start": start.strftime('%Y-%m-%d'),
            "end":   end.strftime('%Y-%m-%d'),
            "rows":  rows,
        }

    def get_msisdn_departments(
        self,
        msisdns: List[str],
    ) -> List[Dict[str, Any]]:
        """
        Pour une liste de MSISDN, renvoie le DEPARTMENT (network location) de chaque numéro.
        - Utilise la même logique que get_mtd_by_department (JOIN ht_location × vw_dt_network_sites).
        - Si un MSISDN n'a pas de location → DEPARTMENT = 'Unknown'.
        - Si un MSISDN est ABSENT de la table de location → il sera juste absent du résultat
          (le frontend complète à 'Unknown').
        """
        if not msisdns:
            return []

        # Anti-injection : ne garder que des chiffres et '+', max 32 caractères
        import re as _re
        cleaned: List[str] = []
        seen = set()
        for m in msisdns:
            if not m:
                continue
            s = _re.sub(r"[^\d+]", "", str(m))[:32]
            if s and s not in seen:
                seen.add(s)
                cleaned.append(s.replace("'", "''"))
        if not cleaned:
            return []

        msisdn_list = "', '".join(cleaned)

        query = f"""
        WITH location_data AS (
            SELECT MSISDN, DEPARTMENT FROM (
                SELECT
                    LO.MSISDN,
                    SI.DEPARTMENT,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                  AND LO.MSISDN IN ('{msisdn_list}')
            ) WHERE loc_rn = 1
        )
        SELECT
            MSISDN,
            COALESCE(DEPARTMENT, 'Unknown') AS DEPARTMENT
        FROM location_data
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_mtd_by_department(
        self,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        MTD courant (1er du mois → report_date) agrégé par DEPARTMENT (network location).
        Renvoie pour chaque DEPARTMENT : SUBS, VOLUME, VALUE, REVENUE.

        IMPORTANT : utilise EXACTEMENT la même logique d'agrégation que get_mtd_snapshot_by_type
        (pas de déduplication ROW_NUMBER) — afin que la somme des départements = somme des produits
        = totaux du Snapshot MTD.

        Pour une P2P transaction : sender et receiver sont chacun comptés dans LEUR département.
        Le total cross-départements double-compte P2P, ce qui est cohérent avec le Snapshot MTD
        qui sépare P2P_SEND et P2P_RECEIVE comme deux lignes distinctes.
        """
        if not report_date:
            report_date = date.today() - timedelta(days=1)

        start = self._first_of_month(report_date)
        end   = report_date

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start, end, None, None, None
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        query = f"""
        WITH location_data AS (
            SELECT MSISDN, DEPARTMENT FROM (
                SELECT
                    LO.MSISDN,
                    SI.DEPARTMENT,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
            ) WHERE loc_rn = 1
        ),
        base AS (
            -- DISTINCT par (TRANSACTIONID, MSISDN, TR_TYPE) — strictement identique au snapshot MTD
            SELECT DISTINCT
                TRANSACTIONID, MSISDN, TR_TYPE,
                ORIGINALAMOUNT, CHARGEAMOUNT
            FROM ({inner})
            WHERE TR_TYPE IS NOT NULL {outer}
        )
        SELECT
            COALESCE(l.DEPARTMENT, 'Unknown') AS DEPARTMENT,
            COUNT(DISTINCT b.MSISDN)              AS SUBS,
            COUNT(DISTINCT b.TRANSACTIONID)       AS VOLUME,
            COALESCE(SUM(b.ORIGINALAMOUNT), 0)    AS VALUE,
            COALESCE(SUM(b.CHARGEAMOUNT),  0)    AS REVENUE
        FROM base b
        LEFT JOIN location_data l ON b.MSISDN = l.MSISDN
        GROUP BY COALESCE(l.DEPARTMENT, 'Unknown')
        ORDER BY VALUE DESC
        """
        result = self.db.execute(text(query))
        rows = [dict(r) for r in result.mappings()]
        return {
            "start": start.strftime('%Y-%m-%d'),
            "end":   end.strftime('%Y-%m-%d'),
            "rows":  rows,
        }

    def get_mtd_by_channel(
        self,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        MTD courant (1er du mois → report_date) agrégé par CHANNEL.
        Renvoie pour chaque CHANNEL : SUBS, VOLUME, VALUE, REVENUE.

        SUBS utilise une **attribution par canal primaire** : chaque MSISDN n'est comptée
        que sur SON canal primaire du MTD (= celui où elle a le plus de transactions ;
        tie-break alphabétique). Ainsi Σ(SUBS) sur tous les channels = nombre total
        unique de subscribers actifs sur le MTD — pas de double-comptage cross-channels.

        VOLUME / VALUE / REVENUE restent attribués au canal réel de la transaction.
        CHANNEL NULL ou vide → 'Unknown'.
        """
        if not report_date:
            report_date = date.today() - timedelta(days=1)

        start = self._first_of_month(report_date)
        end   = report_date

        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start, end, None, None, None
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt)

        query = f"""
        WITH base AS (
            SELECT DISTINCT
                TRANSACTIONID, MSISDN, TR_TYPE,
                ORIGINALAMOUNT, CHARGEAMOUNT,
                CASE WHEN CHANNEL IS NULL OR TRIM(CHANNEL) = '' THEN 'Unknown' ELSE CHANNEL END AS CHANNEL
            FROM ({inner})
            WHERE TR_TYPE IS NOT NULL {outer}
        ),
        -- Primary channel per MSISDN over the MTD window
        msisdn_channel_counts AS (
            SELECT
                MSISDN, CHANNEL,
                COUNT(DISTINCT TRANSACTIONID) AS tx_count
            FROM base
            GROUP BY MSISDN, CHANNEL
        ),
        primary_channel AS (
            SELECT MSISDN, CHANNEL FROM (
                SELECT MSISDN, CHANNEL,
                       ROW_NUMBER() OVER (
                         PARTITION BY MSISDN
                         ORDER BY tx_count DESC, CHANNEL ASC
                       ) AS rn
                FROM msisdn_channel_counts
            ) WHERE rn = 1
        ),
        subs_per_channel AS (
            SELECT CHANNEL, COUNT(DISTINCT MSISDN) AS SUBS
            FROM primary_channel
            GROUP BY CHANNEL
        ),
        metrics_per_channel AS (
            SELECT
                CHANNEL,
                COUNT(DISTINCT TRANSACTIONID)    AS VOLUME,
                COALESCE(SUM(ORIGINALAMOUNT), 0) AS VALUE,
                COALESCE(SUM(CHARGEAMOUNT),  0) AS REVENUE
            FROM base
            GROUP BY CHANNEL
        )
        SELECT
            m.CHANNEL,
            COALESCE(s.SUBS, 0) AS SUBS,
            m.VOLUME,
            m.VALUE,
            m.REVENUE
        FROM metrics_per_channel m
        LEFT JOIN subs_per_channel s ON s.CHANNEL = m.CHANNEL
        ORDER BY m.VALUE DESC
        """
        result = self.db.execute(text(query))
        rows = [dict(r) for r in result.mappings()]
        return {
            "start": start.strftime('%Y-%m-%d'),
            "end":   end.strftime('%Y-%m-%d'),
            "rows":  rows,
        }

    # ===== Helpers communs aux deux versions de churn custom =====
    _CHURN_CREDIT_SERVICES = (
        "'Cash In','P2P Transfer','Send Money to Registered Customer by QR Code',"
        "'Cash In OTC','OD Money Transfer Prefunded','IMT revceiving',"
        "'Money Transfer Prefunded','Bulk B2C transfer'"
    )
    _CHURN_DEBIT_SERVICES = (
        "'Cash Out','Merchant Cashout','Customer Bill Payment','Agent/Merchant Bill Payment',"
        "'Merchant Payment to Merchant','Merchant Payment','Merchant QR Payment','Merchant Till payment',"
        "'Merchant to Merchant Payment via Till ID','Merchant Online Payment','P2P Transfer',"
        "'Send Money to Registered Customer by QR Code','Prepaid Top up','Gift Top up','OTC Top Up','Wallet to Bank'"
    )

    def _churn_active_set_sql(self, start_ymd: str, end_ymd: str) -> str:
        """
        Set 'actif' — copie EXACTE du script Databricks de référence :
        - to_date(process_date, 'yyyyMMdd') BETWEEN to_date(...) AND to_date(...)
        - UNION (pas UNION ALL)
        - Pas de filtre WHERE MSISDN IS NOT NULL au niveau outer
        - ORIGINALAMOUNT IS NOT NULL sur credit ET debit
        """
        return f"""
        SELECT MSISDN FROM (
            SELECT CREDITPARTYIDENTIFIER AS MSISDN
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE to_date(process_date, 'yyyyMMdd') BETWEEN to_date('{start_ymd}', 'yyyyMMdd') AND to_date('{end_ymd}', 'yyyyMMdd')
              AND TRANSACTIONSTATUS = 'Completed'
              AND SERVICENAME IN ({self._CHURN_CREDIT_SERVICES})
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'
              AND CREDITPARTYIDENTIFIER LIKE '509%'
            UNION
            SELECT DEBITPARTYIDENTIFIER AS MSISDN
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE to_date(process_date, 'yyyyMMdd') BETWEEN to_date('{start_ymd}', 'yyyyMMdd') AND to_date('{end_ymd}', 'yyyyMMdd')
              AND TRANSACTIONSTATUS = 'Completed'
              AND SERVICENAME IN ({self._CHURN_DEBIT_SERVICES})
              AND ORIGINALAMOUNT IS NOT NULL
              AND DEBITPARTYTYPE = 'Customer'
              AND DEBITPARTYIDENTIFIER LIKE '509%'
        )
        """

    def _churn_exclude_set_sql(self, start_ymd: str, end_ymd: str) -> str:
        """
        Set 'exclude' — copie EXACTE du script Databricks de référence :
        - SELECT DISTINCT MSISDN FROM ... (avec DISTINCT comme dans le script)
        - to_date(process_date, 'yyyyMMdd') BETWEEN ...
        - UNION (pas UNION ALL)
        - ORIGINALAMOUNT IS NOT NULL sur credit, **PAS sur debit** (asymétrie du script)
        """
        return f"""
        SELECT DISTINCT MSISDN FROM (
            SELECT CREDITPARTYIDENTIFIER AS MSISDN
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE to_date(process_date, 'yyyyMMdd') BETWEEN to_date('{start_ymd}', 'yyyyMMdd') AND to_date('{end_ymd}', 'yyyyMMdd')
              AND TRANSACTIONSTATUS = 'Completed'
              AND SERVICENAME IN ({self._CHURN_CREDIT_SERVICES})
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'
              AND CREDITPARTYIDENTIFIER LIKE '509%'
            UNION
            SELECT DEBITPARTYIDENTIFIER AS MSISDN
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE to_date(process_date, 'yyyyMMdd') BETWEEN to_date('{start_ymd}', 'yyyyMMdd') AND to_date('{end_ymd}', 'yyyyMMdd')
              AND TRANSACTIONSTATUS = 'Completed'
              AND SERVICENAME IN ({self._CHURN_DEBIT_SERVICES})
              AND DEBITPARTYTYPE = 'Customer'
              AND DEBITPARTYIDENTIFIER LIKE '509%'
        )
        """

    def get_customer_churn_custom(
        self,
        active_start: date,
        active_end: date,
        exclude_start: date,
        exclude_end: date,
        return_list: bool = False,
        limit: int = 100,
    ) -> Dict[str, Any]:
        """
        Customer churn entre deux plages **libres** :
        MSISDN ayant effectué une transaction (credit ou debit, Customer haïtien)
        pendant la **période active** MAIS PAS pendant la **période exclude**.

        Réplique strictement le script Databricks de référence (UNION + MINUS/EXCEPT)
        avec l'asymétrie ORIGINALAMOUNT IS NOT NULL : présent en credit des deux périodes
        et en debit de l'active, MAIS PAS en debit de l'exclude.
        """
        as_ymd = active_start.strftime('%Y%m%d')
        ae_ymd = active_end.strftime('%Y%m%d')
        es_ymd = exclude_start.strftime('%Y%m%d')
        ee_ymd = exclude_end.strftime('%Y%m%d')

        active_q  = self._churn_active_set_sql(as_ymd, ae_ymd)
        exclude_q = self._churn_exclude_set_sql(es_ymd, ee_ymd)

        # Wrap final identique au script de référence (SELECT DISTINCT MSISDN AS SUBS FROM (... EXCEPT ...))
        query = f"""
        SELECT DISTINCT MSISDN AS SUBS
        FROM (
            {active_q}
            EXCEPT
            {exclude_q}
        )
        """

        all_msisdns: List[str] = []
        result = self.db.execute(text(query))
        for r in result:
            v = r[0] if r else None
            if v is not None:
                all_msisdns.append(str(v))

        total_count = len(all_msisdns)
        print(f"[CUSTOMER_CHURN_CUSTOM] active=[{active_start}, {active_end}] "
              f"exclude=[{exclude_start}, {exclude_end}] → total={total_count}")

        returned_list: List[str] = []
        if return_list:
            all_msisdns.sort()
            returned_list = all_msisdns[:limit] if (limit and limit > 0) else all_msisdns

        return {
            "active_window":  [active_start.strftime('%Y-%m-%d'),  active_end.strftime('%Y-%m-%d')],
            "exclude_window": [exclude_start.strftime('%Y-%m-%d'), exclude_end.strftime('%Y-%m-%d')],
            "churn_count": total_count,
            "msisdns": returned_list,
        }

    def get_customer_churn_custom_enriched(
        self,
        active_start: date,
        active_end: date,
        exclude_start: date,
        exclude_end: date,
        limit: int = 500,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Comme get_customer_churn_custom, mais retourne pour chaque churner :
        - infos profil (NAME, STATUS, KYC, BALANCE, ADDRESS, ID_*, GENDER, …)
        - localisation réseau (SECTOR, CITY, DEPARTMENT, ZONE)
        - LAST_TR_TYPE : type de la dernière transaction pendant la période active
        - LAST_TX : date de cette dernière transaction
        + total churn_count global pour KPI.
        """
        as_ymd = active_start.strftime('%Y%m%d')
        ae_ymd = active_end.strftime('%Y%m%d')
        es_ymd = exclude_start.strftime('%Y%m%d')
        ee_ymd = exclude_end.strftime('%Y%m%d')

        # Inner unions actifs (avec TR_TYPE + TRANSACTION_DATE → pour le LAST_TR_TYPE)
        # Pour _inner_union, end est exclusif → +1 jour
        as_end_str_excl = (active_end + timedelta(days=1)).strftime('%Y%m%d')
        active_inner = self._inner_union(as_ymd, as_end_str_excl, "", "")

        # Utilise les helpers communs — même logique que get_customer_churn_custom :
        # asymétrie ORIGINALAMOUNT IS NOT NULL (présent en credit partout + debit active,
        # ABSENT du debit exclude) → match exact du script de référence
        active_q  = self._churn_active_set_sql(as_ymd, ae_ymd)
        exclude_q = self._churn_exclude_set_sql(es_ymd, ee_ymd)

        query = f"""
        WITH churners AS (
            SELECT MSISDN FROM ({active_q})  AS a
            EXCEPT
            SELECT MSISDN FROM ({exclude_q}) AS e
        ),
        last_tx_per_churner AS (
            -- Pour chaque churner, dernière TR_TYPE + date dans la période active
            SELECT MSISDN, TR_TYPE AS LAST_TR_TYPE, TRANSACTION_DATE AS LAST_TX
            FROM (
                SELECT
                    MSISDN, TR_TYPE, TRANSACTION_DATE,
                    ROW_NUMBER() OVER (PARTITION BY MSISDN ORDER BY TRANSACTION_DATE DESC) AS tx_rn
                FROM ({active_inner})
                WHERE TR_TYPE IS NOT NULL
                  AND MSISDN IS NOT NULL
                  AND MSISDN IN (SELECT MSISDN FROM churners)
            ) AS ranked
            WHERE tx_rn = 1
        ),
        customer_info AS (
            SELECT
                IDENTITYMSISDN AS MSISDN,
                replace(IDENTITYNAME, '/', '') AS IDENTITYNAME,
                GENDER,
                IDENTITYSTATUS AS STATUS,
                CASE
                    WHEN TRUSTLEVEL = 'Registered Customer Level 0' THEN 'MINI WALLET'
                    WHEN TRUSTLEVEL = 'Registered Customer Level 1' THEN 'FULL WALLET'
                    ELSE 'OTHER'
                END AS KYC,
                ADDRESS, IMTOPTIN,
                IDNUMBER AS ID_NUMBER,
                IDTYPE AS ID_TYPE,
                REGEXP_REPLACE(IDNUMBER, '[ _-]', '') AS IDNUMBER_CLEAN,
                CASE WHEN REGEXP_LIKE(IDNUMBER, '[ _-]') THEN 'NO' ELSE 'YES' END AS ID_CLEAN,
                TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') AS ID_EXPIRY_DATE,
                CASE
                    WHEN TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') IS NULL THEN 'Unknown'
                    WHEN TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') <= current_date THEN 'Expired'
                    ELSE 'Valid'
                END AS ID_STATUS,
                to_date(DATEIDENTITYREGISTERED,'yyyyMMddHHmmss') AS CREATED_DATE,
                split(ACCOUNT, '\\\\^')[4] AS BALANCE,
                ROW_NUMBER() OVER (
                    PARTITION BY IDENTITYMSISDN
                    ORDER BY TO_DATE(LASTMODIFIED,'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
            WHERE IDENTITYTYPE = 'Customer'
              AND TO_DATE(DATE_CODE, 'yyyyMMdd') = (
                  SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd'))
                  FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
              )
              AND IDENTITYMSISDN IN (SELECT MSISDN FROM churners)
        ),
        latest_customer AS (SELECT * FROM customer_info WHERE rn = 1),
        location_data AS (
            SELECT MSISDN, SECTOR, CITY, DEPARTMENT, ZONE FROM (
                SELECT LO.MSISDN, SI.SECTOR, SI.CITY, SI.DEPARTMENT, SI.CLUSTERS AS ZONE,
                       ROW_NUMBER() OVER (PARTITION BY LO.MSISDN ORDER BY SI.SITE_CODE, SI.SECTOR) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                  AND LO.MSISDN IN (SELECT MSISDN FROM churners)
            ) WHERE loc_rn = 1
        )
        SELECT
            ch.MSISDN,
            c.IDENTITYNAME, c.GENDER, c.STATUS, c.KYC, c.BALANCE, c.ADDRESS, c.IMTOPTIN,
            c.ID_TYPE, c.ID_NUMBER, c.IDNUMBER_CLEAN, c.ID_CLEAN,
            c.ID_STATUS, c.ID_EXPIRY_DATE, c.CREATED_DATE,
            l.SECTOR, l.CITY, l.DEPARTMENT, l.ZONE,
            lt.LAST_TR_TYPE, lt.LAST_TX
        FROM churners ch
        LEFT JOIN latest_customer c ON ch.MSISDN = c.MSISDN
        LEFT JOIN location_data   l ON ch.MSISDN = l.MSISDN
        LEFT JOIN last_tx_per_churner lt ON ch.MSISDN = lt.MSISDN
        LIMIT {limit} OFFSET {offset}
        """

        # Comptage total — on itère la liste complète des MSISDN churners en tuples
        # (évite le bug pandas du driver databricks-sql-connector qui plante sur .scalar()
        # avec TypeError int(None) sur les colonnes nullable inférées).
        # Plus robuste que .scalar() + cohérent avec get_customer_churn_custom.
        count_query = f"""
        SELECT MSISDN FROM ({active_q})  AS a
        EXCEPT
        SELECT MSISDN FROM ({exclude_q}) AS e
        """

        rows_result = self.db.execute(text(query))
        rows = [dict(r) for r in rows_result.mappings()]

        # Compte robuste : on itère les tuples MSISDN du EXCEPT (pas de COUNT SQL,
        # pas de .scalar() → pas de bug pandas)
        total_count = 0
        try:
            count_result = self.db.execute(text(count_query))
            for _ in count_result:
                total_count += 1
        except Exception as e:
            print(f"[CHURN_CUSTOM_ENRICHED] count query failed: {e}")
            # Fallback ultime : au moins le nombre de rows retournés
            total_count = len(rows)

        print(f"[CHURN_CUSTOM_ENRICHED] active=[{active_start}, {active_end}] "
              f"exclude=[{exclude_start}, {exclude_end}] → total={total_count}, returned={len(rows)}")

        return {
            "active_window":  [active_start.strftime('%Y-%m-%d'),  active_end.strftime('%Y-%m-%d')],
            "exclude_window": [exclude_start.strftime('%Y-%m-%d'), exclude_end.strftime('%Y-%m-%d')],
            "churn_count": total_count,
            "rows": rows,
        }

    def iter_customer_churn_custom_enriched(
        self,
        active_start: date,
        active_end: date,
        exclude_start: date,
        exclude_end: date,
        limit: int = 2_000_000,
        offset: int = 0,
    ):
        """Générateur pour streaming export. Même SQL que get_*_enriched mais yield row par row."""
        data = self.get_customer_churn_custom_enriched(
            active_start, active_end, exclude_start, exclude_end, limit, offset
        )
        for row in data.get("rows", []):
            yield row

    def get_imt_churn(
        self,
        active_start: date,
        active_end: date,
        exclude_start: date,
        exclude_end: date,
        return_list: bool = False,
        limit: int = 100,
        department: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        MSISDN ayant reçu un IMT pendant la **période active** MAIS PAS pendant la **période exclude**.
        Enrichi avec la localisation réseau (DEPARTMENT, CITY) depuis
        ht_location + vw_dt_network_sites.

        Args:
            department: filtre optionnel par DEPARTMENT (case-insensitive)
        """
        as_ymd = active_start.strftime('%Y%m%d')
        ae_ymd = active_end.strftime('%Y%m%d')
        es_ymd = exclude_start.strftime('%Y%m%d')
        ee_ymd = exclude_end.strftime('%Y%m%d')

        def imt_set(start_ymd: str, end_ymd: str) -> str:
            return f"""
            SELECT DISTINCT CREDITPARTYIDENTIFIER AS MSISDN
            FROM hive_metastore.ods_dl.mfs_transaction_aml
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND CREDITPARTYTYPE = 'Customer'
              AND SERVICENAME = 'IMT revceiving'
              AND CREDITPARTYIDENTIFIER IS NOT NULL
            """

        active_q = imt_set(as_ymd, ae_ymd)
        exclude_q = imt_set(es_ymd, ee_ymd)

        # Filtre department (whitelist anti-injection — accepte lettres + espaces + accents)
        dept_filter = ""
        if department and department.strip() and department.strip().lower() != "all":
            import re as _re
            safe_dept = _re.sub(r"[^\w\s\-'À-ſ]", "", department.strip())
            if safe_dept:
                safe_dept_sql = safe_dept.replace("'", "''")
                dept_filter = f"AND UPPER(TRIM(l.DEPARTMENT)) = UPPER('{safe_dept_sql}')"

        query = f"""
        WITH churners AS (
            SELECT MSISDN FROM ({active_q})  AS a
            EXCEPT
            SELECT MSISDN FROM ({exclude_q}) AS e
        ),
        location_data AS (
            SELECT MSISDN, SECTOR, CITY, DEPARTMENT, ZONE
            FROM (
                SELECT
                    LO.MSISDN,
                    SI.SECTOR,
                    SI.CITY,
                    SI.DEPARTMENT,
                    SI.CLUSTERS AS ZONE,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                  AND LO.MSISDN IN (SELECT MSISDN FROM churners)
            ) loc_ranked
            WHERE loc_rn = 1
        )
        SELECT
            ch.MSISDN,
            COALESCE(l.DEPARTMENT, 'Unknown') AS DEPARTMENT,
            COALESCE(l.CITY,       'Unknown') AS CITY,
            COALESCE(l.CITY,       'Unknown') AS COMMUNE
        FROM churners ch
        LEFT JOIN location_data l ON ch.MSISDN = l.MSISDN
        WHERE 1=1 {dept_filter}
        ORDER BY l.DEPARTMENT, l.CITY, ch.MSISDN
        """

        all_rows: List[Dict[str, Any]] = []
        try:
            result = self.db.execute(text(query))
            for r in result.mappings():
                all_rows.append(dict(r))
        except Exception as e:
            print(f"[IMT_CHURN] enriched query failed, fallback to MSISDN-only: {e}")
            # Fallback : simple EXCEPT sans enrichissement si la jointure échoue
            simple_query = f"""
            SELECT MSISDN FROM ({active_q}) AS a
            EXCEPT
            SELECT MSISDN FROM ({exclude_q}) AS e
            """
            simple_result = self.db.execute(text(simple_query))
            for r in simple_result:
                v = r[0] if r else None
                if v is not None:
                    all_rows.append({"MSISDN": str(v),
                                     "DEPARTMENT": "Unknown", "CITY": "Unknown", "COMMUNE": "Unknown"})

        total_count = len(all_rows)
        print(f"[IMT_CHURN] active=[{active_start}, {active_end}] "
              f"exclude=[{exclude_start}, {exclude_end}] dept={department or 'All'} → total={total_count}")

        returned_rows: List[Dict[str, Any]] = []
        returned_msisdns: List[str] = []
        if return_list:
            rows_sorted = sorted(all_rows, key=lambda r: r.get("MSISDN") or "")
            cut = rows_sorted[:limit] if (limit and limit > 0) else rows_sorted
            returned_rows    = cut
            returned_msisdns = [str(r.get("MSISDN") or "") for r in cut]

        return {
            "active_window":  [active_start.strftime('%Y-%m-%d'),  active_end.strftime('%Y-%m-%d')],
            "exclude_window": [exclude_start.strftime('%Y-%m-%d'), exclude_end.strftime('%Y-%m-%d')],
            "churn_count": total_count,
            "msisdns":     returned_msisdns,   # backward-compat
            "rows":        returned_rows,      # MSISDN + DEPARTMENT + CITY
        }

    def get_transactions_summary(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        transaction_statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Aggregate counts/volume/charges over the FULL period without LIMIT.
        Returns a single row: { total_count, distinct_msisdn, total_volume, total_charge }.
        """
        start_str, end_str, sub_cred, sub_debt, outer = self._build_filters(
            start_date, end_date, msisdn_list, service_names, channels
        )
        inner = self._inner_union(start_str, end_str, sub_cred, sub_debt, transaction_statuses)

        query = f"""
        SELECT
            COUNT(*)                  AS TOTAL_COUNT,
            COUNT(DISTINCT MSISDN)    AS DISTINCT_MSISDN,
            COALESCE(SUM(ORIGINALAMOUNT), 0) AS TOTAL_VOLUME,
            COALESCE(SUM(CHARGEAMOUNT),  0) AS TOTAL_CHARGE
        FROM (
            SELECT DISTINCT
                TRANSACTIONID, TRANSACTION_DATE, MSISDN,
                ORIGINALAMOUNT, CHARGEAMOUNT, TR_TYPE
            FROM ({inner})
            WHERE 1=1 {outer}
        )
        """
        result = self.db.execute(text(query))
        row = result.mappings().first()
        if not row:
            return {"TOTAL_COUNT": 0, "DISTINCT_MSISDN": 0, "TOTAL_VOLUME": 0, "TOTAL_CHARGE": 0}
        return dict(row)
