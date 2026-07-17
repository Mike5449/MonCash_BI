from sqlalchemy import text
from typing import List, Dict, Any, Optional
from datetime import date, timedelta


class CustomerMTDRepository:
    """Repository for Month-to-Date (MTD) customer transaction statistics."""
    
    def __init__(self, db):
        self.db = db

    def get_mtd_stats_by_type(
        self,
        msisdn_list: Optional[List[str]] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        Get aggregated statistics by transaction type for a given date range.
        Returns only the last day's cumulative totals from the period.
        
        Args:
            msisdn_list: Optional list of MSISDNs to filter by
            start_date: Start date (defaults to first day of current month)
            end_date: End date (defaults to yesterday)
        
        Returns:
            Dict with:
            - period: "CUSTOM" or "MTD"
            - start_date: Start of range
            - end_date: End of range
            - transaction_types: List of dicts with TR_TYPE and aggregated cumulative metrics
        """
        
        # Determine date range
        today = date.today()
        if not start_date:
            start_date = date(today.year, today.month, 1)
            period = "MTD"
        else:
            period = "CUSTOM"
        
        if not end_date:
            end_date = today - timedelta(days=1)  # Yesterday
        
        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')

        # Build MSISDN filter if provided
        msisdn_outer_filter = ""
        
        if msisdn_list and len(msisdn_list) > 0:
            m_list_str = "', '".join(msisdn_list)
            msisdn_outer_filter = f"AND MSISDN IN ('{m_list_str}')"

        query = f"""
        WITH base_unioned AS (
          -- receive / credit side
          SELECT DISTINCT
            TRANSACTIONID,
            TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') AS TRANSACTION_DATE,
            CREDITPARTYIDENTIFIER AS MSISDN,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            CASE 
                  WHEN SERVICENAME='OD Money Transfer Prefunded' AND DEBITPARTYIDENTIFIER = '07421468' THEN 'B2W'
                  WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code') THEN 'P2P_RECEIVE'
                  WHEN SERVICENAME = 'Cash In' THEN 'CASHIN'
                  WHEN SERVICENAME = 'Cash In OTC' THEN 'Cash In OTC'
                  WHEN SERVICENAME ='IMT revceiving' THEN 'IMT'
               END AS TR_TYPE
          FROM hive_metastore.ods_dl.mfs_transaction_aml
          WHERE TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN '{start_str}' AND '{end_str}'
            AND TRANSACTIONSTATUS IN ('Success','Completed')
            AND SERVICENAME IN ('Cash In','P2P Transfer','Send Money to Registered Customer by QR Code','Cash In OTC','IMT revceiving','OD Money Transfer Prefunded')
            AND ORIGINALAMOUNT IS NOT NULL
            AND CREDITPARTYTYPE = 'Customer'

          UNION ALL

          -- send / debit side
          SELECT DISTINCT
            TRANSACTIONID,
            TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') AS TRANSACTION_DATE,
            DEBITPARTYIDENTIFIER AS MSISDN,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            CASE 
                  WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code') THEN 'P2P_SEND'
                  WHEN SERVICENAME = 'Cash Out' THEN 'CASHOUT'
                  WHEN SERVICENAME = 'Customer Bill Payment' 
                       AND CREDITPARTYIDENTIFIER IN ('314','318','322','326','310') THEN 'DIGI_PRODUCT'
                  WHEN SERVICENAME = 'Customer Bill Payment' THEN 'BILLPAY'
                  WHEN SERVICENAME = 'Gift Top up' THEN 'TOPUP_GIFT'
                  WHEN SERVICENAME = 'Prepaid Top up' THEN 'SELF_TOPUP'
                  WHEN SERVICENAME IN (
                      'Merchant Payment','Merchant QR Payment','Merchant Till payment',
                      'Merchant to Merchant Payment via Till ID','Merchant Online Payment'
                  ) THEN 'PAY2MERC'
               END AS TR_TYPE
          FROM hive_metastore.ods_dl.mfs_transaction_aml
          WHERE TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN '{start_str}' AND '{end_str}'
            AND TRANSACTIONSTATUS IN ('Success','Completed')
            AND ORIGINALAMOUNT IS NOT NULL
            AND DEBITPARTYTYPE = 'Customer'
            AND SERVICENAME IN (
              'Cash Out','Merchant Cashout','Customer Bill Payment','Agent/Merchant Bill Payment',
              'Merchant Payment to Merchant','Merchant Payment','Merchant QR Payment','Merchant Till payment',
              'Merchant to Merchant Payment via Till ID','Merchant Online Payment','P2P Transfer',
              'Send Money to Registered Customer by QR Code','Prepaid Top up','Gift Top up','OTC Top Up'
            )
        ),

        first_per_month AS (
          -- SUBS = nombre de MSISDN dont c'est la première apparition du mois (par TR_TYPE)
          SELECT
            TR_TYPE,
            MSISDN,
            TRANSACTION_DATE,
            ROW_NUMBER() OVER (
              PARTITION BY TR_TYPE, MSISDN, TRUNC(TRANSACTION_DATE,'MM')
              ORDER BY TRANSACTION_DATE
            ) AS rn
          FROM base_unioned
          WHERE MSISDN IS NOT NULL {msisdn_outer_filter}
        ),

        daily_new_subs AS (
          -- SUBS = nombre de MSISDN dont c'est la première apparition du mois (par TR_TYPE)
          SELECT TR_TYPE, TRANSACTION_DATE, COUNT(*) AS NEW_SUBS
          FROM first_per_month
          WHERE rn = 1
          GROUP BY TR_TYPE, TRANSACTION_DATE
        ),

        daily_metrics AS (
          -- metrics quotidiennes (volume / value / revenue) sur l'ensemble des transactions du jour
          SELECT
            TR_TYPE,
            TRANSACTION_DATE,
            COUNT(TRANSACTIONID) AS TR_VOLUME,
            SUM(ORIGINALAMOUNT) AS TR_VALUE,
            SUM(CHARGEAMOUNT) AS MFS_REVENUE
          FROM base_unioned
          WHERE TR_TYPE IS NOT NULL {msisdn_outer_filter}
          GROUP BY TR_TYPE, TRANSACTION_DATE
        ),

        daily_with_cumul AS (
          SELECT
            m.TR_TYPE,
            m.TRANSACTION_DATE,
            COALESCE(n.NEW_SUBS, 0) AS DAILY_SUBS,
            m.TR_VOLUME AS DAILY_VOLUME,
            m.TR_VALUE AS DAILY_VALUE,
            m.MFS_REVENUE AS DAILY_REVENUE,
            -- cumul mensuel des SUBS (sera la somme des NEW_SUBS depuis le début du mois)
            SUM(COALESCE(n.NEW_SUBS,0)) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_SUBS,
            -- cumuls pour les autres métriques (inchangés)
            SUM(m.TR_VOLUME) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_TR_VOLUME,
            SUM(m.TR_VALUE) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_TR_VALUE,
            SUM(m.MFS_REVENUE) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_MFS_REVENUE
          FROM daily_metrics m
          LEFT JOIN daily_new_subs n
            ON m.TR_TYPE = n.TR_TYPE
            AND m.TRANSACTION_DATE = n.TRANSACTION_DATE
        )

        SELECT
          TR_TYPE,
          CUMUL_SUBS AS SUBS,
          CUMUL_TR_VOLUME AS VOLUME,
          CUMUL_TR_VALUE AS VALUE,
          CUMUL_MFS_REVENUE AS REVENUE
        FROM daily_with_cumul
        WHERE TRANSACTION_DATE = (
            SELECT MAX(TRANSACTION_DATE) FROM daily_with_cumul
        )
        ORDER BY VALUE DESC
        """
        
        result = self.db.execute(text(query))
        transaction_types = [dict(row) for row in result.mappings()]
        
        return {
            "period": period,
            "start_date": start_str,
            "end_date": end_str,
            "transaction_types": transaction_types
        }

    def get_mtd_stats_by_day(
        self,
        tr_type: Optional[str] = None,
        msisdn_list: Optional[List[str]] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        Get MTD statistics by day with daily breakdown and cumulative totals.
        MTD SUBS = new customers (first appearance in month per TR_TYPE) that day
        Shows daily metrics + cumulative progression for the period.
        
        Args:
            tr_type: Optional transaction type to filter (e.g. 'P2P_SEND')
            msisdn_list: Optional list of MSISDNs to filter by
            start_date: Start date (defaults to first day of current month)
            end_date: End date (defaults to yesterday)
        
        Returns:
            Dict with daily progression showing daily and cumulative values
        """
        
        # Determine date range
        today = date.today()
        if not start_date:
            start_date = date(today.year, today.month, 1)
            period = "MTD"
        else:
            period = "CUSTOM"
        
        if not end_date:
            end_date = today - timedelta(days=1)  # Yesterday
        
        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')

        # Build MSISDN filter if provided
        msisdn_outer_filter = ""
        
        if msisdn_list and len(msisdn_list) > 0:
            m_list_str = "', '".join(msisdn_list)
            msisdn_outer_filter = f"AND MSISDN IN ('{m_list_str}')"

        # Build TR_TYPE filter
        tr_type_filter = ""
        if tr_type:
          tr_type_filter = f"WHERE m.TR_TYPE = '{tr_type}'"

        query = f"""
        WITH base_unioned AS (
          -- receive / credit side
          SELECT DISTINCT
            TRANSACTIONID,
            TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') AS TRANSACTION_DATE,
            CREDITPARTYIDENTIFIER AS MSISDN,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            CASE 
                  WHEN SERVICENAME='OD Money Transfer Prefunded' AND DEBITPARTYIDENTIFIER = '07421468' THEN 'B2W'
                  WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code') THEN 'P2P_RECEIVE'
                  WHEN SERVICENAME = 'Cash In' THEN 'CASHIN'
                  WHEN SERVICENAME = 'Cash In OTC' THEN 'Cash In OTC'
                  WHEN SERVICENAME ='IMT revceiving' THEN 'IMT'
               END AS TR_TYPE
          FROM hive_metastore.ods_dl.mfs_transaction_aml
          WHERE TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN '{start_str}' AND '{end_str}'
            AND TRANSACTIONSTATUS IN ('Success','Completed')
            AND SERVICENAME IN ('Cash In','P2P Transfer','Send Money to Registered Customer by QR Code','Cash In OTC','IMT revceiving','OD Money Transfer Prefunded')
            AND ORIGINALAMOUNT IS NOT NULL
            AND CREDITPARTYTYPE = 'Customer'

          UNION ALL

          -- send / debit side
          SELECT DISTINCT
            TRANSACTIONID,
            TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') AS TRANSACTION_DATE,
            DEBITPARTYIDENTIFIER AS MSISDN,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            CASE 
                  WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code') THEN 'P2P_SEND'
                  WHEN SERVICENAME = 'Cash Out' THEN 'CASHOUT'
                  WHEN SERVICENAME = 'Customer Bill Payment' 
                       AND CREDITPARTYIDENTIFIER IN ('314','318','322','326','310') THEN 'DIGI_PRODUCT'
                  WHEN SERVICENAME = 'Customer Bill Payment' THEN 'BILLPAY'
                  WHEN SERVICENAME = 'Gift Top up' THEN 'TOPUP_GIFT'
                  WHEN SERVICENAME = 'Prepaid Top up' THEN 'SELF_TOPUP'
                  WHEN SERVICENAME IN (
                      'Merchant Payment','Merchant QR Payment','Merchant Till payment',
                      'Merchant to Merchant Payment via Till ID','Merchant Online Payment'
                  ) THEN 'PAY2MERC'
               END AS TR_TYPE
          FROM hive_metastore.ods_dl.mfs_transaction_aml
          WHERE TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN '{start_str}' AND '{end_str}'
            AND TRANSACTIONSTATUS IN ('Success','Completed')
            AND ORIGINALAMOUNT IS NOT NULL
            AND DEBITPARTYTYPE = 'Customer'
            AND SERVICENAME IN (
              'Cash Out','Merchant Cashout','Customer Bill Payment','Agent/Merchant Bill Payment',
              'Merchant Payment to Merchant','Merchant Payment','Merchant QR Payment','Merchant Till payment',
              'Merchant to Merchant Payment via Till ID','Merchant Online Payment','P2P Transfer',
              'Send Money to Registered Customer by QR Code','Prepaid Top up','Gift Top up','OTC Top Up'
            )
        ),

        first_per_month AS (
          -- SUBS = nombre de MSISDN dont c'est la première apparition du mois (par TR_TYPE)
          SELECT
            TR_TYPE,
            MSISDN,
            TRANSACTION_DATE,
            ROW_NUMBER() OVER (
              PARTITION BY TR_TYPE, MSISDN, TRUNC(TRANSACTION_DATE,'MM')
              ORDER BY TRANSACTION_DATE
            ) AS rn
          FROM base_unioned
          WHERE MSISDN IS NOT NULL {msisdn_outer_filter}
        ),

        daily_new_subs AS (
          -- SUBS = nombre de MSISDN dont c'est la première apparition du mois (par TR_TYPE)
          SELECT TR_TYPE, TRANSACTION_DATE, COUNT(*) AS NEW_SUBS
          FROM first_per_month
          WHERE rn = 1
          GROUP BY TR_TYPE, TRANSACTION_DATE
        ),

        daily_metrics AS (
          -- metrics quotidiennes (volume / value / revenue) sur l'ensemble des transactions du jour
          SELECT
            TR_TYPE,
            TRANSACTION_DATE,
            COUNT(TRANSACTIONID) AS TR_VOLUME,
            SUM(ORIGINALAMOUNT) AS TR_VALUE,
            SUM(CHARGEAMOUNT) AS MFS_REVENUE
          FROM base_unioned
          WHERE TR_TYPE IS NOT NULL {msisdn_outer_filter}
          GROUP BY TR_TYPE, TRANSACTION_DATE
        ),

        daily_with_cumul AS (
          SELECT
            m.TR_TYPE,
            m.TRANSACTION_DATE,
            COALESCE(n.NEW_SUBS, 0) AS DAILY_SUBS,
            m.TR_VOLUME AS DAILY_VOLUME,
            m.TR_VALUE AS DAILY_VALUE,
            m.MFS_REVENUE AS DAILY_REVENUE,
            -- cumul mensuel des SUBS (sera la somme des NEW_SUBS depuis le début du mois)
            SUM(COALESCE(n.NEW_SUBS,0)) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_SUBS,
            -- cumuls pour les autres métriques (inchangés)
            SUM(m.TR_VOLUME) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_TR_VOLUME,
            SUM(m.TR_VALUE) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_TR_VALUE,
            SUM(m.MFS_REVENUE) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_MFS_REVENUE
          FROM daily_metrics m
          LEFT JOIN daily_new_subs n
            ON m.TR_TYPE = n.TR_TYPE
            AND m.TRANSACTION_DATE = n.TRANSACTION_DATE
        )

        SELECT
          m.TR_TYPE,
          m.TRANSACTION_DATE,
          m.DAILY_SUBS,
          m.DAILY_VOLUME,
          m.DAILY_VALUE,
          m.DAILY_REVENUE,
          m.CUMUL_SUBS,
          m.CUMUL_TR_VOLUME AS CUMUL_VOLUME,
          m.CUMUL_TR_VALUE AS CUMUL_VALUE,
          m.CUMUL_MFS_REVENUE AS CUMUL_REVENUE
        FROM daily_with_cumul m
        {tr_type_filter}
        ORDER BY m.TR_TYPE, m.TRANSACTION_DATE
        """
        
        # Debug probe: list TR_TYPEs available in the period (temporary)
        debug_types_query = f"""
        WITH base_unioned AS (
          SELECT
          CASE 
              WHEN SERVICENAME='OD Money Transfer Prefunded' AND DEBITPARTYIDENTIFIER = '07421468' THEN 'B2W'
              WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code') THEN 'P2P_RECEIVE'
              WHEN SERVICENAME = 'Cash In' THEN 'CASHIN'
              WHEN SERVICENAME = 'Cash In OTC' THEN 'Cash In OTC'
              WHEN SERVICENAME ='IMT revceiving' THEN 'IMT'
              WHEN SERVICENAME = 'Cash Out' THEN 'CASHOUT'
              WHEN SERVICENAME = 'Customer Bill Payment' AND CREDITPARTYIDENTIFIER IN ('314','318','322','326','310') THEN 'DIGI_PRODUCT'
              WHEN SERVICENAME = 'Customer Bill Payment' THEN 'BILLPAY'
              WHEN SERVICENAME = 'Gift Top up' THEN 'TOPUP_GIFT'
              WHEN SERVICENAME = 'Prepaid Top up' THEN 'SELF_TOPUP'
              WHEN SERVICENAME IN ('Merchant Payment','Merchant QR Payment','Merchant Till payment','Merchant to Merchant Payment via Till ID','Merchant Online Payment') THEN 'PAY2MERC'
          END AS TR_TYPE
          FROM hive_metastore.ods_dl.mfs_transaction_aml
          WHERE TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN '{start_str}' AND '{end_str}'
          AND TRANSACTIONSTATUS IN ('Success','Completed')
          AND ORIGINALAMOUNT IS NOT NULL
          AND (CREDITPARTYTYPE = 'Customer' OR DEBITPARTYTYPE = 'Customer')
        )
        SELECT TR_TYPE, COUNT(*) AS CNT FROM base_unioned WHERE TR_TYPE IS NOT NULL GROUP BY TR_TYPE ORDER BY CNT DESC
        """
        try:
          debug_res = self.db.execute(text(debug_types_query))
          debug_types = [dict(r) for r in debug_res.mappings()]
          print(f"DEBUG: available TR_TYPEs for {start_str} to {end_str}: {debug_types}")
        except Exception as e:
          print("DEBUG: failed to fetch TR_TYPE list:", e)

        result = self.db.execute(text(query))
        daily_records = [dict(row) for row in result.mappings()]
        print(f"DEBUG: returned daily_records count={len(daily_records)} for tr_type={tr_type}")

        return {
          "period": period,
          "start_date": start_str,
          "end_date": end_str,
          "daily_records": daily_records
        }

    def get_subscribers_snapshot_by_day_of_month(
        self,
        day_of_month: int,
        msisdn_list: Optional[List[str]] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        Return a snapshot table of subscriber counts per TR_TYPE for each month,
        filtered to transactions that occurred on the given day-of-month (e.g. 25 -> all 25ths).

        Args:
            day_of_month: integer 1-31 to filter day of month
            msisdn_list: optional list of MSISDNs to filter
            start_date/end_date: optional date range (defaults to first of current month to yesterday)

        Returns:
            Dict with: period, start_date, end_date, day_of_month, months[], rows[] where each row has TR_TYPE and values per month
        """
        # Determine date range
        today = date.today()
        # Default start: 1st January of current year if not provided
        if not start_date:
          start_date = date(today.year, 1, 1)
          period = "YTD"
        else:
          period = "CUSTOM"

        # Default end: yesterday if not provided
        if not end_date:
          end_date = today - timedelta(days=1)

        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')

        msisdn_outer_filter = ""
        if msisdn_list and len(msisdn_list) > 0:
            m_list_str = "', '".join(msisdn_list)
            msisdn_outer_filter = f"AND MSISDN IN ('{m_list_str}')"

        # Build full pipeline to compute monthly cumulative SUBS up to the selected day-of-month
        query = f"""
        WITH base_unioned AS (
          -- receive / credit side
          SELECT DISTINCT
            TRANSACTIONID,
            TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') AS TRANSACTION_DATE,
            CREDITPARTYIDENTIFIER AS MSISDN,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            CASE 
                  WHEN SERVICENAME='OD Money Transfer Prefunded' AND DEBITPARTYIDENTIFIER = '07421468' THEN 'B2W'
                  WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code') THEN 'P2P_RECEIVE'
                  WHEN SERVICENAME = 'Cash In' THEN 'CASHIN'
                  WHEN SERVICENAME = 'Cash In OTC' THEN 'Cash In OTC'
                  WHEN SERVICENAME ='IMT revceiving' THEN 'IMT'
               END AS TR_TYPE
          FROM hive_metastore.ods_dl.mfs_transaction_aml
          WHERE TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN '{start_str}' AND '{end_str}'
            AND TRANSACTIONSTATUS IN ('Success','Completed')
            AND SERVICENAME IN ('Cash In','P2P Transfer','Send Money to Registered Customer by QR Code','Cash In OTC','IMT revceiving','OD Money Transfer Prefunded')
            AND ORIGINALAMOUNT IS NOT NULL
            AND CREDITPARTYTYPE = 'Customer'

          UNION ALL

          -- send / debit side
          SELECT DISTINCT
            TRANSACTIONID,
            TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') AS TRANSACTION_DATE,
            DEBITPARTYIDENTIFIER AS MSISDN,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            CASE 
                  WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code') THEN 'P2P_SEND'
                  WHEN SERVICENAME = 'Cash Out' THEN 'CASHOUT'
                  WHEN SERVICENAME = 'Customer Bill Payment' 
                       AND CREDITPARTYIDENTIFIER IN ('314','318','322','326','310') THEN 'DIGI_PRODUCT'
                  WHEN SERVICENAME = 'Customer Bill Payment' THEN 'BILLPAY'
                  WHEN SERVICENAME = 'Gift Top up' THEN 'TOPUP_GIFT'
                  WHEN SERVICENAME = 'Prepaid Top up' THEN 'SELF_TOPUP'
                  WHEN SERVICENAME IN (
                      'Merchant Payment','Merchant QR Payment','Merchant Till payment',
                      'Merchant to Merchant Payment via Till ID','Merchant Online Payment'
                  ) THEN 'PAY2MERC'
               END AS TR_TYPE
          FROM hive_metastore.ods_dl.mfs_transaction_aml
          WHERE TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN '{start_str}' AND '{end_str}'
            AND TRANSACTIONSTATUS IN ('Success','Completed')
            AND ORIGINALAMOUNT IS NOT NULL
            AND DEBITPARTYTYPE = 'Customer'
            AND SERVICENAME IN (
              'Cash Out','Merchant Cashout','Customer Bill Payment','Agent/Merchant Bill Payment',
              'Merchant Payment to Merchant','Merchant Payment','Merchant QR Payment','Merchant Till payment',
              'Merchant to Merchant Payment via Till ID','Merchant Online Payment','P2P Transfer',
              'Send Money to Registered Customer by QR Code','Prepaid Top up','Gift Top up','OTC Top Up'
            )
        ),

        first_per_month AS (
          SELECT
            TR_TYPE,
            MSISDN,
            TRANSACTION_DATE,
            ROW_NUMBER() OVER (
              PARTITION BY TR_TYPE, MSISDN, TRUNC(TRANSACTION_DATE,'MM')
              ORDER BY TRANSACTION_DATE
            ) AS rn
          FROM base_unioned
          WHERE MSISDN IS NOT NULL {msisdn_outer_filter}
        ),

        daily_new_subs AS (
          SELECT TR_TYPE, TRANSACTION_DATE, COUNT(*) AS NEW_SUBS
          FROM first_per_month
          WHERE rn = 1
          GROUP BY TR_TYPE, TRANSACTION_DATE
        ),

        daily_metrics AS (
          SELECT
            TR_TYPE,
            TRANSACTION_DATE,
            COUNT(TRANSACTIONID) AS TR_VOLUME,
            SUM(ORIGINALAMOUNT) AS TR_VALUE,
            SUM(CHARGEAMOUNT) AS MFS_REVENUE
          FROM base_unioned
          WHERE TR_TYPE IS NOT NULL {msisdn_outer_filter}
          GROUP BY TR_TYPE, TRANSACTION_DATE
        ),

        daily_with_cumul AS (
          SELECT
            m.TR_TYPE,
            m.TRANSACTION_DATE,
            COALESCE(n.NEW_SUBS, 0) AS DAILY_SUBS,
            m.TR_VOLUME AS DAILY_VOLUME,
            m.TR_VALUE AS DAILY_VALUE,
            m.MFS_REVENUE AS DAILY_REVENUE,
            SUM(COALESCE(n.NEW_SUBS,0)) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_SUBS,
            SUM(m.TR_VOLUME) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_TR_VOLUME,
            SUM(m.TR_VALUE) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_TR_VALUE,
            SUM(m.MFS_REVENUE) OVER (
              PARTITION BY m.TR_TYPE, TRUNC(m.TRANSACTION_DATE,'MM')
              ORDER BY m.TRANSACTION_DATE
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS CUMUL_MFS_REVENUE
          FROM daily_metrics m
          LEFT JOIN daily_new_subs n
            ON m.TR_TYPE = n.TR_TYPE
            AND m.TRANSACTION_DATE = n.TRANSACTION_DATE
        )

        SELECT DISTINCT
          TR_TYPE,
          date_format(TRANSACTION_DATE,'yyyy-MM') AS MONTH,
          CUMUL_SUBS AS SUBS,
          CUMUL_TR_VOLUME AS VOLUME,
          CUMUL_TR_VALUE AS VALUE,
          CUMUL_MFS_REVENUE AS REVENUE
        FROM daily_with_cumul
        WHERE DAY(TRANSACTION_DATE) = {day_of_month}
        ORDER BY TR_TYPE, MONTH
        """

        result = self.db.execute(text(query))
        rows = [dict(r) for r in result.mappings()]

        # If no rows returned for the selected day, run a diagnostic without the DAY filter
        diagnostic: Optional[Dict[str, Any]] = None
        if len(rows) == 0:
            try:
                diag_q = f"""
                WITH base_unioned AS (
                  SELECT DISTINCT
                    TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') AS TRANSACTION_DATE,
                    CREDITPARTYIDENTIFIER AS MSISDN,
                    CASE WHEN SERVICENAME='OD Money Transfer Prefunded' AND DEBITPARTYIDENTIFIER = '07421468' THEN 'B2W'
                         WHEN SERVICENAME IN ('P2P Transfer', 'Send Money to Registered Customer by QR Code') THEN 'P2P_RECEIVE'
                         WHEN SERVICENAME = 'Cash In' THEN 'CASHIN'
                         WHEN SERVICENAME = 'Cash In OTC' THEN 'Cash In OTC'
                         WHEN SERVICENAME ='IMT revceiving' THEN 'IMT'
                    END AS TR_TYPE
                  FROM hive_metastore.ods_dl.mfs_transaction_aml
                  WHERE TO_DATE(TRANSACTIONFINISHTIME, 'yyyy-MM-dd') BETWEEN '{start_str}' AND '{end_str}'
                    AND TRANSACTIONSTATUS IN ('Success','Completed')
                    AND ORIGINALAMOUNT IS NOT NULL
                    AND (CREDITPARTYTYPE = 'Customer' OR DEBITPARTYTYPE = 'Customer')
                )
                SELECT TR_TYPE, date_format(TRANSACTION_DATE,'yyyy-MM') AS MONTH, COUNT(DISTINCT MSISDN) AS SUBS
                FROM base_unioned
                WHERE TR_TYPE IS NOT NULL
                GROUP BY TR_TYPE, date_format(TRANSACTION_DATE,'yyyy-MM')
                ORDER BY TR_TYPE, MONTH
                """
                diag_res = self.db.execute(text(diag_q))
                diag_rows = [dict(r) for r in diag_res.mappings()]
                diagnostic = { 'rows': diag_rows }
            except Exception as e:
                diagnostic = { 'error': str(e) }

        # Build full months list between start and end (inclusive) in yyyy-MM format
        from datetime import datetime
        s_dt = datetime.strptime(start_str, '%Y-%m-%d')
        e_dt = datetime.strptime(end_str, '%Y-%m-%d')
        months = []
        cur = s_dt.replace(day=1)
        while cur <= e_dt:
          months.append(cur.strftime('%Y-%m'))
          # advance one month
          if cur.month == 12:
            cur = cur.replace(year=cur.year + 1, month=1)
          else:
            cur = cur.replace(month=cur.month + 1)

        # Aggregate rows by TR_TYPE and month for each metric
        rows_by_type: Dict[str, Dict[str, Dict[str, float]]] = {}
        for r in rows:
          t = r.get('TR_TYPE')
          m = r.get('MONTH')
          if t is None or m is None:
            continue
          rows_by_type.setdefault(t, {}).setdefault(m, {})
          rows_by_type[t][m]['SUBS'] = int(r.get('SUBS', 0))
          rows_by_type[t][m]['VOLUME'] = int(r.get('VOLUME', 0))
          # VALUE and REVENUE may be floats
          rows_by_type[t][m]['VALUE'] = float(r.get('VALUE') or 0)
          rows_by_type[t][m]['REVENUE'] = float(r.get('REVENUE') or 0)

        # Canonical list of TR_TYPEs to always display (keeps table stable)
        canonical_types = [
          'CASHOUT', 'P2P_RECEIVE', 'P2P_SEND', 'CASHIN', 'Cash In OTC', 'IMT',
          'B2W', 'DIGI_PRODUCT', 'BILLPAY', 'TOPUP_GIFT', 'SELF_TOPUP', 'PAY2MERC'
        ]

        # Ensure we include any discovered types not in canonical list
        all_types = list(dict.fromkeys(canonical_types + list(rows_by_type.keys())))

        # Build rows: for each TR_TYPE, output four rows (Subscribers, Volume, Value, Revenue)
        snapshot_rows = []
        metrics = [
          ('Subscribers', 'SUBS'),
          ('Volume', 'VOLUME'),
          ('Value', 'VALUE'),
          ('Revenue', 'REVENUE')
        ]

        for tr_type in all_types:
          month_map = rows_by_type.get(tr_type, {})
          for label, key in metrics:
            values = []
            for m in months:
              cell = month_map.get(m, {})
              v = cell.get(key, 0)
              # cast to int for counts, keep float for money
              if key in ('SUBS', 'VOLUME'):
                values.append(int(v))
              else:
                values.append(float(v))
            snapshot_rows.append({
              'TR_TYPE': f"{tr_type} — {label}",
              'metric': key,
              'values': values
            })

        return {
          'period': period,
          'start_date': start_str,
          'end_date': end_str,
          'day_of_month': day_of_month,
          'months': months,
          'rows': snapshot_rows
        }
