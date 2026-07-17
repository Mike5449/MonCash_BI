from pydantic import BaseModel
from typing import Optional, List
from datetime import date

class TransactionResponse(BaseModel):
    TRANSACTIONID: str
    TRANSACTION_DATE: date
    TR_TYPE: str
    MSISDN: str
    ORIGINALAMOUNT: float
    CHARGEAMOUNT: Optional[float] = None
    STATUS: str
    FAILURE_REASON: Optional[str] = None
    INITIORTE_TYPE: Optional[str] = None
    INITIATOR: Optional[str] = None

    class Config:
        from_attributes = True
