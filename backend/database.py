import logging
import time
import threading
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from core.config import settings
from azure.identity import DefaultAzureCredential, InteractiveBrowserCredential
from databricks import sql

logger = logging.getLogger(__name__)

# Persistent Global Identity State
_token_cache = {
    "access_token": None,
    "expiry": 0,
    "credential": None
}
_auth_lock = threading.Lock()

def get_databricks_token():
    """Acquires and caches the Databricks access token silently and thread-safely."""
    global _token_cache

    # 1. First check (no lock)
    current_time = time.time()
    if _token_cache["access_token"] and (current_time < _token_cache["expiry"] - 300):
        return _token_cache["access_token"]

    # 2. Acquire lock for renewal
    with _auth_lock:
        # Check again inside lock (Double-Checked Locking)
        current_time = time.time()
        if _token_cache["access_token"] and (current_time < _token_cache["expiry"] - 300):
            return _token_cache["access_token"]

        try:
            if _token_cache["credential"] is None:
                logger.info("[AUTH] Initializing DefaultAzureCredential (Silent -> CLI -> Browser)")
                _token_cache["credential"] = DefaultAzureCredential(connection_verify=False)

            logger.info("[AUTH] Acquiring fresh Databricks token...")
            token_obj = _token_cache["credential"].get_token("2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default")

            _token_cache["access_token"] = token_obj.token
            _token_cache["expiry"] = token_obj.expires_on

            logger.info(f"[AUTH] Success! Token acquired. Expires in {int((_token_cache['expiry'] - current_time)/60)} minutes.")
            return _token_cache["access_token"]

        except Exception as e:
            logger.warning(f"[AUTH] Silent/Default auth failed: {str(e)}. Falling back to Interactive Browser.")
            try:
                browser_cred = InteractiveBrowserCredential(connection_verify=False)
                token_obj = browser_cred.get_token("2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default")
                _token_cache["access_token"] = token_obj.token
                _token_cache["expiry"] = token_obj.expires_on
                _token_cache["credential"] = browser_cred
                return _token_cache["access_token"]
            except Exception as inner_e:
                logger.error(f"[AUTH] Critical: Both default and interactive login failed: {str(inner_e)}")
                _token_cache["credential"] = None
                raise inner_e

def get_databricks_connection():
    """Custom creator function for SQLAlchemy engine to handle auth tokens."""
    token = get_databricks_token()

    try:
        return sql.connect(
            server_hostname=settings.DATABRICKS_SERVER_HOSTNAME,
            http_path=settings.DATABRICKS_HTTP_PATH,
            access_token=token
        )
    except Exception as e:
        logger.error(f"[DB] Connection failed: {str(e)}")
        _token_cache["access_token"] = None
        raise e

engine = create_engine(
    "databricks://",
    creator=get_databricks_connection,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=300
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
