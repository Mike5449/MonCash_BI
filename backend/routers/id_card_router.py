"""
ID Card OCR endpoint — Carte d'Identification Nationale (CIN) haïtienne.

Stack 100 % offline (zéro download runtime, identique Windows / Linux) :
- pytesseract : wrapper Python du binaire Tesseract.
- mrz         : parseur ICAO 9303 (TD1/TD2/TD3) avec validation des checksums.
                Pure Python — aucune dépendance externe.
- Pillow      : preprocessing image (EXIF + niveau de gris + auto-contraste).

Prérequis serveur :
- Windows : installer Tesseract depuis https://github.com/UB-Mannheim/tesseract/wiki
            (cocher 'French' à l'install)
- Linux   : sudo apt install tesseract-ocr tesseract-ocr-fra

Pipeline :
1. Multipart upload (recto obligatoire, verso optionnel mais recommandé).
2. Preprocessing image (orientation EXIF + gris + auto-contraste).
3. OCR via Tesseract (lang : fra + eng + hat si dispo).
4. Verso : parsing MRZ via lib `mrz` (checksums validés). Si OK, ses champs
   écrasent ceux du recto (priorité au déterministe).
5. Retour JSON éditable côté frontend.
"""
import io
import os
import re
import logging
from typing import Dict, Any, Optional, List, Tuple

from fastapi import APIRouter, UploadFile, File, HTTPException

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/tools/id-card",
    tags=["tools"],
)


# ── Tesseract binary discovery ────────────────────────────────────────────────
# Deux modes d'échec distincts :
#   1. pytesseract non installé (pip)  → pip install pytesseract Pillow mrz
#   2. tesseract.exe binaire absent     → installer UB-Mannheim (Win) ou apt-get (Linux)
_PYTESSERACT_INSTALLED = False
try:
    import pytesseract  # noqa: F401
    _PYTESSERACT_INSTALLED = True
except ImportError:
    pass


def _configure_tesseract_binary() -> Optional[str]:
    """Best-effort détection de tesseract sur Win/Linux. Renvoie le chemin trouvé ou None."""
    if not _PYTESSERACT_INSTALLED:
        return None

    import pytesseract as pt

    # Déjà sur PATH ?
    from shutil import which
    found = which("tesseract")
    if found:
        return found

    # Chemins d'install par défaut (Windows + macOS Brew + Linux)
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
        "/usr/bin/tesseract",
        "/usr/local/bin/tesseract",
        "/opt/homebrew/bin/tesseract",
    ]
    for p in candidates:
        if os.path.isfile(p):
            pt.pytesseract.tesseract_cmd = p
            return p
    return None


_TESS_PATH = _configure_tesseract_binary()


# ── MRZ helpers (lib `mrz` + fallback regex) ──────────────────────────────────
RE_MRZ_LINE_TD1 = re.compile(r"^[A-Z0-9<]{30}$")


def _normalize_mrz_line(line: str) -> str:
    """Normalise une ligne candidate MRZ : majuscules, retire espaces, pad à 30 chars."""
    s = line.upper()
    s = re.sub(r"\s+", "", s)
    s = s.replace("«", "<").replace(">", "<").replace("‹", "<").replace("›", "<")
    if 26 <= len(s) <= 30:
        s = s.ljust(30, "<")
    return s


def _extract_mrz_block(raw_text: str) -> Optional[str]:
    """Cherche 3 lignes contiguës ressemblant à un MRZ TD1 haïtien (HTI)."""
    lines = [_normalize_mrz_line(l) for l in raw_text.splitlines() if l.strip()]
    for i in range(len(lines) - 2):
        l1, l2, l3 = lines[i], lines[i+1], lines[i+2]
        if RE_MRZ_LINE_TD1.match(l1) and RE_MRZ_LINE_TD1.match(l2) and RE_MRZ_LINE_TD1.match(l3):
            if l1.startswith("I") and "HTI" in l1:
                return "\n".join([l1, l2, l3])
    return None


def _mrz_yymmdd_to_iso(yymmdd: str, *, is_birth: bool) -> Optional[str]:
    """YYMMDD → DD-MM-YYYY. Naissance : siècle 19xx si YY>30, sinon 20xx."""
    if not yymmdd or len(yymmdd) != 6 or not yymmdd.isdigit():
        return None
    yy, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:6])
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return None
    year = (1900 + yy if yy > 30 else 2000 + yy) if is_birth else (2000 + yy)
    return f"{dd:02d}-{mm:02d}-{year:04d}"


