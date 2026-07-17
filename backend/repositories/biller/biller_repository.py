from sqlalchemy import text
from typing import List, Dict, Any, Optional

class BillerRepository:
    def __init__(self, db):
        self.db = db

    def _get_latest_date_subquery(self):
        return "(SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit)"

    def get_biller_accounts(self, limit: int = 100) -> List[Dict[str, Any]]:
        query = f"""
        SELECT *
        FROM (
            SELECT DISTINCT
                DATE_CODE,       
                IDENTITYMSISDN AS ACCOUNT_ID,
                ORGANIZATIONSHORTCODE AS BILLER_SHORT_CODE,
                UNIQUESYSTEMID AS IDENTITY_ID ,
                IDENTITYNAME AS BILLER_NAME ,
                DEPARTMENT ,
                ACCOUNTGLCODE AS ACCOUNT_GL_CODE ,
                split(SEGMENT ,"#")[0] AS BILLER_TYPE ,
                split(CHARGEPROFILE," ")[4] AS FEE ,
                ROW_NUMBER() OVER (
                    PARTITION BY ORGANIZATIONSHORTCODE
                    ORDER BY to_date(LASTMODIFIED,'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
            WHERE PRODUCTS like '%[Utility Product]%' 
            AND to_date(DATE_CODE,'yyyyMMdd') = {self._get_latest_date_subquery()}
        ) a
        WHERE a.rn = 1
        LIMIT {limit}
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]
