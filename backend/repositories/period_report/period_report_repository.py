import logging
from sqlalchemy import text
from typing import Dict, Any
from datetime import date, datetime, timedelta

logger = logging.getLogger(__name__)


def _as_int(v) -> int:
    """Coerce any DB cell (None / int / float / Decimal / str) to a plain int. Never raises."""
    if v is None:
        return 0
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _as_float(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _pick(row: Dict[str, Any], key: str) -> Any:
    """Lookup that tolerates case-mismatch (Spark often lower-cases aliases)."""
    if key in row:
        return row[key]
    lc = key.lower()
    if lc in row:
        return row[lc]
    uc = key.upper()
    if uc in row:
        return row[uc]
    return None


class PeriodReportRepository:
    """
    Period Report — single endpoint computing eight KPIs over a user-chosen window.

    All MSISDN-side KPIs use the LATEST snapshot of mfs_mobile_banking_audit
    (TO_DATE(DATE_CODE,'yyyyMMdd') = MAX(...)) so the customer / merchant
    profile is point-in-time today. The "active vs dormant" partition is
    computed against MFS transactions in the period window.

    Note:
    - "Active" = at least 1 Completed MFS transaction in the period (any side).
    - "Dormant" = profile rows with IDENTITYSTATUS <> 'Closed' that are NOT in
      the active set.
    - "Registered in period" uses DATEIDENTITYREGISTERED (yyyyMMddHHmmss).
    """

    CUSTOMER_AUDIT_TABLE = "gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit"
    TX_TABLE             = "hive_metastore.ods_dl.mfs_transaction_aml"

    def __init__(self, db):
        self.db = db

    # ── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _to_ymd(d) -> str:
        """Accept 'YYYY-MM-DD' string or date / datetime → returns 'YYYYMMDD'."""
        if isinstance(d, (date, datetime)):
            return d.strftime('%Y%m%d')
        s = str(d).strip()
        # 'YYYY-MM-DD' → 'YYYYMMDD'
        return s.replace("-", "").replace("/", "")[:8]

    @staticmethod
    def _to_iso(d) -> str:
        if isinstance(d, (date, datetime)):
            return d.strftime('%Y-%m-%d')
        s = str(d).strip()
        # already iso?
        if len(s) >= 10 and s[4] == '-':
            return s[:10]
        # yyyyMMdd → yyyy-MM-dd
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"

    def _one(self, label: str, query: str) -> Dict[str, Any]:
        """Run a query that must return a single aggregated row. Logs + isolates failures."""
        try:
            row = next(iter(self.db.execute(text(query)).mappings()), None)
            return dict(row) if row else {}
        except Exception as e:
            # Log the exact query that broke so the failure is attributable.
            logger.exception("[PERIOD_REPORT] sub-query '%s' failed: %s", label, e)
            return {}

    # ── KPIs ─────────────────────────────────────────────────────────────────

    def get_period_report(self, start_date, end_date) -> Dict[str, Any]:
        start_iso = self._to_iso(start_date)
        end_iso   = self._to_iso(end_date)
        start_ymd = self._to_ymd(start_date)
        end_ymd   = self._to_ymd(end_date)

        # ───── 1) Customer accounts REGISTERED in the period — by gender ─────
        q_registered_customers = f"""
        SELECT
            CAST(COUNT(*) AS STRING)                                                                              AS TOTAL,
            CAST(COUNT(CASE WHEN UPPER(GENDER) IN ('FEMALE','F') THEN 1 END) AS STRING)                            AS FEMALE,
            CAST(COUNT(CASE WHEN UPPER(GENDER) IN ('MALE','M')   THEN 1 END) AS STRING)                            AS MALE,
            CAST(COUNT(CASE WHEN GENDER IS NULL OR TRIM(GENDER) = ''
                        OR UPPER(GENDER) NOT IN ('FEMALE','F','MALE','M') THEN 1 END) AS STRING)                   AS UNKNOWN
        FROM (
            SELECT
                IDENTITYMSISDN,
                GENDER,
                ROW_NUMBER() OVER (
                    PARTITION BY IDENTITYMSISDN
                    ORDER BY TO_DATE(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM {self.CUSTOMER_AUDIT_TABLE}
            WHERE IDENTITYTYPE = 'Customer'
              AND DATE(TO_DATE(DATEIDENTITYREGISTERED, 'yyyyMMddHHmmss'))
                  BETWEEN DATE('{start_iso}') AND DATE('{end_iso}')
        ) WHERE rn = 1
        """

        # ───── 2) Customer accounts ACTIVE in the period — by gender ─────
        # Active = MSISDN appears (CREDIT or DEBIT, type=Customer) in ≥1 Completed tx during the period.
        q_active_customers = f"""
        WITH active_msisdns AS (
            SELECT DISTINCT CREDITPARTYIDENTIFIER AS MSISDN
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'
              AND CREDITPARTYIDENTIFIER IS NOT NULL
            UNION
            SELECT DISTINCT DEBITPARTYIDENTIFIER AS MSISDN
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND DEBITPARTYTYPE = 'Customer'
              AND DEBITPARTYIDENTIFIER IS NOT NULL
        ),
        customer_profile AS (
            SELECT IDENTITYMSISDN, GENDER FROM (
                SELECT
                    IDENTITYMSISDN, GENDER, IDENTITYSTATUS,
                    ROW_NUMBER() OVER (
                        PARTITION BY IDENTITYMSISDN
                        ORDER BY TO_DATE(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM {self.CUSTOMER_AUDIT_TABLE}
                WHERE IDENTITYTYPE = 'Customer'
                  AND TO_DATE(DATE_CODE,'yyyyMMdd') = (
                      SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM {self.CUSTOMER_AUDIT_TABLE}
                  )
            ) WHERE rn = 1
        )
        SELECT
            CAST(COUNT(*) AS STRING)                                                                              AS TOTAL,
            CAST(COUNT(CASE WHEN UPPER(c.GENDER) IN ('FEMALE','F') THEN 1 END) AS STRING)                          AS FEMALE,
            CAST(COUNT(CASE WHEN UPPER(c.GENDER) IN ('MALE','M')   THEN 1 END) AS STRING)                          AS MALE,
            CAST(COUNT(CASE WHEN c.GENDER IS NULL OR TRIM(c.GENDER) = ''
                        OR UPPER(c.GENDER) NOT IN ('FEMALE','F','MALE','M') THEN 1 END) AS STRING)                 AS UNKNOWN
        FROM active_msisdns a
        INNER JOIN customer_profile c ON a.MSISDN = c.IDENTITYMSISDN
        """

        # ───── 3) Customer accounts DORMANT in the period — by gender ─────
        # Dormant = current customer profile, IDENTITYSTATUS != 'Closed', NOT in active set.
        q_dormant_customers = f"""
        WITH customer_profile AS (
            SELECT IDENTITYMSISDN, GENDER FROM (
                SELECT
                    IDENTITYMSISDN, GENDER, IDENTITYSTATUS,
                    ROW_NUMBER() OVER (
                        PARTITION BY IDENTITYMSISDN
                        ORDER BY TO_DATE(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM {self.CUSTOMER_AUDIT_TABLE}
                WHERE IDENTITYTYPE = 'Customer'
                  AND TO_DATE(DATE_CODE,'yyyyMMdd') = (
                      SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM {self.CUSTOMER_AUDIT_TABLE}
                  )
            ) WHERE rn = 1 AND IDENTITYSTATUS <> 'Closed'
        ),
        active_msisdns AS (
            SELECT DISTINCT CREDITPARTYIDENTIFIER AS MSISDN
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'
              AND CREDITPARTYIDENTIFIER IS NOT NULL
            UNION
            SELECT DISTINCT DEBITPARTYIDENTIFIER AS MSISDN
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND DEBITPARTYTYPE = 'Customer'
              AND DEBITPARTYIDENTIFIER IS NOT NULL
        )
        SELECT
            CAST(COUNT(*) AS STRING)                                                                              AS TOTAL,
            CAST(COUNT(CASE WHEN UPPER(c.GENDER) IN ('FEMALE','F') THEN 1 END) AS STRING)                          AS FEMALE,
            CAST(COUNT(CASE WHEN UPPER(c.GENDER) IN ('MALE','M')   THEN 1 END) AS STRING)                          AS MALE,
            CAST(COUNT(CASE WHEN c.GENDER IS NULL OR TRIM(c.GENDER) = ''
                        OR UPPER(c.GENDER) NOT IN ('FEMALE','F','MALE','M') THEN 1 END) AS STRING)                 AS UNKNOWN
        FROM customer_profile c
        WHERE c.IDENTITYMSISDN NOT IN (
            SELECT MSISDN FROM active_msisdns WHERE MSISDN IS NOT NULL
        )
        """

        # Merchant identity canonique (aligné sur le script de référence métier) :
        #   PRODUCTS = '[Merchant Product]'  (match exact, pas substring)
        #   DATE_CODE = snapshot le plus récent  (point-in-time, pas l'historique)
        #   ROW_NUMBER PARTITION BY ORGANIZATIONSHORTCODE ORDER BY LASTMODIFIED DESC
        #   keep rn = 1
        # NB : on n'utilise PLUS `IDENTITYTYPE = 'Organization'` car ça inclut aussi
        #      les Billers, Prefunded organizations, etc.
        merchant_credit_services = (
            "'Agent Payment to Merchant','Merchant Payment','Merchant Payment to Merchant',"
            "'Merchant QR Payment','Merchant Till payment','Merchant to Merchant Payment via Till ID',"
            "'Merchant Online Payment','Merchant Cashout','Agent/Merchant Bill Payment'"
        )
        merchant_debit_services = (
            "'Merchant Cashout','Agent/Merchant Bill Payment',"
            "'Merchant Payment to Merchant','Merchant to Merchant Payment via Till ID'"
        )

        # ───── 4) Merchants REGISTERED in the period ─────
        # Aligné 1:1 sur le script de référence métier.
        q_registered_merchants = f"""
        SELECT CAST(COUNT(*) AS STRING) AS TOTAL
        FROM (
            SELECT
                ORGANIZATIONSHORTCODE,
                ROW_NUMBER() OVER (
                    PARTITION BY ORGANIZATIONSHORTCODE
                    ORDER BY TO_DATE(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM {self.CUSTOMER_AUDIT_TABLE}
            WHERE PRODUCTS = '[Merchant Product]'
              AND TO_DATE(DATE_CODE,'yyyyMMdd') = (
                  SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM {self.CUSTOMER_AUDIT_TABLE}
              )
              AND ORGANIZATIONSHORTCODE IS NOT NULL
              AND TRIM(ORGANIZATIONSHORTCODE) <> ''
              AND DATEIDENTITYREGISTERED IS NOT NULL
              AND TO_DATE(DATEIDENTITYREGISTERED, 'yyyyMMddHHmmss') >= TO_DATE('{start_iso}')
              AND TO_DATE(DATEIDENTITYREGISTERED, 'yyyyMMddHHmmss') <= TO_DATE('{end_iso}')
        ) WHERE rn = 1
        """

        # ───── 5) Merchants ACTIVE in the period ─────
        # Active merchant = appartient au merchant_profile courant ET a au moins une
        # transaction Completed (CREDIT ou DEBIT) dans la fenêtre.
        # On contraint au merchant_profile pour éviter de compter des shortcodes
        # fantômes vus en tx mais qui ne sont pas (plus) des merchants enregistrés.
        q_active_merchants = f"""
        WITH merchant_profile AS (
            SELECT ORGANIZATIONSHORTCODE FROM (
                SELECT
                    ORGANIZATIONSHORTCODE,
                    ROW_NUMBER() OVER (
                        PARTITION BY ORGANIZATIONSHORTCODE
                        ORDER BY TO_DATE(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM {self.CUSTOMER_AUDIT_TABLE}
                WHERE PRODUCTS = '[Merchant Product]'
                  AND TO_DATE(DATE_CODE,'yyyyMMdd') = (
                      SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM {self.CUSTOMER_AUDIT_TABLE}
                  )
                  AND ORGANIZATIONSHORTCODE IS NOT NULL
                  AND TRIM(ORGANIZATIONSHORTCODE) <> ''
            ) WHERE rn = 1
        ),
        active_tx AS (
            SELECT DISTINCT CREDITPARTYIDENTIFIER AS ORG_ID
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND SERVICENAME IN ({merchant_credit_services})
              AND CREDITPARTYIDENTIFIER IS NOT NULL
            UNION
            SELECT DISTINCT DEBITPARTYIDENTIFIER AS ORG_ID
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND SERVICENAME IN ({merchant_debit_services})
              AND DEBITPARTYIDENTIFIER IS NOT NULL
        )
        SELECT CAST(COUNT(*) AS STRING) AS TOTAL
        FROM merchant_profile mp
        WHERE mp.ORGANIZATIONSHORTCODE IN (
            SELECT ORG_ID FROM active_tx WHERE ORG_ID IS NOT NULL
        )
        """

        # ───── 6) Merchants DORMANT in the period ─────
        # Dormant = merchant_profile courant (PRODUCTS='[Merchant Product]', latest snapshot,
        # IDENTITYSTATUS <> 'Closed') ET pas dans le set actif.
        q_dormant_merchants = f"""
        WITH merchant_profile AS (
            SELECT ORGANIZATIONSHORTCODE FROM (
                SELECT
                    ORGANIZATIONSHORTCODE,
                    IDENTITYSTATUS,
                    ROW_NUMBER() OVER (
                        PARTITION BY ORGANIZATIONSHORTCODE
                        ORDER BY TO_DATE(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM {self.CUSTOMER_AUDIT_TABLE}
                WHERE PRODUCTS = '[Merchant Product]'
                  AND TO_DATE(DATE_CODE,'yyyyMMdd') = (
                      SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM {self.CUSTOMER_AUDIT_TABLE}
                  )
                  AND ORGANIZATIONSHORTCODE IS NOT NULL
                  AND TRIM(ORGANIZATIONSHORTCODE) <> ''
            ) WHERE rn = 1 AND IDENTITYSTATUS <> 'Closed'
        ),
        active_tx AS (
            SELECT DISTINCT CREDITPARTYIDENTIFIER AS ORG_ID
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND SERVICENAME IN ({merchant_credit_services})
              AND CREDITPARTYIDENTIFIER IS NOT NULL
            UNION
            SELECT DISTINCT DEBITPARTYIDENTIFIER AS ORG_ID
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND ORIGINALAMOUNT IS NOT NULL
              AND SERVICENAME IN ({merchant_debit_services})
              AND DEBITPARTYIDENTIFIER IS NOT NULL
        )
        SELECT CAST(COUNT(*) AS STRING) AS TOTAL
        FROM merchant_profile mp
        WHERE mp.ORGANIZATIONSHORTCODE NOT IN (
            SELECT ORG_ID FROM active_tx WHERE ORG_ID IS NOT NULL
        )
        """

        # ───── 7 + 8) Volume + Value — all completed MFS transactions in the period ─────
        q_volume_value = f"""
        SELECT
            CAST(COUNT(DISTINCT TRANSACTIONID) AS STRING)         AS VOLUME,
            CAST(COALESCE(SUM(ORIGINALAMOUNT), 0) AS STRING)      AS VALUE,
            CAST(COALESCE(SUM(CHARGEAMOUNT),  0) AS STRING)       AS REVENUE
        FROM {self.TX_TABLE}
        WHERE PROCESS_DATE >= '{start_ymd}' AND PROCESS_DATE <= '{end_ymd}'
          AND TRANSACTIONSTATUS = 'Completed'
          AND ORIGINALAMOUNT IS NOT NULL
        """

        # Run sequentially — each query is independently logged & isolated so one
        # broken sub-query doesn't take down the whole report.
        reg_cust   = self._one("registered_customers", q_registered_customers)
        act_cust   = self._one("active_customers",     q_active_customers)
        dor_cust   = self._one("dormant_customers",    q_dormant_customers)
        reg_merch  = self._one("registered_merchants", q_registered_merchants)
        act_merch  = self._one("active_merchants",     q_active_merchants)
        dor_merch  = self._one("dormant_merchants",    q_dormant_merchants)
        vol_val    = self._one("volume_value",         q_volume_value)

        # Visibility log — dump the raw rows so we can see if Spark returned a row
        # at all (vs. an empty result that defaults to 0).
        logger.info("[PERIOD_REPORT] window=%s→%s | reg_cust=%s act_cust=%s dor_cust=%s "
                    "reg_merch=%s act_merch=%s dor_merch=%s vol_val=%s",
                    start_iso, end_iso,
                    reg_cust, act_cust, dor_cust,
                    reg_merch, act_merch, dor_merch, vol_val)

        def gender_block(row: Dict[str, Any]) -> Dict[str, int]:
            return {
                "TOTAL":   _as_int(_pick(row, "TOTAL")),
                "FEMALE":  _as_int(_pick(row, "FEMALE")),
                "MALE":    _as_int(_pick(row, "MALE")),
                "UNKNOWN": _as_int(_pick(row, "UNKNOWN")),
            }

        return {
            "period":  { "start": start_iso, "end": end_iso },
            "customers": {
                "registered": gender_block(reg_cust),
                "active":     gender_block(act_cust),
                "dormant":    gender_block(dor_cust),
            },
            "merchants": {
                "registered": _as_int(_pick(reg_merch, "TOTAL")),
                "active":     _as_int(_pick(act_merch, "TOTAL")),
                "dormant":    _as_int(_pick(dor_merch, "TOTAL")),
            },
            "transactions": {
                "volume":  _as_int(_pick(vol_val,  "VOLUME")),
                "value":   _as_float(_pick(vol_val, "VALUE")),
                "revenue": _as_float(_pick(vol_val, "REVENUE")),
            },
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Channel × Category matrix report
    # ─────────────────────────────────────────────────────────────────────────
    #
    # Reproduces the "Rapport par canal × type d'opération" table used by
    # Compliance / Reporting. The base SQL below is a 1:1 copy of the reference
    # script provided by the business team — DO NOT alter TR_TYPE mappings or
    # the SERVICENAME whitelist without their sign-off.
    #
    # Category columns (channel groups) :
    #   - Opération via téléphone mobile : USSD_Digicel  (USSD = protocole telecom mobile)
    #   - Opération via carte            : (currently empty — no channel maps here)
    #   - Opération en ligne             : API, APP, QR  (canaux data / internet)
    #   - Total                          : sum across ALL channels present
    #
    # Row labels (TR_TYPE groups) :
    #   - Recharge téléphonique             = SELF_TOPUP + TOPUP_GIFT
    #   - Dépôts en cash                     = CASHIN + 'Cash In Self'
    #   - Retraits de Cash                   = CASHOUT
    #   - Transfert personne à personne      = P2P_RECEIVE + SUBSCRIBERP2P
    #   - Transfert personne à entreprise    = (empty — no TR_TYPE maps here)
    #   - Paiement de facture                = BILLPAY
    #   - Paiement marchand affilié          = PAY2MERC
    #   - Paiements de salaires              = (empty)
    #   - Autres (à spécifier)               = every TR_TYPE not covered above
    # ─────────────────────────────────────────────────────────────────────────

    CATEGORY_DEFS = [
        ("mobile", "Opération via téléphone mobile", {"USSD_Digicel"}),
        ("card",   "Opération via carte",            set()),
        ("online", "Opération en ligne",             {"API", "APP", "QR"}),
    ]

    ROW_DEFS = [
        ("topup",     "Recharge téléphonique",             {"SELF_TOPUP", "TOPUP_GIFT"}),
        ("deposit",   "Dépôts en cash",                    {"CASHIN", "Cash In Self"}),
        ("withdraw",  "Retraits de Cash",                  {"CASHOUT"}),
        ("p2p",       "Transfert personne à personne",     {"P2P_RECEIVE", "SUBSCRIBERP2P"}),
        ("p2b",       "Transfert personne à entreprise",   set()),
        ("billpay",   "Paiement de facture",               {"BILLPAY"}),
        ("merchant",  "Paiement marchand affilié",         {"PAY2MERC"}),
        ("salary",    "Paiements de salaires",             set()),
        # "other" is the residual — computed dynamically from unmapped TR_TYPEs
        ("other",     "Autres (à spécifier)",              set()),
    ]

    # ─────────────────────────────────────────────────────────────────────────
    # Regulatory report — point-in-time snapshot at a reference date
    # ─────────────────────────────────────────────────────────────────────────
    #
    # Reproduces the compliance report layout with a single "Trimestre courant"
    # column. Rows are populated one query at a time as the business team
    # provides the reference SQL. Any row not yet implemented returns None,
    # which the frontend renders as an empty cell (dash).
    #
    # The reference_date is the point-in-time anchor :
    #   - "registered" queries hit the audit snapshot where DATE_CODE = reference
    #   - "active / dormant" queries evaluate the last 90 days ending at reference
    # ─────────────────────────────────────────────────────────────────────────

    def get_regulatory_report(self, reference_date) -> Dict[str, Any]:
        ref_iso = self._to_iso(reference_date)
        ref_ymd = self._to_ymd(reference_date)

        # ─ Row : Nombre de comptes de fonds de paiement électronique enregistrés ─
        # Reference SQL provided by the business team :
        #   WITH withouDoublon AS (
        #       SELECT DISTINCT IDENTITYMSISDN, GENDER
        #       FROM {AUDIT}
        #       WHERE TO_DATE(DATE_CODE,'yyyyMMdd') = TO_DATE('YYYYMMDD','yyyyMMdd')
        #         AND IDENTITYTYPE = 'Customer'
        #   )
        #   SELECT CASE WHEN GENDER='Male' THEN 'Homme' ELSE 'Femme' END AS Sex,
        #          COUNT(IDENTITYMSISDN) AS count
        #   FROM withouDoublon GROUP BY Sex ;
        #
        # NB : the mapping treats every non-'Male' value (NULL, 'Female', 'F', '',
        # unknown) as 'Femme' — faithful to the business team's SQL.
        q_accounts_registered = f"""
        WITH withouDoublon AS (
            SELECT DISTINCT
                IDENTITYMSISDN,
                GENDER
            FROM {self.CUSTOMER_AUDIT_TABLE}
            WHERE TO_DATE(DATE_CODE,'yyyyMMdd') = TO_DATE('{ref_ymd}','yyyyMMdd')
              AND IDENTITYTYPE = 'Customer'
        )
        SELECT
            CAST(COUNT(CASE WHEN GENDER = 'Male' THEN 1 END)             AS STRING) AS HOMME,
            CAST(COUNT(CASE WHEN GENDER IS NULL OR GENDER <> 'Male' THEN 1 END) AS STRING) AS FEMME
        FROM withouDoublon
        """

        acc_reg = self._one("regulatory.accounts_registered", q_accounts_registered)

        # ─ Row : Nombre de comptes de fonds de paiement électronique actifs
        #        (au moins une transaction au cours des 90 derniers jours) ─
        # Reference SQL provided by the business team joins the customer
        # profile (latest snapshot at ref) with the union of MSISDNs that
        # have had a Success/Completed transaction in the 90 days ending at
        # ref. Gender is then mapped (Male → Homme, else → Femme) to fit the
        # compliance report layout.
        try:
            ref_dt = datetime.strptime(ref_ymd, "%Y%m%d")
        except Exception:
            ref_dt = datetime.combine(date.today(), datetime.min.time())
        # 90-day window : [ref-90d, ref] inclusive → [ref-90d, ref+1d) exclusive
        start_ymd_90 = (ref_dt - timedelta(days=90)).strftime("%Y%m%d")
        end_ymd_excl = (ref_dt + timedelta(days=1)).strftime("%Y%m%d")

        # Whitelist of SERVICENAME on each side — 1:1 with the reference script.
        credit_services = (
            "'Cash In', 'P2P Transfer',"
            "'Send Money to Registered Customer by QR Code',"
            "'Cash In OTC', 'OD Money Transfer Prefunded',"
            "'IMT revceiving', 'Money Transfer Prefunded',"
            "'Bulk B2C transfer'"
        )
        debit_services = (
            "'Cash Out', 'Merchant Cashout', 'Customer Bill Payment',"
            "'Agent/Merchant Bill Payment', 'Merchant Payment to Merchant',"
            "'Merchant Payment', 'Merchant QR Payment', 'Merchant Till payment',"
            "'Merchant to Merchant Payment via Till ID', 'Merchant Online Payment',"
            "'P2P Transfer', 'Send Money to Registered Customer by QR Code',"
            "'Prepaid Top up', 'Gift Top up', 'OTC Top Up', 'Wallet to Bank'"
        )

        q_accounts_active = f"""
        SELECT
            CAST(COUNT(DISTINCT CASE WHEN A1.GENDER = 'Male'
                                THEN A1.MSISDN END)                             AS STRING) AS HOMME,
            CAST(COUNT(DISTINCT CASE WHEN A1.GENDER IS NULL
                                  OR A1.GENDER <> 'Male'
                                THEN A1.MSISDN END)                             AS STRING) AS FEMME
        FROM (
            SELECT DISTINCT IDENTITYMSISDN AS MSISDN, GENDER
            FROM {self.CUSTOMER_AUDIT_TABLE}
            WHERE TO_DATE(DATE_CODE, 'yyyyMMdd') = TO_DATE('{ref_ymd}', 'yyyyMMdd')
              AND IDENTITYTYPE = 'Customer'
        ) A1
        INNER JOIN (
            SELECT DISTINCT CREDITPARTYIDENTIFIER AS MSISDN
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd_90}'
              AND PROCESS_DATE <  '{end_ymd_excl}'
              AND TRANSACTIONSTATUS IN ('Success', 'Completed')
              AND SERVICENAME IN ({credit_services})
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'
            UNION
            SELECT DISTINCT DEBITPARTYIDENTIFIER AS MSISDN
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd_90}'
              AND PROCESS_DATE <  '{end_ymd_excl}'
              AND TRANSACTIONSTATUS IN ('Success', 'Completed')
              AND SERVICENAME IN ({debit_services})
              AND ORIGINALAMOUNT IS NOT NULL
              AND DEBITPARTYTYPE = 'Customer'
        ) A2
          ON A1.MSISDN = A2.MSISDN
        """

        acc_act = self._one("regulatory.accounts_active_90d", q_accounts_active)

        # ─ Row : Nombre de comptes de fonds de paiement électronique dormants
        #        (aucune transaction au cours des 90 derniers jours) ─
        # Reference SQL : LEFT JOIN identity base with transaction base (90 j),
        # keep rows where the identity has NO matching MSISDN in transactions.
        # Same SERVICENAME whitelists as the active query; only difference is
        # the reference SQL uses TRANSACTIONSTATUS = 'Completed' (not 'Success'
        # OR 'Completed') — we reproduce that faithfully.
        q_accounts_dormant = f"""
        WITH base_identity AS (
            SELECT DISTINCT IDENTITYMSISDN AS MSISDN, GENDER
            FROM {self.CUSTOMER_AUDIT_TABLE}
            WHERE TO_DATE(DATE_CODE, 'yyyyMMdd') = TO_DATE('{ref_ymd}', 'yyyyMMdd')
              AND IDENTITYTYPE = 'Customer'
        ),
        base_transactions AS (
            SELECT DISTINCT MSISDN FROM (
                SELECT CREDITPARTYIDENTIFIER AS MSISDN
                FROM {self.TX_TABLE}
                WHERE PROCESS_DATE >= '{start_ymd_90}'
                  AND PROCESS_DATE <  '{end_ymd_excl}'
                  AND TRANSACTIONSTATUS = 'Completed'
                  AND SERVICENAME IN ({credit_services})
                  AND ORIGINALAMOUNT IS NOT NULL
                  AND CREDITPARTYTYPE = 'Customer'
                UNION
                SELECT DEBITPARTYIDENTIFIER AS MSISDN
                FROM {self.TX_TABLE}
                WHERE PROCESS_DATE >= '{start_ymd_90}'
                  AND PROCESS_DATE <  '{end_ymd_excl}'
                  AND TRANSACTIONSTATUS = 'Completed'
                  AND SERVICENAME IN ({debit_services})
                  AND ORIGINALAMOUNT IS NOT NULL
                  AND DEBITPARTYTYPE = 'Customer'
            )
        )
        SELECT
            CAST(COUNT(DISTINCT CASE WHEN i.GENDER = 'Male'
                                THEN i.MSISDN END)                              AS STRING) AS HOMME,
            CAST(COUNT(DISTINCT CASE WHEN i.GENDER IS NULL
                                  OR i.GENDER <> 'Male'
                                THEN i.MSISDN END)                              AS STRING) AS FEMME
        FROM base_identity i
        LEFT JOIN base_transactions t
            ON i.MSISDN = t.MSISDN
        WHERE t.MSISDN IS NULL
        """

        acc_dor = self._one("regulatory.accounts_dormant_90d", q_accounts_dormant)

        # ─ Row : Nombre de commerçants affiliés enregistrés ─
        # Compliance interpretation (matches the reference report layout : the
        # figure is much smaller than active+dormant → it's NEW registrations
        # in the quarter, not the total merchant base).
        # Merchants = PRODUCTS = '[Merchant Product]' (exact match, not LIKE).
        # Window = 90 days ending at reference (aligned with Q2 : Apr 1 → Jun 30
        # when reference = Jun 30).
        # ROW_NUMBER() PARTITION BY ORGANIZATIONSHORTCODE ORDER BY LASTMODIFIED
        # DESC keeps only the latest snapshot per merchant.
        start_iso_90 = (ref_dt - timedelta(days=90)).strftime("%Y-%m-%d")

        q_merchants_registered = f"""
        SELECT CAST(COUNT(*) AS STRING) AS TOTAL
        FROM (
            SELECT
                ORGANIZATIONSHORTCODE,
                ROW_NUMBER() OVER (
                    PARTITION BY ORGANIZATIONSHORTCODE
                    ORDER BY TO_DATE(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM {self.CUSTOMER_AUDIT_TABLE}
            WHERE PRODUCTS = '[Merchant Product]'
              AND TO_DATE(DATE_CODE, 'yyyyMMdd') = TO_DATE('{ref_ymd}', 'yyyyMMdd')
              AND ORGANIZATIONSHORTCODE IS NOT NULL
              AND TRIM(ORGANIZATIONSHORTCODE) <> ''
              AND DATEIDENTITYREGISTERED IS NOT NULL
              AND TO_DATE(DATEIDENTITYREGISTERED, 'yyyyMMddHHmmss') >= TO_DATE('{start_iso_90}')
              AND TO_DATE(DATEIDENTITYREGISTERED, 'yyyyMMddHHmmss') <= TO_DATE('{ref_iso}')
        ) WHERE rn = 1
        """

        merch_reg = self._one("regulatory.merchants_registered", q_merchants_registered)

        # ─ Row : Nombre de commerçants affiliés actifs ─
        # PRODUCTS = '[Merchant Product]' (exact match) — aligned with rows 8
        # (registered) and 10 (dormant) so that (active + dormant) sits inside
        # the same universe. Excludes '[Merchant Product][Master Agent]' as
        # requested by the business team.
        # TRANS side unions ALL Completed transactions in the 90-day window on
        # either CREDIT or DEBIT side. Note : the reference script asymmetrically
        # applies ORIGINALAMOUNT IS NOT NULL on CREDIT side only — reproduced
        # faithfully.
        q_merchants_active = f"""
        WITH MERCHANT AS (
            SELECT ORGANIZATIONSHORTCODE AS MERCHANT_SHORT_CODE FROM (
                SELECT
                    ORGANIZATIONSHORTCODE,
                    ROW_NUMBER() OVER (
                        PARTITION BY ORGANIZATIONSHORTCODE
                        ORDER BY TO_TIMESTAMP(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM {self.CUSTOMER_AUDIT_TABLE}
                WHERE PRODUCTS = '[Merchant Product]'
                  AND TO_DATE(DATE_CODE, 'yyyyMMdd') = TO_DATE('{ref_ymd}', 'yyyyMMdd')
                  AND ORGANIZATIONSHORTCODE IS NOT NULL
                  AND TRIM(ORGANIZATIONSHORTCODE) <> ''
            ) WHERE rn = 1
        ),
        TRANS AS (
            SELECT DISTINCT MSISDN FROM (
                SELECT CREDITPARTYIDENTIFIER AS MSISDN
                FROM {self.TX_TABLE}
                WHERE PROCESS_DATE >= '{start_ymd_90}'
                  AND PROCESS_DATE <  '{end_ymd_excl}'
                  AND TRANSACTIONSTATUS = 'Completed'
                  AND ORIGINALAMOUNT IS NOT NULL
                UNION ALL
                SELECT DEBITPARTYIDENTIFIER AS MSISDN
                FROM {self.TX_TABLE}
                WHERE PROCESS_DATE >= '{start_ymd_90}'
                  AND PROCESS_DATE <  '{end_ymd_excl}'
                  AND TRANSACTIONSTATUS = 'Completed'
            )
        )
        SELECT CAST(COUNT(DISTINCT MR.MERCHANT_SHORT_CODE) AS STRING) AS TOTAL
        FROM MERCHANT MR
        INNER JOIN TRANS TR
            ON MR.MERCHANT_SHORT_CODE = TR.MSISDN
        """

        merch_act = self._one("regulatory.merchants_active_90d", q_merchants_active)

        # ─ Row : Nombre de commerçants affiliés dormants ─
        # Same logic as the "active" query, but :
        #   1. PRODUCTS = '[Merchant Product]' (exact match) — restricts to
        #      pure merchants, EXCLUDING '[Merchant Product][Master Agent]'
        #      as explicitly requested by the business team.
        #   2. LEFT JOIN + WHERE TR.MSISDN IS NULL — keeps merchants with NO
        #      matching transaction in the 90-day window.
        q_merchants_dormant = f"""
        WITH MERCHANT AS (
            SELECT ORGANIZATIONSHORTCODE AS MERCHANT_SHORT_CODE FROM (
                SELECT
                    ORGANIZATIONSHORTCODE,
                    ROW_NUMBER() OVER (
                        PARTITION BY ORGANIZATIONSHORTCODE
                        ORDER BY TO_TIMESTAMP(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM {self.CUSTOMER_AUDIT_TABLE}
                WHERE PRODUCTS = '[Merchant Product]'
                  AND TO_DATE(DATE_CODE, 'yyyyMMdd') = TO_DATE('{ref_ymd}', 'yyyyMMdd')
                  AND ORGANIZATIONSHORTCODE IS NOT NULL
                  AND TRIM(ORGANIZATIONSHORTCODE) <> ''
            ) WHERE rn = 1
        ),
        TRANS AS (
            SELECT DISTINCT MSISDN FROM (
                SELECT CREDITPARTYIDENTIFIER AS MSISDN
                FROM {self.TX_TABLE}
                WHERE PROCESS_DATE >= '{start_ymd_90}'
                  AND PROCESS_DATE <  '{end_ymd_excl}'
                  AND TRANSACTIONSTATUS = 'Completed'
                  AND ORIGINALAMOUNT IS NOT NULL
                UNION ALL
                SELECT DEBITPARTYIDENTIFIER AS MSISDN
                FROM {self.TX_TABLE}
                WHERE PROCESS_DATE >= '{start_ymd_90}'
                  AND PROCESS_DATE <  '{end_ymd_excl}'
                  AND TRANSACTIONSTATUS = 'Completed'
            )
        )
        SELECT CAST(COUNT(DISTINCT MR.MERCHANT_SHORT_CODE) AS STRING) AS TOTAL
        FROM MERCHANT MR
        LEFT JOIN TRANS TR
            ON MR.MERCHANT_SHORT_CODE = TR.MSISDN
        WHERE TR.MSISDN IS NULL
        """

        merch_dor = self._one("regulatory.merchants_dormant_90d", q_merchants_dormant)

        # ─ Rows : Nombre total de transactions + Valeur totale (milliers HTG) ─
        # Reference SQL provided by the business team (2026-07-15 correction) :
        #   - TRANSACTIONSTATUS = 'Completed' only (not 'Success').
        #   - Narrower SERVICENAME whitelists on both credit and debit sides
        #     (Prefunded / IMT / Bulk B2C removed from credit ; OTC Top Up +
        #     Wallet to Bank removed from debit).
        #   - UNION ALL (not UNION) — P2P transactions between two customers
        #     are counted TWICE by design here (once as sender event, once
        #     as receiver event) — this is the compliance interpretation.
        #   - MSISDN kept inside the inner SELECT DISTINCT to preserve the
        #     UNION ALL semantics vs the credit/debit side.
        # Row 12 exposes the raw HTG sum (the field name mentions "thousands"
        # for legacy reasons — no /1000 conversion is applied).
        credit_services_tx = (
            "'Cash In', 'P2P Transfer',"
            "'Send Money to Registered Customer by QR Code',"
            "'Cash In OTC'"
        )
        debit_services_tx = (
            "'Cash Out', 'Merchant Cashout', 'Customer Bill Payment',"
            "'Agent/Merchant Bill Payment', 'Merchant Payment to Merchant',"
            "'Merchant Payment', 'Merchant QR Payment', 'Merchant Till payment',"
            "'Merchant to Merchant Payment via Till ID', 'Merchant Online Payment',"
            "'P2P Transfer', 'Send Money to Registered Customer by QR Code',"
            "'Prepaid Top up', 'Gift Top up'"
        )
        q_transactions = f"""
        SELECT
            CAST(COUNT(TRANSACTIONID)            AS STRING) AS VOLUME,
            CAST(COALESCE(SUM(ORIGINALAMOUNT), 0) AS STRING) AS VALUE_HTG
        FROM (
            SELECT DISTINCT
                TRANSACTIONID, ORIGINALAMOUNT,
                CREDITPARTYIDENTIFIER AS MSISDN
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd_90}'
              AND PROCESS_DATE <  '{end_ymd_excl}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND SERVICENAME IN ({credit_services_tx})
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'
            UNION ALL
            SELECT DISTINCT
                TRANSACTIONID, ORIGINALAMOUNT,
                DEBITPARTYIDENTIFIER AS MSISDN
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd_90}'
              AND PROCESS_DATE <  '{end_ymd_excl}'
              AND TRANSACTIONSTATUS = 'Completed'
              AND SERVICENAME IN ({debit_services_tx})
              AND ORIGINALAMOUNT IS NOT NULL
              AND DEBITPARTYTYPE = 'Customer'
        )
        """

        tx_row = self._one("regulatory.transactions_volume_value", q_transactions)
        # Business team keeps the raw HTG value under this row despite the label
        # "en milliers de gourdes" (kept for compliance report legacy naming).
        tx_value_htg = _as_float(_pick(tx_row, "VALUE_HTG"))

        logger.info(
            "[PERIOD_REPORT] regulatory ref=%s | accounts_registered=%s "
            "accounts_active=%s accounts_dormant=%s "
            "merchants_registered=%s merchants_active=%s merchants_dormant=%s "
            "transactions=%s",
            ref_iso, acc_reg, acc_act, acc_dor, merch_reg, merch_act, merch_dor,
            tx_row,
        )

        return {
            "reference_date": ref_iso,
            "reference_date_ymd": ref_ymd,

            # Row 1 : Nombre de Clients (explicitly left empty per business spec)
            "clients": {"homme": None, "femme": None},

            # Row 2 : Nombre de comptes de fonds de paiement électronique enregistrés
            "accounts_registered": {
                "homme": _as_int(_pick(acc_reg, "HOMME")),
                "femme": _as_int(_pick(acc_reg, "FEMME")),
            },

            # Row 3 : Nombre de comptes de fonds de paiement électronique actifs
            #         (au moins une transaction au cours des 90 derniers jours)
            "accounts_active_90d": {
                "homme": _as_int(_pick(acc_act, "HOMME")),
                "femme": _as_int(_pick(acc_act, "FEMME")),
            },

            # Row 4 : Nombre de comptes de fonds de paiement électronique dormants
            #         (aucune transaction au cours des 90 derniers jours)
            "accounts_dormant_90d": {
                "homme": _as_int(_pick(acc_dor, "HOMME")),
                "femme": _as_int(_pick(acc_dor, "FEMME")),
            },

            # Row 5 : Nombre d'agents enregistrés
            "agents_registered":     None,
            # Row 6 : Nombre d'agents actifs (au moins une transaction au cours des 90 derniers jours)
            "agents_active_90d":     None,
            # Row 7 : Nombre d'agents dormants (aucune transaction au cours des 90 derniers jours)
            "agents_dormant_90d":    None,

            # Row 8 : Nombre de commerçants affiliés enregistrés
            "merchants_registered":  _as_int(_pick(merch_reg, "TOTAL")),
            # Row 9 : Nombre de commerçants affiliés actifs
            "merchants_active_90d":  _as_int(_pick(merch_act, "TOTAL")),
            # Row 10 : Nombre de commerçants affiliés dormants
            "merchants_dormant_90d": _as_int(_pick(merch_dor, "TOTAL")),

            # Row 11 : Nombre total de transactions
            "transactions_volume":            _as_int(_pick(tx_row, "VOLUME")),
            # Row 12 : Valeur totale des transactions (en milliers de gourdes)
            # NB : the field name is a legacy — we return the RAW HTG sum here
            # as required by the compliance team, no /1000 conversion.
            "transactions_value_thousands":   round(tx_value_htg, 2),
        }

    def get_channel_category_matrix(self, start_date, end_date) -> Dict[str, Any]:
        start_iso = self._to_iso(start_date)
        end_iso   = self._to_iso(end_date)
        start_ymd = self._to_ymd(start_date)
        end_ymd   = self._to_ymd(end_date)

        # 1:1 with the reference SQL — DO NOT reorder / re-alias without sign-off.
        query = f"""
        SELECT CHANNEL, TR_TYPE,
               COUNT(TRANSACTIONID)     AS VOLUME,
               SUM(ORIGINALAMOUNT)      AS VALUE,
               COUNT(DISTINCT MSISDN)   AS SUBS
        FROM (
            SELECT DISTINCT
                CHANNEL,
                TRANSACTIONTYPE,
                TRANSACTIONID,
                ORIGINALAMOUNT,
                CREDITPARTYIDENTIFIER AS MSISDN,
                CASE SERVICENAME
                    WHEN 'P2P Transfer'                                THEN 'P2P_RECEIVE'
                    WHEN 'Send Money to Registered Customer by QR Code' THEN 'P2P_RECEIVE'
                    WHEN 'Cash In'                                     THEN 'CASHIN'
                    WHEN 'Cash In OTC'                                 THEN 'Cash In Self'
                    ELSE SERVICENAME
                END AS TR_TYPE
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}'
              AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS IN ('Success', 'Completed')
              AND SERVICENAME IN (
                  'Cash In', 'P2P Transfer',
                  'Send Money to Registered Customer by QR Code',
                  'Cash In OTC'
              )
              AND ORIGINALAMOUNT IS NOT NULL
              AND CREDITPARTYTYPE = 'Customer'

            UNION

            SELECT DISTINCT
                CHANNEL,
                TRANSACTIONTYPE,
                TRANSACTIONID,
                ORIGINALAMOUNT,
                DEBITPARTYIDENTIFIER AS MSISDN,
                CASE SERVICENAME
                    WHEN 'P2P Transfer'                                THEN 'SUBSCRIBERP2P'
                    WHEN 'Send Money to Registered Customer by QR Code' THEN 'SUBSCRIBERP2P'
                    WHEN 'Cash Out'                                    THEN 'CASHOUT'
                    WHEN 'Customer Bill Payment'                       THEN 'BILLPAY'
                    WHEN 'Gift Top up'                                 THEN 'TOPUP_GIFT'
                    WHEN 'Prepaid Top up'                              THEN 'SELF_TOPUP'
                    WHEN 'Merchant Payment'                            THEN 'PAY2MERC'
                    WHEN 'Merchant QR Payment'                         THEN 'PAY2MERC'
                    WHEN 'Merchant Till payment'                       THEN 'PAY2MERC'
                    WHEN 'Merchant to Merchant Payment via Till ID'    THEN 'PAY2MERC'
                    WHEN 'Merchant Online Payment'                     THEN 'PAY2MERC'
                    ELSE SERVICENAME
                END AS TR_TYPE
            FROM {self.TX_TABLE}
            WHERE PROCESS_DATE >= '{start_ymd}'
              AND PROCESS_DATE <= '{end_ymd}'
              AND TRANSACTIONSTATUS IN ('Success', 'Completed')
              AND SERVICENAME IN (
                  'Cash Out', 'Merchant Cashout', 'Customer Bill Payment',
                  'Agent/Merchant Bill Payment', 'Merchant Payment to Merchant',
                  'Merchant Payment', 'Merchant QR Payment', 'Merchant Till payment',
                  'Merchant to Merchant Payment via Till ID', 'Merchant Online Payment',
                  'P2P Transfer', 'Send Money to Registered Customer by QR Code',
                  'Prepaid Top up', 'Gift Top up', 'OTC Top Up'
              )
              AND ORIGINALAMOUNT IS NOT NULL
              AND DEBITPARTYTYPE = 'Customer'
        )
        GROUP BY CHANNEL, TR_TYPE
        ORDER BY CHANNEL, TR_TYPE
        """

        try:
            raw_rows = [dict(r) for r in self.db.execute(text(query)).mappings()]
        except Exception as e:
            logger.exception("[PERIOD_REPORT] channel_matrix query failed: %s", e)
            raw_rows = []

        logger.info(
            "[PERIOD_REPORT] channel_matrix window=%s→%s | rows=%d",
            start_iso, end_iso, len(raw_rows),
        )

        # ── Aggregate into the matrix ────────────────────────────────────────
        # row_id → cat_id → {volume, value}
        # Rows and categories always present even if their cell is 0 (mirrors
        # the compliance report layout, where empty rows/cols are still shown).
        cat_ids   = [c[0] for c in self.CATEGORY_DEFS] + ["total"]
        row_ids   = [r[0] for r in self.ROW_DEFS]

        cells: Dict[str, Dict[str, Dict[str, float]]] = {
            r: {c: {"volume": 0, "value": 0.0} for c in cat_ids} for r in row_ids
        }

        # Named categories (excluding the "total" pseudo-column) — this is what
        # the Total column is expected to sum. Any channel not in one of these
        # named category sets is silently dropped from the report.
        named_cat_ids = [c[0] for c in self.CATEGORY_DEFS]

        # Fast lookups
        row_by_type: Dict[str, str] = {}
        for row_id, _label, tr_set in self.ROW_DEFS:
            for tr in tr_set:
                row_by_type[tr] = row_id

        cat_by_channel: Dict[str, str] = {}
        for cat_id, _label, ch_set in self.CATEGORY_DEFS:
            for ch in ch_set:
                cat_by_channel[ch] = cat_id

        # Track any channel appearing in the data that we don't map — logged
        # once at the end so we can extend CATEGORY_DEFS if needed.
        unmapped_channels: Dict[str, int] = {}

        for raw in raw_rows:
            channel = _pick(raw, "CHANNEL") or ""
            tr_type = _pick(raw, "TR_TYPE") or ""
            volume  = _as_int(_pick(raw, "VOLUME"))
            value   = _as_float(_pick(raw, "VALUE"))

            row_id = row_by_type.get(tr_type, "other")
            cat_id = cat_by_channel.get(channel)

            if cat_id is None:
                # Unmapped channel — drop it from the report and track it.
                unmapped_channels[channel] = unmapped_channels.get(channel, 0) + volume
                continue

            cells[row_id][cat_id]["volume"] += volume
            cells[row_id][cat_id]["value"]  += value

        # ── Row Total = strict sum of the row's named-category cells ──────
        # Guarantees Total column = Mobile + Carte + En ligne for every row.
        for row_id in row_ids:
            for cat_id in named_cat_ids:
                cells[row_id]["total"]["volume"] += cells[row_id][cat_id]["volume"]
                cells[row_id]["total"]["value"]  += cells[row_id][cat_id]["value"]

        # ── Column totals = strict sum of the displayed row cells ─────────
        # Guarantees the "Total général" row = column sum of the cells shown.
        col_totals: Dict[str, Dict[str, float]] = {c: {"volume": 0, "value": 0.0} for c in cat_ids}
        for row_id in row_ids:
            for cat_id in cat_ids:
                col_totals[cat_id]["volume"] += cells[row_id][cat_id]["volume"]
                col_totals[cat_id]["value"]  += cells[row_id][cat_id]["value"]

        if unmapped_channels:
            logger.warning(
                "[PERIOD_REPORT] channel_matrix : %d channels ignored "
                "(not in CATEGORY_DEFS) — %s",
                len(unmapped_channels),
                sorted(unmapped_channels.items(), key=lambda x: -x[1])[:10],
            )

        # ── Shape the payload ────────────────────────────────────────────────
        categories = [
            {"id": cat_id, "label": label, "channels": sorted(ch_set)}
            for cat_id, label, ch_set in self.CATEGORY_DEFS
        ]
        categories.append({"id": "total", "label": "Total", "channels": ["*"]})

        rows_out = []
        for row_id, label, tr_set in self.ROW_DEFS:
            rows_out.append({
                "id":       row_id,
                "label":    label,
                "tr_types": sorted(tr_set) if tr_set else [],
                "cells":    cells[row_id],
            })

        return {
            "period":     {"start": start_iso, "end": end_iso},
            "categories": categories,
            "rows":       rows_out,
            "col_totals": col_totals,
        }
