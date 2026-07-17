from typing import Dict, Any
from sqlalchemy.orm import Session
from repositories.period_report.period_report_repository import PeriodReportRepository


class PeriodReportService:
    @staticmethod
    def get_period_report(db: Session, start_date: str, end_date: str) -> Dict[str, Any]:
        return PeriodReportRepository(db).get_period_report(start_date, end_date)

    @staticmethod
    def get_channel_category_matrix(db: Session, start_date: str, end_date: str) -> Dict[str, Any]:
        return PeriodReportRepository(db).get_channel_category_matrix(start_date, end_date)

    @staticmethod
    def get_regulatory_report(db: Session, reference_date: str) -> Dict[str, Any]:
        return PeriodReportRepository(db).get_regulatory_report(reference_date)


# Cache the read-only method.
from core.cache import cache_all_methods  # noqa: E402
cache_all_methods(PeriodReportService)
