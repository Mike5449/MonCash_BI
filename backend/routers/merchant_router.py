from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, timedelta
from database import get_db
from services.merchant.merchant_service import MerchantService
from utils.xlsx_stream import stream_xlsx, stream_csv, select_columns


def _date_only(v):
    if not v: return ""
    s = str(v)
    return s.split('T')[0] if 'T' in s else s


MERCHANT_TX_COLUMNS = [
    ("DATE",           "Date",           lambda r: _date_only(r.get("TRANSACTION_DATE"))),
    ("TRANSACTION_ID", "Transaction ID", lambda r: r.get("TRANSACTIONID") or ""),
    ("TYPE",           "Type",           lambda r: r.get("TR_TYPE") or ""),
    ("MSISDN",         "MSISDN",         lambda r: r.get("MSISDN") or ""),
    ("MERCHANT_ID",    "Merchant ID",    lambda r: r.get("MERCHANT_ID") or ""),
    ("AMOUNT",         "Amount (HTG)",   lambda r: float(r.get("AMOUNT") or 0)),
    ("CHARGE",         "Charge (HTG)",   lambda r: float(r.get("CHARGE") or 0)),
    ("CHANNEL",        "Channel",        lambda r: r.get("CHANNEL") or ""),
    ("STATUS",         "Status",         lambda r: r.get("STATUS") or ""),
    ("REASON_TYPE",    "Reason Type",    lambda r: r.get("REASONTYPE") or ""),
    ("INITIATOR",      "Initiator",      lambda r: r.get("INITIATOR") or ""),
    ("FAILURE_REASON", "Failure Reason", lambda r: r.get("FAILUREREASON") or ""),
]

router = APIRouter(
    prefix="/merchants",
    tags=["merchants"]
)


MERCHANT_ACCOUNT_COLUMNS = [
    ("DATE_CODE",       "Date Code",        lambda r: r.get("DATE_CODE") or ""),
    ("CREATED_DATE",    "Created Date",     lambda r: _date_only(r.get("CREATED_DATE"))),
    ("MERCHANT_NAME",   "Merchant Name",    lambda r: r.get("MERCHANT_NAME") or ""),
    ("ACCOUNT_ID",      "Account ID",       lambda r: r.get("ACCOUNT_ID") or ""),
    ("SHORTCODE",       "Shortcode",        lambda r: r.get("MERCHANT_SHORT_CODE") or ""),
    ("IDENTITY_ID",     "Identity ID",      lambda r: r.get("IDENTITY_ID") or ""),
    ("MERCHANT_TYPE",   "Merchant Type",    lambda r: r.get("MERCHANT_TYPE") or ""),
    ("FEE",             "Fee",              lambda r: r.get("FEE") or ""),
    ("DEPARTMENT",      "Department",       lambda r: r.get("DEPARTMENT") or ""),
    ("COMMUNE",         "Commune",          lambda r: r.get("COMMUNE") or ""),
    ("STATUS",          "Status",           lambda r: r.get("STATUS") or ""),
    ("ACCOUNT_GL_CODE", "GL Code",          lambda r: r.get("ACCOUNT_GL_CODE") or ""),
]


