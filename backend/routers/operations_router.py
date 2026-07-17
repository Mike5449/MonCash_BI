from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from database import get_db
from services.operations.operations_service import OperationsService, EmoneyOpsService
from utils.xlsx_stream import stream_xlsx, select_columns


def _date_only(v):
    if not v: return ""
    s = str(v)
    return s.split('T')[0] if 'T' in s else s


OPERATIONS_TX_COLUMNS = [
    ("DATE",            "Date",                lambda r: _date_only(r.get("TRANSACTION_DATE"))),
    ("TRANSACTION_ID",  "Transaction ID",      lambda r: r.get("TRANSACTIONID") or ""),
    ("REASON_TYPE",     "Reason Type",         lambda r: r.get("REASONTYPE") or ""),
    ("TR_TYPE",         "Transaction Type",    lambda r: r.get("TR_TYPE") or ""),
    ("CREDITOR_ID",     "Creditor ID",         lambda r: r.get("CREDITOR_ID") or ""),
    ("CREDITOR_NAME",   "Creditor Name",       lambda r: r.get("CREDITOR_NAME") or ""),
    ("DEBITOR_ID",      "Debitor ID",          lambda r: r.get("DEBITOR_ID") or ""),
    ("DEBITOR_NAME",    "Debitor Name",        lambda r: r.get("DEBITOR_NAME") or ""),
    ("AMOUNT",          "Amount (HTG)",        lambda r: float(r.get("ORIGINALAMOUNT") or 0)),
    ("CHARGE",          "Charge (HTG)",        lambda r: float(r.get("CHARGEAMOUNT") or 0)),
    ("CHANNEL",         "Channel",             lambda r: r.get("CHANNEL") or ""),
    ("STATUS",          "Status",              lambda r: r.get("STATUS") or "Completed"),
    ("INITIATOR",       "Initiator",           lambda r: r.get("INITIATOR") or ""),
    ("FAILURE_REASON",  "Failure Reason",      lambda r: r.get("FAILUREREASON") or ""),
]


router = APIRouter(
    prefix="/operations",
    tags=["operations"],
)


@router.get(
    "/transactions",
    summary="Operations team transactions (Bulk transfer + Customer Dormant)",
)
def get_operations_transactions(
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date:   Optional[str] = Query(None, description="YYYY-MM-DD"),
    limit:      int           = Query(100),
    reason_types: Optional[List[str]] = Query(None, description="Whitelist REASONTYPE — voir Service pour la liste"),
    statuses:     Optional[List[str]] = Query(None, description="Défaut 'Completed', ['*'] = tous statuts"),
    initiators:   Optional[List[str]] = Query(None, description="Multi-select INITIATOR"),
    transaction_ids: Optional[List[str]] = Query(None, description="Recherche par TRANSACTIONID — court-circuite TOUS les autres filtres"),
    db: Session = Depends(get_db),
):
    return OperationsService.get_transactions(
        db, start_date, end_date, limit, reason_types, statuses, initiators, transaction_ids,
    )


