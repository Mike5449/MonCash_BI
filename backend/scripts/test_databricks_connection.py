import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.example")
load_dotenv(env_path)

from database import engine
from sqlalchemy import text

def test_connection():
    try:
        with engine.connect() as conn:
            print("Listing catalogs...")
            catalogs = conn.execute(text("SHOW CATALOGS")).fetchall()
            for cat in catalogs:
                print(f"Catalog: {cat[0]}")
            
            print("\nListing schemas in current catalog...")
            schemas = conn.execute(text("SHOW SCHEMAS")).fetchall()
            for schema in schemas:
                print(f"Schema: {schema[0]}")
            
            result = conn.execute(text("SELECT 1 AS connection_test"))
            print("\nConnection test successful!")
    except Exception as e:
        print("Error connecting to Databricks:", e)

if __name__ == "__main__":
    test_connection()