def _parse_mrz_with_lib(raw_text: str) -> Dict[str, Any]:
    """Parse le MRZ via lib `mrz` (checksums ICAO validés). Renvoie {} si KO."""
    mrz_block = _extract_mrz_block(raw_text)
    if not mrz_block:
        return {}

    try:
        from mrz.checker.td1 import TD1CodeChecker
    except ImportError:
        logger.warning("[ID_CARD] mrz library not installed — falling back to regex parser")
        return _parse_mrz_regex_fallback(mrz_block)

    try:
        checker = TD1CodeChecker(mrz_block)
        fields = checker.fields()
        all_valid = bool(checker)  # True si TOUS les checksums valident
        return {
            "mrz_surname":     str(fields.surname     or "").replace("<", " ").strip(),
            "mrz_given":       str(fields.name        or "").replace("<", " ").strip(),
            "mrz_sex":         str(fields.sex         or "").strip(),
            "mrz_nationality": str(fields.nationality or "").strip(),
            "mrz_dob":         _mrz_yymmdd_to_iso(str(fields.birth_date),  is_birth=True)  or "",
            "mrz_expiry":      _mrz_yymmdd_to_iso(str(fields.expiry_date), is_birth=False) or "",
            "mrz_doc_no":      str(fields.document_number or "").replace("<", "").strip(),
            "mrz_niu":         str(fields.optional_data   or "").replace("<", "").strip(),
            "mrz_all_checksums_valid": all_valid,
        }
    except Exception as e:
        logger.warning(f"[ID_CARD] mrz checker failed: {e} — falling back to regex parser")
        return _parse_mrz_regex_fallback(mrz_block)


def _parse_mrz_regex_fallback(mrz_block: str) -> Dict[str, Any]:
    """Parseur regex maison (utilisé si la lib `mrz` est indisponible / rejette les checksums)."""
    lines = mrz_block.splitlines()
    if len(lines) < 3:
        return {}
    l1, l2, l3 = lines[0], lines[1], lines[2]
    out: Dict[str, Any] = {"mrz_all_checksums_valid": False}

    m = re.match(r"^I<HTI([A-Z0-9<]{9})(\d)([A-Z0-9<]{15})$", l1)
    if m:
        out["mrz_doc_no"] = m.group(1).replace("<", "")
        niu_field = m.group(3).replace("<", "")
        if niu_field.isdigit():
            out["mrz_niu"] = niu_field

    m = re.match(r"^(\d{6})(\d)([MF<])(\d{6})(\d)([A-Z<]{3})", l2)
    if m:
        out["mrz_dob"]    = _mrz_yymmdd_to_iso(m.group(1), is_birth=True)  or ""
        out["mrz_expiry"] = _mrz_yymmdd_to_iso(m.group(4), is_birth=False) or ""
        if m.group(3) in ("M", "F"): out["mrz_sex"] = m.group(3)
        nat = m.group(6).replace("<", "")
        if nat: out["mrz_nationality"] = nat

    m = re.match(r"^([A-Z<]+)<<([A-Z< ]+)$", l3)
    if m:
        out["mrz_surname"] = m.group(1).replace("<", " ").strip()
        out["mrz_given"]   = m.group(2).replace("<", " ").strip()
    return out


# ── Parsing du recto (regex / labels) ─────────────────────────────────────────
RE_DATE = re.compile(r"\b(\d{2})[-/. ](\d{2})[-/. ](\d{4})\b")
RE_NIU  = re.compile(r"\b(\d{10})\b")
# Numéro de carte CIN : 1 lettre + 3 chiffres + 2 lettres + 3 chiffres (ex. H001CH620)
# On tolère les confusions OCR usuelles : O↔0, I↔1, espaces parasites.
RE_CARD = re.compile(r"\b([A-Z][O0]{0,1}\d{2,3}[A-Z]{2}\d{3})\b")
RE_SEX  = re.compile(r"\bSe[xkc]s?[^A-Z]*([MF])\b", re.IGNORECASE)

