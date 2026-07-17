from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from database import get_db
from services.imt.imt_service import ImtService
from utils.xlsx_stream import stream_xlsx, select_columns


def _date_only(v):
    if not v: return ""
    s = str(v)
    return s.split('T')[0] if 'T' in s else s


IMT_TX_COLUMNS = [
    ("DATE",           "Date",            lambda r: _date_only(r.get("TRANSACTION_DATE"))),
    ("TRANSACTION_ID", "Transaction ID",  lambda r: r.get("TRANSACTIONID") or ""),
    ("MSISDN",         "MSISDN (receiver)", lambda r: r.get("MSISDN") or ""),
    ("SENDER_ID",      "Sender ID",       lambda r: r.get("SENDER_ID") or ""),
    ("SENDER_NAME",    "Sender Name",     lambda r: r.get("SENDER_NAME") or ""),
    ("AMOUNT",         "Amount (HTG)",    lambda r: float(r.get("ORIGINALAMOUNT") or 0)),
    ("CHARGE",         "Charge (HTG)",    lambda r: float(r.get("CHARGEAMOUNT") or 0)),
    ("CHANNEL",        "Channel",         lambda r: r.get("CHANNEL") or ""),
    ("STATUS",         "Status",          lambda r: r.get("STATUS") or "Completed"),
    ("DEPARTMENT",     "Department",      lambda r: r.get("DEPARTMENT") or "Unknown"),
    ("CITY",           "City",            lambda r: r.get("CITY") or "Unknown"),
    ("LOOKUP_DATE",    "Lookup Date",     lambda r: _date_only(r.get("LOCATION_SNAPSHOT_DATE"))),
    ("REASON_TYPE",    "Reason Type",     lambda r: r.get("REASONTYPE") or ""),
    ("INITIATOR",      "Initiator",       lambda r: r.get("INITIATOR") or ""),
    ("FAILURE_REASON", "Failure Reason",  lambda r: r.get("FAILUREREASON") or ""),
]


router = APIRouter(
    prefix="/imt",
    tags=["imt"],
)


@router.get("/transactions", summary="Get IMT receiving transactions")
def get_imt_transactions(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    limit: int = Query(100),
    msisdns:    Optional[List[str]] = Query(None, description="Filtrer par MSISDN receveur (CREDITPARTYIDENTIFIER)"),
    sender_ids: Optional[List[str]] = Query(None, description="Filtrer par sender ID (DEBITPARTYIDENTIFIER) — opérateur IMT international"),
    channels:   Optional[List[str]] = Query(None),
    statuses:   Optional[List[str]] = Query(None, description="Défaut: Completed. ['*'] pour tous les statuts."),
    db: Session = Depends(get_db),
):
    return ImtService.get_transactions(
        db, start_date, end_date, limit, msisdns, sender_ids, channels, statuses,
    )


@router.get("/transactions/summary", summary="KPI aggregate over IMT receiving transactions")
def get_imt_transactions_summary(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    msisdns:    Optional[List[str]] = Query(None),
    sender_ids: Optional[List[str]] = Query(None),
    channels:   Optional[List[str]] = Query(None),
    statuses:   Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Renvoie pour la période et les filtres :
    - **UNIQUE_SUBS**    : MSISDN receveurs distincts en Haïti
    - **UNIQUE_SENDERS** : opérateurs / IDs sender distincts à l'étranger
    - **VOLUME**         : COUNT(DISTINCT TRANSACTIONID)
    - **VALUE**          : SUM(ORIGINALAMOUNT) HTG
    - **REVENUE**        : SUM(CHARGEAMOUNT)   HTG
    """
    return ImtService.get_transactions_summary(
        db, start_date, end_date, msisdns, sender_ids, channels, statuses,
    )


@router.get("/transactions/export.xlsx", summary="Stream un XLSX des IMT receiving transactions")
def export_imt_transactions_xlsx(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    msisdns:    Optional[List[str]] = Query(None),
    sender_ids: Optional[List[str]] = Query(None),
    channels:   Optional[List[str]] = Query(None),
    statuses:   Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    rows = ImtService.get_transactions(
        db, start_date, end_date, limit, msisdns, sender_ids, channels, statuses,
    )
    cols = select_columns(IMT_TX_COLUMNS, columns)
    s = start_date or "all"
    e = end_date   or "now"
    return stream_xlsx(rows, cols, f"IMT_Transactions_{s}_to_{e}.xlsx", "IMT_Tx")
