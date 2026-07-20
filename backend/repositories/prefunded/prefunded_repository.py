import re
from sqlalchemy import text
from typing import List, Dict, Any, Optional

_YYYYMMDD = re.compile(r"^\d{8}$")


class PrefundedRepository:
    def __init__(self, db):
        self.db = db

    def _get_latest_date_subquery(self):
        return "(SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit)"

    def get_prefunded_accounts(
        self,
        limit: int = 100,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        for d in (start_date, end_date):
            if d and not _YYYYMMDD.match(d):
                raise ValueError(f"Invalid date format {d!r}, expected yyyyMMdd (8 digits)")

        if start_date and end_date:
            date_clause = (
                f"AND to_date(DATE_CODE,'yyyyMMdd') "
                f"BETWEEN to_date('{start_date}','yyyyMMdd') AND to_date('{end_date}','yyyyMMdd')"
            )
        elif start_date:
            date_clause = f"AND to_date(DATE_CODE,'yyyyMMdd') >= to_date('{start_date}','yyyyMMdd')"
        elif end_date:
            date_clause = f"AND to_date(DATE_CODE,'yyyyMMdd') <= to_date('{end_date}','yyyyMMdd')"
        else:
            date_clause = f"AND to_date(DATE_CODE,'yyyyMMdd') = {self._get_latest_date_subquery()}"

        query = f"""
        SELECT *
        FROM (
            SELECT DISTINCT
                DATE_CODE,
                IDENTITYMSISDN AS ACCOUNT_ID,
                ORGANIZATIONSHORTCODE AS PREFUNDED_SHORT_CODE,
                UNIQUESYSTEMID AS IDENTITY_ID,
                IDENTITYNAME AS PREFUNDED_NAME,
                DEPARTMENT,
                COMMUNE,
                ACCOUNTGLCODE AS ACCOUNT_GL_CODE,
                split(CHARGEPROFILE," ")[4] AS FEE,
                PRODUCTS,
                ROW_NUMBER() OVER (
                    PARTITION BY ORGANIZATIONSHORTCODE
                    ORDER BY to_date(LASTMODIFIED,'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
            WHERE PRODUCTS LIKE '%[Prefunded partner Product]%'
            {date_clause}
        ) a
        WHERE a.rn = 1
        LIMIT {limit}
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]
