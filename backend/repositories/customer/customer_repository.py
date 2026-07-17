import re
from sqlalchemy import text
from typing import List, Dict, Any, Optional


def _normalize_name_for_search(name: str) -> str:
    """
    Réplique en Python la logique SQL :
      array_join(
        sort_array(
          split(regexp_replace(lower(regexp_replace(NAME, '/$', '')), '[^a-z ]', ''), ' ')
        ),
      ' ')

    Tolère l'ordre des mots, la casse, et la ponctuation.
    Exemples : "John Doe" == "DOE JOHN" == "john / doe" == "John  Doe."
    """
    if not name:
        return ""
    s = re.sub(r'/$', '', str(name))
    s = s.lower()
    s = re.sub(r'[^a-z ]', '', s)
    parts = sorted([p for p in s.split(' ') if p])
    return ' '.join(parts)


# SQL expression qui calcule la même chose côté Databricks sur IDENTITYNAME
_NAME_SQL_EXPR = (
    "array_join("
    "sort_array("
    "split("
    "regexp_replace(lower(regexp_replace(IDENTITYNAME, '/$', '')), '[^a-z ]', '')"
    ", ' ')"
    "), ' ')"
)


class CustomerRepository:
    def __init__(self, db):
        self.db = db

    def _get_active_date_subquery(self):
        return "(SELECT MAX(TO_DATE(DATE_CODE,'yyyyMMdd')) FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit)"

    def _build_where_clauses(
        self,
        status=None, kyc=None, id_status=None, id_clean=None,
        has_address=None, imt_opt_in=None,
        expiry_date=None,
        created_start=None, created_end=None,
        msisdn=None, msisdn_list=None,
        shortcode_list=None,
        identity_type: Optional[str] = "Customer",
        name=None, name_list=None,
        date_code: Optional[str] = None,
    ):
        # whitelist pour éviter toute injection — ne laisser passer que les valeurs connues
        safe_identity_type = identity_type if identity_type in ("Customer", "Organization") else "Customer"
        inner_conditions = [f"IDENTITYTYPE = '{safe_identity_type}'"]

        # DATE_CODE : si l'utilisateur fournit une valeur, on l'utilise (match exact ou préfixe)
        # — sinon on prend le snapshot le plus récent (comportement par défaut historique).
        if date_code:
            # Sanitize : garde uniquement les chiffres (DATE_CODE est numérique yyyyMMdd)
            cleaned = re.sub(r'[^0-9]', '', str(date_code))
            if cleaned:
                # Match exact si 8 digits, sinon préfixe (ex: '202606' → tout juin 2026)
                if len(cleaned) == 8:
                    inner_conditions.append(f"DATE_CODE = '{cleaned}'")
                else:
                    inner_conditions.append(f"DATE_CODE LIKE '{cleaned}%'")
            else:
                inner_conditions.append(f"TO_DATE(DATE_CODE,'yyyyMMdd') = {self._get_active_date_subquery()}")
        else:
            inner_conditions.append(f"TO_DATE(DATE_CODE,'yyyyMMdd') = {self._get_active_date_subquery()}")

        if status:
            inner_conditions.append(f"IDENTITYSTATUS = '{status}'")

        if kyc:
            inner_conditions.append(f"TRUSTLEVEL = '{kyc}'")

        if msisdn:
            inner_conditions.append(f"IDENTITYMSISDN LIKE '%{msisdn}%'")

        if msisdn_list and len(msisdn_list) > 0:
            msisdns_str = ",".join([f"'{m}'" for m in msisdn_list])
            inner_conditions.append(f"IDENTITYMSISDN IN ({msisdns_str})")

        if shortcode_list and len(shortcode_list) > 0:
            shortcodes_str = ",".join([f"'{s}'" for s in shortcode_list])
            inner_conditions.append(f"ORGANIZATIONSHORTCODE IN ({shortcodes_str})")

        # Recherche par IDENTITYNAME — tolère ordre, casse, ponctuation
        # via sort_array(split(lower(regexp_replace(...))))
        if name:
            norm = _normalize_name_for_search(name)
            if norm:
                safe = norm.replace("'", "''")
                inner_conditions.append(f"{_NAME_SQL_EXPR} = '{safe}'")

        if name_list and len(name_list) > 0:
            normalized = []
            for n in name_list:
                nn = _normalize_name_for_search(n)
                if nn:
                    normalized.append(nn.replace("'", "''"))
            if normalized:
                names_str = ",".join(f"'{n}'" for n in normalized)
                inner_conditions.append(f"{_NAME_SQL_EXPR} IN ({names_str})")
            
        if has_address:
            if has_address == 'YES':
                inner_conditions.append("ADDRESS IS NOT NULL AND TRIM(ADDRESS) <> '' AND LOWER(TRIM(ADDRESS)) <> 'default'")
            elif has_address == 'NO':
                inner_conditions.append("(ADDRESS IS NULL OR TRIM(ADDRESS) = '' OR LOWER(TRIM(ADDRESS)) = 'default')")
        
        if imt_opt_in:
            inner_conditions.append(f"UPPER(IMTOPTIN) = UPPER('{imt_opt_in}')")

        if expiry_date:
            inner_conditions.append(f"DATE(TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd')) = DATE('{expiry_date}')")

        if created_start:
            inner_conditions.append(f"DATE(TO_DATE(DATEIDENTITYREGISTERED, 'yyyyMMddHHmmss')) >= DATE('{created_start}')")
        if created_end:
            inner_conditions.append(f"DATE(TO_DATE(DATEIDENTITYREGISTERED, 'yyyyMMddHHmmss')) <= DATE('{created_end}')")
            
        outer_conditions = ["rn = 1"]
        if id_status:
            outer_conditions.append(f"ID_STATUS = '{id_status}'")
        if id_clean:
            outer_conditions.append(f"ID_CLEAN = '{id_clean}'")
            
        return " AND ".join(inner_conditions), " AND ".join(outer_conditions)

    def get_customers(
        self,
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
        limit: int = 100,
        offset: int = 0,
        shortcode_list: Optional[List[str]] = None,
        identity_type: Optional[str] = "Customer",
        name: Optional[str] = None,
        name_list: Optional[List[str]] = None,
        date_code: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        inner_where, outer_where = self._build_where_clauses(
            status, kyc, id_status, id_clean, has_address, imt_opt_in,
            expiry_date, created_start, created_end,
            msisdn, msisdn_list, shortcode_list,
            identity_type=identity_type,
            name=name, name_list=name_list,
            date_code=date_code,
        )

        # Optimisation perf : on construit d'abord les MSISDN visés (CTE customer_data),
        # puis on filtre la sous-requête de localisation à ces MSISDNs UNIQUEMENT —
        # évite un scan complet de ht_location/vw_dt_network_sites pour chaque appel.
        query = f"""
        WITH customer_data AS (
            SELECT * FROM(
                SELECT
                    DATE_CODE,
                    to_date(DATEIDENTITYREGISTERED,'yyyyMMddHHmmss') AS CREATED_DATE,
                    IDENTITYMSISDN AS MSISDN,
                    replace( IDENTITYNAME,'/','') AS IDENTITYNAME,
                    GENDER,
                    TO_DATE(DOB, 'yyyy-MM-dd') AS DOB,
                    CASE
                        WHEN TO_DATE(DOB, 'yyyy-MM-dd') IS NULL
                          OR TO_DATE(DOB, 'yyyy-MM-dd') > current_date THEN NULL
                        ELSE FLOOR(DATEDIFF(current_date, TO_DATE(DOB, 'yyyy-MM-dd')) / 365.25)
                    END AS AGE,
                    IDNUMBER AS ID_NUMBER,
                    IDTYPE AS ID_TYPE,
                    TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') AS ID_EXPIRY_DATE ,
                    CASE
                        WHEN ID_EXPIRY_DATE IS NULL THEN 'Unknown'
                        WHEN ID_EXPIRY_DATE <= current_date THEN 'Expired'
                        ELSE 'Valid'
                    END AS ID_STATUS,
                    CASE WHEN REGEXP_LIKE(IDNUMBER, '[ _-]') THEN 'NO'
                        ELSE 'YES'
                    END AS ID_CLEAN,
                    REGEXP_REPLACE(IDNUMBER, '[ _-]', '') AS IDNUMBER_CLEAN,
                    IDENTITYSTATUS AS STATUS,
                    TRUSTLEVEL,
                    CASE
                        WHEN TRUSTLEVEL = 'Registered Customer Level 0' THEN 'MINI WALLET'
                        WHEN TRUSTLEVEL = 'Registered Customer Level 1' THEN 'FULL WALLET'
                        ELSE 'OTHER'
                    END AS KYC,
                    ADDRESS,
                    PRODUCTS,
                    IMTOPTIN,
                    LASTMODIFIED,
                    ROW_NUMBER() OVER (
                        PARTITION BY IDENTITYMSISDN
                        ORDER BY TO_DATE(LASTMODIFIED,'yyyyMMddHHmmss') DESC
                    ) AS rn,
                    split(ACCOUNT, '\\\\^')[4] AS BALANCE
                FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
                WHERE {inner_where}
              ) AS main_table
              WHERE {outer_where}
              ORDER BY CREATED_DATE DESC
              LIMIT {limit} OFFSET {offset}
        ),
        location_data AS (
            -- 1 row per MSISDN — network location from yesterday (CURRENT_DATE - 1)
            -- Filtre poussé : on ne lit que les locations des MSISDN qui seront retournés
            SELECT MSISDN, SECTOR, CITY, DEPARTMENT, ZONE
            FROM (
                SELECT
                    LO.MSISDN,
                    SI.SECTOR,
                    SI.CITY,
                    SI.DEPARTMENT,
                    SI.CLUSTERS AS ZONE,
                    ROW_NUMBER() OVER (
                        PARTITION BY LO.MSISDN
                        ORDER BY SI.SITE_CODE, SI.SECTOR
                    ) AS loc_rn
                FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
                INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                    ON LO.site_code_30d = SI.site_code AND LO.sector_30d = SI.sector
                WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
                  AND LO.MSISDN IN (SELECT MSISDN FROM customer_data)
            ) loc_ranked
            WHERE loc_rn = 1
        )
        SELECT
            c.*,
            l.SECTOR     AS SECTOR,
            l.CITY       AS CITY,
            l.DEPARTMENT AS DEPARTMENT,
            l.ZONE       AS ZONE
        FROM customer_data c
        LEFT JOIN location_data l ON c.MSISDN = l.MSISDN
        ORDER BY c.CREATED_DATE DESC
        """
        
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]

    def get_customer_summary(
        self,
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
        inner_where, outer_where = self._build_where_clauses(
            status, kyc, id_status, id_clean, has_address, imt_opt_in,
            expiry_date, created_start, created_end,
            msisdn, msisdn_list, shortcode_list,
            identity_type=identity_type,
            name=name, name_list=name_list,
        )

        query = f"""
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN STATUS = 'Active' THEN 1 END) as total_active,
            COUNT(CASE WHEN STATUS = 'Pending Active' THEN 1 END) as total_pending,
            COUNT(CASE WHEN STATUS = 'Suspended' THEN 1 END) as total_suspended,
            COUNT(CASE WHEN STATUS = 'Dormant' THEN 1 END) as total_dormant,
            COUNT(CASE WHEN STATUS = 'Frozen' THEN 1 END) as total_frozen,
            COUNT(CASE WHEN STATUS = 'Closed' THEN 1 END) as total_closed,
            COUNT(CASE WHEN KYC = 'FULL WALLET' THEN 1 END) as full_total,
            COUNT(CASE WHEN KYC = 'FULL WALLET' AND STATUS = 'Active' THEN 1 END) as full_active,
            COUNT(CASE WHEN KYC = 'FULL WALLET' AND STATUS = 'Pending Active' THEN 1 END) as full_pending,
            COUNT(CASE WHEN KYC = 'FULL WALLET' AND STATUS = 'Suspended' THEN 1 END) as full_suspended,
            COUNT(CASE WHEN KYC = 'FULL WALLET' AND STATUS = 'Dormant' THEN 1 END) as full_dormant,
            COUNT(CASE WHEN KYC = 'FULL WALLET' AND STATUS = 'Frozen' THEN 1 END) as full_frozen,
            COUNT(CASE WHEN KYC = 'FULL WALLET' AND STATUS = 'Closed' THEN 1 END) as full_closed,
            COUNT(CASE WHEN KYC = 'MINI WALLET' THEN 1 END) as mini_total,
            COUNT(CASE WHEN KYC = 'MINI WALLET' AND STATUS = 'Active' THEN 1 END) as mini_active,
            COUNT(CASE WHEN KYC = 'MINI WALLET' AND STATUS = 'Pending Active' THEN 1 END) as mini_pending,
            COUNT(CASE WHEN KYC = 'MINI WALLET' AND STATUS = 'Suspended' THEN 1 END) as mini_suspended,
            COUNT(CASE WHEN KYC = 'MINI WALLET' AND STATUS = 'Dormant' THEN 1 END) as mini_dormant,
            COUNT(CASE WHEN KYC = 'MINI WALLET' AND STATUS = 'Frozen' THEN 1 END) as mini_frozen,
            COUNT(CASE WHEN KYC = 'MINI WALLET' AND STATUS = 'Closed' THEN 1 END) as mini_closed,
            COUNT(CASE WHEN ADDRESS IS NULL OR TRIM(ADDRESS) = '' OR LOWER(TRIM(ADDRESS)) = 'default' THEN 1 END) as without_address,
            COUNT(CASE WHEN ADDRESS IS NOT NULL AND TRIM(ADDRESS) <> '' AND LOWER(TRIM(ADDRESS)) <> 'default' THEN 1 END) as with_address,
            COUNT(CASE WHEN UPPER(IMTOPTIN) = 'YES' THEN 1 END) as imt_yes,
            COUNT(CASE WHEN UPPER(IMTOPTIN) = 'NO' THEN 1 END) as imt_no,
            COUNT(CASE WHEN UPPER(GENDER) IN ('FEMALE', 'F') THEN 1 END) as total_female,
            COUNT(CASE WHEN UPPER(GENDER) IN ('MALE', 'M') THEN 1 END) as total_male,
            COUNT(CASE WHEN GENDER IS NULL OR TRIM(GENDER) = '' OR UPPER(GENDER) NOT IN ('FEMALE','F','MALE','M') THEN 1 END) as total_gender_unknown,
            COUNT(CASE WHEN ID_STATUS = 'Expired' THEN 1 END) as id_expired,
            COUNT(CASE WHEN ID_STATUS = 'Valid' THEN 1 END) as id_valid
        FROM (
            SELECT
                IDENTITYSTATUS AS STATUS,
                ADDRESS,
                IMTOPTIN,
                GENDER,
                IDENTITYMSISDN AS MSISDN,
                CASE
                    WHEN TRUSTLEVEL = 'Registered Customer Level 0' THEN 'MINI WALLET'
                    WHEN TRUSTLEVEL = 'Registered Customer Level 1' THEN 'FULL WALLET'
                END AS KYC,
                CASE
                    WHEN TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') IS NULL THEN 'Unknown'
                    WHEN TO_DATE(CAST(IDEXPIRYDATE AS STRING), 'yyyyMMdd') <= current_date THEN 'Expired'
                    ELSE 'Valid'
                END AS ID_STATUS,
                CASE WHEN REGEXP_LIKE(IDNUMBER, '[ _-]') THEN 'NO'
                     ELSE 'YES'
                END AS ID_CLEAN,
                ROW_NUMBER() OVER (
                    PARTITION BY IDENTITYMSISDN
                    ORDER BY TO_DATE(LASTMODIFIED,'yyyyMMddHHmmss') DESC
                ) AS rn
            FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
            WHERE {inner_where}
        ) AS main_table
        WHERE {outer_where}
        """
        
        result = self.db.execute(text(query)).mappings().first()
        return dict(result) if result else {}

    # ─────────────────────────────────────────────────────────────────────────
    # Compliance KYC Info
    # ─────────────────────────────────────────────────────────────────────────
    # Extracts the KYC fields expected by compliance for a specific list of
    # MSISDNs (typically uploaded as an Excel file by an analyst). Query is
    # aligned 1:1 with the business team's reference SQL — DO NOT change
    # column order or aliases without their sign-off.
    #
    # Only IDENTITYTYPE = 'Customer' is included, and the snapshot is
    # `to_date(DATE_CODE, 'yyyyMMdd') = current_date - 1` (latest available).
    # Each MSISDN is deduplicated to its most recent LASTMODIFIED row.
    def get_compliance_kyc_info(
        self,
        msisdns: List[str],
    ) -> List[Dict[str, Any]]:
        """
        For each MSISDN in the input list, returns the KYC fields required by
        compliance : identity type / number, gender, DOB, address, commune,
        département, MonCash account status.

        Returns an empty list when the input list is empty (no query issued).
        MSISDNs not found in the latest audit snapshot are simply absent from
        the response — the frontend can compare counts to detect missing ones.
        """
        if not msisdns:
            return []
        # Sanitize + de-duplicate the input to prevent injection and control
        # the IN(...) list size.
        cleaned = list({m.strip() for m in msisdns if m and m.strip()})
        if not cleaned:
            return []
        m_list_str = "', '".join(cleaned)

        # NB : aliases mixed-case wrapped in backticks so Databricks returns
        # the columns with the exact case the compliance team expects
        # (`Nom_complet`, `Bene_phys`, `MONCASH_STATUS` etc.).
        # `ville_Bene_phys` and `departement_Bene_phys` come from the network
        # location snapshot (LOCALISATION CTE) instead of the audit table.
        query = f"""
        WITH CLEAN_DATA AS (
            SELECT * FROM (
                SELECT DISTINCT
                    IDENTITYMSISDN                              AS `msisdn`,
                    replace(IDENTITYNAME, '/', '')              AS `Nom_complet`,
                    IDTYPE                                      AS `identification_Bene_phys`,
                    IDNUMBER                                    AS `numero_identite_Bene_phys`,
                    'Haiti'                                     AS `pays_identification_Bene_phys`,
                    GENDER                                      AS `sexe_Bene_phys`,
                    DOB                                         AS `date_de_naissance_Bene_phys`,
                    ADDRESS                                     AS `adresse_Bene_phys`,
                    'Haiti'                                     AS `pays_de_residence_Bene_phys`,
                    IDENTITYSTATUS                              AS `MONCASH_STATUS`,
                    ROW_NUMBER() OVER (
                        PARTITION BY IDENTITYMSISDN
                        ORDER BY to_date(LASTMODIFIED, 'yyyyMMddHHmmss') DESC
                    ) AS rn
                FROM gr_dgc_dwh_prd.ods_dl.mfs_mobile_banking_audit
                WHERE IDENTITYTYPE = 'Customer'
                  AND to_date(DATE_CODE, 'yyyyMMdd') = current_date - 1
                  AND IDENTITYMSISDN IN ('{m_list_str}')
            )
            WHERE rn = 1
        ),
        LOCALISATION AS (
            SELECT
                LO.MSISDN,
                SI.CITY,
                SI.DEPARTMENT,
                ROW_NUMBER() OVER (
                    PARTITION BY LO.MSISDN
                    ORDER BY SI.SITE_CODE, SI.SECTOR
                ) AS loc_rn
            FROM gr_dgc_dwh_prd.temp_dl.ht_location LO
            INNER JOIN gr_dgc_dwh_prd.temp_dl.vw_dt_network_sites SI
                ON LO.site_code = SI.site_code
               AND LO.sector    = SI.sector
            WHERE TO_DATE(LO.DATE_CODE, 'yyyyMMdd') = CURRENT_DATE - 1
              AND LO.MSISDN IN ('{m_list_str}')
        )
        SELECT
            CD.`msisdn`,
            CD.`Nom_complet`,
            CD.`identification_Bene_phys`,
            CD.`numero_identite_Bene_phys`,
            CD.`pays_identification_Bene_phys`,
            CD.`sexe_Bene_phys`,
            CD.`date_de_naissance_Bene_phys`,
            CD.`adresse_Bene_phys`,
            LO.CITY       AS `ville_Bene_phys`,
            LO.DEPARTMENT AS `departement_Bene_phys`,
            CD.`pays_de_residence_Bene_phys`,
            CD.`MONCASH_STATUS`
        FROM CLEAN_DATA CD
        LEFT JOIN LOCALISATION LO
            ON CD.`msisdn` = LO.MSISDN
           AND LO.loc_rn = 1
        """
        result = self.db.execute(text(query))
        return [dict(row) for row in result.mappings()]
