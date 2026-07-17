import os
import sys
from dotenv import load_dotenv
from databricks import sql
from azure.identity import InteractiveBrowserCredential
import pandas as pd
import ssl

ssl._create_default_https_context = ssl._create_unverified_context
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.example")
load_dotenv(env_path)

import certifi

# Bypass SSL verification locally if you are behind a corporate proxy
os.environ["AZURE_IDENTITY_DISABLE_MULTITENANT_AUTH"] = "true"
os.environ["CURL_CA_BUNDLE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()
os.environ["SSL_CERT_FILE"] = certifi.where()

# Retrieve info from env
server_hostname = os.getenv("DATABRICKS_SERVER_HOSTNAME")
http_path = os.getenv("DATABRICKS_HTTP_PATH")

print("Authenticating...")
# Authentification Azure AD (ouvre le navigateur)
credential = InteractiveBrowserCredential(connection_verify=False)
token = credential.get_token("2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default").token

print("Connecting to Databricks...")
# Connexion Databricks
connection = sql.connect(
    server_hostname=server_hostname,
    http_path=http_path,
    access_token=token
)

print("Running test query...")
# Test query 1
query1 = "SELECT current_user()"
df1 = pd.read_sql(query1, connection)
print("Current User:")
print(df1)

print("\nRunning second test query...")
# Test query 2
query2 = """
SELECT *
FROM system.information_schema.tables
LIMIT 10
"""
df2 = pd.read_sql(query2, connection)
print(df2)
