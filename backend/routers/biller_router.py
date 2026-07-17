from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from database import get_db
from services.biller.biller_service import BillerService
from utils.xlsx_stream import stream_xlsx, select_columns


def _date_only(v):
    if not v: return ""
    s = str(v)
    return s.split('T')[0] if 'T' in s else s


BILLER_TX_COLUMNS = [
    ("DATE",           "Date",           lambda r: _date_only(r.get("TRANSACTION_DATE"))),
    ("TRANSACTION_ID", "Transaction ID", lambda r: r.get("TRANSACTIONID") or ""),
    ("MSISDN",         "MSISDN",         lambda r: r.get("MSISDN") or ""),
    ("BILLER_ID",      "Biller ID",      lambda r: r.get("ACCOUNT_ID") or ""),
    ("BILLER_NAME",    "Biller Name",    lambda r: r.get("BILLER_NAME") or ""),
    ("SERVICE",        "Service",        lambda r: r.get("TR_TYPE") or ""),
    ("AMOUNT",         "Amount (HTG)",   lambda r: float(r.get("ORIGINALAMOUNT") or 0)),
    ("CHARGE",         "Charge (HTG)",   lambda r: float(r.get("CHARGEAMOUNT") or 0)),
    ("CHANNEL",        "Channel",        lambda r: r.get("CHANNEL") or ""),
    ("STATUS",         "Status",         lambda r: r.get("STATUS") or "Completed"),
]


router = APIRouter(
    prefix="/billers",
    tags=["billers"]
)


@router.get("/accounts", summary="Get Biller accounts")
def get_biller_accounts(
    limit: int = Query(100),
    db: Session = Depends(get_db)
):
    return BillerService.get_accounts(db, limit)


@router.get("/transactions", summary="Get Biller transactions (Customer Bill Payment)")
def get_biller_transactions(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    limit: int = Query(100),
    active_only: bool = Query(False),
    biller_ids: Optional[List[str]] = Query(None, description="Filtrer par un ou plusieurs Biller ID (CREDITPARTYIDENTIFIER)"),
    msisdns: Optional[List[str]] = Query(None, description="Filtrer par un ou plusieurs MSISDN (DEBITPARTYIDENTIFIER)"),
    channels: Optional[List[str]] = Query(None, description="Filtrer par CHANNEL (API/Web/QR/USSD_Digicel/...)"),
    statuses: Optional[List[str]] = Query(None, description="Filtrer par TRANSACTIONSTATUS (Completed/Pending/Failed/...). Défaut: Completed. Utiliser ['*'] pour désactiver le filtre."),
    db: Session = Depends(get_db)
):
    return BillerService.get_transactions(
        db, start_date, end_date, limit, active_only, biller_ids, msisdns, channels, statuses
    )


@router.get("/transactions/summary", summary="KPI aggregate over Biller transactions")
def get_biller_transactions_summary(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    biller_ids: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    statuses: Optional[List[str]] = Query(None, description="Défaut: Completed. ['*'] pour tous les statuts."),
    db: Session = Depends(get_db)
):
    """
    Renvoie pour la période filtrée :
    - **UNIQUE_SUBS**    : COUNT(DISTINCT DEBITPARTYIDENTIFIER) — clients ayant payé au moins une facture
    - **UNIQUE_BILLERS** : COUNT(DISTINCT CREDITPARTYIDENTIFIER) — billers ayant collecté au moins un paiement
    - **VOLUME**         : COUNT(DISTINCT TRANSACTIONID)
    - **VALUE**          : SUM(ORIGINALAMOUNT)   — montants collectés (HTG)
    - **REVENUE**        : SUM(CHARGEAMOUNT)     — revenus MFS (HTG)
    """
    return BillerService.get_transactions_summary(
        db, start_date, end_date, biller_ids, msisdns, channels, statuses
    )


BILLER_MONTHLY_COLUMNS = [
    ("MONTH",       "Month",            lambda r: r.get("MONTH") or ""),
    ("BILLER_ID",   "Biller ID",        lambda r: r.get("BILLER_ID") or ""),
    ("BILLER_NAME", "Biller Name",      lambda r: r.get("BILLER_NAME") or ""),
    ("SUBS",        "Unique Subs",      lambda r: int(r.get("SUBS") or 0)),
    ("VOLUME",      "Volume",           lambda r: int(r.get("VOLUME") or 0)),
    ("VALUE",       "Value (HTG)",      lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE",     "Revenue (HTG)",    lambda r: float(r.get("REVENUE") or 0)),
]


@router.get("/monthly-stats", summary="Monthly aggregates per (MONTH, BILLER_ID)")
def get_biller_monthly_stats(
    start_month: Optional[str] = Query(None, description="YYYY-MM-DD (1er du mois de début). Défaut: 6 mois en arrière."),
    end_month:   Optional[str] = Query(None, description="YYYY-MM-DD (jour du mois de fin). Défaut: today."),
    biller_ids:  Optional[List[str]] = Query(None),
    msisdns:     Optional[List[str]] = Query(None),
    channels:    Optional[List[str]] = Query(None),
    statuses:    Optional[List[str]] = Query(None),
    limit: int = Query(10000, ge=1, le=200_000),
    db: Session = Depends(get_db),
):
    """
    Pour chaque (MONTH, BILLER_ID) :
    - **SUBS**    : COUNT(DISTINCT DEBITPARTYIDENTIFIER) — clients distincts ayant payé ce biller ce mois-ci
    - **VOLUME**  : COUNT(DISTINCT TRANSACTIONID)
    - **VALUE**   : SUM(ORIGINALAMOUNT) HTG
    - **REVENUE** : SUM(CHARGEAMOUNT)   HTG
    Chaque ligne inclut **BILLER_NAME** (CREDITPARTYNAME).
    """
    return BillerService.get_monthly_stats_by_biller(
        db, start_month, end_month, biller_ids, msisdns, channels, statuses, limit,
    )


@router.get("/monthly-stats/export.xlsx", summary="Stream XLSX des monthly stats by biller")
def export_biller_monthly_stats_xlsx(
    start_month: Optional[str] = Query(None),
    end_month:   Optional[str] = Query(None),
    biller_ids:  Optional[List[str]] = Query(None),
    msisdns:     Optional[List[str]] = Query(None),
    channels:    Optional[List[str]] = Query(None),
    statuses:    Optional[List[str]] = Query(None),
    columns:     Optional[str] = Query(None),
    limit: int = Query(200_000, ge=1, le=2_000_000),
    db: Session = Depends(get_db),
):
    data = BillerService.get_monthly_stats_by_biller(
        db, start_month, end_month, biller_ids, msisdns, channels, statuses, limit,
    )
    rows = data.get("rows", [])
    cols = select_columns(BILLER_MONTHLY_COLUMNS, columns)
    s = data.get("start_month") or "all"
    e = data.get("end_month")   or "now"
    return stream_xlsx(rows, cols, f"Biller_Monthly_Stats_{s}_to_{e}.xlsx", "Biller_Monthly")


@router.get("/transactions/export.xlsx", summary="Stream un XLSX des biller transactions")
def export_biller_transactions_xlsx(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    biller_ids: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    statuses: Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    rows = BillerService.get_transactions(
        db, start_date, end_date, limit, False, biller_ids, msisdns, channels, statuses
    )
    cols = select_columns(BILLER_TX_COLUMNS, columns)
    s = start_date or "all"
    e = end_date   or "now"
    return stream_xlsx(rows, cols, f"Biller_Transactions_{s}_to_{e}.xlsx", "Biller_Tx")
