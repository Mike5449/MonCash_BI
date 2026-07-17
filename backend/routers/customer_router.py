from fastapi import APIRouter, Depends, Query, Body
from sqlalchemy.orm import Session
from typing import List, Optional, Any
from database import get_db
from services.customer.customer_service import CustomerService
from services.customer.customer_mtd_service import CustomerMTDService
from repositories.customer.customer_transaction_repository import CustomerTransactionRepository
from utils.xlsx_stream import stream_xlsx, stream_csv, select_columns
from datetime import date
from datetime import timedelta

router = APIRouter(
    prefix="/customers",
    tags=["customers"]
)

CUSTOMERS_COLUMNS = [
    ("DATE_CODE",      "Date Code",        lambda r: r.get("DATE_CODE") or ""),
    ("NAME",           "Full Name",        lambda r: r.get("IDENTITYNAME") or ""),
    ("MSISDN",         "MSISDN",           lambda r: r.get("MSISDN") or ""),
    ("GENDER",         "Gender",           lambda r: r.get("GENDER") or ""),
    ("DOB",            "Date of Birth",    lambda r: str(r.get("DOB") or "")),
    ("AGE",            "Age",              lambda r: int(r["AGE"]) if r.get("AGE") is not None else ""),
    ("STATUS",         "Account Status",   lambda r: r.get("STATUS") or ""),
    ("WALLET",         "Wallet Type",      lambda r: r.get("KYC") or ""),
    ("BALANCE",        "Balance (HTG)",    lambda r: float(r.get("BALANCE") or 0)),
    ("ADDRESS",        "Address",          lambda r: r.get("ADDRESS") or "N/A"),
    ("IMT_OPT",        "IMT Opt-in",       lambda r: r.get("IMTOPTIN") or ""),
    ("ID_TYPE",        "ID Type",          lambda r: r.get("ID_TYPE") or ""),
    ("ID_NUMBER",      "ID Number",        lambda r: r.get("ID_NUMBER") or ""),
    ("IDNUMBER_CLEAN", "ID Number Clean",  lambda r: r.get("IDNUMBER_CLEAN") or ""),
    ("ID_CLEAN",       "ID Clean Flag",    lambda r: r.get("ID_CLEAN") or ""),
    ("ID_STATUS",      "ID Status",        lambda r: r.get("ID_STATUS") or ""),
    ("EXPIRY_DATE",    "Expiry Date",      lambda r: str(r.get("ID_EXPIRY_DATE") or "")),
    ("CREATED_DATE",   "Created Date",     lambda r: str(r.get("CREATED_DATE") or "")),
    ("SECTOR",         "Sector",           lambda r: r.get("SECTOR") or ""),
    ("CITY",           "City",             lambda r: r.get("CITY") or ""),
    ("DEPARTMENT",     "Department",       lambda r: r.get("DEPARTMENT") or ""),
    ("ZONE",           "Zone (Cluster)",   lambda r: r.get("ZONE") or ""),
]


