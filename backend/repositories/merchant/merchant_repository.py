import re
from sqlalchemy import text
from typing import List, Dict, Any, Optional
from datetime import date


class MerchantRepository:
    """
    Annuaire des comptes Merchant — source : mfs_mobile_banking_audit (latest DATE_CODE).

    Filtres exposés :
    - created_start / created_end : intervalle sur DATEIDENTITYREGISTERED (date d'enregistrement)
    - merchant_types : whitelist parmi {Gold, Silver, Silver1, Silver2, Blue, Other}
    - departments   : multi-select sur DEPARTMENT (audit table)
    - search        : ILIKE sur MERCHANT_NAME / ACCOUNT_ID / SHORTCODE / IDENTITY_ID
    - status        : IDENTITYSTATUS (Active / Closed / Suspended / ...)
    - limit / offset : pagination
    """

    AUDIT_TABLE = "gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit"

    # Mapping segment → type lisible + fee
    TYPE_FEE_CTE = """
    SELECT
        DATE_CODE,
        ORGANIZATIONSHORTCODE                          AS MERCHANT_SHORT_CODE,
        UNIQUESYSTEMID                                 AS IDENTITY_ID,
        IDENTITYMSISDN                                 AS ACCOUNT_ID,
        IDENTITYNAME                                   AS MERCHANT_NAME,
        DEPARTMENT,
        COMMUNE,
        ACCOUNTGLCODE                                  AS ACCOUNT_GL_CODE,
        IDENTITYSTATUS                                 AS STATUS,
        DATEIDENTITYREGISTERED                         AS DATEIDENTITYREGISTERED,
        TO_DATE(DATEIDENTITYREGISTERED, 'yyyyMMddHHmmss') AS CREATED_DATE,
        INITCAP(REPLACE(REPLACE(SEGMENT, 'mcommerchant#', ''), ' Merchant', '')) AS MERCHANT_TYPE,
        CASE
            WHEN INITCAP(REPLACE(SEGMENT, 'mcommerchant#', ''))
                 IN ('Gold Merchant','Silver Merchant','Silver1 Merchant','Silver2 Merchant') THEN '2%'
            WHEN INITCAP(REPLACE(SEGMENT, 'mcommerchant#', '')) = 'Blue Merchant' THEN '1.5%'
            ELSE '0%'
        END                                            AS FEE,
        ROW_NUMBER() OVER (
            PARTITION BY ORGANIZATIONSHORTCODE
            ORDER BY to_date(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
        )                                              AS rn
    FROM {table}
    WHERE PRODUCTS LIKE '%[Merchant Product]%'
      AND to_date(DATE_CODE,'yyyyMMdd') = (
          SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM {table}
      )
    """

    def __init__(self, db):
        self.db = db

    @staticmethod
    def _quote_list(values: List[str]) -> str:
        cleaned = [
            str(v).replace("\\", "\\\\").replace("'", "''").strip()
            for v in values if v and str(v).strip()
        ]
        return "'" + "','".join(cleaned) + "'"

    def _base_cte(self) -> str:
        return f"WITH base AS ({self.TYPE_FEE_CTE.format(table=self.AUDIT_TABLE)})"

    def _build_outer_filters(
        self,
        created_start: Optional[date],
        created_end:   Optional[date],
        merchant_types: Optional[List[str]],
        departments:    Optional[List[str]],
        statuses:       Optional[List[str]],
        search:         Optional[str],
    ) -> str:
        """Build the WHERE clause appliquée APRES la CTE base (sur rn=1)."""
        conds: List[str] = ["rn = 1"]

        if created_start:
            conds.append(f"CREATED_DATE >= DATE('{created_start.strftime('%Y-%m-%d')}')")
        if created_end:
            conds.append(f"CREATED_DATE <= DATE('{created_end.strftime('%Y-%m-%d')}')")

        if merchant_types:
            clean = [t.strip() for t in merchant_types if t and t.strip()]
            if clean:
                # On matche sur MERCHANT_TYPE qui est le segment normalisé
                conds.append(f"MERCHANT_TYPE IN ({self._quote_list(clean)})")

        if departments:
            clean = [d.strip() for d in departments if d and d.strip()]
            if clean:
                conds.append(f"DEPARTMENT IN ({self._quote_list(clean)})")

        if statuses:
            clean = [s.strip() for s in statuses if s and s.strip()]
            if clean:
                conds.append(f"STATUS IN ({self._quote_list(clean)})")

        if search and search.strip():
            # ILIKE-compatible (Spark : LOWER(...) LIKE LOWER(...))
            safe = re.sub(r"[%_\\]", "", search.strip()).replace("'", "''")
            if safe:
                like = f"LOWER('%{safe}%')"
                conds.append(
                    f"(LOWER(MERCHANT_NAME)        LIKE {like}"
                    f" OR LOWER(ACCOUNT_ID)        LIKE {like}"
                    f" OR LOWER(MERCHANT_SHORT_CODE) LIKE {like}"
                    f" OR LOWER(IDENTITY_ID)       LIKE {like})"
                )

        return " AND ".join(conds)

    def get_merchant_accounts(
        self,
        limit: int = 100,
        offset: int = 0,
        created_start: Optional[date] = None,
        created_end:   Optional[date] = None,
        merchant_types: Optional[List[str]] = None,
        departments:    Optional[List[str]] = None,
        statuses:       Optional[List[str]] = None,
        search:         Optional[str] = None,
    ) -> Dict[str, Any]:
        """Returns {rows, total, summary} pour l'annuaire merchant avec tous les filtres."""
        where = self._build_outer_filters(
            created_start, created_end, merchant_types, departments, statuses, search,
        )
        base_cte = self._base_cte()

        # ── Q1 : lignes paginées ──
        rows_query = f"""
        {base_cte}
        SELECT DATE_CODE, MERCHANT_NAME, ACCOUNT_ID, MERCHANT_SHORT_CODE,
               IDENTITY_ID, DEPARTMENT, COMMUNE, MERCHANT_TYPE, FEE,
               ACCOUNT_GL_CODE, STATUS, CREATED_DATE
        FROM base
        WHERE {where}
        ORDER BY CREATED_DATE DESC, MERCHANT_NAME ASC
        LIMIT {int(limit)} OFFSET {int(offset)}
        """
        rows = [dict(r) for r in self.db.execute(text(rows_query)).mappings()]

        # ── Q2 : total + summary KPIs sur la base filtrée ──
        # CAST en STRING côté Spark pour éviter le bug Arrow→pandas sur les colonnes
        # numériques nullables (cf. autres repos de l'app).
        summary_query = f"""
        {base_cte}
        SELECT
            CAST(COUNT(*)                                                           AS STRING) AS TOTAL,
            CAST(COUNT(CASE WHEN MERCHANT_TYPE IN ('Gold','Silver','Silver1','Silver2') THEN 1 END) AS STRING) AS PREMIUM,
            CAST(COUNT(CASE WHEN MERCHANT_TYPE = 'Blue' THEN 1 END)                  AS STRING) AS BLUE,
            CAST(COUNT(CASE WHEN MERCHANT_TYPE NOT IN ('Gold','Silver','Silver1','Silver2','Blue')
                              OR MERCHANT_TYPE IS NULL THEN 1 END)                  AS STRING) AS OTHER_TYPE,
            CAST(COUNT(CASE WHEN STATUS = 'Active' THEN 1 END)                       AS STRING) AS ACTIVE
        FROM base
        WHERE {where}
        """
        s_row = next(iter(self.db.execute(text(summary_query)).mappings()), None) or {}

        def _as_int(v) -> int:
            if v is None: return 0
            try: return int(v)
            except (TypeError, ValueError):
                try: return int(float(v))
                except (TypeError, ValueError): return 0

        summary = {
            "total":   _as_int(s_row.get("TOTAL")),
            "premium": _as_int(s_row.get("PREMIUM")),
            "blue":    _as_int(s_row.get("BLUE")),
            "other":   _as_int(s_row.get("OTHER_TYPE")),
            "active":  _as_int(s_row.get("ACTIVE")),
        }

        return {
            "rows":    rows,
            "total":   summary["total"],
            "summary": summary,
        }

    def get_filter_options(self) -> Dict[str, List[str]]:
        """Liste les valeurs distinctes pour peupler les dropdowns du filter panel."""
        base_cte = self._base_cte()

        types_q = f"""
        {base_cte}
        SELECT DISTINCT MERCHANT_TYPE AS V
        FROM base WHERE rn = 1 AND MERCHANT_TYPE IS NOT NULL
        ORDER BY V
        """
        depts_q = f"""
        {base_cte}
        SELECT DISTINCT DEPARTMENT AS V
        FROM base WHERE rn = 1 AND DEPARTMENT IS NOT NULL AND TRIM(DEPARTMENT) <> ''
        ORDER BY V
        """
        statuses_q = f"""
        {base_cte}
        SELECT DISTINCT STATUS AS V
        FROM base WHERE rn = 1 AND STATUS IS NOT NULL
        ORDER BY V
        """

        def _scalar_list(q: str) -> List[str]:
            try:
                return [
                    str(r.get("V")).strip()
                    for r in self.db.execute(text(q)).mappings()
                    if r.get("V") and str(r.get("V")).strip()
                ]
            except Exception:
                return []

        return {
            "merchant_types": _scalar_list(types_q),
            "departments":   _scalar_list(depts_q),
            "statuses":      _scalar_list(statuses_q),
        }

    def get_merchant_accounts_for_export(
        self,
        created_start: Optional[date] = None,
        created_end:   Optional[date] = None,
        merchant_types: Optional[List[str]] = None,
        departments:    Optional[List[str]] = None,
        statuses:       Optional[List[str]] = None,
        search:         Optional[str] = None,
        limit:          int = 2_000_000,
    ) -> List[Dict[str, Any]]:
        """Variante sans pagination — utilisée pour le streaming XLSX."""
        where = self._build_outer_filters(
            created_start, created_end, merchant_types, departments, statuses, search,
        )
        base_cte = self._base_cte()
        query = f"""
        {base_cte}
        SELECT DATE_CODE, MERCHANT_NAME, ACCOUNT_ID, MERCHANT_SHORT_CODE,
               IDENTITY_ID, DEPARTMENT, COMMUNE, MERCHANT_TYPE, FEE,
               ACCOUNT_GL_CODE, STATUS, CREATED_DATE
        FROM base
        WHERE {where}
        ORDER BY CREATED_DATE DESC, MERCHANT_NAME ASC
        LIMIT {int(limit)}
        """
        return [dict(r) for r in self.db.execute(text(query)).mappings()]