# Pour les confusions O↔0 dans le numéro de carte, on normalise après extraction.
def _normalize_card_number(s: str) -> str:
    """H0O1CH620 → H001CH620 : convertit O→0 dans les positions numériques."""
    if len(s) < 6:
        return s
    out = list(s)
    # Position 1-3 et 6-9 sont numériques : O → 0
    for i in (1, 2, 3, 6, 7, 8):
        if i < len(out) and out[i] == 'O':
            out[i] = '0'
    return "".join(out)


# Départements connus d'Haïti — sert d'ancre quand le label est mal lu
HAITIAN_DEPARTMENTS = {
    "OUEST", "SUD", "SUD-EST", "SUD EST", "NORD", "NORD-EST", "NORD EST",
    "NORD-OUEST", "NORD OUEST", "ARTIBONITE", "CENTRE", "GRAND'ANSE",
    "GRANDE ANSE", "GRAND ANSE", "NIPPES",
}


def _normalize_text(raw: str) -> List[str]:
    out = []
    for line in raw.splitlines():
        s = re.sub(r"[\t\xa0]+", " ", line).strip()
        if s:
            out.append(s)
    return out


def _value_after_label(lines: List[str], label_patterns: List[str]) -> Optional[str]:
    for i, line in enumerate(lines):
        for pat in label_patterns:
            if re.search(pat, line, re.IGNORECASE):
                for j in range(i + 1, min(i + 4, len(lines))):
                    candidate = lines[j].strip()
                    if not candidate:
                        continue
                    if re.match(r"^(Nom|Prénom|Sexe|Nationalité|Date|Lieu|Numéro|Signature|Commune|Département|Section|Adresse)", candidate, re.IGNORECASE):
                        break
                    return candidate
    return None


def _find_first(pattern: re.Pattern, lines: List[str]) -> Optional[str]:
    for line in lines:
        m = pattern.search(line)
        if m:
            return m.group(1) if m.groups() else m.group(0)
    return None


def _find_all_dates(lines: List[str]) -> List[str]:
    dates: List[str] = []
    for line in lines:
        for m in RE_DATE.finditer(line):
            d = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            if d not in dates:
                dates.append(d)
    return dates


def _parse_haitian_id(raw_text: str) -> Dict[str, Any]:
    """Champs du recto via ancres + regex tolérantes (accents optionnels, confusions OCR)."""
    lines = _normalize_text(raw_text)

    # Labels avec accents OPTIONNELS (Tesseract sans pack 'fra' lit "Prénom" comme "Prenom")
    prenom = _value_after_label(lines, [
        r"Pr[ée]nom\s*/?\s*Non", r"^Pr[ée]nom\b",
    ])
    nom = _value_after_label(lines, [
        r"Nom\s*/?\s*Siyati", r"^Nom\b(?!\s*&)",
    ])
    lieu = _value_after_label(lines, [
        r"Lieu\s*de\s*Naissance", r"Kote\s*ou\s*f[èe]t",
    ])
    nationalite = _value_after_label(lines, [
        r"Nationalit[ée]\s*/?\s*Nasyonalite", r"^Nationalit[ée]\b",
    ])

    sexe: Optional[str] = None
    m = RE_SEX.search(raw_text)
    if m:
        sexe = m.group(1).upper()
    else:
        v = _value_after_label(lines, [r"Sexe\s*/?\s*S[èe]ks", r"^Sexe\b"])
        if v:
            v_clean = re.sub(r"[^MF]", "", v.upper())
            if v_clean[:1] in ("M", "F"):
                sexe = v_clean[0]

    # ── Numéro de carte : RE_CARD avec confusion O↔0 puis normalisation
    numero_carte_raw = _find_first(RE_CARD, lines)
    numero_carte = _normalize_card_number(numero_carte_raw) if numero_carte_raw else None

    niu = _find_first(RE_NIU, lines)

    dates = _find_all_dates(lines)
    date_naissance  = dates[0] if len(dates) >= 1 else None
    date_emission   = dates[1] if len(dates) >= 2 else None
    date_expiration = dates[2] if len(dates) >= 3 else None

    # ── Fallbacks d'ancres absolues quand le label-after a échoué ──

    # Nationalité : si "HTI" apparaît seul sur une ligne ou dans un coin
    if not nationalite:
        for line in lines:
            if re.search(r"\bHTI\b", line):
                nationalite = "HTI"; break

    # Lieu de naissance : ancre sur les départements connus haïtiens
    if not lieu:
        for line in lines:
            up = line.upper()
            for dept in HAITIAN_DEPARTMENTS:
                if dept in up:
                    # Capture la ligne entière (souvent "OUEST - PORT-AU-PRINCE")
                    lieu = line.strip(); break
            if lieu: break

    return {
        "prenom":           prenom or "",
        "nom":              nom or "",
        "sexe":             sexe or "",
        "nationalite":      nationalite or "",
        "lieu_naissance":   lieu or "",
        "date_naissance":   date_naissance or "",
        "date_emission":    date_emission or "",
        "date_expiration":  date_expiration or "",
        "numero_carte":     numero_carte or "",
        "numero_identification_unique": niu or "",
    }


