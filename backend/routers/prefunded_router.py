from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from database import get_db
from services.prefunded.prefunded_service import PrefundedService
from utils.xlsx_stream import stream_xlsx, select_columns


def _date_only(v):
    if not v: return ""
    s = str(v)
    return s.split('T')[0] if 'T' in s else s


PREFUNDED_TX_COLUMNS = [
    ("DATE",           "Date",           lambda r: _date_only(r.get("TRANSACTION_DATE"))),
    ("TRANSACTION_ID", "Transaction ID", lambda r: r.get("TRANSACTIONID") or ""),
    ("ORG_ID",         "Organization ID",   lambda r: r.get("ORG_ID") or ""),
    ("ORG_NAME",       "Organization name", lambda r: r.get("ORG_NAME") or ""),
    ("MSISDN",         "MSISDN",         lambda r: r.get("MSISDN") or ""),
    ("SERVICE",        "Service",        lambda r: r.get("TR_TYPE") or ""),
    ("AMOUNT",         "Amount (HTG)",   lambda r: float(r.get("ORIGINALAMOUNT") or 0)),
    ("CHARGE",         "Charge (HTG)",   lambda r: float(r.get("CHARGEAMOUNT") or 0)),
    ("CHANNEL",        "Channel",        lambda r: r.get("CHANNEL") or ""),
    ("STATUS",         "Status",         lambda r: r.get("STATUS") or "Completed"),
]


router = APIRouter(
    prefix="/prefunded",
    tags=["prefunded"]
)


@router.get("/accounts", summary="Get Prefunded accounts")
def get_prefunded_accounts(
    limit: int = Query(100),
    db: Session = Depends(get_db)
):
    return PrefundedService.get_accounts(db, limit)


@router.get("/transactions", summary="Get Prefunded (B2C) transactions")
def get_prefunded_transactions(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    limit: int = Query(100),
    active_only: bool = Query(False),
    org_ids: Optional[List[str]] = Query(None, description="Filtrer par un ou plusieurs Organization ID (DEBITPARTYIDENTIFIER)"),
    msisdns: Optional[List[str]] = Query(None, description="Filtrer par un ou plusieurs MSISDN destinataire (CREDITPARTYIDENTIFIER)"),
    channels: Optional[List[str]] = Query(None, description="Filtrer par CHANNEL (API/Web/QR/USSD_Digicel/...)"),
    statuses: Optional[List[str]] = Query(None, description="Filtrer par TRANSACTIONSTATUS. Défaut: Completed. Utiliser ['*'] pour tous les statuts."),
    db: Session = Depends(get_db),
):
    return PrefundedService.get_transactions(
        db, start_date, end_date, limit, active_only, org_ids, msisdns, channels, statuses
    )


@router.get("/transactions/summary", summary="KPI aggregate over Prefunded transactions")
def get_prefunded_transactions_summary(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    org_ids: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Renvoie pour la période filtrée :
    - **UNIQUE_SUBS** : MSISDN distincts ayant reçu un prefunded transfer
    - **UNIQUE_ORGS** : Organisations distinctes ayant émis au moins un transfert
    - **VOLUME**      : COUNT(DISTINCT TRANSACTIONID)
    - **VALUE**       : SUM(ORIGINALAMOUNT) — HTG
    - **REVENUE**     : SUM(CHARGEAMOUNT)   — HTG
    """
    return PrefundedService.get_transactions_summary(
        db, start_date, end_date, org_ids, msisdns, channels, statuses
    )


PREFUNDED_MONTHLY_COLUMNS = [
    ("MONTH",    "Month",            lambda r: r.get("MONTH") or ""),
    ("ORG_ID",   "Organization ID",  lambda r: r.get("ORG_ID") or ""),
    ("ORG_NAME", "Organization name", lambda r: r.get("ORG_NAME") or ""),
    ("SUBS",     "Unique Subs",      lambda r: int(r.get("SUBS") or 0)),
    ("VOLUME",   "Volume",           lambda r: int(r.get("VOLUME") or 0)),
    ("VALUE",    "Value (HTG)",      lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE",  "Revenue (HTG)",    lambda r: float(r.get("REVENUE") or 0)),
]


@router.get("/monthly-stats", summary="Monthly aggregates per (MONTH, ORGANIZATION_ID)")
def get_prefunded_monthly_stats(
    start_month: Optional[str] = Query(None, description="YYYY-MM-DD (1er du mois de début). Défaut: 6 mois en arrière."),
    end_month:   Optional[str] = Query(None, description="YYYY-MM-DD (jour du mois de fin). Défaut: today."),
    org_ids:     Optional[List[str]] = Query(None),
    msisdns:     Optional[List[str]] = Query(None),
    channels:    Optional[List[str]] = Query(None),
    statuses:    Optional[List[str]] = Query(None),
    limit: int = Query(10000, ge=1, le=200_000),
    db: Session = Depends(get_db),
):
    """
    Pour chaque (MONTH, ORG_ID) :
    - **SUBS**    : COUNT(DISTINCT CREDITPARTYIDENTIFIER) — MSISDN distincts ayant reçu un transfer
    - **VOLUME**  : COUNT(DISTINCT TRANSACTIONID)
    - **VALUE**   : SUM(ORIGINALAMOUNT) HTG
    - **REVENUE** : SUM(CHARGEAMOUNT)   HTG
    Chaque ligne inclut **ORG_NAME** (DEBITPARTYNAME).
    """
    return PrefundedService.get_monthly_stats_by_org(
        db, start_month, end_month, org_ids, msisdns, channels, statuses, limit,
    )


@router.get("/monthly-stats/export.xlsx", summary="Stream XLSX des monthly stats by organization")
def export_prefunded_monthly_stats_xlsx(
    start_month: Optional[str] = Query(None),
    end_month:   Optional[str] = Query(None),
    org_ids:     Optional[List[str]] = Query(None),
    msisdns:     Optional[List[str]] = Query(None),
    channels:    Optional[List[str]] = Query(None),
    statuses:    Optional[List[str]] = Query(None),
    columns:     Optional[str] = Query(None),
    limit: int = Query(200_000, ge=1, le=2_000_000),
    db: Session = Depends(get_db),
):
    data = PrefundedService.get_monthly_stats_by_org(
        db, start_month, end_month, org_ids, msisdns, channels, statuses, limit,
    )
    rows = data.get("rows", [])
    cols = select_columns(PREFUNDED_MONTHLY_COLUMNS, columns)
    s = data.get("start_month") or "all"
    e = data.get("end_month")   or "now"
    return stream_xlsx(rows, cols, f"Prefunded_Monthly_Stats_{s}_to_{e}.xlsx", "Prefunded_Monthly")


@router.get("/transactions/export.xlsx", summary="Stream un XLSX des prefunded transactions")
def export_prefunded_transactions_xlsx(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    org_ids: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    rows = PrefundedService.get_transactions(
        db, start_date, end_date, limit, False, org_ids, msisdns, channels, statuses
    )
    cols = select_columns(PREFUNDED_TX_COLUMNS, columns)
    s = start_date or "all"
    e = end_date   or "now"
    return stream_xlsx(rows, cols, f"Prefunded_Transactions_{s}_to_{e}.xlsx", "Prefunded_Tx")
