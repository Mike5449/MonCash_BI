import logging
from sqlalchemy import text
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


class OperationsTransactionRepository:
    """
    Transactions effectuées par l'équipe Operation interne — pas du trafic client.

    Scope (filtre dur) :
    - TRANSACTIONTYPE IN ('Bulk transfer', 'Customer Dormant')

    Mapping REASONTYPE → TRANSACTIONTYPE (côté données) :
    - 'Bulk customer to organization payment'  → TRANSACTIONTYPE = 'Bulk transfer'
    - 'Agent Account Replenishment'            → TRANSACTIONTYPE = 'Bulk transfer'
    - 'Money Transfer Prefunded'               → TRANSACTIONTYPE = 'Bulk transfer'
    - 'Bulk customer to customer payment'      → TRANSACTIONTYPE = 'Bulk transfer'
    - 'Customer Dormant Account Clean'         → TRANSACTIONTYPE = 'Customer Dormant'

    KPIs :
    - UNIQUE_CREDITORS = COUNT(DISTINCT CREDITPARTYIDENTIFIER)
    - UNIQUE_DEBITORS  = COUNT(DISTINCT DEBITPARTYIDENTIFIER)
    - VOLUME           = COUNT(DISTINCT TRANSACTIONID)
    - VALUE            = SUM(ORIGINALAMOUNT) HTG
    - REVENUE          = SUM(CHARGEAMOUNT)   HTG
    """

    TX_TABLE = "hive_metastore.ods_dl.mfs_transaction_aml"

    # Filtre dur sur TRANSACTIONTYPE — cette page n'expose QUE ces deux types.
    TX_TYPES = ("Bulk transfer", "Customer Dormant")

    # Whitelist des REASONTYPE — n'importe quelle autre valeur est rejetée silencieusement.
    REASON_TYPES_ALLOWED = {
        "Bulk customer to organization payment",
        "Agent Account Replenishment",
        "Money Transfer Prefunded",
        "Bulk customer to customer payment",
        "Customer Dormant Account Clean",
    }

    def __init__(self, db):
        self.db = db

    @staticmethod
    def _quote_list(values: List[str]) -> str:
        # IMPORTANT : Spark SQL traite '\' comme caractère d'échappement à l'intérieur des
        # littéraux entre quotes simples. Pour matcher un INITIATOR comme 'MM SP\GEORGES.LATOUCHE'
        # (qui contient un backslash réel en base), il faut envoyer 'MM SP\\GEORGES.LATOUCHE'
        # dans le SQL. Donc on remplace '\' par '\\' AVANT le quoting des single-quotes.
        cleaned = [
            str(v).replace("\\", "\\\\").replace("'", "''").strip()
            for v in values
            if v and str(v).strip()
        ]
        return "'" + "','".join(cleaned) + "'"

    def _build_where(
        self,
        start_date:   Optional[str],
        end_date:     Optional[str],
        reason_types: Optional[List[str]],
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
    ) -> str:
        # ── Lookup universel par TRANSACTIONID ──
        # Quand l'utilisateur fournit un ou plusieurs Tx ID, on court-circuite TOUS les autres
        # filtres (date, status, reason, initiator, et même le TRANSACTIONTYPE hardcodé).
        # Permet de récupérer une transaction même si elle est hors scope Operations,
        # utile pour le diagnostic rapide.
        if transaction_ids:
            cleaned_ids = [t.strip() for t in transaction_ids if t and t.strip()]
            if cleaned_ids:
                return f"WHERE TRANSACTIONID IN ({self._quote_list(cleaned_ids)})"

        tx_types_sql = self._quote_list(list(self.TX_TYPES))
        where = f"WHERE TRANSACTIONTYPE IN ({tx_types_sql})"

        # Status — défaut 'Completed', wildcard '*' désactive
        if statuses:
            cleaned = [s.strip() for s in statuses if s and s.strip()]
            wildcards = {"*", "ALL", "all"}
            if cleaned and not any(s in wildcards for s in cleaned):
                where += f" AND TRANSACTIONSTATUS IN ({self._quote_list(cleaned)})"
        else:
            where += " AND TRANSACTIONSTATUS = 'Completed'"

        # REASONTYPE — filtre la whitelist
        if reason_types:
            cleaned = [r.strip() for r in reason_types if r and r.strip()]
            allowed = [r for r in cleaned if r in self.REASON_TYPES_ALLOWED]
            if allowed:
                where += f" AND REASONTYPE IN ({self._quote_list(allowed)})"

        # INITIATOR — multi-select libre (valeurs choisies dans le dropdown distinct).
        # On normalise TRIM + UPPER des deux côtés :
        # - TRIM : la base peut contenir des espaces parasites (' john.doe ')
        # - UPPER : la base peut être en casse mixte ('John.Doe' vs 'JOHN.DOE')
        # Aligné avec `get_distinct_initiators` qui fait la même normalisation pour le dropdown.
        if initiators:
            cleaned = [i.strip().upper() for i in initiators if i and i.strip()]
            if cleaned:
                where += f" AND UPPER(TRIM(INITIATOR)) IN ({self._quote_list(cleaned)})"

        # Date range — PROCESS_DATE (yyyyMMdd) pour partition pruning Spark
        if start_date:
            ymd = start_date.replace("-", "")
            where += f" AND PROCESS_DATE >= '{ymd}'"
        if end_date:
            ymd = end_date.replace("-", "")
            where += f" AND PROCESS_DATE <= '{ymd}'"

        return where

    def get_transactions(
        self,
        start_date:   Optional[str] = None,
        end_date:     Optional[str] = None,
        limit:        int = 100,
        reason_types: Optional[List[str]] = None,
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        where = self._build_where(
            start_date, end_date, reason_types, statuses, initiators, transaction_ids,
        )

        # Log de diagnostic — utile quand des filtres complexes (initiators, multi-reason)
        # rendent 0 ligne et qu'on veut voir le SQL qui sort.
        logger.info("[OPERATIONS] get_transactions filters: initiators=%s reason_types=%s "
                    "statuses=%s transaction_ids=%s | WHERE=%s",
                    initiators, reason_types, statuses, transaction_ids, where)

        query = f"""
        SELECT
            TRANSACTIONID,
            TRANSACTIONFINISHTIME           AS TRANSACTION_DATE,
            CREDITPARTYIDENTIFIER           AS CREDITOR_ID,
            CREDITPARTYNAME                 AS CREDITOR_NAME,
            DEBITPARTYIDENTIFIER            AS DEBITOR_ID,
            DEBITPARTYNAME                  AS DEBITOR_NAME,
            ORIGINALAMOUNT,
            CHARGEAMOUNT,
            TRANSACTIONTYPE                 AS TR_TYPE,
            REASONTYPE,
            CHANNEL,
            TRANSACTIONSTATUS               AS STATUS,
            INITIATOR,
            FAILUREREASON,
            'OPERATIONS'                    AS ACCOUNT_TYPE
        FROM {self.TX_TABLE}
        {where}
        ORDER BY TRANSACTIONFINISHTIME DESC
        LIMIT {limit}
        """
        result = self.db.execute(text(query))
        rows = [dict(row) for row in result.mappings()]
        logger.info("[OPERATIONS] get_transactions returned %d rows", len(rows))
        return rows

    def get_summary(
        self,
        start_date:   Optional[str] = None,
        end_date:     Optional[str] = None,
        reason_types: Optional[List[str]] = None,
        statuses:     Optional[List[str]] = None,
        initiators:   Optional[List[str]] = None,
        transaction_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        where = self._build_where(
            start_date, end_date, reason_types, statuses, initiators, transaction_ids,
        )
        query = f"""
        SELECT
            CAST(COUNT(DISTINCT CREDITPARTYIDENTIFIER) AS STRING)  AS UNIQUE_CREDITORS,
            CAST(COUNT(DISTINCT DEBITPARTYIDENTIFIER)  AS STRING)  AS UNIQUE_DEBITORS,
            CAST(COUNT(DISTINCT TRANSACTIONID)         AS STRING)  AS VOLUME,
            CAST(COALESCE(SUM(ORIGINALAMOUNT), 0)      AS STRING)  AS VALUE,
            CAST(COALESCE(SUM(CHARGEAMOUNT),  0)       AS STRING)  AS REVENUE
        FROM {self.TX_TABLE}
        {where}
        """
        row = next(iter(self.db.execute(text(query)).mappings()), None) or {}

        def _to_int(v) -> int:
            try: return int(v) if v is not None else 0
            except (TypeError, ValueError):
                try: return int(float(v))
                except (TypeError, ValueError): return 0

        def _to_float(v) -> float:
            try: return float(v) if v is not None else 0.0
            except (TypeError, ValueError): return 0.0

        return {
            "UNIQUE_CREDITORS": _to_int(row.get("UNIQUE_CREDITORS")),
            "UNIQUE_DEBITORS":  _to_int(row.get("UNIQUE_DEBITORS")),
            "VOLUME":           _to_int(row.get("VOLUME")),
            "VALUE":            _to_float(row.get("VALUE")),
            "REVENUE":          _to_float(row.get("REVENUE")),
        }

    def get_distinct_initiators(
        self,
        start_date: Optional[str] = None,
        end_date:   Optional[str] = None,
    ) -> List[str]:
        """Renvoie la liste triée des INITIATOR distincts vus dans la période.

        Sert à peupler le dropdown du filter panel. Toujours scopé sur TRANSACTIONTYPE
        Operations (les autres filtres utilisateur ne s'appliquent PAS — on veut une
        liste stable indépendante de ce qui est actuellement filtré).
        """
        tx_types_sql = self._quote_list(list(self.TX_TYPES))
        where = f"WHERE TRANSACTIONTYPE IN ({tx_types_sql})"
        where += " AND INITIATOR IS NOT NULL AND TRIM(INITIATOR) <> ''"

        if start_date:
            where += f" AND PROCESS_DATE >= '{start_date.replace('-', '')}'"
        if end_date:
            where += f" AND PROCESS_DATE <= '{end_date.replace('-', '')}'"

        # On normalise TRIM + UPPER → 1 entrée par initiator même si la casse varie
        # dans la base. Aligné sur la comparaison dans _build_where (cf. INITIATOR filter).
        query = f"""
        SELECT DISTINCT UPPER(TRIM(INITIATOR)) AS INITIATOR
        FROM {self.TX_TABLE}
        {where}
        ORDER BY INITIATOR
        """
        result = self.db.execute(text(query))
        out = [str(row.get("INITIATOR") or "").strip()
               for row in result.mappings()
               if (row.get("INITIATOR") or "").strip()]
        logger.info("[OPERATIONS] distinct_initiators returned %d entries", len(out))
        return out