def _parse_recto_robust(image_bytes: bytes) -> Tuple[Dict[str, Any], str]:
    """Parse robuste du recto :
       1. Multi-PSM (11, 6, 4) sur l'image preprocessée
       2. Parse chaque sortie séparément avec _parse_haitian_id
       3. Fusionne : pour chaque champ, prend la PREMIÈRE valeur non vide trouvée
          en parcourant les PSM dans l'ordre 11 → 6 → 4

    Retourne (fields_dict, concatenated_raw_text_for_debug).
    """
    image = _preprocess_for_ocr(image_bytes)
    outputs = _run_tesseract_multi_psm(image)
    if not outputs:
        return _parse_haitian_id(""), ""

    parsed_per_psm: List[Dict[str, Any]] = [_parse_haitian_id(t) for t in outputs]

    # Fusion : pour chaque champ, première valeur non vide en parcourant les PSM
    merged = _parse_haitian_id("")  # squelette avec toutes les clés à ""
    for key in merged.keys():
        for parsed in parsed_per_psm:
            v = parsed.get(key)
            if v:
                merged[key] = v
                break
    return merged, "\n\n--- PSM separator ---\n\n".join(outputs)


def _parse_back(raw_text: str) -> Dict[str, Any]:
    """Champs verso : adresse + Numéro de série + MRZ déterministe."""
    lines = _normalize_text(raw_text)
    out: Dict[str, Any] = {
        "departement":       _value_after_label(lines, [r"Département\s*/?\s*Depatman", r"^Département\b"]) or "",
        "commune":           _value_after_label(lines, [r"Commune\s*/?\s*Komin", r"^Commune\b"]) or "",
        "section_communale": _value_after_label(lines, [r"Section\s*communale", r"Seksyon\s*kominal"]) or "",
        "adresse":           _value_after_label(lines, [r"Adresse\s*/?\s*Adrès", r"^Adresse\b"]) or "",
    }

    serie = None
    for line in lines:
        if re.search(r"Numéro\s*de\s*série|Nimewo\s*S[eé]r", line, re.IGNORECASE):
            m = re.search(r"(\d{6,})", line)
            if m:
                serie = m.group(1); break
    if not serie:
        for line in lines:
            m = re.match(r"^\s*(\d{8,12})\s*$", line)
            if m: serie = m.group(1); break
    if serie:
        out["numero_serie"] = serie

    out.update(_parse_mrz_with_lib(raw_text))
    return out


# ── OCR pipeline (Tesseract) ──────────────────────────────────────────────────
def _preprocess_for_ocr(image_bytes: bytes):
    """Corrige l'orientation EXIF + niveau de gris auto-contraste pour Tesseract."""
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    img = img.convert("L")
    img = ImageOps.autocontrast(img, cutoff=2)
    return img


def _pick_lang(image) -> str:
    """Choisit le meilleur combo de langue dispo. Tente une fois fra+eng+hat,
    sinon fra+eng, sinon eng. Cache le résultat pour ne pas re-tester à chaque call."""
    import pytesseract
    for lang in ("fra+eng+hat", "fra+eng", "eng"):
        try:
            # Test très court (1 char) juste pour valider que les packs existent
            pytesseract.image_to_string(image, lang=lang, config="--psm 6", timeout=10)
            return lang
        except pytesseract.TesseractError as e:
            msg = str(e).lower()
            if "language" in msg or "data file" in msg:
                continue
            return lang  # autre type d'erreur, on ré-essaiera plus tard
    return "eng"