@router.get(
    "/transactions/summary",
    summary="KPI aggregate over Operations team transactions",
)
def get_operations_transactions_summary(
    start_date: Optional[str] = Query(None),
    end_date:   Optional[str] = Query(None),
    reason_types: Optional[List[str]] = Query(None),
    statuses:     Optional[List[str]] = Query(None),
    initiators:   Optional[List[str]] = Query(None),
    transaction_ids: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Renvoie :
    - UNIQUE_CREDITORS : MSISDN/comptes crédit distincts
    - UNIQUE_DEBITORS  : MSISDN/comptes débit distincts
    - VOLUME           : COUNT(DISTINCT TRANSACTIONID)
    - VALUE            : SUM(ORIGINALAMOUNT) HTG
    - REVENUE          : SUM(CHARGEAMOUNT)   HTG

    Si `transaction_ids` est fourni, TOUS les autres filtres sont ignorés.
    """
    return OperationsService.get_transactions_summary(
        db, start_date, end_date, reason_types, statuses, initiators, transaction_ids,
    )


@router.get(
    "/initiators",
    summary="Liste distincte des INITIATOR (pour peupler le dropdown filter)",
)
def get_operations_initiators(
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD (optionnel, borne le scope)"),
    end_date:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> List[str]:
    """Renvoie la liste alphabétique des INITIATOR distincts vus dans la période."""
    return OperationsService.get_distinct_initiators(db, start_date, end_date)


@router.get("/transactions/export.xlsx", summary="Stream un XLSX des transactions Operations")
def export_operations_transactions_xlsx(
    start_date: Optional[str] = Query(None),
    end_date:   Optional[str] = Query(None),
    reason_types: Optional[List[str]] = Query(None),
    statuses:     Optional[List[str]] = Query(None),
    initiators:   Optional[List[str]] = Query(None),
    transaction_ids: Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    rows = OperationsService.get_transactions(
        db, start_date, end_date, limit, reason_types, statuses, initiators, transaction_ids,
    )
    cols = select_columns(OPERATIONS_TX_COLUMNS, columns)
    s = start_date or "all"
    e = end_date   or "now"
    return stream_xlsx(rows, cols, f"Operations_Transactions_{s}_to_{e}.xlsx", "Operations_Tx")


# ──────────────────────────────────────────────────────────────────────────────
# E-money operations transactions (E-money Withdrawal / E-money Deposit)
# with ACCOUNT_CLASS column (Merchant / Biller / Other).
# ──────────────────────────────────────────────────────────────────────────────
EMONEY_OPS_TX_COLUMNS = [
    ("DATE",            "Date",                lambda r: _date_only(r.get("TRANSACTION_DATE"))),
    ("TRANSACTION_ID",  "Transaction ID",      lambda r: r.get("TRANSACTIONID") or ""),
    ("TR_TYPE",         "Transaction Type",    lambda r: r.get("TR_TYPE") or ""),
    ("ACCOUNT_CLASS",   "Account Class",       lambda r: r.get("ACCOUNT_CLASS") or "Other"),
    ("REASON_TYPE",     "Reason Type",         lambda r: r.get("REASONTYPE") or ""),
    ("CREDITOR_ID",     "Creditor ID",         lambda r: r.get("CREDITOR_ID") or ""),
    ("CREDITOR_NAME",   "Creditor Name",       lambda r: r.get("CREDITOR_NAME") or ""),
    ("DEBITOR_ID",      "Debitor ID",          lambda r: r.get("DEBITOR_ID") or ""),
    ("DEBITOR_NAME",    "Debitor Name",        lambda r: r.get("DEBITOR_NAME") or ""),
    ("AMOUNT",          "Amount (HTG)",        lambda r: float(r.get("ORIGINALAMOUNT") or 0)),
    ("CHARGE",          "Charge (HTG)",        lambda r: float(r.get("CHARGEAMOUNT") or 0)),
    ("CHANNEL",         "Channel",             lambda r: r.get("CHANNEL") or ""),
    ("STATUS",          "Status",              lambda r: r.get("STATUS") or "Completed"),
    ("INITIATOR",       "Initiator",           lambda r: r.get("INITIATOR") or ""),
    ("FAILURE_REASON",  "Failure Reason",      lambda r: r.get("FAILUREREASON") or ""),
]


@router.get(
    "/emoney-transactions",
    summary="E-money Withdrawal/Deposit ops transactions with Biller/Merchant/Other classification",
)
def get_emoney_ops_transactions(
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date:   Optional[str] = Query(None, description="YYYY-MM-DD"),
    limit:      int           = Query(100),
    statuses:        Optional[List[str]] = Query(None, description="Défaut 'Completed', ['*'] = tous statuts"),
    initiators:      Optional[List[str]] = Query(None, description="Multi-select INITIATOR"),
    transaction_ids: Optional[List[str]] = Query(None, description="Recherche par TRANSACTIONID — court-circuite TOUS les autres filtres"),
    account_classes: Optional[List[str]] = Query(None, description="Filtre par classe : Biller / Merchant / Other"),
    db: Session = Depends(get_db),
):
    return EmoneyOpsService.get_transactions(
        db, start_date, end_date, limit, statuses, initiators, transaction_ids, account_classes,
    )


@router.get(
    "/emoney-transactions/summary",
    summary="KPI aggregate over E-money Withdrawal/Deposit ops transactions",
)
def get_emoney_ops_transactions_summary(
    start_date: Optional[str] = Query(None),
    end_date:   Optional[str] = Query(None),
    statuses:        Optional[List[str]] = Query(None),
    initiators:      Optional[List[str]] = Query(None),
    transaction_ids: Optional[List[str]] = Query(None),
    account_classes: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    return EmoneyOpsService.get_transactions_summary(
        db, start_date, end_date, statuses, initiators, transaction_ids, account_classes,
    )


@router.get(
    "/emoney-initiators",
    summary="Liste distincte des INITIATOR (pour peupler le dropdown filter E-money ops)",
)
def get_emoney_ops_initiators(
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD (optionnel, borne le scope)"),
    end_date:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> List[str]:
    return EmoneyOpsService.get_distinct_initiators(db, start_date, end_date)


@router.get("/emoney-transactions/export.xlsx", summary="Stream un XLSX des transactions E-money Withdrawal/Deposit")
def export_emoney_ops_transactions_xlsx(
    start_date: Optional[str] = Query(None),
    end_date:   Optional[str] = Query(None),
    statuses:        Optional[List[str]] = Query(None),
    initiators:      Optional[List[str]] = Query(None),
    transaction_ids: Optional[List[str]] = Query(None),
    account_classes: Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    rows = EmoneyOpsService.get_transactions(
        db, start_date, end_date, limit, statuses, initiators, transaction_ids, account_classes,
    )
    cols = select_columns(EMONEY_OPS_TX_COLUMNS, columns)
    s = start_date or "all"
    e = end_date   or "now"
    return stream_xlsx(rows, cols, f"Emoney_Ops_Transactions_{s}_to_{e}.xlsx", "Emoney_Ops_Tx")
