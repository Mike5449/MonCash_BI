from sqlalchemy import text
from typing import List, Dict, Any, Optional

class PrefundedRepository:
    def __init__(self, db):
        self.db = db

    def _get_latest_date_subquery(self):
        return "(SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit)"

    def get_prefunded_accounts(self, limit: int = 100) -> List[Dict[str, Any]]:
        query = f"""
        SELECT *
        FROM (
            SELECT DISTINCT
                DATE_CODE,
                IDENTITYMSISDN AS ACCOUNT_ID,
                ORGANIZATIONSHORTCODE AS PREFUNDED_SHORT_CODE,
                UNIQUESYSTEMID AS IDENTITY_ID ,
                IDENTITYNAME AS PREFUNDED_NAME ,
                DEPARTMENT ,
                COMMUNE ,
                ACCOUNTGLCODE AS ACCOUNT_GL_CODE ,
                split(CHARGEPROFILE," ")[4] AS FEE ,
                PRODUCTS ,
                ROW_NUMBER() OVER (
                    PARTITION BY ORGANIZATIONSHORTCODE
                    ORDER BY to_date(LASTMODIFIED,'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
            WHERE PRODUCTS LIKE '%[Prefunded partner Product]%'
            AND to_date(DATE_CODE,'yyyyMMdd') = {self._get_latest_date_subquery()}
        ) a
        WHERE a.rn = 1
        LIMIT {limit}
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]
