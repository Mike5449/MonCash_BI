from sqlalchemy import text
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)

class ExcelAnalyticsRepository:
    def __init__(self, db):
        self.db = db

    def get_enriched_data(self, input_data: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        all_results = []
        chunk_size = 500
        total_chunks = (len(input_data) + chunk_size - 1) // chunk_size
        
        # Process in chunks to avoid giant SQL queries that might trigger RequestErrors
        for idx, i in enumerate(range(0, len(input_data), chunk_size)):
            chunk = input_data[i:i + chunk_size]
            logger.info(f"Processing chunk {idx + 1}/{total_chunks} ({len(chunk)} records)...")
            
            values_list = []
            for item in chunk:
                # Handle possible missing keys or None values
                name = str(item.get('NOM_COMPLET', '') or '').replace("'", "''")
                msisdn = str(item.get('MSISDN', '') or '').strip()
                if msisdn:
                    values_list.append(f"('{name}', '{msisdn}')")
            
            if not values_list:
                continue
                
            values_str = ", ".join(values_list)

            query = f"""
            WITH InputList(NOM_COMPLET, MSISDN) AS (
                VALUES {values_str}
            ),
            MfsEnriched AS (
                SELECT 
                    Base.MSISDN, 
                    Mfs.WALLET_TYPE, 
                    Base.NOM_COMPLET, 
                    Mfs.NAME AS MFS_NOM_COMPLET, 
                    Mfs.BALANCE, 
                    Mfs.STATUS, 
                    Mfs.ab_created_date as CREATED_DATE,
                    CASE WHEN Mfs.MSISDN IS NULL THEN 'NO' ELSE 'YES' END AS MFS_USERS,
                    ROW_NUMBER() OVER (PARTITION BY Base.MSISDN ORDER BY Mfs.ab_created_date DESC) as RK
                FROM InputList Base
                LEFT JOIN (
                    SELECT distinct AB_SALT as MSISDN, AD_KYC AS WALLET_TYPE, IDENTITYSTATUS as STATUS, AB_NAME AS NAME, AC_CUR_BAL AS BALANCE, ab_created_date
                    FROM gr_dgc_dwh_prd.ods_dl.ods_mfs_agent
                    WHERE to_date(DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                    AND AG_GROUP_LIST = 'subscriber'
                    AND AD_KYC IS NOT NULL
                ) Mfs ON Base.MSISDN = Mfs.MSISDN
            ),
            SimStatus AS (
                SELECT 
                    MSISDN,
                    NVL(
                        CASE
                            WHEN ACCOUNTACTIVATEDFLAG = 1 AND SUPVNPERIODEXPIRYDATE > Date_Key THEN 'Activated'
                            WHEN ACCOUNTACTIVATEDFLAG = 0 OR ACCOUNTACTIVATEDDATE IS NULL OR ACCOUNTACTIVATEDDATE <= '1970-01-01' THEN 'Installed'
                            WHEN SERVFEEEXPIRYFLAG = 1 OR SERVFEEEXPIRYDATE <= Date_Key THEN 'Expired'
                            WHEN SUPVNPERIODEXPIRYDATE <= Date_Key THEN 'Deactivated'
                            ELSE 'UNDETERMINED'
                        END, 
                    'UNDETERMINED') AS SIM_STATUS
                FROM (
                    SELECT 
                        MSISDN, ACCOUNTACTIVATEDFLAG, SUPVNPERIODEXPIRYDATE, Date_Key, ACCOUNTACTIVATEDDATE, SERVFEEEXPIRYFLAG, SERVFEEEXPIRYDATE,
                        ROW_NUMBER() OVER (PARTITION BY MSISDN ORDER BY ACCOUNTACTIVATEDDATE DESC) AS rn
                    FROM gr_dgc_dwh_prd.ods_dl.sdp_balance_snp
                    WHERE Date_Key = CURRENT_DATE - 1
                )
                WHERE rn = 1
            )
            SELECT 
                E.MSISDN, 
                E.WALLET_TYPE, 
                E.NOM_COMPLET, 
                E.MFS_NOM_COMPLET, 
                E.BALANCE, 
                E.STATUS, 
                S.SIM_STATUS, 
                TO_DATE(SUBSTR(E.CREATED_DATE, 1, 8), 'yyyyMMdd') as CREATED_DATE, 
                E.MFS_USERS
            FROM MfsEnriched E
            LEFT JOIN SimStatus S ON E.MSISDN = S.MSISDN
            WHERE E.RK = 1
            """
            
            result = self.db.execute(text(query))
            all_results.extend([dict(row) for row in result.mappings()])
            
        return all_results
