import logging
import pandas as pd
import io
import os
import re
import unicodedata
from datetime import datetime
from repositories.excel_analytics_repository import ExcelAnalyticsRepository
from core.config import settings
from typing import List, Dict, Any
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

class ExcelAnalyticsService:
    @staticmethod
    def _normalize_column_name(value: Any) -> str:
        text = str(value or "").strip().upper()
        text = unicodedata.normalize("NFKD", text)
        text = "".join(ch for ch in text if not unicodedata.combining(ch))
        text = re.sub(r"[^A-Z0-9]+", "", text)
        return text

    @staticmethod
    def _columns_look_sane(df: pd.DataFrame) -> bool:
        """
        Détecte les CSV à une seule colonne mal parsés (ex: 'MSISDN' avec sep=None
        peut être splitté en M | I | DN si le sniffer prend 'S' comme délimiteur).
        Un parsing sain a au moins une colonne dont le nom normalisé est un mot
        connu (MSISDN, PHONE, SHORTCODE…) OU contient plus de 3 caractères alpha.
        NB : on N'utilise PAS df.empty (True si 0 ligne) — un CSV avec juste un header
        est tout de même un parsing valide structurellement.
        """
        if df is None or len(df.columns) == 0:
            return False
        known_markers = (
            'MSISDN', 'PHONE', 'NUM', 'MOBILE', 'TEL', 'CELL', 'CONTACT',
            'GSM', 'SIM', 'SHORTCODE', 'CODE', 'BILLER',
        )
        for col in df.columns:
            norm = ExcelAnalyticsService._normalize_column_name(col)
            if any(m in norm for m in known_markers):
                return True
            # Sinon : au moins une colonne avec un nom non-trivial (>3 chars)
            if len(norm) >= 4:
                return True
        return False

    @staticmethod
    def _read_csv_with_fallbacks(file_content: bytes) -> pd.DataFrame:
        encodings = ["utf-8-sig", "utf-8", "cp1252", "latin-1"]
        # Ordre des séparateurs : explicites d'abord, sep=None en dernier recours
        separators = [',', ';', '\t', '|']

        decoded = None
        for encoding in encodings:
            try:
                decoded = file_content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if decoded is None:
            raise ValueError(
                "Unable to read the CSV encoding. Please save the file as UTF-8 CSV or Excel .xlsx."
            )

        # 1) Essais explicites — on retient le 1er parsing 'sain'
        for sep in separators:
            try:
                df = pd.read_csv(io.StringIO(decoded), sep=sep, dtype=str, engine='python')
                if ExcelAnalyticsService._columns_look_sane(df):
                    return df
            except Exception:
                continue

        # 2) Fallback : sniffer auto (peut se tromper, mais on tente)
        try:
            df = pd.read_csv(io.StringIO(decoded), sep=None, engine='python', dtype=str)
            if ExcelAnalyticsService._columns_look_sane(df):
                return df
        except Exception:
            pass

        # 3) Dernier recours : traiter le fichier comme une seule colonne
        # (1 valeur par ligne) — utile pour un fichier avec juste "MSISDN" + valeurs
        lines = [ln.strip() for ln in decoded.splitlines() if ln.strip()]
        if not lines:
            raise ValueError("The uploaded file is empty.")
        header = lines[0]
        # Si la 1re ligne ressemble à un en-tête (texte non-numérique court), on l'utilise
        if not header.replace('.', '').isdigit() and len(header) < 32:
            return pd.DataFrame({header: lines[1:]})
        # Sinon, supposer que toutes les lignes sont des MSISDN
        return pd.DataFrame({'MSISDN': lines})

    @staticmethod
    def extract_msisdns_from_file(file_content: bytes, filename: str) -> List[str]:
        """
        (Backwards-compatible) Returns just the MSISDN list.
        Prefer `extract_identifiers_from_file` for new code: it also detects SHORTCODE.
        """
        result = ExcelAnalyticsService.extract_identifiers_from_file(file_content, filename)
        return result["values"] if result["kind"] == "msisdn" else []

    @staticmethod
    def extract_identifiers_from_file(file_content: bytes, filename: str) -> Dict[str, Any]:
        """
        Parses an uploaded file (CSV/Excel) and returns:
          { "kind": "msisdn" | "shortcode", "column": <col>, "values": [...] }
        Priority: MSISDN-like column > SHORTCODE-like column.
        """
        try:
            lower_name = (filename or "").lower()
            if not file_content:
                raise ValueError("Uploaded file is empty.")

            if lower_name.endswith('.csv'):
                df = ExcelAnalyticsService._read_csv_with_fallbacks(file_content)
            elif lower_name.endswith(('.xlsx', '.xlsm')):
                df = pd.read_excel(io.BytesIO(file_content), dtype=str)
            elif lower_name.endswith('.xls'):
                raise ValueError("Legacy Excel .xls files are not supported. Please save the file as .xlsx or use .csv.")
            else:
                raise ValueError("Unsupported file type. Please upload a .csv, .xlsx, or .xlsm file.")

            if df.empty or len(df.columns) == 0:
                raise ValueError("The uploaded file has no readable columns or rows.")

            logger.info(
                f"[upload-bulk] {filename} parsed: shape={df.shape}, "
                f"columns={list(df.columns)}, "
                f"first_row={df.head(1).to_dict('records')}"
            )

            normalized_columns = {
                col: ExcelAnalyticsService._normalize_column_name(col)
                for col in df.columns
            }

            phone_markers = [
                'MSISDN', 'PHONE', 'PHONENUMBER', 'NUM', 'NUMBER', 'MOBILE',
                'MOBILENUMBER', 'TELEPHONE', 'TEL', 'CELL', 'CEL', 'CONTACT',
                'CONTACTNUMBER', 'GSM', 'SIM', 'ABSALT'
            ]
            shortcode_markers = [
                'SHORTCODE', 'SHORTCODES', 'ORGANIZATIONSHORTCODE', 'ORGSHORTCODE',
                'ORG_SHORTCODE', 'BILLERCODE', 'BILLER_CODE', 'CODE'
            ]
            name_markers = [
                'FULLNAMES', 'FULLNAME', 'FULL_NAMES', 'FULL_NAME',
                'IDENTITYNAME', 'CUSTOMERNAME', 'NOMCOMPLET', 'NOMSCOMPLETS',
                'NAMES', 'NAME', 'NOM', 'NOMS'
            ]

            msisdn_col = next(
                (col for col, norm in normalized_columns.items()
                 if any(m in norm for m in phone_markers)),
                None,
            )
            shortcode_col = next(
                (col for col, norm in normalized_columns.items()
                 if any(m in norm for m in shortcode_markers)),
                None,
            )
            name_col = next(
                (col for col, norm in normalized_columns.items()
                 if any(m in norm for m in name_markers)),
                None,
            )

            def sanitize(val):
                if pd.isna(val): return None
                s = str(val).strip()
                if s.endswith('.0'): s = s[:-2]
                return s if s else None

            # Priority : MSISDN > SHORTCODE > NAME (du plus spécifique au moins)
            if msisdn_col:
                values = df[msisdn_col].apply(sanitize).dropna().unique().tolist()
                if not values:
                    raise ValueError(f"Column '{msisdn_col}' was found, but it contains no valid phone numbers.")
                logger.info(f"Extracted {len(values)} unique MSISDNs from {filename}")
                return {"kind": "msisdn", "column": str(msisdn_col), "values": values}

            if shortcode_col:
                values = df[shortcode_col].apply(sanitize).dropna().unique().tolist()
                if not values:
                    raise ValueError(f"Column '{shortcode_col}' was found, but it contains no valid shortcodes.")
                logger.info(f"Extracted {len(values)} unique SHORTCODEs from {filename}")
                return {"kind": "shortcode", "column": str(shortcode_col), "values": values}

            if name_col:
                # Pour les noms, on garde la casse originale (sera normalisée côté SQL)
                # On nettoie juste les whitespaces multiples
                def sanitize_name(val):
                    if pd.isna(val): return None
                    s = ' '.join(str(val).split()).strip()
                    return s if s else None
                values = df[name_col].apply(sanitize_name).dropna().unique().tolist()
                if not values:
                    raise ValueError(f"Column '{name_col}' was found, but it contains no valid names.")
                logger.info(f"Extracted {len(values)} unique NAMES from {filename}")
                return {"kind": "name", "column": str(name_col), "values": values}

            raise ValueError(
                f"No MSISDN, SHORTCODE or FULL_NAMES column found. Available columns: {', '.join(map(str, df.columns))}"
            )
        except Exception as e:
            logger.error(f"Error extracting identifiers from file {filename}: {str(e)}")
            raise e

    @staticmethod
    def process_uploaded_list(
        db: Session,
        file_content: bytes,
        filename: str,
        identify_column: str = None,
    ) -> Dict[str, Any]:
        """
        Parse un fichier uploadé (CSV/XLSX), enrichit les MSISDN via Databricks
        et renvoie les lignes enrichies en JSON (pas d'écriture disque).
        """
        try:
            lower_name = (filename or "").lower()
            if not file_content:
                return {"status": "error", "message": "Le fichier est vide."}

            if lower_name.endswith('.csv'):
                df_input = ExcelAnalyticsService._read_csv_with_fallbacks(file_content)
            elif lower_name.endswith(('.xlsx', '.xlsm')):
                df_input = pd.read_excel(io.BytesIO(file_content), dtype=str)
            elif lower_name.endswith('.xls'):
                return {"status": "error", "message": "Le format .xls n'est pas supporté. Sauvegardez en .xlsx ou .csv."}
            else:
                return {"status": "error", "message": "Format non supporté. Utilisez .csv, .xlsx ou .xlsm."}

            if df_input.empty or len(df_input.columns) == 0:
                return {"status": "error", "message": "Aucune colonne ni ligne lisible."}

            normalized_columns = {
                col: ExcelAnalyticsService._normalize_column_name(col)
                for col in df_input.columns
            }
            phone_markers = [
                'MSISDN', 'PHONE', 'PHONENUMBER', 'NUM', 'NUMBER', 'MOBILE',
                'MOBILENUMBER', 'TELEPHONE', 'TEL', 'CELL', 'CEL', 'CONTACT',
                'CONTACTNUMBER', 'GSM', 'SIM', 'ABSALT'
            ]
            name_markers = [
                'FULLNAMES', 'FULLNAME', 'FULL_NAMES', 'FULL_NAME',
                'IDENTITYNAME', 'CUSTOMERNAME', 'NOMCOMPLET', 'NOMSCOMPLETS',
                'NAMES', 'NAME', 'NOM', 'NOMS'
            ]
            # Colonne IDENTIFY optionnelle — son contenu sera préservé tel quel
            # et attaché à chaque MSISDN dans le résultat enrichi.
            # Substring match (tolère IDENTIFY_NUM, IDENT_ID, etc.) en excluant
            # IDENTITYNAME qui appartient au pool 'name'.
            identify_markers = ('IDENTIFY', 'IDENTIFIER', 'IDENTITY', 'IDENT')

            msisdn_col = next(
                (col for col, norm in normalized_columns.items()
                 if any(m in norm for m in phone_markers)),
                None,
            )
            name_col = next(
                (col for col, norm in normalized_columns.items()
                 if any(m in norm for m in name_markers)),
                None,
            )
            # Override explicite par le client (dropdown UI) > auto-détection
            if identify_column and identify_column.strip() and identify_column != "__none__":
                target = identify_column.strip()
                # Match insensible à la casse / espaces
                identify_col = next(
                    (col for col in df_input.columns
                     if str(col).strip().lower() == target.lower()),
                    None,
                )
                if not identify_col:
                    # essai sur la version normalisée (au cas où le client envoie le nom original)
                    target_norm = ExcelAnalyticsService._normalize_column_name(target)
                    identify_col = next(
                        (col for col, norm in normalized_columns.items()
                         if norm == target_norm),
                        None,
                    )
            elif identify_column == "__none__":
                identify_col = None
            else:
                identify_col = next(
                    (col for col, norm in normalized_columns.items()
                     if any(m in norm for m in identify_markers)
                        and 'NAME' not in norm
                        and col != msisdn_col
                        and col != name_col),
                    None,
                )
            logger.info(
                f"[verification] Columns → MSISDN: {msisdn_col!r} · NAME: {name_col!r} · "
                f"IDENTIFY: {identify_col!r} (explicit={identify_column!r}) · "
                f"available: {list(df_input.columns)}"
            )

            if not msisdn_col:
                return {
                    "status": "error",
                    "message": f"Pas de colonne MSISDN détectée. Colonnes : {', '.join(map(str, df_input.columns))}"
                }

            def sanitize_msisdn(val):
                if pd.isna(val): return None
                s = str(val).strip()
                if s.endswith('.0'): s = s[:-2]
                return s if s else None

            df_input[msisdn_col] = df_input[msisdn_col].apply(sanitize_msisdn)
            df_filtered = df_input.dropna(subset=[msisdn_col])

            # Map MSISDN → IDENTIFY (première occurrence gagne, pour matcher la dédup MSISDN)
            identify_map: Dict[str, str] = {}
            if identify_col:
                for _, row in df_filtered.iterrows():
                    msisdn = row[msisdn_col]
                    if not msisdn or msisdn in identify_map:
                        continue
                    raw = row[identify_col]
                    if pd.isna(raw):
                        identify_map[msisdn] = ""
                    else:
                        s = str(raw).strip()
                        if s.endswith('.0'):
                            s = s[:-2]
                        identify_map[msisdn] = s

            input_data = []
            for _, row in df_filtered.iterrows():
                if name_col and name_col in df_filtered.columns and not pd.isna(row[name_col]):
                    name = str(row[name_col]).strip() or "Unknown"
                else:
                    name = "Unknown"
                input_data.append({"NOM_COMPLET": name, "MSISDN": row[msisdn_col]})

            if not input_data:
                return {"status": "error", "message": "Aucun MSISDN valide trouvé."}

            # Dédup par MSISDN
            unique_data = {item['MSISDN']: item for item in input_data}.values()
            input_data = list(unique_data)

            repository = ExcelAnalyticsRepository(db)
            enriched_rows = repository.get_enriched_data(input_data)
            df_enriched = pd.DataFrame(enriched_rows)

            # Convertit en list[dict] et injecte la colonne IDENTIFY en premier si présente
            enriched_data = df_enriched.fillna('').to_dict('records')
            if identify_col:
                reordered = []
                for row in enriched_data:
                    msisdn = row.get('MSISDN', '')
                    new_row = {'IDENTIFY': identify_map.get(msisdn, '')}
                    new_row.update(row)
                    reordered.append(new_row)
                enriched_data = reordered

            # ====== Sauvegarde sur le serveur (Original + Verified) ======
            saved_path: str = ""
            try:
                input_path_cfg = (settings.ANALYTICS_INPUT_PATH or "").strip('"').strip("'")
                server_dir = os.path.dirname(input_path_cfg) if input_path_cfg else ""
                if server_dir and not os.path.exists(server_dir):
                    os.makedirs(server_dir, exist_ok=True)
                if not server_dir:
                    # fallback : à côté de l'exécutable backend
                    server_dir = os.path.abspath(os.path.dirname(__file__) + "/../verified_uploads")
                    os.makedirs(server_dir, exist_ok=True)

                base, _ = os.path.splitext(os.path.basename(filename) or "uploaded.xlsx")
                ts = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
                out_filename = f"{base}_verified_{ts}.xlsx"
                saved_path = os.path.join(server_dir, out_filename)

                df_to_write = pd.DataFrame(enriched_data) if enriched_data else pd.DataFrame()
                with pd.ExcelWriter(saved_path, engine='openpyxl', mode='w') as writer:
                    df_input.to_excel(writer, sheet_name='Original', index=False)
                    df_to_write.to_excel(writer, sheet_name='Verified', index=False)
                logger.info(f"[verification] Saved enriched result → {saved_path}")
            except Exception as save_err:
                logger.warning(f"[verification] Could not save server file: {save_err}")
                saved_path = ""

            return {
                "status": "success",
                "filename": filename,
                "available_columns": [str(c) for c in df_input.columns],
                "msisdn_column": str(msisdn_col),
                "name_column": str(name_col) if name_col else None,
                "identify_column": str(identify_col) if identify_col else None,
                "records_processed": len(input_data),
                "records_found": len(enriched_data),
                "saved_to_server": saved_path or None,
                "data": enriched_data,
            }
        except Exception as e:
            logger.exception(f"Error processing uploaded list: {str(e)}")
            return {"status": "error", "message": str(e)}

    @staticmethod
    def process_ht_list(db: Session, input_path: str) -> Dict[str, Any]:
        """
        Processes an HT list (Excel/CSV), enriches it using Databricks data,
        and saves the result to a new sheet in the same file.
        """
        # ... logic remains same as before ...
        input_path = input_path.strip('"').strip("'") if input_path else ""
        
        try:
            if not os.path.exists(input_path):
                raise FileNotFoundError(f"Input file not found: {input_path}")

            if input_path.lower().endswith('.csv'):
                df_input = pd.read_csv(input_path, sep=None, engine='python', dtype=str)
            else:
                df_input = pd.read_excel(input_path, dtype=str)
            
            msisdn_col = 'MSISDN'
            if msisdn_col not in df_input.columns:
                return {"status": "error", "message": "Column 'MSISDN' not found in input file"}

            def sanitize_msisdn(val):
                if pd.isna(val): return None
                s = str(val).strip()
                if s.endswith('.0'): s = s[:-2]
                return s

            name_col = 'NOM_COMPLET'
            df_input[msisdn_col] = df_input[msisdn_col].apply(sanitize_msisdn)
            df_filtered = df_input.dropna(subset=[msisdn_col])

            # ====== Détection auto de la colonne IDENTIFY (server mode) ======
            normalized_columns = {
                col: ExcelAnalyticsService._normalize_column_name(col)
                for col in df_input.columns
            }
            identify_markers = ('IDENTIFY', 'IDENTIFIER', 'IDENTITY', 'IDENT')
            identify_col = next(
                (col for col, norm in normalized_columns.items()
                 if any(m in norm for m in identify_markers)
                    and 'NAME' not in norm
                    and col != msisdn_col
                    and col != name_col),
                None,
            )
            logger.info(f"[server-mode] Detected IDENTIFY: {identify_col!r} · MSISDN: {msisdn_col!r}")

            identify_map: Dict[str, str] = {}
            if identify_col:
                for _, row in df_filtered.iterrows():
                    msisdn = row[msisdn_col]
                    if not msisdn or msisdn in identify_map:
                        continue
                    raw = row[identify_col]
                    if pd.isna(raw):
                        identify_map[msisdn] = ""
                    else:
                        s = str(raw).strip()
                        if s.endswith('.0'):
                            s = s[:-2]
                        identify_map[msisdn] = s

            input_data = []
            for _, row in df_filtered.iterrows():
                name = str(row[name_col]).strip() if name_col in df_input.columns and not pd.isna(row[name_col]) else "Unknown"
                input_data.append({"NOM_COMPLET": name, "MSISDN": row[msisdn_col]})

            if not input_data:
                return {"status": "error", "message": "No valid records found in input file"}

            unique_data = {item['MSISDN']: item for item in input_data}.values()
            input_data = list(unique_data)

            repository = ExcelAnalyticsRepository(db)
            enriched_rows = repository.get_enriched_data(input_data)

            df_enriched = pd.DataFrame(enriched_rows)

            # Injecte IDENTIFY en première colonne de df_enriched si détectée
            if identify_col and not df_enriched.empty and 'MSISDN' in df_enriched.columns:
                df_enriched.insert(
                    0, 'IDENTIFY',
                    df_enriched['MSISDN'].map(identify_map).fillna('')
                )

            try:
                client_name_col = 'NOM_CLIENT'
                sheet_name = 'EnrichedResults'
                if client_name_col in df_input.columns:
                    client_name = df_input[client_name_col].iloc[0] if not df_input[client_name_col].empty else None
                    if client_name and not pd.isna(client_name):
                        sheet_name = str(client_name).strip()[:31].replace('[', '').replace(']', '').replace('*', '').replace('?', '').replace(':', '').replace('/', '').replace('\\', '')

                if input_path.lower().endswith(('.xlsx', '.xls', '.xlsm')):
                    with pd.ExcelWriter(input_path, engine='openpyxl', mode='a', if_sheet_exists='replace') as writer:
                        df_enriched.to_excel(writer, sheet_name=sheet_name, index=False)
                else:
                    df_enriched.to_csv(input_path, index=False)

                return {
                    "status": "success",
                    "records_processed": len(input_data),
                    "records_found": len(df_enriched),
                    "output_file": input_path,
                    "identify_column": identify_col,
                    "data": df_enriched.fillna('').to_dict('records')
                }
            except PermissionError:
                return {"status": "error", "message": f"Permission denied: The file '{input_path}' is open in another app."}
        except Exception as e:
            logger.exception(f"Error processing HT list: {str(e)}")
            raise e
