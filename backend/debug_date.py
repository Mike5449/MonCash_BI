import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Add parent dir to sys.path so we can import internal modules
sys.path.append(os.getcwd())
from core.config import settings

load_dotenv()

def check_latest_date():
    try:
        # Construct URL manually if settings is not fully loaded with env
        token = os.getenv("DATABRICKS_TOKEN")
        hostname = os.getenv("DATABRICKS_SERVER_HOSTNAME")
        http_path = os.getenv("DATABRICKS_HTTP_PATH")
        
        url = f"databricks://token:{token}@{hostname}?http_path={http_path}"
        engine = create_engine(url)
        
        with engine.connect() as conn:
            query = text("SELECT MAX(DATE_CODE) FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit")
            result = conn.execute(query).fetchone()
            print(f"Latest DATE_CODE: {result[0]}")
            
            query2 = text("SELECT current_date")
            result2 = conn.execute(query2).fetchone()
            print(f"Current Date: {result2[0]}")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_latest_date()