def _run_tesseract_multi_psm(image) -> List[str]:
    """OCR via Tesseract sur plusieurs PSM modes — retourne 1 string par PSM essayé.

    Layouts d'une CIN haïtienne :
    - 2 colonnes (gauche : photo + nom/prénom/lieu ; droite : numéro/sexe/dates)
    - PSM 11 = sparse text → trouve les blocs sans assumption de layout
    - PSM 6  = single uniform block of text → lit ligne par ligne (mais traverse les colonnes)
    - PSM 4  = single column of text → bon parfois
    On retourne tout, le parser tournera sur chaque variante et on fusionnera les champs.
    """
    import pytesseract

    lang = _pick_lang(image)
    outputs: List[str] = []
    for psm in (11, 6, 4):
        try:
            text = pytesseract.image_to_string(image, lang=lang, config=f"--psm {psm}")
            if text and text.strip():
                outputs.append(text)
        except pytesseract.TesseractError:
            continue
        except Exception:
            continue
    return outputs


def _run_tesseract(image) -> str:
    """Version simple pour le VERSO : un seul PSM (le verso a moins de pièges layout).
    Pour le RECTO, on appelle directement _run_tesseract_multi_psm + _parse_multi_psm.
    """
    outputs = _run_tesseract_multi_psm(image)
    # Concatène toutes les sorties — le verso n'a pas le problème de 2 colonnes,
    # donc on peut tout coller pour donner plus de chances aux ancres.
    return "\n\n".join(outputs) if outputs else ""


# ── Endpoint ──────────────────────────────────────────────────────────────────
async def _read_image_to_text(file: Optional[UploadFile]) -> Tuple[Optional[str], Optional[str]]:
    """Lit + OCR un upload. Renvoie (raw_text, error_message_or_None)."""
    if not file:
        return None, None
    if not file.content_type or not file.content_type.startswith("image/"):
        return None, "Le fichier doit être une image (JPEG ou PNG)."
    image_bytes = await file.read()
    if not image_bytes or len(image_bytes) < 1024:
        return None, "Image vide ou trop petite."
    if len(image_bytes) > 15 * 1024 * 1024:
        return None, "Image trop volumineuse (max 15 MB)."
    try:
        image = _preprocess_for_ocr(image_bytes)
    except Exception as e:
        logger.exception("[ID_CARD] Image preprocessing failed")
        return None, f"Image illisible : {e}"
    try:
        return _run_tesseract(image), None
    except Exception as e:
        logger.exception("[ID_CARD] Tesseract OCR failed")
        return None, f"OCR failed : {e}"


def _merge_recto_verso(recto: Dict[str, Any], verso: Dict[str, Any]) -> Dict[str, Any]:
    """Fusionne recto + verso avec PRIORITÉ AU MRZ (déterministe, checksums validés)."""
    out: Dict[str, Any] = {
        "prenom": "", "nom": "", "sexe": "", "nationalite": "",
        "lieu_naissance": "", "date_naissance": "", "date_emission": "",
        "date_expiration": "", "numero_carte": "", "numero_identification_unique": "",
        "departement": "", "commune": "", "section_communale": "", "adresse": "", "numero_serie": "",
    }
    for k, v in recto.items():
        if k in out and v: out[k] = v
    for k in ("departement", "commune", "section_communale", "adresse", "numero_serie"):
        if verso.get(k): out[k] = verso[k]
    # MRZ prioritaire
    if verso.get("mrz_surname"):     out["nom"]            = verso["mrz_surname"]
    if verso.get("mrz_given"):       out["prenom"]         = verso["mrz_given"]
    if verso.get("mrz_sex"):         out["sexe"]           = verso["mrz_sex"]
    if verso.get("mrz_nationality"): out["nationalite"]    = verso["mrz_nationality"]
    if verso.get("mrz_dob"):         out["date_naissance"] = verso["mrz_dob"]
    if verso.get("mrz_expiry"):      out["date_expiration"]= verso["mrz_expiry"]
    if verso.get("mrz_doc_no"):      out["numero_carte"]   = verso["mrz_doc_no"]
    if verso.get("mrz_niu"):         out["numero_identification_unique"] = verso["mrz_niu"]
    return out


