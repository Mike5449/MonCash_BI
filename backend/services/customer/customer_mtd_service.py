from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from repositories.customer.customer_mtd_repository import CustomerMTDRepository


class CustomerMTDService:
    """Service for Month-to-Date customer transaction analytics."""
    
    @staticmethod
    def get_mtd_stats_by_type(
        db: Session,
        msisdn_list: Optional[List[str]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get statistics aggregated by transaction type for a given date range.
        
        Args:
            db: Database session
            msisdn_list: Optional list of MSISDNs to filter by
            start_date: Start date in YYYY-MM-DD format (defaults to first day of month)
            end_date: End date in YYYY-MM-DD format (defaults to today)
        
        Returns:
            Dict with period info, date range, and transaction type stats
        """
        from datetime import date as date_type
        
        # Convert string dates to date objects if provided
        start_date_obj = None
        end_date_obj = None
        
        if start_date:
            try:
                start_date_obj = date_type.fromisoformat(start_date)
            except (ValueError, AttributeError):
                start_date_obj = None
        
        if end_date:
            try:
                end_date_obj = date_type.fromisoformat(end_date)
            except (ValueError, AttributeError):
                end_date_obj = None
        
        repository = CustomerMTDRepository(db)
        return repository.get_mtd_stats_by_type(
            msisdn_list=msisdn_list,
            start_date=start_date_obj,
            end_date=end_date_obj
        )

    @staticmethod
    def get_mtd_stats_by_day(
        db: Session,
        tr_type: Optional[str] = None,
        msisdn_list: Optional[List[str]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get MTD statistics by day with daily breakdown.
        
        Args:
            db: Database session
            tr_type: Optional transaction type filter
            msisdn_list: Optional list of MSISDNs to filter by
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
        
        Returns:
            Dict with daily breakdown for each transaction type
        """
        from datetime import date as date_type
        
        start_date_obj = None
        end_date_obj = None
        
        if start_date:
            try:
                start_date_obj = date_type.fromisoformat(start_date)
            except (ValueError, AttributeError):
                start_date_obj = None
        
        if end_date:
            try:
                end_date_obj = date_type.fromisoformat(end_date)
            except (ValueError, AttributeError):
                end_date_obj = None
        
        repository = CustomerMTDRepository(db)
        return repository.get_mtd_stats_by_day(
            tr_type=tr_type,
            msisdn_list=msisdn_list,
            start_date=start_date_obj,
            end_date=end_date_obj
        )

    @staticmethod
    def get_subscribers_snapshot_by_day_of_month(
        db: Session,
        day_of_month: int,
        msisdn_list: Optional[List[str]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        from datetime import date as date_type

        start_date_obj = None
        end_date_obj = None
        if start_date:
            try:
                start_date_obj = date_type.fromisoformat(start_date)
            except (ValueError, AttributeError):
                start_date_obj = None
        if end_date:
            try:
                end_date_obj = date_type.fromisoformat(end_date)
            except (ValueError, AttributeError):
                end_date_obj = None

        repository = CustomerMTDRepository(db)
        return repository.get_subscribers_snapshot_by_day_of_month(
            day_of_month=day_of_month,
            msisdn_list=msisdn_list,
            start_date=start_date_obj,
            end_date=end_date_obj
        )


# Cache all read-only query methods (TTL from settings; large results skipped).
from core.cache import cache_all_methods  # noqa: E402
cache_all_methods(CustomerMTDService)
