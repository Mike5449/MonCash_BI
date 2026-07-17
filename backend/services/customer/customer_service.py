from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import date
from repositories.customer.customer_repository import CustomerRepository
from repositories.customer.customer_transaction_repository import CustomerTransactionRepository

class CustomerService:
    @staticmethod
    def get_customers(
        db: Session,
        status: Optional[str] = None,
        kyc: Optional[str] = None,
        id_status: Optional[str] = None,
        id_clean: Optional[str] = None,
        has_address: Optional[str] = None,
        imt_opt_in: Optional[str] = None,
        expiry_date: Optional[str] = None,
        created_start: Optional[str] = None,
        created_end: Optional[str] = None,
        msisdn: Optional[str] = None,
        msisdn_list: Optional[List[str]] = None,
        skip: int = 0,
        limit: int = 100,
        shortcode_list: Optional[List[str]] = None,
        identity_type: Optional[str] = "Customer",
        name: Optional[str] = None,
        name_list: Optional[List[str]] = None,
        date_code: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerRepository(db)
        return repository.get_customers(
            status=status, kyc=kyc, id_status=id_status, id_clean=id_clean,
            has_address=has_address, imt_opt_in=imt_opt_in,
            expiry_date=expiry_date,
            created_start=created_start, created_end=created_end,
            msisdn=msisdn, msisdn_list=msisdn_list,
            limit=limit, offset=skip,
            shortcode_list=shortcode_list, identity_type=identity_type,
            name=name, name_list=name_list,
            date_code=date_code,
        )

    @staticmethod
    def get_customer_summary(
        db: Session,
        status: Optional[str] = None,
        kyc: Optional[str] = None,
        id_status: Optional[str] = None,
        id_clean: Optional[str] = None,
        has_address: Optional[str] = None,
        imt_opt_in: Optional[str] = None,
        expiry_date: Optional[str] = None,
        created_start: Optional[str] = None,
        created_end: Optional[str] = None,
        msisdn: Optional[str] = None,
        msisdn_list: Optional[List[str]] = None,
        shortcode_list: Optional[List[str]] = None,
        identity_type: Optional[str] = "Customer",
        name: Optional[str] = None,
        name_list: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        repository = CustomerRepository(db)
        return repository.get_customer_summary(
            status=status, kyc=kyc, id_status=id_status, id_clean=id_clean,
            has_address=has_address, imt_opt_in=imt_opt_in,
            expiry_date=expiry_date,
            created_start=created_start, created_end=created_end,
            msisdn=msisdn, msisdn_list=msisdn_list,
            shortcode_list=shortcode_list, identity_type=identity_type,
            name=name, name_list=name_list,
        )

    @staticmethod
    def get_compliance_kyc_info(
        db: Session,
        msisdns: List[str],
    ) -> List[Dict[str, Any]]:
        return CustomerRepository(db).get_compliance_kyc_info(msisdns)

    @staticmethod
    def get_transactions(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        limit: int = 100,
        offset: int = 0,
        active_only: bool = False,
        channels: Optional[List[str]] = None,
        transaction_statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_transactions(
            start_date, end_date, service_names, msisdn_list, limit, offset,
            active_only, channels, transaction_statuses,
        )

    @staticmethod
    def get_transactions_summary(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        transaction_statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_transactions_summary(
            start_date, end_date, service_names, msisdn_list, channels, transaction_statuses,
        )

    @staticmethod
    def get_daily_stats_by_type(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        limit: int = 5000,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_daily_stats_by_type(
            start_date, end_date, service_names, msisdn_list, channels, limit
        )

    @staticmethod
    def get_daily_stats_by_channel(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_daily_stats_by_channel(
            start_date, end_date, service_names, msisdn_list, channels, limit
        )

    @staticmethod
    def get_daily_stats_by_department(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        limit: int = 10000,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_daily_stats_by_department(
            start_date, end_date, service_names, msisdn_list, channels, limit
        )

    @staticmethod
    def get_daily_totals(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        departments: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_daily_totals(
            start_date, end_date, service_names, msisdn_list, channels, departments
        )

    @staticmethod
    def get_snapshot_daily_by_type(
        db: Session,
        report_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_snapshot_daily_by_type(
            report_date, service_names, msisdn_list, channels
        )

    @staticmethod
    def get_mtd_snapshot_by_type(
        db: Session,
        report_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        departments: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_mtd_snapshot_by_type(
            report_date, service_names, msisdn_list, channels, departments
        )

    @staticmethod
    def get_snapshot_daily_by_dimension(
        db: Session,
        report_date: Optional[date] = None,
        dimension: str = "DEPARTMENT",
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        departments: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return CustomerTransactionRepository(db).get_snapshot_daily_by_dimension(
            report_date, dimension, service_names, msisdn_list, channels, departments,
        )

    @staticmethod
    def get_mtd_snapshot_by_dimension(
        db: Session,
        report_date: Optional[date] = None,
        dimension: str = "DEPARTMENT",
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        departments: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return CustomerTransactionRepository(db).get_mtd_snapshot_by_dimension(
            report_date, dimension, service_names, msisdn_list, channels, departments,
        )

    @staticmethod
    def get_period_aggregates_by_dimension(
        db: Session,
        start_date: date,
        end_date: date,
        dimension: str,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        departments: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        return CustomerTransactionRepository(db).get_period_aggregates_by_dimension(
            start_date, end_date, dimension,
            service_names, msisdn_list, channels, departments,
        )

    @staticmethod
    def get_mtd_stats_by_month_and_type(
        db: Session,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        day_of_month: Optional[int] = None,
        departments: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_mtd_stats_by_month_and_type(
            start_month, end_month, service_names, msisdn_list, channels, day_of_month, departments
        )

    @staticmethod
    def get_mtd_stats_by_month_and_department(
        db: Session,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        day_of_month: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_mtd_stats_by_month_and_department(
            start_month, end_month, service_names, msisdn_list, channels, day_of_month
        )

    @staticmethod
    def get_mtd_stats_by_month_and_channel(
        db: Session,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        day_of_month: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_mtd_stats_by_month_and_channel(
            start_month, end_month, service_names, msisdn_list, channels, day_of_month
        )

    @staticmethod
    def get_monthly_totals(
        db: Session,
        start_month: Optional[date] = None,
        end_month: Optional[date] = None,
        service_names: Optional[List[str]] = None,
        msisdn_list: Optional[List[str]] = None,
        channels: Optional[List[str]] = None,
        day_of_month: Optional[int] = None,
        departments: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_monthly_totals(
            start_month, end_month, service_names, msisdn_list, channels, day_of_month, departments
        )

    @staticmethod
    def get_active_customers(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 100,
        offset: int = 0,
        wallet_type: Optional[str] = None,
        msisdns: Optional[List[str]] = None,
        transaction_statuses: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_active_customers(
            start_date, end_date, limit, offset, wallet_type, msisdns, transaction_statuses,
        )

    @staticmethod
    def get_subs_dashboard(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_subs_dashboard(start_date, end_date)

    @staticmethod
    def get_agent_otc(
        db: Session,
        start_date: date,
        end_date: date,
        date_code: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_agent_otc(start_date, end_date, date_code)

    @staticmethod
    def get_transaction_history(
        db: Session,
        msisdn: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_transaction_history(msisdn, start_date, end_date, status)

    @staticmethod
    def get_transaction_range(
        db: Session,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        service_names: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_transaction_range(start_date, end_date, service_names)

    @staticmethod
    def get_mtd_by_service_name(
        db: Session,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_mtd_by_service_name(report_date)

    @staticmethod
    def get_mtd_by_department(
        db: Session,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_mtd_by_department(report_date)

    @staticmethod
    def get_mtd_by_channel(
        db: Session,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_mtd_by_channel(report_date)

    @staticmethod
    def get_msisdn_departments(
        db: Session,
        msisdns: List[str],
    ) -> List[Dict[str, Any]]:
        repository = CustomerTransactionRepository(db)
        return repository.get_msisdn_departments(msisdns)

    @staticmethod
    def get_customer_churn_custom(
        db: Session,
        active_start: date,
        active_end: date,
        exclude_start: date,
        exclude_end: date,
        return_list: bool = False,
        limit: int = 100,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_customer_churn_custom(
            active_start, active_end, exclude_start, exclude_end, return_list, limit
        )

    @staticmethod
    def get_customer_churn_custom_enriched(
        db: Session,
        active_start: date,
        active_end: date,
        exclude_start: date,
        exclude_end: date,
        limit: int = 500,
        offset: int = 0,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_customer_churn_custom_enriched(
            active_start, active_end, exclude_start, exclude_end, limit, offset
        )

    @staticmethod
    def get_imt_churn(
        db: Session,
        active_start: date,
        active_end: date,
        exclude_start: date,
        exclude_end: date,
        return_list: bool = False,
        limit: int = 100,
        department: Optional[str] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_imt_churn(
            active_start, active_end, exclude_start, exclude_end, return_list, limit, department
        )

    @staticmethod
    def get_bank_wallet_snapshot_daily(
        db: Session,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_bank_wallet_snapshot_daily(report_date)

    @staticmethod
    def get_bank_wallet_snapshot_mtd(
        db: Session,
        report_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_bank_wallet_snapshot_mtd(report_date)

    @staticmethod
    def get_churn(
        db: Session,
        start_date: Optional[date] = None,
        period_days: int = 30,
        return_list: bool = False,
        limit: int = 100,
    ) -> Dict[str, Any]:
        repository = CustomerTransactionRepository(db)
        return repository.get_churn(start_date, period_days, return_list, limit)


# Cache all read-only query methods (TTL from settings; large results skipped).
from core.cache import cache_all_methods  # noqa: E402
cache_all_methods(CustomerService)
