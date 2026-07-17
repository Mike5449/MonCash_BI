from database import SessionLocal
from sqlalchemy import text
import sys

db = SessionLocal()
try:
    query = "SELECT ACCOUNT FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit WHERE IDENTITYMSISDN IS NOT NULL AND ACCOUNT IS NOT NULL LIMIT 2"
    res = db.execute(text(query)).mappings().all()
    for r in res:
        print(f"ACCOUNT: {r['ACCOUNT']}")
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