@router.get("/export.xlsx", summary="Stream un XLSX des customers (génération côté serveur)")
def export_customers_xlsx(
    status: Optional[str] = Query(None),
    kyc: Optional[str] = Query(None),
    id_status: Optional[str] = Query(None),
    id_clean: Optional[str] = Query(None),
    has_address: Optional[str] = Query(None),
    imt_opt_in: Optional[str] = Query(None),
    expiry_date: Optional[str] = Query(None),
    created_start: Optional[str] = Query(None),
    created_end: Optional[str] = Query(None),
    msisdn: Optional[str] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    shortcodes: Optional[List[str]] = Query(None),
    identity_type: Optional[str] = Query("Customer"),
    name: Optional[str] = Query(None),
    names: Optional[List[str]] = Query(None),
    date_code: Optional[str] = Query(None, description="Filtrer par DATE_CODE (yyyyMMdd ou préfixe)"),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_customers(
        db, status, kyc, id_status, id_clean, has_address, imt_opt_in,
        expiry_date, created_start, created_end,
        msisdn, msisdns, 0, limit, shortcodes, identity_type,
        name=name, name_list=names,
        date_code=date_code,
    )
    cols = select_columns(CUSTOMERS_COLUMNS, columns)
    kind = "Organizations" if identity_type == "Organization" else "Customers"
    filename = f"{kind}_{date.today().strftime('%Y-%m-%d')}.xlsx"
    return stream_xlsx(rows, cols, filename, kind)


@router.get("/", summary="Get customer list for analysis")
def get_customers(
    status: Optional[str] = Query(None),
    kyc: Optional[str] = Query(None),
    id_status: Optional[str] = Query(None),
    id_clean: Optional[str] = Query(None),
    has_address: Optional[str] = Query(None),
    imt_opt_in: Optional[str] = Query(None),
    expiry_date: Optional[str] = Query(None),
    created_start: Optional[str] = Query(None),
    created_end: Optional[str] = Query(None),
    msisdn: Optional[str] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    shortcodes: Optional[List[str]] = Query(None, description="Filtrer par ORGANIZATIONSHORTCODE"),
    identity_type: Optional[str] = Query("Customer", description="Customer ou Organization (default: Customer)"),
    name: Optional[str] = Query(None, description="Recherche par IDENTITYNAME (tolère ordre des mots, casse, ponctuation)"),
    names: Optional[List[str]] = Query(None, description="Bulk de noms à rechercher"),
    date_code: Optional[str] = Query(None, description="Filtrer par DATE_CODE (yyyyMMdd ou préfixe, ex: '20260614' ou '202606'). Défaut: MAX(DATE_CODE) = snapshot le plus récent."),
    skip: int = Query(0),
    limit: int = Query(100),
    db: Session = Depends(get_db)
):
    return CustomerService.get_customers(
        db, status, kyc, id_status, id_clean, has_address, imt_opt_in,
        expiry_date, created_start, created_end,
        msisdn, msisdns, skip, limit, shortcodes, identity_type,
        name=name, name_list=names,
        date_code=date_code,
    )

@router.get("/summary", summary="Get customer summary counts")
def get_customers_summary(
    status: Optional[str] = Query(None),
    kyc: Optional[str] = Query(None),
    id_status: Optional[str] = Query(None),
    id_clean: Optional[str] = Query(None),
    has_address: Optional[str] = Query(None),
    imt_opt_in: Optional[str] = Query(None),
    expiry_date: Optional[str] = Query(None),
    created_start: Optional[str] = Query(None),
    created_end: Optional[str] = Query(None),
    msisdn: Optional[str] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    shortcodes: Optional[List[str]] = Query(None, description="Filtrer par ORGANIZATIONSHORTCODE"),
    identity_type: Optional[str] = Query("Customer", description="Customer ou Organization (default: Customer)"),
    name: Optional[str] = Query(None),
    names: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db)
):
    return CustomerService.get_customer_summary(
        db, status, kyc, id_status, id_clean, has_address, imt_opt_in,
        expiry_date, created_start, created_end,
        msisdn, msisdns, shortcodes, identity_type,
        name=name, name_list=names,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Compliance KYC info — for an imported list of MSISDNs
# ──────────────────────────────────────────────────────────────────────────────
# Column keys match the mixed-case aliases returned by the compliance SQL
# (see `get_compliance_kyc_info` in the repository).
COMPLIANCE_KYC_COLUMNS = [
    ("MSISDN",                          "msisdn",                         lambda r: r.get("msisdn") or ""),
    ("NOM_COMPLET",                     "Nom_complet",                    lambda r: r.get("Nom_complet") or ""),
    ("IDENTIFICATION_BENE_PHYS",        "identification_Bene_phys",       lambda r: r.get("identification_Bene_phys") or ""),
    ("NUMERO_IDENTITE_BENE_PHYS",       "numero_identite_Bene_phys",      lambda r: r.get("numero_identite_Bene_phys") or ""),
    ("PAYS_IDENTIFICATION_BENE_PHYS",   "pays_identification_Bene_phys",  lambda r: r.get("pays_identification_Bene_phys") or ""),
    ("SEXE_BENE_PHYS",                  "sexe_Bene_phys",                 lambda r: r.get("sexe_Bene_phys") or ""),
    ("DATE_DE_NAISSANCE_BENE_PHYS",     "date_de_naissance_Bene_phys",    lambda r: str(r.get("date_de_naissance_Bene_phys") or "")),
    ("ADRESSE_BENE_PHYS",               "adresse_Bene_phys",              lambda r: r.get("adresse_Bene_phys") or ""),
    ("VILLE_BENE_PHYS",                 "ville_Bene_phys",                lambda r: r.get("ville_Bene_phys") or ""),
    ("DEPARTEMENT_BENE_PHYS",           "departement_Bene_phys",          lambda r: r.get("departement_Bene_phys") or ""),
    ("PAYS_DE_RESIDENCE_BENE_PHYS",     "pays_de_residence_Bene_phys",    lambda r: r.get("pays_de_residence_Bene_phys") or ""),
    ("MONCASH_STATUS",                  "MONCASH_STATUS",                 lambda r: r.get("MONCASH_STATUS") or ""),
]


@router.get(
    "/compliance-kyc-info",
    summary="Compliance — KYC info for a list of MSISDNs (imported from Excel)",
)
def get_compliance_kyc_info(
    msisdns: List[str] = Query(..., description="MSISDN filter — from the Excel file imported by the compliance analyst"),
    db: Session = Depends(get_db),
):
    """
    Returns the KYC fields required by compliance for each MSISDN in the input list :
    MSISDN, full name, ID type / number, gender, DOB, address, commune, département,
    MonCash account status.

    Data source : `mfs_mobile_banking_audit` latest snapshot (CURRENT_DATE - 1),
    filtered on `IDENTITYTYPE = 'Customer'` and deduplicated by MSISDN.
    """
    return CustomerService.get_compliance_kyc_info(db, msisdns)


@router.get("/compliance-kyc-info/export.xlsx", summary="Stream un XLSX des info KYC compliance")
def export_compliance_kyc_info_xlsx(
    msisdns: List[str] = Query(...),
    columns: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_compliance_kyc_info(db, msisdns)
    cols = select_columns(COMPLIANCE_KYC_COLUMNS, columns)
    filename = f"Compliance_KYC_Info_{date.today().strftime('%Y-%m-%d')}.xlsx"
    return stream_xlsx(rows, cols, filename, "Compliance_KYC_Info")


@router.get("/transactions", summary="Get customer transaction list")
def get_transactions(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None, description="Filtrer par un ou plusieurs canaux (case-insensitive)"),
    transaction_statuses: Optional[List[str]] = Query(None, description="Filtre TRANSACTIONSTATUS : Completed / Cancelled / Declined / Expired (défaut : Completed)"),
    skip: int = Query(0),
    limit: int = Query(100),
    active_only: bool = Query(False),
    db: Session = Depends(get_db)
):
    return CustomerService.get_transactions(
        db, start_date, end_date, service_names, msisdns, limit, skip, active_only, channels, transaction_statuses,
    )


@router.get("/churn", summary="Customer churn for a given period (30/60/90 days)")
def get_customer_churn(
    start_date: Optional[date] = Query(None, description="Date de référence (défaut yesterday)"),
    period: int = Query(30, ge=30, le=90, description="Période en jours (30, 60 ou 90)"),
    return_list: bool = Query(False, description="Si true, retourne aussi la liste des MSISDN churners"),
    limit: int = Query(100, ge=0, description="Limite la liste retournée (0 = illimité). Le compteur reste global."),
    db: Session = Depends(get_db)
):
    """
    Pour une date de référence J :
    - **baseline** = [J-2N, J-N-1] (N jours d'activité)
    - **recent**   = [J-N, J] (N jours d'inactivité)
    Churn = MSISDN actifs en baseline ET inactifs en recent (filtre MSISDN haïtiens `509%`).
    Le `limit` ne s'applique qu'à la liste retournée — le `churn_count` est toujours le total exact.
    """
    if period not in (30, 60, 90):
        period = 30
    return CustomerService.get_churn(db, start_date, period, return_list, limit)


def _date_only(v: Any) -> str:
    if not v: return ""
    s = str(v)
    return s.split('T')[0] if 'T' in s else s


# ──────────────────────────────────────────────────────────────────────────────
# Customer Transactions (daily) — streaming XLSX
# ──────────────────────────────────────────────────────────────────────────────
TRANSACTIONS_COLUMNS = [
    ("DATE",           "Date",           lambda r: _date_only(r.get("TRANSACTION_DATE"))),
    ("TRANSACTION_ID", "Transaction ID", lambda r: r.get("TRANSACTIONID") or ""),
    ("TYPE",           "Type",           lambda r: r.get("TR_TYPE") or ""),
    ("MSISDN",         "MSISDN",         lambda r: r.get("MSISDN") or ""),
    ("AMOUNT",         "Amount (HTG)",   lambda r: float(r.get("AMOUNT") or 0)),
    ("CHARGE",         "Charge (HTG)",   lambda r: float(r.get("CHARGE") or 0)),
    ("CHANNEL",        "Channel",        lambda r: r.get("CHANNEL") or ""),
    ("STATUS",         "Status",         lambda r: r.get("STATUS") or ""),
    ("REASON_TYPE",    "Reason Type",    lambda r: r.get("REASONTYPE") or ""),
    ("INITIATOR",      "Initiator",      lambda r: r.get("INITIATOR") or ""),
    ("FAILURE_REASON", "Failure Reason", lambda r: r.get("FAILUREREASON") or ""),
]


@router.get("/transactions/export.xlsx", summary="Stream un XLSX des customer transactions")
def export_transactions_xlsx(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    transaction_statuses: Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_transactions(
        db, start_date, end_date, service_names, msisdns, limit, 0, False, channels, transaction_statuses,
    )
    cols = select_columns(TRANSACTIONS_COLUMNS, columns)
    s = (start_date or date.today() - timedelta(days=7)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return stream_xlsx(rows, cols, f"Daily_Transactions_{s}_to_{e}.xlsx", "Daily_Transactions")


# ──────────────────────────────────────────────────────────────────────────────
# Daily Stats by Type — streaming XLSX
# ──────────────────────────────────────────────────────────────────────────────
DAILY_STATS_COLUMNS = [
    ("DATE",    "Date",          lambda r: _date_only(r.get("TRANSACTION_DATE"))),
    ("TR_TYPE", "Type",          lambda r: r.get("TR_TYPE") or ""),
    ("VOLUME",  "Volume",        lambda r: int(r.get("VOLUME") or 0)),
    ("SUBS",    "Subs",          lambda r: int(r.get("SUBS") or 0)),
    ("VALUE",   "Value (HTG)",   lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE", "Revenue (HTG)", lambda r: float(r.get("REVENUE") or 0)),
]


@router.get("/daily-stats-by-type/export.xlsx", summary="Stream un XLSX des stats journalières par TR_TYPE")
def export_daily_stats_xlsx(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(100_000, ge=1, le=1_000_000),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_daily_stats_by_type(
        db, start_date, end_date, service_names, msisdns, channels, limit
    )
    cols = select_columns(DAILY_STATS_COLUMNS, columns)
    s = (start_date or date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return stream_xlsx(rows, cols, f"Daily_Stats_by_Type_{s}_to_{e}.xlsx", "Daily_Stats")


# ──────────────────────────────────────────────────────────────────────────────
# Daily Stats by Department — streaming XLSX
# ──────────────────────────────────────────────────────────────────────────────
DAILY_STATS_DEPT_COLUMNS = [
    ("TRANSACTION_DATE", "Date",          lambda r: r.get("TRANSACTION_DATE") or ""),
    ("DEPARTMENT",       "Department",    lambda r: r.get("DEPARTMENT") or ""),
    ("VOLUME",           "Volume",        lambda r: int(r.get("VOLUME") or 0)),
    ("SUBS",             "Subs",          lambda r: int(r.get("SUBS") or 0)),
    ("VALUE",            "Value (HTG)",   lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE",          "Revenue (HTG)", lambda r: float(r.get("REVENUE") or 0)),
]


@router.get("/daily-stats-by-department/export.xlsx", summary="Stream un XLSX des stats journalières par DEPARTMENT")
def export_daily_stats_by_department_xlsx(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(100_000, ge=1, le=1_000_000),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_daily_stats_by_department(
        db, start_date, end_date, service_names, msisdns, channels, limit
    )
    cols = select_columns(DAILY_STATS_DEPT_COLUMNS, columns)
    s = (start_date or date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return stream_xlsx(rows, cols, f"Daily_Stats_by_Department_{s}_to_{e}.xlsx", "Daily_Stats_Dept")


# ──────────────────────────────────────────────────────────────────────────────
# Daily Stats by Channel — streaming XLSX
# ──────────────────────────────────────────────────────────────────────────────
DAILY_STATS_CHANNEL_COLUMNS = [
    ("TRANSACTION_DATE", "Date",          lambda r: r.get("TRANSACTION_DATE") or ""),
    ("CHANNEL",          "Channel",       lambda r: r.get("CHANNEL") or ""),
    ("VOLUME",           "Volume",        lambda r: int(r.get("VOLUME") or 0)),
    ("SUBS",             "Subs",          lambda r: int(r.get("SUBS") or 0)),
    ("VALUE",            "Value (HTG)",   lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE",          "Revenue (HTG)", lambda r: float(r.get("REVENUE") or 0)),
]


@router.get("/daily-stats-by-channel/export.xlsx", summary="Stream un XLSX des stats journalières par CHANNEL")
def export_daily_stats_by_channel_xlsx(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(100_000, ge=1, le=1_000_000),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_daily_stats_by_channel(
        db, start_date, end_date, service_names, msisdns, channels, limit
    )
    cols = select_columns(DAILY_STATS_CHANNEL_COLUMNS, columns)
    s = (start_date or date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return stream_xlsx(rows, cols, f"Daily_Stats_by_Channel_{s}_to_{e}.xlsx", "Daily_Stats_Channel")


# ──────────────────────────────────────────────────────────────────────────────
# MTD Stats by Month and Type — streaming XLSX
# ──────────────────────────────────────────────────────────────────────────────
MTD_STATS_COLUMNS = [
    ("MONTH",   "Month",         lambda r: r.get("MONTH") or ""),
    ("TR_TYPE", "Type",          lambda r: r.get("TR_TYPE") or ""),
    ("VOLUME",  "Volume",        lambda r: int(r.get("VOLUME") or 0)),
    ("SUBS",    "Subs",          lambda r: int(r.get("SUBS") or 0)),
    ("VALUE",   "Value (HTG)",   lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE", "Revenue (HTG)", lambda r: float(r.get("REVENUE") or 0)),
]


@router.get("/mtd-stats-by-month-type/export.xlsx", summary="Stream un XLSX des MTD stats par mois × type")
def export_mtd_stats_xlsx(
    start_month: Optional[date] = Query(None),
    end_month: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    day_of_month: Optional[int] = Query(None),
    columns: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_mtd_stats_by_month_and_type(
        db, start_month, end_month, service_names, msisdns, channels, day_of_month
    )
    cols = select_columns(MTD_STATS_COLUMNS, columns)
    return stream_xlsx(rows, cols, f"MTD_Stats_by_Type_{date.today().strftime('%Y-%m-%d')}.xlsx", "MTD_Stats")


# ──────────────────────────────────────────────────────────────────────────────
# MTD Stats by Month and Department — streaming XLSX
# ──────────────────────────────────────────────────────────────────────────────
MTD_STATS_DEPT_COLUMNS = [
    ("MONTH",      "Month",         lambda r: r.get("MONTH") or ""),
    ("DEPARTMENT", "Department",    lambda r: r.get("DEPARTMENT") or ""),
    ("VOLUME",     "Volume",        lambda r: int(r.get("VOLUME") or 0)),
    ("SUBS",       "Subs",          lambda r: int(r.get("SUBS") or 0)),
    ("VALUE",      "Value (HTG)",   lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE",    "Revenue (HTG)", lambda r: float(r.get("REVENUE") or 0)),
]


@router.get("/mtd-stats-by-month-department/export.xlsx", summary="Stream un XLSX des MTD stats par mois × département")
def export_mtd_stats_by_dept_xlsx(
    start_month: Optional[date] = Query(None),
    end_month: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    day_of_month: Optional[int] = Query(None),
    columns: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_mtd_stats_by_month_and_department(
        db, start_month, end_month, service_names, msisdns, channels, day_of_month
    )
    cols = select_columns(MTD_STATS_DEPT_COLUMNS, columns)
    return stream_xlsx(rows, cols, f"MTD_Stats_by_Department_{date.today().strftime('%Y-%m-%d')}.xlsx", "MTD_Stats_Dept")


# ──────────────────────────────────────────────────────────────────────────────
# MTD Stats by Month and Channel — streaming XLSX
# ──────────────────────────────────────────────────────────────────────────────
MTD_STATS_CHANNEL_COLUMNS = [
    ("MONTH",   "Month",         lambda r: r.get("MONTH") or ""),
    ("CHANNEL", "Channel",       lambda r: r.get("CHANNEL") or ""),
    ("VOLUME",  "Volume",        lambda r: int(r.get("VOLUME") or 0)),
    ("SUBS",    "Subs",          lambda r: int(r.get("SUBS") or 0)),
    ("VALUE",   "Value (HTG)",   lambda r: float(r.get("VALUE") or 0)),
    ("REVENUE", "Revenue (HTG)", lambda r: float(r.get("REVENUE") or 0)),
]


@router.get("/mtd-stats-by-month-channel/export.xlsx", summary="Stream un XLSX des MTD stats par mois × canal")
def export_mtd_stats_by_channel_xlsx(
    start_month: Optional[date] = Query(None),
    end_month: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    day_of_month: Optional[int] = Query(None),
    columns: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_mtd_stats_by_month_and_channel(
        db, start_month, end_month, service_names, msisdns, channels, day_of_month
    )
    cols = select_columns(MTD_STATS_CHANNEL_COLUMNS, columns)
    return stream_xlsx(rows, cols, f"MTD_Stats_by_Channel_{date.today().strftime('%Y-%m-%d')}.xlsx", "MTD_Stats_Channel")


# ──────────────────────────────────────────────────────────────────────────────
# Churn lists (30/60/90, Custom, IMT) — streaming XLSX
# ──────────────────────────────────────────────────────────────────────────────
def _msisdn_list_columns():
    return [
        ("INDEX",  "#",      lambda r: r.get("INDEX") or 0),
        ("MSISDN", "MSISDN", lambda r: r.get("MSISDN") or ""),
    ]


def _stream_msisdn_list(msisdns: List[str], filename: str, sheet_name: str) -> Any:
    rows = [{"INDEX": i + 1, "MSISDN": m} for i, m in enumerate(msisdns or [])]
    return stream_xlsx(rows, _msisdn_list_columns(), filename, sheet_name)


@router.get("/churn/export.xlsx", summary="Stream un XLSX des churners 30/60/90")
def export_churn_xlsx(
    start_date: Optional[date] = Query(None),
    period: int = Query(30, ge=30, le=90),
    db: Session = Depends(get_db),
):
    if period not in (30, 60, 90):
        period = 30
    data = CustomerService.get_churn(db, start_date, period, True, 0)
    msisdns = data.get("msisdns", [])
    ref = (start_date or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return _stream_msisdn_list(msisdns, f"Churn_{period}d_at_{ref}.xlsx", f"Churn_{period}")


CHURN_CUSTOM_COLUMNS = [
    ("MSISDN",         "MSISDN",          lambda r: r.get("MSISDN") or ""),
    ("NAME",           "Full Name",       lambda r: r.get("IDENTITYNAME") or ""),
    ("GENDER",         "Gender",          lambda r: r.get("GENDER") or ""),
    ("STATUS",         "Account Status",  lambda r: r.get("STATUS") or ""),
    ("WALLET",         "Wallet Type",     lambda r: r.get("KYC") or ""),
    ("BALANCE",        "Balance (HTG)",   lambda r: float(r.get("BALANCE") or 0)),
    ("ADDRESS",        "Address",         lambda r: r.get("ADDRESS") or "N/A"),
    ("IMT_OPT_IN",     "IMT Opt-in",      lambda r: r.get("IMTOPTIN") or ""),
    ("ID_TYPE",        "ID Type",         lambda r: r.get("ID_TYPE") or ""),
    ("ID_NUMBER",      "ID Number",       lambda r: r.get("ID_NUMBER") or ""),
    ("IDNUMBER_CLEAN", "ID Number Clean", lambda r: r.get("IDNUMBER_CLEAN") or ""),
    ("ID_CLEAN",       "ID Clean Flag",   lambda r: r.get("ID_CLEAN") or ""),
    ("ID_STATUS",      "ID Status",       lambda r: r.get("ID_STATUS") or ""),
    ("ID_EXPIRY",      "ID Expiry",       lambda r: str(r.get("ID_EXPIRY_DATE") or "")),
    ("CREATED",        "Created Date",    lambda r: str(r.get("CREATED_DATE") or "")),
    ("SECTOR",         "Sector",          lambda r: r.get("SECTOR") or ""),
    ("CITY",           "City",            lambda r: r.get("CITY") or ""),
    ("DEPARTMENT",     "Department",      lambda r: r.get("DEPARTMENT") or ""),
    ("ZONE",           "Zone (Cluster)",  lambda r: r.get("ZONE") or ""),
    ("LAST_TR_TYPE",   "Last TR Type",    lambda r: r.get("LAST_TR_TYPE") or ""),
    ("LAST_TX",        "Last TX Date",    lambda r: str(r.get("LAST_TX") or "")),
]


@router.get("/churn-custom-enriched", summary="Customer churn custom enrichi (profil + localisation + last TR_TYPE)")
def get_customer_churn_custom_enriched(
    active_start: date = Query(...),
    active_end: date = Query(...),
    exclude_start: date = Query(...),
    exclude_end: date = Query(...),
    limit: int = Query(500, ge=1, le=600000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Churners de la version Custom enrichis : pour chaque MSISDN, infos profil + localisation
    + dernière TR_TYPE pendant la période active. `churn_count` total reste global.
    """
    return CustomerService.get_customer_churn_custom_enriched(
        db, active_start, active_end, exclude_start, exclude_end, limit, offset
    )


@router.get("/churn-custom/export.xlsx", summary="Stream un XLSX des churners custom (mode: list ou enriched)")
def export_churn_custom_xlsx(
    active_start: date = Query(...),
    active_end: date = Query(...),
    exclude_start: date = Query(...),
    exclude_end: date = Query(...),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    mode: str = Query("list", description="list = MSISDN seul (rapide) | enriched = profil + location + last_tr (lent)"),
    db: Session = Depends(get_db),
):
    base_name = f"Customer_Churn_{active_start}_to_{active_end}_excl_{exclude_start}_to_{exclude_end}"
    if mode == "enriched":
        data = CustomerService.get_customer_churn_custom_enriched(
            db, active_start, active_end, exclude_start, exclude_end, limit, 0
        )
        rows = data.get("rows", [])
        cols = select_columns(CHURN_CUSTOM_COLUMNS, columns)
        return stream_xlsx(rows, cols, f"{base_name}.xlsx", "Customer_Churn")
    else:
        # Mode "list" — vitesse maximale (juste MSISDN, comme le script Databricks)
        data = CustomerService.get_customer_churn_custom(
            db, active_start, active_end, exclude_start, exclude_end, True, limit
        )
        msisdns = data.get("msisdns", [])
        return _stream_msisdn_list(msisdns, f"{base_name}.xlsx", "Customer_Churn")


@router.get("/churn-custom/export.csv", summary="Stream un CSV des churners custom (mode: list ou enriched)")
def export_churn_custom_csv(
    active_start: date = Query(...),
    active_end: date = Query(...),
    exclude_start: date = Query(...),
    exclude_end: date = Query(...),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    mode: str = Query("list", description="list = MSISDN seul (rapide) | enriched = profil + location + last_tr (lent)"),
    db: Session = Depends(get_db),
):
    base_name = f"Customer_Churn_{active_start}_to_{active_end}_excl_{exclude_start}_to_{exclude_end}"
    repository = CustomerTransactionRepository(db)
    if mode == "enriched":
        rows_iter = repository.iter_customer_churn_custom_enriched(
            active_start, active_end, exclude_start, exclude_end, limit, 0
        )
        cols = select_columns(CHURN_CUSTOM_COLUMNS, columns)
        return stream_csv(rows_iter, cols, f"{base_name}.csv")
    else:
        # Mode "list" — itère directement la liste MSISDN (très rapide, comme le script Databricks)
        data = CustomerService.get_customer_churn_custom(
            db, active_start, active_end, exclude_start, exclude_end, True, limit
        )
        msisdns = data.get("msisdns", [])
        list_cols = [
            ("INDEX",  "#",      lambda r: r.get("INDEX") or 0),
            ("MSISDN", "MSISDN", lambda r: r.get("MSISDN") or ""),
        ]
        list_rows = ({"INDEX": i + 1, "MSISDN": m} for i, m in enumerate(msisdns))
        return stream_csv(list_rows, list_cols, f"{base_name}.csv")


@router.get("/imt-churn/export.xlsx", summary="Stream un XLSX des IMT lost receivers")
def export_imt_churn_xlsx(
    active_start: date = Query(...),
    active_end: date = Query(...),
    exclude_start: date = Query(...),
    exclude_end: date = Query(...),
    db: Session = Depends(get_db),
):
    data = CustomerService.get_imt_churn(
        db, active_start, active_end, exclude_start, exclude_end, True, 0
    )
    rows = data.get("rows", [])
    cols = [
        ("MSISDN", "MSISDN", lambda r: r.get("MSISDN") or ""),
        ("DEPARTMENT", "Department", lambda r: r.get("DEPARTMENT") or ""),
        ("CITY", "City", lambda r: r.get("CITY") or ""),
    ]
    return stream_xlsx(
        rows,
        cols,
        f"IMT_Churn_{active_start}_to_{active_end}_excl_{exclude_start}_to_{exclude_end}.xlsx",
        "IMT_Churn",
    )


ACTIVE_CUSTOMERS_COLUMNS = [
    ("MSISDN",       "MSISDN",         lambda r: r.get("MSISDN") or ""),
    ("NAME",         "Full Name",      lambda r: r.get("IDENTITYNAME") or ""),
    ("STATUS",       "Account Status", lambda r: r.get("STATUS") or ""),
    ("WALLET",       "Wallet Type",    lambda r: r.get("KYC") or ""),
    ("BALANCE",      "Balance (HTG)",  lambda r: float(r.get("BALANCE") or 0)),
    ("TX_COUNT",     "TX Count",       lambda r: int(r.get("TX_COUNT") or 0)),
    ("TOTAL_VALUE",  "Total Value",    lambda r: float(r.get("TOTAL_VALUE") or 0)),
    ("TOTAL_CHARGE", "Total Charge",   lambda r: float(r.get("TOTAL_CHARGE") or 0)),
    ("FIRST_TX",     "First TX",       lambda r: str(r.get("FIRST_TX") or "")),
    ("LAST_TX",      "Last TX",        lambda r: str(r.get("LAST_TX") or "")),
    ("ADDRESS",      "Address",        lambda r: r.get("ADDRESS") or "N/A"),
    ("IMT_OPT_IN",   "IMT Opt-in",     lambda r: r.get("IMTOPTIN") or ""),
    ("ID_TYPE",      "ID Type",        lambda r: r.get("ID_TYPE") or ""),
    ("ID_STATUS",    "ID Status",      lambda r: r.get("ID_STATUS") or ""),
    ("ID_EXPIRY",    "ID Expiry",      lambda r: str(r.get("ID_EXPIRY_DATE") or "")),
    ("CREATED",      "Created Date",   lambda r: str(r.get("CREATED_DATE") or "")),
    ("SECTOR",       "Sector",         lambda r: r.get("SECTOR") or ""),
    ("CITY",         "City",           lambda r: r.get("CITY") or ""),
    ("DEPARTMENT",   "Department",     lambda r: r.get("DEPARTMENT") or ""),
    ("ZONE",         "Zone (Cluster)", lambda r: r.get("ZONE") or ""),
]


@router.get("/active-customers/export.csv", summary="Stream un CSV des customers actifs (téléchargement quasi-instantané)")
def export_active_customers_csv(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    wallet_type: Optional[str] = Query(None),
    columns: Optional[str] = Query(None),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    msisdns: Optional[List[str]] = Query(None, description="Liste optionnelle de MSISDN — filtre sur cette liste uniquement"),
    transaction_statuses: Optional[List[str]] = Query(None, description="Filtre TRANSACTIONSTATUS : Completed / Cancelled / Declined / Expired (défaut : Completed)"),
    db: Session = Depends(get_db),
):
    """
    Streame un CSV ligne-par-ligne **depuis le curseur SQL** (true streaming) :
    le 1er chunk est envoyé dès que Databricks renvoie son 1er batch (~1000 rows),
    PAS d'attente que toute la query finisse.
    """
    cols = select_columns(ACTIVE_CUSTOMERS_COLUMNS, columns)
    repository = CustomerTransactionRepository(db)
    # iter_active_customers est un **générateur** → pas de matérialisation en mémoire
    rows_iter = repository.iter_active_customers(
        start_date, end_date, limit, 0, wallet_type, msisdns, transaction_statuses,
    )

    s = (start_date or date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    suffix = f"_{wallet_type.upper()}" if wallet_type else ""
    filename = f"Active_Customers_{s}_to_{e}{suffix}.csv"
    return stream_csv(rows_iter, cols, filename)


@router.get("/active-customers/export.xlsx", summary="Stream un XLSX des customers actifs (génération côté serveur)")
def export_active_customers_xlsx(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    wallet_type: Optional[str] = Query(None),
    columns: Optional[str] = Query(None, description="Liste de colonnes séparées par virgule. Si vide, toutes."),
    limit: int = Query(2_000_000, ge=1, le=5_000_000),
    msisdns: Optional[List[str]] = Query(None, description="Liste optionnelle de MSISDN — filtre sur cette liste uniquement"),
    transaction_statuses: Optional[List[str]] = Query(None, description="Filtre TRANSACTIONSTATUS : Completed / Cancelled / Declined / Expired (défaut : Completed)"),
    db: Session = Depends(get_db),
):
    """Streame un XLSX côté serveur (évite JSON + double parsing client)."""
    cols = select_columns(ACTIVE_CUSTOMERS_COLUMNS, columns)
    repository = CustomerTransactionRepository(db)
    data = repository.get_active_customers(
        start_date, end_date, limit, 0, wallet_type, msisdns, transaction_statuses,
    )
    rows = data.get("rows", [])

    s = (start_date or date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    suffix = f"_{wallet_type.upper()}" if wallet_type else ""
    filename = f"Active_Customers_{s}_to_{e}{suffix}.xlsx"
    return stream_xlsx(rows, cols, filename, "Active_Customers")


@router.get("/active-customers", summary="Customers ayant transigé au moins une fois dans la période")
def get_active_customers(
    start_date: Optional[date] = Query(None, description="Début de la période (défaut: J-30)"),
    end_date: Optional[date] = Query(None, description="Fin de la période (défaut: yesterday)"),
    limit: int = Query(100, ge=1, le=600000),
    offset: int = Query(0, ge=0),
    wallet_type: Optional[str] = Query(None, description="Filtre wallet : FULL, MINI ou null (tous)"),
    msisdns: Optional[List[str]] = Query(None, description="Liste optionnelle de MSISDN — filtre sur cette liste uniquement"),
    transaction_statuses: Optional[List[str]] = Query(None, description="Filtre TRANSACTIONSTATUS : Completed / Cancelled / Declined / Expired (défaut : Completed)"),
    db: Session = Depends(get_db)
):
    """
    Liste des Customers (Customer haïtien 509%) ayant effectué au moins une transaction
    (credit ou debit) dans [start_date, end_date]. Renvoie :
    - infos profil (NAME, STATUS, KYC, BALANCE, ADDRESS, ID_STATUS, …)
    - localisation réseau (SECTOR, CITY, DEPARTMENT, ZONE)
    - summary tx (TX_COUNT, TOTAL_VALUE, TOTAL_CHARGE, FIRST_TX, LAST_TX)
    + totaux globaux pour KPIs.
    `wallet_type` : FULL (Registered Customer Level 1) / MINI (Level 0) / null (tous).
    """
    return CustomerService.get_active_customers(
        db, start_date, end_date, limit, offset, wallet_type, msisdns, transaction_statuses,
    )


TIER_ORDER = [
    'T00 : 0 - 19', 'T01 : 20 - 99', 'T02 : 100 - 249', 'T03 : 250 - 499',
    'T04 : 500 - 999', 'T05 : 1000 - 1999', 'T06 : 2000 - 3999', 'T07 : 4000 - 7999',
    'T08 : 8000 - 11999', 'T09 : 12000 - 19999', 'T10 : 20000 - 39999',
    'T11 : 40000 - 59999', 'T12 : 60000 - 75000', 'T13 : 75K+',
]


@router.get("/subs-dashboard", summary="Snapshot quotidien des subs (CHURN/FW/MFS_ACTIVE/AGENT/MERCHANT)")
def get_subs_dashboard(
    start_date: Optional[date] = Query(None, description="Défaut: 1er janvier année courante"),
    end_date: Optional[date] = Query(None, description="Défaut: today"),
    db: Session = Depends(get_db)
):
    """
    Retourne rows {DATE_CODE, MEMO, SUBS} pour tous les indicateurs du dashboard :
    ACTIVE_AGENT, CHURN 30/60/90, FW_ACTIVE_30/60/90, MFS_ACTIVE_30/60/90, MERCHANT_AGENT,
    MFS_ACTIVE_DAILY (calculé à la volée).
    """
    return CustomerService.get_subs_dashboard(db, start_date, end_date)


@router.get("/subs-dashboard/export.csv", summary="Stream CSV pivoté du dashboard subs")
def export_subs_dashboard_csv(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    rows = CustomerService.get_subs_dashboard(db, start_date, end_date)
    # Pivot : DATE_CODE rows × MEMO columns
    dates = sorted({r["DATE_CODE"] for r in rows if r.get("DATE_CODE")}, reverse=True)
    memos = sorted({r["MEMO"] for r in rows if r.get("MEMO")})
    pivot: dict = {}
    for r in rows:
        dc = r.get("DATE_CODE"); m = r.get("MEMO")
        if not dc or not m: continue
        pivot.setdefault(dc, {})[m] = r.get("SUBS")
    pivoted_rows = []
    for d in dates:
        row = {"DATE_CODE": d}
        for m in memos:
            row[m] = pivot.get(d, {}).get(m, 0)
        pivoted_rows.append(row)
    cols = [("DATE_CODE", "DATE_CODE", lambda r: r.get("DATE_CODE") or "")]
    for m in memos:
        cols.append((m, m, (lambda mm: lambda r: int(r.get(mm) or 0))(m)))
    s = (start_date or date(date.today().year, 1, 1)).strftime('%Y-%m-%d')
    e = (end_date   or date.today()).strftime('%Y-%m-%d')
    return stream_csv(pivoted_rows, cols, f"Subs_Dashboard_{s}_to_{e}.csv")


TRANSACTION_HISTORY_COLUMNS = [
    ("TRANSACTION_DATE", "Transaction Date", lambda r: str(r.get("TRANSACTION_DATE") or "")),
    ("TR_ID",            "Transaction ID",   lambda r: r.get("TR_ID") or ""),
    ("TRANSACTIONTYPE",  "Type",             lambda r: r.get("TRANSACTIONTYPE") or r.get("SERVICENAME") or ""),
    ("TR_CHANNEL",       "Channel",          lambda r: r.get("TR_CHANNEL") or ""),
    ("TRANS_STATUS",     "Status",           lambda r: r.get("TRANS_STATUS") or ""),
    ("SIDE",             "Side",             lambda r: r.get("SIDE") or ""),
    ("CREDITOR",         "Creditor ID",      lambda r: r.get("CREDITOR") or ""),
    ("CREDITPARTYNAME",  "Creditor Name",    lambda r: r.get("CREDITPARTYNAME") or ""),
    ("DEBITOR",          "Debitor ID",       lambda r: r.get("DEBITOR") or ""),
    ("DEBITPARTYNAME",   "Debitor Name",     lambda r: r.get("DEBITPARTYNAME") or ""),
    ("REASONTYPE",       "Reason Type",      lambda r: r.get("REASONTYPE") or ""),
    ("AMOUNT",           "Amount (HTG)",     lambda r: float(r.get("AMOUNT") or 0)),
    ("FEE",              "Fee (HTG)",        lambda r: float(r.get("FEE") or 0)),
    ("BAL_BEFORE",       "Balance Before",   lambda r: float(r.get("BAL_BEFORE") or 0)),
    ("BAL_AFTER",        "Balance After",    lambda r: float(r.get("BAL_AFTER") or 0)),
]


AGENT_OTC_COLUMNS = [
    ("AGENT_MSISDN", "Agent MSISDN", lambda r: r.get("AGENT_MSISDN") or ""),
    ("AGENT_NAME",   "Agent Name",   lambda r: r.get("AGENT_NAME") or ""),
    ("TR_VALUE",     "TR Value (HTG)", lambda r: float(r.get("TR_VALUE") or 0)),
    ("volume_",      "Volume", lambda r: int(r.get("volume_") or 0)),
    ("AGENT_ADRESS", "Agent Address", lambda r: r.get("AGENT_ADRESS") or ""),
]


@router.get("/agent-otc", summary="Agents OTC : volume des transactions Cash In OTC / Agent Payment to Agent")
def get_agent_otc(
    start_date: date = Query(..., description="Début de la période transactions"),
    end_date: date = Query(..., description="Fin de la période transactions"),
    date_code: Optional[str] = Query(None, description="Snapshot du profil agent (yyyyMMdd). Défaut: dernier dispo."),
    db: Session = Depends(get_db),
):
    """
    Agents OTC : SUM(ORIGINALAMOUNT)/2 par agent (DEBITPARTYIDENTIFIER) sur la période,
    pour les services 'Cash In OTC' et 'Agent Payment to Agent'.
    Jointure sur AB_SALT (= AGENT_MSISDN dans la table agent).
    """
    return CustomerService.get_agent_otc(db, start_date, end_date, date_code)


@router.get("/agent-otc/export.csv", summary="Stream CSV des Agents OTC")
def export_agent_otc_csv(
    start_date: date = Query(...),
    end_date: date = Query(...),
    date_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_agent_otc(db, start_date, end_date, date_code)
    return stream_csv(rows, AGENT_OTC_COLUMNS, f"Agent_OTC_{start_date}_to_{end_date}.csv")


@router.get("/agent-otc/export.xlsx", summary="Stream XLSX des Agents OTC")
def export_agent_otc_xlsx(
    start_date: date = Query(...),
    end_date: date = Query(...),
    date_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = CustomerService.get_agent_otc(db, start_date, end_date, date_code)
    return stream_xlsx(rows, AGENT_OTC_COLUMNS, f"Agent_OTC_{start_date}_to_{end_date}.xlsx", "Agent_OTC")


@router.get("/transaction-history", summary="Historique des transactions pour un MSISDN (debiteur OU crediteur)")
def get_transaction_history(
    msisdn: str = Query(..., description="MSISDN à rechercher comme DEBITOR ou CREDITOR"),
    start_date: Optional[date] = Query(None, description="Défaut: J-30"),
    end_date: Optional[date] = Query(None, description="Défaut: today"),
    status: Optional[str] = Query("Completed", description="Completed (défaut) | Expired | Cancelled | Declined | All (laisser vide)"),
    db: Session = Depends(get_db)
):
    """
    Renvoie toutes les transactions où le MSISDN apparait soit côté debit, soit côté credit.
    Balance avant/après calculées selon le côté du MSISDN.
    """
    # 'All' / 'all' / '' → no status filter
    s = (status or "").strip()
    if s.lower() in ("all", ""):
        s = None
    return CustomerService.get_transaction_history(db, msisdn, start_date, end_date, s)


@router.get("/transaction-history/export.csv", summary="Stream un CSV de l'historique transactions")
def export_transaction_history_csv(
    msisdn: str = Query(...),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    status: Optional[str] = Query("Completed"),
    db: Session = Depends(get_db),
):
    s = (status or "").strip()
    if s.lower() in ("all", ""): s = None
    rows = CustomerService.get_transaction_history(db, msisdn, start_date, end_date, s)
    sd = (start_date or date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
    ed = (end_date   or date.today()).strftime('%Y-%m-%d')
    return stream_csv(rows, TRANSACTION_HISTORY_COLUMNS, f"Transaction_History_{msisdn}_{sd}_to_{ed}.csv")


@router.get("/transaction-history/export.xlsx", summary="Stream un XLSX de l'historique transactions")
def export_transaction_history_xlsx(
    msisdn: str = Query(...),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    status: Optional[str] = Query("Completed"),
    db: Session = Depends(get_db),
):
    s = (status or "").strip()
    if s.lower() in ("all", ""): s = None
    rows = CustomerService.get_transaction_history(db, msisdn, start_date, end_date, s)
    sd = (start_date or date.today() - timedelta(days=30)).strftime('%Y-%m-%d')
    ed = (end_date   or date.today()).strftime('%Y-%m-%d')
    return stream_xlsx(rows, TRANSACTION_HISTORY_COLUMNS, f"Transaction_History_{msisdn}_{sd}_to_{ed}.xlsx", "Transaction_History")


@router.get("/transaction-range", summary="Agrégat par mois × service normalisé × tier (montant)")
def get_transaction_range(
    start_date: Optional[date] = Query(None, description="Défaut: 1er janvier de l'année courante"),
    end_date: Optional[date] = Query(None, description="Défaut: yesterday"),
    service_names: Optional[List[str]] = Query(None, description="Filtre par NORMALIZED_SERVICENAME"),
    db: Session = Depends(get_db)
):
    """
    Renvoie une ligne par (mois, NORMALIZED_SERVICENAME, TIER) :
    DATE_CODE (1er du mois), SERVICENAME, TIER, DISTINCT_SUBS, TR_VOLUME, TR_VALUE.
    """
    return CustomerService.get_transaction_range(db, start_date, end_date, service_names)


@router.get("/transaction-range/export.csv", summary="Stream un CSV pivoté (mois × tier) pour la métrique demandée")
def export_transaction_range_csv(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    metric: str = Query("VOLUME", description="VOLUME | SUBS | VALUE — choix de la métrique exportée"),
    db: Session = Depends(get_db)
):
    """
    Export CSV pivoté : 1 ligne par (SERVICENAME, TIER), 1 colonne par mois,
    valeurs = métrique sélectionnée (VOLUME / SUBS / VALUE).
    """
    metric_key = {"VOLUME": "TR_VOLUME", "SUBS": "DISTINCT_SUBS", "VALUE": "TR_VALUE"}.get(metric.upper(), "TR_VOLUME")
    rows = CustomerService.get_transaction_range(db, start_date, end_date, service_names)

    # Pivot client-side : (service, tier) → {month: value}
    months_set = sorted({r["DATE_CODE"] for r in rows})
    pivot = {}  # (service, tier) -> {month: val}
    for r in rows:
        key = (r["SERVICENAME"] or "", r["TIER"] or "")
        if key not in pivot:
            pivot[key] = {}
        pivot[key][r["DATE_CODE"]] = r[metric_key]

    # Tri : SERVICENAME alphabétique, TIER par ordre canonique
    tier_pos = {t: i for i, t in enumerate(TIER_ORDER)}
    sorted_keys = sorted(pivot.keys(), key=lambda k: (k[0], tier_pos.get(k[1], 999)))

    # Construire les rows export
    pivoted_rows = []
    for (service, tier) in sorted_keys:
        row = {"SERVICENAME": service, "TIER": tier}
        for m in months_set:
            row[m] = pivot[(service, tier)].get(m, 0)
        pivoted_rows.append(row)

    # Colonnes Excel : SERVICENAME + TIER + chaque mois
    cols = [
        ("SERVICENAME", "SERVICENAME", lambda r: r.get("SERVICENAME") or ""),
        ("TIER",        "TIER",        lambda r: r.get("TIER") or ""),
    ]
    for m in months_set:
        cols.append((m, m, (lambda mm: lambda r: float(r.get(mm) or 0))(m)))

    s = (start_date or date(date.today().year, 1, 1)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return stream_csv(pivoted_rows, cols, f"Transaction_Range_{metric.upper()}_{s}_to_{e}.csv")


@router.get("/transaction-range/export.xlsx", summary="Stream un XLSX pivoté (mois × tier) pour la métrique demandée")
def export_transaction_range_xlsx(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    metric: str = Query("VOLUME"),
    db: Session = Depends(get_db)
):
    metric_key = {"VOLUME": "TR_VOLUME", "SUBS": "DISTINCT_SUBS", "VALUE": "TR_VALUE"}.get(metric.upper(), "TR_VOLUME")
    rows = CustomerService.get_transaction_range(db, start_date, end_date, service_names)
    months_set = sorted({r["DATE_CODE"] for r in rows})
    pivot = {}
    for r in rows:
        key = (r["SERVICENAME"] or "", r["TIER"] or "")
        pivot.setdefault(key, {})[r["DATE_CODE"]] = r[metric_key]
    tier_pos = {t: i for i, t in enumerate(TIER_ORDER)}
    sorted_keys = sorted(pivot.keys(), key=lambda k: (k[0], tier_pos.get(k[1], 999)))
    pivoted_rows = []
    for (service, tier) in sorted_keys:
        row = {"SERVICENAME": service, "TIER": tier}
        for m in months_set:
            row[m] = pivot[(service, tier)].get(m, 0)
        pivoted_rows.append(row)
    cols = [
        ("SERVICENAME", "SERVICENAME", lambda r: r.get("SERVICENAME") or ""),
        ("TIER",        "TIER",        lambda r: r.get("TIER") or ""),
    ]
    for m in months_set:
        cols.append((m, m, (lambda mm: lambda r: float(r.get(mm) or 0))(m)))
    s = (start_date or date(date.today().year, 1, 1)).strftime('%Y-%m-%d')
    e = (end_date   or date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
    return stream_xlsx(pivoted_rows, cols, f"Transaction_Range_{metric.upper()}_{s}_to_{e}.xlsx", f"Transaction_Range_{metric.upper()}")


@router.get("/mtd-by-service-name", summary="MTD courant agrégé par SERVICENAME (produit)")
def get_mtd_by_service_name(
    report_date: Optional[date] = Query(None, description="Date de fin MTD (défaut yesterday). Le début est toujours le 1er du mois."),
    db: Session = Depends(get_db)
):
    """
    Pour chaque SERVICENAME (Cash In, P2P Transfer, etc.), renvoie SUBS / VOLUME / VALUE / REVENUE
    sur le MTD courant. Dédup des montants pour les transactions credit+debit Customer (P2P/QR).
    """
    return CustomerService.get_mtd_by_service_name(db, report_date)


@router.get("/mtd-by-department", summary="MTD courant agrégé par DEPARTMENT (network location)")
def get_mtd_by_department(
    report_date: Optional[date] = Query(None, description="Date de fin MTD (défaut yesterday). Le début est toujours le 1er du mois."),
    db: Session = Depends(get_db)
):
    """
    Pour chaque DEPARTMENT (basé sur la localisation réseau 30j de la veille), renvoie
    SUBS / VOLUME / VALUE / REVENUE sur le MTD courant. MSISDN non localisés → 'Unknown'.
    """
    return CustomerService.get_mtd_by_department(db, report_date)


@router.get("/mtd-by-channel", summary="MTD courant agrégé par CHANNEL")
def get_mtd_by_channel(
    report_date: Optional[date] = Query(None, description="Date de fin MTD (défaut yesterday). Le début est toujours le 1er du mois."),
    db: Session = Depends(get_db)
):
    """
    Pour chaque CHANNEL (API / Web / QR / USSD_Digicel / ...), renvoie SUBS / VOLUME / VALUE / REVENUE
    sur le MTD courant. CHANNEL NULL ou vide est normalisé en 'Unknown'.
    """
    return CustomerService.get_mtd_by_channel(db, report_date)


@router.post("/msisdn-departments", summary="Bulk lookup MSISDN → DEPARTMENT (network location)")
def post_msisdn_departments(
    payload: dict = Body(..., example={"msisdns": ["50931234567", "50937654321"]}),
    db: Session = Depends(get_db),
):
    """
    Retourne, pour chaque MSISDN fourni dans `payload.msisdns`, son DEPARTMENT
    (network location 30j de la veille). Les MSISDN sans localisation sont absents
    du résultat — c'est au client de les compléter avec 'Unknown'.
    """
    msisdns = payload.get("msisdns") or []
    if not isinstance(msisdns, list):
        return {"results": [], "error": "msisdns must be a list of strings"}
    rows = CustomerService.get_msisdn_departments(db, msisdns)
    return {"results": rows}


@router.get("/churn-custom", summary="Customer churn entre deux plages libres (active vs exclude)")
def get_customer_churn_custom(
    active_start: date = Query(..., description="Début de la période d'activité (incluse)"),
    active_end: date = Query(..., description="Fin de la période d'activité (incluse)"),
    exclude_start: date = Query(..., description="Début de la période d'exclusion (incluse)"),
    exclude_end: date = Query(..., description="Fin de la période d'exclusion (incluse)"),
    return_list: bool = Query(False),
    limit: int = Query(100, ge=0),
    db: Session = Depends(get_db)
):
    """
    MSISDN ayant effectué une transaction (credit ou debit, Customer haïtien `509%`)
    pendant la **période active** mais PAS pendant la **période exclude**.

    Utilise les mêmes services credit/debit que la page Churn 30/60/90 (UNION + EXCEPT).
    """
    return CustomerService.get_customer_churn_custom(
        db, active_start, active_end, exclude_start, exclude_end, return_list, limit
    )


@router.get("/imt-churn", summary="MSISDN receveurs IMT pendant la période active mais PAS pendant la période exclude")
def get_imt_churn(
    active_start: date = Query(..., description="Début de la période d'activité (incluse)"),
    active_end: date = Query(..., description="Fin de la période d'activité (incluse)"),
    exclude_start: date = Query(..., description="Début de la période d'exclusion (incluse)"),
    exclude_end: date = Query(..., description="Fin de la période d'exclusion (incluse)"),
    return_list: bool = Query(False, description="Si true, retourne aussi la liste des MSISDN"),
    limit: int = Query(100, ge=0, description="Limite la liste retournée (0 = illimité). Le compteur reste global."),
    db: Session = Depends(get_db)
):
    """
    **Cas d'usage** : "Clients qui recevaient des IMT pendant la période active mais ne reçoivent plus pendant la période exclude".

    Pour chaque CREDITPARTYIDENTIFIER (Customer) avec SERVICENAME='IMT revceiving' et TRANSACTIONSTATUS='Completed' :
    - **Période active**   : MSISDN ayant reçu un IMT entre [active_start, active_end] (incluses)
    - **Période exclude**  : MSISDN à exclure s'ils ont reçu un IMT entre [exclude_start, exclude_end] (incluses)

    Renvoie : count global + (optionnel) liste des MSISDN.
    """
    return CustomerService.get_imt_churn(
        db, active_start, active_end, exclude_start, exclude_end, return_list, limit
    )


@router.get("/snapshot-bank-wallet-daily", summary="WoW snapshot Bank↔Wallet by BANK_NAME and direction")
def get_bank_wallet_snapshot_daily(
    report_date: Optional[date] = Query(None, description="Date courante (défaut yesterday). Preview = report_date - 7 jours."),
    db: Session = Depends(get_db)
):
    """
    Snapshot Week-on-Week pour les flux Bank↔Wallet :
    - **Bank to Wallet** : SERVICENAME='OD Money Transfer Prefunded' avec banque côté DEBIT
    - **Wallet to Bank** : SERVICENAME='Wallet to Bank' avec banque côté CREDIT
    Renvoyé par (BANK_NAME, TRANSACTION_TYPE) : PREV_/CURR_ {SUBS, VOLUME, VALUE, REVENUE}.
    """
    return CustomerService.get_bank_wallet_snapshot_daily(db, report_date)


@router.get("/snapshot-bank-wallet-mtd", summary="MoM (MTD) snapshot Bank↔Wallet by BANK_NAME and direction")
def get_bank_wallet_snapshot_mtd(
    report_date: Optional[date] = Query(None, description="Date courante (défaut yesterday). PREV = MTD du mois précédent au même day-of-month."),
    db: Session = Depends(get_db)
):
    """
    Snapshot Month-on-Month MTD pour les flux Bank↔Wallet :
    - CURR = [1er du mois de report_date, report_date]
    - PREV = [1er du mois précédent, même day-of-month du mois précédent]
    Renvoyé par (BANK_NAME, TRANSACTION_TYPE) : PREV_/CURR_ {SUBS, VOLUME, VALUE, REVENUE}.
    """
    return CustomerService.get_bank_wallet_snapshot_mtd(db, report_date)


@router.get("/snapshot-daily-by-dimension", summary="Week-on-week snapshot grouped by DEPARTMENT or CHANNEL")
def get_snapshot_daily_by_dimension(
    report_date: Optional[date] = Query(None),
    dimension:   str  = Query("DEPARTMENT", regex="^(DEPARTMENT|CHANNEL)$"),
    service_names: Optional[List[str]] = Query(None),
    msisdns:       Optional[List[str]] = Query(None),
    channels:      Optional[List[str]] = Query(None),
    departments:   Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    """
    WoW snapshot par dimension (DEPARTMENT ou CHANNEL).
    - PREV = report_date - 7, CURR = report_date.
    - PREV/CURR pour SUBS, VOLUME, VALUE, REVENUE par DIM_VALUE.
    Pour DEPARTMENT : JOIN ht_location + vw_dt_network_sites (snapshot d'hier).
    """
    return CustomerService.get_snapshot_daily_by_dimension(
        db, report_date, dimension, service_names, msisdns, channels, departments,
    )


@router.get("/snapshot-mtd-by-dimension", summary="Month-on-month MTD snapshot grouped by DEPARTMENT or CHANNEL")
def get_mtd_snapshot_by_dimension(
    report_date: Optional[date] = Query(None),
    dimension:   str  = Query("DEPARTMENT", regex="^(DEPARTMENT|CHANNEL)$"),
    service_names: Optional[List[str]] = Query(None),
    msisdns:       Optional[List[str]] = Query(None),
    channels:      Optional[List[str]] = Query(None),
    departments:   Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    """
    MoM MTD snapshot par dimension (DEPARTMENT ou CHANNEL).
    - CURR = [1er du mois, report_date], PREV = [1er mois précédent, même day-of-month].
    """
    return CustomerService.get_mtd_snapshot_by_dimension(
        db, report_date, dimension, service_names, msisdns, channels, departments,
    )


# ── Streaming Excel des deux snapshots-by-dimension ────────────────────────────
# Colonnes : la dimension + PREV/CURR/DIFF/VAR pour les 4 métriques.
# Diff et Var sont précalculés côté serveur pour que l'utilisateur ait directement
# l'analyse prête à coller dans une présentation.
def _row_to_export(r: dict) -> dict:
    """Aplatit une row snapshot avec Diff + Var précalculés."""
    def diff(prev, curr):
        return (curr or 0) - (prev or 0)
    def var_pct(prev, curr):
        p, c = float(prev or 0), float(curr or 0)
        if not p and not c: return 0.0
        if not p: return 100.0
        return ((c - p) / p) * 100.0
    return {
        **r,
        "DIFF_SUBS":    diff(r.get("PREV_SUBS"),    r.get("CURR_SUBS")),
        "DIFF_VOLUME":  diff(r.get("PREV_VOLUME"),  r.get("CURR_VOLUME")),
        "DIFF_VALUE":   diff(r.get("PREV_VALUE"),   r.get("CURR_VALUE")),
        "DIFF_REVENUE": diff(r.get("PREV_REVENUE"), r.get("CURR_REVENUE")),
        "VAR_SUBS":    var_pct(r.get("PREV_SUBS"),    r.get("CURR_SUBS")),
        "VAR_VOLUME":  var_pct(r.get("PREV_VOLUME"),  r.get("CURR_VOLUME")),
        "VAR_VALUE":   var_pct(r.get("PREV_VALUE"),   r.get("CURR_VALUE")),
        "VAR_REVENUE": var_pct(r.get("PREV_REVENUE"), r.get("CURR_REVENUE")),
    }


SNAPSHOT_DIMENSION_COLUMNS = [
    ("DIM_VALUE",    "Dimension",     lambda r: r.get("DIM_VALUE") or ""),
    ("PREV_SUBS",    "Prev Subs",     lambda r: int(r.get("PREV_SUBS")    or 0)),
    ("CURR_SUBS",    "Curr Subs",     lambda r: int(r.get("CURR_SUBS")    or 0)),
    ("DIFF_SUBS",    "Diff Subs",     lambda r: int(r.get("DIFF_SUBS")    or 0)),
    ("VAR_SUBS",     "Var Subs (%)",  lambda r: round(float(r.get("VAR_SUBS")    or 0), 2)),
    ("PREV_VOLUME",  "Prev Volume",   lambda r: int(r.get("PREV_VOLUME")  or 0)),
    ("CURR_VOLUME",  "Curr Volume",   lambda r: int(r.get("CURR_VOLUME")  or 0)),
    ("DIFF_VOLUME",  "Diff Volume",   lambda r: int(r.get("DIFF_VOLUME")  or 0)),
    ("VAR_VOLUME",   "Var Volume (%)",lambda r: round(float(r.get("VAR_VOLUME")  or 0), 2)),
    ("PREV_VALUE",   "Prev Value",    lambda r: float(r.get("PREV_VALUE")   or 0)),
    ("CURR_VALUE",   "Curr Value",    lambda r: float(r.get("CURR_VALUE")   or 0)),
    ("DIFF_VALUE",   "Diff Value",    lambda r: float(r.get("DIFF_VALUE")   or 0)),
    ("VAR_VALUE",    "Var Value (%)", lambda r: round(float(r.get("VAR_VALUE")    or 0), 2)),
    ("PREV_REVENUE", "Prev Revenue",  lambda r: float(r.get("PREV_REVENUE") or 0)),
    ("CURR_REVENUE", "Curr Revenue",  lambda r: float(r.get("CURR_REVENUE") or 0)),
    ("DIFF_REVENUE", "Diff Revenue",  lambda r: float(r.get("DIFF_REVENUE") or 0)),
    ("VAR_REVENUE",  "Var Revenue (%)", lambda r: round(float(r.get("VAR_REVENUE") or 0), 2)),
]


@router.get("/snapshot-daily-by-dimension/export.xlsx", summary="Stream XLSX du WoW snapshot par dimension")
def export_snapshot_daily_by_dimension(
    report_date: Optional[date] = Query(None),
    dimension:   str  = Query("DEPARTMENT", regex="^(DEPARTMENT|CHANNEL)$"),
    service_names: Optional[List[str]] = Query(None),
    channels:      Optional[List[str]] = Query(None),
    departments:   Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    data = CustomerService.get_snapshot_daily_by_dimension(
        db, report_date, dimension, service_names, None, channels, departments,
    )
    rows = [_row_to_export(r) for r in (data.get("rows") or [])]
    cd, pd_ = data.get("current_date") or "now", data.get("prev_date") or "prev"
    return stream_xlsx(
        rows, SNAPSHOT_DIMENSION_COLUMNS,
        f"Snapshot_{dimension}_WoW_{cd}_vs_{pd_}.xlsx",
        f"Snapshot_{dimension}_WoW",
    )


@router.get("/snapshot-mtd-by-dimension/export.xlsx", summary="Stream XLSX du MoM (MTD) snapshot par dimension")
def export_snapshot_mtd_by_dimension(
    report_date: Optional[date] = Query(None),
    dimension:   str  = Query("DEPARTMENT", regex="^(DEPARTMENT|CHANNEL)$"),
    service_names: Optional[List[str]] = Query(None),
    channels:      Optional[List[str]] = Query(None),
    departments:   Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    data = CustomerService.get_mtd_snapshot_by_dimension(
        db, report_date, dimension, service_names, None, channels, departments,
    )
    rows = [_row_to_export(r) for r in (data.get("rows") or [])]
    ce = data.get("current_end") or "now"
    pe = data.get("prev_end")    or "prev"
    return stream_xlsx(
        rows, SNAPSHOT_DIMENSION_COLUMNS,
        f"Snapshot_{dimension}_MTD_{ce}_vs_{pe}.xlsx",
        f"Snapshot_{dimension}_MTD",
    )


@router.get("/period-aggregates-by-dimension", summary="Per-dimension aggregates over arbitrary date range (DISTINCT subs)")
def get_period_aggregates_by_dimension(
    start_date: date = Query(..., description="YYYY-MM-DD"),
    end_date:   date = Query(..., description="YYYY-MM-DD"),
    dimension:  str  = Query(..., regex="^(TR_TYPE|CHANNEL|DEPARTMENT)$",
                              description="TR_TYPE | CHANNEL | DEPARTMENT"),
    service_names: Optional[List[str]] = Query(None),
    msisdns:       Optional[List[str]] = Query(None),
    channels:      Optional[List[str]] = Query(None),
    departments:   Optional[List[str]] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Pour chaque valeur de la dimension (TR_TYPE / CHANNEL / DEPARTMENT), renvoie
    sur la **fenêtre entière** [start_date, end_date] :
    - SUBS    = COUNT(DISTINCT MSISDN)          ← uniquement comptés une fois
    - VOLUME  = COUNT(DISTINCT TRANSACTIONID)
    - VALUE   = SUM(ORIGINALAMOUNT)
    - REVENUE = SUM(CHARGEAMOUNT)

    Utilisé par le modal "% Breakdown" en mode Daily — évite le double-comptage
    qu'on aurait en sommant les distincts journaliers de daily-stats-by-type.
    """
    return CustomerService.get_period_aggregates_by_dimension(
        db, start_date, end_date, dimension,
        service_names, msisdns, channels, departments,
    )


@router.get("/snapshot-mtd-by-type", summary="Month-on-Month MTD snapshot (current MTD vs previous month MTD) by TR_TYPE")
def get_mtd_snapshot_by_type(
    report_date: Optional[date] = Query(None, description="Date courante. CURR=[1er du mois, report_date], PREV=[1er mois précédent, même day-of-month]."),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    departments: Optional[List[str]] = Query(None, description="Filtre MSISDN par département (JOIN ht_location + vw_dt_network_sites)."),
    db: Session = Depends(get_db)
):
    """
    Pour chaque TR_TYPE, compare deux MTD parallèles :
    - **CURR** = [1er du mois de report_date, report_date]
    - **PREV** = [1er du mois précédent, même jour-du-mois (borné au dernier jour si besoin)]
    Métriques : SUBS, VOLUME, VALUE, REVENUE.
    Le filtre `departments` restreint l'univers de MSISDN à ceux dont la location
    courante est dans les départements indiqués — `current_total.SUBS` reste DISTINCT.
    """
    return CustomerService.get_mtd_snapshot_by_type(
        db, report_date, service_names, msisdns, channels, departments
    )


@router.get("/monthly-totals", summary="Monthly clean totals (cross TR_TYPE, optional product/department filters, optional MTD day bound)")
def get_monthly_totals(
    start_month: Optional[date] = Query(None, description="Mois de début (normalisé au 1er). Défaut : 6 mois en arrière."),
    end_month: Optional[date] = Query(None, description="Mois de fin (normalisé au 1er). Défaut : mois courant."),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    day_of_month: Optional[int] = Query(None, ge=1, le=31, description="Si fourni, borne chaque mois à [1er, day_of_month]."),
    departments: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Pour chaque mois, totaux cross TR_TYPE :
    - **SUBS**    : COUNT(DISTINCT MSISDN) du mois (clean, pas de double-comptage cross TR_TYPE)
    - **VOLUME**  : Σ COUNT(DISTINCT TRANSACTIONID) par TR_TYPE
    - **VALUE**   : Σ SUM(ORIGINALAMOUNT) par TR_TYPE
    - **REVENUE** : Σ SUM(CHARGEAMOUNT)   par TR_TYPE

    Filtres optionnels : `service_names`, `departments`, `day_of_month` (MTD bound).
    """
    return CustomerService.get_monthly_totals(
        db, start_month, end_month, service_names, msisdns, channels, day_of_month, departments
    )


@router.get("/mtd-stats-by-month-type", summary="MTD aggregate per (month × TR_TYPE)")
def get_mtd_stats_by_month_and_type(
    start_month: Optional[date] = Query(None, description="Mois de début (normalisé au 1er). Défaut : 6 mois en arrière."),
    end_month: Optional[date] = Query(None, description="Mois de fin (normalisé au 1er). Défaut : mois courant."),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    day_of_month: Optional[int] = Query(None, ge=1, le=31, description="Si fourni, borne chaque mois à [1er, day_of_month]. Défaut : dernier jour du mois."),
    departments: Optional[List[str]] = Query(None, description="Liste de DEPARTMENT (network location) pour filtrer par département"),
    db: Session = Depends(get_db)
):
    """
    Pour chaque (mois, TR_TYPE) dans la plage :
    - **VOLUME**  : COUNT(DISTINCT TRANSACTIONID)
    - **SUBS**    : COUNT(DISTINCT MSISDN)
    - **VALUE**   : SUM(ORIGINALAMOUNT)
    - **REVENUE** : SUM(CHARGEAMOUNT)
    Mois courant borné sur yesterday. Si `day_of_month` est fourni, chaque mois s'arrête à ce jour.
    """
    return CustomerService.get_mtd_stats_by_month_and_type(
        db, start_month, end_month, service_names, msisdns, channels, day_of_month, departments
    )


@router.get("/mtd-stats-by-month-department", summary="MTD aggregate per (month × DEPARTMENT)")
def get_mtd_stats_by_month_and_department(
    start_month: Optional[date] = Query(None, description="Mois de début (normalisé au 1er). Défaut : 6 mois en arrière."),
    end_month: Optional[date] = Query(None, description="Mois de fin (normalisé au 1er). Défaut : mois courant."),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    day_of_month: Optional[int] = Query(None, ge=1, le=31, description="Si fourni, borne chaque mois à [1er, day_of_month]. Défaut : dernier jour du mois."),
    db: Session = Depends(get_db)
):
    """
    Pour chaque (mois, DEPARTMENT) dans la plage :
    - **VOLUME**  : COUNT(DISTINCT TRANSACTIONID)
    - **SUBS**    : COUNT(DISTINCT MSISDN)
    - **VALUE**   : SUM(ORIGINALAMOUNT)
    - **REVENUE** : SUM(CHARGEAMOUNT)

    DEPARTMENT vient du JOIN ht_location × vw_dt_network_sites (snapshot d'hier).
    Mois courant borné sur yesterday. Si `day_of_month` est fourni, chaque mois s'arrête à ce jour.
    """
    return CustomerService.get_mtd_stats_by_month_and_department(
        db, start_month, end_month, service_names, msisdns, channels, day_of_month
    )


@router.get("/mtd-stats-by-month-channel", summary="MTD aggregate per (month × CHANNEL)")
def get_mtd_stats_by_month_and_channel(
    start_month: Optional[date] = Query(None, description="Mois de début (normalisé au 1er). Défaut : 6 mois en arrière."),
    end_month: Optional[date] = Query(None, description="Mois de fin (normalisé au 1er). Défaut : mois courant."),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    day_of_month: Optional[int] = Query(None, ge=1, le=31, description="Si fourni, borne chaque mois à [1er, day_of_month]. Défaut : dernier jour du mois."),
    db: Session = Depends(get_db)
):
    """
    Pour chaque (mois, CHANNEL) dans la plage :
    - **VOLUME**  : COUNT(DISTINCT TRANSACTIONID)
    - **SUBS**    : COUNT(DISTINCT MSISDN) attribué au canal primaire par MSISDN/mois
    - **VALUE**   : SUM(ORIGINALAMOUNT)
    - **REVENUE** : SUM(CHARGEAMOUNT)

    CHANNEL NULL ou vide → 'Unknown'. Mois courant borné sur yesterday.
    Si `day_of_month` est fourni, chaque mois s'arrête à ce jour.
    """
    return CustomerService.get_mtd_stats_by_month_and_channel(
        db, start_month, end_month, service_names, msisdns, channels, day_of_month
    )


@router.get("/snapshot-daily-by-type", summary="Week-on-Week snapshot (current vs J-7) by TR_TYPE")
def get_snapshot_daily_by_type(
    report_date: Optional[date] = Query(None, description="Date courante (défaut yesterday). Preview = report_date - 7 jours."),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Pour chaque TR_TYPE, renvoie les valeurs PREV (J-7) vs CURR (report_date) pour :
    SUBS, VOLUME, VALUE, REVENUE.
    """
    return CustomerService.get_snapshot_daily_by_type(
        db, report_date, service_names, msisdns, channels
    )


# ── Excel export columns for TR_TYPE-grouped snapshots ───────────────────────
SNAPSHOT_BY_TYPE_COLUMNS = [
    ("TR_TYPE",      "TR Type",        lambda r: r.get("TR_TYPE") or ""),
    ("PREV_SUBS",    "Prev Subs",      lambda r: int(r.get("PREV_SUBS")    or 0)),
    ("CURR_SUBS",    "Curr Subs",      lambda r: int(r.get("CURR_SUBS")    or 0)),
    ("DIFF_SUBS",    "Diff Subs",      lambda r: int(r.get("DIFF_SUBS")    or 0)),
    ("VAR_SUBS",     "Var Subs (%)",   lambda r: round(float(r.get("VAR_SUBS")    or 0), 2)),
    ("PREV_VOLUME",  "Prev Volume",    lambda r: int(r.get("PREV_VOLUME")  or 0)),
    ("CURR_VOLUME",  "Curr Volume",    lambda r: int(r.get("CURR_VOLUME")  or 0)),
    ("DIFF_VOLUME",  "Diff Volume",    lambda r: int(r.get("DIFF_VOLUME")  or 0)),
    ("VAR_VOLUME",   "Var Volume (%)", lambda r: round(float(r.get("VAR_VOLUME")  or 0), 2)),
    ("PREV_VALUE",   "Prev Value",     lambda r: float(r.get("PREV_VALUE")  or 0)),
    ("CURR_VALUE",   "Curr Value",     lambda r: float(r.get("CURR_VALUE")  or 0)),
    ("DIFF_VALUE",   "Diff Value",     lambda r: float(r.get("DIFF_VALUE")  or 0)),
    ("VAR_VALUE",    "Var Value (%)",  lambda r: round(float(r.get("VAR_VALUE")  or 0), 2)),
    ("PREV_REVENUE", "Prev Revenue",   lambda r: float(r.get("PREV_REVENUE") or 0)),
    ("CURR_REVENUE", "Curr Revenue",   lambda r: float(r.get("CURR_REVENUE") or 0)),
    ("DIFF_REVENUE", "Diff Revenue",   lambda r: float(r.get("DIFF_REVENUE") or 0)),
    ("VAR_REVENUE",  "Var Revenue (%)",lambda r: round(float(r.get("VAR_REVENUE") or 0), 2)),
]

# ── Excel export columns for Bank↔Wallet snapshots (extra TRANSACTION_TYPE col) ──
SNAPSHOT_BANK_WALLET_COLUMNS = [
    ("BANK_NAME",        "Bank Name",       lambda r: r.get("BANK_NAME") or ""),
    ("TRANSACTION_TYPE", "Transaction Type", lambda r: r.get("TRANSACTION_TYPE") or ""),
    *SNAPSHOT_BY_TYPE_COLUMNS[1:],   # reuse all the PREV/CURR/DIFF/VAR cols
]


@router.get("/snapshot-daily-by-type/export.xlsx", summary="Stream XLSX du WoW snapshot par TR_TYPE")
def export_snapshot_daily_by_type(
    report_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    data = CustomerService.get_snapshot_daily_by_type(db, report_date, service_names, msisdns, channels)
    rows = [_row_to_export(r) for r in (data.get("rows") or [])]
    cd, pd_ = data.get("current_date") or "now", data.get("prev_date") or "prev"
    return stream_xlsx(rows, SNAPSHOT_BY_TYPE_COLUMNS,
                       f"Snapshot_TR_TYPE_WoW_{cd}_vs_{pd_}.xlsx", "Snapshot_TR_TYPE_WoW")


@router.get("/snapshot-mtd-by-type/export.xlsx", summary="Stream XLSX du MoM (MTD) snapshot par TR_TYPE")
def export_snapshot_mtd_by_type(
    report_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    data = CustomerService.get_mtd_snapshot_by_type(db, report_date, service_names, msisdns, channels)
    rows = [_row_to_export(r) for r in (data.get("rows") or [])]
    ce = data.get("current_end") or "now"
    pe = data.get("prev_end")    or "prev"
    return stream_xlsx(rows, SNAPSHOT_BY_TYPE_COLUMNS,
                       f"Snapshot_TR_TYPE_MTD_{ce}_vs_{pe}.xlsx", "Snapshot_TR_TYPE_MTD")


@router.get("/snapshot-bank-wallet-daily/export.xlsx", summary="Stream XLSX du WoW Bank↔Wallet snapshot")
def export_snapshot_bank_wallet_daily(
    report_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    data = CustomerService.get_bank_wallet_snapshot_daily(db, report_date)
    rows = [_row_to_export(r) for r in (data.get("rows") or [])]
    cd, pd_ = data.get("current_date") or "now", data.get("prev_date") or "prev"
    return stream_xlsx(rows, SNAPSHOT_BANK_WALLET_COLUMNS,
                       f"Snapshot_BankWallet_WoW_{cd}_vs_{pd_}.xlsx", "Snapshot_BankWallet_WoW")


@router.get("/snapshot-bank-wallet-mtd/export.xlsx", summary="Stream XLSX du MoM (MTD) Bank↔Wallet snapshot")
def export_snapshot_bank_wallet_mtd(
    report_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    data = CustomerService.get_bank_wallet_snapshot_mtd(db, report_date)
    rows = [_row_to_export(r) for r in (data.get("rows") or [])]
    ce = data.get("current_end") or "now"
    pe = data.get("prev_end")    or "prev"
    return stream_xlsx(rows, SNAPSHOT_BANK_WALLET_COLUMNS,
                       f"Snapshot_BankWallet_MTD_{ce}_vs_{pe}.xlsx", "Snapshot_BankWallet_MTD")


@router.get("/daily-stats-by-type", summary="Daily aggregate by TR_TYPE (volume / subs / value / revenue)")
def get_daily_stats_by_type(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    limit: int = Query(5000),
    db: Session = Depends(get_db)
):
    """
    Pour chaque (jour, TR_TYPE) :
    - **VOLUME**  : COUNT(DISTINCT TRANSACTIONID)
    - **SUBS**    : COUNT(DISTINCT MSISDN)
    - **VALUE**   : SUM(ORIGINALAMOUNT)
    - **REVENUE** : SUM(CHARGEAMOUNT)
    """
    return CustomerService.get_daily_stats_by_type(
        db, start_date, end_date, service_names, msisdns, channels, limit
    )


@router.get("/daily-stats-by-channel", summary="Daily aggregate by CHANNEL (volume / subs / value / revenue)")
def get_daily_stats_by_channel(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    limit: int = Query(10000),
    db: Session = Depends(get_db)
):
    """
    Pour chaque (jour, CHANNEL) :
    - **VOLUME**  : COUNT(DISTINCT TRANSACTIONID)
    - **SUBS**    : COUNT(DISTINCT MSISDN) — distinct par jour ET par channel
    - **VALUE**   : SUM(ORIGINALAMOUNT)
    - **REVENUE** : SUM(CHARGEAMOUNT)
    CHANNEL NULL ou vide → 'Unknown'.
    """
    return CustomerService.get_daily_stats_by_channel(
        db, start_date, end_date, service_names, msisdns, channels, limit
    )


@router.get("/daily-stats-by-department", summary="Daily aggregate by DEPARTMENT (volume / subs / value / revenue)")
def get_daily_stats_by_department(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    limit: int = Query(10000),
    db: Session = Depends(get_db)
):
    """
    Pour chaque (jour, DEPARTMENT) :
    - **VOLUME**  : COUNT(DISTINCT TRANSACTIONID)
    - **SUBS**    : COUNT(DISTINCT MSISDN) — distinct par jour ET par département
    - **VALUE**   : SUM(ORIGINALAMOUNT)
    - **REVENUE** : SUM(CHARGEAMOUNT)

    DEPARTMENT vient du JOIN ht_location × vw_dt_network_sites (snapshot d'hier).
    MSISDN sans location → 'Unknown'.
    """
    return CustomerService.get_daily_stats_by_department(
        db, start_date, end_date, service_names, msisdns, channels, limit
    )


@router.get("/daily-totals", summary="Daily clean totals (cross TR_TYPE, optional product / department filters)")
def get_daily_totals(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None, description="Liste de TR_TYPE (ex. CASHIN, P2P_SEND) pour filtrer par produit"),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None),
    departments: Optional[List[str]] = Query(None, description="Liste de DEPARTMENT (network location) pour filtrer par département"),
    db: Session = Depends(get_db)
):
    """
    Pour chaque jour, totaux cross TR_TYPE :
    - **SUBS**    : COUNT(DISTINCT MSISDN) du jour
    - **VOLUME**  : Σ COUNT(DISTINCT TRANSACTIONID) par TR_TYPE
    - **VALUE**   : Σ SUM(ORIGINALAMOUNT) par TR_TYPE
    - **REVENUE** : Σ SUM(CHARGEAMOUNT)   par TR_TYPE

    Filtres optionnels :
    - `service_names` : restriction par produit (TR_TYPE)
    - `departments`   : restriction par département (JOIN avec network location)
    """
    return CustomerService.get_daily_totals(
        db, start_date, end_date, service_names, msisdns, channels, departments
    )


@router.get("/transactions/summary", summary="Aggregate KPIs over the full period (no row limit)")
def get_transactions_summary(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    service_names: Optional[List[str]] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    channels: Optional[List[str]] = Query(None, description="Filtrer par un ou plusieurs canaux (case-insensitive)"),
    transaction_statuses: Optional[List[str]] = Query(None, description="Filtre TRANSACTIONSTATUS : Completed / Cancelled / Declined / Expired (défaut : Completed)"),
    db: Session = Depends(get_db)
):
    """
    Renvoie pour la période et filtres donnés :
    - **TOTAL_COUNT**: nombre total de transactions (sans LIMIT)
    - **DISTINCT_MSISDN**: nombre de clients uniques
    - **TOTAL_VOLUME**: somme des montants (HTG)
    - **TOTAL_CHARGE**: somme des frais (HTG)
    """
    return CustomerService.get_transactions_summary(
        db, start_date, end_date, service_names, msisdns, channels, transaction_statuses,
    )


@router.get("/mtd-stats", summary="Get Month-to-Date stats by transaction type")
def get_mtd_stats_by_type(
    msisdns: Optional[List[str]] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Get statistics aggregated by transaction type for a date range (defaults to Month-to-Date).
    
    Returns for each TR_TYPE (final cumulative totals as of end_date):
    - **SUBS**: Cumulative count of unique customers (each counted once per month on first appearance)
    - **VOLUME**: Cumulative count of transactions
    - **VALUE**: Cumulative sum of ORIGINALAMOUNT
    - **REVENUE**: Cumulative sum of CHARGEAMOUNT
    
    Optional filters:
    - **msisdns**: List of MSISDNs to filter by
    - **start_date**: Start date in YYYY-MM-DD format (defaults to first day of current month)
    - **end_date**: End date in YYYY-MM-DD format (defaults to yesterday)
    """
    return CustomerMTDService.get_mtd_stats_by_type(db, msisdns, start_date, end_date)


@router.get("/mtd-stats/by-day", summary="Get MTD stats progression by day")
def get_mtd_stats_by_day(
    tr_type: Optional[str] = Query(None),
    msisdns: Optional[List[str]] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Get daily breakdown of MTD statistics showing progression day by day.
    Each record contains both daily metrics and cumulative totals from month start.
    
    Returns for each day:
    - **TRANSACTION_DATE**: Date of the transactions
    - **TR_TYPE**: Transaction type
    - **DAILY_SUBS**: New distinct MSISDN on that day (first appearance in month)
    - **DAILY_VOLUME**: Transaction count on that day
    - **DAILY_VALUE**: Sum of amounts on that day
    - **DAILY_REVENUE**: Sum of charges on that day
    - **CUMUL_SUBS**: Cumulative unique customers from month start
    - **CUMUL_VOLUME**: Cumulative transaction count from month start
    - **CUMUL_VALUE**: Cumulative sum of amounts from month start
    - **CUMUL_REVENUE**: Cumulative sum of charges from month start
    
    Optional filters:
    - **tr_type**: Filter by specific transaction type (e.g. 'P2P_SEND')
    - **msisdns**: List of MSISDNs to filter by
    - **start_date**: Start date in YYYY-MM-DD format (defaults to first day of current month)
    - **end_date**: End date in YYYY-MM-DD format (defaults to yesterday)
    """
    return CustomerMTDService.get_mtd_stats_by_day(db, tr_type, msisdns, start_date, end_date)


@router.get("/mtd-snapshot/by-day-of-month", summary="Get snapshot of subscribers by day-of-month")
def get_mtd_snapshot_by_day_of_month(
    day_of_month: int = Query(..., description="Day of month to filter (1-31), e.g. 25"),
    msisdns: Optional[List[str]] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    return CustomerMTDService.get_subscribers_snapshot_by_day_of_month(db, day_of_month, msisdns, start_date, end_date)