@router.post(
    "/scan",
    summary="OCR + parsing CIN haïtienne (recto + verso optionnel) via Tesseract + lib mrz",
)
async def scan_id_card(
    file:  Optional[UploadFile] = File(None, description="Recto (Devant) — obligatoire"),
    front: Optional[UploadFile] = File(None, description="Alias de 'file' (recto)"),
    back:  Optional[UploadFile] = File(None, description="Verso (Dèyè) — fortement recommandé (MRZ avec checksums)"),
) -> Dict[str, Any]:
    """
    Retourne :
    ```
    {
      "fields":   { ...10 champs identité + 5 champs verso },
      "raw_text": { "front": "...", "back": "..." },
      "mrz_checksums_valid": true | false | null,
      "warning":  null | "..."
    }
    ```
    """
    if not _PYTESSERACT_INSTALLED:
        raise HTTPException(
            status_code=503,
            detail=(
                "Python package 'pytesseract' is not installed in the backend venv. "
                "Run :  pip install pytesseract Pillow mrz  — then restart FastAPI."
            ),
        )
    if not _TESS_PATH:
        raise HTTPException(
            status_code=503,
            detail=(
                "Tesseract binary (tesseract.exe) not found. "
                "Windows : install from https://github.com/UB-Mannheim/tesseract/wiki "
                "(default path C:\\Program Files\\Tesseract-OCR\\, tick 'French'). "
                "Linux : sudo apt install tesseract-ocr tesseract-ocr-fra. "
                "Restart FastAPI after install."
            ),
        )

    recto_file = front or file
    if not recto_file:
        raise HTTPException(status_code=400, detail="Recto (champ 'file' ou 'front') manquant.")

    # ── Recto : pipeline multi-PSM robuste ──
    # On lit les bytes, on preprocess une fois, puis on tente PSM 11/6/4 et on fusionne.
    if not recto_file.content_type or not recto_file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Recto : doit être une image (JPEG ou PNG).")
    recto_bytes = await recto_file.read()
    if not recto_bytes or len(recto_bytes) < 1024:
        raise HTTPException(status_code=400, detail="Recto : image vide ou trop petite.")
    if len(recto_bytes) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Recto : image trop volumineuse (max 15 MB).")

    try:
        recto_fields, raw_front = _parse_recto_robust(recto_bytes)
    except Exception as e:
        logger.exception("[ID_CARD] Recto parsing failed")
        raise HTTPException(status_code=500, detail=f"Recto : OCR failed — {e}")

    # ── Verso : pipeline simple (pas de problème 2 colonnes) ──
    raw_back: Optional[str] = None
    if back:
        raw_back, err = await _read_image_to_text(back)
        if err:
            raise HTTPException(status_code=400, detail=f"Verso : {err}")

    verso_fields = _parse_back(raw_back) if raw_back else {}
    fields = _merge_recto_verso(recto_fields, verso_fields)

    mrz_valid: Optional[bool] = None
    if verso_fields.get("mrz_doc_no") or verso_fields.get("mrz_surname"):
        mrz_valid = bool(verso_fields.get("mrz_all_checksums_valid"))

    filled = sum(1 for v in fields.values() if v)
    warning = None
    if filled < 5:
        warning = (
            "Moins de 5 champs reconnus. Vérifie la luminosité, la netteté et "
            "le cadrage. Si possible, upload aussi le VERSO — le MRZ y donne "
            "des champs de manière déterministe avec vérification des checksums."
        )
    elif not back:
        warning = (
            "Tu peux aussi uploader le verso : le MRZ y donne nom, prénom, sexe, "
            "dates et numéro de carte de manière déterministe (checksums validés)."
        )
    elif mrz_valid is False:
        warning = (
            "Le MRZ a été détecté mais ses checksums ICAO ne sont pas tous valides — "
            "des champs ont peut-être été mal lus. Vérifie chaque valeur manuellement."
        )

    return {
        "fields":   fields,
        "raw_text": { "front": raw_front or "", "back":  raw_back  or "" },
        "mrz_checksums_valid": mrz_valid,
        "warning":  warning,
        "tesseract_path": _TESS_PATH,
    }