@router.get("/accounts", summary="Annuaire Merchant — filtres date d'enregistrement, type, département, statut, search")
def get_merchant_accounts(
    limit: int = Query(100, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    created_start: Optional[date] = Query(None, description="Date d'enregistrement (>= début)"),
    created_end:   Optional[date] = Query(None, description="Date d'enregistrement (<= fin)"),
    merchant_types: Optional[List[str]] = Query(None, description="Whitelist sur MERCHANT_TYPE (Gold, Silver, Blue, ...)"),
    departments:    Optional[List[str]] = Query(None, description="Whitelist sur DEPARTMENT"),
    statuses:       Optional[List[str]] = Query(None, description="Whitelist sur IDENTITYSTATUS (Active/Closed/...)"),
    search:         Optional[str]       = Query(None, description="Search libre — name / account ID / shortcode / identity ID"),
    db: Session = Depends(get_db)
):
    return MerchantService.get_accounts(
        db, limit, offset, created_start, created_end,
        merchant_types, departments, statuses, search,
    )


@router.get("/accounts/filter-options", summary="Distinct values for filter dropdowns (types, departments, statuses)")
def get_merchant_accounts_filter_options(db: Session = Depends(get_db)):
    return MerchantService.get_accounts_filter_options(db)


@router.get("/accounts/export.xlsx", summary="Stream XLSX des Merchant accounts (filtres appliqués)")
def export_merchant_accounts_xlsx(
    created_start: Optional[date] = Query(None),
    created_end:   Optional[date] = Query(None),
    merchant_types: Optional[List[str]] = Query(None),
    departments:    Optional[List[str]] = Query(None),
    statuses:       Optional[List[str]] = Query(None),
    search:         Optional[str]       = Query(None),
    columns:        Optional[str]       = Query(None),
    limit:          int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    rows = MerchantService.get_accounts_for_export(
        db, created_start, created_end, merchant_types, departments, statuses, search, limit,
    )
    cols = select_columns(MERCHANT_ACCOUNT_COLUMNS, columns)
    s = (created_start or "all")
    e = (created_end   or "now")
    return stream_xlsx(rows, cols, f"Merchant_Accounts_{s}_to_{e}.xlsx", "Merchant_Accounts")


@router.get("/transactions", summary="Get Merchant transactions (UNION credit+debit, PROCESS_DATE)")
def get_merchant_transactions(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None, description="Filtrer par TR_TYPE (AGENT2MERC / MERC_PAY / M2M_IN ...)"),
    merchant_ids: Optional[List[str]] = Query(None, description="Filtrer par MERCHANT_ID (CREDIT/DEBIT party identifier)"),
    msisdns: Optional[List[str]] = Query(None, description="Filtrer par MSISDN customer (le côté opposé à MERCHANT_ID)"),
    channels: Optional[List[str]] = Query(None, description="Filtrer par CHANNEL (API/Web/QR/USSD_Digicel/...)"),
    statuses: Optional[List[str]] = Query(None, description="Filtrer par TRANSACTIONSTATUS. Défaut: Completed. Utiliser ['*'] pour tous les statuts."),
    skip: int = Query(0),
    limit: int = Query(100),
    db: Session = Depends(get_db)
):
    return MerchantService.get_transactions(
        db, start_date, end_date, service_names, merchant_ids, limit, skip,
        channels, msisdns, statuses,
    )


ACTIVE_MERCHANTS_COLUMNS = [
    ("SHORTCODE",      "Shortcode",       lambda r: r.get("ORGANIZATIONSHORTCODE") or ""),
    ("NAME",           "Merchant Name",   lambda r: r.get("MERCHANT_NAME") or ""),
    ("ACCOUNT_ID",     "Account ID",      lambda r: r.get("ACCOUNT_ID") or ""),
    ("IDENTITY_ID",    "Identity ID",     lambda r: r.get("IDENTITY_ID") or ""),
    ("MERCHANT_TYPE",  "Merchant Type",   lambda r: r.get("MERCHANT_TYPE") or ""),
    ("FEE",            "Fee",             lambda r: r.get("FEE") or ""),
    ("DEPARTMENT",     "Department",      lambda r: r.get("DEPARTMENT") or ""),
    ("COMMUNE",        "Commune",         lambda r: r.get("COMMUNE") or ""),
    ("ACCOUNT_GL",     "Account GL Code", lambda r: r.get("ACCOUNTGLCODE") or ""),
    ("VOLUME",         "Volume",          lambda r: int(r.get("VOLUME") or 0)),
    ("VALUE",          "Value (HTG)",     lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE",        "Revenue (HTG)",   lambda r: float(r.get("REVENUE") or 0)),
    ("FIRST_TX",       "First TX",        lambda r: str(r.get("FIRST_TX") or "")),
    ("LAST_TX",        "Last TX",         lambda r: str(r.get("LAST_TX") or "")),
]


@router.get("/active-merchants", summary="Merchants ayant reçu des transactions Customer dans la période")
def get_active_merchants(
    start_date: Optional[date] = Query(None, description="Défaut: J-30"),
    end_date: Optional[date] = Query(None, description="Défaut: yesterday"),
    limit: int = Query(500, ge=1, le=600_000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """
    Liste des merchants actifs (CREDIT side Organization/Merchant) sur la période.
    Renvoie pour chaque merchant : profil (Name, Type, Fee, Department, etc.) + tx aggregates
    (SUBS = customers uniques ayant payé, VOLUME, VALUE HTG, REVENUE, FIRST_TX, LAST_TX).
    Jointure : ORGANIZATIONSHORTCODE.
    """
    return MerchantService.get_active_merchants(db, start_date, end_date, limit, offset)


@router.get("/active-merchants/export.csv", summary="Stream CSV des active merchants")
def export_active_merchants_csv(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    data = MerchantService.get_active_merchants(db, start_date, end_date, limit, 0)
    rows = data.get("rows", [])
    cols = select_columns(ACTIVE_MERCHANTS_COLUMNS, columns)
    s = (start_date or date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return stream_csv(rows, cols, f"Active_Merchants_{s}_to_{e}.csv")


@router.get("/active-merchants/export.xlsx", summary="Stream XLSX des active merchants")
def export_active_merchants_xlsx(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    data = MerchantService.get_active_merchants(db, start_date, end_date, limit, 0)
    rows = data.get("rows", [])
    cols = select_columns(ACTIVE_MERCHANTS_COLUMNS, columns)
    s = (start_date or date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return stream_xlsx(rows, cols, f"Active_Merchants_{s}_to_{e}.xlsx", "Active_Merchants")


@router.get("/transactions/export.xlsx", summary="Stream un XLSX des merchant transactions")
def export_merchant_transactions_xlsx(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    merchant_ids: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    rows = MerchantService.get_transactions(
        db, start_date, end_date, service_names, merchant_ids, limit, 0,
        channels, msisdns, statuses,
    )
    cols = select_columns(MERCHANT_TX_COLUMNS, columns)
    s = (start_date or date.today() - timedelta(days=7)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return stream_xlsx(rows, cols, f"Merchant_Transactions_{s}_to_{e}.xlsx", "Merchant_Tx")


MERCHANT_MONTHLY_COLUMNS = [
    ("MONTH",         "Month",            lambda r: r.get("MONTH") or ""),
    ("MERCHANT_ID",   "Merchant ID",      lambda r: r.get("MERCHANT_ID") or ""),
    ("MERCHANT_NAME", "Merchant Name",    lambda r: r.get("MERCHANT_NAME") or ""),
    ("MERCHANT_TYPE", "Merchant Type",    lambda r: r.get("MERCHANT_TYPE") or ""),
    ("FEE",           "Fee",              lambda r: r.get("FEE") or ""),
    ("DEPARTMENT",    "Department",       lambda r: r.get("DEPARTMENT") or ""),
    ("COMMUNE",       "Commune",          lambda r: r.get("COMMUNE") or ""),
    ("SUBS",          "Unique Subs",      lambda r: int(r.get("SUBS") or 0)),
    ("VOLUME",        "Volume",           lambda r: int(r.get("VOLUME") or 0)),
    ("VALUE",         "Value (HTG)",      lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE",       "Revenue (HTG)",    lambda r: float(r.get("REVENUE") or 0)),
]


@router.get("/monthly-stats", summary="Monthly aggregates per (MONTH, MERCHANT_ID)")
def get_merchant_monthly_stats(
    start_month: Optional[date] = Query(None, description="Premier jour du mois de début. Défaut: 6 mois en arrière."),
    end_month: Optional[date]   = Query(None, description="Une date du mois de fin (inclus). Défaut: yesterday."),
    service_names: Optional[List[str]] = Query(None, description="Filtrer par TR_TYPE"),
    merchant_ids: Optional[List[str]]  = Query(None, description="Filtrer par MERCHANT_ID"),
    msisdns: Optional[List[str]]       = Query(None, description="Filtrer par customer MSISDN (côté opposé)"),
    channels: Optional[List[str]]      = Query(None, description="Filtrer par CHANNEL"),
    statuses: Optional[List[str]]      = Query(None, description="Filtrer par TRANSACTIONSTATUS. Défaut Completed. ['*'] = tous"),
    limit: int = Query(10000, ge=1, le=200_000),
    db: Session = Depends(get_db),
):
    """
    Pour chaque (MONTH, MERCHANT_ID) :
    - **SUBS**    : MSISDN distincts ayant transigé avec ce merchant ce mois-ci
    - **VOLUME**  : COUNT(DISTINCT TRANSACTIONID)
    - **VALUE**   : SUM(ORIGINALAMOUNT) HTG
    - **REVENUE** : SUM(CHARGEAMOUNT)   HTG

    LEFT JOIN sur le profil merchant (name, type, fee, department, commune).
    Les exclusions hardcodées (test accounts, internal IDs, reason types) s'appliquent automatiquement.
    """
    return MerchantService.get_monthly_stats_by_merchant(
        db, start_month, end_month, service_names, merchant_ids, channels, msisdns, statuses, limit,
    )


@router.get("/monthly-stats/export.xlsx", summary="Stream XLSX des monthly stats by merchant")
def export_merchant_monthly_stats_xlsx(
    start_month: Optional[date] = Query(None),
    end_month: Optional[date]   = Query(None),
    service_names: Optional[List[str]] = Query(None),
    merchant_ids: Optional[List[str]]  = Query(None),
    msisdns: Optional[List[str]]       = Query(None),
    channels: Optional[List[str]]      = Query(None),
    statuses: Optional[List[str]]      = Query(None),
    columns: Optional[str]             = Query(None),
    limit: int = Query(200_000, ge=1, le=2_000_000),
    db: Session = Depends(get_db),
):
    data = MerchantService.get_monthly_stats_by_merchant(
        db, start_month, end_month, service_names, merchant_ids, channels, msisdns, statuses, limit,
    )
    rows = data.get("rows", [])
    cols = select_columns(MERCHANT_MONTHLY_COLUMNS, columns)
    s = data.get("start_month") or "all"
    e = data.get("end_month")   or "now"
    return stream_xlsx(rows, cols, f"Merchant_Monthly_Stats_{s}_to_{e}.xlsx", "Merchant_Monthly")


@router.get("/transactions/summary", summary="Aggregate Merchant KPIs over the full period (no row limit)")
def get_merchant_transactions_summary(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    merchant_ids: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Renvoie pour la période et filtres donnés :
    - **UNIQUE_SUBS**      : MSISDN distincts ayant transigé avec un merchant
    - **UNIQUE_MERCHANTS** : merchants distincts
    - **VOLUME**           : COUNT(DISTINCT TRANSACTIONID)
    - **VALUE**            : SUM(ORIGINALAMOUNT) HTG
    - **REVENUE**          : SUM(CHARGEAMOUNT) HTG

    Aliases legacy (anciens callers) :
    - **TOTAL_COUNT**, **DISTINCT_MERCHANT**, **TOTAL_VOLUME** (= VALUE), **TOTAL_CHARGE** (= REVENUE)
    """
    return MerchantService.get_transactions_summary(
        db, start_date, end_date, service_names, merchant_ids, channels, msisdns, statuses,
    )
