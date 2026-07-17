from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from repositories.biller.biller_repository import BillerRepository
from repositories.biller.biller_transaction_repository import BillerTransactionRepository


class BillerService:
    @staticmethod
    def get_accounts(db: Session, limit: int = 100) -> List[Dict[str, Any]]:
        repository = BillerRepository(db)
        return repository.get_biller_accounts(limit=limit)

    @staticmethod
    def get_transactions(
        db: Session,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: int = 100,
        active_only: bool = False,
        biller_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        repository = BillerTransactionRepository(db)
        return repository.get_transactions(
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            active_only=active_only,
            biller_ids=biller_ids,
            msisdns=msisdns,
            channels=channels,
            statuses=statuses,
        )

    @staticmethod
    def get_transactions_summary(
        db: Session,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        biller_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        repository = BillerTransactionRepository(db)
        return repository.get_summary(
            start_date=start_date,
            end_date=end_date,
            biller_ids=biller_ids,
            msisdns=msisdns,
            channels=channels,
            statuses=statuses,
        )

    @staticmethod
    def get_monthly_stats_by_biller(
        db: Session,
        start_month: Optional[str] = None,
        end_month: Optional[str] = None,
        biller_ids: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> Dict[str, Any]:
        repository = BillerTransactionRepository(db)
        return repository.get_monthly_stats_by_biller(
            start_month=start_month,
            end_month=end_month,
            biller_ids=biller_ids,
            msisdns=msisdns,
            channels=channels,
            statuses=statuses,
            limit=limit,
        )


# Cache all read-only query methods (TTL from settings; large results skipped).
from core.cache import cache_all_methods  # noqa: E402
cache_all_methods(BillerService)
