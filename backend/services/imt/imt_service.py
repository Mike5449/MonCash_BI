from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from repositories.imt.imt_transaction_repository import ImtTransactionRepository


class ImtService:
    @staticmethod
    def get_transactions(
        db: Session,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: int = 100,
        msisdns: Optional[List[str]] = None,
        sender_ids: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        repository = ImtTransactionRepository(db)
        return repository.get_transactions(
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            msisdns=msisdns,
            sender_ids=sender_ids,
            channels=channels,
            statuses=statuses,
        )

    @staticmethod
    def get_transactions_summary(
        db: Session,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        msisdns: Optional[List[str]] = None,
        sender_ids: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        repository = ImtTransactionRepository(db)
        return repository.get_summary(
            start_date=start_date,
            end_date=end_date,
            msisdns=msisdns,
            sender_ids=sender_ids,
            channels=channels,
            statuses=statuses,
        )


# Cache all read-only query methods.
from core.cache import cache_all_methods  # noqa: E402
cache_all_methods(ImtService)
