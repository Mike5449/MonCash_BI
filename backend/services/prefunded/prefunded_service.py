from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from repositories.prefunded.prefunded_repository import PrefundedRepository
from repositories.prefunded.prefunded_transaction_repository import PrefundedTransactionRepository


class PrefundedService:
    @staticmethod
    def get_accounts(
        db: Session,
        limit: int = 100,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        repository = PrefundedRepository(db)
        return repository.get_prefunded_accounts(limit=limit, start_date=start_date, end_date=end_date)

    @staticmethod
    def get_transactions(
        db: Session,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: int = 100,
        active_only: bool = False,
        org_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        repository = PrefundedTransactionRepository(db)
        return repository.get_transactions(
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            active_only=active_only,
            org_ids=org_ids,
            msisdns=msisdns,
            channels=channels,
            statuses=statuses,
        )

    @staticmethod
    def get_transactions_summary(
        db: Session,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        org_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        repository = PrefundedTransactionRepository(db)
        return repository.get_summary(
            start_date=start_date,
            end_date=end_date,
            org_ids=org_ids,
            msisdns=msisdns,
            channels=channels,
            statuses=statuses,
        )

    @staticmethod
    def get_monthly_stats_by_org(
        db: Session,
        start_month: Optional[str] = None,
        end_month: Optional[str] = None,
        org_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> Dict[str, Any]:
        repository = PrefundedTransactionRepository(db)
        return repository.get_monthly_stats_by_org(
            start_month=start_month,
            end_month=end_month,
            org_ids=org_ids,
            msisdns=msisdns,
            channels=channels,
            statuses=statuses,
            limit=limit,
        )


# Cache all read-only query methods (TTL from settings; large results skipped).
from core.cache import cache_all_methods  # noqa: E402
cache_all_methods(PrefundedService)
