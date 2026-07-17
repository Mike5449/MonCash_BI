from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
from services.period_report.period_report_service import PeriodReportService


router = APIRouter(
    prefix="/tools",
    tags=["tools"],
)


@router.get(
    "/period-report",
    summary="Custom period KPIs : registered / active / dormant customers by gender + merchants + volume/value",
)
def get_period_report(
    start_date: str = Query(..., description="YYYY-MM-DD — start of period (inclusive)"),
    end_date:   str = Query(..., description="YYYY-MM-DD — end of period (inclusive)"),
    db: Session = Depends(get_db),
):
    """
    Returns 8 KPIs for the chosen period :

    1. **customers.registered** — customer accounts whose DATEIDENTITYREGISTERED
       falls in the period, broken down by gender (FEMALE / MALE / UNKNOWN).
    2. **customers.active** — customer profiles with ≥1 Completed MFS transaction
       in the period (any side), broken down by gender.
    3. **customers.dormant** — customer profiles (IDENTITYSTATUS != 'Closed')
       with NO transaction in the period, broken down by gender.
    4. **merchants.registered** — merchants (PRODUCTS LIKE '%Merchant Product%')
       registered in the period.
    5. **merchants.active** — merchants with ≥1 Completed merchant-domain
       transaction in the period.
    6. **merchants.dormant** — current merchant profiles (status != 'Closed')
       NOT in the active set.
    7. **transactions.volume** — COUNT(DISTINCT TRANSACTIONID) for all Completed
       MFS transactions in the period.
    8. **transactions.value**  — SUM(ORIGINALAMOUNT) in HTG over the same set.
    """
    return PeriodReportService.get_period_report(db, start_date, end_date)


@router.get(
    "/period-report/channel-matrix",
    summary="Channel × transaction-category matrix (Recharge / Cash In / Cash Out / P2P / Bill / Merchant)",
)
def get_period_report_channel_matrix(
    start_date: str = Query(..., description="YYYY-MM-DD — start of period (inclusive)"),
    end_date:   str = Query(..., description="YYYY-MM-DD — end of period (inclusive)"),
    db: Session = Depends(get_db),
):
    """
    Matrix used by the compliance reporting :

    Rows (transaction categories) :
      - Recharge téléphonique             = SELF_TOPUP + TOPUP_GIFT
      - Dépôts en cash                     = CASHIN + Cash In Self
      - Retraits de Cash                   = CASHOUT
      - Transfert personne à personne      = P2P_RECEIVE + SUBSCRIBERP2P
      - Transfert personne à entreprise    = (empty)
      - Paiement de facture                = BILLPAY
      - Paiement marchand affilié          = PAY2MERC
      - Paiements de salaires              = (empty)
      - Autres (à spécifier)               = every unmapped TR_TYPE

    Columns (channel groups) :
      - Opération via téléphone mobile     = USSD_Digicel
      - Opération via carte                = (empty)
      - Opération en ligne                 = API + APP + QR
      - Total                              = sum across all channels present
    """
    return PeriodReportService.get_channel_category_matrix(db, start_date, end_date)


@router.get(
    "/period-report/regulatory",
    summary="Regulatory point-in-time report (Trimestre courant) — one column",
)
def get_period_report_regulatory(
    reference_date: str = Query(..., description="YYYY-MM-DD — point-in-time reference (e.g. end of quarter)"),
    db: Session = Depends(get_db),
):
    """
    Point-in-time regulatory report. Populated one row at a time as the
    business team provides the SQL. Rows not yet implemented return null.

    Rows :
      1. Nombre de Clients                                                    (left empty)
      2. Nombre de comptes de fonds de paiement électronique enregistrés
      3. Nombre de comptes de fonds de paiement électronique actifs (90 j)
      4. Nombre de comptes de fonds de paiement électronique dormants (90 j)
      5. Nombre d'agents enregistrés
      6. Nombre d'agents actifs (90 j)
      7. Nombre d'agents dormants (90 j)
      8. Nombre de commerçants affiliés enregistrés
      9. Nombre de commerçants affiliés actifs
      10. Nombre de commerçants affiliés dormants
      11. Nombre total de transactions
      12. Valeur totale des transactions (en milliers de gourdes)
    """
    return PeriodReportService.get_regulatory_report(db, reference_date)
