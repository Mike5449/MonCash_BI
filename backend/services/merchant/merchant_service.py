from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import date
from repositories.merchant.merchant_repository import MerchantRepository
from repositories.merchant.merchant_transaction_repository import MerchantTransactionRepository


class MerchantService:
    @staticmethod
    def get_accounts(
        db: Session,
        limit: int = 100,
        offset: int = 0,
        created_start: Optional[date] = None,
        created_end:   Optional[date] = None,
        merchant_types: Optional[List[str]] = None,
        departments:    Optional[List[str]] = None,
        statuses:       Optional[List[str]] = None,
        search:         Optional[str] = None,
    ) -> Dict[str, Any]:
        return MerchantRepository(db).get_merchant_accounts(
            limit=limit, offset=offset,
            created_start=created_start, created_end=created_end,
            merchant_types=merchant_types, departments=departments,
            statuses=statuses, search=search,
        )

    @staticmethod
    def get_accounts_filter_options(db: Session) -> Dict[str, List[str]]:
        return MerchantRepository(db).get_filter_options()

    @staticmethod
    def get_accounts_for_export(
        db: Session,
        created_start: Optional[date] = None,
        created_end:   Optional[date] = None,
        merchant_types: Optional[List[str]] = None,
        departments:    Optional[List[str]] = None,
        statuses:       Optional[List[str]] = None,
        search:         Optional[str] = None,
        limit:          int = 2_000_000,
    ) -> List[Dict[str, Any]]:
        return MerchantRepository(db).get_merchant_accounts_for_export(
            created_start=created_start, created_end=created_end,
            merchant_types=merchant_types, departments=departments,
            statuses=statuses, search=search, limit=limit,
        )

    @staticmethod
    def get_transactions(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        merchant_id_list: Optional[List[str]] = None,
        limit: int = 100,
        offset: int = 0,
        channels: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        repository = MerchantTransactionRepository(db)
        return repository.get_transactions(
            start_date, end_date, service_names, merchant_id_list, limit, offset,
            channels, msisdns, statuses,
        )

    @staticmethod
    def get_active_merchants(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 500,
        offset: int = 0,
    ) -> Dict[str, Any]:
        repository = MerchantTransactionRepository(db)
        return repository.get_active_merchants(start_date, end_date, limit, offset)

    @staticmethod
    def get_transactions_summary(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        merchant_id_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        repository = MerchantTransactionRepository(db)
        return repository.get_transactions_summary(
            start_date, end_date, service_names, merchant_id_list, channels, msisdns, statuses,
        )

    @staticmethod
    def get_monthly_stats_by_merchant(
        db: Session,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        merchant_id_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        msisdns: Optional[List[str]] = None,
        statuses: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> Dict[str, Any]:
        repository = MerchantTransactionRepository(db)
        return repository.get_monthly_stats_by_merchant(
            start_month, end_month, service_names, merchant_id_list,
            channels, msisdns, statuses, limit,
        )


# Cache all read-only query methods (TTL from settings; large results skipped).
from core.cache import cache_all_methods  # noqa: E402
cache_all_methods(MerchantService)
