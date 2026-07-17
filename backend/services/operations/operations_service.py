from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from repositories.operations.operations_transaction_repository import OperationsTransactionRepository
from repositories.operations.emoney_ops_transaction_repository import EmoneyOpsTransactionRepository


class OperationsService:
    @staticmethod
    def get_transactions(
        db: Session,
        start_date:   Optional[str] = None,
        end_date:     Optional[str] = None,
        limit:        int = 100,
        reason_types: Optional[List[str]] = None,
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        return OperationsTransactionRepository(db).get_transactions(
            start_date=start_date, end_date=end_date, limit=limit,
            reason_types=reason_types, statuses=statuses,
            initiators=initiators, transaction_ids=transaction_ids,
        )

    @staticmethod
    def get_transactions_summary(
        db: Session,
        start_date:   Optional[str] = None,
        end_date:     Optional[str] = None,
        reason_types: Optional[List[str]] = None,
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return OperationsTransactionRepository(db).get_summary(
            start_date=start_date, end_date=end_date,
            reason_types=reason_types, statuses=statuses,
            initiators=initiators, transaction_ids=transaction_ids,
        )

    @staticmethod
    def get_distinct_initiators(
        db: Session,
        start_date: Optional[str] = None,
        end_date:   Optional[str] = None,
    ) -> List[str]:
        return OperationsTransactionRepository(db).get_distinct_initiators(
            start_date=start_date, end_date=end_date,
        )


class EmoneyOpsService:
    @staticmethod
    def get_transactions(
        db: Session,
        start_date:   Optional[str] = None,
        end_date:     Optional[str] = None,
        limit:        int = 100,
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
        account_classes: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        return EmoneyOpsTransactionRepository(db).get_transactions(
            start_date=start_date, end_date=end_date, limit=limit,
            statuses=statuses, initiators=initiators,
            transaction_ids=transaction_ids, account_classes=account_classes,
        )

    @staticmethod
    def get_transactions_summary(
        db: Session,
        start_date:   Optional[str] = None,
        end_date:     Optional[str] = None,
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
        account_classes: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return EmoneyOpsTransactionRepository(db).get_summary(
            start_date=start_date, end_date=end_date,
            statuses=statuses, initiators=initiators,
            transaction_ids=transaction_ids, account_classes=account_classes,
        )

    @staticmethod
    def get_distinct_initiators(
        db: Session,
        start_date: Optional[str] = None,
        end_date:   Optional[str] = None,
    ) -> List[str]:
        return EmoneyOpsTransactionRepository(db).get_distinct_initiators(
            start_date=start_date, end_date=end_date,
        )


from core.cache import cache_all_methods  # noqa: E402
cache_all_methods(OperationsService)
cache_all_methods(EmoneyOpsService)
